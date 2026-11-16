import React, { useEffect, useState } from 'react';
import { Settings, ChartColumn, ShieldAlert, FileText, UserSearch, Wallet, Gift, CalendarDays, CalendarX2 } from 'lucide-react';
import { ruleLabel } from '../../utils/refundRules';
import StatTile from '../../components/admin/StatTile';
import { adminApi } from '../../services/api';
import { useToast, Modal, Button, Textarea } from '../../components/ui/index.jsx';
import { SettingsCard, CrudTable, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';
import FormSelect from '../../components/ui/FormSelect';
import { useMasters } from '../../hooks/useMasters';

const A = '/skovo-platform-panel-admin';
// Paise shown, never rounded (Rs 2.50, not Rs 2.5).
const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(v) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const inp = 'w-full min-w-0 min-h-11 px-3 border border-slate-200 rounded-xl text-sm';
const btn = 'w-full sm:w-auto min-h-11 px-4 rounded-xl text-white text-sm font-semibold whitespace-nowrap';
const opts = (rows) => (rows || []).map((o) => ({ value: o.value, label: o.label }));

function Report() {
  const [r, setR] = useState(null);
  useEffect(() => { adminApi.get(`${A}/refunds/report?days=30`).then(({ data }) => data?.bool && setR(data.response)).catch(() => {}); }, []);
  if (!r) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Refunds held" value={rupee(r.wallet_liability.refund_money)} icon={Wallet} tone="blue" sub="owed to students" />
        <StatTile label="Window" value={`${r.days} days`} icon={CalendarDays} tone="emerald" sub="for the lists below" />
      </div>
      <div className="grid lg:grid-cols-3 gap-4">
        <Table title="Refunds by case" rows={r.by_case} cols={[
          ['case_key', 'Case', titleCase], ['destination', 'To', titleCase], ['n', 'Count'], ['amount', 'Amount', rupee]]} />
        <Table title="Why students cancel" rows={r.by_reason} cols={[['reason_code', 'Reason', titleCase], ['n', 'Count']]} />
        <Table title="Top refunders" rows={r.top_refunders} cols={[['full_name', 'Student'], ['refunds', 'Refunds']]} />
      </div>
    </div>
  );
}

