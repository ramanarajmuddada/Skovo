import React, { useEffect, useState, useCallback } from 'react';
import { Star, CheckCircle2, Trash2, Loader2, Eye, X } from 'lucide-react';
import { adminApi } from '../../services/api';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';

function StarRow({ value, max = 5 }) {
  if (!value) return <span className="text-xs text-slate-300">—</span>;
  return (
    <span className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} size={10} className={i < value ? 'text-amber-400 fill-amber-400' : 'text-slate-200 fill-slate-200 dark:text-slate-600 dark:fill-slate-600'} />
      ))}
      <span className="text-xs text-slate-500 ml-0.5">{value}</span>
    </span>
  );
}

function ReviewDetailModal({ item: a, onClose }) {
  if (!a) return null;
  const rows = [
    { label: 'College', value: a.college_name || '—' },
    { label: 'Student', value: a.author_name || '—' },
    { label: 'Email', value: a.author_email || '—' },
    { label: 'Rating', value: a.rating ? `${a.rating} / 5` : '—' },
    { label: 'Academics', value: a.academics_rating ? `${a.academics_rating} / 5` : '—' },
    { label: 'Placement', value: a.placement_rating ? `${a.placement_rating} / 5` : '—' },
    { label: 'Status', value: a.is_verified ? 'Verified' : 'Pending' },
    { label: 'Date', value: a.created_at ? new Date(a.created_at).toLocaleDateString() : '—' },
    { label: 'Review', value: a.review_text || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Review Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">{rows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between py-2 border-b border-slate-50 gap-4">
              <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
              <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
            </div>
          ))}</div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function ReviewRow({ review, onView, onVerify, onDelete, verifying, deleting }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <tr onClick={() => onView(review)} className={`hover:bg-slate-50 transition-colors cursor-pointer ${!review.is_active ? 'opacity-50 line-through' : ''}`}>
      <Td>
        <p className="font-semibold text-slate-900 truncate max-w-[160px]">{review.college_name}</p>
      </Td>
      <Td>
        <p className="font-medium text-slate-700 truncate max-w-[120px]">{review.author_name}</p>
        <p className="text-xs text-slate-400 truncate max-w-[120px]">{review.author_email}</p>
      </Td>
      <Td>
        <StarRow value={review.rating} />
      </Td>
      <Td className="hidden sm:table-cell text-xs text-slate-500">
        <div className="space-y-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 w-14 shrink-0">Academics</span><StarRow value={review.academics_rating} />
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 w-14 shrink-0">Placement</span><StarRow value={review.placement_rating} />
          </div>
        </div>
      </Td>
      <Td className="max-w-xs">
        <p className={`text-xs text-slate-600 ${expanded ? '' : 'line-clamp-2'}`}>{review.review_text || '—'}</p>
        {review.review_text && review.review_text.length > 100 && (
          <button onClick={e => { e.stopPropagation(); setExpanded(x => !x); }} className="text-xs text-indigo-500 mt-0.5 flex items-center gap-0.5">
            <Eye size={10} /> {expanded ? 'less' : 'more'}
          </button>
        )}
      </Td>
      <Td className="text-center">
        <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${review.is_verified ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
          {review.is_verified ? 'Verified' : 'Pending'}
        </span>
      </Td>
      <Td className="text-xs text-slate-400">
        {review.created_at ? new Date(review.created_at).toLocaleDateString() : '—'}
      </Td>
      <Td className="text-center" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-center gap-1">
          <ActionBtn icon={Eye} tooltip="View Details" onClick={() => onView(review)} color="indigo" />
          {verifying === review.id ? (
            <span className="w-7 h-7 flex items-center justify-center"><Loader2 size={13} className="animate-spin text-slate-400" /></span>
          ) : (
            <ActionBtn
              icon={CheckCircle2}
              tooltip={review.is_verified ? 'Unverify' : 'Verify'}
              onClick={() => onVerify(review.id)}
              disabled={!review.is_active}
              color={review.is_verified ? 'amber' : 'green'}
            />
          )}
          {deleting === review.id ? (
            <span className="w-7 h-7 flex items-center justify-center"><Loader2 size={13} className="animate-spin text-slate-400" /></span>
          ) : (
            <ActionBtn
              icon={Trash2}
              tooltip="Hide review"
              onClick={() => onDelete(review.id)}
              disabled={!review.is_active}
              color="red"
            />
          )}
        </div>
      </Td>
    </tr>
  );
}

