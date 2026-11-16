import React from 'react';
import FormSelect from './FormSelect';

/**
 * Time of day — the platform's replacement for <input type="time">, whose
 * popup is a white system menu over the dark theme and differs per browser.
 *
 * Hour and minute are searchable FormSelects, plus an AM/PM switch. Value in /
 * out is 'HH:mm' (24-hour, as a time input gives), '' when unset. Picking any
 * part of an empty value fills the rest from `defaultValue`.
 */
const pad = (n) => String(n).padStart(2, '0');
const HOUR_OPTS = Array.from({ length: 12 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));

export default function TimePicker({ value = '', onChange, step = 5, defaultValue = '09:00', disabled = false, id }) {
  const m = /^(\d{1,2}):(\d{2})/.exec(value || '') || /^(\d{1,2}):(\d{2})/.exec(defaultValue);
  const h24 = Number(m[1]);
  const mi = Number(m[2]);
  const has = Boolean(value);
  const isPm = h24 >= 12;
  const h12 = ((h24 + 11) % 12) + 1;
  // :59 is always offered: "up to the end of the day" is 11:59 PM, not 11:55.
  const minuteOpts = [...Array.from({ length: Math.floor(60 / step) }, (_, i) => ({ value: String(i * step), label: pad(i * step) })),
    ...(60 % step === 0 && step > 1 ? [{ value: '59', label: '59' }] : [])];

  const emit = (h, min) => onChange?.(`${pad(h)}:${pad(min)}`);
  const setHour = (v) => v && emit((Number(v) % 12) + (isPm ? 12 : 0), mi);
  const setMin = (v) => v !== '' && v != null && emit(h24, Number(v));
  const setPm = (pm) => emit((h24 % 12) + (pm ? 12 : 0), mi);

  return (
    // Sized by its container, not the screen: inside a narrow day card at
    // 320px three controls in a row cut the minutes to "0.", so AM/PM drops to
    // its own row until the box is wide enough for all three.
    <div id={id} className="@container">
    <div className="grid grid-cols-2 @[19rem]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] gap-2 items-center">
      <FormSelect value={has ? String(h12) : ''} onChange={setHour} options={HOUR_OPTS}
                  clearable={false} placeholder="Hr" disabled={disabled} />
      <FormSelect value={has ? String(mi === 59 ? 59 : mi - (mi % step)) : ''} onChange={setMin} options={minuteOpts}
                  clearable={false} placeholder="Min" disabled={disabled} />
      <div className={`col-span-2 @[19rem]:col-span-1 grid grid-cols-2 rounded-xl border border-slate-200 overflow-hidden h-11 ${disabled ? 'opacity-50' : ''}`}>
        {['AM', 'PM'].map((p) => {
          const on = has && (p === 'PM') === isPm;
          return (
            <button key={p} type="button" disabled={disabled} onClick={() => setPm(p === 'PM')}
                    className={`px-2.5 text-xs font-bold ${on ? 'text-white' : 'text-slate-500 hover:bg-slate-50'}`}
                    style={on ? { backgroundColor: 'var(--accent, #4f46e5)' } : undefined}>{p}</button>
          );
        })}
      </div>
    </div>
    </div>
  );
}
