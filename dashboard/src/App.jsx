import React, { useState, useEffect, useCallback } from 'react';
import Header from './components/Header';
import Sidebar from './components/Sidebar';
import Overview from './components/Overview';
import LogsTable from './components/LogsTable';
import BlacklistManager from './components/BlacklistManager';
import StoreManager from './components/StoreManager';
import ScriptGenerator from './components/ScriptGenerator';
import AdminAccess from './components/AdminAccess';
import { businessDate } from './utils/dates';

import {
  getStores,
  createStore,
  updateStore,
  deleteStore,
  syncStoreOrders,
  getOverviewStats,
  getChartStats,
  getLogs,
  getBlacklist,
  addToBlacklist,
  removeFromBlacklist,
  deleteLog
} from './api/client';

export default function App() {
  const [activeTab, setActiveTab] = useState('overview');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [adminKey, setAdminKey] = useState(() => sessionStorage.getItem('sapo_admin_api_key') || '');
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
  const fetchData = useCallback(async () => {
    if (!adminKey) return;
    setIsRefreshing(true);
    setDataError('');
    try {
      const queryFilters = {
        ...filters,
        store_id: selectedStoreId,
        orders_only: filters.orders_only !== false
      };

      const results = await Promise.allSettled([
        getOverviewStats({ store_id: selectedStoreId }),
        getChartStats({ store_id: selectedStoreId }),
        getLogs(queryFilters),
        getBlacklist()
      ]);

      const [overviewResult, chartResult, logsResult, blacklistResult] = results;
      const authenticationFailed = results.some(result => result.status === 'rejected' && result.reason?.response?.status === 401);
      if (authenticationFailed) {
        sessionStorage.removeItem('sapo_admin_api_key');
        setAdminKey('');
        setAuthError('Khóa quản trị không đúng hoặc đã hết hiệu lực.');
        return;
      }
      if (overviewResult.status === 'fulfilled' && overviewResult.value.success) setStats(overviewResult.value.data);
      if (chartResult.status === 'fulfilled' && chartResult.value.success) setChartData(chartResult.value.data);
      if (logsResult.status === 'fulfilled' && logsResult.value.success) {
        setLogs(logsResult.value.data);
        setPagination(logsResult.value.pagination);
      }
      if (blacklistResult.status === 'fulfilled' && blacklistResult.value.success) setBlacklist(blacklistResult.value.data);
      if (results.some(result => result.status === 'rejected')) {
        const message = 'Một phần dữ liệu chưa tải được. Thử làm mới lại.';
        setDataError(message);
        setNotice({ type: 'error', message });
      }
    } catch (error) {
      console.error('Error fetching dashboard data:', error);
      const message = 'Không thể kết nối dashboard với server.';
      setDataError(message);
      setNotice({ type: 'error', message });
    } finally {
      setTimeout(() => setIsRefreshing(false), 400);
    }
  }, [adminKey, filters, selectedStoreId]);

  useEffect(() => {
    fetchStores();
  }, [fetchStores]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Auto-refresh every 10 seconds for live monitoring
  useEffect(() => {
    const interval = setInterval(() => {
      fetchData();
    }, 10000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Sync Sapo Orders Handler
  const handleSyncOrders = async () => {
    setIsSyncing(true);
    try {
      const targetStoreId = selectedStoreId !== 'ALL' ? selectedStoreId : (stores.length > 0 ? stores[0].id : 1);
      const res = await syncStoreOrders(targetStoreId, 'TODAY');
      if (res.success) {
        fetchData();
        setNotice({ type: 'success', message: `Đồng bộ xong ${res.total_orders} đơn.` });
      }
    } catch (err) {
      console.error('Failed to sync Sapo orders:', err);
      setNotice({ type: 'error', message: 'Đồng bộ đơn thất bại. Kiểm tra kết nối Sapo và cấu hình store.' });
    } finally {
      setIsSyncing(false);
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
        fetchData();
        setNotice({ type: 'success', message: `Đã chặn IP ${ip}.` });
        return true;
      }
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
        fetchData();
        setNotice({ type: 'success', message: `Đã bỏ chặn IP ${ip}.` });
        return true;
      }
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
        onRefresh={fetchData}
        onSyncOrders={handleSyncOrders}
        isRefreshing={isRefreshing}
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
            />
          )}

          {activeTab === 'script' && <ScriptGenerator />}
        </main>
      </div>
    </div>
  );
}
