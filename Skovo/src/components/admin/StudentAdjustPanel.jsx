/**
 * One student: find them, see where they stand, change it.
 *
 * WHY THIS SHAPE
 *   Adjust used to be a search box and two number fields. You could move a
 *   score without ever seeing what it was made of -- no level, no tasks, no
 *   sense of whether the student was stuck or just new.
 *
 *   Now picking a student opens everything about their score in one place:
 *   what it is, what they can still earn, what they have claimed, and whether
 *   global actions even reach them. The two number fields are still there;
 *   they are just no longer the whole screen.
 *
 * TASKS FOR ONE PERSON LIVE HERE
 *   The Tasks tab is audiences only. A task aimed at exactly one student has
 *   no audience, so it belongs on the screen that already works one student at
 *   a time.
 *
 * WHY IT SHOWS "not earning from global actions"
 *   A batch can switch Tab 1 Actions off for its students. That is invisible
 *   from a score alone, and an admin looking at a stalled student would
 *   reasonably conclude the engine was broken. The panel names the batch that
 *   decided it.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, Save, Users, X } from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { Card, Button, SectionTitle, Badge, FormSelect, DateRange, RANGE_PRESETS } from '../ui/index.jsx';
import { Pagination } from '../ui/TableComponents';
import useAudienceOptions from '../../hooks/useAudienceOptions';
import { useMasters } from '../../hooks/useMasters';
import TaskRoster from './TaskRoster';
import FormMultiSelect from '../ui/FormMultiSelect';

const MAX_TASK_POINTS = 20;
const field = 'w-full min-h-11 px-3 border border-slate-200 rounded-xl text-sm';

export default function StudentAdjustPanel({ flash, onDone }) {
  const { options } = useAudienceOptions();
  const stages = options.categories || [];
  const { lists } = useMasters(['task_route']);
  const routes = (lists.task_route || []).map((r) => ({ value: r.value, label: r.label }));

  // Pick one or several students from a searchable multi-select, narrowed by
  // stage. One picked -> their full panel; several -> one adjustment for all.
  const [category, setCategory] = useState('');
  const [studentOpts, setStudentOpts] = useState([]);       // students for the stage, up to 100
  const [known, setKnown] = useState({});           // id -> student, survives a stage change
  const [selectedIds, setSelectedIds] = useState([]);
  const [optsLoading, setOptsLoading] = useState(false);

  // Recent adjustments: a date range (last 30 days to start) and pages.
  const [adjRange, setAdjRange] = useState(() => {
    const p = RANGE_PRESETS.find((r) => r.label === 'Last 30 days') || RANGE_PRESETS[0];
    return { from: p.from(), to: p.to() };
  });
  const [adjPage, setAdjPage] = useState(1);
  const [adjPer, setAdjPer] = useState(20);
  const [adjMeta, setAdjMeta] = useState({ total: 0, pages: 1 });
  useEffect(() => { setAdjPage(1); }, [adjRange.from, adjRange.to, adjPer]);

  const selected = selectedIds.map((id) => known[id]).filter(Boolean);
  const student = selected.length === 1 ? selected[0] : null;
  const [detail, setDetail] = useState(null);
  const [log, setLog] = useState([]);

  const [delta, setDelta] = useState('');
  const [target, setTarget] = useState('');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);

  const [addingTask, setAddingTask] = useState(false);
  const [draft, setDraft] = useState({ label: '', points: '5', action_route: '' });
  const [rosterFor, setRosterFor] = useState(null);

  /* ── students for the dropdown ───────────────────────────────────────── */
  const loadOptions = useCallback(() => {
    setOptsLoading(true);
    api.get('/skovo-platform-panel-admin/score-rules/students/search', {
      q: '', education_category: category, page: 1, per_page: 100,
    })
      .then(({ data }) => {
        if (!data?.bool) return;
        const rows = data.response.students || [];
        setStudentOpts(rows);
        setKnown((k) => ({ ...k, ...Object.fromEntries(rows.map((r) => [r.id, r])) }));
      })
      .catch(() => setStudentOpts([]))
      .finally(() => setOptsLoading(false));
  }, [category]);

  useEffect(() => { loadOptions(); }, [loadOptions]);

  /* ── the selected student ────────────────────────────────────────────── */
  const loadDetail = useCallback((id) => {
    if (!id) { setDetail(null); return; }
    api.get(`/skovo-platform-panel-admin/score-rules/students/${id}/tasks`)
      .then(({ data }) => { if (data?.bool) setDetail(data.response); })
      .catch(() => setDetail(null));
  }, []);

  const loadLog = useCallback(() => {
    api.get('/skovo-platform-panel-admin/score-rules/adjust', {
      from: adjRange.from, to: adjRange.to, page: adjPage, per_page: adjPer,
    })
      .then(({ data }) => {
        if (data?.bool) {
          setLog(data.response.adjustments || []);
          setAdjMeta({ total: data.response.total || 0, pages: data.response.pages || 1 });
        }
      })
      .catch(() => {});
  }, [adjRange.from, adjRange.to, adjPage, adjPer]);

  useEffect(() => { loadLog(); }, [loadLog]);

  // Opening one student loads their tasks; a bulk pick has no per-student panel.
  const singleId = student?.id;
  useEffect(() => {
    setDelta(''); setTarget(''); setReason('');
    loadDetail(singleId || null);
  }, [singleId, loadDetail]);

  const refreshStudent = () => { loadOptions(); if (singleId) loadDetail(singleId); };

  /* ── actions ─────────────────────────────────────────────────────────── */
  // One adjustment per picked student, same reason, each in the audit log.
  const adjust = async () => {
    if (saving || !selected.length) return;
    setSaving(true);
    const failed = [];
    let last = null;
    for (const st of selected) {
      try {
        const body = { user_id: st.id, reason: reason.trim() };
        if (target !== '') body.target = Number(target);
        else body.delta = Number(delta);
        const { data } = await api.post('/skovo-platform-panel-admin/score-rules/adjust', body);
        if (data?.bool) last = data.response; else failed.push(st.full_name);
      } catch { failed.push(st.full_name); }
    }
    const ok = selected.length - failed.length;
    if (ok && !failed.length) {
      flash(selected.length === 1
        ? `${last?.message || 'Score adjusted.'} New score: ${last?.score}.`
        : `${ok} students adjusted.`);
    } else if (ok) {
      flash(`${ok} adjusted. Not adjusted: ${failed.join(', ')}.`, 'error');
    } else {
      flash(`Could not adjust: ${failed.join(', ')}.`, 'error');
    }
    if (ok) { setDelta(''); setTarget(''); setReason(''); refreshStudent(); loadLog(); onDone?.(); }
    setSaving(false);
  };

  // What each score becomes, shown before Apply. Kept inside 0-100.
  const preview = (score) => {
    const cur = Number(score) || 0;
    const next = target !== '' ? Number(target) : cur + Number(delta || 0);
    return Math.max(0, Math.min(100, Number.isFinite(next) ? next : cur));
  };

  const addTask = async () => {
    const pts = Number(draft.points);
    if (!draft.label.trim()) { flash('Name the task.', 'error'); return; }
    if (!Number.isFinite(pts) || pts < 1 || pts > MAX_TASK_POINTS) {
      flash(`Points must be from 1 to ${MAX_TASK_POINTS}.`, 'error'); return;
    }
    setSaving(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/score-rules/students/${student.id}/tasks`,
        { label: draft.label.trim(), points: pts, action_route: draft.action_route || undefined });
      if (data?.bool) {
        flash('Task added for this student.');
        setDraft({ label: '', points: '5', action_route: '' });
        setAddingTask(false);
        loadDetail(student.id);
      } else flash(data?.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save the task.', 'error'); } finally { setSaving(false); }
  };

  const credit = async (task) => {
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/score-rules/tasks/complete',
        { task_id: task.id, user_id: student.id });
      if (data?.bool) { flash(data.response.message); refreshStudent(); onDone?.(); }
      else flash(data?.response?.message || 'Could not credit.', 'error');
    } catch { flash('Could not credit that task.', 'error'); }
  };

  const ready = selected.length > 0 && reason.trim() && (
    (target !== '' && !Number.isNaN(Number(target)))
    || (delta !== '' && !Number.isNaN(Number(delta)))
  );

  const stageLabel = (v) => stages.find((s) => s.value === v)?.label || v || '—';

  return (
    <>
      {rosterFor && (
        <TaskRoster task={rosterFor} flash={flash}
          onClose={() => setRosterFor(null)} onChanged={refreshStudent} />
      )}

      {/* ── pick ─────────────────────────────────────────────────────── */}
      <Card className="p-5">
        <SectionTitle>Students</SectionTitle>
        <p className="text-xs text-slate-400 -mt-2 mb-3">
          Narrow to a stage if you like, then pick one student or several.
        </p>
        <div className="space-y-2">
          <FormSelect value={category} onChange={(v) => setCategory(v || '')}
            options={[{ value: '', label: 'Any stage' }, ...stages]} clearable={false} />
          <FormMultiSelect
            values={selectedIds}
            onChange={setSelectedIds}
            options={[
              // Picked students stay listed even after the stage changes.
              ...selected.filter((st) => !studentOpts.some((o) => o.id === st.id)),
              ...studentOpts,
            ].map((st) => ({
              value: st.id,
              label: st.full_name,
              // Second line: which class, so "Any stage" still tells them apart.
              sub: `${stageLabel(st.education_category)} · ${st.email} · score ${st.score}`,
            }))}
            placeholder={optsLoading ? 'Loading students…' : 'Search and select students…'}
          />
          {!optsLoading && studentOpts.length === 0 && (
            <p className="text-xs text-slate-400">No students in this stage yet.</p>
          )}
          {studentOpts.length >= 100 && (
            <p className="text-xs text-slate-400">Showing the first 100 — pick a stage to narrow the list.</p>
          )}
        </div>
      </Card>

      {selected.length > 1 && (
        /* ── several students: one adjustment for all ─────────────────── */
        <Card className="p-5 mt-4">
          <SectionTitle>Change the score for {selected.length} students</SectionTitle>
          <div className="divide-y divide-slate-100 mb-3">
            {selected.map((st) => (
              <div key={st.id} className="py-2 flex items-center gap-2">
                <span className="min-w-0 flex-1 text-sm font-semibold text-slate-900 break-words">{st.full_name}</span>
                <span className="shrink-0 text-sm tabular-nums text-slate-500">
                  {st.score}
                  {(delta !== '' || target !== '') && (
                    <> → <strong style={{ color: 'var(--accent)' }}>{preview(st.score)}</strong></>
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="space-y-2">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Add or take away</label>
              <input type="number" value={delta} onChange={(e) => { setDelta(e.target.value); setTarget(''); }}
                placeholder="e.g. 5 or -5" aria-label="Points to add or subtract" className={field} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">…or set it exactly</label>
              <input type="number" min="0" max="100" value={target}
                onChange={(e) => { setTarget(e.target.value); setDelta(''); }}
                placeholder="0 – 100" aria-label="Set score to" className={field} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Reason (required)</label>
              <input value={reason} onChange={(e) => setReason(e.target.value)}
                placeholder="Goes into the audit log for each student" aria-label="Reason" className={field} />
            </div>
            <Button size="sm" className="min-h-11" onClick={adjust} disabled={!ready || saving}>
              <Save size={13} /> {saving ? 'Saving…' : `Apply to ${selected.length} students`}
            </Button>
          </div>
        </Card>
      )}

      {student && (
        <>
          {/* ── where they stand ───────────────────────────────────────── */}
          <Card className="p-5 mt-4">
            <SectionTitle>{student.full_name}</SectionTitle>
            <div className="grid grid-cols-2 gap-3 mt-1">
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">SCORE</p>
                <p className="text-2xl font-bold" style={{ color: 'var(--accent)' }}>{student.score}</p>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <p className="text-xs text-slate-400">LEVEL</p>
                <p className="text-base font-bold text-slate-900 break-words">{student.level || '—'}</p>
              </div>
            </div>
            <p className="mt-2 text-xs text-slate-400 break-words">
              {stageLabel(student.education_category)}
              {student.degree_type ? ` · ${student.degree_type}` : ''}
            </p>

            {detail && !detail.global_ok && (
              /* Without this the admin sees a stalled score and no reason for it. */
              <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
                <p className="text-sm font-semibold text-amber-900">Not earning from global actions</p>
                <p className="mt-1 text-xs text-amber-800 leading-relaxed">
                  The batch <strong>{detail.deciding_batch}</strong> has global actions switched off,
                  so this student only earns from tasks. Points already earned are kept.
                </p>
              </div>
            )}
          </Card>

          {/* ── their tasks ────────────────────────────────────────────── */}
          <Card className="p-5 mt-4">
            <SectionTitle>Their tasks</SectionTitle>
            {(detail?.tasks || []).length === 0 ? (
              <p className="py-2 text-sm text-slate-400">No tasks reach this student yet.</p>
            ) : (
              <div className="divide-y divide-slate-100">
                {detail.tasks.map((t) => (
                  <div key={t.id} className="py-2.5">
                    <div className="flex items-start gap-2">
                      <span className="shrink-0 mt-0.5 px-2 py-0.5 rounded-lg text-xs font-bold"
                        style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
                        +{t.points}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-slate-900 break-words">{t.label}</p>
                        <p className="text-xs text-slate-400 break-words">
                          {t.batch_name || 'Just this student'}
                        </p>
                      </div>
                      <Badge size="xs" color={t.done ? 'emerald' : t.submitted ? 'blue' : 'slate'}>
                        {t.done ? 'Done' : t.submitted ? 'Claimed' : 'To do'}
                      </Badge>
                    </div>
                    {!t.done && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button size="sm" className="min-h-11" onClick={() => credit(t)}>
                          <Check size={13} /> Give the points
                        </Button>
                        <Button size="sm" variant="secondary" className="min-h-11"
                          onClick={() => setRosterFor(t)}>
                          <Users size={13} /> Roster
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {addingTask ? (
              <div className="mt-3 pt-3 border-t border-slate-100 space-y-2">
                <input value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
                  placeholder="What this student has to do" aria-label="Task name" className={field} />
                <div className="flex gap-2">
                  <div className="relative flex-1 min-w-0">
                    <input type="number" min="1" max={MAX_TASK_POINTS} value={draft.points}
                      onChange={(e) => setDraft((d) => ({ ...d, points: e.target.value }))}
                      aria-label="Points" className={`${field} pr-11`} />
                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-slate-400">pts</span>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Where they do it (optional)</label>
                  <FormSelect value={draft.action_route}
                    onChange={(v) => setDraft((d) => ({ ...d, action_route: v || '' }))}
                    options={[{ value: '', label: 'No link' }, ...routes]}
                    searchType="task_route" clearable={false} />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="min-h-11" onClick={addTask} disabled={saving}>
                    <Save size={13} /> Add task
                  </Button>
                  <Button size="sm" variant="secondary" className="min-h-11" onClick={() => setAddingTask(false)}>
                    <X size={13} /> Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="secondary" className="mt-3 min-h-11" onClick={() => setAddingTask(true)}>
                <Plus size={13} /> Add a task for {student.full_name.split(' ')[0]}
              </Button>
            )}
          </Card>

          {/* ── move the score ─────────────────────────────────────────── */}
          <Card className="p-5 mt-4">
            <SectionTitle>Change the score</SectionTitle>
            <p className="text-xs text-slate-400 -mt-2 mb-3">
              For support and dispute cases. Every adjustment is written to an audit
              log with your reason — there is no way to change a score without
              leaving a trace.
            </p>
            <div className="space-y-2">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Add or take away</label>
                <input type="number" value={delta} onChange={(e) => { setDelta(e.target.value); setTarget(''); }}
                  placeholder="e.g. 5 or -5" aria-label="Points to add or subtract" className={field} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">…or set it exactly</label>
                <input type="number" min="0" max="100" value={target}
                  onChange={(e) => { setTarget(e.target.value); setDelta(''); }}
                  placeholder="0 – 100" aria-label="Set score to" className={field} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Reason (required)</label>
                <input value={reason} onChange={(e) => setReason(e.target.value)}
                  placeholder="Goes into the audit log" aria-label="Reason" className={field} />
              </div>
              <Button size="sm" className="min-h-11" onClick={adjust} disabled={!ready || saving}>
                <Save size={13} /> {saving ? 'Saving…' : 'Apply'}
              </Button>
            </div>
          </Card>
        </>
      )}

      {/* ── history ──────────────────────────────────────────────────── */}
      <Card className="p-5 mt-4">
        <SectionTitle>Recent adjustments</SectionTitle>
        <div className="-mt-2 mb-3 w-full sm:w-64">
          <DateRange value={adjRange} onChange={setAdjRange} align="left" />
        </div>
        {log.length === 0 ? (
          <p className="py-2 text-sm text-slate-400">Nothing adjusted in these dates.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {log.map((a) => (
              <div key={a.id} className="py-2.5">
                <p className="text-sm text-slate-700 break-words">
                  <span className="font-bold" style={{ color: 'var(--accent)' }}>
                    {Number(a.delta) > 0 ? `+${Number(a.delta)}` : Number(a.delta)}
                  </span>
                  {' · '}{a.student_name || <span className="italic text-slate-400">Deleted student</span>}
                </p>
                <p className="text-xs text-slate-400 break-words">{a.reason}</p>
                {/* Who and when — the list is the audit trail for score changes. */}
                <p className="mt-0.5 text-xs text-slate-400">
                  {[a.admin_name && `by ${a.admin_name}`,
                    a.created_at && new Date(a.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })]
                    .filter(Boolean).join(' · ')}
                </p>
              </div>
            ))}
          </div>
        )}
        {adjMeta.total > 0 && (
          <div className="-mx-5 -mb-5 mt-3 rounded-b-2xl overflow-hidden">
            <Pagination page={adjPage} pages={adjMeta.pages} total={adjMeta.total} perPage={adjPer}
                        onPage={setAdjPage} onPerPage={setAdjPer} />
          </div>
        )}
      </Card>
    </>
  );
}
