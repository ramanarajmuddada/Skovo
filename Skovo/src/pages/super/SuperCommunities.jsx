import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Users, Search, MessageSquare, Lock, Unlock, CheckCircle, XCircle, PowerOff, Power, Eye, X } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, ActionBtn, StatusBadge, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

const TYPE_META = {
  regular:           { label: 'Regular',           color: 'bg-slate-100 text-slate-600 border-slate-200' },
  thoughts:          { label: 'Thoughts',           color: 'bg-pink-50 text-pink-700 border-pink-200' },
  knowledge_booster: { label: 'Knowledge Booster',  color: 'bg-blue-50 text-blue-700 border-blue-200' },
};

function CommunityDetailModal({ group, onClose, onToggle }) {
  const typeMeta = TYPE_META[group.type] || TYPE_META.regular;
  const rows = [
    { label: 'Type', value: <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${typeMeta.color}`}>{typeMeta.label}</span> },
    { label: 'Category', value: group.category },
    { label: 'Members', value: group.member_count },
    { label: 'Posts', value: group.post_count },
    { label: 'Join Type', value: group.join_type === 'open' ? '🔓 Open' : '🔒 Request only' },
    { label: 'Institution', value: group.institution ? `${group.institution.name}` : 'Platform-wide' },
    { label: 'Active', value: <StatusBadge status={group.is_active ? 'active' : 'inactive'} /> },
    { label: 'Created', value: group.created_at ? new Date(group.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Community Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <div>
            <p className="text-lg font-black text-slate-900">{group.name}</p>
            {group.description && <p className="text-sm text-slate-500 mt-1">{group.description}</p>}
          </div>
          <div className="space-y-2">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex gap-3">
          <button onClick={() => { onToggle(group); onClose(); }}
            className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold transition-colors ${group.is_active ? 'bg-red-50 text-red-600 hover:bg-red-100 border border-red-200' : 'bg-emerald-50 text-emerald-600 hover:bg-emerald-100 border border-emerald-200'}`}>
            {group.is_active ? <PowerOff size={15} /> : <Power size={15} />}
            {group.is_active ? 'Deactivate' : 'Activate'}
          </button>
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperCommunities() {
  const { lists } = useMasters(['community_post_type']);
  const navigate = useNavigate();
  const [communities, setCommunities] = useState([]);
  const [pagination, setPagination]   = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]         = useState(20);
  const [search, setSearch]           = useState('');
  const [typeFilter, setTypeFilter]   = useState('');
  const [loading, setLoading]         = useState(true);
  const [selected, setSelected]       = useState(null);
  const [confirmDlg, setConfirmDlg]   = useState(null);

  const load = useCallback((page = 1, q = search, type = typeFilter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q)    params.search     = q;
    if (type) params.group_type = type;
    superApi.get('/skovo-platform-owner/communities', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setCommunities(data.response.communities); setPagination(data.pagination); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, typeFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search, typeFilter); };

  const toggleActive = (g) => {
    const newVal    = !g.is_active;
    const isDeact   = !newVal;
    setConfirmDlg({
      message: `${isDeact ? 'Deactivate' : 'Activate'} "${g.name}"?`,
      detail: isDeact ? 'Members will no longer see this community.' : 'This community will become visible to members.',
      confirmLabel: isDeact ? 'Deactivate' : 'Activate',
      danger: isDeact,
      onConfirm: async () => {
        try {
          const { data } = await superApi.patch(`/skovo-platform-owner/communities/${g.id}`, { is_active: newVal });
          if (data.bool) setCommunities(prev => prev.map(x => x.id === g.id ? { ...x, is_active: newVal } : x));
        } catch {}
      },
    });
  };

  return (
    <div className="p-4 sm:p-6">
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {selected && <CommunityDetailModal group={selected} onClose={() => setSelected(null)} onToggle={(g) => { setSelected(null); toggleActive(g); }} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Communities</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} groups on the platform</p>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search group name…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
        </div>
        <FormSelect searchType="community_post_type"
          className="sm:w-48 shrink-0"
          value={typeFilter}
          onChange={v => { setTypeFilter(v); load(1, search, v); }}
          options={lists.community_post_type || []}
          placeholder="All Types" />
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
                  <Th>S.No</Th><Th>Group</Th><Th>Type</Th><Th>Category</Th><Th>Members</Th><Th>Posts</Th><Th>Join</Th><Th>Institution</Th><Th>Active</Th><Th>Created</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={11} rows={8} />
            </table>
          </div>
        ) : communities.length === 0 ? (
          <EmptyState icon={Users} message="No communities found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Group</Th>
                  <Th>Type</Th>
                  <Th>Category</Th>
                  <Th>Members</Th>
                  <Th>Posts</Th>
                  <Th>Join</Th>
                  <Th>Institution</Th>
                  <Th>Active</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {communities.map((g, idx) => {
                  const typeMeta = TYPE_META[g.group_type] || TYPE_META.regular;
                  return (
                    <tr key={g.id}
                        onClick={() => setSelected(g)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={g.name} size="md" />
                          <div>
                            <p className="font-semibold text-slate-900">{g.name}</p>
                            {g.description && (
                              <p className="text-[11px] text-slate-400 truncate max-w-45">{g.description}</p>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${typeMeta.color}`}>
                          {typeMeta.label}
                        </span>
                      </Td>
                      <Td><span className="text-xs text-slate-500">{g.category || '--'}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Users size={13} className="text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">{g.member_count}</span>
                        </div>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <MessageSquare size={13} className="text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">{g.post_count}</span>
                        </div>
                      </Td>
                      <Td>
                        {g.join_type === 'open'
                          ? <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium"><Unlock size={12} /> Open</span>
                          : <span className="flex items-center gap-1 text-xs text-amber-600 font-medium"><Lock size={12} /> Request</span>
                        }
                      </Td>
                      <Td>
                        {g.institution ? (
                          <div>
                            <p className="text-xs font-semibold text-slate-900">{g.institution.name}</p>
                            <p className="text-[11px] text-slate-400">{g.institution.subdomain}.skovo.in</p>
                          </div>
                        ) : <span className="text-xs text-slate-400">Platform-wide</span>}
                      </Td>
                      <Td>
                        {g.is_active
                          ? <CheckCircle size={16} className="text-emerald-500" />
                          : <XCircle size={16} className="text-slate-300" />
                        }
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {g.created_at ? new Date(g.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                        </span>
                      </Td>
                      {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(g)} />
                          <ActionBtn
                            icon={g.is_active ? PowerOff : Power}
                            tooltip={g.is_active ? 'Deactivate group' : 'Activate group'}
                            onClick={() => toggleActive(g)}
                            color={g.is_active ? 'red' : 'green'}
                          />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
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
          onPerPage={pp => { setPerPage(pp); load(1, search, typeFilter, pp); }}
        />
      </TableShell>
    </div>
  );
}
