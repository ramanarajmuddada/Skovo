import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Card, Button } from '../components/ui/index.jsx';
import {
  Zap, Users, BookOpen, CheckSquare, Briefcase, Star,
  ArrowRight, CheckCircle, Lock, TrendingUp, Target,
} from 'lucide-react';

const LEVELS = [
  { min: 0,  max: 29,  label: 'Explorer',  emoji: '🌱', color: 'slate',   desc: 'Just getting started — complete the assessment to begin your journey.' },
  { min: 30, max: 64,  label: 'Pioneer',   emoji: '🚀', color: 'blue',    desc: 'Building momentum — focus on cohorts and tasks to level up fast.' },
  { min: 65, max: 84,  label: 'Achiever',  emoji: '🏆', color: 'emerald', desc: 'You\'ve unlocked opportunities — keep applying and complete more tasks.' },
  { min: 85, max: 100, label: 'Champion',  emoji: '⭐', color: 'amber',   desc: 'Top tier — you\'re ready for the best opportunities on the platform.' },
];

const MILESTONES = [
  {
    id: 'assessment',
    pts: 20, icon: Zap, color: 'blue',
    title: 'Complete Readiness Assessment',
    desc: 'Answer 4 quick sections about your skills, experience, career goals and community engagement.',
    action: 'Start Assessment', to: '/readiness-assessment',
    check: (d) => d.readiness_score > 0,
  },
  {
    id: 'cohort',
    pts: 10, icon: Users, color: 'purple',
    title: 'Join Your First Cohort',
    desc: 'Enrol in a live expert-led session that matches your career interests and domain.',
    action: 'Browse Cohorts', to: '/cohorts',
    check: (d) => d.cohorts_completed > 0,
  },
  {
    id: 'task',
    pts: 15, icon: CheckSquare, color: 'emerald',
    title: 'Submit Your First Task',
    desc: 'Complete and submit a task assigned by your mentor to earn points.',
    action: 'View Tasks', to: '/tasks',
    check: (d) => d.tasks_done > 0,
  },
  {
    id: 'profile',
    pts: 5, icon: Star, color: 'amber',
    title: 'Complete Your Profile',
    desc: 'Add your career interests, education details, city and state to personalise your experience.',
    action: 'Edit Profile', to: '/profile',
    check: (d) => d.profile_complete,
  },
  {
    id: 'opportunity_unlock',
    pts: 0, icon: Briefcase, color: 'indigo',
    title: 'Unlock Opportunities (65 pts needed)',
    desc: 'Reach 65+ readiness points to access internships, fresher jobs and fellowship applications.',
    action: 'Browse Opportunities', to: '/opportunities',
    check: (d) => d.readiness_score >= 65,
  },
  {
    id: 'apply',
    pts: 0, icon: Briefcase, color: 'emerald',
    title: 'Apply to an Opportunity',
    desc: 'Put your readiness score to work — apply to an internship or fresher job that matches you.',
    action: 'Find Opportunities', to: '/opportunities',
    check: (d) => d.applications_count > 0,
  },
  {
    id: 'mentor',
    pts: 0, icon: Star, color: 'amber',
    title: 'Book a Mentor Session',
    desc: 'Get 1-on-1 guidance from an industry expert to fast-track your career decisions.',
    action: 'Find Mentors', to: '/find-mentors',
    check: (d) => d.mentor_sessions > 0,
  },
  {
    id: 'cg',
    pts: 0, icon: Target, color: 'purple',
    title: 'Explore Career Guidance',
    desc: 'Browse entrance exams, scholarships, govt exams and study abroad programs curated for you.',
    action: 'Open Career Guidance', to: '/career-guidance',
    check: () => false,
  },
];

function getLevel(score) {
  return LEVELS.find(l => score >= l.min && score <= l.max) || LEVELS[0];
}

const COLOR = {
  blue:    { ring: 'ring-blue-500',    bg: 'bg-blue-50',    icon: 'text-blue-600',    badge: 'bg-blue-100 text-blue-700' },
  purple:  { ring: 'ring-purple-500',  bg: 'bg-purple-50',  icon: 'text-purple-600',  badge: 'bg-purple-100 text-purple-700' },
  emerald: { ring: 'ring-emerald-500', bg: 'bg-emerald-50', icon: 'text-emerald-600', badge: 'bg-emerald-100 text-emerald-700' },
  amber:   { ring: 'ring-amber-500',   bg: 'bg-amber-50',   icon: 'text-amber-600',   badge: 'bg-amber-100 text-amber-700' },
  indigo:  { ring: 'ring-indigo-500',  bg: 'bg-indigo-50',  icon: 'text-indigo-600',  badge: 'bg-indigo-100 text-indigo-700' },
  slate:   { ring: 'ring-slate-400',   bg: 'bg-slate-100',  icon: 'text-slate-500',   badge: 'bg-slate-100 text-slate-600' },
};

