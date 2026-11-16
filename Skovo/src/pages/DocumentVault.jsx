import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api, mediaUrl, mediaDownloadUrl } from '../services/api';
import { useDialogPanel } from '../components/ui/useDialogPanel';
import { useMasters } from '../hooks/useMasters';
import { Input, FormSelect, FilePicker, StudentPage, PageHeader, SearchBar, Toast, Button } from '../components/ui/index.jsx';
import { Th, Td, LoadingRows, EmptyState, ActionBtn, ConfirmModal, ResponsiveTable, RowCard, LoadError } from '../components/ui/TableComponents';
import { fieldErrors, vaultDocument, vaultPublicProfile } from '../schemas/student';
import ProUpgradeBanner, { TakeProLink } from '../components/ProUpgradeBanner.jsx';
import { FolderOpen, Plus, Trash2, Download, FileText, Image, Link2, Eye, X, Pencil, Globe, Copy, Check, Crown, ExternalLink, AlertCircle } from 'lucide-react';

const CAT_COLOR = {
  general: 'bg-slate-100 text-slate-600', resume: 'bg-blue-100 text-blue-600',
  certificate: 'bg-yellow-100 text-yellow-700', marksheet: 'bg-green-100 text-green-700',
  id_proof: 'bg-purple-100 text-purple-600', sop: 'bg-orange-100 text-orange-600',
  lor: 'bg-pink-100 text-pink-600', other: 'bg-gray-100 text-gray-500',
};
// "application/pdf" -> "PDF", "image/jpeg" -> "JPEG": the short name people know.
const fileKind = (t) => (t ? (String(t).split('/').pop().split(/[.+;]/)[0] || t).toUpperCase() : '—');
const shortDate = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

const EMPTY ={ name: '', file_url: '', file_type: '', category: 'general', tags: '' };

const viewUrl = (d) => mediaUrl(d?.file_url);
const downloadUrl = (d) =>
  d?.download_url ? mediaUrl(d.download_url) : mediaDownloadUrl(d?.file_url, d?.name);

const previewKind = (d) => {
  const url = viewUrl(d) || '';
  const ext = (url.split('?')[0].split('.').pop() || '').toLowerCase();
  const hint = `${d?.file_type || ''} ${ext}`.toLowerCase();
  if (/(png|jpg|jpeg|gif|webp|bmp|svg|image)/.test(hint)) return 'image';
  if (/pdf/.test(hint)) return 'pdf';
  return 'none';
};

