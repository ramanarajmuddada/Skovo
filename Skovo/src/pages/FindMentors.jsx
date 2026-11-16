import { useMasters } from '../hooks/useMasters';
import FormSelect from '../components/ui/FormSelect';
import React, { useEffect, useState } from 'react';
import WalletToggle from '../components/v1/WalletToggle';
import CancellationRules from '../components/v1/CancellationRules';
import PriceRange from '../components/ui/PriceRange';
import { api } from '../services/api';
import { openCheckout, confirmOrder, needsPhone } from '../services/payment';
import { Link } from 'react-router-dom';
import { Search, Star, Briefcase, Users, BookOpen, Clock, CalendarCheck, Loader2, ShieldCheck, SlidersHorizontal, X } from 'lucide-react';
import { PageHeader, StudentPage } from '../components/ui/index.jsx';
import AvatarImg from '../components/ui/AvatarImg';


/** Trust is a floor, not a ranking — so this renders three states, and the one
 *  that matters is whether a background check was completed. */
function TrustBadge({ badge, verified }) {
  if (badge === 'background_verified') return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
      <ShieldCheck size={11} /> Background verified
    </span>
  );
  if (badge === 'verified') return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">
      ✓ Verified
    </span>
  );
  if (badge === 'identity_verified') return (
    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
      ID verified
    </span>
  );
  // Fall back to the legacy flag so a stale cached response still renders.
  return (
    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${verified ? 'bg-blue-50 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
      {verified ? '✓ Verified' : 'New achiever'}
    </span>
  );
}

function MentorCard({ mentor, onBook }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-lg transition-all hover:-translate-y-0.5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start gap-4">
        {mentor.profile_image_url ? (
          <AvatarImg src={mentor.profile_image_url} alt="" className="w-14 h-14 rounded-2xl object-cover shrink-0 shadow" />
        ) : (
          <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-bold text-xl shrink-0 shadow"
            style={{ backgroundColor: 'var(--accent)' }}>
            {mentor.full_name?.charAt(0)?.toUpperCase() || 'M'}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {/* Wraps instead of cutting long names off. */}
          <h3 className="font-bold text-slate-900 text-base leading-snug wrap-break-word line-clamp-2">{mentor.full_name}</h3>
          {mentor.designation && (
            <p className="text-sm text-slate-500 flex items-start gap-1.5 mt-0.5 leading-snug">
              <Briefcase size={12} className="shrink-0 mt-1" />
              <span className="min-w-0 line-clamp-2">
                {mentor.designation}
                {/* Company only when it is not the same text as the role. */}
                {mentor.company && mentor.company.trim().toLowerCase() !== (mentor.designation || '').trim().toLowerCase()
                  && <span className="text-slate-400"> @ {mentor.company}</span>}
              </span>
            </p>
          )}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {/* Badge, not a tier number. "Background verified" is the only
                distinction a student needs, and it is the one that governs
                who may mentor someone under 18. */}
            <TrustBadge badge={mentor.trust_badge} verified={mentor.is_verified} />
            {mentor.rating > 0 && (
              <span className="text-xs font-semibold text-amber-600 flex items-center gap-0.5">
                ⭐ {mentor.rating} <span className="text-slate-400 font-normal">({mentor.review_count})</span>
              </span>
            )}
            {/* A probation achiever teaches free until an admin has read their
                three demo reviews. Saying so turns a ₹0 price from a suspected
                bug into an offer — and free is the reason a student tries
                someone with no reviews yet. */}
            {mentor.is_demo_achiever && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full
                               bg-emerald-50 text-emerald-700 border border-emerald-200">
                Free demo session
              </span>
            )}
            {/* Earned nightly from ratings, repeat bookings and no-shows —
                never set by hand, which is what makes it worth showing. */}
            {mentor.standing === 'spotlight' && (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full
                               bg-amber-50 text-amber-700 border border-amber-200">
                ⭐ Spotlight
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {mentor.bio && (
        <p className="text-sm text-slate-600 leading-relaxed line-clamp-2">{mentor.bio}</p>
      )}

      {/* Domains */}
      {mentor.domains?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {mentor.domains.map((d, i) => (
            <span key={i} className="text-xs font-medium px-2.5 py-1 rounded-full border"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent-text)', backgroundColor: 'var(--accent-ring)' }}>
              {d}
            </span>
          ))}
        </div>
      )}

      {/* Profile + Book */}
      <div className="flex items-center justify-between gap-3 mt-auto pt-3 border-t border-slate-100">
        {/* The card stays short; price, classes and reviews are on the profile. */}
        <Link to={`/achievers/${mentor.slug || mentor.mentor_id}`}
          className="inline-flex items-center min-h-11 text-sm font-semibold hover:underline" style={{ color: 'var(--accent)' }}>
          View profile
        </Link>
        {mentor.paused ? (
          <span className="min-h-11 inline-flex items-center px-3 text-xs font-semibold text-slate-500 bg-slate-100 rounded-xl">
            Not taking bookings
          </span>
        ) : (
          <button onClick={() => onBook(mentor)}
            className="min-h-11 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all hover:opacity-90 active:scale-95"
            style={{ backgroundColor: 'var(--accent)' }}>
            Book Session
          </button>
        )}
      </div>
    </div>
  );
}

