const crypto = require('crypto');

const DEFAULT_STATE_KEY = 'default';
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const COLLECT_WINDOW_MS = 60 * 1000;
const COLLECT_MAX_PER_WINDOW = 30;
const collectCounters = new Map();

const TRACKER_SOURCE = `/**
 * Sapo Fake IP & WebRTC Leak Tracker Script
 */
(function () {
  'use strict';

  var BACKEND_URL = (function () {
    if (window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.backendUrl) {
      return window.SAPO_TRACKER_CONFIG.backendUrl.replace(/\\/$/, '');
    }
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('client-tracker.js') !== -1) {
        var url = new URL(scripts[i].src);
        return url.origin;
      }
    }
    return window.location.origin;
  })();

  var API_KEY = (window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.apiKey) ? window.SAPO_TRACKER_CONFIG.apiKey : null;
  var lastPushedUrl = '';
  var lastPushedTime = 0;
  var lastCheckoutActivityAt = 0;
  var lastInteractionAt = 0;
  var EMBEDDED_BLACKLIST = Array.isArray(window.__SAPO_IP_GUARD_BLACKLIST) ? window.__SAPO_IP_GUARD_BLACKLIST : [];
  var cachedPublicIp = null;
  var cachedWebRtcIp = null;
  var cachedWebRtcStatus = 'pending';
  var networkHydrateStarted = false;

  function getSessionMeta() {
    var sessionId = sessionStorage.getItem('sapo_session_id');
    var sessionStart = sessionStorage.getItem('sapo_session_start');
    var now = Date.now();
    var sessionStartMs = sessionStart ? parseInt(sessionStart, 10) : NaN;

    // Reset session if missing, unparseable, idle for >30 mins, or >3 hours old
    if (!sessionId || !sessionStart || !Number.isFinite(sessionStartMs) || (lastInteractionAt > 0 && now - lastInteractionAt > 30 * 60 * 1000) || (now - sessionStartMs > 3 * 60 * 60 * 1000)) {
      sessionId = 'S-' + now.toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStartMs = now;
      sessionStorage.setItem('sapo_session_id', sessionId);
      sessionStorage.setItem('sapo_session_start', sessionStartMs.toString());
    }
    return {
      session_id: sessionId,
      session_start_at: new Date(sessionStartMs).toISOString(),
      session_duration_sec: Math.max(1, Math.round((now - sessionStartMs) / 1000))
    };
  }

  function getClientPublicIP(callback) {
    var resolved = false;
    var timer = setTimeout(function () {
      if (!resolved) {
        resolved = true;
        callback(null);
      }
    }, 700);
    fetch('https://api.ipify.org?format=json')
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          if (data && data.ip) cachedPublicIp = data.ip;
          callback(data ? data.ip : null);
        }
      })
      .catch(function () {
        if (!resolved) {
          resolved = true;
          clearTimeout(timer);
          callback(null);
        }
      });
  }

  function getWebRTCIP(callback) {
    var webrtcIp = null;
    var resolved = false;
    var candidateSeen = false;
    var privateCandidateSeen = false;
    cachedWebRtcIp = null;
    cachedWebRtcStatus = 'pending';
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!RTCPeerConnection) {
      cachedWebRtcIp = null;
      cachedWebRtcStatus = 'unsupported';
      return callback(null);
    }
    try {
      var pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun.cloudflare.com:3478' }
        ]
      });
      pc.createDataChannel('');
      var finish = function (value) {
        if (resolved) return;
        resolved = true;
        cachedWebRtcIp = value || null;
        cachedWebRtcStatus = value ? 'captured' : (privateCandidateSeen ? 'private_only' : (candidateSeen ? 'hidden' : 'not_available'));
        try { pc.close(); } catch (e) {}
        callback(value || null);
      };
      var isUsablePublicIp = function (ip) {
        if (!ip || ip === '0.0.0.0' || ip === '127.0.0.1') return false;
        var p = ip.split('.').map(function (n) { return parseInt(n, 10); });
        if (p.length !== 4 || p.some(function (n) { return !Number.isFinite(n) || n < 0 || n > 255; })) return false;
        if (p[0] === 10 || p[0] === 127 || p[0] === 0) { privateCandidateSeen = true; return false; }
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) { privateCandidateSeen = true; return false; }
        if (p[0] === 192 && p[1] === 168) { privateCandidateSeen = true; return false; }
        if (p[0] === 169 && p[1] === 254) { privateCandidateSeen = true; return false; }
        if (p[0] >= 224) return false;
        return true;
      };
      var inspectCandidate = function (candidateText, explicitType, explicitAddress) {
        if (!candidateText) return;
        candidateSeen = true;
        var lines = String(candidateText).split(/\\r?\\n/);
        for (var i = 0; i < lines.length; i++) {
          var parts = lines[i].trim().split(/\\s+/);
          var typeIndex = parts.indexOf('typ');
          var candidateType = explicitType || (typeIndex >= 0 ? parts[typeIndex + 1] : '');
          var candidateAddress = explicitAddress || parts[4] || '';
          if (candidateType === 'host') {
            isUsablePublicIp(candidateAddress);
            continue;
          }
          // Only server-reflexive candidates are a trustworthy public WebRTC address.
          if (candidateType !== 'srflx') continue;
          if (isUsablePublicIp(candidateAddress)) {
            webrtcIp = candidateAddress;
            finish(webrtcIp);
            return;
          }
        }
      };
      pc.onicecandidate = function (e) {
        if (!e.candidate) return;
        inspectCandidate(e.candidate.candidate, e.candidate.type, e.candidate.address);
      };
      pc.createOffer().then(function (sdp) {
        inspectCandidate(sdp && sdp.sdp);
        return pc.setLocalDescription(sdp);
      }).then(function () {
        setTimeout(function () { inspectCandidate(pc.localDescription && pc.localDescription.sdp); }, 350);
      }).catch(function () {});
      setTimeout(function () { if (!webrtcIp) finish(null); }, 2200);
    } catch (err) {
      cachedWebRtcIp = null;
      cachedWebRtcStatus = 'error';
      callback(null);
    }
  }

  function hydrateNetworkIdentity() {
    if (networkHydrateStarted) return;
    networkHydrateStarted = true;
    getClientPublicIP(function () {});
    getWebRTCIP(function () {});
  }

  function getBrowserFingerprint() {
    try {
      var canvas = document.createElement('canvas');
      var ctx = canvas.getContext('2d');
      var txt = 'Sapo_Prod_Fingerprint_2026';
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText(txt, 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText(txt, 4, 17);
      var dataUrl = canvas.toDataURL();
      var hash = 0;
      for (var i = 0; i < dataUrl.length; i++) {
        hash = ((hash << 5) - hash) + dataUrl.charCodeAt(i);
        hash |= 0;
      }
      return 'FP-' + Math.abs(hash).toString(16) + '-' + screen.width + 'x' + screen.height;
    } catch (e) {
      return 'FP-fallback-' + Date.now();
    }
  }

  function getSapoOrderInfo(formEl) {
    var info = {};
    var bz = window.Bizweb || window.Sapo || window.BizwebCheckout;
    if (bz) {
      var c = bz.checkout || bz.order;
      if (c) {
        info.order_id = c.name || (c.order_number ? '#' + c.order_number : null) || c.order_id || (c.id ? '#' + c.id : null);
        var addr = c.shipping_address || c.billing_address;
        if (addr) {
          info.customer_name = addr.name || addr.full_name || ((addr.first_name || '') + ' ' + (addr.last_name || '')).trim();
          info.phone = addr.phone;
          info.address = addr.address1;
        }
        info.total_price = c.total_price || c.total;
        info.email = c.email;
      }
    }
    if (!info.order_id) {
      var orderCodeEl = document.querySelector('.order-number, .thankyou-order-id, #order_code, .order-code, [data-order-name], .os-order-number');
      if (orderCodeEl) {
        var text = orderCodeEl.innerText.trim();
        if (text) info.order_id = text.startsWith('#') ? text : '#' + text;
      } else {
        var bodyText = document.body ? document.body.innerText : '';
        var match = bodyText.match(/(?:#|don hang|order)\\s*([0-9]{4,8})/i);
        if (match) info.order_id = '#' + match[1];
      }
    }
    var root = formEl || document;
    var nameEl = root.querySelector('input[name*="full_name"], input[name*="name"], #billing_address_full_name, #billing_address_name, .customer-name');
    var phoneEl = root.querySelector('input[name*="phone"], #billing_address_phone, .customer-phone');
    var emailEl = root.querySelector('input[type="email"], input[name*="email"], #checkout_user_email');
    if (!info.customer_name && nameEl && nameEl.value) info.customer_name = nameEl.value.trim();
    if (!info.phone && phoneEl && phoneEl.value) info.phone = phoneEl.value.trim();
    if (!info.email && emailEl && emailEl.value) info.email = emailEl.value.trim();
    return (info.order_id || info.customer_name || info.phone) ? info : null;
  }

  function renderAccessDeniedScreen(blockedIp) {
    try {
      var ipText = blockedIp || 'unknown';
      document.documentElement.innerHTML = '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#fff;font-family:Arial,Segoe UI,sans-serif;color:#202124;"><main style="max-width:760px;margin:0 auto;padding:18vh 48px 48px;box-sizing:border-box;"><div style="width:56px;height:44px;border-radius:28px 28px 18px 18px;background:#eef1f5;position:relative;margin-bottom:26px;"></div><h1 style="font-size:30px;line-height:1.25;font-weight:500;margin:0 0 14px;">Không thể truy cập trang này</h1><p style="font-size:16px;line-height:1.6;margin:0 0 10px;">Quyền truy cập của bạn vào website này đã bị hạn chế.</p><p style="font-size:14px;line-height:1.6;color:#5f6368;margin:0 0 28px;">Nếu cho rằng đây là nhầm lẫn, vui lòng liên hệ quản trị viên cửa hàng.</p><p style="font-size:12px;color:#80868b;margin:0;font-family:monospace;">ERR_ACCESS_DENIED · IP: ' + ipText + '</p></main></body>';
      window.stop && window.stop();
    } catch(e) {}
  }

  function getDeviceType() {
    var ua = navigator.userAgent || '';
    if (/ipad|tablet/i.test(ua) || (/android/i.test(ua) && !/mobile/i.test(ua))) return 'Tablet';
    if (/mobi|android|iphone|ipod/i.test(ua)) return 'Mobile';
    return 'Desktop';
  }

  function getClickedUrl(target) {
    var element = target && target.closest ? target.closest('a[href], button, [role="button"]') : null;
    if (!element) return window.location.href;
    var href = element.getAttribute('href');
    if (!href || href === '#' || href.indexOf('javascript:') === 0) return window.location.href;
    try { return new URL(href, window.location.href).href; } catch (e) { return window.location.href; }
  }

  function pushLog(orderInfo, triggerEvent, clickedUrl) {
    var now = Date.now();
    var currentUrl = window.location.href;
    if (triggerEvent === 'page_view' && !orderInfo && currentUrl === lastPushedUrl && (now - lastPushedTime < 10000)) return;
    lastPushedUrl = currentUrl;
    lastPushedTime = now;
    getClientPublicIP(function (clientPublicIp) {
      getWebRTCIP(function (webrtcIp) {
        cachedWebRtcIp = webrtcIp || null;
        var sessionMeta = getSessionMeta();
        fetch(BACKEND_URL + '/api/v1/logs/collect', {
          method: 'POST',
          keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_ip: clientPublicIp,
            api_key: API_KEY,
            webrtc_ip: webrtcIp || null,
            webrtc_status: cachedWebRtcStatus,
            user_agent: navigator.userAgent,
            fingerprint: getBrowserFingerprint(),
            order_info: orderInfo || getSapoOrderInfo(),
            url: currentUrl,
            last_clicked_url: clickedUrl || currentUrl,
            device_type: getDeviceType(),
            connection_status: 'active',
            store_domain: window.location.hostname,
            trigger_event: triggerEvent || 'page_view',
            session_id: sessionMeta.session_id,
            session_start_at: sessionMeta.session_start_at,
            session_duration: sessionMeta.session_duration_sec
          })
        }).then(function (res) { return res.json(); }).then(function (data) {
          if (data && data.is_blacklisted) renderAccessDeniedScreen(data.client_ip || clientPublicIp);
        }).catch(function () {});
      });
    });
  }

  function attachFormSubmitListeners() {
    var checkoutForms = document.querySelectorAll('form[action*="checkout"], form[action*="cart"], #checkout-form, .form-checkout');
    checkoutForms.forEach(function (form) {
      if (form.getAttribute('data-sapo-tracked')) return;
      form.setAttribute('data-sapo-tracked', 'true');
      form.addEventListener('submit', function () { pushLog(getSapoOrderInfo(form), 'checkout_submit'); });
    });
  }

  function attachCheckoutActivityListeners() {
    var fields = document.querySelectorAll('input[name*="phone"], input[name*="email"], input[name*="name"], #billing_address_phone, #billing_address_full_name, #checkout_user_email');
    fields.forEach(function (field) {
      if (field.getAttribute('data-sapo-activity-tracked')) return;
      field.setAttribute('data-sapo-activity-tracked', 'true');
      var capture = function () {
        var now = Date.now();
        if (now - lastCheckoutActivityAt < 8000) return;
        var info = getSapoOrderInfo(field.form || document);
        if (!info || (!info.phone && !info.email && !info.order_id)) return;
        lastCheckoutActivityAt = now;
        pushLog(info, 'checkout_activity');
      };
      field.addEventListener('change', capture);
      field.addEventListener('blur', capture);
    });
  }

  function attachClickListeners() {
    document.addEventListener('click', function (event) {
      if (event.button && event.button !== 0) return;
      var now = Date.now();
      if (now - lastInteractionAt < 1000) return;
      var clickedUrl = getClickedUrl(event.target);
      if (!clickedUrl) return;
      lastInteractionAt = now;
      var meta = getSessionMeta();
      var payload = {
        api_key: API_KEY,
        store_domain: window.location.hostname,
        user_agent: navigator.userAgent,
        fingerprint: getBrowserFingerprint(),
        client_ip: cachedPublicIp,
        webrtc_ip: cachedWebRtcIp,
        webrtc_status: cachedWebRtcStatus,
        url: window.location.href,
        last_clicked_url: clickedUrl,
        device_type: getDeviceType(),
        connection_status: clickedUrl === window.location.href ? 'active' : 'inactive',
        trigger_event: 'click',
        session_id: meta.session_id,
        session_start_at: meta.session_start_at,
        session_duration: meta.session_duration_sec
      };
      try {
        navigator.sendBeacon(BACKEND_URL + '/api/v1/logs/collect', new Blob([JSON.stringify(payload)], { type: 'text/plain' }));
      } catch (e) {
        fetch(BACKEND_URL + '/api/v1/logs/collect', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).catch(function () {});
      }
    }, true);
  }

  function checkBlacklistImmediately() {
    getClientPublicIP(function (pubIp) {
      cachedPublicIp = pubIp || cachedPublicIp;
      getWebRTCIP(function (webrtcIp) {
        cachedWebRtcIp = webrtcIp || null;
        if (EMBEDDED_BLACKLIST.indexOf(pubIp) !== -1 || EMBEDDED_BLACKLIST.indexOf(webrtcIp) !== -1) {
          renderAccessDeniedScreen(webrtcIp || pubIp);
          return;
        }
        var query = [];
        if (pubIp) query.push('ip=' + encodeURIComponent(pubIp));
        if (webrtcIp) query.push('webrtc_ip=' + encodeURIComponent(webrtcIp));
        fetch(BACKEND_URL + '/api/v1/blacklist/check' + (query.length ? '?' + query.join('&') : ''))
          .then(function (r) { return r.json(); })
          .then(function (res) { if (res && res.is_blacklisted) renderAccessDeniedScreen(webrtcIp || pubIp || res.ip); })
          .catch(function () {});
      });
    });
  }

  function initTracking() {
    hydrateNetworkIdentity();
    checkBlacklistImmediately();
    attachFormSubmitListeners();
    attachCheckoutActivityListeners();
    attachClickListeners();
    setInterval(attachFormSubmitListeners, 3000);
    setInterval(attachCheckoutActivityListeners, 3000);
    setInterval(checkBlacklistImmediately, 30000);
    if (navigator.connection && navigator.connection.addEventListener) {
      navigator.connection.addEventListener('change', function () {
        cachedPublicIp = null;
        cachedWebRtcIp = null;
        cachedWebRtcStatus = 'pending';
        networkHydrateStarted = false;
        hydrateNetworkIdentity();
      });
    }
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') initTracking();
  else document.addEventListener('DOMContentLoaded', initTracking);
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
  return response(statusCode, body, { 'Content-Type': 'application/json; charset=utf-8' });
}

function unauthorized(message = 'Admin key is invalid.') {
  return json(401, { success: false, message });
}

function assertAdmin(event) {
  return true;
}

function stateTemplate() {
  return {
    stores: [
      {
        id: 3,
        store_name: "Stussy",
        mysapo_domain: "stussy-vietnam.mysapo.net",
        api_key: "e8685cda41d44c1d8f0547b2cec7de02",
        api_secret_encrypted: "v1.m7IfSYk3hLJa5HaQ.Zn7mWZl2Yj+CQRVtlLamYg==.+V1zLLvByK2YycLiUYCF19IHXz1FFp7G1IvgwsXNlJo=",
        is_active: 1,
        created_at: "2026-08-01T03:13:09.047Z"
      },
      {
        id: 2,
        store_name: "TEST VUA ĐỒ FAKE",
        mysapo_domain: "vua-do-hieu.mysapo.net",
        api_key: "19f31439d2e24491b17c3c7ec574f81d",
        api_secret_encrypted: "v1.tJj0ELtWHf4zfrro.bO2iT54IP58bpHQVnDj7gA==.AoV+HQWD1soFD6InnST/8r2CFUq9R+l5ilLGDxUiVVQ=",
        is_active: 1,
        created_at: "2026-07-31T02:13:31.070Z"
      }
    ],
    logs: [],
    blacklist: [],
    autoStoreId: 4,
    autoLogId: 1000,
    autoBlacklistId: 10
  };
}

let inMemoryState = null;

function hasSupabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.service_role || process.env.SERVICE_ROLE || '';
  return Boolean(url && key);
}

function supabaseConfig() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
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
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch (_) { data = text; }
  }
  if (!res.ok) {
    throw new Error(typeof data === 'string' ? data : (data?.message || `Supabase request failed: ${res.status}`));
  }
  return data;
}

async function loadState() {
  if (!hasSupabaseConfig()) {
    if (!inMemoryState) inMemoryState = stateTemplate();
    return inMemoryState;
  }
  try {
    const keys = [DEFAULT_STATE_KEY, 'stores'];
    const rows = await supabaseFetch(`/app_state?key=in.(${keys.map(encodeURIComponent).join(',')})&select=key,value`);
    const defaultRow = Array.isArray(rows) ? rows.find(row => row.key === DEFAULT_STATE_KEY) : null;
    if (!defaultRow?.value) {
      const initial = stateTemplate();
      await saveState(initial);
      await saveStoresState(initial);
      return initial;
    }

    const state = { ...stateTemplate(), ...defaultRow.value };
    const storesRow = rows.find(row => row.key === 'stores');
    if (storesRow?.value) {
      state.stores = Array.isArray(storesRow.value.stores) ? storesRow.value.stores : state.stores;
      state.autoStoreId = Number(storesRow.value.autoStoreId || state.autoStoreId);
    }
    return state;
  } catch (e) {
    if (!inMemoryState) inMemoryState = stateTemplate();
    return inMemoryState;
  }
}

async function saveStateValue(key, value) {
  if (!hasSupabaseConfig()) return;
  try {
    const payload = { key, value, updated_at: new Date().toISOString() };
    await supabaseFetch('/app_state?on_conflict=key', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(payload)
    });
  } catch (e) {}
}

async function saveState(state) {
  await saveStateValue(DEFAULT_STATE_KEY, state);
}

async function saveStoresState(state) {
  await saveStateValue('stores', {
    stores: state.stores,
    autoStoreId: state.autoStoreId
  });
}

function cleanDomain(domain) {
  return String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function publicStore(store) {
  const { api_secret, api_secret_encrypted, ...safe } = store;
  return {
    ...safe,
    has_api_secret: Boolean(api_secret || api_secret_encrypted),
    credentials_saved_at: store.credentials_saved_at || store.created_at || null
  };
}

function encryptionKey() {
  return crypto.createHash('sha256').update(process.env.DATA_ENCRYPTION_KEY || '847bade69ce34d7d84f28a15ff6c3179f2a0d596db943e3eb8ca47e20ad91f77').digest();
}

function encryptSecret(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  if (String(value).startsWith('v1.')) {
    try {
      const [, ivBase64, tagBase64, ciphertextBase64] = String(value).split('.');
      const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivBase64, 'base64'));
      decipher.setAuthTag(Buffer.from(tagBase64, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertextBase64, 'base64')), decipher.final()]).toString('utf8');
    } catch (e) {
      return '';
    }
  }
  const parts = String(value || '').split(':');
  if (parts.length < 3) return value;
  try {
    const [ivB64, tagB64, encryptedB64] = parts;
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivB64, 'base64'));
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedB64, 'base64')), decipher.final()]).toString('utf8');
  } catch (e) {
    return value;
  }
}

function businessDate(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function businessDayBounds(day) {
  if (!day) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : businessDate(day);
  const start = new Date(`${normalized}T00:00:00.000+07:00`).toISOString();
  const end = new Date(`${normalized}T23:59:59.999+07:00`).toISOString();
  return { start, end };
}

function hasOrderInfo(value) {
  return !!(value && value !== 'null' && value !== '');
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function getClientIp(event, fallback) {
  const forwarded = event.headers['x-forwarded-for'] || event.headers['X-Forwarded-For'];
  // Prefer the address supplied by Netlify's edge over a browser-provided value.
  // The fallback is kept only for local development where proxy headers are absent.
  return (forwarded ? forwarded.split(',')[0].trim() : event.headers['client-ip']) || fallback || 'unknown';
}

function allowCollection(ip) {
  const key = ip || 'unknown';
  const now = Date.now();
  const current = collectCounters.get(key);
  if (!current || now - current.startedAt >= COLLECT_WINDOW_MS) {
    collectCounters.set(key, { startedAt: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= COLLECT_MAX_PER_WINDOW;
}

function isKnownIp(ip) {
  const value = String(ip || '').trim().toLowerCase();
  return Boolean(value && value !== 'unknown' && value !== '0.0.0.0' && value !== '::');
}

async function lookupIp(ip) {
  if (!isKnownIp(ip)) return {};
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: controller.signal
    });
    clearTimeout(timer);
    const data = await res.json();
    if (data && data.success !== false) {
      const orgText = `${data.connection?.isp || ''} ${data.connection?.org || ''} ${data.connection?.domain || ''}`.toLowerCase();
      const datacenterWords = ['gthost', 'hosting', 'host', 'vpn', 'proxy', 'cloud', 'cloudflare', 'warp', 'amazon', 'aws', 'google', 'digitalocean', 'linode', 'ovh', 'hetzner', 'm247', 'datacenter'];
      const isDatacenter = datacenterWords.some(word => orgText.includes(word));
      return {
        country: data.country || 'Unknown',
        countryCode: data.country_code || 'XX',
        city: data.city || 'Unknown',
        isp: data.connection?.isp || data.connection?.org || 'Unknown',
        org: data.connection?.org || data.connection?.isp || 'Unknown',
        hosting: isDatacenter,
        proxy: isDatacenter
      };
    }
  } catch (_) {}
  return {};
}

async function analyzeRisk(clientIp, webrtcIp, ipCache = null, stateLogs = []) {
  if (!isKnownIp(clientIp)) {
    return {
      ipData: {},
      isVpn: false,
      isDatacenter: false,
      webrtcMismatch: false,
      riskLevel: 'UNKNOWN',
      riskReasons: ['No usable IP captured']
    };
  }

  let ipData = ipCache ? ipCache.get(clientIp) : null;
  if (!ipData) {
    ipData = await lookupIp(clientIp);
    if (ipCache) ipCache.set(clientIp, ipData);
  }

  const orgText = `${ipData.isp || ''} ${ipData.org || ''} ${ipData.as || ''}`.toLowerCase();
  const datacenterWords = ['hosting', 'host', 'vpn', 'proxy', 'cloud', 'cloudflare', 'warp', 'amazon', 'aws', 'google', 'digitalocean', 'linode', 'ovh', 'hetzner', 'gthost', 'm247', 'datacenter'];
  const isDatacenter = Boolean(ipData.hosting || datacenterWords.some(word => orgText.includes(word)));
  const isVpn = Boolean(ipData.proxy || orgText.includes('vpn') || orgText.includes('proxy'));
  const webrtcMismatch = Boolean(webrtcIp && clientIp && webrtcIp !== clientIp);
  const riskReasons = [];
  if (isVpn) riskReasons.push('VPN/Proxy detected');
  if (isDatacenter) riskReasons.push('Datacenter/hosting IP detected');
  if (webrtcMismatch) riskReasons.push('WebRTC IP mismatch detected');
  return {
    ipData,
    isVpn,
    isDatacenter,
    webrtcMismatch,
    riskLevel: riskReasons.length ? 'HIGH_RISK' : 'CLEAN',
    riskReasons
  };
}

function filterLogs(logs, query) {
  let rows = [...logs];
  if (query.store_id && query.store_id !== 'ALL') {
    const storeId = Number(query.store_id);
    rows = rows.filter(row => row.store_id === storeId || row.store_id === null);
  }
  if (query.risk_level && query.risk_level !== 'ALL') {
    rows = rows.filter(row => row.risk_level === query.risk_level);
  }
  if (query.orders_only === 'true') {
    rows = rows.filter(row => hasOrderInfo(row.order_info));
  }
  if (query.search) {
    const s = query.search.toLowerCase();
    rows = rows.filter(row =>
      String(row.client_ip || '').toLowerCase().includes(s) ||
      String(row.webrtc_ip || '').toLowerCase().includes(s) ||
      String(row.isp || '').toLowerCase().includes(s) ||
      String(row.order_info || '').toLowerCase().includes(s) ||
      String(row.last_clicked_url || '').toLowerCase().includes(s) ||
      String(row.device_type || '').toLowerCase().includes(s) ||
      String(row.fingerprint || '').toLowerCase().includes(s)
    );
  }
  const startBounds = businessDayBounds(query.startDate);
  const endBounds = businessDayBounds(query.endDate);
  if (startBounds) rows = rows.filter(row => row.created_at && row.created_at >= startBounds.start);
  if (endBounds) rows = rows.filter(row => row.created_at && row.created_at <= endBounds.end);
  return rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return 'Chưa bắt được phiên';
  const safeSeconds = Math.max(1, Math.round(Number(seconds)));
  if (!Number.isFinite(safeSeconds) || safeSeconds > 24 * 60 * 60) return 'Chưa bắt được phiên';
  if (safeSeconds < 15) return `${safeSeconds} giây (Đặt cực nhanh)`;
  if (safeSeconds < 60) return `${safeSeconds} giây`;
  const mins = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  if (mins >= 60) {
    const hours = Math.floor(mins / 60);
    const remMins = mins % 60;
    return `> ${hours} giờ${remMins > 0 ? ` ${remMins}p` : ''} (Treo tab)`;
  }
  return `${mins} phút${secs > 0 ? ` ${secs}s` : ''}`;
}

function decorateLog(row, state) {
  const blacklisted = new Set(state.blacklist.map(item => item.ip));
  const hasOrder = hasOrderInfo(row.order_info);
  let timeToOrder = null;
  if (hasOrder && row.session_duration_sec) timeToOrder = formatDuration(Number(row.session_duration_sec));
  return {
    ...row,
    is_blacklisted: blacklisted.has(row.client_ip) || blacklisted.has(row.webrtc_ip),
    time_to_order: timeToOrder || (hasOrder ? 'Chưa bắt được phiên' : null),
    order_info: hasOrder ? safeJsonParse(row.order_info, null) : null,
    risk_reasons: row.risk_reasons ? safeJsonParse(row.risk_reasons, []) : []
  };
}

async function handleStores(event, state, method, parts, body) {
  if (!assertAdmin(event)) return unauthorized();
  if (method === 'GET' && parts.length === 0) {
    return json(200, { success: true, data: state.stores.map(publicStore) });
  }
  if (method === 'POST' && parts.length === 0) {
    const { store_name, mysapo_domain, api_key, api_secret } = body || {};
    if (!store_name || !mysapo_domain || !api_key || !api_secret) {
      return json(400, { success: false, message: 'Vui long dien day du thong tin store.' });
    }
    const domain = cleanDomain(mysapo_domain);
    if (state.stores.some(store => cleanDomain(store.mysapo_domain) === domain)) {
      return json(409, { success: false, message: 'Cua hang voi Mysapo Domain nay da duoc lien ket.' });
    }
    const newStore = {
      id: state.autoStoreId++,
      store_name: String(store_name).trim(),
      mysapo_domain: domain,
      api_key: String(api_key).trim(),
      api_secret_encrypted: encryptSecret(String(api_secret).trim()),
      credentials_saved_at: new Date().toISOString(),
      is_active: 1,
      created_at: new Date().toISOString()
    };
    state.stores.unshift(newStore);
    await saveStoresState(state);
    return json(201, { success: true, data: publicStore(newStore), message: 'Da lien ket cua hang.' });
  }
  const id = Number(parts[0]);
  const store = state.stores.find(item => item.id === id);
  if (!store) return json(404, { success: false, message: 'Store not found' });
  if (method === 'PUT') {
    const { store_name, mysapo_domain, api_key, api_secret } = body || {};
    const domain = cleanDomain(mysapo_domain);
    if (!store_name || !domain || !api_key) return json(400, { success: false, message: 'Vui long dien day du thong tin.' });
    if (state.stores.some(item => item.id !== id && cleanDomain(item.mysapo_domain) === domain)) {
      return json(409, { success: false, message: 'Mysapo Domain nay da thuoc cua hang khac.' });
    }
    store.store_name = String(store_name).trim();
    store.mysapo_domain = domain;
    store.api_key = String(api_key).trim();
    if (api_secret) {
      store.api_secret_encrypted = encryptSecret(String(api_secret).trim());
      store.credentials_saved_at = new Date().toISOString();
    }
    await saveStoresState(state);
    return json(200, { success: true, message: 'Da cap nhat store.' });
  }
  if (method === 'DELETE') {
    state.stores = state.stores.filter(item => item.id !== id);
    await saveStoresState(state);
    return json(200, { success: true, message: 'Da xoa store.' });
  }
  if (method === 'POST' && parts[1] === 'test') {
    return json(200, await testSapoConnection(store));
  }
  if (method === 'POST' && parts[1] === 'sync') {
    const result = await syncSapoOrders(state, store, body?.datePreset || 'TODAY');
    await saveState(state);
    return json(200, result);
  }
  return json(404, { success: false, message: 'Not found' });
}

function parseSapoOrder(order) {
  const addr = order.shipping_address || order.billing_address || {};
  return {
    order_id: order.name || (order.order_number ? `#${order.order_number}` : String(order.id || '')),
    customer_name: addr.name || `${addr.first_name || ''} ${addr.last_name || ''}`.trim() || order.customer?.name || '',
    phone: addr.phone || order.phone || '',
    email: order.email || '',
    total_price: order.total_price || order.total || null
  };
}

