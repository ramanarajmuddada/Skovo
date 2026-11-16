/**
 * Who a readiness task reaches, and crediting them in bulk.
 *
 * WHY THIS EXISTS
 *   Tasks are verified by hand -- an admin decides, because a free-text task
 *   ("attend the Hyderabad workshop") has no signal the product can read.
 *   That is workable for five students and unusable for a hundred: the only way
 *   to credit them was to open each student's panel in turn.
 *
 *   This is the same job on one screen -- the roster for a task, split into who
 *   still owes it and who has been paid, with checkboxes.
 *
 * SAFE TO RE-RUN
 *   sp_score_task_complete is idempotent per (task, student), so someone already
 *   credited comes back as a repeat rather than being paid twice. A half-finished
 *   batch can simply be run again.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { adminApi as api } from '../../services/api';

const STATES = [
  // Claimed first: it is the queue an admin is meant to work through, and
  // without it every unpaid student looks identical.
  { key: 'submitted', label: 'Claimed' },
  { key: 'pending',   label: 'Pending' },
  { key: 'done',      label: 'Done' },
  { key: 'all',       label: 'All' },
];

export default function TaskRoster({ task, onClose, onChanged, flash }) {
  const [state, setState] = useState('submitted');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [picked, setPicked] = useState(() => new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!task?.id) return;
    setLoading(true);
    api.get(`/skovo-platform-panel-admin/score-rules/tasks/${task.id}/roster`,
      { state, q: q.trim(), limit: 200 })
      .then(({ data }) => { if (data?.bool) setRows(data.response.students || []); })
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [task?.id, state, q]);

  // Debounced so typing a name does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(load, 220);
    return () => clearTimeout(t);
  }, [load]);

  // Clearing the selection when the filter changes matters: a tick made under
  // "Pending" must not silently still be held when the list has moved on.
  useEffect(() => { setPicked(new Set()); }, [state, task?.id]);

  if (!task) return null;

  const pendingRows = rows.filter((r) => !r.done);
  const toggle = (id) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allPendingPicked = pendingRows.length > 0 && pendingRows.every((r) => picked.has(r.id));
  const toggleAll = () => setPicked(allPendingPicked ? new Set() : new Set(pendingRows.map((r) => r.id)));

  const credit = async () => {
    if (!picked.size || busy) return;
    setBusy(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/score-rules/tasks/complete-bulk',
        { task_id: task.id, user_ids: [...picked] });
      if (data?.bool) {
        flash?.(data.response.message);
        setPicked(new Set());
        load();
        onChanged?.();
      } else flash?.(data?.response?.message || 'Could not credit these students.', 'error');
    } catch {
      flash?.('Could not credit these students.', 'error');
    } finally {
      setBusy(false);
    }
  };

  const fmt = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden">

        <div className="flex items-start justify-between gap-2 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-slate-900 break-words">{task.label}</h2>
            <p className="text-xs text-slate-400">+{task.points} points · {task.scope}</p>
          </div>
          <button onClick={onClose} aria-label="Close"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-slate-100 shrink-0 space-y-2">
          <div className="flex gap-1 p-1 rounded-xl bg-slate-100" role="tablist">
            {STATES.map((s) => (
              <button key={s.key} role="tab" aria-selected={state === s.key}
                onClick={() => setState(s.key)}
                className={`flex-1 min-h-11 rounded-lg text-sm font-semibold transition-colors ${
                  state === s.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
                {s.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Search students" aria-label="Search students"
              className="w-full min-h-11 pl-9 pr-3 rounded-xl border border-slate-200 text-sm" />
          </div>
          {pendingRows.length > 0 && (
            <button type="button" onClick={toggleAll}
              className="text-xs font-semibold text-violet-700 min-h-11">
              {allPendingPicked ? 'Clear selection' : `Select all ${pendingRows.length} pending`}
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          {loading && <p className="py-8 text-center text-sm text-slate-400">Loading…</p>}
          {!loading && rows.length === 0 && (
            <p className="py-8 text-center text-sm text-slate-400">
              {state === 'pending' ? 'Nobody is waiting on this one.' : 'No students match.'}
            </p>
          )}
          <ul className="divide-y divide-slate-100">
            {!loading && rows.map((r) => (
              <li key={r.id} className="py-2">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" disabled={r.done}
                    checked={picked.has(r.id)} onChange={() => toggle(r.id)}
                    className="mt-1 w-4 h-4 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-900 break-words">{r.full_name}</span>
                    <span className="block text-xs text-slate-400 break-all">{r.email}</span>
                  </span>
                  {r.done ? (
                    <span className="shrink-0 text-[11px] font-bold text-emerald-600 flex items-center gap-1">
                      <Check size={12} /> {fmt(r.done_at) || 'Done'}
                    </span>
                  ) : r.submitted ? (
                    <span className="shrink-0 text-[11px] font-bold text-blue-600">
                      Claimed {fmt(r.submitted_at)}
                    </span>
                  ) : null}
                </label>
              </li>
            ))}
          </ul>
        </div>

        <div className="px-5 py-4 border-t border-slate-100 shrink-0">
          <button type="button" onClick={credit} disabled={!picked.size || busy}
            className="w-full min-h-11 rounded-xl text-sm font-bold text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--accent)' }}>
            {busy ? 'Crediting…'
              : picked.size ? `Give the points to ${picked.size}` : 'Select students to credit'}
          </button>
        </div>
      </div>
    </div>
  );
}
