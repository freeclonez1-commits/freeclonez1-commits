import React, { useState } from 'react';
import { Plus, Edit2, Trash2, Store, CheckCircle, AlertCircle, Eye, EyeOff, Copy, Check } from 'lucide-react';

export default function StoreManager({ stores, onAddStore, onUpdateStore, onDeleteStore }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingStore, setEditingStore] = useState(null);
  const [form, setForm] = useState({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' });
  const [showSecret, setShowSecret] = useState({});
  const [copiedKey, setCopiedKey] = useState(null);

  const resetForm = () => { setForm({ store_name: '', mysapo_domain: '', api_key: '', api_secret: '' }); };

  const handleAdd = () => { resetForm(); setEditingStore(null); setIsAdding(true); };
  const handleEdit = (store) => { setForm({ store_name: store.store_name, mysapo_domain: store.mysapo_domain, api_key: store.api_key || '', api_secret: store.api_secret || '' }); setEditingStore(store); setIsAdding(true); };
  const handleCancel = () => { setIsAdding(false); setEditingStore(null); resetForm(); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    let success;
    if (editingStore) {
      success = await onUpdateStore(editingStore.id, form.store_name, form.mysapo_domain, form.api_key, form.api_secret);
    } else {
      success = await onAddStore(form.store_name, form.mysapo_domain, form.api_key, form.api_secret);
    }
    if (!success) return;
    setIsAdding(false);
    setEditingStore(null);
    resetForm();
  };

  const handleCopy = (text, key) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fadeIn font-sans">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-[#1D1D1F] font-sans">
            Cửa hàng Sapo được liên kết
          </h2>
          <p className="text-xs text-[#86868B] mt-1 font-medium">
            Quản lý API Key để đồng bộ đơn hàng và theo dõi IP từ nhiều store Sapo.
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="px-4 py-2 bg-[#0071E3] hover:bg-[#0077ED] text-white text-xs font-bold rounded-full transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
        >
          <Plus className="w-4 h-4" />
          <span>Thêm cửa hàng</span>
        </button>
      </div>

      {/* Add/Edit Form */}
      {isAdding && (
        <div className="p-6 rounded-3xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-4">
          <h3 className="text-base font-bold text-[#1D1D1F]">
            {editingStore ? `Chỉnh sửa: ${editingStore.store_name}` : 'Thêm cửa hàng mới'}
          </h3>
          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block text-[#86868B] font-bold mb-1">Tên cửa hàng *</label>
              <input
                required
                type="text"
                value={form.store_name}
                onChange={e => setForm(p => ({ ...p, store_name: e.target.value }))}
                placeholder="Vua Đồ Hiệu"
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-[#86868B] font-bold mb-1">Mysapo Domain *</label>
              <input
                required
                type="text"
                value={form.mysapo_domain}
                onChange={e => setForm(p => ({ ...p, mysapo_domain: e.target.value }))}
                placeholder="vua-do-hieu.mysapo.net"
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-[#86868B] font-bold mb-1">API Key</label>
              <input
                type="text"
                value={form.api_key}
                onChange={e => setForm(p => ({ ...p, api_key: e.target.value }))}
                placeholder="Sapo API Key"
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>
            <div>
              <label className="block text-[#86868B] font-bold mb-1">API Secret</label>
              <input
                type="password"
                value={form.api_secret}
                onChange={e => setForm(p => ({ ...p, api_secret: e.target.value }))}
                placeholder={editingStore ? 'Leave blank to keep the current API Secret' : 'Sapo API Secret'}
                className="w-full px-4 py-2.5 bg-[#F2F2F7] border border-[#E5E5EA] rounded-2xl text-[#1D1D1F] font-mono focus:outline-none focus:border-[#0071E3] focus:bg-white"
              />
            </div>
            <div className="md:col-span-2 flex gap-3 pt-2">
              <button type="submit" className="px-6 py-2.5 bg-[#0071E3] text-white font-bold rounded-full text-xs cursor-pointer shadow-sm">
                {editingStore ? 'Lưu thay đổi' : 'Thêm cửa hàng'}
              </button>
              <button type="button" onClick={handleCancel} className="px-6 py-2.5 bg-[#F2F2F7] text-[#1D1D1F] font-bold rounded-full text-xs cursor-pointer">
                Hủy
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Store Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {stores && stores.map((store) => (
          <div key={store.id} className="p-5 rounded-2xl apple-card bg-white border border-[#E5E5EA] shadow-sm space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="font-extrabold text-[#1D1D1F] text-sm">{store.store_name}</h4>
                <p className="text-xs text-[#86868B] font-mono mt-0.5">{store.mysapo_domain}</p>
              </div>
              <div className="flex items-center gap-1">
                <button onClick={() => handleEdit(store)} className="p-1.5 text-[#86868B] hover:text-[#0071E3] rounded-full cursor-pointer">
                  <Edit2 className="w-4 h-4" />
                </button>
                <button onClick={() => onDeleteStore(store.id)} className="p-1.5 text-[#86868B] hover:text-[#FF3B30] rounded-full cursor-pointer">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {store.api_key ? (
              <div className="p-3 rounded-xl bg-[#F2F2F7] text-xs font-mono flex items-center justify-between">
                <span className="text-[#34C759] font-bold flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> API Ok
                </span>
                <span className="text-[#86868B]">{store.api_key.substring(0, 8)}...</span>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-[#FFF4E5] text-xs text-[#FF9500] font-medium flex items-center gap-1.5">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>Chưa cài API Key</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
