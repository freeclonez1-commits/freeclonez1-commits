import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Ban,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  Copy,
  Database,
  Eye,
  Globe2,
  KeyRound,
  ListFilter,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Store,
  Trash2,
  Wifi,
  X
} from 'lucide-react';
import { businessDate, businessDateDaysAgo } from './utils/dates';
import {
  createStore,
  deleteStore,
  addToBlacklist,
  compactStorage,
  getBlacklist,
  getOrders,
  getStores,
  removeFromBlacklist,
  syncStoreOrders,
  syncStoreOrdersDirect,
  testStoreConnection,
  updateStore,
  verifyAdminPassword
} from './api/client';

export const PAGE_SIZE = 50;

const DATE_PRESETS = {
  TODAY: { label: 'Hom nay', start: () => businessDate(), end: () => businessDate() },
  '7_DAYS': { label: '7 ngay', start: () => businessDateDaysAgo(6), end: () => businessDate() },
  '30_DAYS': { label: '30 ngay', start: () => businessDateDaysAgo(29), end: () => businessDate() }
};

const FILTER_MODES = [
  { key: 'all', label: 'Tat ca' },
  { key: 'duplicate_ip', label: 'Trung IP' },
  { key: 'duplicate_fingerprint', label: 'Trung dau vet' }
];

function cn(...values) {
  return values.filter(Boolean).join(' ');
}

function formatDate(value) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('vi-VN', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(new Date(value));
}

function formatDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '--';
  if (total < 60) return `${Math.round(total)} giay`;
  const minutes = Math.floor(total / 60);
  const remainingSeconds = Math.round(total % 60);
  if (minutes < 60) return `${minutes} phut ${remainingSeconds} giay`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours} gio ${remainingMinutes} phut`;
}

function isQuotaError(error) {
  const text = [
    error?.response?.data?.message,
    error?.response?.data?.error,
    error?.message
  ].filter(Boolean).join(' ').toLowerCase();
  return text.includes('exceed_egress_quota')
    || text.includes('project is restricted')
    || text.includes('supabase_url and supabase_service_role_key');
}

function cleanDomainInput(value) {
  return String(value || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').toLowerCase();
}

function ipText(value) {
  return value || '--';
}

function ipVersion(value) {
  const text = String(value || '').trim();
  if (!text || text === '--' || text === 'unknown') return '';
  if (text.includes(':')) return 'IPv6';
  if (text.includes('.')) return 'IPv4';
  return '';
}

function samePublicIp(left, right) {
  return Boolean(left && right && String(left).trim().toLowerCase() === String(right).trim().toLowerCase());
}

function shortId(value) {
  const text = String(value || '').trim();
  if (!text) return '--';
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-6)}` : text;
}

function isUnknownText(value) {
  const text = String(value || '').trim().toLowerCase();
  return !text || ['unknown', 'xx', 'n/a', 'na', 'null', 'undefined'].includes(text);
}

function networkText(order) {
  return [order.country, order.region, order.city].filter(value => !isUnknownText(value)).join(' / ') || 'Chua co vi tri';
}

function ispText(order) {
  return [order.isp, order.org, order.asn].filter(value => !isUnknownText(value)).join(' / ') || 'Chua co ISP';
}

// =========================================================================
// CAU HINH TINH NANG CANH BAO VPN / PROXY / DATACENTER
// Mac dinh: false (Tam thoi tat: tat ca don deu cung 1 mau, khong boi do)
// Khi muon bat lai: doi thanh true hoac bam nut tren giao dien
// =========================================================================
export const DEFAULT_ENABLE_VPN_ALERT = false;

function isFakeConnection(order, enableVpnAlert = false) {
  if (!enableVpnAlert) return false;
  return Boolean(order.risk_level === 'HIGH_RISK' && (order.webrtc_mismatch || order.is_vpn || order.is_proxy || order.is_datacenter || order.is_tor || order.is_abuser));
}

function connectionLabel(order, enableVpnAlert = false) {
  if (enableVpnAlert) {
    if (order.webrtc_mismatch) return 'IP ket noi / VPN fake';
    if (order.is_vpn || order.is_proxy) return 'IP VPN / Proxy';
    if (order.is_datacenter) return 'IP Datacenter';
  }
  if (order.risk_level === 'UNKNOWN') return 'IP chua du lieu';
  return 'IP ket noi';
}

function webrtcLabel(order, enableVpnAlert = false) {
  if (!order.webrtc_ip) {
    if (order.webrtc_status === 'not_supported') return 'Trinh duyet khong ho tro WebRTC';
    if (order.webrtc_status === 'error') return 'Loi kiem tra WebRTC';
    if (order.webrtc_status === 'invalid_candidate') return 'Candidate WebRTC khong phai IP';
    if (enableVpnAlert && (order.is_vpn || order.is_proxy || order.is_datacenter)) return 'VPN/trinh duyet khong leak IP goc';
    return 'Khong leak IP WebRTC';
  }
  if (enableVpnAlert && order.webrtc_mismatch) return 'IP WebRTC / IP goc bi lo';
  if (samePublicIp(order.client_ip, order.webrtc_ip) && (order.is_vpn || order.is_proxy || order.is_datacenter)) {
    return enableVpnAlert ? 'WebRTC trung IP VPN, khong lo IP goc' : 'IP WebRTC trung IP ket noi';
  }
  return 'IP WebRTC trung IP ket noi';
}

function riskInfo(order, enableVpnAlert = false) {
  if (order.is_blacklisted) return { tone: 'red', label: 'Da chan IP', icon: Ban };
  if (enableVpnAlert && order.risk_level === 'HIGH_RISK') {
    if (order.webrtc_mismatch) return { tone: 'red', label: 'Fake IP: lech WebRTC', icon: ShieldAlert };
    if (order.is_vpn || order.is_proxy) return { tone: 'red', label: 'VPN / Proxy', icon: ShieldAlert };
    if (order.is_datacenter) return { tone: 'red', label: 'Datacenter', icon: ShieldAlert };
    return { tone: 'red', label: 'Canh bao IP', icon: ShieldAlert };
  }
  if (order.risk_level === 'CLEAN' || (!enableVpnAlert && order.risk_level === 'HIGH_RISK')) {
    return { tone: 'green', label: 'IP an toan', icon: ShieldCheck };
  }
  return { tone: 'gray', label: 'Da ghi nhan IP', icon: AlertTriangle };
}

function cleanIdentity(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text || ['--', 'unknown', 'not_available', 'null', 'undefined'].includes(text)) return '';
  return text;
}

function orderIps(order) {
  return [order.client_ip, order.webrtc_ip]
    .map(cleanIdentity)
    .filter(Boolean);
}

function orderTraceKeys(order) {
  return [order.machine_key, order.device_key, order.fingerprint, order.session_id]
    .map(cleanIdentity)
    .filter(Boolean);
}

