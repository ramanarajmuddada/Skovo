import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldCheck, Crown, ArrowRight, Lock, ScrollText, KeyRound, Clock, ChevronDown } from 'lucide-react';
import { studentSiteUrl } from '../../utils/portalHost';

/**
 * The single entry page for BOTH consoles — /console, and skovoai.info/.
 *
 * One page, two doors. It replaced a separate landing page per console: staff
 * were expected to remember which obscure URL belonged to which role, and the
 * two pages had quietly drifted into advertising removed features because
 * neither was reachable enough for anyone to notice.
 *
 * It deliberately is NOT a marketing page. Nobody signs up for an admin
 * console, so there is no audience to convert, and a public pitch would only
 * advertise where the console lives. Everything stated here is verifiable in
 * the code: the audit log is real (`audit_logs`), self-registration really was
 * removed, and the 24h figure is the JWT's own `expires_delta`.
 */
const DOORS = [
  {
    key: 'admin',
    icon: ShieldCheck,
    eyebrow: 'Day to day',
    title: 'Admin Console',
    tagline: 'Run the platform',
    points: [
      'Students, achievers and verification',
      'Cohorts, bookings and tasks',
      'Payments, payouts and coupons',
      'Colleges, opportunities and masters',
    ],
    to: '/skovo-platform-panel-admin/login',
    tint: '59,130,246',            // blue — matches the admin console
  },
  {
    key: 'super',
    icon: Crown,
    eyebrow: 'Ownership',
    title: 'Founder Console',
    tagline: 'The layer above',
    points: [
      'Who is allowed to administer SKOVO',
      'Revenue, enrolments and growth',
      'Every user, achiever and cohort',
      'The complete audit trail',
    ],
    to: '/skovo-platform-owner/login',
    tint: '245,158,11',            // amber — the owner console has always been amber
  },
];

const ASSURANCES = [
  { icon: ScrollText, label: 'Audit logged',    sub: 'Every privileged action, against your account' },
  { icon: KeyRound,   label: 'Issued accounts', sub: 'No self-registration on either console' },
  { icon: Clock,      label: '24-hour session', sub: 'Sign-in expires and must be renewed' },
];

/**
 * What is actually behind each door.
 *
 * These are the real sidebar groups of each console, read off AdminLayout and
 * SuperLayout — not a pitch. Someone who is not sure which account they hold
 * can recognise the console by the work in it, which is the only question this
 * page exists to answer.
 *
 * Keep in step with those two files if the navigation is regrouped.
 */
const INSIDE = [
  {
    key: 'admin',
    title: 'Admin Console',
    tint: '59,130,246',
    groups: [
      // Mirrors the v1 admin sidebar (AdminLayout NAV_FULL_GROUPS) — keep the two in step.
      { name: 'Management', items: 'Students · Cohorts · Achievers · Achiever Review · Bookings · Payments · Coupons · Subscriptions · Market · Score Engine · Moderation · Tasks' },
      { name: 'Content',    items: 'Colleges · Opportunities · Domains · Masters · Cities · Courses & Trades · Bulk Import · College Reviews · Communities · Referrals' },
      { name: 'Version 1',  items: 'Stages · Career Streaks · Leaderboard · Daily Engagement · Wallet & Refunds · Community Safety · Platform Settings' },
      { name: 'Analytics',  items: 'Platform Analytics' },
      { name: 'Settings',   items: 'Readiness Rules · Invitations · Audit Log · Error Logs · Support' },
    ],
  },
  {
    key: 'super',
    title: 'Founder Console',
    tint: '245,158,11',
    groups: [
      { name: 'Platform',     items: 'Business — revenue, enrolments and growth' },
      { name: 'Admin Access', items: 'Provision, suspend and audit every admin account' },
      { name: 'Users',        items: 'All Users · Achievers · Cohorts · Courses · Enrollments · Readiness' },
      { name: 'System',       items: 'Audit Log — every privileged action on the platform' },
    ],
  },
];

/** How an account comes to exist, now that neither console self-registers. */
const STEPS = [
  {
    n: '01',
    title: 'Your account is issued',
    body: 'The platform owner creates it directly. There is no signup form on either console, so an account cannot be created by anyone who does not already have access.',
  },
  {
    n: '02',
    title: 'You sign in',
    body: 'Email and password on your own console. Pick the wrong door and the credentials simply will not match — the two consoles hold separate accounts.',
  },
  {
    n: '03',
    title: 'The session expires',
    body: 'Sign-in lasts 24 hours, then it has to be renewed. Change your own password any time from the profile screen inside the console.',
  },
];

