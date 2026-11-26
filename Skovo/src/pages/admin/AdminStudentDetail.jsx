/**
 * One student, everything Skovo v1 knows about them — /skovo-platform-panel-admin/users/:id
 *
 * Six tabs, each loaded on first open from its own stored procedure
 * (admin_users.py -> sp_admin_student_*), so the page opens fast and a slow
 * tab never holds up the others. The tab is in the URL (?tab=), so a link to
 * "this student's Money tab" works.
 *
 *   Profile   who they are, class and stage history
 *   Score     score, rank, Opportunity Hub distance, every point earned, adjust, tasks
 *   Habits    streaks + calendar, buddies, groups, daily goal, quests, monthly challenge
 *   Practice  quizzes, speed rounds, My Mistakes, achievements
 *   Activity  cohorts, 1-on-1 bookings, applications, notifications sent
 *   Money     wallet, plan, payments, refunds, referrals
 */
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, User, Trophy, Flame, Target, CalendarCheck, Wallet, Snowflake, Zap, RotateCcw, GraduationCap, Clock,
  Users, Bell, Check, Plus, Minus, ShieldCheck, Medal,
} from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { StatusBadge, ConfirmModal, Pagination } from '../../components/ui/TableComponents';
import { Button, useToast } from '../../components/ui/index.jsx';
import StudentAvatar from '../../components/admin/StudentAvatar';
import StatTile from '../../components/admin/StatTile';
import { ago } from '../../utils/datetime';

const BASE = '/skovo-platform-panel-admin';
// Opportunity Hub floor (readiness_rules.opportunity_unlock_score, v1 = 60).
// Shown as a distance only; the server is what gates the Hub.
const HUB_FLOOR = 60;

const TABS = [
  { key: 'profile', label: 'Profile', icon: User },
  { key: 'score', label: 'Score', icon: Trophy },
  { key: 'habits', label: 'Habits', icon: Flame },
  { key: 'practice', label: 'Practice', icon: Target },
  { key: 'activity', label: 'Activity', icon: CalendarCheck },
  { key: 'money', label: 'Money', icon: Wallet },
];
const MEDAL = { bronze: '🥉', silver: '🥈', gold: '🥇' };
const DAY_KIND = {
  action: 'bg-orange-500', freeze: 'bg-sky-400', exam: 'bg-violet-400', restore: 'bg-amber-400',
};

