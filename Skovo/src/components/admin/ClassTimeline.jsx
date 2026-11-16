/**
 * What actually happened in a class or 1-on-1, for admin's detail view:
 * when the achiever pressed Start (and how late), when it ended (by the
 * achiever or closed automatically), missed, moved, and when the achiever is
 * paid. Admin checks this before deciding a student's complaint.
 */
import React from 'react';
import { PlayCircle, StopCircle, AlertTriangle, CalendarClock, IndianRupee } from 'lucide-react';

const at = (iso) => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '');

export default function ClassTimeline({ t, status }) {
  if (!t) return null;
  if (!t.rules) {
    return (
      <p className="text-xs text-slate-500 rounded-lg border border-slate-200 p-2.5">
        Created before the class rules: Start and End times were not recorded for this class.
      </p>
    );
  }
  const rows = [];
  if (t.rescheduled_at) rows.push([CalendarClock, 'text-indigo-600', `Time changed by the achiever on ${at(t.rescheduled_at)}`]);
  if (t.missed_at) {
    rows.push([AlertTriangle, 'text-red-600', `Missed: not started by ${at(t.start_closes_at)}. Students got 100% back.`]);
  } else if (t.started_at) {
    rows.push([PlayCircle, t.late_min > 0 ? 'text-amber-600' : 'text-emerald-600',
      `Started ${at(t.started_at)}${t.late_min > 0 ? ` (${t.late_min} min late)` : ' (on time)'}`]);
  } else {
    rows.push([PlayCircle, 'text-slate-400', status === 'cancelled' ? 'Never started (cancelled)' : 'Not started yet']);
  }
  if (t.ended_at) {
    rows.push([StopCircle, t.ended_by === 'auto' ? 'text-amber-600' : 'text-emerald-600',
      `Ended ${at(t.ended_at)} · ${t.ended_by === 'auto' ? 'closed automatically (End session not pressed)' : 'by the achiever'}`]);
  } else if (t.started_at) {
    rows.push([StopCircle, 'text-slate-400', 'Not ended yet']);
  }
  if (t.paid_at) {
    const done = new Date(t.paid_at) <= new Date();
    rows.push([IndianRupee, done ? 'text-emerald-600' : 'text-slate-500',
      done ? `Achiever paid ${at(t.paid_at)}` : `Achiever paid ${at(t.paid_at)} if no complaint`]);
  }
  return (
    <ul className="rounded-lg border border-slate-200 p-2.5 space-y-1.5">
      {rows.map((row) => {
        const Icon = row[0];
        return (
          <li key={row[2]} className="flex items-start gap-2 text-xs text-slate-700">
            <Icon size={14} className={`shrink-0 mt-px ${row[1]}`} /> <span className="min-w-0">{row[2]}</span>
          </li>
        );
      })}
    </ul>
  );
}
