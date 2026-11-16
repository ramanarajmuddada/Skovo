import React, { useState, useEffect } from 'react';
import { useMasters } from '../../hooks/useMasters';
import { adminApi, api } from '../../services/api';
import { BookOpen, Plus, Edit2, Trash2, Search, ExternalLink, Eye, X } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal } from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

function ResourceDetailModal({ item: r, onClose, onEdit }) {
  const { lists } = useMasters(['exam_resource_exam', 'exam_resource_type']);
  const EXAM_TYPES = [...(lists.exam_resource_exam || []).map(o => o.value)];
  const RESOURCE_TYPES = [...(lists.exam_resource_type || []).map(o => o.value)];
  if (!r) return null;
  const rows = [
    { label: 'Title', value: r.title || '—' },
    { label: 'Exam Type', value: r.exam_type || '—' },
    { label: 'Type', value: r.resource_type || '—' },
    { label: 'Subject', value: r.subject || '—' },
    { label: 'Access', value: r.is_free ? 'Free' : 'Premium' },
    { label: 'Status', value: r.is_active ? 'Active' : 'Inactive' },
    { label: 'Downloads', value: r.downloads || 0 },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Resource Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          {r.description && <p className="text-sm text-slate-600 mb-4">{r.description}</p>}
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
            {(r.file_url || r.external_url) && (
              <div className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">Link</span>
                <a href={r.file_url || r.external_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-teal-600 hover:underline text-right inline-flex items-center gap-1">
                  Open <ExternalLink size={12} />
                </a>
              </div>
            )}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onEdit && <button onClick={() => { onEdit(r); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// EXAM_TYPES comes from master data (masters.exam_resource_exam).
// RESOURCE_TYPES comes from master data (masters.exam_resource_type).
const EMPTY = { title: '', description: '', exam_type: '', subject: '', resource_type: 'pdf', file_url: '', external_url: '', thumbnail_url: '', tags: '', is_free: true, is_active: true };

export default function AdminExamResources() {
  const { lists } = useMasters(['exam_resource_exam', 'exam_resource_type']);
  const EXAM_TYPES = [...(lists.exam_resource_exam || []).map(o => o.value)];
  const RESOURCE_TYPES = [...(lists.exam_resource_type || []).map(o => o.value)];
  const [resources, setResources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');
  const [examFilter, setExamFilter] = useState('');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/skovo-platform-panel-admin/exam-resources');
      if (data.bool) setResources(data.response.resources || []);
    } catch {}
    setLoading(false);
  };

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal(true); };
  const openEdit = (r) => {
    setForm({ title: r.title, description: r.description || '', exam_type: r.exam_type || '',
      subject: r.subject || '', resource_type: r.resource_type, file_url: r.file_url || '',
      external_url: r.external_url || '', thumbnail_url: r.thumbnail_url || '',
      tags: (r.tags || []).join(', '), is_free: r.is_free, is_active: r.is_active });
    setEditId(r.id); setModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return alert('Title required.');
    setSaving(true);
    try {
      const tags = form.tags.split(',').map(t => t.trim()).filter(Boolean);
      const payload = { ...form, tags };
      const { data } = editId
        ? await adminApi.put(`/skovo-platform-panel-admin/exam-resources/${editId}`, payload)
        : await adminApi.post('/skovo-platform-panel-admin/exam-resources', payload);
      if (data.bool) { setModal(false); load(); }
    } catch {}
    setSaving(false);
  };

  const remove = async (r) => {
    try { await adminApi.delete(`/skovo-platform-panel-admin/exam-resources/${r.id}`); load(); } catch {}
  };

  const filtered = resources.filter(r =>
    (search === '' || r.title.toLowerCase().includes(search.toLowerCase())) &&
    (examFilter === '' || r.exam_type === examFilter)
  );

  // Client-side pagination on filtered results
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pagedResources = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen size={22} className="text-teal-500" />
          <h1 className="text-xl font-bold text-slate-900">Exam Resources</h1>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium hover:bg-teal-600 transition-colors">
          <Plus size={16} />Add Resource
        </button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="Search resources…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
        </div>
        <FormSelect searchType="exam_resource_exam"
          className="sm:w-48 shrink-0"
          value={examFilter}
          onChange={v => { setExamFilter(v); setPage(1); }}
          options={EXAM_TYPES.map(e => ({ value: e, label: e }))}
          placeholder="All Exams" />
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Title</Th>
                <Th>Exam Type</Th>
                <Th>Type</Th>
                <Th>Subject</Th>
                <Th>Access</Th>
                <Th>Status</Th>
                <Th>Downloads</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={9} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pagedResources.map((r, idx) => (
                  <tr key={r.id} onClick={() => setView(r)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(r)} />
                        <ActionBtn icon={Edit2} tooltip="Edit" color="blue" onClick={() => openEdit(r)} />
                        {(r.file_url || r.external_url) && (
                          <ActionBtn
                            icon={ExternalLink}
                            tooltip="Open resource"
                            color="violet"
                            onClick={() => window.open(r.file_url || r.external_url, '_blank', 'noreferrer')}
                          />
                        )}
                        <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(r)} />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2.5">
                        {r.thumbnail_url ? (
                          <img src={r.thumbnail_url} alt="" className="w-8 h-8 rounded-lg object-cover shrink-0" />
                        ) : (
                          <div className="w-8 h-8 rounded-lg bg-teal-50 flex items-center justify-center shrink-0">
                            <BookOpen size={14} className="text-teal-400" />
                          </div>
                        )}
                        <p className="font-semibold text-slate-900 max-w-xs truncate">{r.title}</p>
                      </div>
                    </Td>
                    <Td>
                      {r.exam_type ? (
                        <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded-full text-xs font-medium">{r.exam_type}</span>
                      ) : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td>
                      <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full text-xs">{r.resource_type}</span>
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-600">{r.subject || '—'}</span>
                    </Td>
                    <Td>
                      {r.is_free ? (
                        <span className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs font-medium">Free</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-orange-100 text-orange-600 rounded-full text-xs font-medium">Premium</span>
                      )}
                    </Td>
                    <Td>
                      {r.is_active ? (
                        <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 bg-red-50 text-red-500 rounded-full text-xs font-medium">Inactive</span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-500">{r.downloads || 0}</span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {filtered.length === 0 && !loading && (
          <EmptyState icon={BookOpen} message="No resources found. Try adjusting your search or filters." />
        )}
        <Pagination
          page={page}
          pages={pages}
          total={filtered.length}
          perPage={perPage}
          onPage={(p) => setPage(p)}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
        />
      </TableShell>

      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editId ? 'Edit Resource' : 'Add Resource'}</h2>
            <div className="space-y-3">
              <input placeholder="Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormSelect searchType="exam_resource_exam"
                  value={form.exam_type}
                  onChange={v => setForm(f => ({ ...f, exam_type: v }))}
                  options={EXAM_TYPES.map(e => ({ value: e, label: e }))}
                  placeholder="Select Exam Type" />
                <FormSelect searchType="exam_resource_type"
                  value={form.resource_type}
                  onChange={v => setForm(f => ({ ...f, resource_type: v }))}
                  options={RESOURCE_TYPES.map(t => ({ value: t, label: t }))}
                  clearable={false} />
              </div>
              <input placeholder="Subject (e.g. Physics, Quant)" value={form.subject} onChange={e => setForm(f => ({ ...f, subject: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <input placeholder="File URL" value={form.file_url} onChange={e => setForm(f => ({ ...f, file_url: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <input placeholder="External URL (YouTube, article, etc.)" value={form.external_url} onChange={e => setForm(f => ({ ...f, external_url: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <input placeholder="Thumbnail URL" value={form.thumbnail_url} onChange={e => setForm(f => ({ ...f, thumbnail_url: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <input placeholder="Tags (comma separated)" value={form.tags} onChange={e => setForm(f => ({ ...f, tags: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.is_free} onChange={e => setForm(f => ({ ...f, is_free: e.target.checked }))} className="accent-teal-500" />
                  Free Resource
                </label>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="accent-teal-500" />
                  Active
                </label>
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-teal-500 text-white rounded-xl text-sm font-medium hover:bg-teal-600 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view && <ResourceDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}

      {confirm && (
        <ConfirmModal
          message="Delete this resource?"
          detail={confirm.title}
          danger
          confirmLabel="Delete"
          onConfirm={() => { remove(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
