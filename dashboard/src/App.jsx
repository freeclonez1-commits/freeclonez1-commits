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
  getBlacklist,
  getOrders,
  getStores,
  removeFromBlacklist,
  syncStoreOrders,
  testStoreConnection,
  updateStore,
  verifyAdminPassword
} from './api/client';

const DATE_PRESETS = {
  TODAY: { label: 'Hom nay', start: () => businessDate(), end: () => businessDate(), limit: 30 },
  '7_DAYS': { label: '7 ngay', start: () => businessDateDaysAgo(6), end: () => businessDate(), limit: 60 },
  '30_DAYS': { label: '30 ngay', start: () => businessDateDaysAgo(29), end: () => businessDate(), limit: 80 }
};

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

function isFakeConnection(order) {
  return Boolean(order.risk_level === 'HIGH_RISK' && (order.webrtc_mismatch || order.is_vpn || order.is_proxy || order.is_datacenter || order.is_tor || order.is_abuser));
}

function connectionLabel(order) {
  if (order.webrtc_mismatch) return 'IP ket noi / VPN fake';
  if (order.is_vpn || order.is_proxy) return 'IP VPN / Proxy';
  if (order.is_datacenter) return 'IP Datacenter';
  if (order.risk_level === 'UNKNOWN') return 'IP chua du lieu';
  return 'IP ket noi';
}

function webrtcLabel(order) {
  if (!order.webrtc_ip) {
    if (order.webrtc_status === 'not_supported') return 'Trinh duyet khong ho tro WebRTC';
    if (order.webrtc_status === 'error') return 'Loi kiem tra WebRTC';
    if (order.webrtc_status === 'invalid_candidate') return 'Candidate WebRTC khong phai IP';
    if (order.is_vpn || order.is_proxy || order.is_datacenter) return 'VPN/trinh duyet khong leak IP goc';
    return 'Khong leak IP WebRTC';
  }
  if (order.webrtc_mismatch) return 'IP WebRTC / IP goc bi lo';
  if (samePublicIp(order.client_ip, order.webrtc_ip) && (order.is_vpn || order.is_proxy || order.is_datacenter)) {
    return 'WebRTC trung IP VPN, khong lo IP goc';
  }
  return 'IP WebRTC trung IP ket noi';
}