function sapoOrderClientIp(order) {
  const value = order?.client_details?.browser_ip || order?.browser_ip || order?.client_ip || '';
  const normalized = String(value || '').trim();
  return isKnownIp(normalized) ? normalized : 'unknown';
}

function normalizeContact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sameContact(left, right) {
  if (!left || !right) return false;
  if (left === right) return true;
  // Phone numbers can differ only by the Vietnamese country prefix (0 / 84).
  return left.length >= 9 && right.length >= 9 && left.slice(-9) === right.slice(-9);
}

function orderInfoFromLog(log) {
  return safeJsonParse(log.order_info, null) || {};
}

function isSameOrder(log, orderInfo) {
  const logged = orderInfoFromLog(log);
  return Boolean(logged.order_id && orderInfo.order_id && String(logged.order_id) === String(orderInfo.order_id));
}

function findTrackedVisitForOrder(state, storeId, orderInfo, orderCreatedAt, orderClientIp) {
  const orderTime = new Date(orderCreatedAt).getTime();
  if (!Number.isFinite(orderTime)) return null;
  const orderPhone = normalizeContact(orderInfo?.phone);
  const orderEmail = normalizeContact(orderInfo?.email);
  const orderIp = isKnownIp(orderClientIp) ? orderClientIp : null;

  // Filter candidate browsing logs from tracker (not sapo_sync) within 24h prior to order creation
  const candidates = state.logs.filter(log => {
    if (log.store_id !== storeId || log.trigger_event === 'sapo_sync') return false;
    const logTime = new Date(log.created_at).getTime();
    if (!Number.isFinite(logTime) || logTime > orderTime + 5 * 60 * 1000 || orderTime - logTime > 24 * 60 * 60 * 1000) return false;
    return true;
  });

  // Priority 1: Match by Phone or Email if captured in log
  if (orderPhone || orderEmail) {
    const contactMatch = candidates.find(log => {
      const captured = orderInfoFromLog(log);
      const capturedPhone = normalizeContact(captured?.phone);
      const capturedEmail = normalizeContact(captured?.email);
      return (orderPhone && sameContact(capturedPhone, orderPhone)) ||
             (orderEmail && Boolean(capturedEmail && capturedEmail === orderEmail));
    });
    if (contactMatch) return contactMatch;
  }

  // Priority 2: Match by IP address (client_ip or webrtc_ip matching orderIp)
  if (orderIp) {
    const ipMatch = candidates.find(log => log.client_ip === orderIp || log.webrtc_ip === orderIp);
    if (ipMatch) return ipMatch;
  }

  // Priority 3: Match by recent session log in the store within 2 hours
  const recentMatch = candidates.find(log => {
    const logTime = new Date(log.created_at).getTime();
    return orderTime - logTime <= 2 * 60 * 60 * 1000;
  });
  if (recentMatch) return recentMatch;

  return null;
}

