import React, { useEffect, useRef, useState } from 'react';
import WalletToggle from '../components/v1/WalletToggle';
import { useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { Crown, Check, Loader2, Sparkles, Lock, ArrowRight,
         GraduationCap, Users, Briefcase, Bot, Wrench } from 'lucide-react';
import { api } from '../services/api';
import { openCheckout, confirmOrder, needsPhone } from '../services/payment';
import { PLAN_KEYS, clearPendingPlan } from '../utils/checkoutIntent';
import { StudentPage, Input, Toast } from '../components/ui/index.jsx';
import { LoadError } from '../components/ui/TableComponents';
import { fieldErrors, proCheckout } from '../schemas/student';


/* The six perks, owned by the client.
   These are product copy, not data: this is the one section of the page that
   has to render even when every API call fails, because a Skovo Pro screen
   that cannot say what Pro unlocks has no reason to exist. Sourcing the list
   from the server meant a backend that had not been restarted yet served the
   heading over an empty list — which is exactly what shipped.
   The server still owns LIVE STATE (is it on for me, how much of the free
   allowance is spent); that merges in on top of this by `key`. Keep these keys
   identical to PRO_PERK_DETAILS in Subscription/subscription.py. */
const PERKS = [
  { key: 'cohorts', icon: Users,
    title: 'Unlimited cohorts',
    detail: 'Every paid cohort is covered by your membership — enrol in one tap, no checkout, no limit on how many.',
    route: '/cohorts' },
  { key: 'colleges', icon: GraduationCap,
    title: 'Detailed Colleges with scholarships',
    detail: 'Full college profiles with the scholarships you are eligible for, and an unlimited comparison list.',
    route: '/colleges' },
  { key: 'community', icon: Sparkles,
    title: 'Unlimited community Leads & Creations',
    detail: 'Lead, join and create as many communities as you like — plus direct messages and pinned posts.',
    route: '/assemble' },
  { key: 'opportunities', icon: Briefcase,
    title: 'Personalised Fresh Job Opportunities',
    detail: 'A For You feed ranked against your branch, interests and city, newest roles first — and one-tap apply from your Vault.',
    route: '/opportunities' },
  { key: 'bhaai', icon: Bot,
    title: 'Early BhaAI (Career Agent) Access',
    detail: 'Ask BhaAI about your path and get answers built from your own Skovo data — your score, vault, cohorts and saved colleges.',
    route: '/bhaai' },
  { key: 'career_tools', icon: Wrench,
    title: 'Priority Career Tools access',
    // No number here. The server sends this sentence with the live credit
    // count and overrides the local copy; this text only shows when that call
    // fails, and a hardcoded "2" would be a promise the admin can change.
    detail: 'Unlimited Document Vault, a shareable public profile, priority support and free 1-on-1 sessions every month.',
    route: '/document-vault' },
];

/* A perk line that says what is true for THIS student right now.
   The old list was six static strings — fine as an advert, useless to a member
   who came back to check what their money bought. Each row now carries live
   state: on/locked, the free allowance spent, and a link to the screen where
   the perk is actually used. */
function PerkRow({ perk }) {
  const Icon = perk.icon || Check;
  const on = perk.active;
  const usage = perk.usage;
  const status = on ? perk.pro_label : perk.free_label;
  // A Pro member who still cannot use a perk (Opportunities below the score
  // floor) must not be shown a green tick — that is the one state where the
  // membership is live and the screen behind it is not.
  const held = on && perk.blocked_by_score;

  return (
    <li className="flex items-start gap-3 py-3 border-b border-slate-100 last:border-0">
      <span className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0
                        ${on ? '' : 'bg-slate-100'}`}
        style={on ? { backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' } : undefined}>
        {on
          ? <Icon size={15} />
          : <Lock size={13} className="text-slate-400" />}
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-sm font-semibold text-slate-900">{perk.title}</p>
          {on && !held && (
            <span className="text-[10px] font-black uppercase tracking-wide text-emerald-700
                             bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
              Active
            </span>
          )}
          {held && (
            <span className="text-[10px] font-black uppercase tracking-wide text-amber-700
                             bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
              Waiting on your score
            </span>
          )}
        </div>

        {perk.detail && <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{perk.detail}</p>}

        {status && (
          <p className={`text-xs mt-1.5 font-medium ${on ? 'text-slate-600' : 'text-slate-400'}`}>
            {status}
          </p>
        )}

        {/* Only draw a meter where a free cap actually exists — an unlimited
            Pro allowance has nothing to fill up. */}
        {usage && usage.limit ? (
          <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden mt-2 max-w-xs">
            <div className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${Math.min(100, Math.round(((usage.used || 0) / usage.limit) * 100))}%`,
                backgroundColor: on ? 'var(--accent)' : '#cbd5e1',
              }} />
          </div>
        ) : null}

        {on && perk.route && (
          <Link to={perk.route}
            className="inline-flex items-center justify-center min-h-11 gap-1 text-xs font-bold mt-1"
            style={{ color: 'var(--accent)' }}>
            Use it <ArrowRight size={11} />
          </Link>
        )}
      </div>
    </li>
  );
}

