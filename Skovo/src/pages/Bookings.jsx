import React, { useEffect, useState, useCallback, useRef, lazy, Suspense } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';
import FreeTimes from '../components/sessions/FreeTimes';
import { Receipt, BookOpen, Calendar, Clock, IndianRupee, CheckCircle, XCircle,
  X, Check, UserCheck, MessageSquare, Star, Send, Loader2, Video, Filter, FileText, PenTool } from 'lucide-react';
import { Tabs } from '../components/admin/v1/AdminV1Kit';
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn, Avatar, ConfirmModal } from '../components/ui/TableComponents';
import { StudentPage, FormSelect, DateRange } from '../components/ui/index.jsx';
import { useMasters } from '../hooks/useMasters';
import CancelRefundModal from '../components/v1/CancelRefundModal';
// UI05-010 — the whiteboard is 1.7 MB and was statically imported here, so it
// shipped in the main bundle and every student paid for it on every visit,
// including the ones who never open a board. It only ever renders behind a
// state flag, so lazy loading costs nothing: the chunk is fetched when someone
// actually opens one, and Suspense covers that moment.
const Whiteboard = lazy(() => import('../components/Whiteboard'));

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-5 right-5 z-100 px-5 py-3 rounded-2xl text-sm font-semibold shadow-2xl flex items-center gap-2.5 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}

