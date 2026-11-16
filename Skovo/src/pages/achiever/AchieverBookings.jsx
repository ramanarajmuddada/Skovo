import React, { useEffect, useState, useRef, useCallback, lazy, Suspense } from 'react';
import StatTile from '../../components/admin/StatTile';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { Clock, CheckCircle, XCircle, MessageSquare, ChevronDown, ChevronUp, Users, BookOpen, Send, Loader2, X, Video, PenTool, Search, BadgeCheck, Gift, Calendar } from 'lucide-react';
import { achieverApi } from '../../services/api';
import FreeTimes from '../../components/sessions/FreeTimes';
import { CohortDetail } from '../../components/admin/AchieverCohortsPanel';
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, Avatar, RowCard, ConfirmModal, StatusBadge, ResponsiveTable } from '../../components/ui/TableComponents';
import { FormSelect, DateRange, defaultRange, ErrorState, useToast, SkeletonCard } from '../../components/ui/index.jsx';
// UI05-010 — the whiteboard is 1.7 MB and was statically imported here, so it
// shipped in the main bundle and every achiever paid for it on every visit,
// including the ones who never open a board. It only ever renders behind a
// state flag, so lazy loading costs nothing: the chunk is fetched when someone
// actually opens one, and Suspense covers that moment.
const Whiteboard = lazy(() => import('../../components/Whiteboard'));

const SESSION_STATUS_STYLE = {
  pending:   'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  rejected:  'bg-red-100 text-red-700',
};

const PAYMENT_OPTIONS = [
  { value: 'all',      label: 'All payments' },
  { value: 'paid',     label: 'Paid' },
  { value: 'free',     label: 'Free' },
  { value: 'pending',  label: 'Pending' },
  { value: 'refunded', label: 'Refunded' },
];

