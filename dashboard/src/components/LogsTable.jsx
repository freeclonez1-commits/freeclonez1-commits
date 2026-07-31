import React, { useState } from 'react';
import { Search, AlertTriangle, ShieldCheck, ShieldAlert, Ban, Eye, X, Globe, Calendar, ShoppingCart, Wifi, Clock, CheckCircle2, Unlock, Monitor, Smartphone, Tablet, MousePointer2, CircleOff } from 'lucide-react';
import { businessDate, businessDateDaysAgo } from '../utils/dates';

export default function LogsTable({ logs, pagination, filters, setFilters, onAddToBlacklist, onRemoveFromBlacklist, onDeleteLog }) {
  const [selectedLog, setSelectedLog] = useState(null);
  const ordersOnlyFilter = filters.orders_only !== false;

  const todayStr = businessDate();
  const isTodayDefault = filters.startDate === todayStr && filters.endDate === todayStr;

  const handleSearchChange = (e) => {
    setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }));
  };

  const handleRiskFilter = (risk) => {
    setFilters(prev => ({ ...prev, risk_level: risk, page: 1 }));
  };

  const handleViewMode = (ordersOnly) => {
    setFilters(prev => ({ ...prev, orders_only: ordersOnly, page: 1 }));
  };

  const handleDatePreset = (preset) => {
    if (preset === 'ALL') {
      setFilters(prev => ({ ...prev, startDate: '', endDate: '', page: 1 }));
    } else if (preset === 'TODAY') {
      setFilters(prev => ({ ...prev, startDate: todayStr, endDate: todayStr, page: 1 }));
    } else if (preset === '7_DAYS') {
      setFilters(prev => ({ ...prev, startDate: businessDateDaysAgo(6), endDate: todayStr, page: 1 }));
    } else if (preset === '30_DAYS') {
      setFilters(prev => ({ ...prev, startDate: businessDateDaysAgo(29), endDate: todayStr, page: 1 }));
    }
  };

  const handleBlockIp = async (log) => {
    if (!window.confirm(`Block ${log.client_ip}${log.webrtc_ip && log.webrtc_ip !== log.client_ip ? ` and ${log.webrtc_ip}` : ''}?`)) return false;
    const reason = `Chặn IP truy cập website từ Đơn ${log.order_info?.order_id || log.id} (${log.isp})`;
    const blockedClientIp = await onAddToBlacklist(log.client_ip, reason);
    if (!blockedClientIp) return false;
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip) {
      return onAddToBlacklist(log.webrtc_ip, `Chặn IP Gốc WebRTC từ Đơn ${log.order_info?.order_id || log.id}`);
    }
    return true;
  };

  const handleUnblockIp = async (log) => {
    if (!window.confirm(`Unblock ${log.client_ip}?`)) return false;
    const unblockedClientIp = await onRemoveFromBlacklist(log.client_ip);
    if (!unblockedClientIp) return false;
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip) {
      return onRemoveFromBlacklist(log.webrtc_ip);
    }
    return true;
  };

  // Backend filters orders before pagination; keep this as a visual guard while data refreshes.
  const displayedLogs = logs ? logs.filter(log => {
    if (ordersOnlyFilter) {
      return log.order_info !== null;
    }
    return true;
  }).slice(0, 20) : [];

  const renderDeviceIcon = (device) => {
    if (device === 'Mobile') return <Smartphone className="w-3.5 h-3.5" />;
    if (device === 'Tablet') return <Tablet className="w-3.5 h-3.5" />;
    return <Monitor className="w-3.5 h-3.5" />;
  };

  const hasConnectionRisk = (log) => {
    const reasons = Array.isArray(log.risk_reasons) ? log.risk_reasons.join(' ').toLowerCase() : '';
    return Boolean(log.is_vpn || log.is_datacenter || reasons.includes('vpn') || reasons.includes('proxy') || reasons.includes('datacenter') || reasons.includes('hosting') || reasons.includes('cloudflare'));
  };

  const renderOriginIpBadge = (log, isHighRisk) => {
    if (log.webrtc_ip) {
      return (
        <span className="font-mono font-black text-white bg-[#34C759] px-2.5 py-0.5 rounded-md flex items-center gap-1 shadow-sm">
          🟢 {log.webrtc_ip} (IP GỐC THẬT)
        </span>
      );
    }
    if (isHighRisk && hasConnectionRisk(log)) {
      return (
        <span className="text-[#B45309] bg-[#FFF4E5] px-2 py-0.5 rounded text-[11px] font-bold border border-[#FF9500]/25">
          ⚠️ WebRTC bị ẩn, đang chặn theo IP kết nối
        </span>
      );
    }
    if (isHighRisk) {
      return (
        <span className="text-[#FF9500] bg-[#FFF4E5] px-2 py-0.5 rounded text-[11px] font-bold border border-[#FF9500]/20">
          ⚠️ Chưa có dữ liệu IP gốc
        </span>
      );
    }
    return (
      <span className="text-[#86868B] font-medium text-[11px]">
        🟢 Giống IP kết nối (không có dấu hiệu VPN)
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn font-sans w-full">
      {/* Search & Filter Header Card */}
      <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
            <input
              type="text"
              value={filters.search}
              onChange={handleSearchChange}
              placeholder="Tìm theo IP, Tên, Mã đơn, Phone..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#F2F2F7] rounded-full text-xs font-medium text-[#1D1D1F] placeholder-[#86868B] border border-transparent focus:border-[#0071E3] focus:bg-white focus:outline-none transition-all"
            />
          </div>

          {/* View Mode Toggle: Orders Only vs All */}
          <div className="flex items-center gap-1.5 bg-[#E8F2FF] p-1 rounded-full text-xs font-bold border border-[#0071E3]/20">
            <button
              onClick={() => handleViewMode(true)}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
                ordersOnlyFilter
                  ? 'bg-[#0071E3] text-white shadow-sm'
                  : 'text-[#0071E3] hover:bg-[#0071E3]/10'
              }`}
            >
              <ShoppingCart className="w-3.5 h-3.5" />
              <span>🛒 Chỉ Đơn Hàng ({logs ? logs.filter(l => l.order_info !== null).length : 0})</span>
            </button>
            <button
              onClick={() => handleViewMode(false)}
              className={`px-4 py-1.5 rounded-full transition-all flex items-center gap-1.5 cursor-pointer ${
                !ordersOnlyFilter
                  ? 'bg-[#1D1D1F] text-[#E5E5EA] shadow-sm'
                  : 'text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              <span>🌐 Tất Cả (Gồm lượt xem trang)</span>
            </button>
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-[#F2F2F7] p-1 rounded-full text-xs font-bold">
            <button
              onClick={() => handleRiskFilter('ALL')}
              className={`px-3 py-1.5 rounded-full transition-all cursor-pointer ${
                filters.risk_level === 'ALL'
                  ? 'bg-white text-[#1D1D1F] shadow-sm'
                  : 'text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => handleRiskFilter('HIGH_RISK')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1 cursor-pointer ${
                filters.risk_level === 'HIGH_RISK'
                  ? 'bg-[#FF3B30] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-[#FF3B30]'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>Fake IP / VPN</span>
            </button>
            <button
              onClick={() => handleRiskFilter('CLEAN')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1 cursor-pointer ${
                filters.risk_level === 'CLEAN'
                  ? 'bg-[#34C759] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-[#34C759]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>IP Thật An toàn</span>
            </button>
          </div>
        </div>

        {/* Date Presets */}
        <div className="pt-3 border-t border-[#E5E5EA] flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#86868B] font-bold">
            <Calendar className="w-4 h-4 text-[#0071E3]" />
            <span>Quét thời gian:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-bold">
            <button
              onClick={() => handleDatePreset('TODAY')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm ${
                isTodayDefault ? 'bg-[#0071E3] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              ✨ Hôm nay (Mặc định)
            </button>
            <button
              onClick={() => handleDatePreset('7_DAYS')}
              className="px-3.5 py-1.5 rounded-full bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA] transition-all cursor-pointer"
            >
              7 ngày qua
            </button>
            <button
              onClick={() => handleDatePreset('30_DAYS')}
              className="px-3.5 py-1.5 rounded-full bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA] transition-all cursor-pointer"
            >
              30 ngày qua
            </button>
            <button
              onClick={() => handleDatePreset('ALL')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer ${
                !filters.startDate && !filters.endDate ? 'bg-[#0071E3] text-white' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              Tất cả thời gian
            </button>
          </div>
        </div>
      </div>

      {/* Spacious Widescreen Table */}
      <div className="apple-card rounded-3xl overflow-hidden shadow-sm bg-white border border-[#E5E5EA] w-full">
        <div className="overflow-x-auto w-full">
          <table className="w-full text-left border-collapse min-w-full">
            <thead>
              <tr className="border-b border-[#E5E5EA] text-[11px] font-bold text-[#86868B] uppercase tracking-wider bg-[#FAFAFC]">
                <th className="py-4 px-6 w-48">{ordersOnlyFilter ? 'Thời gian tạo đơn' : 'Thời gian hoạt động'}</th>
                <th className="py-4 px-6 w-64">{ordersOnlyFilter ? 'Mã đơn & Khách hàng' : 'Hoạt động của khách'}</th>
                <th className="py-4 px-6 w-60">{ordersOnlyFilter ? 'Thời gian thao tác của User' : 'URL tương tác cuối'}</th>
                <th className="py-4 px-6">Phân tích Chi tiết IP (Fake IP vs IP Thật)</th>
                <th className="py-4 px-6 w-44">Trạng thái Cảnh báo</th>
                <th className="py-4 px-6 text-right w-48">Hành động Chặn IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5EA] text-xs font-medium text-[#1D1D1F]">
              {displayedLogs && displayedLogs.length > 0 ? (
                displayedLogs.map((log) => {
                  const isHighRisk = log.risk_level === 'HIGH_RISK';
                  const order = log.order_info;
                  const isBlocked = log.is_blacklisted;

                  return (
                    <tr
                      key={log.id}
                      className={`hover:bg-[#F5F5F7]/80 transition-colors ${
                        isBlocked ? 'bg-[#FF3B30]/10' : (isHighRisk ? 'bg-[#FF3B30]/5' : '')
                      }`}
                    >
                      {/* 1. Time */}
                      <td className="py-4 px-6 whitespace-nowrap text-[11px]">
                        <div className="font-extrabold text-[#1D1D1F] text-xs">{new Date(log.created_at).toLocaleTimeString('vi-VN')}</div>
                        <div className="text-[#86868B] font-mono mt-0.5">{new Date(log.created_at).toLocaleDateString('vi-VN')}</div>
                      </td>

                      {/* 2. Order Info */}
                      <td className="py-4 px-6">
                        {order ? (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 font-black text-[#0071E3] text-sm bg-[#E8F2FF] px-2.5 py-0.5 rounded-lg border border-[#0071E3]/20">
                              🛒 {order.order_id || 'N/A'}
                            </span>
                            <div className="font-bold text-[#1D1D1F] text-xs">
                              {order.customer_name || 'Khách vãng lai'}
                            </div>
                            {order.phone && (
                              <div className="text-[11px] text-[#86868B] font-mono">
                                📞 {order.phone}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-[#1D1D1F] font-bold">
                            {log.connection_status === 'inactive' ? <CircleOff className="w-3.5 h-3.5 text-[#86868B]" /> : <MousePointer2 className="w-3.5 h-3.5 text-[#0071E3]" />}
                            {log.connection_status === 'inactive' ? 'Đã rời trang' : 'Đã tương tác'}
                          </span>
                        )}
                      </td>

                      {/* 3. Calculated User Time Taken to Place Order */}
                      <td className="py-4 px-6 whitespace-nowrap">
                        {order ? (
                          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#F2F2F7] border border-[#E5E5EA] font-extrabold text-xs text-[#1D1D1F]">
                            <Clock className="w-3.5 h-3.5 text-[#0071E3]" />
                            <span title="Ước tính từ phiên truy cập gần nhất; chỉ xác thực khi đơn có phiên checkout tương ứng.">⏱️ {log.time_to_order || 'Chưa bắt được phiên'}</span>
                          </div>
                        ) : (
                          <div className="space-y-1 max-w-[250px]">
                            <a href={log.last_clicked_url || log.url} target="_blank" rel="noreferrer" title={log.last_clicked_url || log.url || ''} className="block truncate text-[11px] font-mono text-[#0071E3] hover:underline">
                              {log.last_clicked_url || log.url || 'Không xác định URL'}
                            </a>
                            <span className={`inline-flex items-center gap-1 text-[10px] font-bold ${log.connection_status === 'inactive' ? 'text-[#86868B]' : 'text-[#34C759]'}`}>
                              {log.connection_status === 'inactive' ? <CircleOff className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                              {log.connection_status === 'inactive' ? 'Đã rời trang' : 'Đang hoạt động'}
                            </span>
                          </div>
                        )}
                      </td>

                      {/* 4. Concentrated Single IP Card */}
                      <td className="py-4 px-6">
                        <div className="space-y-1.5">
                          {/* Connection / Fake IP Line */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[#86868B] font-bold text-[11px] w-24 shrink-0">IP Kết nối:</span>
                            {isHighRisk ? (
                              <span className="font-mono font-extrabold text-[#FF3B30] bg-[#FF3B30]/10 px-2.5 py-0.5 rounded-md border border-[#FF3B30]/30 flex items-center gap-1">
                                🔴 {log.client_ip}
                                <span className="text-[10px] text-[#FF3B30] font-sans font-normal ml-1">({log.country || 'US'} · {log.isp})</span>
                              </span>
                            ) : (
                              <span className="font-mono font-extrabold text-[#34C759] bg-[#34C759]/10 px-2.5 py-0.5 rounded-md border border-[#34C759]/30 flex items-center gap-1">
                                🟢 {log.client_ip}
                                <span className="text-[10px] text-[#34C759] font-sans font-normal ml-1">({log.country || 'VN'} · {log.isp})</span>
                              </span>
                            )}
                          </div>

                          {!order && (
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="text-[#86868B] font-bold w-24 shrink-0">Thiết bị:</span>
                              <span className="inline-flex items-center gap-1 text-[#1D1D1F] font-bold">
                                {renderDeviceIcon(log.device_type)} {log.device_type || 'Unknown'}
                              </span>
                            </div>
                          )}

                          {/* Real WebRTC Leak IP Line */}
                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[#86868B] font-bold text-[11px] w-24 shrink-0">IP Gốc Thực tế:</span>
                            {renderOriginIpBadge(log, isHighRisk)}
                          </div>
                        </div>
                      </td>

                      {/* 5. Risk Status */}
                      <td className="py-4 px-6 whitespace-nowrap">
                        {isBlocked ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-black bg-[#FF3B30] text-white shadow-sm">
                            <Ban className="w-4 h-4" />
                            <span>🚫 ĐÃ CHẶN TRUY CẬP</span>
                          </span>
                        ) : isHighRisk ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-black bg-[#FF3B30]/10 text-[#FF3B30] border border-[#FF3B30]/30 shadow-sm">
                            <ShieldAlert className="w-4 h-4" />
                            <span>🔴 CẢNH BÁO FAKE IP</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/30">
                            <ShieldCheck className="w-4 h-4" />
                            <span>🟢 IP THẬT AN TOÀN</span>
                          </span>
                        )}
                      </td>

                      {/* 6. Actions (Block vs Unblock Button Toggle) */}
                      <td className="py-4 px-6 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedLog(log)}
                            className="flex items-center gap-1 px-3 py-1.5 text-xs font-bold bg-[#0071E3]/10 hover:bg-[#0071E3] text-[#0071E3] hover:text-white rounded-full transition-all cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>Chi tiết</span>
                          </button>

                          {isBlocked ? (
                            <button
                              onClick={() => handleUnblockIp(log)}
                              className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-extrabold bg-[#34C759] hover:bg-[#2FB34F] text-white rounded-full transition-all shadow-sm cursor-pointer"
                              title="Gỡ IP khỏi Blacklist để cho phép truy cập lại"
                            >
                              <Unlock className="w-3.5 h-3.5" />
                              <span>Bỏ Chặn IP</span>
                            </button>
                          ) : (
                            <button
                              onClick={() => handleBlockIp(log)}
                              className="flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold bg-[#FF3B30]/10 hover:bg-[#FF3B30] text-[#FF3B30] hover:text-white rounded-full transition-all cursor-pointer"
                              title="Chặn IP này không cho truy cập website Sapo nữa"
                            >
                              <Ban className="w-3.5 h-3.5" />
                              <span>Chặn IP</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan="6" className="py-12 text-center text-[#86868B] text-xs font-medium">
                    {ordersOnlyFilter ? 'Không tìm thấy đơn hàng phù hợp với bộ lọc đã chọn' : 'Chưa có lượt tương tác mới. Dữ liệu sẽ tự xuất hiện sau khi khách nhấp trên website.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Detail Modal with Time to Order */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-white rounded-3xl p-6 max-w-xl w-full shadow-2xl space-y-6 relative border border-[#E5E5EA] max-h-[90vh] overflow-y-auto font-sans">
            <button
              onClick={() => setSelectedLog(null)}
              className="absolute top-5 right-5 p-2 rounded-full text-[#86868B] hover:bg-[#F2F2F7] transition-all cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Modal Header */}
            <div className="flex items-center gap-3">
              <div className={`w-11 h-11 rounded-2xl flex items-center justify-center text-white ${
                selectedLog.is_blacklisted ? 'bg-[#FF3B30]' : (selectedLog.risk_level === 'HIGH_RISK' ? 'bg-[#FF3B30]' : 'bg-[#34C759]')
              }`}>
                {selectedLog.risk_level === 'HIGH_RISK' ? <ShieldAlert className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />}
              </div>
              <div>
                <h3 className="text-lg font-extrabold text-[#1D1D1F]">
                  Phân tích Đơn hàng {selectedLog.order_info?.order_id || `#${selectedLog.id}`}
                </h3>
                <p className="text-xs text-[#86868B] font-mono">
                  Đặt lúc: {new Date(selectedLog.created_at).toLocaleTimeString('vi-VN')} {new Date(selectedLog.created_at).toLocaleDateString('vi-VN')}
                </p>
              </div>
            </div>

            {/* User Time Taken Card */}
            {selectedLog.order_info && (
              <div className="p-4 rounded-2xl bg-[#E8F2FF] border border-[#0071E3]/20 text-xs flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-[#0071E3]" />
                  <div>
                    <span className="font-extrabold text-[#0071E3] block">Thời gian user thao tác đến khi đặt hàng:</span>
                    <span className="text-sm font-black text-[#1D1D1F]">{selectedLog.time_to_order || 'Chưa bắt được phiên'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* IP Comparison Card */}
            <div className="p-4 rounded-2xl bg-[#F2F2F7] border border-[#E5E5EA] space-y-3 text-xs">
              <div className="font-extrabold text-[#1D1D1F] text-xs uppercase tracking-wider">
                Chi tiết Địa chỉ IP Đơn hàng:
              </div>

              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] flex items-center justify-between">
                  <div>
                    <span className="text-[#86868B] font-bold block text-[11px]">1. IP KẾT NỐI (IP FAKE / VPN):</span>
                    <span className="font-mono font-extrabold text-sm text-[#FF3B30]">{selectedLog.client_ip}</span>
                  </div>
                  <span className="text-right text-[11px] text-[#86868B]">
                    <strong>{selectedLog.isp}</strong><br />{selectedLog.country} ({selectedLog.city})
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] flex items-center justify-between">
                  <div>
                    <span className="text-[#86868B] font-bold block text-[11px]">2. IP GỐC THỰC TẾ (WEBRTC LEAK):</span>
                    <div className="mt-1">
                      {renderOriginIpBadge(selectedLog, selectedLog.risk_level === 'HIGH_RISK')}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Order Details */}
            {selectedLog.order_info && (
              <div className="p-4 rounded-2xl bg-[#F2F2F7] border border-[#E5E5EA] text-xs space-y-2">
                <div className="font-extrabold text-[#0071E3] flex items-center justify-between">
                  <span>🛒 Chi tiết Đơn hàng Sapo</span>
                  <span className="font-mono text-sm">{selectedLog.order_info.order_id}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[#1D1D1F]">
                  <div>
                    <span className="text-[#86868B] font-bold block">Khách hàng:</span>
                    <span>{selectedLog.order_info.customer_name || 'Khách vãng lai'}</span>
                  </div>
                  <div>
                    <span className="text-[#86868B] font-bold block">Số điện thoại:</span>
                    <span className="font-mono font-bold">{selectedLog.order_info.phone || 'N/A'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Actions (Block vs Unblock Button inside Modal) */}
            <div className="flex items-center gap-3">
              {selectedLog.is_blacklisted ? (
                <button
                  onClick={() => handleUnblockIp(selectedLog).then(success => success && setSelectedLog(null))}
                  className="w-full py-2.5 bg-[#34C759] hover:bg-[#2FB34F] text-white text-xs font-bold rounded-full transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Unlock className="w-4 h-4" />
                  <span>Bỏ Chặn IP ({selectedLog.client_ip})</span>
                </button>
              ) : (
                <button
                  onClick={() => handleBlockIp(selectedLog).then(success => success && setSelectedLog(null))}
                  className="w-full py-2.5 bg-[#FF3B30] hover:bg-[#E03126] text-white text-xs font-bold rounded-full transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Ban className="w-4 h-4" />
                  <span>Chặn IP này không cho truy cập Sapo ({selectedLog.client_ip})</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
