import useMobileCardTables from '../../hooks/useMobileCardTables';
import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation, Navigate } from 'react-router-dom';
import PageTransition from '../../components/ui/PageTransition';
import { useTheme } from '../../context/ThemeContext';
import ThemeDropdown from '../../components/ui/ThemeDropdown';
import { ToastProvider } from '../../components/ui/index.jsx';
import {
  LayoutDashboard, BookOpen, CalendarCheck, User, LogOut,
  Menu, X, Star, ChevronRight, Tag, Clock, TrendingUp, Bell, Ticket,
  ShieldCheck, UserRound, ClipboardList, LifeBuoy, Gift, } from 'lucide-react';
import { clearAchieverToken, achieverApi, mediaUrl, publishAchieverUser } from '../../services/api';
import { useAchieverLifecycle } from '../../hooks/useAchieverLifecycle';
import { routeFor } from '../../utils/achieverNotifRoute';

const NAV_GROUPS = [
  {
    label: 'Overview',
    items: [
      { to: '/skovo-achiever-portal',             label: 'Dashboard',   icon: LayoutDashboard, end: true, key: 'dashboard' },
      // Pending unlocks Verification only. Profile returns after approval;
      // while pending, the same fields sit on the Verification case page.
      { to: '/skovo-achiever-portal/profile',     label: 'Profile',      icon: UserRound, key: 'profile' },
      // Until this is complete the achiever cannot be listed, charge, or take a
      // booking, so it stays near the top rather than under an account menu.
      { to: '/skovo-achiever-portal/application', label: 'Verification', icon: ShieldCheck, key: 'verification' },
    ],
  },
  {
    label: 'My Work',
    items: [
      { to: '/skovo-achiever-portal/bookings',      label: 'Bookings',      icon: CalendarCheck, key: 'bookings' },
      { to: '/skovo-achiever-portal/cohorts',       label: 'My Cohorts',    icon: BookOpen, key: 'cohorts' },
      // Directly under Cohorts: a task only exists on a cohort, and the two
      // screens are used in the same sitting — run the session, set the work.
      { to: '/skovo-achiever-portal/tasks',         label: 'Tasks',         icon: ClipboardList, key: 'tasks' },
      { to: '/skovo-achiever-portal/review-queue',  label: 'Review queue',  icon: ClipboardList, key: 'tasks' },
      { to: '/skovo-achiever-portal/availability',  label: 'Availability',  icon: Clock, key: 'availability' },
      { to: '/skovo-achiever-portal/earnings',      label: 'Earnings',      icon: TrendingUp, key: 'earnings' },
      // v1: no Domains screen. Achievers pick (or add) a domain inside Create cohort;
      // admin curates the list in Admin > Domains.
      // { to: '/skovo-achiever-portal/domains',       label: 'Domains',       icon: Tag, key: 'domains' },
      // v1-hidden: My Courses
      // { to: '/skovo-achiever-portal/courses',       label: 'My Courses',    icon: GraduationCap, key: 'courses' },
      { to: '/skovo-achiever-portal/offers',        label: 'Offers',        icon: Ticket, key: 'coupons' },
    ],
  },
  {
    label: 'Account',
    items: [
      // Mobile has had this screen since launch; the web portal did not, so a
      // booking request only surfaced if the achiever opened the right page.
      { to: '/skovo-achiever-portal/notifications', label: 'Notifications', icon: Bell, key: 'notifications' },
      // No lifecycle key — restricted accounts still need Help.
      { to: '/skovo-achiever-portal/support', label: 'Help & support', icon: LifeBuoy },
      { to: '/skovo-achiever-portal/referrals', label: 'Refer & Earn', icon: Gift, key: 'referrals' },
    ],
  },
];

// Which screen key each route belongs to, for the redirect guard below. A
// hidden sidebar link is not access control -- the URL is still typeable, and
// before this the dashboard rendered for anyone who typed it.
const PATH_KEYS = {
  '/skovo-achiever-portal':                'dashboard',
  '/skovo-achiever-portal/application':    'verification',
  '/skovo-achiever-portal/profile':        'profile',
  '/skovo-achiever-portal/notifications':  'notifications',
  '/skovo-achiever-portal/bookings':       'bookings',
  '/skovo-achiever-portal/cohorts':        'cohorts',
  '/skovo-achiever-portal/tasks':          'tasks',
  '/skovo-achiever-portal/availability':   'availability',
  '/skovo-achiever-portal/earnings':       'earnings',
  '/skovo-achiever-portal/domains':        'domains',
  // v1-hidden: '/skovo-achiever-portal/courses':        'courses',
  '/skovo-achiever-portal/offers':         'coupons',
  '/skovo-achiever-portal/referrals':      'referrals',
};

