import React, { useCallback, useEffect, useState } from 'react';
import { Star, MessageSquare } from 'lucide-react';
import { achieverApi } from '../../services/api';
import { Skeleton, ErrorState, EmptyState } from '../../components/ui/index.jsx';

/** Every rating and review students have left this achiever. Read-only: the
    person being reviewed cannot edit or hide feedback. */

const when = (s) => (s ? new Date(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function Stars({ value, size = 15 }) {
  return (
    <span className="inline-flex items-center gap-0.5" role="img" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} size={size}
              className={n <= Math.round(value) ? 'fill-amber-400 text-amber-400' : 'text-slate-200'} />
      ))}
    </span>
  );
}

export default function AchieverReviews() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    achieverApi.get('/achievers/portal/reviews')
      .then(({ data: d }) => { if (d?.bool) { setData(d.response); setFailed(false); } else setFailed(true); })
      .catch(() => setFailed(true));
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Reviews</h1>
        <p className="text-sm text-slate-500 mt-1">What students said about your cohorts and sessions.</p>
      </div>

      {failed ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <ErrorState title="We couldn't load your reviews" subtitle="Your reviews are safe — this is a connection problem." onRetry={load} />
        </div>
      ) : !data ? (
        <div className="space-y-3"><Skeleton className="h-32" /><Skeleton className="h-24" /></div>
      ) : data.reviews.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState icon={MessageSquare} title="No reviews yet"
                      subtitle="Students can rate a cohort once it is completed." />
        </div>
      ) : (
        <>
          <div className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col sm:flex-row gap-5 sm:items-center">
            <div className="text-center sm:w-40 shrink-0">
              <p className="text-4xl font-black text-slate-900">{data.avg_rating ?? '—'}</p>
              <Stars value={data.avg_rating || 0} size={18} />
              <p className="text-xs text-slate-500 mt-1">{data.count} review{data.count === 1 ? '' : 's'}</p>
            </div>
            <div className="flex-1 space-y-1.5">
              {[5, 4, 3, 2, 1].map((n) => {
                const c = data.breakdown?.[String(n)] || 0;
                return (
                  <div key={n} className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="w-8 shrink-0">{n} ★</span>
                    <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-amber-400 rounded-full" style={{ width: `${data.count ? (c / data.count) * 100 : 0}%` }} />
                    </div>
                    <span className="w-6 text-right tabular-nums">{c}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <ul className="space-y-3">
            {data.reviews.map((r) => (
              <li key={r.id} className="bg-white rounded-2xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900 break-words">{r.student_name}</p>
                    <p className="text-xs text-slate-500 break-words">
                      {r.cohort_title || (r.context_type === 'session' ? '1-on-1 session' : 'General review')}
                      {r.created_at ? ` · ${when(r.created_at)}` : ''}
                    </p>
                  </div>
                  <Stars value={r.rating} />
                </div>
                {r.review_text
                  ? <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap break-words">{r.review_text}</p>
                  : <p className="text-xs text-slate-400 italic mt-2">No written feedback.</p>}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
