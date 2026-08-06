import React, { useEffect, useState } from 'react';
import { Search, AlertTriangle, ShieldCheck, ShieldAlert, Ban, Eye, X, Globe, Calendar, ShoppingCart, Wifi, Clock, CheckCircle2, Unlock, Monitor, Smartphone, Tablet, MousePointer2, CircleOff, ChevronLeft, ChevronRight } from 'lucide-react';
import { businessDate, businessDateDaysAgo } from '../utils/dates';

export default function LogsTable({ logs, isLoading = false, error = '', onRetry, pagination, filters, setFilters, onAddToBlacklist, onRemoveFromBlacklist, onDeleteLog, onDatePresetChange }) {
  const [selectedLog, setSelectedLog] = useState(null);
  const [searchInput, setSearchInput] = useState(filters.search || '');
  const ordersOnlyFilter = filters.orders_only !== false;
  const isKnownIp = (ip) => {
    const value = String(ip || '').trim().toLowerCase();
    return Boolean(value && value !== 'unknown' && value !== '0.0.0.0' && value !== '::');
  };
  const isResolvedText = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return Boolean(normalized && !['unknown', 'xx', 'n/a', 'na', 'none', 'null', 'undefined'].includes(normalized));
  };
  const hasResolvedIpInfo = (log) => [
    log?.country,
    log?.country_code,
    log?.city,
    log?.isp,
    log?.org,
    log?.asn
  ].some(isResolvedText);
  const isUnknownLog = (log) => log?.risk_level === 'UNKNOWN' || !isKnownIp(log?.client_ip) || !hasResolvedIpInfo(log);
  const compactIp = (ip) => {
    const value = String(ip || 'unknown').trim();
    if (value.includes(':') && value.length > 24) return `${value.slice(0, 22)}...`;
    return value;
  };

  const todayStr = businessDate();
  const isTodayDefault = filters.startDate === todayStr && filters.endDate === todayStr;
  const is7Days = filters.startDate === businessDateDaysAgo(6) && filters.endDate === todayStr;
  const is30Days = filters.startDate === businessDateDaysAgo(29) && filters.endDate === todayStr;
  const isAll = !filters.startDate && !filters.endDate;

  useEffect(() => {
    setSearchInput(filters.search || '');
  }, [filters.search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) {
        setFilters(prev => ({ ...prev, search: searchInput, page: 1 }));
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, filters.search, setFilters]);

  const handleRiskFilter = (risk) => {
    setFilters(prev => ({ ...prev, risk_level: risk, page: 1 }));
  };

  const handleViewMode = (ordersOnly) => {
    setFilters(prev => ({ ...prev, orders_only: ordersOnly, page: 1 }));
  };

  const handleDatePreset = (preset) => {
    let nextFilters;
    if (preset === 'ALL') {
      nextFilters = { ...filters, startDate: '', endDate: '', page: 1, limit: 100 };
    } else if (preset === 'TODAY') {
      nextFilters = { ...filters, startDate: todayStr, endDate: todayStr, page: 1, limit: 20 };
    } else if (preset === '7_DAYS') {
      nextFilters = { ...filters, startDate: businessDateDaysAgo(6), endDate: todayStr, page: 1, limit: 50 };
    } else if (preset === '30_DAYS') {
      nextFilters = { ...filters, startDate: businessDateDaysAgo(29), endDate: todayStr, page: 1, limit: 50 };
    }
    if (!nextFilters) return;
    if (onDatePresetChange) onDatePresetChange(preset, nextFilters);
    else setFilters(nextFilters);
  };

  const handleBlockIp = async (log) => {
    if (!isKnownIp(log.client_ip)) {
      window.alert('Chưa có IP hợp lệ để chặn. Hãy đồng bộ lại đơn hoặc chờ tracker ghi nhận phiên truy cập.');
      return false;
    }
    // Optimistic UI update: instantly reflect block state on UI
    log.is_blacklisted = true;
    
    const reason = `Chặn IP truy cập website từ Đơn ${log.order_info?.order_id || log.id} (${log.isp || 'N/A'})`;
    const tasks = [onAddToBlacklist(log.client_ip, reason)];
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip) {
      tasks.push(onAddToBlacklist(log.webrtc_ip, `Chặn IP Gốc WebRTC từ Đơn ${log.order_info?.order_id || log.id}`));
    }
    try {
      const [blockedClientIp] = await Promise.all(tasks);
      return Boolean(blockedClientIp);
    } catch (err) {
      log.is_blacklisted = false;
      return false;
    }
  };

  const handleUnblockIp = async (log) => {
    if (!isKnownIp(log.client_ip)) return false;
    // Optimistic UI update: instantly reflect unblock state on UI
    log.is_blacklisted = false;

    const tasks = [onRemoveFromBlacklist(log.client_ip)];
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip) {
      tasks.push(onRemoveFromBlacklist(log.webrtc_ip));
    }
    try {
      const [unblockedClientIp] = await Promise.all(tasks);
      return Boolean(unblockedClientIp);
    } catch (err) {
      log.is_blacklisted = true;
      return false;
    }
  };

  // Backend filters orders before pagination; render full log dataset received
  const displayedLogs = logs ? logs.filter(log => {
    if (ordersOnlyFilter) {
      return Boolean(log.order_info && log.order_info.order_id);
    }
    return true;
  }) : [];

  const renderDeviceIcon = (device) => {
    if (device === 'Mobile') return <Smartphone className="w-3.5 h-3.5" />;
    if (device === 'Tablet') return <Tablet className="w-3.5 h-3.5" />;
    return <Monitor className="w-3.5 h-3.5" />;
  };

  const isForeignIpLog = (log) => {
    const code = String(log.country_code || '').toUpperCase().trim();
    const name = String(log.country || '').toLowerCase().trim();
    if (!code && !name) return false;
    if (code === 'VN' || name === 'vietnam' || name === 'việt nam' || code === 'XX' || name === 'unknown') return false;
    return true;
  };

  const riskPresentation = (log) => {
    if (isUnknownLog(log)) {
      return isKnownIp(log?.client_ip)
        ? { label: 'IP ĐÃ GHI NHẬN', mobileLabel: 'ĐÃ CÓ IP' }
        : { label: 'CHƯA CÓ IP', mobileLabel: 'CHƯA CÓ IP' };
    }
    if (log.webrtc_mismatch) return { label: 'LỆCH IP WEBRTC', mobileLabel: 'LỆCH WEBRTC' };
    if (log.is_tor) return { label: 'PHÁT HIỆN TOR', mobileLabel: 'TOR' };
    if (log.is_vpn || log.is_proxy) return { label: 'PHÁT HIỆN VPN / PROXY', mobileLabel: 'VPN / PROXY' };
    if (log.is_datacenter && log.is_abuser) return { label: 'IP DATACENTER RỦI RO', mobileLabel: 'DATACENTER RỦI RO' };
    if (log.is_datacenter) return { label: 'IP DATACENTER', mobileLabel: 'DATACENTER' };
    if (log.is_abuser) return { label: 'IP CÓ RỦI RO', mobileLabel: 'IP RỦI RO' };
    if (isForeignIpLog(log)) return { label: `IP NƯỚC NGOÀI (${log.country || log.country_code})`, mobileLabel: `IP ${log.country_code || 'NGOÀI'}` };
    if (log.risk_level === 'HIGH_RISK') return { label: 'FAKE IP / VPN', mobileLabel: 'FAKE IP' };
    return { label: 'CẦN KIỂM TRA', mobileLabel: 'CẦN KIỂM TRA' };
  };

  const readableRiskReasons = (log) => {
    const reasons = Array.isArray(log.risk_reasons) ? log.risk_reasons : [];
    return reasons.map((reason) => {
      if (reason.includes('WebRTC IP mismatch')) return 'IP WebRTC khác IP kết nối';
      if (reason.includes('Datacenter/hosting')) return 'IP thuộc hạ tầng datacenter/hosting';
      if (reason.includes('Abusive IP reputation')) return 'IP có danh tiếng rủi ro';
      if (reason.includes('Tor exit')) return 'IP là điểm thoát Tor';
      if (reason.includes('VPN')) return 'Phát hiện VPN/Proxy';
      if (reason.includes('Foreign IP')) return 'IP ngoài Việt Nam (Tự động cảnh báo Fake IP)';
      return reason;
    });
  };

  const networkLabel = (log) => {
    const country = log.country || 'Unknown';
    if (log.webrtc_mismatch) return `${country} · Lệch WebRTC`;
    if (log.is_tor) return `${country} · Tor`;
    if (log.is_vpn || log.is_proxy) return `${country} · ${log.vpn_service || 'VPN / Proxy'}`;
    if (log.is_datacenter && log.is_abuser) return `${country} · Datacenter rủi ro`;
    if (log.is_datacenter) return `${country} · Datacenter`;
    if (log.is_abuser) return `${country} · IP rủi ro`;
    return `${country} · ${log.isp || 'ISP chưa rõ'}`;
  };

  const renderConnectionIp = (log) => {
    if (isUnknownLog(log)) {
      return (
        <div className="flex flex-1 min-w-0 items-center gap-2" aria-label={`${log.client_ip || 'unknown'}, IP intelligence pending`}>
          <span className="shrink-0 font-mono font-extrabold text-[#86868B] bg-[#F2F2F7] px-2.5 py-0.5 rounded-md border border-[#D1D1D6]">
            {isKnownIp(log.client_ip) ? compactIp(log.client_ip) : '-- Chưa có IP'}
          </span>
          <span className="min-w-0 truncate text-[10px] font-sans font-medium text-[#86868B]">
            Đang chờ quét thủ công để tra ISP
          </span>
        </div>
      );
    }
    const isHighRisk = log.risk_level === 'HIGH_RISK';
    const color = isHighRisk ? 'text-[#FF3B30]' : 'text-[#34C759]';
    const background = isHighRisk ? 'bg-[#FF3B30]/10 border-[#FF3B30]/30' : 'bg-[#34C759]/10 border-[#34C759]/30';
    return (
      <div className="flex flex-1 min-w-0 items-center gap-2" aria-label={`${log.client_ip}, ${log.isp || 'ISP chưa rõ'}${log.asn ? `, ${log.asn}` : ''}`}>
        <span className={`shrink-0 font-mono font-extrabold px-2.5 py-0.5 rounded-md border ${color} ${background}`}>
          {isHighRisk ? '🔴' : '🟢'} {compactIp(log.client_ip)}
        </span>
        <span className={`min-w-0 truncate text-[10px] font-sans font-medium ${color}`}>
          {networkLabel(log)}
        </span>
      </div>
    );
  };

  const renderOriginIpBadge = (log, { full = false } = {}) => {
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip && log.webrtc_status !== 'stale') {
      const isRealFakeIp = log.webrtc_mismatch;
      if (!isRealFakeIp) {
        return (
          <span className="font-mono font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1 border break-all text-[#1D1D1F] bg-[#F2F2F7] border-[#E5E5EA]">
            {full ? log.webrtc_ip : compactIp(log.webrtc_ip)}
            <span className="font-sans text-[10px] text-[#86868B] font-medium">
              (IP WebRTC)
            </span>
          </span>
        );
      }
      return (
        <span className="font-mono font-black px-2.5 py-0.5 rounded-md flex items-center gap-1 border break-all text-white bg-[#FF3B30] border-[#FF3B30] shadow-sm">
          {full ? log.webrtc_ip : compactIp(log.webrtc_ip)}
          <span className="font-sans text-[10px] font-black">
            (Lệch IP kết nối)
          </span>
        </span>
      );
    }
    return null;
  };

  const renderWebRtcResult = (log, { full = false } = {}) => {
    if (log.webrtc_ip && log.webrtc_ip !== log.client_ip) {
      return renderOriginIpBadge(log, { full });
    }
    if (log.webrtc_ip && log.webrtc_ip === log.client_ip) {
      return (
        <span title="VPN/trinh duyet khong lam lo IP goc qua WebRTC" className="font-mono font-bold px-2.5 py-0.5 rounded-md flex items-center gap-1 border break-all text-[#1D1D1F] bg-[#F2F2F7] border-[#E5E5EA]">
          {full ? log.webrtc_ip : compactIp(log.webrtc_ip)}
          <span className="font-sans text-[10px] text-[#86868B] font-medium">(trung IP ket noi, khong lo IP goc)</span>
        </span>
      );
    }
    const labels = {
      pending: 'Đang kiểm tra WebRTC...',
      unsupported: 'Trình duyệt không hỗ trợ WebRTC',
      private_only: 'WebRTC chỉ trả IP nội bộ',
      hidden: 'WebRTC bị trình duyệt ẩn',
      not_available: full ? 'Không phát hiện IP WebRTC (trình duyệt/VPN không công khai hoặc đơn đồng bộ Sapo)' : 'Không phát hiện IP WebRTC',
      error: 'Không thể kiểm tra WebRTC'
    };
    const status = log.webrtc_status || 'not_available';
    return (
      <span title="Nhiều VPN và trình duyệt (Chrome/Brave) tự động ẩn WebRTC leak để bảo mật, hoặc đơn hàng đồng bộ từ Sapo API chưa gắn tracker WebRTC" className="font-sans font-bold px-2.5 py-0.5 rounded-md border text-[#86868B] bg-[#F2F2F7] border-[#E5E5EA]">
        {labels[status] || 'Không phát hiện IP WebRTC'}
      </span>
    );
  };

  return (
    <div className="space-y-6 animate-fadeIn font-sans w-full">
      {/* Search & Filter Header Card */}
      <div className="p-4 sm:p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-4">
          {/* Search Box */}
          <div className="relative w-full lg:w-80">
            <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
            <input
              type="text"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Tìm theo IP, Tên, Mã đơn, Phone..."
              className="w-full pl-10 pr-4 py-2.5 bg-[#F2F2F7] rounded-full text-xs font-medium text-[#1D1D1F] placeholder-[#86868B] border border-transparent focus:border-[#0071E3] focus:bg-white focus:outline-none transition-all"
            />
          </div>

          {/* Orders Counter Badge */}
          <div className="flex items-center gap-1.5 bg-[#E8F2FF] px-4 py-2 rounded-full text-xs font-black text-[#0071E3] border border-[#0071E3]/20 shadow-sm shrink-0">
            <ShoppingCart className="w-4 h-4 shrink-0 text-[#0071E3]" />
            <span>🛒 Danh sách Đơn Hàng ({pagination?.orderTotal ?? (logs ? logs.filter(l => l.order_info !== null).length : 0)})</span>
          </div>

          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-[#F2F2F7] p-1 rounded-full text-xs font-bold overflow-x-auto">
            <button
              onClick={() => handleRiskFilter('ALL')}
              className={`px-3 py-1.5 rounded-full transition-all cursor-pointer whitespace-nowrap ${
                filters.risk_level === 'ALL'
                  ? 'bg-white text-[#1D1D1F] shadow-sm'
                  : 'text-[#86868B] hover:text-[#1D1D1F]'
              }`}
            >
              Tất cả
            </button>
            <button
              onClick={() => handleRiskFilter('HIGH_RISK')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                filters.risk_level === 'HIGH_RISK'
                  ? 'bg-[#FF3B30] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-[#FF3B30]'
              }`}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Fake IP / VPN</span>
            </button>
            <button
              onClick={() => handleRiskFilter('CLEAN')}
              className={`px-3 py-1.5 rounded-full transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                filters.risk_level === 'CLEAN'
                  ? 'bg-[#34C759] text-white shadow-sm'
                  : 'text-[#86868B] hover:text-[#34C759]'
              }`}
            >
              <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
              <span>IP Thật An toàn</span>
            </button>
          </div>
        </div>

        {/* Date Presets */}
        <div className="pt-3 border-t border-[#E5E5EA] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-[#86868B] font-bold">
            <Calendar className="w-4 h-4 text-[#0071E3]" />
            <span>Quét thời gian:</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 font-bold w-full sm:w-auto">
            <button
              onClick={() => handleDatePreset('TODAY')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm ${
                isTodayDefault ? 'bg-[#0071E3] text-white font-extrabold' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              ✨ Hôm nay (Mặc định)
            </button>
            <button
              onClick={() => handleDatePreset('7_DAYS')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm ${
                is7Days ? 'bg-[#0071E3] text-white font-extrabold' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              7 ngày qua
            </button>
            <button
              onClick={() => handleDatePreset('30_DAYS')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm ${
                is30Days ? 'bg-[#0071E3] text-white font-extrabold' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              30 ngày qua
            </button>
            <button
              onClick={() => handleDatePreset('ALL')}
              className={`px-3.5 py-1.5 rounded-full transition-all cursor-pointer shadow-sm ${
                isAll ? 'bg-[#0071E3] text-white font-extrabold' : 'bg-[#F2F2F7] text-[#1D1D1F] hover:bg-[#E5E5EA]'
              }`}
            >
              Tất cả thời gian
            </button>
          </div>
        {/* Info Banner when logs exist in system but filtered count is 0 */}
        {!isLoading && logs && logs.length > 0 && displayedLogs.length === 0 && (
          <div className="p-3.5 px-5 rounded-2xl bg-[#E8F2FF] border border-[#0071E3]/20 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-bold text-[#0071E3] animate-fadeIn">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4 shrink-0 text-[#0071E3]" />
              <span>
                {isTodayDefault
                  ? `Đã lưu ${logs.length} dữ liệu trong hệ thống. Chưa phát sinh đơn mới trong ngày hôm nay (${new Date().toLocaleDateString('vi-VN')}).`
                  : `Đã lưu ${logs.length} dữ liệu trong hệ thống. Không có mục nào khớp bộ lọc hiện tại.`}
              </span>
            </div>
            <button
              onClick={() => {
                handleDatePreset('ALL');
                handleRiskFilter('ALL');
                setFilters(prev => ({ ...prev, search: '', page: 1 }));
              }}
              className="px-3.5 py-1.5 bg-[#0071E3] text-white rounded-full transition-all shrink-0 hover:bg-[#0077ED] cursor-pointer shadow-sm text-xs font-extrabold"
            >
              🌐 Hiển thị tất cả ({logs.length})
            </button>
          </div>
        )}
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
                  const isUnknown = isUnknownLog(log);
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
                            {renderConnectionIp(log)}
                          </div>

                          {!order && (
                            <div className="flex items-center gap-2 text-[11px]">
                              <span className="text-[#86868B] font-bold w-24 shrink-0">Thiết bị:</span>
                              <span className="inline-flex items-center gap-1 text-[#1D1D1F] font-bold">
                                {renderDeviceIcon(log.device_type)} {log.device_type || 'Unknown'}
                              </span>
                            </div>
                          )}

                          <div className="flex items-center gap-2 text-xs">
                            <span className="text-[#86868B] font-bold text-[11px] w-24 shrink-0">IP WebRTC:</span>
                            {renderWebRtcResult(log)}
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
                        ) : isUnknown ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-bold bg-[#F2F2F7] text-[#86868B] border border-[#D1D1D6]">
                            <AlertTriangle className="w-4 h-4" />
                            <span>{riskPresentation(log).label}</span>
                          </span>
                        ) : isHighRisk ? (
                          <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-black bg-[#FF3B30]/10 text-[#FF3B30] border border-[#FF3B30]/30 shadow-sm">
                            <ShieldAlert className="w-4 h-4" />
                            <span>{riskPresentation(log).label}</span>
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
                              disabled={!isKnownIp(log.client_ip)}
                              className={`flex items-center gap-1 px-3.5 py-1.5 text-xs font-bold rounded-full transition-all ${
                                !isKnownIp(log.client_ip)
                                  ? 'bg-[#F2F2F7] text-[#AEAEB2] cursor-not-allowed'
                                  : 'bg-[#FF3B30]/10 hover:bg-[#FF3B30] text-[#FF3B30] hover:text-white cursor-pointer'
                              }`}
                              title={!isKnownIp(log.client_ip) ? 'Chưa có IP hợp lệ để chặn' : 'Chặn IP này không cho truy cập website Sapo nữa'}
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
                    <div className="max-w-md mx-auto space-y-3">
                      <p className="font-bold text-[#1D1D1F] text-sm">
                        {error || (isLoading
                          ? 'Đang tải dữ liệu đơn hàng...'
                          : isTodayDefault
                          ? `Chưa có đơn hàng trong ngày hôm nay (${new Date().toLocaleDateString('vi-VN')})`
                          : 'Không tìm thấy đơn hàng phù hợp với bộ lọc')}
                      </p>
                      <p className="text-xs text-[#86868B]">
                        {isLoading
                          ? 'Danh sách cửa hàng đã sẵn sàng. Dữ liệu đơn hàng đang được tải nền.'
                          : isTodayDefault
                          ? 'Mặc định hệ thống hiển thị đơn "Hôm nay". Các đơn tạo ngày hôm qua vẫn được lưu an toàn. Bấm xem "Tất cả thời gian" để hiển thị lại:'
                          : (filters.risk_level !== 'ALL' || filters.search)
                          ? 'Đang có bộ lọc trạng thái hoặc từ khóa tìm kiếm. Hãy thử bỏ bộ lọc hoặc xem tất cả thời gian.'
                          : 'Thử đổi khoảng thời gian hoặc bấm Đồng bộ đơn Sapo.'}
                      </p>
                      <div className="flex items-center justify-center gap-2 pt-2">
                        {error && (
                          <button
                            onClick={onRetry}
                            className="px-4 py-2 bg-[#FF3B30] hover:bg-[#E03126] text-white rounded-full text-xs font-bold transition-all shadow-sm cursor-pointer"
                          >
                            Thử lại
                          </button>
                        )}
                        <button
                          onClick={() => handleDatePreset('ALL')}
                          className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white rounded-full text-xs font-bold transition-all shadow-sm cursor-pointer"
                        >
                          📅 Xem Tất Cả Thời Gian
                        </button>
                        {(filters.risk_level !== 'ALL' || filters.search) && (
                          <button
                            onClick={() => {
                              handleRiskFilter('ALL');
                              setFilters(prev => ({ ...prev, search: '', page: 1 }));
                            }}
                            className="px-4 py-2 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-full text-xs font-bold transition-all cursor-pointer"
                          >
                            🔄 Xóa Bộ Lọc Trạng Thái
                          </button>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile Card List (visible on mobile < lg) */}
      <div className="block lg:hidden space-y-3.5">
        {displayedLogs && displayedLogs.length > 0 ? (
          displayedLogs.map((log) => {
            const isHighRisk = log.risk_level === 'HIGH_RISK';
            const isUnknown = isUnknownLog(log);
            const order = log.order_info;
            const isBlocked = log.is_blacklisted;

            return (
              <div
                key={log.id}
                className={`p-4 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-3 ${
                  isBlocked ? 'border-[#FF3B30]/40 bg-[#FF3B30]/5' : (isHighRisk ? 'border-[#FF3B30]/30' : '')
                }`}
              >
                {/* Header: Date + Status Badge */}
                <div className="flex items-center justify-between gap-2 border-b border-[#F2F2F7] pb-2.5">
                  <div className="text-[11px] font-bold text-[#86868B] font-mono">
                    ⏰ {new Date(log.created_at).toLocaleTimeString('vi-VN')} · {new Date(log.created_at).toLocaleDateString('vi-VN')}
                  </div>
                  {isBlocked ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-[#FF3B30] text-white">
                      🚫 ĐÃ CHẶN
                    </span>
                  ) : isUnknown ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#F2F2F7] text-[#86868B] border border-[#D1D1D6]">
                      {riskPresentation(log).mobileLabel}
                    </span>
                  ) : isHighRisk ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-black bg-[#FF3B30]/10 text-[#FF3B30] border border-[#FF3B30]/30">
                      {riskPresentation(log).mobileLabel}
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-[#34C759]/10 text-[#34C759] border border-[#34C759]/30">
                      🟢 IP THẬT AN TOÀN
                    </span>
                  )}
                </div>

                {/* Body: Order Info & User Time */}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    {order ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1 font-black text-[#0071E3] text-sm bg-[#E8F2FF] px-2.5 py-0.5 rounded-lg border border-[#0071E3]/20">
                          🛒 {order.order_id || 'N/A'}
                        </span>
                        <div className="font-bold text-[#1D1D1F] text-xs">
                          {order.customer_name || 'Khách vãng lai'}
                        </div>
                        {order.phone && (
                          <div className="text-[11px] text-[#0071E3] font-mono font-bold">
                            📞 {order.phone}
                          </div>
                        )}
                      </div>
                    ) : (
                      <span className="font-bold text-xs text-[#1D1D1F]">Lượt xem trang</span>
                    )}
                  </div>

                  <div className="text-right">
                    <span className="text-[10px] font-bold text-[#86868B] block">Thao tác:</span>
                    <span className="inline-flex items-center gap-1 text-xs font-black text-[#1D1D1F] bg-[#F2F2F7] px-2.5 py-1 rounded-lg border border-[#E5E5EA]">
                      ⏱️ {log.time_to_order || 'Chưa bắt được phiên'}
                    </span>
                  </div>
                </div>

                {/* IP Info Box */}
                <div className="p-3 rounded-2xl bg-[#F9F9FB] border border-[#E5E5EA] space-y-1.5 text-xs">
                  <div className="space-y-1">
                    <span className="text-[#86868B] font-bold text-[11px]">IP Kết nối:</span>
                    {renderConnectionIp(log)}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-1 pt-1 border-t border-[#E5E5EA]">
                    <span className="text-[#86868B] font-bold text-[11px]">IP WebRTC:</span>
                    {renderWebRtcResult(log, { full: true })}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    onClick={() => setSelectedLog(log)}
                    className="flex-1 py-2 bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#0071E3] font-bold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" />
                    <span>Chi tiết</span>
                  </button>
                  {isBlocked ? (
                    <button
                      onClick={() => handleUnblockIp(log)}
                      className="flex-1 py-2 bg-[#34C759] text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1 cursor-pointer shadow-sm"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      <span>Bỏ Chặn IP</span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleBlockIp(log)}
                      disabled={!isKnownIp(log.client_ip)}
                      className={`flex-1 py-2 font-bold text-xs rounded-xl flex items-center justify-center gap-1 ${
                        !isKnownIp(log.client_ip)
                          ? 'bg-[#F2F2F7] text-[#AEAEB2] cursor-not-allowed'
                          : 'bg-[#FF3B30] text-white cursor-pointer shadow-sm'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                      <span>Chặn IP</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })
        ) : null}
      </div>

      {/* Pagination Controls Bar */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 sm:p-5 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm text-xs font-bold w-full">
          <div className="text-[#86868B] font-bold">
            Hiển thị trang <strong className="text-[#1D1D1F]">{pagination.page}</strong> / <strong className="text-[#1D1D1F]">{pagination.totalPages}</strong> (Tổng cộng <strong className="text-[#0071E3]">{pagination.total}</strong> đơn hàng trong khoảng thời gian đã chọn)
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setFilters(prev => ({ ...prev, page: Math.max(1, (pagination.page || 1) - 1) }))}
              disabled={pagination.page <= 1}
              className={`px-4 py-2 rounded-full transition-all flex items-center gap-1 shadow-sm text-xs font-bold ${
                pagination.page <= 1
                  ? 'bg-[#F2F2F7] text-[#AEAEB2] cursor-not-allowed'
                  : 'bg-[#0071E3] text-white hover:bg-[#0077ED] cursor-pointer'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Trang trước</span>
            </button>

            <span className="px-3.5 py-1.5 bg-[#F2F2F7] rounded-full font-mono text-[#1D1D1F] font-extrabold border border-[#E5E5EA]">
              {pagination.page} / {pagination.totalPages}
            </span>

            <button
              onClick={() => setFilters(prev => ({ ...prev, page: Math.min(pagination.totalPages, (pagination.page || 1) + 1) }))}
              disabled={pagination.page >= pagination.totalPages}
              className={`px-4 py-2 rounded-full transition-all flex items-center gap-1 shadow-sm text-xs font-bold ${
                pagination.page >= pagination.totalPages
                  ? 'bg-[#F2F2F7] text-[#AEAEB2] cursor-not-allowed'
                  : 'bg-[#0071E3] text-white hover:bg-[#0077ED] cursor-pointer'
              }`}
            >
              <span>Trang tiếp</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

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
                selectedLog.is_blacklisted ? 'bg-[#FF3B30]' : (selectedLog.risk_level === 'HIGH_RISK' ? 'bg-[#FF3B30]' : (isUnknownLog(selectedLog) ? 'bg-[#86868B]' : 'bg-[#34C759]'))
              }`}>
                {selectedLog.risk_level === 'HIGH_RISK' ? <ShieldAlert className="w-6 h-6" /> : (isUnknownLog(selectedLog) ? <AlertTriangle className="w-6 h-6" /> : <ShieldCheck className="w-6 h-6" />)}
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
                    <span className="text-[#86868B] font-bold block text-[11px]">1. IP KẾT NỐI (Sapo/Vercel ghi nhận):</span>
                    <span className={`font-mono font-extrabold text-sm break-all ${isUnknownLog(selectedLog) ? 'text-[#86868B]' : (selectedLog.risk_level === 'HIGH_RISK' ? 'text-[#FF3B30]' : 'text-[#34C759]')}`}>
                      {isKnownIp(selectedLog.client_ip) ? selectedLog.client_ip : 'Chưa có IP hợp lệ'}
                    </span>
                    {isUnknownLog(selectedLog) && isKnownIp(selectedLog.client_ip) && (
                      <span className="block text-[10px] font-bold text-[#86868B] mt-1">Đang đợi tra cứu quốc gia/ISP</span>
                    )}
                  </div>
                  <span className="text-right text-[11px] text-[#86868B]">
                    <strong>{selectedLog.isp}</strong><br />{selectedLog.country} ({selectedLog.city})
                  </span>
                </div>

                <div className="p-3 rounded-xl bg-white border border-[#E5E5EA] flex items-center justify-between">
                  <div>
                    <span className="text-[#86868B] font-bold block text-[11px]">2. IP WEBRTC (nếu trình duyệt công bố):</span>
                    <div className="mt-1">
                      {renderWebRtcResult(selectedLog, { full: true })}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {selectedLog.risk_level === 'HIGH_RISK' && (
              <div className="p-3 rounded-xl bg-[#FF3B30]/5 border border-[#FF3B30]/20 text-xs">
                <div className="flex items-center gap-2 font-extrabold text-[#B42318]">
                  <ShieldAlert className="w-4 h-4" />
                  <span>{riskPresentation(selectedLog).label}</span>
                </div>
                <p className="mt-1.5 text-[#6E6E73] leading-5">
                  {readableRiskReasons(selectedLog).join(' · ') || 'IP này cần được kiểm tra thêm trước khi xử lý đơn.'}
                </p>
              </div>
            )}

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
                  disabled={!isKnownIp(selectedLog.client_ip)}
                  className={`w-full py-2.5 text-xs font-bold rounded-full transition-all shadow-sm flex items-center justify-center gap-1.5 ${
                    !isKnownIp(selectedLog.client_ip)
                      ? 'bg-[#F2F2F7] text-[#AEAEB2] cursor-not-allowed'
                      : 'bg-[#FF3B30] hover:bg-[#E03126] text-white cursor-pointer'
                  }`}
                >
                  <Ban className="w-4 h-4" />
                  <span>{!isKnownIp(selectedLog.client_ip) ? 'Chưa có IP hợp lệ để chặn' : `Chặn IP này không cho truy cập Sapo (${selectedLog.client_ip})`}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