export default function AdminCollegeReviews() {
  const [reviews,   setReviews]   = useState([]);
  const [total,     setTotal]     = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [filter,    setFilter]    = useState('all');
  const [page,      setPage]      = useState(1);
  const [perPage,   setPerPage]   = useState(20);
  const [verifying, setVerifying] = useState(null);
  const [deleting,  setDeleting]  = useState(null);
  const [view,      setView]      = useState(null);
  const [confirm,   setConfirm]   = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, per_page: perPage });
    if (filter === 'verified')   params.set('verified', 'true');
    if (filter === 'unverified') params.set('verified', 'false');
    adminApi.get(`/skovo-platform-panel-admin/college-reviews?${params}`)
      .then(({ data }) => { if (data.bool) { setReviews(data.response.reviews || []); setTotal(data.response.total || 0); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, filter, perPage]);

  useEffect(() => { load(); }, [load]);

  const handleVerify = async (id) => {
    setVerifying(id);
    try {
      const { data } = await adminApi.post(`/skovo-platform-panel-admin/college-reviews/${id}/verify`);
      if (data.bool) setReviews(prev => prev.map(r => r.id === id ? { ...r, is_verified: data.response.is_verified } : r));
    } catch {} finally { setVerifying(null); }
  };

  const handleDelete = async (id) => {
    setDeleting(id);
    try {
      await adminApi.delete(`/skovo-platform-panel-admin/college-reviews/${id}`);
      setReviews(prev => prev.map(r => r.id === id ? { ...r, is_active: false } : r));
    } catch {} finally { setDeleting(null); }
  };

  const pages = Math.ceil(total / perPage);

  return (
    <div className="p-4 sm:p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-black text-slate-900">College Reviews</h1>
        <p className="text-sm text-slate-400 mt-0.5">Moderate student reviews — verify genuine ones, hide inappropriate ones</p>
      </div>

      {/* Filter tabs */}
      <div className="grid grid-cols-3 sm:flex items-center gap-1 bg-slate-100 rounded-xl p-1 w-full sm:w-fit">
        {[
          { id: 'all',        label: 'All' },
          { id: 'unverified', label: 'Pending' },
          { id: 'verified',   label: 'Verified' },
        ].map(t => (
          <button key={t.id} onClick={() => { setFilter(t.id); setPage(1); }}
            className={`min-h-10 px-4 py-1.5 rounded-lg text-sm font-semibold transition-all ${filter === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <Th>College</Th>
                  <Th>Student</Th>
                  <Th>Rating</Th>
                  <Th className="hidden sm:table-cell">Sub-Ratings</Th>
                  <Th>Review</Th>
                  <Th className="text-center">Status</Th>
                  <Th>Date</Th>
                  <Th className="text-center">Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={5} />
            </table>
          </div>
        ) : reviews.length === 0 ? (
          <EmptyState icon={Star} message="No reviews found" />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <Th>College</Th>
                    <Th>Student</Th>
                    <Th>Rating</Th>
                    <Th className="hidden sm:table-cell">Sub-Ratings</Th>
                    <Th>Review</Th>
                    <Th className="text-center">Status</Th>
                    <Th>Date</Th>
                    <Th className="text-center">Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {reviews.map((r) => (
                    <ReviewRow
                      key={r.id}
                      review={r}
                      onView={setView}
                      onVerify={handleVerify}
                      onDelete={(id) => setConfirm(reviews.find(x => x.id === id) || { id })}
                      verifying={verifying}
                      deleting={deleting}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination
              page={page}
              pages={pages}
              total={total}
              perPage={perPage}
              onPage={(p) => setPage(p)}
              onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
            />
          </>
        )}
      </TableShell>

      {view && <ReviewDetailModal item={view} onClose={() => setView(null)} />}
      {confirm && (
        <ConfirmModal
          message="Hide this review from students?"
          detail="This cannot be undone."
          danger
          confirmLabel="Hide"
          onConfirm={() => { handleDelete(confirm.id); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
