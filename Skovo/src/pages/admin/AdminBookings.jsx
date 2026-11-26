/**
 * Bookings — cohort seats and 1-on-1 mentor sessions, in two tabs.
 *
 * Lists come from sp_admin_bookings_page / sp_admin_sessions_page: search,
 * status and paging run in MySQL, and a booking stays listed after its student,
 * cohort or mentor is gone (shown as "Deleted …") — money may still be owed.
 *
 * View only in v1: admin does not cancel. The student cancels (admin's
 * cancellation rules) or the achiever cancels (100% back to the wallet); a
 * dispute is refunded from Wallet > Lookup. Payment status is never typed in.
 */
import React, { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  BookOpen, Video, Search, Calendar, IndianRupee, Download, Eye, User,
} from 'lucide-react';
import { adminApi as api } from '../../services/api';
import {
  Th, Td, StatusBadge, ActionBtn, TableShell, LoadingRows, EmptyState, Pagination,
} from '../../components/ui/TableComponents';
import { FormSelect, Modal } from '../../components/ui/index.jsx';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { useMasters } from '../../hooks/useMasters';
import { CohortDetail } from '../../components/admin/AchieverCohortsPanel';
import ClassTimeline from '../../components/admin/ClassTimeline';

const BASE = '/skovo-platform-panel-admin/bookings';
const TABS = [
  { key: 'cohorts', label: 'Cohort bookings', icon: BookOpen },
  { key: 'sessions', label: '1-on-1 sessions', icon: Video },
];
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
// Paise shown, never rounded (Rs 2.50, not Rs 2.5).
const money = (n) => (Number(n) > 0 ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : 'Free');
const Gone = ({ children }) => <span className="italic text-slate-400">{children}</span>;
const name = (text, gone) => (gone ? <Gone>{text}</Gone> : text);

function csv(rows, file) {
  const out = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([out], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = `${file}-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

/* One paged list per tab; `loading` is "not this request yet". */
function useList(path, key, params) {
  const [tick, setTick] = useState(0);
  const [res, setRes] = useState({ key: null, rows: [], total: 0, pages: 1, revenue: 0 });
  const reqKey = `${key}|${tick}`;
  useEffect(() => {
    let alive = true;
    api.get(path, params)
      .then(({ data }) => {
        if (!alive) return;
        const r = data?.response || {};
        setRes({ key: reqKey, rows: r.bookings || r.sessions || [], total: data?.pagination?.total || 0,
                 pages: data?.pagination?.pages || 1, revenue: r.total_revenue || 0 });
      })
      .catch(() => { if (alive) setRes((x) => ({ ...x, key: reqKey })); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);
  return { ...res, loading: res.key !== reqKey, reload: () => setTick((t) => t + 1) };
}


/* ── Detail window pieces ───────────────────────────────────────────────── */
function Person({ title, gone, sub, chips }) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-12 h-12 rounded-2xl flex items-center justify-center font-black text-lg shrink-0 ${gone ? 'bg-slate-100 text-slate-400' : 'bg-violet-100 text-violet-700'}`}>
        {gone ? '?' : (title || '?').charAt(0).toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`font-black leading-tight break-words ${gone ? 'italic text-slate-400' : 'text-slate-900'}`}>{title}</p>
        {sub && <p className="text-xs text-slate-400 break-all mt-0.5">{sub}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">{chips}</div>
      </div>
    </div>
  );
}

/* A titled card of label/value lines; lines with no value are left out. */
function Block({ icon: Icon, title, lines, children }) {
  const shown = (lines || []).filter(([, v]) => v !== null && v !== undefined && v !== '' && v !== '—');
  return (
    <section className="rounded-2xl border border-slate-200 p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">
        {Icon && <Icon size={13} />} {title}
      </p>
      {shown.map(([l, v]) => (
        <div key={l} className="flex items-start justify-between gap-3 py-1.5">
          <span className="text-xs text-slate-500 shrink-0">{l}</span>
          <span className="text-sm font-semibold text-slate-800 text-right min-w-0 break-words">{v}</span>
        </div>
      ))}
      {children}
    </section>
  );
}