/* ── formatting ─────────────────────────────────────────────────────────── */
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const date = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
const words = (v) => (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const list = (v) => (Array.isArray(v) ? v : []);

/* ── small pieces ───────────────────────────────────────────────────────── */
function Section({ title, icon: Icon, children, aside }) {
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        {Icon && <Icon size={16} className="text-slate-400 shrink-0" />}
        <h3 className="text-sm font-bold text-slate-900 flex-1 min-w-0">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Stat({ label, value, tone = 'text-slate-900', sub }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
      <p className={`mt-1 text-lg font-black tabular-nums break-words ${tone}`}>{value ?? '—'}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="py-2 border-b border-slate-100 last:border-0 sm:grid sm:grid-cols-3 sm:gap-3">
      <p className="text-[11px] uppercase tracking-wide text-slate-400 font-medium sm:pt-0.5">{label}</p>
      <p className="mt-0.5 sm:mt-0 sm:col-span-2 text-sm font-semibold text-slate-800 break-all">{value ?? '—'}</p>
    </div>
  );
}

function Bar({ value, max, tone = 'bg-violet-500' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 rounded-full bg-slate-100 overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemax={max}>
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Item({ title, sub, right }) {
  return (
    <li className="flex items-start gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800 break-words">{title}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5 break-words">{sub}</p>}
      </div>
      {right && <div className="shrink-0 text-right">{right}</div>}
    </li>
  );
}

const None = ({ children }) => <p className="text-sm text-slate-400">{children}</p>;
const Pill = ({ children, tone = 'bg-slate-100 text-slate-600' }) => (
  <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full capitalize ${tone}`}>{children}</span>
);

/* Loads one tab's data once; `reload` refetches after a write. */
function useSection(userId, section, active) {
  const [tick, setTick] = useState(0);
  const [got, setGot] = useState({ tick: -1, data: null, failed: false });
  useEffect(() => {
    if (!active || got.tick === tick) return undefined;
    let alive = true;
    api.get(`${BASE}/users/${userId}/dossier/${section}`)
      .then(({ data }) => { if (alive) setGot({ tick, data: data?.bool ? data.response[section] : null, failed: !data?.bool }); })
      .catch(() => { if (alive) setGot({ tick, data: null, failed: true }); });
    return () => { alive = false; };
  }, [userId, section, active, tick, got.tick]);
  const state = { data: got.data, failed: got.failed, loading: active && got.tick !== tick };
  return [state, () => setTick((t) => t + 1)];
}

function Loading({ state, children }) {
  if (state.loading && !state.data) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-100 animate-pulse" />)}</div>;
  }
  if (state.failed) return <None>Could not load this part. Try again in a moment.</None>;
  return state.data ? children(state.data) : null;
}

/* ── Profile ────────────────────────────────────────────────────────────── */
function ProfileTab({ s, summary }) {
  const interests = list(s.career_interests).filter(Boolean).join(', ');
  const join = (sep, ...p) => p.filter(Boolean).join(sep) || '—';
  return (
    <div className="space-y-3">
      <Section title="Contact & account" icon={User}>
        <Row label="Email" value={s.email} />
        <Row label="Phone" value={s.phone} />
        <Row label="Date of birth" value={date(s.date_of_birth)} />
        <Row label="Consent" value={words(s.consent_status)} />
        <Row label="Joined" value={when(s.created_at)} />
        <Row label="Last sign-in" value={`${when(s.last_login_at)}${s.last_login_at ? ` (${ago(s.last_login_at)})` : ''}`} />
        <Row label="Sign-ins" value={s.login_count} />
        <Row label="Location" value={join(', ', s.city, s.state)} />
      </Section>
      <Section title="Education" icon={ShieldCheck}>
        <Row label="Class now" value={summary?.class_label ? `${summary.class_label}${summary.sub_year ? ` · year ${summary.sub_year}` : ''}` : 'Not set'} />
        <Row label="Education" value={words(s.education_level || s.education_category)} />
        <Row label="Board / stream" value={join(' · ', s.board, s.stream)} />
        <Row label="Degree / branch" value={join(' · ', s.degree_type, s.branch)} />
        <Row label="Year" value={s.year_of_study} />
        <Row label="School / college" value={s.school_name || s.college_name} />
        <Row label="Target exam" value={s.exam_target} />
        <Row label="Interests" value={interests || '—'} />
      </Section>
      <Section title="Class history" icon={CalendarCheck}>
        {list(summary?.stages).length === 0 ? <None>No class recorded yet.</None> : (
          <ol className="relative border-l-2 border-slate-100 ml-1.5 space-y-3">
            {list(summary.stages).map((h, i) => (
              <li key={i} className="pl-4 relative">
                <span className={`absolute -left-[7px] top-1.5 w-3 h-3 rounded-full ${h.status === 'active' ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                <p className="text-sm font-semibold text-slate-800">{h.label || words(h.stage_group)}{h.sub_year ? ` · year ${h.sub_year}` : ''}</p>
                <p className="text-xs text-slate-400">
                  {date(h.started_at)} → {h.status === 'active' ? 'now' : date(h.ended_at)}
                  {h.final_score != null && h.status !== 'active' ? ` · ended at score ${h.final_score}` : ''}
                  {h.close_reason ? ` · ${words(h.close_reason)}` : ''}
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  );
}

/* ── Score ──────────────────────────────────────────────────────────────── */
function ScoreTab({ userId, s, summary, onChanged }) {
  const toast = useToast();
  const [events, setEvents] = useState([]);
  const [pg, setPg] = useState({ page: 1, pages: 1, total: 0, per: 10 });
  const [tasks, setTasks] = useState(null);
  const [adjustments, setAdjustments] = useState([]);
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [taskLabel, setTaskLabel] = useState('');
  const [taskPoints, setTaskPoints] = useState('');
  const [busy, setBusy] = useState(false);

  const loadEvents = useCallback((page, per) => {
    api.get(`${BASE}/users/${userId}/points`, { page, per_page: per }).then(({ data }) => {
      if (!data?.bool) return;
      setEvents(data.response.events || []);
      setPg({ page, per, pages: data.pagination?.pages || 1, total: data.pagination?.total || 0 });
    }).catch(() => {});
  }, [userId]);
  const loadTasks = useCallback(() => {
    api.get(`${BASE}/score-rules/students/${userId}/tasks`)
      .then(({ data }) => setTasks(data?.bool ? data.response.tasks || [] : []))
      .catch(() => setTasks([]));
  }, [userId]);
  const loadAdjustments = useCallback(() => {
    api.get(`${BASE}/score-rules/adjust`, { user_id: userId, limit: 5 })
      .then(({ data }) => { if (data?.bool) setAdjustments(data.response.adjustments || []); })
      .catch(() => {});
  }, [userId]);
  useEffect(() => { loadEvents(1, 10); loadTasks(); loadAdjustments(); }, [loadEvents, loadTasks, loadAdjustments]);

  const run = async (fn, ok, after) => {
    setBusy(true);
    try {
      const { data } = await fn();
      if (data?.bool) { toast.success(data.response?.message || ok); after?.(); loadEvents(1, pg.per); loadTasks(); loadAdjustments(); onChanged(); }
      else toast.error(data?.response?.message || 'That did not go through.');
    } catch { toast.error('Connection problem — nothing was changed.'); }
    setBusy(false);
  };
  const applyAdjust = () => {
    const n = parseInt(delta, 10);
    if (!Number.isInteger(n) || n === 0) { toast.error('Enter a whole number that is not 0.'); return; }
    if (!reason.trim()) { toast.error('Add a reason — the student sees it.'); return; }
    run(() => api.post(`${BASE}/score-rules/adjust`, { user_id: userId, delta: n, reason: reason.trim() }),
      'Score adjusted.', () => { setDelta(''); setReason(''); });
  };
  const addTask = () => {
    const pts = parseInt(taskPoints, 10);
    if (!taskLabel.trim()) { toast.error('Name the task.'); return; }
    if (!Number.isInteger(pts) || pts < 1) { toast.error('Points must be a whole number, at least 1.'); return; }
    run(() => api.post(`${BASE}/score-rules/tasks`, { label: taskLabel.trim(), points: pts, scope: 'student', user_id: userId, status: 'active' }),
      'Task assigned.', () => { setTaskLabel(''); setTaskPoints(''); });
  };
  const done = (id) => run(() => api.post(`${BASE}/score-rules/tasks/complete`, { task_id: id, user_id: userId }), 'Marked done.');

  const score = Number(summary?.score ?? s.score ?? 0);
  const label = (e) => (e.event_type === 'admin_adjustment' ? 'Admin adjustment' : e.label);
  const inputCls = 'min-h-11 px-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="space-y-3">
      <Section title="Readiness score" icon={Trophy}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Score" value={score} tone="text-violet-700" />
          <Stat label="Level" value={s.level} />
          <Stat label="Rank in class" value={summary?.class_rank ? `#${summary.class_rank}` : '—'}
                sub={summary?.class_size ? `of ${summary.class_size} in ${summary.class_label}` : undefined} />
          <Stat label="Decay" value={s.decay_points ?? 0} tone="text-amber-600" sub={`Base ${s.base_points ?? 0}`} />
        </div>
        <div className="mt-4">
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span className="font-semibold text-slate-700">Opportunity Hub</span>
            <span className="text-slate-500 tabular-nums">{Math.min(score, HUB_FLOOR)} / {HUB_FLOOR}</span>
          </div>
          <Bar value={score} max={HUB_FLOOR} tone={score >= HUB_FLOOR ? 'bg-emerald-500' : 'bg-violet-500'} />
          <p className="text-xs text-slate-500 mt-1.5">
            {score >= HUB_FLOOR ? 'Unlocked — they can see and apply to opportunities.'
              : `${HUB_FLOOR - score} more points to unlock (needs ${HUB_FLOOR}).`}
          </p>
        </div>
        <p className="text-xs text-slate-400 mt-3">Last points change: {when(summary?.last_points_at)}</p>
      </Section>

      <Section title="Points history" icon={Medal} aside={<span className="text-xs text-slate-400 tabular-nums">{pg.total}</span>}>
        {events.length === 0 ? <None>No points yet.</None> : (
          <ul>
            {events.map((e) => (
              <Item key={e.id} title={label(e)} sub={when(e.occurred_at)}
                    right={<span className={`text-sm font-black tabular-nums ${e.points < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{e.points > 0 ? '+' : ''}{e.points}</span>} />
            ))}
          </ul>
        )}
        {pg.total > pg.per && (
          <Pagination page={pg.page} pages={pg.pages} total={pg.total} perPage={pg.per}
                      onPage={(p) => loadEvents(p, pg.per)} onPerPage={(n) => loadEvents(1, n)} />
        )}
      </Section>

      <Section title="Adjust score" icon={Plus}>
        <div className="flex gap-2">
          <button type="button" onClick={() => setDelta((d) => String((parseInt(d, 10) || 0) - 1))} aria-label="Decrease"
                  className="min-h-11 w-11 rounded-xl border border-slate-200 text-slate-600 flex items-center justify-center shrink-0"><Minus size={15} /></button>
          <input type="number" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="0" aria-label="Points to add or remove"
                 className={`${inputCls} min-w-0 flex-1 text-center tabular-nums`} />
          <button type="button" onClick={() => setDelta((d) => String((parseInt(d, 10) || 0) + 1))} aria-label="Increase"
                  className="min-h-11 w-11 rounded-xl border border-slate-200 text-slate-600 flex items-center justify-center shrink-0"><Plus size={15} /></button>
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason — the student sees this" aria-label="Reason"
               className={`${inputCls} mt-2 w-full`} />
        <Button onClick={applyAdjust} disabled={busy} className="mt-2 w-full">Apply adjustment</Button>
        {adjustments.length > 0 && (
          <ul className="mt-3 pt-2 border-t border-slate-100">
            {adjustments.map((a) => (
              <Item key={a.id} title={a.reason} sub={`${when(a.created_at)}${a.admin_name ? ` · by ${a.admin_name}` : ''}`}
                    right={<span className={`text-sm font-black tabular-nums ${Number(a.delta) < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{Number(a.delta) > 0 ? '+' : ''}{a.delta}</span>} />
            ))}
          </ul>
        )}
      </Section>

      <Section title="Readiness tasks" icon={Check} aside={<span className="text-xs text-slate-400">{tasks ? tasks.length : ''}</span>}>
        {tasks === null ? <None>Loading…</None> : tasks.length === 0 ? <None>No tasks for this student.</None> : (
          <ul>
            {tasks.map((t) => (
              <Item key={t.id} title={t.label}
                    sub={[t.batch_name || (t.scope === 'student' ? 'Only this student' : words(t.scope)), t.submitted && !t.done ? 'proof sent' : null].filter(Boolean).join(' · ')}
                    right={t.done
                      ? <Pill tone="bg-emerald-50 text-emerald-700">done +{t.points}</Pill>
                      : (
                        <button type="button" onClick={() => done(t.id)} disabled={busy}
                                className="min-h-10 px-3 rounded-xl border border-emerald-500/30 text-emerald-600 text-xs font-semibold inline-flex items-center gap-1">
                          <Check size={13} /> Done +{t.points}
                        </button>
                      )} />
            ))}
          </ul>
        )}
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-semibold text-slate-500 mb-2">Give this student a task</p>
          <input value={taskLabel} onChange={(e) => setTaskLabel(e.target.value)} placeholder="What should they do?" aria-label="Task name"
                 className={`${inputCls} w-full`} />
          <div className="mt-2 flex gap-2">
            <input type="number" value={taskPoints} onChange={(e) => setTaskPoints(e.target.value)} placeholder="Points" aria-label="Points"
                   className={`${inputCls} min-w-0 flex-1 tabular-nums`} />
            <Button onClick={addTask} disabled={busy}>Assign</Button>
          </div>
        </div>
      </Section>
    </div>
  );
}

/* ── Habits ─────────────────────────────────────────────────────────────── */
function Calendar({ days }) {
  const kinds = Object.fromEntries(list(days).map((d) => [String(d.day).slice(0, 10), d.kind]));
  const cells = [];
  const today = new Date();
  for (let i = 34; i >= 0; i -= 1) {
    const d = new Date(today); d.setDate(today.getDate() - i);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    cells.push({ k, kind: kinds[k], label: d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) });
  }
  return (
    <div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c) => (
          <div key={c.k} title={`${c.label}: ${c.kind || 'nothing'}`}
               className={`aspect-square rounded-md ${c.kind ? DAY_KIND[c.kind] || 'bg-orange-500' : 'bg-slate-100'}`} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500">
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-orange-500" /> did a task</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-sky-400" /> freeze used</span>
        <span className="inline-flex items-center gap-1"><i className="w-2.5 h-2.5 rounded-sm bg-violet-400" /> exam window</span>
        <span>last 5 weeks</span>
      </div>
    </div>
  );
}

function HabitsTab({ state }) {
  return (
    <Loading state={state}>{(h) => {
      const quests = list(h.quests);
      const doneToday = quests.filter((q) => q.done).length;
      const target = Number(h.challenge_target || 0);
      return (
        <div className="space-y-3">
          <Section title="Career streak" icon={Flame}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
              <Stat label="🔥 Lifetime" value={h.lifetime_current ?? 0} tone="text-orange-600" sub={`best ${h.lifetime_best ?? 0}`} />
              <Stat label="⚡ This class" value={h.stage_current ?? 0} sub={`best ${h.stage_best ?? 0}`} />
              <Stat label="Freezes held" value={h.freezes_held ?? 0} tone="text-sky-600" />
              <Stat label="Kept through" value={h.covered_through ? date(h.covered_through) : '—'} />
            </div>
            <Calendar days={h.days} />
          </Section>

          <Section title="Daily goal" icon={Target}>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <Stat label="Level" value={h.goal_label || 'Default'} sub={h.tasks_per_day ? `${h.tasks_per_day} task(s) a day` : 'never chose one'} />
              <Stat label="Today" value={h.tasks_per_day ? `${Math.min(h.today_tasks, h.tasks_per_day)}/${h.tasks_per_day}` : h.today_tasks} />
              <Stat label="Met this week" value={`${h.goal_days_week}/7`} tone="text-emerald-600" />
              <Stat label="Perfect weeks" value={h.perfect_weeks} sub={`${h.goal_days_total} goal days in all`} />
            </div>
          </Section>

          <Section title="Today's quests" icon={Zap} aside={<span className="text-xs text-slate-400">{h.quests_done_total} done in all</span>}>
            {quests.length === 0 ? <None>No quests today. Quests go to students active in the last 14 days.</None> : (
              <ul className="space-y-3">
                {quests.map((q, i) => (
                  <li key={i}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className="flex-1 min-w-0 font-semibold text-slate-800 break-words">{q.done ? '✅ ' : ''}{q.label}</span>
                      <Pill>{q.difficulty}</Pill>
                      <span className="text-xs tabular-nums text-slate-500">{Math.min(q.progress, q.target)}/{q.target}</span>
                    </div>
                    <div className="mt-1.5"><Bar value={q.progress} max={q.target} tone={q.done ? 'bg-emerald-500' : 'bg-violet-500'} /></div>
                  </li>
                ))}
                <li className="text-xs text-slate-400">{doneToday} of {quests.length} done today</li>
              </ul>
            )}
          </Section>

          <Section title="Monthly challenge" icon={Medal}>
            {h.challenge_label ? (
              <>
                <div className="flex items-center justify-between text-sm mb-1.5">
                  <span className="font-semibold text-slate-800 min-w-0 break-words">{h.challenge_label}</span>
                  <span className="text-xs tabular-nums text-slate-500 shrink-0 ml-2">{Math.min(h.challenge_done, target)}/{target}</span>
                </div>
                <Bar value={Number(h.challenge_done)} max={target} tone={h.challenge_done >= target ? 'bg-emerald-500' : 'bg-amber-500'} />
                <p className="text-xs text-slate-500 mt-1.5">Badge: {h.challenge_badge || '—'}</p>
              </>
            ) : <None>No challenge set for this month.</None>}
            {list(h.badges).length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {list(h.badges).map((b) => <Pill key={b.month} tone="bg-amber-50 text-amber-700">🏅 {b.badge || b.month}</Pill>)}
              </div>
            )}
          </Section>

          <Section title="Buddies & groups" icon={Users}>
            {list(h.buddies).length === 0 && list(h.groups).length === 0 && <None>No buddy or group streaks.</None>}
            <ul>
              {list(h.buddies).map((b) => (
                <Item key={b.id} title={`🤝 ${b.name || 'Waiting for a buddy'}`}
                      sub={b.status === 'pending' ? 'Invite not accepted yet' : `best ${b.best} days`}
                      right={<span className="text-sm font-black text-orange-600 tabular-nums">{b.current} 🔥</span>} />
              ))}
              {list(h.groups).map((g) => (
                <Item key={g.id} title={`👥 ${g.name}`}
                      sub={`${g.members} member(s) · ${g.status === 'forming' ? 'still forming' : `best ${g.best} days`}`}
                      right={<span className="text-sm font-black text-orange-600 tabular-nums">{g.current} 🔥</span>} />
              ))}
            </ul>
          </Section>
        </div>
      );
    }}</Loading>
  );
}

/* ── Practice ───────────────────────────────────────────────────────────── */
function PracticeTab({ state }) {
  return (
    <Loading state={state}>{(p) => (
      <div className="space-y-3">
        <Section title="Quizzes" icon={Target}>
          <div className="grid grid-cols-3 gap-2 mb-3">
            <Stat label="Taken" value={p.quizzes_taken} />
            <Stat label="Average" value={p.quiz_avg != null ? `${p.quiz_avg}%` : '—'} />
            <Stat label="Best" value={p.quiz_best != null ? `${Math.round(p.quiz_best)}%` : '—'} tone="text-emerald-600" />
          </div>
          {list(p.quizzes).length === 0 ? <None>No quizzes yet.</None> : (
            <ul>
              {list(p.quizzes).map((q, i) => (
                <Item key={i} title={q.title || 'Quiz'} sub={[q.cohort, date(q.at)].filter(Boolean).join(' · ')}
                      right={<span className={`text-sm font-black tabular-nums ${Number(q.percent) >= 60 ? 'text-emerald-600' : 'text-amber-600'}`}>{q.percent != null ? `${Math.round(q.percent)}%` : '—'}</span>} />
              ))}
            </ul>
          )}
        </Section>
        <div className="grid sm:grid-cols-2 gap-3">
          <Section title="Speed practice" icon={Zap}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Rounds" value={p.speed_rounds} />
              <Stat label="Last played" value={p.speed_last ? date(p.speed_last) : '—'} />
            </div>
          </Section>
          <Section title="My Mistakes" icon={RotateCcw}>
            <div className="grid grid-cols-3 gap-2">
              <Stat label="Due" value={p.mistakes_due} tone="text-rose-600" />
              <Stat label="Open" value={p.mistakes_open} />
              <Stat label="Cleared" value={p.mistakes_cleared} tone="text-emerald-600" />
            </div>
          </Section>
        </div>
        <Section title="Achievements" icon={Medal}>
          {list(p.achievements).length === 0 ? <None>No badges yet.</None> : (
            <div className="flex flex-wrap gap-2">
              {list(p.achievements).map((a) => (
                <span key={`${a.key}-${a.tier}`} title={date(a.at)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-semibold text-slate-800">
                  {MEDAL[a.tier] || '🏆'} {a.label || words(a.key)}
                </span>
              ))}
            </div>
          )}
        </Section>
      </div>
    )}</Loading>
  );
}

/* ── Activity ───────────────────────────────────────────────────────────── */
function ActivityTab({ s, state }) {
  return (
    <div className="space-y-3">
      <Section title="At a glance" icon={CalendarCheck}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Stat label="Cohorts joined" value={s.cohorts_joined} />
          <Stat label="1-on-1 booked" value={s.sessions_booked} sub={`${s.sessions_completed ?? 0} done`} />
          <Stat label="Applied" value={s.applied} sub={`${s.shortlisted ?? 0} shortlisted`} />
          <Stat label="Documents" value={s.documents} />
          <Stat label="Communities" value={s.communities} />
          <Stat label="Reviews" value={s.reviews_written} />
          <Stat label="Support issues" value={s.support_issues} />
        </div>
      </Section>
      <Loading state={state}>{(a) => (
        <>
          <Section title="Cohorts" icon={Users}>
            {list(a.cohorts).length === 0 ? <None>No cohorts joined.</None> : (
              <ul>{list(a.cohorts).map((c, i) => (
                <Item key={i} title={c.title} sub={`${date(c.session_date)} · ${words(c.payment)}${c.attended ? ' · attended' : ''}`}
                      right={<StatusBadge status={c.status} />} />
              ))}</ul>
            )}
          </Section>
          <Section title="1-on-1 bookings" icon={User}>
            {list(a.bookings).length === 0 ? <None>No bookings.</None> : (
              <ul>{list(a.bookings).map((b, i) => (
                <Item key={i} title={b.mentor || 'Mentor'} sub={`${when(b.at)} · ${b.amount ? rupees(b.amount) : 'free'}`}
                      right={<StatusBadge status={b.status} />} />
              ))}</ul>
            )}
          </Section>
          <Section title="Applications" icon={ShieldCheck}>
            {list(a.applications).length === 0 ? <None>No applications.</None> : (
              <ul>{list(a.applications).map((o, i) => (
                <Item key={i} title={o.title || 'Opportunity'} sub={[o.company, date(o.at)].filter(Boolean).join(' · ')}
                      right={<Pill>{words(o.status)}</Pill>} />
              ))}</ul>
            )}
          </Section>
          <Section title="Notifications sent" icon={Bell}>
            {list(a.notifications).length === 0 ? <None>Nothing sent yet.</None> : (
              <ul>{list(a.notifications).map((n, i) => (
                <Item key={i} title={n.title} sub={`${n.body ? `${n.body} · ` : ''}${when(n.at)}`}
                      right={n.read ? <Pill tone="bg-emerald-50 text-emerald-700">read</Pill> : <Pill>unread</Pill>} />
              ))}</ul>
            )}
          </Section>
        </>
      )}</Loading>
    </div>
  );
}

/* ── Money ──────────────────────────────────────────────────────────────── */
function MoneyTab({ s, state }) {
  return (
    <Loading state={state}>{(m) => (
      <div className="space-y-3">
        <Section title="Wallet & plan" icon={Wallet}>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Wallet" value={rupees(Number(m.wallet_refund) + Number(m.wallet_bonus))}
                  sub="refund money" tone="text-emerald-600" />
            <Stat label="Plan" value={words(s.plan || 'free')} sub={s.plan_expires_at ? `until ${date(s.plan_expires_at)}` : undefined} />
            <Stat label="Paid in all" value={rupees(s.amount_paid)} sub={`${s.invoices ?? 0} invoice(s)`} />
            <Stat label="Referrals" value={s.referrals_made ?? 0} sub={`${s.referrals_rewarded ?? 0} rewarded`} />
          </div>
        </Section>
        <Section title="Payments" icon={Wallet}>
          {list(m.orders).length === 0 ? <None>No payments.</None> : (
            <ul>{list(m.orders).map((o) => (
              <Item key={o.order_no} title={`${words(o.kind)} · ${o.order_no}`}
                    sub={`${when(o.at)}${Number(o.discount) ? ` · discount ${rupees(o.discount)}` : ''}${Number(o.refunded) ? ` · refunded ${rupees(o.refunded)}` : ''}`}
                    right={<><p className="text-sm font-black tabular-nums">{rupees(o.gross)}</p><StatusBadge status={o.status} /></>} />
            ))}</ul>
          )}
        </Section>
        <Section title="Refunds" icon={RotateCcw}>
          {list(m.refunds).length === 0 ? <None>No refunds.</None> : (
            <ul>{list(m.refunds).map((r, i) => (
              <Item key={i} title={`${rupees(r.amount)} · ${r.order_no}`} sub={`${when(r.at)} · to ${words(r.destination)}`}
                    right={<StatusBadge status={r.status} />} />
            ))}</ul>
          )}
        </Section>
        <Section title="Wallet history" icon={Snowflake}>
          {list(m.ledger).length === 0 ? <None>No wallet movements.</None> : (
            <ul>{list(m.ledger).map((l, i) => (
              <Item key={i} title={l.reason || words(l.kind)} sub={`${words(l.kind)} · ${when(l.at)}`}
                    right={<span className={`text-sm font-black tabular-nums ${Number(l.amount) < 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{Number(l.amount) > 0 ? '+' : ''}{rupees(l.amount)}</span>} />
            ))}</ul>
          )}
        </Section>
        {list(m.plans).length > 0 && (
          <Section title="Plan history" icon={ShieldCheck}>
            <ul>{list(m.plans).map((p, i) => (
              <Item key={i} title={`${words(p.plan)} · ${rupees(p.amount)}`} sub={`${date(p.started_at)} → ${date(p.expires_at)}`}
                    right={<StatusBadge status={p.status} />} />
            ))}</ul>
          </Section>
        )}
      </div>
    )}</Loading>
  );
}

/* ── Page ───────────────────────────────────────────────────────────────── */
export default function AdminStudentDetail() {
  const { id } = useParams();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = TABS.some((t) => t.key === sp.get('tab')) ? sp.get('tab') : 'profile';
  const [s, setS] = useState(null);
  const [failed, setFailed] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const loadMain = useCallback(() => {
    api.get(`${BASE}/users/${id}/dossier`)
      .then(({ data }) => { if (data?.bool) setS(data.response.student); else setFailed(true); })
      .catch(() => setFailed(true));
  }, [id]);
  useEffect(() => { loadMain(); }, [loadMain]);

  const [summary, reloadSummary] = useSection(id, 'summary', true);
  const [habits] = useSection(id, 'habits', tab === 'habits');
  const [practice] = useSection(id, 'practice', tab === 'practice');
  const [activity] = useSection(id, 'activity', tab === 'activity');
  const [money] = useSection(id, 'money', tab === 'money');

  const setTab = (k) => setSp((prev) => { const n = new URLSearchParams(prev); n.set('tab', k); return n; }, { replace: true });

  const toggle = async () => {
    setConfirm(false);
    const next = s.status === 'active' ? 'blocked' : 'active';
    try {
      const { data } = await api.patch(`${BASE}/users/${id}/status`, { status: next });
      if (data?.bool) { toast.success(next === 'blocked' ? 'Student blocked' : 'Student unblocked'); loadMain(); }
      else toast.error(data?.response?.message || 'Could not change status.');
    } catch { toast.error('Could not change status.'); }
  };

  if (failed) {
    return (
      <div className="p-4 sm:p-6">
        <Link to={`${BASE}/users`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 min-h-11"><ArrowLeft size={16} /> Students</Link>
        <p className="mt-6 text-sm text-slate-500">This student could not be found.</p>
      </div>
    );
  }

  const sum = summary.data;
  return (
    <div className="p-4 sm:p-6 max-w-5xl">
      {confirm && s && (
        <ConfirmModal danger={s.status === 'active'}
                      message={`${s.status === 'active' ? 'Block' : 'Unblock'} "${s.full_name}"?`}
                      detail={s.status === 'active' ? 'They will be signed out and cannot use Skovo until unblocked.' : 'They can sign in and use Skovo again.'}
                      confirmLabel={s.status === 'active' ? 'Block' : 'Unblock'}
                      onConfirm={toggle} onCancel={() => setConfirm(false)} />
      )}

      <Link to={`${BASE}/users`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 min-h-11 mb-2">
        <ArrowLeft size={16} /> Students
      </Link>

      {/* Header: who, and the four numbers an admin looks for first. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-3">
        {!s ? <div className="h-20 animate-pulse" /> : (
          <>
            <div className="flex items-start gap-3">
              <StudentAvatar s={s} size="w-14 h-14 text-lg" />
              <div className="flex-1 min-w-0">
                <h1 className="text-lg font-black text-slate-900 break-words leading-tight">{s.full_name}</h1>
                <p className="text-xs text-slate-400 break-all mt-0.5">{s.email || s.phone || '—'}</p>
                <div className="mt-1.5"><StatusBadge status={s.status || 'active'} /></div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatTile label="Class" value={sum?.class_label || 'Not set'} icon={GraduationCap} tone="blue"
                        sub={sum?.sub_year ? `year ${sum.sub_year}` : undefined} />
              <StatTile label="Score" value={sum?.score ?? s.score ?? 0} icon={Trophy} tone="violet"
                        sub={sum?.class_rank ? `#${sum.class_rank} of ${sum.class_size}` : undefined} />
              <StatTile label="Streak" value={sum?.streak ?? 0} icon={Flame} tone="amber" sub={`best ${sum?.streak_best ?? 0}`} />
              <StatTile label="Last active" value={ago(s.last_login_at)} icon={Clock} tone="emerald" />
            </div>
            <div className="mt-3 flex flex-col sm:flex-row gap-2">
              <button type="button" onClick={() => setConfirm(true)}
                      className={`min-h-11 px-4 rounded-xl border text-sm font-semibold ${
                        s.status === 'active' ? 'border-red-500/30 text-red-500 hover:bg-red-500/10'
                                              : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'}`}>
                {s.status === 'active' ? 'Block student' : 'Unblock student'}
              </button>
            </div>
          </>
        )}
      </div>

      <Tabs className="mb-3" tabs={TABS} active={tab} onChange={setTab} />

      {!s ? null : (
        <div role="tabpanel">
          {tab === 'profile' && <ProfileTab s={s} summary={sum} />}
          {tab === 'score' && <ScoreTab userId={id} s={s} summary={sum} onChanged={() => { loadMain(); reloadSummary(); }} />}
          {tab === 'habits' && <HabitsTab state={habits} />}
          {tab === 'practice' && <PracticeTab state={practice} />}
          {tab === 'activity' && <ActivityTab s={s} state={activity} />}
          {tab === 'money' && <MoneyTab s={s} state={money} />}
        </div>
      )}
    </div>
  );
}
