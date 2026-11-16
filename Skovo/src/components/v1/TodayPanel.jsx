/**
 * Dashboard "Today" card (feature-updates.md §6, §7): streak, daily goal,
 * quests, boost, mistakes due. Every block hides itself when the
 * admin has not switched that feature on.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flame, Target, Zap, RotateCcw } from 'lucide-react';
import { api } from '../../services/api';

function Bar({ value, max }) {
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-blue-600" style={{ width: `${pct}%` }} /></div>;
}

export default function TodayPanel() {
  const [d, setD] = useState(null);
  useEffect(() => {
    api.get('/engagement/today').then(({ data }) => data?.bool && setD(data.response)).catch(() => {});
  }, []);
  if (!d) return null;
  const st = d.streak || {};
  const anything = st.enabled || d.goal || d.quests?.length || d.mistakes_due || d.boost;
  if (!anything) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-900">Today</h3>

      </div>

      {st.enabled && (
        <Link to="/streak" className={`flex items-center gap-3 p-3 rounded-xl ${st.at_risk ? 'bg-red-50' : 'bg-orange-50'}`}>
          <Flame size={22} className={st.kept_today ? 'text-orange-500' : 'text-slate-400'} />
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-900">{st.lifetime_current} day streak <span className="text-xs font-normal text-slate-500">· this stage {st.stage_current}</span></p>
            <p className="text-xs text-slate-600">
              {st.exam_window
                ? `📚 ${st.exam_window.label}: your streak is safe`
                : st.kept_today ? 'Kept for today ✓' : st.at_risk ? 'Do one task today to keep it' : 'Start your streak with one task'}
              {st.freezes_on && st.freezes_held > 0 && ` · ${st.freezes_held} freeze${st.freezes_held > 1 ? 's' : ''}`}
            </p>
          </div>
        </Link>
      )}

      {d.boost && (
        <div className="flex items-center gap-2 text-xs bg-violet-50 text-violet-700 rounded-xl px-3 py-2">
          <Zap size={14} /> {d.boost.multiplier}× points boost until {new Date(d.boost.ends_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
      )}

      {d.goal && d.goal.goal && (
        <div className="space-y-1">
          <div className="flex justify-between text-xs"><span className="inline-flex items-center gap-1 font-semibold text-slate-700"><Target size={13} /> Daily goal</span>
            <span>{d.goal.done_today}/{d.goal.goal.tasks_per_day}{d.goal.met_today && ' ✓'}</span></div>
          <Bar value={d.goal.done_today} max={d.goal.goal.tasks_per_day} />
        </div>
      )}
      {d.goal && !d.goal.goal && (
        <Link to="/streak" className="block text-xs text-blue-700 font-semibold">Set a daily goal →</Link>
      )}

      {d.quests?.length > 0 && (
        <div className="space-y-2">
          {d.quests.map((q) => (
            <div key={q.quest_id} className="space-y-1">
              <div className="flex justify-between text-xs"><span className={q.done ? 'line-through text-slate-400' : 'text-slate-700'}>{q.label}</span>
                <span>{q.progress}/{q.target}</span></div>
              <Bar value={q.progress} max={q.target} />
            </div>
          ))}
        </div>
      )}

      {d.challenge && (
        <p className="text-xs text-slate-600">Monthly challenge: {d.challenge.label} — {d.challenge.done}/{d.challenge.target}{d.challenge.earned && ' 🏅'}</p>
      )}
      {d.mistakes_due > 0 && (
        <Link to="/practice?tab=mistakes" className="flex items-center gap-2 text-xs font-semibold text-rose-700"><RotateCcw size={13} /> {d.mistakes_due} question(s) to retry in My Mistakes</Link>
      )}
    </div>
  );
}
