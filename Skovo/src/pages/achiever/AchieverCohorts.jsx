import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import StatTile from '../../components/admin/StatTile';
import { CalendarClock, Radio, CheckCircle2, XCircle, Users } from 'lucide-react';
import {
  BookOpen, Plus, IndianRupee, Calendar, Clock,
  Pencil, Trash2, X, Loader2, Link as LinkIcon,
  UserCheck, PenTool, Tag, MoreHorizontal, Search, Star, MessageSquare, Video,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { achieverApi } from '../../services/api';
import CohortFormModal from './CohortFormModal';
// UI05-010 — the whiteboard is 1.7 MB and was statically imported here, so it
// shipped in the main bundle and every achiever paid for it on every visit,
// including the ones who never open a board. It only ever renders behind a
// state flag, so lazy loading costs nothing: the chunk is fetched when someone
// actually opens one, and Suspense covers that moment.
const Whiteboard = lazy(() => import('../../components/Whiteboard'));
import { StatusBadge, EmptyState, TableShell, ConfirmModal } from '../../components/ui/TableComponents';
import { Button, Skeleton, ErrorState, useToast, DateRange, FormSelect, defaultRange } from '../../components/ui/index.jsx';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';

/** Overflow menu for a cohort card.
 *
 *  Six actions were laid out as six `flex-1` buttons in one row. In a
 *  three-column grid that is about 55px each: "Attendance" wrapped onto two
 *  lines and "Cancel" was clipped off the card entirely — an action you could
 *  not reach. The two you use during a session stay on the card; the rest live
 *  here, where they have room for a label.
 */
function CardMenu({ items }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" onClick={() => setOpen(o => !o)}
              aria-haspopup="menu" aria-expanded={open} aria-label="More actions"
              className="w-9 h-9 rounded-lg flex items-center justify-center text-slate-500
                         hover:bg-slate-100 hover:text-slate-700 transition-colors
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div role="menu"
             className="absolute right-0 bottom-full mb-2 z-30 w-44 bg-white border border-slate-200
                        rounded-xl shadow-lg py-1 overflow-hidden">
          {items.map(({ label, icon: Icon, onClick, danger, disabled, busy }) => (
            <button key={label} role="menuitem" type="button" disabled={disabled}
                    onClick={() => { setOpen(false); onClick(); }}
                    className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium text-left
                                transition-colors disabled:opacity-50 disabled:cursor-not-allowed
                                ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Roster + attendance for one cohort.
 *
 *  You ran the session, so you record who was there — no admin in the middle,
 *  and the students' points land while they are still in the room.
 *
 *  Attendance comes only from the check-in code: a student who enters it is
 *  present. There is no manual ticking or "Mark all present" -- either would
 *  let someone be marked present without being there. */
function EnrollmentsModal({ cohort, onClose }) {
  const [enrollments, setEnrollments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState(null);
  const [codeBusy, setCodeBusy] = useState(false);

  const load = useCallback(() => {
    achieverApi.get(`/achievers/portal/cohorts/${cohort.id}/enrollments`)
      .then(({ data }) => {
        if (!data.bool) return;
        setEnrollments(data.response.enrollments || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [cohort.id]);

  useEffect(() => { load(); }, [load]);

  // While the class is on, check-ins arrive from students' phones: refresh the
  // list on its own so the achiever sees them without reopening the panel.
  const live = !['completed', 'cancelled'].includes(cohort.status)
    && cohort.session_date && new Date(cohort.session_date) <= new Date();
  useEffect(() => {
    if (!live) return undefined;
    const id = setInterval(load, 10000);
    return () => clearInterval(id);
  }, [live, load]);

  // Surface a code that is already live, so re-opening the panel still shows it.
  useEffect(() => {
    achieverApi.get(`/achievers/portal/cohorts/${cohort.id}/attendance-code`)
      .then(({ data }) => { if (data.bool && data.response.code) setCode(data.response); })
      .catch(() => {});
  }, [cohort.id]);

  const revealCode = async () => {
    setCodeBusy(true);
    try {
      const { data } = await achieverApi.post(
        `/achievers/portal/cohorts/${cohort.id}/attendance-code`, { valid_minutes: 20 });
      if (data.bool) setCode(data.response);
    } catch { /* leave the previous code showing */ } finally { setCodeBusy(false); }
  };

  const ended = cohort.status === 'completed';
  const checkedIn = enrollments.filter((e) => Boolean(e.attended)).length;
  // Before the end nobody is "absent": they are booked, or not checked in yet.
  const statusOf = (e) => (e.attended
    ? { label: ended ? 'Attended' : 'Checked in', cls: 'text-emerald-600' }
    : ended ? { label: 'Absent', cls: 'text-red-600' }
      : live ? { label: 'Not checked in', cls: 'text-slate-500' }
        : { label: 'Booked', cls: 'text-slate-500' });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div role="dialog" aria-modal="true" aria-label="Attendance and roster" tabIndex={-1} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900">Students</h2>
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{cohort.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Check-in code: only while the class is on. After End session nobody can check in. */}
        {cohort.status !== 'completed' && cohort.status !== 'cancelled' && (
        <div className="px-4 sm:px-6 py-4 border-b border-slate-100 bg-slate-50">
          {code?.code ? (
            <div className="flex items-center gap-4">
              <div>
                <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wide">Check-in code</p>
                <p className="text-3xl font-black tracking-[0.3em] text-slate-900 mt-0.5">{code.code}</p>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-500">Read this out. Students enter it to mark themselves present.</p>
                <button onClick={revealCode} disabled={codeBusy}
                  className="text-xs font-semibold mt-1.5 hover:underline disabled:opacity-50"
                  style={{ color: 'var(--accent)' }}>
                  {codeBusy ? 'Generating…' : 'New code'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-slate-800">Let students check themselves in</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Show this part-way through, not at the start — then it proves who actually stayed.
                </p>
              </div>
              <button onClick={revealCode} disabled={codeBusy}
                className="min-h-11 px-4 rounded-xl text-sm font-bold text-white shrink-0 disabled:opacity-60 w-full sm:w-auto"
                style={{ backgroundColor: 'var(--accent)' }}>
                {codeBusy ? 'Generating…' : 'Show code'}
              </button>
            </div>
          )}
        </div>
        )}

        {/* Roster */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12">
              <div className="w-7 h-7 border-2 border-t-transparent rounded-full animate-spin"
                style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
            </div>
          ) : enrollments.length === 0 ? (
            <EmptyState icon={Users} message="No enrollments yet" sub="Students who enroll will appear here" />
          ) : (
            <div>
              <p className="px-4 sm:px-6 py-2 border-b border-slate-100 text-xs text-slate-400">
                {ended ? 'Final attendance, from the check-in code.'
                  : 'Attendance is marked automatically when a student enters the code.'}
              </p>
              {enrollments.map((e, i) => {
                const st = statusOf(e);
                return (
                  <div key={e.enrollment_id}
                    className={`flex items-center gap-3 px-4 sm:px-6 py-3.5 ${i < enrollments.length - 1 ? 'border-b border-slate-100' : ''}`}>
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white"
                      style={{ backgroundColor: 'var(--accent)' }}>
                      {(e.full_name || '?')[0].toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{e.full_name}</p>
                      <p className="text-xs text-slate-400 truncate">{e.email || '—'}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1 shrink-0">
                      <StatusBadge status={e.payment_status} />
                      <span className={`text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-6 py-3 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-3">
          <span className="text-xs text-slate-500">
            {`${checkedIn} of ${enrollments.length} ${ended ? 'attended' : 'checked in'}`}
          </span>
          <div className="flex gap-2 sm:shrink-0">
            <button onClick={onClose} className="min-h-11 px-4 text-sm font-semibold text-slate-600 border border-slate-200 sm:border-transparent hover:bg-slate-100 rounded-xl transition-colors">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// Cohort status comes from master data (masters.cohort_status) — the same
// values the student-facing filters read.
//
// `level` is deliberately absent from this form. It is never sent, so the update
// path keeps whatever is already stored (`_cohort_sp_args` falls back to the
// existing row for any field the payload omits) — sending an empty string
// instead would blank the level on every cohort an achiever edits. Admins can
// still set it from the admin portal.

// The offer the card shows, mirroring the server (window only; the first-N
// count lives on Achiever > Offers). null when none is running.
function cardOffer(c) {
  if (c.offer_now_price != null) return Number(c.offer_now_price) < Number(c.price) ? Number(c.offer_now_price) : null;
  if (c.offer_tiers) return null;  // slabs set but none left: full price
  const p = Number(c.price) || 0;
  if (p <= 0) return null;
  if (c.offer_ends_at && new Date(c.offer_ends_at) <= new Date()) return null;
  if (Number(c.offer_percent) > 0) return (p * (100 - Number(c.offer_percent))) / 100;  // exact, never rounded
  if (c.offer_price != null && Number(c.offer_price) < p) return Number(c.offer_price);
  return null;
}

/** Seats filled.
 *
 *  A bar already existed on the card, but it was always blue: a cohort with two
 *  seats left looked exactly like one that had barely sold. The bar now carries
 *  the state — green, amber past 80%, red when full — and says "full" outright,
 *  because that is the point at which the achiever needs to do something.
 */
function CapacityMeter({ filled = 0, total = 0 }) {
  // Uncapped is the normal case: cohorts have no seat limit unless one was set
  // deliberately. There is no bar to draw without a ceiling, but the achiever
  // still wants the number, so show the count on its own rather than nothing.
  if (!total) {
    return (
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-slate-400">Enrolled</span>
        <span className="font-semibold text-slate-600">{filled}</span>
      </div>
    );
  }
  const pct = Math.min(100, Math.round((filled / total) * 100));
  const tone = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500';
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <span className="text-slate-400">Seats</span>
        <span className={`font-semibold ${pct >= 100 ? 'text-red-600' : 'text-slate-600'}`}>
          {filled} / {total}{pct >= 100 ? ' · full' : ''}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// The four states as filter tiles; tapping the active one again shows all.
// Views, not just counts: Upcoming (incl. live now) never hides a class; Past
// and Cancelled look back over a date range (last 7 days by default).
const STATUS_FILTERS = [
  { key: 'upcoming',  label: 'Upcoming',  icon: CalendarClock, tone: 'blue',    match: (s) => s === 'upcoming' || s === 'live' },
  { key: 'live',      label: 'Live now',  icon: Radio,         tone: 'emerald', match: (s) => s === 'live' },
  { key: 'completed', label: 'Past',      icon: CheckCircle2,  tone: 'violet',  match: (s) => s === 'completed' },
  { key: 'cancelled', label: 'Cancelled', icon: XCircle,       tone: 'amber',   match: (s) => s === 'cancelled' },
];

/** What students said about one class.
 *
 *  Read-only by design. An achiever who could delete a bad rating would make
 *  the average meaningless — and these are the same rows an admin reads when
 *  judging an achiever. Moderation of an unfair
 *  review belongs with an admin, not with the person being reviewed.
 */
function FeedbackModal({ cohort, onClose }) {
  const [data, setData]   = useState(null);
  const [loading, setLoad] = useState(true);
  const [failed, setFail] = useState(false);

  // Fetch on open. The `alive` flag covers the unmount case the rule guards
  // against; same shape as every other fetch-on-mount in this file.
  useEffect(() => {
    if (!cohort?.id) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad(true); setFail(false);
    achieverApi.get(`/achievers/portal/cohorts/${cohort.id}/feedback`)
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
        <Star key={i} size={size}
          className={i <= n ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
      ))}
    </span>
  );

  const total = data?.count || 0;
  const enrolled = data?.enrolled_count || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div role="dialog" aria-modal="true" aria-label="Cohort feedback" tabIndex={-1} className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-lg">Student feedback</h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">{cohort.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading ? (
            <div className="space-y-3">
              {[0, 1, 2].map(i => <Skeleton key={i} className="h-20" />)}
            </div>
          ) : failed ? (
            <ErrorState title="We couldn't load the feedback"
              subtitle="Your students' feedback is safe — this is a connection problem." />
          ) : total === 0 ? (
            <EmptyState icon={MessageSquare} message="No feedback yet"
              sub={enrolled
                ? `None of the ${enrolled} student${enrolled === 1 ? '' : 's'} who joined has rated this class yet`
                : 'Feedback appears here once students rate the class'} />
          ) : (
            <>
              {/* Summary. The response rate matters as much as the average —
                  three fives out of thirty students is not "5.0". */}
              <div className="flex items-center gap-4 pb-4 mb-4 border-b border-slate-100">
                <div>
                  <p className="text-3xl font-bold text-slate-900 leading-none">
                    {data.avg_rating ?? '—'}
                  </p>
                  <div className="mt-1.5">{stars(Math.round(data.avg_rating || 0))}</div>
                </div>
                <div className="flex-1 min-w-0">
                  {[5, 4, 3, 2, 1].map(n => {
                    const c = data.breakdown?.[String(n)] || 0;
                    const pct = total ? (c / total) * 100 : 0;
                    return (
                      <div key={n} className="flex items-center gap-2 text-[11px] text-slate-500">
                        <span className="w-2.5 text-right">{n}</span>
                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                          <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-4">{c}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                {total} of {enrolled || total} student{(enrolled || total) === 1 ? '' : 's'} responded
              </p>

              <div className="space-y-3">
                {data.feedback.map(f => (
                  <div key={f.id} className="rounded-xl border border-slate-200 p-3.5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-slate-900 truncate">{f.student_name}</p>
                      {stars(f.rating, 12)}
                    </div>
                    {f.review_text && (
                      <p className="text-sm text-slate-600 mt-1.5 whitespace-pre-wrap break-words">
                        {f.review_text}
                      </p>
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

export default function AchieverCohorts() {
  // The real rate, fetched once by the layout — never a literal here.
  const { commissionRate, lifecycle, seatAllocation } = useOutletContext() || {};
  // Undefined while the lifecycle call is in flight, and the form treats only an
  // explicit `false` as "cannot charge" — so a slow request never tells an
  // active achiever their paid cohort has to be free.
  const canCharge = lifecycle?.loading ? undefined : lifecycle?.caps?.can_charge;
  const [cohorts, setCohorts] = useState([]);
  const [domains, setDomains] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // Search and status had no UI at all — the only control was pagination, so
  // finding one cohort meant paging through every cohort.
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('upcoming');
  const [range, setRange] = useState(defaultRange);   // Past / Cancelled: last 7 days by default
  const [dateBy, setDateBy] = useState('class');       // class date or created date
  const [domainFilter, setDomainFilter] = useState('');
  const toast = useToast();
  // The class date as YYYY-MM-DD in the viewer's time (IST), for the range.
  const dayOf = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };

  const needle = q.trim().toLowerCase();
  const filtered = cohorts.filter((c) => {
    const matchesQ = !needle
      || (c.title || '').toLowerCase().includes(needle)
      || (c.domain_name || '').toLowerCase().includes(needle)
      || (c.level || '').toLowerCase().includes(needle);
    const view = STATUS_FILTERS.find((f) => f.key === statusFilter);
    const matchesStatus = !view || view.match(c.status);
    const looksBack = statusFilter === 'completed' || statusFilter === 'cancelled';
    const day = dayOf(dateBy === 'created' ? c.created_at : c.session_date);
    const matchesDate = !looksBack || ((!range.from || day >= range.from) && (!range.to || day <= range.to));
    const matchesDomain = !domainFilter || c.domain_name === domainFilter;
    return matchesQ && matchesStatus && matchesDate && matchesDomain;
  }).sort((a, b) => {
    // Upcoming: nearest class first. Past / Cancelled: newest first.
    const ta = new Date((dateBy === 'created' ? a.created_at : a.session_date) || 0).getTime();
    const tb = new Date((dateBy === 'created' ? b.created_at : b.session_date) || 0).getTime();
    return statusFilter === 'upcoming' || statusFilter === 'live' ? ta - tb : tb - ta;
  });
  const paged = usePagedRows(filtered);
  const enrolledTotal = cohorts.reduce((n, c) => n + Number(c.filled_seats ?? 0), 0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editCohort, setEditCohort] = useState(null);
  const [boardCohort, setBoardCohort] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [viewEnrollments, setViewEnrollments] = useState(null);
  const [confirmCancel, setConfirmCancel] = useState(null);
  const [confirmEnd, setConfirmEnd] = useState(null);
  const [ending, setEnding] = useState(null);
  const [feedbackCohort, setFeedbackCohort] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    achieverApi.get('/achievers/portal/cohorts')
      .then(({ data }) => {
        if (!data.bool) { setFailed(true); return; }
        const rows = data.response.cohorts || [];
        setCohorts(rows);
        rows.filter((c) => c.time_up).forEach((c) => {
          const key = `cohort-timeup-${c.id}`;
          if (sessionStorage.getItem(key)) return;
          sessionStorage.setItem(key, '1');
          toast.info(`${c.duration_minutes || 60} minutes are done. Tap End session when the class is actually over.`);
        });
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [toast]);

  useEffect(() => {
    load();
    achieverApi.get('/achievers/portal/domains')
      .then(({ data }) => { if (data.bool) setDomains(data.response.domains || []); });
  }, [load]);

  const openCreate = () => { setEditCohort(null); setModalOpen(true); };
  const openEdit   = (c) => { setEditCohort(c); setModalOpen(true); };
  const onSaved    = (wasEditing, message) => {
    setModalOpen(false);
    toast.success(message || (wasEditing ? 'Cohort updated' : 'Cohort created'));
    load();
  };

  // Class rules: Start opens the meeting link for everyone and is the proof
  // the achiever was there. Open from a few minutes before to a few after.
  const [starting, setStarting] = useState(null);
  const handleStart = async (cohort) => {
    setStarting(cohort.id);
    try {
      const { data } = await achieverApi.post(`/achievers/portal/cohorts/${cohort.id}/start`, {});
      if (data?.bool === false) toast.error(data.response?.message || 'Could not start the class');
      else {
        toast.success('Class started. Students can join now.');
        const link = data?.response?.meeting_link || cohort.meeting_link;
        if (link) window.open(link, '_blank', 'noopener');
      }
      load();
    } catch {
      toast.error('Could not start the class');
    } finally {
      setStarting(null);
    }
  };
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

  const handleEnd = async (cohort) => {
    setConfirmEnd(null);
    setEnding(cohort.id);
    try {
      const { data } = await achieverApi.post(`/achievers/portal/cohorts/${cohort.id}/end`, {});
      if (data?.bool === false) toast.error(data.response?.message || 'Could not end that session');
      else toast.success('Session ended.');
      load();
    } catch {
      toast.error('Could not end that session');
    } finally {
      setEnding(null);
    }
  };

  const handleDelete = async (cohort) => {
    setConfirmCancel(null);
    setDeleting(cohort.id);
    try {
      const { data } = await achieverApi.delete(`/achievers/portal/cohorts/${cohort.id}`);
      if (data?.bool === false) toast.error(data.response?.message || 'Could not cancel that cohort');
      else toast.success('Cohort cancelled');
      load();
    } catch {
      // Silent failure here meant the row simply stayed put and the achiever
      // was left guessing whether the cancel had gone through.
      toast.error('Could not cancel that cohort');
    } finally {
      setDeleting(null);
    }
  };

  return (
    <>
      {viewEnrollments && (
        <EnrollmentsModal cohort={viewEnrollments} onClose={() => setViewEnrollments(null)} />
      )}
      {feedbackCohort && (
        <FeedbackModal cohort={feedbackCohort} onClose={() => setFeedbackCohort(null)} />
      )}
      <CohortFormModal
        open={modalOpen}
        cohort={editCohort}
        domains={domains}
        onDomainsChange={(d) => setDomains((list) => list.some((x) => x.id === d.id) ? list : [...list, d])}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
        commissionRate={commissionRate}
        canCharge={canCharge}
        seatAllocation={seatAllocation}
      />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">My Cohorts</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            <span className="font-semibold text-slate-700">{cohorts.length}</span> cohort{cohorts.length !== 1 ? 's' : ''}
            {' · '}<span className="font-semibold text-slate-700">{enrolledTotal}</span> student{enrolledTotal !== 1 ? 's' : ''} enrolled
            {filtered.length !== cohorts.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        {/* Hover is CSS now, not onMouseEnter/onMouseLeave writing inline
            opacity. Those never fire on touch, so the button had no pressed
            state on a phone at all, and a pointer that left during a re-render
            could strand it at 0.85. */}
        <Button variant="primary" onClick={openCreate} className="shrink-0 w-full sm:w-auto">
          <Plus size={16} /> Create cohort
        </Button>
      </div>

      {/* Search + status. Hidden entirely when there is nothing to search —
          a filter bar over zero rows is noise on an empty screen. */}
      {(cohorts.length > 0 || needle) && (
        <div className="space-y-3 mb-5">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {STATUS_FILTERS.map(f => (
              <StatTile key={f.key} label={f.label} icon={f.icon} tone={f.tone}
                        value={cohorts.filter((c) => f.match(c.status) && (!['completed', 'cancelled'].includes(f.key) || (() => {
                          const d = dayOf(dateBy === 'created' ? c.created_at : c.session_date);
                          return (!range.from || d >= range.from) && (!range.to || d <= range.to);
                        })())).length}
                        active={statusFilter === f.key}
                        onClick={() => setStatusFilter(f.key)} />
            ))}
          </div>
          <div className="flex flex-col lg:flex-row gap-2">
            <div className="relative flex-1 min-w-0">
              <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={q} onChange={e => setQ(e.target.value)} type="search" aria-label="Search cohorts"
                placeholder="Search by title, domain or level…"
                className="w-full min-h-11 pl-10 pr-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            </div>
            {/* Domain from the domains master; on Past / Cancelled also date-by and range. One row under the search on tablets. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex gap-2">
            <div className="w-full lg:w-48">
              <FormSelect value={domainFilter} placeholder="All domains" onChange={(v) => setDomainFilter(v || '')}
                          options={[{ value: '', label: 'All domains' }, ...domains.filter((d) => cohorts.some((c) => c.domain_name === d.name)).map((d) => ({ value: d.name, label: d.name }))]} />
            </div>
            {(statusFilter === 'completed' || statusFilter === 'cancelled') && (
              <>
                <div className="w-full lg:w-44">
                  <FormSelect value={dateBy} clearable={false} onChange={(v) => v && setDateBy(v)}
                              options={[{ value: 'class', label: 'By class date' }, { value: 'created', label: 'By created date' }]} />
                </div>
                <DateRange value={range} anyLabel="Any date" className="w-full lg:w-56"
                           onChange={(r) => setRange(r || { from: '', to: '' })} />
              </>
            )}
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      ) : failed ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <ErrorState
            title="We couldn't load your cohorts"
            subtitle="Your cohorts are safe — this is a connection problem."
            onRetry={load}
          />
        </div>
      ) : filtered.length === 0 && cohorts.length > 0 ? (
        /* Filtered to nothing — different from having no cohorts at all, and
           the way out is to clear the filter, not to create another cohort. */
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState icon={Search}
            message={needle || domainFilter ? 'No cohorts match'
              : statusFilter === 'upcoming' ? 'Nothing coming up'
                : statusFilter === 'live' ? 'No class is live right now' : 'Nothing in this period'}
            sub={needle || domainFilter ? 'Try a different search or domain'
              : statusFilter === 'upcoming' ? 'Create a cohort, or see your Past classes.'
                : 'Try a wider date range, or switch Date by.'} />
          <div className="flex justify-center pb-6">
            {needle || domainFilter
              ? <button onClick={() => { setQ(''); setDomainFilter(''); }}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors">
                  Clear filters
                </button>
              : statusFilter === 'upcoming' && (
                <button onClick={() => setStatusFilter('completed')}
                  className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors">
                  See past classes
                </button>
              )}
          </div>
        </div>
      ) : cohorts.length === 0 ? (
        <TableShell>
          <div className="py-4">
            <EmptyState
              icon={BookOpen}
              message="No cohorts yet"
              sub="Create your first cohort and start mentoring students"
            />
            <div className="flex justify-center pb-6">
              <button onClick={openCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-all"
                style={{ backgroundColor: 'var(--accent)' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                <Plus size={15} /> Create First Cohort
              </button>
            </div>
          </div>
        </TableShell>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {paged.rows.map(c => (
            <div key={c.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
              <div className="p-5 flex-1">
                {/* Top row */}
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--sidebar-hover)' }}>
                    <BookOpen size={18} style={{ color: 'var(--accent)' }} />
                  </div>
                  {c.class?.missed
                    ? <span className="text-[11px] font-semibold text-red-600 bg-red-50 rounded-full px-2 py-0.5">Missed</span>
                    : <StatusBadge status={c.status} />}
                </div>

                <h3 className="font-bold text-slate-900 text-sm leading-snug mb-1 line-clamp-2">{c.title}</h3>
                {c.class?.missed && (
                  <p className="text-[11px] text-red-600 mb-1">Not started in time. Students got 100% back and you got strikes.</p>
                )}
                {c.domain_name && (
                  <span className="text-xs text-slate-400 font-medium">{c.domain_name}</span>
                )}

                <div className="mt-3 space-y-1.5">
                  {c.session_date && (
                    <div className="flex items-center gap-1.5 text-xs text-slate-500">
                      <Calendar size={12} />
                      {new Date(c.session_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </div>
                  )}
                  <div className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Clock size={12} /> {c.duration_minutes} min
                  </div>
                  <CapacityMeter filled={c.filled_seats ?? 0} total={c.total_seats} />
                  <div className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--accent)' }}>
                    <IndianRupee size={12} /> {Number(c.price) > 0
                      ? (cardOffer(c) != null
                        ? <><span className="line-through opacity-60 font-medium">{Number(c.price).toLocaleString('en-IN')}</span> {cardOffer(c).toLocaleString('en-IN', { minimumFractionDigits: cardOffer(c) % 1 ? 2 : 0, maximumFractionDigits: 2 })} · Offer</>
                        : Number(c.price).toLocaleString('en-IN'))
                      : 'Free'}
                  </div>
                  {c.meeting_link && (
                    <div className="flex items-center gap-1.5 text-xs text-blue-500">
                      <LinkIcon size={12} />
                      <a href={c.meeting_link} target="_blank" rel="noreferrer" className="truncate hover:underline">Meeting link</a>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions — Join / End stay on the card when the class is on. */}
              {c.class?.rules && c.status !== 'cancelled' && c.status !== 'completed' && !c.class.started && (
                <p className={`px-4 pt-2 text-[11px] ${c.class.start_late ? 'text-red-600' : 'text-slate-500'}`}>
                  {c.class.start_late
                    ? 'The time to start has passed. Students are being refunded.'
                    : c.class.can_start
                      ? `Press Start before ${hhmm(c.class.start_closes_at)}, or the class is missed.`
                      : `Start opens at ${hhmm(c.class.start_opens_at)}.`}
                </p>
              )}
              {c.class?.rules && c.class.started && c.status === 'live' && !c.class.can_end && (
                <p className="px-4 pt-2 text-[11px] text-slate-500">End session opens at {hhmm(c.class.end_opens_at)}.</p>
              )}
              <div className="px-4 py-3 border-t border-slate-100 flex items-center gap-2">
                {c.class?.rules && !c.class.started && c.class.can_start ? (
                  <button onClick={() => handleStart(c)} disabled={starting === c.id}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-lg text-white disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {starting === c.id ? <Loader2 size={13} className="animate-spin" /> : <Video size={13} />} Start
                  </button>
                ) : c.can_join ? (
                  <a href={c.meeting_link} target="_blank" rel="noreferrer"
                     className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold
                                rounded-lg text-white"
                     style={{ backgroundColor: 'var(--accent)' }}>
                    <Video size={13} /> Join
                  </a>
                ) : (
                  <button onClick={() => setViewEnrollments(c)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold
                               rounded-lg text-blue-600 hover:bg-blue-50 transition-colors">
                    <UserCheck size={13} /> Students ({c.filled_seats ?? 0})
                  </button>
                )}
                {c.status === 'live' && (!c.class?.rules || c.class.started) && (
                  <button onClick={() => setConfirmEnd(c)} disabled={ending === c.id || (c.class?.rules && !c.class.can_end)}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold
                               rounded-lg text-emerald-700 hover:bg-emerald-50 disabled:opacity-50">
                    {ending === c.id ? <Loader2 size={13} className="animate-spin" /> : null}
                    End session
                  </button>
                )}
                {c.status !== 'cancelled' && (
                  <CardMenu items={[
                    ...(c.can_join ? [{ label: 'Students', icon: UserCheck, onClick: () => setViewEnrollments(c) }] : []),
                    { label: 'Whiteboard',   icon: PenTool, onClick: () => setBoardCohort(c) },
                    // By status: upcoming can still be changed or called off; live
                    // has End session on the card and must not shift under the
                    // students in it; completed is read-only (and the server
                    // refuses to cancel it). Feedback only once it has happened.
                    ...(c.status === 'completed'
                      ? [{ label: 'Feedback', icon: MessageSquare, onClick: () => setFeedbackCohort(c) }] : []),
                    ...(c.status === 'upcoming' ? [
                      // A discount on a free class means nothing.
                      { label: 'Edit cohort',  icon: Pencil,  onClick: () => openEdit(c) },
                      { label: 'Cancel cohort', icon: Trash2, onClick: () => setConfirmCancel(c),
                        danger: true, disabled: deleting === c.id, busy: deleting === c.id },
                    ] : []),
                  ]} />
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      {cohorts.length > 0 && (
        <div className="mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <Pagination {...paged.bind} />
        </div>
      )}

      {boardCohort && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60">
          <div className="rounded-xl bg-white px-6 py-4 text-sm font-medium text-slate-700 shadow-xl">
            Loading whiteboard…
          </div>
        </div>}>
          <Whiteboard
            contextType="cohort"
            contextId={boardCohort.id}
            token={localStorage.getItem('achiever_access_token')}
            title={boardCohort.title}
            onClose={() => setBoardCohort(null)}
          />
        </Suspense>
      )}



      {/* The app's own modal rather than window.confirm, which is unstyled,
          unblockable in some browsers, and cannot say what will be lost. */}
      {confirmCancel && (
        <ConfirmModal
          danger
          confirmLabel="Cancel cohort"
          message={`Cancel "${confirmCancel.title}"?`}
          detail={`${confirmCancel.filled_seats || 0} student${(confirmCancel.filled_seats || 0) === 1 ? '' : 's'} enrolled. This cannot be undone.`}
          onConfirm={() => handleDelete(confirmCancel)}
          onCancel={() => setConfirmCancel(null)}
        />
      )}
      {confirmEnd && (
        <ConfirmModal
          confirmLabel="End session"
          message={`End "${confirmEnd.title}"?`}
          detail="Join hides for students. Only do this when the class is actually over."
          onConfirm={() => handleEnd(confirmEnd)}
          onCancel={() => setConfirmEnd(null)}
        />
      )}
    </>
  );
}
