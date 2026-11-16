import React, { useState, useRef, useEffect } from 'react';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import { clearSuperToken } from '../../services/api';
import ThemeDropdown from '../../components/ui/ThemeDropdown';
import { useTheme } from '../../context/ThemeContext';
import {
  LayoutDashboard, Users, LogOut, Menu, X,
  UserCheck, CalendarDays, ShieldAlert, ShieldCheck, ChevronRight,
  Briefcase, MessageSquare, BookOpen, BarChart2, User, GraduationCap,
  TrendingUp, UserCog,
} from 'lucide-react';

const NAV_SECTIONS = [
  {
    label: 'Overview',
    items: [{ to: '/skovo-platform-owner', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Platform',
    items: [
      { to: '/skovo-platform-owner/business', label: 'Business', icon: TrendingUp },
      { to: '/skovo-platform-owner/admin-approvals', label: 'Admin Access', icon: UserCog },
      { to: '/skovo-platform-owner/admins', label: 'Admins', icon: ShieldCheck },
    ],
  },
  {
    label: 'Users',
    items: [
      { to: '/skovo-platform-owner/users',       label: 'All Users',   icon: Users },
      { to: '/skovo-platform-owner/achievers',    label: 'Achievers',   icon: UserCheck },
      { to: '/skovo-platform-owner/cohorts',     label: 'Cohorts',     icon: CalendarDays },
      { to: '/skovo-platform-owner/courses',     label: 'Courses',     icon: GraduationCap },
      { to: '/skovo-platform-owner/enrollments', label: 'Enrollments', icon: BookOpen },
      { to: '/skovo-platform-owner/readiness',   label: 'Readiness',   icon: BarChart2 },
      { to: '/skovo-platform-owner/v1-overview', label: 'V1 Overview', icon: BarChart2 },
    ],
  },
  {
    label: 'Content',
    items: [
      { to: '/skovo-platform-owner/opportunities', label: 'Opportunities', icon: Briefcase },
      { to: '/skovo-platform-owner/communities',   label: 'Communities',   icon: MessageSquare },
    ],
  },
  {
    label: 'System',
    items: [
      { to: '/skovo-platform-owner/audit', label: 'Audit Log', icon: ShieldAlert },
    ],
  },
];

const SUPER_PAGE_TITLES = {
  '/skovo-platform-owner':                  'Dashboard',
  '/skovo-platform-owner/business':         'Business',
  '/skovo-platform-owner/admin-approvals':  'Admin Access',
  '/skovo-platform-owner/admins':           'Admins',
  '/skovo-platform-owner/users':            'All Users',
  '/skovo-platform-owner/achievers':        'Achievers',
  '/skovo-platform-owner/cohorts':          'Cohorts',
  '/skovo-platform-owner/courses':          'Courses',
  '/skovo-platform-owner/enrollments':      'Enrollments',
  '/skovo-platform-owner/readiness':        'Readiness',
  '/skovo-platform-owner/opportunities':    'Opportunities',
  '/skovo-platform-owner/communities':      'Communities',
  '/skovo-platform-owner/audit':            'Audit Log',
  '/skovo-platform-owner/profile':          'My Profile',
};

function Sidebar({ onClose }) {
  const location = useLocation();
  return (
    <aside className="flex flex-col h-full border-r" style={{ width: 248, backgroundColor: 'var(--sidebar-bg)', borderColor: 'var(--sidebar-border)' }}>
      {/* Brand */}
      <div className="px-5 pt-6 pb-5" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg overflow-hidden shrink-0">
            <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="text-sm font-bold text-white tracking-tight">SKOVO</p>
            <p className="text-[11px] font-medium mt-0.5" style={{ color: 'var(--accent-ring)' }}>
              Founder Console
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 p-1 rounded-lg transition-colors">
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 overflow-y-auto space-y-5 scrollbar-none">
        {NAV_SECTIONS.map(section => (
          <div key={section.label}>
            <p className="px-3 mb-1.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--accent-ring)', opacity: 0.7 }}>
              {section.label}
            </p>
            <div className="space-y-0.5">
              {section.items.map(({ to, label, icon: Icon, end }) => {
                const isActive = end ? location.pathname === to : location.pathname.startsWith(to);
                return (
                  <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onClose}
                    style={isActive ? { backgroundColor: 'var(--accent)' } : {}}
                    className={`flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium transition-all ${
                      isActive ? 'text-white' : 'text-slate-400 hover:text-slate-200'
                    }`}
                    onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'; }}
                    onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = ''; }}
                  >
                    <span className="flex items-center gap-2.5">
                      <Icon size={15} />
                      {label}
                    </span>
                    {isActive && <ChevronRight size={13} className="opacity-60" />}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

    </aside>
  );
}

/* ── Header avatar dropdown — Profile + Sign Out ── */
function SuperUserMenu({ user, initials }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { mode } = useTheme();
  const dark = mode === 'dark';

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  function handleSignOut() {
    clearSuperToken();
    navigate('/skovo-platform-owner/login');
  }

  const panelBg     = dark ? '#1e293b' : '#ffffff';
  const panelBorder = dark ? '1px solid rgba(51,65,85,0.8)' : '1px solid #e2e8f0';
  const dividerBg   = dark ? 'rgba(51,65,85,0.8)' : '#f1f5f9';
  const labelColor  = dark ? 'rgba(148,163,184,0.7)' : '#94a3b8';
  const nameColor   = dark ? '#f1f5f9' : '#1e293b';
  const profileColor = dark ? '#cbd5e1' : '#334155';
  const profileHover = dark ? 'rgba(255,255,255,0.07)' : '#f8fafc';
  const signOutHover = dark ? 'rgba(239,68,68,0.12)' : '#fef2f2';

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-white text-[11px] font-bold shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
        style={{ backgroundColor: 'var(--accent)' }}
        title={user.full_name || 'Super Admin'}
      >
        {initials}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 220, borderRadius: 16, zIndex: 50, overflow: 'hidden',
          backgroundColor: panelBg,
          border: panelBorder,
          boxShadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.15)',
        }}>
          {/* User info */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${dividerBg}` }}>
            <p style={{ fontSize: 11, color: labelColor, margin: '0 0 3px 0' }}>Signed in as</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: nameColor, margin: '0 0 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.full_name || 'Super Admin'}</p>
            <p style={{ fontSize: 11, color: labelColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email || ''}</p>
          </div>

          {/* Actions */}
          <div style={{ padding: 6 }}>
            {/* My Profile */}
            <button
              onClick={() => { setOpen(false); navigate('/skovo-platform-owner/profile'); }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 12px', borderRadius: 10,
                fontSize: 14, fontWeight: 500, textAlign: 'left',
                cursor: 'pointer', border: 'none',
                backgroundColor: 'transparent', color: profileColor,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = profileHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <User size={15} color={labelColor} />
              My Profile
            </button>

            <div style={{ height: 1, backgroundColor: dividerBg, margin: '4px 0' }} />

            {/* Sign Out */}
            <button
              onClick={handleSignOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 12px', borderRadius: 10,
                fontSize: 14, fontWeight: 500, textAlign: 'left',
                cursor: 'pointer', border: 'none',
                backgroundColor: 'transparent', color: dark ? '#f87171' : '#dc2626',
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = signOutHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <LogOut size={15} color={dark ? '#f87171' : '#dc2626'} />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function SuperLayout() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  const user = (() => { try { return JSON.parse(localStorage.getItem('super_user') || '{}'); } catch { return {}; } })();
  const initials = (user.full_name || 'S').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);

  const pageTitle = Object.entries(SUPER_PAGE_TITLES).find(([path]) =>
    location.pathname === path || location.pathname.startsWith(path + '/')
  )?.[1] || 'Founder Console';

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* Skip to content — the sidebar carries a long nav list that a keyboard
          user would otherwise tab through again on every page. Hidden until
          focused, so it is first in the tree rather than styled away. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50
                   focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white
                   focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
        Skip to main content
      </a>

      {/* Mounted empty and permanently: a live region created at the same
          moment as its first message is frequently not announced at all.
          ToastProvider writes into this by id, so a portal without it makes
          every toast silent to a screen reader. */}
      <div id="a11y-live-region" role="status" aria-live="polite" aria-atomic="true"
           className="sr-only" />

      {/* Desktop sidebar */}
      <div className="hidden lg:flex flex-col shrink-0"><Sidebar /></div>

      {/* Mobile sidebar */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex flex-col"><Sidebar onClose={() => setOpen(false)} /></div>
        </>
      )}

      {/* Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* ── Top Header ── */}
        <header className="flex items-center gap-3 px-4 shrink-0" style={{ minHeight: 56, backgroundColor: 'var(--sidebar-bg)', borderBottom: '1px solid var(--sidebar-border)' }}>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(!open)}
            className="lg:hidden text-slate-400 hover:text-white p-1.5 rounded-lg hover:bg-white/10 transition-colors"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>

          {/* Mobile: brand */}
          <div className="flex lg:hidden items-center gap-2">
            <div className="w-6 h-6 rounded-md overflow-hidden shrink-0">
              <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
            </div>
            <span className="text-white font-bold text-sm">SKOVO</span>
          </div>

          {/* Desktop: page title. Persistent chrome that repeats the page's
              own <h1>, so it stays visible and stays out of the heading outline. */}
          <div className="hidden lg:flex items-center gap-2" aria-hidden="true">
            <div className="w-5 h-5 rounded flex items-center justify-center" style={{ backgroundColor: 'var(--accent)', opacity: 0.3 }}>
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: 'var(--accent)' }} />
            </div>
            <span className="text-sm font-semibold text-slate-200">{pageTitle}</span>
          </div>

          <div className="flex-1" />

          <ThemeDropdown dark={true} />

          {/* Avatar dropdown */}
          <SuperUserMenu user={user} initials={initials} />
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto" style={{ backgroundColor: 'var(--bg)' }}><PageTransition><Outlet /></PageTransition></main>
      </div>
    </div>
  );
}
