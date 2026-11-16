import useMobileCardTables from '../../hooks/useMobileCardTables';
﻿import React, { useState, useRef, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { adminApi } from '../../services/api';
import PageTransition from '../../components/ui/PageTransition';
import { useAuth } from '../../context/AuthContext';
import ThemeDropdown from '../../components/ui/ThemeDropdown';
import { useTheme } from '../../context/ThemeContext';
import { useAdminConsole } from '../../hooks/useAdminConsole';
import AdminHoldingScreen from './AdminHoldingScreen';
import { useToast } from '../../components/ui/index.jsx';
import {
  LayoutDashboard, Users, BookOpen, GraduationCap, Briefcase, Star, Tag,
  LogOut, Menu, X, Shield, MailOpen, ScrollText,
  UserCheck, CalendarCheck, IndianRupee, CheckSquare, Sliders, ChevronRight, User, Brain, Database, AlertTriangle, Crown, ShoppingBag, Gauge, ShieldAlert,
  ClipboardList, FileText, BarChart2, Share2, MessageSquare, Ticket, Upload,
  ClipboardCheck, MapPin, LifeBuoy, Layers, Flame, Trophy, Sparkles, Wallet, Building,
} from 'lucide-react';

function isCollegeSubdomain() {
  const host = window.location.hostname;
  const parts = host.split('.');
  if (host === 'localhost' || host === '127.0.0.1') return false;
  if (parts.length === 2 && parts[1] === 'localhost') return parts[0] !== 'demo';
  if (parts.length >= 3) return parts[0] !== 'demo' && parts[0] !== 'www';
  return false;
}

const NAV_FULL_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/skovo-platform-panel-admin', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Management',
    items: [
      { to: '/skovo-platform-panel-admin/users',     label: 'Students',  icon: Users },
      { to: '/skovo-platform-panel-admin/cohorts',   label: 'Cohorts',   icon: BookOpen },
      { to: '/skovo-platform-panel-admin/achievers', label: 'Achievers', icon: UserCheck },
      { to: '/skovo-platform-panel-admin/achiever-guidelines', label: 'Achiever guidelines', icon: UserCheck },
      { to: '/skovo-platform-panel-admin/achiever-review', label: 'Achiever Review', icon: ClipboardCheck },
      { to: '/skovo-platform-panel-admin/bookings',  label: 'Bookings',  icon: CalendarCheck },
      { to: '/skovo-platform-panel-admin/payments',  label: 'Payments',  icon: IndianRupee },
      { to: '/skovo-platform-panel-admin/coupons',   label: 'Coupons',   icon: Ticket },
      { to: '/skovo-platform-panel-admin/subscriptions', label: 'Subscriptions', icon: Crown },
      { to: '/skovo-platform-panel-admin/market',        label: 'Market',        icon: ShoppingBag },
      { to: '/skovo-platform-panel-admin/score-rules',   label: 'Score Engine',  icon: Gauge },
      { to: '/skovo-platform-panel-admin/moderation',    label: 'Moderation',    icon: ShieldAlert },
      { to: '/skovo-platform-panel-admin/tasks',     label: 'Tasks',     icon: CheckSquare },
    ],
  },
  {
    label: 'Content',
    items: [
      // The colleges page + "Add College" existed but was only linked in the
      // college-subdomain nav, so a normal platform admin had no way to reach
      // it — which read as "there is no page to add colleges".
      { to: '/skovo-platform-panel-admin/colleges',       label: 'Colleges',      icon: GraduationCap },
      { to: '/skovo-platform-panel-admin/opportunities',  label: 'Opportunities', icon: Briefcase },
      { to: '/skovo-platform-panel-admin/domains',        label: 'Domains',       icon: Tag },
      { to: '/skovo-platform-panel-admin/masters',        label: 'Masters',       icon: Database },
      // The city list students actually pick from — the `cities` entity table,
      // not the flat master_city type on the Masters screen.
      { to: '/skovo-platform-panel-admin/cities',         label: 'Cities',        icon: MapPin },
      // The course/trade list onboarding searches. Separate from Masters for the
      // same reason Cities is: Masters edits flat name/label types, and nothing
      // student-facing reads those for courses.
      { to: '/skovo-platform-panel-admin/course-catalogue', label: 'Courses & Trades', icon: GraduationCap },
      { to: '/skovo-platform-panel-admin/import',         label: 'Bulk Import',   icon: Upload },
      // v1-hidden: { to: '/skovo-platform-panel-admin/coaching',       label: 'Coaching',      icon: Building2 },
      // v1-hidden: { to: '/skovo-platform-panel-admin/mock-tests',        label: 'Mock Tests',       icon: ClipboardList },
      // v1-hidden: { to: '/skovo-platform-panel-admin/exam-resources',    label: 'Study Materials',  icon: BookOpen },
      // v1-hidden: { to: '/skovo-platform-panel-admin/courses',           label: 'Courses',          icon: GraduationCap },
      { to: '/skovo-platform-panel-admin/college-reviews',   label: 'College Reviews',  icon: MessageSquare },
      { to: '/skovo-platform-panel-admin/communities',       label: 'Communities',      icon: Users },
      { to: '/skovo-platform-panel-admin/referrals',         label: 'Referrals',        icon: Share2 },
    ],
  },
  {
    label: 'Career Guidance',
    items: [
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-colleges',       label: 'CG Colleges',    icon: GraduationCap },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-branches',       label: 'CG Branches',    icon: Tag },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-rank-data',      label: 'Rank Data',      icon: BarChart2 },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-entrance-exams', label: 'Entrance Exams', icon: BookOpen },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-scholarships',   label: 'Scholarships',   icon: Star },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-govt-exams',     label: 'Govt Exams',     icon: Shield },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-abroad',         label: 'Abroad Studies', icon: Building2 },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-content',        label: 'CG Content',     icon: FileText },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-ai-prompts',     label: 'AI Prompts',     icon: Brain },
    ],
  },
  {
    label: 'Analytics',
    items: [
      { to: '/skovo-platform-panel-admin/analytics', label: 'Platform Analytics', icon: BarChart2 },
    ],
  },
  {
    label: 'Version 1',
    items: [
      { to: '/skovo-platform-panel-admin/stages',           label: 'Stages',            icon: Layers },
      { to: '/skovo-platform-panel-admin/readiness',        label: 'Readiness & SP',    icon: Gauge },
      { to: '/skovo-platform-panel-admin/streaks',          label: 'Career Streaks',    icon: Flame },
      { to: '/skovo-platform-panel-admin/leaderboard',      label: 'Leaderboard',       icon: Trophy },
      { to: '/skovo-platform-panel-admin/engagement',       label: 'Daily Engagement',  icon: Sparkles },
      { to: '/skovo-platform-panel-admin/wallet',           label: 'Wallet & Refunds',  icon: Wallet },
      { to: '/skovo-platform-panel-admin/community-safety', label: 'Community Safety',  icon: ShieldAlert },
      { to: '/skovo-platform-panel-admin/platform-v1',      label: 'Platform Settings', icon: Building },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/skovo-platform-panel-admin/readiness-rules', label: 'Readiness Rules', icon: Sliders },
      { to: '/skovo-platform-panel-admin/invites',         label: 'Invitations',     icon: MailOpen },
      { to: '/skovo-platform-panel-admin/audit',           label: 'Audit Log',       icon: ScrollText },
      { to: '/skovo-platform-panel-admin/error-logs',     label: 'Error Logs',      icon: AlertTriangle },
      { to: '/skovo-platform-panel-admin/support',        label: 'Support',         icon: LifeBuoy },
    ],
  },
];

