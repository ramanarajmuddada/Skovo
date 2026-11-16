import React, { useEffect, useState, useCallback } from 'react';
import { useMasters } from '../../hooks/useMasters';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import {
  BarChart2, Plus, Pencil, Trash2, X, Check,
  Filter, Eye,
} from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

function RankDetailModal({ item: a, onClose, onEdit }) {
  const { lists } = useMasters(['rank_data_exam']);
  const EXAMS = [...(lists.rank_data_exam || []).map(o => o.value)];
  if (!a) return null;
  const rows = [
    { label: 'Exam Type', value: a.exam_type || '—' },
    { label: 'Year', value: a.year || '—' },
    { label: 'Marks Obtained', value: a.marks_obtained != null ? a.marks_obtained.toLocaleString() : '—' },
    { label: 'Total Marks', value: a.total_marks != null ? a.total_marks.toLocaleString() : '—' },
    { label: 'Percentage', value: a.marks_percentage != null ? `${a.marks_percentage}%` : '—' },
    { label: 'Rank Obtained', value: a.rank_obtained != null ? a.rank_obtained.toLocaleString() : '—' },
    { label: 'Category', value: a.category || '—' },
    { label: 'State', value: a.state || '—' },
    { label: 'Data Source', value: a.data_source || '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Rank Record Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-start justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

// EXAMS comes from master data (masters.rank_data_exam).
const CUR_YEAR  = new Date().getFullYear();
const YEARS     = Array.from({ length: 6 }, (_, i) => CUR_YEAR - i);

const schema = z.object({
  exam_type:        z.string().min(1, 'Exam type is required'),
  year:             z.coerce.number().int().min(2000).max(CUR_YEAR),
  marks_obtained:   z.coerce.number().min(0, 'Marks must be ≥ 0'),
  total_marks:      z.coerce.number().min(0).optional(),
  marks_percentage: z.coerce.number().min(0).max(100).optional(),
  rank_obtained:    z.coerce.number().int().min(1, 'Rank must be ≥ 1'),
  category:         z.string().optional(),
  state:            z.string().optional(),
  data_source:      z.string().optional(),
});

const EMPTY = {
  exam_type: 'EAMCET', year: CUR_YEAR,
  marks_obtained: '', total_marks: '', marks_percentage: '',
  rank_obtained: '', category: 'OC', state: 'Andhra Pradesh', data_source: '',
};

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}

/* Local reimplementation of the shared field — now just forwards to it. */
function Sel(props) {
  return <FormSelect {...props} />;
}

function Inp({ label, required, value, onChange, placeholder, type = 'text', error }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full px-3 py-2 rounded-xl text-sm border focus:outline-none ${error ? 'border-red-400 bg-red-50' : 'border-slate-200'}`} />
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

function Modal({ row, onClose, onSave, saving }) {
  const { lists } = useMasters(['rank_data_exam']);
  const EXAMS = [...(lists.rank_data_exam || []).map(o => o.value)];
  const isEdit = !!row?.id;
  const [form, setForm]     = useState(isEdit ? { ...row } : { ...EMPTY });
  const [errors, setErrors] = useState({});

  const sf = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const handleSave = () => {
    const result = schema.safeParse(form);
    if (!result.success) {
      const fe = {};
      result.error.issues.forEach(i => { fe[i.path[0]] = i.message; });
      setErrors(fe);
      return;
    }
    onSave(result.data);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} className="text-blue-600" />
            <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Rank Record' : 'Add Rank Record'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={16} /></button>
        </div>

        <div className="p-6 grid grid-cols-2 gap-4">
          <Sel label="Exam Type" required value={form.exam_type} onChange={v => sf('exam_type', v)} options={EXAMS} error={errors.exam_type} />
          <Sel label="Year" required value={form.year} onChange={v => sf('year', Number(v))} options={YEARS.map(y => ({ value: y, label: String(y) }))} error={errors.year} />
          <Inp label="Marks Obtained" required type="number" value={form.marks_obtained} onChange={v => sf('marks_obtained', v)} placeholder="e.g. 145" error={errors.marks_obtained} />
          <Inp label="Total Marks" type="number" value={form.total_marks} onChange={v => sf('total_marks', v)} placeholder="e.g. 160" error={errors.total_marks} />
          <Inp label="Marks Percentage" type="number" value={form.marks_percentage} onChange={v => sf('marks_percentage', v)} placeholder="e.g. 90.6" error={errors.marks_percentage} />
          <Inp label="Rank Obtained" required type="number" value={form.rank_obtained} onChange={v => sf('rank_obtained', v)} placeholder="e.g. 1250" error={errors.rank_obtained} />
          <Inp label="Category" value={form.category} onChange={v => sf('category', v)} placeholder="e.g. OC, BC, SC, ST" error={errors.category} />
          <Inp label="State" value={form.state} onChange={v => sf('state', v)} placeholder="e.g. Andhra Pradesh" error={errors.state} />
          <Inp label="Data Source" value={form.data_source} onChange={v => sf('data_source', v)} placeholder="e.g. Official APEAMCET 2024" error={errors.data_source} />
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {saving ? 'Saving…' : isEdit ? <><Check size={15} /> Update</> : <><Plus size={15} /> Add Record</>}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCGRankData() {
  const { lists } = useMasters(['rank_data_exam']);
  const EXAMS = [...(lists.rank_data_exam || []).map(o => o.value)];
  const [rows, setRows]           = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [filterExam, setFilterExam] = useState('');
  const [filterYear, setFilterYear] = useState('');
  const [loading, setLoading]     = useState(true);
  const [modal, setModal]         = useState(null);
  const [view, setView]           = useState(null);
  const [confirm, setConfirm]     = useState(null);
  const [saving, setSaving]       = useState(false);
  const [toast, setToast]         = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1) => {
    setLoading(true);
    const params = { page, per_page: 25 };
    if (filterExam) params.exam_type = filterExam;
    if (filterYear) params.year      = filterYear;
    api.get('/skovo-platform-panel-admin/cg/rank-data', params)
      .then(({ data }) => {
        if (data.bool) { setRows(data.response.records || []); setPagination(data.pagination || {}); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterExam, filterYear]);

  useEffect(() => {
    load(1);
  }, []);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const isEdit = modal?.id;
      const res = isEdit
        ? await api.put(`/skovo-platform-panel-admin/cg/rank-data/${modal.id}`, form)
        : await api.post('/skovo-platform-panel-admin/cg/rank-data', form);
      if (!res.data.bool) { showToast(res.data.response?.message || 'Failed', false); return; }
      showToast(isEdit ? 'Record updated!' : 'Record added!');
      setModal(null);
      load(pagination.page);
    } catch { showToast('Connection error', false); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/rank-data/${id}`);
      if (data.bool) { showToast('Deleted'); load(pagination.page); }
      else showToast('Failed', false);
    } catch { showToast('Connection error', false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {modal !== null && (
        <Modal
          row={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <BarChart2 size={24} className="text-blue-600" /> CG Rank Data
          </h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total || 0} rank records — marks &amp; rank data for rank prediction</p>
        </div>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-all">
          <Plus size={16} /> Add Record
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-5">
        <FormSelect searchType="rank_data_exam"
          value={filterExam}
          onChange={v => { setFilterExam(v); }}
          options={EXAMS.map(e => ({ value: e, label: e }))}
          placeholder="All Exams" />
        <FormSelect
          value={filterYear}
          onChange={v => setFilterYear(v)}
          options={YEARS.map(y => ({ value: y, label: y }))}
          placeholder="All Years" />
        <button onClick={() => load(1)}
          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
          <Filter size={14} className="inline mr-1.5" />Filter
        </button>
      </div>

      {/* Table */}
      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Exam Type</Th>
                <Th>Year</Th>
                <Th>Marks</Th>
                <Th>Total</Th>
                <Th>%</Th>
                <Th>Rank</Th>
                <Th>Category</Th>
                <Th>State</Th>
                <Th>Source</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={11} />
            ) : rows.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={11}>
                    <EmptyState icon={BarChart2} message="No rank records found" sub="Add marks-to-rank data for rank prediction" />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {rows.map((r, idx) => (
                  <tr key={r.id} onClick={() => setView(r)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-slate-400 text-xs">{((pagination.page || 1) - 1) * 25 + idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setView(r)} />
                        <ActionBtn icon={Pencil} tooltip="Edit record" color="blue" onClick={() => setModal(r)} />
                        <ActionBtn icon={Trash2} tooltip="Delete record" color="red" onClick={() => setConfirm(r)} />
                      </div>
                    </Td>
                    <Td className="text-slate-600 whitespace-nowrap">{r.exam_type}</Td>
                    <Td className="font-semibold text-slate-800">{r.year}</Td>
                    <Td className="font-semibold text-slate-800">{r.marks_obtained != null ? r.marks_obtained.toLocaleString() : '—'}</Td>
                    <Td className="text-slate-500">{r.total_marks != null ? r.total_marks.toLocaleString() : '—'}</Td>
                    <Td className="text-slate-600">{r.marks_percentage != null ? `${r.marks_percentage}%` : '—'}</Td>
                    <Td className="font-bold text-blue-700">{r.rank_obtained != null ? r.rank_obtained.toLocaleString() : '—'}</Td>
                    <Td>
                      {r.category
                        ? <span className="text-xs font-semibold px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">{r.category}</span>
                        : <span className="text-slate-400">—</span>}
                    </Td>
                    <Td className="text-xs text-slate-500 whitespace-nowrap">{r.state || '—'}</Td>
                    <Td className="text-xs text-slate-500 truncate max-w-36">{r.data_source || '—'}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && rows.length > 0 && (
          <Pagination
            page={pagination.page || 1}
            pages={pagination.pages || 1}
            total={pagination.total || rows.length}
            perPage={25}
            onPage={(p) => load(p)}
            onPerPage={() => {}}
          />
        )}
      </TableShell>

      {view && <RankDetailModal item={view} onClose={() => setView(null)} onEdit={(r) => setModal(r)} />}
      {confirm && <ConfirmModal message={`Delete this rank record?`} detail={`${confirm.exam_type} ${confirm.year} • ${confirm.marks_obtained} marks → rank ${confirm.rank_obtained}`} danger confirmLabel="Delete" onConfirm={() => { handleDelete(confirm.id); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
