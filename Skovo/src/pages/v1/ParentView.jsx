import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../services/api';

const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Public page a parent opens from the consent link (§16 item 2): the child's
 *  wallet and a delete request. No login; the token is the key. */
export default function ParentView() {
  const [sp] = useSearchParams();
  const token = sp.get('token') || '';
  const [d, setD] = useState(null);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api.get('/auth/parent/overview', { token })
      .then(({ data }) => setD(data?.bool ? data.response : { error: data?.response?.message || 'This link is not valid.' }))
      .catch(() => setD({ error: 'This link is not valid.' }));
  }, [token]);

  const del = async () => {
    if (!window.confirm('Ask SKOVO to delete your child\'s account?')) return;
    const { data } = await api.post(`/auth/parent/delete-request?token=${encodeURIComponent(token)}`, {});
    setMsg(data?.response?.message || 'Could not send.');
  };

  return (
    <div className="min-h-screen bg-slate-50 flex justify-center p-4">
      <div className="w-full max-w-lg space-y-4 pt-8">
        <h1 className="text-xl font-bold text-slate-900">SKOVO — Parent view</h1>
        {!d && <p className="text-sm text-slate-400">Loading…</p>}
        {d?.error && <p className="text-sm text-red-600">{d.error}</p>}
        {d && !d.error && (
          <>
            <p className="text-sm text-slate-700">Hello {d.parent_name || ''}. This is {d.child_name}&apos;s account.</p>
            {d.consent_status !== 'confirmed' && <p className="text-sm text-amber-700">Consent is not confirmed yet, so details are hidden.</p>}
            {d.wallet && (
              <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
                <p className="text-sm font-bold">Wallet: {rupee(d.wallet.total)}</p>
                <p className="text-xs text-slate-500">Refund money {rupee(d.wallet.refund_money)} · bonus credit {rupee(d.wallet.bonus_credit)}</p>
                {d.wallet.history.map((h, i) => (
                  <div key={i} className="flex justify-between text-xs border-t border-slate-50 pt-1">
                    <span>{h.reason || h.kind} · {new Date(h.at).toLocaleDateString('en-IN')}</span>
                    <span className={h.amount < 0 ? 'text-red-600' : 'text-emerald-600'}>{rupee(h.amount)}</span>
                  </div>
                ))}
              </div>
            )}
            {d.consent_status === 'confirmed' && (
              msg ? <p className="text-sm text-slate-700">{msg}</p>
                : <button onClick={del} className="px-4 py-2 rounded-xl border border-red-300 text-red-700 text-sm">Request account deletion</button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
