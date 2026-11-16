import React, { useEffect, useState, useCallback, useRef } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Briefcase, Pencil, Trash2, Plus, X, Eye, ChevronDown, Check, Type, Building2, MapPin, Clock, IndianRupee, Tag, Link2, AlignLeft, Calendar, AlertCircle, Hash, Users } from 'lucide-react';
import ApplicantPipeline from './ApplicantPipeline';
import { api as publicApi } from '../../services/api';
import { FormSelect, Button as KitButton } from '../../components/ui/index.jsx';
import { Search as SearchIcon } from 'lucide-react';
import {
  Th, Td, StatusBadge, ActionBtn,
  TableShell, LoadingRows, EmptyState, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';

const oppSchema = z.object({
  title:           z.string().min(3, 'Title must be at least 3 characters'),
  company:         z.string().min(2, 'Company name is required'),
  type:            z.string().min(1, 'Opportunity type is required'),
  deadline:        z.string().min(1, 'Application deadline is required'),
  experience_level:z.string().min(1, 'Experience level is required'),
  status:          z.string().min(1, 'Status is required'),
  skills_required: z.string().min(2, 'At least one skill required'),
  application_link:z.string().url('Must be a valid URL').min(1, 'Application link is required'),
  description:     z.string().min(20, 'Description must be at least 20 characters'),
});

const TYPE_COLOR   = { internship:'bg-blue-100 text-blue-700', fresher_job:'bg-emerald-100 text-emerald-700', part_time:'bg-purple-100 text-purple-700', fellowship:'bg-amber-100 text-amber-700' };
const STATUS_COLOR = { active:'bg-emerald-100 text-emerald-700', closed:'bg-red-100 text-red-700', draft:'bg-slate-100 text-slate-600' };
const EMPTY = { title:'', company:'', type:'internship', domain:'', location:'', is_remote:false, duration:'', stipend_min:'', stipend_max:'', stipend_type:'fixed', min_readiness_score:0, skills_required:'', eligibility_criteria:'', experience_level:'', application_link:'', is_featured:false, deadline:'', description:'', requirements:'', status:'active' };

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok?'bg-emerald-600 text-white':'bg-red-600 text-white'}`}>{msg}</div>;
}


function Modal({ title, onClose, onSave, form, setForm, saving, dropdowns }) {
  const [errors, setErrors] = useState({});
  const opts = (type) => dropdowns[type] || [];
  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };

  const handleSave = () => {
    const result = oppSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    onSave();
  };

  const ic = (f) => errors[f]?.[0]
    ? 'border-red-400 bg-red-50/30 focus:ring-red-100'
    : 'border-slate-200 focus:ring-blue-500';
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;
  const Lbl = ({ icon: Icon, text, req, note }) => (
    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
      <Icon size={12} className="text-slate-400"/>{text}{req && <span className="text-red-500">*</span>}
      {note && <span className="font-normal text-slate-400 ml-1">{note}</span>}
    </label>
  );
  const iInp = (icon, key, type = 'text', placeholder = '') => {
    const Icon = icon;
    return (
      <div className="relative">
        <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <input type={type} value={form[key]} onChange={e => sf(key, e.target.value)} placeholder={placeholder}
          className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic(key)}`} />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-2 gap-4">
          {/* Title */}
          <div className="col-span-2">
            <Lbl icon={Type} text="Job / Internship Title" req />
            {iInp(Type, 'title', 'text', 'e.g. Software Engineer Intern · Frontend Developer')}
            <Err f="title" />
          </div>
          {/* Company */}
          <div>
            <Lbl icon={Building2} text="Company" req />
            {iInp(Building2, 'company', 'text', 'e.g. Google · TCS · StartupXYZ')}
            <Err f="company" />
          </div>
          {/* Type */}
          <div>
            <Lbl icon={Briefcase} text="Opportunity Type" req />
            <FormSelect searchType="opportunity_type" value={form.type} onChange={v => sf('type', v)} icon={Briefcase} options={opts('opportunity_type')} placeholder="e.g. Internship" />
            <Err f="type" />
          </div>
          {/* Domain */}
          <div>
            <Lbl icon={Tag} text="Domain" />
            {iInp(Tag, 'domain', 'text', 'e.g. Technology · Finance · Marketing')}
          </div>
          {/* Location */}
          <div>
            <Lbl icon={MapPin} text="Location" />
            {iInp(MapPin, 'location', 'text', 'e.g. Bangalore · Hyderabad · Pan India')}
          </div>
          {/* Remote toggle */}
          <div className="col-span-2 flex items-center gap-3 -mt-1">
            <input type="checkbox" id="remote" checked={form.is_remote} onChange={e=>sf('is_remote',e.target.checked)} className="w-4 h-4 rounded accent-blue-600"/>
            <label htmlFor="remote" className="text-sm font-medium text-slate-700">Remote / Work from home</label>
          </div>
          {/* Duration */}
          <div>
            <Lbl icon={Clock} text="Duration" />
            {iInp(Clock, 'duration', 'text', 'e.g. 3 months · 6 months · Full-time')}
          </div>
          {/* Stipend Min */}
          <div>
            <Lbl icon={IndianRupee} text="Stipend Min (₹/mo)" />
            {iInp(IndianRupee, 'stipend_min', 'number', 'e.g. 15000')}
          </div>
          {/* Stipend Max */}
          <div>
            <Lbl icon={IndianRupee} text="Stipend Max (₹/mo)" />
            {iInp(IndianRupee, 'stipend_max', 'number', 'e.g. 25000')}
          </div>
          {/* Stipend Type */}
          <div>
            <Lbl icon={IndianRupee} text="Stipend Type" />
            <FormSelect searchType="stipend_type" value={form.stipend_type} onChange={v => sf('stipend_type', v)} icon={IndianRupee} options={opts('stipend_type')} placeholder="e.g. Fixed" />
          </div>
          {/* Min Readiness Score */}
          <div>
            <Lbl icon={Hash} text="Min Readiness Score" />
            {iInp(Hash, 'min_readiness_score', 'number', 'e.g. 60')}
          </div>
          {/* Deadline */}
          <div>
            <Lbl icon={Calendar} text="Application Deadline" req />
            <div className="relative">
              <Calendar size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input type="date" value={form.deadline} onChange={e => sf('deadline', e.target.value)}
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('deadline')}`} />
            </div>
            <Err f="deadline" />
          </div>
          {/* Experience Level */}
          <div>
            <Lbl icon={Briefcase} text="Experience Level" req />
            <FormSelect searchType="experience_level" value={form.experience_level} onChange={v => sf('experience_level', v)} icon={Briefcase} options={opts('experience_level')} placeholder="e.g. Fresher" />
            <Err f="experience_level" />
          </div>
          {/* Status */}
          <div>
            <Lbl icon={Check} text="Status" req />
            <FormSelect searchType="opportunity_status" value={form.status} onChange={v => sf('status', v)} icon={Check} options={opts('opportunity_status')} placeholder="e.g. Active" required />
            <Err f="status" />
          </div>
          {/* Skills */}
          <div className="col-span-2">
            <Lbl icon={Tag} text="Skills Required" req note="(comma separated)" />
            <div className="relative">
              <Tag size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input value={form.skills_required} onChange={e => sf('skills_required', e.target.value)}
                placeholder="Python, React, SQL, Communication, Problem Solving…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('skills_required')}`} />
            </div>
            <Err f="skills_required" />
          </div>
          {/* Application Link */}
          <div className="col-span-2">
            <Lbl icon={Link2} text="Application Link" req />
            {iInp(Link2, 'application_link', 'url', 'https://forms.gle/… or https://company.com/careers')}
            <Err f="application_link" />
          </div>
          {/* Eligibility */}
          <div className="col-span-2">
            <Lbl icon={AlignLeft} text="Eligibility Criteria" />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={2} value={form.eligibility_criteria} onChange={e=>sf('eligibility_criteria',e.target.value)}
                placeholder="e.g. Final year students / 2024-25 graduates with 60% aggregate in B.Tech (CSE/IT)"
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
            </div>
          </div>
          {/* Featured */}
          <div className="col-span-2 flex items-center gap-3">
            <input type="checkbox" id="featured" checked={form.is_featured} onChange={e=>sf('is_featured',e.target.checked)} className="w-4 h-4 rounded accent-blue-600"/>
            <label htmlFor="featured" className="text-sm font-medium text-slate-700">Mark as Featured</label>
          </div>
          {/* Description */}
          <div className="col-span-2">
            <Lbl icon={AlignLeft} text="Description" req />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={3} value={form.description} onChange={e=>sf('description',e.target.value)}
                placeholder="Role overview, responsibilities, what the candidate will work on, team culture…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none resize-none ${ic('description')}`}/>
            </div>
            <Err f="description" />
          </div>
          {/* Requirements */}
          <div className="col-span-2">
            <Lbl icon={AlignLeft} text="Requirements" note="(one per line)" />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={3} value={form.requirements} onChange={e=>sf('requirements',e.target.value)}
                placeholder={"Strong Python skills\nFinal year student (B.Tech CSE/IT)\nGood communication skills"}
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
            </div>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">{saving?'Saving…':'Save Opportunity'}</button>
        </div>
      </div>
    </div>
  );
}

function OpportunityDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Company', value: a.company || '—' },
    { label: 'Type', value: a.type ? a.type.replace('_', ' ') : '—' },
    { label: 'Location', value: `${a.location || '—'}${a.is_remote ? ' · Remote' : ''}` },
    { label: 'Stipend', value: a.stipend_min ? `₹${a.stipend_min}${a.stipend_max ? `–${a.stipend_max}` : ''}/mo` : '—' },
    { label: 'Deadline', value: a.deadline ? new Date(a.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—' },
    { label: 'Status', value: a.status || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Opportunity Details</h2>
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

export default function AdminOpportunities() {
  const [dropdowns, setDropdowns] = useState({ opportunity_type: [], stipend_type: [], opportunity_status: [], experience_level: [] });
  const [opps, setOpps]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [pages, setPages]     = useState(1);
  const [total, setTotal]     = useState(0);
  const [perPage, setPerPage] = useState(20);
  const [modal, setModal]     = useState(null);
  const [form, setForm]       = useState(EMPTY);
  const [saving, setSaving]   = useState(false);
  const [toast, setToast]     = useState(null);
  const [view, setView]       = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const showToast = (msg, ok=true) => { setToast({msg,ok}); setTimeout(()=>setToast(null),3000); };
  const qRef = useRef('');
  const [query, setQuery] = useState('');
  const load = useCallback((p=1, pp=15) => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/opportunities',{page:p,per_page:pp,...(qRef.current && { search: qRef.current })})
      .then(({data})=>{ if(data.bool){setOpps(data.response.opportunities);setPages(data.pagination?.pages||1);setTotal(data.pagination?.total||0);} })
      .catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(() => {
    load(1);
    publicApi.get('/auth/masters', { types: 'opportunity_type,stipend_type,opportunity_status,experience_level' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, []);

  const openCreate = ()=>{ setForm(EMPTY); setModal('create'); };
  const openEdit = (o)=>{
    setForm({title:o.title||'',company:o.company||'',type:o.type||'internship',domain:o.domain||'',location:o.location||'',is_remote:!!o.is_remote,duration:o.duration||'',stipend_min:o.stipend_min||'',stipend_max:o.stipend_max||'',stipend_type:o.stipend_type||'fixed',min_readiness_score:o.min_readiness_score||0,skills_required:Array.isArray(o.skills_required)?o.skills_required.join(', '):'',eligibility_criteria:o.eligibility_criteria||'',experience_level:o.experience_level||'',application_link:o.application_link||'',is_featured:!!o.is_featured,deadline:o.deadline?o.deadline.slice(0,10):'',description:o.description||'',requirements:Array.isArray(o.requirements)?o.requirements.join('\n'):'',status:o.status||'active'});
    setModal(o);
  };

  const save = async ()=>{
    setSaving(true);
    try {
      const payload = {...form, requirements: form.requirements.split('\n').map(s=>s.trim()).filter(Boolean), skills_required: typeof form.skills_required === 'string' ? form.skills_required.split(',').map(s=>s.trim()).filter(Boolean) : form.skills_required};
      const isEdit = modal && modal!=='create';
      const {data} = isEdit ? await api.put(`/skovo-platform-panel-admin/opportunities/${modal.id}`,payload) : await api.post('/skovo-platform-panel-admin/opportunities',payload);
      if(data.bool){showToast(isEdit?'Updated':'Created');setModal(null);load(page);}
      else showToast(data.response?.message||'Failed',false);
    } catch { showToast('Error',false); } finally { setSaving(false); }
  };

  const doDelete = async (o)=>{
    try{const {data}=await api.delete(`/skovo-platform-panel-admin/opportunities/${o.id}`);if(data.bool){showToast('Deleted');load(page);}else showToast('Failed',false);}catch{showToast('Error',false);}
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok}/>
      {modal && <Modal title={modal==='create'?'Add Opportunity':'Edit Opportunity'} onClose={()=>setModal(null)} onSave={save} form={form} setForm={setForm} saving={saving} dropdowns={dropdowns}/>}
      {view && <OpportunityDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {pipeline && <ApplicantPipeline opportunity={pipeline} onClose={() => setPipeline(null)} />}
      {confirm && (
        <ConfirmModal
          message={`Delete "${confirm.title}"?`}
          detail="This cannot be undone."
          danger
          confirmLabel="Delete"
          onConfirm={() => { doDelete(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Opportunities</h1>
          <p className="text-sm text-slate-500 mt-0.5"><span className="font-semibold text-slate-700">{total}</span> jobs, internships &amp; fellowships</p>
        </div>
        <KitButton onClick={openCreate} className="w-full sm:w-auto"><Plus size={16} /> Add opportunity</KitButton>
      </div>

      <div className="relative mb-4">
        <SearchIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} type="search" aria-label="Search opportunities" placeholder="Search title or company…"
               onChange={(e) => {
                 setQuery(e.target.value);
                 clearTimeout(window.__oppSearchT);
                 window.__oppSearchT = setTimeout(() => { qRef.current = e.target.value.trim(); setPage(1); load(1, perPage); }, 400);
               }}
               className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Phones and tablets: cards, two across from md. */}
      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {loading ? [0, 1].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-100 animate-pulse" />)
          : opps.length === 0 ? <div className="md:col-span-2"><EmptyState icon={Briefcase} message={query ? 'No opportunities match' : 'No opportunities yet'} /></div>
            : opps.map((o) => (
              <div key={o.id} onClick={() => setView(o)} className="bg-white rounded-2xl border border-slate-200 p-4 cursor-pointer">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-slate-900 break-words">{o.title}</p>
                    <p className="text-xs text-slate-500">{o.company}</p>
                  </div>
                  <StatusBadge status={o.status} />
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  <span className="capitalize">{o.type?.replace('_', ' ')}</span>
                  <span>{o.location || '—'}{o.is_remote ? ' · Remote' : ''}</span>
                  {o.deadline && <span>Closes {new Date(o.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' })}</span>}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <ActionBtn icon={Users} tooltip="View applicants" onClick={() => setPipeline(o)} color="green" />
                  <ActionBtn icon={Pencil} tooltip="Edit Opportunity" onClick={() => openEdit(o)} color="blue" />
                  <ActionBtn icon={Trash2} tooltip="Delete Opportunity" onClick={() => setConfirm(o)} color="red" />
                </div>
              </div>
            ))}
      </div>

      <TableShell>
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>Opportunity</Th>
                <Th>Type</Th>
                <Th>Location</Th>
                <Th>Stipend</Th>
                <Th>Deadline</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={8} rows={6} />
            ) : opps.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon={Briefcase} message={query ? 'No opportunities match' : 'No opportunities yet'} />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {opps.map((o)=>(
                  <tr key={o.id} onClick={() => setView(o)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>
                      <p className="font-semibold text-slate-900 max-w-64 truncate">{o.title}</p>
                      <p className="text-xs text-slate-400 max-w-64 truncate">{o.company}</p>
                    </Td>
                    <Td><span className={`text-xs font-semibold px-2.5 py-1 rounded-lg capitalize whitespace-nowrap ${TYPE_COLOR[o.type]||''}`}>{o.type?.replace('_',' ')}</span></Td>
                    <Td className="text-slate-500 text-xs">{o.location||'—'}{o.is_remote?' · Remote':''}</Td>
                    <Td className="text-slate-600 text-xs">{o.stipend_min?`₹${o.stipend_min}${o.stipend_max?`–${o.stipend_max}`:''}/mo`:'—'}</Td>
                    <Td className="text-slate-400 text-xs whitespace-nowrap">{o.deadline?new Date(o.deadline).toLocaleDateString('en-IN',{dateStyle:'medium'}):'—'}</Td>
                    <Td><StatusBadge status={o.status} /></Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View" onClick={()=>setView(o)} color="indigo" />
                        <ActionBtn icon={Users} tooltip="View applicants" onClick={()=>setPipeline(o)} color="green" />
                        <ActionBtn icon={Pencil} tooltip="Edit Opportunity" onClick={()=>openEdit(o)} color="blue" />
                        <ActionBtn icon={Trash2} tooltip="Delete Opportunity" onClick={()=>setConfirm(o)} color="red" />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        <Pagination
          page={page}
          pages={pages}
          total={total}
          perPage={perPage}
          onPage={(p) => { setPage(p); load(p, perPage); }}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
        />
      </TableShell>
    </div>
  );
}
