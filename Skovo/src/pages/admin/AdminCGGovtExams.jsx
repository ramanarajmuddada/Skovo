import React, { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Shield, Plus, Pencil, Trash2, X, Check, ChevronDown, AlertCircle, Eye } from 'lucide-react';
import { api as publicApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';

const govtExamSchema = z.object({
  name:              z.string().min(3, 'Exam name must be at least 3 characters'),
  exam_category:     z.string().min(1, 'Category is required'),
  competition_level: z.string().min(1, 'Competition level is required'),
});

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

const empty = { name:'', exam_category:'state', conducting_body:'', for_state:'Andhra Pradesh', eligible_qualifications:'', eligible_age_min:'', eligible_age_max:'', age_relaxation_info:'', salary_min:'', salary_max:'', job_benefits:'', competition_level:'high', preparation_timeline_months:'', syllabus:'', roadmap:'', recommended_books:'', notification_url:'', official_website:'' };


function GovtExamModal({ item, onClose, onSaved, dropdowns }) {
  const editing = !!item?.id;
  const [form, setForm] = useState(editing ? {
    ...item,
    eligible_qualifications: Array.isArray(item.eligible_qualifications)?item.eligible_qualifications.join(', '):'',
    syllabus: Array.isArray(item.syllabus)?item.syllabus.join(', '):'',
    recommended_books: Array.isArray(item.recommended_books)?item.recommended_books.join(', '):'',
  } : { ...empty });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [errors, setErrors] = useState({});
  const sf=(k,v)=>{ setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:undefined})); };
  const opts = (type) => dropdowns[type] || [];
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;

  const handleSave = async () => {
    const result = govtExamSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true); setApiError('');
    const toArr=s=>s?s.split(',').map(x=>x.trim()).filter(Boolean):[];
    const payload={...form, eligible_qualifications:toArr(form.eligible_qualifications), syllabus:toArr(form.syllabus), recommended_books:toArr(form.recommended_books)};
    try{
      const res=editing?await api.put(`/skovo-platform-panel-admin/cg/govt-exams/${item.id}`,payload):await api.post('/skovo-platform-panel-admin/cg/govt-exams',payload);
      if(res.data.bool){onSaved();onClose();}else setApiError(res.data.response?.message||'Failed.');
    }catch{setApiError('Connection error.');}
    finally{setSaving(false);}
  };

  const inp='w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl='block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Shield size={16} style={{color:'var(--accent)'}}/>{editing?'Edit Govt Exam':'Add Govt Exam'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {apiError&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2"><AlertCircle size={14}/>{apiError}</div>}
          <div>
            <label className={lbl}>Exam Name <span className="text-red-500">*</span></label>
            <input className={`${inp} ${errors.name?.[0] ? 'border-red-400' : ''}`} value={form.name} onChange={e=>sf('name',e.target.value)} placeholder="e.g. APPSC Group 1 · SSC CGL · UPSC Civil Services"/>
            <Err f="name" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Category <span className="text-red-500">*</span></label>
              <FormSelect searchType="govt_exam_category" value={form.exam_category} onChange={v=>sf('exam_category',v)} options={opts('govt_exam_category')} placeholder="e.g. Banking" required />
              <Err f="exam_category"/>
            </div>
            <div>
              <label className={lbl}>Competition Level <span className="text-red-500">*</span></label>
              <FormSelect searchType="competition_level" value={form.competition_level} onChange={v=>sf('competition_level',v)} options={opts('competition_level')} placeholder="e.g. Very High" required />
              <Err f="competition_level"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Conducting Body</label><input className={inp} value={form.conducting_body} onChange={e=>sf('conducting_body',e.target.value)} placeholder="APPSC"/></div>
            <div><label className={lbl}>For State</label><input className={inp} value={form.for_state} onChange={e=>sf('for_state',e.target.value)}/></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Age Min</label><input type="number" className={inp} value={form.eligible_age_min} onChange={e=>sf('eligible_age_min',e.target.value)} placeholder="18"/></div>
            <div><label className={lbl}>Age Max</label><input type="number" className={inp} value={form.eligible_age_max} onChange={e=>sf('eligible_age_max',e.target.value)} placeholder="42"/></div>
          </div>
          <div><label className={lbl}>Age Relaxation Info</label><input className={inp} value={form.age_relaxation_info} onChange={e=>sf('age_relaxation_info',e.target.value)} placeholder="5 years for SC/ST, 3 years for BC"/></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Salary Min (?/month)</label><input type="number" className={inp} value={form.salary_min} onChange={e=>sf('salary_min',e.target.value)}/></div>
            <div><label className={lbl}>Salary Max (?/month)</label><input type="number" className={inp} value={form.salary_max} onChange={e=>sf('salary_max',e.target.value)}/></div>
          </div>
          <div><label className={lbl}>Job Benefits</label><textarea className={inp} rows={2} value={form.job_benefits} onChange={e=>sf('job_benefits',e.target.value)} placeholder="Pension, job security, government quarters…"/></div>
          <div><label className={lbl}>Preparation Timeline (months)</label><input type="number" className={inp} value={form.preparation_timeline_months} onChange={e=>sf('preparation_timeline_months',e.target.value)}/></div>
          <div><label className={lbl}>Eligible Qualifications (comma separated)</label><input className={inp} value={form.eligible_qualifications} onChange={e=>sf('eligible_qualifications',e.target.value)} placeholder="Degree, B.Tech"/></div>
          <div><label className={lbl}>Syllabus Topics (comma separated)</label><input className={inp} value={form.syllabus} onChange={e=>sf('syllabus',e.target.value)} placeholder="General Studies, Aptitude, English"/></div>
          <div><label className={lbl}>Recommended Books (comma separated)</label><input className={inp} value={form.recommended_books} onChange={e=>sf('recommended_books',e.target.value)}/></div>
          <div><label className={lbl}>Notification URL</label><input className={inp} value={form.notification_url} onChange={e=>sf('notification_url',e.target.value)}/></div>
          <div><label className={lbl}>Official Website</label><input className={inp} value={form.official_website} onChange={e=>sf('official_website',e.target.value)}/></div>
          <div><label className={lbl}>Preparation Roadmap</label><textarea className={inp} rows={3} value={form.roadmap} onChange={e=>sf('roadmap',e.target.value)} placeholder="Step-by-step preparation plan for this exam…"/></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update':'Save'}</button>
        </div>
      </div>
    </div>
  );
}

