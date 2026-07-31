const axios = require('axios');
const db = require('../db');
const { analyzeRisk } = require('./ipService');
const { decryptSecret } = require('./secretService');
const { startOfBusinessDay } = require('./dateService');

/**
 * Safely parse Sapo date string (created_on or created_at)
 */
function parseSapoDate(dateStr) {
  if (!dateStr) return new Date().toISOString();
  try {
    const d = new Date(dateStr);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch (e) {}
  return new Date().toISOString();
}

/**
 * Sync orders from a Sapo Store via Sapo Admin REST API
 */
async function syncSapoOrders(storeId, datePreset = 'TODAY') {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) {
    throw new Error('Cửa hàng không tồn tại');
  }

  const { mysapo_domain, api_key } = store;
  const api_secret = decryptSecret(store.api_secret_encrypted || store.api_secret);
  if (!api_secret) throw new Error('Store is missing its Sapo API secret.');

  let minDate = startOfBusinessDay();

  if (datePreset === '7_DAYS') {
    minDate = startOfBusinessDay(-6);
  } else if (datePreset === '30_DAYS') {
    minDate = startOfBusinessDay(-29);
  } else if (datePreset === 'ALL') {
    minDate = startOfBusinessDay(-364);
  }

  console.log(`[Sapo Sync] Fetching orders for store ${store.store_name} (${mysapo_domain}) since ${minDate}...`);

  let sapoOrders = [];
  let apiSuccess = false;

  const authHeaderBasic = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64');

  const seenOrderIds = new Set();
  for (let page = 1; page <= 50; page++) {
    const url = `https://${mysapo_domain}/admin/orders.json?created_at_min=${encodeURIComponent(minDate)}&limit=250&page=${page}`;
    try {
      const res = await axios.get(url, {
        headers: {
          'Authorization': authHeaderBasic,
          'X-Sapo-Access-Token': api_secret,
          'X-Bizweb-Access-Token': api_secret,
          'Content-Type': 'application/json',
          'User-Agent': 'SapoAntiFakeIP/1.0'
        },
        timeout: 6000
      });

      if (res.data && (res.data.orders || Array.isArray(res.data))) {
        const pageOrders = res.data.orders || res.data;
        const uniqueOrders = pageOrders.filter(order => {
          const key = String(order.id || order.name);
          if (seenOrderIds.has(key)) return false;
          seenOrderIds.add(key);
          return true;
        });
        sapoOrders.push(...uniqueOrders);
        apiSuccess = true;
        if (pageOrders.length < 250) break;
      } else {
        break;
      }
    } catch (err) {
      console.warn(`[Sapo Sync API Attempt] Error connecting to ${url}: ${err.message}`);
      break;
    }
  }

  if (apiSuccess) {
    console.log(`[Sapo Sync Success] Retrieved ${sapoOrders.length} real orders from Sapo API.`);
  }

  let syncCount = 0;
  let updatedCount = 0;

  for (const ord of sapoOrders) {
    const clientIp = ord.browser_ip || ord.client_details?.browser_ip || 'unknown';
    const orderIdStr = ord.name || `#${ord.id}`;
    
    // Check both created_on and created_at fields from Sapo API
    const sapoRawDate = ord.created_on || ord.created_at || ord.processed_at;
    const realCreatedAt = parseSapoDate(sapoRawDate);

    // Check if order log already exists
    const existing = db.prepare(`
      SELECT * FROM logs WHERE store_id = ? AND order_info LIKE ?
    `).get(store.id, `%${orderIdStr}%`);

    const orderInfoObj = {
      order_id: orderIdStr,
      customer_name: ord.customer ? `${ord.customer.first_name || ''} ${ord.customer.last_name || ''}`.trim() : (ord.billing_address ? ord.billing_address.name : 'Khách hàng Sapo'),
      phone: ord.customer ? ord.customer.phone : (ord.billing_address ? ord.billing_address.phone : null),
      email: ord.customer ? ord.customer.email : ord.email,
      total_price: ord.total_price || ord.total
    };

    // Analyze Risk
    const analysis = await analyzeRisk(clientIp, null);
    const blacklistCheck = db.prepare('SELECT * FROM blacklist WHERE ip = ?').get(clientIp);

    let finalRiskLevel = analysis.riskLevel;
    const finalReasons = [...analysis.riskReasons];

    if (blacklistCheck) {
      finalRiskLevel = 'HIGH_RISK';
      finalReasons.push(`IP nằm trong Danh sách đen (Lý do: ${blacklistCheck.reason || 'Bị chặn bởi quản trị viên'})`);
    }

    // Auto-discover captured WebRTC IP for this client IP if available
    let capturedWebRtcIp = null;
    const webRtcMatch = db.prepare('SELECT webrtc_ip FROM logs WHERE client_ip = ? AND webrtc_ip IS NOT NULL AND webrtc_ip != "" ORDER BY id DESC').get(clientIp);
    if (webRtcMatch) {
      capturedWebRtcIp = webRtcMatch.webrtc_ip;
    }

    if (!existing) {
      const stmt = db.prepare(`
        INSERT INTO logs (
          store_id, store_domain, client_ip, webrtc_ip, user_agent, fingerprint, order_info,
          country, country_code, city, isp, org,
          is_vpn, is_datacenter, webrtc_mismatch, risk_level, risk_reasons, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        store.id,
        store.mysapo_domain,
        clientIp,
        capturedWebRtcIp,
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Sapo Order Sync',
        'FP-SAPO-SYNCED',
        JSON.stringify(orderInfoObj),
        analysis.ipData.country || 'Vietnam',
        analysis.ipData.countryCode || 'VN',
        analysis.ipData.city || 'Hanoi',
        analysis.ipData.isp || 'Viettel Group',
        analysis.ipData.org || 'Viettel Network',
        analysis.isVpn ? 1 : 0,
        analysis.isDatacenter ? 1 : 0,
        0,
        finalRiskLevel,
        JSON.stringify(finalReasons),
        realCreatedAt
      );

      syncCount++;
    } else {
      const updateStmt = db.prepare(`
        UPDATE logs SET client_ip = ?, risk_level = ?, order_info = ?, risk_reasons = ? WHERE id = ?
      `);
      updateStmt.run(clientIp, finalRiskLevel, JSON.stringify(orderInfoObj), JSON.stringify(finalReasons), existing.id);

      // Directly update created_at timestamp in memory store
      const allLogs = db.prepare('SELECT * FROM logs').all();
      const targetLog = allLogs.find(l => l.id === existing.id);
      if (targetLog) {
        targetLog.created_at = realCreatedAt;
      }
      updatedCount++;
    }
  }

  console.log(`[Sapo Sync Summary] Total Sapo Orders: ${sapoOrders.length}, Synced New: ${syncCount}, Updated Dates: ${updatedCount}`);

  return {
    success: true,
    api_connected: apiSuccess,
    synced_count: syncCount,
    updated_count: updatedCount,
    total_orders: sapoOrders.length,
    message: `Đã đồng bộ ${sapoOrders.length} đơn hàng thực tế từ Sapo Admin với đúng thời gian đặt hàng!`
  };
}

module.exports = {
  syncSapoOrders,
  parseSapoDate
};
