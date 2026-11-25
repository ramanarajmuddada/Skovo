import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, onScoreChanged } from '../services/api';
import { Card, PageHeader, Badge, Toast, Button, SectionTitle, StudentPage } from '../components/ui/index.jsx';
import { EmptyState, LoadError, ConfirmModal } from '../components/ui/TableComponents';
import { TrendingUp, TrendingDown, Lock, Unlock, PauseCircle, History, Zap, AlertTriangle, ChevronRight } from 'lucide-react';
import ReadinessV21 from '../components/v1/ReadinessV21';
import { useReadinessV21 } from '../components/v1/readinessV21Hooks';

// A rule with points of its own, or one that paid out anyway. Referral points
// are set per Refer & Earn reward, so their rule row says 0 each; without the
// second half a student's score rose with no line explaining why.
const shown = (b) => b.points_each > 0 || b.earned > 0;

/* How a rule earns, in the student's words.
   This used to be a single fallback string, "Every time you do it", shown
   whenever a rule had no per-student cap. A rule that pays once when a
   subscription starts therefore described itself as repeatable -- the opposite
   of what it does. */
function howItPays(a) {
  if (a.remaining_uses) {
    return `${a.remaining_uses} left \u00b7 up to ${a.points_available} points`;
  }
  if (a.rule_test === 'becomes_active') return 'Once, when it starts';
  if (a.rule_test === 'reaches')        return `Once, at ${a.threshold}`;
  if (a.rule_test === 'every')          return `Every ${a.threshold}`;
  return 'Every time you do it';
}

/* One task the student has been given.

   There is no "I've done this" button, on purpose.

   It used to need two taps by two people: the student claimed, then an admin
   approved. That does not survive 10,000 students -- the admin cannot read
   10,000 claims, and, worse, the student who actually did the work but never
   tapped went unpaid and had no way to know why. The tap earned them nothing
   on its own, so plenty of them skipped it.

   Now the platform checks. sp_score_task_autopay measures the task's metric and
   credits the student the moment it is met -- in the same second they upload,
   or overnight at the latest. The row's job is only to say what to do and to
   take them where the work happens.

   A task with no metric behind it cannot pay itself. It shows as "Skovo will
   check" rather than pretending to be automatic, because the honest answer is
   that a human has to look at that one. */
function TaskRow({ task }) {
  const navigate = useNavigate();
  const expired = task.status === 'expired';

  const badge = task.done ? 'Done' : expired ? 'Expired' : 'To do';
  const badgeColor = task.done ? 'emerald' : expired ? 'amber' : 'slate';

  return (
    <div className="py-2 border-b border-slate-100 last:border-0">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
          +{task.points}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-900 break-words">{task.label}</p>
          {!task.done && !expired && (
            <p className="text-xs text-slate-400">
              {task.auto_verified
                ? 'Points arrive on their own once you have done it.'
                : 'Skovo will check this one.'}
            </p>
          )}
        </div>
        <Badge color={badgeColor} size="xs">{badge}</Badge>
      </div>

      {!task.done && !expired && task.action_route && (
        <div className="mt-2">
          <Button size="sm" variant="secondary" className="min-h-11"
            onClick={() => navigate(task.action_route)}>
            Go there <ChevronRight size={13} />
          </Button>
        </div>
      )}
    </div>
  );
}

function ScoreRing({ score, level }) {
  const r = 52;
  const circumference = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, Number(score) || 0)) / 100;
  const label = `${Number(score) || 0} out of 100`;

  return (
    <div className="relative w-36 h-36 shrink-0" role="img" aria-label={label}>
      <svg className="w-full h-full -rotate-90" viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" style={{ stroke: 'color-mix(in srgb, var(--accent) 14%, transparent)' }} />
        <circle
          cx="60" cy="60" r={r} fill="none" stroke="var(--accent)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          className="transition-all duration-700"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-black text-slate-900 leading-none">{Number(score) || 0}</span>
        <span className="text-xs font-semibold text-slate-400 mt-1">/ 100</span>
        {level && <Badge color="blue" size="xs" className="mt-1.5">{level}</Badge>}
      </div>
    </div>
  );
}

