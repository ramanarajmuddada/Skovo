/**
 * Tasks, organised into batches.
 *
 * WHAT CHANGED
 *   The tab used to be three cards -- everyone, a batch, one student -- and a
 *   task carried its own targeting, so "the B.Tech students" was not something
 *   you could point at. A batch is an object now: define the audience once,
 *   hang as many tasks off it as you like.
 *
 *   "Everyone" is a batch with neither filter set. One-student tasks are gone.
 *
 * THE TOGGLE
 *   Each batch decides whether Tab 1 Actions apply to its students as well as
 *   its own tasks. Turning it off is forward-only -- points already earned stay
 *   on the score, and a global task already under way still pays if finished.
 *
 *   When several batches match one student the most specific wins, so a narrow
 *   batch beats `Any / Any`. The header says which, because an admin who cannot
 *   see that rule will assume the toggle is broken.
 *
 * EDITING GOES THROUGH THE BATCH ROUTE
 *   Not the old /score-rules/tasks one. That procedure rewrites a batch task's
 *   targeting from the request body, so an edit that only carries a new label
 *   would blank the audience and the task would quietly reach nobody.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  ChevronDown, ChevronRight, Plus, Save, Trash2, Users, X, Pencil, Check,
  ToggleLeft, ToggleRight,
} from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { Card, Button, SectionTitle, FormSelect } from '../ui/index.jsx';
import useAudienceOptions from '../../hooks/useAudienceOptions';
import { useMasters } from '../../hooks/useMasters';
import TaskRoster from './TaskRoster';
import FormMultiSelect from '../ui/FormMultiSelect';
import { ConfirmModal } from '../ui/TableComponents';

const MAX_TASK_POINTS = 20;

/* Target pickers read one list for the whole tab: states, Inter streams, and the
   course catalogue's degrees and branches -- the masters the profile is filled
   from. Fetched once and shared by every task row. */
let targetsCache = null;
function useTaskTargets() {
  const [opts, setOpts] = useState(targetsCache);
  useEffect(() => {
    if (targetsCache) return;
    api.get('/skovo-platform-panel-admin/score-rules/task-targets')
      .then(({ data }) => { if (data?.bool) { targetsCache = data.response; setOpts(data.response); } })
      .catch(() => {});
  }, []);
  return opts || { states: [], streams: [], degrees: [], branches: [] };
}

const targetsOf = (t) => ({
  state: t.state || '',
  target_degrees: t.target_degrees || [],
  target_branches: t.target_branches || [],
  target_streams: t.target_streams || [],
});
const field = 'w-full min-h-11 px-3 border border-slate-200 rounded-xl text-sm';

