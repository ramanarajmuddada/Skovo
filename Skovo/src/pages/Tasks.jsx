import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../services/api';
import { useDialogPanel } from '../components/ui/useDialogPanel';
import { CheckSquare, Clock, CheckCircle, XCircle, Star, ExternalLink, AlertCircle, X, Check, Eye, Upload } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, StatusBadge, ActionBtn, Pagination, ResponsiveTable, RowCard, LoadError } from '../components/ui/TableComponents';
import { PageHeader, StudentPage } from '../components/ui/index.jsx';
import { fieldErrors, taskSubmit } from '../schemas/student';
import { Link } from 'react-router-dom';
import { TaskQuiz, RubricMarks, Appeal } from '../components/v1/TaskQuizPanel';

// Labels for cohort_tasks.task_type. Falls back to the raw value, so a type an
// admin adds to master_task_type still renders instead of disappearing.
const TYPE_LABEL = {
  assignment:   'Assignment',
  quiz:         'Quiz',
  project:      'Project',
  presentation: 'Presentation',
  live_session: 'Live Session',
};
const typeLabel = (v) => TYPE_LABEL[v] || (v ? String(v).replace(/_/g, ' ') : null);

const STATUS_BADGE = {
  pending:  'pending',
  reviewed: 'confirmed',
  approved: 'completed',
  rejected: 'cancelled',
};

/* Filters — ST06-019.
 *
 * The screen had none, so a student with a term's worth of homework had one
 * long list and no way to answer "what still needs doing". The three the sheet
 * names map onto the submission row rather than onto a column of their own:
 *
 *   To-do      nothing submitted yet (overdue included — it is still to do,
 *              and hiding it behind its own filter is how it gets forgotten)
 *   Submitted  sent in and waiting, or sent back for another go
 *   Approved   marked and accepted
 *
 * `rejected` deliberately falls under Submitted: the work is with the mentor
 * as far as the student is concerned, and a "Rejected" tab is a place nobody
 * clicks. It still carries its own red badge in the row. */
const TASK_FILTERS = [
  ['all',       'All'],
  ['todo',      'To-do'],
  ['submitted', 'Submitted'],
  ['approved',  'Approved'],
];

const matchesFilter = (task, filter) => {
  if (filter === 'all') return true;
  const status = task.submission?.status;
  if (filter === 'todo') return !task.submission;
  if (filter === 'approved') return status === 'approved';
  if (filter === 'submitted') return !!task.submission && status !== 'approved';
  return true;
};


/* A passed quiz pays readiness through the Score Engine (+2, or +3 at 70%);
   score_weight is the old per-task number and read "+0" on every quiz. */
function pointsLabel(t) {
  const type = String(t.task_type || '').toLowerCase();
  if (type === 'quiz') return '+2 readiness on pass · +3 at 70%';
  return Number(t.score_weight) ? `+${t.score_weight}` : '—';
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-5 right-5 z-100 px-5 py-3 rounded-2xl text-sm font-semibold shadow-2xl flex items-center gap-2.5 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}

const fmtDate = (iso) => iso
  ? new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' })
  : null;

// Deadlines carry a time and students miss them by hours, not days.
//
// The list column used to be date-only "to fit", and that was the wrong trade:
// a row reading "12 Sep" for a task that closes at 18:30 tells a student they
// have all of Friday when they have until the evening, and the only place the
// real deadline appeared was inside a modal they had no reason to open. Width
// is a layout problem; a missed deadline is the student's problem. Both views
// now show the time, and the short form keeps it to one line.
const fmtDateTime = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
  : null;

