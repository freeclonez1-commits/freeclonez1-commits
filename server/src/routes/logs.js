const express = require('express');
const router = express.Router();
const db = require('../db');
const { analyzeRisk } = require('../services/ipService');
const { requireAdmin } = require('../middleware/adminAuth');
const { businessDayBounds } = require('../services/dateService');

const SESSION_LOOKBACK_MS = 2 * 60 * 60 * 1000;
const SESSION_GAP_MS = 5 * 60 * 1000;
const COLLECT_WINDOW_MS = 60 * 1000;
const COLLECT_MAX_PER_WINDOW = 30;
const collectionCounters = new Map();

function hasOrderInfoValue(value) {
  return !!(value && value !== 'null');
}

function safeJsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch (error) {
    return fallback;
  }
}

function allowCollection(ip) {
  const key = ip || 'unknown';
  const now = Date.now();
  const current = collectionCounters.get(key);
  if (!current || now - current.startedAt >= COLLECT_WINDOW_MS) {
    collectionCounters.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= COLLECT_MAX_PER_WINDOW;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Chưa bắt được phiên';

  const safeSeconds = Math.max(1, Math.round(seconds));
  if (safeSeconds < 15) return `${safeSeconds} giây (Đặt cực nhanh ⚡)`;
  if (safeSeconds < 60) return `${safeSeconds} giây`;

  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${mins} phút${secs > 0 ? ` ${secs}s` : ''}`;
}

function calculateTimeToOrder(orderRow, effectiveWebRtcIp, allRows) {
  if (orderRow.session_duration_sec) return Number(orderRow.session_duration_sec);

  const orderTimeMs = new Date(orderRow.created_at).getTime();
  if (!Number.isFinite(orderTimeMs)) return null;

  const targetIps = new Set([orderRow.client_ip, effectiveWebRtcIp].filter(Boolean));
  const candidates = allRows
    .filter(row => {
      if (row.id === orderRow.id || hasOrderInfoValue(row.order_info)) return false;
      const rowTimeMs = new Date(row.created_at).getTime();
      if (!Number.isFinite(rowTimeMs) || rowTimeMs > orderTimeMs) return false;
      if ((orderTimeMs - rowTimeMs) > SESSION_LOOKBACK_MS) return false;
      return targetIps.has(row.client_ip) || targetIps.has(row.webrtc_ip);
    })
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  if (candidates.length === 0) return null;

  const latest = candidates[candidates.length - 1];
  if (latest.session_start_at) {
    const sessionStartMs = new Date(latest.session_start_at).getTime();
    if (Number.isFinite(sessionStartMs) && sessionStartMs <= orderTimeMs) {
      return Math.round((orderTimeMs - sessionStartMs) / 1000);
    }
  }

  const clusterCandidates = latest.fingerprint && latest.fingerprint !== 'FP-SAPO-SYNCED'
    ? candidates.filter(row => row.fingerprint === latest.fingerprint)
    : candidates;

  const clusterLatest = clusterCandidates[clusterCandidates.length - 1] || latest;
  let clusterStart = latest;
  let previous = clusterLatest;
  clusterStart = clusterLatest;

  for (let i = clusterCandidates.length - 2; i >= 0; i--) {
    const current = clusterCandidates[i];
    const previousMs = new Date(previous.created_at).getTime();
    const currentMs = new Date(current.created_at).getTime();
    if ((previousMs - currentMs) > SESSION_GAP_MS) break;
    clusterStart = current;
    previous = current;
  }

  return Math.round((orderTimeMs - new Date(clusterStart.created_at).getTime()) / 1000);
}

function findSessionStartMs(orderRow, effectiveWebRtcIp, allRows) {
  const diffSec = calculateTimeToOrder(orderRow, effectiveWebRtcIp, allRows);
  if (diffSec === null || diffSec === undefined) return null;
  return new Date(orderRow.created_at).getTime() - (diffSec * 1000);
}

/**
 * POST /api/v1/logs/collect
 * Endpoint receiving tracking payload from Sapo frontend script
 */
router.post('/collect', async (req, res) => {
  try {
    const {
      client_ip,
      webrtc_ip,
      user_agent,
      fingerprint,
      order_info,
      api_key,
      url,
      trigger_event,
      session_id,
      session_start_at,
      session_duration
    } = req.body;

    const key = api_key || req.headers['x-sapo-api-key'] || req.query.apiKey;
    const referer = req.headers['referer'] || req.headers['origin'] || url || '';

    const allStores = db.prepare('SELECT * FROM stores').all();

    // Smart Sapo Store resolution
    let matchedStore = null;

    if (key) {
      matchedStore = allStores.find(s => s.api_key === key);
    }

    if (!matchedStore && referer) {
      matchedStore = allStores.find(s => referer.toLowerCase().includes(s.mysapo_domain.toLowerCase()));
    }

    if (!matchedStore) {
      return res.status(403).json({ success: false, message: 'Tracker origin is not a connected Sapo store.' });
    }

    const storeId = matchedStore.id;
    const storeDomain = matchedStore.mysapo_domain;

    // Detect actual client IP from various proxy & cloud headers
    let realClientIp = client_ip ||
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
      req.socket.remoteAddress;

    // Clean IPv6 mapped IPv4 addresses (::ffff:127.0.0.1 -> 127.0.0.1)
    if (realClientIp && realClientIp.includes('::ffff:')) {
      realClientIp = realClientIp.replace('::ffff:', '');
    }

    if (!realClientIp || realClientIp === '::1' || realClientIp === '127.0.0.1') {
      realClientIp = client_ip || 'unknown';
    }

    if (!allowCollection(realClientIp)) {
      return res.status(429).json({ success: false, message: 'Too many tracking events. Try again shortly.' });
    }

    // 1. Analyze Risk (IP API lookup, Datacenter check, WebRTC leak check)
    const analysis = await analyzeRisk(realClientIp, webrtc_ip);

    // 2. Check if either Client IP or WebRTC Real IP is in Blacklist
    const blacklistCheck = db.prepare(`
      SELECT * FROM blacklist 
      WHERE ip = ? OR (ip = ? AND ip IS NOT NULL AND ip != '')
    `).get(realClientIp, webrtc_ip || '');

    let finalRiskLevel = analysis.riskLevel;
    const finalReasons = [...analysis.riskReasons];

    if (blacklistCheck) {
      finalRiskLevel = 'HIGH_RISK';
      finalReasons.push(`IP nằm trong Danh sách đen (Lý do: ${blacklistCheck.reason || 'Bị chặn bởi quản trị viên'})`);
    }

    // 3. Save to database
    const orderInfoStr = order_info
      ? (typeof order_info === 'object' ? JSON.stringify(order_info) : order_info)
      : null;
    const riskReasonsStr = JSON.stringify(finalReasons);

    const stmt = db.prepare(`
      INSERT INTO logs (
        store_id, store_domain, client_ip, webrtc_ip, user_agent, fingerprint, order_info,
        country, country_code, city, isp, org,
        is_vpn, is_datacenter, webrtc_mismatch, risk_level, risk_reasons,
        url, trigger_event, session_id, session_start_at, session_duration_sec
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = stmt.run(
      storeId,
      storeDomain,
      realClientIp,
      webrtc_ip || null,
      user_agent || null,
      fingerprint || null,
      orderInfoStr,
      analysis.ipData.country || 'Unknown',
      analysis.ipData.countryCode || 'XX',
      analysis.ipData.city || 'Unknown',
      analysis.ipData.isp || 'Unknown',
      analysis.ipData.org || 'Unknown',
      analysis.isVpn,
      analysis.isDatacenter,
      analysis.webrtcMismatch,
      finalRiskLevel,
      riskReasonsStr,
      url || referer || null,
      trigger_event || null,
      session_id || null,
      session_start_at || null,
      session_duration || null
    );

    console.log(`[POST /collect] Saved Log #${result.lastInsertRowid} for ${storeDomain} (IP: ${realClientIp}, Risk: ${finalRiskLevel})`);

    res.status(201).json({
      success: true,
      log_id: result.lastInsertRowid,
      store_domain: storeDomain,
      client_ip: realClientIp,
      risk_level: finalRiskLevel,
      is_blacklisted: !!blacklistCheck,
      reasons: finalReasons
    });

  } catch (error) {
    console.error('Error collecting log:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

router.use(requireAdmin);

/**
 * GET /api/v1/logs
 * Retrieve logs for Dashboard with store filtering, status filtering, and pagination
 */
router.get('/', (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const offset = (page - 1) * limit;

    const { store_id, risk_level, search, startDate, endDate, orders_only } = req.query;

    let whereClauses = [];
    let params = [];

    if (store_id && store_id !== 'ALL') {
      whereClauses.push('(store_id = ? OR store_id IS NULL)');
      params.push(parseInt(store_id));
    }

    if (risk_level && risk_level !== 'ALL') {
      whereClauses.push('risk_level = ?');
      params.push(risk_level);
    }

    if (orders_only === 'true') {
      whereClauses.push("(order_info IS NOT NULL AND order_info != '' AND order_info != 'null')");
    }

    if (search) {
      whereClauses.push('(client_ip LIKE ? OR webrtc_ip LIKE ? OR isp LIKE ? OR order_info LIKE ? OR fingerprint LIKE ?)');
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
    }

    const startBounds = businessDayBounds(startDate);
    const endBounds = businessDayBounds(endDate);

    if (startBounds) {
      whereClauses.push('created_at >= ?');
      params.push(startBounds.start);
    }

    if (endBounds) {
      whereClauses.push('created_at <= ?');
      params.push(endBounds.end);
    }

    const whereString = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countStmt = db.prepare(`SELECT COUNT(*) as total FROM logs ${whereString}`);
    const { total } = countStmt.get(...params);

    const logsStmt = db.prepare(`
      SELECT * FROM logs
      ${whereString}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `);

    const rows = logsStmt.all(...params, limit, offset);

    // Get set of blacklisted IPs for instant lookup
    const blacklistRows = db.prepare('SELECT ip FROM blacklist').all();
    const blacklistedIpSet = new Set(blacklistRows.map(b => b.ip));

    // Use all logs to reconstruct the closest visit/session before each synced Sapo order.
    const earliestLogsStmt = db.prepare('SELECT * FROM logs ORDER BY created_at ASC');
    const allLogRows = earliestLogsStmt.all();

    // Build map of client_ip -> webrtc_ip from existing logs so orders automatically inherit WebRTC IPs
    const webrtcLookupStmt = db.prepare('SELECT client_ip, webrtc_ip FROM logs WHERE webrtc_ip IS NOT NULL AND webrtc_ip != "" ORDER BY id DESC');
    const webrtcRows = webrtcLookupStmt.all();
    const clientIpToWebRtc = {};
    for (const r of webrtcRows) {
      if (!clientIpToWebRtc[r.client_ip]) {
        clientIpToWebRtc[r.client_ip] = r.webrtc_ip;
      }
    }

    const logs = rows.map(row => {
      // Auto-inherit WebRTC IP if missing for this client IP
      const effectiveWebRtcIp = row.webrtc_ip || clientIpToWebRtc[row.client_ip] || null;

      // Calculate time taken to place order (from first visit on this IP to order created_at)
      let timeToOrderFormatted = null;

      const hasOrderInfo = row.order_info && row.order_info !== 'null';

      if (hasOrderInfo) {
        const orderTimeMs = new Date(row.created_at).getTime();
        const firstVisitMs = findSessionStartMs(row, effectiveWebRtcIp, allLogRows) || orderTimeMs;
        
        let diffSec = Math.round((orderTimeMs - firstVisitMs) / 1000);
        if (diffSec <= 0) {
          diffSec = null;
        }

        if (diffSec === null) {
          timeToOrderFormatted = 'Chưa bắt được phiên';
        } else if (diffSec < 15) {
          timeToOrderFormatted = `${diffSec} giây (Đặt cực nhanh ⚡)`;
        } else if (diffSec < 60) {
          timeToOrderFormatted = `${diffSec} giây`;
        } else {
          const mins = Math.floor(diffSec / 60);
          const secs = diffSec % 60;
          timeToOrderFormatted = `${mins} phút ${secs > 0 ? secs + 's' : ''}`;
        }
      }

      const isBlacklisted = blacklistedIpSet.has(row.client_ip) || !!(effectiveWebRtcIp && blacklistedIpSet.has(effectiveWebRtcIp));

      return {
        ...row,
        webrtc_ip: effectiveWebRtcIp,
        is_blacklisted: isBlacklisted,
        time_to_order: timeToOrderFormatted,
        order_info: hasOrderInfo ? safeJsonParse(row.order_info, null) : null,
        risk_reasons: row.risk_reasons ? safeJsonParse(row.risk_reasons, []) : []
      };
    });

    res.json({
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

/**
 * DELETE /api/v1/logs/:id
 */
router.delete('/:id', (req, res) => {
  try {
    const stmt = db.prepare('DELETE FROM logs WHERE id = ?');
    const result = stmt.run(req.params.id);

    if (result.changes > 0) {
      res.json({ success: true, message: 'Log deleted successfully' });
    } else {
      res.status(404).json({ success: false, message: 'Log not found' });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: 'Internal server error', error: error.message });
  }
});

module.exports = router;