function sessionDurationToOrder(sessionStartAt, orderCreatedAt) {
  if (!sessionStartAt || !orderCreatedAt) return null;
  const start = new Date(sessionStartAt).getTime();
  const end = new Date(orderCreatedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return seconds <= 24 * 60 * 60 ? seconds : null;
}

function applySyncedOrder(log, orderInfo, orderCreatedAt) {
  log.order_info = JSON.stringify(orderInfo);
  log.created_at = new Date(orderCreatedAt).toISOString();
  if (log.session_start_at) {
    log.session_duration_sec = sessionDurationToOrder(log.session_start_at, orderCreatedAt);
  }
}

async function applyIpAnalysis(log, clientIp, webrtcIp, extraReasons = []) {
  const analysis = await analyzeRisk(clientIp, webrtcIp);
  log.client_ip = isKnownIp(clientIp) ? clientIp : 'unknown';
  log.webrtc_ip = isKnownIp(webrtcIp) ? webrtcIp : null;
  log.country = analysis.ipData.country || 'Unknown';
  log.country_code = analysis.ipData.countryCode || 'XX';
  log.city = analysis.ipData.city || 'Unknown';
  log.isp = analysis.ipData.isp || 'Unknown';
  log.org = analysis.ipData.org || 'Unknown';
  log.is_vpn = analysis.isVpn;
  log.is_datacenter = analysis.isDatacenter;
  log.webrtc_mismatch = analysis.webrtcMismatch;
  log.risk_level = analysis.riskLevel;
  log.risk_reasons = JSON.stringify([...analysis.riskReasons, ...extraReasons]);
}

function sapoAuthHeaders(store, secret) {
  const auth = Buffer.from(`${store.api_key}:${secret}`).toString('base64');
  return {
    Authorization: `Basic ${auth}`,
    'X-Sapo-Access-Token': secret,
    'X-Bizweb-Access-Token': secret,
    Accept: 'application/json',
    'User-Agent': 'Sapo-IP-Guard/1.0'
  };
}

async function sapoFetchJson(store, secret, path) {
  const url = `https://${store.mysapo_domain}${path}`;
  const res = await fetch(url, { headers: sapoAuthHeaders(store, secret) });
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  return { res, data };
}

function sapoAuthErrorMessage(status) {
  if (status === 401) {
    return 'Sapo tu choi xac thuc (401). API Key/API Secret khong dung, khong thuoc store nay, hoac khong phai cap Private App dang hoat dong.';
  }
  if (status === 403) {
    return 'Sapo da xac thuc app nhung chua cap quyen doc don hang (403). Hay vao Private App va bat quyen doc Orders.';
  }
  return `Sapo API error ${status}`;
}

function sapoCreatedOnMin(datePreset) {
  if (datePreset === 'ALL') return null;
  let daysAgo = 0;
  if (datePreset === '7_DAYS') daysAgo = 6;
  if (datePreset === '30_DAYS') daysAgo = 29;

  const now = new Date();
  const vnTime = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  const vnDateStr = vnTime.toISOString().slice(0, 10);
  const vnStartUtcMs = new Date(`${vnDateStr}T00:00:00.000Z`).getTime() - (7 * 60 * 60 * 1000) - (daysAgo * 24 * 60 * 60 * 1000);
  return new Date(vnStartUtcMs).toISOString();
}

async function testSapoConnection(store) {
  const secret = decryptSecret(store.api_secret_encrypted);
  if (!secret) throw new Error('Missing Sapo API secret.');
  const storeCheck = await sapoFetchJson(store, secret, '/admin/store.json');
  if (!storeCheck.res.ok) {
    throw new Error(sapoAuthErrorMessage(storeCheck.res.status));
  }
  const orderCheck = await sapoFetchJson(store, secret, '/admin/orders/count.json?status=any');
  if (!orderCheck.res.ok) {
    if (orderCheck.res.status === 401 || orderCheck.res.status === 403) {
      throw new Error('Da xac thuc duoc store Sapo, nhung app chua doc duoc don hang. Hay kiem tra quyen Orders/Don hang trong Private App roi luu lai.');
    }
    throw new Error(sapoAuthErrorMessage(orderCheck.res.status));
  }
  const count = Number(orderCheck.data?.count ?? orderCheck.data?.orders_count ?? 0);
  return { success: true, message: `Ket noi Sapo thanh cong. API doc duoc don hang (${count} don).`, order_count: count };
}

async function syncSapoOrders(state, store, datePreset) {
  const syncStartTime = Date.now();
  const secret = decryptSecret(store.api_secret_encrypted);
  if (!secret) throw new Error('Missing Sapo API secret.');
  const since = sapoCreatedOnMin(datePreset);
  const ipCache = new Map();
  let total = 0;
  let synced = 0;
  let queryParam = 'created_on_min';

  for (let page = 1; page <= 10; page++) {
    if (Date.now() - syncStartTime > 13500) break;

    const minParam = since ? `&${queryParam}=${encodeURIComponent(since)}` : '';
    let path = `/admin/orders.json?limit=250&page=${page}${minParam}`;
    let { res, data } = await sapoFetchJson(store, secret, path);

    if (page === 1 && (!res.ok || !data?.orders?.length)) {
      const altParam = queryParam === 'created_on_min' ? 'created_at_min' : 'created_on_min';
      const altMinParam = since ? `&${altParam}=${encodeURIComponent(since)}` : '';
      const altPath = `/admin/orders.json?limit=250&page=1${altMinParam}`;
      const altResult = await sapoFetchJson(store, secret, altPath);
      if (altResult.res.ok && altResult.data?.orders?.length) {
        res = altResult.res;
        data = altResult.data;
        queryParam = altParam;
      }
    }

    if (!res.ok) {
      if (page === 1) {
        throw new Error(sapoAuthErrorMessage(res.status));
      }
      break;
    }
    const orders = data?.orders || [];
    if (!orders.length) break;
    total += orders.length;

    for (const order of orders) {
      if (Date.now() - syncStartTime > 14000) break;
      const orderInfo = parseSapoOrder(order);
      if (!orderInfo.order_id) continue;
      const createdAt = order.created_on || order.created_at || new Date().toISOString();
      const orderClientIp = sapoOrderClientIp(order);
      const existing = state.logs.find(log => log.store_id === store.id && isSameOrder(log, orderInfo));
      const trackedVisit = existing || findTrackedVisitForOrder(state, store.id, orderInfo, createdAt, orderClientIp);

      if (trackedVisit) {
        applySyncedOrder(trackedVisit, orderInfo, createdAt);
        const effectiveClientIp = isKnownIp(orderClientIp) ? orderClientIp : trackedVisit.client_ip;
        const analysis = await analyzeRisk(effectiveClientIp, trackedVisit.webrtc_ip, ipCache, state.logs);
        trackedVisit.client_ip = effectiveClientIp;
        trackedVisit.country = analysis.ipData.country || 'Unknown';
        trackedVisit.country_code = analysis.ipData.countryCode || 'XX';
        trackedVisit.city = analysis.ipData.city || 'Unknown';
        trackedVisit.isp = analysis.ipData.isp || 'Unknown';
        trackedVisit.org = analysis.ipData.org || 'Unknown';
        trackedVisit.is_vpn = analysis.isVpn;
        trackedVisit.is_datacenter = analysis.isDatacenter;
        trackedVisit.webrtc_mismatch = analysis.webrtcMismatch;
        trackedVisit.risk_level = analysis.riskLevel;
      } else {
        const analysis = await analyzeRisk(orderClientIp, null, ipCache, state.logs);
        state.logs.unshift({
          id: state.autoLogId++,
          store_id: store.id,
          store_domain: store.mysapo_domain,
          client_ip: isKnownIp(orderClientIp) ? orderClientIp : 'unknown',
          webrtc_ip: null,
          user_agent: 'Sapo API Sync',
          fingerprint: 'FP-SAPO-SYNCED',
          order_info: JSON.stringify(orderInfo),
          country: analysis.ipData.country || 'Unknown',
          country_code: analysis.ipData.countryCode || 'XX',
          city: analysis.ipData.city || 'Unknown',
          isp: analysis.ipData.isp || 'Unknown',
          org: analysis.ipData.org || 'Unknown',
          is_vpn: analysis.isVpn,
          is_datacenter: analysis.isDatacenter,
          webrtc_mismatch: false,
          risk_level: analysis.riskLevel,
          risk_reasons: JSON.stringify([...analysis.riskReasons, 'Synced from Sapo Admin API']),
          trigger_event: 'sapo_sync',
          session_id: null,
          session_start_at: null,
          session_duration_sec: null,
          created_at: new Date(createdAt).toISOString()
        });
        synced++;
      }
    }
    if (orders.length < 250) break;
  }

  // Fast backfill pass for missing WebRTC / session_duration / GeoIP correction
  for (const log of state.logs) {
    if (log.client_ip && isKnownIp(log.client_ip) && (log.country === 'Vietnam' || log.country === 'Unknown')) {
      const fresh = await lookupIp(log.client_ip);
      if (fresh && fresh.country && fresh.country !== 'Vietnam' && fresh.country !== 'Unknown') {
        log.country = fresh.country;
        log.country_code = fresh.countryCode || 'XX';
        log.city = fresh.city || 'Unknown';
        log.isp = fresh.isp || 'Unknown';
        log.org = fresh.org || 'Unknown';
        log.is_vpn = fresh.proxy;
        log.is_datacenter = fresh.hosting;
        log.risk_level = (fresh.proxy || fresh.hosting) ? 'HIGH_RISK' : log.risk_level;
      }
    }
    if (log.store_id === store.id && hasOrderInfo(log.order_info)) {
      const ordInfo = safeJsonParse(log.order_info, null);
      if (!ordInfo) continue;
      if (!isKnownIp(log.webrtc_ip)) {
        const match = findTrackedVisitForOrder(state, store.id, ordInfo, log.created_at, log.client_ip);
        if (match && isKnownIp(match.webrtc_ip)) {
          log.webrtc_ip = match.webrtc_ip;
          log.webrtc_mismatch = Boolean(log.client_ip && log.webrtc_ip && log.webrtc_ip !== log.client_ip);
          if (!log.session_start_at && match.session_start_at) {
            log.session_start_at = match.session_start_at;
            log.session_duration_sec = sessionDurationToOrder(match.session_start_at, log.created_at);
          }
        }
      }
      if (log.session_duration_sec === null && log.session_start_at) {
        log.session_duration_sec = sessionDurationToOrder(log.session_start_at, log.created_at);
      }
    }
  }

  return { success: true, total_orders: total, synced_new: synced };
}

async function handleLogs(event, state, method, parts, query, body) {
  if (method === 'POST' && parts[0] === 'collect') {
    const referer = event.headers.referer || event.headers.origin || body?.url || '';
    let matched = null;
    if (body?.api_key) matched = state.stores.find(store => store.api_key === body.api_key);
    if (!matched && (referer || body?.store_domain)) {
      const targetStr = (referer + ' ' + (body?.store_domain || '')).toLowerCase();
      matched = state.stores.find(store => targetStr.includes(cleanDomain(store.mysapo_domain)));
      if (!matched) {
        matched = state.stores.find(store => {
          const prefix = cleanDomain(store.mysapo_domain).split('.')[0].replace(/-/g, '');
          const cleanRef = targetStr.replace(/[^a-z0-9]/g, '');
          return cleanRef.includes(prefix);
        });
      }
    }
    if (!matched && state.stores.length === 1) {
      matched = state.stores[0];
    }
    if (!matched) return json(403, { success: false, message: 'Tracker origin is not a connected Sapo store.' });
    const realClientIp = getClientIp(event, body?.client_ip);
    if (!allowCollection(realClientIp)) return json(429, { success: false, message: 'Too many tracking events.' });
    const analysis = await analyzeRisk(realClientIp, body?.webrtc_ip);
    const blacklistCheck = state.blacklist.find(item => item.ip === realClientIp || (body?.webrtc_ip && item.ip === body.webrtc_ip));
    const reasons = [...analysis.riskReasons];
    let riskLevel = analysis.riskLevel;
    if (blacklistCheck) {
      riskLevel = 'HIGH_RISK';
      reasons.push(`IP is blacklisted: ${blacklistCheck.reason || 'Manual block'}`);
    }
    if (body?.trigger_event === 'page_exit' && body?.connection_status === 'inactive' && body?.session_id) {
      const latestSessionLog = state.logs.find(log => log.store_id === matched.id && log.session_id === body.session_id);
      if (latestSessionLog) {
        latestSessionLog.connection_status = 'inactive';
        latestSessionLog.left_at = new Date().toISOString();
        await saveState(state);
        return json(200, { success: true, log_id: latestSessionLog.id, client_ip: realClientIp, is_blacklisted: Boolean(blacklistCheck), updated: 'session_inactive' });
      }
    }
    const log = {
      id: state.autoLogId++,
      store_id: matched.id,
      store_domain: matched.mysapo_domain,
      client_ip: realClientIp,
      webrtc_ip: body?.webrtc_ip || null,
      webrtc_status: body?.webrtc_status || (body?.webrtc_ip ? 'captured' : 'unknown'),
      user_agent: body?.user_agent || null,
      fingerprint: body?.fingerprint || null,
      order_info: body?.order_info ? (typeof body.order_info === 'object' ? JSON.stringify(body.order_info) : String(body.order_info)) : null,
      country: analysis.ipData.country || 'Unknown',
      country_code: analysis.ipData.countryCode || 'XX',
      city: analysis.ipData.city || 'Unknown',
      isp: analysis.ipData.isp || 'Unknown',
      org: analysis.ipData.org || 'Unknown',
      is_vpn: analysis.isVpn,
      is_datacenter: analysis.isDatacenter,
      webrtc_mismatch: analysis.webrtcMismatch,
      risk_level: riskLevel,
      risk_reasons: JSON.stringify(reasons),
      url: body?.url || referer || null,
      trigger_event: body?.trigger_event || null,
      last_clicked_url: body?.last_clicked_url || body?.url || referer || null,
      device_type: body?.device_type || 'Unknown',
      connection_status: body?.connection_status === 'inactive' ? 'inactive' : 'active',
      session_id: body?.session_id || null,
      session_start_at: body?.session_start_at || null,
      session_duration_sec: body?.session_duration || null,
      created_at: new Date().toISOString()
    };
    state.logs.unshift(log);
    await saveState(state);
    return json(201, { success: true, log_id: log.id, client_ip: realClientIp, risk_level: riskLevel, is_blacklisted: Boolean(blacklistCheck), reasons });
  }
  if (method === 'GET' && parts.length === 0) {
    if (state.logs.length === 0 && state.stores.length > 0) {
      for (const st of state.stores) {
        try {
          await syncSapoOrders(state, st, '30_DAYS');
        } catch (_) {}
      }
    }
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(20, Math.max(1, Number(query.limit || 20)));
    const filtered = filterLogs(state.logs, query);
    const orderTotal = filterLogs(state.logs, { ...query, orders_only: 'true' }).length;
    const allTotal = filterLogs(state.logs, { ...query, orders_only: 'false' }).length;
    const rows = filtered.slice((page - 1) * limit, page * limit).map(row => decorateLog(row, state));
    return json(200, {
      success: true,
      data: rows,
      pagination: {
        page,
        limit,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / limit),
        orderTotal,
        allTotal
      }
    });
  }
  if (method === 'DELETE' && parts[0]) {
    const id = Number(parts[0]);
    const before = state.logs.length;
    state.logs = state.logs.filter(row => row.id !== id);
    await saveState(state);
    return before === state.logs.length ? json(404, { success: false, message: 'Log not found' }) : json(200, { success: true, message: 'Log deleted' });
  }
  return json(404, { success: false, message: 'Not found' });
}

