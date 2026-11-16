import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Users, UserCheck, BookOpen, ShieldCheck, ShieldAlert, ArrowRight, CalendarDays, TrendingUp, Activity } from 'lucide-react';

/* Simple inline bar chart — no library needed */
function BarChart({ data = [], color = '#7c3aed', height = 80 }) {
  if (!data.length) return null;
  const max = Math.max(...data.map(d => d.value), 1);
  return (
    <div className="flex items-end gap-1" style={{ height }}>
      {data.map((d, i) => {
        const pct = (d.value / max) * 100;
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
            <div className="absolute -top-7 left-1/2 -translate-x-1/2 hidden group-hover:flex bg-slate-900 text-white text-[10px] font-bold px-2 py-1 rounded-lg whitespace-nowrap z-10">
              {d.label}: {d.value}
            </div>
            <div
              className="w-full rounded-t-md transition-all"
              style={{ height: `${pct}%`, minHeight: d.value > 0 ? 3 : 0, backgroundColor: color, opacity: 0.75 + (i / data.length) * 0.25 }}
            />
            {data.length <= 12 && (
              <p className="text-[10px] text-slate-400 truncate w-full text-center">{d.label}</p>
            )}
          </div>
        );
      })}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, accent, to }) {
  const accents = {
    violet:  { bg: 'bg-violet-600',  ring: 'ring-violet-100' },
    emerald: { bg: 'bg-emerald-600', ring: 'ring-emerald-100' },
    amber:   { bg: 'bg-amber-500',   ring: 'ring-amber-100' },
    blue:    { bg: 'bg-blue-600',    ring: 'ring-blue-100' },
    slate:   { bg: 'bg-slate-600',   ring: 'ring-slate-100' },
  };
  const a = accents[accent] || accents.violet;
  const card = (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center gap-4 hover:shadow-md transition-shadow">
      <div className={`w-12 h-12 rounded-xl ${a.bg} ring-4 ${a.ring} flex items-center justify-center shrink-0`}>
        <Icon size={20} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-2xl font-black text-slate-900">{value ?? '--'}</p>
        <p className="text-xs font-semibold text-slate-500 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
  return to ? <Link to={to}>{card}</Link> : card;
}

export default function SuperDashboard() {
  const navigate = useNavigate();
  const [stats, setStats]   = useState(null);
  const [trends, setTrends] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [statsRes, trendsRes] = await Promise.allSettled([
        superApi.get('/skovo-platform-owner/stats'),
        superApi.get('/skovo-platform-owner/stats/trends'),
      ]);
      if (statsRes.status === 'fulfilled') {
        if (statsRes.value.status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (statsRes.value.data.bool) setStats(statsRes.value.data.response);
      }
      if (trendsRes.status === 'fulfilled' && trendsRes.value.data.bool) {
        setTrends(trendsRes.value.data.response);
      }
    } catch {}
    setLoading(false);
  }

  const s = stats;

  return (
    <div className="p-4 sm:p-6 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900">Founder Dashboard</h1>
        <p className="text-slate-500 text-sm mt-1">Platform overview for SKOVO student guidance</p>
      </div>

      {/* Stat Cards */}
      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 h-24 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatCard label="Total Students"  value={s?.users?.total}   icon={Users}       accent="violet"  sub="Registered on platform" to="/skovo-platform-owner/users" />
          <StatCard label="Achievers"        value={s?.mentors?.total} icon={UserCheck}   accent="emerald" sub="Guiding students"        to="/skovo-platform-owner/achievers" />
          <StatCard label="Cohorts"         value={s?.cohorts?.total} icon={CalendarDays} accent="amber"  sub="Active learning sessions" to="/skovo-platform-owner/cohorts" />
          <StatCard label="Admin Accounts"  value={s?.admins?.total}  icon={ShieldCheck} accent="blue"    sub="Platform managers"       to="/skovo-platform-owner/admins" />
        </div>
      )}

      {/* Platform Trends */}
      {(trends || !loading) && (
        <div>
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-2">
            <TrendingUp size={14} /> Platform Trends
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { key: 'user_registrations', label: 'New Students', color: '#7c3aed' },
              { key: 'cohort_enrollments', label: 'Cohort Enrollments', color: '#2563eb' },
              { key: 'opportunity_applications', label: 'Applications', color: '#059669' },
            ].map(({ key, label, color }) => {
              const d = trends?.[key] || [];
              return (
                <div key={key} className="bg-white rounded-2xl border border-slate-200 p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <Activity size={14} style={{ color }} />
                    <p className="text-sm font-bold text-slate-700">{label}</p>
                  </div>
                  {d.length > 0 ? (
                    <BarChart data={d} color={color} height={72} />
                  ) : (
                    <div className="h-18 flex items-center justify-center text-xs text-slate-400 bg-slate-50 rounded-xl py-6">
                      No trend data available yet
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quick Links */}
      <div>
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide mb-3">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {[
            { to: '/skovo-platform-owner/users',   icon: Users,       label: 'Manage Students',  sub: 'View all registered students' },
            { to: '/skovo-platform-owner/achievers', icon: UserCheck,   label: 'Manage Achievers', sub: 'Verify and manage achievers' },
            { to: '/skovo-platform-owner/cohorts',  icon: CalendarDays, label: 'View Cohorts',    sub: 'All learning cohorts' },
            { to: '/skovo-platform-owner/admins',        icon: ShieldCheck, label: 'Manage Admins',    sub: 'Control admin access' },
            { to: '/skovo-platform-owner/opportunities', icon: BookOpen,    label: 'Opportunities',    sub: 'Manage platform-wide jobs' },
            { to: '/skovo-platform-owner/audit',         icon: ShieldAlert, label: 'Audit Log',        sub: 'Monitor all platform activity' },
          ].map(({ to, icon: Icon, label, sub }) => (
            <Link key={to} to={to}
              className="bg-white rounded-2xl border border-slate-200 p-5 flex items-center justify-between hover:border-violet-300 hover:shadow-md transition-all group">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-violet-50 flex items-center justify-center shrink-0">
                  <Icon size={18} className="text-violet-600" />
                </div>
                <div>
                  <p className="font-bold text-slate-900 text-sm">{label}</p>
                  <p className="text-xs text-slate-400">{sub}</p>
                </div>
              </div>
              <ArrowRight size={16} className="text-slate-300 group-hover:text-violet-500 transition-colors shrink-0" />
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
