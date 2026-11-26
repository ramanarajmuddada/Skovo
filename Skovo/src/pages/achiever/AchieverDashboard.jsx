import React, { useEffect, useMemo, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { useNavigate } from 'react-router-dom';
import {
  Wallet, BadgeIndianRupee, Lock, PieChart, CalendarCheck, CheckCircle,
  Users, ArrowUpRight, ArrowDownRight, TrendingUp, Sparkles,
  Plus, Clock, Ticket, Tag, Eye, UserRound, Gauge,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { achieverApi } from '../../services/api';
import LifecycleBanner from '../../components/achiever/LifecycleBanner';
import { DateRange, defaultRange } from '../../components/ui/index.jsx';

/* ── Palette ──────────────────────────────────────────────────────────────────
 * Slots 1–3 of the validated categorical order, assigned in fixed order and
 * never cycled, so a source keeps its colour when another drops to zero.
 * Verified against this page's own white surface:
 *   node scripts/validate_palette.js "#2a78d6,#eb6834,#1baf7a" \
 *        --mode light --surface "#ffffff"
 * All checks pass. Aqua warns under 3:1, answered by direct labels on every
 * donut segment and a legend entry on every line.
 *
 * Colour appears on this page only where it encodes data. The KPI cards carry a
 * single muted accent instead of four different tints — four coloured cards make
 * every tile look equally urgent, which is the same as none of them being.
 */
const SERIES = [
  { key: 'cohorts',  label: 'Cohorts',  color: '#2a78d6' },
  // v1-hidden: { key: 'courses',  label: 'Courses',  color: '#eb6834' },
  { key: 'sessions', label: 'Sessions', color: '#1baf7a' },
];
const INK = { grid: '#eef1f5', axis: '#94a3b8' };

const fmtRange = ({ from, to }) => {
  const d = (s) => new Date(s + 'T00:00:00');
  const opt = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${d(from).toLocaleDateString('en-IN', opt)} – ${d(to).toLocaleDateString('en-IN', opt)}`;
};

// One money formatter for the page, matching the rest of the portal: en-IN
// grouping (1,21,450 not 121,450) and a ₹ prefix.
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;  // never rounded: Rs 4.50 stays 4.50
const short = (n) => (n >= 1000 ? `₹${(n / 1000).toFixed(n % 1000 ? 1 : 0)}K` : `₹${n}`);

/* ── Empty state ──────────────────────────────────────────────────────────────
 * A chart with no data must not render axes and an empty plot area — that reads
 * as "broken", not as "nothing yet". It gets a written explanation instead.
 */
function Empty({ icon: Icon, title, body, className = '' }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center px-6 ${className}`}>
      <div className="w-11 h-11 rounded-xl bg-slate-100 flex items-center justify-center mb-3">
        <Icon size={19} className="text-slate-400" />
      </div>
      <p className="text-sm font-semibold text-slate-700">{title}</p>
      <p className="text-xs text-slate-500 mt-1 max-w-60 leading-relaxed">{body}</p>
    </div>
  );
}

/* ── Line chart ───────────────────────────────────────────────────────────────
 * Cumulative, not daily. Daily earnings for an achiever are mostly zero with a
 * few spikes — a chart of that is a flat line with teeth, and says nothing about
 * how the business is going. The running total answers the question the reader
 * actually has: is this growing, and how fast.
 *
 * One y-axis, always. Two scales on one chart is the single most misread form.
 */
