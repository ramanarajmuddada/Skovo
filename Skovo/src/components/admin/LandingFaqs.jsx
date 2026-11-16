import React, { useEffect, useState } from 'react';
import { ArrowUp, ArrowDown, Pencil, Trash2, Plus, Eye, EyeOff, HelpCircle } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useToast, Button, Input, Textarea } from '../ui/index.jsx';
import { ConfirmModal, EmptyState } from '../ui/TableComponents';

const A = '/skovo-platform-panel-admin';
const Q_MAX = 300;
const A_MAX = 2000;

/* Add / edit form, used inline for both. */
function FaqForm({ initial, onSave, onCancel, saving }) {
  const [q, setQ] = useState(initial?.question || '');
  const [a, setA] = useState(initial?.answer || '');
  const [err, setErr] = useState({});
  const submit = (e) => {
    e.preventDefault();
    const next = {};
    if (!q.trim()) next.q = 'Question is required.';
    if (!a.trim()) next.a = 'Answer is required.';
    setErr(next);
    if (!Object.keys(next).length) onSave({ question: q.trim(), answer: a.trim() });
  };
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <Input label="Question" required value={q} maxLength={Q_MAX} onChange={(e) => setQ(e.target.value)}
             error={err.q} hint={`${q.length}/${Q_MAX}`} />
      <Textarea label="Answer" required rows={4} value={a} maxLength={A_MAX} onChange={(e) => setA(e.target.value)}
                error={err.a} hint={`Write {gate} to show the current Opportunity Hub score. ${a.length}/${A_MAX}`} />
      <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={saving}>{saving ? 'Saving…' : initial ? 'Save changes' : 'Add FAQ'}</Button>
      </div>
    </form>
  );
}

/** Admin › Platform settings › Landing FAQs — what the homepage FAQ shows. */
export default function LandingFaqs() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [editing, setEditing] = useState(null);   // id | 'new' | null
  const [saving, setSaving] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const load = () => adminApi.get(`${A}/landing-faqs`)
    .then(({ data }) => (data?.bool ? setRows(data.response.faqs) : toast.error(data?.response?.message || 'Could not load FAQs.')))
    .catch(() => toast.error('Could not load FAQs.'));
  useEffect(() => { load(); }, []);           // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (body) => {
    setSaving(true);
    try {
      const { data } = editing === 'new'
        ? await adminApi.post(`${A}/landing-faqs`, body)
        : await adminApi.put(`${A}/landing-faqs/${editing}`, body);
      if (data?.bool) { toast.success(data.response.message); setEditing(null); load(); }
      else toast.error(data?.response?.message || 'Could not save.');
    } finally { setSaving(false); }
  };

  const act = async (row, body, ok) => {
    const { data } = await adminApi.put(`${A}/landing-faqs/${row.id}`, body);
    if (data?.bool) { if (ok) toast.success(ok); load(); } else toast.error(data?.response?.message || 'Could not save.');
  };

  const remove = async (row) => {
    setConfirm(null);
    const { data } = await adminApi.delete(`${A}/landing-faqs/${row.id}`);
    if (data?.bool) { toast.success(data.response.message); load(); } else toast.error(data?.response?.message || 'Could not delete.');
  };

  const shown = rows?.filter((r) => r.is_active).length || 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900">Landing page FAQs</h3>
          <p className="text-xs text-slate-500">
            Shown on skovoai.com in this order. {rows ? `${shown} of ${rows.length} visible.` : ''} Hidden FAQs stay here but are not shown.
          </p>
        </div>
        {editing !== 'new' && (
          <Button onClick={() => setEditing('new')} className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5"><Plus size={15} /> Add FAQ</Button>
        )}
      </div>

      {editing === 'new' && <FaqForm onSave={save} onCancel={() => setEditing(null)} saving={saving} />}

      {!rows ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-16 rounded-2xl bg-white border border-slate-100 animate-pulse" />)}</div>
      ) : rows.length === 0 ? (
        <div className="bg-white border border-slate-200 rounded-2xl">
          <EmptyState icon={HelpCircle} message="No FAQs yet" sub="Add the first one. Until then the FAQ section is hidden on the homepage." />
        </div>
      ) : (
        <ol className="space-y-2">
          {rows.map((r, i) => (
            <li key={r.id} className={`bg-white border rounded-2xl p-4 ${r.is_active ? 'border-slate-200' : 'border-dashed border-slate-300'}`}>
              {editing === r.id ? (
                <FaqForm initial={r} onSave={save} onCancel={() => setEditing(null)} saving={saving} />
              ) : (
                <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                  <span className="w-7 h-7 shrink-0 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center">{i + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-bold break-words ${r.is_active ? 'text-slate-900' : 'text-slate-400'}`}>
                      {r.question}
                      {!r.is_active && <span className="ml-2 align-middle px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-500 text-[10px] font-bold uppercase">Hidden</span>}
                    </p>
                    <p className="text-sm text-slate-500 mt-1 line-clamp-2 break-words">{r.answer}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <IconBtn label="Move up" disabled={i === 0} onClick={() => act(r, { move: 'up' })}><ArrowUp size={15} /></IconBtn>
                    <IconBtn label="Move down" disabled={i === rows.length - 1} onClick={() => act(r, { move: 'down' })}><ArrowDown size={15} /></IconBtn>
                    <IconBtn label={r.is_active ? 'Hide' : 'Show'} onClick={() => act(r, { is_active: !r.is_active }, r.is_active ? 'Hidden from homepage.' : 'Shown on homepage.')}>
                      {r.is_active ? <EyeOff size={15} /> : <Eye size={15} />}
                    </IconBtn>
                    <IconBtn label="Edit" onClick={() => setEditing(r.id)}><Pencil size={15} /></IconBtn>
                    <IconBtn label="Delete" danger onClick={() => setConfirm(r)}><Trash2 size={15} /></IconBtn>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {confirm && (
        <ConfirmModal danger confirmLabel="Delete"
          message="Delete this FAQ?"
          detail={`"${confirm.question}" will be removed from the homepage. To keep it for later, hide it instead.`}
          onConfirm={() => remove(confirm)} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}

function IconBtn({ label, onClick, disabled, danger, children }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
            className={`w-9 h-9 rounded-lg flex items-center justify-center border border-slate-200 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${danger ? 'text-red-600 hover:bg-red-50' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-800'}`}>
      {children}
    </button>
  );
}
