/**
 * Achiever: build a task's quiz and rubric, see results (feature-updates.md §5).
 * No points field anywhere — points are admin score rules.
 */
import React, { useEffect, useState } from 'react';
import { achieverApi } from '../../services/api';
import { Modal, useToast } from '../ui/index.jsx';
import FormSelect from '../ui/FormSelect';
import { Plus, X } from 'lucide-react';

const cls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

const payloadOf = (s) => ({
  ...s, time_limit_minutes: Number(s.time_limit_minutes || 0), max_attempts: Number(s.max_attempts || 1),
  negative_marks: Number(s.negative_marks || 0), pool_size: Number(s.pool_size || 0),
  pass_percent: s.pass_percent === '' || s.pass_percent === null ? null : Number(s.pass_percent),
  rubric: (s.rubric || []).filter((l) => l.label && l.max).map((l) => ({ label: l.label, max: Number(l.max) })),
});

/** How a task is marked. With `mode`, the task's Type decides it ('auto' for a
 *  Quiz, 'manual' for everything else) and it is saved straight away, so the
 *  achiever never has to find a second switch. */
export function Settings({ taskId, mode }) {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [sessions, setSessions] = useState([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    achieverApi.get(`/achievers/portal/tasks/${taskId}/settings`).then(({ data }) => {
      if (!data?.bool) return;
      const loaded = data.response.settings;
      setSessions(data.response.sessions || []);
      if (mode && loaded.grading_mode !== mode) {
        const next = { ...loaded, grading_mode: mode };
        setS(next);
        achieverApi.put(`/achievers/portal/tasks/${taskId}/settings`, payloadOf(next)).catch(() => {});
      } else setS(loaded);
    }).catch(() => {});
  }, [taskId, mode]);
  if (!s) return <p className="text-sm text-slate-400">Loading…</p>;
  const set = (k, v) => setS((p) => ({ ...p, [k]: v }));
  const save = async () => {
    setSaving(true);
    const { data } = await achieverApi.put(`/achievers/portal/tasks/${taskId}/settings`, payloadOf(s));
    setSaving(false);
    if (data?.bool) { toast.success('Saved.'); setS(data.response.settings); } else toast.error(data?.response?.message || 'Could not save.');
  };
  const auto = s.grading_mode === 'auto';
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-3">
        {!mode && (
        <label className="text-sm font-semibold text-slate-700 space-y-1">How is it checked?
          <FormSelect value={s.grading_mode} onChange={(v) => v && set('grading_mode', v)} clearable={false}
                      options={[{ value: 'auto', label: 'Auto-checked quiz (questions above)' },
                                { value: 'manual', label: 'I review it (link / text / upload)' }]} />
        </label>
        )}
        {/* Only when the cohort has extra sessions to link to — an always-empty
            dropdown on a single-class cohort. */}
        {sessions.length > 0 && (
        <label className="text-sm font-semibold text-slate-700 space-y-1">Session
          <FormSelect value={s.session_id || ''} onChange={(v) => set('session_id', v || '')}
                      placeholder="Not linked to a session" options={sessions.map((x) => ({ value: x.id, label: x.title }))} />
        </label>
        )}
        {/* Only the fields for the chosen way of marking: quiz rules for an
            auto-checked quiz, the rubric for work you review. Showing both
            left an achiever marking a resume looking at "negative marks". */}
        {auto && <>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Time limit (minutes, 0 = none)
          <input className={cls} type="number" min={0} value={s.time_limit_minutes ?? 0} onChange={(e) => set('time_limit_minutes', e.target.value)} />
        </label>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Attempts allowed
          <input className={cls} type="number" min={1} max={10} value={s.max_attempts} onChange={(e) => set('max_attempts', e.target.value)} />
        </label>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Pass % (for the "passed" rule)
          <input className={cls} type="number" min={0} max={100} value={s.pass_percent ?? ''} onChange={(e) => set('pass_percent', e.target.value)} />
        </label>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Negative marks per wrong answer
          <input className={cls} type="number" min={0} step={0.25} value={s.negative_marks} onChange={(e) => set('negative_marks', e.target.value)} />
        </label>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Each student gets N random questions (0 = all)
          <input className={cls} type="number" min={0} value={s.pool_size ?? 0} onChange={(e) => set('pool_size', e.target.value)} />
        </label>
        <label className="text-sm font-semibold text-slate-700 space-y-1">Show answers
          <FormSelect value={s.review_after} onChange={(v) => v && set('review_after', v)} clearable={false}
                      options={[{ value: 'deadline', label: 'After the deadline' },
                                { value: 'submit', label: 'Right after submitting' },
                                { value: 'never', label: 'Never' }]} />
        </label>
        <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <input type="checkbox" checked={!!s.shuffle} onChange={(e) => set('shuffle', e.target.checked)} /> Shuffle questions and options
        </label>
        </>}
      </div>
      {!auto && (
      <div className="space-y-2">
        <p className="text-sm font-semibold text-slate-700">Rubric</p>
        <p className="text-xs text-slate-500 -mt-1">The points you mark each submission on, e.g. "Fits on one page — 3".</p>
        {(s.rubric || []).map((l, i) => (
          <div key={i} className="flex gap-2">
            <input className={cls} value={l.label} placeholder="e.g. Concept explained correctly"
                   onChange={(e) => set('rubric', s.rubric.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
            <input className={`${cls} w-24`} type="number" min={1} value={l.max} placeholder="Max"
                   onChange={(e) => set('rubric', s.rubric.map((x, j) => (j === i ? { ...x, max: e.target.value } : x)))} />
            <button onClick={() => set('rubric', s.rubric.filter((_, j) => j !== i))} className="p-2 text-slate-400" aria-label="Remove line"><X size={14} /></button>
          </div>
        ))}
        {(s.rubric || []).length < 10 && (
          <button onClick={() => set('rubric', [...(s.rubric || []), { label: '', max: 3 }])} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600"><Plus size={13} /> Add rubric line</button>
        )}
      </div>
      )}
      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : (auto ? 'Save quiz rules' : 'Save rubric')}</button>
      </div>
    </div>
  );
}

