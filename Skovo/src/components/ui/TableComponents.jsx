import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, AlertTriangle, X } from 'lucide-react';
// Imported directly, not via ui/index.jsx, so this file stays out of that
// barrel's dependency graph.
import FormSelect from './FormSelect';
import { useDialogPanel } from './useDialogPanel';

// ── Tooltip ───────────────────────────────────────────────────────────────────
export function Tooltip({ text, children, side = 'top' }) {
  return (
    <span className="relative group inline-flex">
      {children}
      {/* `hidden md:block`, not just `opacity-0`: an invisible box is still laid
          out, and `whitespace-nowrap` made these wider than the button they
          label. On the Achievers list that put the row's two tooltips 9px past
          the right edge of <main>, and since `overflow-y-auto` computes the X
          axis to `auto` as well, <main> grew a horizontal scrollbar across the
          bottom of every phone screen. Below `md` there is no hover to show
          them with, so there is nothing to lose by not rendering them.
          Rendered only on hover: a hidden-but-laid-out tooltip in the last
          column widened the table and caused a sideways scroll. */}
      <span
        style={{ backgroundColor: 'var(--accent)' }}
        className={`pointer-events-none hidden md:group-hover:block absolute z-50 whitespace-nowrap rounded-lg
          text-white text-[11px] font-medium px-2.5 py-1
          opacity-0 group-hover:opacity-100 transition-opacity duration-150 shadow-lg
          ${side === 'top'
            ? 'bottom-full left-1/2 -translate-x-1/2 mb-1.5'
            : 'top-full left-1/2 -translate-x-1/2 mt-1.5'}`}>
        {text}
        <span
          style={{ borderTopColor: side === 'top' ? 'var(--accent)' : 'transparent', borderBottomColor: side !== 'top' ? 'var(--accent)' : 'transparent' }}
          className="absolute left-1/2 -translate-x-1/2 border-4 border-transparent"
        />
      </span>
    </span>
  );
}

// ── ActionBtn ─────────────────────────────────────────────────────────────────
export function ActionBtn({ icon: Icon, tooltip, onClick, color = 'default', disabled = false, loading = false }) {
  const colors = {
    default: 'text-slate-500 bg-slate-100 hover:text-slate-700 hover:bg-slate-200',
    blue:    'text-blue-600 bg-blue-50 hover:bg-blue-100',
    indigo:  'text-indigo-600 bg-indigo-50 hover:bg-indigo-100',
    green:   'text-emerald-600 bg-emerald-50 hover:bg-emerald-100',
    red:     'text-red-500 bg-red-50 hover:bg-red-100',
    amber:   'text-amber-600 bg-amber-50 hover:bg-amber-100',
    violet:  'text-violet-600 bg-violet-50 hover:bg-violet-100',
  };
  return (
    <Tooltip text={tooltip}>
      <button
        onClick={onClick}
        disabled={disabled || loading}
        // UI04-009 / UI02-164. The Tooltip is a visual affordance only — it
        // renders a <span> on hover, which a screen reader never sees and a
        // touch device never triggers. Without this the button announces as
        // "button" and nothing else, which on a row of five icons leaves a
        // screen-reader user guessing which one deletes.
        aria-label={tooltip}
        title={tooltip}
        // UI02-146. The visual box stays 28px so no layout changes, but the
        // *hit area* grows to 44px via a transparent inset pseudo-element —
        // the sheet asks for 44x44 and a 28px target is not thumb-reachable.
        // Expanding the box itself would resize every action button in the app.
        className={`relative w-7 h-7 flex items-center justify-center rounded-lg transition-colors
          before:absolute before:content-[''] before:-inset-2 before:rounded-lg
          disabled:opacity-40 disabled:cursor-not-allowed ${colors[color] || colors.default}`}>
        {loading
          ? <span className="w-3.5 h-3.5 border-2 border-t-transparent border-current rounded-full animate-spin" />
          : <Icon size={14} aria-hidden="true" />
        }
      </button>
    </Tooltip>
  );
}

