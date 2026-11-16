import useCompany from '../../hooks/useCompany';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2 } from 'lucide-react';
import PolicyLayout from './PolicyLayout';
import { api } from '../../services/api';
import { val } from '../../config/company';

const UPDATED = '18 October 2026';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function Pricing() {
  const { company: COMPANY } = useCompany();
  const [plans, setPlans] = useState(null);   // null = loading, [] = loaded-empty
  const [perks, setPerks] = useState([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    // Prices come from the public plans endpoint, never hardcoded here — the
    // pricing shown to a regulator or a paying user has to be the live price an
    // admin set, not a copy that can drift (UI01-009).
    api.get('/subscription/plans')
      .then(({ data }) => {
        if (!alive) return;
        if (data?.bool) {
          setPlans(data.response?.plans || []);
          setPerks(data.response?.perks || []);
        } else {
          setError(true);
          setPlans([]);
        }
      })
      .catch(() => { if (alive) { setError(true); setPlans([]); } });
    return () => { alive = false; };
  }, []);

  return (
    <PolicyLayout title="Pricing" updated={UPDATED}>
      <p>
        {val(COMPANY.brand)} is free to start. Browse cohorts and colleges, build your
        readiness score, and get one free cohort seat — no payment needed. SKOVO
        Pro unlocks everything for a single yearly or monthly membership, and
        individual paid cohorts and sessions are priced by the Achiever
        who runs them.
      </p>

      <h2>SKOVO Pro membership</h2>

      {plans === null ? (
        <div className="not-prose flex items-center gap-2 py-6 text-slate-500">
          <Loader2 className="animate-spin" size={18} /> Loading current prices…
        </div>
      ) : plans.length === 0 ? (
        <p className="text-slate-500">
          {error
            ? 'Live pricing is momentarily unavailable — please refresh, or check the Skovo Pro page in the app for current prices.'
            : 'Membership pricing will appear here shortly.'}
        </p>
      ) : (
        <div className="not-prose mt-4 grid gap-4 sm:grid-cols-2">
          {plans.map((p) => {
            const struck = p.effective_price < p.price ? p.price : null;
            return (
              <div key={p.key} className="rounded-2xl border border-slate-200 bg-white p-5">
                <p className="text-sm font-bold uppercase tracking-wide text-indigo-500">{p.label}</p>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-3xl font-black text-slate-900">{inr(p.effective_price)}</span>
                  {struck && <span className="text-sm text-slate-400 line-through">{inr(struck)}</span>}
                </div>
                <p className="mt-1 text-sm text-slate-500">
                  {p.months > 1 ? `${inr(p.effective_monthly)}/month, billed yearly` : 'per month'}
                  {p.offer_label ? ` · ${p.offer_label}` : ''}
                </p>
              </div>
            );
          })}
        </div>
      )}

      {perks.length > 0 && (
        <>
          <h3>What Pro includes</h3>
          <ul className="not-prose mt-2 space-y-2">
            {perks.map((perk, i) => (
              <li key={i} className="flex items-start gap-2 text-slate-700">
                <Check size={16} className="mt-0.5 shrink-0 text-emerald-600" />
                <span>{typeof perk === 'string' ? perk : perk.label || perk.title}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>Paid cohorts and sessions</h2>
      <p>
        Individual cohorts and one-on-one sessions are priced by the
        Achiever offering them, and the price is always shown before you pay. Many
        cohorts are free. SKOVO adds no charge on top of the price you see; the
        platform commission is deducted from the Achiever's settlement, not added
        to your bill.
      </p>

      <h2>Taxes and payment</h2>
      <p>
        Prices are in Indian Rupees (INR). Applicable taxes are charged where
        required by law. Payments are processed securely by our partner Cashfree.
      </p>

      <h2>Refunds</h2>
      <p>
        Cancellations and refunds are governed by our{' '}
        <Link to="/refund">Refund &amp; Cancellation Policy</Link>. Questions?
        See <Link to="/contact">Contact</Link> or the{' '}
        <Link to="/terms">Terms</Link>.
      </p>
    </PolicyLayout>
  );
}
