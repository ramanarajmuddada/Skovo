import React from 'react';
import { Link } from 'react-router-dom';
import { Crown } from 'lucide-react';

/**
 * Shared "take Pro" strip. Same copy and CTA on every free-tier cap so every
 * student sees the same rule — the number comes from Admin → Subscriptions.
 */
export default function ProUpgradeBanner({
  used,
  limit,
  noun = 'items',
  extra,
  fullLabel,
  remainingLabel,
}) {
  if (limit == null) return null;
  const n = Number(limit);
  const u = Number(used || 0);
  const full = u >= n;
  const title = full
    ? (fullLabel || `You've used all ${n} free ${noun}. Take Skovo Pro.`)
    : (remainingLabel || `${u} of ${n} free ${noun} used`);
  return (
    <div
      className="rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
      style={{
        // A light accent tint, not var(--card): that is neutral grey in dark
        // mode and sat oddly among the slate cards around it.
        borderColor: full ? 'var(--accent)' : 'color-mix(in srgb, var(--accent) 25%, transparent)',
        background: `color-mix(in srgb, var(--accent) ${full ? 10 : 6}%, transparent)`,
      }}
    >
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-800">{title}</p>
        {extra && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{extra}</p>}
      </div>
      <Link
        to="/skovo-pro"
        className="shrink-0 w-full sm:w-auto min-h-11 px-3.5 py-2 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-opacity hover:opacity-90"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        <Crown size={13} /> Take Skovo Pro
      </Link>
    </div>
  );
}

export function TakeProLink({ children = 'Take Skovo Pro', className = '' }) {
  return (
    <Link
      to="/skovo-pro"
      className={`inline-flex items-center gap-1 font-bold underline ${className}`}
      style={{ color: 'var(--accent)' }}
    >
      {children}
    </Link>
  );
}
