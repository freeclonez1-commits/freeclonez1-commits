const crypto = require('crypto');
const net = require('net');
const zlib = require('zlib');

const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const COMPRESSED_LOGS_ENCODING = 'gzip-base64-v1';
const LOG_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;
const BOOTSTRAP_DASHBOARD_PASSWORD_HASH = '5614f8701b76755fca46a29799ae4122ca791e6339afb80e45e9da52c4ea6474';
const MAX_IP_LOOKUPS_PER_SYNC = 30;
const MAX_STORED_ORDERS = Math.max(100, Number(process.env.MAX_STORED_ORDERS || 700));
const MAX_LEGACY_LOGS = Math.max(50, Number(process.env.MAX_LEGACY_LOGS || 150));
const MAX_VISITS_PER_SYNC = Math.max(50, Number(process.env.MAX_VISITS_PER_SYNC || 250));
const IP_INTELLIGENCE_VERSION = 2;
const DATACENTER_WORDS = [
  'datacenter', 'data center', 'hosting', 'host', 'cloud', 'server', 'vps',
  'vpn', 'proxy', 'gthost', 'm247', 'ovh', 'hetzner', 'digitalocean',
  'linode', 'vultr', 'aws', 'amazon', 'google cloud', 'azure', 'datacamp',
  'cloudflare', 'iomart', 'rapidswitch', 'purevoltage', 'ip transit',
  'globaltelehost', 'globaltehost', 'colo', 'colocation'
];

