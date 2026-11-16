import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  IndianRupee, TrendingUp, TrendingDown, Users, UserCheck, Wallet,
  AlertTriangle, ShieldCheck, Percent, ArrowUpRight, Repeat, RotateCcw,
} from 'lucide-react';
import { superApi } from '../../services/api';
import {
  Card, PageHeader, SectionTitle, Skeleton, Button,
} from '../../components/ui/index.jsx';
import { ErrorState } from '../../components/ui/Overlays.jsx';

/**
 * The founder's screen: is this business working.
 *
 * Deliberately shares no numbers with the admin dashboard. Admin answers "what
 * do I do today" with queues; this answers "is this working" with money and
 * trend. Two consoles showing the same tiles would make one of them redundant,
 * which is the flaw in the older super-admin screens that mirror admin.
 *
 * The tile that matters most is outstanding liability — money in the platform's
 * bank that belongs to achievers. Revenue read without it flatters the
 * business, because a good month also means a bigger debt.
 */

const inr = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function Delta({ pct }) {
  // Null means no baseline, not zero growth. A first month should not read as
  // a failure because there was nothing to compare against.
  if (pct === null || pct === undefined) {
    return <span className="text-xs text-slate-400">no prior month</span>;
  }
  const up = pct >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
      up ? 'text-emerald-600' : 'text-red-600'}`}>
      <Icon size={13} />
      {up ? '+' : ''}{pct}%
    </span>
  );
}

function Metric({ icon: Icon, label, value, sub, delta, tone = 'slate', href }) {
  const tones = {
    slate:   'bg-slate-50 text-slate-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    amber:   'bg-amber-50 text-amber-600',
    blue:    'bg-blue-50 text-blue-600',
    red:     'bg-red-50 text-red-600',
  };
  const body = (
    <Card className="p-4 h-full">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
          <p className="text-2xl font-black text-slate-900 mt-1 tabular-nums">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-1">{sub}</p>}
          {delta !== undefined && <div className="mt-1.5"><Delta pct={delta} /></div>}
        </div>
        {Icon && (
          <div className={`w-9 h-9 rounded-xl grid place-items-center shrink-0 ${tones[tone]}`}>
            <Icon size={17} />
          </div>
        )}
      </div>
    </Card>
  );
  return href ? <Link to={href} className="block h-full">{body}</Link> : body;
}

export default function SuperBusinessDashboard() {
  const [d, setD]             = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data } = await superApi.get('/skovo-platform-owner/business-dashboard');
      if (data?.bool) setD(data.response); else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-28" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }
  if (failed || !d) return <ErrorState onRetry={load} />;

  const { revenue, liability, growth, unit_economics: ue, governance: gov } = d;

  return (
    // p-4 sm:p-6 matches every other console page. Without it the content
    // sits flush against the sidebar and slides under it on a narrow window.
    <div className="p-4 sm:p-6 space-y-6">
      <PageHeader
        title="Business"
        subtitle="Revenue, what the platform owes, and whether it is growing."
      />

      {/* Anything needing the owner personally, before the numbers. */}
      {gov.admins_pending > 0 && (
        <Card className="p-4 border-amber-200 bg-amber-50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <ShieldCheck size={20} className="text-amber-600 shrink-0" />
              <div>
                <p className="font-semibold text-amber-900">
                  {gov.admins_pending} admin {gov.admins_pending === 1 ? 'account is' : 'accounts are'} waiting for approval
                </p>
                <p className="text-sm text-amber-800">
                  Nobody else can approve these.
                </p>
              </div>
            </div>
            <Link to="/skovo-platform-owner/admin-approvals">
              <Button variant="primary" size="sm">Review</Button>
            </Link>
          </div>
        </Card>
      )}

      {/* ── Money ─────────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Money</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric icon={IndianRupee} tone="emerald"
                  label="Revenue this month" value={inr(revenue.month)}
                  sub={`${inr(revenue.prev_month)} last month`}
                  delta={revenue.growth_pct} />
          <Metric icon={Percent} tone="blue"
                  label="Platform cut" value={inr(revenue.platform_cut)}
                  sub={revenue.take_rate_pct !== null
                    ? `${revenue.take_rate_pct}% effective take rate`
                    : 'no sales yet'} />
          {/* The number a founder should see next to revenue, not buried. */}
          <Metric icon={Wallet} tone="amber"
                  label="Owed to achievers" value={inr(liability.outstanding)}
                  sub={`${inr(liability.payouts_pending)} requested`} />
          <Metric icon={ArrowUpRight}
                  label="Paid out this month" value={inr(liability.paid_out_month)}
                  sub={`${inr(revenue.all_time)} revenue all time`} />
        </div>
      </div>

      {/* ── Growth ────────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Growth</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric icon={Users} label="Students" value={growth.students_total}
                  sub={`+${growth.students_month} this month`}
                  delta={growth.students_growth_pct} />
          <Metric icon={UserCheck} tone="emerald"
                  label="Paying students" value={growth.students_paying}
                  sub={`${growth.conversion_pct}% of all students`} />
          <Metric icon={TrendingUp} label="Sessions this month"
                  value={growth.sessions_month}
                  delta={growth.sessions_growth_pct} />
          <Metric icon={ShieldCheck} label="Active achievers"
                  value={growth.achievers.active}
                  sub={`${growth.achievers.probation} in probation · ${growth.achievers.pending} applying`} />
        </div>
      </div>

      {/* ── Unit economics ────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Unit economics</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric label="Average order value" value={inr(ue.avg_order_value)} />
          <Metric label="Revenue per paying student"
                  value={inr(ue.revenue_per_paying_student)} />
          <Metric icon={Repeat} tone="emerald"
                  label="Repeat booking rate" value={`${ue.repeat_rate_pct}%`}
                  sub="students who booked more than once" />
          <Metric icon={RotateCcw}
                  tone={ue.refund_rate_pct > 5 ? 'red' : 'slate'}
                  label="Refund rate" value={`${ue.refund_rate_pct}%`}
                  sub={ue.refund_rate_pct > 5 ? 'higher than it should be' : undefined} />
        </div>
      </div>

      {/* ── Governance ────────────────────────────────────────────────────── */}
      <div>
        <SectionTitle>Governance</SectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
          <Metric icon={ShieldCheck} label="Active admins" value={gov.admins_active}
                  href="/skovo-platform-owner/admin-approvals" />
          <Metric icon={AlertTriangle}
                  tone={gov.admins_pending ? 'amber' : 'slate'}
                  label="Awaiting approval" value={gov.admins_pending}
                  href="/skovo-platform-owner/admin-approvals" />
          <Metric label="Suspended admins" value={gov.admins_suspended} />
          <Metric icon={Percent} label="Commission"
                  value={`${gov.commission_pct}%`}
                  sub={`achievers keep ${(100 - gov.commission_pct).toFixed(0)}%`} />
        </div>
      </div>
    </div>
  );
}
