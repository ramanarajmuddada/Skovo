import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api, onScoreChanged } from '../services/api';
import CohortCard from '../components/cohorts/CohortCard';
import TodayPanel from '../components/v1/TodayPanel';
import SetGoalCard from '../components/v1/SetGoalCard';
import CohortDetailsSlideover from '../components/cohorts/CohortDetailsSlideover';
import { Card, SectionTitle, StatCard, SkeletonCard, Button, StudentPage } from '../components/ui/index.jsx';
import { TrendingUp, Users, CheckCircle, Star, ArrowRight, Lock, Zap, Crown, ChevronRight, GraduationCap, Briefcase, MessageSquare, Target } from 'lucide-react';

function ReadinessRing({ score }) {
  const r = 52, c = 2 * Math.PI * r;
  return (
    <div className="relative inline-flex items-center justify-center w-24 h-24 sm:w-36 sm:h-36 shrink-0">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 144 144" aria-hidden="true">
        <circle cx="72" cy="72" r={r} stroke="#1e293b" strokeWidth="10" fill="none" />
        <circle cx="72" cy="72" r={r} stroke="var(--accent)" strokeWidth="10" fill="none"
          strokeDasharray={c} strokeDashoffset={c - (score / 100) * c}
          strokeLinecap="round" className="transition-all duration-700" />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="text-2xl sm:text-3xl font-black text-white">{score}</span>
        <span className="text-[10px] sm:text-xs text-slate-400 font-medium">/ 100</span>
      </div>
    </div>
  );
}

function normalizeCohort(c) {
  const date = c.session_date ? new Date(c.session_date) : null;
  return {
    id: c.id, title: c.title,
    domain: c.domain?.name || c.domain || 'General',
    status: c.status || 'upcoming',
    mentor: c.achiever?.full_name || c.mentor || 'Expert Mentor',
    mentorRole: c.achiever ? [c.achiever.designation, c.achiever.company].filter(Boolean).join(' • ') : c.mentorRole || '',
    date: date ? date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : c.date,
    dateTime: date
      ? date.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null,
    seats: c.total_seats
      ? (c.available_seats == null
          ? `${c.filled_seats ?? 0}/${c.total_seats}`
          : `${c.available_seats} left`)
      : (c.seats || `${c.filled_seats ?? 0} enrolled`),
    seatsLabel: c.total_seats
      ? `${c.filled_seats ?? 0}/${c.total_seats} seats`
      : `${c.filled_seats ?? 0} enrolled`,
    isEnrolled: Boolean(c.is_enrolled),
    price: c.price ?? 0, effectivePrice: c.effective_price ?? c.price ?? 0, offerLabel: c.offer_label || null, about: c.about,
    learnings: c.what_you_learn || c.learnings || [],
    duration: c.duration_minutes ? `${c.duration_minutes} min` : (c.duration || '90 min'),
    fullDate: date ? date.toLocaleDateString('en-IN', { dateStyle: 'long' }) : c.fullDate,
  };
}

// Styling only -- the NAME comes from the server.
//
// This map used to carry the label too ('🌱 Explorer'), and the lookup fell
// back to Explorer for anything it did not recognise. Levels are configurable
// now, so a student the server had correctly labelled "Builder" was shown
// "Explorer" on their own dashboard: the one screen where the badge is meant
// to tell them they have moved.
const LEVEL_STYLE = {
  Explorer: { color: 'text-amber-400',   icon: '🌱' },
  Pioneer:  { color: 'text-blue-400',    icon: '🚀' },
  Achiever: { color: 'text-emerald-400', icon: '🏆' },
};
const DEFAULT_LEVEL_STYLE = { color: 'text-violet-400', icon: '⭐' };

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

