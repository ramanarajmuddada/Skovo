import React, { useEffect, useState } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { Tag, Trash2, Plus, Pencil, X, Eye, ToggleLeft, ToggleRight, Type, Link2, AlignLeft, Hash, AlertCircle, Search } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import FormSelect from '../../components/ui/FormSelect';
import StatTile from '../../components/admin/StatTile';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { FolderTree, CheckCircle2, PowerOff } from 'lucide-react';

// Domains are a tree: 30 groups (Engineering, Medical, ITI…) with their
// specialisations underneath. These helpers turn the flat API list back into
// that shape for the group picker, the "Group" column and the parent field.
function domainTree(domains) {
  const byId = new Map(domains.map(d => [d.id, d]));
  const path = (d) => {
    const names = [];
    let p = byId.get(d.parent_id);
    for (let guard = 0; p && guard < 10; guard++) { names.unshift(p.name); p = byId.get(p.parent_id); }
    return names.join(' › ');
  };
  const rootId = (d) => {
    let cur = d;
    for (let guard = 0; cur?.parent_id && byId.has(cur.parent_id) && guard < 10; guard++) cur = byId.get(cur.parent_id);
    return cur?.id;
  };
  // Every id at or under `id` — what a parent picker must not offer, or the
  // tree would loop.
  const subtree = (id) => {
    const out = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const d of domains) if (d.parent_id && out.has(d.parent_id) && !out.has(d.id)) { out.add(d.id); grew = true; }
    }
    return out;
  };
  const groups = domains.filter(d => !d.parent_id || !byId.has(d.parent_id))
                        .sort((a, b) => a.name.localeCompare(b.name));
  return { path, rootId, subtree, groups };
}

const domainSchema = z.object({
  name:        z.string().min(2, 'Domain name must be at least 2 characters'),
  // Optional: a sub-domain like "Level 2" or "Welder" needs no essay. When one
  // is written it should say something, hence the minimum. Required here, it
  // blocked every edit, because no seeded domain had a description.
  description: z.union([
    z.literal(''),
    z.string().trim().min(10, 'Description must be at least 10 characters'),
  ]).nullish(),
  slug:        z.string().min(2, 'Slug is required').regex(/^[a-z0-9-]+$/, 'Slug can only contain lowercase letters, numbers, and hyphens'),
});

