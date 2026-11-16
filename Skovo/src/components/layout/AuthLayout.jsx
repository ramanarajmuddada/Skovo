import React from 'react';
import {
  Users, GraduationCap, Briefcase, MessageSquare, CalendarCheck, CreditCard, FolderCog,
  KeyRound, BarChart3, Compass, ScrollText, Lock,
} from 'lucide-react';

/**
 * The panel beside every sign-in form, in all four portals.
 *
 * It used to render ONE set of copy — "Build Your Dream Career", Sunday Expert
 * Cohorts, "12,000+ students building careers". That is student acquisition
 * copy, and it was being shown to the two people who are definitely not
 * students: the admin and the founder signing in to run the place.
 *
 * `variant` swaps only the words. The shell — gradient, glow, grid, logo,
 * footer — is shared, so the four portals still look like one product.
 *
 * The student panel is the DEFAULT and is unchanged: student and achiever
 * screens pass no variant and render exactly what they rendered before.
 */
export const PANELS = {
  student: {
    badge: 'For students aged 14 to 25',
    lead: 'Build Your',
    accent: 'Dream Career',
    sub: 'Cohorts with achievers, colleges, communities and real opportunities — everything a student needs, in one place.',
    mobileSub: 'The Student Career Readiness OS',
    features: [
      { icon: Users,         label: 'Cohorts with achievers', sub: 'Small-group sessions with people a few years ahead' },
      { icon: GraduationCap, label: 'Colleges',               sub: 'Explore, compare and save colleges' },
      { icon: Briefcase,     label: 'Opportunities',          sub: 'Internships and fresher roles, unlocked by your score' },
      { icon: MessageSquare, label: 'Communities',            sub: 'Grow with peers on the same path' },
    ],
    notice: null,
  },

  // Both console panels name what the console ACTUALLY holds — the areas in its
  // own sidebar — rather than borrowing marketing claims. An operator does not
  // need to be sold the product they are about to administer.
  admin: {
    badge: 'Restricted · Staff access only',
    lead: 'Run the',
    accent: 'SKOVO platform',
    sub: 'Students, achievers, cohorts and payments — reviewed and managed from one place.',
    mobileSub: 'Admin Console',
    features: [
      { icon: Users,         label: 'Students & Achievers', sub: 'Profiles, verification and review' },
      { icon: CalendarCheck, label: 'Cohorts & Bookings',   sub: 'Sessions, tasks and attendance' },
      { icon: CreditCard,    label: 'Payments & Payouts',   sub: 'Orders, coupons and settlements' },
      { icon: FolderCog,     label: 'Content & Masters',    sub: 'Colleges, opportunities and masters' },
    ],
    notice: 'Authorised personnel only. Every action taken in this console is recorded in the audit log against your account.',
  },

  super: {
    badge: 'Restricted · Founder access',
    lead: 'Own the',
    accent: 'whole platform',
    sub: 'Admin access, business performance and the complete audit trail.',
    mobileSub: 'Founder Console',
    features: [
      { icon: KeyRound,   label: 'Admin Access', sub: 'Who is allowed to administer SKOVO' },
      { icon: BarChart3,  label: 'Business',     sub: 'Revenue, enrolments and growth' },
      { icon: Compass,    label: 'Platform',     sub: 'Users, achievers, cohorts and content' },
      { icon: ScrollText, label: 'Audit Log',    sub: 'Every privileged action, recorded' },
    ],
    notice: 'Authorised personnel only. Every action taken in this console is recorded in the audit log against your account.',
  },
};

export default function AuthLayout({ children, variant = 'student' }) {
  const panel = PANELS[variant] || PANELS.student;

  return (
    <div className="flex" style={{ backgroundColor: 'var(--sidebar-bg)', minHeight: '100dvh' }}>

      {/* ── Left brand panel ─────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-14 overflow-hidden">
        {/* Background layers */}
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, var(--sidebar-bg) 0%, var(--sidebar-sec) 100%)' }}
        />
        {/* Accent glow blobs */}
        <div
          className="absolute top-0 right-0 w-120 h-120 rounded-full blur-3xl translate-x-1/3 -translate-y-1/4 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)', opacity: 1 }}
        />
        <div
          className="absolute bottom-0 left-0 w-95 h-95 rounded-full blur-3xl -translate-x-1/3 translate-y-1/4 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)', opacity: 0.6 }}
        />
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.04]"
          style={{ backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)', backgroundSize: '40px 40px' }} />

        {/* Logo */}
        <div className="relative flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl shadow-lg overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
          <span className="text-white font-black text-xl tracking-tight">SKOVO</span>
        </div>

        {/* Hero copy */}
        <div className="relative space-y-8">
          <div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
              style={{ backgroundColor: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)' }}
            >
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent-ring)' }} />
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--accent-ring)' }}>
                {panel.badge}
              </span>
            </div>
            <h1 className="text-5xl font-black text-white leading-[1.1] tracking-tight">
              {panel.lead}<br />
              <span
                className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-ring), var(--accent-muted))' }}
              >
                {panel.accent}
              </span>
            </h1>
            <p className="mt-5 text-slate-400 text-base leading-relaxed max-w-sm">
              {panel.sub}
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-3">
            {panel.features.map(({ icon: Icon, label, sub }) => (
              <div
                key={label}
                className="flex items-center gap-4 p-3 rounded-2xl transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span
                  className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--sidebar-sec)', border: '1px solid var(--sidebar-border)', color: 'var(--accent-ring)' }}
                >
                  <Icon size={17} />
                </span>
                <div>
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {panel.notice && (
            /* Consoles get a standing notice. It is true — privileged actions
               write to `audit_logs` — and it is the thing worth saying to
               someone about to act on real student data. */
            <div
              className="flex items-start gap-3 p-3 rounded-2xl"
              style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
            >
              <Lock size={15} className="mt-0.5 shrink-0 text-slate-400" />
              <p className="text-slate-400 text-xs leading-relaxed">{panel.notice}</p>
            </div>
          )}
        </div>

        <p className="relative text-slate-600 text-xs">© {new Date().getFullYear()} SKOVO. All rights reserved.</p>
      </div>

      {/* ── Right form panel ─────────────────────────────────── */}
      {/*
        Centred at every size, but *safe* centred: when the form is taller than
        the screen (signup on a short phone) it falls back to the top and
        scrolls. Plain `justify-center` clipped the name field and the logo
        there with no way to reach them.
      */}
      <div
        className="flex-1 flex flex-col items-center justify-center-safe px-5 py-6 sm:p-10 bg-white overflow-y-auto"
        style={{
          paddingTop: 'max(1.5rem, env(safe-area-inset-top))',
          paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        }}
      >
        {/* Mobile logo */}
        <div className="lg:hidden flex flex-col items-center mb-6">
          <div className="w-12 h-12 rounded-2xl shadow-lg mb-3 overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
          <span className="font-black text-slate-900 text-xl tracking-tight">SKOVO</span>
          <p className="text-xs mt-1 text-slate-500">{panel.mobileSub}</p>
        </div>

        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>

    </div>
  );
}
