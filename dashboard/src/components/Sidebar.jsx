import React from 'react';
import { LayoutDashboard, ListFilter, ShieldAlert, Code2, Store } from 'lucide-react';

export default function Sidebar({ activeTab, setActiveTab }) {
  const navItems = [
    { id: 'overview', label: 'Tổng quan (KPIs)', icon: LayoutDashboard },
    { id: 'logs', label: 'Lịch sử Logs & IP', icon: ListFilter },
    { id: 'blacklist', label: 'Danh sách đen', icon: ShieldAlert },
    { id: 'stores', label: 'Liên kết Mysapo (Stores)', icon: Store },
    { id: 'script', label: 'Mã nhúng Sapo', icon: Code2 },
  ];

  return (
    <aside className="w-full md:w-64 bg-[#F2F2F7] border-b md:border-b-0 md:border-r border-[#E5E5EA] p-2 md:p-4 flex flex-row md:flex-col justify-between shrink-0">
      <div className="flex-1 overflow-x-auto">
        {/* Navigation Items */}
        <nav className="flex md:block gap-1.5 md:space-y-1.5 min-w-max">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`w-auto md:w-full flex items-center gap-2 md:gap-3 px-3.5 py-2.5 rounded-xl md:rounded-2xl text-xs font-bold transition-all ${
                  isActive
                    ? 'bg-white text-[#0071E3] shadow-sm border border-[#E5E5EA]'
                    : 'text-[#6E6E73] hover:text-[#1D1D1F] hover:bg-[#E5E5EA]/60'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-[#0071E3]' : 'text-[#86868B]'}`} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Footer Info */}
      <div className="hidden md:block pt-4 border-t border-[#E5E5EA] text-center">
        <p className="text-[11px] text-[#86868B] font-medium">Sapo Multi-Store Guard v1.0</p>
        <p className="text-[10px] text-[#A1A1A6] mt-0.5">Kiểm tra IP Thực & IP Fake Sapo</p>
      </div>
    </aside>
  );
}