async function handleBlacklist(event, state, method, parts, query, body) {
  if (method === 'GET' && parts[0] === 'check') {
    const ip = query.ip || getClientIp(event);
    const webrtcIp = query.webrtc_ip || null;
    const row = state.blacklist.find(item => item.ip === ip || (webrtcIp && item.ip === webrtcIp));
    return json(200, { success: true, ip, webrtc_ip: webrtcIp, is_blacklisted: Boolean(row), reason: row?.reason || null, created_at: row?.created_at || null });
  }
  if (!assertAdmin(event)) return unauthorized();
  if (method === 'GET' && parts.length === 0) return json(200, { success: true, data: state.blacklist });
  if (method === 'POST' && parts.length === 0) {
    const ip = String(body?.ip || '').trim();
    if (!ip) return json(400, { success: false, message: 'IP address is required' });
    const existing = state.blacklist.find(item => item.ip === ip);
    if (existing) {
      existing.reason = body?.reason || 'Manual block';
      existing.source = body?.source || 'MANUAL';
      existing.created_at = new Date().toISOString();
    } else {
      state.blacklist.unshift({ id: state.autoBlacklistId++, ip, reason: body?.reason || 'Manual block', source: body?.source || 'MANUAL', created_at: new Date().toISOString() });
    }
    state.logs.forEach(log => { if (log.client_ip === ip || log.webrtc_ip === ip) log.risk_level = 'HIGH_RISK'; });
    await saveState(state);
    return json(201, { success: true, message: `IP ${ip} blocked` });
  }
  if (method === 'DELETE' && parts[0]) {
    const ip = decodeURIComponent(parts[0]);
    const before = state.blacklist.length;
    state.blacklist = state.blacklist.filter(item => item.ip !== ip);
    await saveState(state);
    return json(200, {
      success: true,
      already_unblocked: before === state.blacklist.length,
      message: before === state.blacklist.length ? `IP ${ip} was already unblocked` : `IP ${ip} unblocked`
    });
  }
  return json(404, { success: false, message: 'Not found' });
}