const titleCase = (v) => String(v || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

// cols: [key, header, format?]
function Table({ title, rows, cols }) {
  const list = rows || [];
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 min-w-0">
      <h3 className="text-sm font-bold text-slate-800 mb-2">{title}</h3>
      {list.length === 0 ? <p className="text-xs text-slate-400 py-2">Nothing in this window.</p> : (
        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">{cols.map(([k, h]) => <th key={k} className="py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
            <tbody>{list.map((row, i) => (
              <tr key={i} className="border-t border-slate-100">
                {cols.map(([k, , f]) => <td key={k} className="py-1.5 pr-3 text-slate-700 whitespace-nowrap">{row[k] == null ? '—' : f ? f(row[k]) : String(row[k])}</td>)}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StudentWallet() {
  const toast = useToast();
  const [uid, setUid] = useState('');
  const [w, setW] = useState(null);
  // Find the student by name or email (nobody knows a user ID by heart).
  const [find, setFind] = useState('');
  const [hits, setHits] = useState([]);
  const [who, setWho] = useState(null);
  useEffect(() => {
    const q = find.trim();
    if (q.length < 2 || (who && q === who.label)) return undefined;
    const t = setTimeout(() => {
      adminApi.get(`${A}/users`, { search: q, per_page: 8 })
        .then(({ data }) => setHits(data?.bool ? (data.response.users || []) : []))
        .catch(() => setHits([]));
    }, 300);
    return () => clearTimeout(t);
  }, [find, who]);
  // v1: no bonus credit -- goodwill is plain wallet money.
  const [g, setG] = useState({ amount: '', kind: 'refund', reason: '' });
  const [orderId, setOrderId] = useState('');
  // v1: every refund goes to the student's SKOVO wallet.
  const [refund, setRefund] = useState({ amount: '', refund_to: 'wallet', reason: '' });

  const load = (id = uid) => adminApi.get(`${A}/wallet/students/${String(id).trim()}`).then(({ data }) => data?.bool && setW(data.response));
  const pick = (u) => {
    const label = `${u.full_name || 'Student'}${u.email ? ` · ${u.email}` : ''}`;
    setWho({ id: u.id, label }); setFind(label); setHits([]); setUid(u.id); load(u.id);
  };
  const goodwill = async () => {
    const { data } = await adminApi.post(`${A}/wallet/students/${uid.trim()}/goodwill`, { ...g, amount: Number(g.amount) });
    if (data?.bool) { toast.success('Money added to the wallet.'); load(); } else toast.error(data?.response?.message || 'Failed.');
  };
  const doRefund = async () => {
    if (!window.confirm('Issue this refund?')) return;
    const { data } = await adminApi.post(`${A}/payments/${orderId.trim()}/refund`, { ...refund, amount: refund.amount === '' ? null : Number(refund.amount) });
    if (data?.bool) toast.success('Refund issued.'); else toast.error(data?.response?.message || 'Failed.');
  };

  return (
    <div className="space-y-4">
      {/* Phones: every field and button full width -- side by side, "Open"
          ran past the card and each field was a different width. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold">Student wallet</h3>
        <div className="relative">
          <input className={inp} value={find} onChange={(e) => { setFind(e.target.value); setWho(null); setW(null); if (e.target.value.trim().length < 2) setHits([]); }}
                 placeholder="Search student by name or email" aria-label="Search student by name or email" />
          {hits.length > 0 && (
            <div className="absolute z-20 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
              {hits.map((u) => (
                <button key={u.id} type="button" onClick={() => pick(u)}
                        className="w-full text-left px-3 py-2.5 hover:bg-slate-50 border-b border-slate-100 last:border-0">
                  <p className="text-sm font-semibold text-slate-800">{u.full_name || 'Student'}</p>
                  {u.email && <p className="text-xs text-slate-500 break-all">{u.email}</p>}
                </button>
              ))}
            </div>
          )}
          {find.trim().length >= 2 && !who && hits.length === 0 && (
            <p className="text-xs text-slate-400 mt-1">Type a name or email; pick the student from the list.</p>
          )}
        </div>
        {w && (
          <>
            <p className="text-sm">Wallet balance <b>{rupee(w.refund_money)}</b></p>
            <div className="grid gap-2 sm:grid-cols-2">
              <p className="text-xs text-slate-500 sm:col-span-2">Give this student extra money in their wallet, for example to say sorry for a problem with a class.</p>
              <input className={inp} type="number" placeholder="Amount (₹)" value={g.amount} onChange={(e) => setG({ ...g, amount: e.target.value })} />
              <input className={`${inp} sm:col-span-2`} placeholder="Reason, e.g. Sorry for the audio issue (required)" value={g.reason} onChange={(e) => setG({ ...g, reason: e.target.value })} />
              <button onClick={goodwill} className={`${btn} bg-emerald-600 sm:col-span-2`}>Add money to wallet</button>
            </div>
            <div className="max-h-64 overflow-auto text-xs">
              {w.history.map((h, i) => <div key={i} className="flex justify-between border-t py-1"><span>{h.type} · {h.kind} · {h.reason || ''}</span><span>{rupee(h.amount)}</span></div>)}
            </div>
          </>
        )}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <h3 className="text-sm font-bold">Refund an order</h3>
        <div className="grid gap-2 sm:grid-cols-2">
          <input className={`${inp} sm:col-span-2`} placeholder="Order ID" value={orderId} onChange={(e) => setOrderId(e.target.value)} />
          <input className={inp} type="number" placeholder="Amount (blank = all)" value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} />
          <p className="text-xs text-slate-500 self-center">Goes to the student's SKOVO wallet.</p>
          <input className={`${inp} sm:col-span-2`} placeholder="Reason (required)" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
          <button onClick={doRefund} className={`${btn} bg-red-600 sm:col-span-2`}>Refund</button>
        </div>
      </div>
    </div>
  );
}

/* Student cancellation rules: hours before the class -> refund %. Saving
   starts a new version; bookings already paid keep the rules they paid under.
   When an achiever cancels, the student always gets 100% back (not editable). */
function CancelRules() {
  const toast = useToast();
  const [kind, setKind] = useState('cohort');
  const [all, setAll] = useState(null);
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    adminApi.get(`${A}/refund-rules`).then(({ data }) => {
      if (!data?.bool) { setAll(false); return; }
      setAll(data.response);
      setRows(data.response.cohort.map((r) => ({ min_hours: String(r.min_hours), pct: String(r.pct) })));
    }).catch(() => setAll(false));
  }, []);
  const pick = (k) => {
    setKind(k);
    setRows((all?.[k] || []).map((r) => ({ min_hours: String(r.min_hours), pct: String(r.pct) })));
  };
  const set = (i, key, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  const save = async () => {
    setBusy(true);
    try {
      const rules = rows.map((r) => ({ min_hours: Number(r.min_hours), pct: Number(r.pct) }));
      const { data } = await adminApi.put(`${A}/refund-rules`, { kind, rules });
      if (data?.bool) {
        toast.success(data.response.message);
        const fresh = data.response.rules;
        setAll((a) => ({ ...a, [kind]: fresh, ...(kind === 'session' && { session_own: true }) }));
        setRows(fresh.map((r) => ({ min_hours: String(r.min_hours), pct: String(r.pct) })));
      } else toast.error(data?.response?.message || 'Could not save.');
    } catch { toast.error('Could not save.'); }
    setBusy(false);
  };
  if (all === false) return <p className="text-sm text-red-600">Could not load the cancellation rules. Refresh, or try again in a minute.</p>;
  if (!all) return <p className="text-sm text-slate-400">Loading…</p>;
  // Each row in plain words, from where it sits among the others
  // ("2-24 hours before the class: 50% back").
  const sorted = rows.filter((r) => r.min_hours !== '' && r.pct !== '')
    .map((r) => ({ min_hours: Number(r.min_hours), pct: Number(r.pct) }))
    .sort((a, b) => b.min_hours - a.min_hours);
  const meaning = (r) => {
    if (r.min_hours === '' || r.pct === '') return '';
    const i = sorted.findIndex((x) => x.min_hours === Number(r.min_hours));
    return `${ruleLabel(sorted, i)} the class: ${Number(r.pct) > 0 ? `${Number(r.pct)}% back` : 'no refund'}`;
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4 max-w-2xl">
      <div>
        <p className="font-semibold text-slate-900">Cancellation rules</p>
        <p className="text-xs text-slate-500 mt-0.5">
          How much a student gets back when they cancel. Keep a 0-hours row for last-minute cancels. Students see these before
          they pay; new rules apply to new bookings only. If the achiever cancels, the student always gets 100% back.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rules for">
        {[['cohort', 'Cohort classes'], ['session', '1-on-1 sessions']].map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} onClick={() => pick(k)}
                  className={`min-h-11 rounded-xl border text-sm font-semibold ${kind === k ? 'border-violet-500 bg-violet-50 text-violet-700' : 'border-slate-200 text-slate-600'}`}>
            {l}
          </button>
        ))}
      </div>
      {kind === 'session' && !all.session_own && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl p-2">
          1-on-1 uses the cohort rules until you save its own.
        </p>
      )}
      <div className="space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="rounded-xl border border-slate-200 p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm text-slate-700">
              <span>Student cancels</span>
              <input className={`${inp} w-20!`} type="number" min="0" max="720" step="0.5" value={r.min_hours}
                     aria-label="Hours before the class" onChange={(e) => set(i, 'min_hours', e.target.value)} />
              <span>hours or more before the class, gets</span>
              <input className={`${inp} w-20!`} type="number" min="0" max="100" step="0.01" value={r.pct}
                     aria-label="Refund %" onChange={(e) => set(i, 'pct', e.target.value)} />
              <span>% back</span>
              <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1}
                      className="ml-auto w-11 min-h-11 rounded-xl border border-slate-200 text-slate-500 disabled:opacity-40" aria-label="Remove rule">×</button>
            </div>
            {meaning(r) && <p className="text-xs font-semibold text-emerald-700">{meaning(r)}</p>}
          </div>
        ))}
        {rows.length < 6 && (
          <button type="button" onClick={() => setRows([...rows, { min_hours: '', pct: '' }])}
                  className="text-sm font-semibold text-violet-700">+ Add a rule</button>
        )}
      </div>
      <button onClick={save} disabled={busy} className={`${btn} bg-violet-600 disabled:opacity-50`}>{busy ? 'Saving…' : 'Save rules'}</button>
    </div>
  );
}

/* Class issues: student complaints and classes with no check-ins (money held
   until admin decides), missed classes (already refunded), achiever strikes
   and paused achievers. */
const ISSUE_KIND = { student_report: 'Student report', no_checkins: 'Nobody checked in', missed: 'Missed class' };
const STRIKE_REASON = { missed: 'Missed class', late_cancel: 'Cancelled within 24 h', left_early: 'Left early' };
const when = (v) => (v ? new Date(v.endsWith('Z') ? v : `${v}Z`).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function ClassIssues() {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState(null);
  // Remove-strike reason, asked in the platform dialog (not a browser prompt).
  const [removing, setRemoving] = useState(null);
  const [removeNote, setRemoveNote] = useState('');
  useEffect(() => {
    adminApi.get(`${A}/class-issues`).then(({ data }) => setD(data?.bool ? data.response : false)).catch(() => setD(false));
  }, [tick]);
  const act = async (url, body, okMsg) => {
    setBusy(url);
    try {
      const { data } = await adminApi.post(url, body || {});
      if (data?.bool) { toast.success(data.response?.message || okMsg); setTick((t) => t + 1); }
      else toast.error(data?.response?.message || 'Could not do that.');
    } catch { toast.error('Could not do that.'); }
    setBusy(null);
  };
  if (d === false) return <p className="text-sm text-red-600">Could not load class issues. Refresh, or try again in a minute.</p>;
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  const open = d.issues.filter((i) => i.status === 'open');
  const closed = d.issues.filter((i) => i.status !== 'open');
  // Points per achiever inside the strike window.
  const byAchiever = {};
  d.strikes.filter((s) => s.counts).forEach((s) => {
    byAchiever[s.achiever_id] = byAchiever[s.achiever_id] || { name: s.achiever_name, points: 0 };
    byAchiever[s.achiever_id].points += s.points;
  });
  const card = 'bg-white border border-slate-200 rounded-2xl p-4 space-y-2';
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <StatTile label="Open issues" value={open.length} icon={ShieldAlert} tone="amber" sub="money held" />
        <StatTile label="Achievers with strikes" value={Object.keys(byAchiever).length} icon={UserSearch} tone="violet" sub="in the strike window" />
        <StatTile label="Paused" value={d.paused.length} icon={CalendarX2} tone="blue" sub="no new classes" />
      </div>

      <div className="space-y-2">
        <p className="font-semibold text-slate-900">Open — decide who is paid</p>
        {open.length === 0 && <p className="text-sm text-slate-500">Nothing to check.</p>}
        <div className="grid gap-3 lg:grid-cols-2">
          {open.map((i) => (
            <div key={i.id} className={card}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900 text-sm wrap-break-word">{i.class_title}</p>
                  <p className="text-xs text-slate-500">{i.achiever_name || 'Achiever'} · {ISSUE_KIND[i.kind] || i.kind}</p>
                </div>
                <span className="text-[11px] font-semibold text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 shrink-0">Held</span>
              </div>
              {i.student_name && <p className="text-xs text-slate-600 break-all">{i.student_name} · {i.student_email}</p>}
              {i.reason && <p className="text-sm text-slate-700">“{i.reason}”</p>}
              <p className="text-xs text-slate-500">
                Started {when(i.started_at)} · Ended {when(i.ended_at)}
                {i.source_type === 'cohort' ? ` · ${i.checked_in ?? 0} of ${i.booked ?? 0} checked in` : ''}
              </p>
              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button type="button" disabled={!!busy} onClick={() => act(`${A}/class-issues/${i.id}/release`, {}, 'Released')}
                        className="min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-semibold disabled:opacity-50">Release to achiever</button>
                <button type="button" disabled={!!busy} onClick={() => act(`${A}/class-issues/${i.id}/refund`, { strike: false }, 'Refunded')}
                        className="min-h-11 px-3 rounded-xl border border-red-200 text-red-600 text-sm font-semibold disabled:opacity-50">Refund student</button>
                <button type="button" disabled={!!busy} onClick={() => act(`${A}/class-issues/${i.id}/refund`, { strike: true }, 'Refunded')}
                        className="min-h-11 px-3 rounded-xl bg-red-600 text-white text-sm font-semibold disabled:opacity-50">Refund + strike</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {d.paused.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold text-slate-900">Paused achievers</p>
          {d.paused.map((p) => (
            <div key={p.achiever_id} className={`${card} flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2`}>
              <p className="text-sm text-slate-800">{p.achiever_name} · paused {when(p.classes_paused_at)} · {byAchiever[p.achiever_id]?.points || 0} strikes</p>
              <button type="button" disabled={!!busy} onClick={() => act(`${A}/achievers/${p.achiever_id}/unpause`, {}, 'Unpaused')}
                      className="min-h-11 px-3 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">Unpause</button>
            </div>
          ))}
        </div>
      )}

      <Modal isOpen={!!removing} onClose={() => setRemoving(null)} title="Remove this strike?"
             footer={(
               <div className="flex justify-end gap-2">
                 <Button variant="secondary" onClick={() => setRemoving(null)}>Cancel</Button>
                 <Button variant="danger" disabled={removeNote.trim().length < 5 || !!busy}
                         onClick={async () => { const s = removing; setRemoving(null); await act(`${A}/strikes/${s.id}/remove`, { note: removeNote.trim() }, 'Strike removed'); }}>
                   Remove strike
                 </Button>
               </div>
             )}>
        {removing && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              {removing.achiever_name} · {STRIKE_REASON[removing.reason] || removing.reason} · {removing.points} strike{removing.points === 1 ? '' : 's'}
            </p>
            <Textarea label="Why remove it?" required value={removeNote} onChange={(e) => setRemoveNote(e.target.value)}
                      hint="At least 5 characters. Kept in the Audit Log." rows={3} />
          </div>
        )}
      </Modal>

      <div className="space-y-2">
        <p className="font-semibold text-slate-900">Strikes</p>
        {d.strikes.length === 0 && <p className="text-sm text-slate-500">No strikes.</p>}
        <div className="grid gap-2 lg:grid-cols-2">
          {d.strikes.map((s) => (
            <div key={s.id} className={`${card} ${s.counts ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-slate-800 min-w-0">
                  <b>{s.achiever_name}</b> · {STRIKE_REASON[s.reason] || s.reason} · {s.points} strike{s.points === 1 ? '' : 's'}
                </p>
                {s.counts && (
                  <button type="button" disabled={!!busy}
                          onClick={() => { setRemoveNote(''); setRemoving(s); }}
                          className="text-xs font-semibold text-violet-700 shrink-0">Remove</button>
                )}
              </div>
              <p className="text-xs text-slate-500">{when(s.created_at)}{s.note ? ` · ${s.note}` : ''}{s.removed_at ? ` · removed: ${s.removed_note}` : !s.counts ? ' · expired' : ''}</p>
            </div>
          ))}
        </div>
      </div>

      {closed.length > 0 && (
        <div className="space-y-2">
          <p className="font-semibold text-slate-900">Last 30 days</p>
          <div className="grid gap-2 lg:grid-cols-2">
            {closed.map((i) => (
              <div key={i.id} className={card}>
                <p className="text-sm text-slate-800">{i.class_title} · {ISSUE_KIND[i.kind] || i.kind} · <span className="capitalize">{i.status}</span></p>
                <p className="text-xs text-slate-500">{i.achiever_name} · {when(i.created_at)}{i.resolution ? ` · ${i.resolution}` : i.reason ? ` · ${i.reason}` : ''}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** SKOVO Wallet, refunds, alerts (feature-updates.md §15). */
export default function AdminWallet() {
  const toast = useToast();
  const { lists } = useMasters(['wallet_reverse_mode']);
  const [tab, setTab] = useState('settings');
  return (
    <PageShell title="Wallet & refunds" subtitle="Every refund goes straight to the student's SKOVO wallet (no bonus). Wallet money is spent on SKOVO only: another cohort, session or Pro. It is never sent to a bank.">
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'settings', label: 'Settings', icon: Settings }, { key: 'rules', label: 'Cancellation rules', icon: CalendarX2 },
        { key: 'class', label: 'Class rules', icon: CalendarDays }, { key: 'issues', label: 'Class issues', icon: ShieldAlert },
        { key: 'report', label: 'Report', icon: ChartColumn },
        { key: 'chargebacks', label: 'Disputes', icon: ShieldAlert }, { key: 'notes', label: 'Credits', icon: FileText }, { key: 'student', label: 'Lookup', icon: UserSearch },
      ]} />
      {tab === 'settings' && (
        <SettingsCard title="Wallet settings" endpoint={`${A}/wallet/settings`}
          description="Confirm the GST treatment of wallet credit with your CA before switching it on."
          fields={[
            { key: 'usable_on', label: 'Wallet usable on (cohort, session, subscription)', type: 'text' },
            { key: 'reverse_mode', label: 'Points taken back on refund', type: 'select', options: opts(lists.wallet_reverse_mode), placeholder: "All of the purchase's points" },
            { key: 'credit_note_prefix', label: 'Credit note prefix', type: 'text' },
          ]} />
      )}
      {tab === 'rules' && <CancelRules />}
      {tab === 'class' && (
        <SettingsCard title="Class rules" endpoint={`${A}/class-rules`}
          description="Cohorts and 1-on-1. Example, a 5:15–6:15 class with 5 / 5 / 5 / 60: Start opens 5:10 and closes 5:20 (not started = missed, students 100% back), End session from 6:10, closes itself at 7:15."
          fields={[
            { key: 'start_before_min', label: 'Start opens before the class (minutes)', type: 'int', min: 0, max: 60 },
            { key: 'start_after_min', label: 'Start closes after the class time (minutes) — then missed', type: 'int', min: 1, max: 60 },
            { key: 'end_before_min', label: 'End session opens before the class ends (minutes)', type: 'int', min: 0, max: 60 },
            { key: 'auto_close_min', label: 'Close automatically after the class ends (minutes)', type: 'int', min: 10, max: 720 },
            { key: 'release_hours', label: "Achiever paid after the class ends (hours) — students can complain until then", type: 'int', min: 0, max: 168 },
            { key: 'change_lock_hours', label: 'Achiever cannot change the time within (hours)', type: 'int', min: 0, max: 168 },
            { key: 'strike_missed', label: 'Strikes for a missed class', type: 'int', min: 0, max: 10 },
            { key: 'strike_late_cancel', label: 'Strikes for cancelling inside the lock window', type: 'int', min: 0, max: 10 },
            { key: 'strike_left_early', label: 'Strikes for leaving early (confirmed by admin)', type: 'int', min: 0, max: 10 },
            { key: 'strike_pause_at', label: 'Pause new classes at (strikes)', type: 'int', min: 1, max: 50 },
            { key: 'strike_suspend_at', label: 'Suspend at (strikes)', type: 'int', min: 1, max: 50 },
            { key: 'strike_days', label: 'Strikes count over (days)', type: 'int', min: 1, max: 365 },
            { key: 'reminders_on', label: 'Reminders and the "Start now" message', type: 'bool' },
          ]} />
      )}
      {tab === 'issues' && <ClassIssues />}
      {tab === 'report' && <Report />}
      {tab === 'payouts' && (
        <CrudTable title="Send-to-bank requests" listKey="requests" canCreate={false} listEndpoint={`${A}/wallet/payout-requests?status=pending`}
          columns={[{ key: 'full_name', label: 'Student' }, { key: 'amount', label: 'Amount', render: (r) => rupee(r.amount) }, { key: 'status', label: 'Status' },
                    { key: 'created_at', label: 'Asked', render: (r) => (r.created_at || '').slice(0, 10) }]} fields={[]}
          extraActions={(r, reload) => r.status === 'pending' && (
            <>
              {[['Approve', true, 'text-emerald-700'], ['Reject', false, 'text-red-600']].map(([l, ok, c]) => (
                <button key={l} className={`text-xs font-semibold ${c} mr-2`} onClick={async () => {
                  const { data } = await adminApi.post(`${A}/wallet/payout-requests/${r.id}/decide`, { approve: ok });
                  if (data?.bool) { toast.success(data.response.message); reload(); } else toast.error(data?.response?.message || 'Failed.');
                }}>{l}</button>
              ))}
            </>
          )} />
      )}
      {tab === 'chargebacks' && (
        <CrudTable title="Chargebacks" listKey="chargebacks" canCreate={false} listEndpoint={`${A}/chargebacks`}
          columns={[{ key: 'order_no', label: 'Order' }, { key: 'full_name', label: 'Student' }, { key: 'kind', label: 'Kind' }, { key: 'amount', label: 'Amount' }, { key: 'status', label: 'Status' }]} fields={[]} />
      )}
      {tab === 'notes' && (
        <CrudTable title="Credit notes" listKey="credit_notes" canCreate={false} listEndpoint={`${A}/credit-notes`}
          columns={[{ key: 'number', label: 'Number' }, { key: 'order_no', label: 'Order' }, { key: 'full_name', label: 'Student' }, { key: 'amount', label: 'Amount', render: (r) => rupee(r.amount) },
                    { key: 'destination', label: 'To' }, { key: 'created_at', label: 'Date', render: (r) => (r.created_at || '').slice(0, 10) }]} fields={[]} />
      )}
      {tab === 'student' && <StudentWallet />}
    </PageShell>
  );
}
