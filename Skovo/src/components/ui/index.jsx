import React from 'react';
import ReactDOM from 'react-dom';
import { FieldLabel, FieldNote } from './Field';
import FormSelect from './FormSelect';
import FormMultiSelect from './FormMultiSelect';
import DateRange, { defaultRange, RANGE_PRESETS } from './DateRange';
import { Drawer, ActionMenu, ErrorState, ToastProvider, useToast } from './Overlays';

// Single import site for callers: `import { Input, FormSelect } from '.../ui'`.
export { FieldLabel, FieldNote, FormSelect, FormMultiSelect, DateRange, defaultRange, RANGE_PRESETS };

// Overlays and states that live in Overlays.jsx — re-exported here so a screen
// never needs to know which file a component came from.
export { Drawer, ActionMenu, ErrorState, ToastProvider, useToast };

// Select-then-upload control shared by the achiever application and the
// student document vault, so both enforce the same limits and read the same.
export { default as FilePicker } from './FilePicker';
export { validateFile, ALLOWED_EXT, MAX_BYTES, prettySize } from './fileRules';

/* ─── Button ──────────────────────────────────────────────────────────── */
export function Button({ variant = 'primary', size = 'md', children, className = '', style = {}, ...props }) {
  // mo-press gives the tactile scale-down on tap and mo-ring a theme-coloured
  // focus ring; both come from the motion layer in index.css so every button in
  // every portal behaves identically.
  const base = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed select-none mo-press mo-ring';
  const variants = {
    primary:   'btn-accent text-white shadow-sm',
    secondary: 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 active:bg-slate-100',
    ghost:     'text-slate-600 hover:bg-slate-100 active:bg-slate-200',
    danger:    'bg-red-600 hover:bg-red-700 text-white shadow-sm shadow-red-200',
    outline:   'border text-white hover:opacity-90 active:opacity-80',
  };
  const sizes = {
    sm: 'text-xs px-3 py-1.5 gap-1.5 min-h-9',
    md: 'text-sm px-4 py-2.5 gap-2 min-h-11',
    lg: 'text-sm px-5 py-3 gap-2 min-h-11',
    xl: 'text-base px-6 py-3.5 gap-2 min-h-11',
  };

  // For outline variant use accent CSS variable for border/text
  const outlineStyle = variant === 'outline'
    ? { borderColor: 'var(--accent)', color: 'var(--accent)', backgroundColor: 'transparent', ...style }
    : style;
  const outlineClass = variant === 'outline' ? '' : '';

  return (
    <button
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      style={outlineStyle}
      {...props}
    >
      {children}
    </button>
  );
}

/* ─── Card ────────────────────────────────────────────────────────────── */
/* `hover` opts into the lift; `animate` into the entrance. Both are off by
   default so existing screens are unchanged until they ask for it. */
