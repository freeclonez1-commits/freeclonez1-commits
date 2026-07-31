import React, { useState } from 'react';
import { Code2, Copy, Check, Terminal, Globe, ShieldCheck, Zap } from 'lucide-react';

export default function ScriptGenerator() {
  const [copied, setCopied] = useState(false);
  const [customBackendUrl, setCustomBackendUrl] = useState('');

  const defaultTunnelUrl = 'https://bxkqeu-ip-171-224-0-81.tunnelmole.net';

  const effectiveBackendUrl = customBackendUrl.trim()
    ? customBackendUrl.trim().replace(/\/$/, '')
    : defaultTunnelUrl;

  const codeSnippet = `<!-- SAPO FAKE IP & WEBRTC LEAK TRACKER SCRIPT (HTTPS PRODUCTION) -->
<script>
  window.SAPO_TRACKER_CONFIG = {
    backendUrl: "${effectiveBackendUrl}"
  };
</script>
<script src="${effectiveBackendUrl}/client-tracker.js" async></script>`;

  const handleCopy = () => {
    navigator.clipboard.writeText(codeSnippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 animate-fadeIn font-sans">
      {/* Header */}
      <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F] font-sans flex items-center gap-2">
            <Code2 className="w-5 h-5 text-[#0071E3]" />
            <span>Tích Hợp Đoạn Mã Tracking Thực Tế Cho Sapo Theme</span>
          </h2>
          <p className="text-xs text-[#86868B] mt-1 font-medium">
            Mã nhúng HTTPS công khai đã được khởi chạy sẵn sàng kết nối trực tiếp với website Sapo của bạn.
          </p>
        </div>
      </div>

      {/* Backend URL Configuration Box */}
      <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-3">
        <label className="block text-xs font-bold text-[#1D1D1F] flex items-center gap-2">
          <Globe className="w-4 h-4 text-[#34C759]" />
          <span>Cấu hình Domain Backend API Sản Xuất (Public Server URL / Tunnel):</span>
        </label>
        <div className="flex flex-col sm:flex-row items-center gap-3">
          <input
            type="text"
            value={customBackendUrl}
            onChange={(e) => setCustomBackendUrl(e.target.value)}
            placeholder={`Đã tự tạo sẵn: ${defaultTunnelUrl}`}
            className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-xs font-mono text-[#0071E3] font-bold placeholder-[#86868B] focus:outline-none focus:border-[#0071E3] focus:bg-white"
          />
          {customBackendUrl && (
            <button
              onClick={() => setCustomBackendUrl('')}
              className="px-4 py-2 text-xs font-bold bg-[#F2F2F7] hover:bg-[#E5E5EA] text-[#1D1D1F] rounded-full whitespace-nowrap border border-[#E5E5EA]"
            >
              Đặt về Mặc định
            </button>
          )}
        </div>
        <p className="text-[11px] text-[#86868B] font-medium">
          💡 <strong>Đường truyền HTTPS đang chạy:</strong> <code>{effectiveBackendUrl}</code>
        </p>
      </div>

      {/* Code Snippet Box */}
      <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-[#1D1D1F] font-bold">
            <Terminal className="w-4 h-4 text-[#34C759]" />
            <span>Mã HTML Script (Chèn trước thẻ &lt;/head&gt; trong theme.bwt / theme.biquyet.xml)</span>
          </div>
          <button
            onClick={handleCopy}
            className={`px-4 py-2 rounded-full text-xs font-bold flex items-center gap-2 transition-all shadow-sm cursor-pointer ${
              copied
                ? 'bg-[#34C759] text-white'
                : 'bg-[#0071E3] hover:bg-[#0077ED] text-white'
            }`}
          >
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            <span>{copied ? 'Đã sao chép!' : 'Sao chép mã'}</span>
          </button>
        </div>

        <div className="relative">
          <pre className="p-4 bg-[#F2F2F7] rounded-2xl border border-[#E5E5EA] font-mono text-xs text-[#0071E3] font-bold overflow-x-auto leading-relaxed">
            {codeSnippet}
          </pre>
        </div>
      </div>
    </div>
  );
}