const CAT_COLOR={upsc:'bg-red-50 text-red-700',ssc:'bg-orange-50 text-orange-700',banking:'bg-emerald-50 text-emerald-700',railway:'bg-blue-50 text-blue-700',state:'bg-violet-50 text-violet-700',police:'bg-slate-100 text-slate-600',teaching:'bg-amber-50 text-amber-700'};
const COMP_COLOR={very_high:'bg-red-50 text-red-700',high:'bg-orange-50 text-orange-700',medium:'bg-amber-50 text-amber-700',low:'bg-emerald-50 text-emerald-700'};

function GovtExamDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const fmtArr = (v) => Array.isArray(v) ? (v.join(', ') || '—') : (v || '—');
  const num = (v) => (v || v === 0) ? `₹${Number(v).toLocaleString('en-IN')}` : '—';
  const rows = [
    { label: 'Exam Name', value: a.name || '—' },
    { label: 'Category', value: a.exam_category || '—' },
    { label: 'Competition', value: a.competition_level?.replace('_',' ') || '—' },
    { label: 'Conducting Body', value: a.conducting_body || '—' },
    { label: 'For State', value: a.for_state || '—' },
    { label: 'Age', value: (a.eligible_age_min && a.eligible_age_max) ? `${a.eligible_age_min}–${a.eligible_age_max} yrs` : '—' },
    { label: 'Age Relaxation', value: a.age_relaxation_info || '—' },
    { label: 'Salary Min', value: num(a.salary_min) },
    { label: 'Salary Max', value: num(a.salary_max) },
    { label: 'Job Benefits', value: a.job_benefits || '—' },
    { label: 'Prep Timeline', value: a.preparation_timeline_months ? `${a.preparation_timeline_months} months` : '—' },
    { label: 'Qualifications', value: fmtArr(a.eligible_qualifications) },
    { label: 'Syllabus', value: fmtArr(a.syllabus) },
    { label: 'Books', value: fmtArr(a.recommended_books) },
    { label: 'Notification', value: a.notification_url || '—' },
    { label: 'Website', value: a.official_website || '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0"><h2 className="text-base font-bold text-slate-900">Govt Exam Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right break-words">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

export default function AdminCGGovtExams() {
  const [dropdowns, setDropdowns] = useState({ govt_exam_category: [], competition_level: [] });
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState('');
  const [modal, setModal]     = useState(null);
  const [view, setView]       = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [page, setPage]       = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [toast, setToast]     = useState({msg:'',ok:true});
  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast({msg:'',ok:true}),3000);};

  const openEdit = (row) => setModal(row);

  const load=useCallback(async()=>{
    setLoading(true);
    try{const{data}=await api.get('/skovo-platform-panel-admin/cg/govt-exams', filter?{category:filter}:{});if(data.bool)setItems(data.response.exams);}catch{}
    finally{setLoading(false);}
  },[filter]);
  useEffect(() => {
    load();
    publicApi.get('/auth/masters', { types: 'govt_exam_category,competition_level' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, [load]);

  const doDelete=async(g)=>{
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/govt-exams/${g.id}`);if(data.bool){showToast('Deleted.');load();}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Govt Exams</h1><p className="text-sm text-slate-500 mt-1">UPSC, SSC, Banking, Groups, Railways & more</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Exam</button>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={()=>{setFilter('');setPage(1);}} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-colors ${!filter?'text-white border-transparent':'bg-white border-slate-200 text-slate-600'}`} style={!filter?{backgroundColor:'var(--accent)'}:{}}>All</button>
        {dropdowns.govt_exam_category.map(c=>{const val=c.value??c;const label=c.label??c;return(<button key={val} onClick={()=>{setFilter(val);setPage(1);}} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border capitalize transition-colors ${filter===val?'text-white border-transparent':'bg-white border-slate-200 text-slate-600'}`} style={filter===val?{backgroundColor:'var(--accent)'}:{}}>{label}</button>);})}
      </div>

      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Exam Name</Th>
                  <Th>Category</Th>
                  <Th>Competition</Th>
                  <Th>Age</Th>
                  <Th>Salary</Th>
                  <Th>Timeline</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={4} />
            </table>
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Shield} message="No exams yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Exam Name</Th>
                  <Th>Category</Th>
                  <Th>Competition</Th>
                  <Th>Age</Th>
                  <Th>Salary</Th>
                  <Th>Timeline</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {items.slice((page-1)*perPage, page*perPage).map((g, idx) => (
                  <tr key={g.id} onClick={() => setView(g)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-xs text-slate-400 w-10">{(page-1)*perPage + idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View exam" onClick={() => setView(g)} color="indigo" />
                        <ActionBtn icon={Pencil} tooltip="Edit exam" onClick={() => openEdit(g)} color="blue" />
                        <ActionBtn icon={Trash2} tooltip="Delete exam" onClick={() => setConfirm(g)} color="red" />
                      </div>
                    </Td>
                    <Td><p className="font-semibold text-slate-900">{g.name}</p><p className="text-xs text-slate-400">{g.conducting_body}</p></Td>
                    <Td><span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${CAT_COLOR[g.exam_category]||'bg-slate-100 text-slate-500'}`}>{g.exam_category}</span></Td>
                    <Td><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${COMP_COLOR[g.competition_level]||'bg-slate-100 text-slate-500'}`}>{g.competition_level?.replace('_',' ')}</span></Td>
                    <Td className="text-xs text-slate-600">{g.eligible_age_min&&g.eligible_age_max?`${g.eligible_age_min}–${g.eligible_age_max} yrs`:'—'}</Td>
                    <Td className="text-xs text-slate-700">{g.salary_min?`₹${g.salary_min.toLocaleString('en-IN')}–${g.salary_max?.toLocaleString('en-IN')}/mo`:'—'}</Td>
                    <Td className="text-xs text-slate-600">{g.preparation_timeline_months?`${g.preparation_timeline_months} months`:'—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && items.length > 0 && (
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil(items.length / perPage))}
            total={items.length}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
          />
        )}
      </TableShell>

      {(modal==='add'||(modal&&modal.id))&&<GovtExamModal item={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Saved!');load();}} dropdowns={dropdowns}/>}
      {view && <GovtExamDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.name}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { doDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
