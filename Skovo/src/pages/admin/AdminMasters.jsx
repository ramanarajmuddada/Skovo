import React, { useEffect, useState, useCallback } from 'react';
import { adminApi as api } from '../../services/api';
import { Database, Plus, Pencil, Trash2, Check, X, ToggleLeft, ToggleRight, Search } from 'lucide-react';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';
import FormSelect from '../../components/ui/FormSelect';

const TYPE_LABELS = {
  college_type:             'College Type',
  reservation_category:     'Reservation Category',
  exam_type:                'Exam Type',
  gender:                   'Gender',
  branch_code:              'Branch Code',
  degree_type:              'Degree Type',
  branch_category:          'Branch Category',
  demand_level:             'Demand Level',
  ai_impact:                'AI Impact',
  difficulty_level:         'Difficulty Level',
  work_life_balance:        'Work Life Balance',
  entrance_exam_type:       'Entrance Exam Type',
  entrance_exam_stream:     'Entrance Exam Stream',
  govt_exam_category:       'Govt Exam Category',
  competition_level:        'Competition Level',
  scholarship_type:         'Scholarship Type',
  scholarship_benefit_type: 'Scholarship Benefit Type',
  abroad_program_type:      'Abroad Program Type',
  opportunity_type:         'Opportunity Type',
  stipend_type:             'Stipend Type',
  cohort_status:            'Cohort Status',
  cohort_level:             'Cohort Level',
  opportunity_status:       'Opportunity Status',
  task_type:                'Task Type',
  task_submission_type:     'Task Submission Type',
  experience_level:         'Experience Level',
  exam_mode:                'Exam Mode',
  scholarship_mode:         'Scholarship Mode',
  indian_state:             'Indian State',
  city:                     'City',
  degree_branch:            'Degree → Branch Mapping',
};

/** "entrance_exam_TS" → "Entrance Exam TS", for types with no curated label. */
function prettyType(t) {
  return TYPE_LABELS[t] || String(t)
    .split('_')
    .map(w => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={14} /> : <X size={14} />} {msg}
    </div>
  );
}

