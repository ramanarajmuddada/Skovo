import React, { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Globe, Plus, Pencil, Trash2, X, Check, ChevronDown, AlertCircle, Eye } from 'lucide-react';
import { api as publicApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';
import { useMasters } from '../../hooks/useMasters';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';

function AbroadDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const arr = v => Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—');
  const money = v => v ? `$${Number(v).toLocaleString()}` : '—';
  const rows = [
    { label: 'Country', value: a.country || '—' },
    { label: 'University', value: a.university_name || '(All universities)' },
    { label: 'Program Type', value: a.program_type || '—' },
    { label: 'Intake Season', value: a.intake_season || '—' },
    { label: 'Min GRE', value: a.min_gre_score || '—' },
    { label: 'Min IELTS', value: a.min_ielts_score || '—' },
    { label: 'Min TOEFL', value: a.min_toefl_score || '—' },
    { label: 'Min GPA', value: a.min_gpa || '—' },
    { label: 'Tuition/yr', value: money(a.tuition_per_year_usd) },
    { label: 'Living Cost/yr', value: money(a.living_cost_per_year_usd) },
    { label: 'Duration', value: a.duration_years ? `${a.duration_years} yrs` : '—' },
    { label: 'Avg Salary', value: money(a.avg_salary_after_ms_usd) },
    { label: 'Scholarship', value: a.scholarship_available ? 'Yes' : 'No' },
    { label: 'Scholarships', value: arr(a.popular_scholarships) },
    { label: 'Best For', value: arr(a.best_for_branches) },
    { label: 'Required Exams', value: arr(a.required_exams) },
    { label: 'Application Deadline', value: a.application_deadline || '—' },
    { label: 'Status', value: a.is_active !== false ? 'Active' : 'Inactive' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Program Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

const abroadSchema = z.object({
  country:              z.string().min(1, 'Country is required'),
  program_type:         z.string().min(1, 'Program type is required'),
  intake_season:        z.string().min(1, 'Intake season is required'),
  visa_guidance:        z.string().min(1, 'Visa guidance is required'),
  application_process:  z.string().min(1, 'Application process is required'),
  application_deadline: z.string().min(1, 'Application deadline is required'),
});

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

const empty = { country:'USA', university_name:'', program_type:'MS', intake_season:'Fall', min_gre_score:'', min_ielts_score:'', min_toefl_score:'', min_gpa:'', tuition_per_year_usd:'', living_cost_per_year_usd:'', scholarship_available:false, scholarship_info:'', duration_years:'2', language_of_instruction:'English', visa_type:'F-1', job_opportunities:'', pr_opportunities:'', avg_salary_after_ms_usd:'', visa_guidance:'', application_process:'', application_deadline:'', best_for_branches:'', popular_scholarships:'', is_active:true };


function AbroadModal({ item, onClose, onSaved, dropdowns }) {
  const { lists } = useMasters(['abroad_intake', 'active_status']);
  const editing = !!item?.id;
  const [form, setForm] = useState(editing?{...item, best_for_branches: Array.isArray(item.best_for_branches)?item.best_for_branches.join(', '):'', popular_scholarships: Array.isArray(item.popular_scholarships)?item.popular_scholarships.join(', '):'', required_exams: Array.isArray(item.required_exams)?item.required_exams.join(', '):'', intake_season: item.intake_season||'', pr_opportunities: item.pr_opportunities||'', application_deadline: item.application_deadline||'', is_active: item.is_active !== false}:{...empty, required_exams:''});
  const [saving, setSaving]=useState(false);
  const [apiError, setApiError]=useState('');
  const [errors, setErrors]=useState({});
  const sf=(k,v)=>{ setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:undefined})); };
  const opts = (type) => dropdowns[type] || [];
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;

  const handleSave=async()=>{
    const result = abroadSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true);setApiError('');
    const toArr=s=>s?s.split(',').map(x=>x.trim()).filter(Boolean):[];
    const payload={...form,best_for_branches:toArr(form.best_for_branches),popular_scholarships:toArr(form.popular_scholarships),required_exams:toArr(form.required_exams)};
    try{const res=editing?await api.put(`/skovo-platform-panel-admin/cg/abroad/${item.id}`,payload):await api.post('/skovo-platform-panel-admin/cg/abroad',payload);if(res.data.bool){onSaved();onClose();}else setApiError(res.data.response?.message||'Failed.');}catch{setApiError('Error.');}finally{setSaving(false);}
  };

  const inp='w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl='block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Globe size={16} style={{color:'var(--accent)'}}/>{editing?'Edit Program':'Add Abroad Program'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {apiError&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{apiError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Country <span className="text-red-500">*</span></label>
              <input className={`${inp} ${errors.country?'border-red-400':''}`} value={form.country} onChange={e=>sf('country',e.target.value)} placeholder="USA"/>
              <Err f="country"/>
            </div>
            <div>
              <label className={lbl}>Program Type <span className="text-red-500">*</span></label>
              <FormSelect searchType="abroad_program_type" value={form.program_type} onChange={v=>sf('program_type',v)} options={opts('abroad_program_type')} placeholder="e.g. MS, MBA" required />
              <Err f="program_type"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>University Name <span className="text-slate-400 font-normal">(optional)</span></label><input className={inp} value={form.university_name} onChange={e=>sf('university_name',e.target.value)} placeholder="MIT, Stanford (leave blank for country-level)"/></div>
            <div>
              <label className={lbl}>Intake Season <span className="text-red-500">*</span></label>
              <FormSelect searchType="abroad_intake" value={form.intake_season} onChange={v=>sf('intake_season',v)} required
                invalid={Boolean(errors.intake_season)} placeholder="e.g. Fall"
                options={lists.abroad_intake || []} />
              <Err f="intake_season"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={lbl}>Min GRE</label><input type="number" className={inp} value={form.min_gre_score} onChange={e=>sf('min_gre_score',e.target.value)} placeholder="310"/></div>
            <div><label className={lbl}>Min IELTS</label><input type="number" step="0.5" className={inp} value={form.min_ielts_score} onChange={e=>sf('min_ielts_score',e.target.value)} placeholder="6.5"/></div>
            <div><label className={lbl}>Min TOEFL</label><input type="number" className={inp} value={form.min_toefl_score} onChange={e=>sf('min_toefl_score',e.target.value)} placeholder="90"/></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div><label className={lbl}>Min GPA</label><input type="number" step="0.1" className={inp} value={form.min_gpa} onChange={e=>sf('min_gpa',e.target.value)} placeholder="3.0"/></div>
            <div><label className={lbl}>Tuition/yr (USD)</label><input type="number" className={inp} value={form.tuition_per_year_usd} onChange={e=>sf('tuition_per_year_usd',e.target.value)}/></div>
            <div><label className={lbl}>Living Cost/yr (USD)</label><input type="number" className={inp} value={form.living_cost_per_year_usd} onChange={e=>sf('living_cost_per_year_usd',e.target.value)}/></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Duration (years)</label><input type="number" step="0.5" className={inp} value={form.duration_years} onChange={e=>sf('duration_years',e.target.value)}/></div>
            <div><label className={lbl}>Avg Salary after MS (USD/yr)</label><input type="number" className={inp} value={form.avg_salary_after_ms_usd} onChange={e=>sf('avg_salary_after_ms_usd',e.target.value)} placeholder="80000"/></div>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.scholarship_available} onChange={e=>sf('scholarship_available',e.target.checked)} className="rounded"/> Scholarship Available</label>
          {form.scholarship_available&&<div><label className={lbl}>Scholarship Info</label><textarea className={inp} rows={2} value={form.scholarship_info} onChange={e=>sf('scholarship_info',e.target.value)}/></div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div><label className={lbl}>Language of Instruction</label><input className={inp} value={form.language_of_instruction} onChange={e=>sf('language_of_instruction',e.target.value)} placeholder="English"/></div>
            <div><label className={lbl}>Visa Type</label><input className={inp} value={form.visa_type} onChange={e=>sf('visa_type',e.target.value)} placeholder="F-1, Tier 4…"/></div>
          </div>
          <div><label className={lbl}>Popular Scholarships (comma separated)</label><input className={inp} value={form.popular_scholarships} onChange={e=>sf('popular_scholarships',e.target.value)} placeholder="Fulbright, Gates Cambridge"/></div>
          <div><label className={lbl}>Best For Branches (comma separated)</label><input className={inp} value={form.best_for_branches} onChange={e=>sf('best_for_branches',e.target.value)} placeholder="CSE, ECE, ME"/></div>
          <div><label className={lbl}>Required Exams (comma separated)</label><input className={inp} value={form.required_exams} onChange={e=>sf('required_exams',e.target.value)} placeholder="GRE, IELTS, TOEFL"/></div>
          <div><label className={lbl}>Job Opportunities <span className="text-slate-400 font-normal">(optional)</span></label><textarea className={inp} rows={2} value={form.job_opportunities} onChange={e=>sf('job_opportunities',e.target.value)} placeholder="OPT for 3 years, H1B visa…"/></div>
          <div><label className={lbl}>PR Opportunities <span className="text-slate-400 font-normal">(optional)</span></label><textarea className={inp} rows={2} value={form.pr_opportunities} onChange={e=>sf('pr_opportunities',e.target.value)} placeholder="Express Entry, IELTS pathway…"/></div>
          <div>
            <label className={lbl}>Visa Guidance <span className="text-red-500">*</span></label>
            <textarea className={`${inp} ${errors.visa_guidance?'border-red-400':''}`} rows={2} value={form.visa_guidance} onChange={e=>sf('visa_guidance',e.target.value)}/>
            <Err f="visa_guidance"/>
          </div>
          <div>
            <label className={lbl}>Application Process <span className="text-red-500">*</span></label>
            <textarea className={`${inp} ${errors.application_process?'border-red-400':''}`} rows={2} value={form.application_process} onChange={e=>sf('application_process',e.target.value)}/>
            <Err f="application_process"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Application Deadline <span className="text-red-500">*</span></label>
              <input type="date" className={`${inp} ${errors.application_deadline?'border-red-400':''}`} value={form.application_deadline} onChange={e=>sf('application_deadline',e.target.value)}/>
              <Err f="application_deadline"/>
            </div>
            <div>
              <label className={lbl}>Status <span className="text-red-500">*</span></label>
              <FormSelect searchType="active_status"
                value={form.is_active ? 'active' : 'inactive'}
                onChange={v => sf('is_active', v === 'active')}
                options={lists.active_status || []}
                clearable={false} />
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update':'Save'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCGAbroad() {
  const [dropdowns, setDropdowns] = useState({ abroad_program_type: [] });
  const [items, setItems]=useState([]);
  const paged = usePagedRows(items);
  const [loading, setLoading]=useState(true);
  const [modal, setModal]=useState(null);
  const [view, setView]=useState(null);
  const [confirm, setConfirm]=useState(null);
  const [toast, setToast]=useState({msg:'',ok:true});
  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast({msg:'',ok:true}),3000);};

  const load=useCallback(async()=>{
    setLoading(true);
    try{const{data}=await api.get('/skovo-platform-panel-admin/cg/abroad');if(data.bool)setItems(data.response.programs);}catch{}
    finally{setLoading(false);}
  },[]);
  useEffect(() => {
    load();
    publicApi.get('/auth/masters', { types: 'abroad_program_type' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, [load]);

  const handleDelete=async(a)=>{
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/abroad/${a.id}`);if(data.bool){showToast('Deleted.');load();}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Abroad Studies</h1><p className="text-sm text-slate-500 mt-1">MS, MBA, PhD programs by country & university</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Program</button>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Country</Th>
                <Th>University</Th>
                <Th>Program</Th>
                <Th>Cost/Yr</Th>
                <Th>Gre/Ielts</Th>
                <Th>Scholarship</Th>
                <Th>Avg Salary</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={9} />
            ) : items.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={9}>
                    <EmptyState icon={Globe} message="No programs yet" />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {paged.rows.map((a, idx) => (
                  <tr key={a.id} onClick={() => setView(a)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-slate-400 text-xs">{idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setView(a)} />
                        <ActionBtn icon={Pencil} tooltip="Edit program" color="blue" onClick={() => setModal(a)} />
                        <ActionBtn icon={Trash2} tooltip="Delete program" color="red" onClick={() => setConfirm(a)} />
                      </div>
                    </Td>
                    <Td className="font-semibold text-slate-900">{a.country}</Td>
                    <Td className="text-xs text-slate-600 max-w-48 truncate">{a.university_name||'(All universities)'}</Td>
                    <Td>
                      <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full text-xs font-semibold">{a.program_type}</span>
                    </Td>
                    <Td className="text-xs text-slate-700">{a.tuition_per_year_usd?`$${a.tuition_per_year_usd.toLocaleString()}/yr`:'"'}</Td>
                    <Td className="text-xs text-slate-600">{a.min_gre_score?`GRE ${a.min_gre_score}`:''}{a.min_ielts_score?` / IELTS ${a.min_ielts_score}`:''}</Td>
                    <Td>
                      {a.scholarship_available
                        ? <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 text-xs font-semibold rounded-full">Yes</span>
                        : <span className="text-xs text-slate-400">No</span>}
                    </Td>
                    <Td className="text-xs font-semibold text-slate-800">{a.avg_salary_after_ms_usd?`$${a.avg_salary_after_ms_usd.toLocaleString()}/yr`:'"'}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && items.length > 0 && <Pagination {...paged.bind} />}
      </TableShell>

      {(modal==='add'||(modal&&modal.id))&&<AbroadModal item={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Saved!');load();}} dropdowns={dropdowns}/>}
      {view && <AbroadDetailModal item={view} onClose={() => setView(null)} onEdit={(a) => setModal(a)} />}
      {confirm && <ConfirmModal message={`Delete ${confirm.university_name || confirm.country} program?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { handleDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
