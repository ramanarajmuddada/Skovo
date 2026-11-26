import React from 'react';
import { CalendarClock, Users, BarChart3, BadgeCheck, ShieldCheck } from 'lucide-react';

export default function AchieverAuthLayout({ children }) {
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--sidebar-bg)' }}>

      {/* Left brand panel */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-14 overflow-hidden">
        {/* Background gradient */}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, var(--sidebar-bg) 0%, var(--sidebar-sec) 100%)' }} />
        {/* Accent glow blobs */}
        <div className="absolute top-0 right-0 w-120 h-120 rounded-full blur-3xl translate-x-1/3 -translate-y-1/4 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)', opacity: 1 }} />
        <div className="absolute bottom-0 left-0 w-95 h-95 rounded-full blur-3xl -translate-x-1/3 translate-y-1/4 pointer-events-none"
          style={{ backgroundColor: 'var(--sidebar-glow)', opacity: 0.6 }} />
        {/* Grid overlay */}
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
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full mb-6"
              style={{ backgroundColor: 'var(--sidebar-hover)', border: '1px solid var(--sidebar-border)' }}>
              <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: 'var(--accent-ring)' }} />
              <span className="text-xs font-semibold tracking-wide" style={{ color: 'var(--accent-ring)' }}>
                Achiever Portal · For working professionals
              </span>
            </div>
            <h1 className="text-5xl font-black text-white leading-[1.1] tracking-tight">
              Share Your<br />
              <span className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-ring), var(--accent-muted))' }}>
                Expertise
              </span>
            </h1>
            <p className="mt-5 text-slate-400 text-base leading-relaxed max-w-sm">
              Connect with ambitious students, run cohorts, and give back to the community that shaped you.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-3">
            {[
              { icon: CalendarClock, label: '1-on-1 sessions',   sub: 'Students book guidance sessions in your free slots' },
              { icon: Users,         label: 'Run cohorts',       sub: 'Teach small groups what you did to get where you are' },
              { icon: BarChart3,     label: 'Track your impact', sub: 'Sessions, students and earnings in one place' },
              { icon: BadgeCheck,    label: 'Verified profile',  sub: 'A verified badge once our team approves you' },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="flex items-center gap-4 p-3 rounded-2xl transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--sidebar-sec)', border: '1px solid var(--sidebar-border)', color: 'var(--accent-ring)' }}>
                  <Icon size={17} />
                </span>
                <div>
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* What verification involves — true for every achiever, unlike a head-count. */}
          <div className="flex items-start gap-3 p-3 rounded-2xl"
            style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <ShieldCheck size={16} className="mt-0.5 shrink-0 text-slate-400" />
            <p className="text-slate-400 text-xs leading-relaxed">
              Every achiever is verified before teaching — documents and background check.
            </p>
          </div>
        </div>

        <p className="relative text-slate-600 text-xs">© {new Date().getFullYear()} SKOVO. All rights reserved.</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 min-w-0 flex flex-col items-center justify-center px-4 py-6 sm:p-10 bg-white">
        {/* Mobile logo */}
        <div className="lg:hidden flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl shadow-lg mb-3 overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
          <span className="font-black text-slate-900 text-xl tracking-tight">SKOVO</span>
          <p className="text-xs mt-1 text-slate-500">Achiever Portal</p>
        </div>

        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>

    </div>
  );
}
