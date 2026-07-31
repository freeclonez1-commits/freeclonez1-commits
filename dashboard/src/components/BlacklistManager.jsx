import React, { useState } from 'react';
import { ShieldAlert, Plus, Trash2, Globe, AlertCircle } from 'lucide-react';

export default function BlacklistManager({ blacklist, onAdd, onRemove }) {
  const [newIp, setNewIp] = useState('');
  const [reason, setReason] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!newIp.trim()) {
      setErrorMsg('Vui lòng nhập địa chỉ IP');
      return;
    }
    setErrorMsg('');
    onAdd(newIp.trim(), reason.trim() || 'Bị chặn thủ công bởi Quản trị viên');
    setNewIp('');
    setReason('');
  };

  return (
    <div className="space-y-6 animate-fadeIn font-sans">
      {/* Header & Notice */}
      <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F] font-sans flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-[#FF3B30]" />
            <span>Quản Lý Danh Sách Đen (Blacklist IPs)</span>
          </h2>
          <p className="text-xs text-[#86868B] mt-1 font-medium">
            Các địa chỉ IP trong danh sách này sẽ bị đánh dấu Cảnh báo Cao ngay lập tức khi phát hiện truy cập/đặt hàng.
          </p>
        </div>
        <div className="px-4 py-2 rounded-full bg-[#F2F2F7] border border-[#E5E5EA] text-xs font-mono text-[#1D1D1F]">
          <span className="text-[#0071E3] font-bold">API Endpoint Check: </span>
          <span>GET /api/v1/blacklist/check?ip=...</span>
        </div>
      </div>

      {/* Grid: Add IP Form + Blacklist Table */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Form Add IP */}
        <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-4 h-fit">
          <h3 className="text-base font-bold text-[#1D1D1F] font-sans flex items-center gap-2">
            <Plus className="w-4 h-4 text-[#0071E3]" />
            <span>Thêm IP vào Danh Sách Đen</span>
          </h3>

          {errorMsg && (
            <div className="p-3 rounded-2xl bg-[#FFEBEA] border border-[#FF3B30]/20 text-xs text-[#FF3B30] flex items-center gap-2 font-medium">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            <div>
              <label className="block text-[#86868B] font-bold mb-1">Địa chỉ IP (IPv4):</label>
              <input
                type="text"
                value={newIp}
                onChange={(e) => setNewIp(e.target.value)}
                placeholder="Ví dụ: 165.22.100.41"
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>

            <div>
              <label className="block text-[#86868B] font-bold mb-1">Lý do chặn:</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Nhập lý do (ví dụ: Spammer, Đặt đơn ảo từ Proxy VPS)"
                rows={3}
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 bg-[#FF3B30] hover:bg-[#E03126] text-white font-bold rounded-full transition-all shadow-sm flex items-center justify-center gap-2 active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Thêm vào Blacklist</span>
            </button>
          </form>
        </div>

        {/* Table Blacklisted IPs */}
        <div className="lg:col-span-2 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm overflow-hidden flex flex-col justify-between">
          <div className="p-4 bg-[#F2F2F7]/80 border-b border-[#E5E5EA] flex items-center justify-between">
            <span className="text-xs font-bold text-[#1D1D1F]">
              Danh sách {blacklist ? blacklist.length : 0} IP đang bị chặn
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#F2F2F7]/50 border-b border-[#E5E5EA] text-[#86868B] text-[11px] font-bold uppercase tracking-wider">
                  <th className="py-3 px-4">Địa chỉ IP</th>
                  <th className="py-3 px-4">Lý do chặn</th>
                  <th className="py-3 px-4">Nguồn</th>
                  <th className="py-3 px-4">Ngày tạo</th>
                  <th className="py-3 px-4 text-right">Xóa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E5E5EA]/70 text-xs">
                {blacklist && blacklist.length > 0 ? (
                  blacklist.map((item) => (
                    <tr key={item.id} className="hover:bg-[#F9FAFB] text-[#1D1D1F]">
                      <td className="py-3 px-4 font-mono font-bold text-[#FF3B30] flex items-center gap-2">
                        <Globe className="w-3.5 h-3.5 text-[#86868B]" />
                        <span>{item.ip}</span>
                      </td>
                      <td className="py-3 px-4 max-w-xs truncate text-[#1D1D1F] font-medium" title={item.reason}>
                        {item.reason || 'Bị chặn bởi quản trị viên'}
                      </td>
                      <td className="py-3 px-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                          item.source === 'AUTO' ? 'bg-[#FFF4E5] text-[#FF9500] border border-[#FF9500]/20' : 'bg-[#F2F2F7] text-[#86868B]'
                        }`}>
                          {item.source}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-[11px] text-[#86868B]">
                        {new Date(item.created_at).toLocaleDateString('vi-VN')}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => onRemove(item.ip)}
                          className="p-1.5 rounded-xl bg-[#FFEBEA] hover:bg-[#FF3B30] text-[#FF3B30] hover:text-white transition-all cursor-pointer"
                          title="Gỡ IP khỏi Blacklist"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-[#86868B] text-xs">
                      Danh sách đen hiện đang trống
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