/* ── Add Option Modal ─────────────────────────────────────────────────────── */
function AddModal({ typeName, onClose, onAdd, saving, nextOrder }) {
  const [value, setValue] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setError('');
    if (!value.trim()) { setError('Value is required'); return; }
    if (!label.trim()) { setError('Label is required'); return; }
    onAdd({ value: value.trim(), label: label.trim(), order: nextOrder });
  };

  const inp = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-slate-900 text-base">
            Add to <span style={{ color: 'var(--accent)' }}>{typeName}</span>
          </h3>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Value <span className="text-red-500">*</span></label>
            <input
              value={value} onChange={e => { setValue(e.target.value); setError(''); }} autoFocus
              placeholder="e.g. government"
              className={`${inp} ${error && !value.trim() ? 'border-red-400 bg-red-50' : ''}`}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Label <span className="text-red-500">*</span></label>
            <input
              value={label} onChange={e => { setLabel(e.target.value); setError(''); }}
              placeholder="e.g. Government"
              className={`${inp} ${error && !label.trim() ? 'border-red-400 bg-red-50' : ''}`}
            />
          </div>

          {error && <p className="text-xs text-red-500">{error}</p>}

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60 flex items-center justify-center gap-1.5"
              style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Adding…' : <><Plus size={14} /> Add</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function AdminMasters() {
  const [allMasters, setAllMasters]     = useState({});
  const [loading, setLoading]           = useState(true);
  const [selectedType, setSelectedType] = useState('college_type');
  const [toast, setToast]               = useState(null);
  const [editingId, setEditingId]       = useState(null);
  const [editValue, setEditValue]       = useState('');
  const [editLabel, setEditLabel]       = useState('');
  const [editOrder, setEditOrder]       = useState('');
  const [saving, setSaving]             = useState(false);
  const [optionSearch, setOptionSearch] = useState('');
  const [typeSearch, setTypeSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback(() => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/masters', { active_only: 'false' })
      .then(({ data }) => { if (data.bool) setAllMasters(data.response.grouped || {}); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // TYPE_LABELS only supplies nice names. The list itself comes from whatever
  // the API actually returns, so a type added by a migration — onboarding
  // categories, career interests, the state CET lists — is manageable here the
  // day it exists, instead of being invisible until someone edits this file.
  const allTypes = [...new Set([...Object.keys(TYPE_LABELS), ...Object.keys(allMasters)])]
    .sort((a, b) => prettyType(a).localeCompare(prettyType(b)));
  const rawItems   = allMasters[selectedType] || [];
  const filtered   = optionSearch.trim()
    ? rawItems.filter(i =>
        i.value.toLowerCase().includes(optionSearch.toLowerCase()) ||
        i.label.toLowerCase().includes(optionSearch.toLowerCase())
      )
    : rawItems;
  const sorted = filtered.slice().sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  const paged = usePagedRows(sorted);
  const editItem = editingId == null ? null : paged.rows.find(r => r.id === editingId);

  const handleAdd = async ({ value, label, order }) => {
    setSaving(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/masters', {
        type: selectedType,
        value,
        label,
        sort_order: order !== '' ? parseInt(order) : rawItems.length,
        is_active: true,
      });
      if (data.bool) {
        showToast('Option added');
        setShowAddModal(false);
        load();
      } else showToast(data.response?.message || 'Failed', false);
    } catch { showToast('Error', false); }
    finally { setSaving(false); }
  };

  const mobileEditRef = React.useRef(null);
  // The phone editor sits above the table; bring it into view when a row's pencil is tapped.
  useEffect(() => {
    if (editingId != null) mobileEditRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [editingId]);
  const startEdit = (item) => { setEditingId(item.id); setEditValue(item.value); setEditLabel(item.label); setEditOrder(item.sort_order ?? ''); };

  // `type` identifies which master_<type> table the option lives in — an id on
  // its own no longer locates a row now that each dropdown has its own table.
  const saveEdit = async (item) => {
    setSaving(true);
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/masters/${item.id}`, {
        type: item.type,
        value: editValue,
        label: editLabel,
        sort_order: editOrder === '' ? 0 : parseInt(editOrder) || 0,
      });
      if (data.bool) { showToast('Updated'); setEditingId(null); load(); }
      else showToast(data.response?.message || 'Failed', false);
    } catch { showToast('Error', false); }
    finally { setSaving(false); }
  };

  const toggleActive = async (item) => {
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/masters/${item.id}`, { type: item.type, is_active: !item.is_active });
      if (data.bool) { showToast(item.is_active ? 'Disabled' : 'Enabled'); load(); }
      else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.label}"?`)) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/masters/${item.id}?type=${encodeURIComponent(item.type)}`);
      if (data.bool) { showToast('Deleted'); load(); }
      else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const totalCount = Object.values(allMasters).reduce((s, arr) => s + arr.length, 0);

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />

      {showAddModal && (
        <AddModal
          typeName={prettyType(selectedType)}
          onClose={() => setShowAddModal(false)}
          onAdd={handleAdd}
          saving={saving}
          nextOrder={rawItems.length + 1}
        />
      )}

      {/* Header */}
      <div className="mb-5">
        <h1 className="text-2xl font-black text-slate-900">Masters</h1>
        {/* Counts only once loaded — "0 options" while the request is in
            flight read as "the masters are empty". */}
        <p className="text-sm text-slate-500 mt-0.5">
          {loading
            ? 'Loading dropdown options…'
            : <>Every dropdown on the platform · <span className="font-semibold text-slate-700">{allTypes.length}</span> types, <span className="font-semibold text-slate-700">{totalCount.toLocaleString('en-IN')}</span> options</>}
        </p>
      </div>

      <div className="flex gap-5 flex-col lg:flex-row">

        {/* ── Mobile: type picker. The list below would push the options
             off-screen, so on phones the type is a searchable dropdown instead. */}
        <div className="lg:hidden">
          <FormSelect
            label="Type"
            value={selectedType}
            clearable={false}
            onChange={v => { if (!v) return; setSelectedType(v); setEditingId(null); setOptionSearch(''); paged.reset(); }}
            options={allTypes.map(t => ({ value: t, label: loading ? prettyType(t) : `${prettyType(t)} (${(allMasters[t] || []).length})` }))}
          />
        </div>

        {/* ── Left: Type List ─────────────────────────────────────────── */}
        <div className="hidden lg:block lg:w-60 shrink-0">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 space-y-2">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Types</p>
              {/* 150 types: finding one by scrolling was the slow part on desktop. */}
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input value={typeSearch} onChange={(e) => setTypeSearch(e.target.value)} placeholder="Search types…"
                       aria-label="Search types"
                       className="w-full min-h-10 pl-8 pr-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-800" />
              </div>
            </div>
            <div className="divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
              {allTypes.filter(t => !typeSearch.trim()
                || prettyType(t).toLowerCase().includes(typeSearch.trim().toLowerCase())
                || t.toLowerCase().includes(typeSearch.trim().toLowerCase())).length === 0 && (
                <p className="px-4 py-3 text-sm text-slate-400">No type matches.</p>
              )}
              {allTypes.filter(t => !typeSearch.trim()
                || prettyType(t).toLowerCase().includes(typeSearch.trim().toLowerCase())
                || t.toLowerCase().includes(typeSearch.trim().toLowerCase())).map(t => {
                const count = (allMasters[t] || []).length;
                const isSelected = selectedType === t;
                return (
                  <button key={t}
                    onClick={() => { setSelectedType(t); setEditingId(null); setOptionSearch(''); paged.reset(); }}
                    className={`w-full text-left px-4 py-3 flex items-center justify-between transition-colors text-sm
                      ${isSelected ? 'font-semibold' : 'text-slate-600 hover:bg-slate-50'}`}
                    style={isSelected ? { backgroundColor: 'var(--accent-light,#ede9fe)', color: 'var(--accent)' } : {}}>
                    <span className="truncate">{prettyType(t)}</span>
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded-md ml-1 shrink-0 ${isSelected ? 'bg-white/60' : 'bg-slate-100 text-slate-500'}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Right: Options ──────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">

            {/* Toolbar: search + add button */}
            <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap sm:flex-nowrap items-center gap-3">
              <div className="relative flex-1 basis-full sm:basis-auto">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  value={optionSearch}
                  onChange={e => { setOptionSearch(e.target.value); paged.reset(); }}
                  placeholder={`Search in ${prettyType(selectedType)}…`}
                  className="w-full pl-8 pr-8 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:border-emerald-400 placeholder:text-slate-500"
                />
                {optionSearch && (
                  <button onClick={() => setOptionSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500">
                    <X size={12} />
                  </button>
                )}
              </div>
              <span className="text-xs text-slate-400 shrink-0">
                {loading ? 'Loading…' : optionSearch ? `${sorted.length} of ${rawItems.length}` : `${rawItems.length} options`}
              </span>
              <button
                onClick={() => setShowAddModal(true)}
                className="flex items-center gap-1.5 px-3.5 py-2 text-sm font-semibold text-white rounded-lg shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}>
                <Plus size={14} /> Add
              </button>
            </div>

            {/* Table */}
            {loading ? (
              <div className="divide-y">
                {Array.from({ length: 5 }).map((_, i) => <div key={i} className="px-5 py-4 h-12 animate-pulse bg-slate-50" />)}
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center py-16 text-slate-400">
                {optionSearch ? (
                  <>
                    <Search size={32} className="mb-3 opacity-30" />
                    <p className="font-semibold text-slate-500">No results for "{optionSearch}"</p>
                    <button onClick={() => setOptionSearch('')} className="mt-2 text-sm text-emerald-600 hover:underline">Clear search</button>
                  </>
                ) : (
                  <>
                    <Database size={36} className="mb-3 opacity-30" />
                    <p className="font-semibold text-slate-500">No options yet</p>
                    <button onClick={() => setShowAddModal(true)} className="mt-2 text-sm text-emerald-600 hover:underline flex items-center gap-1">
                      <Plus size={13} /> Add first option
                    </button>
                  </>
                )}
              </div>
            ) : (
              <>
              {/* Phones: four columns cannot hold the inline editor, so the
                  option being edited opens as a stacked form above the table. */}
              {editItem && (
                <div ref={mobileEditRef} className="lg:hidden px-4 py-4 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Edit option</p>
                  <div className="space-y-3">
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Value
                      <input value={editValue} onChange={e => setEditValue(e.target.value)}
                        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg font-mono text-sm normal-case font-normal focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                    </label>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Label
                      <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm normal-case font-normal focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                    </label>
                    <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">Sort order
                      <input type="number" value={editOrder} onChange={e => setEditOrder(e.target.value)} placeholder="#"
                        className="mt-1 w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm normal-case font-normal focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                    </label>
                    <div className="flex gap-2 pt-1">
                      <button onClick={() => setEditingId(null)}
                        className="flex-1 py-2.5 text-sm font-semibold text-slate-600 border border-slate-200 rounded-xl">Cancel</button>
                      <button onClick={() => saveEdit(editItem)} disabled={saving}
                        className="flex-1 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-60" style={{ backgroundColor: 'var(--accent)' }}>
                        {saving ? 'Saving…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {/* Phones: a four-column table only fits by scrolling sideways, so
                  each option is one row — label over value, actions on the right. */}
              <ul className="lg:hidden divide-y divide-slate-100">
                {paged.rows.map(item => (
                  <li key={item.id} className={`flex items-center gap-2 px-4 py-2.5 ${!item.is_active ? 'opacity-40' : ''} ${editingId === item.id ? 'bg-slate-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      {/* Wrap, don't truncate: "MPC (Maths, Physics, Chemistry)" cut
                          to "MPC (Maths,…" hides the part that tells options apart. */}
                      <p className="font-medium text-sm text-slate-800 break-words">{item.label}</p>
                      <p className="font-mono text-xs text-slate-500 break-all">{item.value}</p>
                    </div>
                    <button onClick={() => toggleActive(item)} aria-label={item.is_active ? 'Deactivate' : 'Activate'}
                      className="flex items-center gap-1 text-xs font-semibold min-h-10 px-1 shrink-0">
                      {item.is_active
                        ? <><ToggleRight size={18} className="text-emerald-500" /><span className="text-emerald-600">On</span></>
                        : <><ToggleLeft size={18} className="text-slate-400" /><span className="text-slate-400">Off</span></>}
                    </button>
                    <button onClick={() => startEdit(item)} aria-label="Edit" className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-blue-600 rounded-lg shrink-0"><Pencil size={14} /></button>
                    <button onClick={() => handleDelete(item)} aria-label="Delete" className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-red-600 rounded-lg shrink-0"><Trash2 size={14} /></button>
                  </li>
                ))}
              </ul>
              <div className="hidden lg:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Value</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide">Label</th>
                    <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wide w-20">Status</th>
                    <th className="px-4 py-3 w-20" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {paged.rows.map(item => (
                    <tr key={item.id} className={`hover:bg-slate-50 transition-colors ${!item.is_active ? 'opacity-40' : ''}`}>
                      <td className="px-4 py-3">
                        {editingId === item.id ? (
                          <input value={editValue} onChange={e => setEditValue(e.target.value)} autoFocus
                            className="w-full px-2 py-1.5 border border-slate-200 rounded-lg font-mono text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                        ) : (
                          <span className="font-mono text-xs text-slate-600">{item.value}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {editingId === item.id ? (
                          <div className="flex items-center gap-2">
                            <input value={editLabel} onChange={e => setEditLabel(e.target.value)}
                              className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                            <input type="number" value={editOrder} onChange={e => setEditOrder(e.target.value)}
                              title="Sort order" placeholder="#"
                              className="w-16 px-2 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-400" />
                          </div>
                        ) : (
                          <span className="font-medium text-slate-800">{item.label}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button onClick={() => toggleActive(item)} className="flex items-center gap-1 text-xs font-semibold">
                          {item.is_active
                            ? <><ToggleRight size={16} className="text-emerald-500" /><span className="text-emerald-600">Active</span></>
                            : <><ToggleLeft size={16} className="text-slate-400" /><span className="text-slate-400">Off</span></>}
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1 justify-end">
                          {editingId === item.id ? (
                            <>
                              <button onClick={() => saveEdit(item)} disabled={saving} className="p-1.5 text-emerald-600 hover:bg-emerald-50 rounded-lg"><Check size={14} /></button>
                              <button onClick={() => setEditingId(null)} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-lg"><X size={14} /></button>
                            </>
                          ) : (
                            <>
                              <button onClick={() => startEdit(item)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={14} /></button>
                              <button onClick={() => handleDelete(item)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14} /></button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
              {sorted.length > 0 && <Pagination {...paged.bind} />}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
