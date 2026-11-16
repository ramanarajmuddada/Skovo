import React, { useCallback, useEffect, useState } from 'react';
import {
  Flame, Lock, Unlock, Sparkles, CalendarDays, Upload, CheckCircle2, Circle, Clock, Trophy, PauseCircle, Award,
} from 'lucide-react';
import { api } from '../../services/api';
import { Card, PageHeader, StudentPage, Modal, useToast, ToastProvider } from '../ui/index.jsx';
import FormSelect from '../ui/FormSelect';

/* Readiness Score Playbook v2.1 — the student's side.
   Readiness = checked proof on the current Journey Card (70 earned + 30 completion).
   Day streak + Streak Points = habit; they never become readiness. */

const PILLAR = {
  clarity: { label: 'Clarity', hint: 'Knows where they are going', bar: 'bg-sky-500' },
  skill: { label: 'Skill', hint: 'Can do the work', bar: 'bg-violet-500' },
  proof: { label: 'Proof', hint: 'Evidence others trust', bar: 'bg-emerald-500' },
};
const LEVEL = {
  getting_started: 'Getting started', building: 'Building', unlocked: 'Opportunities unlocked', skovo_ready: 'Skovo Ready',
};
const STATUS = {
  pending: 'bg-amber-50 text-amber-700', approved: 'bg-emerald-50 text-emerald-700', rejected: 'bg-red-50 text-red-700',
  held: 'bg-slate-100 text-slate-600',
};
const CHECKER = { app: 'in the app', achiever: 'an achiever', ops: 'the verification desk', employer: 'the employer', bhaai: 'BhaAI' };
const fmtDate = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : '');
const msgOf = (d, fb) => d?.response?.message || fb;

// Student pages have no app-wide toast host, so this screen brings its own.
export default function ReadinessV21() {
  return <ToastProvider duration={4000}><ReadinessScreen /></ToastProvider>;
}

