import React, { useEffect, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { Search as SearchIcon, ShieldCheck as AdminIcon, UserRound } from 'lucide-react';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { z } from 'zod';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import { Users, Trash2, Plus, Pencil, X, Eye, ToggleLeft, ToggleRight, AlertCircle, StickyNote, MessageSquare } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

function Toast({ msg, ok }) { if (!msg) return null; return <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{msg}</div>; }

const EMPTY = { name: '', description: '', category: 'general', group_type: 'public', join_type: 'open', is_active: true };

const retentionSchema = z.object({
  chat_days: z.number({ invalid_type_error: 'Enter a whole number of days for chat.' }).int().min(1, 'Chat must stay at least 1 day.').max(3650, '3650 days is the longest window.'),
  file_days: z.number({ invalid_type_error: 'Enter a whole number of days for documents.' }).int().min(1, 'Documents must stay at least 1 day.').max(3650, '3650 days is the longest window.'),
});

const scoreSchema = z.object({
  points: z.number({ invalid_type_error: 'Enter how many points to remove.' }).int().min(1, 'Remove at least 1 point.').max(100, '100 points is the most you can remove at once.'),
  reason: z.string().trim().min(3, 'Say why, in a few words.').max(500, 'Keep the reason under 500 characters.'),
});

function wholeNumber(raw) {
  const text = String(raw ?? '').trim();
  if (!/^\d+$/.test(text)) return null;
  return Number(text);
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
}

function fileLabel(url) {
  if (!url) return '';
  const clean = String(url).split('?')[0];
  const name = clean.split('/').pop();
  return name || 'File';
}
// CATEGORIES comes from master data (masters.community_category) — see hooks/useMasters.

function CommunityModal({ item, onClose, onSaved }) {
  const { lists } = useMasters(['community_category', 'community_join_policy']);
  const CATEGORIES = (lists.community_category || []).map(o => o.value);

  const editing = !!item?.id;
  const [form, setForm] = useState(editing ? { ...item } : { ...EMPTY });
  const [saving, setSaving] = useState(false);
  const [apiError, setApiError] = useState('');
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name || form.name.trim().length < 2) { setApiError('Name must be at least 2 characters.'); return; }
    setSaving(true); setApiError('');
    try {
      const res = editing
        ? await api.patch(`/skovo-platform-panel-admin/communities/${item.id}`, form)
        : await api.post('/skovo-platform-panel-admin/communities', form);
      if (res.data.bool) { onSaved(); onClose(); }
      else setApiError(res.data.response?.message || 'Failed.');
    } catch { setApiError('Error saving community.'); }
    finally { setSaving(false); }
  };

  const inputCls = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900">{editing ? 'Edit Community' : 'Create Community'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4 flex-1 overflow-y-auto">
          {apiError && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl flex items-center gap-2"><AlertCircle size={14} />{apiError}</div>}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Name <span className="text-red-500">*</span></label>
            <input className={inputCls} value={form.name} onChange={e => sf('name', e.target.value)} placeholder="e.g. GATE 2027 Aspirants" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Description</label>
            <textarea rows={2} className={`${inputCls} resize-none`} value={form.description} onChange={e => sf('description', e.target.value)} placeholder="What is this community about…" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Category</label>
              <FormSelect searchType="community_category"
                value={form.category}
                onChange={v => sf('category', v)}
                options={CATEGORIES.map(c => ({ value: c, label: c }))}
                clearable={false} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Join Type</label>
              <FormSelect searchType="community_join_policy"
                value={form.join_type}
                onChange={v => sf('join_type', v)}
                options={lists.community_join_policy || []}
                clearable={false} />
            </div>
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" checked={form.is_active} onChange={e => sf('is_active', e.target.checked)} className="w-4 h-4 rounded accent-blue-600" />
            <span className="text-sm font-medium text-slate-700">Active (visible to students in Assemble)</span>
          </label>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : editing ? 'Update' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

function RetentionCard({ value, onSaved, showToast }) {
  const [chatDays, setChatDays] = useState(value?.chat_days ?? '');
  const [fileDays, setFileDays] = useState(value?.file_days ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setChatDays(value?.chat_days ?? '');
    setFileDays(value?.file_days ?? '');
  }, [value?.chat_days, value?.file_days]);

  const save = async () => {
    const parsed = retentionSchema.safeParse({
      chat_days: wholeNumber(chatDays),
      file_days: wholeNumber(fileDays),
    });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Enter whole numbers of days.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const { data } = await api.put('/skovo-platform-panel-admin/community-retention', parsed.data);
      if (data.bool) {
        onSaved(data.response.retention);
        showToast('Retention saved. The next sweep uses these days.');
      } else setError(data.response?.message || 'Could not save.');
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
      <h2 className="text-sm font-bold text-slate-900">How long community content stays</h2>
      <p className="text-xs text-slate-500 mt-1 max-w-2xl">
        Chat posts and direct messages are deleted after the chat period. PDFs and Word documents are deleted sooner, and the file is removed from storage so the link stops opening. Change either number any time.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 max-w-xl">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1.5">Chat (days)</span>
          <input className={inputCls} inputMode="numeric" value={chatDays}
                 onChange={(e) => { setChatDays(e.target.value); setError(''); }} />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-600 mb-1.5">Documents (days)</span>
          <input className={inputCls} inputMode="numeric" value={fileDays}
                 onChange={(e) => { setFileDays(e.target.value); setError(''); }} />
        </label>
      </div>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      <button type="button" onClick={save} disabled={saving}
              className="mt-4 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
        {saving ? 'Saving…' : 'Save retention'}
      </button>
    </div>
  );
}

