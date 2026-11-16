import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { ShieldAlert, Check, X, Clock, ChevronDown, ChevronUp, Search, Calendar, Download, Filter, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

function downloadSuperCSV(logs) {
  const rows = [
    ['Time', 'Action', 'Resource', 'Actor', 'Actor Email', 'Details'],
    ...logs.map(l => [
      l.created_at ? new Date(l.created_at).toLocaleString('en-IN') : '',
      l.action || '', l.resource_type || '',
      l.actor_name || 'System', l.actor_email || '',
      l.meta ? JSON.stringify(l.meta) : '',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `platform-audit-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  URL.revokeObjectURL(url);
}

const ACTION_COLORS = {
  'user.created':         'bg-emerald-50 text-emerald-700',
  'user.deleted':         'bg-red-50 text-red-700',
  'user.role_changed':    'bg-blue-50 text-blue-700',
  'user.status_changed':  'bg-amber-50 text-amber-700',
  'cohort.created':       'bg-violet-50 text-violet-700',
  'cohort.updated':       'bg-violet-50 text-violet-700',
  'cohort.deleted':       'bg-red-50 text-red-700',
  'admin.updated':        'bg-slate-100 text-slate-700',
};

function getActionColor(action = '') {
  return ACTION_COLORS[action] || 'bg-slate-50 text-slate-600';
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function MetaPopover({ meta }) {
  const [open, setOpen] = useState(false);
  if (!meta || Object.keys(meta).length === 0) return <span className="text-xs text-slate-400">--</span>;
  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-violet-600 hover:text-violet-800 font-medium">
        Details {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-30 bg-white border border-slate-200 rounded-xl shadow-xl p-3 min-w-50 max-w-xs">
          <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all font-mono">
            {JSON.stringify(meta, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function LogDetailModal({ log, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Audit Log Entry</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-2 max-h-[65vh] overflow-y-auto">
          {[
            { label: 'Action', value: <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${getActionColor(log.action)}`}>{log.action}</span> },
            { label: 'Resource Type', value: log.resource_type },
            { label: 'Resource ID', value: log.resource_id ? <span className="font-mono text-xs">{log.resource_id}</span> : '—' },
            { label: 'Actor', value: log.actor_name },
            { label: 'Actor Email', value: log.actor_email },
            { label: 'Timestamp', value: log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—' },
          ].map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
              <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
              <span className="text-sm font-semibold text-slate-800 text-right">{value ?? '—'}</span>
            </div>
          ))}
          {log.meta && Object.keys(log.meta).length > 0 && (
            <div className="py-2">
              <span className="text-xs text-slate-400 font-medium block mb-2">Meta / Details</span>
              <pre className="text-xs bg-slate-50 rounded-xl p-3 font-mono text-slate-600 whitespace-pre-wrap break-all overflow-x-auto">
                {JSON.stringify(log.meta, null, 2)}
              </pre>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperAuditLog() {
  const { lists } = useMasters(['audit_action', 'audit_resource']);
  const navigate = useNavigate();
  const [logs, setLogs]             = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [actionFilter, setAction]   = useState('');
  const [resFilter, setRes]         = useState('');
  const [actorSearch, setActorSearch] = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [selected, setSelected]     = useState(null);
  const [exporting, setExporting]   = useState(false);
  const [toast, setToast]           = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, action = actionFilter, res = resFilter, actor = actorSearch, from = fromDate, to = toDate, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (action) params.action        = action;
    if (res)    params.resource_type = res;
    if (actor)  params.actor         = actor;
    if (from)   params.from_date     = from;
    if (to)     params.to_date       = to;
    superApi.get('/skovo-platform-owner/audit', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setLogs(data.response.logs); setPagination(data.pagination); }
      })
      .catch(() => showToast('Failed to load audit log', false))
      .finally(() => setLoading(false));
  }, [actionFilter, resFilter, perPage]);

  useEffect(() => { load(1); }, []);

  function fmt(ts) {
    if (!ts) return '--';
    const d = new Date(ts);
    return d.toLocaleDateString('en-IN', { dateStyle: 'medium' }) + ' · ' + d.toLocaleTimeString('en-IN', { timeStyle: 'short' });
  }

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {selected && <LogDetailModal log={selected} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Platform Audit Log</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} platform activity events</p>
        </div>
        <button
          onClick={async () => {
            setExporting(true);
            try {
              const { data } = await superApi.get('/skovo-platform-owner/audit', { page: 1, per_page: 1000, ...(actionFilter && { action: actionFilter }), ...(resFilter && { resource_type: resFilter }), ...(actorSearch && { actor: actorSearch }), ...(fromDate && { from_date: fromDate }), ...(toDate && { to_date: toDate }) });
              if (data.bool) downloadSuperCSV(data.response.logs || []);
            } catch {}
            setExporting(false);
          }}
          disabled={exporting || logs.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-50 disabled:opacity-40 shrink-0"
        >
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <FormSelect searchType="audit_action"
            className="sm:w-48 shrink-0"
            value={actionFilter}
            onChange={v => { setAction(v); load(1, v, resFilter, actorSearch, fromDate, toDate); }}
            options={lists.audit_action || []}
            placeholder="All Actions" />
          <FormSelect searchType="audit_resource"
            className="sm:w-48 shrink-0"
            value={resFilter}
            onChange={v => { setRes(v); load(1, actionFilter, v, actorSearch, fromDate, toDate); }}
            options={lists.audit_resource || []}
            placeholder="All Resources" />
          {/* From date */}
          <div className="relative">
            <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
          </div>
          {/* To date */}
          <div className="relative">
            <Calendar size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)}
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
          </div>
        </div>
        {/* Actor search + apply */}
        <div className="flex gap-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={actorSearch} onChange={e => setActorSearch(e.target.value)}
              placeholder="Search by actor name or email…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500" />
          </div>
          <button onClick={() => load(1, actionFilter, resFilter, actorSearch, fromDate, toDate)}
            className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700 transition-colors">
            <Filter size={13} /> Apply
          </button>
          {(actionFilter || resFilter || actorSearch || fromDate || toDate) && (
            <button onClick={() => { setAction(''); setRes(''); setActorSearch(''); setFromDate(''); setToDate(''); load(1, '', '', '', '', ''); }}
              className="px-4 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 font-medium">
              Clear
            </button>
          )}
        </div>
      </div>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th><Th>Action</Th><Th>Resource</Th><Th>Actor</Th><Th>Details</Th><Th>Time</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={7} rows={10} />
            </table>
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={ShieldAlert} message={actionFilter || resFilter ? 'No results found' : 'No audit events yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Action</Th>
                  <Th>Resource</Th>
                  <Th>Actor</Th>
                  <Th>Details</Th>
                  <Th>Time</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {logs.map((log, idx) => (
                  <tr key={log.id}
                        onClick={() => setSelected(log)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <span className={`px-2.5 py-1 rounded-lg text-xs font-mono font-semibold ${getActionColor(log.action)}`}>
                        {log.action}
                      </span>
                    </Td>
                    <Td>
                      {log.resource_type && (
                        <div>
                          <span className="text-xs font-semibold text-slate-700 capitalize">{log.resource_type}</span>
                          {log.resource_id && (
                            <p className="text-xs text-slate-400 font-mono mt-0.5 truncate max-w-30" title={log.resource_id}>
                              {log.resource_id.slice(0, 8)}...
                            </p>
                          )}
                        </div>
                      )}
                    </Td>
                    <Td>
                      {log.actor_name ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{log.actor_name}</p>
                          <p className="text-xs text-slate-400">{log.actor_email}</p>
                        </div>
                      ) : <span className="text-xs text-slate-400">System</span>}
                    </Td>
                    <Td>
                      <MetaPopover meta={log.meta} />
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
                        <Clock size={11} className="shrink-0" />
                        {fmt(log.created_at)}
                      </div>
                    </Td>
                    {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(log)} />
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
          onPerPage={pp => { setPerPage(pp); load(1, actionFilter, resFilter, actorSearch, fromDate, toDate, pp); }}
        />
      </TableShell>
    </div>
  );
}
