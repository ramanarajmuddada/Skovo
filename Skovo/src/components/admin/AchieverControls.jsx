import React from 'react';
import { Minus, Plus } from 'lucide-react';

/**
 * The two achiever controls that have to read the same on every screen.
 *
 * Both existed in more than one place and disagreed with themselves. Seats were
 * a radio pair in the approve dialog and a bare number box on the case file,
 * where blank silently meant unlimited — the same decision asked two ways, and
 * the second way never says what blank does until after you have saved it. The
 * demo target could only be typed, and only ever added to.
 */

export const MIN_SEATS = 1;
export const MAX_SEATS = 1000;

// The demo box had `min` and no `max`, which a number input reports to
// assistive tech as a range of 1 to 0 -- a screen reader reading the field
// announces "2 of 0". A ceiling also stops the + button running forever; 50
// unpaid demos is already far past any real target.
export const MAX_DEMOS = 50;

/**
 * Seats per cohort: a number, or explicitly Unlimited.
 *
 * `value` is '' for unlimited and a string number otherwise, which is what both
 * callers already hold. Unlimited is a radio you choose, never an empty box you
 * leave — "no cap" and "I have not typed it yet" are different intentions and
 * the old input could not tell them apart.
 */
export function SeatAllocationField({ value, onChange, idPrefix = 'seat', disabled = false,
                                      allowUnset = false }) {
  // `allowUnset` is for the approve dialog, where the admin has not answered yet.
  //
  // Everywhere else the achiever already has an allocation, so '' genuinely
  // means Unlimited and showing that radio selected is correct. At approval
  // nothing has been chosen, and defaulting the selection to Unlimited would
  // put "uncapped" one click from happening by accident on a person nobody has
  // decided about. With allowUnset, null/undefined leaves both radios empty and
  // the caller can refuse to submit until one is picked.
  const unset = allowUnset && (value === null || value === undefined);
  const unlimited = !unset && (value === '' || value === null || value === undefined);
  const name = `${idPrefix}-mode`;

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
        <input type="radio" name={name} value="limited"
               checked={!unset && !unlimited}
               disabled={disabled}
               onChange={() => onChange(String(MIN_SEATS))}
               className="w-4 h-4 shrink-0" />
        <span className="shrink-0">Limited to</span>
        <input
          id={`${idPrefix}-count`} type="number"
          min={MIN_SEATS} max={MAX_SEATS} step="1"
          value={unset || unlimited ? '' : value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. 5"
          aria-label="Students per cohort"
          className="w-20 min-w-0 min-h-11 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm tabular-nums
                     focus:outline-none focus:ring-2 focus:ring-blue-300 disabled:opacity-50" />
        <span className="shrink-0">students</span>
      </label>
      <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
        <input type="radio" name={name} value="unlimited"
               checked={!unset && unlimited}
               disabled={disabled}
               onChange={() => onChange('')}
               className="w-4 h-4 shrink-0" />
        <span>Unlimited</span>
      </label>
    </div>
  );
}

/**
 * How many demos they need — with steppers, because the everyday edit is
 * "13 is too many, make it 12" and that should not require selecting a field
 * and retyping a number.
 *
 * `value` is the raw string so a half-typed box does not fight the user.
 */
export function DemoTargetField({ value, onChange, done = 0, id = 'demo-target', disabled = false }) {
  const n = Number(value);
  const valid = Number.isInteger(n) && n >= 1;
  const step = (by) =>
    onChange(String(Math.min(MAX_DEMOS, Math.max(1, (valid ? n : done || 1) + by))));

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => step(-1)}
                disabled={disabled || (valid && n <= 1)}
                aria-label="One fewer demo"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-slate-200
                           text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
          <Minus size={16} />
        </button>
        <input
          id={id} type="number" min="1" max={MAX_DEMOS} step="1"
          value={value}
          disabled={disabled}
          onChange={e => onChange(e.target.value)}
          placeholder="e.g. 5"
          aria-label="Demos required"
          className="w-full min-w-0 min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                     text-center tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300
                     disabled:opacity-50" />
        <button type="button" onClick={() => step(1)}
                disabled={disabled || (valid && n >= MAX_DEMOS)}
                aria-label="One more demo"
                className="w-11 h-11 shrink-0 flex items-center justify-center rounded-xl border border-slate-200
                           text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors">
          <Plus size={16} />
        </button>
      </div>
      {valid && (
        <p className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
          Their target becomes {n} demo{n === 1 ? '' : 's'}, {done} already done.
        </p>
      )}
    </div>
  );
}
