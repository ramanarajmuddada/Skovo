import React, { useState, useEffect } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { Input, Textarea, FormSelect } from '../components/ui/index.jsx';
import { PenTool, Plus, Trash2, Save, ArrowLeft, FileCheck, Eye, Pencil, X } from 'lucide-react';
import { Th, Td, TableShell, EmptyState, StatusBadge, ActionBtn, ConfirmModal } from '../components/ui/TableComponents';

// DOC_TYPES comes from master data (masters.sop_doc_type).
const DOC_TYPE_LABEL = { sop: 'Statement of Purpose', lor: 'Letter of Recommendation', personal_statement: 'Personal Statement', motivation_letter: 'Motivation Letter' };
const EMPTY = { title: '', doc_type: 'sop', target_institution: '', target_program: '', content: '', status: 'draft' };

function DocDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Type', value: DOC_TYPE_LABEL[a.doc_type] || a.doc_type || '—' },
    { label: 'Institution', value: a.target_institution || '—' },
    { label: 'Program', value: a.target_program || '—' },
    { label: 'Status', value: a.status || '—' },
    { label: 'Words', value: a.word_count || 0 },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Document Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 flex gap-3">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

export default function SOPBuilder() {
  const { lists } = useMasters(['sop_doc_type', 'sop_status']);
  const DOC_TYPES = [...(lists.sop_doc_type || []).map(o => o.value)];
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { loadDocs(); }, []);

  const loadDocs = async () => {
    try {
      const { data } = await api.get('/sop-builder/');
      if (data.bool) setDocs(data.response.documents || []);
    } catch {}
    setLoading(false);
  };

  const openDoc = async (d) => {
    try {
      const { data } = await api.get(`/sop-builder/${d.id}`);
      if (data.bool) { setForm(data.response); setEditing(d.id); }
    } catch {}
  };

  const save = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    setSaving(true);
    try {
      const { data } = editing === 'new'
        ? await api.post('/sop-builder/', form)
        : await api.put(`/sop-builder/${editing}`, form);
      if (data.bool) {
        if (editing === 'new') setEditing(null);
        loadDocs();
      }
    } catch {}
    setSaving(false);
  };

  const remove = async (id) => {
    try { await api.delete(`/sop-builder/${id}`); loadDocs(); } catch {}
    setConfirm(null);
  };

  const wordCount = (form.content || '').split(/\s+/).filter(Boolean).length;

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;

  if (!editing) return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-violet-500 flex items-center justify-center">
            <PenTool size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">SOP / LOR Builder</h1>
            <p className="text-sm text-slate-500">Craft compelling statements and letters</p>
          </div>
        </div>
        <button onClick={() => { setForm(EMPTY); setEditing('new'); }} className="flex items-center gap-2 px-4 py-2 bg-violet-500 text-white rounded-xl text-sm font-medium hover:bg-violet-600 transition-colors">
          <Plus size={16} />New Document
        </button>
      </div>
      <TableShell>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>S.No</Th>
              <Th>Actions</Th>
              <Th>Title</Th>
              <Th>Type</Th>
              <Th>Institution</Th>
              <Th>Words</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {docs.length === 0 ? (
              <tr><td colSpan={7}><EmptyState icon={PenTool} message="No documents yet. Start writing your SOP!" /></td></tr>
            ) : docs.map((d, idx) => (
              <tr key={d.id} onClick={() => setView(d)} className="hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100">
                <Td>{idx + 1}</Td>
                <Td>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(d)} />
                    <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openDoc(d)} />
                    <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(d)} />
                  </div>
                </Td>
                <Td><span className="font-medium text-slate-900">{d.title}</span></Td>
                <Td className="text-slate-500">{DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</Td>
                <Td className="text-slate-500">{d.target_institution || '—'}</Td>
                <Td className="text-slate-500">{d.word_count || 0}</Td>
                <Td><StatusBadge status={d.status} /></Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      {view && <DocDetailModal item={view} onClose={() => setView(null)} onEdit={openDoc} />}
      {confirm && (
        <ConfirmModal
          message="Delete this document?"
          detail={confirm.title}
          danger
          confirmLabel="Delete"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => { setEditing(null); loadDocs(); }} className="p-2 text-slate-400 hover:text-slate-700 transition-colors"><ArrowLeft size={18} /></button>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            placeholder="Untitled document — give it a name"
            className="text-lg font-bold text-slate-900 border-none outline-none bg-transparent min-w-0 flex-1" />
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-400 whitespace-nowrap">{wordCount} words</span>
          <FormSelect searchType="sop_status"
            className="w-36 shrink-0"
            value={form.status}
            onChange={v => setForm(f => ({ ...f, status: v }))}
            options={lists.sop_status || []}
            clearable={false}
          />
          <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-violet-500 text-white rounded-xl text-sm font-medium hover:bg-violet-600 transition-colors disabled:opacity-50">
            <Save size={15} />{saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormSelect searchType="sop_doc_type"
          label="Document Type" required
          value={form.doc_type}
          onChange={v => setForm(f => ({ ...f, doc_type: v }))}
          options={DOC_TYPES.map(t => ({ value: t, label: DOC_TYPE_LABEL[t] }))}
          placeholder="What are you writing?"
          clearable={false}
        />
        <Input label="Target Institution" placeholder="e.g. IIM Bangalore"
          value={form.target_institution}
          onChange={e => setForm(f => ({ ...f, target_institution: e.target.value }))} />
        <Input label="Target Program" placeholder="e.g. MBA, M.Tech CSE"
          value={form.target_program}
          onChange={e => setForm(f => ({ ...f, target_program: e.target.value }))} />
      </div>

      {/* Editor */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-2 border-b border-slate-100 flex items-center gap-2 text-xs text-slate-400">
          <FileCheck size={13} />
          <span>Content</span>
          <span className="ml-auto">{wordCount} / 1000 words recommended</span>
          <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden ml-2">
            <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${Math.min(100, (wordCount / 1000) * 100)}%` }} />
          </div>
        </div>
        <textarea value={form.content} onChange={e => setForm(f => ({ ...f, content: e.target.value }))} rows={20}
          placeholder={`Start writing your ${DOC_TYPE_LABEL[form.doc_type] || 'document'}…\n\nTip: Begin with why you're passionate about the field, then describe your journey, achievements, and future goals.`}
          className="w-full px-6 py-4 text-sm text-slate-800 leading-relaxed resize-none focus:outline-none" />
      </div>
    </div>
  );
}
