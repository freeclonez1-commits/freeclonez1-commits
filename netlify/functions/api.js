const crypto = require('crypto');
const zlib = require('zlib');

const DEFAULT_STATE_KEY = 'default';
const BUSINESS_TIME_ZONE = process.env.BUSINESS_TIME_ZONE || 'Asia/Ho_Chi_Minh';
const COLLECT_WINDOW_MS = 60 * 1000;
const COLLECT_MAX_PER_WINDOW = 30;
const collectCounters = new Map();
const syncLocks = new Map();
const ipIntelligenceCache = new Map();
const COMPRESSED_LOGS_ENCODING = 'gzip-base64-v1';
const LOG_COMPRESSION_THRESHOLD_BYTES = 16 * 1024;
const IP_INTELLIGENCE_VERSION = 3;
const IP_INTELLIGENCE_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const SYNC_LOOKBACK_MS = 5 * 60 * 1000;
const SYNC_HISTORY_LIMIT = 40;
const FULL_SYNC_RECONCILIATION_MS = 10 * 60 * 1000;
const BOOTSTRAP_DASHBOARD_PASSWORD_HASH = '5614f8701b76755fca46a29799ae4122ca791e6339afb80e45e9da52c4ea6474';
const DATACENTER_PROVIDER_WORDS = [
  'gthost', 'm247', 'vultr', 'digitalocean', 'linode', 'hetzner', 'ovh',
  'aws', 'amazon', 'google cloud', 'azure', 'vpn', 'proxy', 'datacenter',
  'datacamp', 'cdnext', 'cyberzone', 'cyberzon'
];

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
  var INITIAL_BLOCK = window.__SAPO_IP_GUARD_INITIAL_BLOCK || null;
  var cachedPublicIp = null;
  var cachedWebRtcIp = null;
  var cachedWebRtcStatus = 'pending';
  var networkHydrateStarted = false;
  var webRtcDiscoveryInFlight = false;
  var webRtcCallbacks = [];
  var lastNetworkIdentitySignature = '';
  var forceNetworkIdentityPush = false;
  var NETWORK_CHECK_INTERVAL_MS = 15000;
  var WEBRTC_DISCOVERY_TIMEOUT_MS = 5000;

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
    var fallbackStarted = false;
    var finish = function (ip) {
      if (resolved) return;
      resolved = true;
      if (ip) cachedPublicIp = ip;
      callback(ip || null);
    };
    var fetchIpify = function () {
      if (resolved || fallbackStarted) return;
      fallbackStarted = true;
      var timer = setTimeout(function () { finish(null); }, 1000);
      fetch('https://api.ipify.org?format=json', { cache: 'no-store' })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          clearTimeout(timer);
          finish(data && data.ip ? data.ip : null);
        })
        .catch(function () {
          clearTimeout(timer);
          finish(null);
        });
    };

    // Use the same Vercel edge that receives tracking events. This is both
    // faster and more representative than a third-party IP lookup.
    var edgeTimer = setTimeout(fetchIpify, 900);
    fetch(BACKEND_URL + '/api/v1/blacklist/check?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        clearTimeout(edgeTimer);
        if (data && data.ip) finish(data.ip);
        else fetchIpify();
      })
      .catch(function () {
        clearTimeout(edgeTimer);
        fetchIpify();
      });
  }

  function getWebRTCIP(callback, force) {
    if (!force && cachedWebRtcStatus !== 'pending') {
      callback(cachedWebRtcIp);
      return;
    }
    webRtcCallbacks.push(callback);
    if (webRtcDiscoveryInFlight) return;
    webRtcDiscoveryInFlight = true;

    var webrtcIp = null;
    var resolved = false;
    var candidateSeen = false;
    var privateCandidateSeen = false;
    var complete = function (value, status) {
      if (resolved) return;
      resolved = true;
      webRtcDiscoveryInFlight = false;
      cachedWebRtcIp = value || null;
      cachedWebRtcStatus = status || (value ? 'captured' : 'not_available');
      var callbacks = webRtcCallbacks.splice(0, webRtcCallbacks.length);
      callbacks.forEach(function (fn) { try { fn(cachedWebRtcIp); } catch (e) {} });
    };
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;
    if (!RTCPeerConnection) {
      complete(null, 'unsupported');
      return;
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
        var status = value ? 'captured' : (privateCandidateSeen ? 'private_only' : (candidateSeen ? 'hidden' : 'not_available'));
        try { pc.close(); } catch (e) {}
        complete(value || null, status);
      };
      var isUsablePublicIp = function (ip) {
        var value = String(ip || '').trim().replace(/^\\[|\\]$/g, '').split('%')[0].toLowerCase();
        if (!value || value === '0.0.0.0' || value === '127.0.0.1') return false;

        // WebRTC can expose a global IPv6 server-reflexive address. The older
        // IPv4-only parser silently discarded it, leaving valid checks empty.
        if (value.indexOf(':') >= 0) {
          if (!/^[0-9a-f:.]+$/.test(value)) return false;
          if (value.indexOf('::ffff:') === 0) return isUsablePublicIp(value.slice(7));
          if (value === '::' || value === '::1' || /^fe[89ab]/.test(value) || /^f[cd]/.test(value) || /^ff/.test(value)) {
            privateCandidateSeen = true;
            return false;
          }
          return (value.match(/:/g) || []).length >= 2;
        }

        var p = value.split('.').map(function (n) { return parseInt(n, 10); });
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
      setTimeout(function () { if (!webrtcIp) finish(null); }, WEBRTC_DISCOVERY_TIMEOUT_MS);
    } catch (err) {
      complete(null, 'error');
    }
  }

  function hydrateNetworkIdentity(force, knownPublicIp) {
    if (networkHydrateStarted) return;
    if (!force && cachedWebRtcStatus !== 'pending') return;
    networkHydrateStarted = true;
    var trustedPublicIp = typeof knownPublicIp === 'string' ? knownPublicIp : null;
    var publicIpReady = Boolean(trustedPublicIp);
    var webRtcReady = false;
    var finishHydration = function () {
      if (!publicIpReady || !webRtcReady) return;
      networkHydrateStarted = false;
      sendNetworkIdentity();
    };
    if (trustedPublicIp) {
      cachedPublicIp = trustedPublicIp;
    } else {
      getClientPublicIP(function (ip) {
        cachedPublicIp = ip || cachedPublicIp;
        publicIpReady = true;
        finishHydration();
      });
    }
    getWebRTCIP(function () {
      webRtcReady = true;
      finishHydration();
    }, Boolean(force));
  }

  function refreshNetworkIdentity(knownPublicIp) {
    if (networkHydrateStarted || document.hidden) return;
    var trustedPublicIp = typeof knownPublicIp === 'string' ? knownPublicIp : null;
    if (trustedPublicIp) cachedPublicIp = trustedPublicIp;
    forceNetworkIdentityPush = true;
    hydrateNetworkIdentity(true, trustedPublicIp);
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
    var path = (window.location.pathname || '').toLowerCase();
    var isCheckoutPage = path.indexOf('/checkouts') !== -1 || path.indexOf('/thank') !== -1 || path.indexOf('/orders/') !== -1;
    if (!info.order_id && isCheckoutPage) {
      var orderCodeEl = document.querySelector('.order-number, .thankyou-order-id, #order_code, .order-code, [data-order-name], .os-order-number');
      if (orderCodeEl) {
        var text = orderCodeEl.innerText.trim();
        if (text) info.order_id = text.startsWith('#') ? text : '#' + text;
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

  function buildCollectionPayload(orderInfo, triggerEvent, clickedUrl, sessionMeta) {
    var meta = sessionMeta || getSessionMeta();
    var currentUrl = window.location.href;
    return {
      client_ip: cachedPublicIp,
      api_key: API_KEY,
      webrtc_ip: cachedWebRtcIp,
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
      session_id: meta.session_id,
      session_start_at: meta.session_start_at,
      session_duration: meta.session_duration_sec
    };
  }

  function sendCollection(payload, preferBeacon) {
    var body = JSON.stringify(payload);
    if (preferBeacon && navigator.sendBeacon) {
      try {
        if (navigator.sendBeacon(BACKEND_URL + '/api/v1/logs/collect', new Blob([body], { type: 'text/plain' }))) return;
      } catch (e) {}
    }
    fetch(BACKEND_URL + '/api/v1/logs/collect', {
      method: 'POST',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: body
    }).then(function (res) { return res.json(); }).then(function (data) {
      if (data && data.is_blacklisted) renderAccessDeniedScreen(data.client_ip || cachedPublicIp);
    }).catch(function () {});
  }

  function sendNetworkIdentity() {
    if (cachedWebRtcStatus === 'pending') return;
    var meta = getSessionMeta();
    var signature = [meta.session_id, cachedPublicIp || '', cachedWebRtcIp || '', cachedWebRtcStatus].join('|');
    var forcePush = forceNetworkIdentityPush;
    forceNetworkIdentityPush = false;
    if (signature === lastNetworkIdentitySignature && !forcePush) return;
    lastNetworkIdentitySignature = signature;
    sendCollection(buildCollectionPayload(null, 'network_identity', window.location.href, meta));
  }

  function pushLog(orderInfo, triggerEvent, clickedUrl) {
    var now = Date.now();
    var currentUrl = window.location.href;
    if (triggerEvent === 'page_view' && !orderInfo && currentUrl === lastPushedUrl && (now - lastPushedTime < 10000)) return;
    lastPushedUrl = currentUrl;
    lastPushedTime = now;
    // Checkout can navigate away immediately. Persist the event first; network
    // identity is merged into this session once WebRTC discovery finishes.
    sendCollection(buildCollectionPayload(orderInfo, triggerEvent, clickedUrl), triggerEvent === 'checkout_submit');
    hydrateNetworkIdentity();
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
    if (INITIAL_BLOCK && INITIAL_BLOCK.is_blacklisted) {
      renderAccessDeniedScreen(INITIAL_BLOCK.ip);
      return;
    }

    // The API reads the visitor address from the edge request. This check runs
    // immediately and also detects VPN/network changes without another request.
    var query = cachedWebRtcIp ? '?webrtc_ip=' + encodeURIComponent(cachedWebRtcIp) : '';
    fetch(BACKEND_URL + '/api/v1/blacklist/check' + query, { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res) return;
        if (res.is_blacklisted) {
          renderAccessDeniedScreen(res.webrtc_ip || res.ip);
          return;
        }
        if (res.ip && cachedPublicIp && res.ip !== cachedPublicIp) {
          refreshNetworkIdentity(res.ip);
        } else if (res.ip) {
          cachedPublicIp = res.ip;
        }
      })
      .catch(function () {});
  }

  function initTracking() {
    if (INITIAL_BLOCK && INITIAL_BLOCK.is_blacklisted) {
      renderAccessDeniedScreen(INITIAL_BLOCK.ip);
      return;
    }
    hydrateNetworkIdentity();
    checkBlacklistImmediately();
    pushLog(null, 'page_view');
    attachFormSubmitListeners();
    attachCheckoutActivityListeners();
    attachClickListeners();
    setInterval(attachFormSubmitListeners, 3000);
    setInterval(attachCheckoutActivityListeners, 3000);
    setInterval(checkBlacklistImmediately, NETWORK_CHECK_INTERVAL_MS);
    if (navigator.connection && navigator.connection.addEventListener) {
      navigator.connection.addEventListener('change', refreshNetworkIdentity);
    }
    window.addEventListener('online', refreshNetworkIdentity);
    window.addEventListener('focus', refreshNetworkIdentity);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) refreshNetworkIdentity();
    });
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
  return response(statusCode, body, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
}