const PAGE_TITLES = {
  '/skovo-achiever-portal':                'Dashboard',
  '/skovo-achiever-portal/application':    'Verification',
  '/skovo-achiever-portal/notifications':  'Notifications',
  '/skovo-achiever-portal/bookings':       'Bookings',
  '/skovo-achiever-portal/cohorts':        'My Cohorts',
  '/skovo-achiever-portal/tasks':          'Tasks',
  '/skovo-achiever-portal/review-queue':   'Review queue',
  '/skovo-achiever-portal/availability':   'Availability',
  '/skovo-achiever-portal/earnings':       'Earnings',
  '/skovo-achiever-portal/domains':        'Domains',
  // v1-hidden: '/skovo-achiever-portal/courses':        'My Courses',
  '/skovo-achiever-portal/offers':         'Offers',
  '/skovo-achiever-portal/profile':        'Profile',
  '/skovo-achiever-portal/support':        'Help & support',
  '/skovo-achiever-portal/referrals':      'Refer & Earn',
};


/** Nav item minus its screen key, which must not reach JSX as a spread prop. */
function rest({ key, ...props }) {   // eslint-disable-line no-unused-vars
  return props;
}

function NavItem({ to, label, icon: Icon, end, onClose }) {
  const location = useLocation();
  const isActive = end ? location.pathname === to : location.pathname.startsWith(to);

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClose}
      style={isActive ? { backgroundColor: 'var(--accent)' } : {}}
      className={`flex items-center gap-3 px-3 py-2.5 min-h-11 rounded-xl text-sm font-medium transition-all ${
        isActive ? 'text-white shadow-sm' : 'text-slate-400 hover:text-white'
      }`}
      onMouseEnter={e => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'; }}
      onMouseLeave={e => { if (!isActive) e.currentTarget.style.backgroundColor = ''; }}
    >
      <Icon size={16} className="shrink-0" />
      <span className="flex-1">{label}</span>
      {isActive && <ChevronRight size={13} className="opacity-60" />}
    </NavLink>
  );
}

