import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CalendarCheck, IndianRupee, ShieldCheck, Info, CheckCheck, Loader2, ChevronRight, MailOpen, Mail,
} from 'lucide-react';
import { achieverApi } from '../../services/api';
import { routeFor } from '../../utils/achieverNotifRoute';
import {
  PageHeader, EmptyState, ErrorState, Skeleton, useToast,
} from '../../components/ui/index.jsx';

/**
 * Achiever notifications — web.
 *
 * The mobile app has had this screen; the web portal did not. A booking
 * request, a cancellation or a payout decision would arrive and the achiever
 * only saw it if they happened to open the right page.
 *
 * No new backend: /notifications/ is keyed on the JWT identity, and an
 * achiever token carries the achiever id, so the same endpoints the student
 * portal uses already return the right rows.
 */

const ICONS = {
  session:  CalendarCheck,
  cohort:   CalendarCheck,
  booking:  CalendarCheck,
  payment:  IndianRupee,
  reminder: Bell,
  system:   ShieldCheck,
};

const TINTS = {
  session:  'text-emerald-600 bg-emerald-50',
  cohort:   'text-emerald-600 bg-emerald-50',
  booking:  'text-emerald-600 bg-emerald-50',
  payment:  'text-amber-600 bg-amber-50',
  reminder: 'text-blue-600 bg-blue-50',
  system:   'text-violet-600 bg-violet-50',
};

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.floor(mins / 60)}h ago`;
  if (mins < 10080) return `${Math.floor(mins / 1440)}d ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

// The screen a notification is about. Unknown kinds stay non-navigating.
const BASE = '/skovo-achiever-portal';
const PER_PAGE = 20;

/** A message folded to two lines, with More / Less only when the fold actually
 *  hides something at the current width (a character count guessed wrong on
 *  wide screens, offering More on text that was already fully shown). */
function Message({ text }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const check = () => { if (!open) setCut(el.scrollHeight > el.clientHeight + 1); };
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [open, text]);
  return (
    <>
      <p ref={ref} className={`text-sm text-slate-500 mt-0.5 leading-relaxed ${open ? '' : 'line-clamp-2'}`}>{text}</p>
      {(cut || open) && (
        <button type="button" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
                className="text-xs font-semibold whitespace-nowrap mt-1" style={{ color: 'var(--accent)' }}>
          {open ? 'Less' : 'More'}
        </button>
      )}
    </>
  );
}