/* ── Role-based nav gating (mirrors portal/helpers/admin_auth.py) ──────────── */
// path prefix → area. Anything unmatched is 'content' (the broadest area).
const AREA_BY_PATH = {
  '/skovo-platform-panel-admin/users': 'users',
  '/skovo-platform-panel-admin/achievers': 'users',
  '/skovo-platform-panel-admin/achiever-guidelines': 'content',
  // KYC sits in the users area — same permission that governs bans and account
  // records, so content_moderator and finance cannot approve achiever tiers.
  '/skovo-platform-panel-admin/achiever-review': 'users',
  '/skovo-platform-panel-admin/payments': 'finance',
  '/skovo-platform-panel-admin/subscriptions': 'finance',
  '/skovo-platform-panel-admin/coupons': 'finance',
  '/skovo-platform-panel-admin/moderation': 'moderation',
  '/skovo-platform-panel-admin/communities': 'moderation',
  '/skovo-platform-panel-admin/college-reviews': 'moderation',
  '/skovo-platform-panel-admin/score-rules': 'score',
  '/skovo-platform-panel-admin/readiness-rules': 'score',
  '/skovo-platform-panel-admin/masters': 'ops',
  '/skovo-platform-panel-admin/cities': 'ops',
  '/skovo-platform-panel-admin/course-catalogue': 'content',
  '/skovo-platform-panel-admin/import': 'ops',
  '/skovo-platform-panel-admin/domains': 'ops',
  '/skovo-platform-panel-admin/invites': 'ops',
  '/skovo-platform-panel-admin/audit': 'ops',
  '/skovo-platform-panel-admin/error-logs': 'ops',
  '/skovo-platform-panel-admin/analytics': 'ops',
  '/skovo-platform-panel-admin/support': 'ops',
  '/skovo-platform-panel-admin/team': 'founder-only',
  '/skovo-platform-panel-admin/stages': 'score',
  '/skovo-platform-panel-admin/streaks': 'score',
  '/skovo-platform-panel-admin/readiness': 'score',
  '/skovo-platform-panel-admin/leaderboard': 'score',
  '/skovo-platform-panel-admin/engagement': 'score',
  '/skovo-platform-panel-admin/wallet': 'finance',
  '/skovo-platform-panel-admin/community-safety': 'moderation',
  '/skovo-platform-panel-admin/platform-v1': 'content',
};
const ROLE_AREAS = {
  founder: ['users', 'finance', 'moderation', 'score', 'content', 'ops', 'founder-only'],
  product_ops: ['users', 'moderation', 'score', 'content', 'ops'],
  content_moderator: ['moderation', 'content'],
  finance: ['finance'],
};

