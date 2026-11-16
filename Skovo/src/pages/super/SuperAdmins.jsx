import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Users, Search, Check, X, Eye, Mail, Calendar, Shield } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, StatusBadge, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function AdminDetailModal({ admin, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Admin Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black shadow-sm" style={{ backgroundColor: 'var(--accent)' }}>
              {admin.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-lg font-black text-slate-900">{admin.full_name}</p>
              {/* `state` is the access gate. `status` is a legacy column that reads
                  'active' from the moment the row is inserted, so badging it showed
                  a pending admin as approved. */}
              <StatusBadge status={admin.state || 'pending'} />
            </div>
          </div>
          <div className="grid gap-3">
            {[
              { icon: Mail, label: 'Email', value: admin.email },
              { icon: Shield, label: 'Role', value: 'Admin' },
              { icon: Calendar, label: 'Registered', value: admin.created_at ? new Date(admin.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-center gap-3 bg-slate-50 rounded-xl px-4 py-3">
                <Icon size={15} className="text-slate-400 shrink-0" />
                <div>
                  <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{label}</p>
                  <p className="text-sm font-semibold text-slate-800">{value || '—'}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          {/* No block/unblock here. Access is decided in Admin Access, which
              drives the pending/active/suspended state machine and records a
              reason and an audit event. Two ways to change access meant two
              answers to "can this person log in". */}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperAdmins() {
  const navigate = useNavigate();
  const [admins, setAdmins]         = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]               = useState(null);
  const [selectedAdmin, setSelectedAdmin] = useState(null);
  const [confirmDlg, setConfirmDlg]       = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q) params.search = q;
    superApi.get('/skovo-platform-owner/admins', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setAdmins(data.response.admins); setPagination(data.pagination); }
      })
      .catch(() => showToast('Could not load admin accounts.', false))
      .finally(() => setLoading(false));
  }, [search, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search); };


  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {selectedAdmin && (
        <AdminDetailModal admin={selectedAdmin} onClose={() => setSelectedAdmin(null)}
        />
      )}

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Admin Accounts</h1>
        <p className="text-sm text-slate-500 mt-1">{pagination.total} admin accounts on the platform</p>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or email…"
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
                  <Th>S.No</Th><Th>Admin</Th><Th>Email</Th><Th>Status</Th><Th>Registered</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={6} rows={6} />
            </table>
          </div>
        ) : admins.length === 0 ? (
          <EmptyState icon={Users} message={search ? 'No results found' : 'No admin accounts yet'} sub="Admins register at /skovo-platform-panel-admin/register" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Admin</Th>
                  <Th>Email</Th>
                  <Th>Status</Th>
                  <Th>Registered</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {admins.map((admin, idx) => (
                  <tr key={admin.id}
                        onClick={() => setSelectedAdmin(admin)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={admin.full_name} size="md" />
                        <p className="font-semibold text-slate-900">{admin.full_name}</p>
                      </div>
                    </Td>
                    <Td><span className="text-slate-500 text-xs">{admin.email}</span></Td>
                    {/* `state` — the access gate. Reading `status` here showed "Active"
                        for an admin nobody had approved. */}
                    <Td><StatusBadge status={admin.state || 'pending'} /></Td>
                    <Td>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {admin.created_at ? new Date(admin.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                      </span>
                    </Td>
                    {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View admin details" color="indigo" onClick={() => setSelectedAdmin(admin)} />
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
