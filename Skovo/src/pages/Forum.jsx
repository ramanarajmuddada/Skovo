import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useMasters } from '../hooks/useMasters';
import { Input, Textarea, FormSelect } from '../components/ui/index.jsx';
import { MessageSquare, Plus, ThumbsUp, Eye, CheckCircle2, Pin, Send, ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

// CATEGORIES comes from master data (masters.forum_category) — see hooks/useMasters.
const CAT_COLOR = {
  general: 'bg-slate-100 text-slate-600', exam_prep: 'bg-blue-100 text-blue-600',
  college: 'bg-purple-100 text-purple-600', career: 'bg-green-100 text-green-700',
  scholarship: 'bg-yellow-100 text-yellow-700', abroad: 'bg-orange-100 text-orange-600',
  placement: 'bg-pink-100 text-pink-600',
};

export default function Forum() {
  const { lists } = useMasters(['forum_category']);
  const CATEGORIES = (lists.forum_category || []).map(o => o.value);

  const { user } = useAuth();
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('list');
  const [activePost, setActivePost] = useState(null);
  const [activeReplies, setActiveReplies] = useState([]);
  const [category, setCategory] = useState('all');
  const [newPost, setNewPost] = useState({ title: '', content: '', category: 'general', tags: '' });
  const [editingId, setEditingId] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadPosts(); }, [category]);

  const loadPosts = async () => {
    try {
      const params = category !== 'all' ? `?category=${category}` : '';
      const { data } = await api.get(`/forum/posts${params}`);
      if (data.bool) setPosts(data.response.posts || []);
    } catch {}
    setLoading(false);
  };

  const openPost = async (p) => {
    try {
      const { data } = await api.get(`/forum/posts/${p.id}`);
      if (data.bool) {
        setActivePost(data.response.post);
        setActiveReplies(data.response.replies || []);
        setView('detail');
      }
    } catch {}
  };

  const upvote = async (postId) => {
    try {
      // Upvote is a server-side toggle — use the authoritative count it returns
      // instead of always incrementing (which desyncs on un-vote / repeat clicks).
      const { data } = await api.post(`/forum/posts/${postId}/upvote`);
      if (!data.bool) return;
      const { upvotes, upvoted } = data.response;
      setPosts(prev => prev.map(p => p.id === postId ? { ...p, upvotes, upvoted } : p));
      setActivePost(prev => (prev && prev.id === postId ? { ...prev, upvotes, upvoted } : prev));
    } catch {}
  };

  const submitPost = async () => {
    if (!newPost.title.trim() || !newPost.content.trim()) return alert('Title and content are required.');
    setSaving(true);
    try {
      const tags = typeof newPost.tags === 'string'
        ? newPost.tags.split(',').map(t => t.trim()).filter(Boolean)
        : (newPost.tags || []);
      const body = { ...newPost, tags };
      const { data } = editingId
        ? await api.put(`/forum/posts/${editingId}`, body)
        : await api.post('/forum/posts', body);
      if (data.bool) {
        setShowNewForm(false); setEditingId(null);
        setNewPost({ title: '', content: '', category: 'general', tags: '' });
        loadPosts();
      }
    } catch {}
    setSaving(false);
  };

  const startEdit = (p) => {
    setEditingId(p.id);
    setNewPost({
      title: p.title || '', content: p.content || '',
      category: p.category || 'general',
      tags: Array.isArray(p.tags) ? p.tags.join(', ') : (p.tags || ''),
    });
    setView('list'); setShowNewForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const deletePost = async (postId) => {
    if (!window.confirm('Delete this post? This cannot be undone.')) return;
    try {
      const { data } = await api.delete(`/forum/posts/${postId}`);
      if (data.bool) { setView('list'); setActivePost(null); loadPosts(); }
      else alert(data.response?.message || 'Failed to delete.');
    } catch { alert('Connection error.'); }
  };

  const submitReply = async () => {
    if (!replyText.trim()) return;
    try {
      const { data } = await api.post(`/forum/posts/${activePost.id}/replies`, { content: replyText });
      if (data.bool) {
        setReplyText('');
        setActiveReplies(prev => [...prev, { id: data.response.id, content: replyText, author_name: user?.full_name, upvotes: 0, is_accepted: false, created_at: new Date().toISOString() }]);
        setActivePost(prev => (prev ? { ...prev, replies_count: (prev.replies_count || 0) + 1 } : prev));
        setPosts(prev => prev.map(p => p.id === activePost.id ? { ...p, replies_count: (p.replies_count || 0) + 1 } : p));
      }
    } catch {}
  };

  const acceptReply = async (replyId) => {
    try {
      await api.post(`/forum/replies/${replyId}/accept`);
      setActiveReplies(prev => prev.map(r => ({ ...r, is_accepted: r.id === replyId })));
      setActivePost(prev => (prev ? { ...prev, is_solved: true } : prev));
      setPosts(prev => prev.map(p => p.id === activePost?.id ? { ...p, is_solved: true } : p));
    } catch {}
  };

  if (loading) return <div className="p-8 text-slate-500">Loading forum…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {view === 'detail' && (
            <button onClick={() => setView('list')} className="p-2 text-slate-500 hover:text-slate-800 transition-colors"><ArrowLeft size={18} /></button>
          )}
          <div className="w-10 h-10 rounded-xl bg-indigo-500 flex items-center justify-center">
            <MessageSquare size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Community Forum</h1>
            <p className="text-sm text-slate-500">Ask questions, share experiences</p>
          </div>
        </div>
        {view === 'list' && (
          <button onClick={() => { setShowNewForm(f => !f); if (showNewForm) { setEditingId(null); setNewPost({ title: '', content: '', category: 'general', tags: '' }); } }}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-600 transition-colors">
            <Plus size={16} />{showNewForm ? 'Cancel' : 'New Post'}
          </button>
        )}
      </div>

      {/* New Post Form */}
      {showNewForm && view === 'list' && (
        <div className="bg-white rounded-2xl border border-slate-200 p-5 space-y-3">
          <Input label="Post title" required placeholder="Ask it the way you'd ask a senior"
            value={newPost.title} onChange={e => setNewPost(p => ({ ...p, title: e.target.value }))} />
          <Textarea label="Your question" required rows={4}
            placeholder="Add the details that matter — your stream, rank, state, what you've already tried"
            value={newPost.content} onChange={e => setNewPost(p => ({ ...p, content: e.target.value }))} />
          <div className="grid sm:grid-cols-2 gap-3">
            <FormSelect searchType="forum_category" label="Category" clearable={false}
              value={newPost.category} onChange={v => setNewPost(p => ({ ...p, category: v }))}
              options={CATEGORIES.map(c => ({ value: c, label: c.replace('_', ' ') }))} />
            <Input label="Tags" placeholder="jee, counselling, hostel"
              hint="Separate with commas — helps others find your post."
              value={newPost.tags} onChange={e => setNewPost(p => ({ ...p, tags: e.target.value }))} />
          </div>
          <button onClick={submitPost} disabled={saving} className="w-full py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-50">
            {saving ? (editingId ? 'Updating…' : 'Posting…') : (editingId ? 'Update Post' : 'Post Question')}
          </button>
        </div>
      )}

      {/* List view */}
      {view === 'list' && (
        <>
          {/* Category filter */}
          <div className="flex gap-2 flex-wrap">
            {['all', ...CATEGORIES].map(c => (
              <button key={c} onClick={() => setCategory(c)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${category === c ? 'bg-indigo-500 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>
                {c === 'all' ? 'All' : c.replace('_', ' ')}
              </button>
            ))}
          </div>
          <div className="space-y-3">
            {posts.length === 0 && <div className="text-center py-16 text-slate-400">No posts yet. Start a conversation!</div>}
            {posts.map(p => (
              <div key={p.id} className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-sm transition-shadow cursor-pointer" onClick={() => openPost(p)}>
                <div className="flex items-start gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {p.is_pinned && <Pin size={13} className="text-indigo-500" />}
                      {p.is_solved && <CheckCircle2 size={13} className="text-green-500" />}
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[p.category] || 'bg-slate-100 text-slate-600'}`}>
                        {(p.category || '').replace('_', ' ')}
                      </span>
                    </div>
                    <h3 className="font-semibold text-slate-900 leading-tight mb-1">{p.title}</h3>
                    <p className="text-sm text-slate-500 line-clamp-2">{p.content}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                      <span>by {p.author_name}</span>
                      <span className="flex items-center gap-1"><ThumbsUp size={11} />{p.upvotes}</span>
                      <span className="flex items-center gap-1"><Eye size={11} />{p.views}</span>
                      <span className="flex items-center gap-1"><MessageSquare size={11} />{p.replies_count}</span>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Detail view */}
      {view === 'detail' && activePost && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${CAT_COLOR[activePost.category] || ''}`}>
                {(activePost.category || '').replace('_', ' ')}
              </span>
              {activePost.is_solved && <span className="flex items-center gap-1 text-green-600 text-xs font-medium"><CheckCircle2 size={13} />Solved</span>}
            </div>
            <h2 className="text-xl font-bold text-slate-900 mb-2">{activePost.title}</h2>
            <p className="text-slate-700 whitespace-pre-wrap">{activePost.content}</p>
            <div className="flex items-center gap-4 mt-4 text-sm text-slate-400">
              <span>by <strong className="text-slate-600">{activePost.author_name}</strong></span>
              <button onClick={() => upvote(activePost.id)}
                className={`flex items-center gap-1 transition-colors ${activePost.upvoted ? 'text-indigo-600 font-semibold' : 'hover:text-indigo-600'}`}>
                <ThumbsUp size={13} />{activePost.upvotes} {activePost.upvoted ? 'Upvoted' : 'Upvote'}
              </button>
              <span>{activePost.views} views</span>
              {activePost.author_id === user?.id && (
                <span className="ml-auto flex items-center gap-2">
                  <button onClick={() => startEdit(activePost)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                    <Pencil size={13} /> Edit
                  </button>
                  <button onClick={() => deletePost(activePost.id)}
                    className="flex items-center gap-1 px-2 py-1 rounded-lg text-red-500 hover:bg-red-50 transition-colors">
                    <Trash2 size={13} /> Delete
                  </button>
                </span>
              )}
            </div>
          </div>

          {/* Replies */}
          <h3 className="font-semibold text-slate-700">{activeReplies.length} {activeReplies.length === 1 ? 'Reply' : 'Replies'}</h3>
          {activeReplies.map(r => (
            <div key={r.id} className={`bg-white rounded-xl border p-4 ${r.is_accepted ? 'border-green-300 bg-green-50' : 'border-slate-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  {r.is_accepted && <span className="flex items-center gap-1 text-green-600 text-xs font-medium mb-2"><CheckCircle2 size={13} />Accepted Answer</span>}
                  <p className="text-slate-700 whitespace-pre-wrap text-sm">{r.content}</p>
                  <div className="flex items-center gap-4 mt-2 text-xs text-slate-400">
                    <span>by <strong className="text-slate-600">{r.author_name}</strong></span>
                    <span>{r.upvotes} upvotes</span>
                  </div>
                </div>
                {activePost.author_id === user?.id && !r.is_accepted && !activePost.is_solved && (
                  <button onClick={() => acceptReply(r.id)} className="shrink-0 px-2 py-1 text-xs bg-green-100 text-green-700 rounded-lg hover:bg-green-200 transition-colors">
                    Accept
                  </button>
                )}
              </div>
            </div>
          ))}

          {/* Reply input */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex gap-3">
            <textarea placeholder="Write a reply…" value={replyText} onChange={e => setReplyText(e.target.value)} rows={3}
              className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300" />
            <button onClick={submitReply} disabled={!replyText.trim()} className="self-end px-4 py-2 bg-indigo-500 text-white rounded-xl text-sm font-medium hover:bg-indigo-600 transition-colors disabled:opacity-40">
              <Send size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