function ChatDrawer({ session, onClose }) {
  const [messages, setMessages] = useState([]);
  const [body,     setBody]     = useState('');
  const [loading,  setLoading]  = useState(true);
  const [sending,  setSending]  = useState(false);
  const bottomRef = useRef(null);
  const myId = (() => { try { const t = localStorage.getItem('access_token'); if (!t) return null; return JSON.parse(atob(t.split('.')[1])).sub; } catch { return null; } })();

  const load = useCallback(() => {
    api.get(`/chat/sessions/${session.id}/messages`)
      .then(({ data }) => { if (data.bool) setMessages(data.response.messages || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [session.id]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  const send = async (e) => {
    e.preventDefault();
    if (!body.trim()) return;
    setSending(true);
    try {
      const { data } = await api.post(`/chat/sessions/${session.id}/messages`, { body: body.trim() });
      if (data.bool) { setMessages(m => [...m, data.response]); setBody(''); }
    } catch {} finally { setSending(false); }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full sm:max-w-md sm:mx-4 bg-white rounded-t-2xl sm:rounded-2xl overflow-hidden shadow-2xl flex flex-col" style={{ maxHeight: '85vh' }}>
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center text-white font-bold text-sm">
            {session.mentor_name?.charAt(0) || 'M'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-white text-sm truncate">{session.mentor_name}</p>
            <p className="text-white/70 text-xs">1-on-1 Session · {session.status}</p>
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
              <p className="text-xs mt-1">Start the conversation with your achiever</p>
            </div>
          ) : messages.map(m => {
            const mine = m.sender_id === myId;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 ${mine ? 'text-white rounded-br-sm' : 'bg-slate-100 text-slate-900 rounded-bl-sm'}`}
                  style={mine ? { backgroundColor: 'var(--accent)' } : {}}>
                  <p className="text-sm leading-snug">{m.body}</p>
                  <p className={`text-[10px] mt-1 ${mine ? 'text-white/60' : 'text-slate-400'}`}>{fmt(m.created_at)}</p>
                </div>
              </div>
            );
          })}
          <div ref={bottomRef} />
        </div>
        <form onSubmit={send} className="flex items-center gap-2 px-4 py-3 border-t border-slate-100 shrink-0"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <input value={body} onChange={e => setBody(e.target.value)} placeholder="Enter a message" maxLength={2000}
            className="flex-1 text-base bg-slate-50 border border-slate-200 rounded-xl min-h-11 px-3.5 py-2.5 focus:outline-none focus:border-transparent" />
          <button type="submit" disabled={sending || !body.trim()} aria-label="Send"
            className="min-h-11 min-w-11 rounded-xl flex items-center justify-center text-white shrink-0 disabled:opacity-40 transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}>
            {sending ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * "You met Nandhu on 12 Aug" — enough to identify which session this is.
 * Falls back gracefully: a session with no date still names the achiever, so
 * the line is never left dangling as "You met  on".
 */
function sessionContext(session) {
  const name = session?.mentor_name || 'your achiever';
  // Same precedence as the `upcoming` list: a booked slot is the real date,
  // scheduled_at is the fallback for sessions that never had one.
  const d = session?.slot_date
    ? new Date(`${session.slot_date}T${(session.slot_start || '00:00:00').slice(0, 8)}`)
    : (session?.scheduled_at ? new Date(session.scheduled_at) : null);
  if (!d || Number.isNaN(d.getTime())) return `with ${name}`;
  const on = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return `You met ${name} on ${on}`;
}

/**
 * A nudge to review sessions that have finished and not been rated.
 *
 * The Rate button already existed on each completed session, but it sat inside
 * a list the student has no reason to scroll back to once the session is over.
 * Reviews are what decide whether a demo achiever can start charging, so the
 * ask has to find the student rather than wait to be found.
 *
 * Silent when there is nothing to review — a permanent empty box trains people
 * to stop looking at that part of the screen.
 */
function ReviewPrompt({ sessions, onRate }) {
  if (!sessions.length) return null;
  const first = sessions[0];
  const more = sessions.length - 1;

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
        <div className="w-9 h-9 rounded-xl bg-amber-100 grid place-items-center shrink-0">
          <Star size={17} className="text-amber-600" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-amber-900 text-sm">
            How was your session{sessions.length > 1 ? 's' : ''}?
          </p>
          <p className="text-xs text-amber-800 mt-0.5">
            {sessionContext(first)}.{' '}
            {more > 0 && `And ${more} other session${more > 1 ? 's' : ''} to review. `}
            Your rating decides whether they can charge for sessions.
          </p>
        </div>
        </div>
        <button
          type="button"
          onClick={() => onRate(first)}
          className="w-full sm:w-auto shrink-0 min-h-11 px-3.5 py-2 rounded-xl text-white text-xs font-bold transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#f59e0b' }}
        >
          Rate now
        </button>
      </div>
    </div>
  );
}

function RatingModal({ session, onClose, onRated }) {
  const [rating, setRating] = useState(0);
  const [hover,  setHover]  = useState(0);
  const [text,   setText]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const submit = async () => {
    if (!rating) { setError('Please pick a rating.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/achiever-reviews/${session.mentor_id}`, {
        rating, review_text: text.trim() || null,
        context_type: 'session', context_id: session.id,
      });
      if (data.bool) onRated(session.id);
      else setError(data.response?.message || 'Failed to submit rating.');
    } catch { setError('Network error.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="p-5 sm:p-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <h3 className="font-bold text-slate-900 text-lg mb-1">Rate your session</h3>
          {/* Names the session being rated. Someone with several sessions in a
              week cannot otherwise tell which one this modal is about, and a
              rating attached to the wrong achiever is not correctable by them. */}
          <p className="text-xs text-slate-500 mb-4">
            {sessionContext(session)}
          </p>

          <div className="flex items-center justify-center gap-1.5 mb-5">
            {[1, 2, 3, 4, 5].map(n => (
              <button key={n} type="button"
                onMouseEnter={() => setHover(n)} onMouseLeave={() => setHover(0)}
                onClick={() => setRating(n)}
                className="transition-transform hover:scale-110 active:scale-95">
                <Star size={32}
                  className={(hover || rating) >= n ? 'text-amber-400' : 'text-slate-200'}
                  fill={(hover || rating) >= n ? '#fbbf24' : 'none'} />
              </button>
            ))}
          </div>

          <textarea rows={3} value={text} onChange={e => setText(e.target.value)}
            placeholder="Enter what you thought of the session"
            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-base focus:outline-none resize-none mb-3" />

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl mb-3">{error}</p>}

          <div className="flex flex-col-reverse sm:flex-row gap-3 sm:justify-end">
            <button onClick={onClose} className="min-h-11 px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
            <button onClick={submit} disabled={saving || !rating}
              className="min-h-11 px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
              style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Submitting…' : 'Submit Rating'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const FILTERS = ['', 'paid', 'free', 'pending', 'refunded'];

function RescheduleModal({ session, onClose, onDone }) {
  const [dates, setDates]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked]   = useState(null);   // { date, time }
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState('');

  useEffect(() => {
    api.get(`/achiever-availability/${session.mentor_id}/times`, { session_id: session.id })
      .then(({ data }) => { if (data.bool) setDates(data.response.dates || []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, [session.mentor_id, session.id]);

  const ready = picked?.date && picked?.time;
  const save = async () => {
    if (!ready) { setErr('Pick a new day and time.'); return; }
    setSaving(true); setErr('');
    try {
      const { data } = await api.post(`/achievers/sessions/${session.id}/reschedule`,
        { date: picked.date, start_time: picked.time });
      if (data.bool) { onDone(); onClose(); }
      else setErr(data.response?.message || 'Failed to reschedule.');
    } catch { setErr('Something went wrong.'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[92dvh] overflow-y-auto"
        style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-900">Reschedule with {session.mentor_name}</h2>
          <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        {loading
          ? <p className="text-sm text-slate-400 py-6 text-center">Finding free times…</p>
          : <FreeTimes dates={dates} value={picked} onChange={setPicked} empty="No free times from this achiever in the next 4 weeks." />}
        {err && <p className="text-xs text-red-500 mt-2">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row gap-3 mt-5">
          <button onClick={onClose} className="flex-1 min-h-11 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving || !ready} className="flex-1 min-h-11 py-2 bg-indigo-600 text-white rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Reschedule'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* Class-day rules, in one line under a booking: waiting for the achiever to
   start (Join opens then), missed (money back), moved by the achiever (cancel
   for 100%), and "Report a problem" during the 24 hours after the class. */
function ClassNote({ item, kind, onReport }) {
  const c = item.class || {};
  const open = kind === 'cohort' ? ['live', 'upcoming'].includes(item.cohort_status) : ['pending', 'confirmed'].includes(item.status);
  const due = c.start_opens_at && new Date(c.start_opens_at) <= new Date();
  let text = null;
  let tone = 'text-slate-500';
  // A free seat has nothing to give back: say it was cancelled, not "money is back".
  const paid = Number(item.amount_paid ?? item.amount ?? 0) > 0 || item.payment_status === 'paid' || item.payment_status === 'refunded';
  if (c.missed) {
    text = paid ? "The achiever didn't join. Your money is back in your SKOVO Wallet." : "The achiever didn't join. Your seat is cancelled.";
    tone = paid ? 'text-emerald-700' : 'text-slate-500';
  }
  else if (c.rules && !c.started && open && due) text = 'Waiting for the achiever to start. Join opens then.';
  else if (item.rescheduled && open) { text = 'The achiever changed the time. Keep your seat, or cancel for 100% back.'; tone = 'text-indigo-700'; }
  if (!text && !item.can_report) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      {text && <span className={tone}>{text}</span>}
      {item.can_report && (
        <button type="button" onClick={() => onReport({ ...item, kind })} className="font-semibold text-red-600 underline">
          Report a problem
        </button>
      )}
    </div>
  );
}

function ReportModal({ item, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const send = async () => {
    if (reason.trim().length < 5) { setErr('Tell us what went wrong.'); return; }
    setBusy(true);
    try {
      const url = item.kind === 'session' ? `/achievers/sessions/${item.id}/report` : `/bookings/${item.id}/report`;
      const { data } = await api.post(url, { reason: reason.trim() });
      if (data?.bool) onDone(data.response?.message || 'Sent.');
      else setErr(data?.response?.message || 'Could not send.');
    } catch { setErr('Could not send.'); }
    setBusy(false);
  };
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-4" onClick={onClose}>
      <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <p className="font-bold text-slate-900">Report a problem with this class</p>
        <p className="text-xs text-slate-500">For example: the achiever left early, or the class did not happen. An admin checks it, and the achiever's payment waits until then.</p>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000}
                  placeholder="What went wrong?" aria-label="What went wrong"
                  className="w-full px-3 py-2 border border-slate-200 rounded-xl text-base sm:text-sm" />
        {err && <p className="text-xs text-red-600">{err}</p>}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <button type="button" onClick={onClose} className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold">Cancel</button>
          <button type="button" onClick={send} disabled={busy}
                  className="min-h-11 px-4 rounded-xl text-white text-sm font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
            {busy ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Bookings() {
  const navigate = useNavigate();
  const [tab,         setTab]         = useState('upcoming');
  const [bookings,    setBookings]    = useState([]);
  const [sessions,    setSessions]    = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [sessLoading, setSessLoading] = useState(true);
  const [filter,      setFilter]      = useState('');
  const [classStatus, setClassStatus] = useState('');
  const [range, setRange] = useState({ from: '', to: '' });
  const { lists: statusLists } = useMasters(['cohort_status']);
  const [page,        setPage]        = useState(1);
  const [perPage,     setPerPage]     = useState(20);
  const [pagination,  setPagination]  = useState({ total: 0, pages: 1, page: 1 });
  const [toast,       setToast]       = useState(null);
  const [cancelling,  setCancelling]  = useState(null);
  const [chatSession, setChatSession] = useState(null);
  const [confirmDlg,  setConfirmDlg]  = useState(null);
  const [rateSession, setRateSession] = useState(null);
  const [ratedIds,    setRatedIds]    = useState([]);
  const [invoices,    setInvoices]    = useState({});   // context_id -> invoice
  const [reschedule,  setReschedule]  = useState(null); // session being rescheduled
  const [board,       setBoard]       = useState(null); // { contextType, contextId, title } or null

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };
  const [report, setReport] = useState(null);

  const loadInvoices = () => {
    api.get('/billing/invoices')
      .then(({ data }) => {
        if (data.bool) {
          const map = {};
          (data.response.invoices || []).forEach(i => { if (i.context_id) map[i.context_id] = i; });
          setInvoices(map);
        }
      }).catch(() => {});
  };

  const downloadInvoice = async (invId) => {
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(`${API_BASE_URL}/billing/invoices/${invId}?format=html`,
        { headers: { Authorization: `Bearer ${token}` } });
      const html = await res.text();
      const w = window.open('', '_blank');
      if (w) { w.document.write(html); w.document.close(); }
    } catch { showToast('Could not open invoice', false); }
  };

  // Filter pills and pagination can fire several loads in quick succession.
  // Without this guard a slow earlier reply lands last and shows the wrong
  // filter's rows — same failure the Colleges list had.
  const bookingsSeq = useRef(0);

  const loadBookings = useCallback((pg = 1, status = filter, pp = perPage, cls = classStatus, rg = range) => {
    const seq = ++bookingsSeq.current;
    setLoading(true);
    const params = { page: pg, per_page: pp };
    if (status) params.payment_status = status;
    if (cls) params.class_status = cls;
    if (rg?.from) params.date_from = rg.from;
    if (rg?.to) params.date_to = rg.to;
    api.get('/bookings/', params)
      .then(({ data }) => {
        if (seq !== bookingsSeq.current) return;   // superseded by a newer load
        if (data.bool) {
          setBookings(data.response.bookings || []);
          setPagination(data.pagination || { total: 0, pages: 1, page: 1 });
        }
      })
      .catch(() => {})
      .finally(() => { if (seq === bookingsSeq.current) setLoading(false); });
  }, [filter, perPage, classStatus, range]);

  const [sessError, setSessError] = useState('');
  const loadSessions = () => {
    setSessLoading(true);
    setSessError('');
    api.get('/achievers/my-sessions')
      .then(({ data }) => {
        if (data.bool) setSessions(data.response.sessions || []);
        else setSessError(data.response?.message || 'Could not load your 1-on-1 sessions.');
      })
      // A failed load used to leave the list empty, which reads as "my booking
      // vanished". Say so, and offer a retry; the booking itself is safe.
      .catch(() => setSessError('Could not load your 1-on-1 sessions. Check your connection.'))
      .finally(() => setSessLoading(false));
  };

  // Which sessions this student has already rated.
  //
  // This used to live only in local state, so a reload lost it: an already
  // rated session showed "Rate" again, and rating it a second time silently
  // replaced the first score (the API is update-or-insert). Seeding from the
  // server is what makes the badge survive a refresh.
  const loadMyReviews = () => {
    api.get('/achiever-reviews/mine')
      .then(({ data }) => {
        if (!data?.bool) return;
        setRatedIds((data.response.reviews || [])
          .filter(r => r.context_type === 'session' && r.context_id)
          .map(r => r.context_id));
      })
      .catch(() => {});   // A failed lookup just means no badges; not worth a toast.
  };

  const cancelSession = async (s) => {
    let detail = 'Your session request will be cancelled.';
    let preview = null;
    if (s.payment_status === 'paid') {
      try {
        const { data } = await api.get(`/achievers/sessions/${s.id}/refund-preview`);
        if (data.bool) {
          preview = data.response;
          const r = Number(data.response.refund || 0);
          detail = r > 0
            ? `You'll be refunded ₹${r.toLocaleString('en-IN')}.`
            : 'No refund applies this close to the session.';
          preview = { ...preview, text: detail };
        }
      } catch { /* fall through */ }
    }
    setConfirmDlg({
      preview,
      message: 'Cancel this 1-on-1 session?',
      detail,
      confirmLabel: 'Cancel Session',
      danger: true,
      onConfirm: async (choice = {}) => {
        try {
          const { data } = await api.post(`/achievers/sessions/${s.id}/cancel`, choice);
          if (data.bool) { showToast(data.response?.message || 'Session cancelled'); loadSessions(); }
          else showToast(data.response?.message || 'Failed', false);
        } catch { showToast('Error', false); }
      },
    });
  };

  useEffect(() => { loadBookings(1); loadSessions(); loadInvoices(); loadMyReviews(); }, []);

  // Come back to the tab (or the phone) later and the achiever may have
  // confirmed, moved or cancelled something -- pick that up without a reload.
  useEffect(() => {
    const onShow = () => { if (document.visibilityState === 'visible') loadSessions(); };
    document.addEventListener('visibilitychange', onShow);
    return () => document.removeEventListener('visibilitychange', onShow);
  }, []);

  const handleCancel = async (enrollmentId, payStatus) => {
    const booking = bookings.find(b => b.id === enrollmentId);
    let detail = 'Your booking will be cancelled.';
    let preview = null;
    if (booking?.payment_status === 'paid') {
      try {
        const { data } = await api.get(`/bookings/${enrollmentId}/refund-preview`);
        if (data.bool) { detail = data.response.text || detail; preview = data.response; }
      } catch { /* fall through */ }
    }
    setConfirmDlg({
      preview,
      message: 'Cancel this booking?',
      detail,
      confirmLabel: 'Cancel Booking',
      danger: true,
      onConfirm: async (choice = {}) => {
        setCancelling(enrollmentId);
        try {
          const { data } = await api.post(`/bookings/${enrollmentId}/cancel`, choice);
          if (data.bool) { showToast('Booking cancelled successfully'); loadBookings(page, filter); }
          else showToast(data.response?.message || 'Failed to cancel', false);
        } catch { showToast('Network error', false); }
        finally { setCancelling(null); }
      },
    });
  };

  const fmtProposed = (s) => {
    const day = s.proposed_slot_date
      ? new Date(`${String(s.proposed_slot_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
      : 'a new time';
    const t = s.proposed_slot_start ? String(s.proposed_slot_start).slice(0, 5) : '';
    return t ? `${day} · ${t}` : day;
  };

  const handleProposal = (s, accept) => {
    const when = fmtProposed(s);
    setConfirmDlg({
      message: accept ? `Accept ${when}?` : `Decline ${when}?`,
      detail: accept
        ? 'Your 1-on-1 moves to this slot. Payment stays the same.'
        : 'The session is cancelled and you get a full refund.',
      confirmLabel: accept ? 'Accept new time' : 'Decline and refund',
      danger: !accept,
      onConfirm: async () => {
        try {
          const { data } = await api.post(
            `/achievers/sessions/${s.id}/proposal/${accept ? 'accept' : 'decline'}`, {});
          if (data.bool) { showToast(data.response?.message || (accept ? 'Time accepted' : 'Declined')); loadSessions(); }
          else showToast(data.response?.message || 'Could not update', false);
        } catch { showToast('Network error', false); }
      },
    });
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';

  /** Cohorts and 1-on-1 sessions as one chronological list.
   *  Anything already finished or cancelled drops out; items still awaiting a
   *  time sort to the end rather than disappearing, so a pending request is
   *  never invisible. */
  // Completed sessions this student has not rated yet, oldest first — the one
  // they are least likely to still remember is the one worth asking about now.
  const awaitingReview = React.useMemo(() => (
    (sessions || [])
      .filter(s => s.status === 'completed' && !ratedIds.includes(s.id))
      .sort((a, b) => new Date(a.slot_date || a.scheduled_at || 0)
                    - new Date(b.slot_date || b.scheduled_at || 0))
  ), [sessions, ratedIds]);

  const upcoming = React.useMemo(() => {
    const DONE = ['completed', 'cancelled', 'rejected'];

    const fromCohorts = (bookings || [])
      .filter((b) => !DONE.includes(b.cohort_status))
      .map((b) => ({
        kind: 'cohort',
        id: b.cohort_id,
        title: b.cohort_title,
        subtitle: b.achiever_name || b.mentor_name || '',
        when: b.session_date ? new Date(b.session_date) : null,
        status: b.cohort_status,
        meetingLink: b.meeting_link,
      }));

    const fromSessions = (sessions || [])
      .filter((s) => !DONE.includes(s.status))
      .map((s) => ({
        kind: 'session',
        id: s.id,
        title: s.title ? `${s.title} with ${s.mentor_name || 'your achiever'}` : `1-on-1 with ${s.mentor_name || 'your achiever'}`,
        subtitle: [s.mentor_designation, s.mentor_company].filter(Boolean).join(' @ '),
        when: s.slot_date
          ? new Date(`${s.slot_date}T${(s.slot_start || '00:00:00').slice(0, 8)}`)
          : (s.scheduled_at ? new Date(s.scheduled_at) : null),
        status: s.status,
        meetingLink: s.meeting_link,
      }));

    return [...fromCohorts, ...fromSessions].sort((a, b) => {
      if (!a.when && !b.when) return 0;
      if (!a.when) return 1;      // undated requests go last, not missing
      if (!b.when) return -1;
      return a.when - b.when;
    });
  }, [bookings, sessions]);

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {report && <ReportModal item={report} onClose={() => setReport(null)} onDone={(m) => { setReport(null); showToast(m); loadBookings(); }} />}
      {chatSession && <ChatDrawer session={chatSession} onClose={() => setChatSession(null)} />}
      {board && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60">
          <div className="rounded-xl bg-white px-6 py-4 text-sm font-medium text-slate-700 shadow-xl">
            Loading whiteboard…
          </div>
        </div>}>
          <Whiteboard
            contextType={board.contextType}
            contextId={board.contextId}
            token={localStorage.getItem('access_token')}
            title={board.title}
            onClose={() => setBoard(null)}
          />
        </Suspense>
      )}
      {reschedule && (
        <RescheduleModal session={reschedule} onClose={() => setReschedule(null)}
          onDone={() => { showToast('Session rescheduled'); loadSessions(); }} />
      )}
      {rateSession && (
        <RatingModal session={rateSession} onClose={() => setRateSession(null)}
          onRated={(id) => { setRatedIds(ids => [...ids, id]); setRateSession(null); showToast('Thanks for rating your session!'); }} />
      )}
      {confirmDlg?.preview && (
        <CancelRefundModal title={confirmDlg.message} preview={confirmDlg.preview} confirmLabel={confirmDlg.confirmLabel}
          onConfirm={async (choice) => { await confirmDlg.onConfirm(choice); setConfirmDlg(null); }}
          onClose={() => setConfirmDlg(null)} />
      )}
      {confirmDlg && !confirmDlg.preview && (
        <ConfirmModal
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel}
          danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-black text-slate-900">My Bookings</h1>
          <p className="text-sm text-slate-400 mt-0.5">Your cohort enrollments and mentor sessions</p>
        </div>
        {/* Where a refund actually shows up. Cancelling used to change a badge
            here and nothing else, so "did my money come back" had no answer. */}
        <Link to="/payments"
          className="inline-flex items-center justify-center gap-1.5 min-h-11 text-sm font-semibold text-slate-500 hover:text-slate-800 transition-colors">
          <Receipt size={15} /> Payments &amp; refunds
        </Link>
      </div>

      <ReviewPrompt sessions={awaitingReview} onRate={setRateSession} />

      {/* Tabs: the platform's icon tabs, same as every other screen. */}
      {sessError && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span>{sessError} Your bookings are safe.</span>
          <button type="button" onClick={loadSessions} className="shrink-0 font-semibold underline">Retry</button>
        </div>
      )}

      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'upcoming', label: 'Upcoming', icon: Calendar, count: upcoming.length },
        { key: 'cohorts', label: 'Cohorts', icon: BookOpen, count: pagination.total },
        { key: 'sessions', label: 'Sessions', icon: UserCheck, count: sessions.length },
      ]} />

      {/* ── UPCOMING ── cohorts and 1-on-1s together, soonest first.
          Students think in one question — "what do I have coming up" — not in
          the two product categories these happen to belong to. The per-type
          tabs stay for when they want to look at just one kind. */}
      {tab === 'upcoming' && (
        <TableShell>
          {upcoming.length === 0 ? (
            <EmptyState
              icon={Calendar}
              message="Nothing coming up"
              sub="Cohorts you enrol in and sessions you book will appear here"
              action={
                <div className="flex flex-col sm:flex-row gap-2">
                  <button onClick={() => navigate('/cohorts')}
                    className="min-h-11 inline-flex items-center justify-center gap-2 px-5 text-sm font-semibold text-white rounded-xl hover:opacity-90"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    <BookOpen size={14} /> Browse cohorts
                  </button>
                  <button onClick={() => navigate('/find-mentors')}
                    className="min-h-11 inline-flex items-center justify-center gap-2 px-5 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50">
                    <Star size={14} /> Find Achievers
                  </button>
                </div>
              }
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {upcoming.map((u) => (
                <div key={`${u.kind}-${u.id}`} className="p-4 flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ backgroundColor: u.kind === 'cohort' ? '#eff6ff' : '#f5f3ff' }}>
                    {u.kind === 'cohort'
                      ? <BookOpen size={17} className="text-blue-600" />
                      : <UserCheck size={17} className="text-violet-600" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-bold text-slate-900 text-sm truncate">{u.title}</p>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0"
                        style={{
                          backgroundColor: u.kind === 'cohort' ? '#dbeafe' : '#ede9fe',
                          color: u.kind === 'cohort' ? '#1d4ed8' : '#6d28d9',
                        }}>
                        {u.kind === 'cohort' ? 'COHORT' : '1-ON-1'}
                      </span>
                    </div>
                    {u.subtitle && <p className="text-xs text-slate-400 truncate mt-0.5">{u.subtitle}</p>}
                    <p className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                      <Calendar size={11} />
                      {u.when
                        ? u.when.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                        : 'Awaiting a time'}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1.5 shrink-0">
                    <StatusBadge status={u.status} />
                    {u.meetingLink && (
                      <a href={u.meetingLink} target="_blank" rel="noopener noreferrer"
                        className="text-[11px] font-semibold px-2.5 py-1 rounded-lg text-white"
                        style={{ backgroundColor: '#059669' }}>
                        Join
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </TableShell>
      )}

      {/* ── COHORT BOOKINGS TAB ── */}
      {tab === 'cohorts' && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <Filter size={13} className="text-slate-400 shrink-0" />
            {FILTERS.map(s => (
              <button key={s || 'all'} onClick={() => { setFilter(s); setPage(1); loadBookings(1, s); }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                  filter === s ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'}`}>
                {s ? s.charAt(0).toUpperCase() + s.slice(1) : 'All'}
              </button>
            ))}
            {/* Class status (upcoming / live / completed / cancelled), beside the payment chips. */}
            <DateRange value={range} anyLabel="Any time" className="w-full sm:w-56 sm:ml-auto"
                       onChange={(r) => { const v = r || { from: '', to: '' }; setRange(v); setPage(1); loadBookings(1, filter, perPage, classStatus, v); }} />
            <div className="w-full sm:w-48">
              <FormSelect value={classStatus} placeholder="All classes"
                          options={[{ value: '', label: 'All classes' }, ...(statusLists.cohort_status || []).map((o) => ({ value: o.value, label: o.label }))]}
                          onChange={(v) => { setClassStatus(v || ''); setPage(1); loadBookings(1, filter, perPage, v || ''); }} />
            </div>
          </div>

          <TableShell>
            {/* Mobile: stacked cards (the wide table hides important columns on phones) */}
            {!loading && bookings.length > 0 && (
              <div className="sm:hidden divide-y divide-slate-100">
                {bookings.map((b) => {
                  const canCancel = ['paid', 'free', 'pending'].includes(b.payment_status)
                    && b.cohort_status !== 'completed' && b.cohort_status !== 'live' && !b.is_live;
                  const hasActions = (b.meeting_link && b.cohort_status !== 'completed')
                    || invoices[b.cohort_id] || canCancel;
                  return (
                    <div key={b.id} className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-bold text-slate-900 text-sm">{b.cohort_title}</p>
                        <span className="font-bold text-slate-800 text-sm shrink-0">{b.amount_paid > 0 ? `₹${b.amount_paid.toLocaleString('en-IN', { minimumFractionDigits: b.amount_paid % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : 'Free'}</span>
                      </div>
                      {b.achiever && (
                        <div className="flex items-center gap-2">
                          <Avatar name={b.achiever.full_name} size="sm" />
                          <span className="text-xs text-slate-600">{b.achiever.full_name}</span>
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>{fmt(b.session_date)}</span><span>·</span><span>{b.duration_minutes || 90} min</span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge status={b.payment_status} />
                        <StatusBadge status={b.cohort_status} label={b.class?.missed ? 'Missed' : undefined} />
                        {b.attended
                          ? <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={11} /> Attended</span>
                          : <span className="text-xs text-slate-400 flex items-center gap-1"><XCircle size={11} /> Not attended</span>}
                      </div>
                      <ClassNote item={b} kind="cohort" onReport={setReport} />
                      {hasActions && (
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {b.meeting_link && b.cohort_status !== 'completed' && (
                            <a href={b.meeting_link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white" style={{ backgroundColor: 'var(--accent)' }}>
                              <Video size={11} /> Join
                            </a>
                          )}
                          {b.meeting_link && b.cohort_status !== 'completed' && (
                            <button onClick={() => setBoard({ contextType: 'cohort', contextId: b.cohort_id, title: b.cohort_title })}
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#7c3aed' }}>
                              <PenTool size={11} /> Board
                            </button>
                          )}
                          {invoices[b.cohort_id] && (
                            <button onClick={() => downloadInvoice(invoices[b.cohort_id].id)}
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-slate-600 bg-slate-100">
                              <FileText size={11} /> Invoice
                            </button>
                          )}
                          {canCancel && (
                            <button onClick={() => handleCancel(b.id)} disabled={cancelling === b.id}
                              className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-red-500 bg-red-50 disabled:opacity-50">
                              <X size={11} /> Cancel
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Desktop: full table */}
            <div className="overflow-x-auto hidden sm:block">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>S.No</Th>
                    <Th>Actions</Th>
                    <Th>Cohort</Th>
                    <Th>Achiever</Th>
                    <Th>Date</Th>
                    <Th>Duration</Th>
                    <Th right>Amount</Th>
                    <Th>Payment</Th>
                    <Th>Session</Th>
                    <Th>Attended</Th>
                  </tr>
                </thead>
                {loading ? <LoadingRows cols={10} rows={6} /> : (
                  <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                    {bookings.map((b, idx) => {
                      // Can't cancel once the session is live or done — only before it starts.
                      const canCancel = ['paid', 'free', 'pending'].includes(b.payment_status)
                        && b.cohort_status !== 'completed' && b.cohort_status !== 'live' && !b.is_live;
                      // A finished cohort with no invoice has nothing to act on — show a dash
                      // rather than an empty cell so the column still reads as deliberate.
                      const hasActions = (b.meeting_link && b.cohort_status !== 'completed')
                        || invoices[b.cohort_id] || canCancel;
                      return (
                        <tr key={b.id} className="hover:bg-slate-50 transition-colors">
                          <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                          <Td>
                            <div className="flex items-center gap-1">
                              {b.meeting_link && b.cohort_status !== 'completed' && (
                                <a href={b.meeting_link} target="_blank" rel="noopener noreferrer"
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                                  style={{ backgroundColor: 'var(--accent)' }}>
                                  <Video size={10} /> Join
                                </a>
                              )}
                              {b.meeting_link && b.cohort_status !== 'completed' && (
                                <button onClick={() => setBoard({ contextType: 'cohort', contextId: b.cohort_id, title: b.cohort_title })}
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                                  style={{ backgroundColor: '#7c3aed' }}>
                                  <PenTool size={10} /> Board
                                </button>
                              )}
                              {invoices[b.cohort_id] && (
                                <button onClick={() => downloadInvoice(invoices[b.cohort_id].id)}
                                  title="Download invoice"
                                  className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                                  <FileText size={10} /> Invoice
                                </button>
                              )}
                              {canCancel && (
                                <ActionBtn icon={X} tooltip="Cancel booking" color="red"
                                  loading={cancelling === b.id}
                                  onClick={() => handleCancel(b.id)} />
                              )}
                              {!hasActions && <span className="text-xs text-slate-300">—</span>}
                            </div>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 max-w-50 truncate block">{b.cohort_title}</span>
                          </Td>
                          <Td>
                            {b.achiever && (
                              <div className="flex items-center gap-2">
                                <Avatar name={b.achiever.full_name} size="sm" />
                                <span className="text-xs text-slate-600 truncate max-w-25">{b.achiever.full_name}</span>
                              </div>
                            )}
                          </Td>
                          <Td className="whitespace-nowrap"><span className="text-xs text-slate-500">{fmt(b.session_date)}</span>
                            {b.session_date && <span className="block text-[11px] text-slate-400">{new Date(b.session_date).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}</span>}</Td>
                          <Td><span className="text-xs text-slate-500">{b.duration_minutes || 90} min</span></Td>
                          <Td right>
                            <span className="font-semibold text-slate-800">
                              {b.amount_paid > 0 ? `₹${b.amount_paid.toLocaleString('en-IN', { minimumFractionDigits: b.amount_paid % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : 'Free'}
                            </span>
                          </Td>
                          <Td><StatusBadge status={b.payment_status} /></Td>
                          <Td><StatusBadge status={b.cohort_status} label={b.class?.missed ? 'Missed' : undefined} /><div className="mt-1 max-w-56"><ClassNote item={b} kind="cohort" onReport={setReport} /></div></Td>
                          <Td>
                            {b.attended
                              ? <span className="text-xs text-emerald-600 flex items-center gap-1"><CheckCircle size={11} /> Yes</span>
                              : <span className="text-xs text-slate-400 flex items-center gap-1"><XCircle size={11} /> No</span>}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
            {!loading && bookings.length === 0 && (
              <EmptyState icon={BookOpen}
                message="No bookings found"
                sub={filter ? 'Try clearing the filter' : 'Browse cohorts and enroll to get started!'} />
            )}
            <Pagination
              page={page} pages={pagination.pages} total={pagination.total}
              perPage={perPage} onPage={p => { setPage(p); loadBookings(p); }}
              onPerPage={pp => { setPerPage(pp); setPage(1); loadBookings(1, filter, pp); }} />
          </TableShell>
        </>
      )}

      {/* ── ACHIEVER SESSIONS TAB ── */}
      {tab === 'sessions' && (
        <TableShell>
          {/* Mobile: stacked cards */}
          {!sessLoading && sessions.length > 0 && (
            <div className="sm:hidden divide-y divide-slate-100">
              {sessions.map((s) => (
                <div key={s.id} className="p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Avatar name={s.mentor_name} size="sm" />
                    <div className="min-w-0 flex-1">
                      {s.title && <p className="font-bold text-slate-900 text-sm wrap-break-word">{s.title}</p>}
                      <p className={s.title ? 'text-xs font-semibold text-slate-600 truncate' : 'font-bold text-slate-900 text-sm truncate'}>{s.title ? `with ${s.mentor_name}` : s.mentor_name}</p>
                      {s.mentor_designation && <p className="text-[11px] text-slate-400 truncate">{s.mentor_designation}{s.mentor_company ? ` @ ${s.mentor_company}` : ''}</p>}
                    </div>
                    <StatusBadge status={s.status} />
                  </div>
                  <p className="text-xs text-slate-500 flex items-center gap-1">
                    <Calendar size={11} />
                    {s.slot_date ? new Date(s.slot_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : `Requested ${s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}`}
                    {s.slot_start && <span className="ml-1">· {s.slot_start.slice(0, 5)}</span>}
                  </p>
                  {s.note && <p className="text-xs text-slate-500 italic">"{s.note}"</p>}
                  {s.proposed_slot_id && ['pending', 'confirmed'].includes(s.status) && (
                    <div className="p-2.5 bg-indigo-50 rounded-xl text-xs text-indigo-800">
                      New time proposed: {fmtProposed(s)}. Accept to keep the session, or decline for a full refund.
                      <div className="flex gap-2 mt-2">
                        <button onClick={() => handleProposal(s, true)}
                          className="flex-1 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold">Accept</button>
                        <button onClick={() => handleProposal(s, false)}
                          className="flex-1 py-1.5 rounded-lg bg-white border border-indigo-200 font-semibold">Decline</button>
                      </div>
                    </div>
                  )}
                  <ClassNote item={s} kind="session" onReport={setReport} />
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {/* Gated on status, as the cohort rows above already were:
                        a completed session has no meeting to join and its board
                        is a record, not a workspace. Rate stays -- that is the
                        one thing a finished session still needs. */}
                    {s.meeting_link && s.status !== 'completed' && s.status !== 'cancelled' && (
                      <a href={s.meeting_link} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#059669' }}>
                        <Video size={11} /> Join
                      </a>
                    )}
                    {s.meeting_link && s.status !== 'completed' && s.status !== 'cancelled' && (
                      <button onClick={() => setBoard({ contextType: 'session', contextId: s.id, title: s.mentor_name })}
                        className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#7c3aed' }}>
                        <PenTool size={11} /> Board
                      </button>
                    )}
                    <button onClick={() => setChatSession(s)}
                      className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-indigo-600 bg-indigo-50">
                      <MessageSquare size={11} /> Chat
                    </button>
                    {['pending', 'confirmed'].includes(s.status) && (
                      <>
                        <button onClick={() => setReschedule(s)}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 text-slate-600">
                          <Clock size={11} /> Reschedule
                        </button>
                        <button onClick={() => cancelSession(s)}
                          className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-red-50 text-red-600">
                          <XCircle size={11} /> Cancel
                        </button>
                      </>
                    )}
                    {s.status === 'completed' && (ratedIds.includes(s.id) ? (
                      <span className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-emerald-50 text-emerald-600"><Star size={11} fill="#059669" className="text-emerald-600" /> Rated</span>
                    ) : (
                      <button onClick={() => setRateSession(s)} className="flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg text-white" style={{ backgroundColor: '#f59e0b' }}><Star size={11} /> Rate</button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Desktop: full table */}
          <div className="overflow-x-auto hidden sm:block">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Achiever</Th>
                  <Th>Date & Time</Th>
                  <Th>Status</Th>
                  <Th>Your Note</Th>
                  <Th>Achiever Note</Th>
                </tr>
              </thead>
              {sessLoading ? <LoadingRows cols={7} rows={4} /> : (
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {sessions.map((s, idx) => (
                    <tr key={s.id} className="hover:bg-slate-50 transition-colors">
                      <Td><span className="text-xs text-slate-400">{idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1">
                          {s.meeting_link && s.status !== 'completed' && s.status !== 'cancelled' && (
                            <a href={s.meeting_link} target="_blank" rel="noopener noreferrer"
                              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                              style={{ backgroundColor: '#059669' }}>
                              <Video size={10} /> Join
                            </a>
                          )}
                          {s.meeting_link && s.status !== 'completed' && s.status !== 'cancelled' && (
                            <button onClick={() => setBoard({ contextType: 'session', contextId: s.id, title: s.mentor_name })}
                              className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                              style={{ backgroundColor: '#7c3aed' }}>
                              <PenTool size={10} /> Board
                            </button>
                          )}
                          <ActionBtn icon={MessageSquare} tooltip="Open chat" color="indigo"
                            onClick={() => setChatSession(s)} />
                          {['pending', 'confirmed'].includes(s.status) && (
                            <>
                              {s.proposed_slot_id && (
                                <>
                                  <button onClick={() => handleProposal(s, true)}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white bg-indigo-600">
                                    Accept {fmtProposed(s)}
                                  </button>
                                  <button onClick={() => handleProposal(s, false)}
                                    className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-red-50 text-red-600">
                                    Decline
                                  </button>
                                </>
                              )}
                              <button onClick={() => setReschedule(s)}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
                                <Clock size={10} /> Reschedule
                              </button>
                              <button onClick={() => cancelSession(s)}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                                <XCircle size={10} /> Cancel
                              </button>
                            </>
                          )}
                          {s.status === 'completed' && (
                            ratedIds.includes(s.id) ? (
                              <span className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg bg-emerald-50 text-emerald-600">
                                <Star size={10} fill="#059669" className="text-emerald-600" /> Rated
                              </span>
                            ) : (
                              <button onClick={() => setRateSession(s)}
                                className="flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-lg text-white"
                                style={{ backgroundColor: '#f59e0b' }}>
                                <Star size={10} /> Rate
                              </button>
                            )
                          )}
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <Avatar name={s.mentor_name} size="sm" />
                          <div className="min-w-0">
                            {s.title && <p className="font-semibold text-slate-900 truncate max-w-40" title={s.title}>{s.title}</p>}
                            <p className={s.title ? 'text-[11px] text-slate-600 truncate max-w-30' : 'font-semibold text-slate-800 truncate max-w-30'}>{s.mentor_name}</p>
                            {s.mentor_designation && (
                              <p className="text-[10px] text-slate-400 truncate max-w-30">
                                {s.mentor_designation}{s.mentor_company ? ` @ ${s.mentor_company}` : ''}
                              </p>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Calendar size={11} />
                          {s.slot_date
                            ? new Date(s.slot_date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                            : `Requested ${s.created_at ? new Date(s.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}`}
                          {s.slot_start && <span className="ml-1">· {new Date(`2000-01-01T${s.slot_start.slice(0, 5)}`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }).toUpperCase()}</span>}
                        </span>
                      </Td>
                      <Td>
                        {s.missed ? (
                          <span className="inline-flex flex-wrap gap-1">
                            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-red-200 bg-red-50 text-red-600">Missed</span>
                            {s.payment_status === 'refunded' && <span className="text-[11px] font-bold px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">Refunded</span>}
                          </span>
                        ) : <StatusBadge status={s.status} />}
                        <div className="mt-1 max-w-56"><ClassNote item={s} kind="session" onReport={setReport} /></div>
                      </Td>
                      <Td>
                        {s.note && (
                          <span className="text-xs text-slate-500 italic line-clamp-1 max-w-35">"{s.note}"</span>
                        )}
                      </Td>
                      <Td>
                        {s.mentor_notes && (
                          <span className="text-xs text-slate-500 italic line-clamp-1 max-w-35">"{s.mentor_notes}"</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {!sessLoading && sessions.length === 0 && (
            <div className="flex flex-col items-center py-16 text-center">
              <EmptyState icon={UserCheck} message="No 1-on-1 sessions yet"
                sub="Browse achievers, pick a time slot, and send a session request." />
              <button onClick={() => navigate('/find-mentors')}
                className="mt-4 min-h-11 flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-all"
                style={{ backgroundColor: 'var(--accent)' }}>
                <Star size={14} /> Find Achievers
              </button>
            </div>
          )}
        </TableShell>
      )}
    </StudentPage>
  );
}
