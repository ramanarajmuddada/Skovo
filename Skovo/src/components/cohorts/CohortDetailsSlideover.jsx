import React, { useState, useEffect, useCallback } from 'react';
import WalletToggle from '../v1/WalletToggle';
import CancellationRules from '../v1/CancellationRules';
import { Link } from 'react-router-dom';
import { X, Calendar, Clock, Users, CheckCircle2, IndianRupee, Video, Loader2, Star } from 'lucide-react';
import { api } from '../../services/api';
import { openCheckout, confirmOrder, needsPhone } from '../../services/payment';
import { SeatMeter } from './CohortCard';
import ReviewsBlock from './ReviewsBlock';
import AvatarImg from '../ui/AvatarImg';


// Rupees with paise when there are paise (Rs 2.50), never rounded.
const paise = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Rate the class you just sat in.
 *
 *  Shown to an enrolled student once the class has actually started — the same
 *  rule the server enforces, so the box never appears on something the API
 *  would then refuse. Rating a class nobody has attended is not feedback, and
 *  these ratings are what students and admins judge an achiever by.
 *
 *  Editable rather than one-shot. The API is update-or-insert on
 *  (achiever, user, context_type, context_id), so a second submit replaces the
 *  first instead of stacking a duplicate — and a student who wants to revise a
 *  rating after thinking about it should not have to ask support.
 */
