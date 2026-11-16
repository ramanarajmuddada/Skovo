import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { CalendarDays, Search, Check, X, Eye, IndianRupee, Users, Calendar, Ban, RotateCcw } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function CohortDetailModal({ cohort, onClose }) {
  const rows = [
    { label: 'Status', value: <StatusBadge status={cohort.status || 'upcoming'} /> },
    { label: 'Session Date', value: cohort.session_date ? new Date(cohort.session_date).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
    { label: 'Seats', value: Number(cohort.total_seats) > 0
        ? `${cohort.filled_seats ?? 0} / ${cohort.total_seats} filled`
        : `${cohort.filled_seats ?? 0} enrolled` },
    { label: 'Price', value: !Number(cohort.price) ? 'Free' : `₹${Number(cohort.price).toLocaleString('en-IN')}` },
    { label: 'Created', value: cohort.created_at ? new Date(cohort.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Cohort Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-lg font-black text-slate-900">{cohort.title}</p>
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

/**
 * The cohort edit form that lived here is gone on purpose.
 *
 * It also did not do what it appeared to: the form PATCHed every field, but the
 * super endpoint only ever accepted `status`, so the rest was silently dropped.
 * Editing a cohort is admin work. What the super admin keeps is the status
 * control in the table below — the reversible switch for stopping a cohort
 * that has gone wrong.
 */

export default function SuperCohorts() {
  const { lists } = useMasters(['cohort_status']);
  const navigate = useNavigate();
  const [cohorts, setCohorts]       = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, st = statusFilter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q)  params.search = q;
    if (st) params.status = st;
    superApi.get('/skovo-platform-owner/cohorts', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setCohorts(data.response.cohorts); setPagination(data.pagination); }
      })
      .catch(() => showToast('Failed to load cohorts', false))
      .finally(() => setLoading(false));
  }, [search, statusFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search, statusFilter); };

  // Break-glass. The super admin does not edit cohorts, but must be able to
  // stop one that has gone wrong when no admin is around. Reversible on
  // purpose: `cancelled` hides it from students, it does not destroy the row
  // or the enrolments and payments hanging off it.
  const changeStatus = async (cohort, newStatus) => {
    try {
      const { data } = await superApi.patch(`/skovo-platform-owner/cohorts/${cohort.id}`, { status: newStatus });
      if (data.bool) {
        showToast(`Cohort marked as ${newStatus}`);
        setCohorts(prev => prev.map(c => c.id === cohort.id ? { ...c, status: newStatus } : c));
      } else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };


  const seatPercent = (filled, total) => total > 0 ? Math.round((filled / total) * 100) : 0;

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {selected && <CohortDetailModal cohort={selected} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">All Cohorts</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} cohorts on the platform</p>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search cohort title…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
        </div>
        <FormSelect searchType="cohort_status"
          className="sm:w-48 shrink-0"
          value={statusFilter}
          onChange={v => { setStatus(v); load(1, search, v); }}
          options={lists.cohort_status || []}
          placeholder="All Statuses" />
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
                  <Th>S.No</Th><Th>Cohort</Th><Th>Session Date</Th><Th>Status</Th><Th>Seats</Th><Th>Price</Th><Th>Created</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={8} />
            </table>
          </div>
        ) : cohorts.length === 0 ? (
          <EmptyState icon={CalendarDays} message={search || statusFilter ? 'No results found' : 'No cohorts yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Cohort</Th>
                  <Th>Session Date</Th>
                  <Th>Status</Th>
                  <Th>Seats</Th>
                  <Th>Price</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {cohorts.map((c, idx) => {
                  const pct = seatPercent(c.filled_seats, c.total_seats);
                  return (
                    <tr key={c.id}
                        onClick={() => setSelected(c)}
                        className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                      <Td><p className="font-semibold text-slate-900 truncate max-w-xs">{c.title}</p></Td>
                      <Td>
                        <span className="text-xs text-slate-500 whitespace-nowrap">
                          {c.session_date ? new Date(c.session_date).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                        </span>
                      </Td>
                      <Td><StatusBadge status={c.status || 'upcoming'} /></Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 min-w-15 bg-slate-100 rounded-full h-1.5">
                            <div
                              className={`h-1.5 rounded-full ${pct >= 90 ? 'bg-red-500' : pct >= 60 ? 'bg-amber-500' : 'bg-emerald-500'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className="text-xs text-slate-500 whitespace-nowrap">
                            <span className="font-semibold text-slate-900">{c.filled_seats}</span>/{c.total_seats}
                          </span>
                        </div>
                      </Td>
                      <Td>
                        {!Number(c.price) ? (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-xs font-semibold">Free</span>
                        ) : (
                          <span className="text-xs font-semibold text-slate-900">₹{Number(c.price).toLocaleString('en-IN')}</span>
                        )}
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {c.created_at ? new Date(c.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                        </span>
                      </Td>
                      {/* The row opens the detail view; the action cell below stops the
                        click so a button does not also open it. */}
                    <Td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(c)} />
                          {c.status === 'cancelled' ? (
                            <ActionBtn icon={RotateCcw} tooltip="Restore cohort" color="emerald"
                              onClick={() => setConfirmDlg({
                                message: `Restore "${c.title}"?`,
                                detail: 'It becomes visible to students again as upcoming.',
                                confirmLabel: 'Restore',
                                onConfirm: () => changeStatus(c, 'upcoming'),
                              })} />
                          ) : (
                            <ActionBtn icon={Ban} tooltip="Cancel cohort" color="red"
                              onClick={() => setConfirmDlg({
                                message: `Cancel "${c.title}"?`,
                                detail: 'Students stop seeing it immediately. Enrolments and payments are kept, and you can restore it later.',
                                confirmLabel: 'Cancel cohort',
                                danger: true,
                                onConfirm: () => changeStatus(c, 'cancelled'),
                              })} />
                          )}
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
          onPerPage={pp => { setPerPage(pp); load(1, search, statusFilter, pp); }}
        />
      </TableShell>
    </div>
  );
}
