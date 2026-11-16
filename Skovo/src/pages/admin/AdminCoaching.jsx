import React, { useEffect, useState, useCallback } from 'react';
import { adminApi as api } from '../../services/api';
import { Building2, Pencil, Trash2, Plus, X, CheckCircle } from 'lucide-react';

const EMPTY = { name:'', description:'', city:'', state:'', address:'', categories:'', logo_url:'', website_url:'', contact_phone:'', contact_email:'', discount_percent:'', discount_info:'', is_verified:false, is_active:true };

function Toast({msg,ok}){if(!msg)return null;return<div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok?'bg-emerald-600 text-white':'bg-red-600 text-white'}`}>{msg}</div>;}

function Modal({title,onClose,onSave,form,setForm,saving}){
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  const field=(label,k,type='text',placeholder='',full=false)=>(
    <div className={full?'col-span-2':''}>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <input type={type} value={form[k]} onChange={e=>set(k,e.target.value)} placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
    </div>
  );
  return(
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose}/>
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-screen overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Centre Name *','name','text','e.g. Allen Career Institute',true)}
          {field('City','city','text','Kota')}
          {field('State','state','text','Rajasthan')}
          {field('Contact Phone','contact_phone','tel','+91 98765 43210')}
          {field('Contact Email','contact_email','email','info@allen.in')}
          {field('Website URL','website_url','url','https://…',true)}
          {field('Logo URL','logo_url','url','https://…',true)}
          {field('Discount %','discount_percent','number','10')}
          {field('Discount Info','discount_info','text','10% off for SKOVO users',true)}
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Categories <span className="text-slate-400 font-normal">(comma separated)</span></label>
            <input value={form.categories} onChange={e=>set('categories',e.target.value)} placeholder="JEE, NEET, Coding"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Address</label>
            <textarea rows={2} value={form.address} onChange={e=>set('address',e.target.value)} placeholder="Full address…"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Description</label>
            <textarea rows={2} value={form.description} onChange={e=>set('description',e.target.value)} placeholder="About the coaching centre…"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"/>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="cv" checked={form.is_verified} onChange={e=>set('is_verified',e.target.checked)} className="w-4 h-4 rounded"/>
            <label htmlFor="cv" className="text-sm font-medium text-slate-700">Verified Centre</label>
          </div>
          <div className="flex items-center gap-3">
            <input type="checkbox" id="ca" checked={form.is_active} onChange={e=>set('is_active',e.target.checked)} className="w-4 h-4 rounded"/>
            <label htmlFor="ca" className="text-sm font-medium text-slate-700">Active (visible to students)</label>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">{saving?'Saving…':'Save Centre'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCoaching(){
  const [centres,setCentres]=useState([]);
  const [loading,setLoading]=useState(true);
  const [page,setPage]=useState(1);
  const [pages,setPages]=useState(1);
  const [modal,setModal]=useState(null);
  const [form,setForm]=useState(EMPTY);
  const [saving,setSaving]=useState(false);
  const [toast,setToast]=useState(null);

  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3000);};
  const load=useCallback((p=1)=>{
    setLoading(true);
    api.get('/skovo-platform-panel-admin/coaching',{page:p,per_page:15}).then(({data})=>{if(data.bool){setCentres(data.response.coaching_centres||[]);setPages(data.pagination?.pages||1);}}).catch(()=>{}).finally(()=>setLoading(false));
  },[]);

  useEffect(()=>{load(1);},[]);

  const openCreate=()=>{setForm(EMPTY);setModal('create');};
  const openEdit=(c)=>{
    setForm({name:c.name||'',description:c.description||'',city:c.city||'',state:c.state||'',address:c.address||'',categories:Array.isArray(c.categories)?c.categories.join(', '):'',logo_url:c.logo_url||'',website_url:c.website_url||'',contact_phone:c.contact_phone||'',contact_email:c.contact_email||'',discount_percent:c.discount_percent||'',discount_info:c.discount_info||'',is_verified:!!c.is_verified,is_active:c.is_active!==false});
    setModal(c);
  };

  const save=async()=>{
    setSaving(true);
    try{
      const payload={...form,categories:form.categories.split(',').map(s=>s.trim()).filter(Boolean)};
      const isEdit=modal&&modal!=='create';
      const {data}=isEdit?await api.put(`/skovo-platform-panel-admin/coaching/${modal.id}`,payload):await api.post('/skovo-platform-panel-admin/coaching',payload);
      if(data.bool){showToast(isEdit?'Updated':'Created');setModal(null);load(page);}else showToast(data.response?.message||'Failed',false);
    }catch{showToast('Error',false);}finally{setSaving(false);}
  };

  const del=async(c)=>{
    if(!window.confirm(`Delete "${c.name}"?`))return;
    try{const {data}=await api.delete(`/skovo-platform-panel-admin/coaching/${c.id}`);if(data.bool){showToast('Deleted');load(page);}else showToast('Failed',false);}catch{showToast('Error',false);}
  };

  return(
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok}/>
      {modal&&<Modal title={modal==='create'?'Add Coaching Centre':'Edit Centre'} onClose={()=>setModal(null)} onSave={save} form={form} setForm={setForm} saving={saving}/>}
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-2xl font-black text-slate-900">Coaching Centres</h1><p className="text-sm text-slate-500 mt-1">Manage coaching centre listings</p></div>
        <button onClick={openCreate} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700"><Plus size={16}/>Add Centre</button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading?<div className="divide-y">{Array.from({length:5}).map((_,i)=><div key={i} className="px-6 py-4 h-14 animate-pulse bg-slate-50"/>)}</div>
        :centres.length===0?(
          <div className="flex flex-col items-center py-20 text-slate-400"><Building2 size={40} className="mb-3 text-slate-300"/><p className="font-semibold">No coaching centres yet</p></div>
        ):(
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>{['Name','Location','Categories','Contact','Verified',''].map(h=><th key={h} className="text-left px-5 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {centres.map(c=>(
                  <tr key={c.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3.5 font-medium text-slate-900 max-w-44 truncate">{c.name}</td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">{[c.city,c.state].filter(Boolean).join(', ')||'—'}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(c.categories||[]).slice(0,3).map(cat=><span key={cat} className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-lg">{cat}</span>)}
                        {(c.categories||[]).length>3&&<span className="text-xs text-slate-400">+{c.categories.length-3}</span>}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-slate-500 text-xs">{c.contact_phone||c.contact_email||'—'}</td>
                    <td className="px-5 py-3.5">{c.is_verified?<CheckCircle size={16} className="text-emerald-500"/>:<span className="text-xs text-slate-400">—</span>}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <button onClick={()=>openEdit(c)} className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg"><Pencil size={15}/></button>
                        <button onClick={()=>del(c)} className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg"><Trash2 size={15}/></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pages>1&&(<div className="flex justify-center gap-2 mt-6"><button disabled={page===1} onClick={()=>{setPage(p=>p-1);load(page-1);}} className="px-4 py-2 text-sm font-medium border border-slate-200 rounded-xl disabled:opacity-40 hover:bg-slate-50">← Prev</button><span className="px-4 py-2 text-sm text-slate-500">Page {page} of {pages}</span><button disabled={page===pages} onClick={()=>{setPage(p=>p+1);load(page+1);}} className="px-4 py-2 text-sm font-medium border border-slate-200 rounded-xl disabled:opacity-40 hover:bg-slate-50">Next →</button></div>)}
    </div>
  );
}

