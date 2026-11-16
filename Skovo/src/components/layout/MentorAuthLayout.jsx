import React from 'react';

export default function MentorAuthLayout({ children }) {
  return (
    <div className="min-h-screen flex" style={{ backgroundColor: 'var(--sidebar-bg)' }}>

      {/* ── Left brand panel ─────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[52%] relative flex-col justify-between p-14 overflow-hidden">
        {/* Background */}
        <div className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, var(--sidebar-bg) 0%, var(--sidebar-sec) 100%)' }} />
        {/* Glow blobs */}
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
                Mentor Portal
              </span>
            </div>
            <h1 className="text-5xl font-black text-white leading-[1.1] tracking-tight">
              Guide the Next<br />
              <span className="text-transparent bg-clip-text"
                style={{ backgroundImage: 'linear-gradient(90deg, var(--accent-ring), var(--accent-muted))' }}>
                Generation
              </span>
            </h1>
            <p className="mt-5 text-slate-400 text-base leading-relaxed max-w-sm">
              Share your expertise, mentor ambitious students, and make a real impact on careers — all in one place.
            </p>
          </div>

          {/* Feature list */}
          <div className="space-y-3">
            {[
              { icon: '🎯', label: 'Guide Students',         sub: 'Mentor assigned mentees one-on-one' },
              { icon: '📅', label: 'Schedule Sessions',      sub: 'Manage and track your mentoring sessions' },
              { icon: '📈', label: 'Track Progress',         sub: "Monitor your mentees' readiness scores" },
              { icon: '🌐', label: 'Share Your Expertise',   sub: 'Domains, bio and LinkedIn in your profile' },
            ].map(({ icon, label, sub }) => (
              <div key={label} className="flex items-center gap-4 p-3 rounded-2xl transition-colors"
                style={{ backgroundColor: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0"
                  style={{ backgroundColor: 'var(--sidebar-sec)', border: '1px solid var(--sidebar-border)' }}>
                  {icon}
                </span>
                <div>
                  <p className="text-white text-sm font-semibold">{label}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{sub}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Social proof */}
          <div className="flex items-center gap-4 pt-2">
            <div className="flex -space-x-2">
              {['M', 'K', 'R', 'S'].map((l, i) => (
                <div key={i} className="w-8 h-8 rounded-full border-2 flex items-center justify-center text-white text-xs font-bold"
                  style={{ backgroundColor: 'var(--accent)', borderColor: 'var(--sidebar-bg)' }}>
                  {l}
                </div>
              ))}
            </div>
            <p className="text-slate-400 text-sm">
              <span className="text-white font-semibold">500+</span> mentors shaping careers
            </p>
          </div>
        </div>

        <p className="relative text-slate-600 text-xs">© {new Date().getFullYear()} SKOVO. All rights reserved.</p>
      </div>

      {/* ── Right form panel ─────────────────────────────────── */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 sm:p-10 bg-white overflow-y-auto">
        {/* Mobile logo */}
        <div className="lg:hidden flex flex-col items-center mb-8">
          <div className="w-12 h-12 rounded-2xl shadow-lg mb-3 overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
          <span className="font-black text-slate-900 text-xl tracking-tight">SKOVO</span>
          <p className="text-xs mt-1 text-slate-500">Mentor Portal</p>
        </div>

        <div className="w-full max-w-sm">
          {children}
        </div>
      </div>

    </div>
  );
}
