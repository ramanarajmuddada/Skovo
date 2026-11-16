import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { BookOpen, Search, CheckCircle, XCircle, Eye, X } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, StatusBadge, ActionBtn,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

function EnrollmentDetailModal({ item, onClose }) {
  const rows = [
    { label: 'Student', value: item.user_name },
    { label: 'Email', value: item.user_email },
    { label: 'Cohort', value: item.cohort_title },
    { label: 'Cohort Status', value: <StatusBadge status={item.cohort_status} /> },
    { label: 'Payment', value: <StatusBadge status={item.payment_status} /> },
    { label: 'Amount Paid', value: item.amount_paid > 0 ? `₹${item.amount_paid.toLocaleString('en-IN')}` : 'Free' },
    { label: 'Attended', value: item.attended ? '✅ Yes' : '❌ No' },
    { label: 'Institution', value: item.institution ? `${item.institution.name} (${item.institution.subdomain}.skovo.in)` : 'Platform-wide' },
    { label: 'Enrolled On', value: item.enrolled_at ? new Date(item.enrolled_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Enrollment Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 max-h-[65vh] overflow-y-auto space-y-2">
          {rows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
              <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
              <span className="text-sm font-semibold text-slate-800 text-right">{value || '—'}</span>
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperEnrollments() {
  const { lists } = useMasters(['payment_status']);
  const navigate = useNavigate();
  const [enrollments, setEnrollments] = useState([]);
  const [pagination, setPagination]   = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]         = useState(20);
  const [search, setSearch]           = useState('');
  const [payFilter, setPayFilter]     = useState('');
  const [loading, setLoading]             = useState(true);
  const [selected, setSelected]           = useState(null);

  const load = useCallback((page = 1, q = search, pay = payFilter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q)   params.search          = q;
    if (pay) params.payment_status  = pay;
    superApi.get('/skovo-platform-owner/enrollments', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setEnrollments(data.response.enrollments); setPagination(data.pagination); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, payFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search, payFilter); };

  return (
    <div className="p-4 sm:p-6">
      {selected && <EnrollmentDetailModal item={selected} onClose={() => setSelected(null)} />}
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Enrollments</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} enrollments platform-wide</p>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student name, email or cohort…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
        </div>
        <FormSelect searchType="payment_status"
          className="sm:w-48 shrink-0"
          value={payFilter}
          onChange={v => { setPayFilter(v); load(1, search, v); }}
          options={lists.payment_status || []}
          placeholder="All Payments" />
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
                  <Th>S.No</Th><Th>Student</Th><Th>Email</Th><Th>Cohort</Th><Th>Cohort Status</Th><Th>Payment</Th><Th>Amount</Th><Th>Attended</Th><Th>Institution</Th><Th>Enrolled</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={11} rows={8} />
            </table>
          </div>
        ) : enrollments.length === 0 ? (
          <EmptyState icon={BookOpen} message="No enrollments found" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Student</Th>
                  <Th>Email</Th>
                  <Th>Cohort</Th>
                  <Th>Cohort Status</Th>
                  <Th>Payment</Th>
                  <Th>Amount</Th>
                  <Th>Attended</Th>
                  <Th>Institution</Th>
                  <Th>Enrolled</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {enrollments.map((e, idx) => (
                  <tr key={e.id} onClick={() => setSelected(e)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={e.user_name} />
                        <span className="font-semibold text-slate-900">{e.user_name}</span>
                      </div>
                    </Td>
                    <Td><span className="text-xs text-slate-500">{e.user_email}</span></Td>
                    <Td><p className="font-semibold text-slate-900 text-xs max-w-40 truncate">{e.cohort_title}</p></Td>
                    <Td><StatusBadge status={e.cohort_status} /></Td>
                    <Td><StatusBadge status={e.payment_status} /></Td>
                    <Td>
                      <span className="text-sm font-semibold text-slate-700">
                        {e.amount_paid > 0 ? `₹${e.amount_paid.toLocaleString('en-IN')}` : '--'}
                      </span>
                    </Td>
                    <Td>
                      {e.attended
                        ? <CheckCircle size={16} className="text-emerald-500" />
                        : <XCircle size={16} className="text-slate-300" />
                      }
                    </Td>
                    <Td>
                      {e.institution ? (
                        <div>
                          <p className="text-xs font-semibold text-slate-900">{e.institution.name}</p>
                          <p className="text-[11px] text-slate-400">{e.institution.subdomain}.skovo.in</p>
                        </div>
                      ) : <span className="text-xs text-slate-400">--</span>}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {e.enrolled_at ? new Date(e.enrolled_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(e)} />
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
          onPerPage={pp => { setPerPage(pp); load(1, search, payFilter, pp); }}
        />
      </TableShell>
    </div>
  );
}