// ── Avatar ────────────────────────────────────────────────────────────────────
const AVATAR_COLORS = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-violet-100 text-violet-700',
  'bg-amber-100 text-amber-700',
  'bg-red-100 text-red-700',
  'bg-indigo-100 text-indigo-700',
  'bg-pink-100 text-pink-700',
  'bg-teal-100 text-teal-700',
];
export function Avatar({ name, size = 'sm' }) {
  const initials = (name || '?')
    .split(' ')
    .map(w => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  const idx = (name?.charCodeAt(0) || 0) % AVATAR_COLORS.length;
  const sz  = size === 'sm' ? 'w-7 h-7 text-xs' : 'w-9 h-9 text-sm';
  return (
    <span className={`${sz} rounded-full flex items-center justify-center font-bold shrink-0 ${AVATAR_COLORS[idx]}`}>
      {initials}
    </span>
  );
}

// ── StatusBadge ───────────────────────────────────────────────────────────────
const BADGE_COLORS = {
  // generic
  active:       'bg-emerald-50 text-emerald-700 border-emerald-200',
  inactive:     'bg-slate-100   text-slate-500   border-slate-200',
  // course/cohort
  published:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft:        'bg-amber-50   text-amber-600   border-amber-200',
  archived:     'bg-red-50     text-red-500     border-red-200',
  // sessions/bookings
  pending:      'bg-yellow-50  text-yellow-600  border-yellow-200',
  confirmed:    'bg-blue-50    text-blue-700    border-blue-200',
  completed:    'bg-emerald-50 text-emerald-700 border-emerald-200',
  cancelled:    'bg-red-50     text-red-500     border-red-200',
  // payment
  paid:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  free:         'bg-blue-50    text-blue-600    border-blue-200',
  refunded:     'bg-orange-50  text-orange-600  border-orange-200',
  // cohort status
  upcoming:     'bg-violet-50  text-violet-700  border-violet-200',
  live:         'bg-emerald-50 text-emerald-700 border-emerald-200',
  // admin access state: pending | active | suspended. Suspended needs to read
  // as a warning, not as the neutral grey of the unmapped fallback — it is a
  // decision someone made about a person, not a dormant record.
  suspended:    'bg-orange-50  text-orange-700  border-orange-200',
  // user/achiever
  verified:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  unverified:   'bg-slate-100  text-slate-500   border-slate-200',
  // Account state. `blocked` was missing, so a blocked student fell through to
  // the neutral grey fallback in every desktop table while the mobile card on
  // the same screen drew it red — the same row, two meanings, depending only on
  // viewport width. Grey reads as dormant; being blocked is a decision.
  blocked:      'bg-red-50     text-red-600     border-red-200',
  banned:       'bg-red-50     text-red-600     border-red-200',
  rejected:     'bg-red-50     text-red-500     border-red-200',
  failed:       'bg-red-50     text-red-500     border-red-200',
  // misc
  open:         'bg-blue-50    text-blue-700    border-blue-200',
  closed:       'bg-slate-100  text-slate-500   border-slate-200',
  won:          'bg-emerald-50 text-emerald-700 border-emerald-200',
  lost:         'bg-red-50     text-red-500     border-red-200',
};

// Semantic tones, for when the caller knows what a state *means* better than a
// lookup on its name can. `suspended` is the case that proves the need: the
// achiever console treats it as a warning (reversible, the achiever is coming
// back) and the admin console treats it as danger (someone lost their access).
// One entry in BADGE_COLORS cannot be both.
// Two vocabularies are already in use at the call sites — the lifecycle and
// approval screens pass semantic names (STATE_TONE), the document rows pass
// colour names (DOC_TONE). Both are accepted rather than picking a winner and
// breaking the other, since neither had any effect until now and there is no
// prior behaviour to preserve. Semantic names are the ones to use in new code.
const TONE_COLORS = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50   text-amber-700   border-amber-200',
  danger:  'bg-red-50     text-red-600     border-red-200',
  info:    'bg-blue-50    text-blue-700    border-blue-200',
  neutral: 'bg-slate-100  text-slate-500   border-slate-200',
  // colour-name aliases
  emerald: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  green:   'bg-emerald-50 text-emerald-700 border-emerald-200',
  amber:   'bg-amber-50   text-amber-700   border-amber-200',
  red:     'bg-red-50     text-red-600     border-red-200',
  blue:    'bg-blue-50    text-blue-700    border-blue-200',
  violet:  'bg-violet-50  text-violet-700  border-violet-200',
  slate:   'bg-slate-100  text-slate-500   border-slate-200',
};

