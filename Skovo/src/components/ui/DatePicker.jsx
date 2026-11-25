import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Calendar, ChevronLeft, ChevronRight, X } from 'lucide-react';
import FormSelect from './FormSelect';
import { MONTHS, DOW, parseIso, toIso, isoToDisplay, displayToIso, isoToLong } from './dateUtils';

/**
 * Zero-dependency date picker.
 *
 * The native <input type="date"> opens on today's month, which is useless for a
 * birth date — reaching 2006 is 240 clicks on the arrow. This one has month and
 * year dropdowns in the header, so any date is two clicks away, and the text box
 * accepts a typed dd/mm/yyyy (slashes insert themselves).
 *
 * Value in / out is always an ISO `YYYY-MM-DD` string ('' when unset), which is
 * what every API on the platform expects.
 */
export default function DatePicker({
  value = '',
  onChange,
  min,                       // ISO, inclusive
  max,                       // ISO, inclusive
  placeholder = 'dd/mm/yyyy',
  disabled = false,
  invalid = false,
  clearable = true,
  /** Month the calendar opens on when nothing is selected yet (ISO). */
  defaultView,
  className = '',
  id,
}) {
  const [open, setOpen]     = useState(false);
  const [text, setText]     = useState(() => isoToDisplay(value));
  // Where the calendar sits on screen. It is drawn in a portal (like FormSelect),
  // so a scrolling modal or card can never cut it off.
  const [box, setBox] = useState(null);
  const calRef = useRef(null);
  const wrapRef = useRef(null);
  const btnRef  = useRef(null);

  const minDate = useMemo(() => parseIso(min), [min]);
  const maxDate = useMemo(() => parseIso(max), [max]);

  const openingDate = () => parseIso(value) || parseIso(defaultView) || maxDate || new Date();
  const [view, setView] = useState(() => {
    const d = openingDate();
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Follow the value when the parent changes it (reset, load-from-server…).
  // Adjusted during render rather than in an effect: React re-runs this pass
  // before committing, so the box never paints the stale date.
  //
  // But NOT when the change is this component's own typing echoed back. Typing a
  // partial date into a box that already held a full one hands the parent '' (no
  // valid date yet), and that echo used to reset the box to empty on the very
  // next render -- so correcting one digit of an existing birth date erased
  // everything you had typed. `emitted` remembers what we last sent up.
  const [lastValue, setLastValue] = useState(value);
  const [emitted, setEmitted] = useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    if (value !== emitted) setText(isoToDisplay(value));
  }

  // Where the calendar sits, from the field's current position. Called on open
  // and again whenever the window resizes or scrolls while it is open.
  const place = () => {
    // Flip upwards when there isn't room for the panel below the field.
    const r = wrapRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom, above = r.top;
      const up = below < 430 && above > below;   // calendar is ~420px tall
      const width = Math.min(304, window.innerWidth - 16);
      const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
      // Always a top edge, clamped so the whole panel stays on screen. On a short
      // phone with no room either side, it covers the field rather than getting cut.
      const H = 420, vh = window.innerHeight;
      const want = up ? r.top - 8 - H : r.bottom + 8;
      setBox({ left, top: Math.max(8, Math.min(want, vh - H - 8)) });
    }
  };
  // Always the latest `place`, for the resize/scroll listener registered below.
  const placeRef = useRef(null);
  useEffect(() => { placeRef.current = place; });

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (wrapRef.current?.contains(e.target) || calRef.current?.contains(e.target)
          || e.target.closest?.('.field-menu')) return;
      setOpen(false);
    };
    // The calendar is fixed, so it has to follow its field. A phone's keyboard
    // fires both events too (it resizes the window and scrolls the page to keep
    // the focused box in view), and closing on them shut the calendar -- and the
    // keyboard with it -- as soon as the month/year search was tapped. So it is
    // re-measured instead, and only closes when the field has genuinely scrolled
    // out of sight with nobody typing.
    const onScroll = (e) => {
      if (calRef.current?.contains(e.target) || e.target.closest?.('.field-menu')) return;
      const a = document.activeElement;
      const typing = !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')
        && (wrapRef.current?.contains(a) || calRef.current?.contains(a) || a.closest?.('.field-menu'));
      if (e.type === 'scroll' && !typing) {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r || r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      }
      placeRef.current?.();
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    const onKey  = (e) => { if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open]);

  const years = useMemo(() => {
    const hi = maxDate ? maxDate.getFullYear() : new Date().getFullYear() + 10;
    const lo = minDate ? minDate.getFullYear() : hi - 100;
    const out = [];
    for (let y = hi; y >= lo; y--) out.push(y);   // newest first — closest to a student's birth year
    return out;
  }, [minDate, maxDate]);

  const inRange = (t) => !(minDate && t < minDate.getTime()) && !(maxDate && t > maxDate.getTime());

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      const d = openingDate();
      setView({ y: d.getFullYear(), m: d.getMonth() });
      place();
    }
    setOpen(o => !o);
  };

  const commit = (iso) => {
    setEmitted(iso);
    onChange?.(iso);
    setText(isoToDisplay(iso));
    setOpen(false);
    btnRef.current?.focus();
  };

  const handleText = (raw) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    let out = digits;
    if (digits.length > 4)      out = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    else if (digits.length > 2) out = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    setText(out);

    const iso = out.length === 10 ? displayToIso(out) : null;
    if (iso && inRange(parseIso(iso).getTime())) {
      const d = parseIso(iso);
      setView({ y: d.getFullYear(), m: d.getMonth() });
      setEmitted(iso);
      onChange?.(iso);
    } else if (value) {
      setEmitted('');
      onChange?.('');          // partial or impossible date — no value to hand upstream
    }
  };

  const shiftMonth = (delta) => setView(({ y, m }) => {
    const d = new Date(y, m + delta, 1);
    return { y: d.getFullYear(), m: d.getMonth() };
  });

  // Whole-month bounds, used to grey out the arrows at the ends of the range.
  const prevDisabled = minDate && new Date(view.y, view.m, 0).getTime() < minDate.getTime();
  const nextDisabled = maxDate && new Date(view.y, view.m + 1, 1).getTime() > maxDate.getTime();

  const leading   = new Date(view.y, view.m, 1).getDay();
  const dayCount  = new Date(view.y, view.m + 1, 0).getDate();
  const selected  = parseIso(value);
  const now       = new Date();
  const todayKey  = toIso(now.getFullYear(), now.getMonth(), now.getDate());

  const cells = [
    ...Array.from({ length: leading }, () => null),
    ...Array.from({ length: dayCount }, (_, i) => i + 1),
  ];

  // A fully typed date we refused to accept — say so, rather than leaving the
  // student staring at a greyed-out button wondering what they did wrong.
  const typedIso = text.length === 10 ? displayToIso(text) : null;
  const rejected = text.length === 10
    && (!typedIso || !inRange(parseIso(typedIso).getTime()));

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      {/* Field */}
      <div
        className={`flex items-center w-full border rounded-xl bg-white transition-shadow ${
          invalid || rejected ? 'border-red-300 ring-2 ring-red-100'
                  : open ? 'border-[var(--accent,#4f46e5)] ring-2 ring-[color:var(--accent,#4f46e5)]/20'
                         : 'border-slate-200'
        } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}
      >
        <input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => handleText(e.target.value)}
          onFocus={() => setOpen(false)}
          className="flex-1 min-w-0 bg-transparent px-4 py-3 text-base outline-none placeholder:text-slate-500 disabled:cursor-not-allowed"
        />
        {clearable && value && !disabled && (
          <button type="button" onClick={() => commit('')} title="Clear"
                  className="p-1.5 text-slate-300 hover:text-slate-500 transition-colors">
            <X size={14} />
          </button>
        )}
        <button
          ref={btnRef}
          type="button"
          onClick={toggle}
          disabled={disabled}
          aria-label="Open calendar"
          aria-expanded={open}
          className="px-3 py-3 text-slate-400 hover:text-[var(--accent,#4f46e5)] transition-colors disabled:cursor-not-allowed"
        >
          <Calendar size={16} />
        </button>
      </div>

      {rejected && (
        <p className="text-xs text-red-500 mt-1.5">
          {typedIso ? 'That date is outside the allowed range.' : "That date doesn't exist — check the day and month."}
        </p>
      )}

      {/* Calendar */}
      {open && box && createPortal(
        <div
          ref={calRef}
          className="fixed z-[200] w-[19rem] max-w-[calc(100vw-16px)] bg-white border border-slate-200 rounded-2xl shadow-xl p-3"
          style={{ left: box.left, top: box.top, maxHeight: 'calc(100vh - 16px)', overflowY: 'auto' }}
        >
          {/* Month and year: the platform searchable dropdown (type "sep" or "2008"), half a row each so "September" never truncates on a phone. */}
          <div className="grid grid-cols-2 gap-2 mb-2">
            <FormSelect className="min-w-0" value={String(view.m)} clearable={false}
                        onChange={(v) => v !== '' && setView(c => ({ ...c, m: Number(v) }))}
                        options={MONTHS.map((mn, i) => ({ value: String(i), label: mn }))} />
            <FormSelect className="min-w-0" value={String(view.y)} clearable={false}
                        onChange={(v) => v !== '' && setView(c => ({ ...c, y: Number(v) }))}
                        options={years.map(y => ({ value: String(y), label: String(y) }))} />

          </div>
          <div className="flex items-center gap-1.5 mb-2.5">
            <button type="button" onClick={() => shiftMonth(-1)} disabled={prevDisabled}
                    aria-label="Previous month"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <ChevronLeft size={16} />
            </button>

            <p className="flex-1 text-center text-sm font-semibold text-slate-700">{MONTHS[view.m]} {view.y}</p>
            <button type="button" onClick={() => shiftMonth(1)} disabled={nextDisabled}
                    aria-label="Next month"
                    className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30 disabled:hover:bg-transparent transition-colors">
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Day-of-week strip */}
          <div className="grid grid-cols-7 mb-1">
            {DOW.map(d => (
              <div key={d} className="text-[11px] font-semibold text-slate-400 text-center py-1">{d}</div>
            ))}
          </div>

          {/* Days */}
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const iso  = toIso(view.y, view.m, day);
              const time = new Date(view.y, view.m, day).getTime();
              const off  = !inRange(time);
              const sel  = selected && iso === toIso(selected.getFullYear(), selected.getMonth(), selected.getDate());
              const isToday = iso === todayKey;
              return (
                <button
                  key={iso}
                  type="button"
                  disabled={off}
                  onClick={() => commit(iso)}
                  className={`h-8 rounded-lg text-sm transition-colors ${
                    sel ? 'text-white font-bold'
                        : off ? 'text-slate-200 cursor-not-allowed'
                              : 'text-slate-700 hover:bg-slate-100'
                  } ${isToday && !sel ? 'ring-1 ring-slate-300 font-semibold' : ''}`}
                  style={sel ? { backgroundColor: 'var(--accent, #4f46e5)' } : undefined}
                >
                  {day}
                </button>
              );
            })}
          </div>

          {/* Footer — what is actually selected, in words */}
          <div className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-slate-100">
            <span className="text-[11px] text-slate-400">
              {value ? isoToLong(value) : 'No date selected'}
            </span>
            {clearable && value && (
              <button type="button" onClick={() => commit('')}
                      className="text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
