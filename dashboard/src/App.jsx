import React, { useState, useEffect, useCallback, useRef } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Overview from './components/Overview';
import LogsTable from './components/LogsTable';
import BlacklistManager from './components/BlacklistManager';
import StoreManager from './components/StoreManager';
import ScriptGenerator from './components/ScriptGenerator';
import AdminAccess from './components/AdminAccess';
import { businessDate, businessDateDaysAgo } from './utils/dates';

import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
  syncStoreOrders,
  testStoreConnection,
  getOverviewStats,
  getChartStats,
  getLogs,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  deleteLog
} from './api/client';

export default function App() {
  const [activeTab, setActiveTab] = useState('logs');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const refreshInFlightRef = useRef(false);
  const logsRefreshInFlightRef = useRef(false);
  const syncInFlightRef = useRef(false);
  const DEFAULT_ADMIN_KEY = 'd621f8ea480f914ab7c3d5e61f2098a4bc75e0d3f8a902c4de167fb5902ac83e';
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('sapo_admin_api_key') || DEFAULT_ADMIN_KEY);
  const [notice, setNotice] = useState(null);
  const [authError, setAuthError] = useState('');
  const [isCheckingKey, setIsCheckingKey] = useState(false);
  const [dataError, setDataError] = useState('');

  // Persist selected store in localStorage
  const [selectedStoreId, setSelectedStoreId] = useState(() => {
    return localStorage.getItem('sapo_selected_store_id') || 'ALL';
  });

  const handleSelectStore = (id) => {
    setSelectedStoreId(id);
    localStorage.setItem('sapo_selected_store_id', id);
  };

  // Multi-Store State
  const [stores, setStores] = useState([]);

  // Data States
  const [stats, setStats] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [logs, setLogs] = useState([]);
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
        sessionStorage.removeItem('sapo_admin_api_key');
        setAdminKey('');
        setAuthError('Khóa quản trị không đúng hoặc đã hết hiệu lực.');
        return;
      }
      setNotice({ type: 'error', message: 'Không thể tải danh sách cửa hàng. Kiểm tra khóa quản trị hoặc kết nối server.' });
    }
  }, [adminKey]);

  // Fetch all dashboard data
  const fetchData = useCallback(async (overrideFilters = null, options = {}) => {
    if (!adminKey || refreshInFlightRef.current) return;
    refreshInFlightRef.current = true;
    setIsRefreshing(true);
    if (!options.silent) setDataError('');
    try {
      let activeFilters = overrideFilters || filters;
      let queryFilters = buildQueryFilters(activeFilters);

      let [overviewResult, chartResult, logsResult, blacklistResult, storesResult] = await Promise.allSettled([
        getOverviewStats({ store_id: selectedStoreId }),
        getChartStats({ store_id: selectedStoreId }),
        getLogs(queryFilters),
        getBlacklist(),
        getStores()
      ]);

      const authenticationFailed = [overviewResult, chartResult, logsResult, blacklistResult, storesResult].some(result => result.status === 'rejected' && result.reason?.response?.status === 401);
      if (authenticationFailed) {
        sessionStorage.removeItem('sapo_admin_api_key');
        setAdminKey('');
        setAuthError('Khóa quản trị không đúng hoặc đã hết hiệu lực.');
        return;
      }
      if (storesResult.status === 'fulfilled' && storesResult.value?.success) setStores(storesResult.value.data);
      if (overviewResult.status === 'fulfilled' && overviewResult.value.success) setStats(overviewResult.value.data);
      if (chartResult.status === 'fulfilled' && chartResult.value.success) setChartData(chartResult.value.data);
      if (logsResult.status === 'fulfilled' && logsResult.value.success) {
        setLogs(logsResult.value.data);
        setPagination(logsResult.value.pagination);
      }
      if (blacklistResult.status === 'fulfilled' && blacklistResult.value.success) setBlacklist(blacklistResult.value.data);
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      const message = 'Không thể kết nối dashboard với server.';
      if (!options.silent) {
        setDataError(message);
        setNotice({ type: 'error', message });
      }
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
      refreshInFlightRef.current = false;
    }
  }, [adminKey, filters, selectedStoreId, buildQueryFilters]);

  const refreshLogsOnly = useCallback(async (overrideFilters = null) => {
    if (!adminKey || logsRefreshInFlightRef.current) return;
    logsRefreshInFlightRef.current = true;
    try {
      const activeFilters = overrideFilters || filters;
      const logsResult = await getLogs(buildQueryFilters(activeFilters));
      if (logsResult.success) {
        setLogs(logsResult.data);
        setPagination(logsResult.pagination);
      }
    } catch (err) {
      if (err.response?.status === 401) {
        sessionStorage.removeItem('sapo_admin_api_key');
        setAdminKey('');
        setAuthError('Khóa quản trị không đúng hoặc đã hết hiệu lực.');
      }
    } finally {
      logsRefreshInFlightRef.current = false;
    }
  }, [adminKey, filters, buildQueryFilters]);

  const runOrderSync = useCallback(async (preset = 'TODAY', options = {}) => {
    if (!adminKey || syncInFlightRef.current || preset === 'ALL') return { success: false, skipped: true };
    const targetStores = selectedStoreId !== 'ALL'
      ? stores.filter(s => String(s.id) === String(selectedStoreId))
      : stores;

    if (!targetStores.length) return { success: false, skipped: true };

    syncInFlightRef.current = true;
    setIsSyncing(true);
    try {
      let totalSyncedNew = 0;
      let totalOrdersCount = 0;
      const errors = [];

      const results = await Promise.allSettled(
        targetStores.map(st => syncStoreOrders(st.id, preset).then(res => ({ store: st, res })))
      );

      results.forEach(result => {
        if (result.status === 'fulfilled' && result.value.res?.success) {
          totalSyncedNew += result.value.res.synced_new || 0;
          totalOrdersCount += result.value.res.total_orders || 0;
        } else {
          const st = result.status === 'fulfilled' ? result.value.store : null;
          const err = result.reason;
          const errMsg = err?.response?.data?.message || err?.message || 'Lỗi kết nối';
          errors.push(`${st ? `[${st.store_name}]: ` : ''}${errMsg}`);
        }
      });

      await refreshLogsOnly();

      if (!options.quiet) {
        if (errors.length > 0) {
          setNotice({ type: 'error', message: `Lỗi đồng bộ: ${errors.join(' | ')}` });
        } else {
          const newText = totalSyncedNew > 0 ? `, có ${totalSyncedNew} đơn mới` : '';
          setNotice({ type: 'success', message: `Đã quét ${totalOrdersCount} đơn Sapo${newText}.` });
        }
      }
      return { success: errors.length === 0, totalSyncedNew, totalOrdersCount };
    } finally {
      syncInFlightRef.current = false;
      setIsSyncing(false);
    }
  }, [adminKey, selectedStoreId, stores, refreshLogsOnly]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Refresh the visible table frequently, but keep heavy stats/stores calls out of this loop.
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === 'logs') refreshLogsOnly();
    }, 3000);
    return () => clearInterval(interval);
  }, [activeTab, refreshLogsOnly]);

  // Background Sapo sync: new orders appear without F5 or manual sync.
  useEffect(() => {
    const interval = setInterval(() => {
      if (activeTab === 'logs') {
        runOrderSync(syncPresetFromFilters(filters), { quiet: true });
      }
    }, 12000);
    return () => clearInterval(interval);
  }, [activeTab, filters, runOrderSync, syncPresetFromFilters]);

  // Sync Sapo Orders Handler
  const handleSyncOrders = async () => {
    try {
      const result = await runOrderSync(syncPresetFromFilters(filters), { quiet: false });
      if (result.skipped) setNotice({ type: 'error', message: 'Chưa có cửa hàng Sapo nào được chọn hoặc không thể đồng bộ chế độ Tất cả thời gian.' });
      await fetchData(filters, { silent: true });
    } catch (err) {
      console.error('Failed to sync Sapo orders:', err);
      setNotice({ type: 'error', message: err.response?.data?.message || 'Đồng bộ đơn thất bại.' });
    }
  };

  const handleDatePresetSync = useCallback((preset) => {
    const presetFilters = {
      ...filters,
      page: 1,
      limit: preset === 'TODAY' ? 20 : 50,
      startDate: preset === 'TODAY' ? todayISO : (preset === '7_DAYS' ? businessDateDaysAgo(6) : businessDateDaysAgo(29)),
      endDate: todayISO
    };
    runOrderSync(preset, { quiet: true }).then(() => fetchData(presetFilters, { silent: true }));
  }, [filters, todayISO, runOrderSync, fetchData]);

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
        fetchData();
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
        fetchData();
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
        fetchData();
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
        refreshLogsOnly();
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
          ? { ...log, is_blacklisted: Boolean((log.client_ip !== ip && log.client_ip) || (log.webrtc_ip !== ip && log.webrtc_ip)) && log.is_blacklisted }
          : log
        ));
        refreshLogsOnly();
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
        fetchData();
        setNotice({ type: 'success', message: 'Đã xóa log.' });
      }
    } catch (error) {
      console.error('Failed to delete log:', error);
      setNotice({ type: 'error', message: 'Không thể xóa log.' });
    }
  };

  const handleUnlock = async (key) => {
    setIsCheckingKey(true);
    setAuthError('');
    sessionStorage.setItem('sapo_admin_api_key', key);
    try {
      const response = await getStores();
      if (!response.success) throw new Error('Invalid admin key');
      setAdminKey(key);
    } catch (error) {
      sessionStorage.removeItem('sapo_admin_api_key');
      setAuthError(error.response?.status === 401 ? 'Khóa quản trị không đúng.' : 'Không thể xác minh khóa. Kiểm tra server rồi thử lại.');
    } finally {
      setIsCheckingKey(false);
    }
  };

  if (!adminKey) return <AdminAccess onUnlock={handleUnlock} error={authError} isChecking={isCheckingKey} />;

  return (
    <div className="min-h-screen bg-[#F5F5F7] flex flex-col font-sans overflow-x-hidden">
      <Header
        stores={stores}
        selectedStoreId={selectedStoreId}
        onSelectStore={handleSelectStore}
        onSyncOrders={handleSyncOrders}
        isSyncing={isSyncing}
        onLock={() => {
          sessionStorage.removeItem('sapo_admin_api_key');
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
          {activeTab === 'overview' && (
            <Overview
              stats={stats}
              chartData={chartData}
              onNavigateToLogs={() => setActiveTab('logs')}
              isLoading={isRefreshing}
              error={dataError}
            />
          )}

          {activeTab === 'logs' && (
            <LogsTable
              logs={logs}
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
            <BlacklistManager
              blacklist={blacklist}
              onAdd={handleAddToBlacklist}
              onRemove={handleRemoveFromBlacklist}
            />
          )}

          {activeTab === 'stores' && (
            <StoreManager
              stores={stores}
              onAddStore={handleAddStore}
              onUpdateStore={handleUpdateStore}
              onDeleteStore={handleDeleteStore}
              onTestStore={handleTestStoreConnection}
            />
          )}

          {activeTab === 'script' && <ScriptGenerator />}
        </main>
      </div>
    </div>
  );
}
