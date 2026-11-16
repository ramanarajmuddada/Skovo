import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, MoreVertical, AlertTriangle, RotateCw } from 'lucide-react';

/**
 * Shared overlays and states — the four pieces `index.jsx` did not already have.
 *
 * Everything else a screen needs (Card, Button, PageHeader, EmptyState,
 * Skeleton, Modal, StatCard, Toast, Pagination, SearchBar, FilterPills) already
 * lives in `index.jsx`. These are the gaps:
 *
 *   Drawer        — side panel for detail/edit without leaving the list. The
 *                   spec asks for drawers on Bookings and My Cohorts; screens
 *                   were reaching for full-screen modals instead.
 *   ActionMenu    — overflow menu. The spec's mobile rule is "one primary
 *                   action plus an overflow menu", which had nothing to build on.
 *   ErrorState    — a failed fetch currently renders through EmptyState, which
 *                   tells the user "nothing here" when the truth is "we could
 *                   not load it". Those need different words and a retry.
 *   ToastProvider — `Toast` in index.jsx is presentational only, so every screen
 *                   invented its own `toast` state and timer. This owns that.
 *
 * Re-exported from `components/ui/index.jsx`, so callers keep one import site.
 */

/* ─── Drawer ──────────────────────────────────────────────────────────────
 * Right-hand panel on desktop; a bottom sheet under `md`, because a 400px side
 * panel on a 390px phone is just a broken modal.
 */
export function Drawer({
  open, onClose, title, subtitle, children, footer, width = 'md',
}) {
  const widths = {
    sm: 'md:max-w-md',
    md: 'md:max-w-xl',
    lg: 'md:max-w-3xl',
    xl: 'md:max-w-5xl',
  };

  // Escape closes, and the page behind must not scroll while it is open.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex md:justify-end" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm mo-in" onClick={onClose} />

      <div className={`relative bg-white w-full ${widths[width]} flex flex-col shadow-2xl
                       mt-auto md:mt-0 max-h-[90vh] md:max-h-none md:h-full
                       rounded-t-2xl md:rounded-none mo-pop`}>
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-slate-900 truncate">{title}</h2>
            {subtitle && <p className="text-sm text-slate-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>

        {footer && (
          <div className="px-5 py-4 border-t border-slate-100 shrink-0 bg-slate-50/60">{footer}</div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* ─── ActionMenu ──────────────────────────────────────────────────────────
 * Overflow menu. Positioned with a portal so it is never clipped by a table's
 * `overflow-x-auto` — which is exactly where these get used.
 */
export function ActionMenu({ items = [], label = 'More actions' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const btnRef = useRef(null);

  const place = useCallback(() => {
    const r = btnRef.current?.getBoundingClientRect();
    if (!r) return;
    // Flip left when the menu would run off the right edge.
    setPos({ top: r.bottom + 6, left: Math.min(r.left, window.innerWidth - 200) });
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    place();
    const close = () => setOpen(false);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, place]);

  const visible = items.filter(Boolean);
  if (!visible.length) return null;

  return (
    <>
      <button ref={btnRef} type="button" aria-label={label} aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors">
        <MoreVertical size={16} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed z-50 w-48 bg-white rounded-xl border border-slate-200 shadow-xl py-1 mo-pop"
            style={{ top: pos.top, left: pos.left }}>
            {visible.map((it, i) => (
              <button key={i} type="button" disabled={it.disabled}
                onClick={() => { setOpen(false); it.onClick?.(); }}
                className={`w-full text-left px-3.5 py-2 text-sm flex items-center gap-2.5 transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${it.danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-700 hover:bg-slate-50'}`}>
                {it.icon && <it.icon size={14} />}
                {it.label}
              </button>
            ))}
          </div>
        </>,
        document.body,
      )}
    </>
  );
}

/* ─── ErrorState ──────────────────────────────────────────────────────────
 * Distinct from EmptyState on purpose. "No bookings yet" and "we couldn't load
 * your bookings" are different facts, and showing the first when the second is
 * true hides an outage from the person it affects.
 */
export function ErrorState({
  title = "We couldn't load this",
  subtitle = 'Something went wrong on our side. Try again in a moment.',
  onRetry,
  compact = false,
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-8' : 'py-12'}`}>
      <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
        <AlertTriangle size={22} className="text-red-500" />
      </div>
      <p className="text-base font-semibold text-slate-700">{title}</p>
      <p className="text-sm text-slate-400 mt-1 max-w-xs">{subtitle}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="mt-5 inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-700 hover:border-slate-400 transition-colors">
          <RotateCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

/* ─── Toasts ──────────────────────────────────────────────────────────────
 * `Toast` in index.jsx renders a message; it does not own the message. That is
 * why several screens each carry their own `const [toast, setToast]` plus a
 * setTimeout. This provider owns the queue and the timers.
 *
 *   const toast = useToast();
 *   toast.success('Cohort created');
 *   toast.error('Could not save');
 */
const ToastCtx = React.createContext(null);

export function ToastProvider({ children, duration = 3000 }) {
  const [items, setItems] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setItems((list) => list.filter((t) => t.id !== id));
    const handle = timers.current.get(id);
    if (handle) { clearTimeout(handle); timers.current.delete(id); }
  }, []);

  const push = useCallback((message, type = 'success') => {
    if (!message) return undefined;
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setItems((list) => [...list, { id, message, type }]);
    timers.current.set(id, setTimeout(() => dismiss(id), duration));

    // Announce it. MainLayout mounts #a11y-live-region empty and permanently,
    // because a live region created at the same moment as its first message is
    // frequently not announced at all — but nothing was ever writing to it, so
    // every toast in the app was silent to a screen reader while the comment
    // above that div claimed otherwise. Written imperatively rather than by
    // rendering into it: the region has to pre-exist the message, which is the
    // whole reason it lives in the layout and not in this portal.
    try {
      const live = document.getElementById('a11y-live-region');
      if (live) {
        // Clearing first forces a change even when the same message repeats —
        // an identical textContent is not a mutation and announces nothing.
        live.textContent = '';
        window.requestAnimationFrame(() => {
          live.textContent = type === 'error' ? `Error: ${message}` : message;
        });
      }
    } catch { /* no DOM (SSR, tests) — the visual toast still renders */ }

    return id;
  }, [dismiss, duration]);

  // Clear every pending timer on unmount, or a toast fires into a dead tree.
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);

  const api = React.useMemo(() => ({
    push,
    dismiss,
    success: (m) => push(m, 'success'),
    error: (m) => push(m, 'error'),
    info: (m) => push(m, 'info'),
  }), [push, dismiss]);

  const styles = {
    success: 'bg-emerald-600',
    error: 'bg-red-600',
    info: 'bg-slate-800',
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      {items.length > 0 && createPortal(
        // Full width under `sm` so a long message is readable on a phone
        // instead of wrapping into a tall block pinned to one corner.
        <div className="fixed z-[100] top-4 left-4 right-4 sm:left-auto sm:right-5 sm:w-auto sm:max-w-sm flex flex-col gap-2">
          {items.map((t) => (
            <button key={t.id} type="button" onClick={() => dismiss(t.id)}
              className={`${styles[t.type]} text-white text-sm font-medium text-left px-5 py-3 rounded-xl shadow-xl mo-pop`}>
              {t.message}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  );
}

/** Safe outside a provider: returns no-ops rather than throwing, so a screen
 *  rendered in isolation (or in a test) does not crash on a toast call. */
export function useToast() {
  const ctx = React.useContext(ToastCtx);
  return ctx || {
    push: () => {}, dismiss: () => {},
    success: () => {}, error: () => {}, info: () => {},
  };
}
