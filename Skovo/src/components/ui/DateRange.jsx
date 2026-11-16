import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

/**
 * From-date → to-date range picker.
 *
 * The dashboards were filtered by a "Last 30 days" dropdown, which can only
 * answer questions that end today. It cannot answer "how did March go", and
 * every reporting question eventually is one.
 *
 * Presets stay, because "last 30 days" is still the common case and making
 * someone pick two dates for it would be a downgrade. They are shortcuts that
 * write into the same two fields, not a separate mode — so the control always
 * shows the actual range in effect, however it was chosen.
 *
 *   <DateRange value={{ from, to }} onChange={({ from, to }) => …} />
 *
 * Values are `YYYY-MM-DD` strings throughout: that is what `<input type="date">`
 * reads and writes, and what the API takes, so nothing is ever parsed into a
 * Date only to be formatted back.
 */

const iso = (d) => {
  // Local date parts, not toISOString() — that converts to UTC first, which in
  // IST (+5:30) turns any time before 05:30 into the previous day.
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const daysAgo = (n) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
};

// Inclusive ranges: "last 7 days" is today plus the six before it, so the label
// and the number of points on the chart agree.
export const RANGE_PRESETS = [
  { label: 'Today',         from: () => iso(new Date()), to: () => iso(new Date()) },
  { label: 'Last 7 days',   from: () => daysAgo(6),   to: () => iso(new Date()) },
  { label: 'Last 30 days',  from: () => daysAgo(29),  to: () => iso(new Date()) },
  { label: 'Last 90 days',  from: () => daysAgo(89),  to: () => iso(new Date()) },
  { label: 'Last year',     from: () => daysAgo(364), to: () => iso(new Date()) },
  {
    label: 'This month',
    from: () => { const d = new Date(); d.setDate(1); return iso(d); },
    to:   () => iso(new Date()),
  },
  {
    label: 'Last month',
    from: () => { const d = new Date(); d.setMonth(d.getMonth() - 1, 1); return iso(d); },
    to:   () => { const d = new Date(); d.setDate(0); return iso(d); },   // day 0 = last of prev month
  },
];

// Last 7 days on open — the window an achiever checks most often.
export const defaultRange = () => ({ from: daysAgo(6), to: iso(new Date()) });

const pretty = (s) => {
  if (!s) return '—';
  const d = new Date(s + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// `anyLabel` (e.g. "Any time") makes an empty range valid: it shows that label
// and offers it as the first choice. Without it, a range is always required.
export default function DateRange({ value, onChange, className = '', align = 'right', anyLabel }) {
  const { from = '', to = '' } = value || {};
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ from, to });
  const wrapRef = useRef(null);

  // Reopening always starts from what is actually applied, so an abandoned edit
  // never leaks into the next one.
  useEffect(() => { if (open) setDraft({ from, to }); }, [open, from, to]);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const today = iso(new Date());
  const apply = (next) => {
    // Swap rather than reject: picking the end date first is a normal way to
    // use two fields, and refusing it would just be a scolding.
    const fixed = next.from && next.to && next.from > next.to
      ? { from: next.to, to: next.from }
      : next;
    onChange?.(fixed);
    setOpen(false);
  };

  const activePreset = RANGE_PRESETS.find((p) => p.from() === from && p.to() === to);

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className="w-full flex items-center gap-2 text-sm font-semibold text-slate-700 bg-white
                   border border-slate-200 rounded-xl px-3 py-2.5 hover:border-slate-300
                   focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500
                   transition-colors"
      >
        <Calendar size={15} className="text-slate-400 shrink-0" />
        <span className="truncate">
          {anyLabel && !from && !to ? anyLabel : activePreset ? activePreset.label : `${pretty(from)} – ${pretty(to)}`}
        </span>
        <ChevronDown size={15}
                     className={`ml-auto text-slate-400 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div role="dialog" aria-label="Choose a date range"
             // Phone: exactly the trigger's width, so it can never run past the
             // screen edge (a 304px panel beside a 246px trigger did, and pushed
             // Apply off-screen). From sm up, the fixed 304px panel.
             className={`absolute z-50 mt-2 w-full sm:w-76 sm:max-w-[calc(100vw-2rem)] bg-white border border-slate-200 rounded-2xl shadow-xl p-3
                         ${align === 'right' ? 'right-0' : 'left-0'}`}>
          <div className="grid grid-cols-2 gap-1.5">
            {anyLabel && (
              <button type="button" onClick={() => { onChange?.({ from: '', to: '' }); setOpen(false); }}
                      className={`col-span-2 text-xs font-semibold rounded-lg px-2.5 py-2 text-left transition-colors ${
                        !from && !to ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'text-slate-600 hover:bg-slate-50'}`}>
                {anyLabel}
              </button>
            )}
            {RANGE_PRESETS.map((p) => {
              const on = activePreset?.label === p.label;
              return (
                <button
                  key={p.label} type="button"
                  onClick={() => apply({ from: p.from(), to: p.to() })}
                  className={`text-xs font-semibold rounded-lg px-2.5 py-2 text-left transition-colors ${
                    on ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200'
                       : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          <div className="h-px bg-slate-100 my-3" />

          {/* Stacked on a phone: two date boxes side by side need ~270px. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">From</span>
              <input
                type="date" value={draft.from} max={today}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wide">To</span>
              <input
                type="date" value={draft.to} max={today}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))}
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-2.5 py-2
                           focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500"
              />
            </label>
          </div>

          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={() => setOpen(false)}
                    className="flex-1 text-sm font-semibold text-slate-600 rounded-lg px-3 py-2 hover:bg-slate-50">
              Cancel
            </button>
            <button type="button"
                    disabled={!draft.from || !draft.to}
                    onClick={() => apply(draft)}
                    className="flex-1 text-sm font-bold text-white bg-blue-600 rounded-lg px-3 py-2
                               hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed">
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