const memoryIpCache = new Map();
const memoryBlacklistCache = { data: null, expiresAt: 0 };
const memoryStoresCache = { data: null, autoStoreId: 1, expiresAt: 0 };
const memoryFallbackBlacklist = { blacklist: [], autoBlacklistId: 1 };

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
      const host = location.hostname || 'this site';
      document.documentElement.innerHTML =
        '<head><title>Hmm... can\\'t reach this page</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
        '<body style="margin:0;background:#fff;color:#000;font-family:Arial,Segoe UI,sans-serif">' +
        '<main style="margin-left:11vw;margin-top:18vh;max-width:620px">' +
        '<div style="width:100px;height:60px;margin:0 0 54px 14px;position:relative">' +
        '<div style="position:absolute;left:0;top:22px;width:98px;height:28px;border-radius:22px;background:linear-gradient(#edf3f8,#b5c6d5);box-shadow:0 3px 8px rgba(0,0,0,.14)"></div>' +
        '<div style="position:absolute;left:18px;top:0;width:46px;height:46px;border-radius:50%;background:linear-gradient(#edf3f8,#c3d2df)"></div>' +
        '<div style="position:absolute;left:58px;top:18px;width:28px;height:28px;border-radius:50%;background:linear-gradient(#edf3f8,#b2c4d3)"></div>' +
        '<div style="position:absolute;left:30px;top:30px;color:#4b5560;font-size:22px;letter-spacing:8px;font-weight:700">...</div>' +
        '<div style="position:absolute;left:20px;top:68px;width:10px;height:10px;border-radius:50%;background:#b7c7d6"></div>' +
        '<div style="position:absolute;left:43px;top:65px;width:16px;height:16px;border-radius:50%;background:#b7c7d6"></div>' +
        '</div>' +
        '<h1 style="font-size:32px;line-height:1.2;margin:0 0 24px;font-weight:600">Hmm... can\\'t reach this page</h1>' +
        '<p style="font-size:16px;margin:0 0 22px;font-weight:600">Check if there is a typo in ' + host + '.</p>' +
        '<p style="font-size:11px;margin:0 0 24px;color:#5f6368;letter-spacing:.02em">DNS_PROBE_FINISHED_NXDOMAIN</p>' +
        '<button onclick="location.reload()" style="height:40px;padding:0 18px;border:0;border-radius:3px;background:#0078d4;color:white;font-size:15px;font-weight:600;cursor:pointer">Refresh</button>' +
        '<p style="margin-top:28px;color:#6b7280;font-size:12px">Blocked ID: <span style="font-family:Consolas,monospace">' + String(ip || 'unknown') + '</span> · ' + String(reason || 'Blocked by Sapo IP Guard') + '</p>' +
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

  function simpleHash(input) {
    let hash = 2166136261;
    const text = String(input || '');
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
    }
    return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
  }

  function canvasHash() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 280;
      canvas.height = 80;
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '16px Arial';
      ctx.fillStyle = '#f60';
      ctx.fillRect(0, 0, 120, 22);
      ctx.fillStyle = '#069';
      ctx.fillText('Sapo IP Guard 2026', 4, 6);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.font = '18px Times New Roman';
      ctx.fillText('device-check', 18, 34);
      return simpleHash(canvas.toDataURL());
    } catch (_) {
      return '';
    }
  }

  function webglInfo() {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return { vendor: '', renderer: '' };
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: debug ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR),
        renderer: debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      };
    } catch (_) {
      return { vendor: '', renderer: '' };
    }
  }

  function browserTrace() {
    const nav = navigator || {};
    const scr = screen || {};
    const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } })();
    const webgl = webglInfo();
    const plugins = (() => {
      try { return Array.from(nav.plugins || []).slice(0, 12).map(item => item.name).join('|'); } catch (_) { return ''; }
    })();
    const languages = (() => {
      try { return Array.from(nav.languages || [nav.language]).filter(Boolean).join(','); } catch (_) { return nav.language || ''; }
    })();
    const trace = {
      user_agent: nav.userAgent || '',
      language: nav.language || '',
      languages,
      platform: nav.platform || '',
      timezone: tz,
      screen: [scr.width, scr.height, scr.colorDepth].join('x'),
      viewport: [window.innerWidth || 0, window.innerHeight || 0].join('x'),
      hardware_concurrency: nav.hardwareConcurrency || null,
      device_memory: nav.deviceMemory || null,
      max_touch_points: nav.maxTouchPoints || 0,
      webdriver: Boolean(nav.webdriver),
      plugins_hash: simpleHash(plugins),
      canvas_hash: canvasHash(),
      webgl_vendor: webgl.vendor || '',
      webgl_renderer: webgl.renderer || ''
    };
    trace.fingerprint = simpleHash(JSON.stringify(trace));
    trace.machine_key = simpleHash(JSON.stringify({
      platform: trace.platform,
      timezone: trace.timezone,
      screen: trace.screen,
      hardware_concurrency: trace.hardware_concurrency,
      device_memory: trace.device_memory,
      max_touch_points: trace.max_touch_points,
      language: trace.language,
      canvas_hash: trace.canvas_hash,
      webgl_vendor: trace.webgl_vendor,
      webgl_renderer: trace.webgl_renderer
    }));
    trace.device_key = trace.machine_key;
    return trace;
  }

  function send(payload) {
    const trace = browserTrace();
    payload.api_key = apiKey;
    payload.url = location.href;
    payload.referrer = document.referrer || null;
    payload.user_agent = navigator.userAgent || null;
    payload.device_type = deviceType();
    payload.session_id = sessionId;
    payload.session_start_at = sessionValue(sessionStartKey) || new Date().toISOString();
    payload.fingerprint = trace.fingerprint;
    payload.device_key = trace.device_key;
    payload.machine_key = trace.machine_key;
    payload.browser_trace = trace;

    const body = JSON.stringify(payload);
    fetch(backendUrl + '/api/v1/logs/collect', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body
    }).then(res => res.json()).then(data => {
      if (data && data.is_blacklisted) renderBlocked(data.blocked_value || data.blocked_ip || data.client_ip, data.block_reason);
    }).catch(() => {});
  }

  function checkBlocked(webrtcIp) {
    const trace = browserTrace();
    const query = [];
    if (webrtcIp) query.push('webrtc_ip=' + encodeURIComponent(webrtcIp));
    if (trace.fingerprint) query.push('fingerprint=' + encodeURIComponent(trace.fingerprint));
    if (trace.device_key) query.push('device_key=' + encodeURIComponent(trace.device_key));
    if (trace.machine_key) query.push('machine_key=' + encodeURIComponent(trace.machine_key));
    if (!query.length) return;
    fetch(backendUrl + '/api/v1/blacklist/check?' + query.join('&'), {
      method: 'GET',
      keepalive: true
    }).then(res => res.json()).then(data => {
      if (data && data.is_blacklisted) renderBlocked(data.blocked_value || data.blocked_ip || webrtcIp, data.reason);
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
          if (!event.candidate && ips.size) finish('captured');
        };
        pc.createOffer().then(offer => pc.setLocalDescription(offer)).catch(() => finish('error'));
        setTimeout(() => finish(ips.size ? 'captured' : 'not_available'), 3200);
      } catch (_) {
        finish('error');
      }
    });
  }

  checkWebRtc().then(result => {
    checkBlocked(result.ip);
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

function isSupabaseQuotaError(error) {
  const text = String(error?.message || error || '').toLowerCase();
  return text.includes('exceed_egress_quota')
    || text.includes('project is restricted')
    || text.includes('supabase_url and supabase_service_role_key')
    || text.includes('supabase error 402');
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

function trimRows(rows, max, dateField = 'created_at') {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => new Date(b?.[dateField] || b?.updated_at || 0).getTime() - new Date(a?.[dateField] || a?.updated_at || 0).getTime())
    .slice(0, max);
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

async function loadState({ includeLogs = true, includeOrders = includeLogs, includeStores = true, includeBlacklist = true } = {}) {
  const keys = [];
  if (includeStores) keys.push('stores');
  if (includeLogs) keys.push('logs');
  if (includeOrders) keys.push('sapo_orders');
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
    state.logs = trimRows(Array.isArray(logsValue.logs) ? logsValue.logs : [], MAX_LEGACY_LOGS);
    state.autoLogId = Number(logsValue.autoLogId || state.autoLogId);
  }

  const ordersValue = unpackLogsValue(find('sapo_orders'));
  if (includeOrders && ordersValue) {
    state.orders = trimRows(Array.isArray(ordersValue.orders)
      ? ordersValue.orders
      : (Array.isArray(ordersValue.logs) ? ordersValue.logs : []), MAX_STORED_ORDERS);
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

async function loadStateValue(key) {
  const rows = await supabaseFetch(`/app_state?key=eq.${encodeURIComponent(key)}&select=key,value&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0].value : null;
}

function visitStateKey(storeId, sessionId) {
  const cleanSession = String(sessionId || '').trim().replace(/[^a-z0-9_-]/gi, '').slice(0, 80);
  return cleanSession ? `visit:${storeId}:${cleanSession}` : '';
}

async function saveVisitLog(row) {
  const key = visitStateKey(row.store_id, row.session_id);
  if (!key) return false;
  await saveStateValue(key, row);
  return true;
}

async function loadVisitLog(storeId, sessionId) {
  const key = visitStateKey(storeId, sessionId);
  if (!key) return null;
  const value = await loadStateValue(key);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

async function loadRecentVisits(storeId, hours = 8) {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const rows = await supabaseFetch(
    `/app_state?key=like.${encodeURIComponent(`visit:${storeId}:%`)}&updated_at=gte.${encodeURIComponent(since)}&select=value,updated_at&order=updated_at.desc&limit=${MAX_VISITS_PER_SYNC}`
  );
  return (Array.isArray(rows) ? rows : [])
    .map(row => row.value)
    .filter(value => value && typeof value === 'object' && !Array.isArray(value));
}

async function saveStores(state) {
  memoryStoresCache.data = null;
  memoryStoresCache.expiresAt = 0;
  await saveStateValue('stores', { stores: state.stores, autoStoreId: state.autoStoreId });
}

async function saveLogs(state) {
  state.logs = trimRows(state.logs, MAX_LEGACY_LOGS);
  await saveStateValue('logs', packLogsValue(state.logs, state.autoLogId));
}

async function saveOrders(state) {
  state.orders = trimRows(state.orders, MAX_STORED_ORDERS);
  await saveStateValue('sapo_orders', packLogsValue(state.orders, state.autoLogId));
}

async function saveBlacklist(state) {
  memoryBlacklistCache.data = null;
  memoryBlacklistCache.expiresAt = 0;
  await saveStateValue('blacklist', { blacklist: state.blacklist || [], autoBlacklistId: state.autoBlacklistId || 1 });
}

async function saveBlacklistSafe(state) {
  try {
    await saveBlacklist(state);
    memoryFallbackBlacklist.blacklist = state.blacklist || [];
    memoryFallbackBlacklist.autoBlacklistId = state.autoBlacklistId || 1;
    return { transient: false };
  } catch (error) {
    if (!isSupabaseQuotaError(error)) throw error;
    memoryFallbackBlacklist.blacklist = state.blacklist || [];
    memoryFallbackBlacklist.autoBlacklistId = state.autoBlacklistId || 1;
    memoryBlacklistCache.data = memoryFallbackBlacklist.blacklist;
    memoryBlacklistCache.expiresAt = Date.now() + 60 * 60 * 1000;
    return { transient: true };
  }
}

async function loadBlacklistStateCached(ttlMs = 15000) {
  if (memoryBlacklistCache.data && memoryBlacklistCache.expiresAt > Date.now()) {
    return { ...stateTemplate(), blacklist: memoryBlacklistCache.data };
  }
  const state = await loadState({ includeLogs: false, includeOrders: false, includeStores: false, includeBlacklist: true });
  memoryBlacklistCache.data = state.blacklist || [];
  memoryBlacklistCache.expiresAt = Date.now() + ttlMs;
  return state;
}

async function loadBlacklistStateSafe(ttlMs = 15000) {
  try {
    return await loadBlacklistStateCached(ttlMs);
  } catch (error) {
    if (!isSupabaseQuotaError(error)) throw error;
    return {
      ...stateTemplate(),
      blacklist: memoryFallbackBlacklist.blacklist || [],
      autoBlacklistId: memoryFallbackBlacklist.autoBlacklistId || 1,
      transient_blacklist: true
    };
  }
}

async function loadStoresStateCached(ttlMs = 60000) {
  if (memoryStoresCache.data && memoryStoresCache.expiresAt > Date.now()) {
    return { ...stateTemplate(), stores: memoryStoresCache.data, autoStoreId: memoryStoresCache.autoStoreId };
  }
  const state = await loadState({ includeLogs: false, includeOrders: false, includeStores: true, includeBlacklist: false });
  memoryStoresCache.data = state.stores || [];
  memoryStoresCache.autoStoreId = state.autoStoreId || 1;
  memoryStoresCache.expiresAt = Date.now() + ttlMs;
  return state;
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

function normalizeIdentityType(value) {
  const type = String(value || 'ip').trim().toLowerCase();
  return ['ip', 'fingerprint', 'device_key', 'machine_key'].includes(type) ? type : 'ip';
}

function normalizeIdentityValue(type, value) {
  const identityType = normalizeIdentityType(type);
  const text = String(value || '').trim();
  if (identityType === 'ip') return normalizeIpValue(text);
  if (!/^[a-z0-9:_-]{4,128}$/i.test(text)) return '';
  return text;
}

function blacklistType(item) {
  return normalizeIdentityType(item?.type || item?.identity_type || (item?.ip ? 'ip' : 'ip'));
}

function blacklistValue(item) {
  const type = blacklistType(item);
  return normalizeIdentityValue(type, item?.value || item?.identity_value || item?.ip);
}

function findBlacklist(state, ...ips) {
  const values = ips.map(normalizeIpValue).filter(Boolean);
  if (!values.length) return null;
  return (state.blacklist || []).find(item => blacklistType(item) === 'ip' && values.includes(blacklistValue(item))) || null;
}

function findBlockedIdentity(state, { ips = [], fingerprint = '', deviceKey = '', machineKey = '' } = {}) {
  const ipValues = ips.map(normalizeIpValue).filter(Boolean);
  const fp = normalizeIdentityValue('fingerprint', fingerprint);
  const dk = normalizeIdentityValue('device_key', deviceKey);
  const mk = normalizeIdentityValue('machine_key', machineKey);
  return (state.blacklist || []).find(item => {
    const type = blacklistType(item);
    const value = blacklistValue(item);
    if (!value) return false;
    if (type === 'ip') return ipValues.includes(value);
    if (type === 'fingerprint') return fp && value === fp;
    if (type === 'device_key') return dk && value === dk;
    if (type === 'machine_key') return mk && value === mk;
    return false;
  }) || null;
}

function blacklistPublic(item) {
  const type = blacklistType(item);
  const value = blacklistValue(item);
  return {
    id: item.id,
    type,
    value,
    ip: type === 'ip' ? value : null,
    reason: item.reason || 'Blocked by Sapo IP Guard',
    created_at: item.created_at || null,
    source: item.source || 'manual'
  };
}

function normalizeTrace(value) {
  const data = parseJson(value, value || null);
  return data && typeof data === 'object' && !Array.isArray(data) ? data : null;
}

function fallbackFingerprint(row) {
  const trace = normalizeTrace(row?.browser_trace);
  if (trace?.fingerprint) return String(trace.fingerprint).trim();
  const userAgent = String(row?.user_agent || '').trim();
  if (!userAgent || userAgent === 'Sapo API Sync') return null;
  return sha256([
    userAgent,
    row?.device_type || '',
    row?.client_ip || '',
    row?.webrtc_ip || ''
  ].join('|')).slice(0, 12);
}

function fallbackDeviceKey(row) {
  const trace = normalizeTrace(row?.browser_trace);
  if (trace?.device_key || trace?.machine_key) return String(trace.device_key || trace.machine_key).trim();
  return null;
}

function fallbackMachineKey(row) {
  const trace = normalizeTrace(row?.browser_trace);
  if (trace?.machine_key || trace?.device_key) return String(trace.machine_key || trace.device_key).trim();
  return null;
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

function findVisitForOrder(visits, storeId, orderInfo, createdAt, orderIp) {
  const orderTime = new Date(createdAt).getTime();
  if (!Number.isFinite(orderTime)) return null;
  const candidates = (Array.isArray(visits) ? visits : []).filter(log => {
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
  const pageLimit = 250;
  const maxPages = preset === 'TODAY' ? 10 : (preset === '7_DAYS' ? 25 : 50);
  const recentVisits = await loadRecentVisits(store.id, preset === 'TODAY' ? 8 : (preset === '7_DAYS' ? 24 * 7 : 24 * 30))
    .catch(() => []);
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
      const visit = findVisitForOrder(recentVisits, store.id, info, createdAt, orderIp);
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
      row.fingerprint = visit?.fingerprint || row.fingerprint || null;
      row.device_key = visit?.device_key || row.device_key || null;
      row.machine_key = visit?.machine_key || row.machine_key || null;
      row.browser_trace = visit?.browser_trace || row.browser_trace || null;
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

async function scanSapoOrdersDirect(store, preset = 'TODAY') {
  const createdMin = presetMinDate(preset);
  const pageLimit = 250;
  const maxPages = preset === 'TODAY' ? 10 : (preset === '7_DAYS' ? 25 : 50);
  const rows = [];
  let total = 0;
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
    if (!orders.length) break;

    for (const sapoOrder of orders) {
      const createdAt = sapoOrder.created_on || sapoOrder.created_at || new Date().toISOString();
      if (!inPreset(createdAt, preset)) continue;
      const info = parseSapoOrder(sapoOrder);
      if (!info.order_id) continue;
      total++;
      const orderIp = sapoClientIp(sapoOrder);
      rows.push({
        id: `direct:${store.id}:${info.order_id}`,
        store_id: store.id,
        store_domain: store.mysapo_domain,
        trigger_event: 'sapo_direct_scan',
        client_ip: isKnownIp(orderIp) ? orderIp : 'unknown',
        webrtc_ip: null,
        webrtc_status: 'db_offline',
        user_agent: 'Sapo API Direct Scan',
        device_type: 'Unknown',
        order_info: JSON.stringify(info),
        created_at: new Date(createdAt).toISOString(),
        updated_at: new Date().toISOString()
      });
    }

    if (orders.length < pageLimit) break;
  }

  const enriched = await enrichOrders(rows);
  const decorated = rows.map(r => decorateOrder(r, null));
  return {
    success: true,
    direct_mode: true,
    total_orders: total,
    synced_new: rows.length,
    updated_orders: 0,
    enriched_ips: enriched,
    all_orders: decorated,
    orders: pagedOrders({ ...stateTemplate(), orders: rows }, {
      page: 1,
      limit: 50,
      store_id: store.id,
      startDate: businessDate(presetMinDate(preset) || new Date().toISOString()),
      endDate: businessDate(),
      filterMode: 'all'
    })
  };
}

function decorateOrder(row, state) {
  const info = getOrderInfo(row);
  const clientIp = normalizeIpValue(row.client_ip) || 'unknown';
  const webrtcIp = normalizeIpValue(row.webrtc_ip) || null;
  const invalidWebrtc = Boolean(row.webrtc_ip && !webrtcIp);
  const hasOtherRisk = Boolean(row.is_vpn || row.is_proxy || row.is_datacenter || row.is_tor || row.is_abuser);
  const riskReasons = parseJson(row.risk_reasons, []).filter(reason => !(invalidWebrtc && /webrtc/i.test(String(reason))));
  const browserTrace = normalizeTrace(row.browser_trace);
  const fingerprint = row.fingerprint || fallbackFingerprint(row);
  const deviceKey = row.device_key || fallbackDeviceKey(row);
  const machineKey = row.machine_key || fallbackMachineKey(row);
  const orderTimeMs = new Date(row.created_at).getTime();
  const sessionStartMs = new Date(row.session_start_at || '').getTime();
  const timeToOrderSec = Number.isFinite(orderTimeMs) && Number.isFinite(sessionStartMs)
    ? Math.max(0, Math.round((orderTimeMs - sessionStartMs) / 1000))
    : null;
  const blocked = findBlockedIdentity(state || {}, { ips: [clientIp, webrtcIp], fingerprint, deviceKey, machineKey });
  return {
    ...row,
    client_ip: clientIp,
    webrtc_ip: webrtcIp,
    fingerprint,
    device_key: deviceKey,
    machine_key: machineKey,
    browser_trace: browserTrace,
    user_order_time: row.created_at,
    time_to_order_sec: timeToOrderSec,
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
  const getOrderTime = (o) => {
    const raw = o.created_at || o.order_info?.created_at || 0;
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  };

  if (query.filterMode === 'duplicate_ip') {
    const counts = new Map();
    result.forEach(row => {
      const ips = [normalizeIpValue(row.client_ip), normalizeIpValue(row.webrtc_ip)].filter(Boolean);
      new Set(ips).forEach(ip => counts.set(ip, (counts.get(ip) || 0) + 1));
    });
    result = result.filter(row => {
      const ips = [normalizeIpValue(row.client_ip), normalizeIpValue(row.webrtc_ip)].filter(Boolean);
      return ips.some(ip => (counts.get(ip) || 0) > 1);
    });

    const getPrimaryDuplicateIp = (row) => {
      const cIp = normalizeIpValue(row.client_ip);
      if (cIp && (counts.get(cIp) || 0) > 1) return cIp;
      const wIp = normalizeIpValue(row.webrtc_ip);
      if (wIp && (counts.get(wIp) || 0) > 1) return wIp;
      return cIp || wIp || 'unknown';
    };

    const groups = new Map();
    result.forEach(row => {
      const key = getPrimaryDuplicateIp(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    for (const groupOrders of groups.values()) {
      groupOrders.sort((a, b) => getOrderTime(b) - getOrderTime(a));
    }

    const sortedGroups = Array.from(groups.entries()).sort(([, aOrders], [, bOrders]) => {
      return getOrderTime(bOrders[0]) - getOrderTime(aOrders[0]);
    });

    let groupIndex = 0;
    return sortedGroups.flatMap(([groupKey, groupOrders]) => {
      const gIdx = groupIndex++;
      return groupOrders.map((order, idx) => ({
        ...order,
        _dup_group_key: groupKey,
        _dup_group_index: gIdx,
        _dup_group_count: groupOrders.length,
        _dup_is_first_in_group: idx === 0,
        _dup_is_last_in_group: idx === groupOrders.length - 1
      }));
    });
  }

  if (query.filterMode === 'duplicate_fingerprint') {
    const counts = new Map();
    result.forEach(row => {
      const keys = [row.machine_key, row.device_key, row.fingerprint].map(v => String(v || '').trim()).filter(Boolean);
      new Set(keys).forEach(k => counts.set(k, (counts.get(k) || 0) + 1));
    });
    result = result.filter(row => {
      const keys = [row.machine_key, row.device_key, row.fingerprint].map(v => String(v || '').trim()).filter(Boolean);
      return keys.some(k => (counts.get(k) || 0) > 1);
    });

    const getPrimaryDuplicateTrace = (row) => {
      const keys = [row.machine_key, row.device_key, row.fingerprint].map(v => String(v || '').trim()).filter(Boolean);
      for (const k of keys) {
        if ((counts.get(k) || 0) > 1) return k;
      }
      return keys[0] || 'unknown';
    };

    const groups = new Map();
    result.forEach(row => {
      const key = getPrimaryDuplicateTrace(row);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });

    for (const groupOrders of groups.values()) {
      groupOrders.sort((a, b) => getOrderTime(b) - getOrderTime(a));
    }

    const sortedGroups = Array.from(groups.entries()).sort(([, aOrders], [, bOrders]) => {
      return getOrderTime(bOrders[0]) - getOrderTime(aOrders[0]);
    });

    let groupIndex = 0;
    return sortedGroups.flatMap(([groupKey, groupOrders]) => {
      const gIdx = groupIndex++;
      return groupOrders.map((order, idx) => ({
        ...order,
        _dup_group_key: groupKey,
        _dup_group_index: gIdx,
        _dup_group_count: groupOrders.length,
        _dup_is_first_in_group: idx === 0,
        _dup_is_last_in_group: idx === groupOrders.length - 1
      }));
    });
  }

  return [...result].sort((a, b) => getOrderTime(b) - getOrderTime(a));
}

function pagedOrders(state, query = {}) {
  const page = Math.max(1, Number(query.page || 1));
  const limit = Math.min(100, Math.max(1, Number(query.limit || 50)));
  const filtered = filterOrders(state.orders || [], query, state);
  return {
    success: true,
    data: filtered.slice((page - 1) * limit, page * limit),
    pagination: {
      page,
      limit,
      total: filtered.length,
      totalPages: Math.max(1, Math.ceil(filtered.length / limit))
    }
  };
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
    const preset = body.datePreset || 'TODAY';
    const result = await syncSapoOrders(state, store, preset);
    const orders = pagedOrders(state, {
      page: body.page || 1,
      limit: body.limit || 50,
      store_id: store.id,
      startDate: body.startDate || businessDate(presetMinDate(preset) || new Date().toISOString()),
      endDate: body.endDate || businessDate(),
      search: body.search || '',
      filterMode: body.filterMode || 'all'
    });
    return json(200, { ...result, orders });
  }
  return json(404, { success: false, message: 'Not found.' });
}

async function handleBlacklist(event, state, method, parts, query, body) {
  if (method === 'GET' && parts.length === 0) {
    return json(200, { success: true, transient: Boolean(state.transient_blacklist), data: (state.blacklist || []).map(blacklistPublic) });
  }

  if (method === 'GET' && parts[0] === 'check') {
    const clientIp = firstIp(event.headers['x-forwarded-for']) || event.headers['x-real-ip'] || query.ip || '';
    const blocked = findBlockedIdentity(state, {
      ips: [clientIp, query.webrtc_ip],
      fingerprint: query.fingerprint,
      deviceKey: query.device_key,
      machineKey: query.machine_key
    });
    return json(200, {
      success: true,
      is_blacklisted: Boolean(blocked),
      blocked_ip: blocked?.ip || null,
      blocked_value: blocked ? blacklistValue(blocked) : null,
      blocked_type: blocked ? blacklistType(blocked) : null,
      reason: blocked?.reason || null
    });
  }

  if (method === 'POST' && parts.length === 0) {
    const type = normalizeIdentityType(body.type || body.identity_type || (body.machine_key ? 'machine_key' : (body.fingerprint ? 'fingerprint' : (body.device_key ? 'device_key' : 'ip'))));
    const value = normalizeIdentityValue(type, body.value || body.identity_value || body.ip || body.fingerprint || body.device_key || body.machine_key);
    if (!value) return json(400, { success: false, message: 'Gia tri chan khong hop le.' });
    const existing = (state.blacklist || []).find(item => blacklistType(item) === type && blacklistValue(item) === value);
    if (existing) {
      existing.reason = String(body.reason || existing.reason || 'Blocked by Sapo IP Guard').trim();
      existing.updated_at = new Date().toISOString();
      const saved = await saveBlacklistSafe(state);
      return json(200, { success: true, transient: saved.transient, data: blacklistPublic(existing) });
    }
    const item = {
      id: state.autoBlacklistId++,
      type,
      value,
      ip: type === 'ip' ? value : null,
      reason: String(body.reason || 'Blocked by Sapo IP Guard').trim(),
      source: String(body.source || 'manual').trim(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    state.blacklist.unshift(item);
    const saved = await saveBlacklistSafe(state);
    return json(201, { success: true, transient: saved.transient, data: blacklistPublic(item) });
  }

  if (method === 'DELETE' && parts[0]) {
    const rawValue = String(parts[0] || '').trim();
    const before = (state.blacklist || []).length;
    state.blacklist = (state.blacklist || []).filter(item => {
      const publicItem = blacklistPublic(item);
      return String(publicItem.id) !== rawValue && publicItem.value !== rawValue && publicItem.ip !== rawValue;
    });
    let saved = { transient: Boolean(state.transient_blacklist) };
    if (state.blacklist.length !== before) saved = await saveBlacklistSafe(state);
    return json(200, { success: true, transient: saved.transient });
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
    const existing = body.session_id ? await loadVisitLog(store.id, body.session_id).catch(() => null) : null;
    const row = existing || {
      id: body.session_id ? `visit:${store.id}:${String(body.session_id).slice(0, 60)}` : state.autoLogId++,
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
    row.fingerprint = String(body.fingerprint || row.fingerprint || '').trim() || null;
    row.device_key = String(body.device_key || row.device_key || '').trim() || null;
    row.machine_key = String(body.machine_key || row.machine_key || '').trim() || null;
    row.browser_trace = body.browser_trace && typeof body.browser_trace === 'object'
      ? body.browser_trace
      : (row.browser_trace || null);
    row.trigger_event = body.trigger_event || row.trigger_event || 'network_identity';
    row.updated_at = new Date().toISOString();
    const savedVisit = await saveVisitLog(row);
    if (!savedVisit) {
      if (!existing) state.logs.unshift(row);
      await saveLogs(state);
    }
    const blocked = findBlockedIdentity(state, {
      ips: [row.client_ip, row.webrtc_ip],
      fingerprint: row.fingerprint,
      deviceKey: row.device_key,
      machineKey: row.machine_key
    });
    return json(201, {
      success: true,
      log_id: row.id,
      client_ip: row.client_ip,
      webrtc_ip: row.webrtc_ip || null,
      is_blacklisted: Boolean(blocked),
      blocked_ip: blocked?.ip || null,
      blocked_value: blocked ? blacklistValue(blocked) : null,
      blocked_type: blocked ? blacklistType(blocked) : null,
      block_reason: blocked?.reason || null
    });
  }

  if (method === 'GET' && parts.length === 0) {
    return json(200, pagedOrders(state, query));
  }

  return json(404, { success: false, message: 'Not found.' });
}

async function handleMaintenance(state, method, parts) {
  if (method === 'POST' && parts[0] === 'compact') {
    const beforeOrders = (state.orders || []).length;
    const beforeLogs = (state.logs || []).length;
    state.orders = trimRows(state.orders, MAX_STORED_ORDERS);
    state.logs = [];
    await Promise.all([
      saveOrders(state),
      saveLogs(state)
    ]);
    return json(200, {
      success: true,
      before_orders: beforeOrders,
      after_orders: state.orders.length,
      before_logs: beforeLogs,
      after_logs: 0
    });
  }
  return json(404, { success: false, message: 'Not found.' });
}

async function handleDirectSync(method, body) {
  if (method !== 'POST') return json(404, { success: false, message: 'Not found.' });
  const store = {
    id: 0,
    store_name: String(body.store_name || body.mysapo_domain || 'Sapo Direct').trim(),
    mysapo_domain: normalizeDomain(body.mysapo_domain || body.domain),
    api_key: String(body.api_key || '').trim(),
    api_secret_encrypted: encryptSecret(String(body.api_secret || '').trim())
  };
  if (!store.mysapo_domain || !store.api_key || !body.api_secret) {
    return json(400, { success: false, message: 'Nhap domain Sapo, API key va API secret de quet tam thoi.' });
  }
  return json(200, await scanSapoOrdersDirect(store, body.datePreset || 'TODAY'));
}

function firstIp(value) {
  return String(value || '').split(',')[0].trim();
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return response(204, '');
    const rawPath = event.path.replace(/^\/\.netlify\/functions\/api/, '');
    if (rawPath === '/health') return json(200, { status: 'OK', version: 'clean-orders-v4-direct-sapo', time: new Date().toISOString() });
    if (rawPath === '/client-tracker.js') {
      const clientIp = firstIp(event.headers['x-forwarded-for']) || event.headers['x-real-ip'] || event.headers['cf-connecting-ip'] || '';
      let blocked = null;
      try {
        const state = await loadBlacklistStateCached();
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

    if (resource === 'direct-sync') return await handleDirectSync(method, body);

    if (publicBlacklistCheck) {
      const state = await loadBlacklistStateCached();
      return await handleBlacklist(event, state, method, parts, query, body);
    }

    if (publicCollect) {
      const [storesState, blacklistState] = await Promise.all([
        loadStoresStateCached(),
        loadBlacklistStateCached()
      ]);
      const state = {
        ...stateTemplate(),
        stores: storesState.stores || [],
        autoStoreId: storesState.autoStoreId || 1,
        blacklist: blacklistState.blacklist || [],
        autoBlacklistId: blacklistState.autoBlacklistId || 1
      };
      return await handleLogs(event, state, method, parts, query, body);
    }

    const isSync = resource === 'stores' && method === 'POST' && parts[1] === 'sync';
    const isOrdersRead = resource === 'logs' && method === 'GET';
    const isBlacklistResource = resource === 'blacklist';
    const isMaintenance = resource === 'maintenance';
    const state = await loadState({
      includeLogs: Boolean(isMaintenance),
      includeOrders: Boolean(isOrdersRead || isSync || isMaintenance),
      includeStores: Boolean(resource === 'stores' || publicCollect),
      includeBlacklist: Boolean(isOrdersRead || isBlacklistResource || publicCollect)
    });
    if (resource === 'stores') return await handleStores(state, method, parts, body);
    if (resource === 'blacklist') return await handleBlacklist(event, state, method, parts, query, body);
    if (resource === 'logs') return await handleLogs(event, state, method, parts, query, body);
    if (resource === 'maintenance') return await handleMaintenance(state, method, parts);

    return json(404, { success: false, message: 'Not found.' });
  } catch (error) {
    return json(500, { success: false, message: error.message || 'Server error.' });
  }
};
