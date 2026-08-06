import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Globe2,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  Store,
  Wifi,
  X
} from 'lucide-react';
import { businessDate, businessDateDaysAgo } from './utils/dates';
import {
  createStore,
  deleteStore,
  getOrders,
  getStores,
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

function networkText(order) {
  return [order.country, order.region, order.city].filter(Boolean).filter(v => !['Unknown', 'XX'].includes(v)).join(' / ') || 'Chua co vi tri';
}

function riskInfo(order) {
  if (order.risk_level === 'HIGH_RISK') {
    if (order.webrtc_mismatch) return { tone: 'red', label: 'Lech IP WebRTC', icon: ShieldAlert };
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
    <section className="bg-white border border-[#E5E5EA] rounded-lg p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-extrabold uppercase text-[#6E6E73]">Cua hang Sapo</h2>
          <p className="text-xs text-[#86868B] mt-1">Dung de quet don va gan tracker WebRTC.</p>
        </div>
        <Store className="w-5 h-5 text-[#0071E3]" />
      </div>
      <select
        value={selectedStoreId}
        onChange={(event) => setSelectedStoreId(event.target.value)}
        className="w-full h-10 rounded-lg border border-[#D1D1D6] px-3 text-sm font-semibold"
      >
        {stores.map(store => <option key={store.id} value={store.id}>{store.store_name} - {store.mysapo_domain}</option>)}
        {!stores.length && <option value="">Chua co store</option>}
      </select>

      <div className="grid grid-cols-1 gap-2">
        <input className="h-10 rounded-lg border border-[#D1D1D6] px-3 text-sm" placeholder="Ten store" value={form.store_name} onChange={e => setForm({ ...form, store_name: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#D1D1D6] px-3 text-sm" placeholder="ten-shop.mysapo.net" value={form.mysapo_domain} onChange={e => setForm({ ...form, mysapo_domain: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#D1D1D6] px-3 text-sm" placeholder="API key" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} />
        <input className="h-10 rounded-lg border border-[#D1D1D6] px-3 text-sm" placeholder="API secret" value={form.api_secret} onChange={e => setForm({ ...form, api_secret: e.target.value })} />
      </div>
      <div className="flex gap-2">
        <button onClick={save} disabled={saving} className="flex-1 h-10 rounded-lg bg-[#0071E3] text-white font-bold text-sm flex items-center justify-center gap-2">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          {selectedStore ? 'Cap nhat' : 'Them store'}
        </button>
        {selectedStore && (
          <button onClick={() => testStoreConnection(selectedStore.id).then(res => notice(`Ket noi OK: ${res.order_count || 0} don`)).catch(err => notice(err.response?.data?.message || 'Test loi', 'error'))} className="h-10 px-3 rounded-lg bg-[#F2F2F7] font-bold text-sm">
            Test
          </button>
        )}
      </div>
      {selectedStore && (
        <div className="space-y-2">
          <div className="text-xs font-bold text-[#6E6E73]">Ma nhung tracker</div>
          <textarea readOnly value={trackerSnippet} className="w-full h-28 rounded-lg border border-[#D1D1D6] p-3 text-xs font-mono bg-[#F5F5F7]" />
          <button
            onClick={() => deleteStore(selectedStore.id).then(onStoresChanged)}
            className="text-xs font-bold text-[#FF3B30]"
          >
            Xoa store nay
          </button>
        </div>
      )}
    </section>
  );
}

function OrderDetail({ order, onClose }) {
  if (!order) return null;
  const info = order.order_info || {};
  const risk = riskInfo(order);
  const RiskIcon = risk.icon;
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
          </div>
          <div className="md:col-span-2 border border-[#E5E5EA] rounded-lg p-4">
            <div className="text-xs font-bold uppercase text-[#6E6E73] mb-3">IP va WebRTC</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Info label="IP ket noi" value={ipText(order.client_ip)} mono />
              <Info label="IP WebRTC" value={ipText(order.webrtc_ip) + (order.webrtc_status ? ` (${order.webrtc_status})` : '')} mono />
              <Info label="Vi tri" value={networkText(order)} />
              <Info label="ISP / ASN" value={[order.isp, order.asn].filter(Boolean).join(' / ') || '--'} />
              <Info label="To chuc" value={order.org || '--'} />
              <Info label="Thiet bi" value={order.device_type || '--'} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value, mono = false }) {
  return (
    <div className="rounded-lg bg-[#F5F5F7] p-3">
      <div className="text-[11px] uppercase font-bold text-[#86868B]">{label}</div>
      <div className={cn('mt-1 text-sm font-bold break-all', mono && 'font-mono')}>{value}</div>
    </div>
  );
}

export default function App() {
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('sapo_dashboard_password_v2') || '');
  const [stores, setStores] = useState([]);
  const [selectedStoreId, setSelectedStoreId] = useState(() => localStorage.getItem('sapo_selected_store_id_v2') || '');
  const [preset, setPreset] = useState('TODAY');
  const [search, setSearch] = useState('');
  const [orders, setOrders] = useState([]);
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
  }, [adminKey, activePreset, pagination.page, search, selectedStoreId, notify]);

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
    return { high, webrtc };
  }, [orders]);

  if (!adminKey) return <AdminGate onUnlock={setAdminKey} />;

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-[#1D1D1F]">
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-[#E5E5EA]">
        <div className="max-w-[1680px] mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-lg bg-[#0071E3] text-white flex items-center justify-center"><ShieldCheck className="w-6 h-6" /></div>
            <div>
              <h1 className="text-lg font-extrabold">Sapo IP Guard Clean</h1>
              <p className="text-xs text-[#6E6E73]">Quet don, IP ket noi va IP WebRTC</p>
            </div>
          </div>
          <button
            onClick={() => { sessionStorage.removeItem('sapo_dashboard_password_v2'); setAdminKey(''); }}
            className="h-9 px-3 rounded-lg bg-[#F2F2F7] text-sm font-bold"
          >
            Khoa
          </button>
        </div>
      </header>

      {notice && (
        <div className={cn('fixed top-20 right-4 z-50 max-w-md rounded-lg px-4 py-3 text-sm font-bold shadow-lg', notice.type === 'error' ? 'bg-[#FFEDEC] text-[#B42318]' : 'bg-[#E9F8EF] text-[#147A3D]')}>
          {notice.message}
        </div>
      )}

      <main className="max-w-[1680px] mx-auto p-4 grid grid-cols-1 xl:grid-cols-[320px_1fr] gap-4">
        <aside className="space-y-4">
          <StorePanel
            stores={stores}
            selectedStoreId={selectedStoreId}
            setSelectedStoreId={setSelectedStoreId}
            onStoresChanged={loadStores}
            notice={notify}
          />
          <section className="bg-white border border-[#E5E5EA] rounded-lg p-4 grid grid-cols-2 gap-3">
            <Info label="Don dang hien" value={String(pagination.total || 0)} />
            <Info label="Canh bao" value={String(summary.high)} />
            <Info label="Co WebRTC" value={String(summary.webrtc)} />
            <Info label="Preset" value={DATE_PRESETS[preset].label} />
          </section>
        </aside>

        <section className="bg-white border border-[#E5E5EA] rounded-lg overflow-hidden">
          <div className="p-4 border-b border-[#E5E5EA] space-y-3">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-extrabold">Danh sach don hang</h2>
                <p className="text-sm text-[#6E6E73]">Data chi cap nhat khi bam nut quet don.</p>
              </div>
              <button
                onClick={runSync}
                disabled={syncing}
                className="h-11 px-4 rounded-lg bg-[#34C759] text-white font-extrabold flex items-center justify-center gap-2"
              >
                {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Quet don Sapo
              </button>
            </div>
            <div className="flex flex-col lg:flex-row gap-3">
              <div className="flex gap-2">
                {Object.entries(DATE_PRESETS).map(([key, item]) => (
                  <button
                    key={key}
                    onClick={() => setPreset(key)}
                    className={cn('h-10 px-4 rounded-lg text-sm font-extrabold', preset === key ? 'bg-[#0071E3] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F]')}
                  >
                    <Calendar className="w-4 h-4 inline mr-1" />
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-3 text-[#86868B]" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  onKeyDown={(event) => { if (event.key === 'Enter') loadOrders(1); }}
                  placeholder="Tim ma don, ten, phone, IP, ISP..."
                  className="w-full h-10 rounded-lg border border-[#D1D1D6] pl-9 pr-3 text-sm outline-none focus:border-[#0071E3]"
                />
              </div>
              <button onClick={() => loadOrders(1)} className="h-10 px-4 rounded-lg bg-[#F2F2F7] font-bold text-sm">Tai lai</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] text-sm">
              <thead className="bg-[#F5F5F7] text-[#6E6E73]">
                <tr>
                  <th className="text-left p-3 font-extrabold">Thoi gian</th>
                  <th className="text-left p-3 font-extrabold">Don & khach</th>
                  <th className="text-left p-3 font-extrabold">IP ket noi</th>
                  <th className="text-left p-3 font-extrabold">IP WebRTC</th>
                  <th className="text-left p-3 font-extrabold">Vi tri / ISP</th>
                  <th className="text-left p-3 font-extrabold">Trang thai</th>
                  <th className="text-right p-3 font-extrabold">Chi tiet</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="7" className="p-10 text-center text-[#86868B] font-bold"><Loader2 className="w-5 h-5 animate-spin inline mr-2" />Dang tai...</td></tr>
                )}
                {!loading && orders.length === 0 && (
                  <tr><td colSpan="7" className="p-10 text-center text-[#86868B] font-bold">Chua co don trong khoang nay. Bam Quet don Sapo.</td></tr>
                )}
                {!loading && orders.map(order => {
                  const info = order.order_info || {};
                  const risk = riskInfo(order);
                  const RiskIcon = risk.icon;
                  return (
                    <tr key={order.id} className={cn('border-t border-[#E5E5EA]', order.risk_level === 'HIGH_RISK' && 'bg-[#FFF2F2]')}>
                      <td className="p-3 font-mono font-bold">{formatDate(order.created_at)}</td>
                      <td className="p-3">
                        <div className="font-extrabold text-[#0071E3]">{info.order_id || order.id}</div>
                        <div className="font-bold">{info.customer_name || '--'}</div>
                        <div className="text-xs text-[#86868B]">{info.phone || '--'}</div>
                      </td>
                      <td className="p-3">
                        <div className="inline-flex items-center gap-2 rounded-lg bg-[#F2F2F7] px-2.5 py-1 font-mono font-extrabold">
                          <Wifi className="w-4 h-4 text-[#0071E3]" />
                          {ipText(order.client_ip)}
                        </div>
                      </td>
                      <td className="p-3">
                        <div className="font-mono font-extrabold">{ipText(order.webrtc_ip)}</div>
                        <div className="text-xs text-[#86868B]">{order.webrtc_status || 'unknown'}</div>
                      </td>
                      <td className="p-3 max-w-[260px]">
                        <div className="font-bold truncate flex items-center gap-1"><Globe2 className="w-4 h-4" />{networkText(order)}</div>
                        <div className="text-xs text-[#86868B] truncate">{[order.isp, order.asn].filter(Boolean).join(' / ') || 'Chua co ISP'}</div>
                      </td>
                      <td className="p-3">
                        <div className={cn('inline-flex items-center gap-2 rounded-full px-3 py-1 font-extrabold text-xs', risk.tone === 'red' ? 'bg-[#FF3B30]/10 text-[#FF3B30]' : risk.tone === 'green' ? 'bg-[#34C759]/10 text-[#1A8F3A]' : 'bg-[#F2F2F7] text-[#6E6E73]')}>
                          <RiskIcon className="w-4 h-4" />
                          {risk.label}
                        </div>
                      </td>
                      <td className="p-3 text-right">
                        <button onClick={() => setSelectedOrder(order)} className="h-9 px-3 rounded-lg bg-[#E8F2FF] text-[#0071E3] font-extrabold inline-flex items-center gap-1">
                          <Eye className="w-4 h-4" />
                          Xem
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="p-4 border-t border-[#E5E5EA] flex items-center justify-between">
            <button disabled={pagination.page <= 1} onClick={() => loadOrders(pagination.page - 1)} className="h-9 px-3 rounded-lg bg-[#F2F2F7] font-bold disabled:opacity-40"><ChevronLeft className="w-4 h-4 inline" /> Truoc</button>
            <div className="text-sm font-bold text-[#6E6E73]">Trang {pagination.page} / {pagination.totalPages} - {pagination.total} don</div>
            <button disabled={pagination.page >= pagination.totalPages} onClick={() => loadOrders(pagination.page + 1)} className="h-9 px-3 rounded-lg bg-[#F2F2F7] font-bold disabled:opacity-40">Sau <ChevronRight className="w-4 h-4 inline" /></button>
          </div>
        </section>
      </main>

      <OrderDetail order={selectedOrder} onClose={() => setSelectedOrder(null)} />
    </div>
  );
}
