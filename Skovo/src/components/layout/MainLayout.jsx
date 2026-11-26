import useMobileCardTables from '../../hooks/useMobileCardTables';
import { goHomeAfterSignOut } from '../../utils/signOut';
import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import PageTransition from '../ui/PageTransition';
import useScrollTopOnNavigate from '../../hooks/useScrollTopOnNavigate';
import { useAuth } from '../../context/AuthContext';
import { useTheme } from '../../context/ThemeContext';
import ThemeDropdown from '../ui/ThemeDropdown';
import { api, mediaUrl } from '../../services/api';
import { isStudentPathComplete } from '../../config/educationPathways';
import OnboardingModal from '../OnboardingModal';
import {
  LayoutDashboard, Users, GraduationCap, Briefcase, FileText,
  MessageSquare, BookOpen, User, Star, LogOut, Menu, X, Zap,
  CalendarCheck, CheckSquare, ChevronRight, Compass, Bell, Map, Receipt,
  ClipboardList, FolderOpen, PenTool, Award, Trophy, MessageCircle, Crown, ShoppingBag, Gauge, Bookmark, Target,
  Sparkles, LifeBuoy, Gift, Flame, Wallet,
  UserRound,
} from 'lucide-react';
import { useStreakPing } from '../v1/readinessV21Hooks';

const STUDENT_NAV = [
  {
    label: 'Discover',
    items: [
      { to: '/career-path',          icon: LayoutDashboard, label: 'Dashboard' },
      // BhaAI v1: a grounded career chat for Pro, a preview for everyone else.
      { to: '/bhaai',                icon: Sparkles,        label: 'BhaAI' },
      // v1-hidden: { to: '/readiness-assessment', icon: Zap,             label: 'Assessment' },
      { to: '/cohorts',              icon: Users,           label: 'Cohorts' },
      { to: '/one-on-one',           icon: UserRound,       label: '1-on-1 sessions' },
      { to: '/tasks',                icon: CheckSquare,     label: 'My Tasks' },
      { to: '/practice',             icon: Target,          label: 'Practice' },
      { to: '/streak',               icon: Flame,           label: 'Streak' },
      { to: '/colleges',             icon: GraduationCap,   label: 'Colleges' },
      // Saved Colleges and College Predictor are tabs inside Colleges now, not
      // sidebar entries — see components/colleges/CollegeTabs.jsx. Their routes
      // still exist; only the nav entry point moved.
      // { to: '/colleges/saved',       icon: Bookmark,        label: 'Saved Colleges' },
      // { to: '/colleges/predictor',   icon: Target,          label: 'College Predictor' },
      { to: '/opportunities',        icon: Briefcase,       label: 'Opportunities' },
      { to: '/find-mentors',         icon: Star,            label: 'Find Achievers' },
      // v1-hidden: { to: '/courses',              icon: BookOpen,        label: 'Courses' },
      // v1-hidden: { to: '/career-guidance',      icon: Compass,         label: 'Career Guidance' },
    ],
  },
  {
    label: 'My Activity',
    items: [
      { to: '/skovo-pro',    icon: Crown,         label: 'Skovo Pro' },
      // v1-hidden: { to: '/roadmap',      icon: Map,           label: 'My Roadmap' },
      { to: '/bookings',     icon: CalendarCheck, label: 'My Bookings' },
      { to: '/payments',     icon: Receipt,       label: 'Payments' },
      { to: '/wallet',       icon: Wallet,        label: 'Wallet & refunds' },
      { to: '/applications', icon: FileText,      label: 'Applications' },
    ],
  },
  {
    label: 'Test Prep',
    items: [
      // v1-hidden: { to: '/mock-tests',        icon: ClipboardList,    label: 'Mock Tests' },
      // v1-hidden: { to: '/exam-resources',    icon: BookOpen,         label: 'Study Materials' },
    ],
  },
  {
    label: 'Tools',
    items: [
      // v1-hidden: { to: '/college-applications', icon: FileText,     label: 'App Tracker' },
      // v1-hidden: { to: '/scholarship-tracker',  icon: Star,         label: 'Scholarships' },
      // v1-hidden: { to: '/resume-builder',       icon: Briefcase,    label: 'Resume Builder' },
      // v1-hidden: { to: '/sop-builder',          icon: PenTool,      label: 'SOP Builder' },
      { to: '/document-vault',       icon: FolderOpen,   label: 'Document Vault' },
      // v1-hidden: { to: '/certifications',       icon: Award,        label: 'Certifications' },
      // Moved to the Dashboard's Quick Actions — the route still exists.
      // { to: '/market',               icon: ShoppingBag,  label: 'Market' },
      { to: '/my-score',             icon: Gauge,        label: 'My Score' },
    ],
  },
  {
    label: 'Community',
    items: [
      // v1-hidden: { to: '/forum',    icon: MessageCircle,  label: 'Forum' },
      { to: '/assemble', icon: MessageSquare,  label: 'Assemble' },
      // v1-hidden: { to: '/coaching', icon: BookOpen,       label: 'Coaching' },
      { to: '/leaderboard', icon: Trophy,         label: 'Leaderboard' },
    ],
  },
  {
    label: 'Account',
    items: [
      { to: '/notifications', icon: Bell,  label: 'Notifications' },
      { to: '/referrals', icon: Gift, label: 'Refer & Earn' },
      { to: '/support', icon: LifeBuoy, label: 'Help & support' },
    ],
  },
];

