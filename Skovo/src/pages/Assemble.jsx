import React, { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import CommunityChat from '../components/v1/CommunityChat';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, PageHeader, Badge, Toast, EmptyState, Avatar, Modal, Input, Textarea, Button, FormSelect, SearchBar, StudentPage } from '../components/ui/index.jsx';
import { LoadError } from '../components/ui/TableComponents';
import { useMasters } from '../hooks/useMasters';
import ProUpgradeBanner, { TakeProLink } from '../components/ProUpgradeBanner.jsx';
import { fieldErrors, assembleCommunity, assembleMessage } from '../schemas/student';
import { Users, MessageSquare, Heart, Send, X, Mail, ChevronLeft, Ban, Flag, Lock, Pin, Plus, Type, Layers, ShieldCheck, Trash2 } from 'lucide-react';

/* ── Create a community ──────────────────────────────────────────────────────
   Free members can be in three communities; creating one puts you in it, so it
   spends a slot the same way joining does. One rule, one counter. */
function CreateGroupModal({ onClose, onCreated, onCap }) {
  const { lists } = useMasters(['community_category', 'community_join_policy']);
  const [form, setForm] = useState({
    name: '', description: '', category: 'general', join_type: 'open', max_members: '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState({});
  const [needsPro, setNeedsPro] = useState(false);
  const set = (k) => (v) => { setForm((f) => ({ ...f, [k]: v })); setErrs((e) => ({ ...e, [k]: undefined })); };

  const submit = async (e) => {
    e?.preventDefault?.();
    const parsed = assembleCommunity.safeParse(form);
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setError('');
      return;
    }
    setErrs({});
    setSaving(true); setError(''); setNeedsPro(false);
    try {
      const { data } = await api.post('/assemble/groups', {
        name: parsed.data.name,
        description: parsed.data.description,
        category: parsed.data.category,
        join_type: parsed.data.join_type,
        max_members: parsed.data.max_members.trim() === '' ? null : Number(parsed.data.max_members),
      });
      if (data.bool) {
        onCreated(data.response.group, data.response.quota, data.response.message);
      } else if (data.response?.requires_pro) {
        setNeedsPro(true);
        setError(data.response?.message || 'Take Skovo Pro to create more communities.');
        onCap?.(data.response);
      } else {
        setError(data.response?.message || 'Could not create the community.');
      }
    } catch { setError('Could not create the community.'); }
    finally { setSaving(false); }
  };

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title="Start a community"
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2 justify-end w-full">
          <Button type="button" variant="secondary" className="min-h-11" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="create-community" className="min-h-11" disabled={saving}>
            {saving ? 'Creating…' : 'Create community'}
          </Button>
        </div>
      }
    >
      <form id="create-community" onSubmit={submit} noValidate className="space-y-4">
        <Input
          label="Community name" required icon={<Type size={14} />}
          value={form.name} onChange={(e) => set('name')(e.target.value)}
          placeholder="Enter community name"
          hint="Other students see this name when they browse communities."
          error={errs.name}
        />
        <Textarea
          label="What is it for?" rows={3}
          value={form.description} onChange={(e) => set('description')(e.target.value)}
          placeholder="Enter what this community is for"
          error={errs.description}
        />
        <div className="grid sm:grid-cols-2 gap-4">
          <FormSelect searchType="community_category"
            label="Category" icon={Layers}
            value={form.category} onChange={set('category')}
            options={lists.community_category || []}
            placeholder="Enter category" clearable={false}
            error={errs.category}
          />
          <FormSelect searchType="community_join_policy"
            label="Who can join?" icon={ShieldCheck}
            value={form.join_type} onChange={set('join_type')}
            options={lists.community_join_policy || []}
            clearable={false}
            hint="Requests appear under Manage inside the community."
            error={errs.join_type}
          />
        </div>
        <Input
          label="Member limit" type="text" inputMode="numeric" icon={<Users size={14} />}
          value={form.max_members} onChange={(e) => set('max_members')(e.target.value.replace(/\D/g, ''))}
          placeholder="Leave empty for no limit"
          hint="Minimum 2 if you set one."
          error={errs.max_members}
        />
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
            {error}
            {needsPro && <span className="block mt-2"><TakeProLink>Take Skovo Pro</TakeProLink></span>}
          </div>
        )}
      </form>
    </Modal>
  );
}