// `tone` wins over the status lookup when given. It was already being passed by
// the achiever-lifecycle and admin-approval screens — seven call sites — and
// silently dropped, so every state in the two highest-stakes workflows in the
// product rendered in the same fallback grey.
export function StatusBadge({ status, label, tone }) {
  const cls = TONE_COLORS[tone]
    || BADGE_COLORS[status?.toLowerCase()]
    || 'bg-slate-100 text-slate-500 border-slate-200';
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px]
      font-semibold border capitalize ${cls}`}>
      {label || status}
    </span>
  );
}

// ── Th (Table Header Cell) ────────────────────────────────────────────────────
export function Th({ children, right = false, className = '' }) {
  return (
    <th className={`px-4 py-3 text-xs font-bold text-slate-500 ${right ? 'text-right' : 'text-left'} ${className}`}>
      {children}
    </th>
  );
}

// ── Td (Table Data Cell) ──────────────────────────────────────────────────────
export function Td({ children, right = false, num = false, className = '' }) {
  // `num` opts a cell into tabular figures.
  //
  // In a proportional face the digits have different widths — a 1 is narrower
  // than a 0 — so a column of prices or counts does not line up and the eye
  // cannot compare two rows by shape. `tabular-nums` fixes every digit to the
  // same advance width, which is the whole reason the feature exists.
  //
  // Right-aligned cells get it automatically: a column is right-aligned in the
  // first place because it holds numbers, so making the two travel together
  // removes a decision nobody should have to remember at each call site.
  const tabular = num || right;
  return (
    <td className={`px-4 py-2.5 ${right ? 'text-right' : ''}`
      + `${tabular ? ' tabular-nums' : ''} ${className}`}>
      {children}
    </td>
  );
}

// ── Pagination ────────────────────────────────────────────────────────────────
// Which page numbers to draw: always the first and last, the current page and
// one either side, and "…" for the gaps — never more than seven slots, so the
// row has a fixed maximum width and fits a 320px phone.
//   7 pages or fewer → 1 2 3 4 5 6 7
//   near the start   → 1 2 3 4 5 … 13
//   in the middle    → 1 … 6 7 8 … 13
//   near the end     → 1 … 9 10 11 12 13
export function pageSlots(page, pages) {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, 'gap-r', pages];
  if (page >= pages - 3) return [1, 'gap-l', pages - 4, pages - 3, pages - 2, pages - 1, pages];
  return [1, 'gap-l', page - 1, page, page + 1, 'gap-r', pages];
}

// Only one list per screen may own ?page= in the URL. A screen with two pagers
// (a list and a review queue) would otherwise fight over the same parameter.
let urlOwner = null;
let pagerSeq = 0;
// Page size is NOT remembered across lists: every list opens at its own
// default (20). Remembering it carried one list's "Show 100" onto every other.

export function Pagination({ page, pages, total, perPage, onPage, onPerPage }) {
  const start = total === 0 ? 0 : (page - 1) * perPage + 1;
  const end   = Math.min(page * perPage, total);
  const rootRef = React.useRef(null);
  const idRef = React.useRef(null);
  if (idRef.current == null) idRef.current = ++pagerSeq;
  const [params, setParams] = useSearchParams();
  const [jump, setJump] = React.useState('');
  // The page being restored from the URL on mount. Until the list reaches it,
  // the URL is left alone — otherwise the first render (page 1) wipes ?page=3
  // before the restore lands.
  const restoringRef = React.useRef(null);

  // ── Own the URL, restore from it, and restore the remembered page size ────
  React.useEffect(() => {
    if (urlOwner == null) urlOwner = idRef.current;
    if (urlOwner === idRef.current) {
      const fromUrl = parseInt(params.get('page'), 10);
      if (fromUrl > 1 && fromUrl !== page) { restoringRef.current = fromUrl; onPage?.(fromUrl); }
    }
    return () => { if (urlOwner === idRef.current) urlOwner = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep ?page= in step, so refresh, Back and a shared link land on this page.
  // Page 1 is the default and leaves the URL clean.
  React.useEffect(() => {
    if (urlOwner !== idRef.current) return;
    if (restoringRef.current != null) {
      if (page !== restoringRef.current) return;
      restoringRef.current = null;
    }
    const want = page > 1 ? String(page) : null;
    // Read the live URL, not this render's `params`: a write from the previous
    // render may not have reached the router yet.
    if (new URLSearchParams(window.location.search).get('page') === want) return;
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (want) next.set('page', want); else next.delete('page');
      return next;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  // A new page should start at the top of the list, not wherever the pager was.
  // Walks up to the first ancestor clearly bigger than the pager (the table
  // card, or the section around a card list) and scrolls it into view — only if
  // its top is above the fold, so a short list does not jump.
  const scrollToListTop = () => {
    const pager = rootRef.current;
    if (!pager) return;
    let el = pager.parentElement;
    while (el && el.offsetHeight < pager.offsetHeight * 3) el = el.parentElement;
    if (!el) return;
    // The portal shells scroll <main id="main-content">, which already starts
    // below the header, so the fold is main's top edge, not the window's.
    const scroller = el.closest('#main-content');
    const fold = scroller ? scroller.getBoundingClientRect().top : 64;
    requestAnimationFrame(() => {
      if (el.getBoundingClientRect().top < fold) {
        el.style.scrollMarginTop = scroller ? '12px' : '76px';
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  };

  const go = (p) => {
    const target = Math.min(Math.max(p, 1), Math.max(pages, 1));
    if (target === page) return;
    restoringRef.current = null;     // the person has taken over from the URL
    onPage?.(target);
    scrollToListTop();
  };

  const changePerPage = (v) => {
    const n = Number(v);
    onPerPage?.(n);
    onPage?.(1);
  };

  const submitJump = (e) => {
    e.preventDefault();
    const n = parseInt(jump, 10);
    if (n) go(n);
    setJump('');
  };

  const btn = `relative before:absolute before:content-[''] before:-inset-2 before:rounded-lg
    w-7 h-7 flex items-center justify-center rounded-lg transition-colors`;
  const jumpId = `pager-jump-${idRef.current}`;

  return (
    // Phone: two lines — the tally and "Show" on top, the page buttons centred
    // underneath. On one line the buttons and "Show [20]" need ~350px and a
    // 320px card has ~260, so the row scrolled sideways inside the table.
    // From sm up there is room, and it is one row again.
    <nav ref={rootRef} aria-label="Pagination"
      className="flex flex-wrap sm:flex-nowrap items-center justify-between gap-x-2 gap-y-2
                 px-3 sm:px-5 py-3 border-t border-slate-100 bg-slate-50 text-sm text-slate-500">
      {/* Rows per page, for this list only. */}
      <div className="order-2 sm:order-1 flex items-center gap-2 shrink-0">
        <span className="text-xs">Show</span>
        <FormSelect
          className="w-20 shrink-0"
          value={perPage}
          onChange={changePerPage}
          options={[10, 20, 50, 100].map(n => ({ value: n, label: String(n) }))}
          // Four fixed numbers are not worth a search field, and in an 80px
          // trigger the menu inherits that width, so the box rendered as a
          // clipped "Searc".
          searchable={false}
          clearable={false} />
      </div>

      {/* Tally. */}
      <span className="order-1 sm:order-2 text-xs shrink-0 tabular-nums">
        {total === 0 ? 'No data' : `${start}–${end} of ${total}`}
      </span>

      {/* Page buttons. Full width and centred on a phone, so the up-to-nine
          slots (‹ 1 … 6 7 8 … 13 ›) fit at 320px. The 8px inset gives every
          28px button a 44px hit area; sm:px-2 keeps those clear of the tally. */}
      <div className="order-3 w-full sm:w-auto flex items-center justify-center gap-0.5 sm:gap-1 shrink-0 sm:px-2 py-1 sm:py-2">
        <button type="button" onClick={() => go(page - 1)} disabled={page <= 1}
          aria-label="Previous page"
          className={`${btn} hover:bg-slate-200 disabled:opacity-40`}>
          <ChevronLeft size={14} aria-hidden="true" />
        </button>

        {pageSlots(page, pages).map(p => (typeof p === 'string' ? (
          <span key={p} aria-hidden="true" className="w-5 text-center text-xs text-slate-400 select-none">…</span>
        ) : (
          <button type="button" key={p} onClick={() => go(p)}
            aria-label={`Page ${p}`}
            aria-current={p === page ? 'page' : undefined}
            className={`${btn} text-xs font-semibold ${p === page ? 'text-white' : 'hover:bg-slate-200 text-slate-600'}`}
            style={p === page ? { backgroundColor: 'var(--accent)' } : {}}>
            {p}
          </button>
        )))}

        <button type="button" onClick={() => go(page + 1)} disabled={page >= pages || pages === 0}
          aria-label="Next page"
          className={`${btn} hover:bg-slate-200 disabled:opacity-40`}>
          <ChevronRight size={14} aria-hidden="true" />
        </button>

        {/* Long lists only, and only where there is room: jump straight to a
            page instead of stepping through the window. */}
        {pages > 10 && (
          <form onSubmit={submitJump} className="hidden md:flex items-center gap-1.5 ml-2">
            <label htmlFor={jumpId} className="text-xs">Go to</label>
            <input
              id={jumpId}
              type="number" min={1} max={pages} inputMode="numeric"
              value={jump} onChange={e => setJump(e.target.value)}
              placeholder={String(page)}
              className="w-14 h-7 px-2 text-xs rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </form>
        )}
      </div>
    </nav>
  );
}

// ── EmptyState ────────────────────────────────────────────────────────────────
export function EmptyState({ icon: Icon, message = 'No data yet', sub = '', action }) {
  return (
    // text-center, not just items-center. `items-center` centres each child as a
    // box, which is enough for the icon and the short heading — but the sub line
    // is long enough to fill the width on a phone, and a full-width box with
    // left-aligned text is not centred. On a 320px screen it ran 17px to 303px
    // while the heading above it sat neatly in the middle, so the block read as
    // misaligned. max-w keeps the sub to a readable measure on wide screens
    // instead of one long line across the table.
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 text-center px-4">
      {Icon && <Icon size={32} className="mb-3 opacity-30" />}
      <p className="font-semibold text-slate-500 text-sm">{message}</p>
      {sub && <p className="text-xs mt-1 text-slate-400 max-w-xs">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

// ── LoadError ─────────────────────────────────────────────────────────────────
// The state every list screen was missing.
//
// A request that fails and an account that genuinely has no rows are not the
// same fact, and until this existed both rendered the empty state — so a dropped
// connection told the student "No cohorts found. Try a different search",
// which is advice that cannot possibly work and hides the real problem. It also
// left them with nothing to press: an error with no retry is a dead end that
// only a page reload escapes.
//
// role="alert" so the failure is announced, not just drawn.
export function LoadError({ message, onRetry, what = 'this list' }) {
  return (
    <div role="alert"
         className="flex flex-col items-center justify-center py-16 text-center">
      <AlertTriangle size={32} className="text-red-400 mb-3" />
      <p className="font-semibold text-slate-700 text-sm">
        Could not load {what}
      </p>
      {/* The server's own words when we have them — a generic string hides
          "your session expired" behind "something went wrong". */}
      <p className="text-xs mt-1 text-slate-500 max-w-xs">
        {message || 'The request failed. Check your connection and try again.'}
      </p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="mt-5 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: 'var(--accent, #2563eb)' }}>
          Try again
        </button>
      )}
    </div>
  );
}

// ── TableShell ────────────────────────────────────────────────────────────────
// Wraps the whole table + pagination in a consistent card.
//
// `overflow-x-auto`, not `overflow-hidden`: a table with six columns is wider
// than a 360px phone, and hiding the overflow clipped the extra columns with no
// way to reach them. Scrolling horizontally is the fix; the rounded corners
// still clip because a scroll container respects border-radius.
export function TableShell({ children }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
      {children}
    </div>
  );
}

// ── ResponsiveTable / RowCard ─────────────────────────────────────────────────
// Horizontal scroll keeps a wide table reachable on a phone, but reachable is
// not the same as usable — a seven-column row still means swiping back and
// forth to read one record. The spec asks for stacked cards below the tablet
// breakpoint instead.
//
// Usage: render the <table> and the card list as siblings and let this switch
// between them, so both read from the same rows and cannot drift apart.
//
//   <ResponsiveTable
//     table={<table>…</table>}
//     cards={rows.map(r => <RowCard key={r.id} title={…} fields={[…]} />)}
//   />
export function ResponsiveTable({ table, cards, breakpoint = 'md' }) {
  const hide = { sm: 'hidden sm:block', md: 'hidden md:block', lg: 'hidden lg:block' }[breakpoint];
  const show = { sm: 'sm:hidden', md: 'md:hidden', lg: 'lg:hidden' }[breakpoint];
  return (
    <>
      <div className={hide}><TableShell>{table}</TableShell></div>
      {/* With the lg breakpoint, tablets get cards two across instead of a table that runs off the edge. */}
      <div className={`${show} grid gap-2.5 ${breakpoint === 'lg' ? 'md:grid-cols-2' : ''}`}>{cards}</div>
    </>
  );
}

// One record as a card. `fields` is [{ label, value }]; falsy values are
// dropped so an empty column does not leave a dangling label on mobile.
//
// `avatar` is optional and takes whatever the table branch puts in its own
// avatar column, so the two branches show the same person the same way. A
// table with a photo column whose card equivalent has none is the card losing
// information, not simplifying it.
export function RowCard({ title, subtitle, badge, fields = [], action, onClick, avatar }) {
  return (
    // `data-row` is the same hook the table branch gives a `<tbody tr>`.
    //
    // ResponsiveTable hides the table below `md` and shows these instead, so on
    // a phone the row a test (or any tooling) reaches for exists in the DOM but
    // is invisible, and every interaction times out on an element that is right
    // there. One attribute makes both branches addressable the same way; it
    // renders nothing and changes no behaviour.
    //
    // `role`/`tabIndex` only when the card is actually clickable: a div that
    // responds to a click is a button to everyone except a keyboard, and
    // announcing a static card as one would be worse than silence.
    <div onClick={onClick}
      data-row
      {...(onClick ? { role: 'button', tabIndex: 0,
                       onKeyDown: (e) => {
                         if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e); }
                       } } : {})}
      className={`bg-white rounded-2xl border border-slate-200 p-4 ${onClick ? 'cursor-pointer active:bg-slate-50' : ''}`}>
      {/* One line, always. Four things share it — photo, name, badge, actions —
          and at 320px that is tight, so the room comes out of the gaps and the
          chrome rather than out of the name: badge and buttons are grouped and
          pinned right, and the title takes whatever is left. That was about
          78px before the grouping, which rendered "pavan kumar" as
          "pavan k..."; only a genuinely long name truncates now. */}
      <div className="flex items-start gap-2 flex-nowrap">
        {avatar && <div className="shrink-0">{avatar}</div>}
        <div className="min-w-0 flex-1">
          {/* line-clamp-2, not truncate. The grouping below bought the title
              ~137px, and the assumption was that only a genuinely long name
              would still clip. It does not hold for ordinary Indian full names:
              "Pavan Kumar Sarakam" needs 152px and rendered as "Pavan Kumar
              Sara...". A name is the one thing on this card that has to be
              readable, so it takes a second line when it needs one; the clamp
              keeps the card height bounded. */}
          <p className="font-semibold text-slate-900 text-sm line-clamp-2 break-words">{title}</p>
        </div>
        {(badge || action) && (
          <div className="flex items-center gap-1.5 shrink-0">
            {badge}
            {action}
          </div>
        )}
      </div>
      {/* The subtitle sat inside the flex column beside the badge and the
          action, so on a 320px card an email had 126px and rendered as
          "goddumahesh123@..." - while the line underneath was entirely empty.
          Out here it gets the full card width. break-words rather than
          truncate so an address longer than one line wraps instead of losing
          its domain, which is the half that says which account it is. */}
      {subtitle && <p className="text-xs text-slate-400 mt-0.5 break-words">{subtitle}</p>}
      {fields.filter((f) => f && f.value != null && f.value !== '').length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3 pt-3 border-t border-slate-100">
          {fields.filter((f) => f && f.value != null && f.value !== '').map((f) => (
            <div key={f.label} className="min-w-0">
              <dt className="text-[11px] uppercase tracking-wide text-slate-400">{f.label}</dt>
              {/* Not `truncate`. A card is not a table row - nothing below needs to
                  line up, and the width is whatever the phone is. On a 320px screen
                  the Documents value had 119px for "0 accepted . 3 required missing",
                  so it read "0 accepted . 3 r..." - and the truncated half was the
                  reason the admin could not approve. break-words wraps to a second
                  line and still protects against a long unbroken string. */}
              <dd className="text-sm text-slate-700 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

// ── LoadingRows ───────────────────────────────────────────────────────────────
export function LoadingRows({ cols = 5, rows = 5 }) {
  return (
    <tbody>
      {Array.from({ length: rows }).map((_, i) => (
        <tr key={i} className="border-b border-slate-100">
          {Array.from({ length: cols }).map((_, j) => (
            <td key={j} className="px-4 py-3">
              <div className="h-4 bg-slate-100 rounded animate-pulse" style={{ width: `${60 + (j * 13) % 30}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  );
}

