import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { Award, Plus, Trash2, ExternalLink, Eye, Pencil, X } from 'lucide-react';
import { Th, Td, TableShell, EmptyState, ActionBtn, ConfirmModal } from '../components/ui/TableComponents';
import { FilePicker } from '../components/ui/index.jsx';

const EMPTY = { title: '', provider: '', credential_id: '', issue_date: '', expiry_date: '', certificate_url: '', skills: '' };

function CertDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Provider', value: a.provider || '—' },
    { label: 'Credential ID', value: a.credential_id || '—' },
    { label: 'Issue Date', value: a.issue_date || '—' },
    { label: 'Expiry Date', value: a.expiry_date || '—' },
    { label: 'Skills', value: (a.skills || []).join(', ') || '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Certification Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 flex gap-3">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

export default function Certifications() {
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);
  // Bumped after each successful upload so FilePicker remounts empty.
  const [uploadSeq, setUploadSeq] = useState(0);

  // Upload the certificate file from the device → the backend returns a URL.
  // Throwing lets FilePicker keep the file selected and show why it failed.
  const uploadFile = async (file, { onProgress, signal }) => {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await api.upload('/upload/', fd, { onProgress, signal });
    if (!data.bool) throw new Error(data.response?.message || 'Upload failed.');

    setForm(f => ({
      ...f,
      certificate_url: data.response.url,
      // Only fills a blank title — never overwrites one already typed.
      title: f.title || file.name.replace(/\.[^.]+$/, ''),
    }));
    setUploadSeq(n => n + 1);
  };

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/certifications/');
      if (data.bool) setCerts(data.response.certifications || []);
    } catch {}
    setLoading(false);
  };

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal(true); };
  const openEdit = (c) => {
    setForm({ title: c.title || '', provider: c.provider || '', credential_id: c.credential_id || '',
      issue_date: c.issue_date || '', expiry_date: c.expiry_date || '', certificate_url: c.certificate_url || '',
      skills: (c.skills || []).join(', ') });
    setEditId(c.id); setModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return alert('Title is required.');
    setSaving(true);
    try {
      const skills = form.skills.split(',').map(s => s.trim()).filter(Boolean);
      const payload = { ...form, skills };
      // On edit, send cleared dates as null so the backend clears them
      // (it updates only `if field in data`). On create, omit empty dates.
      if (!payload.issue_date) { if (editId) payload.issue_date = null; else delete payload.issue_date; }
      if (!payload.expiry_date) { if (editId) payload.expiry_date = null; else delete payload.expiry_date; }
      const { data } = editId
        ? await api.put(`/certifications/${editId}`, payload)
        : await api.post('/certifications/', payload);
      if (data.bool) { setModal(false); load(); }
    } catch {}
    setSaving(false);
  };

  const remove = async (id) => {
    try { await api.delete(`/certifications/${id}`); load(); } catch {}
    setConfirm(null);
  };

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center">
            <Award size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Certifications</h1>
            <p className="text-sm text-slate-500">Track your courses and certificates</p>
          </div>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors">
          <Plus size={16} />Add Certificate
        </button>
      </div>

      <TableShell>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>S.No</Th>
              <Th>Actions</Th>
              <Th>Title</Th>
              <Th>Provider</Th>
              <Th>Issue Date</Th>
              <Th>Expiry</Th>
            </tr>
          </thead>
          <tbody>
            {certs.length === 0 ? (
              <tr><td colSpan={6}><EmptyState icon={Award} message="No certifications yet. Add your first one!" /></td></tr>
            ) : certs.map((c, idx) => (
              <tr key={c.id} onClick={() => setView(c)} className="hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100">
                <Td>{idx + 1}</Td>
                <Td>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(c)} />
                    <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openEdit(c)} />
                    <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(c)} />
                    {c.certificate_url && (
                      <ActionBtn icon={ExternalLink} tooltip="Open Certificate" color="green" onClick={() => window.open(c.certificate_url, '_blank', 'noreferrer')} />
                    )}
                  </div>
                </Td>
                <Td><span className="font-medium text-slate-900">{c.title}</span></Td>
                <Td className="text-slate-500">{c.provider || '—'}</Td>
                <Td className="text-slate-500">{c.issue_date || '—'}</Td>
                <Td className="text-slate-500">{c.expiry_date || '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      {view && <CertDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {confirm && (
        <ConfirmModal
          message="Remove this certification?"
          detail={confirm.title}
          danger
          confirmLabel="Remove"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editId ? 'Edit' : 'Add'} Certification</h2>
            <div className="space-y-3">
              <input placeholder="Certificate Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
              <input placeholder="Issuing Organization" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
              <input placeholder="Credential ID" value={form.credential_id} onChange={e => setForm(f => ({ ...f, credential_id: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div><label className="text-xs text-slate-500 mb-1 block">Issue Date</label>
                  <input type="date" value={form.issue_date} onChange={e => setForm(f => ({ ...f, issue_date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" /></div>
                <div><label className="text-xs text-slate-500 mb-1 block">Expiry Date</label>
                  <input type="date" value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" /></div>
              </div>
              <input placeholder="Certificate URL" value={form.certificate_url} onChange={e => setForm(f => ({ ...f, certificate_url: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
              <FilePicker
                key={uploadSeq}
                onUpload={uploadFile}
                label="Upload certificate file"
                hint="Click to choose, or drag it here — fills the URL above"
              />
              {form.certificate_url && (
                <p className="text-xs text-emerald-600 font-medium">✓ File ready to save</p>
              )}
              <input placeholder="Skills (comma separated)" value={form.skills} onChange={e => setForm(f => ({ ...f, skills: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-emerald-500 text-white rounded-xl text-sm font-medium hover:bg-emerald-600 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
