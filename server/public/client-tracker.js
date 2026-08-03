/**
 * Sapo Fake IP & WebRTC Leak Tracker Script (Ultra-Accurate Order Extraction & Deduplication)
 */
(function () {
  'use strict';

  var BACKEND_URL = (function () {
    if (window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.backendUrl) {
      return window.SAPO_TRACKER_CONFIG.backendUrl.replace(/\/$/, '');
    }
    var scripts = document.getElementsByTagName('script');
    for (var i = 0; i < scripts.length; i++) {
      if (scripts[i].src && scripts[i].src.indexOf('client-tracker.js') !== -1) {
        var url = new URL(scripts[i].src);
        return url.origin;
      }
    }
    return 'http://localhost:5000';
  })();

  var API_KEY = (window.SAPO_TRACKER_CONFIG && window.SAPO_TRACKER_CONFIG.apiKey) ? window.SAPO_TRACKER_CONFIG.apiKey : null;
  var lastPushedUrl = '';
  var lastPushedTime = 0;
  var EMBEDDED_BLACKLIST = Array.isArray(window.__SAPO_IP_GUARD_BLACKLIST) ? window.__SAPO_IP_GUARD_BLACKLIST : [];

  console.log('[Sapo IP Tracker] Active with Backend URL:', BACKEND_URL);
  console.log('[Sapo IP Tracker] Embedded blacklist size:', EMBEDDED_BLACKLIST.length);

  function isEmbeddedBlacklisted(pubIp, webrtcIp) {
    return EMBEDDED_BLACKLIST.indexOf(pubIp) !== -1 || EMBEDDED_BLACKLIST.indexOf(webrtcIp) !== -1;
  }

  function getSessionMeta() {
    var sessionId = sessionStorage.getItem('sapo_session_id');
    var sessionStart = sessionStorage.getItem('sapo_session_start');

    if (!sessionId) {
      sessionId = 'S-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem('sapo_session_id', sessionId);
    }

    if (!sessionStart) {
      sessionStart = Date.now().toString();
      sessionStorage.setItem('sapo_session_start', sessionStart);
    }

    var sessionStartMs = parseInt(sessionStart, 10);
    return {
      session_id: sessionId,
      session_start_at: new Date(sessionStartMs).toISOString(),
      session_duration_sec: Math.max(1, Math.round((Date.now() - sessionStartMs) / 1000))
    };
  }

  /**
   * Fast Client Public IP Resolution (700ms max timeout)
   */
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

  /**
   * WebRTC IP Leak Detection
   */
  function getWebRTCIP(callback) {
    var webrtcIp = null;
    var RTCPeerConnection = window.RTCPeerConnection || window.webkitRTCPeerConnection || window.mozRTCPeerConnection;

    if (!RTCPeerConnection) {
      return callback(null);
    }

    try {
      var pc = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });

      pc.createDataChannel('');

      pc.onicecandidate = function (e) {
        if (!e.candidate) return;
        var candidate = e.candidate.candidate;
        var match = /([0-9]{1,3}(\.[0-9]{1,3}){3})/.exec(candidate);
        if (match) {
          var ip = match[1];
          if (ip !== '0.0.0.0' && ip !== '127.0.0.1' && !webrtcIp) {
            webrtcIp = ip;
            callback(webrtcIp);
          }
        }
      };

      pc.createOffer().then(function (sdp) {
        pc.setLocalDescription(sdp);
      }).catch(function () {});

      setTimeout(function () {
        if (!webrtcIp) callback(null);
      }, 700);

    } catch (err) {
      callback(null);
    }
  }

  /**
   * Browser Fingerprint Generator
   */
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
        var char = dataUrl.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash |= 0;
      }
      return 'FP-' + Math.abs(hash).toString(16) + '-' + screen.width + 'x' + screen.height;
    } catch (e) {
      return 'FP-fallback-' + Date.now();
    }
  }

  /**
   * Ultra-Accurate Sapo Order / Customer details extraction
   */
  function getSapoOrderInfo(formEl) {
    var info = {};

    // 1. Inspect window.Bizweb / window.Sapo objects
    var bz = window.Bizweb || window.Sapo || window.BizwebCheckout;
    if (bz) {
      var c = bz.checkout || bz.order;
      if (c) {
        info.order_id = c.name || (c.order_number ? '#' + c.order_number : null) || c.order_id || (c.id ? '#' + c.id : null);
        if (c.shipping_address || c.billing_address) {
          var addr = c.shipping_address || c.billing_address;
          info.customer_name = addr.name || addr.full_name || ((addr.first_name || '') + ' ' + (addr.last_name || '')).trim();
          info.phone = addr.phone;
          info.address = addr.address1;
        }
        info.total_price = c.total_price || c.total;
        info.email = c.email;
      }
    }

    // 2. Inspect DOM elements for Order Code (#18931) on checkout/thank-you pages
    var path = (window.location.pathname || '').toLowerCase();
    var isCheckoutPage = path.indexOf('/checkouts') !== -1 || path.indexOf('/thank') !== -1 || path.indexOf('/orders/') !== -1;
    if (!info.order_id && isCheckoutPage) {
      var orderCodeEl = document.querySelector('.order-number, .thankyou-order-id, #order_code, .order-code, [data-order-name], .os-order-number');
      if (orderCodeEl) {
        var text = orderCodeEl.innerText.trim();
        if (text) info.order_id = text.startsWith('#') ? text : '#' + text;
      }
    }

    // 3. Extract Customer Name, Phone, Email from Form or Page inputs
    var root = formEl || document;
    if (!info.customer_name) {
      var nameEl = root.querySelector('input[name*="full_name"], input[name*="name"], #billing_address_full_name, #billing_address_name, .customer-name');
      if (nameEl && nameEl.value) info.customer_name = nameEl.value.trim();
    }
    if (!info.phone) {
      var phoneEl = root.querySelector('input[name*="phone"], #billing_address_phone, .customer-phone');
      if (phoneEl && phoneEl.value) info.phone = phoneEl.value.trim();
    }
    if (!info.email) {
      var emailEl = root.querySelector('input[type="email"], input[name*="email"], #checkout_user_email');
      if (emailEl && emailEl.value) info.email = emailEl.value.trim();
    }

    return (info.order_id || info.customer_name || info.phone) ? info : null;
  }

  /**
   * Push Log to Backend API with keepalive
   */
  function pushLog(orderInfo, triggerEvent) {
    var now = Date.now();
    var currentUrl = window.location.href;

    // Deduplicate repetitive page_view logs within 10 seconds unless it's a checkout submission
    if (triggerEvent === 'page_view' && !orderInfo && currentUrl === lastPushedUrl && (now - lastPushedTime < 10000)) {
      return;
    }

    lastPushedUrl = currentUrl;
    lastPushedTime = now;

    getClientPublicIP(function (clientPublicIp) {
      getWebRTCIP(function (webrtcIp) {
        var fingerprint = getBrowserFingerprint();
        var finalOrderInfo = orderInfo || getSapoOrderInfo();

        var sessionMeta = getSessionMeta();

        var payload = {
          client_ip: clientPublicIp,
          api_key: API_KEY,
          webrtc_ip: webrtcIp,
          user_agent: navigator.userAgent,
          fingerprint: fingerprint,
          order_info: finalOrderInfo,
          url: currentUrl,
          trigger_event: triggerEvent || 'page_view',
          session_id: sessionMeta.session_id,
          session_start_at: sessionMeta.session_start_at,
          session_duration: sessionMeta.session_duration_sec
        };

        fetch(BACKEND_URL + '/api/v1/logs/collect', {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'Bypass-Tunnel-Remainder': 'true',
            'ngrok-skip-browser-warning': 'true'
          },
          body: JSON.stringify(payload)
        })
        .then(function (res) { return res.json(); })
        .then(function (data) {
          console.log('[Sapo IP Tracker] Log pushed successfully:', data);
          if (data && data.is_blacklisted) {
            renderAccessDeniedScreen(data.client_ip || clientPublicIp);
          }
        })
        .catch(function (err) {
          console.error('[Sapo IP Tracker] Push log error:', err);
        });
      });
    });
  }

  function renderAccessDeniedScreen(blockedIp) {
    try {
      var ipText = blockedIp || '171.224.0.81';
      document.body.innerHTML = '<div style="position:fixed;inset:0;z-index:9999999;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;width:100vw;background:#FAFAFA;font-family:-apple-system,BlinkMacSystemFont,\'SF Pro Display\',\'SF Pro Text\',\'Segoe UI\',Roboto,\'Helvetica Neue\',Arial,sans-serif;color:#1D1D1F;padding:32px;box-sizing:border-box;-webkit-font-smoothing:antialiased;">' +
        '<div style="max-width:720px;width:100%;background:#FFFFFF;border:1px solid #D1D1D6;border-radius:20px;padding:36px 40px;box-shadow:0 10px 30px rgba(0,0,0,0.06);text-align:left;box-sizing:border-box;">' +
        
        '<!-- LEVEL 1: TITLE -->' +
        '<h1 style="font-size:24px;font-weight:900;color:#000000;margin:0 0 14px 0;letter-spacing:-0.02em;line-height:1.3;text-transform:uppercase;">' +
        'CẢNH BÁO VI PHẠM PHÁP LUẬT & TRUY CẬP BỊ KHÓA' +
        '</h1>' +

        '<!-- LEVEL 2: DETECTED IP BANNER -->' +
        '<div style="font-size:14px;color:#1D1D1F;margin-bottom:24px;font-weight:600;line-height:1.6;padding:12px 16px;background:#F2F2F7;border-radius:12px;border-left:4px solid #000000;">' +
        'Chúng tôi đã phát hiện và ghi nhận địa chỉ IP gốc thực tế của bạn: ' +
        '<strong style="font-family:monospace;font-size:16px;color:#000000;background:#E5E5EA;padding:2px 8px;border-radius:6px;margin-left:4px;">' + ipText + '</strong>' +
        '</div>' +

        '<!-- LEVEL 3: LEGAL WARNING BOX -->' +
        '<div style="background:#FFFFFF;border:1px solid #E5E5EA;border-radius:14px;padding:20px 24px;margin-bottom:24px;">' +
        '<h2 style="font-size:13px;font-weight:800;color:#000000;margin:0 0 14px 0;letter-spacing:0.04em;text-transform:uppercase;border-bottom:1px solid #E5E5EA;padding-bottom:8px;">' +
        'THÔNG BÁO VỀ LUẬT AN NINH MẠNG VIỆT NAM' +
        '</h2>' +

        '<div style="font-size:13px;color:#1D1D1F;line-height:1.75;">' +
        '<p style="margin:0 0 12px 0;font-weight:500;">' +
        '<strong>1.</strong> Hành vi cố tình sử dụng VPN, Proxy, Fake IP để giả mạo thông tin, tạo đơn hàng ảo, hoặc can thiệp bất hợp pháp vào hệ thống thương mại điện tử là hành vi vi phạm nghiêm trọng <strong style="color:#000000;">Luật An ninh mạng số 24/2018/QH14</strong> và <strong style="color:#000000;">Điều 288 Bộ luật Hình sự Nước Cộng hòa Xã hội Chủ nghĩa Việt Nam</strong> <em>(Tội đưa hoặc sử dụng trái phép thông tin mạng máy tính, mạng viễn thông)</em>.' +
        '</p>' +
        '<p style="margin:0;font-weight:500;">' +
        '<strong>2.</strong> Toàn bộ dữ liệu truy cập bao gồm IP thực tế (WebRTC Leak), dải IP VPN kết nối, lịch sử thao tác và dấu bản chân trình duyệt (Browser Fingerprint) đã được tự động thu thập, niêm phong làm bằng chứng số và có thể được chuyển giao cho <strong style="color:#000000;">Cục An ninh mạng và phòng, chống tội phạm sử dụng công nghệ cao (A05 - Bộ Công an)</strong> để điều tra, xử lý theo quy định của pháp luật.' +
        '</p>' +
        '</div>' +
        '</div>' +

        '<!-- LEVEL 4: FOOTER NOTICE -->' +
        '<p style="font-size:12px;color:#86868B;margin:0;font-weight:500;line-height:1.5;">' +
        'Quyền truy cập và tính năng đặt hàng của bạn đã bị vô hiệu hóa hoàn toàn trên hệ thống. Nếu cho rằng đây là sự nhầm lẫn, vui lòng liên hệ Quản trị viên cửa hàng để được hỗ trợ giải quyết.' +
        '</p>' +

        '</div>' +
        '</div>';
      window.stop && window.stop();
    } catch(e) {}
  }

  /**
   * Listen to Sapo Checkout Form Submissions
   */
  function attachFormSubmitListeners() {
    var checkoutForms = document.querySelectorAll('form[action*="checkout"], form[action*="cart"], #checkout-form, .form-checkout');
    checkoutForms.forEach(function (form) {
      if (form.getAttribute('data-sapo-tracked')) return;
      form.setAttribute('data-sapo-tracked', 'true');

      form.addEventListener('submit', function () {
        var orderInfo = getSapoOrderInfo(form);
        pushLog(orderInfo, 'checkout_submit');
      });
    });
  }

  function checkBlacklistImmediately() {
    getClientPublicIP(function (pubIp) {
      getWebRTCIP(function (webrtcIp) {
        if (isEmbeddedBlacklisted(pubIp, webrtcIp)) {
          renderAccessDeniedScreen(webrtcIp || pubIp);
          return;
        }

        var query = [];
        if (pubIp) query.push('ip=' + encodeURIComponent(pubIp));
        if (webrtcIp) query.push('webrtc_ip=' + encodeURIComponent(webrtcIp));
        var checkUrl = BACKEND_URL + '/api/v1/blacklist/check' + (query.length ? '?' + query.join('&') : '');

        fetch(checkUrl, {
          headers: {
            'Bypass-Tunnel-Remainder': 'true',
            'ngrok-skip-browser-warning': 'true'
          }
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
          if (res && res.is_blacklisted) {
            renderAccessDeniedScreen(webrtcIp || pubIp || res.ip);
          }
        })
        .catch(function () {});
      });
    });
  }

  function initTracking() {
    checkBlacklistImmediately();
    pushLog(null, 'page_view');
    attachFormSubmitListeners();
    setInterval(attachFormSubmitListeners, 3000);
    setInterval(checkBlacklistImmediately, 30000);
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    initTracking();
  } else {
    document.addEventListener('DOMContentLoaded', initTracking);
  }

})();
