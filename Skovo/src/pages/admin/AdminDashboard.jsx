import React, { useEffect, useState } from 'react';
import { adminApi as api } from '../../services/api';
import { Link } from 'react-router-dom';
import { Users, BookOpen, GraduationCap, Briefcase, Shield, UserCheck, Eye, X, Mail, Phone, Calendar, ClipboardCheck, CalendarCheck, IndianRupee } from 'lucide-react';
import { ActionBtn, Pagination } from '../../components/ui/TableComponents';
import { WorkQueue, TodayStrip, HealthPanel, ScopeTag } from '../../components/admin/AdminWorkQueue';
import StatTile from '../../components/admin/StatTile';
import { DateRange, RANGE_PRESETS, SectionTitle } from '../../components/ui';

function isCollegeSubdomain() {
  const host = window.location.hostname;
  const parts = host.split('.');
  if (host === 'localhost' || host === '127.0.0.1') return false;
  if (parts.length === 2 && parts[1] === 'localhost') return parts[0] !== 'demo';
  if (parts.length >= 3) return parts[0] !== 'demo' && parts[0] !== 'www';
  return false;
}

// Same-length window ending the day before `range` starts (dates are YYYY-MM-DD, local).
const spanDays = (r) => Math.round((new Date(r.to) - new Date(r.from)) / 86400000) + 1;
function shiftBack(r) {
  const n = spanDays(r);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const to = new Date(`${r.from}T00:00:00`); to.setDate(to.getDate() - 1);
  const from = new Date(to); from.setDate(from.getDate() - (n - 1));
  return { from: iso(from), to: iso(to) };
}

const ROLE_COLOR = {
  admin:   'bg-red-100 text-red-700',
  mentor:  'bg-purple-100 text-purple-700',
  student: 'bg-blue-100 text-blue-700',
};
const ROLE_ICON = { admin: Shield, mentor: UserCheck, student: GraduationCap };