const FAQ = [
  {
    q: 'I forgot my password. How do I reset it?',
    a: 'There is no self-service reset on either console — that was removed deliberately, because a password-reset flow on an admin panel is a way in for anyone who can reach the inbox. Ask the platform owner to set a new one.',
  },
  {
    q: 'Can I create an account?',
    a: 'No. Both consoles are login-only and accounts are provisioned directly. Registration was removed from the server, not just hidden, so there is no endpoint to post at either.',
  },
  {
    q: 'Which console is mine?',
    a: 'If you manage students, cohorts, payments and content day to day, it is the Admin Console. If you decide who is allowed to administer SKOVO and watch the business, it is the Founder Console. The two hold separate accounts — an email works on one, not both.',
  },
  {
    q: 'I am a student or an achiever. Am I in the right place?',
    a: 'No — this is the staff console. The student and achiever portals are on the main SKOVO site.',
  },
];

export default function ConsoleLanding() {
  return (
    <div
      className="relative overflow-hidden console-landing"
      style={{ backgroundColor: 'var(--sidebar-bg)' }}
    >
      {/* Scoped styles. Kept local to this file rather than pushed into
          index.css: nothing else uses them, and a global keyframe named
          `float` is exactly the kind of thing that later collides. Every
          animation is disabled under prefers-reduced-motion (UI04-017). */}
      <style>{`
        .console-landing .aurora {
          animation: consoleFloat 18s ease-in-out infinite;
          will-change: transform;
        }
        .console-landing .aurora-2 { animation-duration: 24s; animation-direction: reverse; }
        @keyframes consoleFloat {
          0%, 100% { transform: translate3d(0,0,0) scale(1); }
          50%      { transform: translate3d(4%, -3%, 0) scale(1.08); }
        }
        .console-landing .rise {
          animation: consoleRise .6s cubic-bezier(.22,1,.36,1) both;
        }
        @keyframes consoleRise {
          from { opacity: 0; transform: translateY(14px); }
          to   { opacity: 1; transform: none; }
        }
        .console-landing .door::before {
          content: '';
          position: absolute;
          inset: -1px;
          border-radius: inherit;
          padding: 1px;
          background: linear-gradient(140deg, rgba(var(--tint),.55), rgba(var(--tint),0) 55%);
          -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
          -webkit-mask-composite: xor;
                  mask-composite: exclude;
          opacity: 0;
          transition: opacity .3s ease;
          pointer-events: none;
        }
        .console-landing .door:hover::before,
        .console-landing .door:focus-visible::before { opacity: 1; }
        .console-landing .door:hover .door-glow { opacity: .18; }
        @media (prefers-reduced-motion: reduce) {
          .console-landing .aurora,
          .console-landing .rise { animation: none; }
          .console-landing .door { transition: none; }
        }
      `}</style>

      {/* ── Background ──────────────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{ background: 'linear-gradient(150deg, var(--sidebar-bg) 0%, var(--sidebar-sec) 60%, var(--sidebar-bg) 100%)' }}
      />
      <div
        className="aurora absolute -top-40 -right-32 w-[46rem] h-[46rem] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(59,130,246,.30), transparent 65%)' }}
      />
      <div
        className="aurora aurora-2 absolute -bottom-48 -left-40 w-[42rem] h-[42rem] rounded-full blur-3xl pointer-events-none"
        style={{ background: 'radial-gradient(circle, rgba(245,158,11,.16), transparent 65%)' }}
      />
      <div
        className="absolute inset-0 opacity-[0.035] pointer-events-none"
        style={{
          backgroundImage:
            'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '48px 48px',
          maskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 80% 60% at 50% 40%, #000 40%, transparent 100%)',
        }}
      />

      {/* ── Header ──────────────────────────────────────────────── */}
      <header className="relative flex items-center justify-between px-6 sm:px-10 lg:px-14 py-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl shadow-lg overflow-hidden shrink-0">
            <img src="/skovo-logo-blue.jpg" alt="" className="w-full h-full object-cover" />
          </div>
          <span className="text-white font-black text-xl tracking-tight">SKOVO</span>
          <span
            className="text-sm font-semibold pl-3"
            style={{ color: 'var(--accent-ring)', borderLeft: '1px solid var(--sidebar-border)' }}
          >
            Console
          </span>
        </div>
        <div
          className="hidden sm:inline-flex items-center gap-2 px-3 py-1.5 rounded-full"
          style={{ backgroundColor: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)' }}
        >
          <Lock size={11} className="text-slate-400" />
          <span className="text-[11px] font-semibold tracking-wide text-slate-400">
            Restricted area
          </span>
        </div>
      </header>

      {/* ── Body ────────────────────────────────────────────────── */}
      <main className="relative flex items-center min-h-[76vh] px-6 sm:px-10 lg:px-14 py-10">
        <div className="w-full max-w-5xl mx-auto">

          <div className="text-center mb-10 sm:mb-12 rise">
            <div
              className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full mb-6"
              style={{ backgroundColor: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)' }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full animate-pulse"
                style={{ backgroundColor: 'var(--accent-ring)' }}
              />
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--accent-ring)' }}>
                Authorised personnel only
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-black text-white tracking-tight leading-[1.05]">
              Sign in to{' '}
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(100deg, var(--accent-ring), var(--accent-muted))' }}
              >
                manage SKOVO
              </span>
            </h1>
            <p className="mt-4 text-slate-400 text-base sm:text-lg max-w-lg mx-auto">
              Two consoles, one door each. Choose the one your account belongs to.
            </p>
          </div>

          {/* ── The two doors ─────────────────────────────────── */}
          <div className="grid gap-5 md:grid-cols-2">
            {DOORS.map(({ key, icon: Icon, eyebrow, title, tagline, points, to, tint }, i) => (
              <Link
                key={key}
                to={to}
                aria-label={`${title} — sign in`}
                className="door group relative flex flex-col p-6 sm:p-7 rounded-3xl overflow-hidden
                           transition-all duration-300 hover:-translate-y-1.5 rise mo-ring"
                style={{
                  '--tint': tint,
                  animationDelay: `${80 + i * 90}ms`,
                  backgroundColor: 'rgba(255,255,255,0.035)',
                  border: '1px solid rgba(255,255,255,0.07)',
                  boxShadow: '0 1px 0 rgba(255,255,255,0.04) inset',
                }}
              >
                {/* Colour wash that warms on hover — the card looks like the
                    console it opens, so the choice is visual before it is read. */}
                <span
                  className="door-glow absolute -top-24 -right-16 w-64 h-64 rounded-full blur-3xl opacity-0
                             transition-opacity duration-300 pointer-events-none"
                  style={{ backgroundColor: `rgb(${tint})` }}
                />

                <div className="relative flex items-start justify-between gap-4">
                  <span
                    className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0"
                    style={{
                      backgroundColor: `rgba(${tint},.12)`,
                      border: `1px solid rgba(${tint},.28)`,
                    }}
                  >
                    <Icon size={22} style={{ color: `rgb(${tint})` }} />
                  </span>
                  <span
                    className="text-[10px] font-bold tracking-[.14em] uppercase px-2.5 py-1 rounded-full"
                    style={{ color: `rgb(${tint})`, backgroundColor: `rgba(${tint},.10)` }}
                  >
                    {eyebrow}
                  </span>
                </div>

                <h2 className="relative mt-5 text-white text-2xl font-black tracking-tight">{title}</h2>
                <p className="relative text-slate-400 text-sm mt-1">{tagline}</p>

                <ul className="relative mt-5 space-y-2.5 flex-1">
                  {points.map((pt) => (
                    <li key={pt} className="flex items-start gap-2.5 text-slate-400 text-[13px] leading-relaxed">
                      <span
                        className="w-1 h-1 rounded-full mt-[7px] shrink-0"
                        style={{ backgroundColor: `rgb(${tint})` }}
                      />
                      {pt}
                    </li>
                  ))}
                </ul>

                <span
                  className="relative mt-7 inline-flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl
                             text-sm font-bold text-white shadow-lg transition-transform duration-300"
                  style={{ backgroundColor: `rgb(${tint})`, boxShadow: `0 10px 30px -12px rgba(${tint},.7)` }}
                >
                  Sign in
                  <ArrowRight
                    size={16}
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  />
                </span>
              </Link>
            ))}
          </div>

          {/* ── What is true of both consoles ─────────────────── */}
          <div className="mt-10 grid gap-3 sm:grid-cols-3 rise" style={{ animationDelay: '280ms' }}>
            {ASSURANCES.map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex items-start gap-3 p-4 rounded-2xl"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <Icon size={16} className="text-slate-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-slate-200 text-xs font-semibold">{label}</p>
                  <p className="text-slate-500 text-[11px] mt-0.5 leading-relaxed">{sub}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* ── What is behind each door ────────────────────────────── */}
      <section
        className="relative px-6 sm:px-10 lg:px-14 py-16 sm:py-20"
        style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            What is behind each door
          </h2>
          <p className="mt-2.5 text-slate-400 text-sm max-w-xl">
            Not sure which account you hold? Find the work you actually do.
          </p>

          <div className="mt-9 grid gap-5 md:grid-cols-2">
            {INSIDE.map(({ key, title, tint, groups }) => (
              <div
                key={key}
                className="rounded-3xl p-6 sm:p-7"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <div className="flex items-center gap-2.5 mb-5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: `rgb(${tint})` }} />
                  <h3 className="text-white text-base font-bold tracking-tight">{title}</h3>
                </div>
                <dl className="space-y-4">
                  {groups.map(({ name, items }) => (
                    <div key={name}>
                      <dt
                        className="text-[10px] font-bold tracking-[.14em] uppercase mb-1"
                        style={{ color: `rgb(${tint})` }}
                      >
                        {name}
                      </dt>
                      <dd className="text-slate-400 text-[13px] leading-relaxed">{items}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How access works ────────────────────────────────────── */}
      <section
        className="relative px-6 sm:px-10 lg:px-14 py-16 sm:py-20"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            How access works
          </h2>
          <p className="mt-2.5 text-slate-400 text-sm max-w-xl">
            Neither console has a signup form or a password reset. This is the whole of it.
          </p>

          <ol className="mt-9 grid gap-5 sm:grid-cols-3">
            {STEPS.map(({ n, title, body }) => (
              <li
                key={n}
                className="rounded-3xl p-6"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <span
                  className="text-3xl font-black tracking-tight text-transparent bg-clip-text"
                  style={{ backgroundImage: 'linear-gradient(120deg, var(--accent-ring), var(--accent-muted))' }}
                >
                  {n}
                </span>
                <h3 className="mt-3 text-white text-sm font-bold">{title}</h3>
                <p className="mt-2 text-slate-400 text-[13px] leading-relaxed">{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── FAQ ─────────────────────────────────────────────────── */}
      <section
        className="relative px-6 sm:px-10 lg:px-14 py-16 sm:py-20"
        style={{ backgroundColor: 'rgba(0,0,0,0.18)', borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">
            Common questions
          </h2>

          <div className="mt-8 space-y-3">
            {FAQ.map(({ q, a }) => (
              /* <details>, not a JS accordion: it opens with no script, it is
                 keyboard-operable and screen-reader-announced for free, and it
                 is findable by the browser's own in-page search when closed. */
              <details
                key={q}
                className="group rounded-2xl px-5 py-4"
                style={{
                  backgroundColor: 'rgba(255,255,255,0.03)',
                  border: '1px solid rgba(255,255,255,0.07)',
                }}
              >
                <summary className="flex items-center justify-between gap-4 cursor-pointer list-none text-white text-sm font-semibold">
                  {q}
                  <ChevronDown
                    size={16}
                    className="shrink-0 text-slate-500 transition-transform duration-200 group-open:rotate-180"
                  />
                </summary>
                <p className="mt-3 text-slate-400 text-[13px] leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────── */}
      <footer
        className="relative px-6 sm:px-10 lg:px-14 py-8"
        style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}
      >
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <p className="text-slate-600 text-xs">© {new Date().getFullYear()} SKOVO. All rights reserved.</p>
          <nav className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* studentSiteUrl() rather than a bare "/": one build serves two
                hostnames, so on skovoai.info a relative link would land back on
                the console, not on the student site. */}
            <a href={studentSiteUrl('/')} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">
              Student site
            </a>
            <a href={studentSiteUrl('/terms')} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">
              Terms
            </a>
            <a href={studentSiteUrl('/privacy')} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">
              Privacy
            </a>
            <a href={studentSiteUrl('/contact')} className="text-slate-500 hover:text-slate-300 text-xs transition-colors">
              Contact
            </a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