function DocumentPreview({ item: a }) {
  const [failed, setFailed] = useState(false);
  const kind = previewKind(a);
  const url = viewUrl(a);

  if (!url) {
    return (
      <div className="flex items-center gap-2 px-4 py-6 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-500">
        <AlertCircle size={16} className="text-slate-400 shrink-0" />
        This document has no file attached.
      </div>
    );
  }

  if (failed) {
    return (
      <div className="px-4 py-6 rounded-xl bg-amber-50 border border-amber-200">
        <div className="flex items-start gap-2">
          <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-amber-900">This file could not be loaded.</p>
            <p className="text-xs text-amber-700 mt-1">
              It may have been removed from storage. Edit the document and upload it
              again to restore it — the details below are unaffected.
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (kind === 'image') {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
        <img
          src={url}
          alt={a.name || 'Document'}
          onError={() => setFailed(true)}
          className="max-h-72 w-auto object-contain"
        />
      </div>
    );
  }

  if (kind === 'pdf') {
    return (
      <object data={url} type="application/pdf" className="w-full h-72 rounded-xl border border-slate-200">
        <div className="flex items-center gap-2 px-4 py-6 text-sm text-slate-500">
          <FileText size={16} className="text-slate-400 shrink-0" />
          Your browser cannot show PDFs inline — use Open or Download below.
        </div>
      </object>
    );
  }

  return (
    <div className="flex items-center gap-3 px-4 py-6 rounded-xl bg-slate-50 border border-slate-200">
      <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
        <FileText size={16} className="text-slate-400" />
      </div>
      <p className="text-sm text-slate-500">
        No inline preview for this file type. Open or download it below.
      </p>
    </div>
  );
}

function DocumentDetailModal({ item: a, onClose }) {
  const viewDialog = useDialogPanel({ onClose, open: !!a });
  if (!a) return null;
  const rows = [
    { label: 'Name', value: a.name || '\u2014' },
    { label: 'Category', value: (a.category || '\u2014').replace(/_/g, ' ') },
    { label: 'File Type', value: fileKind(a.file_type) },
    { label: 'Tags', value: a.tags?.length ? a.tags.join(', ') : '\u2014' },
    { label: 'Added', value: shortDate(a.created_at) },
  ];
  const view = viewUrl(a);
  const download = downloadUrl(a);
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div {...viewDialog.panelProps}
           className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-md max-h-[92dvh] flex flex-col overflow-hidden focus:outline-none">
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 {...viewDialog.titleProps} className="text-base font-bold text-slate-900">Document Details</h2>
          <button type="button" onClick={onClose} aria-label="Close document details" className="min-h-11 min-w-11 p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5 space-y-4 overflow-y-auto">
          <DocumentPreview item={a} />
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex flex-col sm:flex-row gap-2 shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {view && (
            <a href={view} target="_blank" rel="noreferrer"
               className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5">
              <ExternalLink size={14} /> Open
            </a>
          )}
          {download && (
            <a href={download} download
               className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-600 hover:bg-amber-100 transition-colors flex items-center justify-center gap-1.5">
              <Download size={14} /> Download
            </a>
          )}
          <button type="button" onClick={onClose} className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

function PublicProfileCard() {
  const [cfg, setCfg] = useState(null);
  const [slug, setSlug] = useState('');
  const [headline, setHeadline] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState('');
  const [copied, setCopied] = useState(false);
  const [errs, setErrs] = useState({});

  useEffect(() => {
    api.get('/document-vault/public-profile')
      .then(({ data }) => {
        if (data.bool) {
          setCfg(data.response);
          setSlug(data.response.slug || '');
          setHeadline(data.response.headline || '');
          setEnabled(data.response.is_enabled !== false);
        }
      })
      .catch(() => {});
  }, []);

  if (!cfg) return null;

  const base = `${window.location.origin}/p/`;
  const save = async (e) => {
    e?.preventDefault?.();
    const parsed = vaultPublicProfile.safeParse({ slug, headline });
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setMsg('');
      return;
    }
    setErrs({});
    setSaving(true); setMsg('');
    try {
      const { data } = await api.put('/document-vault/public-profile', {
        slug: parsed.data.slug, headline: parsed.data.headline, is_enabled: enabled,
      });
      if (data.bool) { setMsg('Saved.'); setCfg({ ...cfg, slug: data.response.slug }); }
      else setMsg(data.response?.message || 'Could not save.');
    } catch { setMsg('Could not save.'); } finally { setSaving(false); }
  };
  const copy = () => {
    navigator.clipboard?.writeText(base + (cfg.slug || slug));
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };

  // Free members: nothing here. The usage banner above already says the public
  // link comes with Pro -- a second "Take Skovo Pro" card right under it was
  // the same advert twice.
  if (!cfg.is_pro) return null;

  return (
    <form onSubmit={save} noValidate className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Globe size={16} style={{ color: 'var(--accent)' }} />
        <h3 className="font-bold text-slate-900 text-sm">Public profile link</h3>
      </div>
      <div>
        <label className="block text-xs font-semibold text-slate-500 mb-1">Your link</label>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 shrink-0">{base}</span>
          <input value={slug} onChange={(e) => { setSlug(e.target.value); setErrs((x) => ({ ...x, slug: undefined })); }}
                 placeholder="your-name" aria-invalid={errs.slug ? true : undefined}
                 className={`flex-1 min-w-0 min-h-11 px-3 py-2 border rounded-lg text-sm focus:outline-none ${errs.slug ? 'field-error border-red-300' : 'border-slate-200'}`} />
          {cfg.slug && (
            <button type="button" onClick={copy} title="Copy link" className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50 transition-colors shrink-0">
              {copied ? <Check size={15} className="text-emerald-600" /> : <Copy size={15} />}
            </button>
          )}
        </div>
        {errs.slug && <p className="text-xs text-red-600 mt-1">{errs.slug}</p>}
      </div>
      <Input
        label="Headline"
        value={headline}
        onChange={(e) => { setHeadline(e.target.value); setErrs((x) => ({ ...x, headline: undefined })); }}
        placeholder="Enter a short headline"
        error={errs.headline}
      />
      <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer min-h-11">
        <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)}
               className="w-4 h-4 rounded" style={{ accentColor: 'var(--accent)' }} />
        Profile is live
      </label>
      <p className="text-xs text-slate-400">
        Only documents you mark public appear here. Toggle a document&apos;s visibility from its menu.
      </p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving} className="min-h-11">
          {saving ? 'Saving…' : 'Save link'}
        </Button>
        {msg && <span className="text-xs text-slate-500">{msg}</span>}
      </div>
    </form>
  );
}

