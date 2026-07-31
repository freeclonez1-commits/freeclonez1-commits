import React, { useState, useEffect } from 'react';
import { ShieldCheck, Store, DownloadCloud, LockKeyhole } from 'lucide-react';

export default function Header({ stores, selectedStoreId, onSelectStore, onSyncOrders, isSyncing, onLock }) {
  const [time, setTime] = useState(new Date().toLocaleTimeString('vi-VN'));

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date().toLocaleTimeString('vi-VN')), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="sticky top-0 z-30 apple-glass px-3 md:px-6 py-3 flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div className="flex items-center gap-3 min-w-0">
        <div className="w-10 h-10 shrink-0 rounded-xl bg-gradient-to-br from-[#0071E3] to-[#409CFF] shadow-md flex items-center justify-center text-white">
          <ShieldCheck className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-base md:text-lg font-extrabold tracking-tight font-sans text-[#1D1D1F]">
            Sapo IP Guard <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-[#E8F2FF] text-[#0071E3] ml-1.5 border border-[#0071E3]/20">Multi-Store</span>
          </h1>
          <p className="text-xs text-[#86868B] font-medium flex items-center gap-2">
            <span>Giám sát IP Thực & IP Fake đơn hàng Sapo</span>
            <span className="inline-block w-2 h-2 rounded-full bg-[#34C759] animate-pulse"></span>
          </p>
        </div>
      </div>

      <div className="w-full md:w-auto flex items-center justify-end gap-2 overflow-x-auto">
        {/* Multi-Store Dropdown Switcher */}
        <div className="min-w-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#E5E5EA] text-xs font-bold text-[#1D1D1F] shadow-sm">
          <Store className="w-4 h-4 text-[#0071E3]" />
          <select
            value={selectedStoreId || 'ALL'}
            onChange={(e) => onSelectStore(e.target.value)}
            className="max-w-[180px] bg-transparent focus:outline-none cursor-pointer text-[#1D1D1F] font-bold truncate"
          >
            <option value="ALL">🌐 Tất cả cửa hàng Sapo</option>
            {stores && stores.map((s) => (
              <option key={s.id} value={s.id}>
                🛍️ {s.store_name} ({s.mysapo_domain})
              </option>
            ))}
          </select>
        </div>

        {/* Sync Sapo Orders Button */}
        <button
          onClick={onSyncOrders}
          disabled={isSyncing}
          className="shrink-0 flex items-center gap-2 px-3 md:px-4 py-1.5 text-xs font-bold bg-[#34C759] hover:bg-[#2FB34F] active:scale-95 text-white rounded-full shadow-sm transition-all cursor-pointer disabled:opacity-50"
          title="Đồng bộ tất cả đơn hàng đã tạo trên Sapo hôm nay"
        >
          <DownloadCloud className={`w-3.5 h-3.5 ${isSyncing ? 'animate-bounce' : ''}`} />
          <span>{isSyncing ? 'Đang đồng bộ...' : 'Đồng bộ đơn Sapo'}</span>
        </button>

        <button onClick={onLock} title="Khóa dashboard" className="shrink-0 p-2 text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#E5E5EA] rounded-full"><LockKeyhole className="w-4 h-4" /></button>
      </div>
    </header>
  );
}