function LegacyScoreEngine() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [unlocks, setUnlocks] = useState(null);
  const [events, setEvents] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [goals, setGoals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [pausing, setPausing] = useState(false);
  const [confirmPause, setConfirmPause] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () => {
    setLoadError('');
    return Promise.all([
      api.get('/readiness/score')
        .then(({ data: d }) => {
          if (d.bool) setData(d.response);
          else { setData(null); setLoadError(d.response?.message || 'Could not load your score.'); }
        })
        .catch(() => { setData(null); setLoadError('Could not load your score. Check your connection and try again.'); }),
      api.get('/readiness/score/unlocks').then(({ data: d }) => { if (d.bool) setUnlocks(d.response); }).catch(() => {}),
      api.get('/readiness/score/events').then(({ data: d }) => { if (d.bool) setEvents(d.response.events || []); }).catch(() => {}),
      api.get('/readiness/score/tasks').then(({ data: d }) => { if (d.bool) setTasks(d.response.tasks || []); }).catch(() => {}),
      api.get('/readiness/score/progress').then(({ data: d }) => { if (d.bool) setGoals(d.response.goals || []); }).catch(() => {}),
    ]).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    const refresh = () => { load(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const off = onScoreChanged(refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doPause = async () => {
    setConfirmPause(false);
    setPausing(true);
    try {
      const { data: d } = await api.post('/readiness/score/pause', {});
      if (d.bool) { flash(d.response.message || 'Score paused.'); load(); }
      else flash(d.response?.message || 'Could not pause your score.', 'error');
    } catch { flash('Could not pause your score.', 'error'); } finally { setPausing(false); }
  };

  const pause = data?.pause || {};
  const pauseRemaining = Math.max(0, (pause.max_tokens || 0) - (pause.used_this_year || 0));
  const pauseResets = pause.resets_on
    ? new Date(pause.resets_on).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;
  const isPaused = !!pause.active_until;
  const decaying = (data?.decay_points || 0) > 0;
  const idleDays = data?.last_event_at
    ? Math.floor((Date.now() - new Date(data.last_event_at)) / 86400000)
    : null;
  const atRisk = decaying || (idleDays !== null && idleDays >= 5);
  const nextActions = (unlocks?.next_actions || []).filter((a) => a.route !== '/readiness-assessment');

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type={toastType} />
      <PageHeader title="My Readiness Score" subtitle="Every point you have earned, and what it unlocks" />

      {loading ? (
        <>
          <div className="h-48 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          <div className="h-64 bg-white rounded-2xl border border-slate-100 animate-pulse" />
        </>
      ) : loadError ? (
        <LoadError what="your score" message={loadError} onRetry={() => { setLoading(true); load(); }} />
      ) : (
        <>
      <Card className="p-6 flex flex-col sm:flex-row items-center gap-6">
        <ScoreRing score={data?.score || 0} level={data?.level} />

        <div className="flex-1 min-w-0 w-full">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Zap size={15} style={{ color: 'var(--accent)' }} />
            <span><strong className="text-slate-900">{data?.base_points || 0}</strong> points earned</span>
            {decaying && (
              <>
                <span className="text-slate-300">·</span>
                <TrendingDown size={15} className="text-amber-600" />
                <span className="text-amber-700"><strong>−{data.decay_points}</strong> from inactivity</span>
              </>
            )}
          </div>

          {!isPaused && atRisk && (
            <div className="mt-4 rounded-2xl border px-4 py-3"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent) 40%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              }}>
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <AlertTriangle size={15} style={{ color: 'var(--accent)' }} />
                {decaying ? 'Your score is dropping' : 'Your score starts dropping soon'}
              </p>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                {decaying
                  ? `You have lost ${data.decay_points} point${data.decay_points === 1 ? '' : 's'} to inactivity. `
                  : 'After a few more quiet days it will lose a point a day. '}
                Exams or a break coming up? Freeze it for {pause.pause_days || 21} days — you have{' '}
                <strong>{pauseRemaining}</strong> pause{pauseRemaining === 1 ? '' : 's'} left.
              </p>
              <p className="text-xs text-slate-500 mt-1">
                Free if you are back within {pause.grace_days || 7} days.
              </p>
              <Button
                className="mt-2.5 min-h-11"
                onClick={() => setConfirmPause(true)}
                disabled={pausing || pauseRemaining === 0}
              >
                <PauseCircle size={14} /> {pauseRemaining === 0 ? 'No pauses left' : 'Pause my score now'}
              </Button>
            </div>
          )}

          {isPaused ? (
            <div className="mt-4 rounded-2xl border px-4 py-3"
              style={{
                borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
              }}>
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                <PauseCircle size={15} style={{ color: 'var(--accent)' }} /> Your score is paused
              </p>
              <p className="text-xs text-slate-600 mt-1">
                No inactivity decay until{' '}
                {new Date(pause.active_until).toLocaleDateString('en-IN', { dateStyle: 'medium' })}.
              </p>
            </div>
          ) : atRisk ? null : (
            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">Taking a break?</p>
              {/* Three things a student has to know before spending one, and
                  the screen used to say none of them: a short break is free,
                  the allowance runs from their own signup date rather than
                  January, and when it comes back. */}
              <p className="text-xs text-slate-500 mt-1">
                Your score drops slowly while you are inactive. Pause it for{' '}
                {pause.pause_days || 21} days — you have <strong>{pauseRemaining}</strong>{' '}
                of {pause.max_tokens || 2} left.
              </p>
              <p className="text-xs text-slate-400 mt-1">
                Free if you are back within {pause.grace_days || 7} days. After that it
                uses one{pauseResets ? `, and yours reset on ${pauseResets}` : ''}.
              </p>
              <Button
                variant="secondary" className="mt-2.5 min-h-11"
                onClick={() => setConfirmPause(true)}
                disabled={pausing || pauseRemaining === 0}
              >
                <PauseCircle size={14} /> {pauseRemaining === 0 ? 'No pauses left' : 'Pause my score'}
              </Button>
              {pauseRemaining === 0 && pauseResets && (
                /* "None left" with no date is a dead end. */
                <p className="text-xs text-slate-400 mt-2">
                  Your next pauses arrive on {pauseResets}.
                </p>
              )}
            </div>
          )}
        </div>
      </Card>

      {tasks.length > 0 && (
        <Card className="p-5">
          <SectionTitle>Tasks from Skovo</SectionTitle>
          <p className="text-xs text-slate-400 -mt-2 mb-3">
            Do these and the points arrive on their own. Each pays once.
          </p>
          <div className="space-y-2">
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </div>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-4">
        {unlocks?.next && nextActions.length > 0 && (
          <Card className="p-5">
            <SectionTitle>How to unlock {unlocks.next.label}</SectionTitle>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              {unlocks.next.points_away} point{unlocks.next.points_away === 1 ? '' : 's'} to go.
              Any of these get you there:
            </p>
            <div className="space-y-2">
              {nextActions.map((a) => (
                <button
                  key={a.event_type}
                  type="button"
                  onClick={() => navigate(a.event_type === 'profile_completed' ? '/profile' : a.route)}
                  className="w-full flex items-center gap-3 p-3 min-h-11 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
                >
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0 font-bold text-sm"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                    +{a.points_each}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 break-words">{a.label}</p>
                    <p className="text-xs text-slate-400">{howItPays(a)}</p>
                  </div>
                  <ChevronRight size={16} className="text-slate-300 shrink-0" />
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5">
          <SectionTitle>What your score unlocks</SectionTitle>
          <div className="space-y-2.5">
            {(unlocks?.unlocks || []).length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">Unlocks will show here once your score loads.</p>
            ) : (unlocks.unlocks || []).map((u) => (
              <div key={u.key} className="flex items-center gap-3 min-h-11">
                <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${
                  u.unlocked ? '' : 'bg-slate-100 text-slate-400'
                }`}
                  style={u.unlocked
                    ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }
                    : undefined}>
                  {u.unlocked ? <Unlock size={15} /> : <Lock size={15} />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-semibold ${u.unlocked ? 'text-slate-900' : 'text-slate-500'}`}>
                    {u.label}
                  </p>
                  <p className="text-xs text-slate-400">
                    {u.unlocked ? 'Unlocked' : `${u.points_away} more point${u.points_away === 1 ? '' : 's'} to go`}
                  </p>
                </div>
                <span className="text-xs font-bold text-slate-400 shrink-0">{u.required}</span>
              </div>
            ))}
          </div>
        </Card>

        {goals.filter((g) => !g.earned).length > 0 && (
          <Card className="p-5">
            <SectionTitle>Points waiting for you</SectionTitle>
            {/* A combo pays nothing until it is finished, so without this a
                student has no way of knowing there are five points one step
                away. The waiting line is most of what makes the shape work. */}
            <div className="space-y-4">
              {goals.filter((g) => !g.earned).map((g) => (
                <div key={g.event_type}>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 min-w-0 break-words">
                      {g.label}
                    </p>
                    <span className="text-xs font-bold text-violet-600 shrink-0">
                      {g.points} pts waiting
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {g.done} of {g.need} done
                  </p>
                  <div className="mt-2 h-1.5 rounded-full bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-violet-500 transition-all"
                      style={{ width: `${Math.min(100, (g.done / (g.need || 1)) * 100)}%` }}
                    />
                  </div>
                  <ul className="mt-2 space-y-1">
                    {g.steps.map((st, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs">
                        <span className={`mt-px shrink-0 ${st.done ? 'text-emerald-500' : 'text-slate-300'}`}>
                          {st.done ? '✓' : '○'}
                        </span>
                        <span className={`min-w-0 break-words ${
                          st.done ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                          {st.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-5">
          <SectionTitle>Where your points come from</SectionTitle>
          <div className="space-y-3">
            {(data?.breakdown || []).filter(shown).length === 0 ? (
              <p className="text-sm text-slate-400 py-6 text-center">No scoring rules on this account yet.</p>
            ) : (data?.breakdown || [])
              .filter(shown)
              .map((b) => {
                const ceiling = b.cap_value ? b.cap_value * b.points_each : null;
                const pct = ceiling ? Math.min(100, Math.round((b.earned / ceiling) * 100)) : 0;
                return (
                  <div key={b.event_type}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={b.earned ? 'font-semibold text-slate-800' : 'text-slate-400'}>
                        {b.label}
                      </span>
                      <span className="text-slate-400 shrink-0 ml-2">
                        {b.earned}{ceiling ? `/${ceiling}` : ''}
                        {b.cap_type && !['none', 'per_item'].includes(b.cap_type) && (
                          <span className="ml-1 text-slate-300">
                            {b.cap_type === 'once' ? 'once' : `per ${({ daily: 'day', weekly: 'week', monthly: 'month', yearly: 'year' })[b.cap_type] || b.cap_type.replace(/ly$/, '')}`}
                          </span>
                        )}
                      </span>
                    </div>
                    {ceiling ? (
                      <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
                      </div>
                    ) : (
                      <div className="h-1.5 rounded-full bg-slate-100" />
                    )}
                  </div>
                );
              })}
          </div>
        </Card>
      </div>

      <Card className="p-5">
        <SectionTitle>Score history</SectionTitle>
        {events.length === 0 ? (
          <EmptyState
            icon={History}
            message="No points yet"
            sub="Join a cohort, add a vault document, or post in Assemble — those earn the first points."
            action={
              <div className="flex flex-col sm:flex-row gap-2">
                <Link to="/cohorts"
                  className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-xl text-sm font-semibold text-white"
                  style={{ backgroundColor: 'var(--accent)' }}>
                  Browse cohorts
                </Link>
                <Link to="/document-vault"
                  className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600">
                  Open vault
                </Link>
              </div>
            }
          />
        ) : (
          <div className="divide-y divide-slate-100">
            {events.map((e) => (
              <div key={e.id} className="flex items-start gap-3 py-2.5 min-h-11">
                <History size={14} className="text-slate-300 shrink-0" />
                <span className="flex-1 min-w-0 text-sm text-slate-700 break-words">{e.label}</span>
                <span className="text-xs text-slate-400 shrink-0">
                  {new Date(e.occurred_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </span>
                <span className="text-sm font-bold shrink-0 flex items-center gap-0.5" style={{ color: 'var(--accent)' }}>
                  <TrendingUp size={12} /> {e.points}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
        </>
      )}

      {confirmPause && (
        <ConfirmModal
          message={`Pause your score for ${pause.pause_days || 21} days?`}
          detail={`This uses one of your ${pause.max_tokens || 2} pauses for the year. Decay stays frozen until the pause ends.`}
          confirmLabel="Pause my score"
          onConfirm={doPause}
          onCancel={() => setConfirmPause(false)}
        />
      )}
    </StudentPage>
  );
}


/** Playbook v2.1: once the admin switches the new engine on, this page shows it. */
export default function ScoreEngine(props) {
  const v21 = useReadinessV21();
  if (v21 === null) return null;
  return v21 ? <ReadinessV21 /> : <LegacyScoreEngine {...props} />;
}