/* The free-tier meter. Shown only to free members — telling a paying member
   they have "unlimited of unlimited" is noise. */
function QuotaBar({ quota }) {
  if (!quota || quota.is_pro) return null;
  return (
    <div className="mb-5">
      <ProUpgradeBanner
        used={quota.used}
        limit={quota.limit}
        noun={quota.limit === 1 ? 'community' : 'communities'}
        extra="Direct messages and unlimited groups come with Skovo Pro."
      />
    </div>
  );
}

function GroupCard({ group, onJoin, onLeave, onOpen }) {
  return (
    <Card className="p-5 flex flex-col gap-3 hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          {group.category && (
            <Badge color="blue" size="xs">{group.category}</Badge>
          )}
          <h3 className="font-bold text-slate-900 mt-2 leading-snug">{group.name}</h3>
          <p className="text-sm text-slate-500 mt-1 line-clamp-2">{group.description}</p>
        </div>
      </div>

      {group.member_count !== undefined && (
        <div className="flex items-center gap-1.5 text-xs text-slate-400">
          <Users size={12} />
          {group.member_count}{group.max_members ? `/${group.max_members}` : ''} {(group.max_members || group.member_count) === 1 ? 'member' : 'members'}
        </div>
      )}

      <div className="flex gap-2 mt-auto pt-3 border-t border-slate-100">
        <button
          onClick={() => onOpen(group)}
          className="flex-1 min-h-11 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-1.5 transition-colors"
        >
          <MessageSquare size={14} /> Posts
        </button>
        {group.membership_status === 'pending' ? (
          <span className="flex-1 min-h-11 py-2 text-center text-sm font-semibold text-amber-700 bg-amber-50 rounded-xl inline-flex items-center justify-center">
            Awaiting approval
          </span>
        ) : !group.is_member && group.max_members && group.member_count >= group.max_members ? (
          <span className="flex-1 min-h-11 py-2 text-center text-sm font-semibold text-slate-500 bg-slate-100 rounded-xl inline-flex items-center justify-center">
            Full
          </span>
        ) : !group.is_member ? (
          <button
            type="button"
            onClick={() => onJoin(group)}
            className="flex-1 min-h-11 py-2 text-white text-sm font-semibold rounded-xl transition-opacity hover:opacity-90"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {group.join_type === 'approval' ? 'Request to join' : 'Join'}
          </button>
        ) : group.my_role === 'owner' ? (
          <span className="flex-1 min-h-11 py-2 text-center text-sm font-semibold text-emerald-600 bg-emerald-50 rounded-xl inline-flex items-center justify-center">
            You own this
          </span>
        ) : (
          // Was a dead <span>. Membership costs a slot out of a budget of three
          // on the free tier, and there was no way to give one back — three
          // joins stranded a student with no exit but buying Pro. Reversible:
          // rejoining restores the membership, so this needs no confirm step.
          <button
            onClick={() => onLeave(group)}
            title="Leave this community"
            className="flex-1 min-h-11 py-2 text-center text-sm font-semibold rounded-xl transition-colors
                       text-red-600 bg-red-50 hover:bg-red-100"
          >
            Leave
          </button>
        )}
      </div>
    </Card>
  );
}