export default function Roadmap() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // The roadmap needs data from several endpoints. The dashboard only carries
    // readiness + cohorts/tasks; applications, mentor sessions and profile
    // completeness come from their own routes. Fetch in parallel and normalise
    // into the flat shape the milestone `check` functions expect.
    Promise.all([
      api.get('/dashboard/').catch(() => ({ data: {} })),
      api.get('/applications/').catch(() => ({ data: {} })),
      api.get('/achievers/my-sessions').catch(() => ({ data: {} })),
      api.get('/profile/').catch(() => ({ data: {} })),
    ])
      .then(([dash, apps, sessions, profile]) => {
        const readiness = dash.data?.response?.readiness || {};
        const p = profile.data?.response?.profile || {};
        const profileComplete = Boolean(
          p.education_level && p.city && p.state && (p.career_interests?.length > 0)
        );
        setData({
          readiness_score:    readiness.score ?? 0,
          cohorts_completed:  readiness.cohorts_completed ?? 0,
          tasks_done:         readiness.tasks_completed ?? 0,
          applications_count: apps.data?.response?.stats?.total ?? 0,
          mentor_sessions:    sessions.data?.response?.total ?? 0,
          profile_complete:   profileComplete,
        });
      })
      .finally(() => setLoading(false));
  }, []);

  const score = data?.readiness_score ?? 0;
  const level = getLevel(score);
  const nextLevel = LEVELS.find(l => l.min > score);

  const done = MILESTONES.filter(m => m.check(data || {}));
  const pending = MILESTONES.filter(m => !m.check(data || {}));
  const pct = Math.round((score / 100) * 100);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 tracking-tight">My Roadmap</h1>
        <p className="text-sm text-slate-500 mt-1">Your personalised career journey — step by step</p>
      </div>

      {/* Score hero */}
      <div className="bg-slate-900 rounded-2xl p-6 mb-6 text-white flex flex-col sm:flex-row items-center gap-6">
        {/* Ring */}
        <div className="relative w-28 h-28 shrink-0">
          <svg className="w-28 h-28 -rotate-90" viewBox="0 0 112 112">
            <circle cx="56" cy="56" r="48" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <circle
              cx="56" cy="56" r="48"
              fill="none" stroke="var(--accent)" strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 48}`}
              strokeDashoffset={`${2 * Math.PI * 48 * (1 - pct / 100)}`}
              style={{ transition: 'stroke-dashoffset 1s ease' }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black">{score}</span>
            <span className="text-xs text-slate-400">/100</span>
          </div>
        </div>

        <div className="flex-1 text-center sm:text-left">
          <p className="text-slate-400 text-sm mb-1">Current Level</p>
          <p className="text-2xl font-bold mb-1">{level.emoji} {level.label}</p>
          <p className="text-slate-400 text-sm leading-relaxed mb-3">{level.desc}</p>
          {nextLevel && (
            <div className="inline-flex items-center gap-2 bg-white/10 rounded-xl px-4 py-2 text-sm">
              <TrendingUp size={14} />
              <span>{nextLevel.min - score} more points → <strong>{nextLevel.label}</strong> {nextLevel.emoji}</span>
            </div>
          )}
        </div>
      </div>

      {/* Stats row */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Cohorts', value: data.cohorts_completed || 0, icon: Users, color: 'bg-purple-50 text-purple-600' },
            { label: 'Tasks Done', value: data.tasks_done || 0, icon: CheckSquare, color: 'bg-emerald-50 text-emerald-600' },
            { label: 'Readiness', value: `${score}%`, icon: TrendingUp, color: 'bg-blue-50 text-blue-600' },
            { label: 'Applications', value: data.applications_count || 0, icon: Briefcase, color: 'bg-amber-50 text-amber-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="p-4 flex items-center gap-3">
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
                <Icon size={16} />
              </div>
              <div>
                <p className="text-lg font-bold text-slate-900 leading-none">{value}</p>
                <p className="text-xs text-slate-400 mt-0.5">{label}</p>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Pending milestones */}
      {pending.length > 0 && (
        <div className="mb-8">
          <p className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs flex items-center justify-center font-bold">{pending.length}</span>
            Next Steps
          </p>
          <div className="space-y-3">
            {pending.map((m, idx) => {
              const Icon = m.icon;
              const c = COLOR[m.color];
              const locked = m.id === 'apply' && score < 65;
              return (
                <Card key={m.id} className="p-4 flex items-center gap-4">
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
                    {locked ? <Lock size={16} className="text-slate-400" /> : <Icon size={18} className={c.icon} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <p className="font-semibold text-slate-900 text-sm">{m.title}</p>
                      {m.pts > 0 && <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${c.badge}`}>+{m.pts} pts</span>}
                    </div>
                    <p className="text-xs text-slate-500 leading-relaxed">{m.desc}</p>
                  </div>
                  {!locked && (
                    <Button variant="secondary" size="sm" className="shrink-0" onClick={() => navigate(m.to)}>
                      {m.action} <ArrowRight size={12} />
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* Completed milestones */}
      {done.length > 0 && (
        <div>
          <p className="text-base font-bold text-slate-900 mb-3 flex items-center gap-2">
            <CheckCircle size={18} className="text-emerald-500" />
            Completed ({done.length})
          </p>
          <div className="space-y-2">
            {done.map((m) => {
              const Icon = m.icon;
              return (
                <Card key={m.id} className="p-3.5 flex items-center gap-3 opacity-70">
                  <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
                    <CheckCircle size={16} className="text-emerald-500" />
                  </div>
                  <p className="text-sm font-medium text-slate-600 line-through">{m.title}</p>
                  {m.pts > 0 && <span className="ml-auto text-xs font-bold text-emerald-600">+{m.pts} pts</span>}
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
