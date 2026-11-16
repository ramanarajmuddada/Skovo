/**
 * Free 1-on-1 times: day chips, then start times for the day picked.
 * `dates` comes from the server ([{ date: 'YYYY-MM-DD', times: ['18:00'] }]),
 * already inside the achiever's hours and clear of cohorts and bookings.
 */
import React from 'react';

const fmt = (t) => {
  const [h, m] = String(t).split(':');
  const hr = parseInt(h, 10);
  return `${hr % 12 || 12}:${m} ${hr < 12 ? 'AM' : 'PM'}`;
};

export default function FreeTimes({ dates, value, onChange, empty = 'No free times in the next 4 weeks.' }) {
  const day = value?.date || dates[0]?.date || '';
  const times = dates.find((d) => d.date === day)?.times || [];
  if (!dates.length) return <p className="text-sm text-slate-400 py-6 text-center">{empty}</p>;
  return (
    <div>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1" role="group" aria-label="Day">
        {dates.map((d) => {
          const dt = new Date(d.date + 'T00:00:00');
          const on = day === d.date;
          return (
            <button key={d.date} type="button" onClick={() => onChange({ date: d.date, time: '' })}
                    className={`shrink-0 min-w-14 min-h-14 px-2 rounded-xl border text-center ${on ? 'text-white border-transparent' : 'border-slate-200 bg-white text-slate-600'}`}
                    style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
              <span className="block text-[11px] font-semibold">{dt.toLocaleDateString('en-IN', { weekday: 'short' })}</span>
              <span className="block text-sm font-bold">{dt.getDate()} {dt.toLocaleDateString('en-IN', { month: 'short' })}</span>
            </button>
          );
        })}
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3" role="group" aria-label="Start time">
        {times.map((t) => {
          const on = value?.date === day && value?.time === t;
          return (
            <button key={t} type="button" onClick={() => onChange({ date: day, time: t })}
                    className={`min-h-11 rounded-xl text-xs font-semibold border ${on ? 'text-white border-transparent' : 'border-slate-200 bg-white text-slate-600'}`}
                    style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
              {fmt(t)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