function CohortFeedbackBox({ cohortId, achieverId, onSaved }) {
  const [mine, setMine]     = useState(null);      // existing review | null
  const [loading, setLoad]  = useState(true);
  const [editing, setEdit]  = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover]   = useState(0);
  const [text, setText]     = useState('');
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState('');

  // Seed from the server, not from local state. Bookings.jsx learned this the
  // hard way: tracked in memory alone, a reload showed "Rate" again on a class
  // already rated and the second submit silently replaced the first score.
  const load = useCallback(() => {
    setLoad(true);
    api.get('/achiever-reviews/mine')
      .then(({ data }) => {
        if (!data?.bool) return;
        const found = (data.response.reviews || []).find(
          r => r.context_type === 'cohort' && r.context_id === cohortId);
        if (found) { setMine(found); setRating(found.rating); setText(found.review_text || ''); }
      })
      .catch(() => {})   // no badge is a smaller failure than a broken panel
      .finally(() => setLoad(false));
  }, [cohortId]);

  // Fetch on mount; `load` sets state inside an awaited callback, which is
  // the shape every screen in this app uses. Same suppression as
  // useAchieverLifecycle and the effect below.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!rating) { setError('Pick a rating first.'); return; }
    setBusy(true); setError('');
    try {
      const { data } = await api.post(`/achiever-reviews/${achieverId}`, {
        rating,
        review_text: text.trim() || null,
        context_type: 'cohort',
        context_id: cohortId,
      });
      if (data.bool) {
        setMine(data.response.review);
        setEdit(false);
        onSaved?.();
      } else {
        setError(data.response?.message || 'Could not save your feedback.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally { setBusy(false); }
  };

  if (loading) return <div className="h-11 rounded-xl bg-slate-100 animate-pulse" />;

  const stars = (value, interactive) => (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button" disabled={!interactive}
          onClick={() => interactive && setRating(n)}
          onMouseEnter={() => interactive && setHover(n)}
          onMouseLeave={() => interactive && setHover(0)}
          aria-label={`${n} star${n > 1 ? 's' : ''}`}
          className={interactive ? 'cursor-pointer transition-transform hover:scale-110' : 'cursor-default'}>
          <Star size={interactive ? 24 : 15}
            className={n <= (interactive ? (hover || rating) : value)
              ? 'fill-amber-400 text-amber-400' : 'text-slate-300'} />
        </button>
      ))}
    </div>
  );

  // Already rated, not editing — show it back, because "did my feedback save?"
  // is the question a submit-and-vanish form leaves behind.
  if (mine && !editing) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Your feedback</p>
            {stars(mine.rating, false)}
            {mine.review_text && (
              <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap break-words">
                {mine.review_text}
              </p>
            )}
          </div>
          <button onClick={() => setEdit(true)}
            className="shrink-0 min-h-11 text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-200
                       text-slate-600 hover:border-slate-400 transition-colors">
            Edit
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-sm font-semibold text-slate-900">
        {mine ? 'Update your feedback' : 'How was this class?'}
      </p>
      <p className="text-xs text-slate-500 mt-0.5 mb-3">
        Your achiever sees this. Ratings help other students choose.
      </p>

      <div className="mb-3">{stars(rating, true)}</div>

      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        maxLength={1000}
        rows={3}
        placeholder="What worked, and what would you change? (optional)"
        className="w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-base resize-y focus:outline-none"
      />

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      <div className="flex items-center gap-2 mt-3">
        <button onClick={submit} disabled={busy}
          className="flex-1 min-h-11 py-2.5 rounded-xl text-white text-sm font-semibold disabled:opacity-50 transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)' }}>
          {busy ? 'Saving…' : mine ? 'Save changes' : 'Submit feedback'}
        </button>
        {mine && (
          <button onClick={() => { setEdit(false); setRating(mine.rating); setText(mine.review_text || ''); setError(''); }}
            className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

/** Self check-in with the code the achiever reads out mid-session.
 *
 *  Four digits, the same shape as every UPI and login OTP, so there is nothing
 *  to learn. Points land straight away rather than waiting on someone to tick
 *  a box later. If the code is missed — a dropped connection, joining late —
 *  the achiever can still mark you present by hand, so this never costs a
 *  student their points. */
function CheckInBox({ cohortId, onCheckedIn }) {
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);   // { ok, message }

  const submit = async (e) => {
    e?.preventDefault?.();
    if (code.trim().length < 4 || busy) return;
    setBusy(true); setResult(null);
    try {
      const { data } = await api.post(`/cohorts/${cohortId}/check-in`, { code: code.trim() });
      setResult({ ok: !!data.bool, message: data.response?.message || 'Could not check you in.' });
      if (data.bool) { setCode(''); onCheckedIn?.(cohortId); }
    } catch {
      setResult({ ok: false, message: 'Could not check you in. Try again.' });
    } finally { setBusy(false); }
  };

  if (result?.ok) {
    return (
      <div className="flex items-center justify-center gap-2 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 font-semibold text-sm">
        <CheckCircle2 size={16} /> {result.message}
      </div>
    );
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)}
        className="w-full min-h-11 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
        I have a check-in code
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <label htmlFor="checkin-code" className="block text-xs text-slate-500">
        Enter the code your achiever read out
      </label>
      <div className="flex gap-2">
        <input
          id="checkin-code"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 4))}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="Enter 4-digit code"
          autoFocus
          className="flex-1 min-h-11 min-w-0 px-4 py-2.5 border border-slate-200 rounded-xl text-lg font-bold tracking-[0.3em] text-center focus:outline-none focus:ring-2 focus:ring-indigo-300"
        />
        <button type="submit" disabled={busy || code.trim().length < 4}
          className="min-h-11 px-5 rounded-xl text-white text-sm font-bold shrink-0 disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}>
          {busy ? '…' : 'Check in'}
        </button>
      </div>
      {result && !result.ok && (
        <p className="text-xs text-red-600">{result.message}</p>
      )}
    </form>
  );
}