export function Card({ children, className = '', hover = false, animate = false, ...props }) {
  return (
    <div
      className={`bg-white rounded-2xl border border-slate-200 shadow-sm ${
        hover ? 'mo-lift hover:border-slate-300 cursor-pointer' : ''
      } ${animate ? 'mo-in' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
}

/* ─── Badge ───────────────────────────────────────────────────────────── */
export function Badge({ children, color = 'slate', size = 'sm', className = '' }) {
  const colors = {
    blue:    'bg-blue-50   text-blue-700   border-blue-200',
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    amber:   'bg-amber-50  text-amber-700  border-amber-200',
    red:     'bg-red-50    text-red-700    border-red-200',
    purple:  'bg-purple-50 text-purple-700 border-purple-200',
    slate:   'bg-slate-100 text-slate-600  border-slate-200',
    orange:  'bg-orange-50 text-orange-700 border-orange-200',
    indigo:  'bg-indigo-50 text-indigo-700 border-indigo-200',
  };
  const sizes = { sm: 'text-xs px-2.5 py-1', xs: 'text-[10px] px-2 py-0.5 tracking-wide uppercase font-bold' };
  return (
    <span className={`inline-flex items-center gap-1 font-semibold rounded-lg border ${colors[color]} ${sizes[size]} ${className}`}>
      {children}
    </span>
  );
}

/* ─── Input ───────────────────────────────────────────────────────────────
 * min-h-11 on the control: padding alone rendered 42px, two short of the 44px
 * a fingertip needs. Every form in the app is built from this component, so
 * that shortfall was app-wide rather than one screen's problem.
 */
export function Input({ label, error, icon, rightIcon, required, hint, className = '', ...props }) {
  // Tie the label to the input so screen readers announce it, and so the label
  // is clickable. Respect a caller-supplied id when there is one.
  const autoId = React.useId();
  const inputId = props.id || autoId;
  // The note under the field is only *associated* with it if the control points
  // at it. Without this the error is a paragraph that happens to sit nearby:
  // a screen-reader user tabs into the box, hears the label, and is told
  // nothing about why the form refused them.
  const noteId = `${inputId}-note`;
  const describedBy = (error || hint) ? noteId : undefined;
  return (
    <div className="w-full">
      <FieldLabel htmlFor={inputId} required={required}>{label}</FieldLabel>
      <div className="relative">
        {icon && (
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
            {icon}
          </span>
        )}
        <input
          id={inputId}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={`w-full min-h-11 ${icon ? 'pl-10' : 'pl-4'} ${rightIcon ? 'pr-11' : 'pr-4'} py-2.5
            border border-slate-200 rounded-xl text-base bg-white transition-all
            hover:border-slate-300 focus:outline-none placeholder:text-slate-500
            disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50
            ${error ? 'field-error' : ''} ${className}`}
          {...props}
        />
        {rightIcon && (
          <span className="absolute right-3.5 top-1/2 -translate-y-1/2">
            {rightIcon}
          </span>
        )}
      </div>
      <FieldNote id={noteId} error={error} hint={hint} />
    </div>
  );
}

/* ─── Textarea ────────────────────────────────────────────────────────── */
export function Textarea({ label, error, required, hint, className = '', ...props }) {
  const autoId = React.useId();
  const areaId = props.id || autoId;
  const noteId = `${areaId}-note`;
  const describedBy = (error || hint) ? noteId : undefined;
  return (
    <div className="w-full">
      <FieldLabel htmlFor={areaId} required={required}>{label}</FieldLabel>
      <textarea
        id={areaId}
        aria-required={required || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`w-full min-h-11 px-4 py-2.5 border border-slate-200 rounded-xl text-base bg-white
          transition-all hover:border-slate-300 focus:outline-none placeholder:text-slate-500
          disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-slate-50 resize-none
          ${error ? 'field-error' : ''} ${className}`}
        {...props}
      />
      <FieldNote id={noteId} error={error} hint={hint} />
    </div>
  );
}

/* ─── StudentPage ───────────────────────────────────────────────────────
 * Shared shell for live student screens: 16px gutters on a phone, 24/32 on
 * larger, and a home-indicator-safe bottom pad. Screens keep their own
 * spacing; this only owns the page edge.
 */
export function StudentPage({ children, className = '', narrow = false }) {
  return (
    <div
      className={`${narrow ? 'max-w-3xl mx-auto w-full' : ''} p-4 sm:p-6 lg:p-8 ${className}`}
      style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
    >
      {children}
    </div>
  );
}

/* ─── PageHeader ──────────────────────────────────────────────────────── */
export function PageHeader({ title, subtitle, action }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between mb-5 sm:mb-6 mo-in">
      <div className="min-w-0">
        <h1 className="text-2xl font-black text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5 leading-relaxed">{subtitle}</p>}
      </div>
      {action && (
        <div className="shrink-0 w-full sm:w-auto flex flex-col sm:flex-row gap-2
                        [&_button]:min-h-11 [&_button]:w-full sm:[&_button]:w-auto
                        [&_a]:min-h-11 [&_a]:inline-flex [&_a]:items-center [&_a]:justify-center [&_a]:w-full sm:[&_a]:w-auto">
          {action}
        </div>
      )}
    </div>
  );
}

/* ─── EmptyState ──────────────────────────────────────────────────────── */
export function EmptyState({ icon: Icon, title, subtitle, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center mo-pop">
      {Icon && <Icon size={48} className="text-slate-300 mb-4 mo-float" />}
      <p className="text-base font-semibold text-slate-700">{title}</p>
      {subtitle && <p className="text-sm text-slate-400 mt-1 max-w-xs">{subtitle}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/* ─── Skeleton ────────────────────────────────────────────────────────── */
export function Skeleton({ className = '' }) {
  return <div className={`bg-slate-100 rounded-xl mo-shimmer ${className}`} />;
}

export function SkeletonCard({ className = '' }) {
  return (
    <Card className={`p-5 space-y-3 ${className}`}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-5 w-4/5" />
      <Skeleton className="h-4 w-2/3" />
      <Skeleton className="h-9 w-full mt-2" />
    </Card>
  );
}

/* ─── Pagination ──────────────────────────────────────────────────────── */
export function Pagination({ page, pages, onPage }) {
  if (!pages || pages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2 mt-6 sm:mt-8">
      <Button variant="secondary" size="md" disabled={page === 1} onClick={() => onPage(page - 1)}>
        ← Previous
      </Button>
      <span className="text-sm text-slate-500 px-2">
        Page <span className="font-semibold text-slate-900">{page}</span> of {pages}
      </span>
      <Button variant="secondary" size="md" disabled={page === pages} onClick={() => onPage(page + 1)}>
        Next →
      </Button>
    </div>
  );
}

/* ─── SearchBar ───────────────────────────────────────────────────────── */
export function SearchBar({ value, onChange, onSubmit, placeholder = 'Search…', className = '' }) {
  // Stop the native submit here rather than trusting every caller to do it.
  // Callers that pass a handler ignoring the event — `onSubmit={() => setQuery(search)}`
  // — let the form submit for real, which reloads the page and throws the
  // search away. The user types, hits Enter, and lands back on an unfiltered
  // list with an empty box.
  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit?.(e);
  };

  return (
    <form onSubmit={handleSubmit} className={`flex flex-col sm:flex-row gap-2 ${className}`}>
      <div className="relative flex-1">
        <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="search"
          enterKeyHint="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full min-h-11 pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-base bg-white focus:outline-none placeholder:text-slate-500 transition-all"
        />
      </div>
      <Button type="submit" variant="primary" size="md" className="w-full sm:w-auto">Search</Button>
    </form>
  );
}

/* ─── FilterPills ─────────────────────────────────────────────────────── */
export function FilterPills({ options, active, onSelect, formatLabel }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onSelect(opt)}
          style={active === opt ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
          className={`px-3.5 py-2 min-h-11 rounded-xl text-sm font-medium transition-all border ${
            active === opt
              ? 'text-white shadow-sm'
              : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:text-slate-800'
          }`}
        >
          {formatLabel ? formatLabel(opt) : opt}
        </button>
      ))}
    </div>
  );
}

/* ─── Toast ───────────────────────────────────────────────────────────── */
/**
 * A one-line confirmation, top of the screen.
 *
 * Accepts two prop shapes on purpose. It was written as ({ message, type }),
 * but 33 of the 47 call sites across the console pass ({ msg, ok }) -- and
 * because `message` was undefined for every one of them, `if (!message) return
 * null` meant those screens rendered nothing at all. Every "Saved", "Removed",
 * "Banned" and "Suspended" on those 33 screens went nowhere: the action ran,
 * the list refreshed, and the admin was never told it had worked.
 *
 * Fixed here rather than in 33 files. The alternative was a rename across the
 * console in one pass, which is a large diff to land on a component whose whole
 * job is to be reassuring.
 *
 * `ok` is a boolean; `type` is a string. `ok === false` is the only thing that
 * means failure -- an absent `ok` is success, because the callers default it to
 * true.
 */
export function Toast({ message, msg, type, ok }) {
  const text = message ?? msg;
  if (!text) return null;
  const tone = type ?? (ok === false ? 'error' : 'success');
  const styles = {
    success: 'bg-emerald-600 text-white',
    error:   'bg-red-600 text-white',
    info:    'bg-slate-800 text-white',
  };
  return (
    <div role="status" aria-live="polite"
         className={`fixed top-[max(1.25rem,env(safe-area-inset-top))] left-4 right-4 sm:left-auto sm:right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-medium ${styles[tone] || styles.success} animate-in slide-in-from-top-2`}>
      {text}
    </div>
  );
}

/* ─── SectionTitle ────────────────────────────────────────────────────── */
export function SectionTitle({ children, action }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
      <h2 className="text-base font-bold text-slate-900 min-w-0">{children}</h2>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

/* ─── StatCard ────────────────────────────────────────────────────────── */
export function StatCard({ label, value, icon: Icon, color = 'blue' }) {
  // Same layout as the admin StatTile (ui-patterns.md §3a), so a stat looks the
  // same in every portal: label on its own line (never clipped at 320px), the
  // number with a small tinted icon beside it. The icon stays optional --
  // `<Icon />` with an undefined Icon blanks the whole route.
  const colors = {
    blue:    'bg-blue-50 text-blue-600',
    emerald: 'bg-emerald-50 text-emerald-600',
    purple:  'bg-violet-50 text-violet-600',
    amber:   'bg-amber-50 text-amber-600',
    red:     'bg-red-50 text-red-600',
    violet:  'bg-violet-50 text-violet-600',
  };
  // Words ("Explorer", "Not set") read at body size; numbers get the big type.
  const isNumeric = value !== null && value !== undefined
    && /^[₹\d.,%+\s-]+$/.test(String(value).trim());
  return (
    <Card className="p-3 sm:p-4 min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 leading-tight break-words">{label}</p>
      <div className="mt-2 flex items-center justify-between gap-2">
        <p className={`min-w-0 text-slate-900 break-words ${isNumeric
          ? 'text-xl sm:text-2xl font-black tabular-nums leading-none'
          : 'text-base sm:text-lg font-bold leading-tight'}`}>
          {value ?? 0}
        </p>
        {Icon && (
          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${colors[color] || colors.blue}`}>
            <Icon size={14} />
          </span>
        )}
      </div>
    </Card>
  );
}

