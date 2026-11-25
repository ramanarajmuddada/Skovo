import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { FieldLabel, FieldNote } from './Field';

/**
 * The one dropdown for every portal.
 *
 * Replaces ten private copies of `SearchSelect` in the admin pages, the unused
 * `SearchableSelect`, and the native `<select>`s scattered across the app — all
 * of which looked and behaved slightly differently.
 *
 * Named FormSelect because `ui/Select.jsx` is already the shadcn/base-ui
 * primitive; this is the app-level field with a label, hint and error.
 *
 * Every dropdown is searchable — founder call, so the behaviour is the same
 * wherever you land instead of depending on how many options a list happens to
 * hold today. A list of three grows to thirty the first time an admin adds rows,
 * and the interaction should not change under the user when it does.
 *
 * `searchAfter` is kept so a specific field can opt out (`searchAfter={5}`), and
 * `searchable={false}` still forces it off outright.
 *
 *   <FormSelect label="State" required value={v} onChange={setV}
 *               options={states} placeholder="e.g. Telangana" />
 *
 * options: ['a', 'b'] or [{ value, label }] — both accepted, because half the
 * codebase stores plain strings.
 */
export default function FormSelect({
  value = '',
  onChange,
  options = [],
  label,
  icon: Icon,                 // lucide component — match the inputs beside it
  placeholder = 'Select…',
  hint,
  error,
  invalid = false,            // red border only — for forms that print their own message
  required = false,
  disabled = false,
  clearable,                  // undefined = clearable unless the field is required
  searchable,                 // undefined = on, unless searchAfter is raised
  searchAfter = 0,            // 0 = always searchable
  searchType,                 // master type -> search runs in the DATABASE
  emptyText = 'Nothing matches that',
  className = '',
  id,
}) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [focused, setFocused] = useState(-1);
  // Server-side results for `searchType`. null = nothing fetched yet, or the
  // call failed -- either way the cached `options` are used instead, so the
  // dropdown never empties because the network did.
  const [remote, setRemote]   = useState(null);
  const [searching, setSearching] = useState(false);
  const seqRef = useRef(0);
  const [dropUp, setDropUp]   = useState(false);
  // Where to paint the menu, in viewport coordinates. Set at the click.
  const [menuBox, setMenuBox] = useState(null);
  const wrapRef  = useRef(null);
  const menuRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const autoId   = React.useId();
  const fieldId  = id || autoId;

  // Accept plain strings as well as {value,label} pairs.
  const items = useMemo(
    () => (options || [])
      .map(o => (typeof o === 'string' ? { value: o, label: o } : o))
      .filter(o => o && o.value !== undefined && o.value !== null),
    [options],
  );

  // A list from useMasters carries the master type it came from, so a dropdown
  // fed from masters searches the DATABASE without the call site saying so.
  // An explicit searchType prop still wins; a literal array (sort orders, "All
  // statuses") has no tag and keeps filtering in memory, which is right --
  // those values are not in the database to search.
  const effectiveType = searchType ?? (Array.isArray(options) ? options.__masterType : undefined);

  const withSearch = searchable ?? items.length > searchAfter;
  // Offering "clear" on a field that must be filled is a dead end — the user
  // empties it and the form just refuses to submit.
  const canClear  = clearable ?? !required;
  const selected  = items.find(o => String(o.value) === String(value)) || null;

  // Ask the database, debounced, whenever `searchType` is set.
  //
  // Two guards matter here. The sequence number discards a slow earlier reply
  // so results cannot arrive out of order and overwrite a newer query -- the
  // classic type-ahead bug where the list flickers back to what you typed two
  // letters ago. And a failed or empty-shaped response leaves `remote` null
  // rather than [], so the dropdown falls back to filtering the options it
  // already has instead of going blank on a flaky connection.
  useEffect(() => {
    if (!effectiveType || !open) return undefined;
    const seq = ++seqRef.current;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const url = `/v1/auth/masters/search?type=${encodeURIComponent(effectiveType)}`
                  + `&q=${encodeURIComponent(query.trim())}&limit=50`;
        const res = await fetch(url);
        const json = await res.json();
        if (seq !== seqRef.current) return;          // a newer query won
        const opts = json?.response?.options;
        setRemote(Array.isArray(opts) ? opts : null);
      } catch {
        if (seq === seqRef.current) setRemote(null);
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 180);
    return () => clearTimeout(t);
  }, [effectiveType, query, open]);

  const filtered = useMemo(() => {
    // Database results win when we have them.
    if (effectiveType && remote) return remote;
    const q = query.trim().toLowerCase();
    if (!q) return items;
    // Prefix matches first — typing "tel" should surface Telangana ahead of
    // anything that merely contains those letters.
    const starts = items.filter(o => String(o.label ?? '').toLowerCase().startsWith(q));
    const rest = items.filter(o => !String(o.label ?? '').toLowerCase().startsWith(q)
                                && String(o.label ?? '').toLowerCase().includes(q));
    return [...starts, ...rest];
  }, [items, query, effectiveType, remote]);

  /**
   * Open, choosing a side and a position.
   *
   * Two things were wrong with the old absolutely-positioned menu:
   *
   * 1. It only ever dropped downwards, so on the last control of a page — the
   *    pagination bar's "Show 20" is the standing example — it hung past the
   *    end of the document and the page grew a scrollbar.
   * 2. It was clipped by any ancestor that scrolls. `TableShell` is
   *    `overflow-x-auto`, and CSS computes the *other* axis to `auto` when one
   *    axis is not `visible`, so the pagination menu was cut off by the card it
   *    sits in. The edit dialogs (`overflow-y-auto`) clip their selects the
   *    same way. Pagination is on thirty-odd screens, so this was not one page.
   *
   * A fixed-position portal answers both: nothing in the tree can clip it, and
   * the side is picked from the room actually available on screen.
   *
   * Measured here rather than in an effect because the geometry is known at the
   * click, and an effect would be a setState-in-effect render cascade.
   */
  function place() {
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      // What the menu will ask for, capped by its own max-h-60 plus the search
      // row and borders.
      const wanted = Math.min(items.length * 44 + (withSearch ? 45 : 0) + 10, 250);
      const below = window.innerHeight - r.bottom;
      const above = r.top;
      const up = below < wanted + 8 && above > below;
      setDropUp(up);
      // Keep it on screen horizontally too — a field near the right edge whose
      // menu is wider than the trigger would otherwise run off it.
      // At least 9rem: a menu as narrow as a 60px "hour" box left its search
      // field unusable. Wider triggers keep their own width.
      const width = Math.max(r.width, 144);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      setMenuBox(up
        ? { left, width, bottom: window.innerHeight - r.top + 6, maxHeight: above - 14 }
        : { left, width, top: r.bottom + 6, maxHeight: below - 14 });
    }
  }

  // Always the latest `place`, so the resize/scroll listener below (registered
  // once per open) re-measures with current options rather than a stale closure.
  const placeRef = useRef(null);
  useEffect(() => { placeRef.current = place; });

  const isTouch = () => !!window.matchMedia?.('(pointer: coarse)').matches;

  function toggleOpen() {
    if (disabled) return;
    if (open) { setOpen(false); setQuery(''); setFocused(-1); return; }

    // On a phone, a field in the lower half would leave its menu (and the search
    // box inside it) behind the on-screen keyboard, which cannot be scrolled out
    // of the way because the menu is fixed. Bring the field up first.
    if (isTouch()) {
      const r0 = wrapRef.current?.getBoundingClientRect();
      if (r0 && r0.top > window.innerHeight * 0.4) window.scrollBy({ top: r0.top - 96 });
    }
    place();
    setOpen(true);
  }

  useEffect(() => {
    function onDocMouseDown(e) {
      // The menu is portalled to <body>, so it is no longer a descendant of
      // wrapRef. Without this second test every click on an option would read
      // as a click outside and close the menu before it could be picked.
      const insideField = wrapRef.current?.contains(e.target);
      const insideMenu  = menuRef.current?.contains(e.target);
      if (!insideField && !insideMenu) {
        setOpen(false); setQuery(''); setFocused(-1);
      }
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  // A fixed menu does not travel with the field it belongs to, so anything that
  // moves the field has to close it rather than leave it stranded mid-page.
  // Capture, because the scroll usually happens on an inner container.
  //
  // But NOT a scroll inside the menu itself. Capture catches every scroll on
  // the page, and the option list is one of them -- so scrolling the list to
  // reach an option further down closed the menu before it could be picked.
  // On a list of eight, anything past the fifth was unreachable: the menu
  // vanished on the way to it and the click landed on whatever was underneath.
  //
  // The arrow-key cursor made it worse, since scrollIntoView on the focused
  // option fires a scroll event too -- so keyboard users lost the menu on the
  // first ArrowDown that moved the list.
  //
  // On a phone the on-screen keyboard is the other thing that fires both events:
  // it resizes the window and the browser scrolls the page to keep the focused
  // box in view. Closing on those killed the menu the instant the keyboard came
  // up -- and with it the keyboard -- so Gender and the calendar's year list
  // could not be used. The menu now FOLLOWS its field instead (re-measured), and
  // closes on scroll only when the field has genuinely scrolled out of sight and
  // nobody is typing in it.
  useEffect(() => {
    if (!open) return undefined;
    const follow = (e) => {
      const t = e?.target;
      if (t && t.nodeType === 1 && menuRef.current?.contains(t)) return;
      const a = document.activeElement;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')
        && (menuRef.current?.contains(a) || wrapRef.current?.contains(a));
      if (e?.type === 'scroll' && !typing) {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r || r.bottom < 0 || r.top > window.innerHeight) {
          setOpen(false); setQuery(''); setFocused(-1);
          return;
        }
      }
      placeRef.current?.();
    };
    window.addEventListener('scroll', follow, true);
    window.addEventListener('resize', follow);
    return () => {
      window.removeEventListener('scroll', follow, true);
      window.removeEventListener('resize', follow);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    // Focus the search box only when there is one, so arrow keys work straight
    // away on short lists -- but not on a touch screen. There, focusing it raised
    // the keyboard the moment the menu opened, even for a three-item list like
    // Gender, covering the options. A tap on the search box brings it up on demand.
    const t = setTimeout(() => { if (withSearch && !isTouch()) inputRef.current?.focus(); }, 40);
    return () => clearTimeout(t);
  }, [open, withSearch]);

  // Keep the arrow-key cursor visible. Without this, holding ArrowDown through
  // 227 courses moves an indicator nobody can see.
  useEffect(() => {
    if (focused < 0) return;
    listRef.current?.children[focused]?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  const close = () => { setOpen(false); setQuery(''); setFocused(-1); };
  const pick = (opt) => { onChange?.(opt.value); close(); };

  function onKeyDown(e) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape')    { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); return; }
    if (e.key === 'Enter' && focused >= 0 && filtered[focused]) { e.preventDefault(); pick(filtered[focused]); }
    if (e.key === 'Tab') close();
  }

  const state = `${error || invalid ? 'is-error ' : ''}${open ? 'is-open' : ''}`;

  // `w-full` was unconditional, so a caller passing `w-20` got both classes and
  // Tailwind's cascade — not the attribute order — picked the winner, which was
  // always `w-full`. The pagination "Show 20" select is declared `w-20` and was
  // rendering at the full bar width, pushing "entries" and the page buttons off
  // a 320px screen. Only default to full width when the caller named no width.
  // The test deliberately requires start/space/variant-colon before `w-`, so
  // `sm:w-52` counts as a width and `max-w-xl` does not.
  const hasWidth = /(^|\s|:)w-/.test(className);

  return (
    <div className={`${hasWidth ? '' : 'w-full'} ${className}`} ref={wrapRef}>
      <FieldLabel htmlFor={fieldId} required={required}>{label}</FieldLabel>

      <div className="relative">
        <button
          type="button"
          id={fieldId}
          disabled={disabled}
          onClick={toggleOpen}
          onKeyDown={onKeyDown}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-required={required || undefined}
          aria-invalid={error || invalid ? true : undefined}
          className={`field-trigger w-full flex items-center gap-2 min-h-11 ${Icon ? 'pl-9' : 'pl-4'} pr-3 py-2.5
                      border border-slate-200 rounded-xl text-sm bg-white text-left transition-all
                      disabled:opacity-50 disabled:cursor-not-allowed mo-press ${state}`}
        >
          {Icon && (
            <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          )}
          {/* Still one line when closed: the control has to keep its height in
              a form, and the full text is a tap away in the open list. */}
          <span className={`flex-1 truncate ${selected ? 'text-slate-900' : 'text-slate-400'}`}>
            {selected ? selected.label : placeholder}
          </span>
          {canClear && selected && !disabled && (
            <span
              role="button"
              tabIndex={-1}
              aria-label="Clear selection"
              onClick={(e) => { e.stopPropagation(); onChange?.(''); close(); }}
              className="relative p-0.5 rounded-md text-slate-300 hover:text-slate-600 hover:bg-slate-100 before:absolute before:-inset-4 before:content-['']"
            >
              <X size={13} />
            </span>
          )}
          <ChevronDown
            size={15}
            className={`text-slate-400 shrink-0 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </button>

        {open && menuBox && createPortal(
          <div
            ref={menuRef}
            role="listbox"
            // Fixed, in <body>, so no scrolling ancestor can clip it, and above
            // every dialog it can be opened from.
            //
            // z-60 was chosen when the only dialogs were z-50. Nested modals
            // arrived later at z-70 (Modal's `nested` prop), which put this menu
            // *between* the two: above the case file behind it, below the dialog
            // containing it. The select then opened onto nothing -- the options
            // were rendered, positioned and 264px wide, painted behind their own
            // modal. z-80 clears both. Anything added above 80 has to move this.
            className="field-menu fixed z-[220] bg-white border border-slate-200 rounded-xl
                       shadow-xl overflow-hidden mo-pop"
            style={{
              left: menuBox.left,
              width: menuBox.width,
              ...(dropUp ? { bottom: menuBox.bottom } : { top: menuBox.top }),
              maxHeight: Math.max(120, menuBox.maxHeight),
            }}
          >
            {withSearch && (
              <div className="field-search-bar p-2 border-b border-slate-100 shadow-[0_1px_2px_rgb(15_23_42/0.06)]">
              <div className="field-search flex items-center gap-2 h-10 px-3 rounded-lg border border-slate-200 bg-slate-50 focus-within:border-[var(--accent)]">
                <Search size={15} className="text-slate-400 shrink-0" />
                {/* type="search" with an id/name and an accessible name: it is
                    still a form field even though it filters rather than submits,
                    and without them every dropdown in the app reported an
                    unlabelled control. `fieldId` is already unique per instance,
                    so two selects open at once cannot collide. */}
                <input
                  ref={inputRef}
                  id={`${fieldId}-search`}
                  name={`${fieldId}-search`}
                  type="search"
                  aria-label={label ? `Search ${label}` : 'Search options'}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setFocused(-1); }}
                  onKeyDown={onKeyDown}
                  // Short enough for a 220px menu at 320 — "Search 44 options…" clipped.
                  placeholder={`Search ${items.length}…`}
                  className="mo-ring flex-1 min-w-0 h-full text-base outline-none border-0 bg-transparent p-0 placeholder:text-slate-500"
                />
                {query && (
                  <button type="button" aria-label="Clear search"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => { setQuery(''); setFocused(-1); inputRef.current?.focus(); }}
                          className="shrink-0 -mr-1.5 p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200/60">
                    <X size={14} />
                  </button>
                )}
              </div>
              </div>
            )}

            {/* The empty-state paragraph only renders when there are no options,
                and `focused` is -1 then, so child indices always line up with
                `filtered` when the scroll effect runs. */}
            {/* The list scrolls within whatever height the menu was given, so a
                field with little room above or below still shows a usable list
                instead of a box taller than the space it was placed in. */}
            <div ref={listRef}
                 className="overflow-y-auto py-1"
                 style={{ maxHeight: Math.max(76, Math.min(240, menuBox.maxHeight - (withSearch ? 45 : 0) - 2)) }}>
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-400">{emptyText}</p>
              )}
              {filtered.map((o, i) => {
                const isSel = String(o.value) === String(value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    onMouseEnter={() => setFocused(i)}
                    onClick={() => pick(o)}
                    className={`field-opt w-full flex items-start gap-2 min-h-11 px-3 py-2.5 text-sm text-left
                      transition-colors ${i === focused ? 'is-focused bg-slate-50' : ''}
                      ${isSel ? 'text-accent font-semibold' : 'text-slate-700'}`}
                  >
                    {/* Wraps. `truncate` clipped every option to one line, so on
                        a 320px screen the document list read "Government ID
                        (Aadhaar / P..." and "Selfie (matched against your..." --
                        the half that distinguishes one option from another was
                        the half that got cut. A taller row is a smaller cost
                        than an unreadable choice. */}
                    <span className="flex-1 min-w-0 break-words">{o.label}</span>
                    {isSel && <Check size={14} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>,
          document.body,
        )}
      </div>

      <FieldNote error={error} hint={hint} />
    </div>
  );
}