function unauthorized(message = 'Dashboard password is invalid.') {
  return json(401, { success: false, message });
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function assertAdmin(event) {
  const headers = event.headers || {};
  const authorization = headers.authorization || headers.Authorization || '';
  const suppliedPassword = headers['x-sapo-admin-key'] || headers['X-Sapo-Admin-Key'] || String(authorization).replace(/^Bearer\s+/i, '');
  if (!suppliedPassword) return false;

  const configuredHash = process.env.DASHBOARD_PASSWORD_HASH || '';
  const configuredPassword = process.env.DASHBOARD_PASSWORD || '';
  const expectedHash = configuredHash || (configuredPassword ? sha256(configuredPassword) : BOOTSTRAP_DASHBOARD_PASSWORD_HASH);
  return safeEqual(sha256(suppliedPassword), expectedHash.toLowerCase());
}

function stateTemplate() {
  return {
    stores: [],
    logs: [],
    blacklist: [],
    syncState: { byStore: {}, runs: [] },
    autoStoreId: 1,
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

function unpackLogsValue(value) {
  if (!value || value.encoding !== COMPRESSED_LOGS_ENCODING || !value.data) return value;
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.from(value.data, 'base64')).toString('utf8'));
  } catch (_) {
    throw new Error('Stored logs could not be decompressed.');
  }
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

function isCompressedLogsValue(value) {
  return Boolean(value && value.encoding === COMPRESSED_LOGS_ENCODING && value.data);
}

async function loadState({ includeLogs = true, includeStores = true, includeBlacklist = true, includeSyncState = true } = {}) {
  if (!hasSupabaseConfig()) {
    throw new Error('Persistent storage is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  try {
    const keys = [];
    if (includeLogs) keys.push('logs');
    if (includeStores) keys.push('stores');
    if (includeBlacklist) keys.push('blacklist');
    if (includeSyncState) keys.push('sync_state');
    let rows = await supabaseFetch(`/app_state?key=in.(${keys.map(encodeURIComponent).join(',')})&select=key,value`);
    let logsRow = rows.find(row => row.key === 'logs');
    let defaultRow = null;

    // Older installations keep logs in the legacy default state. Read it only once
    // to migrate, so normal dashboard requests never download that large blob again.
    if (includeLogs && !logsRow?.value) {
      const fallbackRows = await supabaseFetch(`/app_state?key=eq.${encodeURIComponent(DEFAULT_STATE_KEY)}&select=key,value`);
      defaultRow = Array.isArray(fallbackRows) ? fallbackRows.find(row => row.key === DEFAULT_STATE_KEY) : null;
      rows = [...rows, ...(Array.isArray(fallbackRows) ? fallbackRows : [])];
    }

    if (includeLogs && !logsRow?.value && !defaultRow?.value) {
      const initial = stateTemplate();
      await saveState(initial);
      await saveStoresState(initial);
      await saveLogsState(initial);
      await saveBlacklistState(initial);
      await saveSyncState(initial);
      return initial;
    }

    const state = { ...stateTemplate(), ...(defaultRow?.value || {}) };
    if (!includeLogs) state.logs = [];
    if (!includeStores) state.stores = [];
    if (!includeBlacklist) state.blacklist = [];
    if (!includeSyncState) state.syncState = { byStore: {}, runs: [] };

    logsRow = rows.find(row => row.key === 'logs');
    if (includeLogs && logsRow?.value) {
      const logsValue = unpackLogsValue(logsRow.value);
      state.logs = Array.isArray(logsValue?.logs) ? logsValue.logs : state.logs;
      state.autoLogId = Number(logsValue?.autoLogId || state.autoLogId);
      // Migrate the legacy JSON object on the next successful read. This keeps
      // the existing data intact while making future dashboard reads much smaller.
      if (!isCompressedLogsValue(logsRow.value) && Buffer.byteLength(JSON.stringify(logsValue || {}), 'utf8') >= LOG_COMPRESSION_THRESHOLD_BYTES) {
        await saveLogsState(state);
      }
    } else if (includeLogs && defaultRow?.value) {
      // Migrate existing installations once, then keep order-log reads lightweight.
      await saveLogsState(state);
    }

    const storesRow = rows.find(row => row.key === 'stores');
    if (includeStores && storesRow?.value) {
      state.stores = Array.isArray(storesRow.value.stores) ? storesRow.value.stores : state.stores;
      state.autoStoreId = Number(storesRow.value.autoStoreId || state.autoStoreId);
    }
    const blacklistRow = rows.find(row => row.key === 'blacklist');
    if (includeBlacklist && blacklistRow?.value && Array.isArray(blacklistRow.value.blacklist)) {
      state.blacklist = blacklistRow.value.blacklist;
      state.autoBlacklistId = Number(blacklistRow.value.autoBlacklistId || state.autoBlacklistId);
    }
    const syncStateRow = rows.find(row => row.key === 'sync_state');
    if (includeSyncState && syncStateRow?.value) {
      state.syncState = {
        byStore: syncStateRow.value.byStore && typeof syncStateRow.value.byStore === 'object' ? syncStateRow.value.byStore : {},
        runs: Array.isArray(syncStateRow.value.runs) ? syncStateRow.value.runs : []
      };
    }
    return state;
  } catch (e) {
    throw new Error(`Persistent storage is unavailable: ${e.message}`);
  }
}

async function saveStateValue(key, value) {
  if (!hasSupabaseConfig()) throw new Error('Persistent storage is not configured.');
  const payload = { key, value, updated_at: new Date().toISOString() };
  await supabaseFetch('/app_state?on_conflict=key', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(payload)
  });
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

async function saveLogsState(state) {
  await saveStateValue('logs', packLogsValue(state.logs, state.autoLogId));
}

async function saveBlacklistState(state) {
  await saveStateValue('blacklist', {
    blacklist: state.blacklist,
    autoBlacklistId: state.autoBlacklistId
  });
}

async function saveSyncState(state) {
  const syncState = state.syncState || { byStore: {}, runs: [] };
  await saveStateValue('sync_state', {
    byStore: syncState.byStore || {},
    runs: Array.isArray(syncState.runs) ? syncState.runs.slice(0, SYNC_HISTORY_LIMIT) : []
  });
}

function recordSyncRun(state, run) {
  if (!state.syncState || typeof state.syncState !== 'object') {
    state.syncState = { byStore: {}, runs: [] };
  }
  if (!state.syncState.byStore || typeof state.syncState.byStore !== 'object') state.syncState.byStore = {};
  if (!Array.isArray(state.syncState.runs)) state.syncState.runs = [];

  const previous = state.syncState.byStore[String(run.store_id)] || {};
  const summary = {
    store_id: Number(run.store_id),
    status: run.status || 'success',
    mode: run.mode || 'full',
    started_at: run.started_at || new Date().toISOString(),
    finished_at: run.finished_at || new Date().toISOString(),
    total_orders: Number(run.total_orders || 0),
    synced_new: Number(run.synced_new || 0),
    updated_orders: Number(run.updated_orders || 0),
    removed_orders: Number(run.removed_orders || 0),
    message: run.message || null,
    since: run.since || null,
    last_full_at: run.mode === 'full' ? (run.finished_at || new Date().toISOString()) : (previous.last_full_at || null)
  };
  state.syncState.byStore[String(summary.store_id)] = summary;
  state.syncState.runs.unshift(summary);
  state.syncState.runs = state.syncState.runs.slice(0, SYNC_HISTORY_LIMIT);
  return summary;
}

function cleanDomain(domain) {
  return String(domain || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase();
}

function publicStore(store, syncState = null) {
  const { api_secret, api_secret_encrypted, ...safe } = store;
  return {
    ...safe,
    has_api_secret: Boolean(api_secret || api_secret_encrypted),
    credentials_saved_at: store.credentials_saved_at || store.created_at || null,
    sync_status: syncState?.byStore?.[String(store.id)] || null
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
  if (!value || value === 'null' || value === '') return false;
  const parsed = typeof value === 'string' ? safeJsonParse(value, null) : value;
  return Boolean(parsed && parsed.order_id);
}

function safeJsonParse(value, fallback) {
  try { return JSON.parse(value); } catch (_) { return fallback; }
}

function getClientIp(event, fallback) {
  const forwarded = event.headers['x-vercel-forwarded-for'] ||
    event.headers['x-real-ip'] ||
    event.headers['x-forwarded-for'] ||
    event.headers['X-Forwarded-For'];
  // Prefer the address supplied by the hosting edge over a browser-provided value.
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

function hasDatacenterProvider(...values) {
  const text = values.filter(Boolean).join(' ').toLowerCase();
  return DATACENTER_PROVIDER_WORDS.some(word => text.includes(word));
}

function effectiveRiskLevel(row) {
  const detectedRisk = row?.is_vpn || row?.is_datacenter || row?.is_proxy || row?.is_tor || row?.is_abuser || hasDatacenterProvider(row?.isp, row?.org);
  return detectedRisk ? 'HIGH_RISK' : row?.risk_level;
}

function getNextId(state) {
  return state.logs.length > 0 ? Math.max(...state.logs.map(r => Number(r.id) || 0)) + 1 : 1000;
}

function getNextBlacklistId(state) {
  const list = state.blacklist || [];
  return list.length > 0 ? Math.max(...list.map(r => Number(r.id) || 0)) + 1 : 100;
}

async function fetchJsonWithTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`IP intelligence request failed: ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

function rememberIpData(ip, data, ttlMs = IP_INTELLIGENCE_CACHE_TTL_MS) {
  if (data && Object.keys(data).length) {
    ipIntelligenceCache.set(ip, { data, expiresAt: Date.now() + ttlMs });
  }
  return data;
}

function recentIpDataFromLogs(stateLogs, ip) {
  const row = stateLogs.find(log => {
    if (log.client_ip !== ip || log.ip_intelligence_version !== IP_INTELLIGENCE_VERSION) return false;
    const checkedAt = new Date(log.ip_intelligence_checked_at || 0).getTime();
    return Number.isFinite(checkedAt) && Date.now() - checkedAt < 24 * 60 * 60 * 1000;
  });
  if (!row) return null;
  return {
    country: row.country,
    countryCode: row.country_code,
    city: row.city,
    isp: row.isp,
    org: row.org,
    as: row.asn,
    hosting: Boolean(row.is_datacenter),
    vpn: Boolean(row.is_vpn),
    proxy: Boolean(row.is_proxy),
    tor: Boolean(row.is_tor),
    abuser: Boolean(row.is_abuser),
    vpnService: row.vpn_service || null,
    source: row.ip_intelligence_source || 'cache',
    intelligenceVersion: IP_INTELLIGENCE_VERSION
  };
}

async function lookupIp(ip) {
  if (!isKnownIp(ip)) return {};
  const cached = ipIntelligenceCache.get(ip);
  if (cached && cached.expiresAt > Date.now()) return cached.data;
  if (cached) ipIntelligenceCache.delete(ip);

  let primaryData = null;
  try {
    const ipApiKey = process.env.IPAPI_IS_KEY || '';
    const keyParam = ipApiKey ? `&key=${encodeURIComponent(ipApiKey)}` : '';
    const data = await fetchJsonWithTimeout(`https://api.ipapi.is/?q=${encodeURIComponent(ip)}${keyParam}`, 1400);
    if (data && !data.error) {
      const company = data.company || {};
      const asn = data.asn || {};
      const location = data.location || {};
      primaryData = {
        country: location.country || 'Unknown',
        countryCode: location.country_code || 'XX',
        city: location.city || location.state || 'Unknown',
        isp: company.name || asn.org || 'Unknown',
        org: asn.org || company.name || 'Unknown',
        as: asn.asn ? `AS${asn.asn}` : null,
        hosting: Boolean(data.is_datacenter || company.type === 'hosting' || asn.type === 'hosting'),
        vpn: Boolean(data.is_vpn),
        proxy: Boolean(data.is_proxy),
        tor: Boolean(data.is_tor),
        abuser: Boolean(data.is_abuser),
        vpnService: data.vpn?.service || null,
        source: 'ipapi.is',
        intelligenceVersion: IP_INTELLIGENCE_VERSION
      };
    }
  } catch (_) {}

  try {
    const data = await fetchJsonWithTimeout(`https://ipwho.is/${encodeURIComponent(ip)}`, 900);
    if (data && data.success !== false) {
      const isDatacenter = hasDatacenterProvider(data.connection?.isp, data.connection?.org, data.connection?.domain);
      const secondaryData = {
        country: data.country || 'Unknown',
        countryCode: data.country_code || 'XX',
        city: data.city || 'Unknown',
        isp: data.connection?.isp || data.connection?.org || 'Unknown',
        org: data.connection?.org || data.connection?.isp || 'Unknown',
        as: data.connection?.asn ? `AS${data.connection.asn}` : null,
        hosting: isDatacenter,
        vpn: false,
        proxy: false,
        tor: false,
        abuser: false,
        vpnService: null,
        source: 'ipwho.is',
        intelligenceVersion: IP_INTELLIGENCE_VERSION
      };

      if (primaryData) {
        const primaryIdentity = `${primaryData.countryCode}|${primaryData.isp}|${primaryData.org}`.toLowerCase();
        const secondaryIdentity = `${secondaryData.countryCode}|${secondaryData.isp}|${secondaryData.org}`.toLowerCase();
        const identityConflict = primaryIdentity !== secondaryIdentity;
        const primaryHighRisk = primaryData.hosting || primaryData.abuser || primaryData.vpn || primaryData.proxy;

        // A high-risk label must not survive when an independent source says
        // the address belongs to a normal ISP in another network/country.
        if (primaryHighRisk && !secondaryData.hosting && identityConflict) {
          return rememberIpData(ip, {
            ...secondaryData,
            source: 'ipapi.is+ipwho.is:conflict',
            intelligenceVersion: IP_INTELLIGENCE_VERSION,
            intelligenceConflict: true
          }, 15 * 60 * 1000);
        }
        return rememberIpData(ip, primaryData);
      }

      return rememberIpData(ip, secondaryData, 5 * 60 * 1000);
    }
  } catch (_) {}
  return primaryData ? rememberIpData(ip, primaryData) : {};
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
  if (!ipData) ipData = recentIpDataFromLogs(stateLogs, clientIp);
  if (!ipData) {
    ipData = await lookupIp(clientIp);
    if (ipCache) ipCache.set(clientIp, ipData);
  }
  if (!ipData || Object.keys(ipData).length === 0) {
    return {
      ipData: {},
      isVpn: false,
      isDatacenter: false,
      webrtcMismatch: false,
      riskLevel: 'UNKNOWN',
      riskReasons: ['IP intelligence is temporarily unavailable']
    };
  }

  const orgText = `${ipData.isp || ''} ${ipData.org || ''} ${ipData.as || ''}`.toLowerCase();
  const isDatacenter = Boolean(ipData.hosting || hasDatacenterProvider(ipData.isp, ipData.org, ipData.as));
  const isVpn = Boolean(ipData.vpn || ipData.proxy || orgText.includes('vpn') || orgText.includes('proxy'));
  const isTor = Boolean(ipData.tor);
  const isAbuser = Boolean(ipData.abuser);

  let webrtcMismatch = false;
  if (webrtcIp && clientIp && webrtcIp !== clientIp) {
    if (isDatacenter || isVpn) {
      webrtcMismatch = true;
    } else {
      let webrtcData = ipCache ? ipCache.get(webrtcIp) : null;
      if (!webrtcData && isKnownIp(webrtcIp)) {
        webrtcData = recentIpDataFromLogs(stateLogs, webrtcIp) || await lookupIp(webrtcIp);
        if (ipCache) ipCache.set(webrtcIp, webrtcData);
      }
      if (webrtcData && ipData.country && webrtcData.country && ipData.country !== webrtcData.country) {
        webrtcMismatch = true;
      }
    }
  }

  const riskReasons = [];
  if (isVpn) riskReasons.push(ipData.vpnService ? `${ipData.vpnService} VPN detected` : 'VPN/Proxy detected');
  if (isDatacenter) riskReasons.push('Datacenter/hosting IP detected');
  if (isTor) riskReasons.push('Tor exit node detected');
  if (isAbuser) riskReasons.push('Abusive IP reputation detected');
  if (webrtcMismatch) riskReasons.push('WebRTC IP mismatch detected');
  return {
    ipData,
    isVpn,
    isDatacenter,
    isTor,
    isAbuser,
    webrtcMismatch,
    riskLevel: riskReasons.length ? 'HIGH_RISK' : 'CLEAN',
    riskReasons
  };
}

function filterLogs(logs, query, { sort = true } = {}) {
  let rows = [...logs];
  if (query.store_id && query.store_id !== 'ALL') {
    const storeId = Number(query.store_id);
    rows = rows.filter(row => row.store_id === storeId);
  }
  if (query.risk_level && query.risk_level !== 'ALL') {
    rows = rows.filter(row => effectiveRiskLevel(row) === query.risk_level);
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
  return sort ? rows.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0)) : rows;
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
  const inferredDatacenter = hasDatacenterProvider(row.isp, row.org);
  const storedReasons = row.risk_reasons ? safeJsonParse(row.risk_reasons, []) : [];
  const riskReasons = inferredDatacenter && !storedReasons.includes('Datacenter/hosting IP detected')
    ? [...storedReasons, 'Datacenter/hosting IP detected']
    : storedReasons;
  const riskLevel = effectiveRiskLevel(row);
  let timeToOrder = null;
  if (hasOrder && row.session_duration_sec) timeToOrder = formatDuration(Number(row.session_duration_sec));
  const effectiveWebrtc = (row.webrtc_ip && isKnownIp(row.webrtc_ip)) ? row.webrtc_ip : null;
  let effectiveWebrtcStatus = row.webrtc_status || (effectiveWebrtc ? 'captured' : 'not_available');
  const rowAgeMs = Date.now() - new Date(row.created_at || 0).getTime();
  if (!effectiveWebrtc && effectiveWebrtcStatus === 'pending' && Number.isFinite(rowAgeMs) && rowAgeMs > 30 * 1000) {
    effectiveWebrtcStatus = 'not_available';
  }
  const isBlacklisted = blacklisted.has(row.client_ip) || (row.webrtc_ip && blacklisted.has(row.webrtc_ip));
  return {
    ...row,
    webrtc_ip: effectiveWebrtc,
    webrtc_status: effectiveWebrtcStatus,
    is_vpn: Boolean(row.is_vpn),
    is_datacenter: Boolean(row.is_datacenter || inferredDatacenter),
    risk_level: riskLevel,
    webrtc_mismatch: Boolean(row.webrtc_mismatch),
    is_blacklisted: isBlacklisted,
    time_to_order: timeToOrder || (hasOrder ? 'Chưa bắt được phiên' : null),
    order_info: hasOrder ? safeJsonParse(row.order_info, null) : null,
    risk_reasons: riskReasons
  };
}

async function handleStores(event, state, method, parts, body) {
  if (!assertAdmin(event)) return unauthorized();
  if (method === 'GET' && parts.length === 0) {
    return json(200, { success: true, data: state.stores.map(store => publicStore(store, state.syncState)) });
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
    const preset = body?.datePreset || 'TODAY';
    const incremental = body?.incremental === true && preset === 'TODAY';
    const lockKey = `${store.id}:${preset}`;
    if (syncLocks.has(lockKey)) {
      return json(202, { success: true, syncing: true, total_orders: 0, synced_new: 0, message: 'Sync dang chay, dashboard se tu cap nhat ngay khi co du lieu moi.' });
    }
    const syncPromise = syncSapoOrders(state, store, preset, { incremental });
    syncLocks.set(lockKey, syncPromise);
    try {
      const result = await syncPromise;
      return json(200, result);
    } catch (error) {
      recordSyncRun(state, {
        store_id: store.id,
        status: 'error',
        mode: incremental ? 'delta' : 'full',
        message: error.message || 'Sync failed'
      });
      await saveSyncState(state);
      throw error;
    } finally {
      syncLocks.delete(lockKey);
    }
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

  // Filter candidate browsing logs from tracker (not sapo_sync) within 15 mins prior to order creation for the same store
  const candidates = state.logs.filter(log => {
    if (log.trigger_event === 'sapo_sync') return false;
    if (hasOrderInfo(log.order_info)) return false;
    if (storeId && log.store_id && log.store_id !== storeId) return false;
    const logTime = new Date(log.created_at).getTime();
    if (!Number.isFinite(logTime)) return false;
    const diff = orderTime - logTime;
    return diff >= -60 * 1000 && diff <= 15 * 60 * 1000;
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

async function applyIpAnalysis(log, clientIp, webrtcIp, extraReasons = [], ipCache = null, stateLogs = []) {
  const analysis = await analyzeRisk(clientIp, webrtcIp, ipCache, stateLogs);
  log.client_ip = isKnownIp(clientIp) ? clientIp : 'unknown';
  log.webrtc_ip = isKnownIp(webrtcIp) ? webrtcIp : null;
  log.country = analysis.ipData.country || 'Unknown';
  log.country_code = analysis.ipData.countryCode || 'XX';
  log.city = analysis.ipData.city || 'Unknown';
  log.isp = analysis.ipData.isp || 'Unknown';
  log.org = analysis.ipData.org || 'Unknown';
  log.asn = analysis.ipData.as || null;
  log.is_vpn = analysis.isVpn;
  log.is_datacenter = analysis.isDatacenter;
  log.is_proxy = Boolean(analysis.ipData.proxy);
  log.is_tor = analysis.isTor;
  log.is_abuser = analysis.isAbuser;
  log.vpn_service = analysis.ipData.vpnService || null;
  log.ip_intelligence_source = analysis.ipData.source || null;
  log.ip_intelligence_version = Number(analysis.ipData.intelligenceVersion || 0);
  log.ip_intelligence_checked_at = new Date().toISOString();
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
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let res;
  try {
    res = await fetch(url, { headers: sapoAuthHeaders(store, secret), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Sapo API timed out after 8 seconds.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function getSyncWindow(state, store, datePreset, incremental) {
  const fullSince = sapoCreatedOnMin(datePreset);
  if (!incremental || !fullSince) return { since: fullSince, mode: 'full' };

  const previous = state.syncState?.byStore?.[String(store.id)];
  const lastSuccessMs = new Date(previous?.finished_at || 0).getTime();
  const lastFullMs = new Date(previous?.last_full_at || 0).getTime();
  if (!Number.isFinite(lastSuccessMs) || !Number.isFinite(lastFullMs) || Date.now() - lastFullMs >= FULL_SYNC_RECONCILIATION_MS) {
    return { since: fullSince, mode: 'full' };
  }

  const deltaSinceMs = Math.max(new Date(fullSince).getTime(), lastSuccessMs - SYNC_LOOKBACK_MS);
  return { since: new Date(deltaSinceMs).toISOString(), mode: 'delta' };
}

function isSapoOrderInDatePreset(createdAt, datePreset) {
  if (datePreset === 'ALL') return true;
  if (!createdAt) return false;

  const timestamp = new Date(createdAt);
  if (!Number.isFinite(timestamp.getTime())) return false;

  const orderDay = businessDate(timestamp);
  const today = businessDate();
  let daysAgo = 0;
  if (datePreset === '7_DAYS') daysAgo = 6;
  if (datePreset === '30_DAYS') daysAgo = 29;
  const startDay = businessDate(new Date(Date.now() - (daysAgo * 24 * 60 * 60 * 1000)));
  return orderDay >= startDay && orderDay <= today;
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

async function syncSapoOrders(state, store, datePreset, { incremental = false } = {}) {
  const syncStartTime = Date.now();
  const startedAt = new Date(syncStartTime).toISOString();
  const secret = decryptSecret(store.api_secret_encrypted);
  if (!secret) throw new Error('Missing Sapo API secret.');
  const syncWindow = getSyncWindow(state, store, datePreset, incremental);
  const since = syncWindow.since;
  const ipCache = new Map();
  let total = 0;
  let synced = 0;
  let updated = 0;
  let removed = 0;
  let logsChanged = false;
  let completedRange = false;
  let queryParam = 'created_at_min';
  const syncedOrderIds = new Set();
  const knownOrders = new Map();
  state.logs.forEach(log => {
    if (log.store_id !== store.id || !hasOrderInfo(log.order_info)) return;
    const order = safeJsonParse(log.order_info, null);
    if (order?.order_id) knownOrders.set(String(order.order_id), log);
  });

  const pageLimit = datePreset === 'TODAY' ? 100 : 250;
  const maxPages = datePreset === 'TODAY' ? 2 : (datePreset === '7_DAYS' ? 4 : 8);
  for (let page = 1; page <= maxPages; page++) {
    if (Date.now() - syncStartTime > 13500) break;

    const minParam = since ? `&${queryParam}=${encodeURIComponent(since)}` : '';
    // Sapo's order-list endpoint for this store returns an empty array when
    // status=any is supplied, even though orders exist. Keep the proven list
    // query and use completion of that response as the reconciliation source.
    let path = `/admin/orders.json?limit=${pageLimit}&page=${page}${minParam}`;
    let { res, data } = await sapoFetchJson(store, secret, path);

    if (page === 1 && (!res.ok || !data?.orders?.length)) {
      const altParam = queryParam === 'created_at_min' ? 'created_on_min' : 'created_at_min';
      const altMinParam = since ? `&${altParam}=${encodeURIComponent(since)}` : '';
      const altPath = `/admin/orders.json?limit=${pageLimit}&page=1${altMinParam}`;
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
    if (!orders.length) {
      completedRange = true;
      break;
    }
    let reachedOlderOrder = false;

    for (const order of orders) {
      if (Date.now() - syncStartTime > 14000) break;
      const createdAt = order.created_on || order.created_at || null;
      if (!isSapoOrderInDatePreset(createdAt, datePreset)) {
        reachedOlderOrder = true;
        continue;
      }
      const orderInfo = parseSapoOrder(order);
      if (!orderInfo.order_id) continue;
      const orderKey = String(orderInfo.order_id);
      if (syncedOrderIds.has(orderKey)) continue;
      syncedOrderIds.add(orderKey);
      total++;
      const orderClientIp = sapoOrderClientIp(order);
      const existing = knownOrders.get(orderKey);
      const candidateVisit = findTrackedVisitForOrder(state, store.id, orderInfo, createdAt, orderClientIp);
      const trackedVisit = existing || candidateVisit;

      if (trackedVisit) {
        const before = JSON.stringify(trackedVisit);
        applySyncedOrder(trackedVisit, orderInfo, createdAt);
        trackedVisit.store_id = store.id;
        trackedVisit.store_domain = store.mysapo_domain;
        const effectiveClientIp = isKnownIp(orderClientIp) ? orderClientIp : trackedVisit.client_ip;
        if (candidateVisit) {
          if (isKnownIp(candidateVisit.webrtc_ip)) {
            trackedVisit.webrtc_ip = candidateVisit.webrtc_ip;
          }
          if (candidateVisit.webrtc_status && candidateVisit.webrtc_status !== 'pending') {
            trackedVisit.webrtc_status = candidateVisit.webrtc_status;
          }
          if (candidateVisit.session_start_at) {
            trackedVisit.session_start_at = candidateVisit.session_start_at;
            trackedVisit.session_duration_sec = sessionDurationToOrder(candidateVisit.session_start_at, createdAt);
          }
        }
        trackedVisit.client_ip = effectiveClientIp;
        const lastCheckedMs = new Date(trackedVisit.ip_intelligence_checked_at || 0).getTime();
        const shouldAnalyze = !Number.isFinite(lastCheckedMs) || Date.now() - lastCheckedMs > IP_INTELLIGENCE_CACHE_TTL_MS || trackedVisit.ip_intelligence_version !== IP_INTELLIGENCE_VERSION || !existing;
        if (shouldAnalyze && ((Date.now() - syncStartTime) < 9500 || ipCache.has(effectiveClientIp))) {
          await applyIpAnalysis(trackedVisit, effectiveClientIp, trackedVisit.webrtc_ip, [], ipCache, state.logs);
        }
        if (JSON.stringify(trackedVisit) !== before) {
          logsChanged = true;
          updated++;
        }
        knownOrders.set(orderKey, trackedVisit);
      } else {
        const effectiveClientIp = isKnownIp(orderClientIp) ? orderClientIp : 'unknown';
        const newLog = {
          id: getNextId(state),
          store_id: store.id,
          store_domain: store.mysapo_domain,
          client_ip: effectiveClientIp,
          webrtc_ip: null,
          user_agent: 'Sapo API Sync',
          fingerprint: 'FP-SAPO-SYNCED',
          order_info: JSON.stringify(orderInfo),
          country: 'Viet Nam',
          country_code: 'VN',
          city: 'Unknown',
          isp: 'Unknown',
          org: 'Unknown',
          is_vpn: false,
          is_datacenter: false,
          webrtc_mismatch: false,
          risk_level: 'UNKNOWN',
          risk_reasons: '["IP analysis pending"]',
          trigger_event: 'sapo_sync',
          session_id: null,
          session_start_at: null,
          session_duration_sec: null,
          created_at: new Date(createdAt).toISOString()
        };
        if ((Date.now() - syncStartTime) < 9500 || ipCache.has(effectiveClientIp)) {
          await applyIpAnalysis(newLog, effectiveClientIp, null, [], ipCache, state.logs);
        }
        state.logs.unshift(newLog);
        knownOrders.set(orderKey, newLog);
        logsChanged = true;
        synced++;
      }
    }
    // Sapo occasionally ignores created_at_min. Orders are newest first, so do
    // not fetch another page once the response has crossed the selected range.
    if (reachedOlderOrder || orders.length < pageLimit) {
      completedRange = true;
      break;
    }
  }

  // A delta response cannot prove an order was deleted. Only a complete full-day
  // reconciliation may remove dashboard orders that no longer exist in Sapo.
  if (syncWindow.mode === 'full' && datePreset === 'TODAY' && completedRange) {
    state.logs = state.logs.filter(log => {
      if (log.store_id !== store.id || !hasOrderInfo(log.order_info) || !isSapoOrderInDatePreset(log.created_at, datePreset)) return true;
      const orderInfo = safeJsonParse(log.order_info, null);
      if (!orderInfo?.order_id || syncedOrderIds.has(String(orderInfo.order_id))) return true;
      removed++;
      return false;
    });
    if (removed > 0) logsChanged = true;
  }

  // Deduplicate orders by order_id per store.
  const seenOrders = new Set();
  const logsBeforeDeduplication = state.logs.length;
  state.logs = state.logs.filter(log => {
    if (hasOrderInfo(log.order_info)) {
      const ordInfo = safeJsonParse(log.order_info, null);
      if (ordInfo && ordInfo.order_id) {
        const dupKey = ordInfo.order_id + '_' + log.store_id;
        if (seenOrders.has(dupKey)) return false;
        seenOrders.add(dupKey);
      }
      return true;
    }
    return true;
  });
  if (state.logs.length !== logsBeforeDeduplication) logsChanged = true;

  // Fast backfill pass for missing WebRTC / session_duration
  for (const log of state.logs) {
    if (log.store_id === store.id && hasOrderInfo(log.order_info)) {
      const originalWebRtcIp = log.webrtc_ip;
      const originalWebRtcMismatch = log.webrtc_mismatch;
      const originalSessionStart = log.session_start_at;
      const originalSessionDuration = log.session_duration_sec;
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
      if (log.webrtc_ip !== originalWebRtcIp || log.webrtc_mismatch !== originalWebRtcMismatch || log.session_start_at !== originalSessionStart || log.session_duration_sec !== originalSessionDuration) {
        logsChanged = true;
      }
    }
  }

  if (logsChanged) await saveLogsState(state);
  const syncStatus = recordSyncRun(state, {
    store_id: store.id,
    status: 'success',
    mode: syncWindow.mode,
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    total_orders: total,
    synced_new: synced,
    updated_orders: updated,
    removed_orders: removed,
    since
  });
  await saveSyncState(state);
  return { success: true, total_orders: total, synced_new: synced, updated_orders: updated, removed_orders: removed, sync_status: syncStatus };
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
    const blacklistCheck = state.blacklist.find(item => item.ip === realClientIp || (body?.webrtc_ip && item.ip === body.webrtc_ip));

    // WebRTC discovery can finish shortly after navigation. Update only recent
    // tracker events so a later VPN/network change cannot rewrite old orders.
    if (body?.trigger_event === 'network_identity' && body?.session_id) {
      const now = Date.now();
      const sessionLogs = state.logs.filter(log => {
        if (log.store_id !== matched.id || log.session_id !== body.session_id) return false;
        if (log.trigger_event === 'sapo_sync') return false;
        const logTime = new Date(log.created_at).getTime();
        return Number.isFinite(logTime) && Math.abs(now - logTime) <= 15 * 1000;
      });
      const capturedWebrtcIp = isKnownIp(body?.webrtc_ip) ? body.webrtc_ip : null;
      const webRtcStatus = String(body?.webrtc_status || 'unknown');
      for (const log of sessionLogs) {
        if (webRtcStatus !== 'pending') log.webrtc_status = webRtcStatus;
        await applyIpAnalysis(log, realClientIp, capturedWebrtcIp, [], null, state.logs);
        const logBlacklist = state.blacklist.find(item => item.ip === log.client_ip || (log.webrtc_ip && item.ip === log.webrtc_ip));
        if (logBlacklist) {
          const existingReasons = safeJsonParse(log.risk_reasons, []);
          log.risk_level = 'HIGH_RISK';
          log.risk_reasons = JSON.stringify([...existingReasons, `IP is blacklisted: ${logBlacklist.reason || 'Manual block'}`]);
        }
      }
      if (sessionLogs.length) await saveLogsState(state);
      if (sessionLogs.length) {
        return json(200, {
          success: true,
          updated: 'network_identity',
          updated_logs: sessionLogs.length,
          client_ip: realClientIp,
          webrtc_ip: capturedWebrtcIp,
          webrtc_status: webRtcStatus,
          is_blacklisted: Boolean(blacklistCheck)
        });
      }
    }
    const analysis = await analyzeRisk(realClientIp, body?.webrtc_ip, null, state.logs);
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
        await saveLogsState(state);
        return json(200, { success: true, log_id: latestSessionLog.id, client_ip: realClientIp, is_blacklisted: Boolean(blacklistCheck), updated: 'session_inactive' });
      }
    }
    const log = {
      id: getNextId(state),
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
      asn: analysis.ipData.as || null,
      is_vpn: analysis.isVpn,
      is_datacenter: analysis.isDatacenter,
      is_proxy: Boolean(analysis.ipData.proxy),
      is_tor: analysis.isTor,
      is_abuser: analysis.isAbuser,
      vpn_service: analysis.ipData.vpnService || null,
      ip_intelligence_source: analysis.ipData.source || null,
      ip_intelligence_version: Number(analysis.ipData.intelligenceVersion || 0),
      ip_intelligence_checked_at: new Date().toISOString(),
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
    await saveLogsState(state);
    return json(201, { success: true, log_id: log.id, client_ip: realClientIp, risk_level: riskLevel, is_blacklisted: Boolean(blacklistCheck), reasons });
  }
  if (method === 'GET' && parts.length === 0) {
    const page = Math.max(1, Number(query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(query.limit || 20)));
    const filtered = filterLogs(state.logs, query);
    const orderTotal = filterLogs(state.logs, { ...query, orders_only: 'true' }, { sort: false }).length;
    const allTotal = filterLogs(state.logs, { ...query, orders_only: 'false' }, { sort: false }).length;
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
    await saveLogsState(state);
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
      state.blacklist.unshift({ id: getNextBlacklistId(state), ip, reason: body?.reason || 'Manual block', source: body?.source || 'MANUAL', created_at: new Date().toISOString() });
    }
    state.logs.forEach(log => { if (log.client_ip === ip || log.webrtc_ip === ip) log.risk_level = 'HIGH_RISK'; });
    // Save only the lightweight blacklist key — avoids writing the full MB-sized state blob
    await saveBlacklistState(state);
    return json(201, { success: true, message: `IP ${ip} blocked` });
  }
  if (method === 'DELETE' && parts[0]) {
    const ip = decodeURIComponent(parts[0]);
    const before = state.blacklist.length;
    state.blacklist = state.blacklist.filter(item => item.ip !== ip);
    // Save only the lightweight blacklist key — avoids writing the full MB-sized state blob
    await saveBlacklistState(state);
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
    const highRiskCount = logs.filter(log => effectiveRiskLevel(log) === 'HIGH_RISK').length;
    const cleanCount = totalLogs - highRiskCount;
    const today = businessDate();
    const suspiciousOrdersToday = logs.filter(log => effectiveRiskLevel(log) === 'HIGH_RISK' && hasOrderInfo(log.order_info) && log.created_at && businessDate(log.created_at) === today).length;
    const ispMap = {};
    logs.filter(log => effectiveRiskLevel(log) === 'HIGH_RISK' && log.isp && log.isp !== 'Unknown').forEach(log => { ispMap[log.isp] = (ispMap[log.isp] || 0) + 1; });
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
      if (effectiveRiskLevel(log) === 'HIGH_RISK') buckets[hour].high_risk += 1;
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

    if (rawPath === '/client-tracker.js') {
      const state = await loadState({ includeLogs: false, includeStores: false });
      const blacklist = state.blacklist.map(item => item.ip).filter(Boolean);
      const visitorIp = getClientIp(event);
      const block = state.blacklist.find(item => item.ip === visitorIp);
      const initialBlock = block ? { is_blacklisted: true, ip: visitorIp } : null;
      return response(200, `window.__SAPO_IP_GUARD_BLACKLIST = ${JSON.stringify(blacklist)};\nwindow.__SAPO_IP_GUARD_INITIAL_BLOCK = ${JSON.stringify(initialBlock)};\n${TRACKER_SOURCE}`, {
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
    const isPublicCollection = resource === 'logs' && method === 'POST' && parts[0] === 'collect';
    const isPublicBlacklistCheck = resource === 'blacklist' && method === 'GET' && parts[0] === 'check';

    // Reject protected API requests before loading any persistent state.
    if (!isPublicCollection && !isPublicBlacklistCheck && !assertAdmin(event)) return unauthorized();
    if (resource === 'auth' && method === 'POST' && parts[0] === 'verify') {
      return json(200, { success: true });
    }

    if (resource === 'stores') {
      const isSync = method === 'POST' && parts[1] === 'sync';
      const state = await loadState({ includeLogs: isSync, includeStores: true, includeBlacklist: isSync });
      return await handleStores(event, state, method, parts, body);
    }
    if (resource === 'logs') {
      const isCollection = method === 'POST' && parts[0] === 'collect';
      const state = await loadState({ includeLogs: true, includeStores: isCollection, includeBlacklist: true });
      return await handleLogs(event, state, method, parts, query, body);
    }
    if (resource === 'blacklist') {
      const state = await loadState({ includeLogs: false, includeStores: false, includeBlacklist: true });
      return await handleBlacklist(event, state, method, parts, query, body);
    }
    if (resource === 'stats') {
      const state = await loadState({ includeLogs: true, includeStores: false, includeBlacklist: true });
      return handleStats(event, state, method, parts, query);
    }

    return json(404, { success: false, message: 'Not found' });
  } catch (error) {
    return json(500, { success: false, message: error.message });
  }
};
