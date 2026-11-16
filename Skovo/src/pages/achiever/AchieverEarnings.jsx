import React, { useEffect, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { EmptyState } from '../../components/ui/TableComponents';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { IndianRupee, TrendingUp, Users, Clock, BookOpen, Wallet, Banknote, Smartphone } from 'lucide-react';
import { achieverApi } from '../../services/api';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination, ConfirmModal, ResponsiveTable, RowCard } from '../../components/ui/TableComponents';
import { Button, ErrorState, useToast, DateRange, defaultRange } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

const STATUS_COLOR = {
  upcoming:  'bg-blue-50 text-blue-700',
  completed: 'bg-emerald-50 text-emerald-700',
  cancelled: 'bg-red-50 text-red-600',
};

const PAYOUT_STATUS_COLOR = {
  pending:    'bg-amber-50 text-amber-700',
  processing: 'bg-blue-50 text-blue-700',
  failed:     'bg-red-50 text-red-600',
  paid:       'bg-emerald-50 text-emerald-700',
  rejected:   'bg-red-50 text-red-600',
};

const SOURCE_LABEL = { cohort: 'Cohort', session: '1-on-1', course: 'Course' };

// What a payout was made of, as frozen when it was raised. These rows are a
// snapshot of what was releasable at request time, not a live recomputation —
// that is the whole point, since the balance moves on afterwards.
function LineItems({ rows }) {
  if (rows === 'loading') return <p className="text-xs text-slate-400">Loading breakdown…</p>;
  if (rows === 'error')   return <p className="text-xs text-rose-600">Could not load the breakdown.</p>;
  if (!Array.isArray(rows)) return null;
  if (rows.length === 0)  return <p className="text-xs text-slate-400">No line items were recorded for this payout.</p>;

  const total = rows.reduce((sum, r) => sum + Number(r.amount || 0), 0);

  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <div key={r.id} className="flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 flex-1 truncate text-slate-600">
            <span className="text-slate-400">{SOURCE_LABEL[r.source_type] || r.source_type} · </span>
            {r.title || '—'}
            {r.occurred_at && (
              <span className="text-slate-400">
                {' '}· {new Date(r.occurred_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
              </span>
            )}
          </span>
          <span className="font-semibold text-slate-700 shrink-0 text-right">₹{Number(r.amount).toFixed(2)}{r.part && <span className="block text-[10px] font-normal text-slate-400">of ₹{Number(r.earned).toFixed(2)}</span>}</span>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 pt-1.5 border-t border-slate-200 text-xs">
        <span className="font-semibold text-slate-500">Releasable when requested</span>
        <span className="font-bold text-slate-900">₹{total.toFixed(2)}</span>
      </div>
    </div>
  );
}

function PayoutsSection({ onChanged }) {
  const [details, setDetails] = useState(null);
  const [history, setHistory] = useState([]);
  const paged = usePagedRows(history);
  const [loading, setLoading] = useState(true);
  const [form,    setForm]    = useState({ payout_account_name: '', payout_account_number: '', payout_ifsc: '', payout_upi: '' });
  const [amount,  setAmount]  = useState('');
  const [saving,  setSaving]  = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [failed,  setFailed]  = useState(false);
  const [confirmReq, setConfirmReq] = useState(null);
  // Bank details are a one-time setup: once saved they show as a summary line
  // and the form opens only on Edit, instead of filling half the page.
  const [editingDetails, setEditingDetails] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // requestId -> 'loading' | 'error' | array of frozen line items. Cached per
  // request because the rows never change once the payout is raised.
  const [lines, setLines] = useState({});
  const [openLines, setOpenLines] = useState(null);
  // ToastProvider is mounted in AchieverLayout and owns the queue and timers.
  // This screen had its own setMsg + setTimeout pair, which is the pattern that
  // replaced.
  const toast = useToast();

  // `throw` rather than a silent return: these feed a Promise.all whose catch
  // is what sets `failed`. The API wrapper resolves on a 5xx instead of
  // rejecting, so without this a 500 read as "you have no money".
  const loadDetails = () =>
    achieverApi.get('/achiever-payouts/details').then(({ data: d }) => {
      if (!d.bool) throw new Error('payout details unavailable');
      if (d.bool) {
        setDetails(d.response);
        setForm({
          payout_account_name:   d.response.payout_account_name   || '',
          payout_account_number: d.response.payout_account_number || '',
          payout_ifsc:           d.response.payout_ifsc           || '',
          payout_upi:            d.response.payout_upi            || '',
        });
      }
    });

  const loadHistory = () =>
    achieverApi.get('/achiever-payouts/').then(({ data: d }) => {
      if (!d.bool) throw new Error('payout history unavailable');
      setHistory(d.response.payouts || []);
    });

  // Fetched on demand rather than with the history: most payouts are never
  // opened, and the rows never change once the request is raised, so one fetch
  // per request id is enough.
  const toggleLines = (id) => {
    setOpenLines((cur) => (cur === id ? null : id));
    if (lines[id] !== undefined) return;
    setLines((m) => ({ ...m, [id]: 'loading' }));
    achieverApi.get(`/achiever-payouts/${id}/lines`)
      .then(({ data: d }) => {
        setLines((m) => ({ ...m, [id]: d.bool ? (d.response.lines || []) : 'error' }));
      })
      .catch(() => setLines((m) => ({ ...m, [id]: 'error' })));
  };

  // Retry bumps a counter rather than calling a fetch function from inside the
  // effect. Same behaviour, and the effect body no longer sets state
  // synchronously - which is what react-hooks/set-state-in-effect objects to.
  useEffect(() => {
    let alive = true;
    // Swallowed before. A failed load left balance at Rs 0.00 and an empty
    // payout history - telling an achiever they have no money and have never
    // been paid, which is a worse lie than any other empty state on this
    // portal.
    Promise.all([loadDetails(), loadHistory()])
      .then(() => { if (alive) setFailed(false); })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const retry = () => { setLoading(true); setReloadKey((k) => k + 1); };

  const saveDetails = (e) => {
    e.preventDefault();
    // Nothing checked these before the PUT. The server caps their LENGTH but
    // never their SHAPE, so a malformed IFSC saved cleanly and only failed at
    // the bank — after an admin had already approved the payout. The schema
    // also refuses saving neither a bank account nor a UPI, which the request
    // endpoint would reject a screen later anyway.
    const parsed = schema.payoutDetails.safeParse(form);
    if (!parsed.success) {
      toast.error(Object.values(fieldErrors(parsed))[0]);
      return;
    }
    setSaving(true);
    achieverApi.put('/achiever-payouts/details', form)
      .then(({ data: d }) => {
        if (d.bool) { toast.success('Payout details saved'); setEditingDetails(false); return loadDetails(); }
        toast.error(d.response?.message || "Couldn't save your payout details.");
      })
      .catch(() => toast.error('Connection problem - nothing was saved.'))
      .finally(() => setSaving(false));
  };

  const askPayout = (e) => {
    e.preventDefault();
    const parsedAmt = schema.payoutRequest.safeParse({ amount });
    if (!parsedAmt.success) {
      toast.error(Object.values(fieldErrors(parsedAmt))[0]);
      return;
    }
    const amt = parseFloat(amount);
    // The balance check stays below and stays first among the money rules: the
    // schema can only say "positive and inside DECIMAL(10,2)". What is actually
    // affordable is recomputed by the server under a row lock, and this screen
    // is only echoing the figure it last fetched.
    if (amt > Number(details?.available_balance ?? 0)) {
      toast.error('That is more than your available balance.');
      return;
    }
    // Money leaving the platform, against a destination the achiever typed in
    // themselves - worth one look before it is submitted.
    setConfirmReq(amt);
  };

  const requestPayout = (amt) => {
    setConfirmReq(null);
    setRequesting(true);
    const hasBank = form.payout_account_name && form.payout_account_number && form.payout_ifsc;
    const method = hasBank ? 'bank' : 'upi';
    achieverApi.post('/achiever-payouts/request', { amount: amt, method })
      .then(({ data: d }) => {
        if (d.bool) {
          toast.success('Payout requested');
          setAmount('');
          onChanged?.();   // the boxes at the top (Available, Pending payout)
          return Promise.all([loadDetails(), loadHistory()]);
        }
        toast.error(d.response?.message || "Couldn't request that payout.");
      })
      .catch(() => toast.error('Connection problem - no payout was requested.'))
      .finally(() => setRequesting(false));
  };

  if (loading) return (
    <div className="flex justify-center py-10">
      <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (failed) return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <ErrorState
        title="We couldn't load your payouts"
        subtitle="Your balance and history are safe - this is a connection problem."
        onRetry={retry}
      />
    </div>
  );

  // Only meaningful once the load succeeded; `failed` short-circuits above so
  // this never renders Rs 0.00 for "we could not ask".
  const balance = details?.available_balance ?? 0;
  const hasBank = Boolean(details?.payout_account_name && details?.payout_account_number && details?.payout_ifsc);
  const hasDest = hasBank || Boolean(details?.payout_upi);
  const showForm = editingDetails || !hasDest;
  const inp = 'mt-1 w-full min-h-11 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30';

  return (
    <div className="space-y-5">

      {confirmReq !== null && (
        <ConfirmModal
          message={`Request a payout of ₹${Number(confirmReq).toFixed(2)}?`}
          detail={form.payout_account_name && form.payout_account_number && form.payout_ifsc
            ? `It will be sent to account ending ${String(form.payout_account_number).slice(-4)} (${form.payout_ifsc}).`
            : `It will be sent to ${form.payout_upi || 'your UPI ID'}.`}
          confirmLabel="Request payout"
          onCancel={() => setConfirmReq(null)}
          onConfirm={() => requestPayout(confirmReq)}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
        {/* Payout details form */}
        {!showForm ? (
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 self-start">
            <div className="flex items-start gap-3">
              <span className="shrink-0 w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center"><Banknote size={18} /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Payouts go to</p>
                {hasBank ? (
                  <>
                    <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">{details.payout_account_name}</p>
                    <p className="text-xs text-slate-500">A/C ••{String(details.payout_account_number).slice(-4)} · {details.payout_ifsc}</p>
                  </>
                ) : (
                  <p className="text-sm font-bold text-slate-900 mt-0.5 truncate">UPI · {details.payout_upi}</p>
                )}
                {hasBank && details.payout_upi && <p className="text-xs text-slate-400 mt-0.5 truncate">UPI · {details.payout_upi}</p>}
              </div>
              <button type="button" onClick={() => setEditingDetails(true)}
                      className="shrink-0 min-h-10 px-3 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Edit</button>
            </div>
          </div>
        ) : (
        <form onSubmit={saveDetails} className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Banknote size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Where to send payouts</p>
          </div>
          <p className="text-[11px] text-slate-400">A bank account (name, number, IFSC) or a UPI ID.</p>

          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold text-slate-600">Account Holder Name</label>
              <input
                value={form.payout_account_name}
                onChange={(e) => setForm({ ...form, payout_account_name: e.target.value })}
                className={inp}
                placeholder="Full name"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">Account Number</label>
              <input
                value={form.payout_account_number}
                onChange={(e) => setForm({ ...form, payout_account_number: e.target.value })}
                className={inp}
                placeholder="Account number"
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">IFSC Code</label>
              <input
                value={form.payout_ifsc}
                onChange={(e) => setForm({ ...form, payout_ifsc: e.target.value })}
                className={inp}
                placeholder="IFSC"
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Smartphone size={13} /> <span>or pay via UPI</span>
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600">UPI ID</label>
              <input
                value={form.payout_upi}
                onChange={(e) => setForm({ ...form, payout_upi: e.target.value })}
                className={inp}
                placeholder="name@bank"
              />
            </div>
          </div>

          <div className="flex gap-2">
            {editingDetails && hasDest && (
              <button type="button" onClick={() => setEditingDetails(false)}
                      className="min-h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">Cancel</button>
            )}
            <Button type="submit" variant="primary" disabled={saving} className="flex-1">
              {saving ? 'Saving…' : 'Save details'}
            </Button>
          </div>
        </form>
        )}

        {/* Available balance + request */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4 self-start">
          <div className="flex items-center gap-2">
            <Wallet size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Available Balance</p>
          </div>
          <p className="text-3xl font-black text-emerald-600">₹{Number(balance).toFixed(2)}</p>

          {Number(details?.in_escrow || 0) > 0 && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
              <p className="text-xs font-semibold text-amber-700">₹{Number(details.in_escrow).toFixed(2)} on hold</p>
              <p className="text-[11px] text-amber-600 mt-0.5">Becomes available 24 hours after you press End on the class, if the student raises no complaint.</p>
            </div>
          )}

          {/* A refund that landed after the money was already paid out. The
              balance above is clamped at zero, so without this the shortfall
              would be invisible and the next payout would look wrongly small. */}
          {Number(details?.clawback_due || 0) > 0 && (
            <div className="rounded-xl bg-rose-50 border border-rose-200 px-3 py-2">
              <p className="text-xs font-semibold text-rose-700">
                ₹{Number(details.clawback_due).toFixed(2)} to recover
              </p>
              <p className="text-[11px] text-rose-600 mt-0.5">
                A refund was issued after this was paid out. New earnings clear this first.
              </p>
            </div>
          )}

          <form onSubmit={askPayout} className="space-y-3 pt-2 border-t border-slate-100">
            <div>
              <label className="text-xs font-semibold text-slate-600">Amount to withdraw</label>
              {/* `max` as well as `min`. With only a min, a number input reports
                  its range to assistive tech as 0.01 to 0 -- a screen reader
                  reads the field as "0 of 0" and the spinner will happily climb
                  past the balance. The over-balance case was already caught by
                  askPayout and re-checked server side under a row lock, so this
                  is the control agreeing with the rule rather than a new rule.
                  Only when there is a balance: max="0" alongside min="0.01" is
                  the same contradiction the other way round. */}
              <input
                type="number"
                min="0.01"
                {...(Number(balance) > 0 ? { max: Number(balance) } : {})}
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className={inp}
                placeholder="0.00"
              />
            </div>
            <button
              type="submit"
              disabled={requesting || balance <= 0 || !hasDest}
              className="w-full min-h-11 rounded-xl text-sm font-bold bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50"
            >
              {requesting ? 'Requesting…' : 'Request payout'}
            </button>
          </form>
        </div>
      </div>

      {/* Payout history */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Clock size={15} style={{ color: 'var(--accent)' }} />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Payout History</p>
        </div>
        {history.length === 0 ? (
          <div className="py-12 text-center text-slate-400">
            <Wallet size={30} className="mx-auto mb-3 text-slate-300" />
            <p className="font-semibold">No payout requests yet</p>
          </div>
        ) : (
          <>
          <ResponsiveTable
            cards={paged.rows.map((p) => (
              <RowCard
                key={p.id}
                title={p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                subtitle={`₹${Number(p.amount).toFixed(2)}`}
                badge={
                  <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${PAYOUT_STATUS_COLOR[p.status] || 'bg-slate-100 text-slate-500'}`}>
                    {p.status}
                  </span>
                }
                onClick={() => toggleLines(p.id)}
                fields={[
                  { label: 'Method', value: p.method || '—' },
                  { label: 'UTR', value: p.utr || '—' },
                  ...(p.status === 'failed' && p.failure_reason
                    ? [{ label: 'Why', value: p.failure_reason }]
                    : []),
                  { label: 'Made up of',
                    value: openLines === p.id ? <LineItems rows={lines[p.id]} /> : 'Tap to see' },
                ]}
              />
            ))}
            table={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Method</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">UTR</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Made up of</th>
                </tr>
              </thead>
              <tbody>
                {paged.rows.map((p, i) => [
                  <tr key={p.id} className={`border-b border-slate-100 last:border-0 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                    <td className="px-6 py-4 text-slate-600">
                      {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                    </td>
                    <td className="px-4 py-4 capitalize text-slate-600">{p.method || '—'}</td>
                    <td className="px-4 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${PAYOUT_STATUS_COLOR[p.status] || 'bg-slate-100 text-slate-500'}`}>
                        {p.status}
                      </span>
                      {p.status === 'failed' && p.failure_reason && (
                        <p className="text-[10px] text-red-500 mt-1 max-w-[14rem] truncate" title={p.failure_reason}>{p.failure_reason}</p>
                      )}
                    </td>
                    <td className="px-4 py-4 font-mono text-xs text-slate-500">{p.utr || '—'}</td>
                    <td className="px-6 py-4 text-right font-bold text-slate-900">₹{Number(p.amount).toFixed(2)}</td>
                    <td className="px-4 py-4 text-right">
                      <button
                        type="button"
                        onClick={() => toggleLines(p.id)}
                        className="text-xs font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2"
                      >
                        {openLines === p.id ? 'Hide' : 'Breakdown'}
                      </button>
                    </td>
                  </tr>,
                  openLines === p.id && (
                    <tr key={`${p.id}-lines`} className="border-b border-slate-100 bg-slate-50/60">
                      <td colSpan={6} className="px-6 py-4">
                        <LineItems rows={lines[p.id]} />
                      </td>
                    </tr>
                  ),
                ])}
              </tbody>
            </table>
            }
          />
          <div className="mt-3"><Pagination {...paged.bind} /></div>
          </>
        )}
      </div>
    </div>
  );
}

export default function AchieverEarnings() {
  const [tab, setTab] = useState('breakdown');
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // By cohort: class date range, last 7 days by default (money looks back).
  const [range, setRange] = useState(defaultRange);

  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/earnings')
      .then(({ data: d }) => {
        if (!alive) return;
        if (d.bool) { setData(d.response); setFailed(false); } else setFailed(true);
      })
      // Swallowed before: an outage rendered a zeroed earnings summary rather
      // than saying it could not be read.
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const retry = () => { setLoading(true); setReloadKey((k) => k + 1); };

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin"
        style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  if (failed || !data) return (
    <div>
      <div className="bg-white rounded-2xl border border-slate-200">
        <ErrorState
          title="We couldn't load your earnings"
          subtitle="Nothing is lost - this is a connection problem."
          onRetry={retry}
        />
      </div>
    </div>
  );

  const inr = (v) => { const n = Number(v || 0); return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };
  const dayOf = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const rows = (data.cohort_breakdown || []).filter((c) => {
    const d = dayOf(c.session_date);
    return !d || ((!range.from || d >= range.from) && (!range.to || d <= range.to));
  });
  const rowsTotal = rows.reduce((n, c) => n + Number(c.earned || 0), 0);
  const stats = [
    { label: 'Available', value: inr(data.payout_summary?.available_balance), icon: Wallet, tone: 'emerald', sub: 'ready to withdraw' },
    { label: 'On hold', value: inr(data.payout_summary?.in_escrow), icon: Clock, tone: 'amber', sub: 'available 24 hrs after class ends' },
    { label: 'Pending payout', value: inr(data.payout_summary?.pending_payout_requests), icon: TrendingUp, tone: 'blue', sub: 'requested' },
    { label: 'Paid out', value: inr(data.payout_summary?.total_paid_out), icon: IndianRupee, tone: 'violet', sub: 'all time' },
  ];

  return (
    // No page padding: AchieverLayout's <main> already applies it, and a second
    // set here sat this screen inset from every other one.
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Earnings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          <span className="font-semibold text-slate-700">{inr(data.total_earned)}</span> earned in total, after the SKOVO fee
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {stats.map((st) => <StatTile key={st.label} {...st} />)}
      </div>

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'breakdown', label: 'By cohort', icon: BookOpen },
        { key: 'payouts',   label: 'Payouts',   icon: Wallet },
      ]} />

      {tab === 'payouts' ? <PayoutsSection onChanged={() => setReloadKey((k) => k + 1)} /> : (
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        <div className="px-4 sm:px-6 py-3 border-b border-slate-100 bg-slate-50 flex flex-col sm:flex-row sm:items-center gap-2">
          <div className="flex items-center gap-2">
            <BookOpen size={15} style={{ color: 'var(--accent)' }} />
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Cohort Breakdown</p>
          </div>
          <DateRange value={range} anyLabel="Any date" className="w-full sm:w-64 sm:ml-auto"
                     onChange={(r) => setRange(r || { from: '', to: '' })} />
        </div>

        {rows.length === 0 ? (
          <EmptyState icon={IndianRupee}
                      message={data.cohort_breakdown.length ? 'No classes in this period' : 'No earnings yet'}
                      sub={data.cohort_breakdown.length ? 'Pick a wider date range to see more.' : 'Each paid enrolment in your cohorts shows up here, cohort by cohort.'} />
        ) : (
          <ResponsiveTable
            cards={
              <>
                {rows.map((c) => (
                  <RowCard
                    key={c.cohort_id}
                    title={c.title}
                    subtitle={c.session_date ? new Date(c.session_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : undefined}
                    badge={
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLOR[c.status] || 'bg-slate-100 text-slate-500'}`}>
                        {c.status}
                      </span>
                    }
                    fields={[
                      { label: 'Price', value: `₹${c.price}` },
                      { label: 'Enrolled', value: c.total_seats ? `${c.paid_count} / ${c.total_seats}` : `${c.paid_count} paid` },
                      { label: 'Earned', value: `₹${c.earned.toFixed(2)}${c.pending > 0 ? ` (+₹${c.pending.toFixed(2)} pending)` : ''}` },
                    ]}
                  />
                ))}
                <div className="flex items-center justify-between rounded-2xl bg-slate-50 border border-slate-200 px-4 py-3">
                  <span className="text-sm font-bold text-slate-700">Total</span>
                  <span className="text-lg font-black text-emerald-600">{inr(rowsTotal)}</span>
                </div>
              </>
            }
            table={
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Cohort</th>
                  <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Price</th>
                  <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Enrolled</th>
                  <th className="text-right px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Earned</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c, i) => (
                  <tr key={c.cohort_id} className={`border-b border-slate-100 last:border-0 ${i % 2 === 0 ? '' : 'bg-slate-50/50'}`}>
                    <td className="px-6 py-4">
                      <p className="font-semibold text-slate-900">{c.title}</p>
                      {c.session_date && (
                        <p className="text-xs text-slate-400 mt-0.5">
                          {new Date(c.session_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize ${STATUS_COLOR[c.status] || 'bg-slate-100 text-slate-500'}`}>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right font-medium text-slate-700">₹{c.price}</td>
                    <td className="px-4 py-4 text-right">
                      <span className="font-semibold text-slate-900">{c.paid_count}</span>
                      {/* Uncapped cohorts have no ceiling to divide by; "12 / "
                          with nothing after it read as a rendering fault. */}
                      {c.total_seats
                        ? <span className="text-slate-400"> / {c.total_seats}</span>
                        : <span className="text-slate-400"> paid</span>}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <span className="font-bold text-emerald-600">₹{c.earned.toFixed(2)}</span>
                      {c.pending > 0 && (
                        <p className="text-xs text-amber-500 mt-0.5">+₹{c.pending.toFixed(2)} pending</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200">
                <tr>
                  <td colSpan={4} className="px-6 py-4 text-sm font-bold text-slate-700">Total</td>
                  <td className="px-6 py-4 text-right text-lg font-black text-emerald-600">{inr(rowsTotal)}</td>
                </tr>
              </tfoot>
            </table>
            }
          />
        )}
      </div>

      )}
    </div>
  );
}
