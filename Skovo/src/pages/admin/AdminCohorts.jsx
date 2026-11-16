import React, { useEffect, useState, useCallback, useRef } from 'react';
import { adminApi as api } from '../../services/api';
import { BookOpen, X, Calendar, Users, IndianRupee, ChevronDown, Check, Type, Link2, AlignLeft, AlertCircle, Clock, Image, List, Layers, Eye, Star, MessageSquare } from 'lucide-react';
import { FormSelect, Button, DateRange } from '../../components/ui/index.jsx';
import StatTile from '../../components/admin/StatTile';
import { CohortDetail } from '../../components/admin/AchieverCohortsPanel';
import { Search, Radio, CheckCircle2, CalendarClock, XCircle, ListFilter } from 'lucide-react';
import { useMasters } from '../../hooks/useMasters';
import {
  Th, Td, StatusBadge, ActionBtn,
  TableShell, LoadingRows, EmptyState, Pagination,
} from '../../components/ui/TableComponents';

/** Student feedback on one cohort, read-only.
 *
 *  Deliberately a read. Removing an unfair review belongs under Moderation,
 *  where it leaves an audit trail; a delete button here would be a second way
 *  to drop the same row with no record of who did it.
 */
function CohortFeedbackModal({ cohort, onClose }) {
  const [data, setData]    = useState(null);
  const [loading, setLoad] = useState(true);
  const [failed, setFail]  = useState(false);

  useEffect(() => {
    if (!cohort?.id) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad(true); setFail(false);
    api.get(`/skovo-platform-panel-admin/cohorts/${cohort.id}/feedback`)
      .then(({ data: res }) => {
        if (!alive) return;
        if (res?.bool) setData(res.response); else setFail(true);
      })
      .catch(() => { if (alive) setFail(true); })
      .finally(() => { if (alive) setLoad(false); });
    return () => { alive = false; };
  }, [cohort?.id]);

  if (!cohort) return null;

  const stars = (n, size = 13) => (
    <span className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map(i => (
        <Star key={i} size={size} className={i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
      ))}
    </span>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-lg">Student feedback</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              {cohort.title}{data?.achiever_name ? ` · ${data.achiever_name}` : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading…</p>
          ) : failed ? (
            <p className="text-sm text-red-600 text-center py-8">
              Couldn&apos;t load the feedback — this is a connection problem, not missing data.
            </p>
          ) : !data?.count ? (
            <EmptyState icon={MessageSquare} message="No feedback yet"
              sub={data?.enrolled_count
                ? `None of the ${data.enrolled_count} enrolled student(s) has rated this class`
                : 'Feedback appears once students rate the class'} />
          ) : (
            <>
              <div className="flex items-baseline gap-3 pb-4 mb-4 border-b border-slate-100">
                <span className="text-3xl font-bold text-slate-900">{data.avg_rating ?? '—'}</span>
                {stars(Math.round(data.avg_rating || 0), 15)}
                <span className="text-xs text-slate-400">
                  {data.count} of {data.enrolled_count || data.count} responded
                </span>
              </div>
              <div className="space-y-3">
                {data.feedback.map(f => (
                  <div key={f.id} className="rounded-xl border border-slate-200 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 truncate">{f.student_name}</p>
                      {stars(f.rating, 12)}
                    </div>
                    {f.review_text && (
                      <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap break-words">{f.review_text}</p>
                    )}
                    <p className="text-[11px] text-slate-400 mt-2">
                      {f.created_at ? new Date(f.created_at).toLocaleDateString('en-IN',
                        { day: 'numeric', month: 'short', year: 'numeric' }) : ''}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CohortDetailModal({ cohort: c, onClose }) {
  if (!c) return null;
  const clock = (d) => new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—';
  const rows = [
    { label: 'Domain',   value: c.domain?.name || '—' },
    { label: 'Mentor',   value: c.achiever?.full_name || '—' },
    // Date with the class time and end, so admin can match it to Start / End below.
    { label: 'Date',     value: c.session_date ? `${fmt(c.session_date)} · ${clock(c.session_date)} – ${clock(new Date(new Date(c.session_date).getTime() + (c.duration_minutes || 60) * 60000))}` : fmt(c.session_date) },
    { label: 'Duration', value: c.duration_minutes ? `${c.duration_minutes} mins` : '—' },
    { label: 'Level',    value: c.level || '—' },
    // `?? 0` read as a zero-seat cohort; uncapped is the normal case here.
    { label: 'Seats',    value: c.total_seats
        ? `${c.filled_seats ?? 0} / ${c.total_seats} filled`
        : `${c.filled_seats ?? 0} enrolled` },
    { label: 'Type',     value: <span className="inline-flex items-center gap-1.5"><KindBadge kind={c.kind} />{c.price > 0 && `₹${c.price.toLocaleString('en-IN')}`}</span> },
    { label: 'Status',   value: <StatusBadge status={c.status} label={c.missed ? 'Missed' : undefined} /> },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Cohort Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 space-y-4 overflow-y-auto">
          <p className="text-lg font-black text-slate-900">{c.title}</p>
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-24 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
          </div>
          {/* Who joined, attended, paid (coupon, discount) and reviewed. */}
          {c.achiever?.id && (
            <CohortDetail achieverId={c.achiever.id} cohort={{ ...c, is_demo: c.kind === 'demo', is_free: !(c.price > 0) }} hideHeader />
          )}
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

const STATUS_COLOR = {
  upcoming:  'bg-blue-100 text-blue-700',
  live:      'bg-emerald-100 text-emerald-700',
  active:    'bg-emerald-100 text-emerald-700',
  completed: 'bg-slate-100 text-slate-600',
  cancelled: 'bg-red-100 text-red-700',
};




// Demo = free class run on probation; Free = no charge after approval.
const KIND = {
  demo: { label: 'Demo', cls: 'bg-violet-100 text-violet-700' },
  free: { label: 'Free', cls: 'bg-slate-100 text-slate-600' },
  paid: { label: 'Paid', cls: 'bg-emerald-100 text-emerald-700' },
};
function KindBadge({ kind }) {
  const k = KIND[kind] || KIND.free;
  return <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${k.cls}`}>{k.label}</span>;
}

/* ── Mobile card ───────────────────────────────────────────────────────────── */
function CohortCard({ c, onView, onFeedback }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{c.title}</p>
          {c.domain?.name && <p className="text-xs text-slate-400 mt-1">{c.domain.name}</p>}
        </div>
        <span className={`shrink-0 text-xs font-semibold px-2.5 py-1 rounded-full capitalize ${STATUS_COLOR[c.status] || STATUS_COLOR.upcoming}`}>
          {c.missed ? 'Missed' : c.status}
        </span>
      </div>
      <p className="text-xs text-slate-500 bg-slate-50 px-3 py-2 rounded-xl">
        <span className="text-slate-400">Mentor:</span>{' '}
        {c.achiever?.full_name
          ? <>{c.achiever.full_name}{c.achiever.company ? ` · ${c.achiever.company}` : ''}</>
          : <span className="text-amber-600 font-semibold">none — removed</span>}
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
        <div className="flex items-center gap-1"><Calendar size={11} className="text-slate-400" /> {fmt(c.session_date)}{c.session_date ? `, ${new Date(c.session_date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : ''}</div>
        <div className="flex items-center gap-1"><Users size={11} className="text-slate-400" /> {c.total_seats ? `${c.filled_seats ?? 0}/${c.total_seats}` : `${c.filled_seats ?? 0} enrolled`}</div>
        <div className="flex items-center gap-1.5"><KindBadge kind={c.kind} />{c.price > 0 && `₹${c.price}`}</div>
      </div>
      <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
        <button onClick={() => onView(c)} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-200 rounded-xl text-slate-600 hover:border-blue-300 hover:text-blue-600 transition-colors">
          <Eye size={13} /> View
        </button>
        <button onClick={() => onFeedback(c)} className="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold px-3 py-2 border border-slate-200 rounded-xl text-slate-600 hover:border-amber-300 hover:text-amber-600 transition-colors">
          <MessageSquare size={13} /> Feedback
        </button>
      </div>
    </div>
  );
}

/* ── Main page ─────────────────────────────────────────────────────────────── */
export default function AdminCohorts() {
  const [cohorts,   setCohorts]   = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [page,      setPage]      = useState(1);
  const [pages,     setPages]     = useState(1);
  const [total,     setTotal]     = useState(0);
  const [perPage,   setPerPage]   = useState(20);
  const [counts,    setCounts]    = useState({});
  const [status,    setStatus]    = useState('');
  const [query,     setQuery]     = useState('');
  // load() keeps its (page, perPage) signature; the filters ride in a ref.
  const filt = useRef({ status: '', q: '', kind: '', achiever_id: '' });
  const [kind,      setKind]      = useState('');
  const [achieverId, setAchieverId] = useState('');
  const [achievers, setAchievers] = useState([]);
  const [viewCohort,  setViewCohort]  = useState(null);
  const [feedbackCohort, setFeedbackCohort] = useState(null);


  // fetch only the 2 types this page needs — not all 26

  const load = useCallback((p = 1, pp = 20) => {
    setLoading(true);
    const { status: st, q, kind: k, achiever_id: aid, from, to } = filt.current;
    api.get('/skovo-platform-panel-admin/cohorts', { page: p, per_page: pp, ...(st && { status: st }), ...(q && { search: q }), ...(k && { kind: k }), ...(aid && { achiever_id: aid }),
                                                      ...(from && { date_from: from }), ...(to && { date_to: to }) })
      .then(({ data }) => {
        if (data.bool) {
          setCohorts(data.response.cohorts);
          setCounts(data.response.counts || {});
          setPages(data.pagination?.pages || 1);
          setTotal(data.pagination?.total || 0);
        }
      })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(1);
    api.get('/skovo-platform-panel-admin/achievers').then(({ data }) => { if (data.bool) setAchievers(data.response.achievers || []); }).catch(() => {});
  }, []);

  const debounce = useRef(null);
  useEffect(() => {
    clearTimeout(debounce.current);
    debounce.current = setTimeout(() => {
      if (filt.current.q === query.trim()) return;
      filt.current = { ...filt.current, q: query.trim() };
      setPage(1); load(1, perPage);
    }, 400);
    return () => clearTimeout(debounce.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);
  const pickFilter = (key, value) => {
    filt.current = { ...filt.current, [key]: value };
    setPage(1); load(1, perPage);
  };
  const { lists: statusLists } = useMasters(['cohort_status']);
  const [range, setRange] = useState({ from: '', to: '' });
  const pickStatus = (st) => {
    const next = status === st ? '' : st;
    setStatus(next); filt.current = { ...filt.current, status: next };
    setPage(1); load(1, perPage);
  };

  return (
    <div className="p-4 sm:p-6">
      <CohortDetailModal cohort={viewCohort} onClose={() => setViewCohort(null)} />
      {feedbackCohort && (
        <CohortFeedbackModal cohort={feedbackCohort} onClose={() => setFeedbackCohort(null)} />
      )}
      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Cohorts</h1>
        <p className="text-sm text-slate-500 mt-0.5">Expert-led sessions created and run by achievers. View only.</p>
      </div>

      {/* Tiles double as the status filter. */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
        <StatTile label="All cohorts" value={counts.all ?? '—'} icon={BookOpen} tone="blue" onClick={() => pickStatus('')} active={!status} />
        <StatTile label="Upcoming" value={counts.upcoming ?? 0} icon={CalendarClock} tone="violet" onClick={() => pickStatus('upcoming')} active={status === 'upcoming'} />
        <StatTile label="Live" value={counts.live ?? 0} icon={Radio} tone="emerald" onClick={() => pickStatus('live')} active={status === 'live'} />
        <StatTile label="Completed" value={counts.completed ?? 0} icon={CheckCircle2} tone="amber" onClick={() => pickStatus('completed')} active={status === 'completed'} />
        <StatTile label="Cancelled" value={counts.cancelled ?? 0} icon={XCircle} tone="violet" sub={counts.missed ? `${counts.missed} missed (not started)` : undefined}
                  onClick={() => pickStatus('cancelled')} active={status === 'cancelled'} />
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-3">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" aria-label="Search cohorts"
                 placeholder="Search cohorts…"
                 className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {/* Class date (IST). Empty = any time. */}
        <DateRange value={range} anyLabel="Any time" className="sm:w-60"
                   onChange={(r) => { setRange(r); filt.current = { ...filt.current, from: r?.from || '', to: r?.to || '' }; setPage(1); load(1, perPage); }} />
        <div className="sm:w-52">
          {/* Status as a dropdown too (the tiles above do the same). */}
          <FormSelect value={status} placeholder="All statuses" icon={ListFilter}
                      options={[{ value: '', label: 'All statuses' }, ...(statusLists.cohort_status || []).map((o) => ({ value: o.value, label: o.label }))]}
                      onChange={(v) => { if ((v || '') !== status) pickStatus(v || status); }} />
        </div>
        <div className="sm:w-64">
          <FormSelect value={achieverId} placeholder="All achievers" icon={Users}
                      options={[{ value: '', label: 'All achievers' }, ...achievers.map(a => ({ value: a.id, label: a.full_name }))]}
                      onChange={(v) => { setAchieverId(v || ''); pickFilter('achiever_id', v || ''); }} />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5 mb-4" role="group" aria-label="Cohort type">
        {[['', 'All types'], ['demo', 'Demo'], ['free', 'Free'], ['paid', 'Paid']].map(([k, l]) => (
          <button key={k || 'all'} type="button" onClick={() => { setKind(k); pickFilter('kind', k); }}
                  className={`min-h-9 px-3 rounded-full text-xs font-semibold ${kind === k ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
        ))}
      </div>

      {/* Phone / tablet cards: two across from md */}
      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? (
          <div className="md:col-span-2 space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-14 bg-white rounded-2xl border border-slate-100 animate-pulse" />
            ))}
          </div>
        ) : cohorts.length === 0 ? (
          <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-20">
            <BookOpen size={40} className="mb-3 text-slate-300" />
            <p className="font-semibold text-slate-500">No cohorts yet</p>
            <p className="mt-1 text-xs text-slate-400">Achievers create cohorts from their portal.</p>
          </div>
        ) : cohorts.map(c => <CohortCard key={c.id} c={c} onView={setViewCohort} onFeedback={setFeedbackCohort} />)}
        {/* Phones get their own pager: the table's one sits inside the hidden desktop block. */}
        {!loading && total > 0 && (
          <div className="md:col-span-2"><Pagination
            page={page}
            pages={pages}
            total={total}
            perPage={perPage}
            onPage={(p) => { setPage(p); load(p, perPage); }}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
          /></div>
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>Cohort</Th>
                  <Th>Mentor</Th>
                  <Th>Date</Th>
                  <Th>Seats</Th>
                  <Th>Type</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              {loading ? (
                <LoadingRows cols={7} rows={5} />
              ) : cohorts.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={7}>
                      <EmptyState icon={BookOpen} message="No cohorts match" sub="Achievers create cohorts from their portal." />
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {cohorts.map((c) => (
                    <tr key={c.id} onClick={() => setViewCohort(c)} className="hover:bg-slate-50/70 transition-colors cursor-pointer">
                      <Td>
                        <p className="text-sm font-semibold text-slate-900 max-w-72 truncate">{c.title}</p>
                        <p className="text-xs text-slate-400 max-w-72 truncate">
                          {[c.domain?.name, c.level].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </Td>
                      <Td className="text-sm whitespace-nowrap">
                        {c.achiever?.full_name || <span className="text-amber-600 font-semibold">None</span>}
                      </Td>
                      <Td className="text-sm text-slate-900 whitespace-nowrap">
                        {c.session_date ? new Date(c.session_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
                        {c.session_date && <span className="block text-xs text-slate-500">{new Date(c.session_date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}
                      </Td>
                      <Td className="text-sm text-slate-900 whitespace-nowrap tabular-nums">{c.total_seats ? `${c.filled_seats ?? 0}/${c.total_seats}` : `${c.filled_seats ?? 0} joined`}</Td>
                      <Td className="text-sm text-slate-900 font-medium whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><KindBadge kind={c.kind} />{c.price > 0 && `₹${c.price}`}</span></Td>
                      <Td>
                        <StatusBadge status={c.status} label={c.missed ? 'Missed' : undefined} />
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye}    tooltip="View details"  onClick={() => setViewCohort(c)} color="indigo" />
                          <ActionBtn icon={MessageSquare} tooltip="Student feedback" onClick={() => setFeedbackCohort(c)} color="amber" />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          <Pagination
            page={page}
            pages={pages}
            total={total}
            perPage={perPage}
            onPage={(p) => { setPage(p); load(p, perPage); }}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
          />
        </TableShell>
      </div>
    </div>
  );
}