function Sidebar({ onClose, lifecycle }) {
  return (
    <aside className="flex flex-col h-full text-white w-60" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-lg">
            <img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="font-black text-sm tracking-tight">SKOVO</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--accent-ring)' }}>
              Achiever Portal
            </p>
          </div>
          {onClose && (
            <button onClick={onClose}
              className="ml-auto text-slate-500 hover:text-slate-300 p-1 rounded-lg transition-colors"
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-none space-y-1">
        {NAV_GROUPS.map(({ label, items }) => {
          // A screen the achiever cannot open is not shown at all. While their
          // account is pending that leaves Verification — Profile and the rest
          // return after approval. A sidebar of greyed-out links over an
          // all-zero dashboard read as a product that was not working.
          const visible = items.filter(i => !i.key || !lifecycle || lifecycle.can(i.key));
          // Without this the 'My Work' heading survives its own empty list.
          if (!visible.length) return null;
          return (
            <div key={label} className="mb-1">
              <p className="px-3 text-[11px] font-bold uppercase tracking-widest mb-1 mt-2"
                style={{ color: 'var(--accent-ring)', opacity: 0.7 }}>
                {label}
              </p>
              {visible.map(item => (
                // `key` here is the screen key ('profile', 'bookings'), which
                // collides with React's reserved prop when spread. Pulled out so
                // React gets the route as its key and NavItem gets the rest.
                <NavItem key={item.to} {...rest(item)} onClose={onClose} />
              ))}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

function UserMenu({ canProfile }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const { mode } = useTheme();
  const dark = mode === 'dark';

  // `achiever_user` is written once, at login. Reading it straight into a
  // const meant a photo uploaded on the Profile page did not reach this button
  // until the next sign-in — the student header has an AuthContext doing this
  // job, the achiever portal has no equivalent. State plus the event the
  // Profile page fires closes that gap without introducing a context here.
  const readUser = () => {
    try { return JSON.parse(localStorage.getItem('achiever_user') || '{}'); } catch { return {}; }
  };
  const [user, setUser] = useState(readUser);
  const [failedPhoto, setFailedPhoto] = useState(null);

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    // 'achiever-user-updated' is same-tab (the Profile page after a save);
    // 'storage' is the other tabs, which the browser fires for free.
    const refresh = () => setUser(readUser());
    window.addEventListener('achiever-user-updated', refresh);
    // The cached copy is only as new as the last sign-in on this browser: a
    // photo saved from another device, or before this tab existed, never
    // reached it, so the header showed the initial. Read the real profile once.
    achieverApi.get('/achievers/portal/profile').then(({ data }) => {
      if (!data?.bool) return;
      const { full_name, profile_image_url, avatar_url } = data.response || {};
      const cur = readUser();
      if (cur.full_name !== full_name || cur.profile_image_url !== profile_image_url || cur.avatar_url !== avatar_url) {
        publishAchieverUser({ full_name, profile_image_url, avatar_url });
      }
    }).catch(() => {});
    window.addEventListener('storage', refresh);
    return () => {
      document.removeEventListener('mousedown', handle);
      window.removeEventListener('achiever-user-updated', refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  function handleSignOut() {
    clearAchieverToken();
    // Home, not the login form — the same rule the student sidebar already
    // follows. An achiever signing out is leaving, not switching accounts, and
    // dropping them on "Welcome back" asks them to do the one thing they just
    // chose not to do. The landing page gives them a reason to come back.
    navigate('/');
  }

  const initial      = user?.full_name?.charAt(0)?.toUpperCase() || 'A';
  // The uploaded photo, resolved against the API origin: profile_image_url is
  // stored as "/uploads/<name>", which the browser would otherwise resolve
  // against the SPA origin and 404. `avatar_url` is the field an admin fills in
  // from the Achievers screen; the achiever's own upload writes
  // profile_image_url, so the achiever's choice wins.
  const photoUrl  = mediaUrl(user?.profile_image_url || user?.avatar_url);
  // Which src failed, not merely that one did — so replacing a broken photo
  // retries on its own instead of staying behind a flag nothing clears.
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
      <button aria-label={user?.full_name || 'Achiever'}
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm cursor-pointer hover:opacity-90 transition-opacity overflow-hidden before:absolute before:-inset-2 before:content-['']"
        style={{ backgroundColor: 'var(--accent)' }}
        title={user?.full_name || 'Achiever'}
      >
        {showPhoto ? (
          <img
            src={photoUrl}
            alt=""
            className="w-full h-full object-cover"
            // Deleted from the bucket, or a URL that never resolved: fall back
            // to the initial rather than leave the browser's broken-image glyph
            // sitting in the header.
            onError={() => setFailedPhoto(photoUrl)}
          />
        ) : initial}
      </button>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 208, borderRadius: 16, zIndex: 50, overflow: 'hidden',
          backgroundColor: panelBg, border: panelBorder,
          boxShadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.15)',
        }}>
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${dividerBg}` }}>
            <p style={{ fontSize: 11, color: labelColor, margin: '0 0 3px 0' }}>Signed in as</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: nameColor, margin: '0 0 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || 'Achiever'}</p>
            <p style={{ fontSize: 11, color: labelColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email || ''}</p>
          </div>
          <div style={{ padding: 6 }}>
            {canProfile && (
              <>
            <button
              onClick={() => { setOpen(false); navigate('/skovo-achiever-portal/profile'); }}
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
              </>
            )}
            {/* Outside the canProfile gate on purpose.
                Fifteen places in this product tell someone to "contact
                support" -- a suspended account on sign-in, a rejected
                document, a failed refund -- and until now the portal offered
                no way to do it: this menu was My Profile and Sign Out. The
                person who most needs support is the one whose access is
                restricted, and `canProfile` is false for exactly them, so
                gating this behind it would hide the link from the only people
                reading those messages. */}
            <button
              onClick={() => { setOpen(false); navigate('/skovo-achiever-portal/support'); }}
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

function AchieverNotifBell() {
  const [count, setCount]   = useState(0);
  const [notifs, setNotifs] = useState([]);
  const [open, setOpen]     = useState(false);
  const ref = useRef(null);
  const navigate = useNavigate();
  const go = (to) => { setOpen(false); if (to) navigate(to); };
  const BASE_URL = import.meta.env.VITE_API_HOST
    ? `https://${import.meta.env.VITE_API_HOST}/v1`
    : '/v1';

  useEffect(() => {
    achieverApi.get('/notifications/unread-count')
      .then(({ data }) => { if (data.bool) setCount(data.response.count || 0); })
      .catch(() => {});

    const token = localStorage.getItem('achiever_access_token');
    if (!token || !window.EventSource) return;
    const url = `${BASE_URL}/notifications/stream?token=${encodeURIComponent(token)}`;
    const es = new EventSource(url);
    es.onmessage = (e) => {
      if (e.data && e.data !== 'ping') {
        try {
          const n = JSON.parse(e.data);
          if (n && !n.is_read) { setCount(c => c + 1); setNotifs(p => [n, ...p].slice(0, 10)); }
        } catch {}
      }
    };
    es.onerror = () => { es.close(); };
    return () => { es.close(); };
  }, [BASE_URL]);

  useEffect(() => {
    function handle(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, []);

  const handleOpen = () => {
    if (!open) {
      achieverApi.get('/notifications/').then(({ data }) => {
        if (data.bool) setNotifs(data.response.notifications || []);
      }).catch(() => {});
      achieverApi.post('/notifications/mark-all-read', {}).catch(() => {});
    }
    setOpen(o => !o);
    setCount(0);
  };

  return (
    <div className="relative" ref={ref}>
      <button aria-label="Notifications" onClick={handleOpen} className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all before:absolute before:-inset-2 before:content-['']" title="Notifications">
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
      {open && (
        // Every colour here used to be a hardcoded hex in an inline style
        // (#fff, #e2e8f0, #334155...). Inline styles carry no class, so none
        // of the html.dark rules in index.css could reach them and the panel
        // stayed white on a dark page. Colours are Tailwind classes now, which
        // the dark overrides already cover; only the geometry stays inline.
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col"
             style={{
               position: 'fixed', right: 8, top: 64,
               width: 'min(280px, calc(100vw - 16px))', maxHeight: 340, zIndex: 50,
               boxShadow: '0 20px 60px rgba(0,0,0,0.15)',
             }}>
          <div className="px-3.5 py-2.5 border-b border-slate-100 text-xs font-bold text-slate-700">
            Notifications
          </div>
          <div className="overflow-y-auto flex-1">
            {notifs.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-400">No notifications yet</p>
            ) : (
              notifs.map(n => (
                <button type="button" key={n.id} onClick={() => go(routeFor(n) || '/skovo-achiever-portal/notifications')}
                        className="block w-full text-left px-3.5 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 transition-colors">
                  <p className="text-xs font-semibold text-slate-800 mb-0.5">{n.title}</p>
                  <p className="text-[11px] text-slate-500 line-clamp-2">{n.message}</p>
                </button>
              ))
            )}
          </div>
          <button type="button" onClick={() => go('/skovo-achiever-portal/notifications')}
                  className="px-3.5 py-2.5 border-t border-slate-100 text-xs font-semibold text-blue-600 hover:bg-slate-50 text-center">
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}

export default function AchieverLayout() {
  useMobileCardTables();  // tables → cards on phones, portal-wide
  // One lifecycle fetch for the whole portal. Screens read it from the
  // Outlet context, so the sidebar's locks and a page's own gating can
  // never disagree about what state the achiever is in.
  const lifecycle = useAchieverLifecycle();

  // The achiever's real commission, fetched once for the whole portal. The
  // cohort and course screens had 30% typed into them, which stopped being
  // true the moment the platform default changed — and was never true for an
  // achiever on a negotiated rate. Null until it loads; screens must not
  // invent a number while waiting.
  const [commissionRate, setCommissionRate] = useState(null);
  // Seats an admin granted this achiever per cohort. Rides the same profile
  // call as the commission for the same reason: both are numbers an admin
  // owns, both are needed by the cohort form, and one request is enough.
  // undefined = still loading, null = no cap set, number = the cap.
  const [seatAllocation, setSeatAllocation] = useState(undefined);
  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/profile')
      .then(({ data }) => {
        if (!alive || !data?.bool) return;
        if (data.response.commission_rate != null) {
          setCommissionRate(Number(data.response.commission_rate));
        }
        const seats = data.response.cohort_seat_allocation;
        setSeatAllocation(seats == null ? null : Number(seats));
      })
      .catch(() => {
        // The split just hides. The seat allocation must resolve to something,
        // though: leaving it `undefined` would disable the cohort submit
        // button forever on a network blip. Falling back to null means "no
        // cap", which is how cohorts behaved before allocations existed — a
        // failed lookup should not lock an achiever out of their own portal.
        if (alive) setSeatAllocation(null);
      });
    return () => { alive = false; };
  }, []);
  const [open, setOpen] = useState(false);
  const location = useLocation();

  const pageTitle = PAGE_TITLES[location.pathname] || 'Achiever Portal';

  // `loading` matters: until the real screen list arrives `can()` answers
  // from the two-screen floor, and redirecting on that would throw an
  // active achiever off any page they opened directly.
  const currentKey = PATH_KEYS[location.pathname];
  const allowed    = !currentKey || lifecycle.can(currentKey);
  const blockedScreen = !lifecycle.loading && !allowed;
  // Login lands on the dashboard, so without this a pending achiever sees a
  // full screen of zeroes for as long as the lifecycle call takes, and only
  // then gets moved. Holding the render is the difference between a portal
  // that looks empty and one that looks like it is checking.
  const holdForCheck  = lifecycle.loading && !allowed;
  // Where a blocked screen sends you. This was hardcoded to /application, which
  // holds for pending and suspended because verification is unlocked
  // in all three. It is NOT unlocked for `banned`: the server lists only
  // dashboard and earnings. So a banned achiever opening any locked URL was
  // redirected to /application, which is itself blocked, which redirects to
  // /application... React Router stops at the no-op and the achiever sits on a
  // completely blank screen with nothing saying why. Pick the first screen the
  // server actually unlocked instead, and fall back to the dashboard.
  const FALLBACK_BY_KEY = {
    dashboard:    '/skovo-achiever-portal',
    verification: '/skovo-achiever-portal/application',
    earnings:     '/skovo-achiever-portal/earnings',
    profile:      '/skovo-achiever-portal/profile',
  };
  const blockedRedirect =
    ['verification', 'dashboard', 'earnings', 'profile']
      .filter(k => lifecycle.can(k))
      .map(k => FALLBACK_BY_KEY[k])[0] || '/skovo-achiever-portal';

  return (
    // ToastProvider wraps the whole portal so any screen can call useToast()
    // instead of carrying its own toast state and timer — which is what several
    // of them were doing.
    <ToastProvider duration={5000}>
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
      <div className="hidden lg:flex flex-col shrink-0"><Sidebar lifecycle={lifecycle} /></div>

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex flex-col shadow-2xl"><Sidebar onClose={() => setOpen(false)} lifecycle={lifecycle} /></div>
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top header */}
        <header className="flex items-center gap-3 px-4 bg-white border-b border-slate-200 shrink-0 shadow-sm" style={{ minHeight: 56 }}>
          <button type="button" aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(o => !o)} className="lg:hidden relative text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 transition-colors before:absolute before:-inset-2 before:content-['']">
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
          {/* Brand only on phones. From `md` up there is room for the page
              title, and a tablet user seeing "Achiever" instead of the screen
              they are on was the visible half of the missing md: breakpoint. */}
          <div className="flex md:hidden items-center gap-2">
            <div className="w-7 h-7 rounded-lg overflow-hidden shrink-0">
              <img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" />
            </div>
            <span className="hidden min-[360px]:inline text-slate-900 font-bold text-sm">Achiever</span>
          </div>
          {/* Persistent chrome that repeats the page's own <h1>, so it stays
              visible and stays out of the heading outline. */}
          <div className="hidden md:flex items-center gap-2" aria-hidden="true">
            <Star size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold text-slate-900">{pageTitle}</span>
          </div>
          <div className="flex-1" />
          <AchieverNotifBell />
          <ThemeDropdown dark={false} />
          <UserMenu canProfile={lifecycle.can('profile')} />
        </header>

        {/* Ultrawide cap. Without max-w the content stretched the full 2560px,
            leaving KPI cards a screen apart and table rows unreadable end to
            end. 1600px is the widest a data screen stays scannable; it centres
            beyond that rather than growing. */}
        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto p-4 sm:p-6 2xl:p-8">
          <div className="mx-auto w-full max-w-400">
            {/* Hiding the link is presentation; this is the actual gate. It
                waits for the fetch to land so an approved achiever is never
                bounced off their own dashboard by the loading floor. */}
            {blockedScreen ? (
              blockedRedirect === location.pathname
                ? <p className="py-24 text-center text-sm text-slate-500">
                    This screen is not available on your account.
                  </p>
                : <Navigate to={blockedRedirect} replace />
            ) : holdForCheck ? (
              <div className="flex items-center justify-center py-24">
                <div className="h-6 w-6 rounded-full border-2 border-slate-200 border-t-slate-500 animate-spin" />
              </div>
            ) : (
              <PageTransition><Outlet context={{ lifecycle, commissionRate, seatAllocation }} /></PageTransition>
            )}
          </div>
        </main>
      </div>
    </div>
    </ToastProvider>
  );
}