function Toast({msg,ok}){if(!msg)return null;return<div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok?'bg-emerald-600 text-white':'bg-red-600 text-white'}`}>{msg}</div>;}

function toSlug(str){ return str.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,''); }

const EMPTY = { name:'', slug:'', description:'', icon_url:'', is_active:true, parent_id:'' };

function DomainModal({ domain, domains = [], onClose, onSaved }) {
  const editing = !!domain?.id;
  const [form, setForm] = useState(editing ? { ...domain, parent_id: domain.parent_id || '' } : { ...EMPTY });
  // A domain cannot move under itself or anything beneath it.
  const tree = domainTree(domains);
  const blocked = editing ? tree.subtree(domain.id) : new Set();
  const parentOptions = [
    { value: '', label: 'None — it is a top-level group' },
    ...domains.filter(d => !blocked.has(d.id))
      .map(d => ({ value: d.id, label: tree.path(d) ? `${tree.path(d)} › ${d.name}` : d.name }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const [errors, setErrors] = useState({});

  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };

  const handleNameChange = (v) => {
    sf('name', v);
    if (!editing) setForm(f => ({ ...f, name: v, slug: toSlug(v) }));
  };

  const handleSave = async () => {
    const result = domainSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    setSaving(true); setApiError('');
    try {
      const res = editing
        ? await api.put(`/skovo-platform-panel-admin/domains/${domain.id}`, form)
        : await api.post('/skovo-platform-panel-admin/domains', { ...form, slug: form.slug || toSlug(form.name) });
      if (res.data.bool) { onSaved(); onClose(); }
      else setApiError(res.data.response?.message || 'Failed.');
    } catch { setApiError('Error saving domain.'); }
    finally { setSaving(false); }
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

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{editing ? 'Edit Domain' : 'Add Domain'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18}/></button>
        </div>
        <div className="p-6 space-y-4">
          {apiError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2"><AlertCircle size={14}/>{apiError}</div>}

          <div>
            <Lbl icon={Type} text="Domain Name" req />
            <div className="relative">
              <Type size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('name')}`}
                value={form.name} onChange={e => handleNameChange(e.target.value)} placeholder="e.g. Technology" autoFocus />
            </div>
            <Err f="name" />
          </div>

          <div>
            <FormSelect
              label="Parent group"
              value={form.parent_id || ''}
              onChange={v => sf('parent_id', v || '')}
              options={parentOptions}
              placeholder="Search groups…"
              clearable={false}
            />
            <p className="text-xs text-slate-400 mt-1">B.Arch sits under Architecture; Architecture has no parent.</p>
          </div>

          <div>
            <Lbl icon={Hash} text="Slug" note="(auto-generated)" />
            <div className="relative">
              <Hash size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm font-mono text-slate-600 focus:outline-none ${ic('slug')}`}
                value={form.slug} onChange={e => sf('slug', e.target.value)} placeholder="e.g. technology" />
            </div>
            <Err f="slug" />
          </div>

          <div>
            <Lbl icon={AlignLeft} text="Description" note="(optional)" />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={2} className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none resize-none ${ic('description')}`}
                value={form.description || ''} onChange={e => sf('description', e.target.value)}
                placeholder="Brief description — what careers and topics this domain covers…" />
            </div>
            <Err f="description" />
          </div>

          <div>
            <Lbl icon={Link2} text="Icon / Image URL" note="(optional)" />
            <div className="relative">
              <Link2 size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={form.icon_url || ''} onChange={e => sf('icon_url', e.target.value)} placeholder="https://cdn.example.com/icons/tech.svg" />
            </div>
          </div>

          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => sf('is_active', e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm font-medium text-slate-700">Active (visible to students)</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Update Domain' : 'Add Domain'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DomainDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Name', value: a.name || '—' },
    { label: 'Slug', value: a.slug || '—' },
    { label: 'Description', value: a.description || '—' },
    { label: 'Status', value: a.is_active ? 'Active' : 'Inactive' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Domain Details</h2>
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

export default function AdminDomains(){
  const [domains,setDomains]=useState([]);
  const [loading,setLoading]=useState(true);
  const [modal,setModal]=useState(null);
  const [toast,setToast]=useState(null);
  const [view,setView]=useState(null);
  const [confirm,setConfirm]=useState(null);
  const [page,setPage]=useState(1);
  const [perPage,setPerPage]=useState(20);
  const [tab,setTab]=useState('all');
  const [query,setQuery]=useState('');
  const [group,setGroup]=useState('');
  const tree = domainTree(domains);

  // Achiever-added domains go live straight away (achiever.py), so an inactive
  // domain is not a suggestion awaiting review any more — it is one an admin
  // switched off (retired groups, duplicates). Live ones list first.
  const offCount = domains.filter(d => !d.is_active).length;
  const inTab = tab === 'off'    ? domains.filter(d => !d.is_active)
              : tab === 'active' ? domains.filter(d => d.is_active)
              : [...domains].sort((a, b) => Number(b.is_active) - Number(a.is_active));
  // 216 domains — finding one by paging through is not a workflow.
  const inGroup = group ? inTab.filter(d => tree.rootId(d) === group) : inTab;
  const q = query.trim().toLowerCase();
  const shown = q
    ? inGroup.filter(d => `${d.name} ${d.slug || ''} ${tree.path(d)}`.toLowerCase().includes(q))
    : inGroup;

  const showToast=(msg,ok=true)=>{setToast({msg,ok});setTimeout(()=>setToast(null),3000);};

  const load=()=>{
    setLoading(true);
    api.get('/skovo-platform-panel-admin/domains').then(({data})=>{if(data.bool)setDomains(data.response.domains);}).catch(()=>{}).finally(()=>setLoading(false));
  };

  useEffect(()=>{load();},[]);

  const toggleActive = async (d) => {
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/domains/${d.id}`, { is_active: !d.is_active });
      if (data.bool) { showToast(d.is_active ? 'Disabled' : 'Enabled'); load(); }
      else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const doDelete=async(d)=>{
    try{const {data}=await api.delete(`/skovo-platform-panel-admin/domains/${d.id}`);if(data.bool){showToast('Deleted');load();}else showToast('Failed',false);}catch{showToast('Error',false);}
  };

  return(
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok}/>
      {modal && <DomainModal domain={modal === 'add' ? null : modal} domains={domains} onClose={() => setModal(null)} onSaved={() => { showToast('Saved'); load(); }} />}
      {view && <DomainDetailModal item={view} onClose={() => setView(null)} onEdit={(d) => setModal(d)} />}
      {confirm && (
        <ConfirmModal
          message={`Delete "${confirm.name}"?`}
          detail="This cannot be undone."
          danger
          confirmLabel="Delete"
          onConfirm={() => { doDelete(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Domains</h1>
          <p className="text-sm text-slate-500 mt-0.5">Career domains used for cohorts and achievers</p>
        </div>
        <KitButton onClick={() => setModal('add')} className="w-full sm:w-auto"><Plus size={16} /> Add domain</KitButton>
      </div>

      {/* Tiles double as the Live / Off filter; Groups is a count. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="All domains" value={domains.length} icon={Tag} tone="blue" onClick={() => { setTab('all'); setPage(1); }} active={tab === 'all'} />
        <StatTile label="Live" value={domains.length - offCount} icon={CheckCircle2} tone="emerald" onClick={() => { setTab('active'); setPage(1); }} active={tab === 'active'} />
        <StatTile label="Switched off" value={offCount} icon={PowerOff} tone="amber" onClick={() => { setTab('off'); setPage(1); }} active={tab === 'off'} />
        <StatTile label="Groups" value={tree.groups.length} icon={FolderTree} tone="violet" sub="top-level" />
      </div>

      {/* Like Masters: pick a group to see what is inside it. */}
      <div className="flex flex-col sm:flex-row sm:items-end gap-3 mb-4">
        <div className="w-full sm:w-72">
          <FormSelect
            label="Group"
            value={group}
            onChange={v => { setGroup(v || ''); setPage(1); }}
            options={[
              { value: '', label: `All groups (${domains.length})` },
              ...tree.groups.map(g => ({
                value: g.id,
                label: `${g.name} (${domains.filter(d => tree.rootId(d) === g.id).length})`,
              })),
            ]}
            placeholder="Search groups…"
            clearable={false}
          />
        </div>
        <div className="relative flex-1 sm:max-w-sm">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query} onChange={e => { setQuery(e.target.value); setPage(1); }}
            placeholder="Search domains…" aria-label="Search domains"
            className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
        </div>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>Domain</Th>
                <Th>Group</Th>
                <Th>Description</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={5} rows={5} />
            ) : shown.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={5}><EmptyState icon={Tag}
                    message={q ? `No domains match "${query.trim()}"` : tab === 'off' ? 'Nothing is switched off' : 'No domains yet'} /></td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {shown.slice((page - 1) * perPage, page * perPage).map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => setView(d)}
                    className={`transition-colors cursor-pointer hover:bg-slate-50 ${!d.is_active ? 'opacity-60' : ''}`}
                  >
                    <Td>
                      <div className="flex items-center gap-2 min-w-0">
                        {d.icon_url && <img src={d.icon_url} alt="" className="w-6 h-6 rounded-md object-cover shrink-0" />}
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 whitespace-normal min-w-28">{d.name}</p>
                          <p className="text-[11px] text-slate-400 font-mono truncate">{d.slug}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-slate-500 text-xs">{tree.path(d) || <span className="text-slate-400">Top-level group</span>}</Td>
                    <Td className="cell-wide text-slate-500 text-xs"><span className="line-clamp-2 md:line-clamp-1 md:max-w-48 xl:max-w-72">{d.description || '—'}</span></Td>
                    <Td>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border ${d.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {d.is_active ? 'Live' : 'Off'}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(d)} />
                        <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => setModal(d)} />
                        <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(d)} />
                        <ActionBtn
                          icon={d.is_active ? ToggleRight : ToggleLeft}
                          tooltip={d.is_active ? 'Switch off' : 'Switch on'}
                          color={d.is_active ? 'green' : 'default'}
                          onClick={() => toggleActive(d)}
                        />
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
          pages={Math.max(1, Math.ceil(shown.length / perPage))}
          total={shown.length}
          perPage={perPage}
          onPage={(p) => setPage(p)}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
        />
      </TableShell>
    </div>
  );
}
