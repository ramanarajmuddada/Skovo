/**
 * Inside a task (feature-updates.md §5): take an auto-checked quiz, see the
 * answers when the achiever allows it, see rubric marks, appeal a decision.
 */
import React, { useState } from 'react';
import { api } from '../../services/api';
import QuizPlayer, { ReviewList } from './QuizPlayer';

export function TaskQuiz({ task, onDone }) {
  const [attempt, setAttempt] = useState(null);
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null);
  const [err, setErr] = useState('');
  const sub = task.submission;
  const q = task.quiz || {};

  const start = async () => {
    setErr('');
    const { data } = await api.post(`/tasks/${task.id}/quiz/start`, {});
    if (data?.bool) setAttempt(data.response); else setErr(data?.response?.message || 'Could not start.');
  };
  const autosave = async (answers, tabs) => {
    if (!attempt) return;
    await api.put(`/tasks/${task.id}/quiz/${attempt.attempt_id}`, { answers, tab_switches: tabs }).catch(() => {});
  };
  const submit = async (answers) => {
    const { data } = await api.post(`/tasks/${task.id}/quiz/${attempt.attempt_id}/submit`, { answers });
    if (data?.bool) { setResult(data.response); setAttempt(null); onDone?.(); } else setErr(data?.response?.message || 'Could not submit.');
  };
  const loadReview = async () => {
    const { data } = await api.get(`/tasks/${task.id}/quiz/review`);
    if (data?.bool) setReview(data.response); else setErr(data?.response?.message || 'Answers are not open yet.');
  };

  if (attempt) {
    return <QuizPlayer questions={attempt.questions} initialAnswers={attempt.answers} seconds={attempt.seconds_left}
                       onSubmit={submit} onAutosave={autosave} submitLabel="Submit quiz" />;
  }
  if (review) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-bold">{review.score}/{review.total} · {review.percent}%</p>
        <ReviewList questions={review.questions} />
        <button onClick={() => setReview(null)} className="text-xs text-blue-700">Hide answers</button>
      </div>
    );
  }

  const last = result || (sub?.auto_total ? { score: sub.auto_score, total: sub.auto_total } : null);
  return (
    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2">
      <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Quiz</p>
      <p className="text-xs text-slate-600">
        {q.questions} questions{q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''} · {q.max_attempts === 1 ? '1 attempt' : `${q.max_attempts} attempts`}{last ? ` · ${q.attempts_used ?? 1} used` : ''}{q.pass_percent ? ` · pass ${q.pass_percent}%` : ''}
      </p>
      {last && <p className="text-sm font-semibold text-slate-900">Your score: {last.score}/{last.total}{result?.percent !== undefined && ` (${result.percent}%)`}{result?.late && ' · late'}</p>}
      {result?.flagged && <p className="text-xs text-amber-700">Your achiever will take a look at this attempt.</p>}
      {err && <p className="text-xs text-red-600">{err}</p>}
      <div className="flex gap-2">
        {/* Only while an attempt is left: "Try again" on a 1-attempt quiz led to an error. */}
        {(!last || (q.attempts_used ?? 0) < (q.max_attempts || 1)) && (
          <button onClick={start} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">{last ? 'Try again' : 'Start quiz'}</button>
        )}
        {last && q.review_after !== 'never' && <button onClick={loadReview} className="px-4 py-2 rounded-xl border text-sm">See answers</button>}
      </div>
    </div>
  );
}

export function RubricMarks({ rubric, scores }) {
  if (!rubric?.length || !scores || !Object.keys(scores).length) return null;
  return (
    <div className="p-3.5 bg-white border border-slate-200 rounded-2xl space-y-1">
      <p className="text-xs font-bold text-slate-600">Rubric</p>
      {rubric.map((l) => (
        <div key={l.label} className="flex justify-between text-xs"><span>{l.label}</span><span className="font-semibold">{scores[l.label] ?? '—'}/{l.max}</span></div>
      ))}
    </div>
  );
}

export function Appeal({ sub, onDone }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  if (!sub?.id) return null;
  if (sub.appeal_text) return <p className="text-xs text-slate-500">Appeal sent: “{sub.appeal_text}”</p>;
  if (!['rejected', 'approved'].includes(sub.status)) return null;
  const send = async () => {
    const { data } = await api.post(`/tasks/submissions/${sub.id}/appeal`, { text });
    setMsg(data?.response?.message || (data?.bool ? 'Appeal sent.' : 'Could not send.'));
    if (data?.bool) { setOpen(false); onDone?.(); }
  };
  return (
    <div className="space-y-2">
      {!open ? <button onClick={() => setOpen(true)} className="text-xs font-semibold text-blue-700">Disagree with the result? Appeal</button> : (
        <>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} placeholder="Explain why (at least 10 characters)"
                    className="w-full px-3 py-2 border rounded-xl text-sm" />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] text-slate-400">{text.trim().length < 10 ? `${10 - text.trim().length} more characters` : 'Ready to send'}</span>
            <button onClick={send} disabled={text.trim().length < 10}
                    className="min-h-11 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">Send appeal</button>
          </div>
        </>
      )}
      {msg && <p className="text-xs text-slate-600">{msg}</p>}
    </div>
  );
}
