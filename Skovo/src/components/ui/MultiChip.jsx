import React from 'react';

/**
 * Multi-select chip group.
 *
 * Promoted out of AchieverCohorts.jsx and AchieverCourses.jsx, where it existed
 * as two byte-identical copies. Both call sites now import this one.
 *
 * Options arrive as {value,label} from master data. The chip shows the label
 * and stores the value — that distinction is the whole point: a Telangana
 * achiever sees "BiPC" while the cohort stores "science_pcb", which is what the
 * student's profile holds and what the targeting engine compares. Passing bare
 * strings still works; they become their own label.
 */
export default function MultiChip({ label, options, selected = [], onChange, note }) {
  const toggle = (v) =>
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);

  const list = (options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));

  return (
    <div>
      <p className="text-xs font-semibold text-slate-600 mb-1.5">
        {label} {note && <span className="font-normal text-slate-400">({note})</span>}
      </p>
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-xs text-slate-400">Loading…</span>}
        {list.map((o) => (
          <button key={o.value} type="button" onClick={() => toggle(o.value)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-full border transition-all ${
              selected.includes(o.value) ? 'chip-active' : 'border-slate-200 text-slate-500 hover:border-slate-300'
            }`}>
            {selected.includes(o.value) && '✓ '}{o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
