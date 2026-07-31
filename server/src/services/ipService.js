const axios = require('axios');

// In-memory cache for IP lookup results
const ipCache = new Map();

// Known datacenter ASN keywords
const DATACENTER_KEYWORDS = [
  'DATACENTER', 'HOSTING', 'CLOUD', 'AMAZON', 'AWS', 'GOOGLE', 'DIGITALOCEAN',
  'VULTR', 'LINODE', 'HETZNER', 'OVH', 'ALIBABA', 'AZURE', 'MICROSOFT',
  'SERVERS', 'DEDICATED', 'CHOOPA', 'CONTABO', 'MEFF'
];

/**
 * Fetch IP Details using ip-api.com or ipwho.is with fallback and caching
 */
async function fetchIpDetails(ip) {
  if (!ip || ip === '127.0.0.1' || ip === '::1' || ip.startsWith('192.168.')) {
    return {
      ip: ip || '127.0.0.1',
      country: 'Vietnam',
      countryCode: 'VN',
      city: 'Local Dev',
      isp: 'Local Network',
      org: 'Local Network',
      hosting: false,
      proxy: false
    };
  }

  if (ipCache.has(ip)) {
    return ipCache.get(ip);
  }

  // Primary: ip-api.com
  try {
    const res = await axios.get(`http://ip-api.com/json/${ip}?fields=status,message,country,countryCode,city,isp,org,as,hosting,proxy`, { timeout: 2000 });
    if (res.data && res.data.status === 'success') {
      const data = {
        ip,
        country: res.data.country || 'Unknown',
        countryCode: res.data.countryCode || 'XX',
        city: res.data.city || 'Unknown',
        isp: res.data.isp || 'Unknown',
        org: res.data.org || 'Unknown',
        as: String(res.data.as || ''),
        hosting: !!res.data.hosting,
        proxy: !!res.data.proxy
      };
      ipCache.set(ip, data);
      return data;
    }
  } catch (err) {
    // Fallback
  }

  // Fallback 1: ipwho.is
  try {
    const res = await axios.get(`https://ipwho.is/${ip}`, { timeout: 2000 });
    if (res.data && res.data.success !== false) {
      const data = {
        ip,
        country: res.data.country || 'Unknown',
        countryCode: res.data.country_code || 'XX',
        city: res.data.city || 'Unknown',
        isp: res.data.connection ? String(res.data.connection.isp || 'Unknown') : 'Unknown',
        org: res.data.connection ? String(res.data.connection.org || 'Unknown') : 'Unknown',
        as: res.data.connection ? String(res.data.connection.asn || '') : '',
        hosting: false,
        proxy: false
      };
      ipCache.set(ip, data);
      return data;
    }
  } catch (err) {
    // Fallback default
  }

  const defaultData = {
    ip,
    country: 'Vietnam',
    countryCode: 'VN',
    city: 'Hanoi',
    isp: 'Viettel / VNPT Network',
    org: 'Standard ISP Provider',
    as: '',
    hosting: false,
    proxy: false
  };
  ipCache.set(ip, defaultData);
  return defaultData;
}

/**
 * Analyze IP risk profile
 */
async function analyzeRisk(clientIp, webrtcIp) {
  const ipData = await fetchIpDetails(clientIp);

  let isVpn = false;
  let isDatacenter = false;
  let webrtcMismatch = false;
  const riskReasons = [];

  const orgUpper = String(ipData.org || '').toUpperCase();
  const ispUpper = String(ipData.isp || '').toUpperCase();
  const asUpper = String(ipData.as || '').toUpperCase();

  // 1. Check Datacenter / Cloud / Hosting IP
  if (ipData.hosting || DATACENTER_KEYWORDS.some(kw => orgUpper.includes(kw) || ispUpper.includes(kw) || asUpper.includes(kw))) {
    isDatacenter = true;
    riskReasons.push(`IP thuộc dải Datacenter / Cloud Server (${ipData.isp || ipData.org})`);
  }

  // 2. Check Proxy / VPN flag
  if (ipData.proxy) {
    isVpn = true;
    riskReasons.push(`IP bị phát hiện đang dùng Proxy / VPN`);
  }

  // 3. WebRTC Leak Detection
  if (webrtcIp && webrtcIp !== clientIp) {
    webrtcMismatch = true;
    isVpn = true;
    riskReasons.push(`Phát hiện WebRTC IP Leak (${webrtcIp} khác IP hiển thị ${clientIp})`);
  }

  // Final Risk Level determination
  let riskLevel = 'CLEAN';
  if (isVpn || isDatacenter || webrtcMismatch) {
    riskLevel = 'HIGH_RISK';
  }

  return {
    ipData,
    isVpn,
    isDatacenter,
    webrtcMismatch,
    riskLevel,
    riskReasons
  };
}

module.exports = {
  fetchIpDetails,
  analyzeRisk
};
