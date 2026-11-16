/**
 * Cancellation rules shown before a student pays (cohort or 1-on-1).
 *
 * The rows come from admin's rules (Wallet & refunds > Cancellation rules),
 * with the real rupee amount for this price, exact to the paisa. The same
 * rules are saved with the booking at payment, so what is shown here is what
 * applies if the student cancels later.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarX2 } from 'lucide-react';
import { api } from '../../services/api';
import { ruleLabel, refundOf } from '../../utils/refundRules';

// Paise shown, never rounded (Rs 2.50, not Rs 3).
const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;

export default function CancellationRules({ kind = 'cohort', price }) {
  const [rules, setRules] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`/bookings/refund-rules?kind=${kind}`)
      .then(({ data }) => { if (alive) setRules(data?.bool ? data.response.rules : []); })
      .catch(() => { if (alive) setRules([]); });
    return () => { alive = false; };
  }, [kind]);

  if (!rules || !rules.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 space-y-2">
      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
        <CalendarX2 size={15} className="shrink-0" /> If you cancel
      </p>
      <ul className="space-y-1">
        {rules.map((r, i) => (
          <li key={r.min_hours} className="flex items-baseline justify-between gap-3">
            <span className="min-w-0">{ruleLabel(rules, i)}</span>
            <span className={`shrink-0 tabular-nums font-semibold ${r.pct > 0 ? 'text-emerald-700' : 'text-slate-500'}`}>
              {r.pct > 0 ? `${inr(refundOf(price, r.pct))} back` : 'No refund'}
            </span>
          </li>
        ))}
      </ul>
      <p>Refunds go to your SKOVO Wallet instantly. If the achiever cancels, changes the time or doesn't start the class, you get 100% back.</p>
      <p className="text-slate-500">
        By paying you agree to these rules and the <Link to="/refund" className="underline">Refund Policy</Link>.
      </p>
    </div>
  );
}
