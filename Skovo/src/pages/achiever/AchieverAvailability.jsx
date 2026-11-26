import TimePicker from '../../components/ui/TimePicker';
import DatePicker from '../../components/ui/DatePicker';
import DateTimePicker from '../../components/ui/DateTimePicker';
import FormSelect from '../../components/ui/FormSelect';
import StatTile from '../../components/admin/StatTile';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  Clock, Plus, Trash2, X, Loader2, Check, AlertTriangle, CalendarDays, Repeat,
  Pencil, IndianRupee, BookOpen, Pause, Play, CalendarOff, CalendarPlus,
} from 'lucide-react';
import { achieverApi } from '../../services/api';
import { Skeleton, ErrorState, EmptyState, useToast } from '../../components/ui/index.jsx';
import { ConfirmModal } from '../../components/ui/TableComponents';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';
import { offeringStatus } from '../../utils/offeringStatus';

/**
 * Availability — 1-on-1s the Calendly way.
 *
 *   My 1-on-1s: WHAT the achiever offers ("Resume review · 30 min · ₹299").
 *   My hours:   WHEN he is free (every Mon 6–9 PM) + one-off date changes.
 *
 * Students pick a 1-on-1 and see only start times that fit his hours, minus
 * cohorts and other bookings. One booking blocks that time for everything.
 */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const LENGTHS = Array.from({ length: 12 }, (_, i) => (i + 1) * 15);   // 15 min to 3 hrs, every 15 min

function fmt(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
}
const overlaps = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;
const toMins = (t) => { const [h, m] = String(t || '0:0').split(':').map(Number); return h * 60 + (m || 0); };
const lenLabel = (m) => (m % 60 ? (m > 60 ? `${Math.floor(m / 60)} hr${m >= 120 ? "s" : ""} ${m % 60} min` : `${m} min`) : `${m / 60} hr${m > 60 ? 's' : ''}`);
const money = (n) => {
  const v = Number(n || 0);
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
const todayIso = () => nowLocal().slice(0, 10);
const toLocalInput = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
};
const dayLabel = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

/** Ids of every weekly range that clashes with another on the same day. */
function findConflicts(rows) {
  const clashing = new Set();
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i], b = rows[j];
      if (a.day_of_week === b.day_of_week && overlaps(a.start_time, a.end_time, b.start_time, b.end_time)) {
        clashing.add(a.id); clashing.add(b.id);
      }
    }
  }
  return clashing;
}

/** Price after an offer, to the paisa. null when the offer is not valid. */
function offerFinal(price, type, value) {
  const p = Number(price || 0);
  const v = Number(value || 0);
  if (!type) return p;
  if (!(p > 0) || !(v > 0)) return null;
  if (type === 'percent') return v <= 90 ? Math.round(p * (100 - v)) / 100 : null;
  return v < p ? Math.round((p - v) * 100) / 100 : null;
}

const inputCls = 'w-full min-h-11 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-purple-400/40';

/* ─── Start / end time with the length under it ─────────────────────────── */
function TimeRange({ start, end, setStart, setEnd, small, min = 15 }) {
  const len = toMins(end) - toMins(start);
  const lbl = small ? 'block text-[11px] font-semibold text-slate-500 mb-1' : 'block text-xs font-semibold text-slate-600 mb-1';
  const moveStart = (v) => {
    const keep = len > 0 ? len : 60;
    setStart(v);
    const e = toMins(v) + keep;
    if (e < 24 * 60) setEnd(`${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`);
  };
  return (
    <div className={small ? 'space-y-2' : 'grid grid-cols-1 sm:grid-cols-2 gap-3'}>
      <div>
        <label className={lbl}>From <span className="text-red-500">*</span></label>
        <TimePicker value={start} onChange={moveStart} step={15} defaultValue="18:00" />
      </div>
      <div>
        <label className={lbl}>To <span className="text-red-500">*</span></label>
        <TimePicker value={end} onChange={setEnd} step={15} defaultValue="21:00" />
      </div>
      <p className={`text-[11px] ${small ? '' : 'sm:col-span-2'} ${len >= min ? 'text-slate-500' : 'text-red-500'}`}>
        {len <= 0 ? 'The end must be after the start.' : len < min ? `At least ${min} minutes.` : <>Free for <b>{lenLabel(len)}</b></>}
      </p>
    </div>
  );
}

