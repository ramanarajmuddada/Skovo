/**
 * Question builder (feature-updates.md §5, §7): MCQ, true/false, numeric,
 * fill-in-the-blank. English only (v1). Used by achievers (cohort quizzes,
 * question bank) and admin (speed practice lists).
 *
 * `client` is one of the services/api clients; `base` is the questions URL,
 * e.g. /achievers/portal/tasks/<id>/questions. No points field: points are
 * admin rules, marks here only count inside the quiz.
 *
 * `types` limits the Type list (speed rounds only use quick types);
 * `showMarks={false}` hides marks where they mean nothing (speed rounds).
 */
import React, { useCallback, useEffect, useId, useState } from 'react';
import { Plus, Trash2, Pencil, Check, X, ArrowUp, ArrowDown } from 'lucide-react';
import { useMasters } from '../hooks/useMasters';
import { Button, FieldLabel, FormSelect } from './ui/index.jsx';
import { ConfirmModal } from './ui/TableComponents';

// Fallback only if the master fails to load; the list lives in Admin -> Masters.
const TYPE_FALLBACK = [
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'numeric', label: 'Number answer' },
  { value: 'fill_blank', label: 'Fill in the blank' },
];
const EMPTY = { question_type: 'mcq', text: '', options: [{ value: '' }, { value: '' }, { value: '' }, { value: '' }],
  correct_answer: 'A', accepted: [''], tolerance: 0, marks: 1, explanation: '', lang: 'en', topic: '' };
const cls = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';
const iconBtn = 'min-h-10 min-w-10 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100';

function useTypes(allowed) {
  const { lists } = useMasters(['quiz_question_type'], { quiz_question_type: TYPE_FALLBACK });
  const all = (lists.quiz_question_type || TYPE_FALLBACK).map((o) => ({ value: o.value, label: o.label }));
  return allowed ? all.filter((t) => allowed.includes(t.value)) : all;
}

