/**
 * Reviews for one cohort, or for an achiever's 1-on-1s: a rating summary with
 * star bars, sort (Newest / Highest / Lowest) and 5 at a time with Show more,
 * so 1,000 reviews stay readable. Reads the public reviews API (no login).
 */
import React, { useEffect, useState } from 'react';
import { Star, Loader2 } from 'lucide-react';
import { api } from '../../services/api';

const day = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function ReviewsBlock({ achiever, cohortId, source, emptyText = 'No reviews yet.' }) {
  const [sort, setSort] = useState('newest');
  const [state, setState] = useState({ items: [], page: 0, hasMore: false, summary: null, loading: true, key: '' });
  const key = `${achiever}|${cohortId || ''}|${source || ''}|${sort}`;

  const load = (page, reset) => {
    api.get(`/achievers/${achiever}/public/reviews`, {
      ...(cohortId ? { cohort_id: cohortId } : {}), ...(source ? { source } : {}), sort, page, per_page: 5,
    }).then(({ data }) => {
      const r = data?.bool ? data.response : { items: [], has_more: false, summary: null };
      setState((s) => ({ items: reset ? r.items : [...s.items, ...r.items], page, hasMore: r.has_more, summary: r.summary || s.summary, loading: false, key }));
    }).catch(() => setState((s) => ({ ...s, loading: false, key })));
  };
  // A new cohort / source / sort starts over (adjusting state during render).
  if (state.key !== key && !state.loading) setState((s) => ({ ...s, loading: true }));
  useEffect(() => { load(1, true); }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = state.summary;
  if (state.loading && !state.items.length) return <p className="text-sm text-slate-400 flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading reviews…</p>;
  if (!sum || !sum.count) return <p className="text-sm text-slate-500">{emptyText}</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-4 sm:items-center">
        <div className="shrink-0 text-center sm:text-left">
          <p className="text-3xl font-black text-slate-900 leading-none">{sum.avg}</p>
          <p className="text-xs text-slate-500 mt-1 flex items-center justify-center sm:justify-start gap-1">
            <Star size={12} fill="currentColor" className="text-amber-500" /> {sum.count} review{sum.count === 1 ? '' : 's'}
          </p>
        </div>
        <div className="flex-1 space-y-1">
          {[5, 4, 3, 2, 1].map((n) => {
            const c = sum.stars?.[n] || 0;
            return (
              <div key={n} className="flex items-center gap-2 text-xs text-slate-500">
                <span className="w-6 shrink-0">{n}★</span>
                <span className="flex-1 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <span className="block h-full rounded-full bg-amber-500" style={{ width: `${(c / sum.count) * 100}%` }} />
                </span>
                <span className="w-8 shrink-0 text-right tabular-nums">{c}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Sort reviews">
        {[['newest', 'Newest'], ['highest', 'Highest'], ['lowest', 'Lowest']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setSort(k)}
                  className={`min-h-9 px-3 rounded-full text-xs font-semibold ${sort === k ? 'text-white' : 'bg-slate-100 text-slate-600'}`}
                  style={sort === k ? { backgroundColor: 'var(--accent)' } : undefined}>{l}</button>
        ))}
      </div>

      <div className="divide-y divide-slate-100">
        {state.items.map((r) => (
          <div key={r.id} className="py-3 first:pt-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">{r.student_name}</span>
              <span className="text-xs font-semibold text-amber-600 inline-flex items-center gap-0.5"><Star size={11} fill="currentColor" /> {r.rating}</span>
              <span className="text-xs text-slate-400 ml-auto">{day(r.created_at)}</span>
            </div>
            {r.text ? <p className="text-sm text-slate-600 mt-1 leading-relaxed">{r.text}</p> : <p className="text-xs text-slate-400 italic mt-1">No comment</p>}
          </div>
        ))}
      </div>
      {state.hasMore && (
        <button type="button" onClick={() => load(state.page + 1, false)}
                className="w-full min-h-11 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
          Show more reviews
        </button>
      )}
    </div>
  );
}
