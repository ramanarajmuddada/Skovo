import React, { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Award, Plus, Pencil, Trash2, X, Check, ChevronDown, AlertCircle, Eye } from 'lucide-react';
import { api as publicApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';

const scholarshipSchema = z.object({
  name:             z.string().min(3, 'Scholarship name must be at least 3 characters'),
  provider:         z.string().min(2, 'Provider is required'),
  scheme_type:      z.string().min(1, 'Type is required'),
  application_url:  z.string().url('Must be a valid URL'),
  application_deadline_info: z.string().min(2, 'Deadline info is required'),
});

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

const empty = { name:'', provider:'', scheme_type:'state', scholarship_mode:'', for_state:'Andhra Pradesh', eligible_categories:'', eligible_courses:'', eligible_qualifications:'', income_limit:'', benefit_type:'full_fees', benefit_amount:'', eligibility_criteria:'', required_documents:'', application_url:'', application_deadline_info:'', notification_pdf_url:'', contact_info:'', is_active:true };


function ScholarshipModal({ item, onClose, onSaved, dropdowns }) {
  const { lists } = useMasters(['active_status']);
  const editing = !!item?.id;
  const [form, setForm] = useState(editing ? {
    ...item,
    eligible_categories:     Array.isArray(item.eligible_categories)     ? item.eligible_categories.join(', ')     : '',
    eligible_courses:        Array.isArray(item.eligible_courses)        ? item.eligible_courses.join(', ')        : '',
    eligible_qualifications: Array.isArray(item.eligible_qualifications) ? item.eligible_qualifications.join(', ') : '',
    required_documents:      Array.isArray(item.required_documents)      ? item.required_documents.join(', ')      : '',
    is_active:               item.is_active !== false,
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
    const result = scholarshipSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true); setApiError('');
    const toArr = s => s ? s.split(',').map(x=>x.trim()).filter(Boolean) : [];
    const payload = { ...form, eligible_categories: toArr(form.eligible_categories), eligible_courses: toArr(form.eligible_courses), eligible_qualifications: toArr(form.eligible_qualifications), required_documents: toArr(form.required_documents) };
    try {
      const res = editing ? await api.put(`/skovo-platform-panel-admin/cg/scholarships/${item.id}`, payload) : await api.post('/skovo-platform-panel-admin/cg/scholarships', payload);
      if (res.data.bool) { onSaved(); onClose(); } else setApiError(res.data.response?.message||'Failed.');
    } catch { setApiError('Connection error.'); }
    finally { setSaving(false); }
  };

  const inp='w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl='block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Award size={16} style={{color:'var(--accent)'}}/>{editing?'Edit Scholarship':'Add Scholarship'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {apiError&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{apiError}</div>}
          <div>
            <label className={lbl}>Scholarship Name <span className="text-red-500">*</span></label>
            <input className={inp} value={form.name} onChange={e=>sf('name',e.target.value)} placeholder="AP Fee Reimbursement Scheme"/>
            <Err f="name"/>
          </div>
          <div>
            <label className={lbl}>Provider <span className="text-red-500">*</span></label>
            <input className={inp} value={form.provider} onChange={e=>sf('provider',e.target.value)} placeholder="Government of Andhra Pradesh / NSP / AICTE"/>
            <Err f="provider"/>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Type <span className="text-red-500">*</span></label>
              <FormSelect searchType="scholarship_type" value={form.scheme_type} onChange={v=>sf('scheme_type',v)} options={opts('scholarship_type')} placeholder="e.g. Merit-based" required />
              <Err f="scheme_type"/>
            </div>
            <div><label className={lbl}>Scholarship Mode</label><FormSelect searchType="scholarship_mode" value={form.scholarship_mode} onChange={v=>sf('scholarship_mode',v)} options={opts('scholarship_mode')} placeholder="e.g. Online" /></div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>For State <span className="text-slate-400 font-normal">(optional)</span></label><input className={inp} value={form.for_state} onChange={e=>sf('for_state',e.target.value)}/></div>
            <div>
              <label className={lbl}>Status <span className="text-red-500">*</span></label>
              <FormSelect searchType="active_status"
                value={form.is_active ? 'active' : 'inactive'}
                onChange={v => sf('is_active', v === 'active')}
                options={lists.active_status || []}
                clearable={false} />
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Benefit Type</label><FormSelect searchType="scholarship_benefit_type" value={form.benefit_type} onChange={v=>sf('benefit_type',v)} options={opts('scholarship_benefit_type')} placeholder="e.g. Tuition waiver" /></div>
            <div><label className={lbl}>Benefit Amount (₹)</label><input type="number" className={inp} value={form.benefit_amount} onChange={e=>sf('benefit_amount',e.target.value)} placeholder="100000"/></div>
          </div>
          <div><label className={lbl}>Income Limit (Annual family income ₹)</label><input type="number" className={inp} value={form.income_limit} onChange={e=>sf('income_limit',e.target.value)} placeholder="200000"/></div>
          <div><label className={lbl}>Eligible Categories (comma separated)</label><input className={inp} value={form.eligible_categories} onChange={e=>sf('eligible_categories',e.target.value)} placeholder="SC, ST, BC-A, EWS"/></div>
          <div><label className={lbl}>Eligible Courses (comma separated)</label><input className={inp} value={form.eligible_courses} onChange={e=>sf('eligible_courses',e.target.value)} placeholder="B.Tech, B.Sc, B.Com"/></div>
          <div><label className={lbl}>Eligible Qualifications (comma separated)</label><input className={inp} value={form.eligible_qualifications} onChange={e=>sf('eligible_qualifications',e.target.value)} placeholder="Intermediate, Diploma"/></div>
          <div><label className={lbl}>Eligibility Criteria</label><textarea className={inp} rows={2} value={form.eligibility_criteria} onChange={e=>sf('eligibility_criteria',e.target.value)}/></div>
          <div><label className={lbl}>Required Documents (comma separated)</label><input className={inp} value={form.required_documents} onChange={e=>sf('required_documents',e.target.value)} placeholder="Income certificate, Caste certificate, Marks memo"/></div>
          <div>
            <label className={lbl}>Application URL <span className="text-red-500">*</span></label>
            <input className={inp} value={form.application_url} onChange={e=>sf('application_url',e.target.value)} placeholder="https://scholarships.gov.in"/>
            <Err f="application_url"/>
          </div>
          <div>
            <label className={lbl}>Deadline Date <span className="text-red-500">*</span></label>
            <input className={inp} value={form.application_deadline_info} onChange={e=>sf('application_deadline_info',e.target.value)} placeholder="October every year / 31-Dec-2025"/>
            <Err f="application_deadline_info"/>
          </div>
          <div><label className={lbl}>Notification PDF URL <span className="text-slate-400 font-normal">(optional)</span></label><input className={inp} value={form.notification_pdf_url} onChange={e=>sf('notification_pdf_url',e.target.value)} placeholder="https://scholarships.gov.in/notice.pdf"/></div>
          <div><label className={lbl}>Contact Info <span className="text-slate-400 font-normal">(optional)</span></label><input className={inp} value={form.contact_info} onChange={e=>sf('contact_info',e.target.value)}/></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update':'Save'}</button>
        </div>
      </div>
    </div>
  );
}

const TYPE_COLOR={central:'bg-violet-50 text-violet-700',state:'bg-blue-50 text-blue-700',private:'bg-amber-50 text-amber-700',international:'bg-emerald-50 text-emerald-700'};

function ScholarshipDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const fmtArr = (v) => Array.isArray(v) ? (v.join(', ') || '—') : (v || '—');
  const num = (v) => (v || v === 0) ? `₹${Number(v).toLocaleString('en-IN')}` : '—';
  const rows = [
    { label: 'Name', value: a.name || '—' },
    { label: 'Provider', value: a.provider || '—' },
    { label: 'Type', value: a.scheme_type || '—' },
    { label: 'Mode', value: a.scholarship_mode || '—' },
    { label: 'For State', value: a.for_state || '—' },
    { label: 'Status', value: a.is_active !== false ? 'Active' : 'Inactive' },
    { label: 'Benefit Type', value: a.benefit_type?.replace('_',' ') || '—' },
    { label: 'Benefit Amount', value: num(a.benefit_amount) },
    { label: 'Income Limit', value: a.income_limit ? `${num(a.income_limit)}/yr` : '—' },
    { label: 'Categories', value: fmtArr(a.eligible_categories) },
    { label: 'Courses', value: fmtArr(a.eligible_courses) },
    { label: 'Qualifications', value: fmtArr(a.eligible_qualifications) },
    { label: 'Eligibility', value: a.eligibility_criteria || '—' },
    { label: 'Documents', value: fmtArr(a.required_documents) },
    { label: 'Deadline', value: a.application_deadline_info || '—' },
    { label: 'Application URL', value: a.application_url || '—' },
    { label: 'Notification', value: a.notification_pdf_url || '—' },
    { label: 'Contact', value: a.contact_info || '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0"><h2 className="text-base font-bold text-slate-900">Scholarship Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right break-words">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

export default function AdminCGScholarships() {
  const [dropdowns, setDropdowns] = useState({ scholarship_type: [], scholarship_benefit_type: [], scholarship_mode: [] });
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
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
    try{const{data}=await api.get('/skovo-platform-panel-admin/cg/scholarships');if(data.bool)setItems(data.response.scholarships);}catch{}
    finally{setLoading(false);}
  },[]);
  useEffect(() => {
    load();
    publicApi.get('/auth/masters', { types: 'scholarship_type,scholarship_benefit_type,scholarship_mode' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, [load]);

  const doDelete=async(s)=>{
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/scholarships/${s.id}`);if(data.bool){showToast('Deleted.');load();}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Scholarships</h1><p className="text-sm text-slate-500 mt-1">AP/TS scholarships, fee reimbursements & schemes</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Scholarship</button>
      </div>

      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>State</Th>
                  <Th>Benefit</Th>
                  <Th>Income Limit</Th>
                  <Th>Categories</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={4} />
            </table>
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={Award} message="No scholarships yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Name</Th>
                  <Th>Type</Th>
                  <Th>State</Th>
                  <Th>Benefit</Th>
                  <Th>Income Limit</Th>
                  <Th>Categories</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {items.slice((page-1)*perPage, page*perPage).map((s, idx) => (
                  <tr key={s.id} onClick={() => setView(s)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-xs text-slate-400 w-10">{(page-1)*perPage + idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View scholarship" onClick={() => setView(s)} color="indigo" />
                        <ActionBtn icon={Pencil} tooltip="Edit scholarship" onClick={() => openEdit(s)} color="blue" />
                        <ActionBtn icon={Trash2} tooltip="Delete scholarship" onClick={() => setConfirm(s)} color="red" />
                      </div>
                    </Td>
                    <Td><p className="font-semibold text-slate-900 max-w-56 truncate">{s.name}</p></Td>
                    <Td><span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${TYPE_COLOR[s.scheme_type]||'bg-slate-100 text-slate-500'}`}>{s.scheme_type}</span></Td>
                    <Td className="text-xs text-slate-600">{s.for_state||'All'}</Td>
                    <Td className="text-xs"><p className="font-semibold text-slate-800 capitalize">{s.benefit_type?.replace('_',' ')}</p>{s.benefit_amount?<p className="text-slate-500">₹{s.benefit_amount.toLocaleString('en-IN')}</p>:null}</Td>
                    <Td className="text-xs text-slate-600">{s.income_limit?`₹${s.income_limit.toLocaleString('en-IN')}/yr`:'—'}</Td>
                    <Td className="text-xs text-slate-500 max-w-36 truncate">{Array.isArray(s.eligible_categories)?s.eligible_categories.join(', '):'—'}</Td>
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

      {(modal==='add'||(modal&&modal.id))&&<ScholarshipModal item={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Saved!');load();}} dropdowns={dropdowns}/>}
      {view && <ScholarshipDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.name}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { doDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
