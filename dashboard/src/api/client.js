import axios from 'axios';

const normalizeApiBase = (value) => String(value || '').trim().replace(/\/+$/, '');
const runtimeApiBase = normalizeApiBase(globalThis.SAPO_GUARD_CONFIG?.API_BASE_URL);
const API_BASE = runtimeApiBase || normalizeApiBase(import.meta.env.VITE_API_BASE_URL) || '/api/v1';

const adminConfig = (extra = {}) => ({
  ...extra,
  headers: {
    'X-Sapo-Admin-Key': sessionStorage.getItem('sapo_dashboard_password_v2') || '',
    ...(extra.headers || {})
  }
});

export async function verifyAdminPassword() {
  const res = await axios.post(`${API_BASE}/auth/verify`, {}, adminConfig());
  return res.data;
}

export async function getStores() {
  const res = await axios.get(`${API_BASE}/stores`, adminConfig());
  return res.data;
}

export async function createStore(store) {
  const res = await axios.post(`${API_BASE}/stores`, store, adminConfig());
  return res.data;
}

export async function updateStore(id, store) {
  const res = await axios.put(`${API_BASE}/stores/${id}`, store, adminConfig());
  return res.data;
}

export async function deleteStore(id) {
  const res = await axios.delete(`${API_BASE}/stores/${id}`, adminConfig());
  return res.data;
}

export async function testStoreConnection(id) {
  const res = await axios.post(`${API_BASE}/stores/${id}/test`, {}, adminConfig());
  return res.data;
}

export async function syncStoreOrders(id, datePreset = 'TODAY') {
  const res = await axios.post(`${API_BASE}/stores/${id}/sync`, { datePreset }, adminConfig());
  return res.data;
}

export async function getOrders(params = {}, options = {}) {
  const res = await axios.get(`${API_BASE}/logs`, adminConfig({ params, signal: options.signal }));
  return res.data;
}

export async function getBlacklist() {
  const res = await axios.get(`${API_BASE}/blacklist`, adminConfig());
  return res.data;
}

export async function addToBlacklist(target, reason = 'Blocked from dashboard') {
  const payload = typeof target === 'object' && target !== null
    ? { ...target, reason, source: 'dashboard' }
    : { ip: target, reason, source: 'dashboard' };
  const res = await axios.post(`${API_BASE}/blacklist`, payload, adminConfig());
  return res.data;
}

export async function removeFromBlacklist(ip) {
  const res = await axios.delete(`${API_BASE}/blacklist/${encodeURIComponent(ip)}`, adminConfig());
  return res.data;
}
