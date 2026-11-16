/**
 * Live community chat (feature-updates.md §8): socket push with a polling
 * fallback, replies, reactions, doubts → Solved, polls, report, mute,
 * owner settings, invite link, add member, top helpers.
 * Phone numbers are masked by the server; we only show its notice.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { Send, Reply, Flag, Trash2, HelpCircle, CheckCircle2, BarChart3, Settings, Link2, UserPlus, BellOff, Bell, Award, X } from 'lucide-react';
import { api, SOCKET_URL } from '../../services/api';

const EMOJI = ['👍', '❤️', '😂', '🎉', '🙏'];
const time = (v) => (v ? new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : '');

function Poll({ poll, onVote }) {
  const total = poll.options.reduce((a, o) => a + o.votes, 0) || 1;
  return (
    <div className="mt-1 space-y-1 min-w-[200px]">
      <p className="text-sm font-semibold">📊 {poll.question}</p>
      {poll.options.map((o) => (
        <button key={o.index} disabled={poll.closed} onClick={() => onVote(poll.id, o.index)}
                className={`relative w-full text-left text-xs px-2 py-1.5 rounded-lg border overflow-hidden ${o.mine ? 'border-blue-500' : 'border-slate-200'}`}>
          <span className="absolute inset-y-0 left-0 bg-blue-100" style={{ width: `${(o.votes / total) * 100}%` }} />
          <span className="relative">{o.text} · {o.votes}</span>
        </button>
      ))}
      {poll.closed && <p className="text-[10px] text-slate-500">Poll closed</p>}
    </div>
  );
}

function OwnerTools({ groupId, settings, onSaved, toast }) {
  const [s, setS] = useState(settings);
  const [q, setQ] = useState('');
  const [found, setFound] = useState([]);
  const [invite, setInvite] = useState('');
  const save = async (patch) => {
    const next = { ...s, ...patch };
    setS(next);
    const { data } = await api.put(`/assemble/groups/${groupId}/chat-settings`, next);
    if (data?.bool) { onSaved(data.response.settings); toast('Saved.'); } else toast(data?.response?.message || 'Could not save.', false);
  };
  const search = async (v) => {
    setQ(v);
    if (v.trim().length < 2) { setFound([]); return; }
    const { data } = await api.get('/assemble/members/search', { q: v, group_id: groupId });
    if (data?.bool) setFound(data.response.students || []);
  };
  const add = async (uid) => {
    const { data } = await api.post(`/assemble/groups/${groupId}/members`, { user_id: uid });
    toast(data?.response?.message || (data?.bool ? 'Added.' : 'Could not add.'), !!data?.bool);
  };
  const makeInvite = async () => {
    const { data } = await api.post(`/assemble/groups/${groupId}/invite`, {});
    if (data?.bool) setInvite(`${window.location.origin}/assemble?join=${data.response.invite_code}`);
  };
  return (
    <div className="p-3 space-y-3 bg-white border-b text-sm">
      <div className="flex flex-wrap gap-3 items-center">
        <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={s.admin_only} onChange={(e) => save({ admin_only: e.target.checked })} /> Only admins can post</label>
        <label className="inline-flex items-center gap-1 text-xs"><input type="checkbox" checked={s.allow_links} onChange={(e) => save({ allow_links: e.target.checked })} /> Allow links</label>
        <label className="inline-flex items-center gap-1 text-xs">Slow mode
          <select value={s.slow_mode_seconds} onChange={(e) => save({ slow_mode_seconds: Number(e.target.value) })} className="border rounded px-1 py-0.5">
            {[0, 10, 30, 60, 300].map((v) => <option key={v} value={v}>{v ? `${v}s` : 'off'}</option>)}
          </select>
        </label>
      </div>
      <div className="flex gap-2 items-center">
        <button onClick={makeInvite} className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700"><Link2 size={13} /> Invite link</button>
        {invite && <input readOnly value={invite} onFocus={(e) => e.target.select()} className="flex-1 text-xs border rounded px-2 py-1" />}
      </div>
      <div>
        <div className="flex items-center gap-1"><UserPlus size={13} /><input value={q} onChange={(e) => search(e.target.value)} placeholder="Add a student by name" className="flex-1 text-xs border rounded px-2 py-1" /></div>
        {found.map((f) => (
          <div key={f.user_id} className="flex justify-between text-xs py-1"><span>{f.name}{f.institute && ` · ${f.institute}`}</span><button onClick={() => add(f.user_id)} className="text-blue-700 font-semibold">Add</button></div>
        ))}
      </div>
    </div>
  );
}

export default function CommunityChat({ groupId, toast }) {
  const [msgs, setMsgs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null);
  const [doubt, setDoubt] = useState(false);
  const [panel, setPanel] = useState('');
  const [helpers, setHelpers] = useState([]);
  const [muted, setMuted] = useState(false);
  const [poll, setPoll] = useState({ question: '', options: ['', ''] });
  const lastSeq = useRef(0);
  const bottom = useRef(null);
  const say = useCallback((m, ok = true) => toast?.(m, ok), [toast]);

  const merge = useCallback((list) => {
    if (!list?.length) return;
    setMsgs((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      list.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m, is_mine: m.is_mine ?? map.get(m.id)?.is_mine }));
      return [...map.values()].sort((a, b) => a.seq - b.seq);
    });
    lastSeq.current = Math.max(lastSeq.current, ...list.map((m) => m.seq));
  }, []);

  const fetchNew = useCallback(async (full) => {
    const { data } = await api.get(`/assemble/groups/${groupId}/chat`, full ? { limit: 50 } : { after: lastSeq.current });
    if (!data?.bool) return;
    setMeta({ my_role: data.response.my_role, settings: data.response.settings, can_post: data.response.can_post });
    if (full) setMsgs([]);
    merge(data.response.messages);
  }, [groupId, merge]);

  // Refresh one stretch of messages (reactions, polls, solved) after an event.
  const refreshAround = useCallback(async () => {
    const { data } = await api.get(`/assemble/groups/${groupId}/chat`, { limit: 50 });
    if (data?.bool) merge(data.response.messages);
  }, [groupId, merge]);

  useEffect(() => {
    lastSeq.current = 0;
    fetchNew(true);
    const t = setInterval(() => fetchNew(false), 8000);
    const token = localStorage.getItem('access_token');
    let socket;
    try {
      socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
      socket.on('connect', () => socket.emit('join_community', { group_id: groupId }));
      socket.on('community_message', (m) => merge([{ ...m, is_mine: false }]));
      socket.on('community_message_deleted', ({ id }) => setMsgs((p) => p.map((m) => (m.id === id ? { ...m, deleted: true, body: null, media_url: null } : m))));
      socket.on('community_reaction', refreshAround);
      socket.on('community_solved', refreshAround);
      socket.on('community_poll', refreshAround);
    } catch { /* polling still works */ }
    return () => { clearInterval(t); socket?.disconnect(); };
  }, [groupId, fetchNew, merge, refreshAround]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    if (lastSeq.current) api.post(`/assemble/groups/${groupId}/read`, { seq: lastSeq.current }).catch(() => {});
  }, [msgs.length, groupId]);

  const send = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    const { data } = await api.post(`/assemble/groups/${groupId}/chat`, { body: text, reply_to: reply?.id, is_doubt: doubt });
    if (data?.bool) {
      merge([data.response.message]); setText(''); setReply(null); setDoubt(false);
      if (data.response.notice) say(data.response.notice);
    } else say(data?.response?.message || 'Could not send.', false);
  };
  const act = async (fn, ok) => {
    const { data } = await fn();
    if (data?.bool) { if (ok) say(data.response?.message || ok); refreshAround(); } else say(data?.response?.message || 'Could not do that.', false);
  };
  const vote = (pid, idx) => act(() => api.post(`/assemble/polls/${pid}/vote`, { option_index: idx }));
  const createPoll = async () => {
    const options = poll.options.filter((o) => o.trim());
    const { data } = await api.post(`/assemble/groups/${groupId}/polls`, { question: poll.question, options });
    if (data?.bool) { merge([data.response.message]); setPanel(''); setPoll({ question: '', options: ['', ''] }); } else say(data?.response?.message || 'Could not create the poll.', false);
  };
  const openHelpers = async () => {
    setPanel(panel === 'helpers' ? '' : 'helpers');
    const { data } = await api.get(`/assemble/groups/${groupId}/top-helpers`);
    if (data?.bool) setHelpers(data.response.helpers || []);
  };
  const toggleMute = async () => {
    const { data } = await api.post(`/assemble/groups/${groupId}/mute`, { muted: !muted });
    if (data?.bool) setMuted(data.response.muted);
  };

  const privileged = ['owner', 'admin'].includes(meta?.my_role);
  const byId = Object.fromEntries(msgs.map((m) => [m.id, m]));

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex items-center gap-1 px-3 py-1.5 border-b bg-white">
        <button onClick={openHelpers} className="p-2 text-slate-500" title="Top helpers"><Award size={16} /></button>
        <button onClick={() => setPanel(panel === 'poll' ? '' : 'poll')} className="p-2 text-slate-500" title="New poll"><BarChart3 size={16} /></button>
        <button onClick={toggleMute} className="p-2 text-slate-500" title={muted ? 'Unmute' : 'Mute'}>{muted ? <BellOff size={16} /> : <Bell size={16} />}</button>
        {privileged && <button onClick={() => setPanel(panel === 'owner' ? '' : 'owner')} className="p-2 text-slate-500" title="Chat settings"><Settings size={16} /></button>}
        {meta?.settings?.slow_mode_seconds > 0 && <span className="ml-auto text-[10px] text-slate-500">Slow mode {meta.settings.slow_mode_seconds}s</span>}
      </div>
      {panel === 'owner' && meta && <OwnerTools groupId={groupId} settings={meta.settings} onSaved={(s) => setMeta((m) => ({ ...m, settings: s }))} toast={say} />}
      {panel === 'helpers' && (
        <div className="p-3 bg-white border-b text-xs space-y-1">
          <p className="font-semibold">Top helpers (doubts solved)</p>
          {helpers.length ? helpers.map((h) => <p key={h.user_id} className={h.is_me ? 'font-bold' : ''}>{h.rank}. {h.name} — {h.solved}</p>) : <p className="text-slate-400">No solved doubts yet.</p>}
        </div>
      )}
      {panel === 'poll' && (
        <div className="p-3 bg-white border-b space-y-2">
          <input value={poll.question} onChange={(e) => setPoll({ ...poll, question: e.target.value })} placeholder="Question" className="w-full text-sm border rounded-lg px-2 py-1.5" />
          {poll.options.map((o, i) => (
            <input key={i} value={o} onChange={(e) => setPoll({ ...poll, options: poll.options.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${i + 1}`} className="w-full text-xs border rounded-lg px-2 py-1" />
          ))}
          <div className="flex gap-2">
            {poll.options.length < 6 && <button onClick={() => setPoll({ ...poll, options: [...poll.options, ''] })} className="text-xs text-blue-700">+ option</button>}
            <button onClick={createPoll} className="ml-auto px-3 py-1 rounded-lg bg-slate-900 text-white text-xs">Post poll</button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3 space-y-2" style={{ background: '#efeae2' }}>
        {msgs.length === 0 && <p className="text-center text-slate-500 py-16 text-sm">No messages yet. Say hi 👋</p>}
        {msgs.map((m) => {
          const parent = m.reply_to && byId[m.reply_to.id];
          const canSolve = parent?.is_doubt && !parent.solved_by_message_id && (parent.is_mine || privileged) && !m.is_mine;
          return (
            <div key={m.id} className={`group flex ${m.is_mine ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[85%] rounded-2xl px-3 py-2 shadow-sm ${m.is_mine ? 'bg-emerald-100' : 'bg-white'} ${m.is_doubt ? 'ring-2 ring-amber-300' : ''}`}>
                {!m.is_mine && <p className="text-[11px] font-semibold text-blue-700">{m.sender_name}</p>}
                {m.reply_to && <p className="text-[11px] border-l-2 border-slate-300 pl-2 text-slate-500 truncate">{m.reply_to.sender_name}: {m.reply_to.body}</p>}
                {m.is_doubt && <p className="text-[10px] font-bold text-amber-700 inline-flex items-center gap-0.5"><HelpCircle size={11} /> Doubt{m.solved_by_message_id && ' · Solved ✅'}</p>}
                {m.deleted ? <p className="text-xs italic text-slate-400">Message deleted</p> : (
                  <>
                    {m.body && <p className="text-sm whitespace-pre-wrap break-words">{m.body}</p>}
                    {m.media_url && <img src={m.media_url} alt="" className="mt-1 rounded-lg max-h-60" />}
                    {m.poll && <Poll poll={m.poll} onVote={vote} />}
                  </>
                )}
                <div className="flex items-center gap-1 mt-1 flex-wrap">
                  {m.reactions.map((r) => (
                    <button key={r.emoji} onClick={() => act(() => api.post(`/assemble/chat/${m.id}/react`, { emoji: r.emoji }))}
                            className={`text-[11px] px-1.5 rounded-full ${r.mine ? 'bg-blue-100' : 'bg-slate-100'}`}>{r.emoji} {r.count}</button>
                  ))}
                  <span className="text-[10px] text-slate-400 ml-auto">{time(m.created_at)}</span>
                </div>
                {!m.deleted && (
                  <div className="hidden group-hover:flex gap-1.5 mt-1 text-slate-400 flex-wrap">
                    {EMOJI.map((e) => <button key={e} onClick={() => act(() => api.post(`/assemble/chat/${m.id}/react`, { emoji: e }))} className="text-xs">{e}</button>)}
                    <button onClick={() => setReply(m)} title="Reply"><Reply size={13} /></button>
                    {canSolve && <button onClick={() => act(() => api.post(`/assemble/chat/${parent.id}/solve`, { answer_id: m.id }), 'Solved')} title="This solved the doubt" className="text-emerald-600"><CheckCircle2 size={13} /></button>}
                    {!m.is_mine && <button onClick={() => { const reason = window.prompt('Why are you reporting this message?'); if (reason !== null) act(() => api.post(`/assemble/chat/${m.id}/report`, { reason }), 'Reported'); }} title="Report"><Flag size={13} /></button>}
                    {(m.is_mine || privileged) && <button onClick={() => window.confirm('Delete this message?') && act(() => api.delete(`/assemble/chat/${m.id}`), 'Deleted')} title="Delete"><Trash2 size={13} /></button>}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        <div ref={bottom} />
      </div>

      {meta?.can_post === false ? <p className="text-xs text-center text-slate-500 py-3 bg-white border-t">Only community admins can post right now.</p> : (
        <form onSubmit={send} className="px-3 py-2 border-t bg-white space-y-1" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }}>
          {reply && <div className="flex items-center text-[11px] text-slate-500 gap-1"><Reply size={11} /> Replying to {reply.sender_name}<button type="button" onClick={() => setReply(null)} className="ml-auto"><X size={12} /></button></div>}
          <div className="flex gap-2 items-center">
            <button type="button" onClick={() => setDoubt((d) => !d)} title="Ask as a doubt" className={`p-2 rounded-full ${doubt ? 'bg-amber-100 text-amber-700' : 'text-slate-400'}`}><HelpCircle size={18} /></button>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={doubt ? 'Ask your doubt' : 'Message'} maxLength={4000}
                   className="flex-1 min-h-11 px-4 py-2 border border-slate-200 rounded-full text-base bg-slate-50 focus:bg-white focus:outline-none" />
            <button type="submit" aria-label="Send" className="min-h-11 min-w-11 p-2.5 text-white rounded-full flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}><Send size={16} /></button>
          </div>
        </form>
      )}
    </div>
  );
}
