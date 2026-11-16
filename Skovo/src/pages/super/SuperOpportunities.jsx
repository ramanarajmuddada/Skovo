import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Briefcase, Search, Globe, Users, Check, X, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  StatusBadge, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

const TYPE_LABELS = {
  internship:   { label: 'Internship',   color: 'bg-blue-50 text-blue-700 border-blue-200' },
  fresher_job:  { label: 'Fresher Job',  color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  part_time:    { label: 'Part Time',    color: 'bg-amber-50 text-amber-700 border-amber-200' },
  fellowship:   { label: 'Fellowship',   color: 'bg-violet-50 text-violet-700 border-violet-200' },
};

function formatStipend(min, max, type) {
  if (type === 'unpaid') return 'Unpaid';
  if (type === 'performance_based') return 'Performance-based';
  if (!min && !max) return '--';
  if (min && max) return `₹${(min / 1000).toFixed(0)}k-₹${(max / 1000).toFixed(0)}k/mo`;
  return `₹${((min || max) / 1000).toFixed(0)}k/mo`;
}

/**
 * The create/edit form that used to live here is gone on purpose.
 *
 * Opportunities are content, and content belongs to the admin portal. The
 * super admin approves who holds admin access and watches the platform; it
 * does not author what students see. Keeping one writer means one name in the
 * audit log against every change.
 *
 * What remains below is the detail view — oversight needs to read everything,
 * it just does not need to write.
 */

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function OppDetailModal({ opp, onClose }) {
  const rows = [
    { label: 'Company', value: opp.company },
    { label: 'Type', value: opp.type },
    { label: 'Domain', value: opp.domain },
    { label: 'Location', value: opp.is_remote ? `${opp.location || ''} · Remote` : opp.location },
    { label: 'Duration', value: opp.duration },
    { label: 'Stipend', value: opp.stipend_min && opp.stipend_max ? `₹${opp.stipend_min}–₹${opp.stipend_max}/mo` : opp.stipend_min ? `₹${opp.stipend_min}/mo` : '—' },
    { label: 'Min Score', value: opp.min_readiness_score ? `${opp.min_readiness_score} pts` : '—' },
    { label: 'Deadline', value: opp.deadline ? new Date(opp.deadline).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
    { label: 'Status', value: <StatusBadge status={opp.status} /> },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Opportunity Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-lg font-black text-slate-900">{opp.title}</p>
          {opp.description && <p className="text-sm text-slate-500 leading-relaxed">{opp.description}</p>}
          <div className="space-y-2">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperOpportunities() {
  const { lists } = useMasters(['opportunity_status', 'opportunity_type']);
  const navigate = useNavigate();
  const [opps, setOpps]             = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [viewOpp, setViewOpp]       = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, type = typeFilter, status = statusFilter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q)      params.search = q;
    if (type)   params.type   = type;
    if (status) params.status = status;
    superApi.get('/skovo-platform-owner/opportunities', params)
      .then(({ data, status: s }) => {
        if (s === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setOpps(data.response.opportunities); setPagination(data.pagination); }
      })
      .catch(() => showToast('Failed to load', false))
      .finally(() => setLoading(false));
  }, [search, typeFilter, statusFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search, typeFilter, statusFilter); };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {viewOpp && <OppDetailModal opp={viewOpp} onClose={() => setViewOpp(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Opportunities</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} opportunities across all institutions</p>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search title or company…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
        </div>
        <FormSelect searchType="opportunity_type"
          className="sm:w-48 shrink-0"
          value={typeFilter}
          onChange={v => { setTypeFilter(v); load(1, search, v, statusFilter); }}
          options={lists.opportunity_type || []}
          placeholder="All Types" />
        <FormSelect searchType="opportunity_status"
          className="sm:w-48 shrink-0"
          value={statusFilter}
          onChange={v => { setStatus(v); load(1, search, typeFilter, v); }}
          options={lists.opportunity_status || []}
          placeholder="All Statuses" />
        <button type="submit" className="px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700">Search</button>
      </form>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th><Th>Role & Company</Th><Th>Type</Th><Th>Stipend</Th><Th>Min Score</Th><Th>Apps</Th><Th>Deadline</Th><Th>Institution</Th><Th>Status</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={10} rows={8} />
            </table>
          </div>
        ) : opps.length === 0 ? (
          <EmptyState icon={Briefcase} message="No opportunities found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Role & Company</Th>
                  <Th>Type</Th>
                  <Th>Stipend</Th>
                  <Th>Min Score</Th>
                  <Th>Apps</Th>
                  <Th>Deadline</Th>
                  <Th>Institution</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {opps.map((o, idx) => {
                  const typeInfo = TYPE_LABELS[o.type] || { label: o.type, color: 'bg-slate-100 text-slate-500 border-slate-200' };
                  return (
                    <tr key={o.id}
                        onClick={() => setViewOpp(o)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <p className="font-semibold text-slate-900 truncate max-w-45">{o.title}</p>
                        {o.company && <p className="text-xs text-slate-400 mt-0.5">{o.company}</p>}
                        {o.is_remote && <span className="inline-flex items-center gap-1 text-[11px] text-emerald-600 mt-0.5"><Globe size={10} /> Remote</span>}
                      </Td>
                      <Td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${typeInfo.color}`}>{typeInfo.label}</span>
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-700 font-medium whitespace-nowrap">
                          {formatStipend(o.stipend_min, o.stipend_max, o.stipend_type)}
                        </span>
                      </Td>
                      <Td>
                        {o.min_readiness_score > 0
                          ? <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-violet-50 text-violet-700 border border-violet-200">{o.min_readiness_score}+</span>
                          : <span className="text-xs text-slate-400">Open</span>
                        }
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1.5">
                          <Users size={13} className="text-slate-400" />
                          <span className="text-sm font-semibold text-slate-700">{o.application_count}</span>
                        </div>
                      </Td>
                      <Td>
                        {o.deadline
                          ? (() => { const d = new Date(o.deadline); const past = d < new Date(); return <span className={`text-xs whitespace-nowrap ${past ? 'text-red-400' : 'text-slate-600 font-medium'}`}>{d.toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>; })()
                          : <span className="text-xs text-slate-400">--</span>
                        }
                      </Td>
                      <Td>
                        {o.institution
                          ? <div><p className="text-xs font-semibold text-slate-900">{o.institution.name}</p><p className="text-[11px] text-slate-400">{o.institution.subdomain}.skovo.in</p></div>
                          : <span className="text-xs text-slate-400">Platform-wide</span>}
                      </Td>
                      <Td><StatusBadge status={o.status} /></Td>
                      {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setViewOpp(o)} />
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
          onPerPage={pp => { setPerPage(pp); load(1, search, typeFilter, statusFilter, pp); }}
        />
      </TableShell>
    </div>
  );
}