const PAGE_TITLES = {
  '/career-path':                         'Dashboard',
  '/bhaai':                               'BhaAI',
  // v1-hidden: '/readiness-assessment':                'Readiness Assessment',
  '/cohorts':                             'Cohorts',
  '/colleges':                            'Colleges',
  '/colleges/saved':                      'Saved Colleges',
  '/colleges/predictor':                  'College Predictor',
  '/opportunities':                       'Opportunities',
  '/find-mentors':                        'Find Achievers',
  // v1-hidden: '/courses':                             'Courses',
  // v1-hidden: '/career-guidance':                     'Career Guidance',
  // v1-hidden: '/career-guidance/entrance-exams':      'Entrance Exams',
  // v1-hidden: '/career-guidance/scholarships':        'Scholarships',
  // v1-hidden: '/career-guidance/govt-exams':          'Govt Exams',
  // v1-hidden: '/career-guidance/abroad':              'Study Abroad',
  // v1-hidden: '/career-guidance/branches':            'Career Branches',
  '/skovo-pro':                           'Skovo Pro',
  '/bookings':                            'My Bookings',
  '/payments':                            'Payments',
  '/tasks':                               'My Tasks',
  '/applications':                        'Applications',
  // v1-hidden: '/roadmap':                             'My Roadmap',
  '/assemble':                            'Assemble',
  // v1-hidden: '/coaching':                            'Coaching',
  '/profile':                             'Profile',
  '/notifications':                       'Notifications',
  '/support':                             'Help & support',
  // v1-hidden: '/mock-tests':                          'Mock Tests',
  // v1-hidden: '/exam-resources':                      'Study Materials',
  // v1-hidden: '/college-applications':                'Application Tracker',
  // v1-hidden: '/scholarship-tracker':                 'Scholarship Tracker',
  // v1-hidden: '/resume-builder':                      'Resume Builder',
  // v1-hidden: '/sop-builder':                         'SOP Builder',
  '/document-vault':                      'Document Vault',
  // v1-hidden: '/certifications':                      'Certifications',
  '/market':                              'Market',
  '/my-score':                            'My Readiness Score',
  '/leaderboard':                         'Leaderboard',
  '/practice':                            'Practice',
  '/streak':                              'Streak',
  '/wallet':                              'Wallet & refunds',
  // v1-hidden: '/forum':                               'Community Forum',
  '/referrals':                              'Refer & Earn',
};

