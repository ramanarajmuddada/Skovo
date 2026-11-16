import React, { useEffect, useState } from 'react';
import { Wallet, Check } from 'lucide-react';
import { api } from '../../services/api';

/** "Use my SKOVO Wallet" at checkout. Shows only when the wallet is on, has
 *  money, and the admin allows it for this kind of purchase. */
export default function WalletToggle({ kind, checked, onChange, onBalance }) {
  const [w, setW] = useState(null);
  useEffect(() => { api.get('/payments/wallet').then(({ data }) => { if (data?.bool) { setW(data.response); onBalance?.(Number(data.response?.total || 0)); } }).catch(() => {}); }, []);  // eslint-disable-line react-hooks/exhaustive-deps
  if (!w?.enabled || !(w.total > 0)) return null;
  if (!w.usable_on.includes(kind)) return null;
  return (
    <label className="flex items-center gap-2.5 min-h-11 text-sm bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 cursor-pointer select-none">
      <input type="checkbox" className="peer sr-only" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden="true"
            className={`w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-300 ${checked ? 'bg-emerald-600 border-emerald-600' : 'bg-white border-slate-300'}`}>
        {checked && <Check size={13} strokeWidth={3} className="text-white" />}
      </span>
      <Wallet size={15} className="text-emerald-700 shrink-0" />
      <span className="font-medium text-slate-800">Use my SKOVO Wallet (₹{Number(w.total).toLocaleString('en-IN', { maximumFractionDigits: 2 })})</span>
    </label>
  );
}
