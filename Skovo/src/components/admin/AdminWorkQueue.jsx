import React from 'react';
import { Link } from 'react-router-dom';
import {
  FileText, ShieldCheck, Wallet, RotateCcw, CheckCircle2, ArrowRight,
  Users, IndianRupee, AlertTriangle, TrendingDown, Activity, Video, UserPlus, Send,
} from 'lucide-react';
import { Card, SectionTitle } from '../ui/index.jsx';
import StatTile from './StatTile';

/**
 * The admin dashboard's opening section: what needs a person today.
 *
 * Queues before statistics, deliberately. An admin opening the console is
 * asking "what do I do now", not "how are we doing" — that is the super-admin's
 * question, and its dashboard answers it with money and trend instead.
 *
 * Every row links straight into the work. A count that cannot be acted on from
 * where it is shown just becomes something to scroll past.
 */

// Paise shown, never rounded (Rs 7.50 stayed Rs 8 here).
const inr = n => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 });

const QUEUE_ICON = {
  documents: FileText,
  probation: ShieldCheck,
  payouts:   Wallet,
  refunds:   RotateCcw,
};

export function WorkQueue({ queues, total }) {
  // Nothing waiting means nothing to show. An "all clear" card occupies the
  // top of the dashboard every day the queues happen to be empty, which is
  // most days — and a banner that is almost always present is one people stop
  // reading, including on the day it changes.
  if (!total) return null;

  const active = queues.filter(q => q.count > 0);

  return (
    <Card className="overflow-hidden">
      <div className="px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
        <Activity size={16} className="text-amber-600" />
        <h2 className="font-bold text-slate-900">Needs you now</h2>
        <span className="ml-auto text-xs font-semibold text-white bg-amber-500 rounded-full px-2 py-0.5">
          {total}
        </span>
      </div>

      <ul className="divide-y divide-slate-100">
        {active.map(q => {
          const Icon = QUEUE_ICON[q.key] || FileText;
          return (
            <li key={q.key}>
              <Link to={q.href}
                    className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 grid place-items-center shrink-0">
                  <Icon size={17} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-900">{q.label}</p>
                  {q.amount ? (
                    <p className="text-xs text-slate-500">{inr(q.amount)} total</p>
                  ) : null}
                </div>
                <span className="text-2xl font-black text-slate-900 tabular-nums">{q.count}</span>
                <ArrowRight size={16} className="text-slate-300 shrink-0" />
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function TodayStrip({ today, prev, vs, title = 'Today' }) {
  const d = (k) => (prev ? Number(today[k] || 0) - Number(prev[k] || 0) : null);
  const items = [
    { label: 'Sessions', value: today.sessions, icon: Video, tone: 'violet', to: '/skovo-platform-panel-admin/bookings?tab=sessions',
      sub: `${today.sessions_done} done${today.no_shows ? ` · ${today.no_shows} no-show` : ''}`,
      delta: vs && { by: d('sessions'), vs } },
    { label: 'New students',  value: today.new_students, icon: UserPlus, tone: 'blue', to: '/skovo-platform-panel-admin/users',
      delta: vs && { by: d('new_students'), vs } },
    { label: 'Applications',  value: today.new_applications, icon: Send, tone: 'amber',
      delta: vs && { by: d('new_applications'), vs } },
    { label: 'Revenue',       value: inr(today.revenue), icon: IndianRupee, tone: 'emerald', to: '/skovo-platform-panel-admin/payments',
      delta: vs && { by: d('revenue'), vs } },
  ];
  return (
    <div>
      <SectionTitle>{title}</SectionTitle>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {items.map(i => <StatTile key={i.label} {...i} />)}
      </div>
    </div>
  );
}

// Small tag saying which time window a number covers — the chosen period,
// "Live", or "All time" — so the date filter's reach is visible on the card.
export function ScopeTag({ children }) {
  return (
    <span className="text-[11px] font-semibold normal-case tracking-normal px-2 py-0.5 rounded-full
                     bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-slate-300">
      {children}
    </span>
  );
}

// `period` names the dashboard's date filter ("Today", "Last year", …). Each
// alert carries a small tag saying whether it follows that filter or is live,
// so nobody expects a stuck payment to disappear by picking another range.
export function HealthPanel({ health, totals, period = 'In this period' }) {
  // Only surfaced when actually wrong. A row of green ticks trains people to
  // stop reading the panel, and then they miss the one red line that mattered.
  const problems = [];

  if (health.stuck_orders > 0) {
    problems.push({
      tone: 'red', Icon: AlertTriangle,
      label: `${health.stuck_orders} payment${health.stuck_orders === 1 ? '' : 's'} stuck`,
      detail: 'Past their hold and not reconciled — the background job may not be running.',
      scope: 'Live',
    });
  }
  if (health.achievers_at_risk > 0) {
    problems.push({
      tone: 'amber', Icon: TrendingDown,
      label: `${health.achievers_at_risk} achiever${health.achievers_at_risk === 1 ? '' : 's'} at risk`,
      detail: 'Rating below 3.5 across five or more sessions.',
      scope: 'Live',
    });
  }
  if (health.failed_payments > 0) {
    problems.push({
      tone: 'amber', Icon: RotateCcw,
      label: `${health.failed_payments} failed payment${health.failed_payments === 1 ? '' : 's'}`,
      detail: 'Students who tried to pay and could not.',
      scope: period,
    });
  }
  if (health.no_show_pct > 10) {
    problems.push({
      tone: 'amber', Icon: TrendingDown,
      label: `${health.no_show_pct}% no-show rate`,
      detail: 'Above 10% is worth investigating.',
      scope: period,
    });
  }

  const tones = {
    red:   'bg-red-50 border-red-200 text-red-900',
    amber: 'bg-amber-50 border-amber-200 text-amber-900',
  };

  return (
    <div>
      <SectionTitle>Platform health</SectionTitle>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 items-start">
        <div className="lg:col-span-2 space-y-2.5">
          {problems.length === 0 ? (
            <Card className="p-4">
              <div className="flex items-start gap-3">
                <span className="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
                  <CheckCircle2 size={18} />
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-900">All clear</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    No stuck payments, no at-risk achievers, no failed payments ({period}).
                  </p>
                </div>
              </div>
            </Card>
          ) : problems.map((p, i) => (
            <Card key={i} className={`p-4 ${tones[p.tone]}`}>
              <div className="flex items-start gap-3">
                <p.Icon size={18} className="shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="text-sm font-semibold">{p.label}</p>
                    <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-white/70 dark:bg-white/10 border border-current/20">
                      {p.scope}
                    </span>
                  </div>
                  <p className="text-xs opacity-80 mt-0.5">{p.detail}</p>
                </div>
              </div>
            </Card>
          ))}
        </div>

        <Card className="p-4">
          <div className="flex items-center justify-between gap-2 mb-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Platform</p>
            <ScopeTag>All time</ScopeTag>
          </div>
          <div className="-mx-2">
            {[
              { Icon: ShieldCheck, label: 'Active achievers',  value: totals.achievers_active, to: '/skovo-platform-panel-admin/achievers' },
              { Icon: ShieldCheck, label: 'In probation',       value: totals.achievers_probation, to: '/skovo-platform-panel-admin/achievers' },
              { Icon: Users,       label: 'Students',           value: totals.students, to: '/skovo-platform-panel-admin/users' },
            ].map(r => (
              <Link key={r.label} to={r.to} className="flex items-center gap-2.5 min-h-10 px-2 rounded-lg hover:bg-slate-50">
                <r.Icon size={15} className="text-slate-400 shrink-0" />
                <span className="text-sm text-slate-600 flex-1">{r.label}</span>
                <span className="text-sm font-bold text-slate-900 tabular-nums">{r.value}</span>
                <ArrowRight size={14} className="text-slate-300 shrink-0" />
              </Link>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