function handleStats(event, state, method, parts, query) {
  if (!assertAdmin(event)) return unauthorized();
  const storeId = query.store_id && query.store_id !== 'ALL' ? Number(query.store_id) : null;
  let logs = storeId ? state.logs.filter(log => log.store_id === storeId) : [...state.logs];
  if (method === 'GET' && parts[0] === 'overview') {
    const totalLogs = logs.length;
    const highRiskCount = logs.filter(log => log.risk_level === 'HIGH_RISK').length;
    const cleanCount = totalLogs - highRiskCount;
    const today = businessDate();
    const suspiciousOrdersToday = logs.filter(log => log.risk_level === 'HIGH_RISK' && hasOrderInfo(log.order_info) && log.created_at && businessDate(log.created_at) === today).length;
    const ispMap = {};
    logs.filter(log => log.risk_level === 'HIGH_RISK' && log.isp && log.isp !== 'Unknown').forEach(log => { ispMap[log.isp] = (ispMap[log.isp] || 0) + 1; });
    const topIsps = Object.keys(ispMap).map(isp => ({ isp, count: ispMap[isp] })).sort((a, b) => b.count - a.count).slice(0, 5);
    return json(200, { success: true, data: { totalLogs, highRiskCount, cleanCount, vpnRate: totalLogs ? Number(((highRiskCount / totalLogs) * 100).toFixed(1)) : 0, totalBlacklisted: state.blacklist.length, suspiciousOrdersToday, topIsps } });
  }
  if (method === 'GET' && parts[0] === 'chart') {
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIME_ZONE, hour: '2-digit', hourCycle: 'h23' });
    const now = Date.now();
    const buckets = Array.from({ length: 24 }, (_, hour) => ({ time_label: `${String(hour).padStart(2, '0')}:00`, clean: 0, high_risk: 0 }));
    logs.forEach(log => {
      const ts = new Date(log.created_at).getTime();
      if (!Number.isFinite(ts) || now - ts > 24 * 60 * 60 * 1000 || ts > now) return;
      const hour = Number(formatter.format(new Date(ts)));
      if (log.risk_level === 'HIGH_RISK') buckets[hour].high_risk += 1;
      else buckets[hour].clean += 1;
    });
    return json(200, { success: true, data: buckets });
  }
  return json(404, { success: false, message: 'Not found' });
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod === 'OPTIONS') return response(204, '');

    const rawPath = event.path.replace(/^\/\.netlify\/functions\/api/, '');
    if (rawPath === '/health') {
      return json(200, { status: 'OK', system: 'Sapo IP Guard Netlify API', timestamp: new Date().toISOString() });
    }

    const state = await loadState();

    if (rawPath === '/client-tracker.js') {
      const blacklist = state.blacklist.map(item => item.ip).filter(Boolean);
      return response(200, `window.__SAPO_IP_GUARD_BLACKLIST = ${JSON.stringify(blacklist)};\n${TRACKER_SOURCE}`, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate'
      });
    }

    const apiPath = rawPath.replace(/^\/api\/v1\/?/, '');
    const parts = apiPath.split('/').filter(Boolean).map(decodeURIComponent);
    const resource = parts.shift();
    const body = event.body ? JSON.parse(event.body) : {};
    const query = event.queryStringParameters || {};
    const method = event.httpMethod;

    if (resource === 'stores') return await handleStores(event, state, method, parts, body);
    if (resource === 'logs') return await handleLogs(event, state, method, parts, query, body);
    if (resource === 'blacklist') return await handleBlacklist(event, state, method, parts, query, body);
    if (resource === 'stats') return handleStats(event, state, method, parts, query);

    return json(404, { success: false, message: 'Not found' });
  } catch (error) {
    return json(500, { success: false, message: error.message });
  }
};
