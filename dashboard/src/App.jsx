import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import LogsTable from './components/LogsTable';
import AdminAccess from './components/AdminAccess';
import { businessDate, businessDateDaysAgo } from './utils/dates';

import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
  syncStoreOrders,
  testStoreConnection,
  getLogs,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  deleteLog,
  verifyAdminPassword
} from './api/client';

const BlacklistManager = lazy(() => import('./components/BlacklistManager'));
const StoreManager = lazy(() => import('./components/StoreManager'));
const ScriptGenerator = lazy(() => import('./components/ScriptGenerator'));

function PanelLoader() {
  return <div className="min-h-[260px] flex items-center justify-center text-sm font-semibold text-[#86868B]">Đang tải...</div>;
}

export default function App() {
  const [activeTab, setActiveTab] = useState('logs');
  const [isSyncing, setIsSyncing] = useState(false);
  const logsAbortControllerRef = useRef(null);
  const logsRequestIdRef = useRef(0);
  const hasLoadedLogsRef = useRef(false);
  const skipNextLogsRefreshRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('sapo_dashboard_password_v2') || '');
  const [notice, setNotice] = useState(null);
  const [authError, setAuthError] = useState('');
  const [isCheckingKey, setIsCheckingKey] = useState(false);

  // Persist selected store in localStorage
  const [selectedStoreId, setSelectedStoreId] = useState(() => {
    return localStorage.getItem('sapo_selected_store_id') || 'ALL';
  });
  const selectedStoreIdRef = useRef(selectedStoreId);

  const handleSelectStore = (id) => {
    selectedStoreIdRef.current = id;
    setSelectedStoreId(id);
    localStorage.setItem('sapo_selected_store_id', id);
  };

  // Multi-Store State
  const [stores, setStores] = useState([]);

  // Data States
  const [logs, setLogs] = useState([]);
  const [isLogsLoading, setIsLogsLoading] = useState(true);
  const [logsError, setLogsError] = useState('');
  const [pagination, setPagination] = useState({ page: 1, limit: 20, total: 0, totalPages: 1 });
  const [blacklist, setBlacklist] = useState([]);

  // Default date filter scan set to "Hôm nay" (TODAY)
  const todayISO = businessDate();

  const [filters, setFilters] = useState({
    page: 1,
    limit: 20,
    store_id: 'ALL',
    risk_level: 'ALL',
    search: '',
    startDate: todayISO,
    endDate: todayISO,
    orders_only: true
  });

  const syncPresetFromFilters = useCallback((sourceFilters = filters) => {
    if (!sourceFilters.startDate && !sourceFilters.endDate) return 'ALL';
    if (sourceFilters.startDate === businessDateDaysAgo(6) && sourceFilters.endDate === todayISO) return '7_DAYS';
    if (sourceFilters.startDate === businessDateDaysAgo(29) && sourceFilters.endDate === todayISO) return '30_DAYS';
    return 'TODAY';
  }, [filters, todayISO]);

  const buildQueryFilters = useCallback((sourceFilters = filters) => ({
    ...sourceFilters,
    store_id: selectedStoreId,
    orders_only: sourceFilters.orders_only !== false
  }), [filters, selectedStoreId]);

  useEffect(() => {
    if (!notice) return undefined;
    const timer = setTimeout(() => setNotice(null), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Load stores list
  const fetchStores = useCallback(async () => {
    if (!adminKey) return;
    try {
      const res = await getStores();
      if (res.success) {
        setStores(res.data);
      }
    } catch (err) {
      console.error('Error fetching stores:', err);
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_dashboard_password_v2');
        setAdminKey('');
        setAuthError('Mật khẩu không đúng hoặc đã hết hiệu lực.');
        return;
      }
      setNotice({ type: 'error', message: 'Không thể tải danh sách cửa hàng. Kiểm tra mật khẩu hoặc kết nối server.' });
    }
  }, [adminKey]);

  const refreshLogsOnly = useCallback(async (overrideFilters = null, options = {}) => {
    if (!adminKey) return;
    const requestId = logsRequestIdRef.current + 1;
    logsRequestIdRef.current = requestId;
    logsAbortControllerRef.current?.abort();
    const controller = new AbortController();
    logsAbortControllerRef.current = controller;
    const shouldShowLoading = !options.background && !hasLoadedLogsRef.current;
    if (shouldShowLoading) setIsLogsLoading(true);
    setLogsError('');
    try {
      const activeFilters = overrideFilters || filters;
      const logsResult = await getLogs(buildQueryFilters(activeFilters), { signal: controller.signal });
      if (requestId !== logsRequestIdRef.current) return;
      if (logsResult.success) {
        setLogs(logsResult.data);
        setPagination(logsResult.pagination);
        hasLoadedLogsRef.current = true;
      }
    } catch (err) {
      if (err.code === 'ERR_CANCELED' || requestId !== logsRequestIdRef.current) return;
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_dashboard_password_v2');
        setAdminKey('');
        setAuthError('Mật khẩu không đúng hoặc đã hết hiệu lực.');
      } else {
        setLogsError(err.response?.data?.message || 'Không thể tải dữ liệu đơn hàng.');
      }
    } finally {
      if (requestId === logsRequestIdRef.current && shouldShowLoading) setIsLogsLoading(false);
    }
  }, [adminKey, filters, buildQueryFilters]);

  const refreshBlacklist = useCallback(async () => {
    if (!adminKey) return;
    try {
      const result = await getBlacklist();
      if (result.success) setBlacklist(result.data);
    } catch (err) {
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_dashboard_password_v2');
        setAdminKey('');
        setAuthError('Mật khẩu không đúng hoặc đã hết hiệu lực.');
      }
    }
  }, [adminKey]);

  const runOrderSync = useCallback(async (preset = 'TODAY', options = {}) => {
    if (!adminKey || syncInFlightRef.current || preset === 'ALL') return { success: false, skipped: true };
    const syncStoreId = selectedStoreId;
    const targetStores = selectedStoreId !== 'ALL'
      ? stores.filter(s => String(s.id) === String(selectedStoreId))
      : stores;

    if (!targetStores.length) return { success: false, skipped: true };

    syncInFlightRef.current = true;
    setIsSyncing(true);
    try {
      let totalSyncedNew = 0;
      let totalOrdersCount = 0;
      let totalRemovedOrders = 0;
      let syncStillRunning = false;
      const errors = [];

      const results = await Promise.allSettled(
        targetStores.map(st => syncStoreOrders(st.id, preset, { incremental: options.incremental === true }).then(res => ({ store: st, res })))
      );

      const syncStatuses = new Map();
      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.res?.success) {
          if (result.value.res.syncing) {
            syncStillRunning = true;
            return;
          }
          totalSyncedNew += result.value.res.synced_new || 0;
          totalOrdersCount += result.value.res.total_orders || 0;
          totalRemovedOrders += result.value.res.removed_orders || 0;
          if (result.value.res.sync_status) syncStatuses.set(String(result.value.store.id), result.value.res.sync_status);
        } else {
          const st = result.status === 'fulfilled' ? result.value.store : null;
          const err = result.reason;
          const errMsg = err?.response?.data?.message || err?.message || 'Lỗi kết nối';
          errors.push(`${st ? `[${st.store_name}]: ` : ''}${errMsg}`);
        }
      });
      if (syncStatuses.size > 0) {
        setStores(previous => previous.map(store => {
          const syncStatus = syncStatuses.get(String(store.id));
          return syncStatus ? { ...store, sync_status: syncStatus } : store;
        }));
      }

      const isStillSelected = String(selectedStoreIdRef.current) === String(syncStoreId);
      if (options.refresh !== false && isStillSelected) {
        await refreshLogsOnly(null, { background: options.backgroundRefresh === true });
      }

      if (!options.quiet && isStillSelected) {
        if (errors.length > 0) {
          setNotice({ type: 'error', message: `Lỗi đồng bộ: ${errors.join(' | ')}` });
        } else if (syncStillRunning) {
          setNotice({ type: 'success', message: 'Đồng bộ đang chạy trên server. Danh sách sẽ tự cập nhật khi hoàn tất.' });
        } else {
          const newText = totalSyncedNew > 0 ? `, có ${totalSyncedNew} đơn mới` : '';
          const knownOrders = Math.max(0, totalOrdersCount - totalSyncedNew);
          const removedText = totalRemovedOrders > 0 ? `, đã xóa ${totalRemovedOrders} đơn không còn trên Sapo` : '';
          const storeLabel = targetStores.length === 1 ? targetStores[0].store_name : 'Tất cả cửa hàng';
          const periodLabel = preset === 'TODAY' ? `hôm nay (${todayISO})` : (preset === '7_DAYS' ? 'trong 7 ngày qua' : 'trong 30 ngày qua');
          const message = totalOrdersCount === 0
            ? `${storeLabel}: không có đơn Sapo ${periodLabel}${removedText}.`
            : `${storeLabel}: đã đối soát ${totalOrdersCount} đơn ${periodLabel}${newText}${knownOrders > 0 ? `, ${knownOrders} đơn đã có trong danh sách` : ''}${removedText}.`;
          setNotice({ type: 'success', message });
        }
      }
      return { success: errors.length === 0, totalSyncedNew, totalOrdersCount, totalRemovedOrders, syncing: syncStillRunning, stale: !isStillSelected };
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [adminKey, selectedStoreId, stores, refreshLogsOnly, todayISO]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    if (skipNextLogsRefreshRef.current) {
      skipNextLogsRefreshRef.current = false;
      return;
    }
    refreshLogsOnly();
  }, [refreshLogsOnly]);

  useEffect(() => {
    if (activeTab === 'blacklist') refreshBlacklist();
  }, [activeTab, refreshBlacklist]);

  // Sync Sapo Orders Handler
  const handleSyncOrders = async () => {
    try {
      const result = await runOrderSync(syncPresetFromFilters(filters), { quiet: false });
      if (result.skipped) setNotice({ type: 'error', message: 'Chưa có cửa hàng Sapo nào được chọn hoặc không thể đồng bộ chế độ Tất cả thời gian.' });
    } catch (err) {
      console.error('Failed to sync Sapo orders:', err);
      setNotice({ type: 'error', message: err.response?.data?.message || 'Đồng bộ đơn thất bại.' });
    }
  };

  const handleDatePresetSync = useCallback(async (preset, presetFilters) => {
    skipNextLogsRefreshRef.current = true;
    setFilters(presetFilters);
    await refreshLogsOnly(presetFilters);
  }, [refreshLogsOnly]);

  const handleTestStoreConnection = async (id) => {
    try {
      const res = await testStoreConnection(id);
      if (res.success) {
        setNotice({ type: 'success', message: 'Kết nối Sapo thành công. Có thể đồng bộ đơn.' });
        return true;
      }
      setNotice({ type: 'error', message: res.message || 'Không thể xác thực với Sapo.' });
      return false;
    } catch (err) {
      setNotice({ type: 'error', message: err.response?.data?.message || 'Không thể xác thực với Sapo.' });
      return false;
    }
  };

  // Store Handlers
  const handleAddStore = async (store_name, mysapo_domain, api_key, api_secret) => {
    try {
      const res = await createStore(store_name, mysapo_domain, api_key, api_secret);
      if (res.success) {
        fetchStores();
        refreshLogsOnly();
        setNotice({ type: 'success', message: 'Đã thêm cửa hàng.' });
        return true;
      }
      setNotice({ type: 'error', message: res.message || 'Không thể thêm cửa hàng.' });
      return false;
    } catch (err) {
      console.error('Failed to add store:', err);
      setNotice({ type: 'error', message: err.response?.data?.message || err.response?.data?.error || 'Không thể thêm cửa hàng.' });
      return false;
    }
  };

  const handleUpdateStore = async (id, store_name, mysapo_domain, api_key, api_secret) => {
    try {
      const res = await updateStore(id, store_name, mysapo_domain, api_key, api_secret);
      if (res.success) {
        fetchStores();
        refreshLogsOnly();
        setNotice({ type: 'success', message: 'Đã lưu cấu hình cửa hàng.' });
        return true;
      }
      setNotice({ type: 'error', message: res.message || 'Không thể lưu cấu hình cửa hàng.' });
      return false;
    } catch (err) {
      console.error('Failed to update store:', err);
      setNotice({ type: 'error', message: err.response?.data?.message || err.response?.data?.error || 'Không thể lưu cấu hình cửa hàng.' });
      return false;
    }
  };

  const handleDeleteStore = async (id) => {
    try {
      const res = await deleteStore(id);
      if (res.success) {
        fetchStores();
        if (selectedStoreId === String(id)) {
          handleSelectStore('ALL');
        }
        refreshLogsOnly();
        setNotice({ type: 'success', message: 'Đã xóa liên kết cửa hàng.' });
      }
    } catch (err) {
      console.error('Failed to delete store:', err);
      setNotice({ type: 'error', message: 'Không thể xóa cửa hàng.' });
    }
  };

  // Blacklist Handlers
  const handleAddToBlacklist = async (ip, reason) => {
    try {
      const res = await addToBlacklist(ip, reason);
      if (res.success) {
        setBlacklist(prev => {
          const exists = prev.some(item => item.ip === ip);
          if (exists) {
            return prev.map(item => item.ip === ip ? { ...item, reason, source: 'MANUAL', created_at: new Date().toISOString() } : item);
          }
          return [{ id: `local-${ip}`, ip, reason, source: 'MANUAL', created_at: new Date().toISOString() }, ...prev];
        });
        setLogs(prev => prev.map(log => (log.client_ip === ip || log.webrtc_ip === ip)
          ? { ...log, is_blacklisted: true, risk_level: 'HIGH_RISK' }
          : log
        ));
        setNotice({ type: 'success', message: `Đã chặn IP ${ip}.` });
        return true;
      }
      setNotice({ type: 'error', message: res.message || `Không thể chặn IP ${ip}.` });
      return false;
    } catch (error) {
      console.error('Failed to add IP to blacklist:', error);
      setNotice({ type: 'error', message: `Không thể chặn IP ${ip}.` });
      return false;
    }
  };

  const handleRemoveFromBlacklist = async (ip) => {
    try {
      const res = await removeFromBlacklist(ip);
      if (res.success) {
        setBlacklist(prev => prev.filter(item => item.ip !== ip));
        setLogs(prev => prev.map(log => (log.client_ip === ip || log.webrtc_ip === ip)
          ? { ...log, is_blacklisted: false }
          : log
        ));
        setNotice({ type: 'success', message: res.already_unblocked ? `IP ${ip} đã được bỏ chặn trước đó.` : `Đã bỏ chặn IP ${ip}.` });
        return true;
      }
      setNotice({ type: 'error', message: res.message || `Không thể bỏ chặn IP ${ip}.` });
      return false;
    } catch (error) {
      console.error('Failed to remove IP from blacklist:', error);
      setNotice({ type: 'error', message: `Không thể bỏ chặn IP ${ip}.` });
      return false;
    }
  };

  const handleDeleteLog = async (id) => {
    try {
      const res = await deleteLog(id);
      if (res.success) {
        refreshLogsOnly();
        setNotice({ type: 'success', message: 'Đã xóa log.' });
      }
    } catch (error) {
      console.error('Failed to delete log:', error);
      setNotice({ type: 'error', message: 'Không thể xóa log.' });
    }
  };

  const handleUnlockAdmin = async (key) => {
    setIsCheckingKey(true);
    setAuthError('');
    try {
      sessionStorage.setItem('sapo_dashboard_password_v2', key);
      const res = await verifyAdminPassword();
      if (res.success) {
        setAdminKey(key);
        setNotice({ type: 'success', message: 'Xác thực admin thành công.' });
      }
    } catch (err) {
      console.error('Password verification failed:', err);
      sessionStorage.removeItem('sapo_dashboard_password_v2');
      setAdminKey('');
      setAuthError('Mật khẩu không đúng. Vui lòng thử lại.');
    } finally {
      setIsCheckingKey(false);
    }
  };

  if (!adminKey) {
    return <AdminAccess onUnlock={handleUnlockAdmin} error={authError} isChecking={isCheckingKey} />;
  }

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col font-sans">
      <Header
        stores={stores}
        selectedStoreId={selectedStoreId}
        onSelectStore={handleSelectStore}
        onSyncOrders={handleSyncOrders}
        isSyncing={isSyncing}
        onLock={() => {
          sessionStorage.removeItem('sapo_dashboard_password_v2');
          setAdminKey('');
        }}
      />

      {notice && (
        <div role="status" className={`fixed z-50 top-4 right-4 max-w-sm px-4 py-3 rounded-lg shadow-lg text-sm font-semibold ${notice.type === 'error' ? 'bg-[#FFEBEA] text-[#B42318]' : 'bg-[#E9F8EF] text-[#147A3D]'}`}>
          <button onClick={() => setNotice(null)} className="float-right ml-3 text-current">x</button>{notice.message}
        </div>
      )}

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

        <main className="flex-1 min-w-0 p-3 md:p-6 overflow-y-auto max-w-[1750px] mx-auto w-full">
          {activeTab === 'logs' && (
            <LogsTable
              logs={logs}
              isLoading={isLogsLoading}
              error={logsError}
              onRetry={() => refreshLogsOnly()}
              pagination={pagination}
              filters={filters}
              setFilters={setFilters}
              onAddToBlacklist={handleAddToBlacklist}
              onRemoveFromBlacklist={handleRemoveFromBlacklist}
              onDeleteLog={handleDeleteLog}
              onDatePresetChange={handleDatePresetSync}
            />
          )}

          {activeTab === 'blacklist' && (
            <Suspense fallback={<PanelLoader />}>
              <BlacklistManager
                blacklist={blacklist}
                onAdd={handleAddToBlacklist}
                onRemove={handleRemoveFromBlacklist}
              />
            </Suspense>
          )}

          {activeTab === 'stores' && (
            <Suspense fallback={<PanelLoader />}>
              <StoreManager
                stores={stores}
                onAddStore={handleAddStore}
                onUpdateStore={handleUpdateStore}
                onDeleteStore={handleDeleteStore}
                onTestStore={handleTestStoreConnection}
              />
            </Suspense>
          )}

          {activeTab === 'script' && <Suspense fallback={<PanelLoader />}><ScriptGenerator /></Suspense>}
        </main>
      </div>
    </div>
  );
}
