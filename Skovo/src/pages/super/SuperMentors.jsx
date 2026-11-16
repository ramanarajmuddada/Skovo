import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { UserCheck, Search, Check, X, ExternalLink, Eye, Ban, ShieldCheck, Mail, Calendar, Briefcase, Link } from 'lucide-react';
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

function MentorDetailModal({ mentor, onClose, onToggle }) {
  const rows = [
    { label: 'Email', value: mentor.email },
    { label: 'Designation', value: mentor.designation },
    { label: 'Company', value: mentor.company },
    { label: 'Domains', value: mentor.domains?.join(', ') || '—' },
    { label: 'State', value: mentor.state ? <StatusBadge status={mentor.state} /> : '—' },
    { label: 'Status', value: <StatusBadge status={mentor.is_active ? 'active' : 'inactive'} /> },
    { label: 'Joined', value: mentor.created_at ? new Date(mentor.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Achiever Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-5">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-white text-xl font-black" style={{ backgroundColor: 'var(--accent)' }}>
              {mentor.full_name?.charAt(0)?.toUpperCase() || '?'}
            </div>
            <div>
              <p className="text-lg font-black text-slate-900">{mentor.full_name}</p>
              {mentor.linkedin_url && (
                <a href={mentor.linkedin_url} target="_blank" rel="noopener noreferrer"
                  className="text-xs text-blue-500 flex items-center gap-1 mt-0.5"><Link size={11} /> LinkedIn</a>
              )}
            </div>
          </div>
          <div className="space-y-2">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value || '—'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={() => { onToggle(mentor); onClose(); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${mentor.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'}`}>
            {mentor.is_active ? <Ban size={15} /> : <ShieldCheck size={15} />}
            {mentor.is_active ? 'Block Achiever' : 'Unblock Achiever'}
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperMentors() {
  const navigate = useNavigate();
  const [mentors, setMentors]       = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q) params.search = q;
    superApi.get('/skovo-platform-owner/achievers', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setMentors(data.response.achievers); setPagination(data.pagination); }
      })
      .catch(() => showToast('Failed to load achievers', false))
      .finally(() => setLoading(false));
  }, [search, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search); };

  const toggleActive = (mentor) => {
    const newVal  = !mentor.is_active;
    const isBlock = !newVal;
    setConfirmDlg({
      message: `${isBlock ? 'Block' : 'Unblock'} "${mentor.full_name}"?`,
      detail: isBlock ? 'This achiever will lose access to the platform.' : 'This achiever will regain platform access.',
      confirmLabel: isBlock ? 'Block' : 'Unblock',
      danger: isBlock,
      onConfirm: async () => {
        try {
          const { data } = await superApi.patch(`/skovo-platform-owner/achievers/${mentor.id}`, { is_active: newVal });
          if (data.bool) {
            showToast(`Mentor ${newVal ? 'unblocked' : 'blocked'}`);
            setMentors(prev => prev.map(m => m.id === mentor.id ? { ...m, is_active: newVal } : m));
          } else showToast('Failed', false);
        } catch { showToast('Error', false); }
      },
    });
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {selected && <MentorDetailModal mentor={selected} onClose={() => setSelected(null)} onToggle={(m) => { setSelected(null); toggleActive(m); }} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">All Mentors</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} mentors on the platform</p>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Name, designation or company…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700">
          Search
        </button>
      </form>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th><Th>Mentor</Th><Th>Email</Th><Th>Designation & Company</Th><Th>Domains</Th><Th>State</Th><Th>Active</Th><Th>Joined</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={9} rows={8} />
            </table>
          </div>
        ) : mentors.length === 0 ? (
          <EmptyState icon={UserCheck} message={search ? 'No results found' : 'No mentors yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Mentor</Th>
                  <Th>Email</Th>
                  <Th>Designation & Company</Th>
                  <Th>Domains</Th>
                  <Th>State</Th>
                  <Th>Active</Th>
                  <Th>Joined</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {mentors.map((m, idx) => (
                  <tr key={m.id}
                        onClick={() => setSelected(m)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={m.full_name} size="md" />
                        <div className="flex items-center gap-1.5">
                          <p className="font-semibold text-slate-900">{m.full_name}</p>
                          {m.linkedin_url && (
                            <a href={m.linkedin_url} target="_blank" rel="noopener noreferrer"
                              className="text-blue-400 hover:text-blue-600" title="LinkedIn">
                              <ExternalLink size={13} />
                            </a>
                          )}
                        </div>
                      </div>
                    </Td>
                    <Td><span className="text-slate-500 text-xs">{m.email}</span></Td>
                    <Td>
                      {m.designation && <p className="text-xs font-semibold text-slate-900">{m.designation}</p>}
                      {m.company     && <p className="text-xs text-slate-400">{m.company}</p>}
                      {!m.designation && !m.company && <span className="text-xs text-slate-400">--</span>}
                    </Td>
                    <Td>
                      {(m.domains || []).length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {m.domains.slice(0, 3).map(d => (
                            <span key={d} className="px-2 py-0.5 bg-violet-50 text-violet-700 border border-violet-200 rounded-full text-xs font-medium">{d}</span>
                          ))}
                          {m.domains.length > 3 && (
                            <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded-full text-xs">+{m.domains.length - 3}</span>
                          )}
                        </div>
                      ) : <span className="text-xs text-slate-400">--</span>}
                    </Td>
                    <Td>
                      {m.state
                        ? <StatusBadge status={m.state} />
                        : <span className="text-xs text-slate-400">—</span>}
                    </Td>
                    <Td>
                      <StatusBadge status={m.is_active ? 'active' : 'inactive'} />
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                      </span>
                    </Td>
                    {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(m)} />
                        <ActionBtn
                          icon={m.is_active ? Ban : ShieldCheck}
                          tooltip={m.is_active ? 'Block mentor' : 'Unblock mentor'}
                          onClick={() => toggleActive(m)}
                          color={m.is_active ? 'red' : 'green'}
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