// "Today" / "Yesterday" / "26 Sept 2026" buckets, newest first (the API order).
function dayLabel(iso) {
  if (!iso) return 'Earlier';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const that = new Date(d); that.setHours(0, 0, 0, 0);
  const diff = Math.round((today - that) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Yesterday';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
function groupByDay(rows) {
  const out = [];
  for (const r of rows) {
    const k = dayLabel(r.created_at);
    const last = out[out.length - 1];
    if (last && last[0] === k) last[1].push(r); else out.push([k, [r]]);
  }
  return out;
}
// Inside the last day "5m ago" reads better; older rows already sit under a
// date heading, so they only need the time.
// Inside the last day "5m ago"; older rows carry their date as well as the
// time, so a row read on its own still says when it happened.
const timeOf = (iso) => {
  if (!iso) return '';
  if (Date.now() - new Date(iso).getTime() < 86400000) return when(iso);
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};

export default function AchieverNotifications() {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const [filter, setFilter]   = useState('all');
  const [page, setPage]       = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [more, setMore]       = useState(false);
  const toast = useToast();
  const navigate = useNavigate();

  // Paged: page 1 replaces the list, later pages append ("Load more").
  const fetchPage = useCallback((p) => achieverApi.get('/notifications/', { page: p, per_page: PER_PAGE })
    .then(({ data }) => {
      if (!data.bool) throw new Error('notifications unavailable');
      const r = data.response;
      const rows = r.notifications || r.items || [];
      setItems((cur) => (p === 1 ? rows : [...cur, ...rows.filter((x) => !cur.some((c) => c.id === x.id))]));
      setHasMore(Boolean(r.has_more));
      setPage(p);
    }), []);

  const loadMore = () => {
    setMore(true);
    fetchPage(page + 1).catch(() => toast.error("Couldn't load older notifications")).finally(() => setMore(false));
  };

  const load = useCallback(() => {
    setFailed(false);
    fetchPage(1)
      // A failed request is not an empty inbox. Tracked separately so the
      // screen can say "we couldn't load this" instead of "you're all caught
      // up", which would be a lie the achiever acts on.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [fetchPage]);

  useEffect(() => { load(); }, [load]);

  const markAllRead = async () => {
    setBusy(true);
    try {
      await achieverApi.post('/notifications/mark-all-read', {});
      // Optimistic locally too, so the list settles even if the reload is slow.
      setItems(list => list.map(n => ({ ...n, is_read: true })));
      load();
      toast.success('All notifications marked read');
    } catch {
      // A failed mark-read must not blank the list.
      toast.error("Couldn't mark them read");
    } finally { setBusy(false); }
  };

  const markUnread = async (id) => {
    setItems(list => list.map(n => (n.id === id ? { ...n, is_read: false } : n)));
    try { await achieverApi.patch(`/notifications/${id}/unread`, {}); }
    catch { toast.error("Couldn't mark it unread"); setItems(list => list.map(n => (n.id === id ? { ...n, is_read: true } : n))); }
  };

  // Tap: mark read, then go to what it is about (when it is about something).
  const openRow = (n) => {
    if (!n.is_read) markRead(n.id);
    const to = routeFor(n);
    if (to) navigate(to);
  };

  const markRead = async (id) => {
    setItems(list => list.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    // PATCH, not POST — mark-all-read is the POST one.
    try { await achieverApi.patch(`/notifications/${id}/read`, {}); } catch { /* ignore */ }
  };

  const unread = items.filter(n => !n.is_read).length;
  const shown = filter === 'unread' ? items.filter(n => !n.is_read) : items;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        subtitle={unread > 0 ? `${unread} unread` : 'You are all caught up'}
        action={
          <div className="flex items-center gap-2 w-full sm:w-auto">
            {/* One segmented switch: as two buttons they stacked full-width on a phone. */}
            <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100 flex-1 min-w-0 sm:flex-none">
              {['all', 'unread'].map(f => (
                <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                  className={`min-h-9 px-3 sm:px-4 rounded-lg text-sm font-semibold whitespace-nowrap transition-all ${
                    filter === f ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500 hover:text-slate-700'}`}>
                  {f === 'all' ? 'All' : `Unread${unread ? ` · ${unread}` : ''}`}
                </button>
              ))}
            </div>
            {unread > 0 && (
              <button onClick={markAllRead} disabled={busy}
                className="shrink-0 w-auto! flex items-center gap-1.5 min-h-11 px-3.5 rounded-xl text-sm font-semibold whitespace-nowrap border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors disabled:opacity-50">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                <span className="hidden sm:inline">Mark all read</span>
                <span className="sm:hidden">Read all</span>
              </button>
            )}
          </div>
        }
      />

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      ) : failed ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <ErrorState
            title="We couldn't load your notifications"
            subtitle="Your notifications are safe — this is a connection problem."
            onRetry={() => { setLoading(true); load(); }}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState
            icon={Bell}
            title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
            subtitle="Booking requests, cancellations and payout updates land here."
          />
        </div>
      ) : (
        // One list, grouped by day — separate cards per item made a long
        // history 1,400px of boxes. Unread rows carry an accent bar.
        <div className="space-y-4">
          {groupByDay(shown).map(([day, rows]) => (
            <section key={day}>
              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2 px-1">{day}</p>
              <div className="bg-white rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
                {rows.map(n => {
                  const Icon = ICONS[n.type] || Info;
                  const tint = TINTS[n.type] || 'text-slate-500 bg-slate-100';
                  const goes = Boolean(routeFor(n));
                  return (
                    <div key={n.id} role="button" tabIndex={0}
                      onClick={() => openRow(n)}
                      onKeyDown={(e) => { if (e.key === 'Enter') openRow(n); }}
                      className={`relative w-full text-left flex items-start gap-3 px-4 py-3.5 cursor-pointer transition-colors hover:bg-slate-50 ${n.is_read ? '' : 'bg-blue-50/40'}`}>
                      {!n.is_read && <span className="absolute left-0 top-3 bottom-3 w-1 rounded-r" style={{ backgroundColor: 'var(--accent)' }} />}
                      <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}>
                        <Icon size={16} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-start gap-2">
                          <p className={`text-sm min-w-0 ${n.is_read ? 'font-semibold text-slate-700' : 'font-bold text-slate-900'}`}>
                            {n.title}
                          </p>
                          {/* Beside the title from sm; on a phone it squeezed the
                              title to three lines, so it moves to the action row. */}
                          <span className="hidden sm:inline text-[11px] text-slate-400 ml-auto shrink-0 mt-0.5">
                            {timeOf(n.created_at)}
                          </span>
                        </div>
                        {/* The API serialises the body as `message`. */}
                        {n.message && <Message text={n.message} />}
                        <div className="flex items-center gap-3 mt-1.5" onClick={(e) => e.stopPropagation()}>
                          <span className="sm:hidden text-[11px] text-slate-400 mr-auto whitespace-nowrap">{timeOf(n.created_at)}</span>
                          <button type="button" onClick={() => (n.is_read ? markUnread(n.id) : markRead(n.id))}
                                  className="inline-flex items-center gap-1 text-xs font-semibold text-slate-400 hover:text-slate-600 whitespace-nowrap">
                            {n.is_read
                              ? <><Mail size={12} /> <span className="sm:hidden">Unread</span><span className="hidden sm:inline">Mark unread</span></>
                              : <><MailOpen size={12} /> <span className="sm:hidden">Read</span><span className="hidden sm:inline">Mark read</span></>}
                          </button>
                        </div>
                      </div>
                      {goes && <ChevronRight size={16} className="shrink-0 self-center text-slate-300" />}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
          {hasMore && filter === 'all' && (
            <button type="button" onClick={loadMore} disabled={more}
                    className="w-full min-h-11 rounded-xl border border-slate-200 bg-white text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-60 flex items-center justify-center gap-2">
              {more ? <><Loader2 size={14} className="animate-spin" /> Loading…</> : 'Load older notifications'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