function Switch({ on, onChange, label, busy }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onChange} disabled={busy}
            className="w-full flex items-center justify-between gap-3 min-h-11 disabled:opacity-60">
      <span className="text-sm font-semibold text-slate-800">{label}</span>
      <span className={`relative w-11 h-6 rounded-full transition-colors ${on ? 'bg-emerald-500' : 'bg-slate-300'}`}>
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-5.5' : 'left-0.5'}`} />
      </span>
    </button>
  );
}


/* ── Cohort bookings ────────────────────────────────────────────────────── */
/* Cohort bookings: one row per class, tap for its students / payments /
   reviews. Listing every seat on its own row grew without end (100 classes x
   4 seats) and hid which class a booking belonged to. Search still finds a
   class by any student who booked it. Attendance is read-only (the check-in
   code decides it); a booking can be cancelled only before the class starts. */
const loadAdminCohort = (achieverId) => (cid) => api.get(`/skovo-platform-panel-admin/achievers/${achieverId}/cohorts/${cid}`);

function CohortClasses({ q, status, setCount }) {
  const [rows, setRows] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [view, setView] = useState(null);

  useEffect(() => {
    let alive = true;
    api.get('/skovo-platform-panel-admin/cohort-bookings', { ...(q && { search: q }), ...(status && { status }) })
      .then(({ data }) => { if (alive) setRows(data?.bool ? data.response.cohorts : []); })
      .catch(() => { if (alive) setRows([]); });
    return () => { alive = false; };
  }, [q, status]);

  const list = rows || [];
  useEffect(() => {
    setCount({ total: list.length, revenue: list.reduce((a, c) => a + (c.collected || 0), 0), loading: rows === null, unit: 'classes' });
  }, [rows, setCount]); // eslint-disable-line react-hooks/exhaustive-deps

  const pages = Math.max(1, Math.ceil(list.length / perPage));
  const paged = list.slice((page - 1) * perPage, page * perPage);
  const pager = <Pagination page={page} pages={pages} total={list.length} perPage={perPage}
                            onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />;
  const kind = (c) => (c.is_free ? 'Free' : money(c.price));
  const DeletedTag = ({ c }) => ((c.deleted || c.gone)
    ? <span className="ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 align-middle">Deleted</span> : null);

  return (
    <>
      {view && (
        <Modal isOpen onClose={() => setView(null)} title={view.title} size="md">
          {view.gone ? (
            // The cohort row itself was removed; only its bookings remain.
            <p className="text-sm text-slate-600">
              This cohort was deleted, so its class details are gone. It had {view.bookings} booking{view.bookings === 1 ? '' : 's'}
              {view.collected > 0 ? `, ${money(view.collected)} collected` : ', none of them paid'}
              {view.refunded > 0 ? `, ${money(view.refunded)} refunded` : ''}.
            </p>
          ) : (
            <>
              <p className="text-xs text-slate-500 mb-3">{view.achiever_name || 'Achiever removed'} · {when(view.session_date)} · {kind(view)}{view.deleted ? ' · Deleted' : ''}</p>
              <CohortDetail cohort={view} hideHeader load={loadAdminCohort(view.achiever_id)} />
            </>
          )}
        </Modal>
      )}

      <div className="flex justify-end mb-3">
        <button onClick={() => csv([['Class', 'Achiever', 'Date', 'Students', 'Attended', 'Type', 'Collected', 'Refunded', 'Status'],
          ...list.map((c) => [c.title, c.achiever_name, when(c.session_date), c.joined, c.attended, kind(c), c.collected, c.refunded, c.status])], 'cohort-bookings')}
                disabled={!list.length}
                className="inline-flex items-center gap-1.5 min-h-10 px-3 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600 disabled:opacity-40">
          <Download size={14} /> Export
        </button>
      </div>

      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {rows === null ? [0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-100 animate-pulse" />)
          : paged.length === 0 ? <EmptyCard text="No classes with bookings match." />
            : paged.map((c) => (
              <button key={c.id} type="button" onClick={() => setView(c)}
                      className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 text-sm break-words">{c.title}<DeletedTag c={c} /></p>
                    <p className="text-xs text-slate-500 truncate">{c.achiever_name || 'Achiever removed'}</p>
                  </div>
                  <StatusBadge status={c.status} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><Calendar size={12} /> {when(c.session_date)}</span>
                  <span className="inline-flex items-center gap-1"><User size={12} /> {c.joined}{c.total_seats ? ` / ${c.total_seats}` : ''}</span>
                  <span className="inline-flex items-center gap-1"><IndianRupee size={12} /> {c.is_free ? kind(c) : `${money(c.collected)} collected`}</span>
                </div>
              </button>
            ))}
        {rows !== null && list.length > 0 && <div className="md:col-span-2">{pager}</div>}
      </div>

      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr><Th>Class</Th><Th>Achiever</Th><Th>Date</Th><Th>Students</Th><Th>Type</Th><Th>Collected</Th><Th>Status</Th></tr>
              </thead>
              {rows === null ? <LoadingRows cols={7} rows={6} /> : paged.length === 0 ? (
                <tbody><tr><td colSpan={7}><EmptyState icon={BookOpen} message="No classes with bookings match." /></td></tr></tbody>
              ) : (
                <tbody className="divide-y divide-slate-100">
                  {paged.map((c) => (
                    <tr key={c.id} onClick={() => setView(c)} className="hover:bg-slate-50/70 cursor-pointer">
                      <Td className="max-w-64"><p className="font-semibold text-slate-900 truncate">{c.title}<DeletedTag c={c} /></p></Td>
                      <Td className="whitespace-nowrap">{c.achiever_name || <Gone>Removed</Gone>}</Td>
                      <Td className="whitespace-nowrap">{when(c.session_date)}</Td>
                      <Td className="tabular-nums">{c.joined}{c.total_seats ? ` / ${c.total_seats}` : ''} · {c.attended} attended</Td>
                      <Td>{kind(c)}</Td>
                      <Td className="tabular-nums">{c.is_free ? '—' : money(c.collected)}</Td>
                      <Td><StatusBadge status={c.status} /></Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {pager}
        </TableShell>
      </div>
    </>
  );
}

/* What happened in a 1-on-1: Start, End, missed, paid. */
function SessionTimeline({ id, status }) {
  const [t, setT] = useState(undefined);
  useEffect(() => {
    let alive = true;
    api.get(`${BASE}/sessions/${id}`).then(({ data }) => { if (alive) setT(data?.bool ? data.response.timeline : null); })
      .catch(() => { if (alive) setT(null); });
    return () => { alive = false; };
  }, [id]);
  return t === undefined ? null : <ClassTimeline t={t} status={status} />;
}

/* ── 1-on-1 sessions ────────────────────────────────────────────────────── */
function Sessions({ q, status, setCount }) {
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [view, setView] = useState(null);
  const params = { page, per_page: perPage, ...(q && { search: q }), ...(status && { status }) };
  const list = useList(`${BASE}/sessions`, `${q}|${status}|${page}|${perPage}`, params);
  useEffect(() => { setCount({ total: list.total, revenue: list.revenue, loading: list.loading }); }, [list.total, list.revenue, list.loading, setCount]);
  const pager = <Pagination page={page} pages={list.pages} total={list.total} perPage={perPage}
                            onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />;
  return (
    <>
      {view && (
        <Modal isOpen onClose={() => setView(null)} title="1-on-1 session" size="sm">
          <div className="space-y-3">
            <Person title={view.student_name} gone={view.student_deleted} sub={view.student_email}
                    chips={<><StatusBadge status={view.status} />{view.no_show && <StatusBadge status="no_show" label="No-show" />}</>} />
            <Block icon={Video} title="Session" lines={[
              ['Mentor', name(view.mentor_name, view.mentor_deleted)],
              ['When', view.starts_at ? when(view.starts_at) : null],
              ['Student note', view.note || null],
              ['Cancelled', view.cancelled_at ? when(view.cancelled_at) : null],
            ]} />
            <SessionTimeline id={view.id} status={view.status} />
            <Block icon={IndianRupee} title="Payment" lines={[
              ['Amount', money(view.amount)],
              ['Status', <StatusBadge key="p" status={view.payment_status} />],
              ['Booked', when(view.created_at)],
            ]} />
          </div>
        </Modal>
      )}

      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {list.loading ? [0, 1].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-100 animate-pulse" />)
          : list.rows.length === 0 ? <EmptyCard text="No 1-on-1 sessions match." />
            : list.rows.map((s) => (
              <button key={s.id} type="button" onClick={() => setView(s)}
                      className="w-full text-left bg-white rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 text-sm break-words">{name(s.student_name, s.student_deleted)}</p>
                    <p className="text-xs text-slate-500 inline-flex items-center gap-1"><User size={11} /> with {name(s.mentor_name, s.mentor_deleted)}</p>
                  </div>
                  <StatusBadge status={s.status} />
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1"><Calendar size={12} /> {when(s.starts_at)}</span>
                  <span className="inline-flex items-center gap-1"><IndianRupee size={12} /> {money(s.amount)}</span>
                </div>
              </button>
            ))}
        {!list.loading && list.total > 0 && <div className="md:col-span-2">{pager}</div>}
      </div>

      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr><Th>Student</Th><Th>Mentor</Th><Th>When</Th><Th>Status</Th><Th>Payment</Th><Th>Amount</Th><Th>Booked</Th><Th>Actions</Th></tr>
              </thead>
              {list.loading ? <LoadingRows cols={8} rows={4} /> : list.rows.length === 0 ? (
                <tbody><tr><td colSpan={8}><EmptyState icon={Video} message="No 1-on-1 sessions match." /></td></tr></tbody>
              ) : (
                <tbody className="divide-y divide-slate-100">
                  {list.rows.map((s) => (
                    <tr key={s.id} onClick={() => setView(s)} className="hover:bg-slate-50/70 cursor-pointer">
                      <Td><p className="font-semibold text-slate-900">{name(s.student_name, s.student_deleted)}</p><p className="text-xs text-slate-400">{s.student_email || ''}</p></Td>
                      <Td>{name(s.mentor_name, s.mentor_deleted)}</Td>
                      <Td className="whitespace-nowrap">{when(s.starts_at)}</Td>
                      <Td><StatusBadge status={s.status} /></Td>
                      <Td><StatusBadge status={s.payment_status} /></Td>
                      <Td className="tabular-nums">{money(s.amount)}</Td>
                      <Td className="whitespace-nowrap">{day(s.created_at)}</Td>
                      <Td>
                        <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="Open" color="indigo" onClick={() => setView(s)} />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {pager}
        </TableShell>
      </div>
    </>
  );
}

const EmptyCard = ({ text }) => (
  <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-14 px-4 text-center">
    <BookOpen size={30} className="text-slate-300 mb-2" />
    <p className="font-semibold text-slate-600">{text}</p>
  </div>
);

export default function AdminBookings() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') === 'sessions' ? 'sessions' : 'cohorts';
  const { lists } = useMasters(['payment_status', 'session_status', 'cohort_status']);
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [count, setCount] = useState({ total: 0, revenue: 0, loading: true });
  const debounce = useRef(null);

  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => setQ(query.trim()), 400);
    return () => clearTimeout(debounce.current);
  }, [query]);

  const switchTab = (k) => {
    setStatus('');
    setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', k); n.delete('page'); return n; }, { replace: true });
  };
  const statusOpts = [
    { value: '', label: 'All statuses' },
    ...((tab === 'sessions' ? lists.session_status : lists.cohort_status) || []).map((o) => ({ value: o.value, label: o.label })),
  ];

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-black text-slate-900">Bookings</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          <span className="font-semibold text-slate-700">{count.loading ? '…' : count.total}</span>{' '}
          {tab === 'sessions' ? '1-on-1 sessions' : 'classes with bookings'} · paid{' '}
          <span className="font-bold text-emerald-600">₹{Number(count.revenue || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(count.revenue || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}</span>
        </p>
      </div>

      <Tabs className="mb-3" tabs={TABS} active={tab} onChange={switchTab} />

      <div className="bg-white rounded-2xl border border-slate-200 p-3 mb-4 grid grid-cols-1 sm:grid-cols-[1fr_14rem] gap-2">
        <div className="relative">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" aria-label="Search bookings"
                 placeholder={tab === 'sessions' ? 'Student, email or mentor' : 'Class, achiever, or a student who booked'}
                 className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
        </div>
        <FormSelect value={status} onChange={(v) => setStatus(v || '')} options={statusOpts} clearable={false}
                    searchable={false} aria-label="Status" />
      </div>

      {tab === 'sessions'
        ? <Sessions key="s" q={q} status={status} setCount={setCount} />
        : <CohortClasses key="c" q={q} status={status} setCount={setCount} />}
    </div>
  );
}