function QuestionForm({ initial, onSave, onCancel, saving, types, showMarks }) {
  const id = useId();
  const [q, setQ] = useState(() => ({ ...EMPTY, ...initial, lang: 'en',
    options: initial?.options?.length ? initial.options.map((o) => ({ value: o.value })) : EMPTY.options,
    accepted: initial?.accepted?.length ? initial.accepted : [''] }));
  const set = (k, v) => setQ((p) => ({ ...p, [k]: v }));
  const keys = q.options.map((_, i) => String.fromCharCode(65 + i));

  return (
    <div className="space-y-4 border border-slate-200 bg-slate-50 rounded-2xl p-4">
      <div className={`grid gap-3 ${showMarks ? 'sm:grid-cols-[1fr_8rem]' : ''}`}>
        <FormSelect label="Type" value={q.question_type} options={types} clearable={false}
                    onChange={(v) => v && set('question_type', v)} />
        {showMarks && (
          <div>
            <FieldLabel htmlFor={`${id}-marks`}>Marks</FieldLabel>
            <input id={`${id}-marks`} className={cls} type="number" min={0.5} step={0.5} value={q.marks}
                   onChange={(e) => set('marks', e.target.value)} />
          </div>
        )}
      </div>

      <div>
        <FieldLabel htmlFor={`${id}-text`} required>Question</FieldLabel>
        <textarea id={`${id}-text`} className={cls} rows={3} value={q.text} onChange={(e) => set('text', e.target.value)}
                  placeholder="e.g. What is 12 × 8?" />
      </div>

      {q.question_type === 'mcq' && (
        <div className="space-y-2">
          <FieldLabel>Options</FieldLabel>
          <p className="text-xs text-slate-500 -mt-1">Tap a letter to mark the correct answer.</p>
          {q.options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <button type="button" onClick={() => set('correct_answer', keys[i])}
                      className={`shrink-0 min-h-10 min-w-10 rounded-full text-sm font-bold border ${q.correct_answer === keys[i] ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white text-slate-500 border-slate-300'}`}
                      aria-label={`Mark option ${keys[i]} correct`} aria-pressed={q.correct_answer === keys[i]}>{keys[i]}</button>
              <input className={`${cls} min-w-0`} value={o.value} placeholder={`Option ${keys[i]}`} aria-label={`Option ${keys[i]}`}
                     onChange={(e) => set('options', q.options.map((x, j) => (j === i ? { value: e.target.value } : x)))} />
              {q.options.length > 2 && (
                <button type="button" onClick={() => set('options', q.options.filter((_, j) => j !== i))}
                        className={`shrink-0 ${iconBtn}`} aria-label={`Remove option ${keys[i]}`}><X size={16} /></button>
              )}
            </div>
          ))}
          {q.options.length < 6 && (
            <Button type="button" variant="ghost" size="sm" onClick={() => set('options', [...q.options, { value: '' }])}>
              <Plus size={14} /> Add option
            </Button>
          )}
        </div>
      )}

      {q.question_type === 'true_false' && (
        <div>
          <FieldLabel>Correct answer</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            {['true', 'false'].map((v) => (
              <button key={v} type="button" onClick={() => set('correct_answer', v)} aria-pressed={q.correct_answer === v}
                      className={`min-h-11 rounded-xl text-sm font-semibold border ${q.correct_answer === v ? 'bg-emerald-500 text-white border-emerald-500' : 'bg-white border-slate-300 text-slate-700'}`}>
                {v === 'true' ? 'True' : 'False'}
              </button>
            ))}
          </div>
        </div>
      )}

      {q.question_type === 'numeric' && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <FieldLabel htmlFor={`${id}-num`} required>Correct number</FieldLabel>
            <input id={`${id}-num`} className={cls} inputMode="decimal" value={q.correct_answer}
                   onChange={(e) => set('correct_answer', e.target.value)} placeholder="e.g. 96" />
          </div>
          <div>
            <FieldLabel htmlFor={`${id}-tol`}>Allowed difference</FieldLabel>
            <input id={`${id}-tol`} className={cls} type="number" min={0} value={q.tolerance}
                   onChange={(e) => set('tolerance', e.target.value)} />
            <p className="text-xs text-slate-500 mt-1">0 = must be exact.</p>
          </div>
        </div>
      )}

      {q.question_type === 'fill_blank' && (
        <div className="space-y-2">
          <FieldLabel>Accepted answers</FieldLabel>
          {q.accepted.map((a, i) => (
            <input key={i} className={cls} value={a} aria-label={`Accepted answer ${i + 1}`}
                   placeholder={i === 0 ? 'Accepted answer' : 'Another accepted answer'}
                   onChange={(e) => set('accepted', q.accepted.map((x, j) => (j === i ? e.target.value : x)))} />
          ))}
          <Button type="button" variant="ghost" size="sm" onClick={() => set('accepted', [...q.accepted, ''])}>
            <Plus size={14} /> Another accepted answer
          </Button>
        </div>
      )}

      <div>
        <FieldLabel htmlFor={`${id}-exp`}>Explanation (optional)</FieldLabel>
        <textarea id={`${id}-exp`} className={cls} rows={2} value={q.explanation || ''}
                  onChange={(e) => set('explanation', e.target.value)} placeholder="Shown after the student answers" />
      </div>
      <div>
        <FieldLabel htmlFor={`${id}-topic`}>Topic (optional)</FieldLabel>
        <input id={`${id}-topic`} className={cls} value={q.topic || ''} onChange={(e) => set('topic', e.target.value)}
               placeholder="e.g. Percentages" />
      </div>

      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel} className="w-full sm:w-auto">Cancel</Button>
        <Button type="button" disabled={saving} className="w-full sm:w-auto" onClick={() => onSave({
          ...q,
          lang: 'en',
          options: q.question_type === 'mcq' ? q.options.filter((o) => o.value.trim()) : undefined,
          accepted: q.question_type === 'fill_blank' ? q.accepted.filter((a) => a.trim()) : undefined,
          correct_answer: q.question_type === 'fill_blank' ? (q.accepted.find((a) => a.trim()) || '') : q.correct_answer,
        })}>
          <Check size={16} /> {saving ? 'Saving…' : 'Save question'}
        </Button>
      </div>
    </div>
  );
}