const STATUS_OPTIONS = [
  { value: 'all',       label: 'All statuses' },
  { value: 'pending',   label: 'Pending' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// The two feeds this screen carries, in the order they are shown. Sessions is
// first and is the default: Bookings is a bookings screen, so it opens on the
// 1-on-1 requests that need an answer, never on a read-only list.
const KINDS = [
  { key: 'all',         label: 'All',     icon: Calendar },
  { key: 'enrollments', label: 'Cohorts', icon: Users },
  { key: 'sessions',    label: '1-on-1',  icon: Video },
];
const DEFAULT_KIND = 'all';
const isKind = (k) => KINDS.some(t => t.key === k);

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;  // never rounded: Rs 4.50 stays 4.50

const fmtDate = (iso) => (iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—');

// Read-only. These were clickable filter tiles, which made one control look like
// two: a number you read and a button you press. The filtering now lives in the
// row of controls below, where a control belongs.
//
// The platform's stat tiles (same as the admin portal); a tile with onClick
// is a filter and shows when it is applied.
const TILE_TONE = { amber: 'amber', blue: 'blue', emerald: 'emerald', violet: 'violet', slate: 'violet', red: 'amber' };
const STRIP_COLS = { 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4' };

function StatStrip({ items, cols = 3 }) {
  return (
    <div className={`grid ${STRIP_COLS[cols] || STRIP_COLS[3]} gap-2 sm:gap-3`}>
      {items.map(({ icon, label, value, tone, onClick, active }) => (
        <StatTile key={label} label={label} icon={icon}
                  value={value === null || value === undefined ? '—' : value}
                  tone={TILE_TONE[((tone || '').match(/text-(\w+)-/) || [])[1]] || 'blue'}
                  onClick={onClick} active={active} />
      ))}
    </div>
  );
}

// Search + status + date, in one row above the table they filter.
//
// The three controls stack full-width on a phone and only sit side by side from
// `sm` up. They used to be fixed at `w-44`/`w-52` at every width, which on a
// 360px screen left the search box squeezed into whatever was left over.
function FilterBar({ q, onQ, status, onStatus, statusOptions = STATUS_OPTIONS, range, onRange, placeholder,
                     dateBy, onDateBy, showRange = true }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3 sm:flex-wrap">
      <div className="relative w-full sm:flex-1 sm:min-w-56">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        <input value={q} onChange={(e) => onQ(e.target.value)} placeholder={placeholder}
               className="w-full min-h-11 text-sm bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2.5
                          focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
      </div>
      {/* Status and date share a row on phones: stacked, the filters took
          three full rows before the list started. */}
      {/* A full row each on phones: half width cut the date range off. */}
      <div className="grid grid-cols-1 gap-2.5 sm:flex sm:gap-3 sm:shrink-0">
        {onStatus && (
          <div className="min-w-0 sm:w-44">
            <FormSelect value={status} onChange={onStatus} options={statusOptions} clearable={false} />
          </div>
        )}
        {showRange && onDateBy && (
          <div className="min-w-0 sm:w-44">
            <FormSelect value={dateBy} onChange={(v) => v && onDateBy(v)} clearable={false}
                        options={[{ value: 'class', label: 'By class date' }, { value: 'created', label: 'By created date' }]} />
          </div>
        )}
        {showRange && (
          <div className="min-w-0 sm:w-72">
            <DateRange value={range} onChange={onRange} />
          </div>
        )}
      </div>
    </div>
  );
}

// Table from `md` up, stacked cards below it — one switch, one pagination, one
// empty state, so the two layouts cannot drift apart or render duplicate
// controls into the DOM.
function ListShell({ table, cards, loading, empty, emptyState, failed, onRetry, pagination }) {
  if (failed && !loading) {
    return (
      <TableShell>
        <ErrorState onRetry={onRetry} />
      </TableShell>
    );
  }
  if (empty && !loading) {
    return (
      <TableShell>
        {emptyState}
        {pagination}
      </TableShell>
    );
  }
  return (
    <>
      <ResponsiveTable
        table={table}
        cards={loading
          ? [0, 1, 2].map((i) => <SkeletonCard key={i} className="h-28" />)
          : cards}
      />
      {pagination && (
        <div className="mt-3 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          {pagination}
        </div>
      )}
    </>
  );
}

const ENROLL_STATUS_BADGE = {
  paid:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  free:     'bg-blue-50 text-blue-700 border-blue-200',
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  refunded: 'bg-slate-100 text-slate-500 border-slate-200',
};

// One detail panel for the two read-only tabs. Inline, like the sessions tab —
// a modal for one tab and an expanding row for another meant the same gesture
// gave two different results depending on which tab you were on.
function DetailList({ rows }) {
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-2 max-w-3xl">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex items-center justify-between py-1.5 border-b border-slate-200/60">
          <dt className="text-xs text-slate-500">{label}</dt>
          <dd className="text-sm font-semibold text-slate-800 text-right ml-4 truncate">{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

function DetailRow({ colSpan, rows }) {
  return (
    <tr>
      <td colSpan={colSpan} className="bg-slate-50/60 px-6 py-4 border-b border-slate-100">
        <DetailList rows={rows} />
      </td>
    </tr>
  );
}

// Wraps a row + its detail so each keeps its own open state.
function ExpandableRow({ cells, detail, colSpan }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen(o => !o)}
          className="hover:bg-slate-50 transition-colors cursor-pointer">
        {cells}
        <Td right>
          {open ? <ChevronUp size={15} className="text-slate-400" />
                : <ChevronDown size={15} className="text-slate-400" />}
        </Td>
      </tr>
      {open && <DetailRow colSpan={colSpan} rows={detail} />}
    </>
  );
}

// The same record as a card, for the two read-only tabs below `md`. Tapping it
// opens the same detail list the row opens, so the gesture means one thing at
// every width.
function ExpandableCard({ title, subtitle, badge, fields, detail }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <RowCard
        onClick={() => setOpen((o) => !o)}
        title={title} subtitle={subtitle} badge={badge} fields={fields}
        action={open ? <ChevronUp size={15} className="text-slate-400 shrink-0" />
                     : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
      />
      {open && (
        <div className="mt-2 bg-white rounded-2xl border border-slate-200 p-4">
          <DetailList rows={detail} />
        </div>
      )}
    </div>
  );
}

function AchieverChatDrawer({ sessionId, studentName, onClose }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);
  const myId = (() => { try { const t = localStorage.getItem('achiever_access_token'); if (!t) return null; return JSON.parse(atob(t.split('.')[1])).sub; } catch { return null; } })();

  // Goes through achieverApi like every other call on this screen. It used to be
  // a private fetch() with the raw token, which meant no 401 handling and no
  // refresh — so once the 30-minute access token expired, opening a chat showed
  // an empty thread and sending a message failed silently.
  const load = useCallback(() => {
    achieverApi.get(`/chat/sessions/${sessionId}/messages`)
      .then(({ data }) => { if (data.bool) setMessages(data.response.messages || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const { data } = await achieverApi.post(
        `/chat/sessions/${sessionId}/messages`, { body: body.trim() });
      if (data.bool) { setMessages(m => [...m, data.response]); setBody(''); }
    } catch {}
    finally { setSending(false); }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md sm:mx-4 bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-sm">
            {studentName?.charAt(0) || 'S'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{studentName}</p>
            <p className="text-white/70 text-xs">Session Chat</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-slate-400" /></div>
          ) : messages.length === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <MessageSquare size={28} className="mx-auto mb-2 text-slate-300" />
              <p className="text-sm font-medium">No messages yet</p>
            </div>
          ) : (
            messages.map(m => {
              const mine = m.sender_id === myId || m.sender_role === 'mentor';
              return (
                <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${mine ? 'text-white rounded-br-sm' : 'bg-slate-100 text-slate-900 rounded-bl-sm'}`}
                    style={mine ? { backgroundColor: 'var(--accent)' } : {}}>
                    <p className="text-sm leading-snug wrap-break-word">{m.body}</p>
                    <p className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-slate-400'}`}>{fmt(m.created_at)}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 shrink-0">
          <input value={body} onChange={e => setBody(e.target.value)} placeholder="Type a message…"
            className="flex-1 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5 focus:outline-none"
            maxLength={2000} />
          <button type="submit" disabled={sending || !body.trim()}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-white shrink-0 disabled:opacity-40 transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
      </div>
    </div>
  );
}

function SessionStatus({ status }) {
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full capitalize shrink-0
                      ${SESSION_STATUS_STYLE[status] || 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

// The writes a booking can make, plus the overlays it can open.
//
// A hook rather than component state because the same controls render twice —
// as a table row from `md` up and as a card below it — and a <tr> cannot hold
// a card.
function useBookingActions(b, onUpdate) {
  const [notes,          setNotes]          = useState(b.mentor_notes || '');
  const [meetingLink,    setMeetingLink]    = useState(b.meeting_link || '');
  const [saving,         setSaving]         = useState(false);
  const [chatOpen,       setChatOpen]       = useState(false);
  const [boardOpen,      setBoardOpen]      = useState(false);
  const [confirmDecline, setConfirmDecline] = useState(false);
  const toast = useToast();

  /* Every write here used to be `if (data.bool) onUpdate();` with no else and
   * no try/catch, in three places. When the request failed nothing changed on
   * screen and nothing was said, so the achiever pressed Confirm or Decline
   * and had no way to tell whether the student had been answered. One helper
   * now owns the outcome of all three. */
  const put = async (payload, successMsg) => {
    setSaving(true);
    try {
      const { data } = await achieverApi.put(`/achievers/portal/bookings/${b.id}`, payload);
      if (data.bool) { toast.success(successMsg); onUpdate(); return true; }
      toast.error(data.response?.message || "That didn't save. Please try again.");
      return false;
    } catch {
      toast.error('Connection problem — nothing was changed.');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const STATUS_MSG = {
    confirmed: 'Session confirmed',
    completed: 'Session marked complete',
    cancelled: 'Session declined',
  };

  return {
    notes, setNotes, meetingLink, setMeetingLink, saving,
    chatOpen, setChatOpen, boardOpen, setBoardOpen,
    confirmDecline, setConfirmDecline,
    // The meeting link rides along with the status, so confirming and sharing
    // the link is one action.
    update: (status) => put(
      { status, mentor_notes: notes, meeting_link: meetingLink },
      STATUS_MSG[status] || 'Booking updated'),
    saveNotes: () => put({ mentor_notes: notes }, 'Notes saved'),
    // Class rules: Start opens the student's Join and is the proof you came.
    start: async () => {
      setSaving(true);
      try {
        const { data } = await achieverApi.post(`/achievers/portal/sessions/${b.id}/start`, {});
        if (!data.bool) { toast.error(data.response?.message || 'Could not start.'); return; }
        toast.success('Session started. The student can join now.');
        const link = data.response?.meeting_link || b.meeting_link;
        if (link) window.open(link, '_blank', 'noopener');
        onUpdate();
      } catch {
        toast.error('Connection problem. Try again.');
      } finally {
        setSaving(false);
      }
    },
    saveLink:  () => put({ meeting_link: meetingLink }, 'Meeting link saved'),
  };
}

function BookingRow({ b, onUpdate }) {
  const a = useBookingActions(b, onUpdate);
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr onClick={() => setOpen(o => !o)}
          className="hover:bg-slate-50 transition-colors cursor-pointer">
        <Td>
          <div className="flex items-center gap-2.5">
            <Avatar name={b.student_name} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 truncate">{b.student_name}</p>
              <p className="text-[11px] text-slate-400 truncate">{b.student_email}</p>
            </div>
          </div>
        </Td>
        <Td>
          {/* Which 1-on-1 it was (title from the booking), then its length. */}
          {b.title && <p className="text-xs font-semibold text-slate-800 truncate max-w-xs" title={b.title}>{b.title}</p>}
          <p className="text-xs text-slate-600">
            {b.duration_minutes ? `${b.duration_minutes} min` : '1-on-1 session'}
          </p>
          <KindBadge kind="session" />
          {b.note && <p className="text-[11px] text-slate-400 truncate max-w-xs">“{b.note}”</p>}
        </Td>
        <Td>
          <span className="text-xs text-slate-600">{fmtDate(b.scheduled_at || b.created_at)}</span>
          {!b.scheduled_at && <span className="block text-[11px] text-slate-400">requested</span>}
        </Td>
        <Td>
          {b.amount > 0
            ? <span className="text-xs font-semibold text-slate-700">{inr(b.amount)}</span>
            : <span className="text-xs text-slate-400">—</span>}
        </Td>
        <Td><SessionStatus status={b.status} /></Td>
        <Td right>
          {open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}
        </Td>
      </tr>

      {open && (
        <tr>
          <td colSpan={6} className="bg-slate-50/60 px-4 py-4 border-b border-slate-100">
            <BookingDetail b={b} a={a} onUpdate={onUpdate} />
          </td>
        </tr>
      )}
      <BookingOverlays b={b} a={a} />
    </>
  );
}

// Below `md` the table is replaced by these. Same actions, same hook — only the
// container differs, so a phone never gets a six-column table to scroll.
function BookingMobileCard({ b, onUpdate }) {
  const a = useBookingActions(b, onUpdate);
  const [open, setOpen] = useState(false);

  return (
    <div>
      <RowCard
        onClick={() => setOpen((o) => !o)}
        title={b.student_name}
        subtitle={b.title ? `${b.title}${b.duration_minutes ? ` · ${b.duration_minutes} min` : ''}` : b.student_email}
        badge={<SessionStatus status={b.status} />}
        action={open ? <ChevronUp size={15} className="text-slate-400 shrink-0" />
                     : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
        fields={[
          { label: 'Session', value: b.duration_minutes ? `${b.duration_minutes} min` : '1-on-1 session' },
          { label: b.scheduled_at ? 'Scheduled' : 'Requested', value: fmtDate(b.scheduled_at || b.created_at) },
          // RowCard drops empty fields, so a free session shows no Amount row
          // rather than an Amount row reading "—".
          { label: 'Amount', value: b.amount > 0 ? inr(b.amount) : null },
        ]}
      />
      {open && (
        <div className="mt-2 bg-white rounded-2xl border border-slate-200 p-4">
          <BookingDetail b={b} a={a} onUpdate={onUpdate} />
        </div>
      )}
      <BookingOverlays b={b} a={a} />
    </div>
  );
}

// Notes, meeting link and the status actions. Shared by the row and the card.
function KindBadge({ kind }) {
  const cohort = kind === 'cohort';
  return (
    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
          style={{
            backgroundColor: cohort ? '#dbeafe' : '#ede9fe',
            color: cohort ? '#1d4ed8' : '#6d28d9',
          }}>
      {cohort ? 'COHORT' : '1-ON-1'}
    </span>
  );
}

function ProposeModal({ session, onClose, onDone }) {
  const [dates, setDates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(null);   // { date, time }
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    achieverApi.get('/achiever-availability/my-times', { session_id: session.id })
      .then(({ data }) => { if (data.bool) setDates(data.response.dates || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session.id]);

  const ready = picked?.date && picked?.time;
  const save = async () => {
    if (!ready) { setErr('Pick a free day and time.'); return; }
    setSaving(true); setErr('');
    try {
      const { data } = await achieverApi.post(
        `/achievers/portal/sessions/${session.id}/propose`, { date: picked.date, start_time: picked.time });
      if (data.bool) { onDone(); onClose(); }
      else setErr(data.response?.message || 'Could not propose that time.');
    } catch { setErr('Something went wrong.'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-900">Propose a new time</h2>
          <button onClick={onClose} aria-label="Close" className="min-h-10 min-w-10 flex items-center justify-center text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <p className="text-xs text-slate-500 mb-3">
          {session.student_name} keeps the paid session. They accept the new time, or decline for a full refund.
        </p>
        {loading
          ? <p className="text-sm text-slate-400 py-6 text-center">Finding your free times…</p>
          : <FreeTimes dates={dates} value={picked} onChange={setPicked} empty="No free times. Add hours in Availability first." />}
        {err && <p className="text-sm text-red-600 mt-3">{err}</p>}
        <div className="flex gap-2 mt-4">
          <button type="button" onClick={onClose} className="flex-1 min-h-11 rounded-xl text-sm font-semibold border border-slate-200">Cancel</button>
          <button type="button" onClick={save} disabled={saving || !ready}
            className="flex-1 min-h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? 'Sending…' : 'Propose'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BookingDetail({ b, a, onUpdate }) {
  const {
    notes, setNotes, meetingLink, setMeetingLink, saving,
    update, saveNotes, saveLink, setChatOpen, setBoardOpen, setConfirmDecline, start,
  } = a;
  const cls = b.class || {};
  const hhmm = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');
  const [propose, setPropose] = useState(false);

  return (
    <div className="space-y-4 max-w-3xl">
      {b.note && (
        <div className="p-3 bg-slate-50 rounded-lg">
          <p className="text-xs font-semibold text-slate-500 mb-1">Student's note:</p>
          <p className="text-sm text-slate-700 wrap-break-word">"{b.note}"</p>
        </div>
      )}
      {b.proposed_slot_id && (
        <div className="p-3 bg-indigo-50 rounded-lg text-sm text-indigo-800">
          Waiting on {b.student_name} to accept{' '}
          {b.proposed_slot_date
            ? new Date(`${String(b.proposed_slot_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            : 'the new time'}
          {b.proposed_slot_start ? ` · ${String(b.proposed_slot_start).slice(0, 5)}` : ''}.
          Decline refunds them in full.
        </div>
      )}
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">Your notes / feedback</label>
        <textarea
          value={notes} onChange={e => setNotes(e.target.value)} rows={3}
          className="w-full border border-slate-200 rounded-xl p-2.5 text-sm focus:outline-none resize-none"
          placeholder="Add notes for the student…"
        />
        <button onClick={saveNotes} disabled={saving}
          className="mt-2 text-xs font-semibold disabled:opacity-50"
          style={{ color: 'var(--accent)' }}>
          {saving ? 'Saving…' : 'Save notes'}
        </button>
      </div>
      {(b.status === 'pending' || b.status === 'confirmed') && (
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1.5">Meeting link (Zoom / Google Meet / etc.)</label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={meetingLink} onChange={e => setMeetingLink(e.target.value)}
              className="flex-1 min-w-0 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none"
              placeholder="https://meet.google.com/…"
            />
            {b.status === 'confirmed' && (
              <button onClick={saveLink} disabled={saving}
                className="px-3 py-2 rounded-xl text-xs font-semibold text-white disabled:opacity-50 shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}>
                {saving ? 'Saving…' : 'Save link'}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-1">Shared with the student when you confirm. Leave blank to use an auto-generated room.</p>
        </div>
      )}
      {b.status === 'pending' && (
        <div className="flex flex-col sm:flex-row gap-2">
          <button onClick={() => update('confirmed')} disabled={saving}
            className="flex-1 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <CheckCircle size={14} /> Confirm
          </button>
          {/* Declining tells the student their request was refused, and there
              is no undo — it asks first rather than firing on the click. */}
          <button onClick={() => setConfirmDecline(true)} disabled={saving}
            className="flex-1 py-2 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
            <XCircle size={14} /> Decline
          </button>
        </div>
      )}
      {b.status === 'confirmed' && cls.rules && !cls.started && (
        cls.can_start ? (
          <button onClick={start} disabled={saving}
            className="w-full py-2 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Video size={14} /> Start (before {hhmm(cls.start_closes_at)})
          </button>
        ) : (
          <p className={`text-xs ${cls.start_late ? 'text-red-600' : 'text-slate-500'}`}>
            {cls.start_late ? 'The time to start has passed. The student is being refunded.' : `Start opens at ${hhmm(cls.start_opens_at)}.`}
          </p>
        )
      )}
      {b.status === 'confirmed' && (!cls.rules || cls.started) && (
        <button onClick={() => update('completed')} disabled={saving || (cls.rules && !cls.can_end)}
          className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-50">
          <CheckCircle size={14} /> {cls.rules && !cls.can_end ? `End opens at ${hhmm(cls.end_opens_at)}` : 'Mark Completed'}
        </button>
      )}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-xs text-slate-400">Requested: {b.created_at ? fmtDate(b.created_at) : '—'}</p>
        <div className="flex items-center gap-2 flex-wrap">
          {b.meeting_link && (
            <a href={b.meeting_link} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all hover:opacity-90"
              style={{ backgroundColor: '#059669' }}>
              <Video size={11} /> Join
            </a>
          )}
          <button onClick={() => setChatOpen(true)}
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}>
            <MessageSquare size={11} /> Chat
          </button>
          {b.status === 'confirmed' && (
            <button onClick={() => setBoardOpen(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg text-white transition-all hover:opacity-90"
              style={{ backgroundColor: '#7c3aed' }}>
              <PenTool size={11} /> Whiteboard
            </button>
          )}
          {['pending', 'confirmed'].includes(b.status) && (
            <button onClick={() => setPropose(true)}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 text-slate-700">
              <Calendar size={11} /> Propose new time
            </button>
          )}
        </div>
      </div>
      {propose && createPortal(
        <ProposeModal session={b} onClose={() => setPropose(false)}
          onDone={() => { setPropose(false); onUpdate?.(); }} />,
        document.body
      )}
    </div>
  );
}

// Portalled to <body>: these are full-screen overlays, and a <div> is not valid
// inside <tbody>. Rendering them in place produced a DOM nesting warning and
// left the overlay parented to a table.
function BookingOverlays({ b, a }) {
  return (
    <>
      {a.confirmDecline && createPortal(
        <ConfirmModal
          danger
          message={`Decline ${b.student_name}'s session?`}
          detail="The student is told the request was turned down. This cannot be undone."
          confirmLabel="Decline session"
          onCancel={() => a.setConfirmDecline(false)}
          onConfirm={() => { a.setConfirmDecline(false); a.update('cancelled'); }}
        />,
        document.body)}
      {a.chatOpen && createPortal(
        <AchieverChatDrawer sessionId={b.id} studentName={b.student_name}
                            onClose={() => a.setChatOpen(false)} />,
        document.body)}
      {a.boardOpen && createPortal(
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60">
          <div className="rounded-xl bg-white px-6 py-4 text-sm font-medium text-slate-700 shadow-xl">
            Loading whiteboard…
          </div>
        </div>}>
          <Whiteboard
            contextType="session"
            contextId={b.id}
            token={localStorage.getItem('achiever_access_token')}
            title={b.student_name}
            onClose={() => a.setBoardOpen(false)}
          />
        </Suspense>,
        document.body)}
    </>
  );
}

function CohortEnrollmentsTab() {
  const [data, setData] = useState({ enrollments: [], total: 0, paid: 0, free: 0, pending: 0 });
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState('all');
  const [q, setQ] = useState('');
  const [range, setRange] = useState(defaultRange);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);

  // `.catch(() => {})` used to swallow the failure and leave the list empty, so
  // an outage read as "no enrolments yet" — the one message that tells the
  // achiever the opposite of what happened.
  const load = useCallback(() => {
    setLoading(true);
    achieverApi.get('/achievers/portal/enrollments', {
      from: range.from, to: range.to, status: filter, search: q.trim(),
      page, per_page: perPage,
    })
      .then(({ data: d }) => {
        if (d.bool) { setData(d.response); setFailed(false); } else { setFailed(true); }
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [range.from, range.to, filter, q, page, perPage]);

  useEffect(() => {
    const id = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const firstPage = (fn) => (v) => { setPage(1); fn(v); };
  const toggleFilter = (v) => { setPage(1); setFilter((cur) => (cur === v ? 'all' : v)); };

  const pagedEnrollments = data.enrollments || [];
  const pages = data.pages || 1;
  const counts = { paid: data.paid, free: data.free, total: data.window_total ?? data.total };

  // Defined once so the row and the card can never show different facts about
  // the same enrolment.
  const detailOf = (e) => ([
    { label: 'Student',   value: e.full_name },
    { label: 'Email',     value: e.email },
    { label: 'Cohort',    value: e.cohort_title },
    { label: 'Payment',   value: e.payment_status },
    { label: 'Amount paid',   value: e.amount_paid > 0 ? inr(e.amount_paid) : 'Free' },
    { label: 'Your earning',  value: e.achiever_earning > 0 ? inr(e.achiever_earning) : '—' },
    { label: 'Attended',  value: e.attended ? 'Yes' : 'No' },
    { label: 'Enrolled',  value: fmtDate(e.enrolled_at) },
  ]);

  return (
    <div className="space-y-4">
      <StatStrip items={[
        { icon: BadgeCheck, label: 'Paid', value: counts.paid, tone: 'text-emerald-600 bg-emerald-50',
          active: filter === 'paid', onClick: () => toggleFilter('paid') },
        { icon: Gift, label: 'Free', value: counts.free, tone: 'text-blue-600 bg-blue-50',
          active: filter === 'free', onClick: () => toggleFilter('free') },
        { icon: Users, label: 'Total', value: counts.total, tone: 'text-slate-600 bg-slate-100',
          active: filter === 'all', onClick: () => toggleFilter('all') },
      ]} />

      <FilterBar q={q} onQ={firstPage(setQ)} status={filter} onStatus={firstPage(setFilter)}
                 statusOptions={PAYMENT_OPTIONS} range={range} onRange={firstPage(setRange)}
                 placeholder="Search by student, email or cohort…" />

      <ListShell
        loading={loading}
        failed={failed}
        onRetry={load}
        empty={pagedEnrollments.length === 0}
        emptyState={
          <EmptyState icon={Users}
                      message={q.trim() || filter !== 'all'
                        ? 'No enrolments match these filters'
                        : 'No enrolments in this period'}
                      sub="Students who enrol in your cohorts will appear here." />
        }
        pagination={
          <Pagination
            page={page}
            pages={pages}
            total={data.total ?? 0}
            perPage={perPage}
            onPage={(p) => setPage(p)}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
          />
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Student</Th>
                <Th>Cohort</Th>
                <Th>Payment</Th>
                <Th>Amount</Th>
                <Th>Enrolled</Th>
                <Th right> </Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={6} rows={5} /> : (
              <tbody className="divide-y divide-slate-100">
                {pagedEnrollments.map((e) => (
                  <ExpandableRow
                    key={e.enrollment_id}
                    colSpan={6}
                    cells={<>
                      <Td>
                        <div className="flex items-center gap-2.5">
                          <Avatar name={e.full_name} />
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-900 truncate">{e.full_name}</p>
                            <p className="text-[11px] text-slate-400 truncate">{e.email}</p>
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <BookOpen size={11} className="text-slate-400 shrink-0" />
                          <p className="text-xs text-slate-600 truncate max-w-xs">{e.cohort_title}</p>
                        </div>
                      </Td>
                      <Td>
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border capitalize ${ENROLL_STATUS_BADGE[e.payment_status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                          {e.payment_status}
                        </span>
                      </Td>
                      <Td>
                        {e.amount_paid > 0
                          ? <span className="text-xs font-semibold text-slate-700">{inr(e.amount_paid)}</span>
                          : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                      <Td><span className="text-xs text-slate-500">{fmtDate(e.enrolled_at)}</span></Td>
                    </>}
                    detail={detailOf(e)}
                  />
                ))}
              </tbody>
            )}
          </table>
        }
        cards={pagedEnrollments.map((e) => (
          <ExpandableCard
            key={e.enrollment_id}
            title={e.full_name}
            subtitle={e.email}
            badge={<StatusBadge status={e.payment_status} />}
            fields={[
              { label: 'Cohort',   value: e.cohort_title },
              { label: 'Amount',   value: e.amount_paid > 0 ? inr(e.amount_paid) : 'Free' },
              { label: 'Enrolled', value: fmtDate(e.enrolled_at) },
            ]}
            detail={detailOf(e)}
          />
        ))}
      />
    </div>
  );
}

// ── Cohorts: one row per class, tap for students / payments / reviews ─────────
// A list of every enrolment grew one row per student (100 cohorts x 4 seats =
// 400 rows). One row per class answers the questions an achiever asks of a
// class -- who joined, who came, what it earned -- and the detail is the same
// view admin sees in Achievers > Cohorts, so the two never disagree.
const loadCohortDetail = (id) => achieverApi.get(`/achievers/portal/cohort-bookings/${id}`);

const COHORT_STATUS_LABEL = { upcoming: 'Upcoming', live: 'Live', completed: 'Completed', cancelled: 'Cancelled' };

function cohortMoney(c) {
  if (c.is_demo) return 'Demo';
  if (c.is_free) return 'Free';
  return inr(c.earned);
}

function CohortWhat({ c }) {
  return (
    <>
      <KindBadge kind="cohort" />
      <p className="text-[11px] text-slate-500 mt-0.5">
        {c.joined}{c.total_seats ? ` / ${c.total_seats}` : ''} student{c.joined === 1 ? '' : 's'} · {c.attended} attended
      </p>
    </>
  );
}

function CohortClassRow({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr onClick={() => setOpen((o) => !o)} className="hover:bg-slate-50 transition-colors cursor-pointer">
        <Td>
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-full bg-blue-50 text-blue-600 flex items-center justify-center shrink-0"><BookOpen size={14} /></span>
            <p className="text-sm font-semibold text-slate-900 truncate max-w-xs">{c.title}</p>
          </div>
        </Td>
        <Td><CohortWhat c={c} /></Td>
        <Td><span className="text-xs text-slate-600">{fmtDate(c.session_date)}</span></Td>
        <Td><span className={`text-xs font-semibold ${c.is_free ? 'text-slate-400' : 'text-slate-700'}`}>{cohortMoney(c)}</span></Td>
        <Td><StatusBadge status={c.status} {...(c.missed ? { label: "Missed", tone: "warning" } : {})} /></Td>
        <Td right>{open ? <ChevronUp size={15} className="text-slate-400" /> : <ChevronDown size={15} className="text-slate-400" />}</Td>
      </tr>
      {open && (
        <tr>
          <td colSpan={6} className="bg-slate-50/60 px-4 py-4 border-b border-slate-100">
            <div className="max-w-2xl"><CohortDetail cohort={c} load={loadCohortDetail} hideHeader /></div>
          </td>
        </tr>
      )}
    </>
  );
}

function CohortClassCard({ c }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <RowCard
        onClick={() => setOpen((o) => !o)}
        title={c.title}
        subtitle={`Cohort · ${c.joined}${c.total_seats ? ` / ${c.total_seats}` : ''} students · ${c.attended} attended`}
        badge={<StatusBadge status={c.status} {...(c.missed ? { label: "Missed", tone: "warning" } : {})} />}
        action={open ? <ChevronUp size={15} className="text-slate-400 shrink-0" /> : <ChevronDown size={15} className="text-slate-400 shrink-0" />}
        fields={[
          { label: 'Date', value: fmtDate(c.session_date) },
          { label: c.is_free ? 'Price' : 'Earned', value: cohortMoney(c) },
        ]}
      />
      {open && (
        <div className="mt-2 bg-white rounded-2xl border border-slate-200 p-4">
          <CohortDetail cohort={c} load={loadCohortDetail} hideHeader />
        </div>
      )}
    </div>
  );
}

// Upcoming / Completed / Cancelled across both kinds of booking.
const BOOKING_STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

// Fetch a wide window once (2 years back, 1 year ahead); the views below cut it.
const isoDay = (d) => d.toISOString().slice(0, 10);
const wideWindow = () => {
  const now = new Date();
  const from = new Date(now); from.setFullYear(from.getFullYear() - 2);
  const to = new Date(now); to.setFullYear(to.getFullYear() + 1);
  return { from: isoDay(from), to: isoDay(to) };
};
// The day in the viewer's time (IST), for comparing with the date filter.
const localDay = (iso) => {
  if (!iso) return '';
  const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
};
const DEAD = ['cancelled', 'declined', 'rejected', 'expired'];

export default function AchieverBookings() {
  const [sessions, setSessions] = useState({ bookings: [] });
  const [cohorts,  setCohorts]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [failed,   setFailed]   = useState(false);
  // Upcoming never hides a class; Past and Cancelled look back (last 7 days by default).
  const [view,     setView]     = useState('upcoming');
  const [dateBy,   setDateBy]   = useState('class');
  const [q,        setQ]        = useState('');
  const [range,    setRange]    = useState(defaultRange);
  const [win]                   = useState(wideWindow);
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const kind = isKind(requested) ? requested : DEFAULT_KIND;
  const setKind = (key) => {
    const next = new URLSearchParams(params);
    if (key === DEFAULT_KIND) next.delete('tab'); else next.set('tab', key);
    setParams(next, { replace: true });
  };
  const [page,     setPage]     = useState(1);
  const [perPage,  setPerPage]  = useState(20);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      achieverApi.get('/achievers/portal/bookings', {
        from: win.from, to: win.to, search: q.trim(), status: 'all', page: 1, per_page: 200,
      }),
      achieverApi.get('/achievers/portal/cohort-bookings'),
    ])
      .then(([sess, coh]) => {
        if (sess.data?.bool && coh.data?.bool) {
          setSessions(sess.data.response);
          setCohorts(coh.data.response.cohorts || []);
          setFailed(false);
        } else setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [win.from, win.to, q]);

  useEffect(() => {
    const id = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [load, q]);

  const firstPage = (fn) => (v) => { setPage(1); fn(v); };
  const pickView = (v) => { setPage(1); setView(v); };

  // Every row of the chosen tab, sorted into Upcoming / Past / Cancelled.
  const [now] = useState(() => Date.now());
  const rowsOfKind = (() => {
    const needle = q.trim().toLowerCase();
    const fromSessions = (sessions.bookings || []).map((b) => {
      const at = b.scheduled_at ? new Date(b.scheduled_at).getTime() : null;
      const end = at ? at + (Number(b.duration_minutes) || 60) * 60000 : null;
      const bucket = DEAD.includes(b.status) ? 'cancelled'
        : (['pending', 'confirmed'].includes(b.status) && (!end || end > now)) ? 'upcoming' : 'past';
      return { kind: 'session', id: b.id, when: b.scheduled_at || b.created_at, created: b.created_at, bucket,
               earned: Number(b.achiever_earning ?? 0) || 0, session: b };
    });
    const fromCohorts = cohorts
      .filter((c) => !needle || (c.title || '').toLowerCase().includes(needle))
      .map((c) => ({ kind: 'cohort', id: c.id, when: c.session_date, created: c.created_at,
                     bucket: c.missed || c.status === 'cancelled' ? 'cancelled' : ['upcoming', 'live'].includes(c.status) ? 'upcoming' : 'past',
                     earned: c.earned || 0, cohort: c }));
    const all = [...fromSessions, ...fromCohorts];
    if (kind === 'sessions') return all.filter((x) => x.kind === 'session');
    if (kind === 'enrollments') return all.filter((x) => x.kind === 'cohort');
    return all;
  })();
  const inRange = (x) => {
    const d = localDay(dateBy === 'created' ? x.created : x.when);
    return !d || ((!range.from || d >= range.from) && (!range.to || d <= range.to));
  };
  const ofView = (v) => rowsOfKind.filter((x) => x.bucket === v && (v === 'upcoming' || inRange(x)));
  const t = (x) => (x.when ? new Date(x.when).getTime() : 0);
  // Upcoming: nearest first. Past / Cancelled: newest first (by the chosen date).
  const timeline = ofView(view).sort((a, b) => (view === 'upcoming' ? t(a) - t(b)
    : new Date((dateBy === 'created' ? b.created : b.when) || 0) - new Date((dateBy === 'created' ? a.created : a.when) || 0)));

  const pages = Math.max(1, Math.ceil(timeline.length / perPage));
  const paged = timeline.slice((page - 1) * perPage, page * perPage);
  const count = (v) => ofView(v).length;
  // Earned in the Past view's period (cancelled money is not earned).
  const earned = ofView('past').reduce((sum, x) => sum + x.earned, 0);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Bookings</h1>
        <p className="text-sm text-slate-500 mt-0.5">Your cohorts (one row per class) and 1-on-1 sessions. Tap a row for details.</p>
      </div>

      <Tabs active={kind} onChange={(k) => { setPage(1); setKind(k); }} tabs={KINDS} />

      {/* Upcoming / Past / Cancelled — the tiles are the views. */}
      <StatStrip cols={4} items={[
        { icon: Clock, label: 'Upcoming', value: count('upcoming'), tone: 'text-blue-600 bg-blue-50',
          active: view === 'upcoming', onClick: () => pickView('upcoming') },
        { icon: CheckCircle, label: 'Past', value: count('past'), tone: 'text-emerald-600 bg-emerald-50',
          active: view === 'past', onClick: () => pickView('past') },
        { icon: XCircle, label: 'Cancelled', value: count('cancelled'), tone: 'text-amber-600 bg-amber-50',
          active: view === 'cancelled', onClick: () => pickView('cancelled') },
        { icon: BadgeCheck, label: 'Earned', value: inr(earned), tone: 'text-violet-600 bg-violet-50' },
      ]} />

      <FilterBar q={q} onQ={firstPage(setQ)} range={range} onRange={firstPage(setRange)}
                 dateBy={dateBy} onDateBy={firstPage(setDateBy)} showRange={view !== 'upcoming'}
                 placeholder={kind === 'sessions' ? 'Search by student, email or note…'
                   : kind === 'enrollments' ? 'Search by class name…' : 'Search by class or student…'} />

      <ListShell
        loading={loading}
        failed={failed}
        onRetry={load}
        empty={paged.length === 0}
        emptyState={
          <EmptyState icon={MessageSquare}
                      message={q.trim() ? 'Nothing matches this search'
                        : view === 'upcoming' ? 'Nothing coming up' : 'Nothing in this period'}
                      sub={view === 'upcoming' ? 'New bookings and your next classes show up here.'
                        : 'Try a wider date range, or switch Date by.'} />
        }
        pagination={
          <Pagination page={page} pages={pages} total={timeline.length} perPage={perPage}
                      onPage={setPage} onPerPage={(pp) => { setPerPage(pp); setPage(1); }} />
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>Class / Student</Th>
                <Th>Type</Th>
                <Th>Date</Th>
                <Th>Amount</Th>
                <Th>Status</Th>
                <Th right> </Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={6} rows={5} /> : (
              <tbody className="divide-y divide-slate-100">
                {paged.map((row) => (row.kind === 'session'
                  ? <BookingRow key={`s-${row.id}`} b={row.session} onUpdate={load} />
                  : <CohortClassRow key={`c-${row.id}`} c={row.cohort} />))}
              </tbody>
            )}
          </table>
        }
        cards={paged.map((row) => (row.kind === 'session'
          ? <BookingMobileCard key={`s-${row.id}`} b={row.session} onUpdate={load} />
          : <CohortClassCard key={`c-${row.id}`} c={row.cohort} />))}
      />
    </div>
  );
}