/* ── Owner tools: pending requests and the member list ───────────────────── */
function ManageTab({ group, flash, onDeleted }) {
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState('');

  const load = React.useCallback(() => {
    api.get(`/assemble/groups/${group.id}/requests`)
      .then(({ data }) => { if (data.bool) setRequests(data.response.requests || []); })
      .catch(() => {});
    api.get(`/assemble/groups/${group.id}/members`)
      .then(({ data }) => { if (data.bool) setMembers(data.response.members || []); })
      .catch(() => {});
  }, [group.id]);

  useEffect(() => { load(); }, [load]);

  const decide = async (memberId, approve) => {
    setBusy(memberId);
    try {
      const { data } = await api.post(`/assemble/groups/${group.id}/requests/${memberId}`, { approve });
      flash(data.response?.message || (approve ? 'Approved.' : 'Declined.'), data.bool ? 'success' : 'error');
      if (data.bool) load();
    } catch { flash('Could not update that request.', 'error'); }
    finally { setBusy(''); }
  };

  const remove = async (memberId, name) => {
    if (!window.confirm(`Remove ${name} from ${group.name}?`)) return;
    setBusy(memberId);
    try {
      const { data } = await api.delete(`/assemble/groups/${group.id}/members/${memberId}`);
      flash(data.response?.message || 'Member removed.', data.bool ? 'success' : 'error');
      if (data.bool) load();
    } catch { flash('Could not remove that member.', 'error'); }
    finally { setBusy(''); }
  };

  const Row = ({ person, children }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-slate-100 last:border-0">
      <Avatar name={person.full_name} size="sm" />
      <span className="flex-1 min-w-0 text-sm font-medium text-slate-800 truncate">{person.full_name}</span>
      {children}
    </div>
  );

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
          Join requests {requests.length > 0 && `(${requests.length})`}
        </h3>
        {requests.length === 0 ? (
          <p className="text-sm text-slate-400 py-2">Nothing waiting.</p>
        ) : requests.map((r) => (
          <Row key={r.user_id} person={r}>
            <button disabled={busy === r.user_id} onClick={() => decide(r.user_id, true)}
              className="min-h-11 px-3 text-xs font-bold rounded-lg bg-emerald-50 text-emerald-700 hover:bg-emerald-100 disabled:opacity-40">
              Approve
            </button>
            <button disabled={busy === r.user_id} onClick={() => decide(r.user_id, false)}
              className="min-h-11 px-3 text-xs font-semibold rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-40">
              Decline
            </button>
          </Row>
        ))}
      </div>

      <div>
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">
          Members ({members.length})
        </h3>
        {members.map((m) => (
          <Row key={m.user_id} person={m}>
            {m.role === 'owner' ? (
              <span className="text-[10px] font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-md">OWNER</span>
            ) : (
              <button disabled={busy === m.user_id} onClick={() => remove(m.user_id, m.full_name)}
                className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                Remove
              </button>
            )}
          </Row>
        ))}
      </div>

      <div className="pt-2 border-t border-slate-100">
        <h3 className="text-xs font-bold uppercase tracking-wide text-slate-400 mb-2">Delete community</h3>
        <p className="text-sm text-slate-500 mb-3">
          Members leave, and the community disappears from Assemble. Skovo Admin can still see it until its chat expires.
        </p>
        <button
          type="button"
          disabled={!!busy}
          onClick={async () => {
            if (!window.confirm(`Delete ${group.name}? Members will be removed. This cannot be undone.`)) return;
            setBusy('delete');
            try {
              const { data } = await api.delete(`/assemble/groups/${group.id}`);
              if (data.bool) onDeleted?.();
              else flash(data.response?.message || 'Could not delete this community.', 'error');
            } catch { flash('Could not delete this community.', 'error'); }
            finally { setBusy(''); }
          }}
          className="min-h-11 px-4 text-sm font-semibold rounded-xl text-white bg-red-600 hover:bg-red-700 disabled:opacity-40"
        >
          {busy === 'delete' ? 'Deleting…' : 'Delete community'}
        </button>
      </div>
    </div>
  );
}

