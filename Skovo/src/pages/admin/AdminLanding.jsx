import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, Users, UserCheck, CalendarCheck, IndianRupee, GraduationCap,
  Briefcase, BarChart2, ScrollText, ArrowRight, Crown, LogIn, CheckCircle2,
} from 'lucide-react';
import { studentSiteUrl } from '../../utils/portalHost';

/* The admin site's front door. Public — no token required to see it — so it
 * says what the console is for and nothing about what is inside it. */

const CAPABILITIES = [
  { icon: Users,         label: 'Students',      sub: 'Accounts, cohort placement, readiness' },
  { icon: UserCheck,     label: 'Achievers',     sub: 'Applications, verification, probation review' },
  { icon: CalendarCheck, label: 'Bookings',      sub: 'Sessions, reschedules, no-shows' },
  { icon: IndianRupee,   label: 'Payments',      sub: 'Captures, payouts, coupons' },
  { icon: GraduationCap, label: 'Colleges',      sub: 'Listings, reviews, course catalogue' },
  { icon: Briefcase,     label: 'Opportunities', sub: 'Jobs, internships, employers' },
  { icon: BarChart2,     label: 'Analytics',     sub: 'Funnels, engagement, score engine' },
  { icon: ScrollText,    label: 'Audit',         sub: 'Every privileged action, logged' },
];

const ASSURANCES = [
  'Email OTP on every new admin account',
  'Role-scoped team access, revocable per member',
  'Immutable audit trail on privileged actions',
];

export default function AdminLanding() {
  // Read on first render, not in an effect: otherwise a signed-in admin sees
  // "Sign In" flash before it corrects itself to "Go to dashboard".
  const [signedIn] = useState(() => Boolean(localStorage.getItem('admin_access_token')));

  const primaryTo = signedIn
    ? '/skovo-platform-panel-admin'
    : '/skovo-platform-panel-admin/login';

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--sidebar-bg)' }}>

      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="relative z-20 w-full px-6 sm:px-10 lg:px-16 py-5 flex items-center gap-4">
        <div className="flex items-center gap-2.5 mr-auto">
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-lg">
            <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <div className="leading-none">
            <span className="text-white text-lg font-black tracking-tight">SKOVO</span>
            <span
              className="ml-2 text-xs font-semibold tracking-widest uppercase"
              style={{ color: 'var(--accent-ring)' }}
            >
              Admin
            </span>
          </div>
        </div>

        <Link
          to={primaryTo}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <LogIn size={14} />
          {signedIn ? 'Go to dashboard' : 'Sign In'}
        </Link>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 sm:px-10 lg:px-16 pt-10 pb-20">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, var(--sidebar-bg) 0%, var(--sidebar-sec) 100%)' }}
        />
        <div
          className="absolute top-0 right-0 w-120 h-120 rounded-full blur-3xl translate-x-1/3 -translate-y-1/3 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)' }}
        />
        <div
          className="absolute bottom-0 left-0 w-95 h-95 rounded-full blur-3xl -translate-x-1/3 translate-y-1/4 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)', opacity: 0.6 }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
            backgroundSize: '40px 40px',
          }}
        />

        <div className="relative max-w-3xl">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
            style={{ backgroundColor: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)' }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--accent-ring)' }}
            />
            <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--accent-ring)' }}>
              Staff access only
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.05] tracking-tight">
            The console behind
            <br />
            <span
              className="text-transparent bg-clip-text"
              style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-ring), var(--accent-muted))' }}
            >
              every SKOVO account
            </span>
          </h1>

          <p className="mt-6 text-slate-400 text-base sm:text-lg leading-relaxed max-w-xl">
            Students, achievers, cohorts, bookings and payments — reviewed, corrected and
            approved from one place. Sign in with the admin account your team issued you.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to={primaryTo}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-bold text-white shadow-lg transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {signedIn ? 'Open dashboard' : 'Sign in to Admin'}
              <ArrowRight size={16} />
            </Link>
          </div>

          {/* No "create an account" and no "reset your password": both consoles
              became login-only on 2026-09-06 and those routes now redirect back
              to the login form. A button that leads nowhere is worse than no
              button — it reads as a way in that silently is not one. */}
          <p className="mt-5 text-xs text-slate-500">
            Admin accounts are issued by SKOVO — there is no self-registration.
            Locked out? Ask the platform owner to reset your password.
          </p>
        </div>
      </section>

      {/* ── What the console covers ──────────────────────────── */}
      <section className="px-6 sm:px-10 lg:px-16 py-16" style={{ backgroundColor: 'var(--sidebar-sec)' }}>
        <h2 className="text-2xl sm:text-3xl font-black text-white tracking-tight">What you administer</h2>
        <p className="mt-2 text-sm text-slate-400 max-w-lg">
          Every admin sees all of it — there are no admin roles.
        </p>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((cap) => {
            const Icon = cap.icon;
            return (
              <div
                key={cap.label}
                className="p-5 rounded-2xl"
                style={{ backgroundColor: 'rgba(255,255,255,0.03)', border: '1px solid var(--sidebar-border)' }}
              >
                <span
                  className="w-10 h-10 rounded-xl flex items-center justify-center mb-4"
                  style={{ backgroundColor: 'var(--sidebar-hover)' }}
                >
                  <Icon size={18} style={{ color: 'var(--accent-ring)' }} aria-hidden />
                </span>
                <p className="text-white text-sm font-bold">{cap.label}</p>
                <p className="text-slate-500 text-xs mt-1.5 leading-relaxed">{cap.sub}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Assurances ───────────────────────────────────────── */}
      <section className="px-6 sm:px-10 lg:px-16 py-14" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
        <div className="flex flex-wrap gap-x-10 gap-y-4">
          {ASSURANCES.map(text => (
            <div key={text} className="flex items-center gap-2.5">
              <CheckCircle2 size={16} style={{ color: 'var(--accent-ring)' }} />
              <span className="text-sm text-slate-400">{text}</span>
            </div>
          ))}
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer
        className="px-6 sm:px-10 lg:px-16 py-8 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ borderTop: '1px solid var(--sidebar-border)' }}
      >
        <p className="text-xs text-slate-600 mr-auto">
          © {new Date().getFullYear()} SKOVO. Internal console — access is logged.
        </p>

        <div className="flex flex-wrap items-center gap-5">
          {/* The owner console is a separate portal with its own credentials, so
              it gets a link across rather than a shared sign-in. */}
          <Link
            to="/skovo-platform-owner/home"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <Crown size={13} /> Platform Owner console
          </Link>
          <a
            href={studentSiteUrl('/')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            <Shield size={13} /> Student site
          </a>
        </div>
      </footer>
    </div>
  );
}
