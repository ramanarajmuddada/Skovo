import React, { useEffect, useState, useCallback } from 'react';
import { adminApi as api } from '../../services/api';
import { AlertTriangle, Search, X, Clock, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn,
} from '../../components/ui/TableComponents';

const METHOD_COLOR = {
  GET:    'bg-blue-50 text-blue-700',
  POST:   'bg-emerald-50 text-emerald-700',
  PATCH:  'bg-amber-50 text-amber-700',
  PUT:    'bg-amber-50 text-amber-700',
  DELETE: 'bg-red-50 text-red-700',
};

function TracebackModal({ log, onClose }) {
  if (!log) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between p-5 border-b border-slate-200">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-black tracking-widest text-red-600 bg-red-50 px-2.5 py-1 rounded-lg font-mono">
                {log.error_id}
              </span>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${METHOD_COLOR[log.method] || 'bg-slate-100 text-slate-600'}`}>
                {log.method}
              </span>
            </div>
            <p className="font-bold text-slate-900 text-sm">{log.endpoint}</p>
            <p className="text-xs text-slate-400 mt-0.5">{log.error_type} — {log.error_message}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1.5 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Full Traceback</p>
          <pre className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
            {log.traceback || 'No traceback available'}
          </pre>
          <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
            {[
              ['Error ID',   log.error_id],
              ['User ID',    log.user_id || '—'],
              ['Role',       log.role || '—'],
              ['IP Address', log.ip_address || '—'],
              ['Status',     log.status_code],
              ['Time',       log.created_at ? new Date(log.created_at).toLocaleString('en-IN') : '—'],
            ].map(([label, value]) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-slate-400 font-semibold mb-0.5">{label}</p>
                <p className="text-slate-700 font-mono break-all">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function ErrorCard({ log, fmt, onExpand }) {
  // The whole card opens the traceback.
  return (
    <button type="button" onClick={() => onExpand(log)}
            className="w-full text-left bg-white rounded-2xl border border-slate-200 p-3.5 hover:border-blue-300 transition-colors">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-black tracking-wider text-red-600 bg-red-50 px-2 py-0.5 rounded-md font-mono">{log.error_id}</span>
        <span className="flex items-center gap-1 text-[11px] text-slate-400 whitespace-nowrap"><Clock size={11} /> {fmt(log.created_at)}</span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 min-w-0">
        <span className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${METHOD_COLOR[log.method] || 'bg-slate-100 text-slate-600'}`}>{log.method}</span>
        <span className="text-xs text-slate-600 font-mono truncate">{log.endpoint}</span>
      </div>
      <p className="mt-1.5 text-xs text-slate-500 line-clamp-2"><span className="font-semibold text-red-600">{log.error_type}</span> · {log.error_message}</p>
    </button>
  );
}

export default function AdminErrorLogs() {
  const [logs,     setLogs]     = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [page,     setPage]     = useState(1);
  const [pages,    setPages]    = useState(1);
  const [total,    setTotal]    = useState(0);
  const [perPage,  setPerPage]  = useState(20);
  const [search,   setSearch]   = useState('');
  const [selected, setSelected] = useState(null);

  const load = useCallback((p = 1, q = search) => {
    setLoading(true);
    const params = { page: p, per_page: perPage };
    if (q) params.error_id = q;
    api.get('/skovo-platform-panel-admin/error-logs', params)
      .then(({ data }) => {
        if (data.bool) {
          setLogs(data.response.errors || []);
          setPages(data.pagination?.pages || 1);
          setTotal(data.pagination?.total || 0);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [perPage]);

  useEffect(() => { load(1, ''); }, []);

  const handleSearch = (e) => { e.preventDefault(); setPage(1); load(1, search); };
  const clearSearch  = () => { setSearch(''); setPage(1); load(1, ''); };

  const fmt = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return (
    <div className="p-4 sm:p-6">
      {selected && <TracebackModal log={selected} onClose={() => setSelected(null)} />}

      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Error Logs</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          {total > 0
            ? <><span className="font-semibold text-slate-700">{total}</span> errors recorded · users only ever see "Internal Server Error"</>
            : 'Actual server errors stored here. Users always see "Internal Server Error" only.'}
        </p>
      </div>

      <form onSubmit={handleSearch} className="flex gap-2 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Error ID"
            className="w-full min-h-11 pl-10 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white font-mono"
          />
          {search && (
            <button type="button" onClick={clearSearch} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={14} />
            </button>
          )}
        </div>
        <button type="submit" className="min-h-11 px-4 sm:px-5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700 transition-colors">
          Search
        </button>
      </form>

      {/* Mobile cards */}
      {!loading && logs.length > 0 && (
        <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {logs.map((log) => (
            <ErrorCard key={log.id} log={log} fmt={fmt} onExpand={setSelected} />
          ))}
        </div>
      )}
      {loading && (
        <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-24 bg-white rounded-2xl border border-slate-100 animate-pulse" />
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
          onPage={(p) => { setPage(p); load(p, search); }}
          onPerPage={(n) => { setPerPage(n); setPage(1); load(1, search); }}
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
                  <Th>Error Id</Th>
                  <Th>Time</Th>
                  <Th>Request</Th>
                  <Th>Error Type</Th>
                  <Th>Message</Th>
                  <Th>Role</Th>
                </tr>
              </thead>
              {loading ? (
                <LoadingRows cols={6} />
              ) : logs.length === 0 ? (
                <tbody>
                  <tr>
                    <td colSpan={6}>
                      <EmptyState icon={AlertTriangle} message="No errors recorded" sub="Platform is running clean" />
                    </td>
                  </tr>
                </tbody>
              ) : (
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {logs.map((log) => (
                    <tr key={log.id} onClick={() => setSelected(log)} className="hover:bg-slate-50/70 transition-colors cursor-pointer">
                      <Td>
                        <span className="text-xs font-black tracking-widest text-red-600 bg-red-50 px-2.5 py-1 rounded-lg font-mono">
                          {log.error_id}
                        </span>
                      </Td>
                      <Td className="text-slate-400 text-xs whitespace-nowrap">{fmt(log.created_at)}</Td>
                      {/* Method + endpoint in one cell: the row opens the traceback. */}
                      <Td>
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className={`shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-md ${METHOD_COLOR[log.method] || 'bg-slate-100 text-slate-600'}`}>
                            {log.method}
                          </span>
                          <span className="text-slate-600 text-xs font-mono max-w-56 truncate">{log.endpoint}</span>
                        </div>
                      </Td>
                      <Td className="text-red-600 text-xs font-semibold whitespace-nowrap">{log.error_type}</Td>
                      <Td className="text-slate-500 text-xs max-w-64 truncate">{log.error_message}</Td>
                      <Td>
                        {log.role
                          ? <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded-md capitalize">{log.role}</span>
                          : <span className="text-slate-300 text-xs">—</span>}
                      </Td>
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
            onPage={(p) => { setPage(p); load(p, search); }}
            onPerPage={(n) => { setPerPage(n); setPage(1); load(1, search); }}
          />
        </TableShell>
      </div>
    </div>
  );
}
