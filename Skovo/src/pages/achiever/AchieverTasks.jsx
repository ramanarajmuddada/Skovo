import React, { useCallback, useEffect, useMemo, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { PlayCircle, PauseCircle, FilePen, Inbox, BarChart3, ChevronRight } from 'lucide-react';
import QuestionEditor from '../../components/QuestionEditor';
import { Settings } from '../../components/achiever/QuizBuilderModal';
import DateTimePicker from '../../components/ui/DateTimePicker';
import {
  ClipboardList, Plus, X, Loader2, Search, Pencil, Trash2,
  Calendar, Users, Tag, Upload, TrendingUp, Link as LinkIcon, BookOpen,
  ExternalLink, Star, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { achieverApi } from '../../services/api';
import QuizBuilderModal from '../../components/achiever/QuizBuilderModal';
import { useMasters } from '../../hooks/useMasters';
import { usePagedRows } from '../../hooks/usePagedRows';
import { toDateTimeLocal } from '../../utils/datetime';
import { StatusBadge, EmptyState, TableShell, ConfirmModal, Pagination } from '../../components/ui/TableComponents';
import { Button, FormSelect, Skeleton, ErrorState, Drawer, useToast } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

/* The three vocabularies live in master data, like every other dropdown in
   SKOVO — the admin task form reads the same three types. A fallback is passed
   because a half-seeded environment would otherwise hand the achiever an empty
   Type dropdown on a required field, which is a dead end rather than a
   degraded one. */
const MASTER_TYPES = ['task_type', 'task_submission_type', 'difficulty_level'];
const MASTER_FALLBACK = {
  task_type: [
    { value: 'assignment', label: 'Assignment' },
    { value: 'quiz', label: 'Quiz' },
    { value: 'project', label: 'Project' },
    { value: 'presentation', label: 'Presentation' },
    { value: 'case_study', label: 'Case Study' },
  ],
  task_submission_type: [
    { value: 'url_link', label: 'URL / Link' },
    { value: 'file_upload', label: 'File Upload' },
    { value: 'text_only', label: 'Text Response' },
    { value: 'github_repo', label: 'GitHub Repo' },
    { value: 'video_link', label: 'Video Link' },
  ],
  difficulty_level: [
    { value: 'easy', label: 'Easy' },
    { value: 'medium', label: 'Medium' },
    { value: 'hard', label: 'Hard' },
  ],
};

// Filter tiles; tapping the active one again shows all.
// Same three values as master_task_status (Active, Draft, Inactive).
const STATUS_FILTERS = [
  { key: 'active',   label: 'Active',   icon: PlayCircle, tone: 'emerald' },
  { key: 'draft',    label: 'Draft',    icon: FilePen,    tone: 'violet' },
  { key: 'inactive', label: 'Inactive', icon: PauseCircle, tone: 'amber' },
];

const EMPTY_FORM = {
  cohort_id: '', title: '', description: '',
  task_type: '', submission_type: '', difficulty_level: '',
  attachment_url: '', task_status: 'active', due_date: '',
};

/** `2 Sept 2026, 11:59 pm`, or an em dash. Tasks without a due date are normal. */
function dueLabel(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

const isOverdue = (t) =>
  t.task_status === 'active' && t.due_date && new Date(t.due_date) < new Date();

/* ── Reviewing what students sent back ────────────────────────────────────── */

/** Anything not finally judged is still work for the achiever.
 *  Mirrors PENDING_STATES in portal/helpers/task_review.py — `reviewed` means
 *  scored but not decided, which is still an open item. */
const PENDING_STATES = ['pending', 'submitted', 'resubmitted', 'reviewed'];
const MAX_SCORE = 10;

const SUB_STATUS_STYLE = {
  pending:  'bg-amber-50 text-amber-700 border-amber-200',
  submitted:'bg-amber-50 text-amber-700 border-amber-200',
  resubmitted: 'bg-amber-50 text-amber-700 border-amber-200',
  reviewed: 'bg-blue-50 text-blue-700 border-blue-200',
  approved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  rejected: 'bg-red-50 text-red-600 border-red-200',
};

/** `9 Sept 2026, 12:30 pm`, or an em dash. */
function stamp(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

/** One submission waiting on a verdict.
 *
 *  Score and feedback are held per card rather than in one shared object on the
 *  drawer: a reviewer working down a list of five should not have what they
 *  typed on the second one appear on the third. */
function PendingSubmission({ sub, onReviewed, toast, rubric = [] }) {
  const [score, setScore]   = useState(sub.mentor_score ?? '');
  // Rubric click-scoring (feature-updates.md §5): one tap per line; the server
  // turns the lines into the 0–10 score when no score is typed.
  const [lines, setLines]   = useState({});
  const rubricDone = rubric.length > 0 && rubric.every((l) => lines[l.label] !== undefined);
  const [notes, setNotes]   = useState(sub.mentor_notes ?? '');
  const [busy, setBusy]     = useState(null);
  const [error, setError]   = useState('');

  const send = async (status) => {
    // The backend refuses an approval with no score, because approving is what
    // puts readiness points on the student's ledger. Saying so here saves the
    // round trip and points at the field.
    if (status === 'approved' && (score === '' || score === null) && !rubricDone) {
      setError(`Give this a score out of ${MAX_SCORE} before approving.`);
      return;
    }
    setError('');
    setBusy(status);
    try {
      const { data } = await achieverApi.patch(`/achievers/portal/submissions/${sub.id}`, {
        status,
        mentor_score: score === '' ? null : Number(score),
        mentor_notes: notes,
        ...(rubricDone ? { rubric_scores: lines } : {}),
      });
      if (data?.bool) {
        toast.success(status === 'approved' ? 'Approved — points awarded' : 'Sent back to the student');
        onReviewed();
      } else {
        const msg = data?.response?.message || 'Could not save that review';
        setError(msg);
        toast.error(msg);
      }
    } catch {
      setError('Could not save that review');
      toast.error('Could not save that review');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 border border-amber-200 rounded-2xl bg-amber-50/40">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
               style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}>
            {(sub.user_name || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-slate-900 text-sm truncate">{sub.user_name}</p>
            <p className="text-xs text-slate-400 truncate">{sub.user_email || 'No email on file'}</p>
          </div>
        </div>
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize shrink-0 ${SUB_STATUS_STYLE[sub.status] || SUB_STATUS_STYLE.pending}`}>
          {sub.status}
        </span>
      </div>

      <p className="text-xs text-slate-400 mb-2">Submitted {stamp(sub.submitted_at)}</p>

      {sub.evidence_url && (
        <a href={sub.evidence_url} target="_blank" rel="noreferrer"
           className="flex items-center gap-1.5 text-xs text-blue-600 hover:underline mb-2 break-all">
          <ExternalLink size={11} className="shrink-0" /> {sub.evidence_url}
        </a>
      )}
      {sub.evidence_text && (
        <p className="text-xs text-slate-600 mb-3 bg-white border border-slate-200 p-3 rounded-xl leading-relaxed whitespace-pre-wrap">
          {sub.evidence_text}
        </p>
      )}
      {!sub.evidence_url && !sub.evidence_text && (
        <p className="text-xs text-slate-400 italic mb-3">The student submitted nothing to open.</p>
      )}

      <div className="pt-3 border-t border-amber-200/60 space-y-2">
        {rubric.length > 0 && (
          <div className="space-y-1.5">
            {rubric.map((l) => (
              <div key={l.label} className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-slate-600 w-40 truncate" title={l.label}>{l.label}</span>
                {Array.from({ length: Number(l.max) + 1 }, (_, v) => (
                  <button key={v} type="button" onClick={() => setLines((p) => ({ ...p, [l.label]: v }))}
                          className={`w-7 h-7 rounded-lg text-xs font-bold border ${lines[l.label] === v ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}`}>{v}</button>
                ))}
              </div>
            ))}
            {rubricDone && <p className="text-[11px] text-slate-500">Score from rubric: {Object.values(lines).reduce((a, b) => a + b, 0)} / {rubric.reduce((a, l) => a + Number(l.max), 0)}</p>}
          </div>
        )}
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1"
                   htmlFor={`score-${sub.id}`}>Score (0–{MAX_SCORE})</label>
            <input
              id={`score-${sub.id}`}
              type="number" min={0} max={MAX_SCORE}
              value={score}
              onChange={(e) => setScore(e.target.value)}
              className="w-20 px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
          <div className="flex-1">
            <label className="block text-[11px] font-semibold text-slate-500 mb-1"
                   htmlFor={`notes-${sub.id}`}>Feedback</label>
            <input
              id={`notes-${sub.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What they did well, what to fix…"
              className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-slate-300"
            />
          </div>
        </div>

        {error && (
          <p className="flex items-center gap-1.5 text-xs text-red-600">
            <AlertCircle size={12} className="shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => send('approved')}
            disabled={Boolean(busy)}
            className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 bg-emerald-600 text-white text-xs font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-50 transition-colors"
          >
            {busy === 'approved' ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
            Approve &amp; award points
          </button>
          <button
            onClick={() => send('rejected')}
            disabled={Boolean(busy)}
            className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 text-xs font-semibold rounded-xl hover:bg-red-100 disabled:opacity-50 transition-colors"
          >
            {busy === 'rejected' ? <Loader2 size={13} className="animate-spin" /> : 'Send back'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Everything students sent in for one task, and the controls to judge it.
 *
 *  This is the screen the achiever portal was missing entirely: the card could
 *  say "1 to review" and there was nowhere to go from it, so grading fell to an
 *  admin who had not taught the session. */
function ReviewDrawer({ task, onClose, onReviewed }) {
  const [subs, setSubs]       = useState([]);
  const [rubric, setRubric]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const toast = useToast();

  const load = useCallback(() => {
    if (!task) return;
    setLoading(true);
    setFailed(false);
    achieverApi.get(`/achievers/portal/tasks/${task.id}/submissions`)
      .then(({ data }) => {
        if (!data?.bool) { setFailed(true); return; }
        setSubs(data.response.submissions || []);
      })
      // A failed request is not "no submissions". Showing the empty state here
      // would tell the achiever their students had not handed anything in.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [task]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!task) return;
    achieverApi.get(`/achievers/portal/tasks/${task.id}/settings`)
      .then(({ data }) => { if (data?.bool) setRubric(data.response.settings.rubric || []); })
      .catch(() => {});
  }, [task]);

  const pending = subs.filter((s) => PENDING_STATES.includes(s.status));
  const done    = subs.filter((s) => !PENDING_STATES.includes(s.status));

  // The card behind the drawer counts submissions, so a verdict has to reach it
  // too — otherwise closing the drawer shows the count it had before.
  const afterReview = () => { load(); onReviewed(); };

  return (
    <Drawer
      open={Boolean(task)}
      onClose={onClose}
      title={task?.title || 'Submissions'}
      subtitle={task?.cohort_title || undefined}
      width="lg"
    >
      {/* Drawer already pads its body — this only spaces the groups. */}
      <div className="space-y-4">
        {loading ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
          </div>
        ) : failed ? (
          <ErrorState
            title="We couldn't load these submissions"
            subtitle="The work your students sent is safe — this is a connection problem."
            onRetry={load}
          />
        ) : subs.length === 0 ? (
          <EmptyState
            icon={Users}
            message="Nothing submitted yet"
            sub="Students in this cohort appear here as soon as they hand their work in"
          />
        ) : (
          <>
            {pending.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">
                  Needs review ({pending.length})
                </p>
                <div className="space-y-3">
                  {pending.map((s) => (
                    <PendingSubmission key={s.id} sub={s} onReviewed={afterReview} toast={toast} rubric={rubric} />
                  ))}
                </div>
              </div>
            )}

            {done.length > 0 && (
              <div>
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 mt-2">
                  Reviewed ({done.length})
                </p>
                <div className="space-y-2">
                  {done.map((s) => (
                    <div key={s.id} className="p-3.5 border border-slate-200 rounded-2xl bg-white flex items-center gap-3">
                      <div className="w-9 h-9 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center text-xs font-bold shrink-0">
                        {(s.user_name || '?').charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-slate-800 text-sm truncate">{s.user_name}</p>
                        {s.mentor_score != null && (
                          <div className="flex items-center gap-1 text-xs text-amber-600 mt-0.5">
                            <Star size={11} className="shrink-0" /> {s.mentor_score}/{MAX_SCORE}
                            {s.mentor_notes && <span className="text-slate-400 ml-1 truncate">· {s.mentor_notes}</span>}
                          </div>
                        )}
                        <p className="text-[11px] text-slate-400 mt-0.5">Reviewed {stamp(s.reviewed_at)}</p>
                      </div>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize shrink-0 ${SUB_STATUS_STYLE[s.status] || ''}`}>
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
    </Drawer>
  );
}


/** Create / edit one task.
 *
 *  Single form rather than the cohort screen's stepper: a task is nine fields,
 *  four of which matter, and walking three steps to set homework for a session
 *  you just taught is friction the cohort form earns and this one does not. */
function TaskModal({ open, task, cohorts, onClose, onSaved }) {
  const editing = Boolean(task);
  const [form, setForm]     = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  // Step 2 is how the task is marked: questions for a Quiz, a rubric for the
  // rest. It needs a saved task, so step 1's button saves first.
  const [step, setStep]       = useState(0);
  const [savedId, setSavedId] = useState(null);
  const [created, setCreated] = useState(false);
  const { lists } = useMasters(MASTER_TYPES, MASTER_FALLBACK);

  useEffect(() => {
    if (!open) return;
    setError('');
    setStep(0);
    setSavedId(task?.id || null);
    setCreated(false);
    setForm(task
      ? {
          cohort_id: task.cohort_id || '',
          title: task.title || '',
          description: task.description || '',
          task_type: task.task_type || '',
          submission_type: task.submission_type || '',
          difficulty_level: task.difficulty_level || '',
          attachment_url: task.attachment_url || '',
          task_status: task.task_status || 'active',
          due_date: toDateTimeLocal(task.due_date),
        }
      // One cohort and nothing to choose — preselect it. Making someone open a
      // dropdown with a single option in it is a step that teaches nothing.
      : { ...EMPTY_FORM, cohort_id: cohorts.length === 1 ? cohorts[0].id : '' });
  }, [open, task, cohorts]);

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const cohortOptions = useMemo(
    () => cohorts.map(c => ({
      value: c.id,
      label: c.status && c.status !== 'upcoming' ? `${c.title} · ${c.status}` : c.title,
    })),
    [cohorts],
  );

  const submit = async () => {
    const parsed = schema.task.safeParse({
      cohort_id: form.cohort_id,
      title: form.title,
      description: form.description,
      due_date: form.due_date,
      attachment_url: form.attachment_url,
    });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Give the task a title.');
      return;
    }

    setSaving(true);
    setError('');
    // Only what the form owns. The PUT is a full replace on the server side but
    // treats an absent key as "keep", so sending the whole form is safe and
    // sending a stray key would not be.
    const body = {
      cohort_id: form.cohort_id,
      title: form.title.trim(),
      description: form.description.trim(),
      task_type: form.task_type,
      submission_type: form.submission_type,
      difficulty_level: form.difficulty_level,
      attachment_url: form.attachment_url.trim(),
      task_status: form.task_status,
      due_date: form.due_date || '',
      // No score_weight: points are admin-owned; the server ignores it anyway.
    };
    try {
      const { data } = editing
        ? await achieverApi.put(`/achievers/portal/tasks/${task.id}`, body)
        : await achieverApi.post('/achievers/portal/tasks', body);
      if (data?.bool) {
        if (!editing) setSavedId(data.response?.task_id || null);
        setCreated(true);   // saved: closing from here on must refresh the list
        setStep(1);
      } else setError(data?.response?.message || 'Could not save this task.');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  const isQuiz = form.task_type === 'quiz';
  const STEPS = ['Details', isQuiz ? 'Questions' : 'Rubric'];
  // Closing after the task was created still has to refresh the list.
  const close = () => (created ? onSaved(editing) : onClose());
  const inputCls = 'w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none transition-shadow';
  const label = (text, req) => (
    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
      {text}{req && <span className="text-red-500"> *</span>}
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-lg">{editing ? 'Edit task' : 'Create task'}</h2>
            {/* "app", not "portal", and deliberately: My Tasks was removed
                from the student *web* portal on 2026-09-01, so a task reaches
                students through SkovoMobile's TasksScreen only. Promising a
                screen the web student does not have would be a lie the
                achiever only discovers when nobody submits. */}
            <p className="text-xs text-slate-400 mt-0.5">
              Step {step + 1} of 2 · {STEPS[step]} · students see it in the SKOVO app
            </p>
          </div>
          <button onClick={close} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors shrink-0">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-4 sm:px-6 pt-4">
          {STEPS.map((l, i) => (
            <button key={l} type="button" disabled={i === 1 && !savedId} onClick={() => setStep(i)} className="flex-1 disabled:cursor-not-allowed">
              <span className={`block h-1 rounded-full ${i <= step ? '' : 'bg-slate-100'}`}
                    style={i <= step ? { backgroundColor: 'var(--accent)' } : {}} />
              <span className={`block text-[11px] mt-1.5 font-semibold ${i === step ? 'text-slate-900' : 'text-slate-400'}`}>{l}</span>
            </button>
          ))}
        </div>

        {step === 1 && savedId ? (
          <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
            {isQuiz ? (
              <>
                <p className="text-xs text-slate-500">Add the questions. Students answer in the app and it is marked automatically — no review needed.</p>
                <QuestionEditor client={achieverApi} base={`/achievers/portal/tasks/${savedId}/questions`} canReorder />
                <div className="pt-4 border-t border-slate-100">
                  <p className="text-sm font-bold text-slate-800 mb-3">Quiz rules</p>
                  <Settings taskId={savedId} mode="auto" />
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-slate-500">You mark each submission by hand in Review, against these lines.</p>
                <Settings taskId={savedId} mode="manual" />
              </>
            )}
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          <div>
            {label('Cohort', true)}
            <FormSelect value={form.cohort_id} onChange={v => sf('cohort_id', v)}
                        icon={BookOpen} options={cohortOptions}
                        placeholder="Which cohort is this for?" />
          </div>

          <div>
            {label('Title', true)}
            <input className={inputCls} value={form.title} maxLength={255}
                   onChange={e => sf('title', e.target.value)}
                   placeholder="e.g. React basics quiz" />
          </div>

          <div>
            {label('Description')}
            <textarea className={`${inputCls} min-h-24 resize-y`} value={form.description}
                      onChange={e => sf('description', e.target.value)}
                      placeholder="What should they do, and what does good look like?" />
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              {label('Type')}
              <FormSelect value={form.task_type} onChange={v => sf('task_type', v)}
                          icon={Tag} options={lists.task_type} placeholder="Choose a type (e.g. Quiz)" />
            </div>
            {/* A quiz is answered in the app, so how to submit only applies to the other types. */}
            {form.task_type !== 'quiz' && (
              <div>
                {label('How they submit')}
                <FormSelect value={form.submission_type} onChange={v => sf('submission_type', v)}
                            icon={Upload} options={lists.task_submission_type} placeholder="e.g. Link / URL" />
              </div>
            )}
            <div>
              {label('Difficulty')}
              <FormSelect value={form.difficulty_level} onChange={v => sf('difficulty_level', v)}
                          icon={TrendingUp} options={lists.difficulty_level} placeholder="Choose a level" />
            </div>
            <div>
              {label('Status')}
              <FormSelect value={form.task_status} onChange={v => sf('task_status', v)}
                          options={STATUS_FILTERS.filter(s => s.key !== 'all').map(s => ({ value: s.key, label: s.label }))}
                          required />
            </div>
            <div>
              {label('Due date')}
              {/* A deadline already behind us would be overdue on arrival. */}
              <DateTimePicker value={form.due_date} onChange={(v) => sf('due_date', v)} placeholder="No deadline"
                              min={(() => { const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset()); return n.toISOString().slice(0, 16); })()} />
              <p className="text-[11px] text-slate-400 mt-1">Optional. Leave blank for no deadline.</p>
            </div>
          </div>

          <div>
            {label('Reference link')}
            <input className={inputCls} value={form.attachment_url}
                   onChange={e => sf('attachment_url', e.target.value)}
                   placeholder="https://… a brief, template or example" />
          </div>

          {error && (
            <div className="rounded-xl bg-red-50 border border-red-100 px-3.5 py-2.5">
              <p className="text-sm text-red-600">{error}</p>
            </div>
          )}
        </div>
        )}

        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex items-center gap-3">
          {step === 1 ? (
            <>
              <button type="button" onClick={() => setStep(0)}
                className="min-h-11 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                Back
              </button>
              <div className="flex-1" />
              <Button variant="primary" onClick={() => onSaved(editing)}>Done</Button>
            </>
          ) : (
            <>
              <button type="button" onClick={close}
                className="min-h-11 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl transition-colors">
                Cancel
              </button>
              <div className="flex-1" />
              <Button variant="primary" onClick={submit} disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                  : <>{editing ? 'Save & next' : 'Create & next'} <ChevronRight size={15} /></>}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


export default function AchieverTasks() {
  const [tasks, setTasks]     = useState([]);
  const [cohorts, setCohorts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [cohortFilter, setCohortFilter] = useState('all');
  const [modalOpen, setModalOpen] = useState(false);
  const [editTask, setEditTask]   = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [deleting, setDeleting]   = useState(null);
  const [reviewTask, setReviewTask] = useState(null);
  const [quizTask, setQuizTask] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    achieverApi.get('/achievers/portal/tasks')
      .then(({ data }) => {
        if (!data.bool) { setFailed(true); return; }
        setTasks(data.response.tasks || []);
        // The cohort list rides along with the tasks so the create dialog can
        // open on an empty screen without a second request.
        setCohorts(data.response.cohorts || []);
      })
      // A failed request is not "no tasks" — the retry belongs here, not an
      // invitation to create a first task when there may already be twenty.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // Fetch on mount. The rule targets cascading renders from synchronous
  // setState; `load` sets state inside an awaited callback, and it is the
  // same shape every other achiever screen uses. See useAchieverLifecycle.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const needle = q.trim().toLowerCase();
  const filtered = tasks.filter((t) => {
    const matchesQ = !needle
      || (t.title || '').toLowerCase().includes(needle)
      || (t.description || '').toLowerCase().includes(needle)
      || (t.cohort_title || '').toLowerCase().includes(needle);
    const matchesStatus = statusFilter === 'all' || t.task_status === statusFilter;
    const matchesCohort = cohortFilter === 'all' || t.cohort_id === cohortFilter;
    return matchesQ && matchesStatus && matchesCohort;
  });
  const paged = usePagedRows(filtered);

  const openCreate = () => { setEditTask(null); setModalOpen(true); };
  const openEdit   = (t) => { setEditTask(t); setModalOpen(true); };
  const onSaved    = (wasEditing) => {
    setModalOpen(false);
    toast.success(wasEditing ? 'Task updated' : 'Task created');
    load();
  };

  const handleDelete = async (task) => {
    setConfirmDelete(null);
    setDeleting(task.id);
    try {
      const { data } = await achieverApi.delete(`/achievers/portal/tasks/${task.id}`);
      if (data?.bool === false) toast.error(data.response?.message || 'Could not delete that task');
      else toast.success('Task deleted');
      load();
    } catch {
      toast.error('Could not delete that task');
    } finally {
      setDeleting(null);
    }
  };

  // Nothing to attach a task to. Distinct from having no tasks: the way out is
  // to create a cohort, not to create a task, and offering the task dialog here
  // would open a form whose only required field has no options.
  const noCohorts = !loading && !failed && cohorts.length === 0;

  return (
    <>
      <TaskModal
        open={modalOpen}
        task={editTask}
        cohorts={cohorts}
        onClose={() => setModalOpen(false)}
        onSaved={onSaved}
      />

      <QuizBuilderModal task={quizTask} onClose={() => setQuizTask(null)} />

      <ReviewDrawer
        task={reviewTask}
        onClose={() => setReviewTask(null)}
        // A verdict changes the submitted/pending counts the cards behind the
        // drawer are showing, so the list reloads rather than going stale.
        onReviewed={load}
      />

      {confirmDelete && (
        <ConfirmModal
          message={`Delete “${confirmDelete.title}”?`}
          detail={confirmDelete.submission_count > 0
            ? `${confirmDelete.submission_count} student${confirmDelete.submission_count === 1 ? ' has' : 's have'} already submitted. Their work is kept, but the task disappears from the app.`
            : 'Students in this cohort will no longer see this task.'}
          confirmLabel="Delete task"
          danger
          onCancel={() => setConfirmDelete(null)}
          onConfirm={() => handleDelete(confirmDelete)}
        />
      )}

      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Tasks</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''} across your cohorts
            {filtered.length !== tasks.length && ` · ${filtered.length} shown`}
          </p>
        </div>
        <Button variant="primary" onClick={openCreate} disabled={noCohorts}
          title={noCohorts ? 'Create a cohort first' : undefined} className="shrink-0 w-full sm:w-auto">
          <Plus size={16} /> Create task
        </Button>
      </div>

      {/* Search, status and cohort. Hidden entirely when there is nothing to
          filter — controls over zero rows are noise on an empty screen. */}
      {(tasks.length > 0 || needle || statusFilter !== 'all' || cohortFilter !== 'all') && (
        <div className="space-y-3 mb-5">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATUS_FILTERS.map(f => (
            <StatTile key={f.key} label={f.label} icon={f.icon} tone={f.tone}
                      value={tasks.filter((t) => t.task_status === f.key).length}
                      active={statusFilter === f.key}
                      onClick={() => setStatusFilter(statusFilter === f.key ? 'all' : f.key)} />
          ))}
          {/* Not a filter: how much work is waiting on the achiever. */}
          <StatTile label="To review" icon={Inbox} tone="blue"
                    value={tasks.reduce((n, t) => n + Number(t.pending_count || 0), 0)} sub="submissions" />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={e => setQ(e.target.value)} type="search" aria-label="Search tasks"
              placeholder="Title, description or cohort…"
              className="w-full min-h-11 pl-10 pr-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
          </div>
          {cohorts.length > 1 && (
            <div className="sm:w-56">
              <FormSelect value={cohortFilter} onChange={setCohortFilter}
                options={[{ value: 'all', label: 'All cohorts' },
                          ...cohorts.map(c => ({ value: c.id, label: c.title }))]}
                required />
            </div>
          )}
        </div>
        </div>
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      ) : failed ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <ErrorState
            title="We couldn't load your tasks"
            subtitle="Your tasks are safe — this is a connection problem."
            onRetry={load}
          />
        </div>
      ) : noCohorts ? (
        <TableShell>
          <div className="py-4">
            <EmptyState
              icon={BookOpen}
              message="No cohorts yet"
              sub="Tasks belong to a cohort — create one first, then set work for it"
            />
          </div>
        </TableShell>
      ) : filtered.length === 0 && tasks.length > 0 ? (
        /* Filtered to nothing — different from having no tasks at all, and the
           way out is to clear the filter, not to create another task. */
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState icon={Search} message="No tasks match"
            sub="Try a different search, cohort or status" />
          <div className="flex justify-center pb-6">
            <button onClick={() => { setQ(''); setStatusFilter('all'); setCohortFilter('all'); }}
              className="px-4 py-2 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:border-slate-400 transition-colors">
              Clear filters
            </button>
          </div>
        </div>
      ) : tasks.length === 0 ? (
        <TableShell>
          <div className="py-4">
            <EmptyState
              icon={ClipboardList}
              message="No tasks yet"
              sub="Set work for a cohort and every enrolled student sees it in the SKOVO app"
            />
            <div className="flex justify-center pb-6">
              <button onClick={openCreate}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-bold text-white rounded-xl transition-all"
                style={{ backgroundColor: 'var(--accent)' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                <Plus size={15} /> Create First Task
              </button>
            </div>
          </div>
        </TableShell>
      ) : (
        <>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {paged.rows.map(t => (
              <div key={t.id} className="bg-white rounded-2xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="p-5 flex-1">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                         style={{ backgroundColor: 'var(--accent-light)' }}>
                      <ClipboardList size={17} style={{ color: 'var(--accent)' }} />
                    </div>
                    <StatusBadge status={t.task_status} />
                  </div>

                  <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{t.title}</h3>
                  <p className="text-xs text-slate-500 mt-1 truncate">{t.cohort_title || '—'}</p>
                  {/* Class rules: a task opens for students who checked in, when the class ends. */}
                  {t.state === 'draft' && (
                    <p className="text-[11px] font-semibold text-amber-700 mt-1">Opens when the class ends</p>
                  )}
                  {t.state === 'withdrawn' && (
                    <p className="text-[11px] font-semibold text-red-600 mt-1">Withdrawn: the class was cancelled</p>
                  )}

                  {t.description && (
                    <p className="text-xs text-slate-500 mt-2 line-clamp-2">{t.description}</p>
                  )}

                  <div className="mt-4 space-y-1.5">
                    <div className="flex items-center gap-2 text-xs">
                      <Calendar size={13} className={isOverdue(t) ? 'text-red-500' : 'text-slate-400'} />
                      <span className={isOverdue(t) ? 'text-red-600 font-semibold' : 'text-slate-600'}>
                        {dueLabel(t.due_date)}{isOverdue(t) && ' · overdue'}
                      </span>
                    </div>
                    {/* The counts used to be dead text. They are the way into
                        the work now — the number and the Review button below
                        open the same drawer. */}
                    <button
                      type="button"
                      onClick={() => setReviewTask(t)}
                      disabled={!t.submission_count}
                      className="flex items-center gap-2 text-xs text-slate-600 enabled:hover:text-slate-900 disabled:cursor-default transition-colors"
                    >
                      <Users size={13} className="text-slate-400" />
                      {t.submission_count} submission{t.submission_count === 1 ? '' : 's'}
                      {t.pending_count > 0 && (
                        <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                          · {t.pending_count} to review
                        </span>
                      )}
                    </button>
                    {t.attachment_url && (
                      <a href={t.attachment_url} target="_blank" rel="noreferrer"
                         className="flex items-center gap-2 text-xs text-slate-600 hover:text-slate-900 transition-colors">
                        <LinkIcon size={13} className="text-slate-400" />
                        <span className="truncate">Reference link</span>
                      </a>
                    )}
                  </div>
                </div>

                {/* 2x2: four actions in one row squeezed "Quiz & rubric" onto two
                    lines on a phone card. */}
                <div className="grid grid-cols-2 border-t border-slate-100 [&>*:nth-child(2n)]:border-l [&>*:nth-child(n+3)]:border-t">
                  {/* First action on the row, because for an active task with
                      work waiting it is the only one that matters. */}
                  <button onClick={() => setReviewTask(t)}
                    className="min-h-11 border-slate-100 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors relative">
                    <ClipboardList size={13} /> Review
                    {t.pending_count > 0 && (
                      <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold text-white"
                            style={{ backgroundColor: 'var(--accent)' }}>
                        {t.pending_count}
                      </span>
                    )}
                  </button>
                  <button onClick={() => setQuizTask(t)}
                    className="min-h-11 border-slate-100 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                    <BarChart3 size={13} /> Results
                  </button>
                  <button onClick={() => openEdit(t)}
                    className="min-h-11 border-slate-100 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => setConfirmDelete(t)} disabled={deleting === t.id}
                    className="min-h-11 border-slate-100 flex items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50">
                    {deleting === t.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
          {paged.pages > 1 && (
            <div className="mt-5">
              <Pagination {...paged.bind} />
            </div>
          )}
        </>
      )}
    </>
  );
}