export default function QuestionEditor({ client, base, canReorder = false, saveToBank = false, onChange,
  types: allowedTypes, showMarks = true }) {
  const types = useTypes(allowedTypes);
  const [items, setItems] = useState([]);
  const [editing, setEditing] = useState(null);     // 'new' | question id
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(null);   // question waiting on "Remove?"

  const load = useCallback(() => {
    client.get(base).then(({ data }) => {
      if (data?.bool) { setItems(data.response.questions || []); onChange && onChange(data.response.questions || []); }
    }).catch(() => {});
  }, [client, base, onChange]);

  useEffect(() => { load(); }, [load]);

  const save = async (q, id) => {
    setSaving(true); setError('');
    try {
      const body = saveToBank && !id ? { ...q, save_to_bank: !!q.save_to_bank } : q;
      const { data } = id ? await client.put(`${base}/${id}`, body) : await client.post(base, body);
      if (data?.bool) { setEditing(null); load(); } else setError(data?.response?.message || 'Could not save.');
    } catch { setError('Could not save.'); }
    setSaving(false);
  };

  const remove = async (id) => {
    setRemoving(null);
    await client.delete(`${base}/${id}`);
    load();
  };

  const move = async (i, dir) => {
    const ids = items.map((q) => q.id);
    const j = i + dir;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await client.post(`${base}/reorder`, { ids });
    load();
  };

  const total = items.reduce((s, q) => s + Number(q.marks || 0), 0);
  const typeLabel = (v) => types.find((t) => t.value === v)?.label || TYPE_FALLBACK.find((t) => t.value === v)?.label || v;

  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <p className="text-sm text-slate-600"><b>{items.length}</b> question(s){showMarks && <> · <b>{total}</b> marks</>}</p>
        {editing !== 'new' && (
          <Button onClick={() => setEditing('new')} className="w-full sm:w-auto"><Plus size={16} /> Add question</Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      {editing === 'new' && (
        <QuestionForm types={types} showMarks={showMarks} onSave={(q) => save(q)} onCancel={() => setEditing(null)} saving={saving} />
      )}
      {items.map((q, i) => (editing === q.id ? (
        <QuestionForm key={q.id} types={types} showMarks={showMarks} initial={q} onSave={(v) => save(v, q.id)}
                      onCancel={() => setEditing(null)} saving={saving} />
      ) : (
        <div key={q.id} className="border border-slate-200 rounded-2xl p-3 flex gap-3">
          <span className="text-xs font-bold text-slate-400 mt-0.5">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-slate-800 break-words">{q.text}</p>
            {q.question_type === 'mcq' && (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {q.options.map((o) => (
                  <span key={o.key} className={`text-xs px-2 py-0.5 rounded-lg break-words ${o.key === q.correct_answer ? 'bg-emerald-100 text-emerald-700 font-semibold' : 'bg-slate-100 text-slate-600'}`}>
                    {o.key}. {o.value}
                  </span>
                ))}
              </div>
            )}
            {q.question_type !== 'mcq' && (
              <p className="text-xs text-emerald-700 mt-1 break-words">Answer: {q.question_type === 'fill_blank' ? q.accepted.join(' / ') : q.correct_answer}</p>
            )}
            <p className="text-[11px] text-slate-400 mt-1">{typeLabel(q.question_type)}{showMarks && ` · ${q.marks} mark(s)`}</p>
          </div>
          <div className="flex flex-col gap-1">
            {canReorder && <button onClick={() => move(i, -1)} className={iconBtn} aria-label="Move up"><ArrowUp size={15} /></button>}
            <button onClick={() => setEditing(q.id)} className={iconBtn} aria-label="Edit question"><Pencil size={15} /></button>
            <button onClick={() => setRemoving(q)} className={`${iconBtn} hover:text-red-600`} aria-label="Delete question"><Trash2 size={15} /></button>
            {canReorder && <button onClick={() => move(i, 1)} className={iconBtn} aria-label="Move down"><ArrowDown size={15} /></button>}
          </div>
        </div>
      )))}
      {removing && (
        <ConfirmModal danger message="Remove this question?" detail={removing.text} confirmLabel="Remove"
                      onConfirm={() => remove(removing.id)} onCancel={() => setRemoving(null)} />
      )}
    </div>
  );
}
