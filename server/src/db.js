const fs = require('fs');
const path = require('path');
const { encryptSecret } = require('./services/secretService');

const defaultDbPath = path.join(__dirname, '../database.json');
const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : (process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'database.json') : defaultDbPath);

function ensureDatabaseFile() {
  const dbDir = path.dirname(dbPath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (!fs.existsSync(dbPath) && dbPath !== defaultDbPath && fs.existsSync(defaultDbPath)) {
    fs.copyFileSync(defaultDbPath, dbPath);
  }
}

// Memory store for multi-tenant data
let store = {
  stores: [],
  logs: [],
  blacklist: [],
  autoStoreId: 1,
  autoLogId: 1,
  autoBlacklistId: 1
};

// Load database file from disk
function loadDb() {
  try {
    ensureDatabaseFile();
    if (fs.existsSync(dbPath)) {
      const raw = fs.readFileSync(dbPath, 'utf8');
      const data = JSON.parse(raw);
      store.stores = data.stores || [];
      store.logs = data.logs || [];
      store.blacklist = data.blacklist || [];
      store.autoStoreId = data.autoStoreId || (store.stores.length > 0 ? Math.max(...store.stores.map(s => s.id)) + 1 : 1);
      store.autoLogId = data.autoLogId || (store.logs.length > 0 ? Math.max(...store.logs.map(l => l.id)) + 1 : 1);
      store.autoBlacklistId = data.autoBlacklistId || (store.blacklist.length > 0 ? Math.max(...store.blacklist.map(b => b.id)) + 1 : 1);

      // One-time migration: legacy files stored Sapo secrets in clear text.
      let migrated = false;
      store.stores.forEach(storeRecord => {
        if (storeRecord.api_secret && !storeRecord.api_secret_encrypted) {
          storeRecord.api_secret_encrypted = encryptSecret(storeRecord.api_secret);
          delete storeRecord.api_secret;
          migrated = true;
        }
      });
      if (migrated) saveDb();
    }
  } catch (err) {
    console.error('Error loading JSON DB:', err.message);
  }
}

// Save database file to disk
function saveDb() {
  try {
    ensureDatabaseFile();
    fs.writeFileSync(dbPath, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving JSON DB:', err.message);
  }
}

loadDb();

/**
 * Statement emulator providing sqlite-like prepare/run/get/all interface
 */
class DbStatement {
  constructor(sql) {
    this.sql = sql.trim();
  }

  run(...params) {
    const sql = this.sql;

    // INSERT INTO stores
    if (sql.includes('INSERT INTO stores')) {
      const newStore = {
        id: store.autoStoreId++,
        store_name: params[0],
        mysapo_domain: params[1],
        api_key: params[2],       // Entered by user from Sapo Admin
        api_secret_encrypted: params[3],
        is_active: 1,
        created_at: new Date().toISOString()
      };
      store.stores.unshift(newStore);
      saveDb();
      return { lastInsertRowid: newStore.id, changes: 1 };
    }

    // UPDATE stores
    if (sql.includes('UPDATE stores')) {
      const id = parseInt(params[params.length - 1]);
      const s = store.stores.find(x => x.id === id);
      if (s) {
        if (sql.includes('store_name = ?')) {
          s.store_name = params[0];
          s.mysapo_domain = params[1];
          s.api_key = params[2];
          s.api_secret_encrypted = params[3];
        } else if (sql.includes('is_active = ?')) {
          s.is_active = params[0];
        }
        saveDb();
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    // DELETE FROM stores WHERE id = ?
    if (sql.includes('DELETE FROM stores')) {
      const id = parseInt(params[0]);
      const initialCount = store.stores.length;
      store.stores = store.stores.filter(s => s.id !== id);
      saveDb();
      return { changes: initialCount - store.stores.length };
    }

    // INSERT INTO logs
    if (sql.includes('INSERT INTO logs')) {
      const columnMatch = sql.match(/INSERT INTO logs\s*\(([\s\S]*?)\)\s*VALUES/i);
      const columns = columnMatch
        ? columnMatch[1].split(',').map(col => col.trim()).filter(Boolean)
        : [];

      const mapped = {};
      columns.forEach((column, index) => {
        mapped[column] = params[index];
      });

      const log = {
        id: store.autoLogId++,
        store_id: mapped.store_id || params[0] || null,
        store_domain: mapped.store_domain || params[1] || 'sapo.vn',
        client_ip: mapped.client_ip !== undefined ? mapped.client_ip : params[2],
        webrtc_ip: mapped.webrtc_ip !== undefined ? mapped.webrtc_ip : params[3],
        user_agent: mapped.user_agent !== undefined ? mapped.user_agent : params[4],
        fingerprint: mapped.fingerprint !== undefined ? mapped.fingerprint : params[5],
        order_info: mapped.order_info !== undefined ? mapped.order_info : params[6],
        country: mapped.country !== undefined ? mapped.country : params[7],
        country_code: mapped.country_code !== undefined ? mapped.country_code : params[8],
        city: mapped.city !== undefined ? mapped.city : params[9],
        isp: mapped.isp !== undefined ? mapped.isp : params[10],
        org: mapped.org !== undefined ? mapped.org : params[11],
        is_vpn: mapped.is_vpn !== undefined ? mapped.is_vpn : params[12],
        is_datacenter: mapped.is_datacenter !== undefined ? mapped.is_datacenter : params[13],
        webrtc_mismatch: mapped.webrtc_mismatch !== undefined ? mapped.webrtc_mismatch : params[14],
        risk_level: mapped.risk_level !== undefined ? mapped.risk_level : params[15],
        risk_reasons: mapped.risk_reasons !== undefined ? mapped.risk_reasons : params[16],
        url: mapped.url || null,
        trigger_event: mapped.trigger_event || null,
        session_id: mapped.session_id || null,
        session_start_at: mapped.session_start_at || null,
        session_duration_sec: mapped.session_duration_sec || null,
        created_at: mapped.created_at || new Date().toISOString()
      };
      store.logs.unshift(log);
      saveDb();
      return { lastInsertRowid: log.id, changes: 1 };
    }

    // INSERT INTO blacklist
    if (sql.includes('INSERT INTO blacklist') || sql.includes('INSERT OR IGNORE INTO blacklist')) {
      const ip = params[0];
      const reason = params[1];
      const source = params[2] || 'MANUAL';

      const existingIndex = store.blacklist.findIndex(b => b.ip === ip);
      if (existingIndex !== -1) {
        store.blacklist[existingIndex].reason = reason;
        store.blacklist[existingIndex].source = source;
        store.blacklist[existingIndex].created_at = new Date().toISOString();
      } else {
        store.blacklist.unshift({
          id: store.autoBlacklistId++,
          ip,
          reason,
          source,
          created_at: new Date().toISOString()
        });
      }

      // Update existing logs for this IP to HIGH_RISK
      store.logs.forEach(l => {
        if (l.client_ip === ip) {
          l.risk_level = 'HIGH_RISK';
        }
      });

      saveDb();
      return { changes: 1 };
    }

    // UPDATE logs SET risk_level = 'HIGH_RISK' WHERE client_ip = ?
    if (sql.includes('UPDATE logs SET risk_level')) {
      if (sql.includes("risk_level = 'HIGH_RISK'") && sql.includes('WHERE client_ip = ?')) {
        const ip = params[0];
        let changes = 0;
        store.logs.forEach(l => {
          if (l.client_ip === ip || l.webrtc_ip === ip) {
            l.risk_level = 'HIGH_RISK';
            changes++;
          }
        });
        if (changes > 0) saveDb();
        return { changes };
      }

      const id = parseInt(params[params.length - 1]);
      const log = store.logs.find(l => l.id === id);
      if (log) {
        log.client_ip = params[0];
        log.risk_level = params[1];
        log.order_info = params[2];
        log.risk_reasons = params[3];
        saveDb();
        return { changes: 1 };
      }
      return { changes: 0 };
    }

    // DELETE FROM logs WHERE id = ?
    if (sql.includes('DELETE FROM logs')) {
      const id = parseInt(params[0]);
      const initialCount = store.logs.length;
      store.logs = store.logs.filter(l => l.id !== id);
      saveDb();
      return { changes: initialCount - store.logs.length };
    }

    // DELETE FROM blacklist WHERE ip = ?
    if (sql.includes('DELETE FROM blacklist')) {
      const ip = params[0];
      const initialCount = store.blacklist.length;
      store.blacklist = store.blacklist.filter(b => b.ip !== ip);
      saveDb();
      return { changes: initialCount - store.blacklist.length };
    }

    return { changes: 0 };
  }

  get(...params) {
    const results = this.all(...params);
    if (this.sql.includes('COUNT(*)')) {
      return results[0] || { count: 0, total: 0 };
    }
    return results[0] || null;
  }

  all(...params) {
    const sql = this.sql;

    // SELECT FROM stores
    if (sql.includes('FROM stores')) {
      if (sql.includes('WHERE api_key = ?')) {
        const apiKey = params[0];
        const match = store.stores.find(s => s.api_key === apiKey);
        return match ? [match] : [];
      }
      if (sql.includes('WHERE mysapo_domain = ?')) {
        const domain = params[0];
        const match = store.stores.find(s => s.mysapo_domain === domain);
        return match ? [match] : [];
      }
      if (sql.includes('WHERE id = ?')) {
        const id = parseInt(params[0]);
        const match = store.stores.find(s => s.id === id);
        return match ? [match] : [];
      }
      return [...store.stores];
    }

    // COUNT queries
    if (sql.includes('SELECT COUNT(*)')) {
      let filtered = [...store.logs];
      let paramIdx = 0;

      if (sql.includes('store_id = ?')) {
        const storeId = parseInt(params[paramIdx++]);
        if (storeId) filtered = filtered.filter(l => l.store_id === storeId || l.store_id === null);
      }

      if (sql.includes("risk_level = 'HIGH_RISK'")) {
        filtered = filtered.filter(l => l.risk_level === 'HIGH_RISK');
      }
      if (sql.includes('risk_level = ?')) {
        const targetRisk = params[paramIdx++];
        if (targetRisk && targetRisk !== 'ALL') {
          filtered = filtered.filter(l => l.risk_level === targetRisk);
        }
      }
      if (sql.includes('order_info IS NOT NULL')) {
        filtered = filtered.filter(l => l.order_info !== null && l.order_info !== '' && l.order_info !== 'null');
      }
      if (sql.includes('client_ip LIKE ?')) {
        const searchPattern = (params[paramIdx++] || '').replace(/%/g, '').toLowerCase();
        paramIdx += 4;
        if (searchPattern) {
          filtered = filtered.filter(l =>
            (l.client_ip && l.client_ip.toLowerCase().includes(searchPattern)) ||
            (l.webrtc_ip && l.webrtc_ip.toLowerCase().includes(searchPattern)) ||
            (l.isp && l.isp.toLowerCase().includes(searchPattern)) ||
            (l.order_info && l.order_info.toLowerCase().includes(searchPattern)) ||
            (l.fingerprint && l.fingerprint.toLowerCase().includes(searchPattern))
          );
        }
      }
      if (sql.includes('created_at >= ?')) {
        const startDate = params[paramIdx++];
        if (startDate) {
          filtered = filtered.filter(l => l.created_at && l.created_at >= startDate);
        }
      }
      if (sql.includes('created_at <= ?')) {
        const endDate = params[paramIdx++];
        if (endDate) {
          const endBoundary = endDate.length === 10 ? endDate + 'T23:59:59.999Z' : endDate;
          filtered = filtered.filter(l => l.created_at && l.created_at <= endBoundary);
        }
      }
      if (sql.includes("date(created_at) = date('now')")) {
        const today = new Date().toISOString().split('T')[0];
        filtered = filtered.filter(l => l.created_at && l.created_at.startsWith(today));
      }
      if (sql.includes('FROM blacklist')) {
        return [{ count: store.blacklist.length, total: store.blacklist.length }];
      }

      return [{ count: filtered.length, total: filtered.length }];
    }

    // SELECT FROM blacklist
    if (sql.includes('FROM blacklist')) {
      if (sql.includes('WHERE ip = ?')) {
        const lookupIps = params
          .filter(ip => ip !== null && ip !== undefined && ip !== '')
          .map(ip => String(ip));
        const match = store.blacklist.find(b => lookupIps.includes(b.ip));
        return match ? [match] : [];
      }
      return [...store.blacklist];
    }

    // SELECT FROM logs with filters
    if (sql.includes('FROM logs')) {
      let result = [...store.logs];
      let paramIdx = 0;

      // Filter store_id
      if (sql.includes('store_id = ?')) {
        const storeId = parseInt(params[paramIdx++]);
        if (storeId) {
          result = result.filter(l => l.store_id === storeId || l.store_id === null);
        }
      }

      // Filter order_info LIKE ? (exact match for order duplication check)
      if (sql.includes('order_info LIKE ?')) {
        const matchPattern = (params[paramIdx++] || '').replace(/%/g, '').toLowerCase();
        if (matchPattern) {
          result = result.filter(l => l.order_info && l.order_info.toLowerCase().includes(matchPattern));
        }
      }

      // Filter risk_level
      if (sql.includes('risk_level = ?')) {
        const targetRisk = params[paramIdx++];
        if (targetRisk && targetRisk !== 'ALL') {
          result = result.filter(l => l.risk_level === targetRisk);
        }
      }

      // Filter orders only before pagination
      if (sql.includes('order_info IS NOT NULL')) {
        result = result.filter(l => l.order_info !== null && l.order_info !== '' && l.order_info !== 'null');
      }

      // Filter search
      if (sql.includes('client_ip LIKE ?')) {
        const searchPattern = (params[paramIdx++] || '').replace(/%/g, '').toLowerCase();
        paramIdx += 4;
        if (searchPattern) {
          result = result.filter(l =>
            (l.client_ip && l.client_ip.toLowerCase().includes(searchPattern)) ||
            (l.webrtc_ip && l.webrtc_ip.toLowerCase().includes(searchPattern)) ||
            (l.isp && l.isp.toLowerCase().includes(searchPattern)) ||
            (l.order_info && l.order_info.toLowerCase().includes(searchPattern)) ||
            (l.fingerprint && l.fingerprint.toLowerCase().includes(searchPattern))
          );
        }
      }

      // Filter Date Range
      if (sql.includes('created_at >= ?')) {
        const startDate = params[paramIdx++];
        if (startDate) {
          result = result.filter(l => l.created_at && l.created_at >= startDate);
        }
      }
      if (sql.includes('created_at <= ?')) {
        const endDate = params[paramIdx++];
        if (endDate) {
          const endBoundary = endDate.length === 10 ? endDate + 'T23:59:59.999Z' : endDate;
          result = result.filter(l => l.created_at && l.created_at <= endBoundary);
        }
      }

      // Top ISPs query
      if (sql.includes('GROUP BY isp')) {
        const ispMap = {};
        result.filter(l => l.risk_level === 'HIGH_RISK' && l.isp && l.isp !== 'Unknown').forEach(l => {
          ispMap[l.isp] = (ispMap[l.isp] || 0) + 1;
        });
        const topIsps = Object.keys(ispMap)
          .map(isp => ({ isp, count: ispMap[isp] }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
        return topIsps;
      }

      // Time chart stats query
      if (sql.includes("strftime('%H:00', created_at)")) {
        const hourMap = {};
        const now = new Date();

        for (let i = 0; i < 24; i++) {
          const d = new Date(now.getTime() - i * 60 * 60 * 1000);
          const hourStr = String(d.getHours()).padStart(2, '0') + ':00';
          if (!hourMap[hourStr]) {
            hourMap[hourStr] = { time_label: hourStr, total: 0, high_risk: 0, clean: 0 };
          }
        }

        result.forEach(l => {
          if (l.created_at) {
            const date = new Date(l.created_at);
            const hourStr = String(date.getHours()).padStart(2, '0') + ':00';
            if (hourMap[hourStr]) {
              hourMap[hourStr].total++;
              if (l.risk_level === 'HIGH_RISK') hourMap[hourStr].high_risk++;
              else hourMap[hourStr].clean++;
            }
          }
        });

        return Object.values(hourMap).reverse();
      }

      if (sql.includes('ORDER BY created_at DESC')) {
        result = result.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
      } else if (sql.includes('ORDER BY id DESC')) {
        result = result.sort((a, b) => (b.id || 0) - (a.id || 0));
      } else if (sql.includes('ORDER BY id ASC')) {
        result = result.sort((a, b) => (a.id || 0) - (b.id || 0));
      }

      // Limit and Offset
      if (sql.includes('LIMIT ? OFFSET ?')) {
        const limit = params[paramIdx++] || 20;
        const offset = params[paramIdx++] || 0;
        return result.slice(offset, offset + limit);
      }

      return result;
    }

    return [];
  }
}

const db = {
  prepare(sql) {
    return new DbStatement(sql);
  }
};

console.log('Production Pure JS Database Engine initialized cleanly at:', dbPath);

module.exports = db;