/* ═══ My 1-on-1s ════════════════════════════════════════════════════════════ */
const EMPTY = {
  title: '', about: '', duration_min: '60', price: '', offer_type: '', offer_value: '', offer_ends_at: '',
  meeting_link: '', days: [], available_from: '', available_to: '',
};

function OfferingModal({ initial, canCharge, onClose, onSaved, ranges = [], onGoHours }) {
  const [f, setF] = useState(() => (initial ? {
    title: initial.title, about: initial.about || '', duration_min: String(initial.duration_min),
    price: String(initial.price ?? ''), offer_type: initial.offer_type || '',
    offer_value: initial.offer_value == null ? '' : String(initial.offer_value),
    offer_ends_at: toLocalInput(initial.offer_ends_at), meeting_link: initial.meeting_link || '',
    days: initial.days?.length ? initial.days : EMPTY.days,
    available_from: initial.available_from || '', available_to: initial.available_to || '',
  } : EMPTY));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const toggleDay = (d) => set('days', f.days.includes(d) ? f.days.filter((x) => x !== d) : [...f.days, d].sort());
  const final = offerFinal(f.price, f.offer_type, f.offer_value);

  const check = () => {
    if (f.title.trim().length < 3) return 'Give it a title (at least 3 characters).';
    if (!f.days.length) return 'Pick at least one Bookable on day.';
    if (canCharge) {
      if (f.price === '') return 'Enter a price (0 means free).';
      const p = Number(f.price);
      if (!(p >= 0) || p > 100000) return 'Price must be 0 to 1,00,000.';
      if (f.offer_type) {
        if (!(p > 0)) return 'An offer needs a price.';
        if (final == null) return f.offer_type === 'percent' ? 'Offer must be 1% to 90% off.' : `Offer must be ₹1 to less than ₹${p} off.`;
      }
    }
    if (f.meeting_link.trim() && !/^https?:\/\//i.test(f.meeting_link.trim())) return 'Meeting link must start with https://';
    if (f.available_from && f.available_to && f.available_to < f.available_from) return 'Bookable till must be after bookable from.';
    return '';
  };

  const save = async () => {
    const e = check();
    if (e) { setError(e); return; }
    setSaving(true); setError('');
    const body = {
      title: f.title.trim(), about: f.about.trim(), duration_min: Number(f.duration_min),
      price: canCharge ? Number(f.price || 0) : 0,
      offer_type: canCharge && Number(f.price) > 0 ? f.offer_type : '',
      offer_value: f.offer_type ? Number(f.offer_value) : null,
      offer_ends_at: f.offer_type ? (f.offer_ends_at || null) : null,
      meeting_link: f.meeting_link.trim(), days: f.days,
      available_from: f.available_from || null, available_to: f.available_to || null,
    };
    try {
      const { data } = initial
        ? await achieverApi.put(`/achiever-availability/my-offerings/${initial.id}`, body)
        : await achieverApi.post('/achiever-availability/my-offerings', body);
      if (data.bool) onSaved(initial ? 'Saved' : '1-on-1 added');
      else setError(data.response?.message || 'Could not save.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 sm:p-4" role="dialog" aria-modal="true">
      <div className="w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 shrink-0">
          <h3 className="text-base font-bold text-slate-900">{initial ? 'Edit 1-on-1 session' : 'Create 1-on-1 session'}</h3>
          <button onClick={onClose} aria-label="Close" className="min-h-10 min-w-10 flex items-center justify-center text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-4 sm:p-5 space-y-4">
          {/* The rules an achiever needs before publishing, in one place. */}
          <details className="rounded-xl border border-slate-200 bg-slate-50 group">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-sm font-semibold flex items-center justify-between"
                     style={{ color: 'var(--accent)' }}>
              How 1-on-1 sessions work
              <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <ol className="px-4 pb-3 space-y-2 text-xs text-slate-600 leading-relaxed list-decimal list-inside">
              <li><b>Availability.</b> Students can book only within the hours set under <i>My hours</i>, on the days selected here. A time is never offered if it overlaps a cohort or another booking.</li>
              <li><b>One booking, one session.</b> Each payment covers a single session at the date and time the student chooses. Students can book until 10 minutes before the start; bookings within the hour reach you as an urgent alert.</li>
              <li><b>Price protection.</b> The price is locked when a student books. Changes to price or offer apply to new bookings only.</li>
              <li><b>On the day.</b> Press <i>Start</i> at the session time; the meeting link is then shared with the student. Press <i>End</i> when finished. If a session is not started in time, the student receives a full refund and a strike is recorded.</li>
              <li><b>Edit, Pause, Remove.</b> <i>Edit</i> updates details for new bookings. <i>Pause</i> hides the session from students until you resume it. <i>Remove</i> deletes it permanently. In every case, sessions already booked go ahead as scheduled.</li>
              <li><b>If you cannot attend.</b> Cancel the booking from <i>Bookings</i>. The student receives a full refund, and the cancellation is recorded under the class rules.</li>
            </ol>
          </details>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Title <span className="text-red-500">*</span></label>
            <input value={f.title} maxLength={80} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Resume review" className={inputCls} />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">What we'll cover</label>
            <textarea rows={3} value={f.about} maxLength={500} onChange={(e) => set('about', e.target.value)}
                      placeholder="e.g. We go through your resume line by line and you leave with 3 clear fixes."
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white resize-none" />
            <p className="text-[11px] text-slate-400 text-right">{f.about.length}/500</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Length <span className="text-red-500">*</span></label>
              <FormSelect value={f.duration_min} onChange={(v) => v && set('duration_min', v)} clearable={false}
                          options={LENGTHS.map((m) => ({ value: String(m), label: lenLabel(m) }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Price (₹) {canCharge && <span className="text-red-500">*</span>}</label>
              {canCharge
                ? <input type="number" min="0" value={f.price} onChange={(e) => set('price', e.target.value)} placeholder="e.g. 299 (0 = free)" className={inputCls} />
                : <p className="text-xs text-slate-500 rounded-xl bg-slate-50 border border-slate-200 px-3 py-3">Paid sessions open once your account is verified.</p>}
            </div>
          </div>
          {canCharge && Number(f.price) > 0 && (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Offer</label>
                <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100" role="group" aria-label="Offer type">
                  {[['', 'No offer'], ['percent', '% off'], ['amount', '₹ off']].map(([k, l]) => (
                    <button key={k || 'none'} type="button" onClick={() => set('offer_type', k)}
                            className={`min-h-9 rounded-lg text-xs font-semibold ${f.offer_type === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
                  ))}
                </div>
              </div>
              {f.offer_type && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">{f.offer_type === 'percent' ? '% off' : '₹ off'} <span className="text-red-500">*</span></label>
                    <input type="number" min="1" value={f.offer_value} onChange={(e) => set('offer_value', e.target.value)}
                           placeholder={f.offer_type === 'percent' ? 'e.g. 20' : 'e.g. 100'} className={inputCls} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1">Offer ends</label>
                    <DateTimePicker value={f.offer_ends_at} onChange={(v) => set('offer_ends_at', v)} min={nowLocal()} defaultTime={{ h: 23, mi: 59 }} />
                    <p className="text-[11px] text-slate-400 mt-1">Pick a day: offer runs to 11:59 PM. Empty = always on.</p>
                  </div>
                </div>
              )}
              <p className="text-xs text-slate-500">
                Student pays{' '}
                {f.offer_type && final != null
                  ? <><s className="text-slate-400">{money(f.price)}</s> <b className="text-slate-800">{money(final)}</b></>
                  : <b className="text-slate-800">{money(f.price)}</b>}
                {' '}· locked once a student books.
              </p>
            </div>
          )}
          {/* When it can be booked — separate from the price and offer. */}
          <div className="rounded-xl border border-slate-200 p-3 space-y-3">
            <div>
              <p className="text-sm font-bold text-slate-900">When students can book</p>
              <p className="text-[11px] text-slate-500">Not the offer. Times show only inside your hours (My hours) on these days.</p>
            </div>
            {(() => {
              // Your hours per day, so a ticked day with no hours is caught here.
              const byDay = DAY_SHORT.map((_, i) => ranges.filter((r) => r.day_of_week === i)
                .map((r) => `${fmt(r.start_time)}–${fmt(r.end_time)}`));
              const lines = byDay.map((h, i) => (h.length ? `${DAY_SHORT[i]} ${h.join(', ')}` : null)).filter(Boolean);
              const noHours = f.days.filter((d) => !byDay[d].length).map((d) => DAY_SHORT[d]);
              return (
                <div className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-[11px] space-y-1">
                  {lines.length
                    ? <p className="text-slate-600"><b>Your hours:</b> {lines.join(' · ')}</p>
                    : <p className="text-amber-700"><b>You have no hours yet.</b> Students can't book until you add them in{' '}
                        <button type="button" onClick={onGoHours} className="font-semibold underline">My hours</button>.</p>}
                  {lines.length > 0 && noHours.length > 0 && (
                    <p className="text-amber-700">No hours on {noHours.join(', ')}, so it won't show those days. Add them in{' '}
                      <button type="button" onClick={onGoHours} className="font-semibold underline">My hours</button>.</p>
                  )}
                </div>
              );
            })()}
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Bookable on <span className="text-red-500">*</span></label>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Bookable on">
                {DAY_SHORT.map((d, i) => {
                  const on = f.days.includes(i);
                  return (
                    <button key={d} type="button" onClick={() => toggleDay(i)} aria-pressed={on}
                            className={`min-h-9 min-w-12 px-2 rounded-lg text-xs font-semibold border ${on ? 'text-white border-transparent' : 'bg-white text-slate-600 border-slate-200'}`}
                            style={on ? { backgroundColor: 'var(--accent)' } : undefined}>{d}</button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bookable from</label>
                <DatePicker value={f.available_from} onChange={(v) => set('available_from', v || '')} min={todayIso()} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Bookable till</label>
                <DatePicker value={f.available_to} onChange={(v) => set('available_to', v || '')} min={f.available_from || todayIso()} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">Empty = from today, no end date. After the till date it hides itself.</p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Meeting link</label>
            <input value={f.meeting_link} onChange={(e) => set('meeting_link', e.target.value)} placeholder="https://meet.google.com/…" className={inputCls} />
            <p className="text-[11px] text-slate-400 mt-1">Students see it only after you press Start.</p>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="p-4 sm:p-5 border-t border-slate-100 flex gap-2 justify-end shrink-0"
             style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="min-h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200">Cancel</button>
          <button onClick={save} disabled={saving} className="min-h-11 px-5 rounded-xl text-sm font-bold text-white disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Create session'}</button>
        </div>
      </div>
    </div>
  );
}

function OfferingsTab({ onChanged, ranges, onGoHours }) {
  const hasHours = ranges === null || ranges.length > 0;
  const [rows, setRows] = useState([]);
  const [canCharge, setCanCharge] = useState(false);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [edit, setEdit] = useState(null);       // null | 'new' | offering
  const [confirm, setConfirm] = useState(null);
  const toast = useToast();
  // Re-draw every minute so "Upcoming" turns into "Live now" without a reload.
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 60000); return () => clearInterval(t); }, []);

  const load = useCallback(() => {
    setLoading(true); setFailed(false);
    achieverApi.get('/achiever-availability/my-offerings')
      .then(({ data }) => {
        if (!data.bool) { setFailed(true); return; }
        setRows(data.response.offerings || []); setCanCharge(Boolean(data.response.can_charge));
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);
  const reload = (msg) => { if (msg) toast.success(msg); load(); onChanged(); };

  const setStatus = async (o, status) => {
    try {
      const { data } = await achieverApi.put(`/achiever-availability/my-offerings/${o.id}/status`, { status });
      if (data.bool) reload(data.response.message); else toast.error(data.response?.message || 'Could not change it');
    } catch { toast.error('Could not change it'); }
  };
  const remove = async (o) => {
    setConfirm(null);
    try {
      const { data } = await achieverApi.delete(`/achiever-availability/my-offerings/${o.id}`);
      if (data.bool) reload('Removed'); else toast.error(data.response?.message || 'Could not remove it');
    } catch { toast.error('Could not remove it'); }
  };

  return (
    <div className="space-y-4">
      {edit && <OfferingModal initial={edit === 'new' ? null : edit} canCharge={canCharge} ranges={ranges || []}
                              onGoHours={() => { setEdit(null); onGoHours(); }}
                              onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); reload(m); }} />}
      {confirm && (
        <ConfirmModal danger message={`Remove "${confirm.title}"?`}
          detail={confirm.upcoming ? `${confirm.upcoming} booked session(s) still happen. Students can't book it again.` : "Students won't see it any more."}
          confirmLabel="Remove" onCancel={() => setConfirm(null)} onConfirm={() => remove(confirm)} />
      )}

      {!hasHours && (
        <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
          <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-800">
            Students can't book yet: you have no hours. Add when you are free in{' '}
            <button onClick={onGoHours} className="font-semibold underline">My hours</button>.
          </p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-slate-500 min-w-0">What students can book, inside your hours.</p>
        <button onClick={() => setEdit('new')}
                className="shrink-0 min-h-11 px-4 rounded-xl text-sm font-semibold text-white flex items-center gap-1.5 whitespace-nowrap"
                style={{ backgroundColor: 'var(--accent)' }}><Plus size={15} /> New 1-on-1</button>
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 gap-3">{[0, 1].map((i) => <Skeleton key={i} className="h-36" />)}</div>
      ) : failed ? (
        <div className="bg-white rounded-2xl border border-slate-200"><ErrorState title="We couldn't load your 1-on-1s" onRetry={load} compact /></div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState icon={BookOpen} title="No 1-on-1 sessions yet" subtitle='Create one, e.g. "Resume review · 30 min · ₹299".' />
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 gap-3">
          {rows.map((o) => {
            const st = offeringStatus(o, ranges);
            const state = {
              ended: ['Ended', 'bg-slate-100 text-slate-500 border-slate-200'],
              paused: ['Paused', 'bg-amber-50 text-amber-700 border-amber-200'],
              published: ['Published', 'bg-blue-50 text-blue-700 border-blue-200'],
              upcoming: ['Upcoming', 'bg-blue-50 text-blue-700 border-blue-200'],
              live: ['Live now', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
              nohours: ['No hours', 'bg-amber-50 text-amber-700 border-amber-200'],
            }[st.kind];
            const off = o.offer_type && Number(o.final_price) < Number(o.price);
            return (
              <div key={o.id} className={`bg-white rounded-2xl border border-slate-200 p-4 flex flex-col ${o.status === 'paused' || o.expired ? 'opacity-75' : ''}`}>
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-bold text-slate-900 wrap-break-word">{o.title}</p>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-full border ${state[1]}`}>{state[0]}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  {lenLabel(o.duration_min)} · {o.days_label}
                  {o.available_to ? ` · till ${dayLabel(o.available_to)}` : ''}
                </p>
                {st.kind === 'upcoming' && (
                  <p className="text-xs text-blue-700 mt-1">
                    Next: {st.today ? 'today' : dayLabel(st.date)}, {fmt(`${String(Math.floor(st.startMin / 60)).padStart(2, '0')}:${String(st.startMin % 60).padStart(2, '0')}`)} IST
                  </p>
                )}
                {st.kind === 'nohours' && (
                  <p className="text-xs text-amber-700 mt-1">No matching hours in the next 4 weeks. Add them under My hours.</p>
                )}
                {o.about && <p className="text-xs text-slate-600 mt-2 line-clamp-2">{o.about}</p>}
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 mt-auto">
                  <span className="text-sm font-bold text-slate-900">
                    {off && <s className="text-xs font-normal text-slate-400 mr-1">{money(o.price)}</s>}
                    {Number(o.final_price) > 0 ? money(o.final_price) : 'Free'}
                  </span>
                  {o.upcoming > 0 && <span className="text-xs text-slate-500">· {o.upcoming} booked</span>}
                  <span className="ml-auto flex items-center gap-0.5">
                    <button onClick={() => setEdit(o)} aria-label="Edit" title="Edit"
                            className="min-h-9 min-w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100"><Pencil size={15} /></button>
                    {!o.expired && (o.status === 'paused'
                      ? <button onClick={() => setStatus(o, 'active')} aria-label="Resume" title="Resume"
                                className="min-h-9 min-w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50"><Play size={15} /></button>
                      : <button onClick={() => setStatus(o, 'paused')} aria-label="Pause" title="Pause"
                                className="min-h-9 min-w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50"><Pause size={15} /></button>)}
                    <button onClick={() => setConfirm(o)} aria-label="Remove" title="Remove"
                            className="min-h-9 min-w-9 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50"><Trash2 size={15} /></button>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ═══ My hours ═════════════════════════════════════════════════════════════ */
function AddRangeForm({ dayIndex, existing, onSaved, onCancel }) {
  const [start, setStart] = useState('18:00');
  const [end, setEnd] = useState('21:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    const parsed = schema.availability.safeParse({ day_of_week: dayIndex, start_time: start, end_time: end });
    if (!parsed.success) { setError(Object.values(fieldErrors(parsed))[0] || 'End must be after start.'); return; }
    const clash = existing.find((s) => overlaps(start, end, s.start_time.slice(0, 5), s.end_time.slice(0, 5)));
    if (clash) { setError(`Overlaps your ${fmt(clash.start_time)} – ${fmt(clash.end_time)} hours.`); return; }
    setSaving(true);
    try {
      const { data } = await achieverApi.post('/achiever-availability/my-availability', { day_of_week: dayIndex, start_time: start, end_time: end });
      if (data.bool) onSaved(); else setError(data.response?.message || 'Failed to save.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="mt-2 p-3 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
      <TimeRange start={start} end={end} setStart={setStart} setEnd={setEnd} small />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 min-h-9 px-3 text-xs font-semibold text-white rounded-lg disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}>
          {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Save
        </button>
        <button onClick={onCancel} className="min-h-9 px-2 text-xs text-slate-400 hover:text-slate-600">Cancel</button>
      </div>
    </div>
  );
}

function DayCard({ dayIndex, ranges, conflicts, onAdded, onAskDelete }) {
  const [adding, setAdding] = useState(false);
  const mine = ranges.filter((s) => s.day_of_week === dayIndex);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-slate-900">{DAYS[dayIndex]}</p>
          <p className="text-xs text-slate-400">{mine.length ? `${mine.length} range${mine.length > 1 ? 's' : ''}` : 'Not free'}</p>
        </div>
        <button onClick={() => setAdding((a) => !a)} aria-label={adding ? 'Cancel' : `Add hours to ${DAYS[dayIndex]}`}
                className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                style={{ backgroundColor: adding ? 'var(--accent)' : 'var(--accent-ring)', color: adding ? '#fff' : 'var(--accent)' }}>
          {adding ? <X size={14} /> : <Plus size={14} />}
        </button>
      </div>
      <div className="space-y-1.5">
        {mine.map((s) => (
          <div key={s.id} className={`flex items-center justify-between px-2.5 py-2 rounded-lg border ${conflicts.has(s.id) ? 'bg-amber-50 border-amber-200' : 'bg-slate-50 border-slate-100'}`}>
            <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
              <Clock size={12} style={{ color: 'var(--accent)' }} /> {fmt(s.start_time)} – {fmt(s.end_time)}
            </span>
            <button onClick={() => onAskDelete(s)} aria-label={`Remove ${fmt(s.start_time)} to ${fmt(s.end_time)}`}
                    className="min-h-8 min-w-8 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={12} /></button>
          </div>
        ))}
      </div>
      {adding && <AddRangeForm dayIndex={dayIndex} existing={mine} onCancel={() => setAdding(false)}
                               onSaved={() => { setAdding(false); onAdded(); }} />}
    </div>
  );
}

function DateChanges({ onChanged }) {
  const [rows, setRows] = useState([]);
  const [date, setDate] = useState('');
  const [kind, setKind] = useState('off');
  const [partDay, setPartDay] = useState(false);   // Not free: part of the day
  const [start, setStart] = useState('16:00');
  const [end, setEnd] = useState('18:00');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const load = useCallback(() => {
    achieverApi.get('/achiever-availability/my-dates')
      .then(({ data }) => { if (data.bool) setRows(data.response.dates || []); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!date) { setError('Pick a date.'); return; }
    const timed = kind === 'extra' || partDay;
    if (timed && toMins(end) - toMins(start) < 15) { setError('The time must be at least 15 minutes.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await achieverApi.post('/achiever-availability/my-dates',
        { date, kind, ...(timed ? { start_time: start, end_time: end } : {}) });
      if (data.bool) { toast.success(data.response.message || 'Saved'); setDate(''); load(); onChanged(); }
      else setError(data.response?.message || 'Could not save.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };
  const remove = async (r) => {
    try {
      const { data } = await achieverApi.delete(`/achiever-availability/my-dates/${r.id}`);
      if (data.bool) { toast.success('Removed'); load(); onChanged(); }
    } catch { toast.error('Could not remove it'); }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
      <h3 className="text-sm font-bold text-slate-900">One-off changes</h3>
      <p className="text-xs text-slate-500 mt-0.5">Changes for one date only. Your weekly hours stay as they are.</p>
      <details className="mt-3 mb-4 rounded-xl border border-slate-200 group">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold flex items-center justify-between"
                 style={{ color: 'var(--accent)' }}>
          How one-off changes work
          <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▾</span>
        </summary>
      <ul className="px-4 pb-3 space-y-1.5 text-xs text-slate-600 leading-relaxed">
        <li><b>Not free · Whole day</b> — no bookings on that date (for example, travel or leave).</li>
        <li><b>Not free · Part of the day</b> — blocks only the time you set (for example, a meeting from 7:00 to 8:00 PM).</li>
        <li><b>Extra hours</b> — opens time on a date you are not normally free (for example, Sunday 10:00 AM to 12:00 PM).</li>
        <li><b>Already booked?</b> Sessions booked before the change still go ahead. If you cannot attend, cancel them in <i>Bookings</i>; the student receives a full refund.</li>
        <li><b>🗑</b> removes a change, and your weekly hours apply again for that date.</li>
      </ul>
      </details>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Date <span className="text-red-500">*</span></label>
          <DatePicker value={date} onChange={setDate} min={todayIso()} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Change</label>
          <div className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100" role="group" aria-label="Change">
            {[['off', 'Not free'], ['extra', 'Extra hours']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setKind(k)}
                      className={`min-h-9 rounded-lg text-xs font-semibold ${kind === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>
      {kind === 'off' && (
        <div className="mt-3 grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 max-w-xs" role="group" aria-label="Not free for">
          {[[false, 'Whole day'], [true, 'Part of the day']].map(([v, l]) => (
            <button key={l} type="button" onClick={() => setPartDay(v)}
                    className={`min-h-9 rounded-lg text-xs font-semibold ${partDay === v ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
          ))}
        </div>
      )}
      {(kind === 'extra' || partDay) && <div className="mt-3"><TimeRange start={start} end={end} setStart={setStart} setEnd={setEnd} /></div>}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      <button onClick={add} disabled={saving}
              className="mt-4 w-full sm:w-auto min-h-11 px-5 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}>
        {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add change
      </button>

      {rows.length > 0 && (
        <div className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 py-2.5">
              {r.kind === 'off' ? <CalendarOff size={15} className="text-red-500 shrink-0" /> : <CalendarPlus size={15} className="text-emerald-600 shrink-0" />}
              <span className="text-sm font-semibold text-slate-700">{dayLabel(r.date)}</span>
              <span className="text-xs text-slate-500 min-w-0 truncate">
                {r.kind === 'off'
                  ? (r.start_time ? `Not free ${fmt(r.start_time)} – ${fmt(r.end_time)}` : 'Not free (whole day)')
                  : `Extra ${fmt(r.start_time)} – ${fmt(r.end_time)}`}
              </span>
              <button onClick={() => remove(r)} aria-label="Remove change"
                      className="ml-auto min-h-8 min-w-8 flex items-center justify-center rounded text-slate-300 hover:text-red-500 hover:bg-red-50"><Trash2 size={13} /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ═══ Page ═════════════════════════════════════════════════════════════════ */
export default function AchieverAvailability() {
  const [tab, setTab] = useState('offerings');
  const [ranges, setRanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [confirmRange, setConfirmRange] = useState(null);
  const [sum, setSum] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true); setFailed(false);
    achieverApi.get('/achiever-availability/my-availability')
      .then(({ data }) => { if (data.bool) setRanges(data.response.availability || []); else setFailed(true); })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  const loadSum = useCallback(() => {
    achieverApi.get('/achiever-availability/my-summary')
      .then(({ data }) => { if (data.bool) setSum(data.response); })
      .catch(() => {});
  }, []);
  useEffect(() => { load(); loadSum(); }, [load, loadSum]);

  const conflicts = useMemo(() => findConflicts(ranges), [ranges]);
  const nextWhen = sum?.next_session ? new Date(sum.next_session) : null;

  const deleteRange = async (r) => {
    setConfirmRange(null);
    try {
      const { data } = await achieverApi.delete(`/achiever-availability/my-availability/${r.id}`);
      if (data?.bool === false) toast.error(data.response?.message || 'Could not remove those hours');
      else toast.success('Hours removed');
      load(); loadSum();
    } catch { toast.error('Could not remove those hours'); }
  };

  return (
    <div>
      {confirmRange && (
        <ConfirmModal danger
          message={`Remove ${DAYS[confirmRange.day_of_week]} ${fmt(confirmRange.start_time)} – ${fmt(confirmRange.end_time)}?`}
          detail="Students can't book these hours any more. Sessions already booked still happen."
          confirmLabel="Remove hours" onCancel={() => setConfirmRange(null)} onConfirm={() => deleteRange(confirmRange)} />
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Availability</h1>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <StatTile label="1-on-1s" icon={BookOpen} tone="blue" value={sum ? sum.offerings : '—'}
                  sub={sum ? `published · ${+Number(sum.weekly_hours || 0).toFixed(2)} hrs a week` : 'published'}
                  onClick={() => setTab('offerings')} active={tab === 'offerings'} />
        <StatTile label="Booked" icon={Check} tone="violet" value={sum ? sum.booked : '—'} sub="upcoming sessions" />
        <StatTile label="Next session" icon={Clock} tone="amber"
                  value={nextWhen ? nextWhen.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }) : 'None'}
                  sub={nextWhen ? nextWhen.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : 'no bookings yet'} />
        <StatTile label="Expected earnings" icon={IndianRupee} tone="emerald" value={sum ? money(sum.earnings) : '—'}
                      sub={sum && sum.commission_rate != null ? `after ${+(sum.commission_rate * 100).toFixed(2)}% SKOVO fee` : 'after SKOVO fee'} />
      </div>

      <Tabs active={tab} onChange={setTab} className="mb-4" tabs={[
        { key: 'offerings', label: 'My 1-on-1s', icon: BookOpen },
        { key: 'hours', label: 'My hours', icon: Repeat },
      ]} />

      {tab === 'offerings' ? (
        <OfferingsTab onChanged={loadSum} ranges={loading ? null : ranges} onGoHours={() => setTab('hours')} />
      ) : loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 7 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : failed ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <ErrorState title="We couldn't load your hours" subtitle="Your hours are safe — this is a connection problem." onRetry={load} />
        </div>
      ) : (
        <div className="space-y-5">
          <p className="text-xs text-slate-500 leading-relaxed">
            When you are free, <b>every week</b>. Your 1-on-1s are offered only inside these hours, never over a cohort
            or another booking.
          </p>
          {/* The core idea of 1-on-1s, in plain words, before anyone sets hours. */}
          <details className="rounded-xl border border-slate-200 bg-white group" open={ranges.length === 0}>
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-semibold flex items-center justify-between"
                     style={{ color: 'var(--accent)' }}>
              How your hours work
              <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▾</span>
            </summary>
            <ol className="px-5 pb-4 space-y-2 text-xs text-slate-600 leading-relaxed list-decimal list-inside">
              <li><b>Weekly hours.</b> Add the times you are free on each day, for example Monday 6:00 PM to 9:00 PM. They repeat every week until you remove them.</li>
              <li><b>How students see them.</b> SKOVO offers start times every 30 minutes inside your hours, sized to each 1-on-1. With Monday 6:00 to 9:00 PM, a 30-minute session can start between 6:00 and 8:30 PM; a 1-hour session between 6:00 and 8:00 PM.</li>
              <li><b>No double booking.</b> Once a student books a time, it is blocked for all your 1-on-1s. A time is also never offered if it overlaps one of your cohorts.</li>
              <li><b>Booking window.</b> Students can book up to 4 weeks ahead and until 10 minutes before a start time. Short-notice bookings reach you as an urgent alert, so keep notifications on during your hours. If you will not be available, mark the time as <i>Not free</i> in advance.</li>
              <li><b>One-off changes.</b> Use <i>Not free</i> to block a whole date or part of it (for example 7:00 to 8:00 PM), or <i>Extra hours</i> to open time on one date only. Your weekly hours stay as they are.</li>
              <li><b>Changing hours.</b> Removing or changing hours stops new bookings in that time. Sessions already booked go ahead as scheduled.</li>
            </ol>
          </details>
          {conflicts.size > 0 && (
            <div className="flex items-start gap-2.5 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
              <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">Some ranges overlap on the same day. Remove one of them.</p>
            </div>
          )}
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {DAYS.map((_, i) => (
              <DayCard key={i} dayIndex={i} ranges={ranges} conflicts={conflicts} onAskDelete={setConfirmRange}
                       onAdded={() => { toast.success('Hours added'); load(); loadSum(); }} />
            ))}
          </div>
          <DateChanges onChanged={loadSum} />
        </div>
      )}
    </div>
  );
}
