import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search, X, Check } from 'lucide-react';
import { FieldLabel, FieldNote } from './Field';

/**
 * The multi-select sibling of FormSelect.
 *
 * FormSelect answered "pick one, searchably" for the whole app; the questions
 * that take several answers — target exams, career interests — had no such
 * control and fell back to a flat wall of chips. That is fine for five options
 * and unusable for eighty: a 12th-grade student is offered every national
 * entrance plus every state CET their level admits from, and finding "TS
 * EAMCET" in that grid means reading it, not searching it.
 *
 * Same contract as FormSelect, plural: `values` / `onChange(nextArray)`.
 *
 *   <FormMultiSelect label="Career interests" required max={5}
 *                    values={picked} onChange={setPicked} options={rows} />
 *
 * options: ['a', 'b'] or [{ value, label }] — both accepted, as in FormSelect.
 *
 * Deliberate differences from FormSelect:
 *
 *  - Picking does NOT close the menu. The whole point is choosing several, and
 *    a menu that shuts after each one turns "up to 5" into five round trips.
 *  - The trigger is a div with role="combobox", not a <button>. Selected values
 *    render as individually removable chips, and a <button> inside a <button>
 *    is invalid HTML — the browser un-nests it and the remove control stops
 *    being clickable.
 *  - `onChange` always builds its next value from the `values` prop it was
 *    handed, never from internal state. Callers pass a *derived* list (see
 *    pruneSelections in config/educationPathways.js), so a click has to commit
 *    back to what was actually displayed, not to a stale copy.
 */
