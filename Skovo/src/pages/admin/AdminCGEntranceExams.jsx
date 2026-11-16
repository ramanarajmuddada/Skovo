import React, { useEffect, useState, useCallback } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { BookOpen, Plus, Pencil, Trash2, X, Check, Globe, ChevronDown, AlertCircle, Eye } from 'lucide-react';
import { api as publicApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';

const examSchema = z.object({
  exam_code:            z.string().min(2, 'Exam code is required').max(20),
  exam_name:            z.string().min(2, 'Exam name is required'),
  exam_type:            z.string().min(1, 'Exam type is required'),
  for_stream:           z.string().min(1, 'Stream is required'),
  exam_mode:            z.string().min(1, 'Exam mode is required'),
  conducting_authority: z.string().min(2, 'Conducting authority is required'),
  eligibility:          z.string().min(1, 'Eligibility is required'),
  exam_pattern:         z.string().min(1, 'Exam pattern is required'),
  syllabus_highlights:  z.string().min(1, 'Syllabus highlights required'),
  official_url:         z.string().url('Must be a valid URL'),
});

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

const empty = { exam_code:'', exam_name:'', exam_type:'state', for_stream:'engineering', conducting_authority:'', exam_mode:'', eligibility:'', syllabus_highlights:'', exam_pattern:'', counseling_info:'', cutoff_notes:'', registration_period:'', exam_period:'', official_url:'', notification_pdf_url:'', preparation_tips:'', useful_for_states:'Andhra Pradesh, Telangana', important_books:'' };


function ExamModal({ exam, onClose, onSaved, dropdowns }) {
  const editing = !!exam?.id;
  const [form, setForm] = useState(editing ? {
    ...exam,
    useful_for_states: Array.isArray(exam.useful_for_states) ? exam.useful_for_states.join(', ') : '',
    important_books:   Array.isArray(exam.important_books)   ? exam.important_books.join(', ')   : '',
    exam_pattern:      typeof exam.exam_pattern === 'object' && exam.exam_pattern !== null ? JSON.stringify(exam.exam_pattern) : (exam.exam_pattern || ''),
  } : { ...empty });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [errors, setErrors] = useState({});
  const sf = (k,v) => { setForm(f=>({...f,[k]:v})); setErrors(e=>({...e,[k]:undefined})); };
  const opts = (type) => dropdowns[type] || [];
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;

  const handleSave = async () => {
    const result = examSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true); setApiError('');
    const payload = { ...form, exam_code: form.exam_code.toUpperCase(),
      useful_for_states: form.useful_for_states ? form.useful_for_states.split(',').map(s=>s.trim()).filter(Boolean) : [],
      important_books:   form.important_books   ? form.important_books.split(',').map(s=>s.trim()).filter(Boolean)   : [],
    };
    try {
      const res = editing
        ? await api.put(`/skovo-platform-panel-admin/cg/entrance-exams/${exam.id}`, payload)
        : await api.post('/skovo-platform-panel-admin/cg/entrance-exams', payload);
      if (res.data.bool) { onSaved(); onClose(); }
      else setApiError(res.data.response?.message||'Failed.');
    } catch { setApiError('Connection error.'); }
    finally { setSaving(false); }
  };

  const inp = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><BookOpen size={16} style={{color:'var(--accent)'}}/>{editing?'Edit Exam':'Add Entrance Exam'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {apiError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2"><AlertCircle size={14}/>{apiError}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Exam Code <span className="text-red-500">*</span></label>
              <input className={inp} value={form.exam_code} onChange={e=>sf('exam_code',e.target.value.toUpperCase())} placeholder="EAMCET" disabled={editing}/>
              <Err f="exam_code"/>
            </div>
            <div>
              <label className={lbl}>Exam Name <span className="text-red-500">*</span></label>
              <input className={inp} value={form.exam_name} onChange={e=>sf('exam_name',e.target.value)} placeholder="Engineering Agriculture Medical Common Entrance Test"/>
              <Err f="exam_name"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Type <span className="text-red-500">*</span></label>
              <FormSelect searchType="entrance_exam_type" value={form.exam_type} onChange={v=>sf('exam_type',v)} options={opts('entrance_exam_type')} placeholder="e.g. Engineering" required />
              <Err f="exam_type"/>
            </div>
            <div>
              <label className={lbl}>For Stream <span className="text-red-500">*</span></label>
              <FormSelect searchType="entrance_exam_stream" value={form.for_stream} onChange={v=>sf('for_stream',v)} options={opts('entrance_exam_stream')} placeholder="e.g. Engineering" required />
              <Err f="for_stream"/>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={lbl}>Conducting Authority <span className="text-red-500">*</span></label>
              <input className={inp} value={form.conducting_authority} onChange={e=>sf('conducting_authority',e.target.value)} placeholder="NTA, JNTU, AP EAMCET Board"/>
              <Err f="conducting_authority"/>
            </div>
            <div>
              <label className={lbl}>Exam Mode <span className="text-red-500">*</span></label>
              <FormSelect searchType="exam_mode" value={form.exam_mode} onChange={v=>sf('exam_mode',v)} options={opts('exam_mode')} placeholder="e.g. Online (CBT)" required />
              <Err f="exam_mode"/>
            </div>
          </div>
          <div>
            <label className={lbl}>Eligibility <span className="text-red-500">*</span></label>
            <textarea className={inp} rows={2} value={form.eligibility} onChange={e=>sf('eligibility',e.target.value)} placeholder="Who can apply?"/>
            <Err f="eligibility"/>
          </div>
          <div>
            <label className={lbl}>Exam Pattern <span className="text-red-500">*</span></label>
            <textarea className={inp} rows={2} value={form.exam_pattern} onChange={e=>sf('exam_pattern',e.target.value)} placeholder="Number of questions, sections, marking scheme"/>
            <Err f="exam_pattern"/>
          </div>
          <div>
            <label className={lbl}>Syllabus Highlights <span className="text-red-500">*</span></label>
            <textarea className={inp} rows={2} value={form.syllabus_highlights} onChange={e=>sf('syllabus_highlights',e.target.value)} placeholder="Key topics covered"/>
            <Err f="syllabus_highlights"/>
          </div>
          <div><label className={lbl}>Counseling Info</label><textarea className={inp} rows={2} value={form.counseling_info} onChange={e=>sf('counseling_info',e.target.value)} placeholder="How college allotment works"/></div>
          <div><label className={lbl}>Cutoff Notes</label><textarea className={inp} rows={2} value={form.cutoff_notes} onChange={e=>sf('cutoff_notes',e.target.value)} placeholder="Notes about rank cutoffs"/></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Registration Period</label><input className={inp} value={form.registration_period} onChange={e=>sf('registration_period',e.target.value)} placeholder="March - April"/></div>
            <div><label className={lbl}>Exam Period</label><input className={inp} value={form.exam_period} onChange={e=>sf('exam_period',e.target.value)} placeholder="May - June"/></div>
          </div>
          <div>
            <label className={lbl}>Official URL <span className="text-red-500">*</span></label>
            <input className={inp} value={form.official_url} onChange={e=>sf('official_url',e.target.value)} placeholder="https://jeemain.nta.nic.in"/>
            <Err f="official_url"/>
          </div>
          <div><label className={lbl}>Notification PDF URL <span className="text-slate-400 font-normal">(optional)</span></label><input className={inp} value={form.notification_pdf_url} onChange={e=>sf('notification_pdf_url',e.target.value)} placeholder="https://nta.ac.in/notice.pdf"/></div>
          <div><label className={lbl}>Preparation Tips <span className="text-slate-400 font-normal">(optional)</span></label><textarea className={inp} rows={2} value={form.preparation_tips} onChange={e=>sf('preparation_tips',e.target.value)}/></div>
          <div><label className={lbl}>Useful For States (comma separated)</label><input className={inp} value={form.useful_for_states} onChange={e=>sf('useful_for_states',e.target.value)}/></div>
          <div><label className={lbl}>Important Books (comma separated)</label><input className={inp} value={form.important_books} onChange={e=>sf('important_books',e.target.value)} placeholder="Sakshi, Eenadu, DC Pandey"/></div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update':'Save Exam'}</button>
        </div>
      </div>
    </div>
  );
}

function ExamDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const fmtArr = (v) => Array.isArray(v) ? (v.join(', ') || '—') : (v || '—');
  const rows = [
    { label: 'Exam Code', value: a.exam_code || '—' },
    { label: 'Exam Name', value: a.exam_name || '—' },
    { label: 'Type', value: a.exam_type || '—' },
    { label: 'Stream', value: a.for_stream || '—' },
    { label: 'Mode', value: a.exam_mode || '—' },
    { label: 'Authority', value: a.conducting_authority || '—' },
    { label: 'Eligibility', value: a.eligibility || '—' },
    { label: 'Exam Pattern', value: (typeof a.exam_pattern === 'object' && a.exam_pattern !== null ? JSON.stringify(a.exam_pattern) : a.exam_pattern) || '—' },
    { label: 'Syllabus', value: a.syllabus_highlights || '—' },
    { label: 'Counseling', value: a.counseling_info || '—' },
    { label: 'Cutoff Notes', value: a.cutoff_notes || '—' },
    { label: 'Registration', value: a.registration_period || '—' },
    { label: 'Exam Period', value: a.exam_period || '—' },
    { label: 'Preparation', value: a.preparation_tips || '—' },
    { label: 'For States', value: fmtArr(a.useful_for_states) },
    { label: 'Books', value: fmtArr(a.important_books) },
    { label: 'Official URL', value: a.official_url || '—' },
    { label: 'Notification', value: a.notification_pdf_url || '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0"><h2 className="text-base font-bold text-slate-900">Exam Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right break-words">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

export default function AdminCGEntranceExams() {
  const [dropdowns, setDropdowns] = useState({ entrance_exam_type: [], entrance_exam_stream: [], exam_mode: [] });
  const [exams, setExams]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal]     = useState(null);
  const [view, setView]       = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [page, setPage]       = useState(1);
  const [perPage, setPerPage] = useState(10);
  const [toast, setToast]     = useState({msg:'',ok:true});
  const showToast = (msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast({msg:'',ok:true}),3000);};

  const openEdit = (row) => setModal(row);

  const load = useCallback(async()=>{
    setLoading(true);
    try{const{data}=await api.get('/skovo-platform-panel-admin/cg/entrance-exams');if(data.bool)setExams(data.response.exams);}catch{}
    finally{setLoading(false);}
  },[]);
  useEffect(() => {
    load();
    publicApi.get('/auth/masters', { types: 'entrance_exam_type,entrance_exam_stream,exam_mode' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, [load]);

  const doDelete=async(e)=>{
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/entrance-exams/${e.id}`);if(data.bool){showToast('Deleted.');load();}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  const TYPE_COLOR={state:'bg-blue-50 text-blue-700',national:'bg-violet-50 text-violet-700',university:'bg-amber-50 text-amber-700'};

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">Entrance Exams</h1><p className="text-sm text-slate-500 mt-1">EAMCET, ECET, JEE, NEET and more</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Exam</button>
      </div>

      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Code</Th>
                  <Th>Exam Name</Th>
                  <Th>Type</Th>
                  <Th>Stream</Th>
                  <Th>Period</Th>
                </tr>
              </thead>
              <LoadingRows cols={7} rows={5} />
            </table>
          </div>
        ) : exams.length === 0 ? (
          <EmptyState icon={BookOpen} message="No exams yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>Actions</Th>
                  <Th>Code</Th>
                  <Th>Exam Name</Th>
                  <Th>Type</Th>
                  <Th>Stream</Th>
                  <Th>Period</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {exams.slice((page-1)*perPage, page*perPage).map((e, idx) => (
                  <tr key={e.id} onClick={() => setView(e)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-xs text-slate-400 w-10">{(page-1)*perPage + idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View exam" onClick={() => setView(e)} color="indigo" />
                        <ActionBtn icon={Pencil} tooltip="Edit exam" onClick={() => openEdit(e)} color="blue" />
                        <ActionBtn icon={Trash2} tooltip="Delete exam" onClick={() => setConfirm(e)} color="red" />
                        {e.official_url && (
                          <a href={e.official_url} target="_blank" rel="noreferrer"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                            <Globe size={13}/>
                          </a>
                        )}
                      </div>
                    </Td>
                    <Td className="font-black text-slate-700 text-xs">{e.exam_code}</Td>
                    <Td><p className="font-semibold text-slate-900">{e.exam_name}</p><p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{e.eligibility}</p></Td>
                    <Td><span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${TYPE_COLOR[e.exam_type]||'bg-slate-100 text-slate-500'}`}>{e.exam_type}</span></Td>
                    <Td className="text-xs text-slate-600 capitalize">{e.for_stream}</Td>
                    <Td className="text-xs text-slate-500">{e.exam_period||'—'}</Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && exams.length > 0 && (
          <Pagination
            page={page}
            pages={Math.max(1, Math.ceil(exams.length / perPage))}
            total={exams.length}
            perPage={perPage}
            onPage={setPage}
            onPerPage={setPerPage}
          />
        )}
      </TableShell>

      {(modal==='add'||(modal&&modal.id))&&<ExamModal exam={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Exam saved!');load();}} dropdowns={dropdowns}/>}
      {view && <ExamDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.exam_name}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { doDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
