import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Save, RotateCcw } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useToast } from '../../components/ui/index.jsx';
import FormSelect from '../../components/ui/FormSelect';
import { PageShell } from '../../components/admin/v1/AdminV1Kit';

const A = '/skovo-platform-panel-admin';
const msgOf = (d, fb) => d?.response?.message || fb;
const inputCls = 'w-full min-h-11 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800';

/** The guidelines an achiever reads on Verification — edited here, not in code. */
export default function AdminAchieverGuidelines() {
  const toast = useToast();
  const [all, setAll] = useState(null);
  const [state, setState] = useState('pending');
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback((keep) => {
    adminApi.get(`${A}/achiever-guidelines`).then(({ data }) => {
      if (!data?.bool) return;
      const rows = data.response.guidelines || [];
      setAll(rows);
      const r = rows.find((x) => x.state === (keep || 'pending')) || rows[0];
      setForm(r ? toForm(r) : null);
    }).catch(() => toast.error('Could not load the guidelines.'));
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const pick = (st) => { setState(st); const r = all.find((x) => x.state === st); setForm(r ? toForm(r) : null); };
  const current = all?.find((x) => x.state === state);
  const set = (k, v) => setForm({ ...form, [k]: v });
  const setSec = (i, k, v) => set('sections', form.sections.map((s, j) => (j === i ? { ...s, [k]: v } : s)));

  const save = async () => {
    setSaving(true);
    try {
      const { data } = await adminApi.put(`${A}/achiever-guidelines/${state}`, form);
      if (data?.bool) { toast.success(msgOf(data, 'Saved.')); load(state); } else toast.error(msgOf(data, 'Could not save.'));
    } catch { toast.error('Could not save.'); }
    setSaving(false);
  };
  const reset = async () => {
    try {
      const { data } = await adminApi.delete(`${A}/achiever-guidelines/${state}`);
      if (data?.bool) { toast.success(msgOf(data, 'Reset.')); load(state); } else toast.error(msgOf(data, 'Could not reset.'));
    } catch { toast.error('Could not reset.'); }
  };

  return (
    <PageShell title="Achiever guidelines"
               subtitle="What an achiever reads on the Verification screen at each stage. Applicants accept the full guidelines before submitting.">
      {!all || !form ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2">
            <div className="sm:w-72">
              <FormSelect value={state} onChange={(v) => v && pick(v)}
                          options={all.map((g) => ({ value: g.state, label: g.label }))} />
            </div>
            <p className="text-xs text-slate-500">
              {current?.custom ? `Edited · version ${current.version}${current.updated_by ? ` · ${current.updated_by}` : ''}` : 'Built-in text (not edited yet)'}
            </p>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
            <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} aria-label="Title" /></Field>
            <Field label="Summary"><textarea className={`${inputCls} py-2`} rows={2} value={form.summary} onChange={(e) => set('summary', e.target.value)} aria-label="Summary" /></Field>
            <Field label="Steps (one per line)">
              <textarea className={`${inputCls} py-2`} rows={5} value={form.steps} onChange={(e) => set('steps', e.target.value)} aria-label="Steps" />
            </Field>
            <Field label="Note (optional)"><textarea className={`${inputCls} py-2`} rows={2} value={form.note} onChange={(e) => set('note', e.target.value)} aria-label="Note" /></Field>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-bold text-slate-800">Full guidelines sections</p>
              <button type="button" onClick={() => set('sections', [...form.sections, { heading: '', points: '' }])}
                      className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-slate-100 text-slate-700 inline-flex items-center gap-1.5">
                <Plus size={15} /> Add section
              </button>
            </div>
            {!form.sections.length && <p className="text-sm text-slate-500">No sections.</p>}
            {form.sections.map((sec, i) => (
              <div key={i} className="border border-slate-100 rounded-xl p-3 space-y-2">
                <div className="flex gap-2">
                  <input className={inputCls} placeholder="Heading" value={sec.heading} onChange={(e) => setSec(i, 'heading', e.target.value)} aria-label="Section heading" />
                  <button type="button" aria-label="Remove section" onClick={() => set('sections', form.sections.filter((_, j) => j !== i))}
                          className="shrink-0 w-11 min-h-11 rounded-xl bg-red-50 text-red-700 inline-flex items-center justify-center">
                    <Trash2 size={16} />
                  </button>
                </div>
                <textarea className={`${inputCls} py-2`} rows={4} placeholder="Points, one per line" value={sec.points}
                          onChange={(e) => setSec(i, 'points', e.target.value)} aria-label="Section points" />
              </div>
            ))}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            {current?.custom && (
              <button type="button" onClick={reset}
                      className="min-h-11 px-4 rounded-xl text-sm font-semibold bg-slate-100 text-slate-700 inline-flex items-center justify-center gap-1.5">
                <RotateCcw size={16} /> Back to built-in text
              </button>
            )}
            <button type="button" disabled={saving} onClick={save}
                    className="min-h-11 px-5 rounded-xl text-sm font-semibold bg-violet-600 text-white inline-flex items-center justify-center gap-1.5 disabled:opacity-50">
              <Save size={16} /> Save
            </button>
          </div>
        </div>
      )}
    </PageShell>
  );
}

function toForm(r) {
  return {
    title: r.title || '', summary: r.summary || '', note: r.note || '', steps: (r.steps || []).join('\n'),
    sections: (r.sections || []).map((s) => ({ heading: s.heading || '', points: (s.points || []).join('\n') })),
  };
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="text-xs font-semibold text-slate-600">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
    </label>
  );
}
