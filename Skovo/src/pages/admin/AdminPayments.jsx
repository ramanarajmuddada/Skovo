import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import MoneySummary from '../../components/admin/MoneySummary';
import PayoutsAdmin from '../../components/admin/PayoutsAdmin';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { adminApi as api } from '../../services/api';
import { IndianRupee, TrendingUp, TrendingDown, Clock, Filter, Calendar, Wallet, Check, X, RefreshCw, CreditCard, Banknote } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';

const PAY_STYLE = {
  paid:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  pending:    'bg-amber-50 text-amber-700 border-amber-200',
  processing: 'bg-blue-50 text-blue-700 border-blue-200',
  failed:     'bg-red-50 text-red-500 border-red-200',
  refunded:   'bg-red-50 text-red-500 border-red-200',
  rejected:   'bg-red-50 text-red-500 border-red-200',
};


/* Mobile card */
function PaymentCard({ p, fmt }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-slate-900 text-sm">{p.user_name}</p>
          <p className="text-xs text-slate-400">{p.user_email}</p>
        </div>
        <span className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${PAY_STYLE[p.payment_status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {p.payment_status}
        </span>
      </div>

      <p className="text-xs text-slate-600 font-medium bg-slate-50 px-3 py-2 rounded-xl line-clamp-2">{p.cohort_title}</p>

      <div className="flex items-center justify-between">
        <span className="text-lg font-black text-slate-800">₹{Number(p.amount_paid).toLocaleString('en-IN')}</span>
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Calendar size={11} />
          {fmt(p.enrolled_at)}
        </div>
      </div>

      {(p.payment_order_id || p.payment_id) && (
        <div className="text-[11px] text-slate-400 font-mono bg-slate-50 px-3 py-2 rounded-xl space-y-0.5">
          {p.payment_order_id && <div>Order: {p.payment_order_id}</div>}
          {p.payment_id && <div>Payment: {p.payment_id}</div>}
        </div>
      )}
    </div>
  );
}

export default function AdminPayments() {
  // ?tab=payouts (dashboard "Payout requests pending") opens the payouts tab.
  const [tab, setTab] = useState(() => (new URLSearchParams(window.location.search).get('tab') === 'payouts' ? 'payouts' : 'payments'));
  // A payout notification opened while already on this screen switches tabs too.
  const location = useLocation();
  useEffect(() => {
    if (new URLSearchParams(location.search).get('tab') === 'payouts') setTab('payouts');
  }, [location.key, location.search]);
  const [payments,   setPayments]   = useState([]);
  const [stats,      setStats]      = useState({});
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('');
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage,    setPerPage]    = useState(20);

  const load = useCallback((page = 1, status = filter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (status) params.status = status;
    api.get('/skovo-platform-panel-admin/payments', params)
      .then(({ data }) => {
        if (data.bool) {
          setPayments(data.response.payments || []);
          setStats(data.response.stats || {});
          setPagination(data.pagination || { total: 0, pages: 1, page: 1 });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filter, perPage]);

  useEffect(() => { load(1); }, []);

  const fmt = (iso) => iso
    ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
    : '—';

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">Payments & Payouts</h1>
        <p className="text-sm text-slate-500 mt-0.5">Revenue, transactions and achiever payouts</p>
      </div>

      <Tabs className="mb-5" active={tab} onChange={setTab} tabs={[
        { key: 'payments', label: 'Payments', icon: CreditCard },
        { key: 'payouts',  label: 'Achiever payouts', icon: Banknote },
      ]} />

      {tab === 'payouts' ? <PayoutsAdmin /> : (
      <>
      <MoneySummary
        headline={{ label: 'Net revenue', value: stats.net_revenue }}
        count={`${pagination.total || 0} transaction${pagination.total === 1 ? '' : 's'}`}
        active={filter} onSelect={(k) => { setFilter(k); load(1, k); }}
        items={[
          { key: 'paid', label: 'Collected', value: stats.total_revenue, tone: 'green' },
          { key: 'pending', label: 'Pending', value: stats.total_pending, tone: 'amber' },
          { key: 'refunded', label: 'Refunded', value: stats.total_refunded, tone: 'red' },
        ]} />

      {/* Mobile cards (always shown on small screens) */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-16 animate-pulse bg-white rounded-2xl border border-slate-100" />
            ))}
          </div>
        ) : payments.length === 0 ? (
          <TableShell>
            <EmptyState
              icon={IndianRupee}
              message="No payment transactions found"
              sub={filter ? 'Try a different filter' : 'Transactions will appear once students enroll'}
            />
          </TableShell>
        ) : (
          payments.map((p) => <PaymentCard key={p.id} p={p} fmt={fmt} />)
        )}
      </div>

      {/* Desktop table */}
      <div className="hidden lg:block">
        <TableShell>
          {loading ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <Th>S.No</Th>
                    <Th>Student</Th>
                    <Th>Cohort</Th>
                    <Th>Amount</Th>
                    <Th>Status</Th>
                    <Th>Order Id</Th>
                    <Th>Payment Id</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <LoadingRows cols={8} rows={6} />
              </table>
            </div>
          ) : payments.length === 0 ? (
            <EmptyState
              icon={IndianRupee}
              message="No payment transactions found"
              sub={filter ? 'Try a different filter' : 'Transactions will appear once students enroll'}
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <Th>S.No</Th>
                      <Th>Student</Th>
                      <Th>Cohort</Th>
                      <Th>Amount</Th>
                      <Th>Status</Th>
                      <Th>Order Id</Th>
                      <Th>Payment Id</Th>
                      <Th>Date</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                    {payments.map((p, idx) => (
                      <tr key={p.id} className="hover:bg-slate-50/70 transition-colors">
                        <Td className="text-xs text-slate-400 w-10">{(pagination.page - 1) * perPage + idx + 1}</Td>
                        <Td>
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                              {p.user_name?.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 text-xs">{p.user_name}</p>
                              <p className="text-slate-400 text-[11px]">{p.user_email}</p>
                            </div>
                          </div>
                        </Td>
                        <Td className="text-xs text-slate-600 max-w-40 truncate">{p.cohort_title}</Td>
                        <Td>
                          <span className="text-sm font-black text-slate-800">₹{Number(p.amount_paid).toLocaleString('en-IN')}</span>
                        </Td>
                        <Td>
                          <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border capitalize ${PAY_STYLE[p.payment_status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {p.payment_status}
                          </span>
                        </Td>
                        <Td className="text-xs text-slate-400 font-mono">{p.payment_order_id || '—'}</Td>
                        <Td className="text-xs text-slate-400 font-mono">{p.payment_id || '—'}</Td>
                        <Td className="text-xs text-slate-400 whitespace-nowrap">{fmt(p.enrolled_at)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pagination
                page={pagination.page}
                pages={pagination.pages}
                total={pagination.total}
                perPage={perPage}
                onPage={(p) => load(p)}
                onPerPage={(pp) => { setPerPage(pp); load(1, filter, pp); }}
              />
            </>
          )}
        </TableShell>
      </div>
      </>
      )}
    </div>
  );
}