/* ── one task inside a batch ─────────────────────────────────────────────── */
function BatchTask({ task, batchId, routes, onChanged, onReview, flash }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({
    label: task.label, points: String(task.points),
    action_route: task.action_route || '', ...targetsOf(task),
  });
  const targets = useTaskTargets();
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Hard delete. The server refuses a task that has already paid anyone.
  const remove = async () => {
    setConfirmDelete(false);
    setBusy(true);
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/score-rules/tasks/${task.id}`);
      if (data?.bool) { flash(data.response.message); onChanged(); }
      else flash(data?.response?.message || 'Could not delete.', 'error');
    } catch (e) {
      flash(e?.response?.data?.response?.message || 'Could not delete.', 'error');
    } finally { setBusy(false); }
  };

  useEffect(() => {
    setForm({ label: task.label, points: String(task.points),
              action_route: task.action_route || '', ...targetsOf(task) });
  }, [task]);

  const save = async (patch = {}) => {
    const pts = Number(patch.points ?? form.points);
    if (!String(patch.label ?? form.label).trim()) { flash('Name the task.', 'error'); return; }
    if (!Number.isFinite(pts) || pts < 0.1 || pts > MAX_TASK_POINTS) {
      flash(`Points must be from 0.1 to ${MAX_TASK_POINTS}.`, 'error'); return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(`/skovo-platform-panel-admin/score-rules/batches/${batchId}/tasks`, {
        id: task.id,
        label: (patch.label ?? form.label).trim(),
        points: pts,
        action_route: form.action_route || undefined,
        status: patch.status ?? task.status,
        state: form.state, target_degrees: form.target_degrees,
        target_branches: form.target_branches, target_streams: form.target_streams,
      });
      if (data?.bool) { flash(data.response.message); setEditing(false); onChanged(); }
      else flash(data?.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save.', 'error'); } finally { setBusy(false); }
  };

  const expired = task.status === 'expired';
  // Draft: loaded for review (e.g. from the readiness task sheets). Students
  // never see it until an admin activates it.
  const isDraft = task.status === 'draft';
  const isLive = !expired && !isDraft;

  return (
    <div className={`py-2.5 border-b border-slate-100 last:border-0 ${isLive ? '' : 'opacity-60'}`}>
      {confirmDelete && (
        <ConfirmModal
          danger
          message={`Delete "${task.label}" permanently?`}
          detail="It is removed from the database and cannot be undone. To stop it for now, switch it off instead."
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
      {/* Wraps on a phone: four 44px buttons beside the name left it ~20px. */}
      <div className="flex flex-wrap sm:flex-nowrap items-start gap-2">
        <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-lg text-xs font-bold"
          style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
          +{task.points}
        </span>
        <div className="min-w-0 flex-1 basis-[calc(100%-3.5rem)] sm:basis-auto">
          <p className="text-sm font-semibold text-slate-900 break-words">{task.label}</p>
          <p className="text-xs text-slate-400 break-words">
            {isDraft ? 'Draft · hidden from students' : `${task.paid_count} paid`}{expired ? ' · Off' : ''}
            {task.state ? ` · ${task.state} only` : ''}
            {task.claimed_count > 0 ? ` · ${task.claimed_count} waiting on you` : ''}
            {task.action_route ? ` · ${task.action_route}` : ''}
          </p>
          {(task.target_degrees?.length || task.target_branches?.length || task.target_streams?.length) ? (
            <p className="text-xs text-slate-500 break-words">
              For: {[...(task.target_degrees || []), ...(task.target_branches || []),
                     ...(task.target_streams || []).map((v) => targets.streams.find((s) => s.value === v)?.label || v)]
                    .join(', ')}
            </p>
          ) : null}
        </div>
        <div className="flex gap-1 shrink-0 ml-auto">
          {/* One tap on/off — it used to sit behind the pencil as "Expire". */}
          <button type="button" onClick={() => save({ status: isLive ? 'expired' : 'active' })} disabled={busy}
            aria-label={`${isLive ? 'Switch off' : 'Switch on'} ${task.label}`} title={isLive ? 'Switch off' : 'Switch on'}
            className="min-h-11 w-11 rounded-lg border border-slate-200 flex items-center justify-center disabled:opacity-50">
            {isLive ? <ToggleRight size={18} className="text-emerald-500" /> : <ToggleLeft size={18} className="text-slate-400" />}
          </button>
          <button type="button" onClick={() => setEditing((v) => !v)}
            aria-label={`Edit ${task.label}`}
            className="min-h-11 w-11 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center">
            <Pencil size={14} />
          </button>
          <button type="button" onClick={() => onReview(task)}
            aria-label={`Who owes ${task.label}`}
            className="min-h-11 w-11 rounded-lg border border-slate-200 text-slate-400 hover:text-slate-700 flex items-center justify-center">
            <Users size={14} />
          </button>
          <button type="button" onClick={() => setConfirmDelete(true)} disabled={busy}
            aria-label={`Delete ${task.label}`}
            className="min-h-11 w-11 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 flex items-center justify-center disabled:opacity-50">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {editing && (
        <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
          <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
            aria-label="Task name" className={field} />
          <div className="flex gap-2">
            <div className="relative flex-1 min-w-0">
              <input type="number" min="0.1" step="0.1" max={MAX_TASK_POINTS} value={form.points}
                onChange={(e) => setForm((f) => ({ ...f, points: e.target.value }))}
                aria-label="Points" className={`${field} pr-11`} />
              <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">pts</span>
            </div>
            <Button size="sm" className="min-h-11 shrink-0" onClick={() => save()} disabled={busy}>
              <Save size={13} /> Save
            </Button>
          </div>
          {/* Who sees it, on top of the batch: empty = everyone in the batch. */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">State</label>
              <FormSelect value={form.state} onChange={(v) => setForm((f) => ({ ...f, state: v || '' }))}
                options={targets.states} placeholder="Every state" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Inter stream</label>
              <FormMultiSelect values={form.target_streams}
                onChange={(v) => setForm((f) => ({ ...f, target_streams: v }))}
                options={targets.streams} placeholder="Any stream" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Courses</label>
              <FormMultiSelect values={form.target_degrees}
                onChange={(v) => setForm((f) => ({ ...f, target_degrees: v }))}
                options={targets.degrees} placeholder="Any course" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Branches</label>
              <FormMultiSelect values={form.target_branches}
                onChange={(v) => setForm((f) => ({ ...f, target_branches: v }))}
                options={(() => {
                  // Branches of the chosen courses, or of the batch's own course.
                  const degs = form.target_degrees.length ? form.target_degrees
                    : (task.degree_type ? [task.degree_type] : []);
                  const pool = degs.length
                    ? targets.branches.filter((b) => degs.some((d) => String(d).toLowerCase() === String(b.parent).toLowerCase()))
                    : targets.branches;
                  const seen = new Set();
                  return pool.filter((b) => !seen.has(b.value) && seen.add(b.value));
                })()}
                placeholder="Any branch" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Where they do it</label>
            <FormSelect value={form.action_route}
              onChange={(v) => setForm((f) => ({ ...f, action_route: v || '' }))}
              options={[{ value: '', label: 'No link' }, ...routes]}
              searchType="task_route" clearable={false} />
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" className="min-h-11"
              onClick={() => save({ status: expired || isDraft ? 'active' : 'expired' })} disabled={busy}>
              {isLive ? 'Switch off' : 'Switch on'}
            </Button>
            <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {/* Expiring is not deleting. What a task already paid stays paid -- the
              ledger is append-only -- so this only stops it being handed out. */}
          <p className="text-xs text-slate-400">
            Switching off stops the task being given out. Points already paid stay.
          </p>
        </div>
      )}
    </div>
  );
}

/* ── one batch ───────────────────────────────────────────────────────────── */
function Batch({ batch, stages, routes, onChanged, onReview, flash }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ label: '', points: '5', action_route: '' });
  const [busy, setBusy] = useState(false);

  const stageLabel = stages.find((s) => s.value === batch.education_category)?.label;
  const audience = [
    stageLabel || batch.education_category || 'Any stage',
    batch.degree_type || 'Any degree',
  ].join(' · ');

  const setGlobal = async (on) => {
    setBusy(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/score-rules/batches', {
        id: batch.id, name: batch.name,
        education_category: batch.education_category, degree_type: batch.degree_type,
        include_global: on,
      });
      if (data?.bool) {
        flash(on ? 'Global actions now apply to this batch.'
                 : 'This batch now earns from its own tasks only. Points already earned are kept.');
        onChanged();
      } else flash(data?.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save.', 'error'); } finally { setBusy(false); }
  };

  const addTask = async () => {
    const pts = Number(draft.points);
    if (!draft.label.trim()) { flash('Name the task.', 'error'); return; }
    if (!Number.isFinite(pts) || pts < 0.1 || pts > MAX_TASK_POINTS) {
      flash(`Points must be from 0.1 to ${MAX_TASK_POINTS}.`, 'error'); return;
    }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/score-rules/batches/${batch.id}/tasks`,
        { label: draft.label.trim(), points: pts,
          action_route: draft.action_route || undefined });
      if (data?.bool) {
        flash(data.response.message);
        setDraft({ label: '', points: '5', action_route: '' });
        setAdding(false); onChanged();
      }
      else flash(data?.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save.', 'error'); } finally { setBusy(false); }
  };

  const remove = async () => {
    if (!window.confirm(`Remove the batch "${batch.name}"?`)) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/score-rules/batches/${batch.id}`);
      if (data?.bool) { flash(data.response.message); onChanged(); }
      else flash(data?.response?.message || 'Could not remove.', 'error');
    } catch { flash('Could not remove.', 'error'); }
  };

  return (
    <Card className="p-4 mt-3">
      <div className="flex items-start gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
          className="min-w-0 flex-1 text-left flex items-start gap-2 min-h-11">
          <span className="mt-0.5 shrink-0 text-slate-400">
            {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-bold text-slate-900 break-words">{batch.name}</span>
            {batch.name !== audience && (
              <span className="block text-xs text-slate-400 break-words">{audience}</span>
            )}
            <span className="block mt-1 text-xs text-slate-500">
              {batch.task_count} task{batch.task_count === 1 ? '' : 's'}
              {(() => { const d = (batch.tasks || []).filter((t) => t.status === 'draft').length; return d ? ` + ${d} draft` : ''; })()}
              {' · '}{batch.student_count} student{batch.student_count === 1 ? '' : 's'}
            </span>
          </span>
        </button>
        <button type="button" onClick={remove} aria-label={`Remove ${batch.name}`}
          className="shrink-0 min-h-11 w-11 rounded-lg border border-slate-200 text-slate-400 hover:text-red-600 flex items-center justify-center">
          <Trash2 size={14} />
        </button>
      </div>

      {open && (
        <div className="mt-3 pt-3 border-t border-slate-100">

          <label className="flex items-start gap-2 cursor-pointer mb-3">
            <input type="checkbox" checked={batch.include_global} disabled={busy}
              onChange={(e) => setGlobal(e.target.checked)}
              className="mt-0.5 w-4 h-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-700">Also earn from global actions</span>
              <span className="block text-xs text-slate-400">
                {batch.include_global
                  ? 'These students earn from Tab 1 Actions as well as the tasks below.'
                  : 'These students earn from the tasks below only. Anything already earned is kept.'}
              </span>
            </span>
          </label>

          {batch.tasks?.length > 0 ? (
            <div className="border-t border-slate-100">
              {batch.tasks.map((t) => (
                <BatchTask key={t.id} task={t} batchId={batch.id} routes={routes}
                  onChanged={onChanged} onReview={onReview} flash={flash} />
              ))}
            </div>
          ) : (
            <p className="py-3 text-sm text-slate-400">No tasks in this batch yet.</p>
          )}

          {adding ? (
            <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
              <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                placeholder="What the student has to do" aria-label="Task name" className={field} />
              <div className="flex gap-2">
                <div className="relative flex-1 min-w-0">
                  <input type="number" min="0.1" step="0.1" max={MAX_TASK_POINTS} value={draft.points}
                    onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))}
                    aria-label="Points" className={`${field} pr-11`} />
                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">pts</span>
                </div>
                <Button size="sm" className="min-h-11 shrink-0" onClick={addTask} disabled={busy}>
                  <Check size={13} /> Add
                </Button>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Where they do it (optional)</label>
                {/* A task that names a place the student can tap beats one that
                    describes it and leaves them to find it. */}
                <FormSelect value={draft.action_route}
                  onChange={(v) => setDraft((d) => ({ ...d, action_route: v || '' }))}
                  options={[{ value: '', label: 'No link' }, ...routes]}
                  searchType="task_route" clearable={false} />
              </div>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setAdding(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="secondary" className="mt-3 min-h-11" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add a task to this batch
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}

/* ── the tab ─────────────────────────────────────────────────────────────── */
export default function BatchPanel({ flash }) {
  const { options } = useAudienceOptions();
  const stages = options.categories || [];
  const degrees = options.degrees || [];
  const { lists } = useMasters(['task_route']);
  const routes = (lists.task_route || []).map((r) => ({ value: r.value, label: r.label }));

  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', klass: '', degree: '', include_global: true });
  const [rosterFor, setRosterFor] = useState(null);
  const [busy, setBusy] = useState(false);
  // Show one class at a time — 12 batches, some with 98 tasks each.
  const [classFilter, setClassFilter] = useState('');

  const load = useCallback(() => {
    api.get('/skovo-platform-panel-admin/score-rules/batches')
      .then(({ data }) => {
        if (data?.bool) {
          setBatches(data.response.batches || []);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const addBatch = async () => {
    setBusy(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/score-rules/batches', {
        name: draft.name.trim() || undefined,
        education_category: draft.klass || undefined,
        degree_type: draft.degree || undefined,
        include_global: draft.include_global,
      });
      if (data?.bool) {
        flash(data.response.message);
        setDraft({ name: '', klass: '', degree: '', include_global: true });
        setAdding(false);
        load();
      } else flash(data?.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save the batch.', 'error'); } finally { setBusy(false); }
  };

  if (loading) return <div className="h-48 bg-white rounded-2xl border border-slate-200 animate-pulse" />;

  return (
    <>
      {rosterFor && (
        <TaskRoster task={rosterFor} flash={flash}
          onClose={() => setRosterFor(null)} onChanged={load} />
      )}

      <Card className="p-5">
        <SectionTitle>Batches</SectionTitle>
        <p className="text-xs text-slate-400 -mt-2 mb-3">
          A batch is who the tasks are for. Leave both filters empty and it means
          everyone. When a student matches more than one, the most specific batch
          decides whether global actions apply to them.
        </p>

        {batches.length === 0 && !adding && (
          <p className="py-3 text-sm text-slate-400">No batches yet.</p>
        )}

        {adding ? (
          <div className="mt-2 pt-3 border-t border-slate-100 space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Stage</label>
              <FormSelect value={draft.klass} onChange={(v) => setDraft((d) => ({ ...d, klass: v || '' }))}
                options={[{ value: '', label: 'Any stage' }, ...stages]} clearable={false} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Degree</label>
              <FormSelect value={draft.degree} onChange={(v) => setDraft((d) => ({ ...d, degree: v || '' }))}
                options={[{ value: '', label: 'Any degree' }, ...degrees]} clearable={false} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Name (optional)</label>
              <input value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Named after the audience if you leave this"
                aria-label="Batch name" className={field} />
            </div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={draft.include_global}
                onChange={(e) => setDraft((d) => ({ ...d, include_global: e.target.checked }))}
                className="mt-0.5 w-4 h-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-slate-700">Also earn from global actions</span>
                <span className="block text-xs text-slate-400">
                  Off means these students earn from this batch&rsquo;s tasks only.
                </span>
              </span>
            </label>
            <div className="flex gap-2">
              <Button size="sm" className="min-h-11" onClick={addBatch} disabled={busy}>
                <Save size={13} /> Add batch
              </Button>
              <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setAdding(false)}>
                <X size={13} /> Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="secondary" className="mt-2 min-h-11" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add a batch
          </Button>
        )}
      </Card>

      {batches.length > 1 && (
        <div className="mt-3 w-full sm:w-72">
          <FormSelect
            value={classFilter}
            onChange={(v) => setClassFilter(v || '')}
            options={[
              { value: '', label: `All classes (${batches.length} batches)` },
              ...[...new Set(batches.map((b) => b.education_category || ''))].map((v) => ({
                value: v || '__any',
                label: (stages.find((s) => s.value === v)?.label || v || 'Any stage')
                  + ` (${batches.filter((b) => (b.education_category || '') === v).length})`,
              })),
            ]}
            clearable={false}
            aria-label="Show batches for"
          />
        </div>
      )}

      {batches
        .filter((b) => !classFilter
          || (classFilter === '__any' ? !b.education_category : b.education_category === classFilter))
        .map((b) => (
        <Batch key={b.id} batch={b} stages={stages} routes={routes} onChanged={load}
          onReview={setRosterFor} flash={flash} />
      ))}

    </>
  );
}