export default function DocumentVault() {
  const { lists } = useMasters(['document_category']);
  const CATEGORIES = lists.document_category || [];
  const catLabel = (v) => {
    const hit = CATEGORIES.find((o) => o.value === v);
    return hit?.label || String(v || '').replace(/_/g, ' ');
  };

  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [errs, setErrs] = useState({});
  const [needsPro, setNeedsPro] = useState(false);
  const [editOrig, setEditOrig] = useState(null);
  const [uploadSeq, setUploadSeq] = useState(0);
  const formDialog = useDialogPanel({ onClose: () => setModal(false), open: modal });
  const [meta, setMeta] = useState(null);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const setField = (k) => (v) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrs((e) => ({ ...e, [k]: undefined }));
  };

  const uploadFile = async (file, { onProgress, signal }) => {
    const fd = new FormData();
    fd.append('file', file);
    const { data } = await api.upload('/upload/', fd, { onProgress, signal });
    if (!data.bool) throw new Error(data.response?.message || 'Upload failed.');

    const ext = (file.name.split('.').pop() || '').toLowerCase();
    setForm((f) => ({
      ...f,
      file_url: data.response.url,
      file_type: f.file_type || ext,
      name: f.name || file.name.replace(/\.[^.]+$/, ''),
    }));
    setErrs((e) => ({ ...e, file_url: undefined, name: undefined }));
    setUploadSeq((n) => n + 1);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = filter !== 'all' ? `?category=${filter}` : '';
      const { data } = await api.get(`/document-vault/${params}`);
      if (data.bool) {
        setDocs(data.response.documents || []);
        setMeta({
          is_pro: data.response.is_pro, used: data.response.used,
          limit: data.response.limit, remaining: data.response.remaining,
        });
      } else {
        setDocs([]);
        setError(data.response?.message || 'Could not load your documents.');
      }
    } catch {
      setDocs([]);
      setError('Could not reach the server. Check your connection and try again.');
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]); // eslint-disable-line react-hooks/exhaustive-deps

  const openAdd = () => {
    setEditId(null); setEditOrig(null); setForm(EMPTY);
    setFormError(''); setErrs({}); setNeedsPro(false); setModal(true);
  };

  const toggleVisibility = async (d) => {
    const next = !d.is_public;
    setDocs((prev) => prev.map((x) => x.id === d.id ? { ...x, is_public: next } : x));
    try {
      await api.put(`/document-vault/${d.id}/visibility`, { is_public: next });
    } catch {
      setDocs((prev) => prev.map((x) => x.id === d.id ? { ...x, is_public: !next } : x));
    }
  };

  const openEdit = (d) => {
    setEditId(d.id);
    setFormError(''); setErrs({}); setNeedsPro(false);
    setEditOrig({
      file_url: d.stored_file_url || d.file_url || '',
      file_type: d.file_type || '',
    });
    setForm({
      name: d.name || '', file_url: d.stored_file_url || d.file_url || '', file_type: d.file_type || '',
      category: d.category || 'general',
      tags: Array.isArray(d.tags) ? d.tags.join(', ') : (d.tags || ''),
    });
    setModal(true);
  };

  const save = async (e) => {
    e?.preventDefault?.();
    const parsed = vaultDocument.safeParse(form);
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setFormError('');
      return;
    }
    setErrs({});
    setFormError('');
    setNeedsPro(false);
    setSaving(true);
    try {
      const tags = parsed.data.tags.split(',').map((t) => t.trim()).filter(Boolean);
      const body = { ...parsed.data, tags };
      if (editId && editOrig
          && body.file_url === editOrig.file_url
          && body.file_type === editOrig.file_type) {
        delete body.file_url;
        delete body.file_type;
      }
      const { data } = editId
        ? await api.put(`/document-vault/${editId}`, body)
        : await api.post('/document-vault/', body);
      if (data.bool) {
        setModal(false); setEditId(null); setForm(EMPTY); setFormError('');
        flash(editId ? 'Document saved.' : 'Document added.');
        load();
      } else if (data.response?.requires_pro) {
        setNeedsPro(true);
        setFormError(data.response?.message || 'Take Skovo Pro to store more documents.');
        setMeta((m) => (m ? { ...m, remaining: 0, used: data.response.upgrade?.used ?? m.used } : m));
      } else {
        setFormError(data.response?.message || 'Could not save document.');
      }
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
    }
    setSaving(false);
  };

  const remove = async (id) => {
    try {
      const { data } = await api.delete(`/document-vault/${id}`);
      if (!data.bool) flash(data.response?.message || 'Could not delete that document.', 'error');
      else flash('Document deleted.');
      load();
    } catch {
      flash('Could not reach the server. Check your connection and try again.', 'error');
    }
    setConfirm(null);
  };

  const getFileIcon = (type) => {
    if (!type) return FileText;
    if (type.includes('image')) return Image;
    if (type.includes('pdf') || type.includes('doc')) return FileText;
    return Link2;
  };

  const q = search.trim().toLowerCase();
  const visible = !q ? docs : docs.filter((d) =>
    `${d.name} ${d.file_type || ''} ${(d.tags || []).join(' ')} ${d.category || ''}`.toLowerCase().includes(q));

  const actionBtns = (d) => (
    <span className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <ActionBtn icon={Eye} tooltip="View document" color="indigo" onClick={() => setView(d)} />
      <ActionBtn
        icon={Globe}
        tooltip={d.is_public ? 'Public — on your profile' : 'Private — make public'}
        color={d.is_public ? 'green' : 'slate'}
        onClick={() => toggleVisibility(d)}
      />
      <ActionBtn icon={Pencil} tooltip="Edit document" color="slate" onClick={() => openEdit(d)} />
      {d.file_url && (
        <ActionBtn icon={Download} tooltip="Download" color="amber"
          onClick={() => window.open(downloadUrl(d), '_blank', 'noopener')} />
      )}
      <ActionBtn icon={Trash2} tooltip="Delete document" color="red" onClick={() => setConfirm(d)} />
    </span>
  );

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Document Vault"
        subtitle="Store the files you need for applications, in one place"
        action={
          <Button type="button" onClick={openAdd} className="min-h-11">
            <Plus size={16} /> Add Document
          </Button>
        }
      />

      {meta && (meta.is_pro ? (
        <div className="text-xs font-semibold px-4 py-2.5 rounded-xl border"
             style={{ color: 'var(--accent)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)',
                      background: 'color-mix(in srgb, var(--accent) 8%, transparent)' }}>
          Skovo Pro · unlimited document storage
        </div>
      ) : (
        <ProUpgradeBanner
          used={meta.used}
          limit={meta.limit}
          noun={meta.limit === 1 ? 'document' : 'documents'}
          extra="A public profile link is included with Skovo Pro."
        />
      ))}

      <PublicProfileCard />

      <div className="flex flex-col gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          placeholder="Search documents by name"
          className="max-w-xl"
        />
        {CATEGORIES.length > 0 && (
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Document folder">
            {[{ value: 'all', label: 'All' }, ...CATEGORIES].map((opt) => {
              const value = opt.value ?? opt;
              const label = opt.label ?? catLabel(opt);
              const on = filter === value;
              return (
                <button key={value} type="button" onClick={() => setFilter(value)}
                  aria-pressed={on}
                  className={`px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border transition-colors ${
                    on ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                  style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {!loading && error && (
        <LoadError what="your documents" message={error} onRetry={load} />
      )}

      {!loading && !error && visible.length === 0 && (
        q || filter !== 'all' ? (
          <EmptyState icon={FolderOpen} message="No matching documents" sub="Try a different name or folder." />
        ) : (
          <EmptyState
            icon={FolderOpen}
            message="No documents yet"
            sub="Add a resume, marksheet or ID — they stay here for applications."
            action={<Button type="button" onClick={openAdd}><Plus size={15} /> Add Document</Button>}
          />
        )
      )}

      {(loading || (!error && visible.length > 0)) && (
      <ResponsiveTable
        cards={
          loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
              ))
            : visible.map((d) => (
                  <RowCard
                    key={d.id}
                    onClick={() => setView(d)}
                    title={d.name}
                    subtitle={catLabel(d.category) || undefined}
                    action={actionBtns(d)}
                    fields={[
                      { label: 'Type', value: fileKind(d.file_type) },
                      { label: 'Tags', value: d.tags?.length ? d.tags.join(', ') : null },
                      { label: 'Added', value: d.created_at ? shortDate(d.created_at) : null },
                    ]}
                  />
                ))
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Name</Th>
                <Th>Category</Th>
                <Th>Type</Th>
                <Th>Tags</Th>
                <Th>Added</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={7} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {visible.map((d, idx) => {
                  const Icon = getFileIcon(d.file_type);
                  return (
                    <tr key={d.id} onClick={() => setView(d)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td>{idx + 1}</Td>
                      <Td>{actionBtns(d)}</Td>
                      <Td>
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)', color: 'var(--accent)' }}>
                            <Icon size={14} />
                          </div>
                          <span className="font-semibold text-slate-900 truncate max-w-xs">{d.name}</span>
                        </div>
                      </Td>
                      <Td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[d.category] || ''}`}>
                          {catLabel(d.category)}
                        </span>
                      </Td>
                      <Td><span className="text-slate-500 text-xs">{fileKind(d.file_type)}</span></Td>
                      <Td>
                        {d.tags?.length > 0 ? (
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {d.tags.map((t, i) => <span key={i} className="px-2 py-0.5 bg-slate-50 text-slate-500 rounded-full text-xs">{t}</span>)}
                          </div>
                        ) : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                      <Td><span className="text-xs text-slate-400">{shortDate(d.created_at)}</span></Td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        }
      />
      )}

      {modal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setModal(false)}>
          <div {...formDialog.panelProps}
               className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-md p-5 sm:p-6 space-y-4 focus:outline-none max-h-[92dvh] overflow-y-auto"
               style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}
               onClick={(e) => e.stopPropagation()}>
            <h2 {...formDialog.titleProps} className="font-bold text-slate-900">{editId ? 'Edit Document' : 'Add Document'}</h2>
            <form id="vault-document" onSubmit={save} noValidate className="space-y-3">
              <Input label="Document name" required placeholder="Enter document name"
                value={form.name} onChange={(e) => setField('name')(e.target.value)}
                error={errs.name} />
              <Input label="File URL / link" required type="url" placeholder="Enter file URL or Drive link"
                value={form.file_url} onChange={(e) => setField('file_url')(e.target.value)}
                error={errs.file_url} />
              <FilePicker
                key={uploadSeq}
                onUpload={uploadFile}
                label="Upload from device"
                hint="Click to choose, or drag a file here — fills the link above"
              />
              {form.file_url && (
                <p className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <Check size={12} /> File ready to save
                </p>
              )}
              <p className="text-xs text-slate-400">Or paste a link (Google Drive, etc.) in the field above.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Input label="File type" placeholder="Enter file type"
                  value={form.file_type} onChange={(e) => setField('file_type')(e.target.value)}
                  error={errs.file_type} />
                <FormSelect searchType="document_category" label="Category" clearable={false}
                  value={form.category} onChange={setField('category')}
                  options={CATEGORIES.map((c) => ({ value: c.value, label: c.label || catLabel(c.value) }))}
                  error={errs.category} />
              </div>
              <Input label="Tags" placeholder="Enter tags, separated by commas"
                hint="Separate with commas."
                value={form.tags} onChange={(e) => setField('tags')(e.target.value)}
                error={errs.tags} />
            </form>
            {formError && (
              <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-red-50 border border-red-200">
                <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                <p className="text-xs text-red-700">
                  {formError}
                  {needsPro && <span className="block mt-2"><TakeProLink>Take Skovo Pro</TakeProLink></span>}
                </p>
              </div>
            )}
            <div className="flex flex-col-reverse sm:flex-row gap-3 pt-2">
              <Button type="button" variant="secondary" className="flex-1 min-h-11"
                onClick={() => { setModal(false); setEditId(null); setFormError(''); }}>Cancel</Button>
              <Button type="submit" form="vault-document" disabled={saving} className="flex-1 min-h-11">
                {saving ? 'Saving…' : (editId ? 'Save Changes' : 'Add Document')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {view && <DocumentDetailModal item={view} onClose={() => setView(null)} />}

      {confirm && (
        <ConfirmModal
          message="Delete this document?"
          detail={confirm.name}
          danger
          confirmLabel="Delete"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </StudentPage>
  );
}