function EarningsChart({ series }) {
  const [hover, setHover] = useState(null);
  const W = 620, H = 232, PAD = { l: 46, r: 16, t: 14, b: 28 };

  const cum = useMemo(() => {
    const run = { cohorts: 0, courses: 0, sessions: 0 };
    return (series || []).map((d) => {
      SERIES.forEach((s) => { run[s.key] += Number(d[s.key] || 0); });
      return { date: d.date, ...run };
    });
  }, [series]);

  const max = Math.max(1, ...cum.map((d) => Math.max(d.cohorts, d.courses, d.sessions)));
  const x = (i) => PAD.l + (i / Math.max(cum.length - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);

  // De-duplicated: a small max rounds [0, .5, 1]×max to repeated values, and a
  // two-point series collapses labelAt to [0, 1, 1]. Repeats are harmless to
  // look at but give React duplicate keys.
  const ticks = [...new Set([0, 0.5, 1].map((f) => Math.round(max * f)))];
  const labelAt = [...new Set([0, Math.floor(cum.length / 2), cum.length - 1])];
  const fmtDay = (iso) =>
    new Date(iso + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
           aria-label="Cumulative earnings by source"
           onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(t)} y2={y(t)} stroke={INK.grid} strokeWidth="1" />
            <text x={PAD.l - 10} y={y(t) + 4} textAnchor="end" fontSize="10" fill={INK.axis}>{short(t)}</text>
          </g>
        ))}

        {labelAt.map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill={INK.axis}>
            {fmtDay(cum[i].date)}
          </text>
        ))}

        {SERIES.map((s) => (
          <polyline
            key={s.key}
            fill="none" stroke={s.color} strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round"
            points={cum.map((d, i) => `${x(i)},${y(d[s.key])}`).join(' ')}
          />
        ))}

        {hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={PAD.t} y2={H - PAD.b}
                  stroke={INK.axis} strokeWidth="1" strokeDasharray="3 3" />
            {SERIES.map((s) => (
              // 2px surface ring so overlapping markers stay readable.
              <circle key={s.key} cx={x(hover)} cy={y(cum[hover][s.key])} r="4"
                      fill={s.color} stroke="#fff" strokeWidth="2" />
            ))}
          </g>
        )}

        {/* Wide invisible bands: the hit target is bigger than the mark. */}
        {cum.map((_, i) => (
          <rect key={i} x={x(i) - (W / cum.length) / 2} y={0}
                width={W / cum.length} height={H} fill="transparent"
                onMouseEnter={() => setHover(i)} />
        ))}
      </svg>

      {hover !== null && (
        <div className="absolute top-2 right-2 bg-white border border-slate-200 rounded-xl shadow-lg px-3 py-2 pointer-events-none">
          <p className="text-[11px] font-bold text-slate-900">{fmtDay(cum[hover].date)}</p>
          {SERIES.map((s) => (
            <p key={s.key} className="text-[11px] text-slate-600 flex items-center gap-2 mt-1">
              <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: s.color }} />
              {s.label}
              <span className="ml-auto font-bold text-slate-900">{inr(cum[hover][s.key])}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Donut ────────────────────────────────────────────────────────────────── */
function SourceDonut({ parts, total }) {
  const C = 2 * Math.PI * 45;
  const GAP = parts.length > 1 ? 3 : 0;   // the 2px surface gap, in user units
  let cursor = 0;

  return (
    <svg viewBox="0 0 120 120" className="w-36 h-36 shrink-0" role="img"
         aria-label={`Earnings split: ${parts.map((p) => `${p.label} ${inr(p.value)}`).join(', ')}`}>
      {parts.map((p) => {
        const len = Math.max((p.value / total) * C - GAP, 0.5);
        const el = (
          <circle key={p.label} cx="60" cy="60" r="45" fill="none"
                  stroke={p.color} strokeWidth="17"
                  strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-cursor}
                  transform="rotate(-90 60 60)" />
        );
        cursor += (p.value / total) * C;
        return el;
      })}
      <text x="60" y="57" textAnchor="middle" className="fill-slate-900" fontSize="15" fontWeight="800">
        {short(total)}
      </text>
      <text x="60" y="71" textAnchor="middle" fill={INK.axis} fontSize="7" fontWeight="700">
        NET EARNED
      </text>
    </svg>
  );
}

/* ── Cards ────────────────────────────────────────────────────────────────────
 * One card shape for money and counts alike. `delta` renders only when the API
 * returned a real comparison: `change_pct` is null when the previous period had
 * no earnings, and a percentage against zero is not a fact.
 */
const CARD = 'bg-white rounded-2xl border border-slate-200 p-4 sm:p-5';

const TONE_OF = { blue: 'blue', sky: 'blue', indigo: 'violet', violet: 'violet', emerald: 'emerald', amber: 'amber' };

function StatCard({ icon, label, value, note, delta, accent = 'text-blue-600', unavailable = false, busy = false }) {
  if (busy) {
    const t = TONE_OF[(accent.match(/text-(\w+)-/) || [])[1]] || 'blue';
    return <StatTile label={label} icon={icon} tone={t} sub="Updating…"
                     value={<span className="inline-block h-7 w-20 rounded-lg bg-slate-200 animate-pulse align-middle" aria-label="Loading" />} />;
  }
  const hasDelta = !unavailable && typeof delta === 'number' && Number.isFinite(delta);
  const tone = TONE_OF[(accent.match(/text-(\w+)-/) || [])[1]] || 'blue';
  // A % change is not a count, so it rides in the note line rather than
  // StatTile's count delta.
  const sub = unavailable ? "Couldn't load — refresh"
    : hasDelta ? `${delta >= 0 ? "▲" : "▼"} ${Math.abs(delta)}% vs before` : note;
  return <StatTile label={label} value={unavailable ? '—' : value} icon={icon} tone={tone} sub={sub} />;
}

const STATUS_STYLE = {
  pending:   'bg-amber-100 text-amber-700',
  confirmed: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-700',
  rejected:  'bg-red-100 text-red-700',
};

// Each carries the screen key the lifecycle gates on. Without it the panel
// offered "Create cohort" to an achiever whose sidebar has no
// Cohorts entry and whose route guard sends them straight back -- a shortcut to
// a door that is locked.
const ACTIONS = [
  { key: 'cohorts',      label: 'Create cohort', to: '/skovo-achiever-portal/cohorts',      icon: Plus,       accent: 'text-blue-600' },
  { key: 'availability', label: 'Availability',  to: '/skovo-achiever-portal/availability', icon: Clock,      accent: 'text-emerald-600' },
  // v1-hidden: { key: 'courses',      label: 'Create course', to: '/skovo-achiever-portal/courses',      icon: BookOpen,   accent: 'text-violet-600' },
  { key: 'earnings',     label: 'Earnings',      to: '/skovo-achiever-portal/earnings',     icon: TrendingUp, accent: 'text-amber-600' },
  { key: 'coupons',      label: 'Offers',        to: '/skovo-achiever-portal/offers',      icon: Ticket,     accent: 'text-rose-600' },
  // v1: Domains screen hidden (picked in Create cohort).
  // { key: 'domains',      label: 'Domains',       to: '/skovo-achiever-portal/domains',      icon: Tag,        accent: 'text-sky-600' },
];

const initials = (name) => (name || 'S').trim().split(/\s+/).slice(0, 2)
  .map((w) => w[0]).join('').toUpperCase();

const fmtWhen = (stamp) => new Date(stamp).toLocaleString('en-IN',
  { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function AchieverDashboard() {
  const navigate = useNavigate();
  // Fetched once by AchieverLayout and passed down, so the sidebar's locks
  // and this banner can never describe different states.
  const { lifecycle } = useOutletContext() || {};
  const [bookings, setBookings] = useState({ bookings: [] });
  const [cohorts,  setCohorts]  = useState([]);
  const [now] = useState(() => Date.now());
  // Active = not cancelled / missed / ended, and the class has not finished yet.
  const activeCohorts = cohorts.filter((c) => {
    if (['cancelled', 'completed'].includes(c.status) || c.missed_at || c.missed) return false;
    const start = c.session_date ? new Date(c.session_date).getTime() : null;
    return !start || start + (Number(c.duration_minutes) || 60) * 60000 > now;
  }).length;
  // v1-hidden: courses
  // const [courses,  setCourses]  = useState([]);
  const [earnings, setEarnings] = useState({});
  const [trend,    setTrend]    = useState(null);
  const [range,    setRange]    = useState(defaultRange);
  const [loading,  setLoading]  = useState(true);
  const [failed,   setFailed]   = useState({});
  const [funnel,   setFunnel]   = useState(null);
  // The range each response was for. Until both match the filter, the
  // period cards show a shimmer instead of the last period's numbers.
  const rangeKey = `${range.from}|${range.to}`;
  const [gotBookings, setGotBookings] = useState('');
  const [gotSeries,   setGotSeries]   = useState('');
  const busyB = gotBookings !== rangeKey;
  const busyS = gotSeries !== rangeKey;

  // Reach, separate from the money. An achiever with no bookings could
  // previously only see ₹0, which does not distinguish "nobody found me" from
  // "everybody bounced off my profile" — and those need opposite fixes.
  useEffect(() => {
    let live = true;
    achieverApi.get('/achievers/portal/funnel', { days: 30 })
      .then(({ data }) => {
        if (!live) return;
        if (data.bool) { setFunnel(data.response); setFailed((f) => ({ ...f, funnel: false })); }
        else setFailed((f) => ({ ...f, funnel: true }));
      })
      // Swallowed before. The Reach row simply vanished, which reads as "you
      // have no reach" rather than "we could not measure it".
      .catch(() => { if (live) setFailed((f) => ({ ...f, funnel: true })); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    let live = true;
    Promise.all([
      // per_page=5 covers the Recent list; the counts come from the response's
      // window tallies, which are computed over the whole range in SQL.
      achieverApi.get('/achievers/portal/bookings',
                      { from: range.from, to: range.to, page: 1, per_page: 5 }),
      achieverApi.get('/achievers/portal/cohorts'),
      achieverApi.get('/achievers/portal/earnings'),
      // v1-hidden: achieverApi.get('/courses/portal/'),
    ]).then(([b, c, e]) => {
      if (!live) return;
      setGotBookings(`${range.from}|${range.to}`);
      if (b.data.bool) setBookings(b.data.response);
      if (c.data.bool) setCohorts(c.data.response.cohorts || []);
      if (e.data.bool) setEarnings(e.data.response);
      // v1-hidden: if (co.data.bool) setCourses(co.data.response.courses || []);
      setFailed((f) => ({
        ...f,
        bookings: !b.data.bool, cohorts: !c.data.bool,
        earnings: !e.data.bool,
        // v1-hidden: courses: !co.data.bool,
      }));
    }).catch(() => {
      if (live) setGotBookings(`${range.from}|${range.to}`);
      if (live) setFailed((f) => ({ ...f, bookings: true, cohorts: true,
                                    earnings: true }));
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // Bookings is window-scoped now, so the range has to re-run this — otherwise
    // the counts would keep describing whichever period was loaded first.
  }, [range.from, range.to]);

  useEffect(() => {
    // Ignore a reply that arrives after the range has moved on again — two quick
    // picks can otherwise land out of order and leave the page showing the older
    // one while the control reads the newer.
    let live = true;
    achieverApi.get('/achievers/portal/earnings/series', { from: range.from, to: range.to })
      .then(({ data }) => {
        if (!live) return;
        setGotSeries(`${range.from}|${range.to}`);
        if (data.bool) { setTrend(data.response); setFailed((f) => ({ ...f, series: false })); }
        else setFailed((f) => ({ ...f, series: true }));
      })
      .catch(() => { if (live) { setGotSeries(`${range.from}|${range.to}`); setFailed((f) => ({ ...f, series: true })); } });
    return () => { live = false; };
  }, [range.from, range.to]);

  // Summed from the same series the chart draws, so the donut and the line can
  // never disagree about the selected period.
  const mix = useMemo(() => {
    const sum = { cohorts: 0, courses: 0, sessions: 0 };
    for (const d of trend?.series || []) SERIES.forEach((x) => { sum[x.key] += Number(d[x.key] || 0); });
    const parts = SERIES
      .map((x) => ({ label: x.label, color: x.color, value: sum[x.key] }))
      .filter((p) => p.value > 0);
    const total = parts.reduce((n, p) => n + p.value, 0);
    // Percentages only where the denominator is real — never a 0/0 "NaN%".
    return { parts: parts.map((p) => ({ ...p, pct: total > 0 ? Math.round((p.value / total) * 100) : null })), total };
  }, [trend]);

  // Counted in SQL over the whole window, not by filtering the handful of rows
  // this page happens to hold — the endpoint returns only the first few.
  //
  // Bookings are events, so they scope to the window. Cohorts and courses are
  // inventory — an achiever running five cohorts still has five of them on a
  // 7-day view, and showing "0" there would read as "you have none". Same reason
  // the balance cards stay current: a balance has no "last 7 days" value.
  const periodBookings = bookings.window_total ?? 0;
  const completed = bookings.completed ?? 0;

  // Already newest-first and range-scoped by the server.
  const recent = bookings.bookings || [];

  // Two conditions, both needed. Enough points to draw a line between, AND some
  // money to draw: 31 days of zeroes is still no history, and rendering axes
  // around a flat baseline reads as broken rather than as "nothing yet".
  const plottable = (trend?.series?.length || 0) >= 2 && mix.total > 0;

  const me = (() => { try { return JSON.parse(localStorage.getItem('achiever_user') || '{}'); } catch { return {}; } })();
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const pendingCount = (bookings.bookings || []).filter((b) => b.status === 'pending').length;
  const shortcuts = ACTIONS.filter((a) => !lifecycle || lifecycle.can(a.key));

  if (loading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-5">
      {/* The visible hero on this screen is a card, by design (see the note
          at the top of the file) — but a page still has to start at heading
          level 1 or a screen-reader user lands mid-outline with nothing above
          them. Hidden visually, announced normally. */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 relative">
        {/* The glow is clipped in its own layer: clipping the card itself cut
            off the date-range menu that opens below the picker. */}
        <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-20 blur-3xl"
               style={{ background: 'var(--accent)' }} />
        </div>
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-400">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 break-words">
              {hello}{me.full_name ? `, ${me.full_name.split(' ')[0]}` : ''} 👋
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {pendingCount ? `${pendingCount} session request${pendingCount === 1 ? '' : 's'} waiting for you.` : 'Nothing is waiting on you right now.'}
            </p>
          </div>
          <div className="w-full md:w-56 shrink-0">
            <DateRange value={range} onChange={setRange} />
          </div>
        </div>
        {/* The places an achiever goes most, one tap away — only the ones
            their lifecycle state has unlocked. */}
        {shortcuts.length > 0 && (
          <div className="relative mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
            {shortcuts.map((a) => (
              <button key={a.label} onClick={() => navigate(a.to)}
                      className="min-h-14 sm:min-h-11 rounded-xl border border-slate-200 px-2 sm:px-3 flex flex-col sm:flex-row items-center justify-center sm:justify-start gap-1 sm:gap-2 text-xs sm:text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50">
                {/* Icon over label on phones, so "Create cohort" is never cut. */}
                <a.icon size={16} className={`${a.accent} shrink-0`} /> <span className="text-center sm:text-left leading-tight">{a.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* State, guidelines and the application checklist come first. A pending
          achiever has no earnings to look at, and what they need on this screen
          is the next step — not an empty chart. */}
      {lifecycle && !lifecycle.loading && <LifecycleBanner lifecycle={lifecycle} />}

      {/* ── Filter bar ────────────────────────────────────────────────────────
        * One range, one row, above everything it governs. Inside the chart card
        * it would read as the chart's own control, while it in fact moves the
        * earnings card, the donut and the booking counts too.
        */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-base font-bold text-slate-900">Overview</h2>
          <p className="text-sm text-slate-500 mt-0.5">
            {fmtRange(range)}
            {busyS ? (
              <span className="text-slate-400"> · updating…</span>
            ) : trend?.days ? (
              <span className="text-slate-400"> · {trend.days} {trend.days === 1 ? 'day' : 'days'}</span>
            ) : null}
          </p>
        </div>
      </div>

      {/* ── Money ─────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard busy={busyS} icon={Wallet} accent="text-blue-600" label="Earned in period"
                  value={inr(trend?.current_earned)} unavailable={failed.series || !trend}
                  delta={trend?.change_pct}
                  note="No earlier data" />
        <StatCard icon={BadgeIndianRupee} accent="text-emerald-600" label="Withdrawable" unavailable={failed.earnings}
                  value={inr(earnings.payout_summary?.available_balance)}
                  note="After payouts" />
        <StatCard icon={Lock} accent="text-amber-600" label="On hold" unavailable={failed.earnings}
                  value={inr(earnings.payout_summary?.in_escrow)}
                  note="Available 24 hrs after class ends" />
        <StatCard busy={busyS} icon={PieChart} accent="text-violet-600" label="Platform fee" unavailable={failed.series || !trend}
                  value={inr(trend?.period_platform_fee)}
                  note="SKOVO's share" />
      </div>

      {/* ── Reach ────────────────────────────────────────────────────────────
        * Deliberately a separate row from the money, and always over a fixed
        * 30 days rather than the range picker: this answers "is anyone finding
        * me", which is a different question from "what did I earn", and mixing
        * the two windows made both harder to read.
        */}
      {/* A failed funnel load used to leave `funnel` null, so the whole Reach
          row vanished - which reads as "you have no reach" rather than "we
          could not measure it". Say which one it is. */}
      {!funnel && failed.funnel && (
        <div>
          <h3 className="text-sm font-bold text-slate-900 mb-2">Reach</h3>
          <div className="bg-white rounded-2xl border border-slate-200 px-5 py-4">
            <p className="text-sm text-slate-500">
              Reach figures are unavailable right now. Your profile views and
              bookings are still being recorded.
            </p>
          </div>
        </div>
      )}

      {funnel && (
        <div>
          <div className="flex items-baseline justify-between mb-2">
            <h3 className="text-sm font-bold text-slate-900">Reach</h3>
            <span className="text-xs text-slate-400">last {funnel.window_days} days</span>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard icon={Eye} accent="text-sky-600" label="Profile views"
                      value={funnel.views}
                      note={`${funnel.lifetime_views} all time`} />
            <StatCard icon={UserRound} accent="text-indigo-600" label="Unique students"
                      value={funnel.unique_viewers}
                      note="Viewed profile" />
            <StatCard icon={CalendarCheck} accent="text-emerald-600" label="Bookings"
                      value={funnel.bookings}
                      note={funnel.view_to_booking_pct !== null
                        ? `${funnel.view_to_booking_pct}% booked`
                        : 'No views yet'} />
            <StatCard icon={Gauge} accent="text-violet-600" label="Quality score"
                      value={funnel.quality_score !== null
                        ? Math.round(funnel.quality_score)
                        : '—'}
                      note={funnel.quality_score !== null
                        ? 'Rating & reliability'
                        : 'After 3 sessions'} />
          </div>
          {funnel.views === 0 && (
            <p className="text-xs text-slate-400 mt-2">
              Nobody has opened your profile yet — share your profile link to bring
              your own students in.
            </p>
          )}
        </div>
      )}

      {/* ── Trend + mix ───────────────────────────────────────────────────── */}
      <div className={`grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4 transition-opacity ${busyS ? 'opacity-40 animate-pulse pointer-events-none' : ''}`}
           aria-busy={busyS}>
        <div className={`${CARD} xl:col-span-2`}>
          <h3 className="font-bold text-slate-900">Earnings overview</h3>
          <p className="text-xs text-slate-500 mt-0.5">Running total, net of platform fee</p>

          {plottable ? (
            <>
              {/* Legend is always present for ≥2 series — identity is never colour alone. */}
              <div className="flex items-center gap-4 mt-3">
                {SERIES.map((s) => (
                  <span key={s.key} className="flex items-center gap-1.5 text-xs text-slate-600">
                    <span className="w-3 h-0.5 rounded" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                ))}
              </div>
              <div className="mt-2">
                <EarningsChart series={trend.series} />
              </div>
            </>
          ) : (
            <Empty icon={TrendingUp} className="h-40"
                   title="Not enough history to chart yet"
                   body="Pick a wider date range, or check back once you have earnings on more than one day." />
          )}
        </div>

        <div className={CARD}>
          <h3 className="font-bold text-slate-900">Earnings source</h3>
          <p className="text-xs text-slate-500 mt-0.5">Selected period</p>

          {mix.total > 0 ? (
            <>
              <div className="flex justify-center my-4">
                <SourceDonut parts={mix.parts} total={mix.total} />
              </div>
              <ul className="space-y-2.5">
                {mix.parts.map((p) => (
                  <li key={p.label} className="flex items-center gap-3 text-sm">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-slate-600">{p.label}</span>
                    <span className="ml-auto font-bold text-slate-900">{inr(p.value)}</span>
                    {p.pct !== null && <span className="text-xs text-slate-400 w-9 text-right">{p.pct}%</span>}
                  </li>
                ))}
              </ul>
              <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100">
                <span className="text-sm text-slate-500">Total net earned</span>
                <span className="font-black text-slate-900">{inr(mix.total)}</span>
              </div>
            </>
          ) : (
            <Empty icon={Sparkles} className="h-40"
                   title="Your earnings journey starts here"
                   body="Complete your first transaction in this period to see where your income comes from." />
          )}
        </div>
      </div>

      {/* ── Activity ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 [&>*:last-child]:col-span-2 md:[&>*:last-child]:col-span-1">
        <StatCard busy={busyB} icon={CalendarCheck} accent="text-blue-600" label="Requests" unavailable={failed.bookings}
                  value={periodBookings} note="In this period" />
        <StatCard busy={busyB} icon={CheckCircle} accent="text-emerald-600" label="Completed" unavailable={failed.bookings}
                  value={completed} note="In this period" />
        <StatCard icon={Users} accent="text-violet-600" label="Active cohorts" unavailable={failed.cohorts}
                  value={activeCohorts} note="Upcoming or live" />
        {/* v1-hidden: Active courses
        <StatCard icon={BookOpen} accent="text-amber-600" label="Active courses" unavailable={failed.courses}
                  value={courses.length} note="Published and on sale" /> */}
      </div>

      {/* ── Recent requests + shortcuts ───────────────────────────────────── */}
      <div className={`transition-opacity ${busyB ? 'opacity-40 animate-pulse pointer-events-none' : ''}`} aria-busy={busyB}>
        <div className={CARD}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-900">Recent session requests</h3>
              <p className="text-xs text-slate-500 mt-0.5">Newest first, in the selected period</p>
            </div>
            <button onClick={() => navigate('/skovo-achiever-portal/bookings')}
                    className="text-sm font-semibold text-blue-600 hover:text-blue-700">
              View all
            </button>
          </div>

          {recent.length ? (
            <ul className="mt-4 divide-y divide-slate-100">
              {recent.map((b) => (
                <li key={b.id}>
                  <button onClick={() => navigate('/skovo-achiever-portal/bookings')}
                          className="w-full flex items-center gap-3 py-3 text-left hover:bg-slate-50/70
                                     rounded-lg px-2 -mx-2 transition-colors">
                    <span className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 font-bold text-xs
                                     flex items-center justify-center shrink-0">
                      {initials(b.student_name)}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-slate-900 truncate">
                        {b.student_name || 'Student'}
                      </span>
                      {b.scheduled_at && (
                        <span className="block text-xs text-slate-500">{fmtWhen(b.scheduled_at)}</span>
                      )}
                    </span>
                    <span className={`ml-auto shrink-0 text-[11px] font-bold px-2.5 py-1 rounded-full
                                      ${STATUS_STYLE[b.status] || 'bg-slate-100 text-slate-600'}`}>
                      {b.status}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty icon={CalendarCheck} className="h-36"
                   title="No session requests yet"
                   body="Publish your availability so students can book time with you." />
          )}
        </div>

      </div>
    </div>
  );
}