function UserDetailModal({ user: u, onClose }) {
  if (!u) return null;
  const RIcon = ROLE_ICON[u.role_code] || ROLE_ICON.student;
  const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  const rows = [
    { icon: Mail,     label: 'Email',   value: u.email || '—' },
    { icon: Phone,    label: 'Phone',   value: u.phone || '—' },
    { icon: Calendar, label: 'Joined',  value: fmt(u.created_at) },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">User Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center font-black text-xl shrink-0">
              {u.full_name?.charAt(0)?.toUpperCase() || 'U'}
            </div>
            <div>
              <p className="text-lg font-black text-slate-900 leading-tight">{u.full_name}</p>
              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full mt-1 ${ROLE_COLOR[u.role_code] || ROLE_COLOR.student}`}>
                <RIcon size={11} /> {u.role_code || 'student'}
              </span>
            </div>
          </div>
          <div className="space-y-2">
            {rows.map(({ icon: Icon, label, value }) => (
              // Label above, value below, value wrapping.
              //
              // These were one row: icon + a fixed 64px label + the value with
              // `truncate`. On a 320px screen that left the value about 150px
              // and it rendered "sarakampavan32..." and "26 Sept 2026, 9:5...".
              // An email and a timestamp are the two things you open this panel
              // to read, and both were cut. Stacking gives the value the panel's
              // full width; break-all keeps a long address inside the card.
              <div key={label} className="py-2 border-b border-slate-50">
                <div className="flex items-center gap-2">
                  <Icon size={13} className="text-slate-400 shrink-0" />
                  <span className="text-[11px] uppercase tracking-wide text-slate-400 font-medium">{label}</span>
                </div>
                <p className="mt-0.5 pl-[21px] text-sm font-semibold text-slate-800 break-all">{value}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

/* Mobile card for a single recent signup */
function UserMobileCard({ u, onView }) {
  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) :  '—';
  const RIcon = ROLE_ICON[u.role_code] || ROLE_ICON.student;
  return (
    // Email on its own line, at the card's full width.
    //
    // It shared a row with the avatar, the role badge and the view button, which
    // left it about 140px on a 320px screen -- "sarakampavan328@gmail.com" needs
    // ~150px and rendered as "sarakampavan32...". An address you cannot read is
    // the one field on this card you might actually need to copy.
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
          {u.full_name?.charAt(0)?.toUpperCase() || 'U'}
        </div>
        <p className="flex-1 min-w-0 font-semibold text-slate-900 text-sm break-words">{u.full_name}</p>
        <span className={`flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${ROLE_COLOR[u.role_code] || ROLE_COLOR.student}`}>
          <RIcon size={11} /> {u.role_code || 'student'}
        </span>
      </div>
      <p className="mt-2 text-xs text-slate-400 break-all">{u.email || u.phone || '—'}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className="text-[11px] text-slate-400">{fmt(u.created_at)}</p>
        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => onView(u)} />
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const [stats, setStats] = useState(null);
  // The work queues, today's activity and health, from one call. Kept separate
  // from the existing /stats fetch so a failure in either still renders the
  // other — a dashboard that goes entirely blank because one endpoint was slow
  // is worse than a dashboard missing a section.
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState(null);
  // Scopes the activity strip only. Opens on today — "what needs you today" —
  // and the queues, health and totals stay live whatever range is picked.
  const [range, setRange] = useState(() => {
    const t = RANGE_PRESETS[0];
    return { from: t.from(), to: t.to() };
  });
  const preset = RANGE_PRESETS.find((p) => p.from() === range.from && p.to() === range.to);

  useEffect(() => {
    let live = true;
    api.get('/skovo-platform-panel-admin/dashboard-summary', { from: range.from, to: range.to })
      .then(({ data }) => { if (live && data?.bool) setSummary(data.response); })
      .catch(() => {});
    return () => { live = false; };
  }, [range.from, range.to]);

  // The same-length period just before, so each "Today" tile can say whether
  // things went up or down. Only its `today` block is used.
  const prevRange = shiftBack(range);
  const [prev, setPrev] = useState(null);
  useEffect(() => {
    let live = true;
    api.get('/skovo-platform-panel-admin/dashboard-summary', prevRange)
      .then(({ data }) => { if (live && data?.bool) setPrev({ key: `${prevRange.from}|${prevRange.to}`, today: data.response.today }); })
      .catch(() => {});
    return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prevRange.from, prevRange.to]);
  const prevToday = prev?.key === `${prevRange.from}|${prevRange.to}` ? prev.today : null;
  const vsLabel = preset?.label === 'Today' ? 'yesterday' : `previous ${spanDays(range)} days`;
  const admin = (() => { try { return JSON.parse(localStorage.getItem('admin_user') || '{}'); } catch { return {}; } })();
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  // Recent signups follow the same date filter, one page at a time.
  const [signups, setSignups] = useState({ items: [], total: 0, pages: 1 });
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  // A new range or page size starts again at page 1 — page 4 of the old
  // range may not exist in the new one.
  useEffect(() => { setPage(1); }, [range.from, range.to, perPage]);

  useEffect(() => {
    let live = true;
    api.get('/skovo-platform-panel-admin/recent-signups',
            { from: range.from, to: range.to, page, per_page: perPage })
      .then(({ data }) => { if (live && data?.bool) setSignups(data.response); })
      .catch(() => {});
    return () => { live = false; };
  }, [range.from, range.to, page, perPage]);

  useEffect(() => {
    api.get('/skovo-platform-panel-admin/stats')
      .then(({ data }) => { if (data.bool) setStats(data.response); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return (
    <div className="p-4 sm:p-6 space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-slate-200 p-5 h-24 animate-pulse" />
        ))}
      </div>
    </div>
  );

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <UserDetailModal user={selectedUser} onClose={() => setSelectedUser(null)} />
      {/* Greeting + the four places an admin goes most, one tap away. */}
      <div className="rounded-3xl border border-slate-200 bg-white p-5 sm:p-6 relative">
        {/* The glow is clipped in its own layer: clipping the card itself cut
            off the date-range menu that opens below the picker. */}
        <div className="absolute inset-0 rounded-3xl overflow-hidden pointer-events-none" aria-hidden="true">
          <div className="absolute -top-16 -right-16 w-56 h-56 rounded-full opacity-20 blur-3xl"
               style={{ background: 'var(--accent)' }} />
        </div>
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs font-semibold text-slate-400">
              {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            <h1 className="text-2xl sm:text-3xl font-black text-slate-900 mt-1 break-words">
              {hello}{admin.full_name ? `, ${admin.full_name.split(' ')[0]}` : ''} 👋
            </h1>
            <p className="text-sm text-slate-500 mt-1">
              {summary?.needs_attention ? `${summary.needs_attention} thing${summary.needs_attention === 1 ? '' : 's'} need you today.` : 'Nothing is waiting on you right now.'}
            </p>
          </div>
          <div className="w-full md:w-56 shrink-0">
            <DateRange value={range} onChange={setRange} />
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[
            { to: '/skovo-platform-panel-admin/achiever-review', label: 'Reviews', Icon: ClipboardCheck },
            { to: '/skovo-platform-panel-admin/bookings', label: 'Bookings', Icon: CalendarCheck },
            { to: '/skovo-platform-panel-admin/payments', label: 'Payments', Icon: IndianRupee },
            { to: '/skovo-platform-panel-admin/users', label: 'Students', Icon: Users },
          ].map((q) => {
            const QIcon = q.Icon;
            return (
              <Link key={q.to} to={q.to}
                    className="min-h-11 rounded-xl border border-slate-200 px-3 flex items-center gap-2 text-sm font-semibold text-slate-700 hover:border-slate-300 hover:bg-slate-50">
                <QIcon size={16} className="text-slate-400 shrink-0" /> <span className="truncate">{q.label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Queues first. An admin opening the console is asking what to do now,
          not how the business is doing — that is the super-admin's screen. */}
      {summary && (
        <>
          <WorkQueue queues={summary.queues} total={summary.needs_attention} />
          <TodayStrip today={summary.today} prev={prevToday} vs={vsLabel} title={preset ? preset.label : 'Selected period'} />
          <HealthPanel health={summary.health} totals={summary.totals}
                       period={preset ? preset.label : 'Selected period'} />
        </>
      )}

      {/* Stats — all-time totals; the date filter does not touch them. */}
      <div>
      <SectionTitle action={<ScopeTag>All time</ScopeTag>}>Totals</SectionTitle>
      {isCollegeSubdomain() ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <StatTile label="Total Students" value={stats?.totals?.users}   icon={Users}        tone="blue" to="/skovo-platform-panel-admin/users" />
          <StatTile label="Cohorts"        value={stats?.totals?.cohorts} icon={BookOpen}     tone="violet" to="/skovo-platform-panel-admin/cohorts" />
          <StatTile label="College"        value={stats?.totals?.colleges ? 'Active' : 'Not set'} icon={GraduationCap} tone="emerald" />
        </div>
      ) : (
        // v1-hidden: Coaching Centres. The route it pointed at is already
        // commented out in App.jsx for v1, so the tile reported a count for a
        // section nobody can open — and it was the odd fifth card that left a
        // lone tile on its own row in the two-column mobile grid.
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatTile label="Students"       value={stats?.totals?.users}         icon={Users}         tone="blue"    to="/skovo-platform-panel-admin/users" />
          <StatTile label="Cohorts"        value={stats?.totals?.cohorts}       icon={BookOpen}      tone="violet"  to="/skovo-platform-panel-admin/cohorts" />
          <StatTile label="Colleges"       value={stats?.totals?.colleges}      icon={GraduationCap} tone="emerald" to="/skovo-platform-panel-admin/colleges" />
          <StatTile label="Opportunities"  value={stats?.totals?.opportunities} icon={Briefcase}     tone="amber"   to="/skovo-platform-panel-admin/opportunities" />
        </div>
      )}
      </div>

      {/* Recent Signups */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-bold text-slate-900">Recent Signups</h2>
          {signups.total > 0 && (
            <span className="text-xs text-slate-400">{signups.total} in this period</span>
          )}
        </div>

        {!signups.items.length ? (
          <div className="bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-16">
            <Users size={36} className="text-slate-300 mb-3" />
            <p className="text-slate-400 font-semibold text-sm">No signups in this period</p>
            <p className="text-xs text-slate-400 mt-1">Pick a wider date range above.</p>
          </div>
        ) : (
          <>
            {/* Mobile cards */}
            <div className="lg:hidden space-y-3">
              {signups.items.map((u) => (
                <UserMobileCard key={u.id} u={u} onView={setSelectedUser} />
              ))}
            </div>

            {/* Desktop table */}
            <div className="hidden lg:block bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-100">
                    <tr>
                      {['Student', 'Role', 'Joined'].map((h) => (
                        <th key={h} className="text-left px-6 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                    {signups.items.map((u) => {
                      const RIcon = ROLE_ICON[u.role_code] || ROLE_ICON.student;
                      return (
                        <tr key={u.id} onClick={() => setSelectedUser(u)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                          <td className="px-6 py-3">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                                {u.full_name?.charAt(0)?.toUpperCase() || 'U'}
                              </div>
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-slate-900 truncate">{u.full_name}</p>
                                <p className="text-xs text-slate-400 truncate">{u.email || u.phone || '—'}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-6 py-3.5">
                            <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full ${ROLE_COLOR[u.role_code] || ROLE_COLOR.student}`}>
                              <RIcon size={11} /> {u.role_code || 'student'}
                            </span>
                          </td>
                          <td className="px-6 py-3.5 text-slate-900 text-sm whitespace-nowrap">
                            {u.created_at ? new Date(u.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 bg-white rounded-2xl border border-slate-200 overflow-hidden">
              <Pagination page={page} pages={signups.pages} total={signups.total} perPage={perPage}
                          onPage={setPage} onPerPage={setPerPage} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
