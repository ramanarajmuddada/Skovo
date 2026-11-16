import React from 'react';

/**
 * On/off switch with its state spelled out beside it ("Active" / "Inactive").
 *
 * A bare checkbox reads as "tick to agree"; a switch reads as a setting, and
 * the text says which way it is set without the reader decoding the colour.
 * The whole row is the tap target (min-h-11), not just the 44px track.
 */
export default function ToggleSwitch({ checked, onChange, onLabel = 'Active', offLabel = 'Inactive', disabled = false, id }) {
  return (
    <button
      type="button" role="switch" id={id}
      aria-checked={!!checked} disabled={disabled}
      onClick={() => onChange?.(!checked)}
      className="inline-flex items-center gap-3 min-h-11 text-sm font-semibold disabled:opacity-50"
    >
      <span className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${checked ? '' : 'bg-slate-300'}`}
            style={checked ? { backgroundColor: 'var(--accent)' } : undefined}>
        {/* Inline white: dark mode repaints .bg-white, which turned the knob navy. */}
        <span className={`inline-block h-5 w-5 rounded-full shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`}
              style={{ backgroundColor: '#fff' }} />
      </span>
      <span className={checked ? 'text-emerald-600' : 'text-slate-500'}>{checked ? onLabel : offLabel}</span>
    </button>
  );
}
