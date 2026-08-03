import React, { useState } from 'react';
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react';

export default function AdminAccess({ onUnlock, error, isChecking }) {
  const [key, setKey] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = (event) => {
    event.preventDefault();
    if (key.trim()) onUnlock(key.trim());
  };

  return (
    <main className="min-h-screen bg-[#F5F5F7] flex items-center justify-center p-5 font-sans">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-[#E5E5EA] rounded-lg shadow-sm p-6 space-y-5">
        <div className="w-10 h-10 bg-[#E8F2FF] text-[#0071E3] rounded-lg flex items-center justify-center"><ShieldCheck className="w-5 h-5" /></div>
        <div>
          <h1 className="text-lg font-extrabold text-[#1D1D1F]">Sapo IP Guard</h1>
          <p className="text-xs text-[#6E6E73] mt-1">Nhập mật khẩu để truy cập dashboard.</p>
        </div>
        <label className="block text-xs font-bold text-[#1D1D1F]">
          Mật khẩu
          <div className="relative mt-2">
            <KeyRound className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#86868B]" />
            <input autoFocus required autoComplete="current-password" type={showPassword ? 'text' : 'password'} value={key} onChange={(event) => setKey(event.target.value)} className="w-full pl-10 pr-10 py-2.5 rounded-lg border border-[#D1D1D6] text-sm focus:outline-none focus:border-[#0071E3]" />
            <button type="button" onClick={() => setShowPassword(value => !value)} title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'} className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-[#86868B] hover:text-[#1D1D1F] cursor-pointer">
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </label>
        {error && <p role="alert" className="text-xs text-[#B42318] bg-[#FFEBEA] px-3 py-2 rounded-lg">{error}</p>}
        <button disabled={isChecking} type="submit" className="w-full py-2.5 rounded-lg bg-[#0071E3] disabled:opacity-60 text-white text-sm font-bold cursor-pointer">{isChecking ? 'Đang kiểm tra...' : 'Đăng nhập'}</button>
      </form>
    </main>
  );
}
