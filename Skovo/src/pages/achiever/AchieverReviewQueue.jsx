import React, { useCallback, useEffect, useState } from 'react';
import { achieverApi } from '../../services/api';
import { useToast, Button } from '../../components/ui/index.jsx';
import { ExternalLink, Inbox, MessageSquareWarning, CheckCircle2, Clock } from 'lucide-react';
import { EmptyState, ConfirmModal } from '../../components/ui/TableComponents';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';

/**
 * Achiever review queue across all their cohorts (feature-updates.md §5):
 * rubric click-scoring, keyboard next / approve, bulk approve, appeals.
 * Auto-checked quizzes never appear here — the system grades them.
 */
export default function AchieverReviewQueue() {
  const toast = useToast();
  // v1 is MCQ-only, so nothing needs hand marking: open on Appeals.
  // Restore 'queued' (and the Tabs below) when hand-marked task types return.
  const [state] = useState('appealed');
  const [items, setItems] = useState([]);
  const [max, setMax] = useState(10);
  const [idx, setIdx] = useState(0);
  const [lines, setLines] = useState({});
  const [score, setScore] = useState('');
  const [notes, setNotes] = useState('');
  const [picked, setPicked] = useState([]);
  const [bulkScore, setBulkScore] = useState('');
  const [confirmBulk, setConfirmBulk] = useState(false);

  const load = useCallback(() => {
    achieverApi.get('/achievers/portal/review-queue', { state }).then(({ data }) => {
      if (data?.bool) { setItems(data.response.items || []); setMax(data.response.max_score || 10); setIdx(0); setLines({}); setScore(''); setNotes(''); }
    }).catch(() => toast.error('Could not load the queue.'));
  }, [state, toast]);
  useEffect(() => { load(); }, [load]);

  const cur = items[idx];
  const rubric = cur?.rubric || [];
  const rubricDone = rubric.length > 0 && rubric.every((l) => lines[l.label] !== undefined);

  const decide = useCallback(async (status) => {
    if (!cur) return;
    if (status === 'approved' && score === '' && !rubricDone) { toast.error(`Score it (0–${max}) or fill the rubric first.`); return; }
    const { data } = await achieverApi.patch(`/achievers/portal/submissions/${cur.id}`, {
      status, mentor_score: score === '' ? null : Number(score), mentor_notes: notes,
      ...(rubricDone ? { rubric_scores: lines } : {}),
    });
    if (data?.bool) {
      toast.success(status === 'approved' ? 'Approved' : 'Sent back');
      setItems((p) => p.filter((x) => x.id !== cur.id));
      setLines({}); setScore(''); setNotes('');
    } else toast.error(data?.response?.message || 'Could not save.');
  }, [cur, score, notes, lines, rubricDone, max, toast]);

  useEffect(() => {
    const onKey = (e) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
      if (e.key === 'j') setIdx((i) => Math.min(i + 1, items.length - 1));
      if (e.key === 'k') setIdx((i) => Math.max(i - 1, 0));
      if (e.key === 'a') decide('approved');
      if (e.key === 'r') decide('rejected');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [items.length, decide]);

  const bulk = async () => {
    setConfirmBulk(false);
    if (!picked.length || bulkScore === '') return;
    const { data } = await achieverApi.post('/achievers/portal/submissions/bulk-approve', { ids: picked, mentor_score: Number(bulkScore) });
    if (data?.bool) { toast.success(data.response.message); setPicked([]); load(); } else toast.error(data?.response?.message || 'Failed.');
  };

  const inp = 'min-h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30';
  return (
    <div className="space-y-4">
      {confirmBulk && (
        <ConfirmModal message={`Approve ${picked.length} submission${picked.length === 1 ? '' : 's'}?`}
          detail={`Each gets a score of ${bulkScore} out of ${max}.`} confirmLabel="Approve"
          onConfirm={bulk} onCancel={() => setConfirmBulk(false)} />
      )}
      <div>
        <h1 className="text-2xl font-black text-slate-900">Review queue</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Quizzes are marked automatically. When a student disputes a mark, it shows up here.
          {/* Keyboard shortcuts only where there is a keyboard. */}
          <span className="hidden lg:inline"> Keys: <b>j</b>/<b>k</b> next / previous · <b>a</b> approve · <b>r</b> send back.</span>
        </p>
      </div>

      {/* v1: Appeals only. "To review" is for hand-marked tasks, which are off.
      <Tabs active={state} onChange={setState} tabs={[
        { key: 'queued', label: 'To review', icon: Inbox },
        { key: 'appealed', label: 'Appeals', icon: MessageSquareWarning },
      ]} />
      */}

      {items.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200">
          <EmptyState icon={CheckCircle2}
            message={state === 'queued' ? 'Nothing waiting for review' : 'No appeals'}
            sub={state === 'queued' ? 'Submissions to tasks you mark by hand show up here.' : 'When a student disputes a mark, it shows up here.'} />
        </div>
      ) : (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-4 items-start">
          {/* The list */}
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-500">{items.length} waiting</p>
              {picked.length > 0 && (
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={max} value={bulkScore} onChange={(e) => setBulkScore(e.target.value)}
                         placeholder={`0–${max}`} aria-label="Score for selected" className={`${inp} w-20 min-h-9`} />
                  <button onClick={() => setConfirmBulk(true)} disabled={bulkScore === ''}
                          className="min-h-9 px-3 rounded-lg bg-emerald-600 text-white text-xs font-semibold disabled:opacity-50">
                    Approve {picked.length}
                  </button>
                </div>
              )}
            </div>
            <ul className="max-h-[60vh] overflow-auto divide-y divide-slate-100">
              {items.map((it, i) => (
                <li key={it.id} onClick={() => setIdx(i)}
                    className={`flex gap-3 px-3 py-3 cursor-pointer ${i === idx ? 'bg-blue-50/60' : 'hover:bg-slate-50'}`}>
                  <input type="checkbox" checked={picked.includes(it.id)} onClick={(e) => e.stopPropagation()}
                         aria-label={`Select ${it.student_name}`} className="mt-1 w-4 h-4 shrink-0"
                         onChange={(e) => setPicked(e.target.checked ? [...picked, it.id] : picked.filter((x) => x !== it.id))} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-slate-900 truncate">{it.student_name}</p>
                    <p className="text-xs text-slate-500 truncate">{it.task_title} · {it.cohort_title}</p>
                  </div>
                  {it.late && <span className="shrink-0 self-start inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded"><Clock size={10} /> Late</span>}
                </li>
              ))}
            </ul>
          </div>

          {/* The one being marked */}
          {cur && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{cur.cohort_title}{cur.task_type ? ` · ${cur.task_type}` : ''}</p>
                <h2 className="text-lg font-bold text-slate-900 mt-0.5">{cur.task_title}</h2>
                <p className="text-sm text-slate-600">{cur.student_name}{cur.late ? ' · submitted late' : ''}</p>
              </div>
              {cur.appeal_text && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Appeal</p>
                  <p className="text-amber-900 mt-0.5">{cur.appeal_text}</p>
                </div>
              )}
              {cur.evidence_url && (
                <a href={cur.evidence_url} target="_blank" rel="noreferrer"
                   className="flex items-center justify-center gap-2 min-h-11 rounded-xl border border-slate-200 text-sm font-semibold text-blue-600 hover:bg-blue-50">
                  <ExternalLink size={15} /> Open submitted work
                </a>
              )}
              {cur.evidence_text && <p className="text-sm whitespace-pre-wrap bg-slate-50 rounded-xl p-3 text-slate-700">{cur.evidence_text}</p>}

              {rubric.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-400">Rubric</p>
                  {rubric.map((l) => (
                    <div key={l.label}>
                      <p className="text-sm text-slate-700 mb-1.5">{l.label} <span className="text-slate-400">· out of {l.max}</span></p>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: Number(l.max) + 1 }, (_, v) => {
                          const on = lines[l.label] === v;
                          return (
                            <button key={v} onClick={() => setLines((p) => ({ ...p, [l.label]: v }))}
                                    className={`w-10 h-10 rounded-lg text-sm font-bold border ${on ? 'text-white border-transparent' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
                                    style={on ? { backgroundColor: 'var(--accent)' } : undefined}>{v}</button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-3">
                <div>
                  <label htmlFor="rq-score" className="block text-xs font-semibold text-slate-600 mb-1">Score <span className="font-normal text-slate-400">(0–{max})</span></label>
                  <input id="rq-score" type="number" min={0} max={max} value={score} onChange={(e) => setScore(e.target.value)}
                         placeholder={rubric.length ? 'From rubric' : `0–${max}`} className={`${inp} w-full`} />
                </div>
                <div>
                  <label htmlFor="rq-notes" className="block text-xs font-semibold text-slate-600 mb-1">Feedback for the student</label>
                  <input id="rq-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                         placeholder="What was good, what to fix" className={`${inp} w-full`} />
                </div>
              </div>
              <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
                <button onClick={() => decide('rejected')}
                        className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                  Send back<span className="hidden lg:inline text-slate-400"> (r)</span>
                </button>
                <Button onClick={() => decide('approved')} className="!bg-emerald-600 hover:!bg-emerald-700">
                  Approve<span className="hidden lg:inline opacity-70"> (a)</span>
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