export default function SkovoPro() {
  // The landing page's pricing cards hand off here as
  // /skovo-pro?plan=<key>&checkout=1 — preselect that plan and open checkout
  // straight away, so the card the visitor tapped is the card they pay for.
  const [searchParams, setSearchParams] = useSearchParams();
  const wantedPlan = searchParams.get('plan');
  const autoCheckout = searchParams.get('checkout') === '1';

  const [info, setInfo] = useState(null);
  const [perks, setPerks] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [errs, setErrs] = useState({});
  const [plan, setPlan] = useState(PLAN_KEYS.includes(wantedPlan) ? wantedPlan : 'annual');
  const [coupon, setCoupon] = useState('');
  const [useWallet, setUseWallet] = useState(false);
  const autoFired = useRef(false);

  const load = () => {
    setLoading(true);
    setLoadError('');
    api.get('/subscription/')
      .then(({ data }) => {
        if (data.bool) setInfo(data.response);
        else setLoadError(data.response?.message || 'Could not load membership details.');
      })
      .catch(() => setLoadError('Could not load membership details. Check your connection and try again.'))
      .finally(() => setLoading(false));
    // Separate call on purpose: the perk states read five other modules, so a
    // slow or failing one must not hold up (or blank) the pricing cards. If it
    // never lands the list falls back to the static titles below.
    api.get('/subscription/entitlements')
      .then(({ data }) => { if (data.bool) setPerks(data.response.perks || []); })
      .catch(() => {});
  };
  useEffect(() => { load(); clearPendingPlan(); }, []);

  const [phone, setPhone] = useState('');
  // Cashfree requires a mobile number; SKOVO accounts may lack one.
  const [needPhone, setNeedPhone] = useState(() => needsPhone());

  const subscribe = async (e) => {
    e?.preventDefault?.();
    const parsed = proCheckout({ requirePhone: needPhone }).safeParse({ plan, phone, coupon });
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setErr('');
      return;
    }
    setErrs({});
    setBusy(true); setErr(''); setMsg('');
    try {
      const body = { plan: parsed.data.plan, coupon_code: parsed.data.coupon.trim() || undefined };
      if (parsed.data.phone) body.phone = parsed.data.phone;
      if (useWallet) body.use_wallet = true;

      const { data: opened } = await api.post('/subscription/subscribe', body);
      if (!opened.bool) {
        if (opened.response?.need_phone) {
          setNeedPhone(true);
          setErr('Please add a mobile number to continue.');
        } else {
          setErr(opened.response?.message || 'Could not start checkout.');
        }
        setBusy(false);
        return;
      }

      if (opened.response?.paid_with_wallet) { setMsg(opened.response.message); load(); setBusy(false); return; }
      const { order_id, payment_session_id, mode } = opened.response;

      try {
        await openCheckout({ paymentSessionId: payment_session_id, mode });
      } catch (e) {
        setErr(e.message || 'Could not open the payment window.');
        setBusy(false);
        return;
      }

      // The webhook activates the plan; this only reports what it decided.
      const outcome = await confirmOrder(api, order_id);
      if (outcome.paid) { setMsg('Welcome to Skovo Pro. Your membership is active.'); load(); }
      else if (outcome.pending) setErr('Payment is still being confirmed. Refresh in a moment.');
      else setErr('Payment was not completed.');
      setBusy(false);
    } catch { setErr('Something went wrong.'); setBusy(false); }
  };

  // Hand-off from the landing page's pricing cards: open checkout once, only if
  // they aren't already Pro, and drop the query params first so a refresh — or a
  // dismissed checkout modal — doesn't reopen it behind their back.
  useEffect(() => {
    if (loading || !autoCheckout || autoFired.current) return;
    autoFired.current = true;
    // Off the effect body: StrictMode remounts this component, and the ref guard
    // above already makes the hand-off fire exactly once either way.
    queueMicrotask(() => {
      setSearchParams({}, { replace: true });
      if (!info || !(info.can_buy ?? !info.is_pro)) return;
      subscribe();
    });
  }, [loading, autoCheckout, info]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <div className="h-40 rounded-3xl bg-white border border-slate-100 animate-pulse" />
      <div className="h-72 rounded-2xl bg-white border border-slate-100 animate-pulse" />
    </StudentPage>
  );

  const isPro = info?.is_pro;
  // Free Pro days from Refer & Earn still let a student buy a plan; the days
  // left are added on top of it.
  const canBuy = info?.can_buy ?? !isPro;
  // The list is always the six above; the server only decorates them. An
  // entitlements call that 404s (old backend), errors or is still in flight
  // costs the usage meters and the per-perk status line — never the perks.
  const live = Object.fromEntries((perks || []).map(p => [p.key, p]));
  const perkRows = PERKS.map(p => ({ ...p, ...(live[p.key] || {}), icon: p.icon,
                                     active: live[p.key]?.active ?? !!isPro }));
  const plans = info?.plans || [];
  const selected = plans.find(p => p.key === plan) || plans.find(p => p.key === 'annual');
  const price = selected?.effective_price ?? selected?.price ?? info?.price ?? 1499;
  const sub = info?.subscription;
  const credits = info?.session_credits;

  return (
    <StudentPage className="space-y-5 sm:space-y-6 max-w-6xl">
      <Toast message={msg} type="success" />
      {/* Hero */}
      <div className="rounded-3xl p-5 sm:p-8 text-white relative overflow-hidden"
        style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)' }}>
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <Crown size={28} className="text-yellow-300 shrink-0" />
          <h1 className="text-2xl sm:text-3xl font-black">Skovo Pro</h1>
          {/* Pinned hex, not text-purple-900: this badge carries its own bright
              background, so the dark-mode remap that lightens purple text would
              put pale purple on gold (1.33:1). An arbitrary value is out of that
              rule's reach and reads identically in both themes. */}
          {isPro && <span className="ml-2 text-xs font-bold bg-yellow-300 text-[#581c87] px-3 py-1 rounded-full">ACTIVE</span>}
        </div>
        {isPro ? (
          <>
            <p className="text-white/90 text-lg">
              {info?.referral_pro
                ? 'You have free Pro days from Refer & Earn. Buy a plan to keep Pro; the days you have left are added on.'
                : "You're a Pro member. Everything below is unlocked."}
            </p>
            {sub?.expires_at && (
              <p className="text-white/70 text-sm mt-2">Renews / expires on {new Date(sub.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
            )}
            {credits && (
              <p className="text-white/90 text-sm mt-3 inline-flex items-center gap-2 bg-white/15 px-3 py-1.5 rounded-xl">
                <Sparkles size={14} /> {credits.remaining} of {credits.monthly} free 1-on-1 session credits left this month
              </p>
            )}
          </>
        ) : (
          <p className="text-white/90 text-lg">Unlock everything — pick the plan that fits you below.</p>
        )}
      </div>

      {loadError && (
        <LoadError what="membership details" message={loadError} onRetry={load} />
      )}
      {err && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{err}</div>
      )}

      {/* Desktop: perks on the left, plan + checkout pinned on the right so the
          price is never a long scroll away. Phones and tablets stack as before. */}
      <div className={canBuy ? 'grid gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] items-start' : ''}>
      {/* Perks — live state per perk, not a static advert */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <div className="flex items-baseline justify-between gap-3 mb-1">
          <h2 className="font-bold text-slate-900">What Pro unlocks</h2>
          <span className="text-xs text-slate-400">
            {isPro ? 'All six are live on your account' : 'Where you stand today'}
          </span>
        </div>
        <ul>
          {perkRows.map((p) => <PerkRow key={p.key || p.title} perk={p} />)}
        </ul>
      </div>

      {canBuy && (
      <div className="space-y-4 lg:sticky lg:top-4">
      {/* Plan selection */}
      {plans.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-3">
          {plans.map((p) => {
            const active = p.key === plan;
            return (
              <button key={p.key} type="button" onClick={() => setPlan(p.key)}
                aria-pressed={active}
                className={`relative text-left sm:min-h-[7.5rem] lg:min-h-0 rounded-2xl border-2 p-4 py-3 sm:py-4 lg:py-3 transition-all ${active ? 'bg-white' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                style={active ? { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, transparent)' } : undefined}>
                {p.key === 'annual' && (
                  <span className="absolute -top-2 right-3 text-[10px] font-black text-white px-2 py-0.5 rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}>BEST VALUE</span>
                )}
                <p className="text-sm font-bold text-slate-900">{p.label}</p>
                {p.effective_price < p.price ? (
                  <p className="mt-1">
                    <span className="line-through text-slate-400 text-sm mr-1">₹{p.price.toLocaleString('en-IN')}</span>
                    <span className="text-2xl lg:text-xl font-black text-slate-900">₹{p.effective_price.toLocaleString('en-IN')}</span>
                  </p>
                ) : (
                  <p className="text-2xl lg:text-xl font-black text-slate-900 mt-1 lg:mt-0.5">₹{p.price.toLocaleString('en-IN')}</p>
                )}
                <p className="text-xs text-slate-500 mt-0.5">≈ ₹{p.effective_monthly}/mo</p>
                {p.offer_label && <p className="text-[10px] font-black text-emerald-600 mt-1 uppercase">{p.offer_label}</p>}
              </button>
            );
          })}
        </div>
      )}

      {/* Mobile number — Cashfree requires one and a SKOVO account may not have it.
          This field did not exist: `needPhone` was declared, flipped to true by
          the refusal below, and never rendered. So the screen said "Please add a
          mobile number to continue" over a page with nowhere to add one and no
          link to anywhere that could — a dead end at the exact moment somebody
          was trying to pay. The three other checkout paths (cohort enrol, 1-on-1
          booking, course purchase) have always rendered this; only Pro did not.
          Same markup as those, deliberately, so the four cannot drift. */}
        <form id="pro-checkout" onSubmit={subscribe} noValidate className="space-y-3">
          {needPhone && (
            <Input
              id="pro-phone"
              label="Mobile number"
              required
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter 10-digit mobile number"
              hint="Required by the payment provider for your receipt."
              value={phone}
              onChange={(e) => { setPhone(e.target.value.replace(/\D/g, '').slice(0, 10)); setErrs((x) => ({ ...x, phone: undefined })); }}
              error={errs.phone}
            />
          )}
          <Input
            label="Coupon code"
            placeholder="Enter coupon code"
            value={coupon}
            onChange={(e) => { setCoupon(e.target.value.toUpperCase()); setErrs((x) => ({ ...x, coupon: undefined })); }}
            error={errs.coupon}
            className="tracking-wide uppercase"
          />
          <WalletToggle kind="subscription" checked={useWallet} onChange={setUseWallet} />
          <button type="submit" disabled={busy}
            className="w-full min-h-12 py-4 rounded-2xl text-white font-bold text-base shadow-lg transition-transform hover:scale-[1.01] disabled:opacity-60 flex items-center justify-center gap-2 px-3 text-center"
            style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)' }}>
            {busy ? <Loader2 className="animate-spin" size={20} /> : <Crown size={20} />}
            {busy ? 'Opening checkout…' : `Get Skovo Pro — ₹${price.toLocaleString('en-IN')} (${selected?.label || 'Annual'})`}
          </button>
        </form>
      </div>
      )}
      </div>
    </StudentPage>
  );
}