function TrackDrawer({ group, onClose, showToast, onChanged }) {
  const [tab, setTab] = useState('members');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [scoreFor, setScoreFor] = useState(null);
  const [points, setPoints] = useState('5');
  const [reason, setReason] = useState('');
  const [scoreError, setScoreError] = useState('');
  const [busy, setBusy] = useState('');

  const load = () => {
    setLoading(true);
    api.get(`/skovo-platform-panel-admin/communities/${group.id}/track`)
      .then(({ data: body }) => { if (body.bool) setData(body.response); })
      .catch(() => showToast('Could not load this community.', false))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [group.id]);

  const removeMember = async (member) => {
    if (!window.confirm(`Remove ${member.full_name} from ${group.name}?`)) return;
    setBusy(member.user_id);
    try {
      const { data: body } = await api.delete(`/skovo-platform-panel-admin/communities/${group.id}/members/${member.user_id}`);
      if (body.bool) { showToast('Member removed.'); load(); onChanged(); }
      else showToast(body.response?.message || 'Could not remove.', false);
    } catch { showToast('Could not remove.', false); }
    finally { setBusy(''); }
  };

  const reduceScore = async () => {
    const parsed = scoreSchema.safeParse({ points: wholeNumber(points), reason });
    if (!parsed.success) {
      setScoreError(parsed.error.issues[0]?.message || 'Check the score and the reason.');
      return;
    }
    setBusy('score');
    setScoreError('');
    try {
      const { data: body } = await api.post(`/skovo-platform-panel-admin/communities/${group.id}/score`, {
        user_id: scoreFor.user_id,
        points: parsed.data.points,
        reason: parsed.data.reason,
      });
      if (body.bool) {
        showToast(body.response?.message || 'Score reduced.');
        setScoreFor(null);
        setReason('');
      } else setScoreError(body.response?.message || 'Could not update the score.');
    } catch { setScoreError('Could not update the score.'); }
    finally { setBusy(''); }
  };

  const community = data?.community;
  const runBy = community?.run_by_kind === 'student'
    ? `${community.run_by} is this community's admin.`
    : 'Skovo Admin runs this community.';

  const tabs = [
    { key: 'members', label: 'Members', count: data?.members?.length || 0, icon: Users },
    { key: 'posts', label: 'Posts', count: data?.posts?.length || 0, icon: StickyNote },
    { key: 'messages', label: 'Messages', count: data?.messages?.length || 0, icon: MessageSquare },
  ];

  return (
    <div className="fixed inset-0 z-100 flex justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white w-full max-w-xl h-full shadow-2xl flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-100">
          <div className="min-w-0 pr-3">
            <h2 className="font-bold text-slate-900 truncate">{group.name}</h2>
            <p className="text-sm text-slate-500 mt-1">{runBy} Skovo Admin can remove anyone here, delete the community, and reduce one person's readiness score.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="px-4 sm:px-6 py-3 border-b border-slate-100">
          <Tabs tabs={tabs} active={tab} onChange={setTab} />
        </div>
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? <p className="text-sm text-slate-400">Loading…</p> : tab === 'members' ? (
            <div className="space-y-3">
              {(data?.members || []).length === 0 && <p className="text-sm text-slate-400">No members yet.</p>}
              {(data?.members || []).map((m) => (
                <div key={`${m.user_id}-${m.status}`} className="flex items-center gap-3 py-2 border-b border-slate-100">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 truncate">{m.full_name}</p>
                    <p className="text-xs text-slate-400 capitalize">{m.role || 'member'} · {m.status || 'active'}</p>
                  </div>
                  {m.status === 'active' && (
                    <button type="button" disabled={busy === m.user_id} onClick={() => removeMember(m)}
                            className="text-xs font-semibold text-red-600 px-2 py-1 rounded-lg hover:bg-red-50 disabled:opacity-40">
                      Remove
                    </button>
                  )}
                  <button type="button" onClick={() => { setScoreFor(m); setScoreError(''); }}
                          className="text-xs font-semibold text-amber-700 px-2 py-1 rounded-lg hover:bg-amber-50">
                    Reduce score
                  </button>
                </div>
              ))}
              {scoreFor && (
                <div className="mt-4 p-4 rounded-xl border border-amber-200 bg-amber-50 space-y-3">
                  <p className="text-sm font-semibold text-slate-800">Reduce {scoreFor.full_name}'s readiness score</p>
                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-600 mb-1">Points to remove</span>
                    <input className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm" inputMode="numeric" value={points}
                           onChange={(e) => { setPoints(e.target.value); setScoreError(''); }} />
                  </label>
                  <label className="block">
                    <span className="block text-xs font-semibold text-slate-600 mb-1">Reason</span>
                    <textarea rows={2} className="w-full px-3 py-2 border border-slate-200 rounded-xl text-sm resize-none" value={reason}
                              onChange={(e) => { setReason(e.target.value); setScoreError(''); }}
                              placeholder="What they did in this community" />
                  </label>
                  {scoreError && <p className="text-sm text-red-600">{scoreError}</p>}
                  <div className="flex gap-2">
                    <button type="button" onClick={reduceScore} disabled={busy === 'score'}
                            className="px-4 py-2 text-sm font-semibold bg-amber-600 text-white rounded-xl disabled:opacity-50">
                      {busy === 'score' ? 'Saving…' : 'Reduce score'}
                    </button>
                    <button type="button" onClick={() => setScoreFor(null)} className="px-4 py-2 text-sm font-semibold text-slate-600">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          ) : tab === 'posts' ? (
            <div className="space-y-3">
              {(data?.posts || []).length === 0 && <p className="text-sm text-slate-400">No posts in the current window.</p>}
              {(data?.posts || []).map((p) => (
                <div key={p.id} className="rounded-xl border border-slate-100 p-3">
                  <p className="text-xs text-slate-400">{p.author_name} · {when(p.created_at)}{p.removed ? ' · removed by author' : ''}</p>
                  {p.content && <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">{p.content}</p>}
                  {p.media_url && <p className="text-xs font-medium text-blue-700 mt-1">File: {fileLabel(p.media_url)}</p>}
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {(data?.messages || []).length === 0 && <p className="text-sm text-slate-400">No direct messages between members in the current window.</p>}
              {(data?.messages || []).map((m) => (
                <div key={m.id} className="rounded-xl border border-slate-100 p-3">
                  <p className="text-xs text-slate-400">{m.sender_name} → {m.recipient_name} · {when(m.created_at)}</p>
                  <p className="text-sm text-slate-800 mt-1 whitespace-pre-wrap">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function AdminCommunities() {
  // Labels for the phone cards; the table shows the raw values as before.
  const { lists: cardLists } = useMasters(['community_category', 'community_join_policy']);
  const labelOf = (list, v) => (cardLists[list] || []).find((o) => o.value === v)?.label || v;
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [track, setTrack] = useState(null);
  const [retention, setRetention] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [kind, setKind] = useState('');          // '' | 'admin' | 'student'
  const [q, setQ] = useState('');
  const isStudentRun = (g) => g.run_by_kind === 'student';
  const shown = items.filter((g) => (!kind || (kind === 'student' ? isStudentRun(g) : !isStudentRun(g)))
    && (!q.trim() || (g.name || '').toLowerCase().includes(q.trim().toLowerCase())));
  const pickKind = (k) => { setKind(kind === k ? '' : k); setPage(1); };

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = () => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/communities', { params: { page: 1, per_page: 500 } })
      .then(({ data }) => { if (data.bool) setItems(data.response.communities || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
    api.get('/skovo-platform-panel-admin/community-retention')
      .then(({ data }) => { if (data.bool) setRetention(data.response.retention); })
      .catch(() => {});
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (g) => {
    try {
      const { data } = await api.patch(`/skovo-platform-panel-admin/communities/${g.id}`, { is_active: !g.is_active });
      if (data.bool) { showToast(g.is_active ? 'Disabled' : 'Enabled'); load(); }
      else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  const doDelete = async (g) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/communities/${g.id}`);
      if (data.bool) { showToast('Deleted'); load(); } else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {modal && <CommunityModal item={modal === 'add' ? null : modal} onClose={() => setModal(null)} onSaved={() => { showToast('Saved'); load(); }} />}
      {track && (
        <TrackDrawer group={track} onClose={() => setTrack(null)} showToast={showToast} onChanged={load} />
      )}
      {confirm && (
        <ConfirmModal
          message={`Delete "${confirm.name}"?`}
          detail="Members leave. Chat stays visible here until the retention window deletes it."
          danger
          confirmLabel="Delete"
          onConfirm={() => { doDelete(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}

      {/* Phones: title and text full width, the button on its own row below --
          side by side, both were squeezed and the label wrapped to two lines. */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div className="min-w-0">
          <h1 className="text-2xl font-black text-slate-900">Communities</h1>
          <p className="text-sm text-slate-500 mt-0.5">Groups you create are run by Skovo Admin; student groups are run by that student, and you can still step in.</p>
        </div>
        <KitButton onClick={() => setModal('add')} className="w-full sm:w-auto shrink-0"><Plus size={16} /> Create community</KitButton>
      </div>

      {/* Tiles double as the filter; members is a total. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="All communities" value={items.length} icon={Users} tone="blue" onClick={() => pickKind('')} active={!kind} />
        <StatTile label="Run by Admin" value={items.filter((g) => !isStudentRun(g)).length} icon={AdminIcon} tone="violet" onClick={() => pickKind('admin')} active={kind === 'admin'} />
        <StatTile label="Run by students" value={items.filter(isStudentRun).length} icon={UserRound} tone="emerald" onClick={() => pickKind('student')} active={kind === 'student'} />
        <StatTile label="Members" value={items.reduce((a, g) => a + Number(g.member_count || 0), 0)} icon={Users} tone="amber" sub="across all groups" />
      </div>
      <div className="relative mb-4">
        <SearchIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} type="search" aria-label="Search communities"
               placeholder="Search communities…"
               className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <TableShell>
        {/* Phones: one card per community -- the eight-column table only fitted by
            scrolling sideways, and its 28px icons were too small to tap. */}
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? (
            <p className="p-6 text-center text-sm text-slate-400">Loading…</p>
          ) : shown.length === 0 ? (
            <EmptyState icon={Users} message={items.length ? 'No communities match.' : 'No communities yet — create one for students.'} />
          ) : shown.slice((page - 1) * perPage, page * perPage).map((g) => (
            <div key={g.id} className={`p-4 ${!g.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 pt-2 font-semibold text-slate-900 break-words">{g.name}</p>
                <div className="flex shrink-0 -mr-1">
                  <button onClick={() => setTrack(g)} aria-label="Track" className="p-2.5 text-indigo-500"><Eye size={16} /></button>
                  {!g.removed && <button onClick={() => setModal(g)} aria-label="Edit" className="p-2.5 text-blue-500"><Pencil size={16} /></button>}
                  {!g.removed && <button onClick={() => setConfirm(g)} aria-label="Delete" className="p-2.5 text-red-500"><Trash2 size={16} /></button>}
                  {!g.removed && (
                    <button onClick={() => toggleActive(g)} aria-label={g.is_active ? 'Disable' : 'Enable'}
                            className={`p-2.5 ${g.is_active ? 'text-emerald-500' : 'text-amber-500'}`}>
                      {g.is_active ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
                    </button>
                  )}
                </div>
              </div>
              <p className="text-xs text-slate-500 break-words">
                {g.run_by || 'Skovo Admin'} · {labelOf('community_category', g.category) || '—'} · {g.member_count ?? 0} member{(g.member_count ?? 0) === 1 ? '' : 's'} · {labelOf('community_join_policy', g.join_type || 'open')}
              </p>
              <span className={`inline-block mt-2 text-xs font-semibold px-2.5 py-1 rounded-full border ${g.removed ? 'bg-red-50 text-red-700 border-red-200' : g.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                {g.removed ? 'Removed' : g.is_active ? 'Active' : 'Inactive'}
              </span>
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>Name</Th><Th>Run by</Th><Th>Category</Th><Th>Members</Th><Th>Join</Th><Th>Status</Th><Th>Actions</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={7} rows={5} />
            ) : shown.length === 0 ? (
              <tbody><tr><td colSpan={7}><EmptyState icon={Users} message={items.length ? 'No communities match.' : 'No communities yet — create one for students.'} /></td></tr></tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {shown.slice((page - 1) * perPage, page * perPage).map((g) => (
                  <tr key={g.id} className={`hover:bg-slate-50 transition-colors ${!g.is_active ? 'opacity-50' : ''}`}>
                    <Td className="font-medium text-slate-900">{g.name}</Td>
                    <Td className="text-slate-600 text-xs">{g.run_by || 'Skovo Admin'}</Td>
                    <Td className="text-slate-500 text-xs capitalize">{g.category || '—'}</Td>
                    <Td className="text-slate-500 text-xs">{g.member_count ?? 0}</Td>
                    <Td className="text-slate-500 text-xs capitalize">{g.join_type || 'open'}</Td>
                    <Td>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border capitalize ${g.removed ? 'bg-red-50 text-red-700 border-red-200' : g.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        {g.removed ? 'Removed' : g.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="Track" color="indigo" onClick={() => setTrack(g)} />
                        {!g.removed && <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => setModal(g)} />}
                        {!g.removed && <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(g)} />}
                        {!g.removed && <ActionBtn icon={g.is_active ? ToggleRight : ToggleLeft} tooltip={g.is_active ? 'Disable' : 'Enable'} color={g.is_active ? 'green' : 'amber'} onClick={() => toggleActive(g)} />}
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

      {/* A setting you change rarely: below the list, not above it. */}
      <div className="mt-4">
        <RetentionCard value={retention} onSaved={setRetention} showToast={showToast} />
      </div>
    </div>
  );
}
