import React, { useEffect, useState } from 'react';
import { adminApi } from '../../services/api';
import { BarChart2, TrendingUp, Users, BookOpen, Star, Loader2, RefreshCw, IndianRupee, Percent } from 'lucide-react';
import StatTile from '../../components/admin/StatTile';

/* ── v1 success metrics (spec §8 / Appendix A) ─────────────────────────────── */
function MetricCard({ label, value, sub, target, met }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
      <p className="text-xl sm:text-2xl font-black text-slate-900 tabular-nums mt-2 leading-none">{value}</p>
      {target != null && (
        <p className={`text-xs mt-1 font-semibold ${met ? 'text-emerald-600' : 'text-slate-400'}`}>
          {met ? '✓ ' : ''}Target {target}
        </p>
      )}
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function V1Metrics({ v1 }) {
  const { score_distribution: sd, unlock_rate: ur, hub_application_rate: har, engagement: eng, pro } = v1;
  const maxBucket = Math.max(1, ...sd.buckets.map((b) => b.count));

  return (
    <div className="space-y-4">
      <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wide">v1 Success Metrics</h2>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <MetricCard label="Pro subscribers" value={pro.active_subscribers}
          sub={`${pro.conversion_rate}% of students`} />
        <MetricCard label="Est. MRR" value={`₹${(pro.mrr_estimate || 0).toLocaleString('en-IN')}`}
          sub="live subscriptions" />
        <MetricCard label="Score ≥60 unlock" value={`${ur.rate}%`}
          target={`${ur.target}%`} met={ur.rate >= ur.target}
          sub={`${ur.unlocked}/${ur.activated} activated`} />
        <MetricCard label="Hub apply rate" value={`${har.rate}%`}
          target={`${har.target}%`} met={har.rate >= har.target}
          sub={`${har.applied_users}/${har.unlocked_users} unlocked`} />
        <MetricCard label="DAU / MAU" value={`${eng.dau_mau}%`}
          target={`${eng.target}%`} met={eng.dau_mau >= eng.target}
          sub={`${eng.dau} / ${eng.mau} users`} />
      </div>

      {/* Score distribution */}
      <div className="bg-white rounded-2xl border border-slate-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-slate-900">Readiness score distribution</h3>
          <span className="text-xs text-slate-400">avg {sd.avg_score} · {sd.total} students</span>
        </div>
        <div className="flex items-end gap-3 h-32">
          {sd.buckets.map((b) => {
            const unlocked = b.label === '60–79' || b.label === '80–100';
            return (
              <div key={b.label} className="flex-1 flex flex-col items-center justify-end h-full">
                <span className="text-xs font-bold text-slate-600 mb-1">{b.count}</span>
                <div className={`w-full rounded-t-lg transition-all ${unlocked ? 'bg-emerald-500' : 'bg-blue-400'}`}
                     style={{ height: `${Math.round((b.count / maxBucket) * 100)}%`, minHeight: b.count ? 4 : 0 }} />
                <span className="text-[11px] text-slate-400 mt-1.5">{b.label}</span>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-400 mt-3">
          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1" />
          Green bars = students who have unlocked the Opportunity Hub (score ≥ {ur.floor}).
        </p>
      </div>
    </div>
  );
}

export default function AdminAnalytics() {
  const [data,    setData]    = useState(null);
  const [v1,      setV1]      = useState(null);
  const [loading, setLoading] = useState(true);
  const [days,    setDays]    = useState(30);

  const load = (d = days) => {
    setLoading(true);
    adminApi.get('/skovo-platform-panel-admin/analytics', { days: d })
      .then(({ data: res }) => { if (res.bool) setData(res.response); })
      .catch(() => {})
      .finally(() => setLoading(false));
    // v1 success metrics (spec §8) — independent of the day range.
    adminApi.get('/skovo-platform-panel-admin/analytics/v1-metrics')
      .then(({ data: res }) => { if (res.bool) setV1(res.response); })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const handleDaysChange = (d) => { setDays(d); load(d); };

  if (loading) return (
    <div className="p-6 flex justify-center py-20">
      <Loader2 size={28} className="animate-spin text-slate-400" />
    </div>
  );

  if (!data) return (
    <div className="p-6 text-center text-slate-400 py-20">
      <BarChart2 size={36} className="mx-auto mb-3 text-slate-300" />
      <p className="font-semibold">Failed to load analytics</p>
    </div>
  );

  const { cohort_funnel, events, daily_signups, top_cohorts, mentor_utilisation, session_statuses } = data;

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Platform Analytics</h1>
          <p className="text-sm text-slate-500 mt-0.5">Event tracking, enrollment funnels, and mentor utilisation</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Period: a segmented control, like every other admin filter. */}
          <div role="group" aria-label="Period" className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-slate-100">
            {[7, 14, 30, 90].map(d => (
              <button key={d} type="button" onClick={() => handleDaysChange(d)} aria-pressed={days === d}
                className={`px-3 min-h-9 rounded-lg text-xs font-semibold ${days === d ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {d}d
              </button>
            ))}
          </div>
          <button onClick={() => load()} aria-label="Reload" className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50">
            <RefreshCw size={15} />
          </button>
        </div>
      </div>

      {/* v1 success metrics (spec §8) */}
      {v1 && <V1Metrics v1={v1} />}

      {/* Funnel stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Cohorts" value={cohort_funnel?.total_cohorts} icon={BookOpen} tone="blue" to="/skovo-platform-panel-admin/cohorts" />
        <StatTile label="Enrollments" value={cohort_funnel?.total_enrollments} icon={Users} tone="violet" to="/skovo-platform-panel-admin/bookings" />
        <StatTile label="Paid enrollments" value={cohort_funnel?.paid_enrollments} icon={IndianRupee} tone="emerald" />
        <StatTile label="Conversion" value={`${cohort_funnel?.conversion_rate ?? 0}%`} icon={Percent} tone="amber"
          sub={`${cohort_funnel?.free_enrollments ?? 0} free enrollments`} />
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Top cohorts */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <BookOpen size={15} style={{ color: 'var(--accent)' }} />
            <p className="font-bold text-slate-900 text-sm">Top Cohorts by Enrollment</p>
          </div>
          {(top_cohorts || []).length === 0 ? (
            <p className="text-center text-slate-400 py-10 text-sm">No data yet</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {(top_cohorts || []).map((c, i) => (
                <div key={c.id} className="flex items-center gap-3 px-5 py-3">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <p className="flex-1 text-sm font-medium text-slate-800 truncate">{c.title}</p>
                  <span className="text-sm font-bold" style={{ color: 'var(--accent)' }}>{c.enrolled}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Mentor utilisation */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Star size={15} style={{ color: 'var(--accent)' }} />
            <p className="font-bold text-slate-900 text-sm">Mentor Session Utilisation</p>
          </div>
          {(mentor_utilisation || []).length === 0 ? (
            <p className="text-center text-slate-400 py-10 text-sm">No data yet</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {(mentor_utilisation || []).map((m, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <div className="w-7 h-7 rounded-full text-white text-xs font-bold flex items-center justify-center shrink-0"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {m.name?.charAt(0) || 'A'}
                  </div>
                  <p className="flex-1 text-sm font-medium text-slate-800 truncate">{m.name}</p>
                  <span className="text-xs font-semibold text-slate-500">{m.sessions} sessions</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Event counts */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <TrendingUp size={15} style={{ color: 'var(--accent)' }} />
            <p className="font-bold text-slate-900 text-sm">Top Events (last {days} days)</p>
          </div>
          {(events || []).length === 0 ? (
            <p className="text-center text-slate-400 py-10 text-sm">No events tracked yet</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {(events || []).map((e, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-3">
                  <p className="flex-1 text-sm font-mono text-slate-600 truncate">{e.type}</p>
                  <span className="text-sm font-bold text-slate-800">{e.count}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Session statuses */}
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
            <Users size={15} style={{ color: 'var(--accent)' }} />
            <p className="font-bold text-slate-900 text-sm">Session Status Breakdown</p>
          </div>
          {(session_statuses || []).length === 0 ? (
            <p className="text-center text-slate-400 py-10 text-sm">No sessions yet</p>
          ) : (
            <div className="divide-y divide-slate-50">
              {(session_statuses || []).map((s, i) => {
                const color = { pending: 'bg-amber-100 text-amber-700', confirmed: 'bg-blue-100 text-blue-700', completed: 'bg-emerald-100 text-emerald-700', cancelled: 'bg-slate-100 text-slate-500' };
                return (
                  <div key={i} className="flex items-center gap-3 px-5 py-3">
                    <span className={`px-2.5 py-0.5 rounded-full text-xs font-semibold capitalize ${color[s.status] || 'bg-slate-100 text-slate-500'}`}>{s.status}</span>
                    <span className="ml-auto text-sm font-bold text-slate-800">{s.count}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Daily signups */}
      {(daily_signups || []).length > 0 && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <p className="font-bold text-slate-900 text-sm">Daily Signups (last 14 days)</p>
          </div>
          <div className="p-5">
            <div className="flex items-end gap-2 h-24">
              {(() => {
                const max = Math.max(...daily_signups.map(d => d.count), 1);
                return daily_signups.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div className="w-full rounded-t-sm transition-all"
                      style={{ height: `${(d.count / max) * 80}px`, backgroundColor: 'var(--accent)', opacity: 0.85 }} />
                    <span className="text-[9px] text-slate-400 truncate w-full text-center">
                      {new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </span>
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