// Readiness Score Playbook v2.1: once the new engine is on, the old score,
// streak, leaderboard and engagement screens leave the menu ("Readiness & SP"
// replaces them); until then the new screen is still reachable to set it up.
const RETIRED_BY_V21 = ['/skovo-platform-panel-admin/score-rules', '/skovo-platform-panel-admin/streaks',
  '/skovo-platform-panel-admin/leaderboard', '/skovo-platform-panel-admin/engagement'];
const V21_ONLY = [];

function useAdminV21() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    adminApi.get('/skovo-platform-panel-admin/v21/settings/readiness')
      .then(({ data }) => setOn(!!(data?.bool && data.response?.settings?.v21_enabled)))
      .catch(() => {});
  }, []);
  return on;
}

function gateNav(groups, adminRole) {
  const allowed = ROLE_AREAS[adminRole] || ROLE_AREAS.founder;   // fail open only for founder default
  return groups
    .map((g) => ({
      ...g,
      items: g.items.filter((it) => {
        if (it.end) return true;   // Dashboard is always visible
        const area = AREA_BY_PATH[it.to] || 'content';
        return allowed.includes(area);
      }),
    }))
    .filter((g) => g.items.length > 0);
}

const NAV_COLLEGE_GROUPS = [
  {
    label: 'Overview',
    items: [{ to: '/skovo-platform-panel-admin', label: 'Dashboard', icon: LayoutDashboard, end: true }],
  },
  {
    label: 'Management',
    items: [
      { to: '/skovo-platform-panel-admin/users',    label: 'Students', icon: Users },
      { to: '/skovo-platform-panel-admin/cohorts',  label: 'Cohorts',         icon: BookOpen },
      { to: '/skovo-platform-panel-admin/bookings', label: 'Bookings',        icon: CalendarCheck },
      { to: '/skovo-platform-panel-admin/payments', label: 'Payments',        icon: IndianRupee },
      { to: '/skovo-platform-panel-admin/tasks',    label: 'Tasks',           icon: CheckSquare },
      { to: '/skovo-platform-panel-admin/colleges', label: 'Colleges', icon: GraduationCap },
    ],
  },
  {
    label: 'Career Guidance',
    items: [
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-colleges',       label: 'CG Colleges',    icon: GraduationCap },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-entrance-exams', label: 'Entrance Exams', icon: BookOpen },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-scholarships',   label: 'Scholarships',   icon: Star },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-govt-exams',     label: 'Govt Exams',     icon: Shield },
      // v1-hidden: { to: '/skovo-platform-panel-admin/cg-abroad',         label: 'Abroad Studies', icon: Building2 },
    ],
  },
  {
    label: 'Settings',
    items: [
      { to: '/skovo-platform-panel-admin/readiness-rules', label: 'Readiness Rules', icon: Sliders },
      { to: '/skovo-platform-panel-admin/invites',         label: 'Invitations',     icon: MailOpen },
      { to: '/skovo-platform-panel-admin/support',         label: 'Support',         icon: LifeBuoy },
    ],
  },
];

