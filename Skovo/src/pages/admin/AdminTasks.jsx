import React, { useEffect, useState, useCallback } from 'react';
import DateTimePicker from '../../components/ui/DateTimePicker';
import StatTile from '../../components/admin/StatTile';
import { ClipboardList, Hourglass } from 'lucide-react';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { z } from 'zod';
import { adminApi as api, api as publicApi } from '../../services/api';
import { CheckSquare, Plus, Pencil, Trash2, X, Check, Star, Clock, ExternalLink, Users, ChevronRight, ChevronDown, Calendar, Link2, Type, AlignLeft, AlertCircle, Award, Tag, Upload, TrendingUp, ToggleRight, ToggleLeft, Eye } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal } from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';
import { toDateTimeLocal } from '../../utils/datetime';

const taskSchema = z.object({
  cohort_id:       z.string().min(1, 'Cohort is required'),
  title:           z.string().min(3, 'Title must be at least 3 characters').max(200, 'Title is too long'),
  description:     z.string().min(10, 'Description must be at least 10 characters'),
  task_type:       z.string().min(1, 'Task type is required'),
  submission_type: z.string().min(1, 'Submission type is required'),
  difficulty_level:z.string().optional(),
  task_status:     z.string().min(1, 'Status is required'),
  due_date:        z.string().min(1, 'Due date is required'),
  score_weight:    z.coerce.number().min(0, 'Cannot be negative').max(100, 'Max 100 points'),
  attachment_url:  z.string().optional(),
});

const STATUS_STYLE = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-500 border-red-200',
};

const EMPTY_FORM = { cohort_id: '', title: '', description: '', task_type: '', submission_type: '', difficulty_level: '', attachment_url: '', task_status: 'active', due_date: '', score_weight: 0 };

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-5 right-5 z-100 px-5 py-3 rounded-2xl text-sm font-semibold shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-bottom-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}


