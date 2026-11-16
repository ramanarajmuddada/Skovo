import React, { useEffect, useState, useCallback } from 'react';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import { FileText, Plus, Pencil, Trash2, X, Check, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

function ContentDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const arr = v => Array.isArray(v) ? (v.length ? v.join(', ') : '—') : (v || '—');
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—';
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Type', value: a.content_type?.replace('_', ' ') || '—' },
    { label: 'Status', value: a.is_published ? 'Published' : 'Draft' },
    { label: 'Author', value: a.author_name || '—' },
    { label: 'Audience', value: arr(a.target_audience) },
    { label: 'Tags', value: arr(a.tags) },
    { label: 'Summary', value: a.summary || '—' },
    { label: 'Views', value: a.view_count || 0 },
    { label: 'Created', value: fmtDate(a.created_at) },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Content Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5 overflow-y-auto"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-start justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 pt-3 flex gap-3 shrink-0">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

function Toast({ msg, ok }) {
  const { lists } = useMasters(['cg_audience', 'cg_content_type']);
  const CONTENT_TYPES = [...(lists.cg_content_type || []).map(o => o.value)];
  const AUDIENCES = [...(lists.cg_audience || []).map(o => o.value)];
  if (!msg) return null;
  return <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok?'bg-emerald-600':'bg-red-600'} text-white`}>{ok?<Check size={15}/>:<X size={15}/>} {msg}</div>;
}

// CONTENT_TYPES comes from master data (masters.cg_content_type).
// AUDIENCES comes from master data (masters.cg_audience).

const empty = { content_type:'article', title:'', body:'', summary:'', tags:'', target_audience:'', author_name:'', thumbnail_url:'', is_published:false };

function ContentModal({ item, onClose, onSaved }) {
  const { lists } = useMasters(['cg_audience', 'cg_content_type']);
  const CONTENT_TYPES = [...(lists.cg_content_type || []).map(o => o.value)];
  const AUDIENCES = [...(lists.cg_audience || []).map(o => o.value)];
  const editing = !!item?.id;
  const [form, setForm] = useState(editing?{...item,tags:Array.isArray(item.tags)?item.tags.join(', '):'',target_audience:Array.isArray(item.target_audience)?item.target_audience.join(', '):''}:{...empty});
  const [saving, setSaving]=useState(false);
  const [error, setError]=useState('');
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));

  const handleSave=async()=>{
    if(!form.title){setError('Title required.');return;}
    setSaving(true);setError('');
    const toArr=s=>s?s.split(',').map(x=>x.trim()).filter(Boolean):[];
    const payload={...form,tags:toArr(form.tags),target_audience:toArr(form.target_audience)};
    try{
      const res=editing?await api.put(`/skovo-platform-panel-admin/cg/content/${item.id}`,payload):await api.post('/skovo-platform-panel-admin/cg/content',payload);
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
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><FileText size={16} style={{color:'var(--accent)'}}/>{editing?'Edit Content':'Add Content'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {error&&<div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div><label className={lbl}>Type</label><FormSelect searchType="cg_content_type"
  value={form.content_type}
  onChange={v => set('content_type',v)}
  options={CONTENT_TYPES.map(t => ({ value: t, label: t }))}
  clearable={false} /></div>
            <div><label className={lbl}>Author Name</label><input className={inp} value={form.author_name} onChange={e=>set('author_name',e.target.value)} placeholder="Admin"/></div>
          </div>
          <div><label className={lbl}>Title *</label><input className={inp} value={form.title} onChange={e=>set('title',e.target.value)} placeholder="Article title"/></div>
          <div><label className={lbl}>Summary</label><textarea className={inp} rows={2} value={form.summary} onChange={e=>set('summary',e.target.value)} placeholder="Short description"/></div>
          <div><label className={lbl}>Body (full content)</label><textarea className={inp} rows={8} value={form.body} onChange={e=>set('body',e.target.value)} placeholder="Write the full article here…"/></div>
          <div><label className={lbl}>Tags (comma separated)</label><input className={inp} value={form.tags} onChange={e=>set('tags',e.target.value)} placeholder="eamcet, colleges, AP"/></div>
          <div>
            <label className={lbl}>Target Audience (comma separated)</label>
            <input className={inp} value={form.target_audience} onChange={e=>set('target_audience',e.target.value)} placeholder="10th, intermediate, btech"/>
            <p className="text-xs text-slate-400 mt-1">Options: {AUDIENCES.join(', ')}</p>
          </div>
          <div><label className={lbl}>Thumbnail URL</label><input className={inp} value={form.thumbnail_url} onChange={e=>set('thumbnail_url',e.target.value)}/></div>
          <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={form.is_published} onChange={e=>set('is_published',e.target.checked)} className="rounded"/> Publish immediately</label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}>{saving?'Saving…':editing?'Update':'Publish'}</button>
        </div>
      </div>
    </div>
  );
}

const TYPE_COLOR={article:'bg-blue-50 text-blue-700',blog:'bg-violet-50 text-violet-700',notification:'bg-amber-50 text-amber-700',announcement:'bg-red-50 text-red-700',exam_update:'bg-emerald-50 text-emerald-700'};
const fmt=d=>d?new Date(d).toLocaleDateString('en-IN',{dateStyle:'medium'}):'"';

export default function AdminCGContent() {
  const { lists } = useMasters(['cg_audience', 'cg_content_type']);
  const CONTENT_TYPES = [...(lists.cg_content_type || []).map(o => o.value)];
  const AUDIENCES = [...(lists.cg_audience || []).map(o => o.value)];
  const [items, setItems]=useState([]);
  const [loading, setLoading]=useState(true);
  const [page, setPage]=useState(1);
  const [pages, setPages]=useState(1);
  const [total, setTotal]=useState(0);
  const [perPage, setPerPage]=useState(20);
  const [typeFilter, setType]=useState('');
  const [modal, setModal]=useState(null);
  const [view, setView]=useState(null);
  const [confirm, setConfirm]=useState(null);
  const [toast, setToast]=useState({msg:'',ok:true});
  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast({msg:'',ok:true}),3000);};

  const load=useCallback(async(p=1)=>{
    setLoading(true);
    try{const params={page:p};if(typeFilter)params.type=typeFilter;const{data}=await api.get('/skovo-platform-panel-admin/cg/content',params);if(data.bool){setItems(data.response.items);setPage(data.pagination.page);setPages(data.pagination.pages);if(data.pagination.total!=null)setTotal(data.pagination.total);if(data.pagination.per_page!=null)setPerPage(data.pagination.per_page);}}catch{}
    finally{setLoading(false);}
  },[typeFilter]);
  useEffect(()=>{load(1);},[load]);

  const handleDelete=async(c)=>{
    try{const{data}=await api.delete(`/skovo-platform-panel-admin/cg/content/${c.id}`);if(data.bool){showToast('Deleted.');load(1);}else showToast('Failed.',false);}catch{showToast('Error.',false);}
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok}/>
      <div className="flex items-center justify-between mb-6 gap-4">
        <div><h1 className="text-2xl font-bold text-slate-900">CG Content</h1><p className="text-sm text-slate-500 mt-1">Blogs, articles, notifications & announcements</p></div>
        <button onClick={()=>setModal('add')} className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl" style={{backgroundColor:'var(--accent)'}}><Plus size={15}/> Add Content</button>
      </div>
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={()=>setType('')} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border ${!typeFilter?'text-white border-transparent':'bg-white border-slate-200 text-slate-600'}`} style={!typeFilter?{backgroundColor:'var(--accent)'}:{}}>All</button>
        {CONTENT_TYPES.map(t=><button key={t} onClick={()=>setType(t)} className={`px-3 py-1.5 rounded-xl text-xs font-semibold border capitalize ${typeFilter===t?'text-white border-transparent':'bg-white border-slate-200 text-slate-600'}`} style={typeFilter===t?{backgroundColor:'var(--accent)'}:{}}>{t.replace('_',' ')}</button>)}
      </div>
      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Status</Th>
                <Th>Audience</Th>
                <Th>Views</Th>
                <Th>Date</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={8} />
            ) : items.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={8}>
                    <EmptyState icon={FileText} message="No content yet" />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {items.map((c, idx) => (
                  <tr key={c.id} onClick={() => setView(c)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td className="text-slate-400 text-xs">{(page - 1) * perPage + idx + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setView(c)} />
                        <ActionBtn icon={Pencil} tooltip="Edit content" color="blue" onClick={() => setModal(c)} />
                        <ActionBtn icon={Trash2} tooltip="Delete content" color="red" onClick={() => setConfirm(c)} />
                      </div>
                    </Td>
                    <Td><p className="font-semibold text-slate-900 max-w-64 truncate">{c.title}</p><p className="text-xs text-slate-400 mt-0.5 truncate max-w-64">{c.summary}</p></Td>
                    <Td><span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${TYPE_COLOR[c.content_type]||'bg-slate-100 text-slate-500'}`}>{c.content_type?.replace('_',' ')}</span></Td>
                    <Td><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.is_published?'bg-emerald-50 text-emerald-700':'bg-slate-100 text-slate-500'}`}>{c.is_published?'Published':'Draft'}</span></Td>
                    <Td className="text-xs text-slate-500">{Array.isArray(c.target_audience)?c.target_audience.join(', '):'all'}</Td>
                    <Td className="text-xs text-slate-500"><span className="flex items-center gap-1"><Eye size={11}/>{c.view_count||0}</span></Td>
                    <Td className="text-xs text-slate-400 whitespace-nowrap">{fmt(c.created_at)}</Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && items.length > 0 && (
          <Pagination page={page} pages={pages} total={total || items.length} perPage={perPage} onPage={(p) => load(p)} onPerPage={() => {}} />
        )}
      </TableShell>
      {(modal==='add'||(modal&&modal.id))&&<ContentModal item={modal==='add'?null:modal} onClose={()=>setModal(null)} onSaved={()=>{showToast('Saved!');load(1);}}/>}
      {view && <ContentDetailModal item={view} onClose={() => setView(null)} onEdit={(c) => setModal(c)} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.title}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { handleDelete(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}
    </div>
  );
}
