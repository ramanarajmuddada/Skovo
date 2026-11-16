/**
 * Admin → Payments → Achiever payouts.
 *
 *  1. Summary boxes: To pay · Sending · Paid this month · Failed.
 *  2. Status tabs with counts (Pending · Sending · Paid · Failed · Rejected · All).
 *  3. Search (achiever, UTR, UPI) and a date range (last 7 days by default).
 *  4. Review before paying: what the payout is made of, the achiever's
 *     standing (strikes, missed classes, open complaints) and warnings.
 *  5. Reject needs a written reason; the achiever is told it.
 *  6. Who did it: "Paid by X · time", UTR with a copy button.
 *  7. Sending rows re-check themselves every few seconds.
 *  8. Download the list as CSV (current tab, search and dates).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Wallet, Check, X, RefreshCw, Clock, Send, CheckCircle2, AlertTriangle, Copy, Download, ShieldCheck, Loader2 } from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { Tabs } from './v1/AdminV1Kit';
import StatTile from './StatTile';
import { SearchBar, DateRange, defaultRange, Button } from '../ui/index.jsx';
import { Pagination } from '../ui/TableComponents';

const BASE = '/skovo-platform-panel-admin/payouts';
const STYLE = {
  paid:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  failed:     'bg-red-50 text-red-600 border-red-200',
  rejected:   'bg-slate-100 text-slate-600 border-slate-200',
};
const LABEL = { pending: 'Pending', processing: 'Sending', paid: 'Paid', failed: 'Failed', rejected: 'Rejected' };
// Exact paise, never rounded: ₹2.25, ₹559.20.
const inr = (n) => { const v = Number(n || 0); return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—');
const dest = (p) => (p.method === 'upi' ? (p.upi || '—') : (p.account_number ? `${p.account_number}${p.ifsc ? ' / ' + p.ifsc : ''}` : '—'));

function Badge({ status }) {
  return <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STYLE[status] || STYLE.rejected}`}>{LABEL[status] || status}</span>;
}

function CopyUtr({ utr }) {
  const [done, setDone] = useState(false);
  if (!utr) return <span className="text-slate-300">—</span>;
  return (
    <button type="button" title="Copy UTR"
            onClick={(e) => { e.stopPropagation(); navigator.clipboard?.writeText(utr).then(() => { setDone(true); setTimeout(() => setDone(false), 1200); }); }}
            className="inline-flex items-center gap-1 font-mono text-xs text-slate-600 hover:text-slate-900">
      {utr} {done ? <Check size={12} className="text-emerald-600" /> : <Copy size={12} />}
    </button>
  );
}

function WhoDid({ p }) {
  if (!p.done_by || !['paid', 'rejected', 'processing', 'failed'].includes(p.status)) return null;
  const verb = p.status === 'rejected' ? 'Rejected' : p.status === 'paid' ? 'Paid' : 'Sent';
  return <p className="text-[11px] text-slate-500">{verb} by {p.done_by} · {when(p.done_at)}</p>;
}

/* Review panel: shown before Pay now / Reject. */
function ReviewPanel({ p, onClose, onDone, onFailed }) {
  const [info, setInfo] = useState(null);
  const [err, setErr] = useState('');
  const [mode, setMode] = useState('review');      // review | confirmPay | reject
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`${BASE}/${p.id}/check`)
      .then(({ data }) => (data.bool ? setInfo(data.response) : setErr(data.response?.message || 'Could not load the check.')))
      .catch(() => setErr('Could not reach the server.'));
  }, [p.id]);

  const send = (body) => {
    setBusy(true); setErr('');
    api.patch(`${BASE}/${p.id}`, body)
      .then(({ data }) => { if (data?.bool) onDone(data.response?.message); else { setErr(data?.response?.message || 'Could not complete that action.'); onFailed?.(); } })
      .catch(() => setErr('Could not reach the server.'))
      .finally(() => setBusy(false));
  };

  const st = info?.standing;
  const open = p.status === 'pending' || p.status === 'failed';
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={onClose}>
      <div className="w-full max-w-md h-full bg-white shadow-xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-100 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="font-bold text-slate-900">{p.achiever_name}</p>
            <p className="text-xs text-slate-500 mt-0.5">Requested {when(p.created_at)}</p>
          </div>
          <p className="text-xl font-black text-slate-900">{inr(p.amount)}</p>
          <button type="button" onClick={onClose} aria-label="Close" className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge status={p.status} />
            <span className="text-xs text-slate-500 uppercase">{p.method}</span>
            <span className="text-xs font-mono text-slate-600 break-all">{dest(p)}</span>
          </div>
          {p.utr && <p className="text-xs text-slate-500">UTR <CopyUtr utr={p.utr} /></p>}
          <WhoDid p={p} />
          {p.reject_reason && <p className="text-xs text-slate-600 bg-slate-50 rounded-lg px-3 py-2">Reason: {p.reject_reason}</p>}
          {p.status === 'failed' && p.failure_reason && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{p.failure_reason}</p>}

          {!info && !err && <p className="text-sm text-slate-400 inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Checking…</p>}

          {info && (
            <>
              {info.warnings.length > 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-1">
                  {info.warnings.map((w) => (
                    <p key={w} className="text-xs text-amber-800 flex gap-1.5"><AlertTriangle size={13} className="shrink-0 mt-0.5" /> {w}</p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex gap-1.5">
                  <ShieldCheck size={14} className="shrink-0" /> No open complaints and no pause. Safe to pay.
                </p>
              )}

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Made up of</p>
                <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
                  {info.lines.length === 0 && <p className="p-3 text-xs text-slate-400">No lines recorded for this request.</p>}
                  {info.lines.map((l, i) => (
                    <div key={i} className="p-3 flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 break-words">{l.title || (l.source_type === 'session' ? '1-on-1 session' : 'Class')}</p>
                        <p className="text-[11px] text-slate-500"><span className="capitalize">{l.source_type}</span> · {when(l.occurred_at)}</p>
                        {l.open_complaint && <p className="text-[11px] font-semibold text-red-600 mt-0.5">Open complaint</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold text-slate-900">{inr(l.amount)}</p>
                        {l.part && <p className="text-[11px] text-slate-500">of {inr(l.earned)}</p>}
                      </div>
                    </div>
                  ))}
                  {info.lines.length > 0 && (
                    <div className="p-3 flex justify-between text-sm font-bold"><span>Total</span><span>{inr(info.lines_total)}</span></div>
                  )}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Achiever standing</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Status</p><p className={`font-semibold ${st.paused ? 'text-red-600' : 'text-slate-800'}`}>{st.paused ? (st.state === 'active' ? 'Paused' : st.state) : 'Active'}</p></div>
                  <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Strikes ({st.strike_days} days)</p><p className="font-semibold text-slate-800">{st.strike_points}</p></div>
                  <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Missed classes</p><p className="font-semibold text-slate-800">{st.missed_recent}</p></div>
                  <div className="rounded-xl bg-slate-50 p-2.5"><p className="text-slate-500">Open complaints</p><p className={`font-semibold ${st.open_complaints ? 'text-red-600' : 'text-slate-800'}`}>{st.open_complaints}</p></div>
                </div>
              </div>
            </>
          )}

          {mode === 'reject' && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-slate-800">Why are you rejecting this payout?</p>
              <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500}
                        placeholder="e.g. The UPI ID is wrong. Please update it and request again."
                        className="w-full px-3 py-2 rounded-xl border border-slate-200 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-red-200" />
              <p className="text-[11px] text-slate-500">{p.achiever_name} sees this reason. The amount goes back to their Available balance.</p>
            </div>
          )}
          {mode === 'confirmPay' && (
            <p className="text-sm text-slate-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              {inr(p.amount)} will be sent now to <b className="break-all">{dest(p)}</b>. It is marked Paid when the bank confirms (UTR).
            </p>
          )}
          {err && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{err}</p>}
        </div>

        {open && (
          <div className="p-4 border-t border-slate-100 flex gap-2" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {mode === 'review' && (
              <>
                <Button type="button" variant="danger" className="flex-1" disabled={!info} onClick={() => setMode('reject')}><X size={15} /> Reject</Button>
                <Button type="button" className="flex-1" disabled={!info} onClick={() => setMode('confirmPay')}><Check size={15} /> Pay now</Button>
              </>
            )}
            {mode === 'confirmPay' && (
              <>
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('review')}>Back</Button>
                <Button type="button" className="flex-1" disabled={busy} onClick={() => send({ status: 'paid' })}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} Send {inr(p.amount)}
                </Button>
              </>
            )}
            {mode === 'reject' && (
              <>
                <Button type="button" variant="secondary" className="flex-1" onClick={() => setMode('review')}>Back</Button>
                <Button type="button" variant="danger" className="flex-1" disabled={busy || reason.trim().length < 5} onClick={() => send({ status: 'rejected', reason: reason.trim() })}>
                  {busy ? 'Rejecting…' : 'Reject payout'}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function PayoutsAdmin() {
  const [tab, setTab] = useState('pending');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(defaultRange);
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [summary, setSummary] = useState(null);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage] = useState(20);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(null);
  const [notice, setNotice] = useState('');
  const [checking, setChecking] = useState(false);
  const pollRef = useRef(null);

  const params = useCallback((page, extra = {}) => ({
    page, per_page: perPage,
    ...(tab !== 'all' && { status: tab }),
    ...(q && { search: q }),
    ...(range?.from && { date_from: range.from }), ...(range?.to && { date_to: range.to }),
    ...extra,
  }), [tab, q, range, perPage]);

  const load = useCallback((page = 1, quiet = false) => {
    if (!quiet) setLoading(true);
    return api.get(BASE, params(page))
      .then(({ data }) => {
        if (!data.bool) { setFailed(true); return; }
        setFailed(false);
        setRows(data.response.payouts || []);
        setCounts(data.response.counts || {});
        setSummary(data.response.summary || null);
        setPagination(data.pagination || { total: 0, pages: 1, page: 1 });
      })
      .catch(() => setFailed(true))
      .finally(() => { if (!quiet) setLoading(false); });
  }, [params]);

  useEffect(() => { load(1); }, [load]);

  // 7. Sending rows ask Cashfree for the result every 6 s (the same call as
  //    "Check status" — it never sends money again), then the list refreshes.
  useEffect(() => {
    clearInterval(pollRef.current);
    const sending = rows.filter((r) => r.status === 'processing');
    if (!sending.length) return undefined;
    pollRef.current = setInterval(() => {
      if (document.hidden) return;
      Promise.all(sending.map((r) => api.patch(`${BASE}/${r.id}`, { status: 'paid' }).catch(() => null)))
        .then(() => load(pagination.page, true));
    }, 6000);
    return () => clearInterval(pollRef.current);
  }, [rows, load, pagination.page]);

  const checkNow = (r) => {
    setChecking(true);
    api.patch(`${BASE}/${r.id}`, { status: 'paid' }).finally(() => { setChecking(false); load(pagination.page, true); });
  };

  // 8. CSV of what is on screen (tab, search, dates), every page.
  const download = () => {
    api.get(BASE, params(1, { export: 1 })).then(({ data }) => {
      if (!data.bool) return;
      const head = ['Requested', 'Achiever', 'Amount', 'Status', 'Method', 'Destination', 'UTR', 'Done by', 'Done at', 'Reason'];
      const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const lines = (data.response.payouts || []).map((p) => [
        when(p.created_at), p.achiever_name, Number(p.amount).toFixed(2), LABEL[p.status] || p.status, p.method,
        dest(p), p.utr || '', p.done_by || '', p.done_at ? when(p.done_at) : '', p.reject_reason || p.failure_reason || '',
      ].map(esc).join(','));
      const blob = new Blob([[head.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `skovo-payouts-${range?.from || 'all'}-to-${range?.to || 'all'}.csv`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
  };

  const s = summary;
  const actions = (r) => (
    r.status === 'processing' ? (
      <button type="button" disabled={checking} onClick={(e) => { e.stopPropagation(); checkNow(r); }}
              className="inline-flex items-center gap-1.5 min-h-10 px-4 rounded-xl text-sm font-semibold bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 disabled:opacity-50">
        <RefreshCw size={14} className={checking ? 'animate-spin' : ''} /> Check status
      </button>
    ) : (r.status === 'pending' || r.status === 'failed') ? (
      <Button type="button" className="w-full md:w-auto" onClick={(e) => { e.stopPropagation(); setOpen(r); }}>
        <ShieldCheck size={15} /> Review & pay
      </Button>
    ) : (
      <button type="button" onClick={(e) => { e.stopPropagation(); setOpen(r); }} className="text-xs font-semibold text-slate-500 hover:text-slate-800">Details</button>
    )
  );

  return (
    <div className="space-y-4">
      {open && (
        <ReviewPanel p={open} onClose={() => setOpen(null)} onFailed={() => load(pagination.page, true)}
                     onDone={(msg) => { setOpen(null); setNotice(msg || 'Done.'); setTimeout(() => setNotice(''), 4000); load(pagination.page, true); }} />
      )}

      {/* 1. Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile label="To pay" value={inr(s?.to_pay.amount)} sub={`${s?.to_pay.count ?? 0} request${s?.to_pay.count === 1 ? '' : 's'}`} icon={Clock} tone="amber" onClick={() => setTab('pending')} active={tab === 'pending'} />
        <StatTile label="Sending" value={inr(s?.sending.amount)} sub={`${s?.sending.count ?? 0} in progress`} icon={Send} tone="blue" onClick={() => setTab('processing')} active={tab === 'processing'} />
        <StatTile label="Paid this month" value={inr(s?.paid_month.amount)} sub={`${s?.paid_month.count ?? 0} payout${s?.paid_month.count === 1 ? '' : 's'}`} icon={CheckCircle2} tone="emerald" onClick={() => setTab('paid')} active={tab === 'paid'} />
        <StatTile label="Failed" value={inr(s?.failed.amount)} sub={`${s?.failed.count ?? 0} to retry`} icon={AlertTriangle} tone="red" onClick={() => setTab('failed')} active={tab === 'failed'} />
      </div>

      {/* 2. Tabs */}
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'pending', label: `Pending (${counts.pending || 0})`, icon: Clock },
        { key: 'processing', label: `Sending (${counts.processing || 0})`, icon: Send },
        { key: 'paid', label: `Paid (${counts.paid || 0})`, icon: CheckCircle2 },
        { key: 'failed', label: `Failed (${counts.failed || 0})`, icon: AlertTriangle },
        { key: 'rejected', label: `Rejected (${counts.rejected || 0})`, icon: X },
        { key: 'all', label: `All (${counts.all || 0})`, icon: Wallet },
      ]} />

      {/* 3. Search, dates, 8. download */}
      <div className="flex flex-col sm:flex-row gap-2">
        <SearchBar value={search} onChange={setSearch} onSubmit={() => setQ(search.trim())}
                   placeholder="Achiever, UTR or UPI" className="flex-1" />
        <DateRange value={range} anyLabel="Any date" className="sm:w-60 shrink-0" onChange={(r) => setRange(r || { from: '', to: '' })} />
        <button type="button" onClick={download}
                className="min-h-11 px-4 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-700 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 shrink-0">
          <Download size={15} /> CSV
        </button>
      </div>

      {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">{notice}</p>}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {failed ? (
          <div className="p-8 text-center">
            <p className="font-semibold text-slate-800">Could not load payouts</p>
            <button type="button" onClick={() => load(1)} className="mt-3 min-h-11 px-5 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>Try again</button>
          </div>
        ) : loading ? (
          <div className="p-4 space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-xl bg-slate-100 animate-pulse" />)}</div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center">
            <Wallet size={28} className="mx-auto text-slate-300" />
            <p className="mt-2 font-semibold text-slate-700">No {tab === 'all' ? '' : (LABEL[tab] || '').toLowerCase() + ' '}payouts</p>
            <p className="text-sm text-slate-500 mt-1">Try another tab, search or date range.</p>
          </div>
        ) : (
          <>
            {/* Phones: cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {rows.map((r) => (
                <div key={r.id} className="p-4 space-y-2" onClick={() => setOpen(r)}>
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-slate-900 text-sm">{r.achiever_name}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{when(r.created_at)}</p>
                    </div>
                    <p className="text-base font-black text-slate-900 shrink-0">{inr(r.amount)}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge status={r.status} />
                    <span className="text-xs text-slate-500 uppercase">{r.method}</span>
                    <span className="text-xs text-slate-500 font-mono break-all min-w-0">{dest(r)}</span>
                  </div>
                  {r.utr && <p className="text-xs text-slate-500">UTR <CopyUtr utr={r.utr} /></p>}
                  <WhoDid p={r} />
                  {r.reject_reason && <p className="text-xs text-slate-500">Reason: {r.reject_reason}</p>}
                  <div className="pt-1">{actions(r)}</div>
                </div>
              ))}
            </div>
            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200 text-left text-xs font-semibold text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Achiever</th><th className="px-4 py-3">Amount</th><th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Destination</th><th className="px-4 py-3">UTR</th><th className="px-4 py-3">Requested</th><th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50/70 cursor-pointer" onClick={() => setOpen(r)}>
                      <td className="px-4 py-3"><p className="font-semibold text-slate-900">{r.achiever_name}</p><WhoDid p={r} /></td>
                      <td className="px-4 py-3 font-black text-slate-900 whitespace-nowrap">{inr(r.amount)}</td>
                      <td className="px-4 py-3"><Badge status={r.status} />{r.reject_reason && <p className="text-[11px] text-slate-500 mt-1 max-w-48 truncate" title={r.reject_reason}>{r.reject_reason}</p>}</td>
                      <td className="px-4 py-3"><span className="text-xs text-slate-500 uppercase mr-1.5">{r.method}</span><span className="text-xs font-mono text-slate-600">{dest(r)}</span></td>
                      <td className="px-4 py-3"><CopyUtr utr={r.utr} /></td>
                      <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap">{when(r.created_at)}</td>
                      <td className="px-4 py-3 text-right">{actions(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={pagination.page} pages={pagination.pages} total={pagination.total}
                        perPage={perPage} onPage={(pg) => load(pg)}
                        onPerPage={(pp) => setPerPage(pp)} />
          </>
        )}
      </div>
    </div>
  );
}
