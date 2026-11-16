import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Crown, ShieldCheck, Users, UserCheck, BookOpen, BarChart2,
  ShieldAlert, Briefcase, ArrowRight, Lock, Shield,
} from 'lucide-react';
import { studentSiteUrl } from '../../utils/portalHost';

/* The owner console's front door.
 *
 * Deliberately not themed with --accent like the admin landing: the two
 * portals sit on the same hostname and take different credentials, and an
 * operator who lands on the wrong one should notice from across the room.
 * Fixed near-black + amber, regardless of the accent the user picked. */

const OVERSIGHT = [
  { icon: ShieldCheck, label: 'Admins',        sub: 'Provision, suspend and audit every admin account' },
  { icon: Users,       label: 'All users',     sub: 'Every student record on the platform' },
  { icon: UserCheck,   label: 'Achievers',     sub: 'Verification outcomes and lifecycle state' },
  { icon: BookOpen,    label: 'Enrollments',   sub: 'Every cohort and course enrolment' },
  { icon: BarChart2,   label: 'Readiness',     sub: 'Scoring rules and their platform-wide effect' },
  { icon: Briefcase,   label: 'Opportunities', sub: 'Employer listings and community moderation' },
  { icon: ShieldAlert, label: 'Audit log',     sub: 'Full trail, including actions taken by admins' },
];

const AMBER = '#f59e0b';
const AMBER_SOFT = '#fcd34d';
const INK = '#0a0a0f';
const INK_2 = '#12121c';
const BORDER = 'rgba(245, 158, 11, 0.16)';

export default function SuperLanding() {
  // Read on first render, not in an effect: otherwise a signed-in owner sees
  // "Sign In" flash before it corrects itself to "Go to console".
  const [signedIn] = useState(() => Boolean(localStorage.getItem('super_access_token')));

  const primaryTo = signedIn ? '/skovo-platform-owner' : '/skovo-platform-owner/login';

  return (
    <div className="min-h-screen" style={{ backgroundColor: INK }}>

      {/* ── Top bar ──────────────────────────────────────────── */}
      <header className="relative z-20 w-full px-6 sm:px-10 lg:px-16 py-5 flex items-center gap-4">
        <div className="flex items-center gap-2.5 mr-auto">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: INK_2 }}
          >
            <Crown size={16} style={{ color: AMBER }} />
          </div>
          <div className="leading-none">
            <span className="text-white text-lg font-black tracking-tight">SKOVO</span>
            <span
              className="ml-2 text-xs font-semibold tracking-widest uppercase"
              style={{ color: AMBER }}
            >
              Owner
            </span>
          </div>
        </div>

        <Link
          to={primaryTo}
          className="inline-flex items-center gap-2 text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
          style={{ color: INK, backgroundColor: AMBER }}
        >
          <Lock size={14} />
          {signedIn ? 'Go to console' : 'Sign In'}
        </Link>
      </header>

      {/* ── Hero ─────────────────────────────────────────────── */}
      <section className="relative overflow-hidden px-6 sm:px-10 lg:px-16 pt-14 pb-20">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: `radial-gradient(circle at 15% 0%, rgba(245,158,11,0.10), transparent 55%)` }}
        />

        <div className="relative max-w-2xl">
          <div
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-7"
            style={{ border: `1px solid ${BORDER}`, backgroundColor: 'rgba(245,158,11,0.06)' }}
          >
            <Lock size={11} style={{ color: AMBER }} />
            <span className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: AMBER }}>
              Restricted — founders only
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black text-white leading-[1.05] tracking-tight">
            Founder Console
          </h1>

          <p className="mt-6 text-slate-400 text-base sm:text-lg leading-relaxed">
            The layer above the admin panel: every admin, every user and every audit entry on
            SKOVO in one view — and the power to revoke any of them.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              to={primaryTo}
              className="inline-flex items-center gap-2 px-6 py-3.5 rounded-2xl text-sm font-bold transition-transform hover:-translate-y-0.5"
              style={{ backgroundColor: AMBER, color: INK }}
            >
              {signedIn ? 'Open console' : 'Sign in as owner'}
              <ArrowRight size={16} />
            </Link>
          </div>

          {/* No reset link: the console is login-only as of 2026-09-06 and that
              route redirects back to the form. A forgotten owner password is a
              database operation, so say so rather than offering a dead button. */}
          <p className="mt-6 text-xs text-slate-400 max-w-md leading-relaxed">
            Owner accounts are not self-serve, and there is no password reset here.
            Day-to-day platform work belongs in the{' '}
            <Link to="/skovo-platform-panel-admin" className="font-semibold hover:underline" style={{ color: AMBER_SOFT }}>
              admin console
            </Link>{' '}
            instead.
          </p>
        </div>
      </section>

      {/* ── Oversight rows ───────────────────────────────────── */}
      <section className="px-6 sm:px-10 lg:px-16 py-16" style={{ backgroundColor: INK_2 }}>
        <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">Under your control</h2>

        <div className="mt-8 max-w-3xl">
          {OVERSIGHT.map((row, i) => {
            const Icon = row.icon;
            return (
              <div
                key={row.label}
                className="flex items-start gap-4 py-4"
                style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(255,255,255,0.05)' }}
              >
                <span
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                  style={{ backgroundColor: 'rgba(245,158,11,0.08)', border: `1px solid ${BORDER}` }}
                >
                  <Icon size={16} style={{ color: AMBER }} aria-hidden />
                </span>
                <div>
                  <p className="text-white text-sm font-bold">{row.label}</p>
                  <p className="text-slate-500 text-xs mt-1 leading-relaxed">{row.sub}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Footer ───────────────────────────────────────────── */}
      <footer
        className="px-6 sm:px-10 lg:px-16 py-8 flex flex-col sm:flex-row items-start sm:items-center gap-4"
        style={{ borderTop: `1px solid rgba(255,255,255,0.05)` }}
      >
        <p className="text-xs text-slate-500 mr-auto">
          © {new Date().getFullYear()} SKOVO. Every action in this console is written to the audit log.
        </p>

        <div className="flex flex-wrap items-center gap-5">
          <Link
            to="/skovo-platform-panel-admin/home"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-white transition-colors"
          >
            <ShieldCheck size={13} /> Admin console
          </Link>
          <a
            href={studentSiteUrl('/')}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-white transition-colors"
          >
            <Shield size={13} /> Student site
          </a>
        </div>
      </footer>
    </div>
  );
}