export default function Dashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedCohort, setSelectedCohort] = useState(null);
  const [isPro, setIsPro] = useState(true); // assume Pro until known, so the banner never flashes

  // The "How to Increase Your Readiness Score" step reads the same live,
  // admin-configurable action list the My Score page uses, so the point values
  // shown here are never a second hardcoded copy that can drift.
  const [unlocks, setUnlocks] = useState(null);

  // Pulled out of the effect so the score can be refetched without a remount.
  const loadDashboard = useCallback(
    () => Promise.all([
      api.get('/dashboard/')
        .then(({ data: res }) => { if (res.bool) setData(res.response); })
        .catch(() => {}),
      api.get('/readiness/score/unlocks')
        .then(({ data: res }) => { if (res.bool) setUnlocks(res.response); })
        .catch(() => {}),
    ]),
    [],
  );

  useEffect(() => {
    loadDashboard().finally(() => setLoading(false));
    api.get('/subscription/').then(({ data: res }) => { if (res.bool) setIsPro(!!res.response.is_pro); }).catch(() => {});
  }, [loadDashboard]);

  // The score is earned somewhere else — a check-in, an upload, a community
  // post — and this screen used to fetch once and never again, so a student who
  // came back to it read a number the server had already moved past and had to
  // reload the page to see their own points. Two triggers cover both ways back
  // here: an in-tab scoring action, and returning to a tab left open.
  useEffect(() => {
    const refresh = () => { loadDashboard(); };
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const off = onScoreChanged(refresh);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', refresh);
    return () => {
      off();
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', refresh);
    };
  }, [loadDashboard]);

  const readiness = data?.readiness || { score: 0, level: 'Explorer', cohorts_completed: 0, tasks_completed: 0 };
  const hubMin = readiness.hub_min_score ?? 60;
  const cohorts   = data?.upcoming_cohorts || [];
  const firstName = (data?.full_name || user?.full_name || 'there').split(' ')[0];
  const levelStyle = LEVEL_STYLE[readiness.level] || DEFAULT_LEVEL_STYLE;
  // Whatever the server called them, even a level added this morning.
  const levelMeta = {
    color: levelStyle.color,
    label: `${levelStyle.icon} ${readiness.level || 'Explorer'}`,
  };
  const assessmentDone = readiness.score > 0;

  const quickActions = [
    // Only screens that are in the v1 sidebar: Market is hidden there, so a
    // shortcut to it was a door the rest of the app never shows.
    { label: 'Join a Cohort', sub: 'Expert-led sessions', path: '/cohorts',       tint: 'bg-blue-50 text-blue-600',       icon: Users },
    { label: 'Practice',      sub: 'Daily quizzes',       path: '/practice',      tint: 'bg-amber-50 text-amber-600',     icon: Target },
    { label: 'Find College',  sub: 'Rank-fit insights',   path: '/colleges',      tint: 'bg-indigo-50 text-indigo-600',   icon: GraduationCap },
    { label: 'Opportunities', sub: 'Fresher jobs & more', path: '/opportunities', tint: 'bg-emerald-50 text-emerald-600', icon: Briefcase },
    { label: 'Assemble',      sub: 'Community groups',    path: '/assemble',      tint: 'bg-violet-50 text-violet-600',   icon: MessageSquare },
  ];

  return (
    <StudentPage className="space-y-5 sm:space-y-6">

      {/* ── Skovo Pro upgrade banner (hidden for members) ──────────── */}
      {!isPro && (
        <button type="button" onClick={() => navigate('/skovo-pro')}
          className="w-full text-left rounded-2xl p-4 sm:p-5 text-white flex items-center gap-3 sm:gap-4 shadow-lg active:scale-[0.99] transition-transform min-h-11"
          style={{ background: 'linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, #4f46e5) 100%)' }}>
          <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
            <Crown size={20} className="text-yellow-300" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm sm:text-base leading-snug">Get Skovo Pro — unlock everything</p>
            <p className="text-white/80 text-xs sm:text-sm mt-0.5 leading-relaxed">Unlimited cohorts, communities, vault and applying. Take Pro when the free allowance is used.</p>
          </div>
          <ArrowRight size={18} className="shrink-0 hidden sm:block" />
        </button>
      )}

      {/* ── Hero strip ───────────────────────────────────────────── */}
      <div className="relative overflow-hidden rounded-2xl sm:rounded-3xl bg-slate-900 p-5 sm:p-6 lg:p-8">
        <div className="pointer-events-none absolute -top-16 -right-10 w-56 h-56 rounded-full blur-3xl opacity-40"
             style={{ backgroundColor: 'var(--accent)' }} />
        <div className="relative flex flex-col sm:flex-row items-start sm:items-center justify-between gap-5">
          <div className="flex items-center gap-4 sm:gap-5 min-w-0">
            <ReadinessRing score={readiness.score} />
            <div className="min-w-0">
              <p className="text-slate-400 text-xs sm:text-sm mb-1">
                {loading ? 'Loading…' : `Welcome back, ${firstName}`}
              </p>
              <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">
                Career Readiness
              </h1>
              <span className={`text-sm font-semibold mt-1 block ${levelMeta.color}`}>
                {levelMeta.label}
              </span>
              {!readiness.opportunity_hub_unlocked && (
                <div className="flex items-center gap-1.5 mt-2 text-xs text-slate-400">
                  <Lock size={11} className="shrink-0" />
                  <span className="leading-snug">
                    {readiness.points_needed_for_hub ?? Math.max(0, 60 - readiness.score)} pts to unlock Opportunity Hub
                  </span>
                </div>
              )}
            </div>
          </div>
          <Button variant="primary" size="md" onClick={() => navigate('/my-score')}
            className="w-full sm:w-auto min-h-11 shrink-0">
            View my score <ArrowRight size={14} />
          </Button>
        </div>
      </div>

      {!assessmentDone && !loading && (
        <div className="bg-linear-to-r from-blue-600 to-indigo-600 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
          <div className="flex items-start sm:items-center gap-3 sm:gap-4 min-w-0">
            <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Zap size={20} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="font-bold text-white text-sm leading-snug">Start building your Readiness Score</p>
              <p className="text-blue-100 text-xs mt-0.5">Reach {hubMin} pts · Unlock opportunities</p>
            </div>
          </div>
          <Button size="sm" onClick={() => navigate('/my-score')}
            className="w-full sm:w-auto min-h-11 shrink-0 bg-white text-blue-600 hover:bg-blue-50 border-0 shadow-none font-semibold">
            See how <ArrowRight size={13} />
          </Button>
        </div>
      )}

      {/* First task after sign-up; gone once a goal is set. */}
      <SetGoalCard />
      <TodayPanel />

      {/* ── Stats ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {loading ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
          <>
            <StatCard label="Cohorts Joined"    value={readiness.cohorts_completed} icon={Users}       color="blue" />
            <StatCard label="Tasks Done"         value={readiness.tasks_completed}   icon={CheckCircle} color="emerald" />
            <StatCard label="Readiness Score"    value={readiness.score}             icon={TrendingUp}  color="purple" />
            <StatCard label="Level"              value={readiness.level}             icon={Star}        color="amber" />
          </>
        )}
      </div>

      {unlocks?.next && (unlocks?.next_actions || []).length > 0 && (
        <Card className="p-4 sm:p-5">
          <SectionTitle action={
            <Button variant="ghost" size="sm" onClick={() => navigate('/my-score')} className="min-h-11 sm:min-h-0">
              See full breakdown <ArrowRight size={14} />
            </Button>
          }>
            How to Increase Your Readiness Score
          </SectionTitle>
          <p className="text-xs text-slate-400 -mt-2 mb-3 leading-relaxed">
            {unlocks.next.points_away} point{unlocks.next.points_away === 1 ? '' : 's'} to {unlocks.next.label}.
            Any of these get you there:
          </p>
          <div className="space-y-2">
            {unlocks.next_actions.slice(0, 4).map((a) => (
              <button
                key={a.event_type}
                type="button"
                onClick={() => navigate(a.route)}
                className="w-full flex items-start gap-3 p-3 min-h-11 rounded-xl border border-slate-200 hover:border-slate-300 hover:bg-slate-50 active:bg-slate-50 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0 font-bold text-sm">
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

      {/* ── Quick Actions ─────────────────────────────────────────── */}
      <div>
        <SectionTitle>Quick Actions</SectionTitle>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 [&>*:last-child]:col-span-2 [&>*:last-child]:flex-row [&>*:last-child]:items-center sm:[&>*:last-child]:col-span-1">
          {/* Compact bordered tiles like the rest of the platform; five
              saturated gradient blocks outshouted the score above them. */}
          {quickActions.map(({ label, sub, path, tint, icon: Icon }) => (
            <button key={path} type="button" onClick={() => navigate(path)}
              className="group bg-white rounded-2xl border border-slate-200 p-3.5 text-left flex flex-col sm:flex-row items-start sm:items-center gap-2 sm:gap-3 min-h-16 hover:border-slate-300 hover:shadow-sm transition-all">
              <span className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tint}`}><Icon size={17} /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-slate-900 leading-snug">{label}</span>
                <span className="block text-[11px] text-slate-500 leading-snug">{sub}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Upcoming Cohorts ──────────────────────────────────────── */}
      <div>
        <SectionTitle action={
          <Button variant="ghost" size="sm" onClick={() => navigate('/cohorts')} className="min-h-11 sm:min-h-0">
            View all <ArrowRight size={14} />
          </Button>
        }>
          Upcoming Cohorts
        </SectionTitle>

        {loading ? (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => <SkeletonCard key={i} />)}
          </div>
        ) : cohorts.length === 0 ? (
          <Card className="p-6 sm:p-8 text-center">
            <p className="text-sm font-semibold text-slate-700">No upcoming cohorts right now</p>
            <p className="text-xs text-slate-400 mt-1">Check back soon, or browse the full list.</p>
            <Button variant="secondary" size="md" className="mt-4 min-h-11" onClick={() => navigate('/cohorts')}>
              Browse cohorts
            </Button>
          </Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {cohorts.slice(0, 3).map((c) => (
              <CohortCard key={c.id} cohort={normalizeCohort(c)} onOpen={setSelectedCohort} />
            ))}
          </div>
        )}
      </div>

      <CohortDetailsSlideover cohort={selectedCohort} isOpen={!!selectedCohort} onClose={() => setSelectedCohort(null)} />
    </StudentPage>
  );
}
