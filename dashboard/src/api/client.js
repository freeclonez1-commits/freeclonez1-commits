import axios from 'axios';

const normalizeApiBase = (value) => (value || '').trim().replace(/\/+$/, '');
const runtimeApiBase = normalizeApiBase(globalThis.SAPO_GUARD_CONFIG?.API_BASE_URL);
const API_BASE = runtimeApiBase || normalizeApiBase(import.meta.env.VITE_API_BASE_URL) || '/api/v1';

const adminConfig = () => ({
  headers: { 'X-Sapo-Admin-Key': sessionStorage.getItem('sapo_dashboard_password_v2') || '' }
});

export const verifyAdminPassword = async () => {
  const res = await axios.post(`${API_BASE}/auth/verify`, {}, adminConfig());
  return res.data;
};

export const getStores = async () => {
  const res = await axios.get(`${API_BASE}/stores`, adminConfig());
  return res.data;
};

export const createStore = async (store_name, mysapo_domain, api_key, api_secret) => {
  const res = await axios.post(`${API_BASE}/stores`, { store_name, mysapo_domain, api_key, api_secret }, adminConfig());
  return res.data;
};

export const updateStore = async (id, store_name, mysapo_domain, api_key, api_secret) => {
  const res = await axios.put(`${API_BASE}/stores/${id}`, { store_name, mysapo_domain, api_key, api_secret }, adminConfig());
  return res.data;
};

export const deleteStore = async (id) => {
  const res = await axios.delete(`${API_BASE}/stores/${id}`, adminConfig());
  return res.data;
};

export const syncStoreOrders = async (id, datePreset = 'TODAY', options = {}) => {
  const res = await axios.post(`${API_BASE}/stores/${id}/sync`, { datePreset, incremental: options.incremental === true }, adminConfig());
  return res.data;
};

export const testStoreConnection = async (id) => {
  const res = await axios.post(`${API_BASE}/stores/${id}/test`, {}, adminConfig());
  return res.data;
};

export const getOverviewStats = async (params = {}) => {
  const res = await axios.get(`${API_BASE}/stats/overview`, { ...adminConfig(), params });
  return res.data;
};

export const getChartStats = async (params = {}) => {
  const res = await axios.get(`${API_BASE}/stats/chart`, { ...adminConfig(), params });
  return res.data;
};

export const getLogs = async (params = {}, options = {}) => {
  const res = await axios.get(`${API_BASE}/logs`, { ...adminConfig(), params, signal: options.signal });
  return res.data;
};

export const deleteLog = async (id) => {
  const res = await axios.delete(`${API_BASE}/logs/${id}`, adminConfig());
  return res.data;
};

export const getBlacklist = async () => {
  const res = await axios.get(`${API_BASE}/blacklist`, adminConfig());
  return res.data;
};

export const addToBlacklist = async (ip, reason, source = 'MANUAL') => {
  const res = await axios.post(`${API_BASE}/blacklist`, { ip, reason, source }, adminConfig());
  return res.data;
};

export const removeFromBlacklist = async (ip) => {
  const res = await axios.delete(`${API_BASE}/blacklist/${encodeURIComponent(ip)}`, adminConfig());
  return res.data;
};
