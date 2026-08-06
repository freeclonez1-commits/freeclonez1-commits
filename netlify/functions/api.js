const crypto = require('crypto');
const net = require('net');
const zlib = require('zlib');

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const COMPRESSED_LOGS_ENCODING = 'gzip-base64-v1';
const LOG_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;
const BOOTSTRAP_DASHBOARD_PASSWORD_HASH = '5614f8701b76755fca46a29799ae4122ca791e6339afb80e45e9da52c4ea6474';
const MAX_IP_LOOKUPS_PER_SYNC = 30;
const IP_INTELLIGENCE_VERSION = 2;
const DATACENTER_WORDS = [
  'datacenter', 'data center', 'hosting', 'host', 'cloud', 'server', 'vps',
  'vpn', 'proxy', 'gthost', 'm247', 'ovh', 'hetzner', 'digitalocean',
  'linode', 'vultr', 'aws', 'amazon', 'google cloud', 'azure', 'datacamp',
  'cloudflare', 'iomart', 'rapidswitch', 'purevoltage', 'ip transit',
  'globaltelehost', 'globaltehost', 'colo', 'colocation'
];

const memoryIpCache = new Map();

const TRACKER_SOURCE = `(() => {
  'use strict';

  const script = document.currentScript || Array.from(document.scripts).find(s => String(s.src || '').includes('/client-tracker.js'));
  const backendUrl = (() => {
    if (window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.backendUrl) {
      return String(window.SAPO_TRACKER_CONFIG.backendUrl).replace(/\\/$/, '');
    }
    if (script && script.src) return new URL(script.src).origin;
    return window.location.origin;
  })();
  const apiKey = window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.apiKey ? window.SAPO_TRACKER_CONFIG.apiKey : null;
  const initialBlock = window.__SAPO_IP_GUARD_BLOCK || null;
  const sessionKey = 'sapo_ip_guard_session_v2';
  const sessionStartKey = 'sapo_ip_guard_session_start_v2';

  function renderBlocked(ip, reason) {
    try {
      document.documentElement.innerHTML =
        '<head><title>Access blocked</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="margin:0;font-family:Arial,sans-serif;background:#f8fafd;color:#202124;display:flex;min-height:100vh;align-items:center;justify-content:center">' +
        '<main style="max-width:520px;margin:24px;padding:28px;border:1px solid #dadce0;border-radius:8px;background:white;box-shadow:0 1px 3px rgba(60,64,67,.18)">' +
        '<div style="width:48px;height:48px;border-radius:50%;background:#fce8e6;color:#d93025;display:flex;align-items:center;justify-content:center;font-size:24px;margin-bottom:16px">!</div>' +
        '<h1 style="font-size:22px;line-height:1.25;margin:0 0 8px;font-weight:700">Truy cap bi chan</h1>' +
        '<p style="font-size:14px;color:#5f6368;margin:0 0 16px">Dia chi IP cua ban nam trong danh sach chan cua cua hang.</p>' +
        '<div style="font-family:Consolas,monospace;background:#f1f3f4;border-radius:6px;padding:10px 12px;font-weight:700">' + String(ip || 'unknown') + '</div>' +
        '<p style="font-size:12px;color:#80868b;margin:12px 0 0">' + String(reason || 'Blocked by Sapo IP Guard') + '</p>' +
        '</main></body>';
    } catch (_) {}
  }

  if (initialBlock && initialBlock.is_blacklisted) {
    renderBlocked(initialBlock.ip, initialBlock.reason);
    return;
  }

  function sessionValue(key, value) {
    try {
      if (value !== undefined) sessionStorage.setItem(key, value);
      return sessionStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  let sessionId = sessionValue(sessionKey);
  if (!sessionId) {
    sessionId = 's_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2);
    sessionValue(sessionKey, sessionId);
    sessionValue(sessionStartKey, new Date().toISOString());
  }

  function deviceType() {
    const ua = navigator.userAgent || '';
    if (/ipad|tablet/i.test(ua)) return 'Tablet';
    if (/mobile|iphone|android/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }

  function send(payload) {
    payload.api_key = apiKey;
    payload.url = location.href;
    payload.referrer = document.referrer || null;
    payload.user_agent = navigator.userAgent || null;
    payload.device_type = deviceType();
    payload.session_id = sessionId;
    payload.session_start_at = sessionValue(sessionStartKey) || new Date().toISOString();

    const body = JSON.stringify(payload);
    fetch(backendUrl + '/api/v1/logs/collect', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body
    }).then(res => res.json()).then(data => {
      if (data && data.is_blacklisted) renderBlocked(data.blocked_ip || data.client_ip, data.block_reason);
    }).catch(() => {});
  }

  function checkBlocked(webrtcIp) {
    if (!webrtcIp) return;
    fetch(backendUrl + '/api/v1/blacklist/check?webrtc_ip=' + encodeURIComponent(webrtcIp), {
      method: 'GET',
      keepalive: true
    }).then(res => res.json()).then(data => {
      if (data && data.is_blacklisted) renderBlocked(data.blocked_ip || webrtcIp, data.reason);
    }).catch(() => {});
  }

  function publicIpCandidate(text) {
    const value = String(text || '').trim().replace(/^\\[|\\]$/g, '').toLowerCase();
    if (!value || value.endsWith('.local')) return null;
    const isIpv4 = value.split('.').length === 4 && value.split('.').every(part => /^\\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
    const isIpv6 = value.includes(':')
      && /^[0-9a-f:]+$/i.test(value)
      && !value.includes(':::')
      && value.split(':').length >= 3
      && value.split(':').length <= 8
      && value.split(':').every(part => part === '' || /^[0-9a-f]{1,4}$/i.test(part));
    if (!isIpv4 && !isIpv6) return null;
    if (/^(10\\.|127\\.|169\\.254\\.|172\\.(1[6-9]|2\\d|3[0-1])\\.|192\\.168\\.)/.test(value)) return null;
    if (/^(::1|fc|fd|fe80)/i.test(value)) return null;
    return value;
  }

  function checkWebRtc() {
    return new Promise(resolve => {
      const RTCPeer = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
      if (!RTCPeer) return resolve({ ip: null, status: 'not_supported' });
      const ips = new Set();
      let done = false;
      const finish = (status) => {
        if (done) return;
        done = true;
        try { pc.close(); } catch (_) {}
        resolve({ ip: Array.from(ips)[0] || null, status });
      };
      let pc;
      try {
        pc = new RTCPeer({
          iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:global.stun.twilio.com:3478' },
            { urls: 'stun:stun.cloudflare.com:3478' }
          ],
          iceCandidatePoolSize: 4
        });
        pc.createDataChannel('sapo-ip-guard');
        pc.onicecandidate = event => {
          const raw = event && event.candidate ? event.candidate : null;
          const candidate = raw ? String(raw.candidate || '') : '';
          const directAddress = raw && raw.address ? publicIpCandidate(raw.address) : null;
          if (directAddress) ips.add(directAddress);
          const matches = candidate.match(/([0-9]{1,3}(?:\\.[0-9]{1,3}){3}|[a-f0-9:]{8,})/ig) || [];
          matches.forEach(item => {
            const ip = publicIpCandidate(item);
            if (ip) ips.add(ip);
          });
          if (ips.size) send({
            trigger_event: 'network_identity',
            webrtc_ip: Array.from(ips)[0],
            webrtc_status: 'captured'
          });
          if (ips.size) checkBlocked(Array.from(ips)[0]);
          if (!event.candidate && ips.size) finish('captured');
        };
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => finish('error'));
        setTimeout(() => finish(ips.size ? 'captured' : 'not_available'), 6500);
      } catch (_) {
        finish('error');
      }
    });
  }

  send({ trigger_event: 'page_view', webrtc_status: 'pending' });
  checkWebRtc().then(result => {
    send({
      trigger_event: 'network_identity',
      webrtc_ip: result.ip,
      webrtc_status: result.status
    });
  });
})();`;