// "12 Sep, 6:30 pm" — the medium date plus the time, for the narrow columns.
const fmtDateShort = (iso) => iso
  ? new Date(iso).toLocaleString('en-IN',
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : null;

const DIFFICULTY_LABEL = { easy: 'Easy', medium: 'Medium', hard: 'Hard',
  beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' };
const SUBMISSION_LABEL = { url_link: 'URL / Link', file_upload: 'File Upload',
  text_only: 'Text Response', github_repo: 'GitHub Repo', video_link: 'Video Link' };
const labelFrom = (map) => (v) => map[v] || (v ? String(v).replace(/_/g, ' ') : null);
const difficultyLabel = labelFrom(DIFFICULTY_LABEL);
const submissionLabel = labelFrom(SUBMISSION_LABEL);

function SubmitForm({ taskId, existing, onSaved }) {
  const [url,    setUrl]    = useState(existing?.evidence_url  || '');
  const [note,   setNote]   = useState(existing?.evidence_text || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [fieldErrs, setFieldErrs] = useState({});

  const submit = async (e) => {
    e.preventDefault();
    const parsed = taskSubmit.safeParse({ evidence_url: url, evidence_text: note });
    if (!parsed.success) {
      setFieldErrs(fieldErrors(parsed));
      return;
    }
    setFieldErrs({});
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/tasks/${taskId}/submit`, {
        evidence_url:  url.trim()  || null,
        evidence_text: note.trim() || null,
      });
      if (data.bool) { onSaved(); }
      else setError(data.response?.message || 'Failed to submit');
    } catch { setError('Network error. Try again.'); }
    finally { setSaving(false); }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-3 p-4 bg-slate-50 rounded-2xl border border-slate-200">
      <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Submit Evidence</p>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          Link <span className="font-normal text-slate-400">(GitHub, Drive, Portfolio…)</span>
        </label>
        <input
          type="text"
          inputMode="url"
          autoComplete="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (fieldErrs.evidence_url) setFieldErrs((p) => ({ ...p, evidence_url: undefined }));
          }}
          placeholder="Enter evidence link"
          aria-invalid={fieldErrs.evidence_url ? true : undefined}
          className="w-full min-h-11 px-3.5 py-2.5 border border-slate-200 rounded-xl text-base focus:outline-none bg-white"
        />
        {fieldErrs.evidence_url && (
          <p className="text-xs text-red-600 mt-1.5">{fieldErrs.evidence_url}</p>
        )}
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-600 mb-1.5">
          Description <span className="font-normal text-slate-400">(optional if you added a link)</span>
        </label>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Enter what you built or did"
          className="w-full min-h-11 px-3.5 py-2.5 border border-slate-200 rounded-xl text-base focus:outline-none resize-none bg-white"
        />
      </div>
      {error && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <AlertCircle size={12} /> {error}
        </p>
      )}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="min-h-11 w-full sm:w-auto px-5 py-2.5 text-white text-sm font-semibold rounded-xl disabled:opacity-50 transition-opacity"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {saving ? 'Submitting…' : existing ? 'Update Submission' : 'Submit Evidence'}
        </button>
      </div>
    </form>
  );
}

// ── Task Detail Modal ─────────────────────────────────────────────────────────
function TaskDetailModal({ item: a, onClose, onRefresh }) {
  const dialog = useDialogPanel({ onClose });
  if (!a) return null;
  const sub = a.submission;
  const overdue = a.due_date && new Date(a.due_date) < new Date() && !sub;
  const canSubmit = !sub || ['pending', 'reviewed', 'rejected'].includes(sub.status);

  // Every field the achiever filled in, in the order a student reads them:
  // what the work is, which class it came from, then when it is due. Rows with
  // nothing behind them are dropped rather than shown as a column of dashes.
  const rows = [
    { label: 'Task', value: a.title || '—' },
    { label: 'Type', value: typeLabel(a.task_type) },
    { label: 'Difficulty', value: difficultyLabel(a.difficulty_level) },
    { label: 'Submit as', value: submissionLabel(a.submission_type) },
    { label: 'Cohort', value: a.cohort_title || '—' },
    { label: 'Class', value: a.session_date ? `${a.cohort_status} · ${fmtDate(a.session_date)}` : a.cohort_status },
    { label: 'Assigned', value: a.assigned_at ? fmtDateTime(a.assigned_at) : null },
    { label: 'Points', value: pointsLabel(a) },
    { label: 'Due', value: a.due_date ? fmtDateTime(a.due_date) : 'No deadline' },
    { label: 'Status', value: sub ? sub.status : (overdue ? 'overdue' : 'not submitted'), cap: true },
    { label: 'Mentor Score', value: sub?.mentor_score != null ? `${sub.mentor_score}/10` : null },
  ].filter((r) => r.value);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div {...dialog.panelProps}
           className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] overflow-hidden flex flex-col focus:outline-none">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 {...dialog.titleProps} className="text-base font-bold text-slate-900">Task Details</h2>
          <button onClick={onClose} aria-label="Close task details" className="min-h-11 min-w-11 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 overflow-y-auto space-y-4">
          <div className="space-y-1">
            {rows.map(({ label, value, cap }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className={`text-sm font-semibold text-slate-800 text-right ${cap ? 'capitalize' : ''}`}>{value}</span>
              </div>
            ))}
          </div>

          {a.description && (
            <p className="text-sm text-slate-600 leading-relaxed whitespace-pre-line">{a.description}</p>
          )}

          {/* The brief. Without a link out to it the attachment field the
              achiever filled in was write-only. */}
          {a.attachment_url && (
            <a href={a.attachment_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold hover:underline break-all"
              style={{ color: 'var(--accent)' }}>
              <ExternalLink size={12} className="shrink-0" /> Open task brief
            </a>
          )}

          {/* Mentor feedback */}
          {sub?.mentor_score != null && (
            <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl">
              <div className="flex items-center gap-1.5 text-xs font-bold text-amber-700 mb-1.5">
                <Star size={12} /> Mentor Score: {sub.mentor_score}/10
              </div>
              {sub.mentor_notes && (
                <p className="text-xs text-amber-700 leading-relaxed">{sub.mentor_notes}</p>
              )}
            </div>
          )}

          {/* Existing submission */}
          {sub && (
            <div className="p-3.5 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
              <p className="text-xs font-bold text-slate-600">Your submission</p>
              {sub.evidence_url && (
                <a href={sub.evidence_url} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 text-xs hover:underline break-all"
                  style={{ color: 'var(--accent)' }}>
                  <ExternalLink size={11} className="shrink-0" /> {sub.evidence_url}
                </a>
              )}
              {sub.evidence_text && (
                <p className="text-xs text-slate-600 leading-relaxed">{sub.evidence_text}</p>
              )}
              <p className="text-[11px] text-slate-400">Submitted {fmtDate(sub.submitted_at)}</p>
            </div>
          )}

          {/* Submit / resubmit form */}
          <RubricMarks rubric={a.rubric} scores={sub?.rubric_scores} />

          {a.is_quiz ? <TaskQuiz task={a} onDone={onRefresh} /> : canSubmit && (
            <SubmitForm taskId={a.id} existing={sub} onSaved={onRefresh} />
          )}
          <Appeal sub={sub} onDone={onRefresh} />

          {sub?.status === 'approved' && (
            <div className="flex items-center gap-2 text-sm text-emerald-700 font-semibold bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-2xl">
              <CheckCircle size={16} className="shrink-0" />
              Approved! Readiness points are added as per SKOVO's score rules.
            </div>
          )}
          {sub?.status === 'rejected' && (
            <div className="flex items-center gap-2 text-sm text-red-600 font-semibold bg-red-50 border border-red-200 px-4 py-3 rounded-2xl">
              <XCircle size={16} className="shrink-0" />
              Rejected. Review the feedback above and resubmit.
            </div>
          )}
        </div>
        <div className="px-5 sm:px-6 pb-5 pt-3 shrink-0 border-t border-slate-100"
          style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          <button onClick={onClose} className="w-full min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function Tasks() {
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [toast,   setToast]   = useState(null);
  const [view,    setView]    = useState(null);
  const [page,    setPage]    = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [filter,  setFilter]  = useState('all');

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.get('/tasks/')
      .then(({ data }) => {
        if (data.bool) setTasks(data.response.tasks || []);
        else setLoadError(data.response?.message || 'The server refused the request.');
      })
      .catch((err) => {
        setLoadError(err?.response?.data?.response?.message
          || err?.message
          || 'The request failed. Check your connection and try again.');
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, []);

  const handleSaved = () => {
    showToast('Submission saved');
    setView(null);
    load();
  };

  const pendingReview = tasks.filter((t) => t.submission?.status === 'reviewed').length;

  // Paginate the filtered list, not the raw one. Filtering after slicing is the
  // classic version of this bug: page 1 of "Approved" then shows whichever of
  // the first 20 tasks happen to be approved, and the rest are unreachable.
  const visible = tasks.filter((t) => matchesFilter(t, filter));
  const total = visible.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageItems = visible.slice((page - 1) * perPage, page * perPage);

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />

      <PageHeader
        title="My Tasks"
        subtitle={tasks.length > 0
          ? `${tasks.length} task${tasks.length !== 1 ? 's' : ''} from your enrolled cohorts${pendingReview > 0 ? ` · ${pendingReview} being reviewed` : ''}`
          : 'Complete tasks from your cohorts to earn readiness points'}
      />

      {/* aria-pressed, not just a colour: a toggle set has to announce which of
          its buttons is on, and colour alone says nothing to a screen reader. */}
      {tasks.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter tasks">
          {TASK_FILTERS.map(([value, label]) => {
            const count = value === 'all'
              ? tasks.length
              : tasks.filter((t) => matchesFilter(t, value)).length;
            const on = filter === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={on}
                onClick={() => { setFilter(value); setPage(1); }}
                className={`px-3 py-2 min-h-11 rounded-lg text-xs font-semibold border transition-colors
                  ${on
                    ? 'text-white border-transparent'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                style={on ? { backgroundColor: 'var(--accent)' } : undefined}
              >
                {label}
                {/* The count is what makes the filter worth pressing — it says
                    whether there is anything behind it before you look. */}
                <span className="ml-1.5 tabular-nums opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Stacked cards below md so a phone reads one task per card. */}
      {(loading || tasks.length > 0) && (
      <ResponsiveTable
        cards={
          loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
              ))
            : pageItems.map((t) => {
                const sub = t.submission;
                const overdue = t.due_date && new Date(t.due_date) < new Date() && !sub;
                const status = sub ? sub.status : (overdue ? 'overdue' : 'pending');
                return (
                  <RowCard
                    key={t.id}
                    onClick={() => setView(t)}
                    title={t.title}
                    subtitle={t.cohort_title || undefined}
                    badge={overdue
                      ? <StatusBadge status="cancelled" label="Overdue" />
                      : <StatusBadge status={STATUS_BADGE[status] || 'pending'} label={status} />}
                    fields={[
                      { label: 'Type', value: typeLabel(t.task_type) || '—' },
                      { label: 'Due', value: t.due_date ? fmtDateTime(t.due_date) : '—' },
                      { label: 'Points', value: pointsLabel(t) },
                      { label: 'Score', value: sub?.mentor_score != null ? `${sub.mentor_score}/10` : null },
                    ]}
                  />
                );
              })
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Task</Th>
                <Th>Type</Th>
                <Th>Cohort</Th>
                <Th>Due</Th>
                <Th right>Points</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={8} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pageItems.map((t, idx) => {
                  const sub = t.submission;
                  const overdue = t.due_date && new Date(t.due_date) < new Date() && !sub;
                  const canSubmit = !sub || ['pending', 'reviewed', 'rejected'].includes(sub.status);
                  const status = sub ? sub.status : (overdue ? 'overdue' : 'pending');
                  return (
                    <tr key={t.id} onClick={() => setView(t)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View task details" color="indigo"
                            onClick={() => setView(t)} />
                          {canSubmit && (
                            <ActionBtn icon={Upload} tooltip={t.is_quiz ? 'Take quiz' : sub ? 'Update submission' : 'Submit evidence'} color="blue"
                              onClick={() => setView(t)} />
                          )}
                        </div>
                      </Td>
                      <Td>
                        <span className="font-semibold text-slate-900 max-w-xs truncate block">{t.title}</span>
                        {sub?.mentor_score != null && (
                          <span className="text-[10px] text-amber-600 inline-flex items-center gap-1">
                            <Star size={9} /> {sub.mentor_score}/10
                          </span>
                        )}
                      </Td>
                      <Td>
                        {typeLabel(t.task_type)
                          ? <span className="text-[10px] font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-600 capitalize">
                              {typeLabel(t.task_type)}
                            </span>
                          : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                      <Td><span className="text-xs text-slate-500">{t.cohort_title || '—'}</span></Td>
                      <Td>
                        <span className={`text-xs inline-flex items-center gap-1 ${overdue ? 'text-red-500 font-semibold' : 'text-slate-500'}`}>
                          {t.due_date ? <><Clock size={11} />{fmtDateShort(t.due_date)}</> : '—'}
                        </span>
                      </Td>
                      <Td right>
                        <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>{pointsLabel(t)}</span>
                      </Td>
                      <Td>
                        {overdue
                          ? <StatusBadge status="cancelled" label="Overdue" />
                          : <StatusBadge status={STATUS_BADGE[status] || 'pending'} label={status} />}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        }
      />
      )}
      {/* Two different empty states. "No tasks yet" on a filtered view would be
          wrong and, worse, alarming — the student has tasks, just none in this
          one bucket, and the way out is to change the filter, not to wait. */}
      {!loading && loadError && (
        <LoadError what="tasks" message={loadError} onRetry={load} />
      )}
      {!loading && total === 0 && tasks.length > 0 && (
        <EmptyState icon={CheckSquare}
          message={`No ${((TASK_FILTERS.find((f) => f[0] === filter) || [])[1] || '').toLowerCase()} tasks`}
          sub={`You have ${tasks.length} task${tasks.length !== 1 ? 's' : ''} in total — choose another filter to see them.`} />
      )}
      {!loading && tasks.length === 0 && !loadError && (
        <EmptyState icon={CheckSquare} message="No tasks yet"
          sub="Join a cohort first. Tasks your achiever sets during or after class land here."
          action={<Link to="/cohorts" className="inline-flex items-center justify-center min-h-11 px-4 py-2 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>Browse cohorts</Link>} />
      )}
      {!loading && total > 0 && (
        <div className="mt-3">
          <Pagination page={page} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
        </div>
      )}

      {view && <TaskDetailModal item={view} onClose={() => setView(null)} onRefresh={handleSaved} />}
    </StudentPage>
  );
}
