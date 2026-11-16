/**
 * Students — find a student, then open their page (AdminStudentDetail).
 *
 * Search, class, status, joined range and sort all run in MySQL
 * (sp_admin_students_page), so the list stays fast at any size. Filters live
 * in the URL: a filtered list can be bookmarked, shared or reloaded.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Users, Search, Flame, X, UserX, UserCheck, Eye, SlidersHorizontal, UserPlus, Activity, Ban } from 'lucide-react';
import StatTile from '../../components/admin/StatTile';
import { adminApi as api } from '../../services/api';
import {
  Th, Td, StatusBadge, ActionBtn, ConfirmModal, TableShell, LoadingRows, EmptyState, Pagination,
} from '../../components/ui/TableComponents';
import { DateRange, FormSelect, useToast } from '../../components/ui/index.jsx';
import StudentAvatar from '../../components/admin/StudentAvatar';
import { useMasters } from '../../hooks/useMasters';
import { ago } from '../../utils/datetime';

const BASE = '/skovo-platform-panel-admin';
const STATUSES = [{ value: '', label: 'All' }, { value: 'active', label: 'Active' }, { value: 'blocked', label: 'Blocked' }];
const SORTS = [
  { value: 'newest', label: 'Newest first' },
  { value: 'score', label: 'Highest score' },
  { value: 'streak', label: 'Longest streak' },
  { value: 'active', label: 'Recently active' },
  { value: 'name', label: 'Name A–Z' },
];

function UserCard({ u, onOpen, onToggleStatus }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <button type="button" onClick={() => onOpen(u)} className="w-full text-left">
        <div className="flex items-start gap-3">
          <StudentAvatar s={u} />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-slate-900 text-sm break-words">{u.full_name}</p>
            <p className="text-xs text-slate-400 break-all">{u.email || u.phone || '—'}</p>
          </div>
          <StatusBadge status={u.status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
          <span className="px-2 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">{u.class_label || 'No class yet'}</span>
          <span className="px-2 py-1 rounded-lg bg-violet-50 text-violet-700 font-semibold tabular-nums">Score {u.score}</span>
          {u.streak > 0 && (
            <span className="px-2 py-1 rounded-lg bg-orange-50 text-orange-700 font-semibold inline-flex items-center gap-1 tabular-nums">
              <Flame size={12} /> {u.streak}
            </span>
          )}
        </div>
        <p className="mt-2 text-[11px] text-slate-400">Active {ago(u.last_login_at)} · joined {ago(u.created_at)}</p>
      </button>
      <div className="pt-2 border-t border-slate-100 flex gap-2">
        <button onClick={() => onOpen(u)}
                className="flex-1 min-h-11 text-xs font-semibold px-3 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50">
          Open
        </button>
        <button onClick={() => onToggleStatus(u)}
                className={`flex-1 min-h-11 text-xs font-semibold px-3 rounded-xl border ${
                  u.status === 'active' ? 'border-red-500/30 text-red-500 hover:bg-red-500/10'
                                        : 'border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10'}`}>
          {u.status === 'active' ? 'Block' : 'Unblock'}
        </button>
      </div>
    </div>
  );
}

export default function AdminUsers() {
  const toast = useToast();
  const navigate = useNavigate();
  const [sp, setSp] = useSearchParams();
  const f = {
    q: sp.get('q') || '', klass: sp.get('class') || '', status: sp.get('status') || '',
    sort: sp.get('sort') || 'newest', from: sp.get('from') || '', to: sp.get('to') || '',
  };
  const { lists } = useMasters(['stage_group']);
  const classOpts = [
    { value: '', label: 'All classes' },
    ...(lists.stage_group || []).map((o) => ({ value: o.value, label: o.label })),
    { value: '__none', label: 'No class yet' },
  ];

  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [tick, setTick] = useState(0);              // bump to reload after a change
  const [res, setRes] = useState({ key: null, users: [], pages: 1, total: 0 });
  const [query, setQuery] = useState(f.q);
  const [showFilters, setShowFilters] = useState(false);   // phones only; always open from sm
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [stats, setStats] = useState(null);
  useEffect(() => {
    let alive = true;
    api.get(`${BASE}/users/stats`).then(({ data }) => { if (alive && data?.bool) setStats(data.response); }).catch(() => {});
    return () => { alive = false; };
  }, [tick]);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const weekAgo = (() => { const d = new Date(); d.setDate(d.getDate() - 6); return iso(d); })();
  const debounceRef = useRef(null);

  // One place that changes filters: drops the page so a narrower list starts at 1.
  const setFilter = useCallback((patch) => {
    setSp((prev) => {
      const n = new URLSearchParams(prev);
      Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k)));
      n.delete('page');
      return n;
    }, { replace: true });
    setPage(1);
  }, [setSp]);

  // The list for these filters + page; `loading` is simply "not this one yet".
  const reqKey = `${f.q}|${f.klass}|${f.status}|${f.sort}|${f.from}|${f.to}|${page}|${perPage}|${tick}`;
  const loading = res.key !== reqKey;
  const { users, pages, total } = res;
  useEffect(() => {
    let alive = true;
    const params = { page, per_page: perPage, sort: f.sort };
    if (f.q) params.search = f.q;
    if (f.klass) params.class = f.klass;
    if (f.status) params.status = f.status;
    if (f.from && f.to) { params.from = f.from; params.to = f.to; }
    api.get(`${BASE}/users`, params)
      .then(({ data }) => {
        if (!alive) return;
        setRes(data?.bool
          ? { key: reqKey, users: data.response.users || [], pages: data.pagination?.pages || 1, total: data.pagination?.total || 0 }
          : (r) => ({ ...r, key: reqKey }));
      })
      .catch(() => { if (alive) { setRes((r) => ({ ...r, key: reqKey })); toast.error('Could not load students.'); } });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqKey]);

  // Typing searches after a short pause; Enter searches at once.
  useEffect(() => {
    if (query === f.q) return undefined;
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setFilter({ q: query.trim() }), 400);
    return () => clearTimeout(debounceRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const open = (u) => navigate(`${BASE}/users/${u.id}`);

  const toggleStatus = (u) => {
    const next = u.status === 'active' ? 'blocked' : 'active';
    const isBlock = next === 'blocked';
    setConfirmDlg({
      message: `${isBlock ? 'Block' : 'Unblock'} "${u.full_name}"?`,
      detail: isBlock ? 'They will be signed out and cannot use Skovo until unblocked.' : 'They can sign in and use Skovo again.',
      confirmLabel: isBlock ? 'Block' : 'Unblock',
      danger: isBlock,
      onConfirm: async () => {
        try {
          const { data } = await api.patch(`${BASE}/users/${u.id}/status`, { status: next });
          if (data?.bool) { toast.success(isBlock ? 'Student blocked' : 'Student unblocked'); setTick((t) => t + 1); }
          else toast.error(data?.response?.message || 'Could not change status.');
        } catch { toast.error('Could not change status.'); }
      },
    });
  };

  const activeCount = [f.klass, f.status, f.from, f.sort !== 'newest'].filter(Boolean).length;
  const filtered = Boolean(f.q || activeCount);
  const clearAll = () => { setQuery(''); setSp({}, { replace: true }); setPage(1); };
  const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—');
  const pager = (
    <Pagination page={page} pages={pages} total={total} perPage={perPage}
                onPage={setPage} onPerPage={(pp) => { setPerPage(pp); setPage(1); }} />
  );

  return (
    <div className="p-4 sm:p-6">
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
                      confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
                      onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
                      onCancel={() => setConfirmDlg(null)} />
      )}

      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Students</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          <span className="font-semibold text-slate-700">{total}</span> {total === 1 ? 'student' : 'students'}
          {filtered ? ' match' : ''} · tap one to see everything about them
        </p>
      </div>

      {/* Each tile is also a shortcut to that slice of the list. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="Students" sub="all time" value={stats?.total} icon={Users} tone="blue" to={`${BASE}/users`} />
        <StatTile label="New" sub="last 7 days" value={stats?.new_week} icon={UserPlus} tone="violet"
                  to={`${BASE}/users?from=${weekAgo}&to=${iso(new Date())}`} />
        <StatTile label="Active" sub="last 7 days" value={stats?.active_week} icon={Activity} tone="emerald" to={`${BASE}/users?sort=active`} />
        <StatTile label="Blocked" sub="right now" value={stats?.blocked} icon={Ban} tone="amber" to={`${BASE}/users?status=blocked`} />
      </div>

      {/* Search always; the other filters fold behind a button on a phone. */}
      <div className="bg-white border border-slate-200 rounded-2xl p-3 mb-4 flex flex-col gap-3">
        <div className="flex gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} type="search"
                 onKeyDown={(e) => { if (e.key === 'Enter') { clearTimeout(debounceRef.current); setFilter({ q: query.trim() }); } }}
                 placeholder="Name, email or phone" aria-label="Search students"
                 className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
        </div>
        <button type="button" onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}
                aria-label="Filters" className="sm:hidden relative min-h-11 min-w-11 rounded-xl border border-slate-200 text-slate-600 flex items-center justify-center">
          <SlidersHorizontal size={17} />
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1 rounded-full bg-violet-600 text-white text-[11px] font-bold flex items-center justify-center">{activeCount}</span>
          )}
        </button>
        </div>
        <div className={`${showFilters ? 'grid' : 'hidden'} sm:grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2`}>
          <FormSelect value={f.klass} onChange={(v) => setFilter({ class: v })} options={classOpts}
                      placeholder="All classes" aria-label="Class" clearable={false} />
          <FormSelect value={f.sort} onChange={(v) => setFilter({ sort: v === 'newest' ? '' : v })} options={SORTS}
                      clearable={false} searchable={false} aria-label="Sort" />
          <DateRange value={{ from: f.from, to: f.to }} anyLabel="Joined any time" align="left"
                     onChange={(r) => setFilter({ from: r.from, to: r.to })} />
          <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100" role="group" aria-label="Status">
            {STATUSES.map((s) => (
              <button key={s.value || 'all'} type="button" onClick={() => setFilter({ status: s.value })}
                      aria-pressed={f.status === s.value}
                      className={`min-h-9 rounded-lg text-xs font-semibold ${f.status === s.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {s.label}
              </button>
            ))}
          </div>
        </div>
        {filtered && (
          <button type="button" onClick={clearAll}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 min-h-9">
            <X size={13} /> Clear filters
          </button>
        )}
      </div>

      {/* Phones: cards, two across from md */}
      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse bg-white rounded-2xl border border-slate-100" />
          ))
        ) : users.length === 0 ? (
          <div className="md:col-span-2 bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-16 px-4 text-center">
            <Users size={32} className="text-slate-300 mb-3" />
            <p className="font-semibold text-slate-600">No students found</p>
            <p className="text-sm text-slate-400 mt-1">{filtered ? 'Try fewer filters.' : 'Students appear here once they sign up.'}</p>
          </div>
        ) : users.map((u) => <UserCard key={u.id} u={u} onOpen={open} onToggleStatus={toggleStatus} />)}
        {!loading && total > 0 && <div className="md:col-span-2">{pager}</div>}
      </div>

      {/* Desktop: table */}
      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>#</Th><Th>Student</Th><Th>Class</Th><Th>Score</Th><Th>Streak</Th>
                  <Th>Last active</Th><Th>Joined</Th><Th>Status</Th><Th>Actions</Th>
                </tr>
              </thead>
              {loading ? (
                <LoadingRows cols={9} rows={6} />
              ) : users.length === 0 ? (
                <tbody><tr><td colSpan={9}>
                  <EmptyState icon={Users} message="No students found" sub={filtered ? 'Try fewer filters.' : ''} />
                </td></tr></tbody>
              ) : (
                <tbody className="divide-y divide-slate-100">
                  {users.map((u, i) => (
                    <tr key={u.id} onClick={() => open(u)} className="hover:bg-slate-50/70 cursor-pointer">
                      <Td className="text-slate-500 tabular-nums">{(page - 1) * perPage + i + 1}</Td>
                      <Td>
                        <div className="flex items-center gap-2.5 min-w-0">
                          <StudentAvatar s={u} size="w-8 h-8 text-xs" />
                          <div className="min-w-0">
                            <p className="font-semibold text-slate-900 truncate max-w-56">{u.full_name}</p>
                            <p className="text-xs text-slate-400 truncate max-w-56">{u.email || u.phone || '—'}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="whitespace-nowrap">{u.class_label || <span className="text-slate-400">—</span>}</Td>
                      <Td className="font-semibold text-violet-700 tabular-nums">{u.score}</Td>
                      <Td className="tabular-nums">{u.streak > 0 ? <span className="text-orange-600">🔥 {u.streak}</span> : '—'}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{ago(u.last_login_at)}</Td>
                      <Td className="whitespace-nowrap text-slate-600">{day(u.created_at)}</Td>
                      <Td><StatusBadge status={u.status} /></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="Open" color="indigo" onClick={() => open(u)} />
                          <ActionBtn icon={u.status === 'active' ? UserX : UserCheck}
                                     tooltip={u.status === 'active' ? 'Block' : 'Unblock'}
                                     color={u.status === 'active' ? 'red' : 'green'} onClick={() => toggleStatus(u)} />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {pager}
        </TableShell>
      </div>
    </div>
  );
}
