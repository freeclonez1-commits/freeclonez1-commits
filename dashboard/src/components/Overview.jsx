import React from 'react';
import {
  Users, ShieldAlert, ShoppingBag, Ban, TrendingUp, Cpu, ArrowUpRight
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid
} from 'recharts';

export default function Overview({ stats, chartData, onNavigateToLogs, isLoading, error }) {
  if (!stats) {
    return (
      <div className="min-h-[360px] flex items-center justify-center">
        <div className="text-center space-y-2">
          <p className="text-sm font-bold text-[#1D1D1F]">{error ? 'Chưa thể tải tổng quan' : 'Đang tải tổng quan...'}</p>
          <p className="text-xs text-[#86868B]">{error || 'Đang lấy dữ liệu từ Sapo IP Guard.'}</p>
          {!isLoading && <button onClick={onNavigateToLogs} className="text-xs font-bold text-[#0071E3]">Mở lịch sử logs</button>}
        </div>
      </div>
    );
  }

  const kpiCards = [
    {
      title: 'Tổng Lượt Logs',
      value: stats.totalLogs || 0,
      subtext: `${stats.cleanCount || 0} lượt sạch`,
      icon: Users,
      badgeColor: 'bg-[#E8F2FF] text-[#0071E3]',
      valueColor: 'text-[#1D1D1F]'
    },
    {
      title: 'Tỷ Lệ Fake IP / VPN',
      value: `${stats.vpnRate || 0}%`,
      subtext: `${stats.highRiskCount || 0} truy cập nguy cơ cao`,
      icon: ShieldAlert,
      badgeColor: 'bg-[#FFEBEA] text-[#FF3B30]',
      valueColor: 'text-[#FF3B30]'
    },
    {
      title: 'Đơn Nghi Vấn Trong Ngày',
      value: stats.suspiciousOrdersToday || 0,
      subtext: 'Đơn hàng từ IP VPN / WebRTC leak',
      icon: ShoppingBag,
      badgeColor: 'bg-[#FFF4E5] text-[#FF9500]',
      valueColor: 'text-[#1D1D1F]'
    },
    {
      title: 'IP Trong Blacklist',
      value: stats.totalBlacklisted || 0,
      subtext: 'Đang chặn truy cập/đặt hàng',
      icon: Ban,
      badgeColor: 'bg-[#F8EFFF] text-[#AF52DE]',
      valueColor: 'text-[#1D1D1F]'
    }
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Top Banner / Welcome */}
      <div className="p-6 rounded-3xl bg-gradient-to-r from-[#FFFFFF] via-[#F9FAFB] to-[#F2F2F7] border border-[#E5E5EA] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold text-[#1D1D1F] font-sans">
            Hệ thống Phát hiện & Thu thập Fake IP Sapo
          </h2>
          <p className="text-xs text-[#86868B] mt-1 font-medium">
            Tự động nhận diện dải IP Datacenter/VPN, rò rỉ WebRTC Leak và bảo vệ đơn hàng Sapo.
          </p>
        </div>
        <button
          onClick={onNavigateToLogs}
          className="px-4 py-2.5 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-bold rounded-full transition-all shadow-sm shrink-0 flex items-center gap-1.5 active:scale-95"
        >
          <span>Xem chi tiết Logs</span>
          <ArrowUpRight className="w-4 h-4" />
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {kpiCards.map((card, idx) => {
          const Icon = card.icon;
          return (
            <div
              key={idx}
              className="p-5 rounded-2xl apple-card apple-card-hover flex flex-col justify-between"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#86868B] uppercase tracking-wider">{card.title}</span>
                <div className={`p-2.5 rounded-xl ${card.badgeColor}`}>
                  <Icon className="w-4 h-4" />
                </div>
              </div>
              <div className="mt-4">
                <div className={`text-2xl font-black font-sans tracking-tight ${card.valueColor}`}>{card.value}</div>
                <div className="text-xs text-[#86868B] mt-1 font-medium">{card.subtext}</div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Charts Section */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Line Chart - Traffic over 24 hours */}
        <div className="lg:col-span-2 p-6 rounded-3xl apple-card flex flex-col justify-between">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-bold text-[#1D1D1F] font-sans flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-[#0071E3]" />
                <span>Lưu lượng truy cập theo giờ (24h)</span>
              </h3>
              <p className="text-xs text-[#86868B]">So sánh lưu lượng Sạch vs Fake IP / VPN</p>
            </div>
            <div className="flex items-center gap-4 text-xs font-medium">
              <span className="flex items-center gap-1.5 text-[#1D1D1F]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#34C759]"></span> IP Sạch
              </span>
              <span className="flex items-center gap-1.5 text-[#1D1D1F]">
                <span className="w-2.5 h-2.5 rounded-full bg-[#FF3B30]"></span> Fake IP / VPN
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            {chartData && chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCleanApple" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#34C759" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#34C759" stopOpacity={0}/>
                    </linearGradient>
                    <linearGradient id="colorHighRiskApple" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#FF3B30" stopOpacity={0.35}/>
                      <stop offset="95%" stopColor="#FF3B30" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" />
                  <XAxis dataKey="time_label" stroke="#86868B" fontSize={11} />
                  <YAxis stroke="#86868B" fontSize={11} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E5E5EA', borderRadius: '14px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                    labelStyle={{ color: '#1D1D1F', fontSize: '12px', fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="clean" name="Lượt Sạch" stroke="#34C759" fillOpacity={1} fill="url(#colorCleanApple)" strokeWidth={2.5} />
                  <Area type="monotone" dataKey="high_risk" name="Fake IP / VPN" stroke="#FF3B30" fillOpacity={1} fill="url(#colorHighRiskApple)" strokeWidth={2.5} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-xs text-[#86868B]">
                Chưa có đủ dữ liệu theo giờ để hiển thị biểu đồ
              </div>
            )}
          </div>
        </div>

        {/* Bar Chart - Top ISPs */}
        <div className="p-6 rounded-3xl apple-card flex flex-col justify-between">
          <div>
            <h3 className="text-base font-bold text-[#1D1D1F] font-sans flex items-center gap-2 mb-1">
              <Cpu className="w-4 h-4 text-[#AF52DE]" />
              <span>Top ISP dùng Fake IP</span>
            </h3>
            <p className="text-xs text-[#86868B] mb-4">Các nhà mạng/Hosting bị lạm dụng nhiều nhất</p>

            <div className="h-60 w-full">
              {stats.topIsps && stats.topIsps.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={stats.topIsps} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E5EA" horizontal={false} />
                    <XAxis type="number" stroke="#86868B" fontSize={11} allowDecimals={false} />
                    <YAxis dataKey="isp" type="category" stroke="#1D1D1F" fontSize={11} width={90} tickFormatter={(val) => val.length > 12 ? val.substring(0, 12) + '...' : val} />
                    <Tooltip
                      contentStyle={{ backgroundColor: '#FFFFFF', borderColor: '#E5E5EA', borderRadius: '14px', boxShadow: '0 8px 24px rgba(0,0,0,0.08)' }}
                    />
                    <Bar dataKey="count" name="Số lượt" fill="#AF52DE" radius={[0, 8, 8, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-xs text-[#86868B]">
                  Chưa ghi nhận ISP nguy cơ nào
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