export default function FormMultiSelect({
  values = [],
  onChange,
  options = [],
  label,
  icon: Icon,                 // lucide component — match the inputs beside it
  placeholder = 'Search and select…',
  hint,
  error,
  invalid = false,            // red border only — for forms that print their own message
  required = false,
  disabled = false,
  max,                        // cap on selections; omit for unlimited
  searchable,                 // undefined = on, unless searchAfter is raised
  searchAfter = 0,            // 0 = always searchable
  emptyText = 'Nothing matches that',
  noOptionsText = 'No options for your education level yet',
  className = '',
  id,
}) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [focused, setFocused] = useState(-1);
  const wrapRef  = useRef(null);
  const menuRef  = useRef(null);
  const inputRef = useRef(null);
  const listRef  = useRef(null);
  const autoId   = React.useId();
  const fieldId  = id || autoId;
  const listId   = `${fieldId}-list`;
  const noteId   = `${fieldId}-note`;

  // Accept plain strings as well as {value,label} pairs.
  const items = useMemo(
    () => (options || [])
      .map(o => (typeof o === 'string' ? { value: o, label: o } : o))
      .filter(o => o && o.value !== undefined && o.value !== null),
    [options],
  );

  // Memoised so the `values` default (`[]`, a fresh array every render) cannot
  // re-run the pickedRows memo on every keystroke in the search box.
  const picked    = useMemo(() => (Array.isArray(values) ? values : []), [values]);
  const isPicked  = (v) => picked.some(x => String(x) === String(v));
  const atMax     = Boolean(max) && picked.length >= max;
  const withSearch = searchable ?? items.length > searchAfter;

  // Chips show labels, state holds values — a student sees "Software & IT"
  // while the profile stores "software_it". A value with no matching row is
  // still rendered (as itself) rather than silently dropped, so a stale pick
  // stays visible and removable instead of looking like it was never made.
  const pickedRows = useMemo(
    () => picked.map(v => items.find(o => String(o.value) === String(v)) || { value: v, label: String(v) }),
    [picked, items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    // Prefix matches first — typing "eam" should surface EAMCET ahead of
    // anything that merely contains those letters.
    // `sub` (the optional second line) is searchable too: a student found by
    // email or class, not only by name.
    const hay = (o) => `${o.label ?? ''} ${o.sub ?? ''}`.toLowerCase();
    const starts = items.filter(o => String(o.label ?? '').toLowerCase().startsWith(q));
    const rest = items.filter(o => !String(o.label ?? '').toLowerCase().startsWith(q)
                                && hay(o).includes(q));
    return [...starts, ...rest];
  }, [items, query]);

  useEffect(() => {
    function onDocMouseDown(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) close();
    }
    document.addEventListener('mousedown', onDocMouseDown);
    return () => document.removeEventListener('mousedown', onDocMouseDown);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      if (withSearch) inputRef.current?.focus();
      // These fields sit near the top of a scrollable dialog body, so a menu
      // that opens downward is half under the fold. Nudge the scroll container
      // rather than building a flip/portal positioner for one call site.
      menuRef.current?.scrollIntoView({ block: 'nearest' });
    }, 40);
    return () => clearTimeout(t);
  }, [open, withSearch]);

  // Keep the arrow-key cursor visible — without this, holding ArrowDown through
  // eighty exams moves an indicator nobody can see.
  useEffect(() => {
    if (focused < 0) return;
    listRef.current?.children[focused]?.scrollIntoView({ block: 'nearest' });
  }, [focused]);

  function close() { setOpen(false); setQuery(''); setFocused(-1); }

  function toggle(opt) {
    if (disabled) return;
    if (isPicked(opt.value)) {
      onChange?.(picked.filter(v => String(v) !== String(opt.value)));
      return;
    }
    if (atMax) return;
    onChange?.([...picked, opt.value]);
  }

  function onKeyDown(e) {
    if (!open) {
      if (['Enter', ' ', 'ArrowDown'].includes(e.key)) { e.preventDefault(); setOpen(true); }
      return;
    }
    if (e.key === 'Escape')    { e.preventDefault(); close(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f + 1, filtered.length - 1)); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f - 1, 0)); return; }
    if (e.key === 'Enter' && focused >= 0 && filtered[focused]) {
      // No close() — Enter toggles and leaves the menu up, so five picks are
      // five keystrokes rather than five reopenings.
      e.preventDefault(); toggle(filtered[focused]); return;
    }
    // Backspace on an empty box removes the last chip, the way every tag input
    // behaves. Guarded on an empty query so it never eats what you are typing.
    if (e.key === 'Backspace' && !query && picked.length) {
      e.preventDefault(); onChange?.(picked.slice(0, -1)); return;
    }
    if (e.key === 'Tab') close();
  }

  const state = `${error || invalid ? 'is-error ' : ''}${open ? 'is-open' : ''}`;

  return (
    <div className={`w-full ${className}`} ref={wrapRef}>
      <FieldLabel htmlFor={fieldId} required={required}>{label}</FieldLabel>

      <div className="relative">
        <div
          id={fieldId}
          role="combobox"
          tabIndex={disabled ? -1 : 0}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-required={required || undefined}
          aria-invalid={error || invalid ? true : undefined}
          aria-describedby={(error || hint) ? noteId : undefined}
          onClick={() => !disabled && setOpen(true)}
          onKeyDown={onKeyDown}
          className={`field-trigger w-full flex items-start gap-2 ${Icon ? 'pl-9' : 'pl-3'} pr-3 py-2
                      border border-slate-200 rounded-xl text-sm bg-white text-left transition-all
                      cursor-text min-h-[42px] ${disabled ? 'opacity-50 cursor-not-allowed' : ''} ${state}`}
        >
          {Icon && (
            <Icon size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none" />
          )}

          <div className="flex-1 flex flex-wrap items-center gap-1.5 py-0.5 min-w-0">
            {pickedRows.length === 0 && (
              <span className="text-slate-400 truncate">{placeholder}</span>
            )}
            {pickedRows.map(o => (
              <span key={o.value}
                    className="chip-active inline-flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-lg
                               border text-xs font-semibold max-w-full">
                <span className="truncate">{o.label}</span>
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={disabled}
                  aria-label={`Remove ${o.label}`}
                  onClick={(e) => { e.stopPropagation(); onChange?.(picked.filter(v => String(v) !== String(o.value))); }}
                  className="p-0.5 rounded opacity-60 hover:opacity-100 shrink-0"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>

          {max && (
            <span className={`shrink-0 text-[11px] font-semibold mt-1.5 tabular-nums ${
              atMax ? 'text-amber-600' : 'text-slate-400'}`}>
              {picked.length}/{max}
            </span>
          )}
          <ChevronDown
            size={15}
            className={`text-slate-400 shrink-0 mt-1.5 transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
          />
        </div>

        {open && (
          <div ref={menuRef}
               className="field-menu absolute z-40 mt-1.5 w-full bg-white border border-slate-200 rounded-xl
                          shadow-xl overflow-hidden mo-pop">
            {withSearch && (
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-100">
                <Search size={13} className="text-slate-400 shrink-0" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setFocused(-1); }}
                  onKeyDown={onKeyDown}
                  placeholder={`Search ${items.length}…`}
                  className="w-full text-sm outline-none bg-transparent placeholder:text-slate-500"
                />
                {picked.length > 0 && (
                  <button type="button" onClick={() => onChange?.([])}
                          className="shrink-0 text-[11px] font-semibold text-slate-400 hover:text-slate-700">
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* The empty-state paragraph only renders when nothing is listed, and
                `focused` is -1 then, so child indices always line up with
                `filtered` when the scroll effect runs. */}
            <div ref={listRef} id={listId} role="listbox" aria-multiselectable="true"
                 className="max-h-60 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-3 text-xs text-slate-400">
                  {items.length === 0 ? noOptionsText : emptyText}
                </p>
              )}
              {filtered.map((o, i) => {
                const isSel = isPicked(o.value);
                // At the cap, unpicked rows stay visible but inert. Hiding them
                // would make the list appear to lose options the moment the
                // fifth pick lands, which reads as a bug.
                const blocked = atMax && !isSel;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSel}
                    disabled={blocked}
                    onMouseEnter={() => setFocused(i)}
                    onClick={() => toggle(o)}
                    className={`field-opt w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left
                      transition-colors ${i === focused && !blocked ? 'is-focused bg-slate-50' : ''}
                      ${blocked ? 'opacity-40 cursor-not-allowed' : ''}
                      ${isSel ? 'text-accent font-semibold' : 'text-slate-700'}`}
                  >
                    <span className={`w-4 h-4 rounded border shrink-0 flex items-center justify-center ${
                      isSel ? 'chip-active' : 'border-slate-300'}`}>
                      {isSel && <Check size={11} />}
                    </span>
                    {/* Wraps instead of truncating, with an optional second line —
                        "Pavan Sarakam — sarakam…" hid the part that told options apart. */}
                    <span className="flex-1 min-w-0">
                      <span className="block break-words">{o.label}</span>
                      {o.sub && <span className="block text-xs font-normal text-slate-400 break-words">{o.sub}</span>}
                    </span>
                  </button>
                );
              })}
            </div>

            {atMax && (
              <p className="px-3 py-2 border-t border-slate-100 text-[11px] text-amber-600">
                That's {max} — remove one to swap it for another.
              </p>
            )}
          </div>
        )}
      </div>

      <FieldNote id={noteId} error={error} hint={hint} />
    </div>
  );
}
