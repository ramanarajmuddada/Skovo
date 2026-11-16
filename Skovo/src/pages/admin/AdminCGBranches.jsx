import React, { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Tag, Plus, Pencil, Trash2, X, Check, TrendingUp, Brain, Code, Globe, Building2, ChevronDown, Type, AlignLeft, IndianRupee, AlertCircle, Eye } from 'lucide-react';
import { api as publicApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';

function BranchDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const arr = v => Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—');
  const yn = v => v ? 'Yes' : 'No';
  const sal = (min, max) => min ? `₹${min}–${max} LPA` : '—';
  const rows = [
    { label: 'Code', value: a.code || '—' },
    { label: 'Name', value: a.name || '—' },
    { label: 'Category', value: a.category || '—' },
    { label: 'Demand Level', value: a.demand_level?.replace('_', ' ') || '—' },
    { label: 'AI Impact', value: a.ai_impact || '—' },
    { label: 'Difficulty', value: a.difficulty_level || '—' },
    { label: 'Work-Life', value: a.work_life_balance || '—' },
    { label: 'Salary Fresher', value: sal(a.salary_fresher_min, a.salary_fresher_max) },
    { label: 'Salary 5yr', value: sal(a.salary_5yr_min, a.salary_5yr_max) },
    { label: 'Salary 10yr', value: sal(a.salary_10yr_min, a.salary_10yr_max) },
    { label: 'Coding Required', value: yn(a.coding_required) },
    { label: 'Govt Opportunities', value: yn(a.govt_opportunities) },
    { label: 'Abroad Scope', value: yn(a.abroad_opportunities) },
    { label: 'Skills', value: arr(a.skills_required) },
    { label: 'Top Companies', value: arr(a.top_companies) },
    { label: 'Related Roles', value: arr(a.related_roles) },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Branch Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

const branchSchema = z.object({
  code: z.string().min(2, 'Branch code is required').max(10, 'Code too long'),
  name: z.string().min(3, 'Branch name must be at least 3 characters'),
});

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>{ok ? <Check size={15}/> : <X size={15}/>} {msg}</div>;
}

const empty = {
  code: '', name: '', category: 'engineering', description: '', future_scope: '',
  salary_fresher_min: '', salary_fresher_max: '', salary_5yr_min: '', salary_5yr_max: '',
  salary_10yr_min: '', salary_10yr_max: '',
  demand_level: 'high', ai_impact: 'medium', difficulty_level: 'medium', work_life_balance: 'good',
  coding_required: false, govt_opportunities: false, abroad_opportunities: false,
  skills_required: '', top_companies: '', related_roles: '',
};


function BranchModal({ branch, onClose, onSaved, dropdowns }) {
  const editing = !!branch?.id;
  const [form, setForm] = useState(editing ? {
    ...branch,
    skills_required: Array.isArray(branch.skills_required) ? branch.skills_required.join(', ') : '',
    top_companies:   Array.isArray(branch.top_companies)   ? branch.top_companies.join(', ')   : '',
    related_roles:   Array.isArray(branch.related_roles)   ? branch.related_roles.join(', ')   : '',
  } : { ...empty });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [errors, setErrors] = useState({});
  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;

  const handleSave = async () => {
    const result = branchSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true); setApiError('');
    const payload = {
      ...form,
      code: form.code.toUpperCase(),
      skills_required: form.skills_required ? form.skills_required.split(',').map(s => s.trim()).filter(Boolean) : [],
      top_companies:   form.top_companies   ? form.top_companies.split(',').map(s => s.trim()).filter(Boolean)   : [],
      related_roles:   form.related_roles   ? form.related_roles.split(',').map(s => s.trim()).filter(Boolean)   : [],
    };
    try {
      const res = editing
        ? await api.put(`/skovo-platform-panel-admin/cg/branches/${branch.id}`, payload)
        : await api.post('/skovo-platform-panel-admin/cg/branches', payload);
      if (res.data.bool) { onSaved(); onClose(); }
      else setApiError(res.data.response?.message || 'Failed.');
    } catch { setApiError('Connection error.'); }
    finally { setSaving(false); }
  };

  const opts = (type) => dropdowns[type] || [];
  const inp = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Tag size={16} style={{color:'var(--accent)'}}/>{editing ? 'Edit Branch' : 'Add Branch'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {apiError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2"><AlertCircle size={14}/>{apiError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Branch Code <span className="text-red-500">*</span></label>
              <div className="relative">
                <Tag size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                <input className={`${inp} pl-8 ${errors.code?.[0] ? 'border-red-400' : ''}`} value={form.code} onChange={e=>sf('code',e.target.value.toUpperCase())} placeholder="e.g. CSE" disabled={editing}/>
              </div>
              <Err f="code" />
            </div>
            <div>
              <label className={lbl}>Branch Name <span className="text-red-500">*</span></label>
              <div className="relative">
                <Type size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
                <input className={`${inp} pl-8 ${errors.name?.[0] ? 'border-red-400' : ''}`} value={form.name} onChange={e=>sf('name',e.target.value)} placeholder="e.g. Computer Science & Engineering"/>
              </div>
              <Err f="name" />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Category</label>
              <FormSelect searchType="branch_category" value={form.category} onChange={v=>sf('category',v)} options={opts('branch_category')} placeholder="e.g. Engineering" />
            </div>
            <div><label className={lbl}>Demand Level</label>
              <FormSelect searchType="demand_level" value={form.demand_level} onChange={v=>sf('demand_level',v)} options={opts('demand_level')} placeholder="e.g. High" />
            </div>
          </div>
          <div><label className={lbl}>Description</label><textarea className={inp} rows={2} value={form.description} onChange={e=>sf('description',e.target.value)} placeholder="Short overview of what this branch covers and its career opportunities"/></div>
          <div><label className={lbl}>Future Scope</label><textarea className={inp} rows={2} value={form.future_scope} onChange={e=>sf('future_scope',e.target.value)} placeholder="Expected demand, emerging technologies, career growth trajectory…"/></div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={lbl}>AI Impact</label>
              <FormSelect searchType="ai_impact" value={form.ai_impact} onChange={v=>sf('ai_impact',v)} options={opts('ai_impact')} placeholder="e.g. Low risk" />
            </div>
            <div><label className={lbl}>Difficulty</label>
              <FormSelect searchType="difficulty_level" value={form.difficulty_level} onChange={v=>sf('difficulty_level',v)} options={opts('difficulty_level')} placeholder="e.g. Moderate" />
            </div>
            <div><label className={lbl}>Work-Life Balance</label>
              <FormSelect searchType="work_life_balance" value={form.work_life_balance} onChange={v=>sf('work_life_balance',v)} options={opts('work_life_balance')} placeholder="e.g. Moderate" />
            </div>
          </div>

          <p className="text-xs font-bold text-slate-500 uppercase tracking-wide flex items-center gap-1.5"><IndianRupee size={12}/>Salary Range (LPA)</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[['Fresher Min','salary_fresher_min'],['Fresher Max','salary_fresher_max'],['5yr Min','salary_5yr_min'],['5yr Max','salary_5yr_max'],['10yr Min','salary_10yr_min'],['10yr Max','salary_10yr_max']].map(([label,key])=>(
              <div key={key}><label className={lbl}>{label}</label><input type="number" className={inp} value={form[key]} onChange={e=>sf(key,e.target.value)} placeholder="e.g. 6"/></div>
            ))}
          </div>

          <div className="flex gap-6">
            {[['coding_required','Coding Required'],['govt_opportunities','Govt Opportunities'],['abroad_opportunities','Abroad Opportunities']].map(([k,label])=>(
              <label key={k} className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form[k]} onChange={e=>sf(k,e.target.checked)} className="rounded"/>
                {label}
              </label>
            ))}
          </div>

          <div><label className={lbl}>Skills Required (comma separated)</label><input className={inp} value={form.skills_required} onChange={e=>sf('skills_required',e.target.value)} placeholder="Python, DSA, React, SQL"/></div>
          <div><label className={lbl}>Top Companies (comma separated)</label><input className={inp} value={form.top_companies} onChange={e=>sf('top_companies',e.target.value)} placeholder="Google, Microsoft, TCS, Infosys"/></div>
          <div><label className={lbl}>Related Job Roles (comma separated)</label><input className={inp} value={form.related_roles} onChange={e=>sf('related_roles',e.target.value)} placeholder="Software Engineer, Data Analyst"/></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>
            {saving ? 'Saving…' : editing ? 'Update' : 'Save Branch'}
          </button>
        </div>
      </div>
    </div>
  );
}