/* ─── Avatar ──────────────────────────────────────────────────────────── */
export function Avatar({ name = '', size = 'md', className = '' }) {
  const sizes = { sm: 'w-7 h-7 text-xs', md: 'w-9 h-9 text-sm', lg: 'w-12 h-12 text-lg' };
  return (
    <div
      className={`${sizes[size]} rounded-full text-white font-bold flex items-center justify-center shrink-0 ${className}`}
      style={{ backgroundColor: 'var(--accent)' }}
    >
      {name.charAt(0).toUpperCase() || 'U'}
    </div>
  );
}

/* ─── Modal ───────────────────────────────────────────────────────────── */
export function Modal({ isOpen, onClose, title, children, footer, size = 'md', nested = false }) {
  const panelRef = React.useRef(null);
  const returnTo = React.useRef(null);
  const titleId = React.useId();

  // Close on Escape — a dialog you can only dismiss by aiming at a 20px × is
  // needlessly fiddly. Hook order is fixed, so this sits above the early return.
  //
  // Tab is handled here too, and it is not a nicety. Without a trap, tabbing out
  // of a dialog walks the page BEHIND it: the focus ring vanishes under the
  // backdrop, every control it lands on is inert to a mouse but still operable
  // by Enter, and there is no way back except Shift+Tab counted out blind. The
  // dialog is `aria-modal`, so a screen reader has already been told the rest of
  // the page does not exist — the keyboard has to agree with that claim.
  React.useEffect(() => {
    if (!isOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { onClose?.(); return; }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),'
        + ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.getClientRects().length);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault(); first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Move focus in on open and put it back where it came from on close.
  // Restoring matters as much as moving: a dialog opened from a row in a long
  // table and closed without it drops focus to the top of the document, so the
  // next Tab starts the whole page again from the sidebar.
  React.useEffect(() => {
    if (!isOpen) return undefined;
    returnTo.current = document.activeElement;
    // After the portal has painted, or there is nothing to focus yet.
    const id = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const target = panel.querySelector(
        'input:not([type="hidden"]):not([disabled]), textarea:not([disabled]),'
        + ' select:not([disabled]), button:not([disabled]), a[href]');
      (target || panel).focus({ preventScroll: true });
    });
    return () => {
      window.cancelAnimationFrame(id);
      const back = returnTo.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) {
        back.focus({ preventScroll: true });
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  // Wider options exist because a dozen single-column fields in a 448px dialog
  // is mostly scrolling. Two columns at `lg` roughly halves the height.
  const widths = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl', xl: 'max-w-4xl' };

  // Rendered into <body>, not in place. A `fixed` element is positioned
  // against the nearest ancestor with a transform/filter/containment rather
  // than the viewport, so a dialog nested in an animated, scrolling page
  // silently re-anchors to that box — centring itself in the full scroll
  // height with its header off-screen. A portal removes the whole class of bug.
  // xl is a case file, not a short prompt. On a phone it is a full-height
  // sheet so the documents are reachable; from sm up it is a centred dialog.
  const fullSheet = size === 'xl';
  const z = nested ? 'z-[70]' : 'z-50';

  return ReactDOM.createPortal(
    <div className={`fixed inset-0 ${z} flex items-end sm:items-center justify-center ${
      fullSheet ? 'p-0 sm:p-4' : 'p-0 sm:p-4'}`}>
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      {/* Cap the height and scroll the body. A long form — the Market deal
          form has a dozen fields — used to grow past the bottom of the screen
          with nothing scrollable, so the Save button was unreachable and the
          dialog just looked oversized. Header and footer stay pinned so Save
          is always in reach. */}
      {/* role/aria-modal/aria-labelledby, and tabIndex so the panel itself can
          hold focus when it contains no control. Without the role this was, to
          a screen reader, an anonymous div: nothing announced that a dialog had
          opened, nothing said what it was for, and the page behind it was still
          presented as readable. */}
      <div ref={panelRef}
           role="dialog"
           aria-modal="true"
           aria-label={title ? undefined : 'Dialog'}
           aria-labelledby={title ? titleId : undefined}
           tabIndex={-1}
           className={`relative bg-white shadow-2xl w-full ${widths[size] || widths.md}
                       flex flex-col overflow-hidden mo-pop focus:outline-none
                       ${fullSheet
                         ? 'h-[100dvh] max-h-[100dvh] rounded-t-2xl sm:h-auto sm:max-h-[90vh] sm:rounded-2xl'
                         : 'max-h-[92dvh] rounded-t-2xl sm:rounded-2xl'}`}>
        {title && (
          <div className="flex items-center justify-between px-4 py-3 sm:px-6 sm:py-4 border-b border-slate-100 shrink-0">
            <h3 id={titleId} className="font-bold text-slate-900 text-base sm:text-lg pr-3 min-w-0 break-words">{title}</h3>
            <button onClick={onClose} aria-label="Close dialog"
                    className="relative p-2 sm:p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all shrink-0 before:absolute before:-inset-1 before:content-['']">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 min-h-0">{children}</div>
        {footer && (
          <div className="px-4 pt-3 sm:px-6 sm:pt-4 border-t border-slate-100 shrink-0"
               style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
