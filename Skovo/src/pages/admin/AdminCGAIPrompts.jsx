import React, { useEffect, useState, useCallback } from 'react';
import { adminApi as api } from '../../services/api';
import { Brain, Plus, Pencil, Trash2, X, Check, Copy } from 'lucide-react';

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

function PromptModal({ item, onClose, onSaved }) {
  const editing = !!item?.id;
  const [form, setForm] = useState(editing?{prompt_type:item.prompt_type,prompt_text:item.prompt_text,is_active:item.is_active}:{prompt_type:'',prompt_text:'',is_active:true});
  const [saving, setSaving]=useState(false);
  const [error, setError]=useState('');

  const handleSave=async()=>{
    if(!form.prompt_type||!form.prompt_text){setError('Type and text are required.');return;}
    setSaving(true);setError('');
    try{
      const res=editing?await api.put(`/skovo-platform-panel-admin/cg/ai-prompts/${item.id}`,{prompt_text:form.prompt_text,is_active:form.is_active}):await api.post('/skovo-platform-panel-admin/cg/ai-prompts',form);
      if(res.data.bool){onSaved();onClose();}else setError(res.data.response?.message||'Failed.');
    }catch{setError('Error.');}finally{setSaving(false);}
  };

  const inp='w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';
  const lbl='block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Brain size={16} style={{color:'var(--accent)'}}/>{editing?'Edit AI Prompt':'Add AI Prompt'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          <div>
            <label className={lbl}>Prompt Type * (unique key)</label>
            <input className={inp} value={form.prompt_type} onChange={e=>setForm(f=>({...f,prompt_type:e.target.value}))} placeholder="e.g. career_guidance_main, college_predictor" disabled={editing}/>
          </div>
          <div>
            <label className={lbl}>Prompt Text *</label>
            <textarea className={inp} rows={14} value={form.prompt_text} onChange={e=>setForm(f=>({...f,prompt_text:e.target.value}))} placeholder="Write the full AI prompt here…" style={{fontFamily:'monospace',fontSize:13}}/>
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>({...f,is_active:e.target.checked}))}/> Active</label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update Prompt':'Save Prompt'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCGAIPrompts() {
  const [items, setItems]=useState([]);
  const [loading, setLoading]=useState(true);
  const [modal, setModal]=useState(null);
  const [toast, setToast]=useState({msg:'',ok:true});
  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast({msg:'',ok:true}),3000);};

  const load=useCallback(async()=>{
    setLoading(true);
    try{const{data}=await api.get('/skovo-platform-panel-admin/cg/ai-prompts');if(data.bool)setItems(data.response.prompts);}catch{}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{load();},[load]);

  const handleDelete=async(p)=>{
    if(!window.confirm(`Delete prompt "${p.prompt_type}"?`))return;
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/ai-prompts/${p.id}`);if(data.bool){showToast('Deleted.');load();}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  const copyToClipboard=(text)=>{navigator.clipboard.writeText(text);showToast('Copied to clipboard!');};

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">AI Prompts</h1><p className="text-sm text-slate-500 mt-1">Manage AI prompts that power the career guidance engine</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Prompt</button>
      </div>
      <div className="space-y-3">
        {loading?[...Array(3)].map((_,i)=><div key={i} className="h-24 bg-white rounded-2xl border border-slate-200 animate-pulse"/>)
        :items.length===0?<div className="flex flex-col items-center py-16 text-slate-400 bg-white rounded-2xl border border-slate-200"><Brain size={40} className="mb-3 opacity-30"/><p className="font-semibold text-slate-600">No prompts yet</p><p className="text-sm mt-1">Add AI prompts to power the guidance engine</p></div>
        :items.map(p=>(
          <div key={p.id} className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <span className="px-2.5 py-1 bg-violet-50 text-violet-700 text-xs font-bold rounded-lg font-mono">{p.prompt_type}</span>
                  <span className={`px-2 py-0.5 text-xs font-semibold rounded-full ${p.is_active?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{p.is_active?'Active':'Inactive'}</span>
                  <span className="text-xs text-slate-400">v{p.version}</span>
                  {p.updated_by_email&&<span className="text-xs text-slate-400">by {p.updated_by_email}</span>}
                </div>
                <p className="text-xs text-slate-500 font-mono line-clamp-3 bg-slate-50 p-3 rounded-xl border border-slate-100">{p.prompt_text}</p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={()=>copyToClipboard(p.prompt_text)} className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg" title="Copy"><Copy size={14}/></button>
                <button onClick={()=>setModal(p)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={14}/></button>
                <button onClick={()=>handleDelete(p)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={14}/></button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {(modal==='add'||(modal&&modal.id))&&<PromptModal item={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Saved!');load();}}/>}
    </div>
  );
}