function PostsPanel({ group, onClose, onMessage, flash, onDeleted }) {
  const { user } = useAuth();
  // /auth/me returns user_id; the login payload uses id — accept either.
  const myId = user?.id || user?.user_id;
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [postErr, setPostErr] = useState('');
  const [tab, setTab] = useState(group.is_member ? 'chat' : 'posts');
  const isOwner = group.my_role === 'owner';

  useEffect(() => {
    if (!group?.id) return;
    api.get(`/assemble/groups/${group.id}/posts`)
      .then(({ data }) => { if (data.bool) setPosts(data.response.posts); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group?.id]);

  // Owners can clear anything in their own community; everyone else only their
  // own posts. The server decides — this just avoids offering a dead button.
  const handleDeletePost = async (postId) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      const { data } = await api.delete(`/assemble/posts/${postId}`);
      if (data.bool) setPosts((prev) => prev.filter((p) => p.id !== postId));
      else flash?.(data.response?.message || 'Could not delete that post.', 'error');
    } catch { flash?.('Could not delete that post.', 'error'); }
  };

  const handlePost = async (e) => {
    e.preventDefault();
    const parsed = assembleMessage.safeParse({ content });
    if (!parsed.success) {
      setPostErr(fieldErrors(parsed).content || 'Enter a message.');
      return;
    }
    setPostErr('');
    setPosting(true);
    try {
      const { data } = await api.post(`/assemble/groups/${group.id}/posts`, { content: parsed.data.content });
      if (data.bool) { setPosts((prev) => [data.response.post, ...prev]); setContent(''); }
      else flash?.(data.response?.message || 'Could not post.', 'error');
    } catch { flash?.('Could not post.', 'error'); }
    finally { setPosting(false); }
  };

  // Pin/unpin your own post (Skovo Pro). Surfaces the upgrade prompt on 403.
  const handlePin = async (postId) => {
    try {
      const { data } = await api.post(`/assemble/posts/${postId}/pin`, {});
      if (data.bool) {
        setPosts((prev) => prev.map((p) => p.id === postId ? { ...p, is_pinned: data.response.is_pinned } : p));
      } else if (data.response?.requires_pro) {
        flash?.(data.response.message || 'Pinning posts is a Skovo Pro feature.', 'error');
      }
    } catch {}
  };

  const handleLike = async (postId) => {
    try {
      const { data } = await api.post(`/assemble/posts/${postId}/like`, {});
      if (data.bool) {
        setPosts((prev) => prev.map((p) =>
          p.id === postId ? { ...p, likes_count: data.response.likes_count, is_liked: data.response.action === 'liked' } : p
        ));
      }
    } catch {}
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white z-50 flex flex-col shadow-2xl"
           style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100">
          <div className="min-w-0 pr-2">
            <h2 className="font-bold text-slate-900 truncate">{group.name}</h2>
            {group.category && <p className="text-xs text-slate-400 mt-0.5">{group.category}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {group.is_member && (
          <div className="flex gap-1 px-5 pt-3 border-b border-slate-100">
            {[['chat', 'Live chat'], ['posts', 'Posts'], ...(isOwner ? [['manage', 'Manage']] : [])].map(([key, label]) => (
              <button key={key} type="button" onClick={() => setTab(key)}
                aria-pressed={tab === key}
                className={`px-3.5 py-2 min-h-11 text-sm font-semibold rounded-t-lg border-b-2 -mb-px transition-colors ${
                  tab === key ? 'text-white border-transparent' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
                style={tab === key ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' } : undefined}>
                {label}
              </button>
            ))}
          </div>
        )}

        {group.is_member && tab === 'chat' ? (
          <CommunityChat groupId={group.id} toast={(m, ok = true) => flash(m, ok ? 'success' : 'error')} />
        ) : isOwner && tab === 'manage' ? (
          <div className="flex-1 overflow-y-auto">
            <ManageTab group={group} flash={flash} onDeleted={onDeleted} />
          </div>
        ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-2" style={{ background: '#efeae2' }}>
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse h-16 bg-white/70 rounded-2xl" />
            ))
          ) : posts.length === 0 ? (
            <p className="text-center text-slate-500 py-16 text-sm">No posts yet. Be the first!</p>
          ) : (
            posts.map((post) => {
              const mine = post.author?.id === myId;
              return (
              <div key={post.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                  mine ? 'rounded-tr-sm text-white' : 'bg-white rounded-tl-sm'
                }`}
                  style={mine ? { backgroundColor: 'var(--accent)' } : undefined}
                >
                <div className={`flex items-center gap-2 mb-1 ${mine ? 'text-white/90' : ''}`}>
                  {!mine && (
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0"
                         style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 18%, transparent)', color: 'var(--accent)' }}>
                      {post.author?.full_name?.charAt(0) || 'U'}
                    </div>
                  )}
                  <span className={`text-xs font-semibold ${mine ? 'text-white' : 'text-slate-900'}`}>{post.author?.full_name || 'User'}</span>
                  {post.is_pinned && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 px-1.5 py-0.5 rounded-md flex items-center gap-0.5">
                      <Pin size={9} /> Pinned
                    </span>
                  )}
                  {group.is_member && post.author?.id === myId && (
                    <button
                      onClick={() => handlePin(post.id)}
                      title={post.is_pinned ? 'Unpin' : 'Pin this post (Pro)'}
                      className={`p-1 rounded-lg ${post.is_pinned ? 'text-amber-200' : 'text-white/50 hover:text-white'}`}
                    >
                      <Pin size={13} />
                    </button>
                  )}
                  {group.is_member && post.author?.id && post.author.id !== myId && (
                    <button
                      onClick={() => onMessage({ id: post.author.id, name: post.author.full_name || 'Skovo member' })}
                      title="Send a direct message"
                      className="p-1 text-slate-300 hover:text-slate-600 rounded-lg"
                    >
                      <Mail size={13} />
                    </button>
                  )}
                  {group.is_member && (post.author?.id === myId || isOwner) && (
                    <button
                      onClick={() => handleDeletePost(post.id)}
                      title={post.author?.id === myId ? 'Delete your post' : 'Remove this post'}
                      className={`p-1 rounded-lg ${mine ? 'text-white/60 hover:text-white' : 'text-slate-300 hover:text-red-600'}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                  <span className={`text-[10px] ml-auto ${mine ? 'text-white/70' : 'text-slate-400'}`}>
                    {new Date(post.created_at).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}
                  </span>
                </div>
                <p className={`text-sm leading-relaxed ${mine ? 'text-white' : 'text-slate-700'}`}>{post.content}</p>
                <button
                  onClick={() => handleLike(post.id)}
                  className={`flex items-center gap-1.5 mt-2 text-xs font-medium ${post.is_liked ? 'text-red-400' : (mine ? 'text-white/70' : 'text-slate-400')}`}
                >
                  <Heart size={13} fill={post.is_liked ? 'currentColor' : 'none'} />
                  {post.likes_count || 0}
                </button>
                </div>
              </div>
              );
            })
          )}
        </div>
        )}

        {group.is_member && tab === 'posts' && (
          <form onSubmit={handlePost} noValidate className="px-3 py-3 border-t border-slate-100 flex flex-col gap-1.5 bg-white"
                style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
            {postErr && <p className="text-xs text-red-600 px-1">{postErr}</p>}
            <div className="flex gap-2 items-center">
            <input
              type="text"
              value={content}
              onChange={(e) => { setContent(e.target.value); setPostErr(''); }}
              placeholder="Enter a message"
              className="flex-1 min-h-11 px-4 py-2.5 border border-slate-200 rounded-full text-base focus:outline-none bg-slate-50 focus:bg-white"
            />
            <button
              type="submit"
              disabled={posting}
              aria-label="Send"
              className="min-h-11 min-w-11 p-2.5 text-white rounded-full transition-opacity disabled:opacity-40 flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              <Send size={16} />
            </button>
            </div>
          </form>
        )}
      </div>
    </>
  );
}

/* ── Direct messages (Skovo Pro) ────────────────────────────────────────── */

function ThreadView({ peer, onBack, onToast }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [needsPro, setNeedsPro] = useState(false);
  const bottomRef = useRef(null);

  const load = () =>
    api.get(`/assemble/dm/${peer.id}`)
      .then(({ data }) => { if (data.bool) setMessages(data.response.messages || []); })
      .catch(() => {})
      .finally(() => setLoading(false));

  // No socket on this route yet — poll while the thread is open.
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [peer.id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  const handleSend = async (e) => {
    e.preventDefault();
    const parsed = assembleMessage.safeParse({ content: body });
    if (!parsed.success) {
      setError(fieldErrors(parsed).content || 'Enter a message.');
      setNeedsPro(false);
      return;
    }
    setSending(true); setError(''); setNeedsPro(false);
    try {
      const { data } = await api.post(`/assemble/dm/${peer.id}`, { body: parsed.data.content });
      if (data.bool) { setBody(''); load(); }
      else {
        setError(data.response?.message || 'Could not send.');
        setNeedsPro(!!data.response?.requires_pro);
      }
    } catch { setError('Could not send.'); } finally { setSending(false); }
  };

  const handleBlock = async () => {
    if (!window.confirm(`Block ${peer.name}? Neither of you will be able to message the other.`)) return;
    try {
      const { data } = await api.post(`/assemble/dm/${peer.id}/block`, {});
      onToast(data.response?.message || 'Member blocked.');
      onBack();
    } catch {}
  };

  const handleReport = async () => {
    const reason = window.prompt(`Report ${peer.name} — what happened?`);
    if (!reason) return;
    try {
      const { data } = await api.post(`/assemble/dm/${peer.id}/report`, { reason });
      onToast(data.response?.message || 'Report submitted.');
    } catch {}
  };

  return (
    <>
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
        <button type="button" onClick={onBack} aria-label="Back"
          className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <Avatar name={peer.name} size="sm" />
        <h2 className="font-bold text-slate-900 flex-1 min-w-0 truncate">{peer.name}</h2>
        <button onClick={handleReport} title="Report" className="p-2 text-slate-400 hover:text-amber-600 rounded-xl hover:bg-slate-100 transition-colors">
          <Flag size={16} />
        </button>
        <button onClick={handleBlock} title="Block" className="p-2 text-slate-400 hover:text-red-600 rounded-xl hover:bg-slate-100 transition-colors">
          <Ban size={16} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse h-10 bg-slate-50 rounded-2xl" />)
        ) : messages.length === 0 ? (
          <p className="text-center text-slate-400 py-16 text-sm">No messages yet. Say hello!</p>
        ) : (
          messages.map((m) => (
            <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                m.mine ? 'text-white rounded-br-md' : 'bg-slate-100 text-slate-800 rounded-bl-md'
              }`}
                style={m.mine ? { backgroundColor: 'var(--accent)' } : undefined}>
                {m.body}
                <span className={`block text-[10px] mt-1 ${m.mine ? 'text-white/70' : 'text-slate-400'}`}>
                  {new Date(m.created_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mx-4 mb-2 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
          {error}
          {needsPro && <span className="block mt-2"><TakeProLink>Take Skovo Pro</TakeProLink></span>}
        </div>
      )}

      <form onSubmit={handleSend} noValidate className="px-4 py-3 border-t border-slate-100 flex gap-2"
            style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <input
          type="text"
          value={body}
          maxLength={2000}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Enter a message"
          className="flex-1 min-h-11 px-4 py-2.5 border border-slate-200 rounded-xl text-base focus:outline-none bg-slate-50 focus:bg-white transition-all"
        />
        <button
          type="submit"
          disabled={sending}
          aria-label="Send"
          className="min-h-11 min-w-11 p-2.5 text-white rounded-xl transition-opacity disabled:opacity-40 flex items-center justify-center"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <Send size={16} />
        </button>
      </form>
    </>
  );
}

function MessagesPanel({ initialPeer, onClose, onToast, isProHint }) {
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isPro, setIsPro] = useState(isProHint == null ? null : !!isProHint);
  const [active, setActive] = useState(initialPeer || null);

  const load = () =>
    api.get('/assemble/dm/conversations')
      .then(({ data }) => {
        if (data.bool) { setConversations(data.response.conversations || []); setIsPro(!!data.response.is_pro); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { if (!active) load(); }, [active]);

  return (
    <>
      <div className="fixed inset-0 bg-black/50 z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white z-50 flex flex-col shadow-2xl"
           style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {active ? (
          <ThreadView peer={active} onBack={() => setActive(null)} onToast={onToast} />
        ) : (
          <>
            <div className="flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-900">Messages</h2>
                <p className="text-xs text-slate-400 mt-0.5">Members of your communities</p>
              </div>
              <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
                <X size={18} />
              </button>
            </div>

            {isPro === false && (
              <div className="mx-5 mt-4 rounded-2xl border px-4 py-3"
                style={{
                  borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                  background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
                }}>
                <p className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
                  <Lock size={14} style={{ color: 'var(--accent)' }} /> Direct messages are a Skovo Pro feature
                </p>
                <p className="text-xs text-slate-600 mt-1">You can read replies. Sending needs Pro.</p>
                <Link to="/skovo-pro"
                  className="inline-flex items-center justify-center mt-3 min-h-11 px-4 rounded-xl text-xs font-bold text-white"
                  style={{ backgroundColor: 'var(--accent)' }}>
                  Take Skovo Pro
                </Link>
              </div>
            )}

            <div className="flex-1 overflow-y-auto p-4 space-y-1">
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => <div key={i} className="animate-pulse h-16 bg-slate-50 rounded-2xl" />)
              ) : conversations.length === 0 ? (
                <p className="text-center text-slate-400 py-16 text-sm">
                  No conversations yet. Open a community and message someone from their post.
                </p>
              ) : (
                conversations.map((c) => (
                  <button
                    key={c.peer.id}
                    onClick={() => setActive(c.peer)}
                    className="w-full flex items-center gap-3 p-3 rounded-2xl hover:bg-slate-50 text-left transition-colors"
                  >
                    <Avatar name={c.peer.name} size="md" />
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 text-sm truncate">{c.peer.name}</p>
                      <p className="text-xs text-slate-500 truncate">{c.last_body}</p>
                    </div>
                    {c.unread > 0 && (
                      <span className="shrink-0 min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                        style={{ backgroundColor: 'var(--accent)' }}>
                        {c.unread}
                      </span>
                    )}
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

const SEARCH_DEBOUNCE_MS = 400;

function normalizeGroup(g) {
  return {
    id: g.id,
    name: g.name || g.title,
    description: g.description,
    category: g.category || g.tag,
    member_count: g.member_count,
    max_members: g.max_members,
    is_member: g.is_member || false,
    join_type: g.join_type || 'open',
    // Decides whether the Manage tab appears — drop it here and the owner
    // silently loses their moderation tools.
    my_role: g.my_role || null,
    membership_status: g.membership_status || null,
  };
}

export default function Assemble() {
  const { lists } = useMasters(['community_category']);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openGroup, setOpenGroup] = useState(null);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [dmOpen, setDmOpen] = useState(false);
  const [dmPeer, setDmPeer] = useState(null);
  const [unread, setUnread] = useState(0);
  const [quota, setQuota] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [sp, setSp] = useSearchParams();
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const loadGroups = (overrides = {}) => {
    setLoadError('');
    const q = overrides.query !== undefined ? overrides.query : query;
    const cat = overrides.category !== undefined ? overrides.category : category;
    const params = {};
    if (q) params.search = q;
    if (cat && cat !== 'all') params.category = cat;
    return api.get('/assemble/groups', Object.keys(params).length ? params : undefined)
      .then(({ data }) => {
        if (data.bool) {
          setGroups((data.response.groups || []).map(normalizeGroup));
          setQuota(data.response.quota || null);
        } else {
          setGroups([]);
          setLoadError(data.response?.message || 'Could not load communities.');
        }
      })
      .catch(() => { setGroups([]); setLoadError('Could not load communities. Check your connection and try again.'); })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    setLoading(true);
    loadGroups();
  }, [query, category]); // eslint-disable-line react-hooks/exhaustive-deps

  // Invite link: /assemble?join=CODE (§8). Joining still counts toward the free-plan limit.
  useEffect(() => {
    const code = sp.get('join');
    if (!code) return;
    setSp({}, { replace: true });
    api.post(`/assemble/join/${encodeURIComponent(code)}`, {}).then(({ data }) => {
      flash(data?.response?.message || (data?.bool ? 'Joined.' : 'Could not join.'), data?.bool ? 'success' : 'error');
      if (data?.bool) loadGroups();
    }).catch(() => flash('Could not join.', 'error'));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  // Unread badge on the Messages button.
  useEffect(() => {
    if (dmOpen) return;
    api.get('/assemble/dm/conversations')
      .then(({ data }) => { if (data.bool) setUnread(data.response.total_unread || 0); })
      .catch(() => {});
  }, [dmOpen]);

  const openDm = (peer) => { setDmPeer(peer); setDmOpen(true); };

  const handleJoin = async (group) => {
    try {
      const { data } = await api.post(`/assemble/groups/${group.id}/join`, {});
      if (data.bool) {
        // On an approval group you are only pending — claiming "Joined ✓" would
        // be a lie until the owner acts, and no slot is spent yet either.
        const active = data.response.status === 'active';
        setGroups((prev) => prev.map((g) => g.id === group.id
          ? { ...g, is_member: active, membership_status: data.response.status }
          : g));
        if (active) {
          setQuota((q) => (q && !q.is_pro
            ? { ...q, used: q.used + 1, remaining: Math.max(0, q.remaining - 1), can_add: q.remaining - 1 > 0 }
            : q));
        }
        flash(data.response.message || 'Joined group!');
      } else {
        flash(data.response?.message || 'Could not join this community.', 'error');
        if (data.response?.requires_pro) {
          const used = data.response.upgrade?.used;
          const limit = data.response.upgrade?.limit;
          setQuota((q) => ({
            ...(q || {}),
            is_pro: false,
            used: used ?? q?.used ?? 0,
            limit: limit ?? q?.limit,
            remaining: 0,
            can_add: false,
          }));
        }
      }
    } catch { flash('Could not join this community.', 'error'); }
  };

  const handleLeave = async (group) => {
    try {
      const { data } = await api.delete(`/assemble/groups/${group.id}/join`);
      if (data.bool) {
        setGroups((prev) => prev.map((g) => g.id === group.id
          ? { ...g, is_member: false, membership_status: null, my_role: null,
              member_count: Math.max(0, (g.member_count || 1) - 1) }
          : g));
        // Give the slot back, so the cap reflects reality without a refetch.
        setQuota((q) => (q && !q.is_pro
          ? { ...q, used: Math.max(0, q.used - 1), remaining: q.remaining + 1, can_add: true }
          : q));
        flash(data.response?.message || 'You have left this community.');
      } else {
        flash(data.response?.message || 'Could not leave this community.', 'error');
      }
    } catch { flash('Could not leave this community.', 'error'); }
  };

  const handleCreated = (group, nextQuota, message) => {
    setShowCreate(false);
    if (group) setGroups((prev) => [normalizeGroup(group), ...prev]);
    if (nextQuota) setQuota(nextQuota);
    flash(message || 'Community created!');
  };

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Assemble"
        subtitle="Join communities, share ideas, grow together"
        action={
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <button
              onClick={() => openDm(null)}
              className="relative min-h-11 px-4 py-2 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50 flex items-center justify-center gap-2 transition-colors"
            >
              <Mail size={15} /> Messages
              {unread > 0 && (
                <span className="absolute -top-1.5 -right-1.5 min-w-5 h-5 px-1.5 rounded-full text-white text-[11px] font-bold flex items-center justify-center"
                  style={{ backgroundColor: 'var(--accent)' }}>
                  {unread}
                </span>
              )}
            </button>
            {/* Out of slots? Still offer the button — the modal explains why,
                which beats a disabled control with no reason attached. */}
            <button
              onClick={() => setShowCreate(true)}
              className="min-h-11 px-4 py-2 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors btn-accent"
            >
              <Plus size={15} /> New community
            </button>
          </div>
        }
      />

      <QuotaBar quota={quota} />

      <div className="flex flex-col gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={() => {
            const next = search.trim();
            if (next !== query) setQuery(next);
            else { setLoading(true); loadGroups({ query: next }); }
          }}
          placeholder="Search communities by name"
          className="max-w-xl"
        />
        {(lists.community_category || []).length > 0 && (
          <div className="flex gap-2 flex-wrap" role="group" aria-label="Community category">
            {[{ value: 'all', label: 'All' }, ...(lists.community_category || [])].map((opt) => {
              const value = opt.value ?? opt;
              const label = opt.label ?? opt;
              const on = category === value;
              return (
                <button key={value} type="button" onClick={() => setCategory(value)}
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

      {!loading && loadError && (
        <LoadError what="communities" message={loadError} onRetry={() => { setLoading(true); loadGroups(); }} />
      )}

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      ) : loadError ? null : groups.length === 0 ? (
        query || category !== 'all' ? (
          <EmptyState
            icon={Users}
            title="No matching communities"
            subtitle="Try a different name or category."
          />
        ) : (
          <EmptyState
            icon={Users}
            title="No communities yet"
            subtitle="Start the first one — pick a name, say who it's for, and share the link."
            action={<Button onClick={() => setShowCreate(true)}><Plus size={15} /> Start a community</Button>}
          />
        )
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <GroupCard key={g.id} group={g} onJoin={handleJoin} onLeave={handleLeave} onOpen={setOpenGroup} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateGroupModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          onCap={(res) => {
            const used = res?.upgrade?.used;
            const limit = res?.upgrade?.limit;
            setQuota((q) => ({
              ...(q || {}),
              is_pro: false,
              used: used ?? q?.used ?? 0,
              limit: limit ?? q?.limit,
              remaining: 0,
              can_add: false,
            }));
          }}
        />
      )}

      {openGroup && (
        <PostsPanel
          group={openGroup}
          onClose={() => setOpenGroup(null)}
          onDeleted={() => {
            const id = openGroup.id;
            setGroups((prev) => prev.filter((g) => g.id !== id));
            setQuota((q) => (q && !q.is_pro
              ? { ...q, used: Math.max(0, (q.used || 1) - 1), remaining: (q.remaining || 0) + 1, can_add: true }
              : q));
            setOpenGroup(null);
            flash('Community deleted.');
          }}
          onMessage={(peer) => { setOpenGroup(null); openDm(peer); }}
          flash={flash}
        />
      )}

      {dmOpen && (
        <MessagesPanel
          initialPeer={dmPeer}
          onClose={() => { setDmOpen(false); setDmPeer(null); }}
          onToast={flash}
          isProHint={quota ? !!quota.is_pro : null}
        />
      )}
    </StudentPage>
  );
}
