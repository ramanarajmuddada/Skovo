import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Users, Search, Check, X, Ban, ShieldCheck, Eye, Mail, Phone, Calendar, Shield, User, MapPin, GraduationCap, Building2, BookOpen, Heart } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, StatusBadge, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import AvatarImg from '../../components/ui/AvatarImg';

const ROLE_BADGE = {
  student: 'bg-blue-50 text-blue-700 border border-blue-200',
  mentor:  'bg-violet-50 text-violet-700 border border-violet-200',
  admin:   'bg-amber-50 text-amber-700 border border-amber-200',
};

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function UserDetailModal({ user, onClose, onToggle }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-base font-bold text-slate-900">User Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Body — scrolls inside the modal so it never overflows small screens */}
        <div className="px-6 py-5 space-y-5 flex-1 overflow-y-auto">
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            {user.avatar_url ? (
              <AvatarImg src={user.avatar_url} alt={user.full_name} className="w-14 h-14 rounded-2xl object-cover shadow-sm shrink-0" />
            ) : (
              <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black shadow-sm shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
                {user.full_name?.charAt(0)?.toUpperCase() || '?'}
              </div>
            )}
            <div>
              <p className="text-lg font-black text-slate-900">{user.full_name}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <StatusBadge status={user.status || 'active'} />
                {user.role_code && (
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${ROLE_BADGE[user.role_code] || ROLE_BADGE.student}`}>
                    {user.role_code.charAt(0).toUpperCase() + user.role_code.slice(1)}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Info grid */}
          <div className="grid gap-3">
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              <Mail size={15} className="text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Email</p>
                <p className="text-sm font-semibold text-slate-800">{user.email || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              <Phone size={15} className="text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Phone</p>
                <p className="text-sm font-semibold text-slate-800">{user.phone || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              <Shield size={15} className="text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Role</p>
                <p className="text-sm font-semibold text-slate-800 capitalize">{user.role_code || '—'}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
              <Calendar size={15} className="text-slate-400 shrink-0" />
              <div>
                <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">Joined</p>
                <p className="text-sm font-semibold text-slate-800">
                  {user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—'}
                </p>
              </div>
            </div>
            {[
              { icon: MapPin,        label: 'Location',  value: [user.city, user.state].filter(Boolean).join(', ') },
              { icon: GraduationCap, label: 'Education', value: user.education_level },
              { icon: BookOpen,      label: 'Branch',    value: user.branch || user.stream },
              { icon: Building2,     label: 'College',   value: user.college_name },
              { icon: Calendar,      label: 'Year',      value: user.year_of_study },
              { icon: Heart,         label: 'Interests', value: Array.isArray(user.career_interests) ? user.career_interests.filter(Boolean).join(', ') : user.career_interests },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                <Icon size={15} className="text-slate-400 shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
                  <p className="text-sm font-semibold text-slate-800 break-words">{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3 shrink-0">
          <button
            onClick={() => { onToggle(user); onClose(); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${
              user.status === 'active'
                ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200'
                : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'
            }`}>
            {user.status === 'active' ? <Ban size={15} /> : <ShieldCheck size={15} />}
            {user.status === 'active' ? 'Block User' : 'Unblock User'}
          </button>
          <button onClick={onClose}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

export default function SuperUsers() {
  const navigate = useNavigate();
  const [users, setUsers]               = useState([]);
  const [pagination, setPagination]     = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]           = useState(20);
  const [search, setSearch]             = useState('');
  const [loading, setLoading]           = useState(true);
  const [toast, setToast]               = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [confirmDlg, setConfirmDlg]     = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q) params.search = q;
    superApi.get('/skovo-platform-owner/users', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setUsers(data.response.users); setPagination(data.pagination); }
      })
      .catch(() => showToast('Failed to load users', false))
      .finally(() => setLoading(false));
  }, [search, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search); };

  const toggleStatus = (user) => {
    const newStatus = user.status === 'active' ? 'blocked' : 'active';
    const isBlock   = newStatus === 'blocked';
    setConfirmDlg({
      message: `${isBlock ? 'Block' : 'Unblock'} "${user.full_name}"?`,
      detail: isBlock ? 'This user will lose access to the platform.' : 'This user will regain access to the platform.',
      confirmLabel: isBlock ? 'Block' : 'Unblock',
      danger: isBlock,
      onConfirm: async () => {
        try {
          const { data } = await superApi.patch(`/skovo-platform-owner/users/${user.id}`, { status: newStatus });
          if (data.bool) {
            showToast(`User ${newStatus}`);
            setUsers(prev => prev.map(u => u.id === user.id ? { ...u, status: newStatus } : u));
          } else showToast('Failed', false);
        } catch { showToast('Error', false); }
      },
    });
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message}
          detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel}
          danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      {selectedUser && (
        <UserDetailModal
          user={selectedUser}
          onClose={() => setSelectedUser(null)}
          onToggle={(u) => { setSelectedUser(null); toggleStatus(u); }}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">All Users</h1>
        <p className="text-sm text-slate-500 mt-1">{pagination.total} students on the platform</p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name, email or phone…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700">Search</button>
      </form>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th><Th>User</Th><Th>Email</Th><Th>Phone</Th><Th>Role</Th><Th>Status</Th><Th>Joined</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={8} />
            </table>
          </div>
        ) : users.length === 0 ? (
          <EmptyState icon={Users} message={search ? 'No results found' : 'No users yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>User</Th>
                  <Th>Email</Th>
                  <Th>Phone</Th>
                  <Th>Role</Th>
                  <Th>Status</Th>
                  <Th>Joined</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {users.map((user, idx) => (
                  <tr key={user.id}
                        onClick={() => setSelectedUser(user)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={user.full_name} size="md" />
                        <p className="font-semibold text-slate-900">{user.full_name}</p>
                      </div>
                    </Td>
                    <Td><span className="text-slate-500 text-xs">{user.email}</span></Td>
                    <Td><span className="text-slate-500 text-xs">{user.phone || '--'}</span></Td>
                    <Td>
                      {user.role_code ? (
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${ROLE_BADGE[user.role_code] || ROLE_BADGE.student}`}>
                          {user.role_code.charAt(0).toUpperCase() + user.role_code.slice(1)}
                        </span>
                      ) : <span className="text-xs text-slate-400">--</span>}
                    </Td>
                    <Td><StatusBadge status={user.status || 'active'} /></Td>
                    <Td>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {user.created_at ? new Date(user.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                      </span>
                    </Td>
                    {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelectedUser(user)} />
                        <ActionBtn
                          icon={user.status === 'active' ? Ban : ShieldCheck}
                          tooltip={user.status === 'active' ? 'Block user' : 'Unblock user'}
                          onClick={() => toggleStatus(user)}
                          color={user.status === 'active' ? 'red' : 'green'}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          perPage={perPage}
          onPage={p => load(p)}
          onPerPage={pp => { setPerPage(pp); load(1, search, pp); }}
        />
      </TableShell>
    </div>
  );
}