function riskInfo(order) {
  if (order.is_blacklisted) return { tone: 'red', label: 'Da chan IP', icon: Ban };
  if (order.risk_level === 'HIGH_RISK') {
    if (order.webrtc_mismatch) return { tone: 'red', label: 'Fake IP: lech WebRTC', icon: ShieldAlert };
    if (order.is_vpn || order.is_proxy) return { tone: 'red', label: 'VPN / Proxy', icon: ShieldAlert };
    if (order.is_datacenter) return { tone: 'red', label: 'Datacenter', icon: ShieldAlert };
    return { tone: 'red', label: 'Canh bao IP', icon: ShieldAlert };
  }
  if (order.risk_level === 'CLEAN') return { tone: 'green', label: 'IP an toan', icon: ShieldCheck };
  return { tone: 'gray', label: 'Da ghi nhan IP', icon: AlertTriangle };
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

function StorePanel({ stores, selectedStoreId, setSelectedStoreId, onStoresChanged, notice }) {
  const [form, setForm] = useState({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' });
  const [saving, setSaving] = useState(false);
  const selectedStore = stores.find(store => String(store.id) === String(selectedStoreId));
  const trackerSnippet = selectedStore
    ? `<script>\nwindow.SAPO_TRACKER_CONFIG = { apiKey: '${selectedStore.api_key}' };\n</script>\n<script src="${window.location.origin}/client-tracker.js"></script>`
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

  return (
    <section className="bg-white border border-[#DADCE0] rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase text-[#5F6368]">Cua hang Sapo</h2>
          <p className="text-xs text-[#5F6368] mt-1">Dung de quet don va gan tracker WebRTC.</p>
        </div>
        <Store className="w-5 h-5 text-[#1A73E8]" />
      </div>
      <select
        value={selectedStoreId}
        onChange={(event) => setSelectedStoreId(event.target.value)}
        className="w-full h-10 rounded-lg border border-[#DADCE0] px-3 text-sm font-semibold outline-none focus:border-[#1A73E8]"
      >
        {stores.map(store => <option key={store.id} value={store.id}>{store.store_name} - {store.mysapo_domain}</option>)}
        {!stores.length && <option value="">Chua co store</option>}
      </select>

      <div className="grid grid-cols-1 gap-2">
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="Ten store" value={form.store_name} onChange={e => setForm({ ...form, store_name: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="ten-shop.mysapo.net" value={form.mysapo_domain} onChange={e => setForm({ ...form, mysapo_domain: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="API key" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#DADCE0] px-3 text-sm outline-none focus:border-[#1A73E8]" placeholder="API secret" value={form.api_secret} onChange={e => setForm({ ...form, api_secret: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#1A73E8] text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {selectedStore ? 'Cap nhat' : 'Them store'}
        </button>
        {selectedStore && (
          <button onClick={() => testStoreConnection(selectedStore.id).then(res => notice(`Ket noi OK: ${res.order_count || 0} don`)).catch(err => notice(err.response?.data?.message || 'Test loi', 'error'))} className="h-10 px-3 rounded-lg bg-[#F1F3F4] font-bold text-sm">
            Test
          </button>
        )}
      </div>
      {selectedStore && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <div className="text-xs font-bold text-[#5F6368]">Ma nhung tracker</div>
            <button onClick={copyTracker} className="h-8 px-2 rounded-lg bg-[#E8F0FE] text-[#1A73E8] text-xs font-extrabold inline-flex items-center gap-1">
              <Copy className="w-3.5 h-3.5" />
              Copy
            </button>
          </div>
          <textarea readOnly value={trackerSnippet} className="w-full h-28 rounded-lg border border-[#DADCE0] p-3 text-xs font-mono bg-[#F8FAFD]" />
          <button
            onClick={() => deleteStore(selectedStore.id).then(onStoresChanged)}
            className="text-xs font-bold text-[#D93025]"
          >
            Xoa store nay
          </button>
        </div>
      )}
    </section>
  );
}

function OrderDetail({ order, onClose, onBlockOrder, onUnblockOrder }) {
  if (!order) return null;
  const info = order.order_info || {};
  const risk = riskInfo(order);
  const RiskIcon = risk.icon;
  const clientIpVersion = ipVersion(order.client_ip);
  const webrtcIpVersion = ipVersion(order.webrtc_ip);
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
            <div className="mt-3 text-sm text-[#6E6E73]">{(order.risk_reasons || []).join(', ') || 'Khong co canh bao.'}</div>
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
              <Info label={`${connectionLabel(order)}${clientIpVersion ? ` - ${clientIpVersion}` : ''}`} value={ipText(order.client_ip)} mono tone={isFakeConnection(order) ? 'red' : 'gray'} />
              <Info label={`${webrtcLabel(order)}${webrtcIpVersion ? ` - ${webrtcIpVersion}` : ''}`} value={ipText(order.webrtc_ip) + (order.webrtc_status ? ` (${order.webrtc_status})` : '')} mono tone={order.webrtc_mismatch ? 'red' : 'gray'} />
              <Info label="Nuoc / Vung / Thanh pho" value={networkText(order)} />
              <Info label="ISP / To chuc / ASN" value={ispText(order)} />
              <Info label="Nguon tra cuu" value={order.ip_intelligence_source || '--'} />
              <Info label="Thiet bi" value={order.device_type || '--'} />
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
          <p className="text-sm text-[#5F6368] mt-1">IP trong danh sach nay se bi tracker chan khi truy cap shop.</p>
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
              <th className="text-left p-3 font-extrabold">IP</th>
              <th className="text-left p-3 font-extrabold">Ly do</th>
              <th className="text-left p-3 font-extrabold">Nguon</th>
              <th className="text-left p-3 font-extrabold">Thoi gian</th>
              <th className="text-right p-3 font-extrabold">Hanh dong</th>
            </tr>
          </thead>
          <tbody>
            {!blacklist.length && (
              <tr>
                <td colSpan="5" className="p-10 text-center text-[#5F6368] font-bold">Chua co IP nao bi chan.</td>
              </tr>
            )}
            {blacklist.map(item => (
              <tr key={item.id || item.ip} className="border-t border-[#DADCE0]">
                <td className="p-3 font-mono font-extrabold text-[#D93025]">{item.ip}</td>
                <td className="p-3 text-[#3C4043]">{item.reason || '--'}</td>
                <td className="p-3 text-[#5F6368]">{item.source || 'manual'}</td>
                <td className="p-3 font-mono text-[#5F6368]">{formatDate(item.created_at)}</td>
                <td className="p-3 text-right">
                  <button
                    onClick={() => onRemoveIp(item.ip)}
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
  const [selectedStoreId, setSelectedStoreId] = useState(() => localStorage.getItem('sapo_selected_store_id_v2') || '');
  const [preset, setPreset] = useState('TODAY');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState([]);
  const [blacklist, setBlacklist] = useState([]);
  const [activeView, setActiveView] = useState('orders');
  const [pagination, setPagination] = useState({ page: 1, limit: 30, total: 0, totalPages: 1 });
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);

  const selectedStore = stores.find(store => String(store.id) === String(selectedStoreId));
  const activePreset = DATE_PRESETS[preset];

  const notify = useCallback((message, type = 'success') => {
    setNotice({ message, type });
    setTimeout(() => setNotice(null), 4500);
  }, []);

  const loadStores = useCallback(async () => {
    if (!adminKey) return;
    const res = await getStores();
    if (res.success) {
      setStores(res.data);
      if (!selectedStoreId && res.data[0]) {
        setSelectedStoreId(String(res.data[0].id));
        localStorage.setItem('sapo_selected_store_id_v2', String(res.data[0].id));
      }
    }
  }, [adminKey, selectedStoreId]);

  const loadBlacklist = useCallback(async () => {
    if (!adminKey) return;
    const res = await getBlacklist();
    if (res.success) setBlacklist(res.data || []);
  }, [adminKey]);

  const loadOrders = useCallback(async (page = pagination.page) => {
    if (!adminKey) return;
    setLoading(true);
    try {
      const res = await getOrders({
        page,
        limit: activePreset.limit,
        store_id: selectedStoreId || 'ALL',
        startDate: activePreset.start(),
        endDate: activePreset.end(),
        search
      });
      setOrders(res.data || []);
      setPagination(res.pagination || { page, limit: activePreset.limit, total: 0, totalPages: 1 });
      await loadBlacklist().catch(() => {});
    } catch (err) {
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_dashboard_password_v2');
        setAdminKey('');
      } else {
        notify(err.response?.data?.message || 'Khong tai duoc don hang.', 'error');
      }
    } finally {
      setLoading(false);
    }
  }, [adminKey, activePreset, pagination.page, search, selectedStoreId, notify, loadBlacklist]);

  const runSync = async () => {
    if (!selectedStore) {
      notify('Hay chon store truoc khi quet.', 'error');
      return;
    }
    setSyncing(true);
    try {
      const res = await syncStoreOrders(selectedStore.id, preset);
      notify(`Da quet ${res.total_orders || 0} don, moi ${res.synced_new || 0}, cap nhat ${res.updated_orders || 0}, enrich IP ${res.enriched_ips || 0}.`);
      await loadOrders(1);
    } catch (err) {
      notify(err.response?.data?.message || 'Quet don that bai.', 'error');
    } finally {
      setSyncing(false);
    }
  };

  const blockOrder = async (order) => {
    const ips = [order.client_ip, order.webrtc_ip].filter(value => value && !['unknown', '--', 'not_available'].includes(String(value).toLowerCase()));
    if (!ips.length) {
      notify('Don nay chua co IP hop le de chan.', 'error');
      return;
    }
    try {
      await Promise.all([...new Set(ips)].map(ip => addToBlacklist(ip, `Chan tu don ${order.order_info?.order_id || order.id}`)));
      notify(`Da chan ${new Set(ips).size} IP. Lan truy cap tiep theo se bi chan ngay.`);
      await Promise.all([loadBlacklist(), loadOrders(pagination.page)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Khong chan duoc IP.', 'error');
    }
  };

  const unblockOrder = async (order) => {
    const ips = [order.client_ip, order.webrtc_ip].filter(value => value && !['unknown', '--', 'not_available'].includes(String(value).toLowerCase()));
    try {
      await Promise.all([...new Set(ips)].map(removeFromBlacklist));
      notify('Da bo chan IP cua don nay.');
      await Promise.all([loadBlacklist(), loadOrders(pagination.page)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Khong bo chan duoc IP.', 'error');
    }
  };

  const addManualBlacklist = async (ip, reason) => {
    try {
      await addToBlacklist(ip, reason);
      notify('Da them IP vao danh sach den.');
      await Promise.all([loadBlacklist(), loadOrders(pagination.page)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Khong them duoc IP.', 'error');
    }
  };

  const removeBlacklistIp = async (ip) => {
    try {
      await removeFromBlacklist(ip);
      notify('Da xoa IP khoi danh sach den.');
      await Promise.all([loadBlacklist(), loadOrders(pagination.page)]);
    } catch (err) {
      notify(err.response?.data?.message || 'Khong xoa duoc IP.', 'error');
    }
  };

  useEffect(() => {
    loadStores().catch(() => {});
  }, [loadStores]);

  useEffect(() => {
    if (adminKey) loadOrders(1);
  }, [adminKey, preset, selectedStoreId]);

  useEffect(() => {
    localStorage.setItem('sapo_selected_store_id_v2', selectedStoreId || '');
  }, [selectedStoreId]);

  const summary = useMemo(() => {
    const high = orders.filter(order => order.risk_level === 'HIGH_RISK').length;
    const webrtc = orders.filter(order => order.webrtc_ip).length;
    const blocked = orders.filter(order => order.is_blacklisted).length;
    return { high, webrtc, blocked };
  }, [orders]);

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
          <StatCard icon={Database} label="Don dang hien" value={pagination.total || 0} />
          <StatCard icon={ShieldAlert} label="Canh bao" value={summary.high} tone="red" />
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
                <Info label="Trang thai tracker" value={selectedStore ? 'San sang nhung vao theme' : 'Chua co store'} tone={selectedStore ? 'gray' : 'red'} />
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
                      onClick={() => setPreset(key)}
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
                    onChange={(event) => setSearch(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') loadOrders(1); }}
                    placeholder="Tim ma don, ten, phone, IP, ISP..."
                    className="w-full h-10 rounded-lg border border-[#DADCE0] pl-9 pr-3 text-sm outline-none focus:border-[#1A73E8]"
                  />
                </div>
                <button onClick={() => loadOrders(1)} className="h-10 px-4 rounded-lg bg-[#F1F3F4] font-bold text-sm inline-flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Tai lai
                </button>
              </div>
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
                  {!loading && orders.length === 0 && (
                    <tr><td colSpan="8" className="p-10 text-center text-[#5F6368] font-bold">Chua co don trong khoang nay. Bam Quet don Sapo.</td></tr>
                  )}
                  {!loading && orders.map(order => {
                    const info = order.order_info || {};
                    const risk = riskInfo(order);
                    const RiskIcon = risk.icon;
                    const clientIpVersion = ipVersion(order.client_ip);
                    const webrtcIpVersion = ipVersion(order.webrtc_ip);
                    return (
                      <tr key={order.id} className={cn('border-t border-[#DADCE0] hover:bg-[#F8FAFD]', (order.risk_level === 'HIGH_RISK' || order.is_blacklisted) && 'bg-[#FCE8E6]/45 hover:bg-[#FCE8E6]/60')}>
                        <td className="p-3 font-mono font-bold whitespace-nowrap">{formatDate(order.created_at)}</td>
                        <td className="p-3">
                          <div className="font-extrabold text-[#1A73E8]">{info.order_id || order.id}</div>
                          <div className="font-bold">{info.customer_name || '--'}</div>
                          <div className="text-xs text-[#5F6368]">{info.phone || '--'}</div>
                        </td>
                        <td className="p-3">
                          <div className={cn('inline-flex max-w-[260px] items-center gap-2 rounded-lg px-2.5 py-1 font-mono font-extrabold', isFakeConnection(order) ? 'bg-[#FCE8E6] text-[#D93025]' : 'bg-[#F1F3F4]')}>
                            <Wifi className={cn('w-4 h-4', isFakeConnection(order) ? 'text-[#D93025]' : 'text-[#1A73E8]')} />
                            <span className="truncate">{ipText(order.client_ip)}</span>
                            {clientIpVersion && <span className="shrink-0 rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-extrabold">{clientIpVersion}</span>}
                          </div>
                          <div className={cn('mt-1 text-[11px] font-bold', isFakeConnection(order) ? 'text-[#D93025]' : 'text-[#5F6368]')}>{connectionLabel(order)}</div>
                        </td>
                        <td className="p-3">
                          <div className="flex max-w-[240px] items-center gap-2">
                            <span className={cn('font-mono font-extrabold truncate', order.webrtc_mismatch && 'text-[#D93025]')}>{ipText(order.webrtc_ip)}</span>
                            {webrtcIpVersion && <span className="shrink-0 rounded bg-[#F1F3F4] px-1.5 py-0.5 text-[10px] font-extrabold text-[#5F6368]">{webrtcIpVersion}</span>}
                          </div>
                          <div className={cn('text-xs', order.webrtc_mismatch ? 'text-[#D93025] font-bold' : 'text-[#5F6368]')}>{webrtcLabel(order)}</div>
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
              <button disabled={pagination.page <= 1} onClick={() => loadOrders(pagination.page - 1)} className="h-9 px-3 rounded-lg bg-[#F1F3F4] font-bold disabled:opacity-40"><ChevronLeft className="w-4 h-4 inline" /> Truoc</button>
              <div className="text-sm font-bold text-[#5F6368] text-center">Trang {pagination.page} / {pagination.totalPages} - {pagination.total} don</div>
              <button disabled={pagination.page >= pagination.totalPages} onClick={() => loadOrders(pagination.page + 1)} className="h-9 px-3 rounded-lg bg-[#F1F3F4] font-bold disabled:opacity-40">Sau <ChevronRight className="w-4 h-4 inline" /></button>
            </div>
          </section>
        )}
      </main>

      <OrderDetail
        order={selectedOrder}
        onClose={() => setSelectedOrder(null)}
        onBlockOrder={blockOrder}
        onUnblockOrder={unblockOrder}
      />
    </div>
  );
}
