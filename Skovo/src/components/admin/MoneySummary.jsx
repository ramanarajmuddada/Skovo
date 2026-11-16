import React from 'react';

/**
 * Money at a glance + the status filter, in one card.
 *
 *   headline  { label, value }            the number that matters most
 *   items     [{ key, label, value, tone }] one tile per status; tapping one filters the list
 *   active    selected key ('' = all)
 *   onSelect  (key) => void
 *   count     e.g. "12 transactions" for the current filter
 *
 * The bar shows how the money splits across the statuses, so a big "failed"
 * or "pending" share stands out before anyone reads a number.
 */
const TONE = {
  green: { dot: 'bg-emerald-500', text: 'text-emerald-700' },
  amber: { dot: 'bg-amber-500', text: 'text-amber-700' },
  blue:  { dot: 'bg-blue-500', text: 'text-blue-700' },
  red:   { dot: 'bg-red-500', text: 'text-red-700' },
  slate: { dot: 'bg-slate-400', text: 'text-slate-700' },
};
// Tiles fill the row exactly: All + one per status.
const LG_COLS = { 4: 'sm:grid-cols-4', 5: 'sm:grid-cols-5', 6: 'sm:grid-cols-3 lg:grid-cols-6' };
const rupees = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function MoneySummary({ headline, items, active, onSelect, count }) {
  const sum = items.reduce((a, i) => a + Math.max(0, Number(i.value || 0)), 0);
  const tile = (key, label, value, tone) => {
    const on = active === key;
    const t = TONE[tone] || TONE.slate;
    return (
      <button key={key || 'all'} type="button" onClick={() => onSelect(key)} aria-pressed={on}
              className={`min-h-16 rounded-xl px-3 py-2 text-left border transition-colors ${
                on ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-slate-200 hover:border-slate-300'}`}>
        <span className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
          {tone && <i className={`w-2 h-2 rounded-full shrink-0 ${t.dot}`} />} {label}
        </span>
        <span className={`block mt-0.5 text-base font-black tabular-nums break-words ${tone ? t.text : 'text-slate-900'}`}>
          {value === null ? '' : rupees(value)}
        </span>
      </button>
    );
  };
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4 mb-4">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">{headline.label}</p>
          <p className="text-3xl font-black text-slate-900 tabular-nums break-words">{rupees(headline.value)}</p>
        </div>
        {count && <span className="text-xs text-slate-400 shrink-0 pb-1">{count}</span>}
      </div>
      <div className="mt-3 h-2.5 rounded-full bg-slate-100 overflow-hidden flex" aria-hidden="true">
        {sum > 0 && items.map((i) => Number(i.value) > 0 && (
          <span key={i.key} className={TONE[i.tone]?.dot || TONE.slate.dot} style={{ width: `${(Number(i.value) / sum) * 100}%` }} />
        ))}
      </div>
      <div role="group" aria-label="Filter by status" className={`mt-4 grid grid-cols-2 gap-2 ${LG_COLS[items.length + 1] || 'sm:grid-cols-3 lg:grid-cols-6'}`}>
        {tile('', 'All', null)}
        {items.map((i) => tile(i.key, i.label, i.value, i.tone))}
      </div>
    </section>
  );
}