function ReadinessScreen() {
  const toast = useToast();
  const [score, setScore] = useState(null);
  const [streak, setStreak] = useState(null);
  const [plan, setPlan] = useState(null);
  const [requests, setRequests] = useState([]);
  const [history, setHistory] = useState(null);
  const [proofOpen, setProofOpen] = useState(false);
  const [resultOpen, setResultOpen] = useState(false);

  const load = useCallback(() => {
    api.get('/readiness/v21/score/current').then(({ data }) => data?.bool && setScore(data.response)).catch(() => {});
    api.get('/readiness/v21/streak/current').then(({ data }) => data?.bool && setStreak(data.response)).catch(() => {});
    api.get('/readiness/v21/weekly-plan').then(({ data }) => data?.bool && setPlan(data.response)).catch(() => {});
    api.get('/readiness/v21/verifications').then(({ data }) => data?.bool && setRequests(data.response.requests || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const pause = async () => {
    try {
      const { data } = await api.post('/readiness/v21/streak/pause');
      if (data?.bool) { toast.success(`Streak paused until ${fmtDate(data.response.paused_until)}.`); load(); }
      else toast.error(msgOf(data, 'Could not pause.'));
    } catch { toast.error('Could not pause.'); }
  };
  const showHistory = () => {
    api.get('/readiness/v21/score/history').then(({ data }) => data?.bool && setHistory(data.response.events || [])).catch(() => {});
  };

  if (!score) return <StudentPage narrow><p className="text-sm text-slate-400">Loading…</p></StudentPage>;
  const c = score.card;
  const t = score.thresholds;

  return (
    <StudentPage narrow>
      <PageHeader title="My Readiness"
                  subtitle="Readiness grows only from checked work. Your streak and Streak Points grow from showing up every day." />
      {!c ? (
        <Card className="p-5 text-sm text-slate-600">Add your class or year in your profile to start your Journey Card.</Card>
      ) : (
        <div className="space-y-4">
          <ScoreCard c={c} t={t} index={score.readiness_index} activeReady={score.active_ready} />
          <Pillars pillars={c.pillars} />
          {streak && <StreakCard s={streak} onPause={pause} />}
          {plan && <WeeklyPlan plan={plan} />}
          <NextActions items={score.next_actions} onProof={() => setProofOpen(true)} onResult={() => setResultOpen(true)}
                       showResult={c.completion_status !== 'awarded'} isSkill={c.card_type === 'skill'} />
          <Requests rows={requests} />
          <PastCards cards={score.cards} />
          <Card className="p-4">
            {history === null ? (
              <button type="button" onClick={showHistory} className="min-h-11 text-sm font-semibold text-violet-700">Show points history</button>
            ) : (
              <div>
                <p className="text-sm font-bold text-slate-800 mb-2">Points history</p>
                {!history.length ? <p className="text-sm text-slate-500">No points yet.</p> : (
                  <ul className="divide-y divide-slate-100">
                    {history.map((h) => (
                      <li key={h.id} className="py-2 flex items-center justify-between gap-2 text-sm">
                        <span className="min-w-0 truncate text-slate-700">{h.label}<span className="text-slate-400"> · {fmtDate(h.at)}</span></span>
                        <span className={`shrink-0 font-semibold ${h.status === 'saved' ? 'text-amber-600' : h.status === 'capped' ? 'text-slate-400' : 'text-emerald-700'}`}>
                          {h.status === 'capped' ? 'bucket full' : `+${h.points}`}{h.status === 'saved' ? ` saved → ${fmtDate(h.release_at)}` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
      <ProofModal key={proofOpen ? 'proof-open' : 'proof'} open={proofOpen} onClose={() => setProofOpen(false)} onDone={() => { setProofOpen(false); load(); }} />
      <ResultModal key={resultOpen ? 'result-open' : 'result'} open={resultOpen} card={c} onClose={() => setResultOpen(false)} onDone={() => { setResultOpen(false); load(); }} />
    </StudentPage>
  );
}

function ScoreCard({ c, t, index, activeReady }) {
  const pct = (v) => `${Math.min(100, Math.max(0, v))}%`;
  const unlocked = c.earned >= t.unlock;
  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-violet-700">{c.label}{c.stage_badge ? ` · ${c.stage_badge}` : ''}</p>
          <p className="text-4xl font-black text-slate-900 leading-tight">{Math.round(c.card_score)}<span className="text-lg text-slate-400">/100</span></p>
          <p className="text-xs text-slate-500">{Math.round(c.earned)} earned of {t.earned_max} · {c.completion_points} for finishing</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full ${unlocked ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
          {unlocked ? <Unlock size={13} /> : <Lock size={13} />} {LEVEL[c.level]}
        </span>
      </div>
      <div className="relative mt-4 h-3 rounded-full bg-slate-100 overflow-hidden" role="progressbar"
           aria-valuenow={Math.round(c.card_score)} aria-valuemin={0} aria-valuemax={100} aria-label="Card score">
        <div className="absolute inset-y-0 left-0 bg-violet-500" style={{ width: pct(c.earned) }} />
        <div className="absolute inset-y-0 bg-orange-400" style={{ left: pct(c.earned), width: pct(c.completion_points) }} />
        {[t.unlock, t.premium, t.earned_max].map((m) => (
          <span key={m} className="absolute inset-y-0 w-px bg-white/90" style={{ left: pct(m) }} />
        ))}
      </div>
      {/* Labels sit under their own marks, not spread evenly. */}
      <div className="relative mt-1 h-4 text-[11px] text-slate-400">
        <span className="absolute left-0">0</span>
        <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: pct(t.unlock) }}>{t.unlock} unlocks</span>
        <span className="absolute right-0">100</span>
      </div>
      <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
        {!unlocked && <Chip icon={Lock} text={`${c.to_unlock} points to unlock`} />}
        {c.monthly?.capped && <Chip icon={CalendarDays} text={`Month ${c.card_month}: ${c.monthly.left} of ${c.monthly.cap} left`} />}
        {c.saved?.points > 0 && <Chip icon={Clock} text={`${c.saved.points} saved → ${fmtDate(c.saved.next_release)}`} />}
        <Chip icon={Award} text={`Readiness Index ${Math.round(index)}`} />
        {activeReady && <Chip icon={Sparkles} text="Active Ready" tone="emerald" />}
        {c.completion_status === 'pending' && <Chip icon={Clock} text="Completion pending — no penalty" tone="amber" />}
      </div>
    </Card>
  );
}

function Chip({ icon, text, tone }) {
  const Icon = icon;
  const cls = tone === 'emerald' ? 'bg-emerald-50 text-emerald-700' : tone === 'amber' ? 'bg-amber-50 text-amber-700' : 'bg-slate-50 text-slate-600';
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 ${cls}`}>
      <Icon size={14} className="shrink-0" /><span className="min-w-0">{text}</span>
    </span>
  );
}

function Pillars({ pillars }) {
  if (!pillars) return null;
  return (
    <Card className="p-4">
      <p className="text-sm font-bold text-slate-800">Three pillars</p>
      <p className="text-xs text-slate-500 mb-3">A full bucket adds nothing more — work on the one with room.</p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {Object.entries(PILLAR).map(([k, p]) => {
          const v = pillars[k] || { applied: 0, bucket: 0, saved: 0 };
          return (
            <div key={k}>
              <div className="flex justify-between text-xs mb-1">
                <span className="font-semibold text-slate-700">{p.label}</span>
                <span className="text-slate-500">{v.applied}/{v.bucket}{v.saved ? ` (+${v.saved} saved)` : ''}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div className={`h-full ${p.bar}`} style={{ width: `${v.bucket ? (v.applied / v.bucket) * 100 : 0}%` }} />
              </div>
              <p className="text-[11px] text-slate-400 mt-1">{p.hint}</p>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function StreakCard({ s, onPause }) {
  return (
    <Card className="p-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat icon={Flame} tone="text-orange-500" value={`${s.streak} day${s.streak === 1 ? '' : 's'}`} label={`Day streak · best ${s.longest}`} />
        <Stat icon={Sparkles} tone="text-violet-600" value={`×${s.multiplier}`}
              label={s.next_multiplier ? `×${s.next_multiplier.x} at ${s.next_multiplier.at_day} days` : 'Top boost'} />
        <Stat icon={Trophy} tone="text-amber-500" value={s.sp_lifetime.toLocaleString('en-IN')} label={`Lifetime SP${s.level?.name ? ` · ${s.level.name}` : ''}`} />
        <Stat icon={CalendarDays} tone="text-sky-600" value={s.sp_weekly.toLocaleString('en-IN')} label="SP this week" />
      </div>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2 text-xs text-slate-500">
        <span className="flex-1">
          {s.kept_today ? 'Today counted ✓' : 'Open Skovo for 30 seconds today to keep your streak.'}
          {' '}{s.save_available ? '1 missed day this month is forgiven.' : 'Monthly save used.'}
          {s.paused_until ? ` Paused until ${fmtDate(s.paused_until)}.` : ''}
        </span>
        {!s.paused_until && s.pause_tokens_left > 0 && (
          <button type="button" onClick={onPause}
                  className="min-h-11 px-3 rounded-xl bg-slate-100 text-slate-700 font-semibold inline-flex items-center justify-center gap-1.5">
            <PauseCircle size={15} /> Pause ({s.pause_tokens_left} left)
          </button>
        )}
      </div>
    </Card>
  );
}

function Stat({ icon, tone, value, label }) {
  const Icon = icon;
  return (
    <div className="min-w-0">
      <p className="text-lg font-black text-slate-900 flex items-center gap-1.5"><Icon size={17} className={tone} />{value}</p>
      <p className="text-[11px] text-slate-500 leading-tight">{label}</p>
    </div>
  );
}

function WeeklyPlan({ plan }) {
  if (!plan.actions?.length) return null;
  const done = plan.actions.filter((a) => a.done).length;
  return (
    <Card className="p-4">
      <p className="text-sm font-bold text-slate-800">This week's plan <span className="text-slate-400 font-normal">· {done}/{plan.actions.length}</span></p>
      <p className="text-xs text-slate-500 mb-2">Finish all three for +100 SP{plan.bonus_paid ? ' — earned ✓' : ''}.</p>
      <ul className="space-y-1.5">
        {plan.actions.map((a) => (
          <li key={a.action_key} className="flex items-center gap-2 text-sm">
            {a.done ? <CheckCircle2 size={17} className="text-emerald-600 shrink-0" /> : <Circle size={17} className="text-slate-300 shrink-0" />}
            <span className={`flex-1 min-w-0 ${a.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{a.label}</span>
            <span className="text-xs text-slate-500 shrink-0">{PILLAR[a.pillar]?.label} +{a.points}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function NextActions({ items, onProof, onResult, showResult, isSkill }) {
  return (
    <Card className="p-4">
      <p className="text-sm font-bold text-slate-800 mb-2">Do next</p>
      {!items?.length ? <p className="text-sm text-slate-500">Your buckets are full. Keep adding checked work to stay Active Ready.</p> : (
        <ul className="space-y-2 mb-3">
          {items.map((a) => (
            <li key={a.action_key} className="text-sm">
              <span className="font-semibold text-slate-700">{a.label}</span>
              <span className="text-xs text-slate-500"> · {PILLAR[a.pillar]?.label} +{a.points} · checked by {CHECKER[a.checked_by] || a.checked_by}</span>
              {a.evidence && <p className="text-xs text-slate-400">{a.evidence}</p>}
            </li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <button type="button" onClick={onProof}
                className="min-h-11 rounded-xl bg-violet-600 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5">
          <Upload size={16} /> Submit proof
        </button>
        {showResult && (
          <button type="button" onClick={onResult}
                  className="min-h-11 rounded-xl bg-orange-50 text-orange-700 text-sm font-semibold inline-flex items-center justify-center gap-1.5">
            <Award size={16} /> {isSkill ? 'Upload job offer' : 'Upload result'}
          </button>
        )}
      </div>
    </Card>
  );
}

function Requests({ rows }) {
  if (!rows?.length) return null;
  return (
    <Card className="p-4">
      <p className="text-sm font-bold text-slate-800 mb-2">My submissions</p>
      <ul className="divide-y divide-slate-100">
        {rows.slice(0, 10).map((r) => (
          <li key={r.id} className="py-2 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-slate-700">{r.action_label}</span>
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS[r.status] || ''}`}>{r.status}</span>
            </div>
            {(r.feedback || r.reason) && <p className="text-xs text-slate-500 mt-0.5">{r.feedback || r.reason}{r.mark != null ? ` · ${r.mark}/10` : ''}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PastCards({ cards }) {
  if (!cards?.length) return null;
  return (
    <Card className="p-4">
      <p className="text-sm font-bold text-slate-800 mb-2">Finished cards</p>
      <ul className="divide-y divide-slate-100">
        {cards.map((c) => (
          <li key={c.id} className="py-2 flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 truncate text-slate-700">{c.label}{c.kind === 'past_result' ? ' · result verified' : ''}</span>
            <span className="shrink-0 font-semibold text-slate-800">{Math.round(c.card_score)}/100{c.status === 'expired' ? ' · expired' : ''}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function ProofModal({ open, onClose, onDone }) {
  const toast = useToast();
  const [actions, setActions] = useState([]);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (!open) return;
    api.get('/readiness/v21/actions').then(({ data }) => data?.bool && setActions(
      (data.response.actions || []).filter((a) => a.checked_by !== 'app' && a.checked_by !== 'employer'),
    )).catch(() => {});
  }, [open]);
  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/readiness/v21/evidence', form);
      if (data?.bool) { toast.success(msgOf(data, 'Sent for checking.')); onDone(); } else toast.error(msgOf(data, 'Could not submit.'));
    } catch { toast.error('Could not submit.'); }
    setSaving(false);
  };
  const picked = actions.find((a) => a.action_key === form.action_key);
  return (
    <Modal isOpen={open} onClose={onClose} title="Submit proof"
           footer={<button type="button" disabled={saving || !form.action_key || !form.url} onClick={submit}
                           className="min-h-11 w-full sm:w-auto px-5 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">Send for checking</button>}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">What did you do?</span>
          <FormSelect value={form.action_key || ''} onChange={(v) => setForm({ ...form, action_key: v })} placeholder="Choose"
                      options={actions.map((a) => ({ value: a.action_key, label: `${a.label} (+${a.points})` }))} />
        </label>
        {picked?.evidence && <p className="text-xs text-slate-500">Needed: {picked.evidence}</p>}
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Link to your proof (certificate, project, results page)</span>
          <input value={form.url || ''} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://"
                 className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Proof link" />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">Note (optional)</span>
          <input value={form.note || ''} onChange={(e) => setForm({ ...form, note: e.target.value })}
                 className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Note" />
        </label>
        <p className="text-xs text-slate-400">Points are added only after someone checks it, usually within 48 hours.</p>
      </div>
    </Modal>
  );
}

function ResultModal({ open, card, onClose, onDone }) {
  const toast = useToast();
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    setSaving(true);
    try {
      const { data } = await api.post('/readiness/v21/results', { ...form, card_id: card?.id });
      if (data?.bool) { toast.success(msgOf(data, 'Sent to the desk.')); onDone(); } else toast.error(msgOf(data, 'Could not submit.'));
    } catch { toast.error('Could not submit.'); }
    setSaving(false);
  };
  const skill = card?.card_type === 'skill';
  return (
    <Modal isOpen={open} onClose={onClose} title={skill ? 'Upload your job offer' : 'Upload your result'}
           footer={<button type="button" disabled={saving || !form.url} onClick={submit}
                           className="min-h-11 w-full sm:w-auto px-5 rounded-xl bg-violet-600 text-white text-sm font-semibold disabled:opacity-50">Send</button>}>
      <div className="space-y-3 text-sm">
        <label className="block">
          <span className="text-xs font-semibold text-slate-600">{skill ? 'Link to the offer or joining letter' : 'Link to your marks memo / result card'}</span>
          <input value={form.url || ''} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://"
                 className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Document link" />
        </label>
        {!skill && (
          <label className="block">
            <span className="text-xs font-semibold text-slate-600">Grade or percentage as printed (optional)</span>
            <input value={form.grade || ''} onChange={(e) => setForm({ ...form, grade: e.target.value })} placeholder="e.g. 68% or A+"
                   className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Grade" />
          </label>
        )}
        <p className="text-xs text-slate-400">Your marks stay private. Employers only see your score and “Completed”.</p>
      </div>
    </Modal>
  );
}

/* ── Leaderboards ─────────────────────────────────────────────────────────── */

const BOARDS = [
  { key: 'weekly', label: 'This week' }, { key: 'city', label: 'City champions' },
  { key: 'streak', label: 'Streak' }, { key: 'readiness', label: 'Readiness' },
];

export function LeaderboardV21() {
  const [board, setBoard] = useState('weekly');
  const [loaded, setLoaded] = useState({ board: null, data: null });
  useEffect(() => {
    api.get(`/readiness/v21/leaderboard?board=${board}`)
      .then(({ data: d }) => setLoaded({ board, data: d?.bool ? d.response : { top: [] } }))
      .catch(() => setLoaded({ board, data: { top: [] } }));
  }, [board]);
  const data = loaded.board === board ? loaded.data : null;
  const unit = board === 'streak' ? 'days' : board === 'readiness' ? '/ 70' : 'SP';
  return (
    <StudentPage narrow>
      <PageHeader title="Leaderboard" subtitle="Weekly boards reset every Monday. Readiness boards show earned points only — never marks." />
      <div role="tablist" className="grid grid-cols-2 sm:flex gap-1 p-1 rounded-2xl bg-slate-100 mb-4">
        {BOARDS.map((b) => (
          <button key={b.key} type="button" role="tab" aria-selected={board === b.key} onClick={() => setBoard(b.key)}
                  className={`min-h-11 px-3 rounded-xl text-sm font-semibold ${board === b.key ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>
            {b.label}
          </button>
        ))}
      </div>
      <Card className="divide-y divide-slate-100">
        {!data ? <p className="p-4 text-sm text-slate-400">Loading…</p> : !data.top.length ? (
          <p className="p-6 text-center text-sm text-slate-500">No one on this board yet — be the first.</p>
        ) : data.top.map((r) => (
          <div key={r.user_id} className={`px-4 py-3 flex items-center gap-3 ${r.user_id === data.me?.user_id ? 'bg-violet-50' : ''}`}>
            <span className={`w-7 text-center font-black ${r.rank <= 3 ? 'text-amber-500' : 'text-slate-400'}`}>{r.rank}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{r.name}</p>
              <p className="text-[11px] text-slate-500 truncate">{[r.stage_badge, r.city].filter(Boolean).join(' · ')}</p>
            </div>
            <span className="shrink-0 text-sm font-bold text-slate-800">{Math.round(r.value).toLocaleString('en-IN')} <span className="text-xs text-slate-400">{unit}</span></span>
          </div>
        ))}
      </Card>
      {data?.me && !data.top.some((r) => r.user_id === data.me.user_id) && (
        <p className="mt-3 text-sm text-slate-600 text-center">You are <b>#{data.me.rank}</b> with {Math.round(data.me.value)} {unit}.</p>
      )}
    </StudentPage>
  );
}
