/**
 * One quiz player for cohort quizzes, speed rounds,
 * speed rounds and My Mistakes (feature-updates.md §5, §7).
 *
 *   questions  [{id, type, text, options:[{key,value}], marks, lang}]
 *   seconds    countdown; at 0 the quiz submits itself (the server enforces it too)
 *   onSubmit(answers)            -> Promise
 *   onAutosave(answers, tabs)    optional, called every few seconds while answering
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, Check, X } from 'lucide-react';

function fmt(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export function QuestionInput({ q, value, onChange, disabled }) {
  if (q.type === 'mcq' || q.type === 'true_false') {
    return (
      <div className="space-y-2">
        {q.options.map((o) => (
          <button key={o.key} type="button" disabled={disabled} onClick={() => onChange(o.key)}
                  className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition ${value === o.key ? 'border-blue-600 bg-blue-50 font-semibold' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  lang={q.lang}>
            {q.type === 'mcq' && <span className="font-bold mr-2 text-slate-400">{o.key}.</span>}{o.value}
          </button>
        ))}
      </div>
    );
  }
  return (
    <input value={value ?? ''} disabled={disabled} onChange={(e) => onChange(e.target.value)} lang={q.lang}
           inputMode={q.type === 'numeric' ? 'decimal' : 'text'} placeholder={q.type === 'numeric' ? 'Your answer (number)' : 'Your answer'}
           className="w-full px-4 py-3 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
  );
}

export default function QuizPlayer({ title, questions, seconds, initialAnswers, onSubmit, onAutosave, submitLabel = 'Submit' }) {
  const [answers, setAnswers] = useState(initialAnswers || {});
  const [left, setLeft] = useState(seconds ?? null);
  const [busy, setBusy] = useState(false);
  const [i, setI] = useState(0);
  const tabs = useRef(0);
  const answersRef = useRef(answers);
  const doneRef = useRef(false);
  useEffect(() => { answersRef.current = answers; }, [answers]);

  const submit = useCallback(async () => {
    if (doneRef.current) return;
    doneRef.current = true;
    setBusy(true);
    try { await onSubmit(answersRef.current); } finally { setBusy(false); }
  }, [onSubmit]);

  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) { submit(); return undefined; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, submit]);

  // Tab switches are logged for the achiever (anti-cheat, §12 gap 5).
  useEffect(() => {
    const onVis = () => { if (document.hidden) tabs.current += 1; };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  // Autosave so a dropped connection never loses answers.
  useEffect(() => {
    if (!onAutosave) return undefined;
    const t = setInterval(() => { onAutosave(answersRef.current, tabs.current); tabs.current = 0; }, 8000);
    return () => clearInterval(t);
  }, [onAutosave]);

  const q = questions[i];
  const answered = Object.values(answers).filter((v) => v !== undefined && v !== '').length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          {title && <h2 className="text-lg font-bold text-slate-900">{title}</h2>}
          <p className="text-xs text-slate-500">Question {i + 1} of {questions.length} · {answered} answered</p>
        </div>
        {left !== null && (
          <span className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-bold ${left < 30 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'}`}>
            <Clock size={14} /> {fmt(Math.max(0, left))}
          </span>
        )}
      </div>
      <div className="flex gap-1 flex-wrap">
        {questions.map((x, j) => (
          <button key={x.id} onClick={() => setI(j)} aria-label={`Question ${j + 1}`}
                  className={`w-7 h-7 rounded-lg text-[11px] font-bold ${j === i ? 'bg-blue-600 text-white' : answers[x.id] ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{j + 1}</button>
        ))}
      </div>
      {q && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
          <p className="text-base text-slate-900 whitespace-pre-wrap" lang={q.lang}>{q.text}</p>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))} disabled={busy} />
          <p className="text-[11px] text-slate-400">{q.marks} mark(s)</p>
        </div>
      )}
      <div className="flex justify-between">
        <button onClick={() => setI((j) => Math.max(0, j - 1))} disabled={i === 0} className="px-4 py-2 rounded-xl border text-sm disabled:opacity-40">Previous</button>
        {i < questions.length - 1 ? (
          <button onClick={() => setI((j) => j + 1)} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm">Next</button>
        ) : (
          <button onClick={submit} disabled={busy} className="px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">{busy ? 'Submitting…' : submitLabel}</button>
        )}
      </div>
    </div>
  );
}

export function ReviewList({ questions }) {
  return (
    <div className="space-y-3">
      {questions.map((q, n) => (
        <div key={q.id} className={`border rounded-2xl p-4 ${q.correct ? 'border-emerald-200 bg-emerald-50/40' : 'border-red-200 bg-red-50/40'}`}>
          <div className="flex gap-2">
            {q.correct ? <Check size={16} className="text-emerald-600 mt-0.5" /> : <X size={16} className="text-red-600 mt-0.5" />}
            <p className="text-sm text-slate-900" lang={q.lang}>{n + 1}. {q.text}</p>
          </div>
          <p className="text-xs mt-2">Your answer: <b>{q.your_answer ?? '—'}</b> · Correct: <b>{q.type === 'fill_blank' ? (q.accepted || []).join(' / ') : q.correct_answer}</b></p>
          {q.explanation && <p className="text-xs text-slate-600 mt-1" lang={q.lang}>{q.explanation}</p>}
        </div>
      ))}
    </div>
  );
}

export function Celebrate({ title, subtitle, onClose }) {
  // Celebration screen (§7): a moment, not a modal maze.
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl p-8 text-center max-w-sm w-full shadow-2xl animate-[pop_.35s_ease-out]">
        <div className="text-5xl mb-3">🎉</div>
        <h3 className="text-xl font-bold text-slate-900">{title}</h3>
        {subtitle && <p className="text-sm text-slate-600 mt-1">{subtitle}</p>}
        <button onClick={onClose} className="mt-5 px-5 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold">Continue</button>
      </div>
    </div>
  );
}