const DEMAND_COLOR = { very_high:'bg-emerald-50 text-emerald-700', high:'bg-blue-50 text-blue-700', medium:'bg-amber-50 text-amber-700', low:'bg-slate-100 text-slate-500' };

export default function AdminCGBranches() {
  const [dropdowns, setDropdowns] = useState({ branch_category: [], demand_level: [], ai_impact: [], difficulty_level: [], work_life_balance: [] });
  const [branches, setBranches] = useState([]);
  const paged = usePagedRows(branches);
  const [loading, setLoading]   = useState(true);
  const [search, setSearch]     = useState('');
  const [modal, setModal]       = useState(null);
  const [view, setView]         = useState(null);
  const [confirm, setConfirm]   = useState(null);
  const [toast, setToast]       = useState({ msg: '', ok: true });

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast({msg:'',ok:true}),3000); };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/skovo-platform-panel-admin/cg/branches', search ? {search} : {});
      if (data.bool) setBranches(data.response.branches);
    } catch {}
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => {
    load();
    publicApi.get('/auth/masters', { types: 'branch_category,demand_level,ai_impact,difficulty_level,work_life_balance' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, [load]);

  const handleDelete = async (b) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/branches/${b.id}`);
      if (data.bool) { showToast('Branch deleted.'); load(); }
      else showToast(data.response?.message || 'Failed.', false);
    } catch { showToast('Error.', false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">CG Branches</h1><p className="text-sm text-slate-500 mt-1">Manage engineering & career branches for guidance</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Branch</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[['Total',branches.length,'bg-violet-50 text-violet-600'],['High Demand',branches.filter(b=>b.demand_level==='high'||b.demand_level==='very_high').length,'bg-emerald-50 text-emerald-600'],['Coding Required',branches.filter(b=>b.coding_required).length,'bg-blue-50 text-blue-600'],['Abroad Scope',branches.filter(b=>b.abroad_opportunities).length,'bg-amber-50 text-amber-600']].map(([label,val,cls])=>(
          <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${cls}`}><Tag size={18}/></div>
            <div><p className="text-xl font-black text-slate-900">{val}</p><p className="text-xs text-slate-500 font-medium">{label}</p></div>
          </div>
        ))}
      </div>

      <div className="flex gap-3 mb-4">
        <input className="flex-1 pl-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none" placeholder="Search branches…" value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==='Enter'&&load()}/>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Code</Th>
                <Th>Branch Name</Th>
                <Th>Category</Th>
                <Th>Demand</Th>
                <Th>Ai Impact</Th>
                <Th>Salary (Fresher)</Th>
                <Th>Flags</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={9} />
            ) : branches.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9}>
                    <EmptyState icon={Tag} message="No branches yet" />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {paged.rows.map((b, idx) => (
                  <tr key={b.id} onClick={() => setView(b)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-slate-400 text-xs">{idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setView(b)} />
                        <ActionBtn icon={Pencil} tooltip="Edit branch" color="blue" onClick={() => setModal(b)} />
                        <ActionBtn icon={Trash2} tooltip="Delete branch" color="red" onClick={() => setConfirm(b)} />
                      </div>
                    </Td>
                    <Td className="font-black text-slate-700">{b.code}</Td>
                    <Td>
                      <p className="font-semibold text-slate-900 max-w-48 truncate">{b.name}</p>
                      <p className="text-xs text-slate-400 mt-0.5 truncate max-w-48">{b.description}</p>
                    </Td>
                    <Td className="text-xs text-slate-600 capitalize">{b.category}</Td>
                    <Td>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${DEMAND_COLOR[b.demand_level]||'bg-slate-100 text-slate-500'}`}>{b.demand_level?.replace('_',' ')}</span>
                    </Td>
                    <Td className="text-xs text-slate-600 capitalize">{b.ai_impact}</Td>
                    <Td className="text-xs text-slate-700">{b.salary_fresher_min ? `₹${b.salary_fresher_min}–${b.salary_fresher_max} LPA` : '—'}</Td>
                    <Td>
                      <div className="flex gap-1">
                        {b.coding_required && <span title="Coding" className="w-5 h-5 bg-blue-100 text-blue-600 rounded flex items-center justify-center"><Code size={11}/></span>}
                        {b.abroad_opportunities && <span title="Abroad" className="w-5 h-5 bg-emerald-100 text-emerald-600 rounded flex items-center justify-center"><Globe size={11}/></span>}
                        {b.govt_opportunities && <span title="Govt" className="w-5 h-5 bg-amber-100 text-amber-600 rounded flex items-center justify-center"><Building2 size={11}/></span>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && branches.length > 0 && <Pagination {...paged.bind} />}
      </TableShell>

      {(modal==='add'||(modal&&modal.id)) && (
        <BranchModal branch={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Branch saved!');load();}} dropdowns={dropdowns}/>
      )}
      {view && <BranchDetailModal item={view} onClose={() => setView(null)} onEdit={(b) => setModal(b)} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.name}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { handleDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
