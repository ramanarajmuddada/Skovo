import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, TrendingUp, TrendingDown } from 'lucide-react';

/**
 * The one stat tile for every admin screen (ui-patterns.md → Type scale & tiles).
 *
 *   label on its own line, the number with the icon beside it, then one short note.
 *   With `to`, the whole tile opens that screen; with onClick/active it is a filter.
 *   delta { by, vs } — change against the previous period. On a phone only
 *   the change shows ("+3", "No change"); from sm up it adds "vs yesterday".
 *
 * About 92px tall on a phone, so four tiles take two short rows.
 */
const TONES = {
  blue: 'bg-blue-50 text-blue-600',
  violet: 'bg-violet-50 text-violet-600',
  emerald: 'bg-emerald-50 text-emerald-600',
  amber: 'bg-amber-50 text-amber-600',
  red: 'bg-red-50 text-red-600',
};

function Delta({ by, vs, downIsGood }) {
  if (by === null || by === undefined || Number.isNaN(by)) return null;
  if (by === 0) {
    return <p className="text-[11px] text-slate-400 truncate">No change<span className="hidden sm:inline"> vs {vs}</span></p>;
  }
  const up = by > 0;
  const good = up !== Boolean(downIsGood);
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <p className={`flex items-center gap-1 text-[11px] font-semibold truncate ${good ? 'text-emerald-600' : 'text-red-500'}`}>
      <Icon size={12} className="shrink-0" /> {up ? '+' : ''}{by.toLocaleString('en-IN')}
      <span className="hidden sm:inline font-normal text-slate-400">vs {vs}</span>
    </p>
  );
}

export default function StatTile({ label, value, sub, icon: Icon, tone = 'blue', to, delta, onClick, active }) {
  // Words ("Class 10", "3 h ago") read at body size; only numbers get the big type.
  const isWords = typeof value === 'string' && !/^[₹\d.,\s%#+\-—]+$/.test(value);
  const body = (
    <>
      {/* Label gets the full width (never cut off at 320px); the icon sits
          beside the number instead. */}
      <div className="flex items-start gap-1.5 min-w-0">
        <p className="flex-1 min-w-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight">{label}</p>
        {to && <ArrowUpRight size={14} className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0" />}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className={`min-w-0 text-slate-900 break-words ${isWords
          ? 'text-base sm:text-lg font-bold leading-tight'
          : 'text-xl sm:text-2xl font-black tabular-nums leading-none'}`}>{value ?? '—'}</p>
        {Icon && (
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${TONES[tone] || TONES.blue}`}>
            <Icon size={14} />
          </span>
        )}
      </div>
      {(sub || delta) && (
        <div className="mt-1.5 min-w-0">
          {sub && <p className="text-xs text-slate-500 truncate">{sub}</p>}
          {delta && <Delta {...delta} />}
        </div>
      )}
    </>
  );
  const cls = 'group block bg-white rounded-2xl border border-slate-200 p-3 sm:p-4 min-w-0';
  // onClick + active: the tile is a filter (selected = violet ring).
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={Boolean(active)}
              className={`${cls} w-full text-left transition-all ${active ? 'border-violet-500 ring-1 ring-violet-500' : 'hover:border-slate-300 hover:shadow-sm'}`}>
        {body}
      </button>
    );
  }
  return to
    ? <Link to={to} className={`${cls} hover:border-slate-300 hover:shadow-sm transition-all`}>{body}</Link>
    : <div className={cls}>{body}</div>;
}