function orderMatchesSearch(order, searchText) {
  const needle = cleanIdentity(searchText);
  if (!needle) return true;
  const info = order.order_info || {};
  const haystack = [
    info.order_id,
    info.customer_name,
    info.phone,
    info.email,
    order.client_ip,
    order.webrtc_ip,
    order.country,
    order.region,
    order.city,
    order.isp,
    order.org,
    order.asn,
    order.machine_key,
    order.device_key,
    order.fingerprint
  ].map(value => String(value || '').toLowerCase()).join(' ');
  return haystack.includes(needle);
}

function filterOrdersLocal(rows, mode, searchText) {
  let result = rows.filter(order => orderMatchesSearch(order, searchText));

  const getOrderTime = (o) => {
    const raw = o.created_at || o.order_info?.created_at || 0;
    const t = new Date(raw).getTime();
    return isNaN(t) ? 0 : t;
  };

  if (mode === 'duplicate_ip') {
    const counts = new Map();
    result.forEach(order => {
      new Set(orderIps(order)).forEach(ip => counts.set(ip, (counts.get(ip) || 0) + 1));
    });
    result = result.filter(order => orderIps(order).some(ip => (counts.get(ip) || 0) > 1));

    const getPrimaryDuplicateIp = (order) => {
      const clientIp = cleanIdentity(order.client_ip);
      if (clientIp && (counts.get(clientIp) || 0) > 1) return clientIp;
      const webrtcIp = cleanIdentity(order.webrtc_ip);
      if (webrtcIp && (counts.get(webrtcIp) || 0) > 1) return webrtcIp;
      return clientIp || webrtcIp || 'unknown';
    };

    const groups = new Map();
    result.forEach(order => {
      const key = getPrimaryDuplicateIp(order);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
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

  if (mode === 'duplicate_fingerprint') {
    const counts = new Map();
    result.forEach(order => {
      new Set(orderTraceKeys(order)).forEach(key => counts.set(key, (counts.get(key) || 0) + 1));
    });
    result = result.filter(order => orderTraceKeys(order).some(key => (counts.get(key) || 0) > 1));

    const getPrimaryDuplicateTrace = (order) => {
      for (const key of orderTraceKeys(order)) {
        if ((counts.get(key) || 0) > 1) return key;
      }
      return orderTraceKeys(order)[0] || 'unknown';
    };

    const groups = new Map();
    result.forEach(order => {
      const key = getPrimaryDuplicateTrace(order);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(order);
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

function AdminGate({ onUnlock }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      sessionStorage.setItem('sapo_dashboard_password_v2', password);
      await verifyAdminPassword();
      onUnlock(password);
    } catch (err) {
      sessionStorage.removeItem('sapo_dashboard_password_v2');
      setError(err.response?.data?.message || 'Mat khau khong dung.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-[#E5E5EA] rounded-lg shadow-sm p-6 space-y-4">
        <div className="w-12 h-12 rounded-lg bg-[#0071E3] text-white flex items-center justify-center">
          <KeyRound className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl font-extrabold text-[#1D1D1F]">Sapo IP Guard</h1>
          <p className="text-sm text-[#6E6E73] mt-1">Nhap mat khau dashboard de quan ly don va IP.</p>
        </div>
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Mat khau dashboard"
          className="w-full h-11 rounded-lg border border-[#D1D1D6] px-3 text-sm outline-none focus:border-[#0071E3]"
        />
        {error && <div className="text-sm font-semibold text-[#FF3B30]">{error}</div>}
        <button className="w-full h-11 rounded-lg bg-[#0071E3] text-white font-bold flex items-center justify-center gap-2">
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Dang nhap
        </button>
      </form>
    </div>
  );
}

function StorePanel({ stores, selectedStoreId, setSelectedStoreId, onStoresChanged, notice, directStore, setDirectStore, dbOffline }) {
  const [form, setForm] = useState({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' });
  const [saving, setSaving] = useState(false);
  const selectedStore = stores.find(store => String(store.id) === String(selectedStoreId));
  const effectiveStore = selectedStore || directStore;
  const directFirst = dbOffline || !stores.length || selectedStoreId === 'direct';
  const trackerSnippet = effectiveStore
    ? `<script>\nwindow.SAPO_TRACKER_CONFIG = { apiKey: '${effectiveStore.api_key}' };\n</script>\n<script src="${window.location.origin}/client-tracker.js"></script>`
    : '';

  const copyTracker = async () => {
    if (!trackerSnippet) return;
    await navigator.clipboard?.writeText(trackerSnippet);
    notice('Da copy ma nhung tracker.');
  };

  const save = async () => {
    setSaving(true);
    try {
      if (selectedStore) {
        await updateStore(selectedStore.id, {
          store_name: form.store_name || selectedStore.store_name,
          mysapo_domain: form.mysapo_domain || selectedStore.mysapo_domain,
          api_key: form.api_key || selectedStore.api_key,
          api_secret: form.api_secret
        });
        notice('Da cap nhat store.');
      } else {
        await createStore(form);
        notice('Da them store.');
      }
      setForm({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' });
      await onStoresChanged();
    } catch (err) {
      notice(err.response?.data?.message || 'Khong luu duoc store.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const saveDirect = () => {
    const next = {
      id: 'direct',
      store_name: form.store_name || directStore?.store_name || 'Sapo tam thoi',
      mysapo_domain: cleanDomainInput(form.mysapo_domain || directStore?.mysapo_domain || ''),
      api_key: form.api_key || directStore?.api_key || '',
      api_secret: form.api_secret || directStore?.api_secret || ''
    };
    if (!next.mysapo_domain || !next.api_key || !next.api_secret) {
      notice('Nhap domain, API key va API secret de luu store tam.', 'error');
      return;
    }
    setDirectStore(next);
    setSelectedStoreId('direct');
    localStorage.setItem('sapo_direct_store_v1', JSON.stringify(next));
    localStorage.setItem('sapo_selected_store_id_v2', 'direct');
    setForm({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' });
    notice('Da luu store tam. Chuyen sang Don hang va bam Quet don Sapo.');
  };

  const primarySave = () => {
    if (directFirst) {
      saveDirect();
      return;
    }
    save();
  };

  return (
    <section className="bg-white border border-[#DADCE0] rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase text-[#5F6368]">Cua hang Sapo</h2>
          <p className="text-xs text-[#5F6368] mt-1">Dung de quet don va gan tracker WebRTC.</p>
        </div>
        <Store className="w-5 h-5 text-[#1A73E8]" />
      </div>
      {dbOffline && (
        <div className="rounded-lg border border-[#FAD2CF] bg-[#FCE8E6] px-3 py-2 text-xs font-bold text-[#B3261E]">
          Supabase dang het quota. Tam thoi dung che do quet truc tiep: chi lay don va IP, khong luu lich su DB.
        </div>
      )}
      <select
        value={selectedStoreId}
        onChange={(event) => setSelectedStoreId(event.target.value)}
        className="w-full h-10 rounded-lg border border-[#DADCE0] px-3 text-sm font-semibold outline-none focus:border-[#1A73E8]"
      >
        {stores.map(store => <option key={store.id} value={store.id}>{store.store_name} - {store.mysapo_domain}</option>)}
        {directStore && <option value="direct">{directStore.store_name} - {directStore.mysapo_domain} (tam thoi)</option>}
        {!stores.length && !directStore && <option value="">Chua co store</option>}
      </select>

      <div className="grid grid-cols-1 gap-2">
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="Ten store" value={form.store_name} onChange={e => setForm({ ...form, store_name: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="ten-shop.mysapo.net" value={form.mysapo_domain} onChange={e => setForm({ ...form, mysapo_domain: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="API key" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="API secret" value={form.api_secret} onChange={e => setForm({ ...form, api_secret: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <button onClick={primarySave} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#1A73E8] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {directFirst ? 'Luu tam de quet don' : (selectedStore ? 'Cap nhat' : 'Them store')}
        </button>
        {!directFirst && (
          <button onClick={saveDirect} className="h-10 px-3 rounded-lg bg-[#F1F3F4] font-bold text-sm">
            Luu tam
          </button>
        )}
        {selectedStore && (
          <button onClick={() => testStoreConnection(selectedStore.id).then(res => notice(`Ket noi OK: ${res.order_count || 0} don`)).catch(err => notice(err.response?.data?.message || 'Test loi', 'error'))} className="h-10 px-3 rounded-lg bg-[#F1F3F4] font-bold text-sm">
            Test
          </button>
        )}
      </div>
      {effectiveStore && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-[#5F6368]">Ma nhung tracker</div>
            <button onClick={copyTracker} className="h-8 px-2 rounded-lg bg-[#E8F0FE] text-[#1A73E8] text-xs font-extrabold inline-flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>
          <textarea readOnly value={trackerSnippet} className="w-full h-28 rounded-lg border border-[#DADCE0] p-3 text-xs font-mono bg-[#F8FAFD]" />
          {selectedStore ? (
            <button
              onClick={() => deleteStore(selectedStore.id).then(onStoresChanged)}
              className="text-xs font-bold text-[#D93025]"
            >
              Xoa store nay
            </button>
          ) : (
            <button
              onClick={() => {
                setDirectStore(null);
                setSelectedStoreId('');
                localStorage.removeItem('sapo_direct_store_v1');
                notice('Da xoa store tam.');
              }}
              className="text-xs font-bold text-[#D93025]"
            >
              Xoa store tam
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function OrderDetail({ order, onClose, onBlockOrder, onUnblockOrder, enableVpnAlert = false }) {
  if (!order) return null;
  const info = order.order_info || {};
  const risk = riskInfo(order, enableVpnAlert);
  const RiskIcon = risk.icon;
  const clientIpVersion = ipVersion(order.client_ip);
  const webrtcIpVersion = ipVersion(order.webrtc_ip);
  const trace = order.browser_trace || {};
  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center p-4">
      <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-lg shadow-xl border border-[#E5E5EA]">
        <div className="sticky top-0 bg-white border-b border-[#E5E5EA] p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-extrabold">Chi tiet don {info.order_id || order.id}</h2>
            <p className="text-sm text-[#6E6E73]">{formatDate(order.created_at)}</p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-lg bg-[#F2F2F7] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-[#E5E5EA] rounded-lg p-4">
            <div className="text-xs font-bold uppercase text-[#6E6E73] mb-3">Khach hang</div>
            <div className="font-extrabold">{info.customer_name || '--'}</div>
            <div className="text-sm text-[#6E6E73] mt-1">{info.phone || '--'}</div>
            <div className="text-sm text-[#6E6E73]">{info.email || '--'}</div>
            <div className="text-sm text-[#6E6E73] mt-3">Tong tien: <b>{info.total_price || '--'}</b></div>
          </div>
          <div className="border border-[#E5E5EA] rounded-lg p-4">
            <div className="text-xs font-bold uppercase text-[#6E6E73] mb-3">Danh gia IP</div>
            <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-extrabold', risk.tone === 'red' ? 'bg-[#FF3B30]/10 text-[#FF3B30]' : risk.tone === 'green' ? 'bg-[#34C759]/10 text-[#1A8F3A]' : 'bg-[#F2F2F7] text-[#6E6E73]')}>
              <RiskIcon className="w-4 h-4" />
              {risk.label}
            </div>
            <div className="mt-3 text-sm text-[#6E6E73]">{enableVpnAlert ? ((order.risk_reasons || []).join(', ') || 'Khong co canh bao.') : 'Canh bao VPN/Proxy dang tam tat.'}</div>
            <button
              onClick={() => order.is_blacklisted ? onUnblockOrder(order) : onBlockOrder(order)}
              className={cn('mt-4 h-10 px-4 rounded-lg font-extrabold text-sm inline-flex items-center gap-2', order.is_blacklisted ? 'bg-[#F1F3F4] text-[#3C4043]' : 'bg-[#FCE8E6] text-[#D93025]')}
            >
              <Ban className="w-4 h-4" />
              {order.is_blacklisted ? 'Bo chan IP' : 'Chan IP nay'}
            </button>
          </div>
          <div className="md:col-span-2 border border-[#E5E5EA] rounded-lg p-4">
            <div className="text-xs font-bold uppercase text-[#6E6E73] mb-3">IP va WebRTC</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Info label={`${connectionLabel(order, enableVpnAlert)}${clientIpVersion ? ` - ${clientIpVersion}` : ''}`} value={ipText(order.client_ip)} mono tone={isFakeConnection(order, enableVpnAlert) ? 'red' : 'gray'} />
              <Info label={`${webrtcLabel(order, enableVpnAlert)}${webrtcIpVersion ? ` - ${webrtcIpVersion}` : ''}`} value={ipText(order.webrtc_ip) + (order.webrtc_status ? ` (${order.webrtc_status})` : '')} mono tone={(enableVpnAlert && order.webrtc_mismatch) ? 'red' : 'gray'} />
              <Info label="Nuoc / Vung / Thanh pho" value={networkText(order)} />
              <Info label="ISP / To chuc / ASN" value={ispText(order)} />
              <Info label="Thoi gian user dat hang" value={formatDate(order.user_order_time || order.created_at)} />
              <Info label="Tu vao web den dat hang" value={formatDuration(order.time_to_order_sec)} />
              <Info label="Nguon tra cuu" value={order.ip_intelligence_source || '--'} />
              <Info label="Thiet bi" value={order.device_type || '--'} />
            </div>
          </div>
          <div className="md:col-span-2 border border-[#E5E5EA] rounded-lg p-4">
            <div className="text-xs font-bold uppercase text-[#6E6E73] mb-3">Dau vet trinh duyet</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Info label="Fingerprint" value={shortId(order.fingerprint)} mono />
              <Info label="Machine key" value={shortId(order.machine_key || order.device_key)} mono />
              <Info label="Device key cu" value={shortId(order.device_key)} mono />
              <Info label="Session" value={shortId(order.session_id)} mono />
              <Info label="Timezone" value={trace.timezone || '--'} />
              <Info label="Ngon ngu / Platform" value={[trace.language, trace.platform].filter(Boolean).join(' / ') || '--'} />
              <Info label="Man hinh" value={trace.screen || '--'} mono />
              <Info label="CPU / RAM / Touch" value={[trace.hardware_concurrency ? `${trace.hardware_concurrency} CPU` : '', trace.device_memory ? `${trace.device_memory}GB RAM` : '', trace.max_touch_points ? `${trace.max_touch_points} touch` : ''].filter(Boolean).join(' / ') || '--'} />
              <Info label="Webdriver" value={trace.webdriver ? 'Co dau hieu automation' : 'Khong thay'} tone={trace.webdriver ? 'red' : 'gray'} />
              <Info label="User Agent" value={order.user_agent || trace.user_agent || '--'} mono />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono = false, tone = 'gray' }) {
  return (
    <div className={cn('rounded-lg p-3', tone === 'red' ? 'bg-[#FF3B30]/10 border border-[#FF3B30]/20' : 'bg-[#F5F5F7]')}>
      <div className="text-[11px] uppercase font-bold text-[#86868B]">{label}</div>
      <div className={cn('mt-1 text-sm font-bold break-all', mono && 'font-mono', tone === 'red' && 'text-[#FF3B30]')}>{value}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone = 'blue' }) {
  const tones = {
    blue: 'bg-[#E8F0FE] text-[#1A73E8]',
    red: 'bg-[#FCE8E6] text-[#D93025]',
    green: 'bg-[#E6F4EA] text-[#188038]',
    gray: 'bg-[#F1F3F4] text-[#3C4043]'
  };
  return (
    <div className="rounded-lg border border-[#DADCE0] bg-white p-4">
      <div className="flex items-center gap-3">
        <div className={cn('w-10 h-10 rounded-lg flex items-center justify-center', tones[tone])}>
          <Icon className="w-5 h-5" />
        </div>
        <div>
          <div className="text-xs font-bold uppercase text-[#5F6368]">{label}</div>
          <div className="text-2xl font-extrabold tracking-normal text-[#202124]">{value}</div>
        </div>
      </div>
    </div>
  );
}

function BlacklistPanel({ blacklist, onAddIp, onRemoveIp }) {
  const [manualIp, setManualIp] = useState('');
  const [reason, setReason] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    await onAddIp(manualIp, reason || 'Chan thu cong tu dashboard');
    setManualIp('');
    setReason('');
  };

  return (
    <section className="bg-white border border-[#DADCE0] rounded-lg overflow-hidden">
      <div className="p-5 border-b border-[#DADCE0] flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-[#202124]">Danh sach den</h2>
          <p className="text-sm text-[#5F6368] mt-1">Danh sach nay co the chan IP, fingerprint, device key va machine key cua may.</p>
        </div>
        <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-[180px_1fr_auto] gap-2 w-full lg:max-w-2xl">
          <input
            value={manualIp}
            onChange={(event) => setManualIp(event.target.value)}
            placeholder="Nhap IP can chan"
            className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]"
          />
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Ly do"
            className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]"
          />
          <button className="h-10 px-4 rounded-lg bg-[#D93025] text-white font-extrabold inline-flex items-center justify-center gap-2">
            <Ban className="w-4 h-4" />
            Them
          </button>
        </form>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-[#F8FAFD] text-[#5F6368]">
            <tr>
              <th className="text-left p-3 font-extrabold">Loai</th>
              <th className="text-left p-3 font-extrabold">Gia tri</th>
              <th className="text-left p-3 font-extrabold">Ly do</th>
              <th className="text-left p-3 font-extrabold">Nguon</th>
              <th className="text-left p-3 font-extrabold">Thoi gian</th>
              <th className="text-right p-3 font-extrabold">Hanh dong</th>
            </tr>
          </thead>
          <tbody>
            {!blacklist.length && (
              <tr>
                <td colSpan="6" className="p-10 text-center text-[#5F6368] font-bold">Chua co dinh danh nao bi chan.</td>
              </tr>
            )}
            {blacklist.map(item => (
              <tr key={item.id || item.value || item.ip} className="border-t border-[#DADCE0]">
                <td className="p-3 font-extrabold text-[#D93025]">{item.type || 'ip'}</td>
                <td className="p-3 font-mono font-extrabold text-[#D93025]">{item.value || item.ip}</td>
                <td className="p-3 text-[#3C4043]">{item.reason || '--'}</td>
                <td className="p-3 text-[#5F6368]">{item.source || 'manual'}</td>
                <td className="p-3 font-mono text-[#5F6368]">{formatDate(item.created_at)}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => onRemoveIp(item.value || item.ip || item.id)}
                    className="h-9 px-3 rounded-lg bg-[#F1F3F4] text-[#3C4043] font-extrabold inline-flex items-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Xoa
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('sapo_dashboard_password_v2') || '');
  const [stores, setStores] = useState([]);
  const [directStore, setDirectStore] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('sapo_direct_store_v1') || 'null');
    } catch (_) {
      return null;
    }
  });
  const [selectedStoreId, setSelectedStoreId] = useState(() => localStorage.getItem('sapo_selected_store_id_v2') || '');
  const [preset, setPreset] = useState('TODAY');
  const [search, setSearch] = useState('');
  const [filterMode, setFilterMode] = useState('all');
  const [orders, setOrders] = useState(() => {
    try {
      const saved = sessionStorage.getItem('sapo_direct_orders_v1');
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });
  const [blacklist, setBlacklist] = useState([]);
  const [activeView, setActiveView] = useState('orders');
  const [pagination, setPagination] = useState({ page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [compacting, setCompacting] = useState(false);
  const [dbOffline, setDbOffline] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [enableVpnAlert, setEnableVpnAlert] = useState(() => {
    const saved = localStorage.getItem('sapo_enable_vpn_alert_v1');
    return saved !== null ? saved === 'true' : DEFAULT_ENABLE_VPN_ALERT;
  });

  const selectedStore = selectedStoreId === 'direct'
    ? directStore
    : stores.find(store => String(store.id) === String(selectedStoreId));
  const activePreset = DATE_PRESETS[preset];

  const notify = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    setTimeout(() => setNotice(null), 4500);
  }, []);

  const loadStores = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await getStores();
      if (res.success) {
        setStores(res.data);
        setDbOffline(false);
        if (!selectedStoreId && res.data[0]) {
          setSelectedStoreId(String(res.data[0].id));
          localStorage.setItem('sapo_selected_store_id_v2', String(res.data[0].id));
        }
      }
    } catch (err) {
      setStores([]);
      if (isQuotaError(err)) {
        setDbOffline(true);
        if (directStore) {
          setSelectedStoreId('direct');
          localStorage.setItem('sapo_selected_store_id_v2', 'direct');
        }
        if (!directStore) notify('Supabase dang bi khoa quota. Bam Luu tam de quet don truc tiep.', 'error');
      } else if (!directStore) {
        notify(err.response?.data?.message || 'Khong tai duoc store.', 'error');
      }
    }
  }, [adminKey, selectedStoreId, directStore, notify]);

  const loadBlacklist = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await getBlacklist();
      if (res.success) setBlacklist(res.data || []);
    } catch (_) {
      setBlacklist([]);
    }
  }, [adminKey]);

  const loadOrders = useCallback(async (page = pagination.page, overrides = {}) => {
    if (!adminKey) return;
    if (selectedStoreId === 'direct') {
      setPagination(current => ({ ...current, page: Math.max(1, page) }));
      return;
    }
    const effectiveSearch = overrides.search ?? search;
    const effectiveFilterMode = overrides.filterMode ?? filterMode;
    setLoading(true);
    try {
      const res = await getOrders({
        page,
        limit: PAGE_SIZE,
        store_id: selectedStoreId || 'ALL',
        startDate: activePreset.start(),
        endDate: activePreset.end(),
        search: effectiveSearch,
        filterMode: effectiveFilterMode
      });
      setOrders(res.data || []);
      setPagination(res.pagination || { page, limit: PAGE_SIZE, total: 0, totalPages: 1 });
    } catch (err) {
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_dashboard_password_v2');
        setAdminKey('');
      } else {
        if (isQuotaError(err)) setDbOffline(true);
        notify(err.response?.data?.message || 'Khong tai duoc don hang.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [adminKey, activePreset, pagination.page, search, selectedStoreId, filterMode, notify]);

  const runSync = async () => {
    if (!selectedStore) {
      notify('Hay chon store truoc khi quet.', 'error');
      return;
    }
    setSyncing(true);
    try {
      const effectivePreset = DATE_PRESETS[preset];
      const res = selectedStoreId === 'direct'
        ? await syncStoreOrdersDirect(selectedStore, preset)
        : await syncStoreOrders(selectedStore.id, {
          datePreset: preset,
          page: 1,
          limit: PAGE_SIZE,
          startDate: effectivePreset.start(),
          endDate: effectivePreset.end(),
          search: '',
          filterMode: 'all'
        });
      setActiveView('orders');
      setFilterMode('all');
      setSearch('');
      const totalCount = res.total_orders ?? res.all_orders?.length ?? (res.orders?.pagination?.total || 0);
      notify(res.direct_mode
        ? `Da quet thanh cong ${totalCount} don tu Sapo (Direct mode).`
        : `Da quet ${totalCount} don. Dang hien tat ca don.`);
      if (res.direct_mode && Array.isArray(res.all_orders)) {
        setOrders(res.all_orders);
        try {
          sessionStorage.setItem('sapo_direct_orders_v1', JSON.stringify(res.all_orders));
        } catch (_) {}
        setPagination({
          page: 1,
          limit: PAGE_SIZE,
          total: res.all_orders.length,
          totalPages: Math.max(1, Math.ceil(res.all_orders.length / PAGE_SIZE))
        });
      } else if (res.orders) {
        setOrders(res.orders.data || []);
        setPagination(res.orders.pagination || { page: 1, limit: PAGE_SIZE, total: 0, totalPages: 1 });
      } else {
        await loadOrders(1, { filterMode: 'all', search: '' });
      }
    } catch (err) {
      notify(err.response?.data?.message || 'Quet don that bai.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const blockOrder = async (order) => {
    const ips = [order.client_ip, order.webrtc_ip].filter(value => value && !['unknown', '--', 'not_available'].includes(String(value).toLowerCase()));
    const targets = [
      ...[...new Set(ips)].map(ip => ({ type: 'ip', value: ip })),
      order.fingerprint ? { type: 'fingerprint', value: order.fingerprint } : null,
      order.machine_key ? { type: 'machine_key', value: order.machine_key } : null,
      order.device_key ? { type: 'device_key', value: order.device_key } : null
    ].filter(Boolean);
    if (!targets.length) {
      notify('Don nay chua co IP/dau vet hop le de chan.', 'error');
      return;
    }
    try {
      await Promise.all(targets.map(target => addToBlacklist(target, `Chan tu don ${order.order_info?.order_id || order.id}`)));
      notify(`Da chan ${targets.length} dinh danh: IP + dau vet may + machine key. Doi IP van se bi chan neu trung dau vet.`);
      await loadBlacklist();
      setOrders(current => current.map(item => item.id === order.id ? { ...item, is_blacklisted: true } : item));
    } catch (err) {
      notify(err.response?.data?.message || 'Khong chan duoc dinh danh.', 'error');
    }
  };

  const unblockOrder = async (order) => {
    const ips = [order.client_ip, order.webrtc_ip].filter(value => value && !['unknown', '--', 'not_available'].includes(String(value).toLowerCase()));
    const identities = [...ips, order.fingerprint, order.machine_key, order.device_key].filter(Boolean);
    try {
      await Promise.all([...new Set(identities)].map(removeFromBlacklist));
      notify('Da bo chan IP/dau vet cua don nay.');
      await loadBlacklist();
      setOrders(current => current.map(item => item.id === order.id ? { ...item, is_blacklisted: false } : item));
    } catch (err) {
      notify(err.response?.data?.message || 'Khong bo chan duoc IP.', 'error');
    }
  };

  const addManualBlacklist = async (ip, reason) => {
    try {
      await addToBlacklist(ip, reason);
      notify('Da them IP vao danh sach den.');
      await loadBlacklist();
    } catch (err) {
      notify(err.response?.data?.message || 'Khong them duoc IP.', 'error');
    }
  };

  const removeBlacklistIp = async (ip) => {
    try {
      await removeFromBlacklist(ip);
      notify('Da xoa IP khoi danh sach den.');
      await loadBlacklist();
    } catch (err) {
      notify(err.response?.data?.message || 'Khong xoa duoc IP.', 'error');
    }
  };

  const runCompactStorage = async () => {
    if (dbOffline) {
      notify('Supabase dang bi khoa quota nen chua don du lieu duoc. Hay dung quet truc tiep truoc.', 'error');
      return;
    }
    setCompacting(true);
    try {
      const res = await compactStorage();
      notify(`Da don Supabase: don ${res.before_orders || 0} -> ${res.after_orders || 0}, log ${res.before_logs || 0} -> ${res.after_logs || 0}.`);
      await loadOrders(1);
    } catch (err) {
      notify(err.response?.data?.message || 'Khong don duoc du lieu Supabase.', 'error');
    } finally {
      setCompacting(false);
    }
  };

  useEffect(() => {
    loadStores().catch(() => {});
  }, [loadStores]);

  useEffect(() => {
    if (adminKey) {
      loadOrders(1);
      loadBlacklist().catch(() => {});
    }
  }, [adminKey]);

  useEffect(() => {
    if (dbOffline && directStore && selectedStoreId !== 'direct') {
      setSelectedStoreId('direct');
      localStorage.setItem('sapo_selected_store_id_v2', 'direct');
    }
  }, [dbOffline, directStore, selectedStoreId]);

  useEffect(() => {
    localStorage.setItem('sapo_selected_store_id_v2', selectedStoreId || '');
  }, [selectedStoreId]);

  const summary = useMemo(() => {
    const high = enableVpnAlert ? orders.filter(order => order.risk_level === 'HIGH_RISK').length : 0;
    const webrtc = orders.filter(order => order.webrtc_ip).length;
    const blocked = orders.filter(order => order.is_blacklisted).length;
    return { high, webrtc, blocked };
  }, [orders, enableVpnAlert]);

  const isDirect = selectedStoreId === 'direct';
  const displayedOrders = useMemo(() => filterOrdersLocal(orders, filterMode, search), [orders, filterMode, search]);

  const totalOrdersCount = isDirect ? displayedOrders.length : (pagination.total || 0);
  const totalPagesCount = isDirect ? Math.max(1, Math.ceil(displayedOrders.length / PAGE_SIZE)) : (pagination.totalPages || 1);
  const currentPage = isDirect ? Math.min(Math.max(1, pagination.page), totalPagesCount) : (pagination.page || 1);

  const currentTableRows = useMemo(() => {
    if (isDirect) {
      const start = (currentPage - 1) * PAGE_SIZE;
      return displayedOrders.slice(start, start + PAGE_SIZE);
    }
    return displayedOrders;
  }, [isDirect, displayedOrders, currentPage]);

  const handlePrevPage = () => {
    if (isDirect) {
      setPagination(p => ({ ...p, page: Math.max(1, currentPage - 1) }));
    } else {
      loadOrders(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (isDirect) {
      setPagination(p => ({ ...p, page: Math.min(totalPagesCount, currentPage + 1) }));
    } else {
      loadOrders(currentPage + 1);
    }
  };

  if (!adminKey) return <AdminGate onUnlock={setAdminKey} />;

  return (
    <div className="min-h-screen bg-[#F8FAFD] text-[#202124] font-sans">
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur border-b border-[#DADCE0]">
        <div className="max-w-[1680px] mx-auto px-4 py-3 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-lg bg-[#1A73E8] text-white flex items-center justify-center shrink-0"><ShieldCheck className="w-6 h-6" /></div>
            <div>
              <h1 className="text-lg font-extrabold">Sapo IP Guard Clean</h1>
              <p className="text-xs text-[#5F6368]">Quet don, IP ket noi va IP WebRTC</p>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <nav className="inline-flex items-center gap-1 rounded-lg bg-[#F1F3F4] p-1">
              {[
                { key: 'orders', label: 'Don hang', icon: Database },
                { key: 'blacklist', label: 'Danh sach den', icon: Ban },
                { key: 'settings', label: 'Cai dat', icon: Settings }
              ].map(item => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => setActiveView(item.key)}
                    className={cn('h-9 px-3 rounded-lg text-sm font-extrabold inline-flex items-center gap-2', activeView === item.key ? 'bg-white text-[#1A73E8] shadow-sm' : 'text-[#3C4043]')}
                  >
                    <Icon className="w-4 h-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
            <button
              onClick={() => { sessionStorage.removeItem('sapo_dashboard_password_v2'); setAdminKey(''); }}
              className="h-10 px-3 rounded-lg bg-[#F1F3F4] text-sm font-bold inline-flex items-center justify-center gap-2"
            >
              <KeyRound className="w-4 h-4" />
              Khoa
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={cn('fixed top-20 right-4 z-50 max-w-md rounded-lg px-4 py-3 text-sm font-bold shadow-lg', notice.type === 'error' ? 'bg-[#FFEDEC] text-[#B42318]' : 'bg-[#E9F8EF] text-[#147A3D]')}>
          {notice.message}
        </div>
      )}

      <main className="max-w-[1680px] mx-auto p-4 space-y-4">
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          <StatCard icon={Database} label="Don dang hien" value={totalOrdersCount} />
          <StatCard icon={ShieldAlert} label="Canh bao" value={summary.high} tone={summary.high > 0 ? 'red' : 'gray'} />
          <StatCard icon={Wifi} label="Co WebRTC" value={summary.webrtc} tone="blue" />
          <StatCard icon={Ban} label="Da chan" value={summary.blocked} tone="red" />
          <StatCard icon={ListFilter} label="Blacklist" value={blacklist.length} tone="gray" />
        </section>

        {activeView === 'settings' && (
          <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
            <StorePanel
              stores={stores}
              selectedStoreId={selectedStoreId}
              setSelectedStoreId={setSelectedStoreId}
              onStoresChanged={loadStores}
              notice={notify}
              directStore={directStore}
              setDirectStore={setDirectStore}
              dbOffline={dbOffline}
            />
            <section className="bg-white border border-[#DADCE0] rounded-lg p-5">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-lg bg-[#E8F0FE] text-[#1A73E8] flex items-center justify-center">
                  <Clipboard className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-xl font-extrabold">Cai dat van hanh</h2>
                  <p className="text-sm text-[#5F6368]">Quet don chi chay khi bam nut, tracker tu ghi IP va WebRTC tren shop.</p>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Info label="Preset hien tai" value={DATE_PRESETS[preset].label} />
                <Info label="Store dang chon" value={selectedStore?.store_name || '--'} />
                <Info label="Domain" value={selectedStore?.mysapo_domain || '--'} mono />
                <Info
                  label="Trang thai tracker"
                  value={selectedStore ? (selectedStoreId === 'direct' ? 'Quet truc tiep, khong luu Supabase' : 'San sang nhung vao theme') : 'Chua co store'}
                  tone={selectedStore ? 'gray' : 'red'}
                />
                <div className="md:col-span-2 rounded-lg border border-[#DADCE0] p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="font-extrabold text-[#1D1D1F] flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-[#5F6368]" />
                      Canh bao rui ro IP (VPN / Proxy / Datacenter)
                    </div>
                    <p className="mt-1 text-sm text-[#5F6368]">
                      {enableVpnAlert
                        ? 'Dang BAT: Cac don dung VPN, Proxy hoac Datacenter se duoc lam noi bat mau do va tinh vao muc Canh bao.'
                        : 'Dang TAT: Tat ca don deu hien thi cung 1 mau chuan an toan, khong boi do.'}
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      const next = !enableVpnAlert;
                      setEnableVpnAlert(next);
                      localStorage.setItem('sapo_enable_vpn_alert_v1', String(next));
                      notify(next ? 'Da bat canh bao mau do cho VPN/Proxy.' : 'Da tat canh bao mau do cho VPN/Proxy (tat ca don cung 1 mau).');
                    }}
                    className={cn(
                      'h-10 px-4 rounded-lg font-extrabold text-sm inline-flex items-center justify-center gap-2 shrink-0 transition-all text-white',
                      enableVpnAlert ? 'bg-[#D93025] hover:bg-[#C5221F]' : 'bg-[#188038] hover:bg-[#137333]'
                    )}
                  >
                    {enableVpnAlert ? 'Tat canh bao do' : 'Bat canh bao do'}
                  </button>
                </div>
                <div className="md:col-span-2 rounded-lg border border-[#DADCE0] p-4">
                  <div className="font-extrabold">Toi uu Supabase</div>
                  <p className="mt-1 text-sm text-[#5F6368]">
                    {dbOffline
                      ? 'Dang tam dung vi Supabase het quota. Khi quota reset moi chay duoc.'
                      : 'Xoa log legacy va cat bot blob don cu. Nut nay chi chay khi bam.'}
                  </p>
                  <button
                    onClick={runCompactStorage}
                    disabled={compacting || dbOffline}
                    className="mt-3 h-10 px-4 rounded-lg bg-[#188038] text-white font-extrabold inline-flex items-center gap-2 disabled:opacity-60"
                  >
                    {compacting ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Don du lieu Supabase
                  </button>
                </div>
              </div>
            </section>
          </div>
        )}

        {activeView === 'blacklist' && (
          <BlacklistPanel
            blacklist={blacklist}
            onAddIp={addManualBlacklist}
            onRemoveIp={removeBlacklistIp}
          />
        )}

        {activeView === 'orders' && (
          <section className="bg-white border border-[#DADCE0] rounded-lg overflow-hidden">
            <div className="p-4 border-b border-[#DADCE0] space-y-3">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-extrabold">Danh sach don hang</h2>
                  <p className="text-sm text-[#5F6368]">Data chi cap nhat khi bam nut quet don.</p>
                </div>
                <button
                  onClick={runSync}
                  disabled={syncing}
                  className="h-11 px-4 rounded-lg bg-[#188038] text-white font-extrabold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                  Quet don Sapo
                </button>
              </div>
              <div className="flex flex-col xl:flex-row gap-3">
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {Object.entries(DATE_PRESETS).map(([key, item]) => (
                    <button
                      key={key}
                      onClick={() => {
                        setPreset(key);
                        setPagination(p => ({ ...p, page: 1 }));
                      }}
                      className={cn('h-10 px-4 rounded-lg text-sm font-extrabold inline-flex items-center gap-2 whitespace-nowrap', preset === key ? 'bg-[#1A73E8] text-white' : 'bg-[#F1F3F4] text-[#202124]')}
                    >
                      <Calendar className="w-4 h-4" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-[#5F6368]" />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setPagination(p => ({ ...p, page: 1 }));
                    }}
                    onKeyDown={(event) => { if (event.key === 'Enter') loadOrders(1); }}
                    placeholder="Tim ma don, ten, phone, IP, ISP..."
                    className="w-full h-10 rounded-lg border border-[#DADCE0] pl-9 pr-3 text-sm outline-none focus:border-[#1A73E8]"
                  />
                </div>
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {FILTER_MODES.map(item => (
                    <button
                      key={item.key}
                      onClick={() => {
                        setFilterMode(item.key);
                        setPagination(p => ({ ...p, page: 1 }));
                      }}
                      className={cn('h-10 px-3 rounded-lg text-sm font-extrabold inline-flex items-center gap-2 whitespace-nowrap', filterMode === item.key ? 'bg-[#E8F0FE] text-[#1A73E8] border border-[#AECBFA]' : 'bg-[#F1F3F4] text-[#3C4043] border border-transparent')}
                    >
                      <ListFilter className="w-4 h-4" />
                      {item.label}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => {
                    const next = !enableVpnAlert;
                    setEnableVpnAlert(next);
                    localStorage.setItem('sapo_enable_vpn_alert_v1', String(next));
                    notify(next ? 'Da bat canh bao mau do cho VPN/Proxy.' : 'Da tat canh bao mau do cho VPN/Proxy (tat ca don cung 1 mau).');
                  }}
                  className={cn(
                    'h-10 px-3 rounded-lg text-sm font-extrabold inline-flex items-center gap-2 whitespace-nowrap border transition-all',
                    enableVpnAlert
                      ? 'bg-[#FCE8E6] text-[#D93025] border-[#F5C2C7]'
                      : 'bg-[#F1F3F4] text-[#5F6368] border-transparent hover:text-[#1D1D1F]'
                  )}
                  title="Bat/Tat canh bao mau do cho don hang dung VPN, Proxy hoac Datacenter"
                >
                  <ShieldAlert className="w-4 h-4" />
                  {enableVpnAlert ? 'Canh bao VPN: Bat' : 'Canh bao VPN: Tat'}
                </button>
                <button onClick={() => loadOrders(1)} className="h-10 px-4 rounded-lg bg-[#F1F3F4] font-bold text-sm inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Tai lai
                </button>
              </div>
              {filterMode === 'duplicate_ip' && (
                <div className="rounded-lg border border-[#AECBFA] bg-[#E8F0FE] px-3 py-2 text-sm font-bold text-[#1A73E8] flex flex-wrap items-center justify-between gap-2">
                  <span>Dang loc <strong>Trung IP</strong>: Cac don co cung dia chi IP duoc xep dung lien tiep nhau de ban de doi chieu va xu ly.</span>
                  <span className="text-xs font-semibold bg-white px-2 py-0.5 rounded text-[#1A73E8] border border-[#AECBFA]">Nhom theo tung dia chi IP</span>
                </div>
              )}
              {filterMode === 'duplicate_fingerprint' && (
                <div className="rounded-lg border border-[#AECBFA] bg-[#E8F0FE] px-3 py-2 text-sm font-bold text-[#1A73E8] flex flex-wrap items-center justify-between gap-2">
                  <span>Dang loc <strong>Trung dau vet</strong>: Cac don co cung thiet bi / dau vet duoc xep dung lien tiep nhau.</span>
                  <span className="text-xs font-semibold bg-white px-2 py-0.5 rounded text-[#1A73E8] border border-[#AECBFA]">Nhom theo dau vet thiet bi</span>
                </div>
              )}
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[1180px] text-sm">
                <thead className="bg-[#F8FAFD] text-[#5F6368]">
                  <tr>
                    <th className="text-left p-3 font-extrabold">Thoi gian</th>
                    <th className="text-left p-3 font-extrabold">Don & khach</th>
                    <th className="text-left p-3 font-extrabold">IP ket noi</th>
                    <th className="text-left p-3 font-extrabold">IP WebRTC</th>
                    <th className="text-left p-3 font-extrabold">Vi tri / ISP</th>
                    <th className="text-left p-3 font-extrabold">Trang thai</th>
                    <th className="text-right p-3 font-extrabold">Chi tiet</th>
                    <th className="text-right p-3 font-extrabold">Chan IP</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && (
                    <tr><td colSpan="8" className="p-10 text-center text-[#5F6368] font-bold"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Dang tai...</td></tr>
                  )}
                  {!loading && currentTableRows.length === 0 && (
                    <tr><td colSpan="8" className="p-10 text-center text-[#5F6368] font-bold">Chua co don trong khoang nay. Bam Quet don Sapo.</td></tr>
                  )}
                  {!loading && currentTableRows.map((order, index) => {
                    const info = order.order_info || {};
                    const risk = riskInfo(order, enableVpnAlert);
                    const RiskIcon = risk.icon;
                    const clientIpVersion = ipVersion(order.client_ip);
                    const webrtcIpVersion = ipVersion(order.webrtc_ip);
                    const isDupMode = filterMode === 'duplicate_ip' || filterMode === 'duplicate_fingerprint';
                    const isGroupBoundary = isDupMode && index > 0 && order._dup_is_first_in_group;
                    const isGroupAlt = isDupMode && (order._dup_group_index % 2 === 1);
                    return (
                      <tr
                        key={order.id}
                        className={cn(
                          'border-t hover:bg-[#F8FAFD]',
                          isGroupBoundary ? 'border-t-2 border-[#1A73E8]/40' : 'border-[#DADCE0]',
                          isGroupAlt ? 'bg-[#F8FAFD]/60' : 'bg-white',
                          ((enableVpnAlert && order.risk_level === 'HIGH_RISK') || order.is_blacklisted) && 'bg-[#FCE8E6]/45 hover:bg-[#FCE8E6]/60'
                        )}
                      >
                        <td className="p-3 font-mono font-bold whitespace-nowrap">{formatDate(order.created_at)}</td>
                        <td className="p-3">
                          <div className="font-extrabold text-[#1A73E8]">{info.order_id || order.id}</div>
                          <div className="font-bold">{info.customer_name || '--'}</div>
                          <div className="text-xs text-[#5F6368]">{info.phone || '--'}</div>
                          <div className="mt-1 flex items-center gap-1.5 text-[11px] font-mono text-[#5F6368] flex-wrap">
                            <span>MK: {shortId(order.machine_key || order.device_key || order.fingerprint)}</span>
                            {filterMode === 'duplicate_fingerprint' && order._dup_group_count > 1 && (
                              <span className="shrink-0 rounded-full bg-[#E8F0FE] text-[#1A73E8] border border-[#AECBFA] px-1.5 py-0.2 text-[9px] font-extrabold">
                                Trung {order._dup_group_count} don
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className={cn('inline-flex max-w-[260px] items-center gap-2 rounded-lg px-2.5 py-1 font-mono font-extrabold', isFakeConnection(order, enableVpnAlert) ? 'bg-[#FCE8E6] text-[#D93025]' : 'bg-[#F1F3F4]')}>
                            <Wifi className={cn('w-4 h-4', isFakeConnection(order, enableVpnAlert) ? 'text-[#D93025]' : 'text-[#1A73E8]')} />
                            <span className="truncate">{ipText(order.client_ip)}</span>
                            {clientIpVersion && <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-extrabold">{clientIpVersion}</span>}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            <span className={cn('text-[11px] font-bold', isFakeConnection(order, enableVpnAlert) ? 'text-[#D93025]' : 'text-[#5F6368]')}>{connectionLabel(order, enableVpnAlert)}</span>
                            {filterMode === 'duplicate_ip' && order._dup_group_count > 1 && (
                              <span className="shrink-0 rounded-full bg-[#E8F0FE] text-[#1A73E8] border border-[#AECBFA] px-2 py-0.2 text-[10px] font-extrabold">
                                Trung {order._dup_group_count} don
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3">
                          <div className="flex max-w-[240px] items-center gap-2">
                            <span className={cn('font-mono font-extrabold truncate', (enableVpnAlert && order.webrtc_mismatch) && 'text-[#D93025]')}>{ipText(order.webrtc_ip)}</span>
                            {webrtcIpVersion && <span className="shrink-0 rounded bg-[#F1F3F4] px-1.5 py-0.5 text-[10px] font-extrabold text-[#5F6368]">{webrtcIpVersion}</span>}
                          </div>
                          <div className={cn('text-xs', (enableVpnAlert && order.webrtc_mismatch) ? 'text-[#D93025] font-bold' : 'text-[#5F6368]')}>{webrtcLabel(order, enableVpnAlert)}</div>
                        </td>
                        <td className="p-3 max-w-[280px]">
                          <div className="font-bold truncate flex items-center gap-1"><Globe2 className="w-4 h-4 shrink-0" />{networkText(order)}</div>
                          <div className="text-xs text-[#5F6368] truncate">{ispText(order)}</div>
                        </td>
                        <td className="p-3">
                          <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 font-extrabold text-xs', risk.tone === 'red' ? 'bg-[#FCE8E6] text-[#D93025]' : risk.tone === 'green' ? 'bg-[#E6F4EA] text-[#188038]' : 'bg-[#F1F3F4] text-[#5F6368]')}>
                            <RiskIcon className="w-4 h-4" />
                            {risk.label}
                          </div>
                        </td>
                        <td className="p-3 text-right">
                          <button onClick={() => setSelectedOrder(order)} className="h-9 px-3 rounded-lg bg-[#E8F0FE] text-[#1A73E8] font-extrabold inline-flex items-center gap-1">
                            <Eye className="w-4 h-4" />
                            Xem
                          </button>
                        </td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => order.is_blacklisted ? unblockOrder(order) : blockOrder(order)}
                            className={cn('h-9 px-3 rounded-lg font-extrabold inline-flex items-center gap-1', order.is_blacklisted ? 'bg-[#F1F3F4] text-[#3C4043]' : 'bg-[#FCE8E6] text-[#D93025]')}
                          >
                            <Ban className="w-4 h-4" />
                            {order.is_blacklisted ? 'Bo chan' : 'Chan'}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="p-4 border-t border-[#DADCE0] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <button
                disabled={currentPage <= 1 || loading}
                onClick={handlePrevPage}
                className="h-9 px-4 rounded-lg bg-[#F1F3F4] font-bold text-sm inline-flex items-center gap-1.5 transition-all disabled:opacity-40 hover:bg-[#E8EAED]"
              >
                <ChevronLeft className="w-4 h-4" />
                Truoc
              </button>
              <div className="text-sm font-bold text-[#5F6368] text-center">
                Trang {currentPage} / {totalPagesCount} — Tong {totalOrdersCount} don ({totalOrdersCount === 0 ? '0 don' : `Hien thi ${(currentPage - 1) * PAGE_SIZE + 1}–${Math.min(currentPage * PAGE_SIZE, totalOrdersCount)}`})
              </div>
              <button
                disabled={currentPage >= totalPagesCount || loading}
                onClick={handleNextPage}
                className="h-9 px-4 rounded-lg bg-[#F1F3F4] font-bold text-sm inline-flex items-center gap-1.5 transition-all disabled:opacity-40 hover:bg-[#E8EAED]"
              >
                Sau
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </section>
        )}
      </main>

      <OrderDetail
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onBlockOrder={blockOrder}
        onUnblockOrder={unblockOrder}
        enableVpnAlert={enableVpnAlert}
      />
    </div>
  );
}
