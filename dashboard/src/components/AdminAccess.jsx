import React, { useState } from 'react';
import { KeyRound, ShieldCheck } from 'lucide-react';

export default function AdminAccess({ onUnlock, error, isChecking }) {
  const [key, setKey] = useState('');

  const submit = (event) => {
    event.preventDefault();
    if (key.trim()) onUnlock(key.trim());
  };

  return (
    <main className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-5 font-sans">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-[#E5E5EA] rounded-2xl shadow-sm p-6 space-y-5">
        <div className="w-10 h-10 bg-[#E8F2FF] text-[#0071E3] rounded-xl flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div>
        <div>
          <h1 className="text-lg font-extrabold text-[#1D1D1F]">Sapo IP Guard</h1>
          <p className="text-xs text-[#6E6E73] mt-1">Nhập khóa quản trị đã cấu hình trên server để mở dashboard.</p>
        </div>
        <label className="block text-xs font-bold text-[#1D1D1F]">
          Khóa quản trị
          <div className="relative mt-2">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
            <input autoFocus required type="password" value={key} onChange={(event) => setKey(event.target.value)} className="w-full pl-10 pr-3 py-2.5 rounded-lg border border-[#D1D1D6] text-sm focus:outline-none focus:border-[#0071E3]" />
          </div>
        </label>
        {error && <p role="alert" className="text-xs text-[#B42318] bg-[#FFEBEA] px-3 py-2 rounded-lg">{error}</p>}
        <button disabled={isChecking} type="submit" className="w-full py-2.5 rounded-lg bg-[#0071E3] disabled:opacity-60 text-white text-sm font-bold">{isChecking ? 'Đang kiểm tra...' : 'Mở dashboard'}</button>
      </form>
    </main>
  );
}
