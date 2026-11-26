import React from 'react';

/**
 * The seat control, which has to read the same on every screen: the approve
 * dialog and the Manage tab ask the same question the same way.
 */

export const MIN_SEATS = 1;
export const MAX_SEATS = 1000;

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
