import React, { useEffect, useState, useCallback } from 'react';
import { DateRange } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import { ScrollText, Filter, X, Clock, Search, Download, Calendar } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

function downloadCSV(logs) {
  // No hook here — this is a plain helper, not a component. It writes the raw
  // action and resource straight from each log row, so it never needed the
  // option lists in the first place.
  const rows = [
    ['Time', 'Action', 'Resource', 'Actor Name', 'Actor Email', 'Details'],
    ...logs.map(l => [
      l.created_at ? new Date(l.created_at).toLocaleString('en-IN') : '',
      l.action || '',
      l.resource_type || '',
      l.actor_name || 'System',
      l.actor_email || '',
      l.meta ? JSON.stringify(l.meta) : '',
    ]),
  ];
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ACTION_COLOR = {
  'user.role_changed':   'bg-amber-100 text-amber-700',
  'user.status_changed': 'bg-red-100 text-red-700',
  'invite.created':      'bg-blue-100 text-blue-700',
  'invite.revoked':      'bg-slate-100 text-slate-600',
  'invite.accepted':     'bg-emerald-100 text-emerald-700',
};

// ACTION_OPTIONS comes from master data (masters.audit_action).

// RESOURCE_OPTIONS comes from master data (masters.audit_resource).

// "booking_cancelled" / "invite.accepted" -> "Booking cancelled" / "Invite accepted"
const actionLabel = (a) => {
  const t = String(a || '').replace(/[._]+/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '—';
};

/* Details: one chip per field, skipping empty ones. Objects (before / after
   snapshots) show as short JSON instead of "[object Object]". */
function MetaBadge({ meta }) {
  const entries = Object.entries(meta || {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return <span className="text-slate-400 text-xs">—</span>;
  const show = (v) => {
    const text = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return text.length > 60 ? `${text.slice(0, 57)}…` : text;
  };
  return (
    <div className="flex flex-wrap gap-1 max-w-md">
      {entries.slice(0, 6).map(([k, v]) => (
        <span key={k} title={typeof v === 'object' ? JSON.stringify(v) : String(v)}
              className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-mono break-all">
          {k.replace(/_/g, ' ')}: {show(v)}
        </span>
      ))}
      {entries.length > 6 && <span className="text-xs text-slate-400 px-1">+{entries.length - 6} more</span>}
    </div>
  );
}

/* Mobile card for a single audit log entry */
function LogCard({ log, fmt }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <span className={`text-xs font-bold px-2.5 py-1 rounded-lg ${ACTION_COLOR[log.action] || 'bg-slate-100 text-slate-600'}`}>
          {actionLabel(log.action)}
        </span>
        <span className="flex items-center gap-1 text-xs text-slate-400 whitespace-nowrap shrink-0">
          <Clock size={11} /> {fmt(log.created_at)}
        </span>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>
          <span className="text-slate-400">Actor:</span>{' '}
          <span className="font-medium text-slate-700">{log.actor_name || 'System'}</span>
          {log.actor_email && <span className="text-slate-400"> · {log.actor_email}</span>}
        </span>
        {log.resource_type && (
          <span className="font-mono text-slate-400 text-[11px] bg-slate-50 px-2 py-0.5 rounded">{log.resource_type}</span>
        )}
      </div>

      {log.meta && Object.keys(log.meta).length > 0 && (
        <div className="pt-1">
          <MetaBadge meta={log.meta} />
        </div>
      )}
    </div>
  );
}

export default function AdminAudit() {
  const { lists } = useMasters(['audit_action', 'audit_resource']);
  const ACTION_OPTIONS = [...(lists.audit_action || []).map(o => o.value)];
  const RESOURCE_OPTIONS = [...(lists.audit_resource || []).map(o => o.value)];
  const [logs,           setLogs]           = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [page,           setPage]           = useState(1);
  const [pages,          setPages]          = useState(1);
  const [total,          setTotal]          = useState(0);
  const [perPage,        setPerPage]        = useState(20);
  const [actionFilter,   setActionFilter]   = useState('');
  const [resourceFilter, setResourceFilter] = useState('');
  const [actorSearch,    setActorSearch]    = useState('');
  const [fromDate,       setFromDate]       = useState('');
  const [toDate,         setToDate]         = useState('');
  const [exporting,      setExporting]      = useState(false);

  const load = useCallback((p = 1, action = actionFilter, resource = resourceFilter, actor = actorSearch, from = fromDate, to = toDate) => {
    setLoading(true);
    const params = { page: p, per_page: perPage };
    if (action)   params.action        = action;
    if (resource) params.resource_type = resource;
    if (actor)    params.actor         = actor;
    if (from)     params.from_date     = from;
    if (to)       params.to_date       = to;
    api.get('/skovo-platform-panel-admin/audit', params)
      .then(({ data }) => {
        if (data.bool) {
          setLogs(data.response.logs);
          setPages(data.pagination?.pages || 1);
          setTotal(data.pagination?.total || 0);
        }
      }).catch(() => {}).finally(() => setLoading(false));
  }, [actionFilter, resourceFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const applyFilter = () => { setPage(1); load(1, actionFilter, resourceFilter, actorSearch, fromDate, toDate); };
  const clearFilter = () => {
    setActionFilter(''); setResourceFilter(''); setActorSearch(''); setFromDate(''); setToDate('');
    setPage(1); load(1, '', '', '', '', '');
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const params = { page: 1, per_page: 1000 };
      if (actionFilter)   params.action        = actionFilter;
      if (resourceFilter) params.resource_type = resourceFilter;
      if (actorSearch)    params.actor         = actorSearch;
      if (fromDate)       params.from_date     = fromDate;
      if (toDate)         params.to_date       = toDate;
      const { data } = await api.get('/skovo-platform-panel-admin/audit', params);
      if (data.bool) downloadCSV(data.response.logs || []);
    } catch {}
    finally { setExporting(false); }
  };

  const fmt = (iso) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Audit Log</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {total > 0 ? <><span className="font-semibold text-slate-700">{total}</span> events recorded</> : 'Every admin action logged permanently'}
          </p>
        </div>
        <button
          onClick={handleExport}
          disabled={exporting || logs.length === 0}
          className="flex items-center gap-2 px-4 py-2.5 border border-slate-200 text-sm font-semibold text-slate-600 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors shrink-0"
        >
          <Download size={14} /> {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-5 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Action */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Action</label>
            <FormSelect searchType="audit_action"
              value={actionFilter}
              onChange={v => setActionFilter(v)}
              options={ACTION_OPTIONS.map(a => ({ value: a, label: actionLabel(a) }))}
              placeholder="All actions"
              className="w-full" />
          </div>
          {/* Resource */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1.5">Resource</label>
            <FormSelect searchType="audit_resource"
              value={resourceFilter}
              onChange={v => setResourceFilter(v)}
              options={RESOURCE_OPTIONS.map(r => ({ value: r, label: r }))}
              placeholder="All resources"
              className="w-full" />
          </div>
          {/* Date range: the platform picker, not two browser date boxes. */}
          <div className="lg:col-span-2">
            <span className="flex items-center gap-1 text-xs font-semibold text-slate-500 mb-1.5"><Calendar size={10}/>When</span>
            <DateRange value={{ from: fromDate, to: toDate }} anyLabel="Any date" align="left"
                       onChange={(r) => { setFromDate(r.from); setToDate(r.to); }} />
          </div>
        </div>
        {/* Actor search + buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={actorSearch} onChange={e => setActorSearch(e.target.value)}
              placeholder="Search by actor name or email…"
              className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="flex gap-2">
            <button onClick={applyFilter}
              className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
              <Filter size={14} /> Apply
            </button>
            {(actionFilter || resourceFilter || actorSearch || fromDate || toDate) && (
              <button onClick={clearFilter}
                className="flex items-center gap-1.5 px-4 py-2.5 border border-slate-200 text-sm text-slate-600 font-medium rounded-xl hover:bg-slate-50 transition-colors">
                <X size={14} /> Clear
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mobile cards */}
      {!loading && logs.length > 0 && (
        <div className="lg:hidden space-y-3 mb-4">
          {logs.map((log) => (
            <LogCard key={log.id} log={log} fmt={fmt} />
          ))}
        </div>
      )}

      {/* Phones: the table pager sits inside the hidden desktop block. */}
      {!loading && total > 0 && (
        <div className="lg:hidden mb-4">
          <Pagination
          page={page}
          pages={pages}
          total={total}
          perPage={perPage}
          onPage={(p) => { setPage(p); load(p); }}
          onPerPage={(n) => { setPerPage(n); setPage(1); load(1); }}
        />
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>Time</Th>
                  <Th>Action</Th>
                  <Th>Resource</Th>
                  <Th>Actor</Th>
                  <Th>Details</Th>
                </tr>
              </thead>
              {loading ? (
                <LoadingRows cols={5} />
              ) : logs.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={5}>
                      <EmptyState icon={ScrollText} message="No events found" />
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/70 transition-colors">
                      <Td className="text-slate-400 text-xs whitespace-nowrap">{fmt(log.created_at)}</Td>
                      <Td>
                        <span className={`inline-block text-xs font-semibold px-2.5 py-1 rounded-lg ${ACTION_COLOR[log.action] || 'bg-slate-100 text-slate-600'}`}>
                          {actionLabel(log.action)}
                        </span>
                      </Td>
                      <Td className="text-slate-500 text-xs">
                        {log.resource_type && <span className="font-mono">{log.resource_type}</span>}
                      </Td>
                      <Td>
                        <p className="font-medium text-slate-900 text-xs whitespace-nowrap">{log.actor_name || 'System'}</p>
                        <p className="text-slate-400 text-xs">{log.actor_email || ''}</p>
                      </Td>
                      <Td><MetaBadge meta={log.meta} /></Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          <Pagination
            page={page}
            pages={pages}
            total={total}
            perPage={perPage}
            onPage={(p) => { setPage(p); load(p); }}
            onPerPage={(n) => { setPerPage(n); setPage(1); load(1); }}
          />
        </TableShell>
      </div>

      {/* Mobile loading / empty states */}
      {loading && (
        <div className="lg:hidden space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-14 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      )}
      {!loading && logs.length === 0 && (
        <div className="lg:hidden bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-20">
          <ScrollText size={40} className="mb-3 text-slate-300" />
          <p className="font-semibold text-slate-500">No events found</p>
        </div>
      )}
    </div>
  );
}
