import React, { useState, useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  GraduationCap, Star, BookOpen, Briefcase, Users, ArrowRight,
  Menu, X, CheckCircle, Shield, Sparkles, Award, MessageSquare,
  TrendingUp, Mail, FolderLock, Check, Loader2, ChevronDown, CalendarDays, Clock,
  Building2, UserCheck, FileCheck2, Rocket, Flame, Target, Crown, Zap, LogIn,
} from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { setPendingPlan } from '../utils/checkoutIntent';

/* ── The Opportunity Hub gate, read from config ─────────────── */
// This page states the unlock score in five places. They were five literals,
// so moving the gate on the Readiness Rules screen left the public site
// promising the old number -- the same drift opportunity_hub_min_score() was
// written to end, on the one page that could not call it because it has no
// session.
//
// Falls back to the spec floor: a marketing page has to render even when the
// API does not answer, and one stale number beats a blank.
const GATE_FALLBACK = 60;
let gateRequest = null;

function useOpportunityGate() {
  const [gate, setGate] = useState(GATE_FALLBACK);
  useEffect(() => {
    // Four components on this page want the number; the request is shared so
    // they do not make four of them.
    if (!gateRequest) {
      gateRequest = api.get('/readiness/public-gate')
        .then(({ data }) => Number(data?.response?.opportunity_unlock_score) || GATE_FALLBACK)
        .catch(() => GATE_FALLBACK);
    }
    let alive = true;
    gateRequest.then((v) => { if (alive) setGate(v); });
    return () => { alive = false; };
  }, []);
  return gate;
}

/* ── Scroll-reveal hook ─────────────────────────────────────────────── */
// Live numbers for the page -- upcoming cohorts, headline counts, score
// actions -- from /public/landing, the same tables Admin edits. One request,
// shared by every section that asks.
let landingRequest = null;
function useLandingData() {
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!landingRequest) {
      landingRequest = api.get('/public/landing')
        .then(({ data: d }) => (d?.bool ? d.response : null))
        .catch(() => null);
    }
    let alive = true;
    landingRequest.then((v) => { if (alive) setData(v); });
    return () => { alive = false; };
  }, []);
  return data;
}

// A headline count is only worth printing once it is big enough to help.
const COUNT_FLOOR = 10;

function useInView(threshold = 0.12) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold]);
  return [ref, visible];
}

/* ── Slide-in wrapper ───────────────────────────────────────────────── */
function Reveal({ children, direction = 'up', delay = 0, className = '' }) {
  const [ref, visible] = useInView();
  const from =
    direction === 'left' ? 'translateX(-64px)'
    : direction === 'right' ? 'translateX(64px)'
    : 'translateY(48px)';
  return (
    <div
      ref={ref}
      className={className}
      style={{
        transform: visible ? 'translate(0,0)' : from,
        opacity: visible ? 1 : 0,
        transition: `transform 0.75s cubic-bezier(.22,.68,0,1.2) ${delay}ms, opacity 0.6s ease ${delay}ms`,
        willChange: 'transform, opacity',
      }}
    >
      {children}
    </div>
  );
}

/* ── Navbar ─────────────────────────────────────────────────────────── */
// Always light — this is a solid card sitting above a dark hero, not the
// transparent-over-hero pattern the rest of the site's chrome used to use, so
// there's no scroll-triggered color swap here, just a shadow once you scroll.
// The achiever portal dropdown that used to live here is gone; sign-in/register
// for achievers are still reachable from the achievers section below and the
// footer, so nothing is actually unreachable.
function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const fn = () => setScrolled(window.scrollY > 8);
    window.addEventListener('scroll', fn, { passive: true });
    return () => window.removeEventListener('scroll', fn);
  }, []);

  const navLinks = [
    { label: 'How it works', href: '#how-it-works', icon: Sparkles, sub: 'Four steps to your first role' },
    { label: 'Features',     href: '#app-features', icon: Award,    sub: 'Cohorts, colleges and more' },
    { label: 'Pricing',      href: '#pricing',      icon: Crown,    sub: 'Free, or upgrade to Skovo Pro' },
    { label: 'Achievers',    href: '#achievers',    icon: Star,     sub: 'Teach students and earn' },
  ];

  // Highlight the section in view.
  const [active, setActive] = useState('');
  useEffect(() => {
    const ids = navLinks.map(l => l.href.slice(1));
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => { if (e.isIntersecting) setActive('#' + e.target.id); });
    }, { rootMargin: '-45% 0px -50% 0px' });
    ids.forEach(id => { const el = document.getElementById(id); if (el) io.observe(el); });
    return () => io.disconnect();
  }, []);  // eslint-disable-line react-hooks/exhaustive-deps

  // Lock page scroll while the menu sheet is open.
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [open]);

  const cta = 'inline-flex items-center justify-center gap-1.5 rounded-full bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-bold transition-colors shadow-md shadow-violet-900/30';

  return (
    <nav className={`fixed top-0 inset-x-0 z-50 transition-all duration-300 ${
      open ? 'bg-white border-b border-slate-200' : scrolled ? 'bg-white/90 backdrop-blur-xl border-b border-slate-200 shadow-sm' : 'bg-white/70 backdrop-blur-xl border-b border-transparent'
    }`}>
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24 flex items-center h-16 gap-4">

        {/* Logo */}
        <Link to="/" className="flex items-center gap-2.5 mr-auto">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
            <img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <span className="text-lg font-black tracking-tight text-slate-900">Skovo</span>
        </Link>

        {/* Section links — a pill group from tablet up */}
        <div className="nav-pill hidden md:flex items-center gap-1 p-1 rounded-full">
          {navLinks.map(({ label, href }) => (
            <a key={label} href={href}
               className={`px-3 lg:px-4 py-1.5 rounded-full text-[13px] lg:text-sm font-semibold transition-colors ${
                 active === href ? 'nav-pill-on' : 'nav-pill-off'}`}>
              {label}
            </a>
          ))}
        </div>

        {/* CTAs from tablet up */}
        <div className="hidden md:flex items-center gap-1.5 ml-auto">
          <Link to="/login" className="text-sm font-semibold text-slate-700 hover:text-slate-900 px-3 lg:px-4 py-2 rounded-full hover:bg-slate-100 transition-all">
            Sign in
          </Link>
          <Link to="/signup" className={`${cta} px-4 lg:px-5 py-2.5 text-sm`}>
            Start free <ArrowRight size={14} />
          </Link>
        </div>

        {/* Phone: Start free stays visible next to the menu button */}
        <Link to="/signup" className={`md:hidden ${cta} px-3.5 py-2 text-xs`}>Start free</Link>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Close menu' : 'Open menu'} aria-expanded={open}
          className="md:hidden w-10 h-10 rounded-xl flex items-center justify-center text-slate-700 hover:bg-slate-100 transition-colors"
        >
          {open ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {/* Phone menu sheet */}
      <div className={`nav-sheet md:hidden fixed inset-x-0 top-16 h-[calc(100dvh-4rem)] transition-all duration-300 ${
        open ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'}`}>
        <div className="px-4 py-4 h-full overflow-y-auto">
          <p className="px-1 mb-2 text-[11px] font-bold uppercase tracking-widest text-slate-400">Explore</p>
          <ul className="rounded-2xl border border-slate-200 divide-y divide-slate-100 overflow-hidden">
            {navLinks.map(({ label, href, icon: Icon, sub }) => (
              <li key={label}>
                <a href={href} onClick={() => setOpen(false)}
                   className="flex items-center gap-3 px-3.5 py-3 min-h-16 active:bg-slate-50 transition-colors">
                  <span className="w-10 h-10 shrink-0 rounded-xl bg-violet-100 text-violet-700 flex items-center justify-center"><Icon size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-bold text-slate-900">{label}</span>
                    <span className="block text-xs text-slate-500 truncate">{sub}</span>
                  </span>
                  <ChevronDown size={16} className="-rotate-90 shrink-0 text-slate-400" />
                </a>
              </li>
            ))}
          </ul>

          <div className="mt-5 space-y-2.5">
            <Link to="/signup" onClick={() => setOpen(false)} className={`${cta} w-full min-h-12 text-sm`}>
              Create free account <ArrowRight size={15} />
            </Link>
            <Link to="/login" onClick={() => setOpen(false)} className="flex items-center justify-center w-full min-h-12 rounded-full border border-slate-200 text-sm font-semibold text-slate-700">
              Sign in
            </Link>
          </div>

          <Link to="/skovo-achiever-portal/login" onClick={() => setOpen(false)}
                className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-200 p-3.5">
            <span className="w-10 h-10 shrink-0 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><UserCheck size={18} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-slate-900">Are you an achiever?</span>
              <span className="block text-xs text-slate-500">Sign in to the Achiever portal</span>
            </span>
            <ArrowRight size={15} className="shrink-0 text-slate-400" />
          </Link>
        </div>
      </div>
    </nav>
  );
}