function Sidebar({ onClose }) {
  const location = useLocation();
  // Drop any group left empty after v1-hidden items are removed.
  const navGroups = STUDENT_NAV.filter((g) => g.items.length > 0);

  // Exactly one nav item lights up: the longest path that the current URL
  // matches. A plain startsWith highlighted both "Colleges" and "Saved
  // Colleges" on /colleges/saved, because one route is a prefix of the other.
  // Longest-match keeps /colleges/:id on "Colleges" while /colleges/saved
  // belongs to "Saved Colleges", and stays correct for any future nested route.
  const activePath = navGroups
    .flatMap((g) => g.items.map((i) => i.to))
    .filter((p) => location.pathname === p || location.pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];

  // Sign-out lives in the header's UserMenu, which is present at every width —
  // the sidebar carries navigation only. It used to hold a duplicate handler
  // with no button attached to it, which read like a missing feature rather
  // than the dead code it was.

  return (
    <div className="flex flex-col h-full w-64" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
      {/* Logo */}
      <div className="px-5 py-5 flex items-center gap-3" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-lg">
          <img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" />
        </div>
        <div>
          <span className="text-white font-bold text-base tracking-tight block leading-tight">SKOVO</span>
          <span className="text-[11px] font-medium" style={{ color: 'var(--accent-ring)', opacity: 0.8 }}>
            {'AI Career OS'}
          </span>
        </div>
        {onClose && (
          <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 transition-colors p-1 rounded-lg" onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
            <X size={17} />
          </button>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-3 space-y-1 overflow-y-auto scrollbar-none">
        {navGroups.map(({ label, items }) => (
          <div key={label} className="mb-1">
            <p className="px-3 text-[11px] font-bold uppercase tracking-widest mb-1 mt-2" style={{ color: 'var(--accent-ring)', opacity: 0.7 }}>{label}</p>
            {items.map(({ to, icon: Icon, label: itemLabel, upcoming }) => {
              const isActive = to === activePath;

              return (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/career-path'}
                  onClick={onClose}
                  style={isActive ? { backgroundColor: 'var(--accent)' } : {}}
                  className={`flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'text-white shadow-sm'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'; }}
                  onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = ''; }}
                >
                  <Icon size={16} className="shrink-0" />
                  <span className="flex-1">{itemLabel}</span>
                  {upcoming && !isActive && (
                    <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md"
                          style={{ color: 'var(--accent-ring)', backgroundColor: 'var(--sidebar-hover)' }}>
                      Soon
                    </span>
                  )}
                  {isActive && <ChevronRight size={13} className="opacity-60" />}
                </NavLink>
              );
            })}
          </div>
        ))}
      </nav>

    </div>
  );
}

/* ── Header user dropdown ── */
function UserMenu({ user }) {
  const [open, setOpen] = useState(false);
  const [failedPhoto, setFailedPhoto] = useState(null);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { mode } = useTheme();
  const dark = mode === 'dark';

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  async function handleSignOut() {
    setOpen(false);
    await logout();
    // Home, not the login form: someone signing out is leaving.
    goHomeAfterSignOut();
  }

  const initial = user?.full_name?.charAt(0)?.toUpperCase() || 'U';
  const name    = user?.full_name || 'User';
  const contact = user?.email || user?.phone || '';

  // The photo, resolved against the API origin: avatar_url is stored as
  // "/uploads/<name>", which the browser would otherwise resolve against the
  // SPA origin and 404. Same helper the Profile card's <AvatarImg> uses.
  const photoUrl = mediaUrl(user?.avatar_url);
  // Which src failed, not that one did -- so a replacement upload retries on
  // its own instead of being stuck behind a flag nothing clears. The fallback
  // here is the initial rather than the silhouette default, because that is
  // what this button has always shown when there is no photo.
  const showPhoto = Boolean(photoUrl) && photoUrl !== failedPhoto;

  const panelBg      = dark ? '#1e293b' : '#ffffff';
  const panelBorder  = dark ? '1px solid rgba(51,65,85,0.8)' : '1px solid #e2e8f0';
  const dividerBg    = dark ? 'rgba(51,65,85,0.8)' : '#f1f5f9';
  const labelColor   = dark ? 'rgba(148,163,184,0.7)' : '#94a3b8';
  const nameColor    = dark ? '#f1f5f9' : '#1e293b';
  const profileColor = dark ? '#cbd5e1' : '#334155';
  const profileHover = dark ? 'rgba(255,255,255,0.07)' : '#f8fafc';
  const signOutColor = dark ? '#f87171' : '#dc2626';
  const signOutHover = dark ? 'rgba(239,68,68,0.12)' : '#fef2f2';

  return (
    <div className="relative" ref={ref}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-11 h-11 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer hover:opacity-90 transition-opacity overflow-hidden"
        style={{ backgroundColor: 'var(--accent)' }}
        title={name}
      >
        {showPhoto ? (
          <img
            src={photoUrl}
            alt=""
            className="w-full h-full object-cover"
            // Deleted from the bucket, or a URL that never resolved: drop back
            // to the initial rather than leaving the browser's broken-image
            // glyph in the header.
            onError={() => setFailedPhoto(photoUrl)}
          />
        ) : initial}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 208, borderRadius: 16, zIndex: 50, overflow: 'hidden',
          backgroundColor: panelBg,
          border: panelBorder,
          boxShadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.15)',
        }}>
          {/* User greeting */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${dividerBg}` }}>
            <p style={{ fontSize: 11, color: labelColor, margin: '0 0 3px 0' }}>Signed in as</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: nameColor, margin: '0 0 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
            <p style={{ fontSize: 11, color: labelColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{contact}</p>
          </div>

          {/* Menu items */}
          <div style={{ padding: 6 }}>
            <button
              onClick={() => { setOpen(false); navigate('/profile'); }}
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

            {/* Same addition as the achiever portal's menu, for the same
                reason: the product tells students to contact support when a
                refund fails or a booking cannot be cancelled, and this menu
                offered no way to do it. Both portals point at the same
                /contact page so there is one address to keep correct. */}
            <button
              onClick={() => { setOpen(false); navigate('/support'); }}
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
              <LifeBuoy size={15} color={labelColor} />
              Help &amp; support
            </button>

            <div style={{ height: 1, backgroundColor: dividerBg, margin: '4px 0' }} />

            <button
              onClick={handleSignOut}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '8px 12px', borderRadius: 10,
                fontSize: 14, fontWeight: 500, textAlign: 'left',
                cursor: 'pointer', border: 'none',
                backgroundColor: 'transparent', color: signOutColor,
                transition: 'background 0.15s',
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = signOutHover}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <LogOut size={15} color={signOutColor} />
              Sign Out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NotifBell() {
  const [count, setCount] = useState(0);
  const navigate = useNavigate();
  const BASE_URL = import.meta.env.VITE_API_HOST
    ? `https://${import.meta.env.VITE_API_HOST}/v1`
    : '/v1';

  useEffect(() => {
    // Initial fetch
    api.get('/notifications/unread-count')
      .then(({ data }) => { if (data.bool) setCount(data.response.count || 0); })
      .catch(() => {});

    // SSE for real-time updates
    const token = localStorage.getItem('access_token');
    if (!token || !window.EventSource) return;

    const url = `${BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);

    es.onmessage = (e) => {
      if (e.data && e.data !== 'ping') {
        try {
          const notif = JSON.parse(e.data);
          if (notif && !notif.is_read) setCount(n => n + 1);
        } catch {}
      }
    };

    es.onerror = () => { es.close(); };

    return () => { es.close(); };
  }, [BASE_URL]);

  return (
    <button
      onClick={() => { setCount(0); navigate('/notifications'); }}
      className="relative min-h-11 min-w-11 p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
      title="Notifications"
    >
      <Bell size={18} />
      {count > 0 && (
        // A small pill at the bell's corner that grows with the number
        // (3, 12, 99+), instead of a fixed circle squeezing "9+" over the icon.
        <span aria-label={`${count} unread`}
              className="absolute top-1 right-1 translate-x-1/3 -translate-y-1/3 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center tabular-nums shadow-sm">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}

export default function MainLayout() {
  useMobileCardTables();  // tables → cards on phones, portal-wide
  useStreakPing();        // v2.1 day streak: 30 s in the app, once a day
  const [open, setOpen] = useState(false);
  const { user, updateUser } = useAuth();
  // First-login setup: the Journey Card, quizzes, leaderboards and opportunities
  // all key off the student's stage, so a new student fills it before anything
  // else. Shown only after the server has answered, so it never flashes for a
  // student whose profile is already there.
  const [profileChecked, setProfileChecked] = useState(false);
  const [consent, setConsent] = useState(null);
  const { mode } = useTheme();
  const location = useLocation();

  // <main> is the scrolling element, not the window — see the hook for why
  // nothing else resets it on navigation.
  const mainRef = useRef(null);
  useScrollTopOnNavigate(mainRef);

  useEffect(() => {
    api.get('/profile/')
      .then(({ data }) => {
        if (!data.bool) return;
        const profile = data.response.profile || {};
        const complete = isStudentPathComplete(profile, {
          reservation_category: data.response.reservation_category,
        });
        updateUser({
          education_level: profile.education_level || profile.education_category || null,
          education_category: profile.education_category || null,
          path_complete: complete,
        });
        setProfileChecked(true);
      })
      .catch(() => {});
    // Date of birth is asked in the same setup when it is not on file yet.
    api.get('/auth/consent/status')
      .then(({ data }) => setConsent(data?.response?.consent_status || 'granted'))
      .catch(() => setConsent('granted'));
  }, []);

  useEffect(() => {
    api.get('/auth/me')
      .then(({ data }) => {
        // The header avatar reads user.avatar_url out of the stored session,
        // which is only as fresh as the login response that wrote it. Taking
        // the server's copy here is what makes the photo survive a reload or a
        // sign-in on another device, and what corrects a session that was
        // stored before the upload happened.
        updateUser({ avatar_url: data?.response?.avatar_url || null });
      })
      .catch(() => {});
  }, []);

  const pageTitle = Object.entries(PAGE_TITLES).find(([path]) =>
    location.pathname === path || (path !== '/career-path' && location.pathname.startsWith(path))
  )?.[1] || 'SKOVO';

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden">
      {/* UI04-004 — skip to content.
          The sidebar carries ~20 links, and without this a keyboard or screen
          reader user tabs every one of them again on every single page before
          reaching the thing they came for. Visually hidden until focused, which
          is why it is the first element in the tree rather than styled away. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50
                   focus:rounded-lg focus:bg-blue-600 focus:px-4 focus:py-2 focus:text-white
                   focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-300">
        Skip to main content
      </a>

      {/* UI04-011 — a live region that exists BEFORE any toast fires.
          A region created at the same moment as its message is frequently not
          announced at all, so this is mounted empty and permanently. Toasts
          write their text here; sighted users still see the toast component. */}
      <div id="a11y-live-region" role="status" aria-live="polite" aria-atomic="true"
           className="sr-only" />

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col shrink-0">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="fixed inset-0 bg-slate-900/60 z-30 lg:hidden backdrop-blur-sm" onClick={() => setOpen(false)} />
          <aside className="fixed inset-y-0 left-0 z-40 lg:hidden flex flex-col shadow-2xl"
                 style={{ paddingTop: 'env(safe-area-inset-top)' }}>
            <Sidebar onClose={() => setOpen(false)} />
          </aside>
        </>
      )}

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Top Header ── */}
        <header className="flex items-center gap-3 px-4 bg-white border-b border-slate-200 shrink-0 shadow-sm"
          style={{ minHeight: 56, paddingTop: 'max(0px, env(safe-area-inset-top))' }}>
          {/* Mobile: hamburger */}
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setOpen(true)}
            className="lg:hidden min-h-11 min-w-11 flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all"
          >
            <Menu size={20} />
          </button>

          {/* Mobile: current page, not a second logo wordmark.
              The title only appears once there is room for it. At 320px the
              header's budget is 32 padding + 48 gaps + 44 hamburger + 44 bell
              + 61 theme + 44 avatar = 273, leaving 47px for the logo AND the
              title -- so "My Readiness Score" (139px) rendered as a single
              letter "M". No styling fixes that; the text does not fit beside
              four controls at that width.
              Every screen renders the same words as its own <h1> directly
              below, so below sm the page itself says where you are and the
              header just carries the mark and the controls. */}
          <div className="flex lg:hidden items-center gap-2 min-w-0 flex-1">
            <div className="w-7 h-7 rounded-lg shadow overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="" className="w-full h-full object-cover" /></div>
            <span className="hidden sm:block font-bold text-slate-900 text-sm truncate">{pageTitle}</span>
          </div>

          {/* Desktop: page title */}
          <div className="hidden lg:block">
            {/* UI04-005 — NOT a heading.
                This was an <h2>, and because it sits above the outlet it was
                the first heading in the document on every page — so the
                outline began at level 2 and the page's own <h1> came second.
                35 of the 50 screens render their own <h1> with the same words,
                so promoting this one to <h1> only produced two.
                It is persistent chrome that repeats the page title, so it
                belongs outside the heading outline altogether: visible, and
                hidden from assistive technology because the real <h1> below
                says the same thing. */}
            <p aria-hidden="true" className="text-sm font-semibold text-slate-900">{pageTitle}</p>
          </div>

          <div className="hidden lg:block flex-1" />

          {/* Notification bell */}
          <NotifBell />

          {/* Theme dropdown */}
          <ThemeDropdown dark={mode === 'dark'} />

          {/* User avatar dropdown */}
          <UserMenu user={user} />
        </header>

        <main ref={mainRef} id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto">
          <PageTransition><Outlet /></PageTransition>
          {profileChecked && consent !== null && (consent !== 'granted' || !user?.education_level) && (
            <OnboardingModal
              consentStatus={consent}
              needsProfile={!user?.education_level}
              onConsentChange={setConsent}
            />
          )}
        </main>
      </div>
    </div>
  );
}
