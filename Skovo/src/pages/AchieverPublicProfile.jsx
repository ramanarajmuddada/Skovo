import React, { useEffect, useRef, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import {
  ShieldCheck, Briefcase, Globe, Star, BookOpen, UserRound, Info,
  ArrowLeft, Link2, Check, Loader2, ChevronRight, Share2, MessageCircle,
} from 'lucide-react';
import { api } from '../services/api';
import AvatarImg from '../components/ui/AvatarImg';
import { StudentPage } from '../components/ui/index.jsx';
import { Tabs } from '../components/admin/v1/AdminV1Kit';
import CohortDetailsSlideover from '../components/cohorts/CohortDetailsSlideover';
import ReviewsBlock from '../components/cohorts/ReviewsBlock';
import { normalizeCohort } from '../components/cohorts/normalizeCohort';
import { setReturnPath } from '../utils/checkoutIntent';
import { BookModal } from './FindMentors';

/**
 * Achiever profile — the page achievers share (skovoai.com/achievers/pavan-kumar).
 * Opens without login: anyone sees the profile, cohorts and reviews; booking
 * asks them to log in or sign up and brings them back here.
 * Tabs: Cohorts (tap one for details + its reviews) · 1-on-1 · Details.
 */
// Paise shown, never rounded (Rs 2.50, not Rs 3).
const inr = (n) => (Number(n) > 0
  ? `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
  : 'Free');
const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const when = (iso) => (iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '');

function ShareMenu({ name, role, rating, url }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  const msg = `Check out ${name} on SKOVO${role ? `, ${role}` : ''}${rating > 0 ? `, ★ ${rating}` : ''}: ${url}`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the URL is in the bar */ }
  };
  const item = 'w-full min-h-11 px-3 flex items-center gap-2.5 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-100';
  return (
    <div className="relative w-full sm:w-auto" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="w-full min-h-11 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors">
        <Share2 size={14} /> Share
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-60 bg-white border border-slate-200 rounded-xl shadow-lg p-1.5 z-20">
          <p className="px-3 pt-1.5 pb-1 text-xs font-semibold text-slate-500">Share {name.split(' ')[0]}'s profile</p>
          <a className={item} href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <MessageCircle size={16} className="text-emerald-600" /> WhatsApp
          </a>
          <a className={item} href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
            <Globe size={16} className="text-blue-600" /> LinkedIn
          </a>
          <button type="button" className={item} onClick={copy}>
            {copied ? <><Check size={16} className="text-emerald-600" /> Link copied</> : <><Link2 size={16} /> Copy link</>}
          </button>
        </div>
      )}
    </div>
  );
}

export default function AchieverPublicProfile() {
  const { achieverId } = useParams();
  const navigate = useNavigate();
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState('cohorts');
  const [openClass, setOpenClass] = useState(null);
  const [booking, setBooking] = useState(false);   // false | true | offering id
  const [toast, setToast]     = useState('');
  const [offerings, setOfferings] = useState([]);

  useEffect(() => {
    api.get(`/achievers/${achieverId}/public`, { source: 'profile' })
      .then(({ data: d }) => { if (d.bool) setData(d.response); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [achieverId]);

  // What this achiever offers 1-on-1 (no login needed to see).
  const realId = data?.achiever?.id;
  useEffect(() => {
    if (!realId) return;
    api.get(`/achiever-availability/${realId}/offerings`)
      .then(({ data: d }) => { if (d.bool) setOfferings(d.response.offerings || []); })
      .catch(() => {});
  }, [realId]);

  if (loading) return (
    <StudentPage className="flex justify-center py-24">
      <Loader2 className="animate-spin text-slate-300" size={28} />
    </StudentPage>
  );

  if (!data) return (
    <StudentPage narrow>
      <p className="font-semibold text-slate-600">This achiever profile isn't available.</p>
      <Link to="/find-mentors" className="text-sm text-blue-600 hover:underline mt-2 inline-block min-h-11">
        Back to Find Achievers
      </Link>
    </StudentPage>
  );

  const a = data.achiever;
  const loggedIn = !!data.logged_in;
  const slug = data.slug || a.id;
  const shareUrl = `${window.location.origin}/achievers/${slug}`;
  const classes = data.classes || [];
  const upcoming = classes.filter((c) => ['live', 'upcoming'].includes(c.status));
  const past = classes.filter((c) => !['live', 'upcoming'].includes(c.status));
  const role = [a.designation, a.company].filter((x, i, arr) => x && arr.indexOf(x) === i).join(' at ');
  const mentor = { mentor_id: a.id, id: a.id, full_name: a.full_name, session_rate: a.session_rate };

  // Not logged in: remember this profile, go to login, come back here after.
  const toLogin = () => { setReturnPath(`/achievers/${slug}`); navigate('/login'); };
  const book = (id) => (loggedIn ? setBooking(id || true) : toLogin());
  const lenLabel = (m) => (m % 60 ? (m > 60 ? `${Math.floor(m / 60)} hr${m >= 120 ? "s" : ""} ${m % 60} min` : `${m} min`) : `${m / 60} hr${m > 60 ? 's' : ''}`);
  const whenFree = (nf) => (nf ? `Next free ${new Date(nf.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}` : 'No free times now');
  const open = (c) => setOpenClass(normalizeCohort({
    ...c, achiever: { full_name: a.full_name, designation: a.designation, company: a.company,
                      avatar_url: a.profile_image_url, profile_image_url: a.profile_image_url },
  }));

  const classRow = (c) => (
    <button key={c.id} type="button" onClick={() => open(c)}
            className="w-full text-left py-3 flex items-center gap-3 hover:bg-slate-50 -mx-2 px-2 rounded-xl transition-colors">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--sidebar-hover)' }}>
        <BookOpen size={17} style={{ color: 'var(--accent)' }} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-slate-900 wrap-break-word">{c.title}</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {when(c.session_date)}
          {c.status === 'live' ? ' · Live now' : c.status === 'upcoming' ? ' · Upcoming' : ' · Done'}
          {['live', 'upcoming'].includes(c.status) && c.total_seats ? ` · ${Math.max(0, c.total_seats - c.filled_seats)} of ${c.total_seats} seats left` : ''}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-sm font-bold text-slate-900">{inr(c.price)}</p>
        {c.rating != null
          ? <span className="text-xs font-semibold text-amber-600 inline-flex items-center gap-0.5"><Star size={11} fill="currentColor" /> {c.rating} ({c.reviews})</span>
          : <p className="text-[11px] text-slate-400">No reviews</p>}
      </div>
      <ChevronRight size={16} className="text-slate-300 shrink-0" />
    </button>
  );

  return (
    <StudentPage className="max-w-4xl mx-auto">
      {toast && (
        <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold bg-emerald-600 text-white">{toast}</div>
      )}
      {booking && (
        <BookModal mentor={mentor} onClose={() => setBooking(false)}
                   initialOffering={typeof booking === 'string' ? booking : undefined}
                   onBooked={() => { setToast('Session booked successfully!'); setTimeout(() => setToast(''), 3000); }} />
      )}
      <CohortDetailsSlideover cohort={openClass} isOpen={!!openClass} onClose={() => setOpenClass(null)} onEnrolled={() => {}}
                              reviewsAchiever={slug} publicView={!loggedIn} onLogin={toLogin} />

      {loggedIn && (
        <Link to="/find-mentors"
          className="inline-flex items-center gap-1.5 min-h-11 text-sm text-slate-500 hover:text-slate-800 transition-colors mb-4">
          <ArrowLeft size={15} /> Find Achievers
        </Link>
      )}

      {/* Identity: who they are, their rating, book and share. Counts live in the tabs. */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <div className="flex flex-wrap sm:flex-nowrap items-start gap-x-4 gap-y-3 sm:gap-5">
          {a.has_photo ? (
            <AvatarImg src={a.profile_image_url} alt={a.full_name}
              className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl object-cover border-2 border-slate-100 shrink-0" />
          ) : (
            // Same initial tile as the Find Achievers card, not a grey placeholder.
            <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl flex items-center justify-center text-white font-bold text-2xl sm:text-3xl shrink-0"
                 style={{ backgroundColor: 'var(--accent)' }}>
              {a.full_name?.charAt(0)?.toUpperCase() || 'A'}
            </div>
          )}

          <div className="min-w-0 flex-1">
            <h1 className="text-xl sm:text-2xl font-black leading-tight text-slate-900 wrap-break-word">{a.full_name}</h1>
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {a.trust_badge === 'background_verified' && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center gap-1">
                  <ShieldCheck size={11} /> Background verified
                </span>
              )}
              {a.trust_badge === 'verified' && (
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200">✓ Verified</span>
              )}
              {a.rating > 0 && (
                <span className="text-sm font-semibold text-amber-600 flex items-center gap-1">
                  <Star size={14} fill="currentColor" /> {a.rating}
                  <span className="text-slate-400 font-normal">({a.review_count} review{a.review_count === 1 ? '' : 's'})</span>
                </span>
              )}
            </div>
            {a.achievement_title && <p className="text-sm font-semibold mt-2" style={{ color: 'var(--accent)' }}>{a.achievement_title}</p>}
            {role && (
              <p className="text-sm text-slate-500 flex items-start gap-1.5 mt-1.5">
                <Briefcase size={13} className="shrink-0 mt-1" /> <span className="min-w-0">{role}</span>
              </p>
            )}
          </div>

          {/* Book is the main action (wider); Share sits beside it at the same height. */}
          <div className="flex sm:flex-col items-stretch gap-2 shrink-0 w-full sm:w-auto">
            {offerings.length > 0 && (
              <button type="button" onClick={() => book()}
                className="flex-[2] sm:flex-none min-h-11 px-5 py-2 text-center text-sm font-bold text-white rounded-xl whitespace-nowrap transition-all hover:opacity-90"
                style={{ backgroundColor: 'var(--accent)' }}>
                {/* No price here: each 1-on-1 has its own, shown in the 1-on-1 tab and the booking window. */}
                Book a 1-on-1
              </button>
            )}
            <div className="flex-1 sm:flex-none [&>*]:h-full [&_button]:h-full">
              <ShareMenu name={a.full_name || 'this achiever'} role={a.designation} rating={a.rating} url={shareUrl} />
            </div>
          </div>
        </div>
      </div>

      <div className="mt-4">
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: 'cohorts', label: `Cohorts (${classes.length})`, icon: BookOpen },
          { key: 'session', label: `1-on-1 (${offerings.length})`, icon: UserRound },
          { key: 'details', label: 'Details', icon: Info },
        ]} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-5 sm:p-6 mt-3">
        {tab === 'cohorts' && (
          classes.length === 0 ? <p className="text-sm text-slate-500">No cohorts yet.</p> : (
            <div className="space-y-5">
              {upcoming.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Upcoming</p>
                  <div className="divide-y divide-slate-100">{upcoming.map(classRow)}</div>
                </div>
              )}
              {past.length > 0 && (
                <div>
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-1">Past</p>
                  <div className="divide-y divide-slate-100">{past.map(classRow)}</div>
                </div>
              )}
              <p className="text-[11px] text-slate-400">Tap a cohort to see its details, reviews and booking.</p>
            </div>
          )
        )}

        {tab === 'session' && (
          <div className="space-y-5">
            {offerings.length === 0 ? (
              <p className="text-sm text-slate-500">No 1-on-1s open right now.</p>
            ) : (
              <div className="space-y-3">
                {offerings.map((o) => {
                  const price = Number(o.final_price ?? o.price ?? 0);
                  const off = o.offer_type && Number(o.final_price) < Number(o.price);
                  return (
                    <div key={o.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-slate-900 wrap-break-word">{o.title}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{lenLabel(o.duration_min)} · {o.days_label} · {whenFree(o.next_free)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          {off && <s className="block text-xs text-slate-400">{inr(o.price)}</s>}
                          <p className="text-base font-bold text-slate-900">{price > 0 ? inr(price) : 'Free'}</p>
                        </div>
                      </div>
                      {o.about && <p className="text-sm text-slate-600 mt-2 leading-relaxed">{o.about}</p>}
                      <button type="button" onClick={() => book(o.id)} disabled={!o.next_free}
                        className="mt-3 min-h-11 w-full sm:w-auto px-5 text-sm font-semibold text-white rounded-xl hover:opacity-90 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent)' }}>
                        {!o.next_free ? 'No free times' : loggedIn ? 'See times & book' : 'Log in to book'}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
            <div>
              <p className="font-semibold text-slate-900 text-sm mb-3">1-on-1 reviews</p>
              <ReviewsBlock achiever={slug} source="session" emptyText="No 1-on-1 reviews yet. Be the first." />
            </div>
          </div>
        )}

        {tab === 'details' && (
          <div className="space-y-4">
            {a.bio ? <p className="text-sm text-slate-600 leading-relaxed">{a.bio}</p> : <p className="text-sm text-slate-500">No bio yet.</p>}
            {a.domains?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Domains</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.domains.map((d) => <span key={d} className="text-xs font-medium px-2.5 py-1 rounded-full bg-slate-100 text-slate-600">{d}</span>)}
                </div>
              </div>
            )}
            {a.skills?.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 mb-1.5">Skills</p>
                <div className="flex flex-wrap gap-1.5">
                  {a.skills.map((s) => <span key={s} className="text-xs font-medium px-2.5 py-1 rounded-full border border-slate-200 text-slate-600">{s}</span>)}
                </div>
              </div>
            )}
            {a.linkedin_url && (
              <a href={/^https?:\/\//i.test(a.linkedin_url) ? a.linkedin_url : `https://${a.linkedin_url}`}
                target="_blank" rel="noreferrer"
                className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1 min-h-11">
                <Globe size={13} /> LinkedIn
              </a>
            )}
            {a.member_since && <p className="text-xs text-slate-400">On SKOVO since {day(a.member_since)}</p>}
            {a.bgv_cleared && (
              <p className="text-xs text-slate-400 flex items-center gap-1.5">
                <ShieldCheck size={13} className="text-emerald-500" /> Background check cleared.
              </p>
            )}
          </div>
        )}
      </div>
    </StudentPage>
  );
}
