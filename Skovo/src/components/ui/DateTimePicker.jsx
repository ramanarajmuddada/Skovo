import React, { useMemo, useState } from 'react';
import { CalendarClock, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { MONTHS, DOW, toIso } from './dateUtils';
import TimePicker from './TimePicker';

/**
 * Date + time picker — the platform's replacement for <input type="datetime-local">.
 *
 * The native control looked different in every browser, showed "dd-mm-yyyy --:--"
 * until touched, and its popup ignored the dark theme. This one reads as a
 * sentence ("Tue, 20 Oct 2026 · 7:30 pm"), picks time in 12-hour form with an
 * AM/PM switch, and offers Today / Tomorrow shortcuts.
 *
 * The panel opens IN FLOW under the field, not as a floating layer: these
 * fields mostly live inside dialogs whose body scrolls, and a floating panel
 * there is clipped by the scroll box.
 *
 * Value in / out is the same string a datetime-local input uses —
 * `YYYY-MM-DDTHH:mm` in local time, '' when unset — so it drops in for one.
 */
const pad = (n) => String(n).padStart(2, '0');

function parse(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(v || '');
  if (!m) return null;
  return { y: +m[1], mo: +m[2] - 1, d: +m[3], h: +m[4], mi: +m[5] };
}
const build = ({ y, mo, d, h, mi }) => `${toIso(y, mo, d)}T${pad(h)}:${pad(mi)}`;
// Built by hand: en-IN's own format puts a comma before the year
// ("24 Oct, 2026") and runs too long for a 320px field.
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const label = (p) => {
  const dt = new Date(p.y, p.mo, p.d);
  const h12 = ((p.h + 11) % 12) + 1;
  return `${WD[dt.getDay()]}, ${p.d} ${MONTHS[p.mo].slice(0, 3)} ${p.y} · ${h12}:${pad(p.mi)} ${p.h >= 12 ? 'pm' : 'am'}`;
};

export default function DateTimePicker({
  value = '',
  onChange,
  min: minProp,                // 'YYYY-MM-DDTHH:mm' — days before it are disabled
  max,                         // 'YYYY-MM-DDTHH:mm' — days after it are disabled
  future = false,              // true: nothing before now (offers, due dates, coupons)
  placeholder = 'Pick date and time',
  disabled = false,
  invalid = false,
  clearable = true,
  defaultTime,                 // used when a day is picked before any time; default: now, rounded up to 5 min
  id,
  className = '',
}) {
  const sel = parse(value);
  let min = minProp;
  if (future) {
    const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset());
    const nowStr = n.toISOString().slice(0, 16);
    if (!min || min < nowStr) min = nowStr;
  }
  // No fixed 7 PM: start from the current time, rounded up to the next 5
  // minutes (10:13 -> 10:15, 10:16 -> 10:20), matching the minute steps.
  const dt = defaultTime || (() => {
    const n = new Date();
    const q = Math.ceil((n.getMinutes() + 1) / 5) * 5;
    const h = n.getHours() + (q === 60 ? 1 : 0);
    return h > 23 ? { h: 23, mi: 55 } : { h, mi: q === 60 ? 0 : q };
  })();
  const minP = parse(min);
  const [open, setOpen] = useState(false);
  const start = sel || minP || (() => { const n = new Date(); return { y: n.getFullYear(), mo: n.getMonth() }; })();
  const [view, setView] = useState({ y: start.y, m: start.mo });

  const minDay = minP ? new Date(minP.y, minP.mo, minP.d).getTime() : null;
  const maxP = parse(max);
  const maxDay = maxP ? new Date(maxP.y, maxP.mo, maxP.d).getTime() : null;
  const dayOff = (y, m, d) => {
    const t = new Date(y, m, d).getTime();
    return (minDay !== null && t < minDay) || (maxDay !== null && t > maxDay);
  };
  // Changing the time before any day is picked lands on today (or the min day),
  // never on an arbitrary 1st of the month.
  const base = () => {
    if (sel) return sel;
    const t = minP || (() => { const n = new Date(); return { y: n.getFullYear(), mo: n.getMonth(), d: n.getDate() }; })();
    return { ...dt, y: t.y, mo: t.mo, d: t.d };
  };
  // Kept inside min..max: picking the last allowed day lands on max's time,
  // not past it (an offer cannot end after the slot starts).
  const set = (patch) => {
    let v = build({ ...base(), ...patch });
    if (max && v > max) v = max.slice(0, 16);
    if (min && v < min) v = min.slice(0, 16);
    onChange?.(v);
  };

  const cells = useMemo(() => {
    const lead = new Date(view.y, view.m, 1).getDay();
    const count = new Date(view.y, view.m + 1, 0).getDate();
    return [...Array.from({ length: lead }, () => null), ...Array.from({ length: count }, (_, i) => i + 1)];
  }, [view]);

  const now = new Date();
  const todayKey = toIso(now.getFullYear(), now.getMonth(), now.getDate());
  const shift = (k) => setView(({ y, m }) => { const d = new Date(y, m + k, 1); return { y: d.getFullYear(), m: d.getMonth() }; });
  const prevOff = minDay !== null && new Date(view.y, view.m, 0).getTime() < minDay;
  const nextOff = maxDay !== null && new Date(view.y, view.m + 1, 1).getTime() > maxDay;

  const pickDay = (d) => set({ y: view.y, mo: view.m, d, ...(sel ? {} : dt) });
  const quick = (addDays) => {
    const t = new Date(); t.setDate(t.getDate() + addDays);
    setView({ y: t.getFullYear(), m: t.getMonth() });
    set({ y: t.getFullYear(), mo: t.getMonth(), d: t.getDate(), ...(sel ? {} : dt) });
  };



  return (
    <div className={className}>
      <div className={`flex items-center w-full min-h-11 border rounded-xl bg-white transition-shadow ${
        invalid ? 'border-red-300 ring-2 ring-red-100'
          : open ? 'border-[var(--accent,#4f46e5)] ring-2 ring-[color:var(--accent,#4f46e5)]/20' : 'border-slate-200'
      } ${disabled ? 'opacity-60 cursor-not-allowed' : ''}`}>
        <button type="button" id={id} disabled={disabled} onClick={() => setOpen((o) => !o)} aria-expanded={open}
                className="flex-1 min-w-0 flex items-center gap-2.5 px-3 py-2.5 text-left text-sm disabled:cursor-not-allowed">
          <CalendarClock size={16} className="shrink-0 text-slate-400" />
          <span className={`min-w-0 leading-snug ${sel ? 'text-slate-900 font-medium' : 'text-slate-400'}`}>{sel ? label(sel) : placeholder}</span>
        </button>
        {clearable && sel && !disabled && (
          <button type="button" onClick={() => { onChange?.(''); }} aria-label="Clear"
                  className="p-2 mr-1 text-slate-300 hover:text-slate-500"><X size={14} /></button>
        )}
      </div>

      {open && (
        <div className="mt-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex gap-1.5 mb-3">
            {[['Today', 0], ['Tomorrow', 1]].filter(([, d]) => {
              const t = new Date(); t.setDate(t.getDate() + d);
              return !dayOff(t.getFullYear(), t.getMonth(), t.getDate());
            }).map(([t, d]) => (
              <button key={t} type="button" onClick={() => quick(d)}
                      className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50">{t}</button>
            ))}
          </div>

          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={() => shift(-1)} disabled={prevOff} aria-label="Previous month"
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronLeft size={16} /></button>
            <p className="text-sm font-bold text-slate-800">{MONTHS[view.m]} {view.y}</p>
            <button type="button" onClick={() => shift(1)} disabled={nextOff} aria-label="Next month"
                    className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-30"><ChevronRight size={16} /></button>
          </div>
          <div className="grid grid-cols-7 mb-1">
            {DOW.map((d) => <div key={d} className="text-[11px] font-semibold text-slate-400 text-center py-1">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((day, i) => {
              if (day === null) return <div key={`b${i}`} />;
              const iso = toIso(view.y, view.m, day);
              const off = dayOff(view.y, view.m, day);
              const on = sel && iso === toIso(sel.y, sel.mo, sel.d);
              return (
                <button key={iso} type="button" disabled={off} onClick={() => pickDay(day)}
                        className={`h-9 rounded-lg text-sm transition-colors ${on ? 'text-white font-bold'
                          : off ? 'text-slate-400 opacity-30 line-through cursor-not-allowed' :'text-slate-700 hover:bg-slate-100'} ${
                          iso === todayKey && !on ? 'ring-1 ring-slate-300 font-semibold' : ''}`}
                        style={on ? { backgroundColor: 'var(--accent, #4f46e5)' } : undefined}>
                  {day}
                </button>
              );
            })}
          </div>

          <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-1.5">Time</p>
            <TimePicker value={sel ? `${pad(sel.h)}:${pad(sel.mi)}` : ''}
                        defaultValue={`${pad(dt.h)}:${pad(dt.mi)}`}
                        onChange={(v) => { const [h, mi] = v.split(':').map(Number); set({ h, mi }); }} />
          </div>

          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400 truncate">{sel ? label(sel) : 'Pick a day'}</span>
            <button type="button" onClick={() => setOpen(false)}
                    className="shrink-0 min-h-9 px-4 rounded-lg text-xs font-bold text-white"
                    style={{ backgroundColor: 'var(--accent, #4f46e5)' }}>Done</button>
          </div>
        </div>
      )}
    </div>
  );
}