function fmt(t) {
  if (!t) return '';
  const [h, m] = t.split(':');
  const hr = parseInt(h);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
}

export function BookModal({ mentor, onClose, onBooked, initialOffering }) {
  const [note,         setNote]         = useState('');
  const [offerings,    setOfferings]    = useState([]);
  const [loadingOff,   setLoadingOff]   = useState(true);
  const [picked,       setPicked]       = useState(initialOffering || null);   // offering id
  // Opened from a 1-on-1's own card: show just that one (with Change), not the whole list.
  const [showList,     setShowList]     = useState(!initialOffering);
  const [days,         setDays]         = useState([]);      // [{date, times}]
  const [loadingTimes, setLoadingTimes] = useState(false);
  const [day,          setDay]          = useState('');
  const [time,         setTime]         = useState('');

  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [coupon,       setCoupon]       = useState('');
  const [couponInfo,   setCouponInfo]   = useState(null);
  const [useWallet,    setUseWallet]    = useState(false);
  const [walletTotal,  setWalletTotal]  = useState(0);
  const [avgRating,    setAvgRating]    = useState(0);
  const [reviewCount,  setReviewCount]  = useState(0);

  // Step 1: what this achiever offers. Step 2: free times for the one picked.
  useEffect(() => {
    api.get(`/achiever-availability/${mentor.mentor_id}/offerings`)
      .then(({ data }) => { if (data.bool) setOfferings(data.response.offerings || []); })
      .catch(() => {})
      .finally(() => setLoadingOff(false));
  }, [mentor.mentor_id]);

  useEffect(() => {
    if (!picked) return;
    let live = true;
    setLoadingTimes(true); setDays([]); setDay(''); setTime('');
    api.get(`/achiever-availability/${mentor.mentor_id}/times`, { offering_id: picked })
      .then(({ data }) => {
        if (!live) return;
        const list = data.bool ? data.response.dates || [] : [];
        setDays(list); setDay(list[0]?.date || '');
      })
      .catch(() => {})
      .finally(() => live && setLoadingTimes(false));
    return () => { live = false; };
  }, [mentor.mentor_id, picked]);

  useEffect(() => {
    api.get(`/achiever-reviews/${mentor.mentor_id}`)
      .then(({ data }) => {
        if (data.bool) {
          setAvgRating(data.response.avg_rating || 0);
          setReviewCount(data.response.count || 0);
        }
      })
      .catch(() => {});
  }, [mentor.mentor_id]);

  const offering = offerings.find((o) => o.id === picked);
  // The price of the 1-on-1 picked (less a live offer); probation is free.
  const rate = offering && !mentor.is_demo_achiever ? Number(offering.final_price ?? offering.price ?? 0) : 0;
  const dayTimes = days.find((d) => d.date === day)?.times || [];
  const lenLabel = (m) => (m % 60 ? (m > 60 ? `${Math.floor(m / 60)} hr${m >= 120 ? "s" : ""} ${m % 60} min` : `${m} min`) : `${m / 60} hr${m > 60 ? 's' : ''}`);
  // Paise always in two digits: ₹559.20, never ₹559.2.
  const rupee = (n) => { const v = Number(n); return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };
  const [phone, setPhone] = useState('');
  // The wallet pays the whole price: no gateway, so no mobile number needed.
  const walletPaysAll = rate > 0 && useWallet && walletTotal >= Number(couponInfo?.final ?? rate);
  // Cashfree will not create an order without a mobile number, and SKOVO
  // accounts can be made with an email alone. Shown only for a paid slot.
  const [needPhone, setNeedPhone] = useState(() => needsPhone());

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponInfo(null);
    try {
      const { data } = await api.post('/billing/coupons/validate', {
        code: coupon.trim(), amount: rate, context_type: 'session',
        context_id: mentor.mentor_id || mentor.id,
      });
      if (data.bool) setCouponInfo({ discount: data.response.discount, final: data.response.final_amount });
      else setCouponInfo({ error: data.response?.message || 'Invalid coupon.' });
    } catch { setCouponInfo({ error: 'Could not validate coupon.' }); }
  };

  const handleBook = async () => {
    if (!picked || !day || !time) { setError('Pick a 1-on-1, a day and a time first.'); return; }
    const when = { offering_id: picked, date: day, start_time: time };
    setSaving(true); setError('');
    const couponBody = (rate > 0 && coupon.trim()) ? { coupon_code: coupon.trim() } : {};
    try {
      // ── Free session: single POST ──────────────────────────────────────
      if (rate <= 0) {
        const { data } = await api.post(`/achievers/${mentor.mentor_id}/book`, { note, ...when });
        if (data.bool) { onBooked(); onClose(); }
        else setError(data.response?.message || 'Failed to book session.');
        setSaving(false);
        return;
      }

      // ── Paid session: hold, pay, then ask the server what happened ─────
      //
      // No signature comes back to the browser any more. Cashfree's webhook is
      // the only thing that confirms a payment, so this opens checkout and then
      // polls the order — a closed tab or a forged callback cannot fake a
      // booking, and a student whose network dies mid-payment still gets the
      // session the webhook confirmed.
      const body = { note, ...when, ...couponBody };
      if (useWallet) body.use_wallet = true;
      if (phone) body.phone = phone;

      const { data: opened } = await api.post(`/achievers/${mentor.mentor_id}/book`, body);

      if (!opened.bool) {
        // The server tells us when it needs a number rather than us guessing.
        if (opened.response?.need_phone) {
          setNeedPhone(true);
          setError('Please add a mobile number to continue.');
        } else {
          setError(opened.response?.message || 'Could not start checkout.');
        }
        setSaving(false);
        return;
      }

      // A 100%-off coupon books outright — nothing to pay for.
      if (!opened.response?.payment_session_id) { onBooked(); onClose(); setSaving(false); return; }

      const { order_id, payment_session_id, mode } = opened.response;

      try {
        await openCheckout({ paymentSessionId: payment_session_id, mode });
      } catch (e) {
        setError(e.message || 'Could not open the payment window.');
        setSaving(false);
        return;
      }

      // The widget has closed. It does not know whether payment succeeded.
      setError('');
      const outcome = await confirmOrder(api, order_id);

      if (outcome.paid) { onBooked(); onClose(); }
      else if (outcome.pending) {
        // Never say "failed" here: the money may already have left their
        // account and the webhook is simply still in flight.
        setError('Payment is still being confirmed. Check My Bookings in a moment.');
      } else {
        setError('Payment was not completed. The slot has been released.');
      }
      setSaving(false);
    } catch { setError('Connection error.'); setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white shadow-2xl w-full max-w-lg overflow-hidden flex flex-col
                      h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
           style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Header */}
        <div className="p-4 sm:p-6 pb-4 shrink-0 flex items-start justify-between gap-3">
          <h3 className="font-bold text-slate-900 text-lg">Book a Session</h3>
          <button type="button" onClick={onClose} aria-label="Close"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>
        <div className="px-4 sm:px-6 pb-4 shrink-0">
          <div className="flex items-center gap-3 p-4 bg-slate-50 rounded-xl">
            {mentor.profile_image_url ? (
              <AvatarImg src={mentor.profile_image_url} alt="" className="w-10 h-10 rounded-xl object-cover shrink-0" />
            ) : (
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}>
                {mentor.full_name?.charAt(0)}
              </div>
            )}
            <div>
              <p className="font-semibold text-slate-900">{mentor.full_name}</p>
              <p className="text-xs text-slate-500">{mentor.designation}{mentor.company ? ` @ ${mentor.company}` : ''}</p>
              {reviewCount > 0 && (
                <p className="text-xs font-semibold text-amber-600 mt-0.5">
                  ⭐ {avgRating} <span className="text-slate-400 font-normal">({reviewCount} review{reviewCount > 1 ? 's' : ''})</span>
                </p>
              )}
              <p className="text-xs font-bold mt-0.5"
                 style={mentor.is_demo_achiever ? { color: '#047857' } : { color: 'var(--accent)' }}>
                {mentor.is_demo_achiever
                  ? 'Free demo session'
                  : offering
                    ? (rate > 0 ? `${rupee(rate)} · ${lenLabel(offering.duration_min)}` : `Free · ${lenLabel(offering.duration_min)}`)
                    : 'Pick a 1-on-1 below'}
              </p>
            </div>
          </div>

          {/* One line. The badge already said "free"; this says why. */}
          {mentor.is_demo_achiever && (
            <p className="mt-2 text-xs text-emerald-700">
              Free demo session — your review decides if they can charge.
            </p>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 space-y-5">
          {/* Step 1: which 1-on-1 */}
          <div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2">
              <BookOpen size={13} style={{ color: 'var(--accent)' }} /> Pick a 1-on-1
              <span className="font-normal text-rose-400">(required)</span>
            </label>
            {loadingOff ? (
              <div className="flex items-center gap-2 py-3 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Loading…</div>
            ) : offerings.length === 0 ? (
              <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                This achiever has no 1-on-1s open right now. Please check back later.
              </p>
            ) : (
              <div className="space-y-2">
                {!showList && offering && (
                  <div className="flex items-center gap-3 rounded-xl border-2 p-3" style={{ borderColor: 'var(--accent)' }}>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-slate-900 break-words">{offering.title}</p>
                      <p className="text-xs text-slate-500">{lenLabel(offering.duration_min)} · {rate > 0 ? rupee(rate) : 'Free'}</p>
                    </div>
                    <button type="button" onClick={() => setShowList(true)} className="shrink-0 text-xs font-semibold min-h-9 px-2" style={{ color: 'var(--accent)' }}>Change</button>
                  </div>
                )}
                {(showList || !offering) && offerings.map((o) => {
                  const on = picked === o.id;
                  const price = mentor.is_demo_achiever ? 0 : Number(o.final_price ?? o.price ?? 0);
                  const off = !mentor.is_demo_achiever && o.offer_type && Number(o.final_price) < Number(o.price);
                  return (
                    <button key={o.id} type="button" onClick={() => setPicked(o.id)} aria-pressed={on}
                            className={`w-full text-left rounded-xl border p-3 transition-colors ${on ? 'border-transparent ring-2' : 'border-slate-200 hover:border-slate-300'}`}
                            style={on ? { '--tw-ring-color': 'var(--accent)' } : undefined}>
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold text-slate-900 wrap-break-word">{o.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {lenLabel(o.duration_min)} · {o.days_label}
                            {o.next_free ? '' : ' · No free times now'}
                          </p>
                          {o.about && <p className="text-xs text-slate-600 mt-1 leading-relaxed">{o.about}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          {off && <s className="block text-[11px] text-slate-400">{rupee(o.price)}</s>}
                          <span className="text-sm font-bold text-slate-900">{price > 0 ? rupee(price) : 'Free'}</span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Step 2: day and start time (only times that fit his hours) */}
          {picked && (
            <div>
              <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-2">
                <CalendarCheck size={13} style={{ color: 'var(--accent)' }} /> Pick a day and time
              </label>
              {loadingTimes ? (
                <div className="flex items-center gap-2 py-3 text-sm text-slate-400"><Loader2 size={14} className="animate-spin" /> Finding free times…</div>
              ) : days.length === 0 ? (
                <p className="text-xs text-slate-400 bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                  No free times in the next 4 weeks. Try another 1-on-1 or check back later.
                </p>
              ) : (
                <>
                  <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Day">
                    {days.map((d) => {
                      const dt = new Date(d.date + 'T00:00:00');
                      const on = day === d.date;
                      return (
                        <button key={d.date} type="button" onClick={() => { setDay(d.date); setTime(''); }}
                                className={`shrink-0 min-w-14 min-h-14 px-2 rounded-xl border text-center ${on ? 'text-white border-transparent' : 'border-slate-200 bg-white text-slate-600'}`}
                                style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
                          <span className="block text-[11px] font-semibold">{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
                          <span className="block text-sm font-bold">{dt.getDate()} {dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-3" role="group" aria-label="Start time">
                    {dayTimes.map((t) => (
                      <button key={t} type="button" onClick={() => setTime(t)}
                              className={`min-h-11 rounded-xl text-xs font-semibold border ${time === t ? 'text-white border-transparent' : 'border-slate-200 bg-white text-slate-600'}`}
                              style={time === t ? { backgroundColor: 'var(--accent)' } : undefined}>
                        {fmt(t)}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Short notice: the student knows a refund is automatic if it does not happen. */}
          {day && time && (() => {
            const mins = Math.round((new Date(`${day}T${time}`) - new Date()) / 60000);
            return mins >= 0 && mins < 60 ? (
              <p className="text-xs rounded-xl border border-amber-200 bg-amber-50 text-amber-800 px-3 py-2">
                ⚡ Starts in {mins} min. The achiever is alerted now. If they cannot join, you get a full refund automatically.
              </p>
            ) : null;
          })()}

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Note (optional)</label>
            <textarea rows={3} value={note} onChange={e => setNote(e.target.value)}
              placeholder="Enter what you want to discuss"
              className="w-full min-h-11 px-4 py-2.5 border border-slate-200 rounded-xl text-base focus:outline-none resize-none" />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</p>}


        {/* Coupon (paid sessions) */}
        {rate > 0 && (
          <div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())}
                placeholder="Enter coupon code"
                className="flex-1 min-h-11 border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300" />
              <button type="button" onClick={applyCoupon}
                className="min-h-11 px-4 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Apply</button>
            </div>
            {couponInfo?.discount != null && <p className="text-xs text-emerald-600 mt-1">−₹{couponInfo.discount} applied · you pay ₹{couponInfo.final}</p>}
            {couponInfo?.error && <p className="text-xs text-red-500 mt-1">{couponInfo.error}</p>}
            <div className="mt-2"><WalletToggle kind="session" checked={useWallet} onChange={setUseWallet} onBalance={setWalletTotal} /></div>
            <div className="mt-3"><CancellationRules kind="session" price={couponInfo?.final ?? rate} /></div>
          </div>
        )}

        {/* Mobile number — the gateway requires one, and an account can exist
            without it, so it is asked for here rather than blocking signup. */}
        {rate > 0 && needPhone && !walletPaysAll && (
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              Mobile number <span className="text-red-500">*</span>
            </label>
            <input
              value={phone}
              onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              inputMode="numeric"
              autoComplete="tel"
              placeholder="Enter 10-digit mobile number"
              className="w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-emerald-300"
            />
            <p className="text-xs text-slate-400 mt-1">Required by the payment provider for your receipt.</p>
          </div>
        )}

        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 pt-4 shrink-0 border-t border-slate-100 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 sm:justify-end"
             style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="min-h-11 w-full sm:w-auto px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleBook} disabled={saving || !(picked && day && time)}
            className="min-h-11 w-full sm:w-auto px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 transition-all hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? 'Booking…' : !picked ? 'Select a 1-on-1' : !(day && time) ? 'Select a time to continue'
              : walletPaysAll ? `Confirm booking (${rupee(couponInfo?.final ?? rate)} from wallet)`
              : rate > 0 ? `Pay ${rupee(couponInfo?.final ?? rate)} & Book` : 'Confirm booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function FindMentors() {
  const { lists: sortLists } = useMasters(['mentor_sort']);
  const [mentors, setMentors]     = useState([]);
  const [loading, setLoading]     = useState(true);
  const [search,  setSearch]      = useState('');
  const [domain,  setDomain]      = useState('');
  const [booking, setBooking]     = useState(null);
  const [toast,   setToast]       = useState('');

  const showToast = msg => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const [minRating, setMinRating] = useState(0);
  // Price range from the slider: null = any price.
  const [price,     setPrice]     = useState(null);
  const [bounds,    setBounds]    = useState({ min: 0, max: 0 });
  const [freeOnly,  setFreeOnly]  = useState(false);
  const [sort,      setSort]      = useState('recommended');
  const [total,     setTotal]     = useState(0);
  const [allDomains, setAllDomains] = useState([]);
  const [showFilters, setShowFilters] = useState(false);

  // Filter options come from what is actually browsable, so the UI never
  // offers a domain that returns an empty list.
  useEffect(() => {
    api.get('/achievers/browse/filters')
      .then(({ data }) => { if (data.bool) setAllDomains(data.response?.domains || []); })
      .catch(() => {});
  }, []);

  // Filtering moved to the server: the old version pulled every achiever and
  // matched strings in the browser, which cannot do rating, price or
  // background-verified at all — and would have shipped the whole table to the
  // phone once supply grew. Debounced so typing doesn't fire a query per key.
  useEffect(() => {
    const t = setTimeout(() => {
      setLoading(true);
      api.get('/achievers/', {
        q: search || '',
        domain: domain || '',
        min_rating: minRating || '',
        min_price: price?.min || '',
        max_price: price?.max || '',
        free_only: freeOnly ? '1' : '',
        sort,
        per_page: 48,
      })
        .then(({ data }) => {
          if (data.bool) {
            setMentors(data.response?.mentors || []);
            setTotal(data.response?.total || 0);
            if (data.response?.price_bounds) setBounds(data.response.price_bounds);
          }
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [search, domain, minRating, price, freeOnly, sort]);

  const activeFilters = [domain, minRating, price, freeOnly].filter(Boolean).length;
  const clearFilters = () => {
    setDomain(''); setMinRating(0); setPrice(null); setFreeOnly(false);
  };
  const filtered = mentors;

  return (
    <StudentPage>
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold bg-emerald-600 text-white">
          {toast}
        </div>
      )}
      {booking && (
        <BookModal mentor={booking} onClose={() => setBooking(null)}
          onBooked={() => showToast('Session booked successfully!')} />
      )}

      <PageHeader
        title="Find Achievers"
        subtitle={`${total} achiever${total === 1 ? '' : 's'} available · Book a 1-on-1 session`}
      />

      {/* Search + sort */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Name, company or role"
            className="w-full min-h-11 pl-11 pr-4 py-3 border border-slate-200 rounded-2xl text-base focus:outline-none bg-white" />
        </div>
        {/* Sort order from master_mentor_sort (Admin > Masters). */}
        <div className="w-full sm:w-56 shrink-0">
          <FormSelect value={sort} onChange={(v) => setSort(v || 'recommended')} clearable={false}
                      options={(sortLists.mentor_sort || []).map((o) => ({ value: o.value, label: o.label }))} />
        </div>
        <button type="button" onClick={() => setShowFilters(v => !v)}
          className={`flex items-center justify-center gap-2 min-h-11 px-4 py-3 rounded-2xl text-sm font-semibold border transition-all ${
            activeFilters ? 'border-transparent text-white' : 'border-slate-200 text-slate-600 bg-white hover:border-slate-300'}`}
          style={activeFilters ? { backgroundColor: 'var(--accent)' } : {}}>
          <SlidersHorizontal size={15} />
          Filters{activeFilters ? ` (${activeFilters})` : ''}
        </button>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-6 space-y-5">
          {allDomains.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Domain</p>
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={() => setDomain('')}
                  className={`min-h-11 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${!domain ? 'text-white border-transparent' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                  style={!domain ? { backgroundColor: 'var(--accent)' } : {}}>All</button>
                {allDomains.map(d => (
                  <button key={d} onClick={() => setDomain(domain === d ? '' : d)}
                    className={`min-h-11 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${domain === d ? 'text-white border-transparent' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    style={domain === d ? { backgroundColor: 'var(--accent)' } : {}}>{d}</button>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-2 gap-5">
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Minimum rating</p>
              <div className="flex gap-2">
                {[0, 3, 4, 4.5].map(r => (
                  <button key={r} onClick={() => setMinRating(r)}
                    className={`min-h-11 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${minRating === r ? 'text-white border-transparent' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
                    style={minRating === r ? { backgroundColor: 'var(--accent)' } : {}}>
                    {r === 0 ? 'Any' : `${r}★+`}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-600 mb-2">Price per session</p>
              {/* Two handles, ends from real prices; typed boxes for exact amounts. */}
              <PriceRange bounds={bounds} value={price} onChange={setPrice} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={() => setFreeOnly(v => !v)}
              className={`min-h-11 px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-all ${freeOnly ? 'text-white border-transparent' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}
              style={freeOnly ? { backgroundColor: 'var(--accent)' } : {}}>
              Free sessions only
            </button>
            {/* "Background verified only" is not offered in v2. No admin control
                starts or records a background check, so bgv_status is 'none' for
                every achiever and this filter returned an empty list every time
                a student ticked it -- a promise the platform could not keep.

                The note that used to sit here said under-18 students were
                restricted to these achievers by the server. That stopped being
                true on 2026-08-30, when can_teach_minors was dropped with the
                DPDP age gates; nothing is gated on BGV today.

                sp_achievers_browse still accepts ?bgv_only=1, so this comes back
                as one button when the checks themselves do. */}
            {activeFilters > 0 && (
              <button onClick={clearFilters}
                className="flex items-center gap-1 px-3.5 min-h-11 rounded-full text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors">
                <X size={12} /> Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-56 animate-pulse bg-white rounded-2xl border border-slate-100" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center py-24">
          <BookOpen size={40} className="text-slate-300 mb-3" />
          <p className="font-semibold text-slate-500">No achievers found</p>
          <p className="text-sm text-slate-400 mt-1">
            {activeFilters ? 'Try relaxing your filters' : 'Try a different search'}
          </p>
          {activeFilters > 0 && (
            <button onClick={clearFilters}
              className="mt-4 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors">
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map(m => (
            <MentorCard key={m.mentor_id} mentor={m} onBook={setBooking} />
          ))}
        </div>
      )}
    </StudentPage>
  );
}