export default function CohortDetailsSlideover({ cohort, isOpen, onClose, onEnrolled, freePerk, reviewsAchiever, publicView, onLogin }) {
  const [enrolling,  setEnrolling]  = useState(false);
  const [justEnrolled, setJustEnrolled] = useState(false);
  const [error,      setError]      = useState('');
  const [detail,     setDetail]     = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [useWallet, setUseWallet] = useState(false);
  // Cashfree requires a mobile number and a SKOVO account may not carry
  // one. Declared with the other hooks: below the early return it would
  // be a conditional hook call.
  const [phone, setPhone] = useState('');
  const [needPhone, setNeedPhone] = useState(() => needsPhone());
  const [needPro, setNeedPro] = useState(false);

  useEffect(() => {
    // A visitor who is not logged in (shared profile) sees what was passed in.
    if (!isOpen || !cohort?.id || publicView) return;
    setJustEnrolled(false);
    setError('');
    setNeedPro(false);
    setDetail(null);
    setDetailLoading(true);
    api.get(`/cohorts/${cohort.id}`)
      .then(({ data }) => { if (data.bool) setDetail(data.response); })
      .catch(() => {})
      .finally(() => setDetailLoading(false));
  }, [isOpen, cohort?.id, publicView]);

  if (!isOpen || !cohort) return null;

  const cohortStatus  = detail?.status || cohort.status;
  const meetingLink   = detail?.meeting_link;
  const isEnrolled    = justEnrolled || (detail?.is_enrolled && ['paid', 'free'].includes(detail?.enrollment_status));
  const isFree        = !cohort.price || cohort.price === 0;
  // Public offer (v1 has no coupon codes): applied automatically at checkout.
  const price         = Number(detail?.price ?? cohort.price) || 0;
  const payPrice      = Number(detail?.effective_price ?? cohort.effectivePrice ?? price) || 0;
  const hasOffer      = !isFree && payPrice > 0 && payPrice < price;
  const offerLabel    = detail?.offer_label ?? cohort.offerLabel;
  const offerLeft     = detail?.offer_left ?? cohort.offerLeft;
  const offerEndsAt   = detail?.offer_ends_at ?? cohort.offerEndsAt;
  const offerNext     = detail?.offer_next_price ?? cohort.offerNextPrice;
  const totalSeats    = detail?.total_seats ?? cohort.totalSeats;
  const filledSeats   = detail?.filled_seats ?? cohort.filledSeats;
  const availableSeats = detail?.available_seats ?? cohort.availableSeats;
  const isFull        = Boolean(totalSeats) && availableSeats === 0 && !isEnrolled;
  const mentorAvatar  = detail?.achiever?.avatar_url || detail?.achiever?.profile_image_url || cohort.mentorAvatar;
  const achieverId    = detail?.achiever?.id || cohort.achiever?.id || null;


  const handleEnroll = async ({ useFree = false } = {}) => {
    setError('');
    setEnrolling(true);
    try {
      const body = {};
      if (phone) body.phone = phone;
      if (useFree) body.use_free_cohort = true;
      if (useWallet && !useFree) body.use_wallet = true;

      const { data } = await api.post(`/cohorts/${cohort.id}/enroll`, body);

      if (!data.bool) {
        if (data.response?.need_phone) {
          setNeedPhone(true);
          setError('Please add a mobile number to continue.');
        } else if (data.response?.requires_pro) {
          setError(data.response.message || 'Take Skovo Pro for unlimited cohort seats.');
          setNeedPro(true);
        } else {
          setError(data.response?.message || 'Enrollment failed. Please try again.');
          // The last offer place went to someone else: show the new price.
          if (/offer just ran out/i.test(data.response?.message || '')) {
            api.get(`/cohorts/${cohort.id}`).then(({ data: d }) => { if (d.bool) setDetail(d.response); }).catch(() => {});
          }
        }
        return;
      }

      // Free cohort, or a 100%-off coupon — enrolled outright.
      if (!data.response?.payment_session_id) {
        setJustEnrolled(true);
        if (onEnrolled) onEnrolled(cohort.id);
        return;
      }

      const { order_id, payment_session_id, mode } = data.response;

      try {
        await openCheckout({ paymentSessionId: payment_session_id, mode });
      } catch (e) {
        setError(e.message || 'Could not open the payment window.');
        return;
      }

      const outcome = await confirmOrder(api, order_id);
      if (outcome.paid) {
        setJustEnrolled(true);
        if (onEnrolled) onEnrolled(cohort.id);
      } else if (outcome.pending) {
        // The seat is still held while the webhook lands — saying "failed"
        // here would be wrong and would send them to support for nothing.
        setError('Payment is still being confirmed. Check My Bookings shortly.');
      } else {
        setError('Payment was not completed. Your seat is held for a few minutes — try again from checkout.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setEnrolling(false);
    }
  };


  // ── Footer ──────────────────────────────────────────────────────────────────
  const cls = detail?.class;
  let footer;
  if (publicView && ['completed', 'cancelled'].includes(cohort?.status)) {
    footer = <p className="text-center text-sm text-slate-500 py-2">This cohort has ended.</p>;
  } else if (publicView) {
    footer = (
      <button type="button" onClick={onLogin}
        className="w-full min-h-11 py-3.5 px-4 text-white font-semibold rounded-xl text-sm"
        style={{ backgroundColor: 'var(--accent)' }}>
        Log in or sign up to book
      </button>
    );
  } else if (detailLoading) {
    footer = (
      <div className="flex items-center justify-center py-4">
        <Loader2 size={18} className="animate-spin text-slate-400" />
      </div>
    );
  } else if (isEnrolled) {
    footer = (
      <div className="space-y-3">
        <div className="flex items-center justify-center gap-2 py-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-700 font-semibold text-sm">
          <CheckCircle2 size={17} /> You're Enrolled
        </div>
        {meetingLink && cohortStatus !== 'completed' ? (
          <a href={meetingLink} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3.5 rounded-xl text-white font-semibold text-sm transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Video size={15} /> {detail?.is_live ? 'Join Live Session' : 'Join Session'}
          </a>
        ) : cohortStatus !== 'completed' && cohortStatus !== 'cancelled' ? (
          <p className="text-center text-xs text-slate-400">
            {/* Class rules: the link opens only when the achiever presses Start. */}
            {cls?.rules
              ? (cls.missed
                ? "The achiever didn't join. Your money is back in your SKOVO Wallet."
                : `Join opens when the achiever starts the class${cls.start_opens_at ? ` (from ${new Date(cls.start_opens_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })})` : ''}.`)
              : 'The Join button opens ~15 minutes before the session starts.'}
          </p>
        ) : null}

        {/* The check-in code is read out in class, so only once it has started. */}
        {cohortStatus !== 'completed' && cohortStatus !== 'cancelled' && (!cls?.rules || cls.started) && (
          <CheckInBox cohortId={cohort?.id} onCheckedIn={onEnrolled} />
        )}

        {/* Feedback opens the moment the class starts, and stays open after it
            ends — which is also when this footer has nothing else in it, so a
            completed class no longer shows an enrolled student a blank panel.
            The gate matches the server's exactly; showing the box on an
            upcoming class would only earn a refusal. */}
        {/* The server decides: completed classes, or a running one after check-in. */}
        {achieverId && detail?.can_review && (
          <CohortFeedbackBox
            cohortId={cohort.id}
            achieverId={achieverId}
            onSaved={() => onEnrolled?.(cohort.id)}
          />
        )}
      </div>
    );
  } else if (isFull) {
    footer = (
      <div className="py-3.5 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-slate-200">
        This class is full — every seat is taken
      </div>
    );
  } else if (cohortStatus === 'completed') {
    footer = (
      <div className="py-3.5 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-slate-200">
        This cohort has ended
      </div>
    );
  } else if (cohortStatus === 'cancelled') {
    footer = (
      <div className="py-3.5 text-center text-red-500 text-sm bg-red-50 rounded-xl border border-red-200">
        This cohort has been cancelled
      </div>
    );
  } else if (cohortStatus === 'live' && !(detail?.late_join_open ?? cohort.lateJoinOpen ?? cohort.late_join_open)) {
    footer = (
      <div className="py-3.5 text-center text-slate-500 text-sm bg-slate-50 rounded-xl border border-slate-200">
        Enrollment closed — session is in progress
      </div>
    );
  } else {
    footer = (
      <div className="space-y-3">
        {!isFree && (
          <div>
            {/* v1: no coupon codes. A public offer applies on its own. */}
            {hasOffer && (
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-sm space-y-1">
                <div className="flex justify-between text-slate-600"><span>Price</span><span>₹{price.toLocaleString('en-IN')}</span></div>
                <div className="flex justify-between text-emerald-700">
                  <span>{offerLabel || 'Offer'}{offerLeft != null ? ` · ${offerLeft} left` : ''}</span>
                  <span>−₹{paise(price - payPrice)}</span>
                </div>
                <div className="flex justify-between font-semibold text-slate-900 pt-1 border-t border-emerald-100">
                  <span>You pay</span><span>₹{paise(payPrice)}</span>
                </div>
                {offerLeft != null && offerNext != null && offerNext > payPrice && (
                  <p className="text-[11px] text-emerald-700">
                    After {offerLeft} more {offerLeft === 1 ? 'student' : 'students'}, the price goes to ₹{paise(offerNext)}.
                  </p>
                )}
                {offerEndsAt && (
                  <p className="text-[11px] text-emerald-700">
                    Offer ends {new Date(offerEndsAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                )}
              </div>
            )}
            <div className="mt-2"><WalletToggle kind="cohort" checked={useWallet} onChange={setUseWallet} /></div>
          </div>
        )}
        {!isFree && <CancellationRules kind="cohort" price={hasOffer ? payPrice : price} />}
        {!isFree && needPhone && (
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
              className="w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <p className="text-xs text-slate-400 mt-1">Required by the payment provider for your receipt.</p>
          </div>
        )}
        <button
          onClick={() => handleEnroll()}
          disabled={enrolling}
          className="w-full min-h-11 py-3.5 px-4 text-white font-semibold rounded-xl transition-opacity disabled:opacity-50 shadow-sm text-sm"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {enrolling
            ? (isFree ? 'Enrolling…' : 'Opening Payment…')
            : isFree ? 'Enroll for Free'
            : `Pay & Enroll · ₹${paise(hasOffer ? payPrice : price)}`}
        </button>
        {!isFree && freePerk?.available && (
          <button
            type="button"
            onClick={() => handleEnroll({ useFree: true })}
            disabled={enrolling}
            className="w-full min-h-11 py-3 px-4 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            Use a free seat ({Math.max(0, (freePerk.allowance || 0) - (freePerk.used || 0))} left)
          </button>
        )}
        {needPro && (
          <Link to="/skovo-pro"
            className="block text-center text-sm font-bold underline"
            style={{ color: 'var(--accent)' }}>
            Take Skovo Pro
          </Link>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 transition-opacity" onClick={onClose} />

      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-2xl z-50 flex flex-col"
           style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Header */}
        <div className="flex items-start justify-between p-4 sm:p-6 border-b border-slate-100">
          <div className="pr-8">
            <span className="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-2.5 py-1 rounded-md">
              {cohort.domain}
            </span>
            <h2 className="text-xl font-bold text-slate-900 mt-2">{cohort.title}</h2>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="min-h-11 min-w-11 p-2 -mr-2 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded-full transition-colors shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Mentor */}
          <div className="flex items-center gap-4">
            {mentorAvatar ? (
              <AvatarImg src={mentorAvatar} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 font-bold text-lg">
                {cohort.mentor?.charAt(0)}
              </div>
            )}
            <div>
              <p className="font-bold text-slate-900">{cohort.mentor}</p>
              <p className="text-sm text-slate-500 mt-0.5">{cohort.mentorRole}</p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-2xl border border-slate-100">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                <Calendar className="w-3.5 h-3.5" /> Date
              </div>
              <p className="font-semibold text-slate-900 text-sm">{cohort.fullDate || cohort.date}</p>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                <Clock className="w-3.5 h-3.5" /> Duration
              </div>
              <p className="font-semibold text-slate-900 text-sm">{cohort.duration || '90 min'}</p>
            </div>
            {!isEnrolled && (
              <div className="col-span-2">
                <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1.5">
                  <Users className="w-3.5 h-3.5" /> Seats
                </div>
                <SeatMeter filled={filledSeats} total={totalSeats} available={availableSeats} />
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5 text-xs text-slate-500 mb-1">
                <IndianRupee className="w-3.5 h-3.5" /> Price
              </div>
              <p className="font-bold text-slate-900 text-sm">
                {isFree ? <span className="text-emerald-600">Free</span> : `₹${cohort.price}`}
              </p>
            </div>
          </div>

          {/* About */}
          {cohort.about && (
            <div>
              <h3 className="font-bold text-slate-900 mb-2">About this session</h3>
              <p className="text-sm text-slate-600 leading-relaxed">{cohort.about}</p>
            </div>
          )}

          {/* Learnings */}
          {cohort.learnings?.length > 0 && (
            <div>
              <h3 className="font-bold text-slate-900 mb-3">What you'll learn</h3>
              <ul className="space-y-2.5">
                {/* A point typed with line breaks can arrive as "a<br>b"; it is
                    text, not HTML, so split it into points instead of showing
                    the tag. */}
                {cohort.learnings
                  .flatMap((item) => String(item).split(/<br\s*\/?>|\n/i))
                  .map((t) => t.trim()).filter(Boolean)
                  .map((item, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                    <span className="text-sm text-slate-700">{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* This cohort's reviews: summary, sort, 5 at a time (from the achiever profile). */}
          {reviewsAchiever && (
            <div>
              <h3 className="font-bold text-slate-900 mb-3">Reviews</h3>
              <ReviewsBlock achiever={reviewsAchiever} cohortId={cohort.id} emptyText="No reviews for this cohort yet." />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 sm:p-6 border-t border-slate-100 bg-white space-y-3"
             style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2.5 rounded-xl text-center">
              {error}
            </p>
          )}
          {footer}
        </div>
      </div>
    </>
  );
}