// ── ConfirmModal ──────────────────────────────────────────────────────────────
export function ConfirmModal({ message, detail, onConfirm, onCancel, confirmLabel = 'Confirm', danger = false }) {
  // Escape cancels, Tab stays inside, focus lands on a button rather than
  // behind the backdrop — and the whole thing announces itself as a dialog
  // instead of as an unnamed div that happens to be on top.
  const dialog = useDialogPanel({ onClose: onCancel });
  return (
    <div className="fixed inset-0 z-60 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <div {...dialog.panelProps}
           className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden focus:outline-none">
        <div className="px-6 pt-6 pb-4 flex flex-col items-center text-center gap-3">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${danger ? 'bg-red-50' : 'bg-amber-50'}`}>
            <AlertTriangle size={22} className={danger ? 'text-red-500' : 'text-amber-500'} />
          </div>
          <div>
            <p {...dialog.titleProps} className="text-base font-bold text-slate-900 leading-snug">{message}</p>
            {detail && <p className="text-sm text-slate-500 mt-1">{detail}</p>}
            {/* Say it out loud on the destructive path. "Delete this document?"
                names the action but not its finality, and the two are different
                questions — someone who thinks a delete is recoverable answers
                the first one far too quickly. */}
            {danger && (
              <p className="text-xs text-red-500 font-semibold mt-2">
                This cannot be undone.
              </p>
            )}
          </div>
        </div>
        <div className="px-6 pb-6 flex flex-col-reverse sm:flex-row gap-3"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onCancel}
            className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">
            Cancel
          </button>
          <button onClick={onConfirm}
            className={`flex-1 min-h-11 py-2.5 rounded-xl text-sm font-bold text-white transition-colors ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-amber-500 hover:bg-amber-600'}`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