function TaskModal({ cohorts, task, onClose, onSaved, showToast, dropdowns }) {
  const { lists } = useMasters(['task_status']);
  const isEdit = !!task?.id;
  const [form, setForm] = useState(
    isEdit
      ? { cohort_id: task.cohort_id, title: task.title, description: task.description || '', task_type: task.task_type || '', submission_type: task.submission_type || '', difficulty_level: task.difficulty_level || '', attachment_url: task.attachment_url || '', task_status: task.task_status || 'active', due_date: toDateTimeLocal(task.due_date), score_weight: task.score_weight }
      : { ...EMPTY_FORM }
  );
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState({});
  const opts = (type) => (dropdowns[type] || []);

  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };

  const save = async () => {
    const result = taskSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true);
    try {
      const payload = { ...form, due_date: form.due_date || null, score_weight: Number(form.score_weight) };
      const { data } = isEdit
        ? await api.put(`/skovo-platform-panel-admin/tasks/${task.id}`, payload)
        : await api.post('/skovo-platform-panel-admin/tasks', payload);
      if (data.bool) { showToast(isEdit ? 'Task updated' : 'Task created'); onSaved(); onClose(); }
      else showToast(data.response?.message || 'Failed', false);
    } catch { showToast('Error', false); }
    finally { setSaving(false); }
  };

  const ic = (field) => errors[field]?.[0]
    ? 'border-red-400 bg-red-50/30 focus:ring-red-100'
    : 'border-slate-200 focus:ring-blue-500';
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;
  const Lbl = ({ icon: Icon, text, req }) => (
    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
      <Icon size={12} className="text-slate-400"/>{text}{req && <span className="text-red-500">*</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-lg max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Task' : 'Create New Task'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">Fill in the task details below</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Cohort */}
          <div>
            <Lbl icon={Users} text="Cohort" req />
            <FormSelect value={form.cohort_id} onChange={v => sf('cohort_id', v)} icon={Users}
              options={cohorts.map(c => ({ value: c.id, label: c.title }))}
              placeholder="Which cohort is this for?" required disabled={isEdit} />
            <Err f="cohort_id" />
          </div>

          {/* Title */}
          <div>
            <Lbl icon={Type} text="Task Title" req />
            <div className="relative">
              <Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={form.title} onChange={e => sf('title', e.target.value)}
                placeholder="e.g. Build a personal portfolio website"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('title')}`} />
            </div>
            <Err f="title" />
          </div>

          {/* Description */}
          <div>
            <Lbl icon={AlignLeft} text="Description" req />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none" />
              <textarea rows={3} value={form.description} onChange={e => sf('description', e.target.value)}
                placeholder="Describe what students need to complete — steps, deliverables, tools to use…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none resize-none ${ic('description')}`} />
            </div>
            <Err f="description" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {/* Task Type */}
            <div>
              <Lbl icon={Tag} text="Task Type" req />
              <FormSelect searchType="task_type" value={form.task_type} onChange={v => sf('task_type', v)} icon={Tag} options={opts('task_type')} placeholder="e.g. Course" />
              <Err f="task_type" />
            </div>
            {/* Submission Type */}
            <div>
              <Lbl icon={Upload} text="Submission Type" req />
              <FormSelect searchType="task_submission_type" value={form.submission_type} onChange={v => sf('submission_type', v)} icon={Upload} options={opts('task_submission_type')} placeholder="e.g. Link" />
              <Err f="submission_type" />
            </div>
            {/* Difficulty */}
            <div>
              <Lbl icon={TrendingUp} text="Difficulty" />
              <FormSelect searchType="difficulty_level" value={form.difficulty_level} onChange={v => sf('difficulty_level', v)} icon={TrendingUp} options={opts('difficulty_level')} placeholder="e.g. Easy" />
            </div>
            {/* Status */}
            <div>
              <Lbl icon={ToggleRight} text="Status" req />
              <FormSelect searchType="task_status" value={form.task_status} onChange={v => sf('task_status', v)} icon={ToggleRight}
                options={lists.task_status || []}
                placeholder="e.g. Active" required />
              <Err f="task_status" />
            </div>
            {/* Due Date */}
            <div>
              <Lbl icon={Calendar} text="Due Date" req />
              <DateTimePicker value={form.due_date} onChange={(v) => sf('due_date', v)} invalid={!!errors.due_date?.[0]} future />
              <Err f="due_date" />
            </div>
            {/* Points */}
            <div>
              <Lbl icon={Award} text="Points" req />
              <div className="relative">
                <Award size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                <input type="number" min={0} max={100} value={form.score_weight}
                  onChange={e => sf('score_weight', e.target.value)}
                  placeholder="e.g. 10"
                  className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('score_weight')}`} />
              </div>
              <Err f="score_weight" />
            </div>
          </div>

          {/* Attachment URL */}
          <div>
            <Lbl icon={Link2} text="Attachment URL" />
            <div className="relative">
              <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              <input value={form.attachment_url} onChange={e => sf('attachment_url', e.target.value)}
                placeholder="https://drive.google.com/file/…"
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors">
            {saving ? 'Saving…' : isEdit ? 'Update Task' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SubmissionsPanel({ task, onClose, showToast, onRefresh }) {
  const [subs,    setSubs]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);
  const [scoring, setScoring] = useState({});

  const loadSubs = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api.get(`/skovo-platform-panel-admin/tasks/${task.id}/submissions`)
      .then(({ data }) => {
        // A `bool: false` body is a refusal, not an empty task. Both used to
        // land in the same place — the panel swallowed every failure and drew
        // "No submissions yet", so a task row could say "1 pending" while the
        // panel it opened insisted nothing had been handed in, with nothing
        // anywhere to say the request had failed.
        if (!data?.bool) { setFailed(true); return; }
        setSubs(data.response.submissions || []);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [task.id]);

  // The rule targets cascading renders from synchronous setState; loadSubs sets
  // state inside an awaited callback. Same shape the achiever review drawer uses.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadSubs(); }, [loadSubs]);

  const doScore = async (subId, status) => {
    const s = scoring[subId];
    // A score gates approval only. Sending work back does not need one, and
    // demanding it here meant a reviewer had to invent a mark for something
    // they were rejecting outright.
    if (status === 'approved' && (s?.score == null || s.score === '')) {
      showToast('Enter a score (0–10) before approving', false);
      return;
    }
    try {
      const { data } = await api.patch(`/skovo-platform-panel-admin/submissions/${subId}`, {
        mentor_score: s?.score === '' || s?.score == null ? null : Number(s.score),
        mentor_notes: s?.notes || '',
        status,
      });
      if (data.bool) { showToast(status === 'approved' ? 'Submission approved ✓' : 'Sent back to the student'); loadSubs(); onRefresh(); }
      // The server says *why* it refused — a length cap, a bad status. Showing
      // a bare "Failed" threw that away.
      else showToast(data?.response?.message || 'Failed', false);
    } catch { showToast('Error', false); }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) :  '—';

  // Mirrors PENDING_STATES in portal/helpers/task_review.py. `submitted` and
  // `resubmitted` were missing, so a row carrying either sat in neither group
  // and vanished from a panel that had loaded it successfully.
  const PENDING = ['pending', 'submitted', 'resubmitted', 'reviewed'];
  const pending = subs.filter((s) => PENDING.includes(s.status));
  const done = subs.filter((s) => !PENDING.includes(s.status));

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-3xl sm:rounded-2xl shadow-2xl w-full sm:max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div>
            <h2 className="font-bold text-slate-900 text-sm leading-snug">{task.title}</h2>
            <div className="flex items-center gap-3 mt-1">
              <span className="text-xs text-slate-400">{subs.length} submission{subs.length !== 1 ? 's' : ''}</span>
              {pending.length > 0 && (
                <span className="text-xs font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                  {pending.length} need review
                </span>
              )}
            </div>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-all">
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-24 animate-pulse bg-slate-100 rounded-2xl" />
            ))
          ) : failed ? (
            <div className="text-center py-16">
              <AlertCircle size={40} className="mx-auto mb-3 text-red-300" />
              <p className="font-semibold text-slate-700">We couldn&apos;t load these submissions</p>
              <p className="text-sm mt-1 text-slate-400">
                The students&apos; work is safe — this is a connection problem.
              </p>
              <button
                onClick={loadSubs}
                className="mt-4 px-4 py-2 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Try again
              </button>
            </div>
          ) : subs.length === 0 ? (
            <div className="text-center py-16 text-slate-400">
              <CheckSquare size={40} className="mx-auto mb-3 text-slate-300" />
              <p className="font-semibold text-slate-500">No submissions yet</p>
              <p className="text-sm mt-1">Students will appear here after submitting</p>
            </div>
          ) : (
            <>
              {/* Pending */}
              {pending.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Needs Review ({pending.length})</p>
                  <div className="space-y-3">
                    {pending.map((s) => (
                      <div key={s.id} className="p-4 border border-amber-200 rounded-2xl bg-amber-50/30">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center text-xs font-bold shrink-0">
                              {s.user_name?.charAt(0)}
                            </div>
                            <div>
                              <p className="font-semibold text-slate-900 text-sm">{s.user_name}</p>
                              <p className="text-xs text-slate-400">{s.user_email}</p>
                            </div>
                          </div>
                          <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_STYLE[s.status]}`}>
                            {s.status}
                          </span>
                        </div>

                        {s.evidence_url && (
                          <a href={s.evidence_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline mb-2 break-all">
                            <ExternalLink size={11} className="shrink-0" /> {s.evidence_url}
                          </a>
                        )}
                        {s.evidence_text && (
                          <p className="text-xs text-slate-600 mb-3 bg-white border border-slate-200 p-3 rounded-xl leading-relaxed">{s.evidence_text}</p>
                        )}

                        {/* Score form */}
                        <div className="pt-3 border-t border-amber-200/60 space-y-2">
                          <div className="flex items-end gap-2">
                            <div>
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Score (0–10)</label>
                              <input
                                type="number" min={0} max={10}
                                value={scoring[s.id]?.score ?? ''}
                                onChange={(e) => setScoring((sc) => ({ ...sc, [s.id]: { ...sc[s.id], score: e.target.value } }))}
                                className="w-20 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                            <div className="flex-1">
                              <label className="block text-[11px] font-semibold text-slate-500 mb-1">Feedback</label>
                              <input
                                value={scoring[s.id]?.notes ?? ''}
                                onChange={(e) => setScoring((sc) => ({ ...sc, [s.id]: { ...sc[s.id], notes: e.target.value } }))}
                                placeholder="Optional feedback for student…"
                                className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                              />
                            </div>
                          </div>
                          <div className="flex gap-2">
                            <button
                              onClick={() => doScore(s.id, 'approved')}
                              className="flex-1 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 transition-colors"
                            >
                              ✓ Approve & Award Points
                            </button>
                            <button
                              onClick={() => doScore(s.id, 'rejected')}
                              className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-xl hover:bg-red-100 transition-colors"
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Reviewed/done */}
              {done.length > 0 && (
                <div>
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-4">Completed ({done.length})</p>
                  <div className="space-y-2">
                    {done.map((s) => (
                      <div key={s.id} className="p-3.5 border border-slate-200 rounded-2xl bg-white flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                          {s.user_name?.charAt(0)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-slate-800 text-sm">{s.user_name}</p>
                          {s.mentor_score != null && (
                            <div className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
                              <Star size={11} /> {s.mentor_score}/10
                              {s.mentor_notes && <span className="text-slate-400 ml-1">· {s.mentor_notes}</span>}
                            </div>
                          )}
                          {/* When it was judged — the panel showed the verdict
                              but never when it landed, which is the first thing
                              asked when a student queries their score. */}
                          <p className="text-[11px] text-slate-400 mt-0.5">Reviewed {fmt(s.reviewed_at)}</p>
                        </div>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${STATUS_STYLE[s.status]}`}>
                          {s.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* Mobile task card */
function TaskMobileCard({ t, onEdit, onDelete, onView, fmt }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex-1 min-w-0">
          <p className="font-bold text-slate-900 text-sm leading-snug">{t.title}</p>
          <p className="text-xs text-slate-400 mt-0.5 truncate">{t.cohort_title}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button onClick={() => onEdit(t)} className="p-2.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all">
            <Pencil size={14} />
          </button>
          <button onClick={() => onDelete(t)} className="p-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3 text-xs text-slate-500 mb-3">
        {t.due_date && (
          <div className="flex items-center gap-1.5">
            <Clock size={11} /> Due {fmt(t.due_date)}
          </div>
        )}
        {t.score_weight > 0 && <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">+{t.score_weight} pts</span>}
      </div>

      <button
        onClick={() => onView(t)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl hover:bg-slate-100 transition-colors"
      >
        <span className="text-sm font-semibold text-slate-700">
          {t.submission_count} submissions
          {t.pending_count > 0 && (
            <span className="text-amber-600 ml-2">· {t.pending_count} pending</span>
          )}
        </span>
        <ChevronRight size={15} className="text-slate-400" />
      </button>
    </div>
  );
}

function TaskDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const fmtDate = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Cohort', value: a.cohort_title || '—' },
    { label: 'Type', value: a.task_type || '—' },
    { label: 'Due Date', value: fmtDate(a.due_date) },
    { label: 'Points', value: a.score_weight != null ? `+${a.score_weight} pts` : '—' },
    { label: 'Submissions', value: a.submission_count != null ? String(a.submission_count) : '—' },
    { label: 'Status', value: a.task_status || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Task Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminTasks() {
  const [dropdowns,  setDropdowns]  = useState({ task_type: [], task_submission_type: [], difficulty_level: [] });
  const [tasks,      setTasks]      = useState([]);
  const [cohorts,    setCohorts]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [page,       setPage]       = useState(1);
  const [perPage,    setPerPage]    = useState(20);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [modal,      setModal]      = useState(null);
  const [viewSubs,   setViewSubs]   = useState(null);
  const [view,       setView]       = useState(null);
  const [confirm,    setConfirm]    = useState(null);
  const [toast,      setToast]      = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3500); };

  const load = useCallback((pg = page, pp = perPage) => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/tasks', { page: pg, per_page: pp })
      .then(({ data }) => {
        if (data.bool) { setTasks(data.response.tasks || []); setPagination(data.pagination || {}); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, perPage]);

  useEffect(() => {
    load(1, perPage);
    api.get('/skovo-platform-panel-admin/cohorts', { per_page: 100 })
      .then(({ data }) => { if (data.bool) setCohorts(data.response.cohorts || []); })
      .catch(() => {});
    publicApi.get('/auth/masters', { types: 'task_type,task_submission_type,difficulty_level' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, []);

  const doDelete = async (t) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/tasks/${t.id}`);
      if (data.bool) { showToast('Task deleted'); load(page, perPage); }
      else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const toggleTaskStatus = async (t) => {
    const newStatus = t.task_status === 'active' ? 'inactive' : 'active';
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/tasks/${t.id}`, { ...t, task_status: newStatus });
      if (data.bool) {
        showToast(`Task ${newStatus === 'active' ? 'enabled' : 'disabled'}`);
        load(page, perPage);
      } else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const fmt = (iso) => iso ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' }) :  '—';

  const totalPending = tasks.reduce((sum, t) => sum + (t.pending_count || 0), 0);

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />

      {modal && (
        <TaskModal
          cohorts={cohorts}
          task={modal === 'create' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={() => load(page, perPage)}
          showToast={showToast}
          dropdowns={dropdowns}
        />
      )}
      {viewSubs && (
        <SubmissionsPanel
          task={viewSubs}
          onClose={() => setViewSubs(null)}
          showToast={showToast}
          onRefresh={() => load(page, perPage)}
        />
      )}
      {view && <TaskDetailModal item={view} onClose={() => setView(null)} onEdit={(t) => setModal(t)} />}
      {confirm && (
        <ConfirmModal
          message={`Delete "${confirm.title}"?`}
          detail="This cannot be undone."
          danger
          confirmLabel="Delete"
          onConfirm={() => { doDelete(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500 mt-0.5">Cohort tasks students submit, and the reviews they wait on.</p>
        </div>
        <KitButton onClick={() => setModal('create')} className="w-full sm:w-auto"><Plus size={16} /> Add task</KitButton>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatTile label="Tasks" value={pagination.total} icon={ClipboardList} tone="blue" sub="all cohorts" />
        <StatTile label="To review" value={totalPending} icon={Hourglass} tone="amber" sub="on this page" />
        <StatTile label="Submissions" value={tasks.reduce((a, t) => a + Number(t.submission_count || 0), 0)} icon={Users} tone="violet" sub="on this page" />
      </div>

      {/* Mobile cards */}
      <div className="lg:hidden space-y-3">
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse bg-white rounded-2xl border border-slate-100" />
          ))
        ) : tasks.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200 flex flex-col items-center py-20 text-slate-400">
            <CheckSquare size={44} className="mb-3 text-slate-300" />
            <p className="font-semibold text-slate-500">No tasks yet</p>
            <p className="text-sm mt-1">Create a task and assign it to a cohort to get started</p>
            <button onClick={() => setModal('create')} className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
              <Plus size={15} /> Create First Task
            </button>
          </div>
        ) : tasks.map((t) => (
          <TaskMobileCard
            key={t.id}
            t={t}
            onEdit={setModal}
            onDelete={setConfirm}
            onView={setViewSubs}
            fmt={fmt}
          />
        ))}
      </div>

      {/* Phones: the table pager sits inside the hidden desktop block. */}
      {!loading && (pagination.total || 0) > 0 && (
        <div className="lg:hidden mb-4">
          <Pagination
          page={page}
          pages={pagination.pages || 1}
          total={pagination.total || 0}
          perPage={perPage}
          onPage={(p) => { setPage(p); load(p, perPage); }}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
        />
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden lg:block">
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Task</Th>
                  <Th>Cohort</Th>
                  <Th>Due Date</Th>
                  <Th>Points</Th>
                  <Th>Submissions</Th>
                  <Th>Status</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              {loading ? <LoadingRows cols={7} rows={5} /> : (
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {tasks.map((t) => (
                    <tr key={t.id} onClick={() => setView(t)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td>
                        <p className="font-semibold text-slate-900 text-sm">{t.title}</p>
                        {t.description && (
                          <p className="text-xs text-slate-400 mt-0.5 max-w-52 truncate">{t.description}</p>
                        )}
                      </Td>
                      <Td>
                        <p className="text-xs font-medium text-slate-600 max-w-36 truncate">{t.cohort_title || '—'}</p>
                      </Td>
                      <Td>
                        {t.due_date ? (
                          <div className="flex items-center gap-1.5 text-xs text-slate-500 whitespace-nowrap">
                            <Clock size={11} className="text-slate-400" />{fmt(t.due_date)}
                          </div>
                        ) : <span className="text-slate-400">—</span>}
                      </Td>
                      <Td>
                        <span className="inline-flex items-center text-xs font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full">
                          +{t.score_weight} pts
                        </span>
                      </Td>
                      <Td>
                        <button
                          onClick={(e) => { e.stopPropagation(); setViewSubs(t); }}
                          className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-blue-600 transition-colors group/sub"
                        >
                          <Users size={12} className="text-slate-400 group-hover/sub:text-blue-400" />
                          {t.submission_count} total
                          {t.pending_count > 0 && (
                            <span className="text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
                              {t.pending_count} pending
                            </span>
                          )}
                        </button>
                      </Td>
                      <Td>
                        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${
                          t.task_status === 'active' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                          t.task_status === 'draft'  ? 'bg-slate-100 text-slate-600 border-slate-200' :
                          'bg-red-50 text-red-500 border-red-200'
                        }`}>{t.task_status}</span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(t)} />
                          <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => setModal(t)} />
                          <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(t)} />
                          <ActionBtn icon={Users} tooltip="View submissions" color="violet" onClick={() => setViewSubs(t)} />
                          <ActionBtn
                            icon={t.task_status === 'active' ? ToggleRight : ToggleLeft}
                            tooltip={t.task_status === 'active' ? 'Disable' : 'Enable'}
                            color={t.task_status === 'active' ? 'green' : 'amber'}
                            onClick={() => toggleTaskStatus(t)}
                          />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              )}
            </table>
          </div>
          {tasks.length === 0 && !loading && (
            <EmptyState icon={CheckSquare} message="No tasks yet. Create a task and assign it to a cohort to get started." />
          )}
          <Pagination
            page={page}
            pages={pagination.pages || 1}
            total={pagination.total || 0}
            perPage={perPage}
            onPage={(p) => { setPage(p); load(p, perPage); }}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
          />
        </TableShell>
      </div>
    </div>
  );
}
