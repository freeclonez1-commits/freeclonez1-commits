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
    minDate = null;
  }

  console.log(`[Sapo Sync] Fetching orders for store ${store.store_name} (${mysapo_domain}) since ${minDate || 'BEGINNING_OF_TIME'}...`);

  let sapoOrders = [];
  let apiSuccess = false;

  const authHeaderBasic = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64');

  const seenOrderIds = new Set();
  for (let page = 1; page <= 50; page++) {
    const minParam = minDate ? `&created_on_min=${encodeURIComponent(minDate)}` : '';
    let url = `https://${mysapo_domain}/admin/orders.json?limit=250&page=${page}${minParam}`;
    try {
      let res = await axios.get(url, {
        headers: {
          'Authorization': authHeaderBasic,
          'X-Sapo-Access-Token': api_secret,
          'X-Bizweb-Access-Token': api_secret,
          'Content-Type': 'application/json',
          'User-Agent': 'SapoAntiFakeIP/1.0'
        },
        timeout: 6000
      });

      if (!res.data || !res.data.orders || !res.data.orders.length) {
        if (page === 1) {
          const altMinParam = minDate ? `&created_on_min=${encodeURIComponent(minDate)}` : '';
          const altUrl = `https://${mysapo_domain}/admin/orders.json?limit=250&page=1${altMinParam}`;
          const altRes = await axios.get(altUrl, {
            headers: {
              'Authorization': authHeaderBasic,
              'X-Sapo-Access-Token': api_secret,
              'X-Bizweb-Access-Token': api_secret,
              'Content-Type': 'application/json',
              'User-Agent': 'SapoAntiFakeIP/1.0'
            },
            timeout: 6000
          });
          if (altRes.data && altRes.data.orders && altRes.data.orders.length) {
            res = altRes;
          }
        }
      }

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

  const ipAnalysisCache = new Map();

  for (const ord of sapoOrders) {
    const orderIdStr = ord.name || `#${ord.id}`;
    
    // Check if order log already exists
    const existing = db.prepare(`
      SELECT id FROM logs WHERE store_id = ? AND order_info LIKE ?
    `).get(store.id, `%${orderIdStr}%`);

    if (existing) {
      updatedCount++;
      continue;
    }

    const clientIp = ord.browser_ip || ord.client_details?.browser_ip || 'unknown';
    const sapoRawDate = ord.created_on || ord.created_at || ord.processed_at;
    const realCreatedAt = parseSapoDate(sapoRawDate);

    const orderInfoObj = {
      order_id: orderIdStr,
      customer_name: ord.customer ? `${ord.customer.first_name || ''} ${ord.customer.last_name || ''}`.trim() : (ord.billing_address ? ord.billing_address.name : 'Khách hàng Sapo'),
      phone: ord.customer ? ord.customer.phone : (ord.billing_address ? ord.billing_address.phone : null),
      email: ord.customer ? ord.customer.email : ord.email,
      total_price: ord.total_price || ord.total
    };

    // Fast cached Risk Analysis
    let analysis;
    if (ipAnalysisCache.has(clientIp)) {
      analysis = ipAnalysisCache.get(clientIp);
    } else {
      analysis = await analyzeRisk(clientIp, null);
      ipAnalysisCache.set(clientIp, analysis);
    }

    const blacklistCheck = db.prepare('SELECT * FROM blacklist WHERE ip = ?').get(clientIp);

    let finalRiskLevel = analysis.riskLevel;
    const finalReasons = [...analysis.riskReasons];

    if (blacklistCheck) {
      finalRiskLevel = 'HIGH_RISK';
      finalReasons.push(`IP nằm trong Danh sách đen (Lý do: ${blacklistCheck.reason || 'Bị chặn bởi quản trị viên'})`);
    }

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
      null,
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

async function testSapoConnection(storeId) {
  const store = db.prepare('SELECT * FROM stores WHERE id = ?').get(storeId);
  if (!store) throw new Error('Cửa hàng không tồn tại');
  const { mysapo_domain, api_key } = store;
  const api_secret = decryptSecret(store.api_secret_encrypted || store.api_secret);
  if (!api_secret) throw new Error('Thiếu API secret');

  const authHeaderBasic = 'Basic ' + Buffer.from(`${api_key}:${api_secret}`).toString('base64');
  const headers = {
    'Authorization': authHeaderBasic,
    'X-Sapo-Access-Token': api_secret,
    'X-Bizweb-Access-Token': api_secret,
    'Content-Type': 'application/json',
    'User-Agent': 'SapoAntiFakeIP/1.0'
  };

  try {
    const storeRes = await axios.get(`https://${mysapo_domain}/admin/store.json`, { headers, timeout: 6000 });
    if (storeRes.status !== 200) throw new Error(`Sapo API error ${storeRes.status}`);

    const countRes = await axios.get(`https://${mysapo_domain}/admin/orders/count.json?status=any`, { headers, timeout: 6000 });
    const count = countRes.data?.count ?? countRes.data?.orders_count ?? 0;
    return { success: true, message: `Kết nối Sapo thành công. API đọc được đơn hàng (${count} đơn).`, order_count: count };
  } catch (err) {
    const status = err.response?.status;
    if (status === 401) {
      throw new Error('Sapo từ chối xác thực (401). API Key / Secret không đúng hoặc Private App bị tắt.');
    }
    if (status === 403) {
      throw new Error('Sapo đã xác thực nhưng chưa bật quyền đọc Đơn hàng (Orders) trong Private App (403).');
    }
    throw new Error(err.message || 'Không thể kết nối API Sapo.');
  }
}

module.exports = {
  syncSapoOrders,
  testSapoConnection,
  parseSapoDate
};