export function Results({ taskId }) {
  const [r, setR] = useState(null);
  useEffect(() => {
    achieverApi.get(`/achievers/portal/tasks/${taskId}/results`).then(({ data }) => data?.bool && setR(data.response)).catch(() => {});
  }, [taskId]);
  if (!r) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <div className="space-y-4 text-sm">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-slate-50 rounded-xl p-3"><p className="text-xs text-slate-500">Submitted</p><p className="text-lg font-bold">{r.submitted} / {r.enrolled}</p></div>
        <div className="bg-slate-50 rounded-xl p-3"><p className="text-xs text-slate-500">Class average</p><p className="text-lg font-bold">{r.average_percent ?? '—'}%</p></div>
        <div className="bg-slate-50 rounded-xl p-3"><p className="text-xs text-slate-500">Not submitted</p><p className="text-lg font-bold">{r.not_submitted.length}</p></div>
      </div>
      {r.questions.length > 0 && (
        <div>
          <p className="font-semibold mb-1">Hardest questions first</p>
          {r.questions.slice(0, 5).map((q) => (
            <div key={q.question_id} className="flex justify-between border-t py-1.5"><span className="truncate pr-3">{q.text}</span><span className="font-semibold">{q.correct_percent ?? '—'}% right</span></div>
          ))}
        </div>
      )}
      <div>
        <p className="font-semibold mb-1">Students</p>
        {r.students.map((s) => (
          <div key={s.user_id} className="flex justify-between border-t py-1.5">
            <span>{s.name} {s.late && <span className="text-amber-600 text-xs">late</span>} {s.flags?.tab_switches && <span className="text-red-600 text-xs">· {s.flags.tab_switches} tab switches</span>} {s.flags?.identical_wrong_answers_with && <span className="text-red-600 text-xs">· same wrong answers as another student</span>}</span>
            <span className="font-semibold">{s.score}/{s.total} ({s.percent}%)</span>
          </div>
        ))}
        {r.not_submitted.length > 0 && <p className="text-xs text-slate-500 mt-2">Not yet: {r.not_submitted.map((x) => x.name).join(', ')}</p>}
      </div>
    </div>
  );
}

export default function QuizBuilderModal({ task, onClose }) {
  if (!task) return null;
  return (
    <Modal isOpen={!!task} onClose={onClose} size="lg"
           title={<>Results<span className="block text-xs font-normal text-slate-400 mt-0.5 truncate">{task.title}</span></>}>
      <Results taskId={task.id} />
    </Modal>
  );
}