const ADMIN_PAGE_TITLES = {
  '/skovo-platform-panel-admin':                 'Dashboard',
  '/skovo-platform-panel-admin/users':           'Students',
  '/skovo-platform-panel-admin/cohorts':         'Cohorts',
  '/skovo-platform-panel-admin/bookings':        'Bookings',
  '/skovo-platform-panel-admin/payments':        'Payments',
  '/skovo-platform-panel-admin/tasks':           'Tasks',
  '/skovo-platform-panel-admin/colleges':        'Colleges',
  '/skovo-platform-panel-admin/opportunities':   'Opportunities',
  '/skovo-platform-panel-admin/achievers':       'Achievers',
  '/skovo-platform-panel-admin/achiever-guidelines': 'Achiever guidelines',
  '/skovo-platform-panel-admin/achiever-review': 'Achiever Review',
  '/skovo-platform-panel-admin/domains':         'Domains',
  '/skovo-platform-panel-admin/masters':         'Masters',
  '/skovo-platform-panel-admin/cities':          'Cities',
  '/skovo-platform-panel-admin/course-catalogue': 'Courses & Trades',
  '/skovo-platform-panel-admin/import':          'Bulk Import',
  // v1-hidden: '/skovo-platform-panel-admin/coaching':        'Coaching',
  '/skovo-platform-panel-admin/readiness-rules': 'Readiness Rules',
  '/skovo-platform-panel-admin/invites':         'Invitations',
  '/skovo-platform-panel-admin/audit':           'Audit Log',
  '/skovo-platform-panel-admin/error-logs':     'Error Logs',
  '/skovo-platform-panel-admin/support':        'Support',
  '/skovo-platform-panel-admin/profile':         'My Profile',
  // v1-hidden: '/skovo-platform-panel-admin/cg-colleges':       'CG Colleges',
  // v1-hidden: '/skovo-platform-panel-admin/cg-entrance-exams': 'Entrance Exams',
  // v1-hidden: '/skovo-platform-panel-admin/cg-scholarships':   'Scholarships',
  // v1-hidden: '/skovo-platform-panel-admin/cg-govt-exams':     'Govt Exams',
  // v1-hidden: '/skovo-platform-panel-admin/cg-abroad':         'Abroad Studies',
  // v1-hidden: '/skovo-platform-panel-admin/cg-branches':       'CG Branches',
  // v1-hidden: '/skovo-platform-panel-admin/cg-rank-data':      'Rank Data',
  // v1-hidden: '/skovo-platform-panel-admin/cg-content':        'CG Content',
  // v1-hidden: '/skovo-platform-panel-admin/cg-ai-prompts':     'AI Prompts',
  // v1-hidden: '/skovo-platform-panel-admin/mock-tests':        'Mock Tests',
  // v1-hidden: '/skovo-platform-panel-admin/exam-resources':    'Study Materials',
  '/skovo-platform-panel-admin/analytics':         'Platform Analytics',
  '/skovo-platform-panel-admin/courses':         'Courses',
  '/skovo-platform-panel-admin/communities':       'Communities',
  '/skovo-platform-panel-admin/college-reviews':   'College Reviews',
  '/skovo-platform-panel-admin/referrals':         'Referrals',
  '/skovo-platform-panel-admin/coupons':           'Coupons',
  '/skovo-platform-panel-admin/subscriptions':     'Subscriptions',
  '/skovo-platform-panel-admin/market':            'Market',
  '/skovo-platform-panel-admin/score-rules':       'Score Engine',
  '/skovo-platform-panel-admin/moderation':        'Moderation',
  '/skovo-platform-panel-admin/community-safety':  'Community Safety',
  '/skovo-platform-panel-admin/engagement':        'Daily Engagement',
  '/skovo-platform-panel-admin/leaderboard':       'Leaderboard',
  '/skovo-platform-panel-admin/platform-v1':       'Platform Settings',
  '/skovo-platform-panel-admin/stages':            'Stages',
  '/skovo-platform-panel-admin/streaks':           'Career Streaks',
  '/skovo-platform-panel-admin/readiness':         'Readiness & SP',
  '/skovo-platform-panel-admin/wallet':            'Wallet & Refunds',
};

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