/* ── Hero ───────────────────────────────────────────────────────────── */
function Hero() {
  const landing = useLandingData();
  return (
    <section className="relative overflow-hidden bg-[#140b30]">
      {/* Glow field — deep violet rather than the old near-black hero, so the
          nav card above reads as sitting on top of the page, not floating on
          nothing. */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute -top-40 -right-24 w-175 h-175 rounded-full bg-violet-600/25 blur-[140px]" />
        <div className="absolute bottom-0 -left-10 w-100 h-100 rounded-full bg-indigo-700/20 blur-[110px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[#0d0722]/70" />
      </div>

      <div className="relative w-full px-4 sm:px-10 lg:px-16 xl:px-24 pt-24 pb-14 md:pt-36 md:pb-28">
        <div className="grid lg:grid-cols-2 gap-10 lg:gap-12 items-center">

          {/* Left - text */}
          <div>
            <h1 className="text-[2rem] sm:text-5xl xl:text-[3.4rem] font-black text-white leading-[1.12] tracking-tight mb-4 sm:mb-6 lg:max-w-xl">
              Get career-ready.<br />Unlock real opportunities.
            </h1>

            <p className="text-sm sm:text-base text-white/60 max-w-2xl lg:max-w-md leading-relaxed mb-7 sm:mb-9">
              Skovo is one app for everything between school and your first job — colleges,
              cohorts with people a few years ahead of you, peer communities, and a readiness score
              that unlocks real internships and jobs. Built for students aged 14 to 25, across every
              stream.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-8">
              <Link
                to="/signup"
                className="inline-flex items-center justify-center min-h-12 px-7 rounded-xl sm:rounded-full bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-bold text-sm shadow-lg shadow-violet-900/40 hover:-translate-y-0.5 transition-all duration-300"
              >
                Start Free
              </Link>
              <Link
                to="/cohorts"
                className="inline-flex items-center justify-center min-h-12 px-7 rounded-xl sm:rounded-full border border-white/20 hover:border-white/40 text-white/85 hover:text-white text-sm font-semibold transition-all"
              >
                Browse upcoming cohorts
              </Link>
            </div>

            <p className="text-xs text-white/40 font-medium">
              Free to start
              {landing?.counts?.verified_achievers >= COUNT_FLOOR && <> &middot; {landing.counts.verified_achievers} verified achievers</>}
              {' '}&middot; Built in Visakhapatnam
            </p>
          </div>

          {/* Right - what is live on Skovo right now (real numbers, no mock-up) */}
          <HeroLivePanel landing={landing} />
        </div>
      </div>
    </section>
  );
}

/* Skovo at a glance. Every number comes from /public/landing;
   a tile with nothing behind it is left out rather than shown as a zero. */
function HeroLivePanel({ landing }) {
  const c = landing?.counts || {};
  // Live Skovo Pro prices -- Admin › Subscriptions, same source as Pricing.
  const [plans, setPlans] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get('/subscription/plans')
      .then(({ data }) => { if (alive && data?.bool) setPlans(data.response?.plans || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  const tiles = [
    { icon: Building2,    label: 'Colleges to explore',  value: c.colleges },
    { icon: CalendarDays, label: 'Upcoming cohorts',     value: c.upcoming_cohorts },
    { icon: Briefcase,    label: 'Open opportunities',   value: c.open_opportunities },
    { icon: Users,        label: 'Peer communities',     value: c.communities },
  ].filter(t => t.value > 0);

  return (
    <div className="relative">
      <div className="absolute -inset-8 rounded-[2.5rem] bg-violet-600/20 blur-3xl pointer-events-none" />
      <div className="relative rounded-3xl border border-white/10 bg-white/[0.06] backdrop-blur-xl p-4 sm:p-6 shadow-2xl shadow-black/30">
        <div className="flex items-center justify-between mb-3 sm:mb-5">
          <p className="text-sm font-bold text-white">Skovo at a glance</p>
        </div>

        {!landing ? (
          <div className="grid grid-cols-2 gap-3">
            {[0, 1, 2, 3].map(i => <div key={i} className="h-20 sm:h-24 rounded-2xl bg-white/5 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {tiles.map(({ icon: Icon, label, value }) => (
              <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.04] p-3 sm:p-4">
                <div className="flex items-center gap-2 sm:block">
                  <span className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-violet-500/20 text-violet-200 flex items-center justify-center shrink-0">
                    <Icon size={16} />
                  </span>
                  <p className="sm:mt-3 text-xl sm:text-2xl font-black text-white tabular-nums">{value.toLocaleString('en-IN')}</p>
                </div>
                <p className="mt-1.5 sm:mt-0 text-[11px] sm:text-xs text-white/55 leading-snug">{label}</p>
              </div>
            ))}
          </div>
        )}

        {plans?.length > 0 && (
          <a href="#pricing" className="mt-3 block rounded-2xl border border-violet-400/30 bg-gradient-to-br from-violet-600/25 to-indigo-600/10 hover:from-violet-600/35 p-4 transition-colors">
            <div className="flex items-center justify-between mb-3">
              <p className="inline-flex items-center gap-1.5 text-sm font-bold text-white">
                <Sparkles size={14} className="text-amber-300" /> Skovo Pro
              </p>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-white/60">
                See plans <ArrowRight size={12} />
              </span>
            </div>
            <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
              {plans.map(pl => (
                <div key={pl.key} className={`min-w-0 rounded-xl px-1 sm:px-2 py-2 sm:py-2.5 text-center ${pl.key === 'annual' ? 'bg-white/15 ring-1 ring-emerald-300/50' : 'bg-white/[0.06]'}`}>
                  <p className="text-[11px] font-bold sm:uppercase sm:tracking-wider text-white/60 truncate">{pl.label}</p>
                  <p className="text-base sm:text-lg font-black text-white tabular-nums">₹{Number(pl.effective_price ?? pl.price).toLocaleString('en-IN')}</p>
                  <p className="text-[11px] text-white/50">₹{pl.effective_monthly}/mo</p>
                </div>
              ))}
            </div>
          </a>
        )}
      </div>
    </div>
  );
}

/* ── Section 2: the gap, then this week's way out of it ─────────────────
   Two blocks in one section on purpose. The problem cards only land if the
   cohort cards are right underneath them, so they share a background and sit
   closer together than the page's usual section rhythm would put them. */
const PROBLEM_CARDS = [
  { q: 'Which stream? Which college?',
    a: 'Counsellors sell you a report. Directories give you a list. Neither knows anything about you.' },
  { q: 'Am I actually ready?',
    a: "You can watch a hundred videos and still have no idea whether you'd survive an interview." },
  { q: 'How do I get my first break?',
    a: "Job portals want experience you don't have. The good opportunities go through networks you're not in." },
];

// Cheapest first — the heading promises "starting from ₹49", so the ₹49 card
// has to be the one the eye lands on. Sorted at render below as well, so adding
// a fourth cohort here cannot quietly put the order back out.
function ProblemAndCohortsSection() {

  return (
    <section id="this-week" className="pt-16 pb-24 bg-[#FAFAF8] overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">

        {/* ── The gap ── */}
        <Reveal direction="up">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 max-w-3xl leading-tight mb-10">
            You have 15 apps. None of them answer the question you actually have.
          </h2>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {PROBLEM_CARDS.map(({ q, a }, i) => (
            <Reveal key={q} direction="up" delay={i * 60}>
              <div className="h-full bg-white rounded-2xl p-6 border border-slate-200 hover:shadow-md hover:-translate-y-1 transition-all duration-300">
                <h3 className="font-bold text-slate-900 mb-2">{q}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{a}</p>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal direction="up" delay={180}>
          <p className="mt-8 text-center text-sm text-slate-400">
            None of these apps talk to each other. And none of them tell you if you&rsquo;re ready.
          </p>
        </Reveal>

      </div>
    </section>
  );
}

/* ── How It Works — the 4-step promise, plain language, no jargon ───── */
function HowItWorksSection() {
  const gate = useOpportunityGate();
  const steps = [
    { title: 'Create your free account',
      body: 'Tell Skovo your stream, interests, and where you want to go. Two minutes.' },
    { title: 'Do the work',
      body: 'Attend cohorts. Join communities. Explore colleges. Upload your certificates. Every action adds to your Readiness Score.' },
    { title: `Cross ${gate}`,
      body: `At score ${gate}, the Opportunities Hub unlocks. Real internships, freelance projects, part-time work, and fresher roles.` },
    { title: 'Apply with one tap',
      body: 'Your documents are already in Skovo. Apply in a tap, and track every application in one place.' },
  ];

  return (
    <section id="how-it-works" className="py-14 sm:py-24 bg-indigo-50/60 overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">
        <Reveal direction="up" className="mb-8 sm:mb-16">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 max-w-2xl leading-tight">
            From confused to career-ready. In one app.
          </h2>
        </Reveal>

        <ol className="relative grid sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-5">
          {/* connector behind the step numbers (desktop) */}
          <span aria-hidden="true" className="hidden lg:block absolute top-[2.6rem] left-[12%] right-[12%] h-px bg-gradient-to-r from-violet-400/0 via-violet-400/40 to-violet-400/0" />
          {steps.map(({ title, body }, i) => (
            <Reveal key={title} direction="up" delay={i * 80} className="h-full">
              <li className="relative h-full flex lg:flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300">
                <span className="relative z-10 w-10 h-10 shrink-0 rounded-xl bg-[#7C3AED] text-white flex items-center justify-center font-black text-sm shadow-md shadow-violet-900/30">
                  {String(i + 1).padStart(2, '0')}
                </span>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 mb-1">{title}</h3>
                  <p className="text-sm text-slate-500 leading-relaxed">{body}</p>
                </div>
              </li>
            </Reveal>
          ))}
        </ol>
      </div>
    </section>
  );
}

/* ── Features grid — the "one app, one subscription" pitch ───────────── */
function FeaturesSection() {
  const gate = useOpportunityGate();
  const features = [
    {
      icon: BookOpen,
      title: 'Cohorts',
      desc: "Sessions run by people who are 3–5 years ahead of you, not 30. A designer who just got into a studio. An analyst who cracked their first job. Real playbooks, not lectures.",
    },
    {
      icon: Users,
      title: 'Peer Communities',
      desc: "Think of it as your own career social feed. Connect with students on the same path, swap notes, and celebrate each other's wins. Ask the questions you'd never ask a teacher, and find the people who just get it.",
    },
    {
      icon: GraduationCap,
      title: 'Find Colleges',
      desc: 'Engineering, degree, diploma, universities — every stream, across India. Filter, compare, save, decide. Without opening ten tabs.',
    },
    {
      icon: Briefcase,
      title: 'Opportunities Hub',
      desc: `Internships, freelance projects, part-time work, and fresher roles. Unlocked at score ${gate}. Apply in one tap.`,
    },
    {
      icon: FolderLock,
      title: 'Document Vault',
      desc: 'Marksheets, certificates, IDs, resume — all in one secure place. Never hunt for a PDF at 2 AM before a deadline again.',
    },
  ];

  return (
    <section id="app-features" className="py-14 sm:py-24 bg-white overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">
        <Reveal direction="up" className="mb-8 sm:mb-14">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 max-w-2xl leading-tight">
            Everything you need. One app. One subscription.
          </h2>
        </Reveal>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
          {features.map(({ icon: Icon, title, desc }, i) => (
            <Reveal key={title} direction="up" delay={i * 60}>
              <div className="h-full bg-white rounded-2xl p-4 sm:p-6 border border-slate-200 hover:shadow-md hover:-translate-y-1 transition-all duration-300">
                <div className="flex items-center gap-3 sm:block mb-2 sm:mb-0">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 shrink-0 rounded-xl bg-indigo-50 flex items-center justify-center sm:mb-4">
                    <Icon size={19} className="text-indigo-600" />
                  </div>
                  <h3 className="font-bold text-slate-900 sm:mb-2">{title}</h3>
                </div>
                <p className="text-sm text-slate-500 leading-relaxed">{desc}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── How the score grows ───────────────────────────────────────────── */
// Score Engine rules arrive as event types; group them into what a student
// actually does. Anything new falls into "More ways" rather than vanishing.
const SCORE_GROUPS = [
  { key: 'streaks',   title: 'Keep a streak',   icon: Flame,  tint: 'from-orange-500/25 to-rose-500/10 text-orange-200',
    test: (t) => /streak/.test(t) },
  { key: 'practice',  title: 'Practise daily',  icon: Target, tint: 'from-emerald-500/25 to-teal-500/10 text-emerald-200',
    test: (t) => /quiz|quest|speed|mistake|daily_goal|perfect_week/.test(t) },
  { key: 'community', title: 'Help the community', icon: Users, tint: 'from-sky-500/25 to-indigo-500/10 text-sky-200',
    test: (t) => /answer|community|post|reaction|referral/.test(t) },
  { key: 'pro',       title: 'Go Pro',          icon: Crown,  tint: 'from-amber-400/25 to-yellow-500/10 text-amber-200',
    test: (t) => /pro_subscription|^m_pro/.test(t) },
  { key: 'daily',     title: 'Show up',         icon: LogIn,  tint: 'from-violet-500/25 to-fuchsia-500/10 text-violet-200',
    test: (t) => /login/.test(t) },
  { key: 'more',      title: 'More ways',       icon: Zap,    tint: 'from-slate-400/20 to-slate-500/10 text-slate-200',
    test: () => true },
];

const CAP_LABEL = { daily: 'a day', weekly: 'a week', monthly: 'a month', none: 'once', per_item: 'each time' };
const pts = (n) => `+${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

function ScoreGrowthSection() {
  const landing = useLandingData();
  const gate = useOpportunityGate();
  const rules = landing?.score_rules || [];
  const groups = SCORE_GROUPS.map(g => ({ ...g, rules: [] }));
  rules.forEach(r => groups.find(g => g.test(r.event_type || ''))?.rules.push(r));
  const shown = groups.filter(g => g.rules.length);

  return (
    <section className="relative overflow-hidden bg-[#140b30] py-14 sm:py-24">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-150 h-150 rounded-full bg-indigo-700/15 blur-[130px]" />
        <div className="absolute bottom-0 left-0 w-120 h-120 rounded-full bg-violet-700/10 blur-[120px]" />
      </div>

      <div className="relative w-full px-4 sm:px-10 lg:px-16 xl:px-24">
        <div className="grid lg:grid-cols-5 gap-8 lg:gap-16 items-start">
          {/* Left: the promise + the unlock meter */}
          <Reveal direction="left" className="lg:col-span-2">
            <span className="block text-xs font-bold text-indigo-300/80 uppercase tracking-widest mb-4">The Readiness Score</span>
            <h2 className="text-2xl sm:text-5xl font-black text-white mb-4 sm:mb-6">Your score is your key.</h2>
            <p className="text-sm sm:text-base text-white/55 leading-relaxed mb-6 sm:mb-8">
              Most platforms show you opportunities you can't get. Skovo works the other way around:
              do the work, build your score, and the opportunities open up.
            </p>

            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-6">
              <div className="flex items-end justify-between gap-4 mb-4">
                <div>
                  <p className="text-xs font-semibold text-white/50">You start at</p>
                  <p className="text-2xl sm:text-3xl font-black text-white">0</p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-semibold text-emerald-300">Unlocks at</p>
                  <p className="text-2xl sm:text-3xl font-black text-emerald-300">{gate}</p>
                </div>
              </div>
              <div className="relative h-3 rounded-full bg-white/10">
                <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-emerald-400"
                     style={{ width: `${gate}%` }} />
                <span className="absolute -top-1.5 w-1 h-6 rounded bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,.8)]"
                      style={{ left: `calc(${gate}% - 2px)` }} />
              </div>
              <div className="flex justify-between text-[11px] text-white/40 mt-2">
                <span>0</span><span>100</span>
              </div>
              <p className="mt-4 text-sm text-white/60">
                Cross {gate} and the Opportunities Hub opens: internships, part-time work and fresher roles.
              </p>
            </div>

            <div className="mt-3 sm:mt-4 rounded-3xl border border-white/10 bg-white/[0.03] p-4 sm:p-6">
              <p className="text-sm font-bold text-white mb-2">Taking a break? Your score is safe.</p>
              <p className="text-sm text-white/50 leading-relaxed">
                Board exams, semester exams, family emergencies — life happens. Pause your score from
                My Score and it stays frozen until you are back.
              </p>
            </div>
          </Reveal>

          {/* Right: the real Score Engine actions, grouped */}
          <Reveal direction="right" delay={120} className="lg:col-span-3">
            <h3 className="text-lg font-bold text-white mb-5">How your score grows</h3>
            {!landing ? (
              <div className="grid sm:grid-cols-2 gap-4">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-3xl bg-white/5 animate-pulse" />)}</div>
            ) : shown.length === 0 ? (
              <p className="text-sm text-white/50">Cohorts, tasks, streaks and practice all add points.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3 sm:gap-4">
                {shown.map(({ key, title, icon: Icon, tint, rules: rs }) => (
                  <div key={key} className={`rounded-3xl border border-white/10 bg-gradient-to-br ${tint.split(' ').slice(0, 2).join(' ')} p-4 sm:p-5`}>
                    <div className="flex items-center gap-3 mb-4">
                      <span className={`w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center ${tint.split(' ')[2]}`}><Icon size={18} /></span>
                      <p className="font-bold text-white">{title}</p>
                    </div>
                    <ul className="space-y-2.5">
                      {rs.slice(0, 4).map(r => (
                        <li key={r.event_type} className="flex items-start justify-between gap-3">
                          <span className="text-sm text-white/75 leading-snug">
                            {r.label}
                            {CAP_LABEL[r.cap_type] && <span className="block text-[11px] text-white/40">{CAP_LABEL[r.cap_type]}</span>}
                          </span>
                          <span className="shrink-0 px-2 py-0.5 rounded-lg bg-emerald-400/15 text-emerald-300 text-sm font-black tabular-nums">{pts(r.points)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Achievers Section ──────────────────────────────────────────────── */
function AchieversSection() {
  const perks = [
    { icon: Briefcase,    text: 'Set your own session rates and schedule' },
    { icon: Users,        text: 'Run paid group cohorts with up to 50 students' },
    { icon: Shield,       text: 'Verified badge after admin approval' },
    { icon: TrendingUp,   text: 'Build your personal brand on SKOVO' },
    { icon: Award,        text: 'Earnings paid directly to your bank account' },
  ];

  return (
    <section id="achievers" className="py-14 sm:py-24 bg-white overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">
        <div className="grid lg:grid-cols-2 gap-8 lg:gap-16 items-center">

          <Reveal direction="left" className="order-2 lg:order-1">
            <div className="relative">
              <div className="hidden sm:block absolute -inset-6 rounded-3xl bg-linear-to-br from-violet-600/10 to-indigo-600/5 blur-xl" />
              <ol className="relative rounded-3xl border border-slate-200 bg-white p-4 sm:p-8 space-y-5 sm:space-y-0 sm:grid sm:grid-cols-2 sm:gap-x-8 sm:gap-y-6 lg:block lg:space-y-6">
                <p className="sm:col-span-2 text-xs font-bold uppercase tracking-widest text-violet-600">How achievers join</p>
                {[
                  { icon: UserCheck,  title: 'Apply',          text: 'Create your achiever account and fill in your profile.' },
                  { icon: FileCheck2, title: 'Get verified',   text: 'Upload your documents; our team checks identity, employment and background.' },
                  { icon: Rocket,     title: 'Start teaching',        text: 'Publish cohorts, take 1:1 sessions and get paid to your bank.' },
                ].map(({ icon: Icon, title, text }, i, arr) => (
                  <li key={title} className="relative flex gap-4">
                    {i < arr.length - 1 && <span className="sm:hidden lg:block absolute left-5 top-11 bottom-[-1.5rem] w-px bg-violet-100" aria-hidden="true" />}
                    <span className="relative w-10 h-10 shrink-0 rounded-xl bg-linear-to-br from-violet-600 to-indigo-600 text-white flex items-center justify-center shadow-md shadow-violet-900/20">
                      <Icon size={18} />
                    </span>
                    <div>
                      <p className="font-bold text-slate-900"><span className="text-violet-500 mr-1.5">{String(i + 1).padStart(2, '0')}</span>{title}</p>
                      <p className="text-sm text-slate-500 leading-relaxed mt-0.5">{text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>

          <Reveal direction="right" delay={100} className="order-1 lg:order-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-bold px-3 py-1 rounded-full bg-violet-50 text-violet-700 mb-5">
              <Star size={11} /> For Achievers
            </span>
            <h2 className="text-2xl sm:text-4xl font-black text-slate-900 mb-5 leading-tight">
              Share What You Know.
              <br />
              <span className="text-transparent bg-clip-text bg-linear-to-r from-violet-600 to-indigo-600">
                Earn What You Deserve.
              </span>
            </h2>
            <p className="text-slate-500 mb-8 leading-relaxed">
              You have built a career. Now help thousands of students do the same. SKOVO makes it
              easy to mentor on your own terms - no middlemen, no complexity.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-9">
              {perks.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Icon size={13} className="text-violet-600" />
                  </div>
                  <p className="text-sm text-slate-700 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link
                to="/skovo-achiever-portal/register"
                className="inline-flex items-center justify-center gap-2 min-h-12 px-7 whitespace-nowrap bg-[#7C3AED] hover:bg-[#8B5CF6] text-white font-bold text-sm rounded-2xl shadow-lg shadow-violet-900/30 transition-all"
              >
                Become an Achiever <ArrowRight size={15} />
              </Link>
              <Link
                to="/skovo-achiever-portal/login"
                className="inline-flex items-center justify-center gap-2 min-h-12 px-7 whitespace-nowrap border border-slate-200 hover:bg-slate-50 text-slate-700 font-semibold text-sm rounded-2xl transition-all"
              >
                Achiever Sign In
              </Link>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ── Pricing — the one paid decision on the whole site ──────────────── */

// The numbers are admin-managed (Admin → Subscriptions, served by the public
// GET /subscription/plans), so a price change or a limited-time offer goes live
// without a redeploy. The lists are the story around the numbers, so they live
// with the page. The fallbacks below are the currently published prices — they
// render instantly and are replaced the moment the API answers, so a slow or
// failed request still shows real pricing rather than an empty card.
const PRICING_FALLBACK = { monthly: 199, quarterly: 499, annual: 1499 };

// Every Skovo Pro plan carries the same perks -- the plans differ only in price
// and billing period. The perk titles come from /subscription/plans (the same
// list the Skovo Pro screen shows); these are only the first-paint fallback.
const PRO_PERKS_FALLBACK = [
  'Unlimited cohorts',
  'Detailed Colleges with scholarships',
  'Unlimited community Leads & Creations',
  'Personalised Fresh Job Opportunities',
  'Early BhaAI (Career Agent) Access',
  'Priority Career Tools access',
];

const PLAN_COPY = {
  free:      { name: 'Free' },
  monthly:   { name: 'Skovo Pro — Monthly',   unit: '/month',    months: 1 },
  quarterly: { name: 'Skovo Pro — Quarterly', unit: '/3 months', months: 3 },
  annual:    { name: 'Skovo Pro — Annual',    unit: '/year',     months: 12 },
};

const inr = n => `₹${Number(n || 0).toLocaleString('en-IN')}`;

/* One ticked feature line — same green check in both card themes. */
function PlanFeature({ children, dark = false }) {
  return (
    <li className="flex items-start gap-3">
      <Check size={16} strokeWidth={3} className="text-emerald-500 shrink-0 mt-0.5" />
      <span className={`text-sm leading-relaxed ${dark ? 'text-white/85' : 'text-slate-700'}`}>
        {children}
      </span>
    </li>
  );
}

function freePlanFeatures(L) {
  const nC = L?.communities ?? 3;
  const nS = L?.saved_colleges ?? 3;
  const nK = L?.free_paid_cohorts ?? 1;
  const nV = L?.vault_docs ?? 5;
  return [
    'Browse every college in India',
    `Join up to ${nC} communit${nC === 1 ? 'y' : 'ies'}`,
    `Save up to ${nS} college${nS === 1 ? '' : 's'}`,
    nK === 1 ? '1 free paid cohort' : `${nK} free paid cohorts`,
    `${nV} document${nV === 1 ? '' : 's'} in your Vault`,
    'Build your Readiness Score',
  ];
}

function PricingSection() {
  const gate = useOpportunityGate();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [plans, setPlans] = useState(null);
  const [limits, setLimits] = useState(null);
  const [perks, setPerks] = useState(null);
  const [pending, setPending] = useState(null);
  const [cycle, setCycle] = useState('annual');

  useEffect(() => {
    let alive = true;
    api.get('/subscription/plans')
      .then(({ data }) => {
        if (!alive || !data?.bool) return;
        const byKey = {};
        (data.response?.plans || []).forEach(p => { byKey[p.key] = p; });
        setPlans(byKey);
        if (data.response?.limits) setLimits(data.response.limits);
        const titles = (data.response?.perk_details || []).map(x => x.title).filter(Boolean);
        if (titles.length) setPerks(titles);
      })
      .catch(() => { /* fallback prices are already on screen */ });
    return () => { alive = false; };
  }, []);

  // Shape a card's price from whatever the API gave us, falling back to the
  // published price so a card is never blank or stuck in a skeleton.
  const priced = (key, fallback, months) => {
    const p = plans?.[key];
    const price = p?.effective_price ?? fallback;
    const struck = p && p.effective_price < p.price ? p.price : null;
    return {
      price,
      struck,
      offer: p?.offer_label || null,
      perMonth: p?.effective_monthly ?? Math.round(price / months),
    };
  };

  const proPerks = perks || PRO_PERKS_FALLBACK;
  const credits = limits?.session_credits;
  const monthlyPrice = priced('monthly', PRICING_FALLBACK.monthly, 1).price;

  // Logged out, the subscribe endpoint has no account to attach a membership
  // to — so remember the plan, send them through signup, and pick checkout back
  // up on /skovo-pro the moment they land.
  const goPro = (planKey) => {
    setPending(planKey);
    if (user) { navigate(`/skovo-pro?plan=${planKey}&checkout=1`); return; }
    setPendingPlan(planKey);
    navigate('/signup');
  };

  // The violet below is spelled out rather than `bg-violet-600`: index.css
  // rewrites any button carrying that class to the in-app accent colour, and
  // this landing page is unthemed marketing chrome.
  const proButton = (planKey, className) => (
    <button
      type="button"
      onClick={() => goPro(planKey)}
      disabled={pending === planKey}
      aria-label={`Get ${PLAN_COPY[planKey].name}`}
      className={`mt-8 w-full inline-flex items-center justify-center gap-2 py-4 rounded-full font-bold text-sm transition-all disabled:opacity-70 ${className}`}
    >
      {pending === planKey && <Loader2 size={16} className="animate-spin" />}
      Get Skovo Pro
    </button>
  );

  return (
    <section id="pricing" className="py-14 sm:py-24 bg-[#FAFAF8] overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">

        <Reveal direction="up" className="mb-14">
          <h2 className="text-2xl sm:text-4xl lg:text-5xl font-black tracking-tight text-slate-900 leading-tight">
            One subscription. No surprises.
          </h2>
        </Reveal>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 max-w-md md:max-w-2xl mx-auto lg:max-w-6xl items-stretch">

          {/* ── Free ── */}
          <Reveal direction="up" className="h-full lg:col-span-2">
            <div className="h-full flex flex-col bg-white rounded-3xl border border-slate-200 p-8">
              <h3 className="text-lg font-bold text-slate-900">{PLAN_COPY.free.name}</h3>
              <p className="mt-1 text-sm text-slate-500">Everything you need to get started.</p>
              <p className="mt-6 text-5xl font-black tracking-tight text-slate-900">₹0</p>
              <p className="mt-1 text-sm text-slate-400">forever</p>

              <ul className="mt-8 space-y-3.5 flex-1">
                {freePlanFeatures(limits).map(f => <PlanFeature key={f}>{f}</PlanFeature>)}
              </ul>

              <Link
                to={user ? '/career-path' : '/signup'}
                className="mt-8 w-full inline-flex items-center justify-center py-4 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-900 font-bold text-sm transition-colors"
              >
                {user ? 'Go to Skovo' : 'Start Free'}
              </Link>
            </div>
          </Reveal>

          {/* ── Skovo Pro — one card, the plan is a switch ── */}
          {(() => {
            const copy = PLAN_COPY[cycle];
            const plan = priced(cycle, PRICING_FALLBACK[cycle], copy.months);
            const saving = copy.months > 1 ? monthlyPrice * copy.months - plan.price : 0;
            return (
              <Reveal direction="up" delay={100} className="h-full lg:col-span-3">
                <div className="relative h-full flex flex-col rounded-3xl p-5 sm:p-8 bg-[#150E2E] shadow-2xl shadow-indigo-950/20 overflow-hidden">
                  <div className="absolute -top-24 -right-24 w-72 h-72 rounded-full bg-violet-600/30 blur-3xl pointer-events-none" />

                  <div className="relative flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="inline-flex items-center gap-2 text-lg font-bold text-white">
                        <Crown size={18} className="text-amber-300" /> Skovo Pro
                      </h3>
                      <p className="mt-1 text-sm text-white/55">Same Pro on every plan — pick how you pay.</p>
                    </div>
                    {/* Plan switch */}
                    <div role="tablist" aria-label="Billing period" className="grid grid-cols-3 gap-1 p-1 rounded-full bg-white/10 text-xs font-bold">
                      {['monthly', 'quarterly', 'annual'].map(k => (
                        <button key={k} type="button" role="tab" aria-selected={cycle === k} onClick={() => setCycle(k)}
                                className={`relative px-2 sm:px-4 min-h-10 rounded-full transition-colors ${cycle === k ? 'bg-[#ffffff] text-[#150E2E] shadow' : 'text-white/70 hover:text-white'}`}>
                          {plans?.[k]?.label || k[0].toUpperCase() + k.slice(1)}
                          {k === 'annual' && cycle !== 'annual' && <span className="absolute -top-1.5 -right-1 w-2 h-2 rounded-full bg-emerald-400" />}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="relative mt-8 flex flex-wrap items-end gap-x-4 gap-y-2">
                    <p className="flex items-baseline gap-2">
                      {plan.struck && <span className="text-xl font-bold text-white/35 line-through">{inr(plan.struck)}</span>}
                      <span className="text-5xl sm:text-6xl font-black tracking-tight text-white tabular-nums">{inr(plan.price)}</span>
                      <span className="text-base text-white/50">{copy.unit}</span>
                    </p>
                    {saving > 0 && (
                      <span className="mb-2 px-2.5 py-1 rounded-full bg-emerald-400/15 text-emerald-300 text-xs font-black">
                        Save {inr(saving)}
                      </span>
                    )}
                  </div>
                  <p className="relative mt-2 text-sm text-white/50">
                    {copy.months > 1 ? `works out to ${inr(plan.perMonth)}/month` : 'billed every month, cancel any time'}
                    {plan.offer && <span className="ml-2 font-black uppercase tracking-wide text-emerald-400">{plan.offer}</span>}
                  </p>

                  <p className="relative mt-8 text-sm text-white/60">Everything in Free, plus:</p>
                  <ul className="relative mt-4 grid sm:grid-cols-2 gap-x-6 gap-y-3.5 flex-1">
                    {proPerks.map(f => <PlanFeature key={f} dark>{f}</PlanFeature>)}
                    {credits > 0 && <PlanFeature dark>{credits} free 1:1 session{credits === 1 ? '' : 's'} with an achiever each month</PlanFeature>}
                    <PlanFeature dark>Opportunities Hub at score {gate}+</PlanFeature>
                  </ul>

                  {proButton(cycle, 'relative bg-[#7C3AED] hover:bg-[#8B5CF6] text-white shadow-lg shadow-violet-900/40')}
                </div>
              </Reveal>
            );
          })()}
        </div>

        <Reveal direction="up" delay={220}>
          <p className="mt-14 text-center text-sm text-slate-400 leading-relaxed">
            Prefer to pay as you go? Book any cohort on its own, no subscription needed.
            1:1 sessions with achievers are priced by each achiever and billed separately from Skovo Pro.
          </p>
        </Reveal>
      </div>
    </section>
  );
}

/* ── Founder Story ──────────────────────────────────────────────────── */
// The portrait gets its own useInView rather than a <Reveal> wrapper: the
// entrance here is a scale+fade rather than the slide the rest of the page
// uses, and the hover zoom needs the group to sit on the frame, not on a
// transformed wrapper (nested transforms fight each other).
function FounderSection() {
  const [photoRef, photoIn] = useInView(0.2);

  return (
    <section id="founder" className="py-14 sm:py-24 bg-indigo-50/60 overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">

        <Reveal direction="up">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 leading-tight mb-12 lg:mb-14">
            Built by someone who lived this.
          </h2>
        </Reveal>

        <div className="grid gap-10 sm:gap-12 md:gap-10 lg:gap-16 xl:gap-20 md:grid-cols-[14rem_minmax(0,1fr)] lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)] items-center">

          {/* Portrait */}
          <div ref={photoRef} className="w-56 sm:w-64 md:w-full mx-auto md:mx-0">
            <div
              className="group relative"
              style={{
                opacity: photoIn ? 1 : 0,
                transform: photoIn ? 'scale(1) translateY(0)' : 'scale(0.94) translateY(28px)',
                transition: 'opacity 0.8s ease, transform 0.9s cubic-bezier(.22,.68,0,1.2)',
                willChange: 'opacity, transform',
              }}
            >
              <div className="absolute -inset-4 rounded-[2.25rem] bg-linear-to-br from-violet-600/15 via-indigo-600/10 to-transparent blur-xl" />
              <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-slate-100 ring-1 ring-slate-900/5 shadow-xl shadow-indigo-950/10 transition-all duration-500 group-hover:shadow-2xl group-hover:shadow-indigo-950/20 group-hover:-translate-y-1">
                <img
                  src="/founder-yogendra.jpg"
                  alt="Yogendra Naidu Pappala, Founder and CEO of Skovo"
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover object-[center_28%] transition-transform duration-700 ease-out group-hover:scale-[1.06]"
                />
                <div className="pointer-events-none absolute inset-0 bg-linear-to-t from-slate-950/30 via-transparent to-transparent" />
              </div>
            </div>
          </div>

          {/* Story */}
          <Reveal direction="right" delay={120}>
            <div className="max-w-2xl">
              <p className="text-slate-600 text-base sm:text-lg leading-relaxed">
                Yogendra Naidu Pappala is a first-generation founder from Visakhapatnam. He grew up
                watching bright students around him make irreversible decisions &mdash; streams, colleges,
                careers &mdash; with no real guidance and no exposure to what those choices actually led to.
                Not because they lacked talent. Because nobody gave them clarity at the moment they
                needed it.
              </p>
              <p className="mt-5 text-slate-600 text-base sm:text-lg leading-relaxed">
                Skovo is what he wishes he&rsquo;d had at 17. He&rsquo;s building it for the students who come next.
              </p>

              <div className="mt-8 pt-6 border-t border-indigo-200/70">
                <p className="font-black text-slate-900">Yogendra Naidu Pappala</p>
                <p className="mt-0.5 text-sm text-slate-500">Founder &amp; CEO, Skovo Educations Pvt. Ltd.</p>
              </div>
            </div>
          </Reveal>

        </div>
      </div>
    </section>
  );
}

/* ── Roadmap ────────────────────────────────────────────────────────── */
const ROADMAP = [
  { label: 'Now',   badge: 'Available now', desc: 'Cohorts, communities, colleges, opportunities, and your vault. Available today.' },
  { label: '2027',  desc: 'Achievers launch their own courses. AI Career Agent in Telugu, Hindi and Tamil.' },
  { label: '2028',  desc: 'Skovo partners with schools and colleges directly.' },
  { label: '2029+', desc: 'Skovo Certified Centres. Offline, in every city.' },
];

// `live` is the shipped milestone (filled, green); everything after it is a
// hollow ring that fills indigo on hover. Both layouts share this so the
// horizontal and vertical timelines can never drift apart.
function RoadmapDot({ live }) {
  return live ? (
    <span className="block h-3 w-3 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
  ) : (
    <span className="block h-3 w-3 shrink-0 rounded-full border-2 border-slate-300 bg-[#FAFAF8] transition-colors duration-300 group-hover:border-indigo-500 group-hover:bg-indigo-500" />
  );
}

function RoadmapCopy({ stage }) {
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-2.5">
        <p className="text-xl font-black text-slate-900">{stage.label}</p>
        {stage.badge && (
          <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-bold text-emerald-700 ring-1 ring-emerald-600/20">
            {stage.badge}
          </span>
        )}
      </div>
      <p className="text-sm text-slate-500 leading-relaxed transition-colors duration-300 group-hover:text-slate-600">
        {stage.desc}
      </p>
    </>
  );
}

function RoadmapSection() {
  const last = ROADMAP.length - 1;

  return (
    <section id="roadmap" className="py-14 sm:py-24 bg-[#FAFAF8] overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">

        <Reveal direction="up">
          <h2 className="text-2xl sm:text-4xl font-black text-slate-900 leading-tight mb-12 lg:mb-14">
            Where Skovo is going.
          </h2>
        </Reveal>

        {/* Horizontal rail (md and up). The connector is pulled back across the
            column's right padding with a negative margin so the rail lands
            exactly on the next dot instead of stopping short of it. */}
        <div className="hidden md:flex items-stretch">
          {ROADMAP.map((stage, i) => (
            <Reveal key={stage.label} direction="up" delay={i * 90} className="flex-1 min-w-0">
              <div className={`group h-full ${i === last ? '' : 'pr-8 lg:pr-14'}`}>
                <div className="flex items-center h-3 mb-7">
                  <RoadmapDot live={i === 0} />
                  {i !== last && (
                    <span className={`ml-3 -mr-8 lg:-mr-14 h-px flex-1 ${i === 0 ? 'bg-linear-to-r from-emerald-400/80 to-slate-200' : 'bg-slate-200'}`} />
                  )}
                </div>
                <RoadmapCopy stage={stage} />
              </div>
            </Reveal>
          ))}
        </div>

        {/* Vertical rail (below md) */}
        <div className="md:hidden">
          {ROADMAP.map((stage, i) => (
            <Reveal key={stage.label} direction="up" delay={i * 80}>
              <div className={`group relative flex gap-4 ${i === last ? '' : 'pb-9'}`}>
                {i !== last && (
                  <span className={`absolute left-[5px] top-5 bottom-0 w-px ${i === 0 ? 'bg-linear-to-b from-emerald-400/80 to-slate-200' : 'bg-slate-200'}`} />
                )}
                <div className="relative mt-1.5">
                  <RoadmapDot live={i === 0} />
                </div>
                <div className="min-w-0 flex-1 -mt-1">
                  <RoadmapCopy stage={stage} />
                </div>
              </div>
            </Reveal>
          ))}
        </div>

        <Reveal direction="up" delay={220}>
          <p className="mt-14 text-center text-sm text-slate-400 leading-relaxed">
            We ship what&rsquo;s ready when it&rsquo;s ready &mdash; and tell you honestly what isn&rsquo;t.
          </p>
        </Reveal>

      </div>
    </section>
  );
}

/* ── FAQ ────────────────────────────────────────────────────────────── */

// Multiple rows can sit open at once, so open state is a Set of indices rather
// than a single active index. The answer animates on grid-template-rows
// 0fr -> 1fr, which gives a real height transition without measuring anything
// or hard-coding a max-height that clips long answers on narrow screens.
function FAQItem({ faq, open, onToggle, id }) {
  return (
    <div>
      <h3>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          aria-controls={`${id}-answer`}
          className="group flex w-full items-center justify-between gap-4 px-5 sm:px-7 py-5 text-left cursor-pointer"
        >
          <span className="text-base sm:text-lg font-bold text-slate-900 leading-snug transition-colors duration-200 group-hover:text-indigo-700">
            {faq.q}
          </span>
          <ChevronDown
            size={20}
            className={`shrink-0 text-slate-400 transition-all duration-300 group-hover:text-indigo-600 ${open ? 'rotate-180 text-indigo-600' : ''}`}
          />
        </button>
      </h3>
      <div
        id={`${id}-answer`}
        role="region"
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <div className="overflow-hidden">
          <p
            className="px-5 sm:px-7 pb-6 pr-10 sm:pr-14 text-sm sm:text-base text-slate-500 leading-relaxed transition-opacity duration-300"
            style={{ opacity: open ? 1 : 0 }}
          >
            {faq.a}
          </p>
        </div>
      </div>
    </div>
  );
}

function FAQSection() {
  const gate = useOpportunityGate();
  // Admin › Platform settings › Landing FAQs. Nothing to show -> no section.
  const faqs = useLandingData()?.faqs || [];
  const [openIdx, setOpenIdx] = useState(() => new Set());

  const toggle = (i) =>
    setOpenIdx((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  if (!faqs.length) return null;
  return (
    <section id="faq" className="py-20 sm:py-14 sm:py-24 bg-indigo-50/60 overflow-hidden">
      <div className="w-full px-4 sm:px-10 lg:px-16 xl:px-24">

        <Reveal direction="up" className="mb-10 sm:mb-12">
          <h2 className="text-2xl sm:text-4xl font-black tracking-tight text-slate-900 leading-tight text-center">
            Questions, answered.
          </h2>
        </Reveal>

        <Reveal direction="up" delay={80}>
          <div className="mx-auto max-w-3xl divide-y divide-slate-200 rounded-3xl bg-white border border-slate-200 shadow-sm overflow-hidden">
            {faqs.map((faq, i) => (
              <FAQItem
                key={faq.id}
                id={`faq-${i}`}
                faq={{ q: faq.question, a: faq.answer.replaceAll('{gate}', gate) }}
                open={openIdx.has(i)}
                onToggle={() => toggle(i)}
              />
            ))}
          </div>
        </Reveal>

      </div>
    </section>
  );
}

/* ── Final CTA ──────────────────────────────────────────────────────── */
function FinalCTA() {
  const landing = useLandingData();
  return (
    <section className="py-14 sm:py-24 bg-linear-to-br from-indigo-700 via-indigo-600 to-violet-700 overflow-hidden relative">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-125 h-100 rounded-full bg-violet-500/20 blur-[100px]" />
        <div className="absolute bottom-0 left-0 w-100 h-75 rounded-full bg-indigo-400/20 blur-[80px]" />
      </div>
      <div className="relative w-full px-4 sm:px-10 lg:px-16 xl:px-24 text-center">
        <Reveal direction="up">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/15 border border-white/20 text-white text-xs font-bold mb-8">
            <Sparkles size={12} /> Free to start
          </div>
          <h2 className="text-2xl sm:text-4xl font-black text-white mb-5 leading-tight">
            Your Career Won't Wait.<br />Start Today.
          </h2>
          <p className="text-white/70 mb-10 max-w-xl mx-auto text-lg leading-relaxed">
            {landing?.counts?.students >= COUNT_FLOOR
              ? <>Join {landing.counts.students.toLocaleString('en-IN')} students already building their careers with SKOVO. </>
              : <>Start building your career with SKOVO. </>}
            No credit card needed to start.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link to="/signup" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-9 py-4 bg-white hover:bg-slate-50 text-indigo-700 font-black text-base rounded-2xl shadow-2xl transition-all">
              Create Free Account <ArrowRight size={17} />
            </Link>
            <Link to="/login" className="w-full sm:w-auto inline-flex items-center justify-center px-9 py-4 border-2 border-white/30 hover:border-white/60 text-white font-semibold text-base rounded-2xl transition-all">
              Sign In
            </Link>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* Brand marks are inlined because lucide v1 dropped its brand glyphs — this
   avoids pulling in a second icon package for six paths.
   NOTE: these profile URLs are placeholders — swap in the real handles. */
// Social icons by support-contact channel. A link shows only when Admin ›
// Support has an active public contact on that channel -- no placeholder URLs.
const SOCIAL_ICONS = {
  instagram: 'M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm7.846-10.405a1.441 1.441 0 01-2.88 0 1.44 1.44 0 012.88 0z',
  linkedin: 'M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z',
  youtube: 'M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z',
  x: 'M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z',
  whatsapp: 'M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.872.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z',
  facebook: 'M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z',
};

const contactHref = (c) => {
  if (c.channel === 'email') return `mailto:${c.value}?subject=${encodeURIComponent('SKOVO support request')}`;
  if (c.channel === 'phone') return `tel:${c.value.replace(/\s/g, '')}`;
  if (c.channel === 'whatsapp' && !/^https?:/.test(c.value)) return `https://wa.me/${c.value.replace(/\D/g, '')}`;
  return /^https?:/.test(c.value) ? c.value : `https://${c.value}`;
};

function usePublicContacts() {
  const [contacts, setContacts] = useState([]);
  useEffect(() => {
    let alive = true;
    api.get('/support/public-contacts')
      .then(({ data }) => { if (alive && data?.bool) setContacts(data.response?.contacts || []); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);
  return contacts;
}

const FOOTER_COLUMNS = [
  { heading: 'Students', links: [
    { label: 'Create free account', to: '/signup' },
    { label: 'Sign in', to: '/login' },
    { label: 'Find achievers', to: '/find-mentors' },
  ] },
  { heading: 'Achievers', links: [
    { label: 'Become an achiever', to: '/skovo-achiever-portal/register' },
    { label: 'Achiever sign in', to: '/skovo-achiever-portal/login' },
    { label: 'How achievers join', href: '#achievers' },
  ] },
  { heading: 'Platform', links: [
    { label: 'How it works', href: '#how-it-works' },
    { label: 'Features', href: '#app-features' },
    { label: 'Pricing', href: '#pricing' },
    { label: 'FAQ', href: '#faq' },
  ] },
  { heading: 'Legal', links: [
    { label: 'Terms & Conditions', to: '/terms' },
    { label: 'Privacy Policy', to: '/privacy' },
    { label: 'Refund & Cancellation', to: '/refund' },
    { label: 'Contact us', to: '/contact' },
  ] },
];

/* ── Footer ─────────────────────────────────────────────────────────── */
function Footer() {
  const contacts = usePublicContacts();
  const direct = contacts.filter(c => c.channel === 'email' || c.channel === 'phone');
  const socials = contacts.filter(c => SOCIAL_ICONS[c.channel]);
  const linkCls = 'inline-flex items-center min-h-10 sm:min-h-0 text-sm text-slate-400 hover:text-white transition-colors';

  return (
    <footer className="relative bg-[#05080f] text-white overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-violet-500/60 to-transparent" />
      <div className="absolute -top-40 left-1/2 -translate-x-1/2 w-[40rem] h-80 rounded-full bg-violet-700/10 blur-[120px] pointer-events-none" />

      <div className="relative w-full px-4 sm:px-10 lg:px-16 xl:px-24 pt-16 pb-10">
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-x-6 gap-y-10 mb-12">
          <div className="col-span-2">
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-10 h-10 rounded-xl overflow-hidden shrink-0 shadow-md ring-1 ring-white/10">
                <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
              </div>
              <span className="text-xl font-black text-white">SKOVO</span>
            </div>
            <p className="text-slate-400 text-sm leading-relaxed max-w-xs mb-5">
              The Student Career Readiness OS — colleges, cohorts, communities and opportunities in one place.
            </p>
            <ul className="space-y-2">
              {(direct.length ? direct : [{ id: 'mail', channel: 'email', value: 'support@skovoai.com', label: 'Email' }]).map(c => (
                <li key={c.id}>
                  <a href={contactHref(c)} className="inline-flex items-center gap-2 min-h-10 text-sm text-slate-400 hover:text-white transition-colors">
                    <Mail size={14} className="shrink-0" /> {c.value}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {FOOTER_COLUMNS.map(({ heading, links }) => (
            <nav key={heading} aria-label={heading}>
              <p className="text-xs font-bold text-white uppercase tracking-widest mb-4">{heading}</p>
              <ul className="space-y-0 sm:space-y-3">
                {links.map(({ label, to, href }) => (
                  <li key={label}>
                    {to ? <Link to={to} className={linkCls}>{label}</Link> : <a href={href} className={linkCls}>{label}</a>}
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="pt-8 border-t border-white/5 flex flex-col-reverse sm:flex-row items-center justify-between gap-5">
          <div className="text-center sm:text-left">
            <p className="text-slate-500 text-xs">&copy; {new Date().getFullYear()} Skovo Educations Pvt. Ltd. All rights reserved.</p>
            <p className="text-slate-600 text-xs mt-1">Built in Visakhapatnam for India's next generation of achievers.</p>
          </div>
          <div className="flex items-center gap-2">
            {socials.map(c => (
              <a key={c.id} href={contactHref(c)} target="_blank" rel="noreferrer noopener"
                 aria-label={c.label} title={c.label}
                 className="w-9 h-9 rounded-xl border border-white/10 flex items-center justify-center text-slate-400 hover:text-white hover:border-white/30 transition-colors">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden="true"><path d={SOCIAL_ICONS[c.channel]} /></svg>
              </a>
            ))}
            <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                    aria-label="Back to top"
                    className="w-9 h-9 rounded-xl bg-white/5 hover:bg-white/10 flex items-center justify-center text-slate-300 transition-colors">
              <ChevronDown size={16} className="rotate-180" />
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

/* ── Page root ──────────────────────────────────────────────────────── */
export default function LandingPage() {
  return (
    <div className="min-h-screen font-sans antialiased">
      <Navbar />
      <Hero />
      <ProblemAndCohortsSection />
      <HowItWorksSection />
      <FeaturesSection />
      <ScoreGrowthSection />
      <AchieversSection />
      <PricingSection />
      <FounderSection />
      <RoadmapSection />
      <FAQSection />
      <FinalCTA />
      <Footer />
    </div>
  );
}
