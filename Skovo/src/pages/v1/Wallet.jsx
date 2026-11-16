import React, { useCallback, useEffect, useState } from 'react';
import { Wallet as WalletIcon, Check, Clock, FileText, Info, RotateCcw } from 'lucide-react';
import { api, API_BASE_URL } from '../../services/api';
import { useToast, StudentPage } from '../../components/ui/index.jsx';

const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(v || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

/**
 * SKOVO Wallet + refund tracker (refunds & wallet spreadsheet).
 * Every refund lands here (v1: no bonus). It is spent on SKOVO only -- never sent to a bank.
 */
export default function Wallet() {
  const toast = useToast();
  const [w, setW] = useState(null);
  const [refunds, setRefunds] = useState([]);

  const load = useCallback(() => {
    api.get('/payments/wallet').then(({ data }) => data?.bool && setW(data.response)).catch(() => {});
    api.get('/payments/refunds').then(({ data }) => data?.bool && setRefunds(data.response.refunds || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (url, body, ok) => {
    const { data } = await api.post(url, body);
    if (data?.bool) { toast.success(data.response?.message || ok); load(); } else toast.error(data?.response?.message || 'Could not do that.');
  };

  // The credit note is a JWT-protected HTML page, so fetch it and open the result.
  const openNote = async (no) => {
    try {
      const res = await fetch(`${API_BASE_URL}/payments/credit-notes/${no}`, { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(new Blob([await res.text()], { type: 'text/html' }));
      window.open(url, '_blank', 'noopener');
    } catch { toast.error('Could not open the credit note.'); }
  };

  if (!w) return <StudentPage><p className="text-sm text-slate-400">Loading…</p></StudentPage>;

  return (
    <StudentPage>
      <div className="space-y-5 max-w-3xl">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Wallet &amp; refunds</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your wallet balance and every refund, step by step.</p>
        </div>

        {w.enabled ? (
          <>
            <div className="bg-gradient-to-br from-slate-900 to-slate-700 text-white rounded-2xl p-5">
              <div className="flex items-center gap-2 text-xs opacity-80"><WalletIcon size={14} /> SKOVO Wallet</div>
              <p className="text-3xl font-black mt-1">{rupee(w.total)}</p>
              <p className="text-xs opacity-70 mt-2">Refunds land here instantly.</p>
            </div>
            <p className="text-xs text-slate-500">
              Use it at checkout{w.usable_on.length ? ` for ${w.usable_on.join(', ')}` : ''}. Wallet money stays on SKOVO and is not sent to a bank.
            </p>


            <div className="bg-white border border-slate-200 rounded-2xl p-4">
              <h3 className="text-sm font-bold mb-2">History</h3>
              {w.history.length === 0 ? <p className="text-xs text-slate-400">No wallet activity yet.</p> : w.history.map((h, i) => (
                <div key={i} className="flex justify-between border-t border-slate-50 py-2 text-sm">
                  <div><p className="text-slate-800">{h.reason || h.kind}</p><p className="text-[11px] text-slate-500">{date(h.at)}{h.expires_at && ` · expires ${date(h.expires_at)}`}</p></div>
                  <span className={`font-semibold ${h.amount < 0 ? 'text-red-600' : 'text-emerald-600'}`}>{h.amount < 0 ? '−' : '+'}{rupee(Math.abs(h.amount))}</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><Info size={16} /></span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">Wallet is not switched on</p>
              <p className="text-sm text-slate-500 mt-0.5">Refunds go straight back to your original payment method.</p>
            </div>
          </div>
        )}

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-900">Refunds</h2>
            {/* Cancel Pro any time: the unused days come back to the wallet. The
                quote is shown first so the student sees exactly what they get. */}
            <button onClick={async () => {
              let q;
              try {
                const { data } = await api.get('/payments/subscription-refund');
                if (!data?.bool) { window.alert(data?.response?.message || 'No active Skovo Pro to cancel.'); return; }
                q = data.response;
              } catch { window.alert('Could not check your Skovo Pro right now.'); return; }
              const lines = [
                `You have used ${q.used_days} of ${q.total_days} days.`,
                `Unused ${q.unused_days} days: ${rupee(q.unused_value)}`,
                ...(q.fee > 0 ? [`SKOVO fee (${q.fee_pct}%): -${rupee(q.fee)}`] : []),
                ...(q.perks_used > 0 ? [`Classes taken free with Pro: -${rupee(q.perks_used)}`] : []),
                `${rupee(q.refund)} goes to your SKOVO Wallet.`,
                '',
                'Skovo Pro stops right away. Cancel now?',
              ];
              if (!window.confirm(lines.join(String.fromCharCode(10)))) return;
              post('/payments/subscription-refund', {}, 'Skovo Pro cancelled');
            }} className="min-h-11 px-3 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-600 hover:text-red-600 hover:border-red-200">Cancel Skovo Pro</button>
          </div>
          {refunds.length === 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl py-10 px-4 text-center">
              <RotateCcw size={28} className="mx-auto text-slate-300" />
              <p className="text-sm font-semibold text-slate-500 mt-3">No refunds</p>
              <p className="text-xs text-slate-400 mt-1">Any refund you get shows here with each step it has reached.</p>
            </div>
          )}
          {refunds.map((r) => (
            <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
              <div className="flex justify-between">
                <div>
                  <p className="text-sm font-bold">{rupee(r.amount)}</p>
                  <p className="text-xs text-slate-500">{r.kind} · to {r.destination === 'wallet' ? 'SKOVO Wallet' : 'original payment'}{r.reason && ` · ${r.reason}`}</p>
                </div>
                <span className="text-xs font-semibold px-2 py-1 rounded-lg bg-slate-100 h-fit">{r.status_label}</span>
              </div>
              <ol className="flex flex-wrap gap-x-4 gap-y-1">
                {r.timeline.map((t, i) => (
                  <li key={i} className={`inline-flex items-center gap-1 text-xs ${t.done ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {t.done ? <Check size={12} /> : <Clock size={12} />}{t.step}{t.reference && ` (ref ${t.reference})`}
                  </li>
                ))}
              </ol>
              <div className="flex gap-3">
                {r.credit_note && <button onClick={() => openNote(r.credit_note)} className="inline-flex items-center gap-1 text-xs text-blue-700"><FileText size={12} /> Credit note</button>}
                {r.can_move_to_wallet && <button onClick={() => post(`/payments/refunds/${r.id}/to-wallet`, {}, 'Moved')} className="text-xs font-semibold text-blue-700">Bank refund failed — add to my wallet instead</button>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </StudentPage>
  );
}