function Sidebar({ onClose }) {
  const user = (() => { try { return JSON.parse(localStorage.getItem('admin_user') || '{}'); } catch { return {}; } })();
  const college = isCollegeSubdomain();
  // Tokens minted before roles existed carry no admin_role — treat as founder,
  // matching the backend, so nobody is stranded mid-session.
  const adminRole = user.admin_role || 'founder';
  const v21 = useAdminV21();
  const groups = gateNav(college ? NAV_COLLEGE_GROUPS : NAV_FULL_GROUPS, adminRole)
    .map((g) => ({ ...g, items: g.items.filter((it) => !(v21 ? RETIRED_BY_V21 : V21_ONLY).includes(it.to)) }))
    .filter((g) => g.items.length > 0);

  return (
    <aside className="flex flex-col h-full text-white w-60" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
      {/* Logo */}
      <div className="px-5 py-5" style={{ borderBottom: '1px solid var(--sidebar-border)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl overflow-hidden shrink-0 shadow-lg">
            <img src="/skovo-logo-black.jpg" alt="Skovo" className="w-full h-full object-cover" />
          </div>
          <div>
            <p className="font-black text-sm tracking-tight">SKOVO</p>
            <p className="text-xs font-semibold" style={{ color: 'var(--accent-ring)' }}>
              {college ? 'College Admin' : 'Admin Panel'}
            </p>
          </div>
          {onClose && (
            <button onClick={onClose} className="ml-auto text-slate-500 hover:text-slate-300 p-1 rounded-lg transition-colors"
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--sidebar-hover)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 px-3 py-3 overflow-y-auto scrollbar-none space-y-1">
        {groups.map(({ label, items }) => (
          <div key={label} className="mb-1">
            <p className="px-3 text-[11px] font-bold uppercase tracking-widest mb-1 mt-2"
              style={{ color: 'var(--accent-ring)', opacity: 0.7 }}>
              {label}
            </p>
            {items.map(item => <NavItem key={item.to} {...item} onClose={onClose} />)}
          </div>
        ))}
      </nav>

    </aside>
  );
}

/* ── Header user-avatar dropdown ───────────────────────────── */
function UserMenu({ user }) {
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
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_access_token');
    navigate('/skovo-platform-panel-admin/login');
  }

  const initial = user?.full_name?.charAt(0)?.toUpperCase() || 'A';

  const panelBg      = dark ? '#1e293b' : '#ffffff';
  const panelBorder  = dark ? '1px solid rgba(51,65,85,0.8)' : '1px solid #e2e8f0';
  const dividerBg    = dark ? 'rgba(51,65,85,0.8)' : '#f1f5f9';
  const labelColor   = dark ? 'rgba(148,163,184,0.7)' : '#94a3b8';
  const nameColor    = dark ? '#f1f5f9' : '#1e293b';
  const profileColor = dark ? '#cbd5e1' : '#334155';
  const profileHover = dark ? 'rgba(255,255,255,0.07)' : '#f8fafc';
  const signOutHover = dark ? 'rgba(239,68,68,0.12)' : '#fef2f2';
  const signOutColor = dark ? '#f87171' : '#dc2626';

  return (
    <div className="relative" ref={ref}>
      {/* Avatar button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative w-8 h-8 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer hover:opacity-90 transition-opacity before:absolute before:-inset-2 before:content-['']"
        style={{ backgroundColor: 'var(--accent)' }}
        title={user?.full_name || 'Admin'}
      >
        {initial}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 'calc(100% + 8px)',
          width: 208, borderRadius: 16, zIndex: 50, overflow: 'hidden',
          backgroundColor: panelBg,
          border: panelBorder,
          boxShadow: dark ? '0 20px 60px rgba(0,0,0,0.5)' : '0 20px 60px rgba(0,0,0,0.15)',
        }}>
          {/* User info */}
          <div style={{ padding: '12px 16px', borderBottom: `1px solid ${dividerBg}` }}>
            <p style={{ fontSize: 11, color: labelColor, margin: '0 0 3px 0' }}>Signed in as</p>
            <p style={{ fontSize: 13, fontWeight: 700, color: nameColor, margin: '0 0 2px 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.full_name || 'Admin'}</p>
            <p style={{ fontSize: 11, color: labelColor, margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.email || user?.phone}</p>
          </div>

          {/* Actions */}
          <div style={{ padding: 6 }}>
            {/* My Profile */}
            <button
              onClick={() => { setOpen(false); navigate('/skovo-platform-panel-admin/profile'); }}
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

export default function AdminLayout() {
  useMobileCardTables();  // tables → cards on phones, portal-wide
  const [open, setOpen] = useState(false);
  const user = (() => { try { return JSON.parse(localStorage.getItem('admin_user') || '{}'); } catch { return {}; } })();
  const location = useLocation();
  const college = isCollegeSubdomain();

  // Approval is enforced here, not screen by screen. A pending or suspended
  // admin never renders the console at all — hiding it behind a banner would
  // be one CSS mistake away from leaking students and payments to someone who
  // has not been approved.
  const consoleState = useAdminConsole();
  const toast = useToast();

  // The user asked for a toast rather than a silently failing button: a retry
  // that changes nothing on screen reads as a dead control.
  async function retryConsole() {
    const ok = await consoleState.reload();
    if (!ok) toast.error("Still cannot reach your account. Sign in again.");
  }

  function leaveConsole() {
    localStorage.removeItem('admin_user');
    localStorage.removeItem('admin_access_token');
    window.location.href = '/skovo-platform-panel-admin/login';
  }

  // Blank while we find out. Rendering the console and then snatching it back
  // reads as a bug; a moment of nothing reads as loading.
  if (consoleState.loading) {
    return <div className="min-h-screen bg-slate-50" />;
  }

  // The status call did not answer -- expired token, backend down, network.
  // We do NOT know this admin is pending, so we must not say so. Saying it
  // anyway is what sent an approved admin off to ask a super-admin to
  // approve an account that was already active.
  if (consoleState.unknown) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <p className="text-lg font-bold text-slate-900">Could not load your account</p>
          <p className="text-sm text-slate-500 leading-relaxed">
            {consoleState.error || 'Your session may have expired.'} Sign in again to continue.
          </p>
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button type="button" onClick={retryConsole}
              className="min-h-11 px-5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700">
              Try again
            </button>
            <button type="button" onClick={leaveConsole}
              className="min-h-11 px-5 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}>
              Sign in again
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Pending or suspended: the console is not rendered at all.
  if (!consoleState.canOperate) {
    return (
      <AdminHoldingScreen
        state={consoleState.state}
        guidelines={consoleState.guidelines}
        reason={consoleState.reason}
        onSignOut={leaveConsole}
      />
    );
  }

  // Longest matching path wins: the Dashboard path is a prefix of every admin
  // page, so "first match" titled every screen "Dashboard".
  const pageTitle = Object.entries(ADMIN_PAGE_TITLES)
    .filter(([path]) => location.pathname === path || location.pathname.startsWith(path + '/'))
    .sort((a, b) => b[0].length - a[0].length)[0]?.[1] || (college ? 'College Admin' : 'Admin Panel');

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

      {/* Mobile drawer */}
      {open && (
        <>
          <div className="fixed inset-0 bg-black/60 z-40 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="fixed inset-y-0 left-0 z-50 flex flex-col shadow-2xl"><Sidebar onClose={() => setOpen(false)} /></div>
        </>
      )}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* ── Top Header ── */}
        <header className="flex items-center gap-3 px-4 bg-white border-b border-slate-200 shrink-0 shadow-sm" style={{ minHeight: 56 }}>
          <button type="button" aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen(!open)} className="lg:hidden relative text-slate-500 hover:text-slate-800 p-1.5 rounded-lg hover:bg-slate-100 transition-colors before:absolute before:-inset-2 before:content-['']">
            {open ? <X size={19} /> : <Menu size={19} />}
          </button>
          <div className="flex lg:hidden items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}>
              <Shield size={13} className="text-white" />
            </div>
            {/* "SKOVO Admin" wrapped onto two lines at 320px, which is what
                made a 56px bar look cramped. Keep it on one line and let the
                second word wait for the room to hold it. */}
            <span className="text-slate-900 font-bold text-sm whitespace-nowrap">
              SKOVO<span className="hidden min-[360px]:inline"> Admin</span>
            </span>
          </div>
          {/* Persistent chrome that repeats the page's own <h1>, so it stays
              visible and stays out of the heading outline. */}
          <div className="hidden lg:flex items-center gap-2" aria-hidden="true">
            <Shield size={15} style={{ color: 'var(--accent)' }} />
            <span className="text-sm font-semibold text-slate-900">{pageTitle}</span>
          </div>
          <div className="flex-1" />
          <ThemeDropdown dark={false} />
          {/* Avatar with dropdown — Profile + Sign Out */}
          <UserMenu user={user} />
        </header>

        <main id="main-content" tabIndex={-1} className="flex-1 overflow-y-auto"><PageTransition><Outlet /></PageTransition></main>
      </div>
    </div>
  );
}
