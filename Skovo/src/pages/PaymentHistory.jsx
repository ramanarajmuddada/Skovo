import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  Receipt, CheckCircle2, RotateCcw, Clock, XCircle, AlertCircle,
  IndianRupee, Calendar, Tag,
} from 'lucide-react';
import { api } from '../services/api';
import { Card, PageHeader, EmptyState, SkeletonCard, ErrorState, StudentPage } from '../components/ui/index.jsx';

/**
 * Every payment this student has made, and what happened to it.
 *
 * Built because a refund had nowhere to appear. The money left, the session was
 * cancelled, and the only trace was a changed badge on the booking — so the
 * question "did I actually get my money back" had no screen that answered it.
 * Refund state is therefore the most prominent thing on a refunded row, not a
 * detail behind a click.
 *
 * Amounts come from payment_orders.gross, which despite the name is the sum
 * actually charged (the order is opened with rate-minus-discount). The list
 * price is shown only where a discount was applied, so a normal purchase reads
 * as one number rather than a fake strikethrough.
 */

const inr = n =>
  '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

const when = iso => {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Each status says what it means for the student's money, not what the payment
// system calls it. "expired" is the one that needs translating most: nobody
// knows what an expired order is, but everyone understands they were not charged.
const STATUS = {
  paid:      { label: 'Paid',      Icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
               note: null },
  settled:   { label: 'Paid',      Icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-700 border-emerald-200',
               note: null },
  refunded:  { label: 'Refunded',  Icon: RotateCcw,    cls: 'bg-blue-50 text-blue-700 border-blue-200',
               note: 'Back to the account you paid from. Banks usually take 5–7 working days.' },
  pending:   { label: 'Pending',   Icon: Clock,        cls: 'bg-amber-50 text-amber-700 border-amber-200',
               note: 'Still confirming with the bank. If money left your account it will either complete or be returned automatically.' },
  failed:    { label: 'Failed',    Icon: XCircle,      cls: 'bg-red-50 text-red-700 border-red-200',
               note: 'You were not charged. If your bank shows a debit it is a hold, and it drops off on its own.' },
  expired:   { label: 'Not paid',  Icon: XCircle,      cls: 'bg-slate-100 text-slate-600 border-slate-200',
               note: 'The checkout timed out before payment completed. You were not charged.' },
};

function StatusChip({ status }) {
  const s = STATUS[status] || { label: status, Icon: AlertCircle, cls: 'bg-slate-100 text-slate-600 border-slate-200' };
  const { Icon } = s;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-lg border ${s.cls}`}>
      <Icon size={12} /> {s.label}
    </span>
  );
}

function SummaryStrip({ summary }) {
  if (!summary || !summary.orders) return null;
  const tiles = [
    { label: 'Total paid', value: inr(summary.total_paid), tone: 'text-slate-900' },
    ...(summary.total_refunded > 0
      ? [{ label: 'Refunded', value: inr(summary.total_refunded), tone: 'text-blue-700' }]
      : []),
    ...(summary.pending > 0
      ? [{ label: 'Pending', value: summary.pending, tone: 'text-amber-700' }]
      : []),
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5">
      {tiles.map(t => (
        <Card key={t.label} className="p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{t.label}</p>
          <p className={`text-xl font-black mt-1 tabular-nums ${t.tone}`}>{t.value}</p>
        </Card>
      ))}
    </div>
  );
}

function OrderRow({ o }) {
  const meta = STATUS[o.status];
  const paidOn = when(o.paid_at) || when(o.created_at);
  const partial = o.status === 'refunded' && o.refunded_amount > 0 && o.refunded_amount < o.amount;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-slate-900 truncate">{o.label}</p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-slate-500">
            {paidOn && (
              <span className="inline-flex items-center gap-1">
                <Calendar size={11} /> {paidOn}
              </span>
            )}
            <span className="font-mono text-[11px] text-slate-400">{o.order_no}</span>
            {o.coupon_code && (
              <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                <Tag size={11} /> {o.coupon_code}
              </span>
            )}
          </div>
        </div>

        <div className="text-right shrink-0">
          <p className={`font-bold tabular-nums ${o.status === 'refunded' ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
            {inr(o.amount)}
          </p>
          {o.discount > 0 && (
            <p className="text-[11px] text-slate-400 tabular-nums">
              <span className="line-through">{inr(o.list_price)}</span> list
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2 mt-3 flex-wrap">
        <StatusChip status={o.status} />
        {/* A partial refund is the case people query most, so it says the
            number rather than leaving them to subtract. */}
        {partial && (
          <span className="text-xs font-semibold text-blue-700">
            {inr(o.refunded_amount)} of {inr(o.amount)} returned
          </span>
        )}
      </div>

      {meta?.note && (
        <p className="text-xs text-slate-500 mt-2 leading-relaxed">{meta.note}</p>
      )}

      {/* Only shown when the gateway gave a reason worth passing on. */}
      {o.status === 'failed' && o.reason && (
        <p className="text-xs text-red-600 mt-1.5">{o.reason}</p>
      )}
    </Card>
  );
}

export default function PaymentHistory() {
  const [orders,  setOrders]  = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data } = await api.get('/payments/history', { limit: 100 });
      if (data?.bool) {
        setOrders(data.response.orders || []);
        setSummary(data.response.summary || null);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount. The rule flags setState inside an effect, but loading data
  // for a screen is exactly what an effect is for, and the codebase already
  // takes this exemption in useAdminConsole.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <StudentPage narrow className="space-y-3">
        <SkeletonCard /><SkeletonCard /><SkeletonCard />
      </StudentPage>
    );
  }

  if (failed) {
    return (
      <StudentPage narrow>
        <ErrorState title="Could not load your payments" onRetry={load} />
      </StudentPage>
    );
  }

  return (
    <StudentPage narrow>
      <PageHeader
        title="Payments"
        subtitle="Every payment you have made, and where each one stands."
      />

      <SummaryStrip summary={summary} />

      {orders.length === 0 ? (
        <Card className="mt-4">
        <EmptyState
          icon={Receipt}
          title="No payments yet"
          subtitle="Sessions and cohorts you pay for will appear here, along with any refunds."
          action={
            <Link to="/find-mentors"
                  className="inline-flex items-center gap-2 min-h-11 px-5 text-white font-semibold rounded-xl text-sm"
                  style={{ backgroundColor: 'var(--accent)' }}>
              <IndianRupee size={15} /> Find an achiever
            </Link>
          }
        />
        </Card>
      ) : (
        <div className="space-y-3">
          {orders.map(o => <OrderRow key={o.id} o={o} />)}
        </div>
      )}
    </StudentPage>
  );
}
