import React, { useState, useEffect } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { Input, Textarea, FormSelect } from '../components/ui/index.jsx';
import { Plus, Pencil, Trash2, Award, Calendar, ExternalLink, DollarSign, Eye, X } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, StatusBadge, ActionBtn, ConfirmModal } from '../components/ui/TableComponents';

// STATUSES comes from master data (masters.scholarship_status).
const EMPTY = { scholarship_name: '', provider: '', amount: '', deadline_date: '', status: 'interested', notes: '', application_url: '' };

function ScholarshipDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Scholarship', value: a.scholarship_name || '—' },
    { label: 'Provider', value: a.provider || '—' },
    { label: 'Amount', value: a.amount ? `₹${Number(a.amount).toLocaleString()}` : '—' },
    { label: 'Deadline', value: a.deadline_date || '—' },
    { label: 'Status', value: (a.status || '—').replace('_', ' ') },
    { label: 'Notes', value: a.notes || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Scholarship Details</h2>
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

export default function ScholarshipTracker() {
  const { lists } = useMasters(['scholarship_status']);
  const STATUSES = [...(lists.scholarship_status || []).map(o => o.value)];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    try {
      const { data } = await api.get('/scholarship-tracking/');
      if (data.bool) setItems(data.response.items || []);
    } catch {}
    setLoading(false);
  };

  const openAdd = () => { setForm(EMPTY); setEditId(null); setModal(true); };
  const openEdit = (i) => {
    setForm({ scholarship_name: i.scholarship_name || '', provider: i.provider || '', amount: i.amount || '',
      deadline_date: i.deadline_date || '', status: i.status || 'interested', notes: i.notes || '', application_url: i.application_url || '' });
    setEditId(i.id); setModal(true);
  };

  const save = async () => {
    if (!form.scholarship_name.trim()) return alert('Scholarship name required.');
    setSaving(true);
    try {
      // Send null (not undefined) when blank so an existing amount can be cleared on edit.
      const payload = { ...form, amount: form.amount === '' || form.amount == null ? null : parseInt(form.amount) };
      if (!payload.deadline_date) delete payload.deadline_date;
      const { data } = editId
        ? await api.put(`/scholarship-tracking/${editId}`, payload)
        : await api.post('/scholarship-tracking/', payload);
      if (data.bool) { setModal(false); load(); }
    } catch {}
    setSaving(false);
  };

  const remove = async (id) => {
    try { await api.delete(`/scholarship-tracking/${id}`); load(); } catch {}
    setConfirm(null);
  };

  const filtered = filter === 'all' ? items : items.filter(i => i.status === filter);
  const awarded = items.filter(i => i.status === 'awarded');
  const totalAwarded = awarded.reduce((s, i) => s + (i.amount || 0), 0);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-yellow-500 flex items-center justify-center">
            <Award size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Scholarship Tracker</h1>
            <p className="text-sm text-slate-500">Track all your scholarship applications</p>
          </div>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-yellow-500 text-white rounded-xl text-sm font-medium hover:bg-yellow-600 transition-colors">
          <Plus size={16} />Add Scholarship
        </button>
      </div>

      {/* Stats */}
      {awarded.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-xl p-4 flex items-center gap-3">
          <Award size={20} className="text-green-600" />
          <div>
            <p className="font-semibold text-green-800">{awarded.length} Scholarship{awarded.length > 1 ? 's' : ''} Awarded!</p>
            {totalAwarded > 0 && <p className="text-sm text-green-600">Total: ₹{totalAwarded.toLocaleString()}</p>}
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {['all', ...STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filter === s ? 'bg-yellow-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
            {s === 'all' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      {/* List */}
      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Scholarship</Th>
                <Th>Provider</Th>
                <Th>Amount</Th>
                <Th>Deadline</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={7} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {filtered.length === 0 ? (
                  <tr><td colSpan={7}><EmptyState icon={Award} message="No scholarships tracked yet" sub="Click 'Add Scholarship' to get started" /></td></tr>
                ) : filtered.map((i, idx) => (
                  <tr key={i.id} onClick={() => setView(i)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>{idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View scholarship" color="indigo" onClick={() => setView(i)} />
                        <ActionBtn icon={Pencil} tooltip="Edit scholarship" color="blue" onClick={() => openEdit(i)} />
                        {i.application_url && (
                          <ActionBtn icon={ExternalLink} tooltip="Open application link" color="indigo"
                            onClick={() => window.open(i.application_url, '_blank')} />
                        )}
                        <ActionBtn icon={Trash2} tooltip="Delete scholarship" color="red" onClick={() => setConfirm(i)} />
                      </div>
                    </Td>
                    <Td><span className="font-semibold text-slate-900 truncate max-w-xs">{i.scholarship_name}</span></Td>
                    <Td><span className="text-slate-600 text-xs">{i.provider || '—'}</span></Td>
                    <Td>
                      {i.amount ? (
                        <span className="text-xs text-slate-600 flex items-center gap-1"><DollarSign size={11} />₹{Number(i.amount).toLocaleString()}</span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </Td>
                    <Td>
                      {i.deadline_date ? (
                        <span className="text-xs text-amber-600 flex items-center gap-1"><Calendar size={11} />{i.deadline_date}</span>
                      ) : <span className="text-xs text-slate-400">—</span>}
                    </Td>
                    <Td><StatusBadge status={i.status} label={(i.status || '').replace('_', ' ')} /></Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      </TableShell>

      {/* Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editId ? 'Edit' : 'Add'} Scholarship</h2>
            <div className="space-y-3">
              <Input label="Scholarship name" required placeholder="e.g. Post Matric Scholarship"
                value={form.scholarship_name} onChange={e => setForm(f => ({ ...f, scholarship_name: e.target.value }))} />
              <Input label="Provider / organisation" placeholder="e.g. Ministry of Social Justice"
                value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))} />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="Amount (₹)" type="number" inputMode="numeric" placeholder="e.g. 50000"
                  value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
                <Input label="Deadline" type="date"
                  value={form.deadline_date} onChange={e => setForm(f => ({ ...f, deadline_date: e.target.value }))} />
              </div>
              <FormSelect searchType="scholarship_status" label="Status" clearable={false}
                value={form.status} onChange={v => setForm(f => ({ ...f, status: v }))}
                options={STATUSES.map(s => ({ value: s, label: s.replace('_', ' ') }))} />
              <Input label="Application URL" type="url" placeholder="https://scholarships.gov.in/…"
                value={form.application_url} onChange={e => setForm(f => ({ ...f, application_url: e.target.value }))} />
              <Textarea label="Notes" rows={2} placeholder="Eligibility checked? Documents still needed?"
                value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-yellow-500 text-white rounded-xl text-sm font-medium hover:bg-yellow-600 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editId ? 'Update' : 'Add'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view && <ScholarshipDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}

      {confirm && (
        <ConfirmModal
          message="Delete this scholarship?"
          detail={confirm.scholarship_name}
          danger
          confirmLabel="Delete"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
