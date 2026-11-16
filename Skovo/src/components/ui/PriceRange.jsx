/**
 * Min–max price slider with two handles and two typed boxes underneath.
 *
 * The ends come from real prices (lowest to highest listed), so the slider is
 * never a fixed ₹500 / ₹1,000 that matches nothing. `value` is
 * { min, max } in rupees; reaching both ends means "any price". `onChange`
 * fires when a handle is let go or a box is left, not on every pixel.
 */
import React, { useState } from 'react';

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN')}`;

export default function PriceRange({ bounds, value, onChange, step = 1 }) {
  const lo = Math.floor(Number(bounds?.min ?? 0));
  const hi = Math.max(lo + step, Math.ceil(Number(bounds?.max ?? 0)));
  const [draft, setDraft] = useState({ min: value?.min ?? lo, max: value?.max ?? hi });
  // Reset the handles when the applied value or the price ends change
  // (adjusting state during render, not in an effect).
  const key = `${value?.min ?? ''}|${value?.max ?? ''}|${lo}|${hi}`;
  const [seen, setSeen] = useState(key);
  if (seen !== key) {
    setSeen(key);
    setDraft({ min: value?.min ?? lo, max: value?.max ?? hi });
  }

  // Every listed achiever has the same price (today: all free): nothing to slide.
  if (Number(bounds?.max ?? 0) <= Number(bounds?.min ?? 0)) {
    return (
      <p className="text-xs text-slate-500 rounded-xl border border-slate-200 px-3 py-2.5">
        {Number(bounds?.max ?? 0) > 0
          ? `Every achiever charges ${inr(bounds.max)} per session right now.`
          : 'Every achiever is free right now.'}
      </p>
    );
  }

  const clamp = (v) => Math.min(hi, Math.max(lo, Number.isFinite(+v) ? +v : lo));
  const commit = (d) => {
    const min = Math.min(clamp(d.min), clamp(d.max));
    const max = Math.max(clamp(d.min), clamp(d.max));
    setDraft({ min, max });
    onChange?.(min <= lo && max >= hi ? null : { min, max });
  };
  const pct = (v) => ((v - lo) / (hi - lo)) * 100;
  const thumb = 'absolute inset-x-0 top-1/2 -translate-y-1/2 w-full appearance-none bg-transparent pointer-events-none '
    + '[&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 '
    + '[&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white '
    + '[&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[var(--accent)] [&::-webkit-slider-thumb]:shadow '
    + '[&::-moz-range-thumb]:pointer-events-auto [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full '
    + '[&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[var(--accent)]';

  return (
    <div className="space-y-3">
      <div className="relative h-8">
        <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 h-1.5 rounded-full bg-slate-200" />
        <div className="absolute top-1/2 -translate-y-1/2 h-1.5 rounded-full"
             style={{ left: `${pct(draft.min)}%`, right: `${100 - pct(draft.max)}%`, backgroundColor: 'var(--accent)' }} />
        <input type="range" min={lo} max={hi} step={step} value={draft.min} aria-label="Minimum price"
               onChange={(e) => setDraft((d) => ({ ...d, min: Math.min(+e.target.value, d.max) }))}
               onMouseUp={() => commit(draft)} onTouchEnd={() => commit(draft)} onKeyUp={() => commit(draft)}
               className={thumb} />
        <input type="range" min={lo} max={hi} step={step} value={draft.max} aria-label="Maximum price"
               onChange={(e) => setDraft((d) => ({ ...d, max: Math.max(+e.target.value, d.min) }))}
               onMouseUp={() => commit(draft)} onTouchEnd={() => commit(draft)} onKeyUp={() => commit(draft)}
               className={thumb} />
      </div>
      <div className="flex items-center gap-2">
        {['min', 'max'].map((k, i) => (
          <React.Fragment key={k}>
            {i === 1 && <span className="text-slate-400 text-sm">to</span>}
            <label className="flex-1 min-w-0">
              <span className="sr-only">{k === 'min' ? 'Minimum' : 'Maximum'} price</span>
              <span className="flex items-center min-h-11 px-3 border border-slate-200 rounded-xl bg-white">
                <span className="text-sm text-slate-400 mr-1">₹</span>
                <input type="number" inputMode="numeric" min={lo} max={hi} value={draft[k]}
                       onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
                       onBlur={() => commit(draft)} onKeyDown={(e) => { if (e.key === 'Enter') commit(draft); }}
                       className="w-full min-w-0 bg-transparent text-base sm:text-sm focus:outline-none" />
              </span>
            </label>
          </React.Fragment>
        ))}
      </div>
      <p className="text-[11px] text-slate-400">Prices on SKOVO now: {inr(lo)} to {inr(hi)} per session</p>
    </div>
  );
}
