import React, { useState, useEffect } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { Input, Textarea, FormSelect } from '../components/ui/index.jsx';
import { Plus, Pencil, Trash2, GraduationCap, Calendar, ExternalLink, Eye, X } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, StatusBadge, ActionBtn, ConfirmModal } from '../components/ui/TableComponents';

// STATUSES comes from master data (masters.college_application_status).
// PRIORITIES comes from master data (masters.application_priority).

const PRIORITY_DOT = { low: 'bg-slate-300', medium: 'bg-yellow-400', high: 'bg-red-500' };

const EMPTY = {
  college_name: '', program_name: '', exam_type: '', application_date: '',
  deadline_date: '', status: 'planning', priority: 'medium', notes: '', application_url: '',
};

function ApplicationDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'College', value: a.college_name || '—' },
    { label: 'Program', value: a.program_name || '—' },
    { label: 'Exam', value: a.exam_type || '—' },
    { label: 'Applied Date', value: a.application_date || '—' },
    { label: 'Deadline', value: a.deadline_date || '—' },
    { label: 'Priority', value: a.priority || '—' },
    { label: 'Status', value: (a.status || '—').replace('_', ' ') },
    { label: 'Notes', value: a.notes || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Application Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function CollegeApplicationTracker() {
  const { lists } = useMasters(['application_priority', 'college_application_status']);
  const STATUSES = [...(lists.college_application_status || []).map(o => o.value)];
  const PRIORITIES = [...(lists.application_priority || []).map(o => o.value)];
  const [apps,         setApps]         = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [modal,        setModal]        = useState(false);
  const [form,         setForm]         = useState(EMPTY);
  const [editId,       setEditId]       = useState(null);
  const [saving,       setSaving]       = useState(false);
  const [filterStatus, setFilterStatus] = useState('all');
  const [view,         setView]         = useState(null);
  const [confirm,      setConfirm]      = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/college-applications/');
      if (data.bool) setApps(data.response.applications || []);
    } catch {}
    setLoading(false);
  };

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal(true); };
  const openEdit = (a) => {
    setForm({
      college_name: a.college_name || '', program_name: a.program_name || '',
      exam_type: a.exam_type || '', application_date: a.application_date || '',
      deadline_date: a.deadline_date || '', status: a.status || 'planning',
      priority: a.priority || 'medium', notes: a.notes || '', application_url: a.application_url || '',
    });
    setEditId(a.id); setModal(true);
  };

  const save = async () => {
    if (!form.college_name.trim()) return alert('College name is required.');
    setSaving(true);
    try {
      const payload = { ...form };
      if (!payload.application_date) delete payload.application_date;
      if (!payload.deadline_date) delete payload.deadline_date;
      const { data } = editId
        ? await api.put(`/college-applications/${editId}`, payload)
        : await api.post('/college-applications/', payload);
      if (data.bool) { setModal(false); load(); }
      else alert(data.response?.message || 'Error');
    } catch { alert('Save failed.'); }
    setSaving(false);
  };

  const remove = async (id) => {
    try { await api.delete(`/college-applications/${id}`); load(); } catch {}
    setConfirm(null);
  };

  const filtered = filterStatus === 'all' ? apps : apps.filter(a => a.status === filterStatus);
  const stats = STATUSES.reduce((acc, s) => ({ ...acc, [s]: apps.filter(a => a.status === s).length }), {});

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500 flex items-center justify-center">
            <GraduationCap size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">College Application Tracker</h1>
            <p className="text-sm text-slate-500">Track all your college applications in one place</p>
          </div>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors">
          <Plus size={16} /> Add Application
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['applied', 'Applied'], ['accepted', 'Accepted'], ['interview', 'Interview'], ['rejected', 'Rejected']].map(([s, l]) => (
          <div key={s} className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-2xl font-black text-slate-900">{stats[s] || 0}</p>
            <p className="text-xs text-slate-500 mt-0.5">{l}</p>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterStatus === s ? 'bg-blue-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>College</Th>
                <Th>Program</Th>
                <Th>Exam</Th>
                <Th>Applied Date</Th>
                <Th>Deadline</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={9} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {filtered.map((a, idx) => (
                  <tr key={a.id} onClick={() => setView(a)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>{idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View application" color="indigo" onClick={() => setView(a)} />
                        <ActionBtn icon={Pencil} tooltip="Edit application" color="blue" onClick={() => openEdit(a)} />
                        {a.application_url && (
                          <ActionBtn icon={ExternalLink} tooltip="Open application link" color="indigo"
                            onClick={() => window.open(a.application_url, '_blank')} />
                        )}
                        <ActionBtn icon={Trash2} tooltip="Delete application" color="red" onClick={() => setConfirm(a)} />
                      </div>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full shrink-0 ${PRIORITY_DOT[a.priority] || 'bg-slate-300'}`} />
                        <span className="font-semibold text-slate-900 truncate max-w-xs">{a.college_name}</span>
                      </div>
                    </Td>
                    <Td><span className="text-slate-600 text-xs">{a.program_name || '—'}</span></Td>
                    <Td><span className="text-slate-500 text-xs">{a.exam_type || '—'}</span></Td>
                    <Td>
                      {a.application_date && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Calendar size={11} />{a.application_date}
                        </span>
                      )}
                    </Td>
                    <Td>
                      {a.deadline_date && (
                        <span className="text-xs text-amber-600 flex items-center gap-1">
                          <Calendar size={11} />{a.deadline_date}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className={`text-xs font-semibold capitalize px-2 py-0.5 rounded-full
                        ${a.priority === 'high' ? 'bg-red-50 text-red-600' : a.priority === 'medium' ? 'bg-yellow-50 text-yellow-600' : 'bg-slate-100 text-slate-500'}`}>
                        {a.priority}
                      </span>
                    </Td>
                    <Td><StatusBadge status={a.status} label={(a.status || '').replace('_', ' ')} /></Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && filtered.length === 0 && (
          <EmptyState icon={GraduationCap} message="No applications yet" sub="Click 'Add Application' to get started" />
        )}
      </TableShell>

      {/* Add/Edit Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editId ? 'Edit Application' : 'Add Application'}</h2>
            <div className="grid gap-3">
              <Input label="College name" required placeholder="e.g. VIT Vellore"
                value={form.college_name} onChange={e => setForm(f => ({ ...f, college_name: e.target.value }))} />
              <Input label="Program / course" placeholder="e.g. B.Tech Computer Science"
                value={form.program_name} onChange={e => setForm(f => ({ ...f, program_name: e.target.value }))} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Exam type" placeholder="e.g. JEE Main, CAT"
                  value={form.exam_type} onChange={e => setForm(f => ({ ...f, exam_type: e.target.value }))} />
                <FormSelect searchType="application_priority" label="Priority" clearable={false}
                  value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v }))}
                  options={PRIORITIES} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Application date" type="date"
                  value={form.application_date} onChange={e => setForm(f => ({ ...f, application_date: e.target.value }))} />
                <Input label="Deadline" type="date"
                  value={form.deadline_date} onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
              </div>
              <FormSelect searchType="college_application_status" label="Status" clearable={false}
                value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))}
                options={STATUSES.map(s => ({ value: s, label: s.replace('_', ' ') }))} />
              <Input label="Application URL" type="url" placeholder="https://admissions.vit.ac.in/apply"
                value={form.application_url} onChange={e => setForm(f => ({ ...f, application_url: e.target.value }))} />
              <Textarea label="Notes" rows={2} placeholder="Anything to remember — documents needed, fee paid, contact person"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-blue-500 text-white rounded-xl text-sm font-medium hover:bg-blue-600 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view && <ApplicationDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}

      {confirm && (
        <ConfirmModal
          message="Delete this application?"
          detail={confirm.college_name}
          danger
          confirmLabel="Delete"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