function response(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Sapo-Admin-Key, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      ...headers
    },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  };
}

function json(statusCode, body) {
  return response(statusCode, body, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''), 'utf8');
  const b = Buffer.from(String(right || ''), 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function assertAdmin(event) {
  const headers = event.headers || {};
  const auth = headers.authorization || headers.Authorization || '';
  const supplied = headers['x-sapo-admin-key'] || headers['X-Sapo-Admin-Key'] || String(auth).replace(/^Bearer\s+/i, '');
  if (!supplied) return false;
  const configuredHash = process.env.DASHBOARD_PASSWORD_HASH || '';
  const configuredPassword = process.env.DASHBOARD_PASSWORD || '';
  const expectedHash = configuredHash || (configuredPassword ? sha256(configuredPassword) : BOOTSTRAP_DASHBOARD_PASSWORD_HASH);
  return safeEqual(sha256(supplied), String(expectedHash).toLowerCase());
}

function supabaseConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.service_role || process.env.SERVICE_ROLE || '';
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  return { url, key };
}

async function supabaseFetch(path, options = {}) {
  const { url, key } = supabaseConfig();
  const res = await fetch(`${url}/rest/v1${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });
  const text = await res.text();
  const data = text ? parseJson(text, text) : null;
  if (!res.ok) throw new Error(typeof data === 'string' ? data : (data?.message || `Supabase error ${res.status}`));
  return data;
}

function stateTemplate() {
  return {
    stores: [],
    logs: [],
    orders: [],
    blacklist: [],
    autoStoreId: 1,
    autoLogId: 1000,
    autoBlacklistId: 1
  };
}

function unpackLogsValue(value) {
  if (!value || value.encoding !== COMPRESSED_LOGS_ENCODING || !value.data) return value;
  return JSON.parse(zlib.gunzipSync(Buffer.from(value.data, 'base64')).toString('utf8'));
}

function packLogsValue(logs, autoLogId) {
  const value = { logs, autoLogId };
  const serialized = JSON.stringify(value);
  if (Buffer.byteLength(serialized, 'utf8') < LOG_COMPRESSION_THRESHOLD_BYTES) return value;
  return {
    encoding: COMPRESSED_LOGS_ENCODING,
    data: zlib.gzipSync(Buffer.from(serialized, 'utf8')).toString('base64')
  };
}

async function loadState({ includeLogs = true, includeStores = true, includeBlacklist = true } = {}) {
  const keys = [];
  if (includeStores) keys.push('stores');
  if (includeLogs) keys.push('logs', 'sapo_orders');
  if (includeBlacklist) keys.push('blacklist');
  const rows = keys.length
    ? await supabaseFetch(`/app_state?key=in.(${keys.map(encodeURIComponent).join(',')})&select=key,value`)
    : [];
  const state = stateTemplate();
  const find = key => Array.isArray(rows) ? rows.find(row => row.key === key)?.value : null;

  const storesValue = find('stores');
  if (includeStores && storesValue) {
    state.stores = Array.isArray(storesValue.stores) ? storesValue.stores : [];
    state.autoStoreId = Number(storesValue.autoStoreId || 1);
  }

  const logsValue = unpackLogsValue(find('logs'));
  if (includeLogs && logsValue) {
    state.logs = Array.isArray(logsValue.logs) ? logsValue.logs : [];
    state.autoLogId = Number(logsValue.autoLogId || state.autoLogId);
  }

  const ordersValue = unpackLogsValue(find('sapo_orders'));
  if (includeLogs && ordersValue) {
    state.orders = Array.isArray(ordersValue.orders)
      ? ordersValue.orders
      : (Array.isArray(ordersValue.logs) ? ordersValue.logs : []);
  }

  const blacklistValue = find('blacklist');
  if (includeBlacklist && blacklistValue) {
    state.blacklist = Array.isArray(blacklistValue.blacklist) ? blacklistValue.blacklist : [];
    state.autoBlacklistId = Number(blacklistValue.autoBlacklistId || 1);
  }

  return state;
}

async function saveStateValue(key, value) {
  await supabaseFetch('/app_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ key, value, updated_at: new Date().toISOString() })
  });
}

async function saveStores(state) {
  await saveStateValue('stores', { stores: state.stores, autoStoreId: state.autoStoreId });
}

async function saveLogs(state) {
  await saveStateValue('logs', packLogsValue(state.logs, state.autoLogId));
}

async function saveOrders(state) {
  await saveStateValue('sapo_orders', packLogsValue(state.orders, state.autoLogId));
}

async function saveBlacklist(state) {
  await saveStateValue('blacklist', { blacklist: state.blacklist || [], autoBlacklistId: state.autoBlacklistId || 1 });
}

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || '847bade69ce34d7d84f28a15ff6c3179f2a0d596db943e3eb8ca47e20ad91f77').digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return `${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  if (String(value).startsWith('v1.')) {
    try {
      const [, iv, tag, encrypted] = String(value).split('.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
    } catch (_) {
      return '';
    }
  }
  const parts = String(value).split(':');
  if (parts.length < 3) return value;
  try {
    const [iv, tag, encrypted] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8');
  } catch (_) {
    return value;
  }
}

function normalizeDomain(value) {
  return String(value || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function publicStore(store) {
  return {
    id: store.id,
    store_name: store.store_name,
    mysapo_domain: store.mysapo_domain,
    api_key: store.api_key,
    has_api_secret: Boolean(store.api_secret_encrypted),
    created_at: store.created_at || null
  };
}

function businessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(value));
  const map = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function businessStartUtc(daysAgo = 0) {
  const now = new Date();
  const vnDate = businessDate(now);
  const start = new Date(`${vnDate}T00:00:00.000Z`).getTime() - (7 * 60 * 60 * 1000) - (daysAgo * 24 * 60 * 60 * 1000);
  return new Date(start).toISOString();
}

function presetMinDate(preset) {
  if (preset === 'ALL') return null;
  if (preset === '7_DAYS') return businessStartUtc(6);
  if (preset === '30_DAYS') return businessStartUtc(29);
  return businessStartUtc(0);
}

function inPreset(createdAt, preset) {
  if (preset === 'ALL') return true;
  if (!createdAt) return false;
  const day = businessDate(createdAt);
  const end = businessDate();
  const min = presetMinDate(preset);
  const start = min ? businessDate(min) : '';
  return day >= start && day <= end;
}

function isKnownIp(ip) {
  const value = String(ip || '').trim().toLowerCase();
  if (!value || ['unknown', 'null', 'undefined', '0.0.0.0', '::'].includes(value)) return false;
  if (!net.isIP(value)) return false;
  if (/^(10\.|127\.|169\.254\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(value)) return false;
  if (/^(::1|fc|fd|fe80)/i.test(value)) return false;
  return true;
}

function sameIp(a, b) {
  return isKnownIp(a) && isKnownIp(b) && String(a).trim() === String(b).trim();
}

function normalizeIpValue(value) {
  return isKnownIp(value) ? String(value).trim() : '';
}

function findBlacklist(state, ...ips) {
  const values = ips.map(normalizeIpValue).filter(Boolean);
  if (!values.length) return null;
  return (state.blacklist || []).find(item => values.includes(normalizeIpValue(item.ip))) || null;
}

function blacklistPublic(item) {
  return {
    id: item.id,
    ip: item.ip,
    reason: item.reason || 'Blocked by Sapo IP Guard',
    created_at: item.created_at || null,
    source: item.source || 'manual'
  };
}

function resolvedText(value) {
  const text = String(value || '').trim().toLowerCase();
  return Boolean(text && !['unknown', 'xx', 'n/a', 'na', 'null', 'undefined'].includes(text));
}

function hasIpIdentity(data) {
  return [data?.country, data?.countryCode, data?.region, data?.city, data?.isp, data?.org, data?.as].some(resolvedText);
}

function providerText(...values) {
  return values.filter(Boolean).join(' ').toLowerCase();
}

function hasDatacenterProvider(...values) {
  const text = providerText(...values);
  return DATACENTER_WORDS.some(word => text.includes(word));
}

async function fetchJson(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch (_) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeIpApiIs(data) {
  if (!data || data.error) return null;
  const company = data.company || {};
  const asn = data.asn || {};
  const location = data.location || {};
  return {
    country: location.country || data.country || data.country_name || 'Unknown',
    countryCode: location.country_code || data.country_code || data.cc || 'XX',
    region: location.region || data.region || data.state || 'Unknown',
    city: location.city || data.city || data.region || 'Unknown',
    isp: company.name || data.company_name || asn.org || data.asn_org || 'Unknown',
    org: asn.org || data.asn_org || company.name || data.company_name || 'Unknown',
    as: asn.asn ? `AS${asn.asn}` : (data.asn_num ? `AS${data.asn_num}` : null),
    hosting: Boolean(data.is_datacenter || company.type === 'hosting' || asn.type === 'hosting'),
    vpn: Boolean(data.is_vpn),
    proxy: Boolean(data.is_proxy),
    tor: Boolean(data.is_tor),
    abuser: Boolean(data.is_abuser),
    source: 'ipapi.is'
  };
}

function normalizeIpWho(data) {
  if (!data || data.success === false) return null;
  const isp = data.connection?.isp || data.connection?.org || 'Unknown';
  const org = data.connection?.org || data.connection?.isp || 'Unknown';
  return {
    country: data.country || 'Unknown',
    countryCode: data.country_code || 'XX',
    region: data.region || 'Unknown',
    city: data.city || 'Unknown',
    isp,
    org,
    as: data.connection?.asn ? `AS${data.connection.asn}` : null,
    hosting: hasDatacenterProvider(isp, org, data.connection?.domain),
    vpn: false,
    proxy: false,
    tor: false,
    abuser: false,
    source: 'ipwho.is'
  };
}

function normalizeIpApiCom(data) {
  if (!data || data.status !== 'success') return null;
  const isp = data.isp || data.org || 'Unknown';
  const org = data.org || data.isp || 'Unknown';
  return {
    country: data.country || 'Unknown',
    countryCode: data.countryCode || 'XX',
    region: data.regionName || data.region || 'Unknown',
    city: data.city || 'Unknown',
    isp,
    org,
    as: data.as || null,
    hosting: Boolean(data.hosting || hasDatacenterProvider(isp, org, data.as)),
    vpn: Boolean(data.proxy),
    proxy: Boolean(data.proxy),
    tor: false,
    abuser: false,
    source: 'ip-api.com'
  };
}

function mergeIpData(...items) {
  const sources = items.filter(hasIpIdentity);
  if (!sources.length) {
    return {
      country: 'Unknown',
      countryCode: 'XX',
      region: 'Unknown',
      city: 'Unknown',
      isp: 'Unknown',
      org: 'Unknown',
      as: null,
      hosting: false,
      vpn: false,
      proxy: false,
      tor: false,
      abuser: false,
      source: 'unknown'
    };
  }
  const base = sources.find(item => item.source === 'ipwho.is') || sources[0];
  return {
    ...base,
    country: resolvedText(base.country) ? base.country : sources[0].country,
    countryCode: resolvedText(base.countryCode) ? base.countryCode : sources[0].countryCode,
    region: resolvedText(base.region) ? base.region : sources[0].region,
    city: resolvedText(base.city) ? base.city : sources[0].city,
    isp: resolvedText(base.isp) ? base.isp : sources[0].isp,
    org: resolvedText(base.org) ? base.org : sources[0].org,
    as: resolvedText(base.as) ? base.as : sources[0].as,
    hosting: Boolean(sources.some(item => item.hosting) || hasDatacenterProvider(base.isp, base.org, base.as)),
    vpn: Boolean(sources.some(item => item.vpn)),
    proxy: Boolean(sources.some(item => item.proxy)),
    tor: Boolean(sources.some(item => item.tor)),
    abuser: Boolean(sources.some(item => item.abuser)),
    source: sources.map(item => item.source).filter(Boolean).join('+') || base.source
  };
}

async function lookupIp(ip) {
  if (!isKnownIp(ip)) return null;
  const cached = memoryIpCache.get(ip);
  if (cached && cached.expiresAt > Date.now() && hasIpIdentity(cached.data)) return cached.data;
  if (cached) memoryIpCache.delete(ip);

  const key = process.env.IPAPI_IS_KEY ? `&key=${encodeURIComponent(process.env.IPAPI_IS_KEY)}` : '';
  const [ipapi, ipwho, ipApiCom] = await Promise.all([
    fetchJson(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}${key}`, 4500).then(normalizeIpApiIs),
    fetchJson(`https://ipwho.is/${encodeURIComponent(ip)}`, 4500).then(normalizeIpWho),
    fetchJson(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,country,countryCode,regionName,city,isp,org,as,hosting,proxy`, 4500).then(normalizeIpApiCom)
  ]);
  const data = mergeIpData(ipapi, ipwho, ipApiCom);
  if (hasIpIdentity(data)) memoryIpCache.set(ip, { data, expiresAt: Date.now() + 6 * 60 * 60 * 1000 });
  return data;
}

function analyze(ipData, clientIp, webrtcIp) {
  const mismatch = Boolean(isKnownIp(clientIp) && isKnownIp(webrtcIp) && !sameIp(clientIp, webrtcIp));
  const datacenter = Boolean(ipData?.hosting || hasDatacenterProvider(ipData?.isp, ipData?.org, ipData?.as));
  const vpn = Boolean(ipData?.vpn || ipData?.proxy || providerText(ipData?.isp, ipData?.org).includes('vpn'));
  const risk = Boolean(mismatch || datacenter || vpn || ipData?.tor || ipData?.abuser);
  const reasons = [];
  if (mismatch) reasons.push('WebRTC IP khac IP ket noi');
  if (vpn || ipData?.proxy) reasons.push('VPN/Proxy');
  if (datacenter) reasons.push('Datacenter/Hosting');
  if (ipData?.abuser) reasons.push('IP reputation rui ro');
  if (ipData?.tor) reasons.push('Tor');
  return {
    is_vpn: vpn,
    is_proxy: Boolean(ipData?.proxy),
    is_datacenter: datacenter,
    is_tor: Boolean(ipData?.tor),
    is_abuser: Boolean(ipData?.abuser),
    webrtc_mismatch: mismatch,
    risk_level: risk ? 'HIGH_RISK' : (hasIpIdentity(ipData) ? 'CLEAN' : 'UNKNOWN'),
    risk_reasons: reasons
  };
}

function applyIp(order, ipData, clientIp, webrtcIp) {
  const risk = analyze(ipData, clientIp, webrtcIp);
  order.client_ip = isKnownIp(clientIp) ? clientIp : 'unknown';
  order.webrtc_ip = isKnownIp(webrtcIp) ? webrtcIp : null;
  order.country = ipData?.country || 'Unknown';
  order.country_code = ipData?.countryCode || 'XX';
  order.region = ipData?.region || 'Unknown';
  order.city = ipData?.city || 'Unknown';
  order.isp = ipData?.isp || 'Unknown';
  order.org = ipData?.org || 'Unknown';
  order.asn = ipData?.as || null;
  order.is_vpn = risk.is_vpn;
  order.is_proxy = risk.is_proxy;
  order.is_datacenter = risk.is_datacenter;
  order.is_tor = risk.is_tor;
  order.is_abuser = risk.is_abuser;
  order.webrtc_mismatch = risk.webrtc_mismatch;
  order.risk_level = risk.risk_level;
  order.risk_reasons = JSON.stringify(risk.risk_reasons);
  order.ip_intelligence_source = ipData?.source || 'unknown';
  order.ip_intelligence_version = IP_INTELLIGENCE_VERSION;
  order.ip_intelligence_checked_at = new Date().toISOString();
}

function sapoAuthHeaders(store, secret) {
  const token = Buffer.from(`${store.api_key}:${secret}`).toString('base64');
  return {
    Authorization: `Basic ${token}`,
    'X-Sapo-Access-Token': secret,
    'X-Bizweb-Access-Token': secret,
    Accept: 'application/json',
    'User-Agent': 'Sapo-IP-Guard-Clean/2.0'
  };
}

async function sapoFetch(store, path) {
  const secret = decryptSecret(store.api_secret_encrypted);
  if (!secret) throw new Error('Missing Sapo API secret.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`https://${store.mysapo_domain}${path}`, {
      headers: sapoAuthHeaders(store, secret),
      signal: controller.signal
    });
    const data = await res.json().catch(() => null);
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

function sapoError(status) {
  if (status === 401) return 'Sapo tu choi xac thuc. Kiem tra API key/secret.';
  if (status === 403) return 'Sapo chua cap quyen doc don hang.';
  return `Sapo API error ${status}`;
}

function parseSapoOrder(order) {
  const address = order.shipping_address || order.billing_address || {};
  const orderId = order.name || (order.order_number ? `#${order.order_number}` : String(order.id || ''));
  return {
    order_id: orderId,
    sapo_id: order.id || null,
    customer_name: address.name || `${address.first_name || ''} ${address.last_name || ''}`.trim() || order.customer?.name || '',
    phone: address.phone || order.phone || '',
    email: order.email || '',
    total_price: order.total_price || order.total || null,
    financial_status: order.financial_status || null,
    fulfillment_status: order.fulfillment_status || null
  };
}

function sapoClientIp(order) {
  const value = order?.client_details?.browser_ip || order?.browser_ip || order?.client_ip || '';
  return isKnownIp(value) ? String(value).trim() : 'unknown';
}

function getOrderInfo(row) {
  return parseJson(row?.order_info, row?.order_info || {});
}

function findVisitForOrder(state, storeId, orderInfo, createdAt, orderIp) {
  const orderTime = new Date(createdAt).getTime();
  if (!Number.isFinite(orderTime)) return null;
  const candidates = (state.logs || []).filter(log => {
    if (log.store_id !== storeId) return false;
    const visitTime = new Date(log.created_at).getTime();
    if (!Number.isFinite(visitTime)) return false;
    const diff = orderTime - visitTime;
    return diff >= -15 * 60 * 1000 && diff <= 6 * 60 * 60 * 1000;
  });
  const sameIpCandidates = candidates.filter(log => sameIp(log.client_ip, orderIp) || sameIp(log.webrtc_ip, orderIp));
  return sameIpCandidates.find(log => isKnownIp(log.webrtc_ip)) || sameIpCandidates[0] || null;
}

async function enrichOrders(orders) {
  const groups = new Map();
  for (const order of orders) {
    if (!isKnownIp(order.client_ip)) continue;
    const stale = !hasIpIdentity({
      country: order.country,
      countryCode: order.country_code,
      region: order.region,
      city: order.city,
      isp: order.isp,
      org: order.org,
      as: order.asn
    });
    const oldVersion = Number(order.ip_intelligence_version || 0) !== IP_INTELLIGENCE_VERSION;
    if (!stale && !oldVersion && order.ip_intelligence_checked_at) continue;
    const key = `${order.client_ip}|${order.webrtc_ip || ''}`;
    if (!groups.has(key)) groups.set(key, { clientIp: order.client_ip, webrtcIp: order.webrtc_ip, orders: [] });
    groups.get(key).orders.push(order);
  }
  let count = 0;
  for (const group of groups.values()) {
    if (count >= MAX_IP_LOOKUPS_PER_SYNC) break;
    const data = await lookupIp(group.clientIp);
    group.orders.forEach(order => applyIp(order, data, group.clientIp, group.webrtcIp));
    count++;
  }
  return count;
}

async function syncSapoOrders(state, store, preset = 'TODAY') {
  const createdMin = presetMinDate(preset);
  const pageLimit = preset === 'TODAY' ? 100 : 250;
  const maxPages = preset === 'TODAY' ? 2 : (preset === '7_DAYS' ? 4 : 8);
  const known = new Map();
  (state.orders || []).forEach(row => {
    if (row.store_id !== store.id) return;
    const info = getOrderInfo(row);
    if (info?.order_id) known.set(String(info.order_id), row);
  });

  const seenOrderIds = new Set();
  let total = 0;
  let created = 0;
  let updated = 0;
  let completed = false;
  let minParamName = 'created_at_min';

  for (let page = 1; page <= maxPages; page++) {
    const activeMinParam = createdMin ? `&${minParamName}=${encodeURIComponent(createdMin)}` : '';
    let { res, data } = await sapoFetch(store, `/admin/orders.json?limit=${pageLimit}&page=${page}${activeMinParam}`);
    if (page === 1 && res.ok && createdMin && (!Array.isArray(data?.orders) || data.orders.length === 0)) {
      const altParam = minParamName === 'created_at_min' ? 'created_on_min' : 'created_at_min';
      const alt = await sapoFetch(store, `/admin/orders.json?limit=${pageLimit}&page=1&${altParam}=${encodeURIComponent(createdMin)}`);
      if (alt.res.ok && Array.isArray(alt.data?.orders) && alt.data.orders.length > 0) {
        minParamName = altParam;
        res = alt.res;
        data = alt.data;
      }
    }
    if (!res.ok) throw new Error(sapoError(res.status));
    const orders = Array.isArray(data?.orders) ? data.orders : [];
    if (!orders.length) {
      completed = true;
      break;
    }

    for (const sapoOrder of orders) {
      const createdAt = sapoOrder.created_on || sapoOrder.created_at || new Date().toISOString();
      if (!inPreset(createdAt, preset)) continue;
      const info = parseSapoOrder(sapoOrder);
      if (!info.order_id) continue;
      seenOrderIds.add(String(info.order_id));
      total++;

      const orderIp = sapoClientIp(sapoOrder);
      const existing = known.get(String(info.order_id));
      const visit = findVisitForOrder(state, store.id, info, createdAt, orderIp);
      const webrtcIp = isKnownIp(visit?.webrtc_ip) ? visit.webrtc_ip : (existing?.webrtc_ip || null);
      const row = existing || {
        id: `sapo:${store.id}:${info.order_id}`,
        store_id: store.id,
        store_domain: store.mysapo_domain,
        trigger_event: 'sapo_sync'
      };
      const before = JSON.stringify(row);
      row.client_ip = isKnownIp(orderIp) ? orderIp : (isKnownIp(visit?.client_ip) ? visit.client_ip : (row.client_ip || 'unknown'));
      row.webrtc_ip = isKnownIp(webrtcIp) ? webrtcIp : null;
      row.webrtc_status = visit?.webrtc_status || (row.webrtc_ip ? 'captured' : 'not_available');
      row.session_id = visit?.session_id || row.session_id || null;
      row.session_start_at = visit?.session_start_at || row.session_start_at || null;
      row.user_agent = visit?.user_agent || row.user_agent || 'Sapo API Sync';
      row.device_type = visit?.device_type || row.device_type || 'Unknown';
      row.order_info = JSON.stringify(info);
      row.created_at = new Date(createdAt).toISOString();
      row.updated_at = new Date().toISOString();

      if (!existing) {
        state.orders.unshift(row);
        known.set(String(info.order_id), row);
        created++;
      } else if (JSON.stringify(row) !== before) {
        updated++;
      }
    }

    if (orders.length < pageLimit) {
      completed = true;
      break;
    }
  }

  if (preset === 'TODAY' && completed) {
    state.orders = state.orders.filter(row => {
      if (row.store_id !== store.id || !inPreset(row.created_at, preset)) return true;
      const info = getOrderInfo(row);
      return !info?.order_id || seenOrderIds.has(String(info.order_id));
    });
  }

  const backfill = state.orders.filter(row => row.store_id === store.id && inPreset(row.created_at, preset));
  const enriched = await enrichOrders(backfill);
  await saveOrders(state);
  return { success: true, total_orders: total, synced_new: created, updated_orders: updated, enriched_ips: enriched };
}

function decorateOrder(row, state) {
  const info = getOrderInfo(row);
  const clientIp = normalizeIpValue(row.client_ip) || 'unknown';
  const webrtcIp = normalizeIpValue(row.webrtc_ip) || null;
  const invalidWebrtc = Boolean(row.webrtc_ip && !webrtcIp);
  const hasOtherRisk = Boolean(row.is_vpn || row.is_proxy || row.is_datacenter || row.is_tor || row.is_abuser);
  const riskReasons = parseJson(row.risk_reasons, []).filter(reason => !(invalidWebrtc && /webrtc/i.test(String(reason))));
  const blocked = findBlacklist(state || {}, clientIp, webrtcIp);
  return {
    ...row,
    client_ip: clientIp,
    webrtc_ip: webrtcIp,
    webrtc_status: invalidWebrtc ? 'invalid_candidate' : row.webrtc_status,
    webrtc_mismatch: webrtcIp ? Boolean(row.webrtc_mismatch) : false,
    risk_level: invalidWebrtc && !hasOtherRisk ? 'UNKNOWN' : row.risk_level,
    order_info: info,
    risk_reasons: riskReasons,
    is_webrtc_available: Boolean(webrtcIp),
    is_blacklisted: Boolean(blocked),
    blacklist_reason: blocked?.reason || null
  };
}

function filterOrders(rows, query, state) {
  let result = rows.map(row => decorateOrder(row, state));
  const storeId = query.store_id && query.store_id !== 'ALL' ? Number(query.store_id) : null;
  if (storeId) result = result.filter(row => row.store_id === storeId);
  if (query.startDate || query.endDate) {
    result = result.filter(row => {
      const day = businessDate(row.created_at);
      if (query.startDate && day < query.startDate) return false;
      if (query.endDate && day > query.endDate) return false;
      return true;
    });
  }
  const search = String(query.search || '').trim().toLowerCase();
  if (search) {
    result = result.filter(row => {
      const info = row.order_info || {};
      return [
        info.order_id, info.customer_name, info.phone, info.email,
        row.client_ip, row.webrtc_ip, row.country, row.region, row.city, row.isp, row.org
      ].some(value => String(value || '').toLowerCase().includes(search));
    });
  }
  return result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
}

async function handleStores(state, method, parts, body) {
  if (method === 'GET' && parts.length === 0) {
    return json(200, { success: true, data: state.stores.map(publicStore) });
  }
  if (method === 'POST' && parts.length === 0) {
    const store = {
      id: state.autoStoreId++,
      store_name: String(body.store_name || body.mysapo_domain || 'Sapo Store').trim(),
      mysapo_domain: normalizeDomain(body.mysapo_domain),
      api_key: String(body.api_key || '').trim(),
      api_secret_encrypted: encryptSecret(String(body.api_secret || '').trim()),
      created_at: new Date().toISOString()
    };
    if (!store.mysapo_domain || !store.api_key || !body.api_secret) return json(400, { success: false, message: 'Store domain, API key, API secret are required.' });
    state.stores.push(store);
    await saveStores(state);
    return json(201, { success: true, data: publicStore(store) });
  }

  const id = Number(parts[0]);
  const store = state.stores.find(item => item.id === id);
  if (!store) return json(404, { success: false, message: 'Store not found.' });

  if (method === 'PUT') {
    store.store_name = String(body.store_name || store.store_name).trim();
    store.mysapo_domain = normalizeDomain(body.mysapo_domain || store.mysapo_domain);
    store.api_key = String(body.api_key || store.api_key).trim();
    if (body.api_secret) store.api_secret_encrypted = encryptSecret(String(body.api_secret).trim());
    await saveStores(state);
    return json(200, { success: true, data: publicStore(store) });
  }
  if (method === 'DELETE') {
    state.stores = state.stores.filter(item => item.id !== id);
    await saveStores(state);
    return json(200, { success: true });
  }
  if (method === 'POST' && parts[1] === 'test') {
    const { res, data } = await sapoFetch(store, '/admin/orders/count.json');
    if (!res.ok) throw new Error(sapoError(res.status));
    return json(200, { success: true, order_count: Number(data?.count || data?.orders_count || 0) });
  }
  if (method === 'POST' && parts[1] === 'sync') {
    return json(200, await syncSapoOrders(state, store, body.datePreset || 'TODAY'));
  }
  return json(404, { success: false, message: 'Not found.' });
}

async function handleBlacklist(event, state, method, parts, query, body) {
  if (method === 'GET' && parts.length === 0) {
    return json(200, { success: true, data: (state.blacklist || []).map(blacklistPublic) });
  }

  if (method === 'GET' && parts[0] === 'check') {
    const clientIp = firstIp(event.headers['x-forwarded-for']) || event.headers['x-real-ip'] || query.ip || '';
    const blocked = findBlacklist(state, clientIp, query.webrtc_ip);
    return json(200, {
      success: true,
      is_blacklisted: Boolean(blocked),
      blocked_ip: blocked?.ip || null,
      reason: blocked?.reason || null
    });
  }

  if (method === 'POST' && parts.length === 0) {
    const ip = normalizeIpValue(body.ip);
    if (!ip) return json(400, { success: false, message: 'IP khong hop le.' });
    const existing = findBlacklist(state, ip);
    if (existing) {
      existing.reason = String(body.reason || existing.reason || 'Blocked by Sapo IP Guard').trim();
      existing.updated_at = new Date().toISOString();
      await saveBlacklist(state);
      return json(200, { success: true, data: blacklistPublic(existing) });
    }
    const item = {
      id: state.autoBlacklistId++,
      ip,
      reason: String(body.reason || 'Blocked by Sapo IP Guard').trim(),
      source: String(body.source || 'manual').trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    state.blacklist.unshift(item);
    await saveBlacklist(state);
    return json(201, { success: true, data: blacklistPublic(item) });
  }

  if (method === 'DELETE' && parts[0]) {
    const ip = normalizeIpValue(parts[0]);
    const before = (state.blacklist || []).length;
    state.blacklist = (state.blacklist || []).filter(item => normalizeIpValue(item.ip) !== ip);
    if (state.blacklist.length !== before) await saveBlacklist(state);
    return json(200, { success: true });
  }

  return json(404, { success: false, message: 'Not found.' });
}

async function handleLogs(event, state, method, parts, query, body) {
  if (method === 'POST' && parts[0] === 'collect') {
    const referer = String(event.headers.origin || event.headers.referer || body.url || '');
    let store = body.api_key ? state.stores.find(item => item.api_key === body.api_key) : null;
    if (!store) {
      const cleanRef = normalizeDomain(referer);
      store = state.stores.find(item => cleanRef.includes(normalizeDomain(item.mysapo_domain)));
    }
    if (!store && state.stores.length === 1) store = state.stores[0];
    if (!store) return json(403, { success: false, message: 'Unknown store.' });

    const ip = firstIp(event.headers['x-forwarded-for']) || event.headers['x-real-ip'] || body.client_ip || 'unknown';
    const existing = body.trigger_event === 'network_identity' && body.session_id
      ? state.logs.find(row => row.store_id === store.id && row.session_id === body.session_id && row.trigger_event === 'page_view')
      : null;
    const row = existing || {
      id: state.autoLogId++,
      store_id: store.id,
      store_domain: store.mysapo_domain,
      created_at: new Date().toISOString()
    };
    row.client_ip = isKnownIp(ip) ? String(ip).trim() : 'unknown';
    const incomingWebrtcIp = normalizeIpValue(body.webrtc_ip);
    if (incomingWebrtcIp) {
      row.webrtc_ip = incomingWebrtcIp;
      row.webrtc_status = body.webrtc_status || 'captured';
    } else if (body.webrtc_ip && body.webrtc_status === 'captured') {
      row.webrtc_ip = null;
      row.webrtc_status = 'invalid_candidate';
    }
    row.webrtc_status = row.webrtc_status || body.webrtc_status || (row.webrtc_ip ? 'captured' : 'pending');
    row.url = body.url || row.url || null;
    row.referrer = body.referrer || row.referrer || null;
    row.user_agent = body.user_agent || row.user_agent || null;
    row.device_type = body.device_type || row.device_type || 'Unknown';
    row.session_id = body.session_id || row.session_id || null;
    row.session_start_at = body.session_start_at || row.session_start_at || null;
    row.trigger_event = existing ? 'page_view' : (body.trigger_event || 'page_view');
    row.updated_at = new Date().toISOString();
    if (!existing) state.logs.unshift(row);
    await saveLogs(state);
    const blocked = findBlacklist(state, row.client_ip, row.webrtc_ip);
    return json(201, {
      success: true,
      log_id: row.id,
      client_ip: row.client_ip,
      webrtc_ip: row.webrtc_ip || null,
      is_blacklisted: Boolean(blocked),
      blocked_ip: blocked?.ip || null,
      block_reason: blocked?.reason || null
    });
  }

  if (method === 'GET' && parts.length === 0) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const filtered = filterOrders(state.orders || [], query, state);
    return json(200, {
      success: true,
      data: filtered.slice((page - 1) * limit, page * limit),
      pagination: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.max(1, Math.ceil(filtered.length / limit))
      }
    });
  }

  return json(404, { success: false, message: 'Not found.' });
}

function firstIp(value) {
  return String(value || '').split(',')[0].trim();
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return response(204, '');
    const rawPath = event.path.replace(/^\/\.netlify\/functions\/api/, '');
    if (rawPath === '/health') return json(200, { status: 'OK', version: 'clean-orders-v2', time: new Date().toISOString() });
    if (rawPath === '/client-tracker.js') {
      const clientIp = firstIp(event.headers['x-forwarded-for']) || event.headers['x-real-ip'] || event.headers['cf-connecting-ip'] || '';
      let blocked = null;
      try {
        const state = await loadState({ includeLogs: false, includeStores: false, includeBlacklist: true });
        blocked = findBlacklist(state, clientIp);
      } catch (_) {
        blocked = null;
      }
      const boot = `window.__SAPO_IP_GUARD_BLOCK=${JSON.stringify({
        is_blacklisted: Boolean(blocked),
        ip: blocked?.ip || clientIp || null,
        reason: blocked?.reason || null
      })};\n`;
      return response(200, boot + TRACKER_SOURCE, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate'
      });
    }

    const apiPath = rawPath.replace(/^\/api\/v1\/?/, '');
    const parts = apiPath.split('/').filter(Boolean).map(decodeURIComponent);
    const resource = parts.shift();
    const method = event.httpMethod;
    const body = event.body ? parseJson(event.body, {}) : {};
    const query = event.queryStringParameters || {};
    const publicCollect = resource === 'logs' && method === 'POST' && parts[0] === 'collect';
    const publicBlacklistCheck = resource === 'blacklist' && method === 'GET' && parts[0] === 'check';

    if (!publicCollect && !publicBlacklistCheck && !assertAdmin(event)) return json(401, { success: false, message: 'Dashboard password is invalid.' });
    if (resource === 'auth' && method === 'POST' && parts[0] === 'verify') return json(200, { success: true });

    const state = await loadState({
      includeLogs: resource !== 'auth' && resource !== 'blacklist',
      includeStores: resource !== 'blacklist' || publicCollect
    });
    if (resource === 'stores') return await handleStores(state, method, parts, body);
    if (resource === 'blacklist') return await handleBlacklist(event, state, method, parts, query, body);
    if (resource === 'logs') return await handleLogs(event, state, method, parts, query, body);

    return json(404, { success: false, message: 'Not found.' });
  } catch (error) {
    return json(500, { success: false, message: error.message || 'Server error.' });
  }
};
