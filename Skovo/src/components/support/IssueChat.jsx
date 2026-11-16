/**
 * Chat on one support issue — the person who raised it and SKOVO support —
 * as a side panel (full screen on phones), like Intercom / Freshdesk.
 *
 *   <SupportChatPanel issue={…} api={…} base="/support/issues" role="user" onClose onSent />
 *   admin: base="/skovo-platform-panel-admin/support/issues" role="admin"
 *
 * The newest 30 messages load first; "Load earlier messages" pages back.
 * Sending adds the message in place — the page behind is never reloaded.
 * Messages are never edited or deleted; files go through /upload/ (S3).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Paperclip, Send, X, Link2, MoreVertical, Pencil, Trash2, Ban } from 'lucide-react';

const MAX_FILES = 3;
const isImage = (f) => /\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/i.test(f?.name || '') || /\.(png|jpe?g|gif|webp|bmp|heic)(\?|$)/i.test(f?.url || '');
const when = (iso) => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '');
const STATUS = {
  open: ['Open', 'bg-amber-50 text-amber-700 border-amber-200'],
  in_progress: ['In progress', 'bg-blue-50 text-blue-700 border-blue-200'],
  solved: ['Solved', 'bg-emerald-50 text-emerald-700 border-emerald-200'],
};

function Messages({ api, base, issueId, role, onSent }) {
  const [msgs, setMsgs] = useState(null);       // null = loading
  const [hasMore, setHasMore] = useState(false);
  const [older, setOlder] = useState(false);
  const [canWrite, setCanWrite] = useState(true);
  const [otherName, setOtherName] = useState('');
  const [editing, setEditing] = useState(null);   // message being edited
  const [menuFor, setMenuFor] = useState(null);   // message id with its menu open
  const [closedReason, setClosedReason] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState([]);       // [{url, name}]
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const endRef = useRef(null);
  const boxRef = useRef(null);
  const stick = useRef(true);                   // scroll to newest unless loading older

  const load = useCallback(() => {
    api.get(`${base}/${issueId}/messages`)
      .then(({ data }) => {
        if (!data.bool) { setMsgs([]); setError(data.response?.message || 'Could not load the chat.'); return; }
        setMsgs(data.response.messages || []);
        setHasMore(!!data.response.has_more);
        setCanWrite(data.response.can_write !== false);
        setClosedReason(data.response.closed_reason || '');
        setOtherName(data.response.other_name || '');
      })
      .catch(() => { setMsgs([]); setError('Could not load the chat.'); });
  }, [api, base, issueId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (stick.current) endRef.current?.scrollIntoView({ block: 'nearest' }); }, [msgs]);

  // Live: while the chat is open and the tab is visible, pick up new
  // messages every 4 seconds (like WhatsApp, without a page refresh).
  useEffect(() => {
    const tick = () => {
      if (document.hidden) return;
      api.get(`${base}/${issueId}/messages`)
        .then(({ data }) => {
          if (!data.bool) return;
          const latest = data.response.messages || [];
          setMsgs((cur) => {
            if (!cur) return latest;
            const byId = new Map(latest.map((m) => [m.id, m]));
            const have = new Set(cur.map((m) => m.id));
            const fresh = latest.filter((m) => !have.has(m.id));
            const updated = cur.map((m) => byId.get(m.id) || m);   // edits and deletes
            if (fresh.length) stick.current = true;
            return fresh.length ? [...updated, ...fresh] : updated;
          });
          setCanWrite(data.response.can_write !== false);
          setClosedReason(data.response.closed_reason || '');
        })
        .catch(() => {});
    };
    const id = setInterval(tick, 4000);
    // Coming back to the tab: catch up at once instead of waiting 4 seconds.
    const onShow = () => { if (!document.hidden) tick(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('focus', onShow); };
  }, [api, base, issueId]);

  const loadEarlier = async () => {
    if (!msgs?.length) return;
    setOlder(true);
    const box = boxRef.current;
    const prevHeight = box?.scrollHeight || 0;
    try {
      const { data } = await api.get(`${base}/${issueId}/messages`, { before: msgs[0].id });
      if (data.bool) {
        stick.current = false;
        setMsgs((m) => [...(data.response.messages || []), ...(m || [])]);
        setHasMore(!!data.response.has_more);
        // Keep the reader where they were, not jumped to the top.
        requestAnimationFrame(() => { if (box) box.scrollTop = box.scrollHeight - prevHeight; stick.current = true; });
      }
    } finally {
      setOlder(false);
    }
  };

  const pick = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setError('File is over 10 MB.'); return; }
    setUploading(true); setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const up = await api.upload('/upload/', fd);
      if (!up.data.bool) throw new Error(up.data.response?.message || 'Upload failed.');
      setFiles((f) => [...f, { url: up.data.response.url, name: up.data.response.original_name || file.name }].slice(0, MAX_FILES));
    } catch (err) {
      setError(err.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const send = async () => {
    const body = text.trim();
    if (editing) {
      if (!body) return;
      setSending(true); setError('');
      try {
        const { data } = await api.put(`${base}/${issueId}/messages/${editing.id}`, { body });
        if (!data.bool) { setError(data.response?.message || 'Could not edit.'); return; }
        setMsgs((m) => m.map((x) => (x.id === editing.id ? { ...x, body, edited: true } : x)));
        setEditing(null); setText('');
      } catch {
        setError('Could not edit. Try again.');
      } finally {
        setSending(false);
      }
      return;
    }
    if (!body && files.length === 0) return;
    setSending(true); setError('');
    try {
      const { data } = await api.post(`${base}/${issueId}/messages`, { body, attachments: files });
      if (!data.bool) { setError(data.response?.message || 'Could not send.'); return; }
      stick.current = true;
      setMsgs((m) => [...(m || []), data.response.message]);
      setText(''); setFiles([]);
      onSent?.(data.response);
    } catch {
      setError('Could not send. Try again.');
    } finally {
      setSending(false);
    }
  };

  const remove = async (m) => {
    setMenuFor(null);
    if (!window.confirm('Delete this message for everyone?')) return;
    try {
      const { data } = await api.delete(`${base}/${issueId}/messages/${m.id}`);
      if (!data.bool) { setError(data.response?.message || 'Could not delete.'); return; }
      setMsgs((list) => list.map((x) => (x.id === m.id ? { ...x, deleted: true, body: '', attachments: [], can_edit: false, can_delete: false } : x)));
    } catch {
      setError('Could not delete. Try again.');
    }
  };
  const startEdit = (m) => { setMenuFor(null); setEditing(m); setText(m.body); setFiles([]); };

  return (
    <>
      <div ref={boxRef} className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2.5 bg-slate-50" aria-live="polite">
        {msgs === null ? (
          <p className="text-xs text-slate-400 flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Loading…</p>
        ) : (
          <>
            {hasMore && (
              <div className="flex justify-center">
                <button type="button" onClick={loadEarlier} disabled={older}
                        className="text-xs font-semibold px-3 min-h-9 rounded-full border border-slate-200 bg-white text-slate-600 hover:bg-slate-100">
                  {older ? 'Loading…' : 'Load earlier messages'}
                </button>
              </div>
            )}
            {msgs.map((m) => {
              const mine = m.from === role;
              return (
                <div key={m.id} className={`flex items-start gap-1 ${mine ? 'justify-end' : 'justify-start'}`}>
                  {/* Own message: Edit (15 min) / Delete (2 days), like WhatsApp. */}
                  {mine && (m.can_edit || m.can_delete) && (
                    <div className="relative shrink-0 self-center">
                      <button type="button" aria-label="Message options" onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                              className="min-h-8 min-w-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200">
                        <MoreVertical size={15} />
                      </button>
                      {menuFor === m.id && (
                        <div className="absolute right-0 top-9 z-10 w-32 rounded-xl border border-slate-200 bg-white shadow-lg py-1 text-sm">
                          {m.can_edit && (
                            <button type="button" onClick={() => startEdit(m)} className="w-full flex items-center gap-2 px-3 min-h-9 hover:bg-slate-50 text-slate-700">
                              <Pencil size={13} /> Edit
                            </button>
                          )}
                          {m.can_delete && (
                            <button type="button" onClick={() => remove(m)} className="w-full flex items-center gap-2 px-3 min-h-9 hover:bg-red-50 text-red-600">
                              <Trash2 size={13} /> Delete
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm shadow-sm ${m.deleted ? 'bg-transparent border border-slate-300 text-slate-500' : mine ? 'text-white rounded-br-md' : 'bg-white text-slate-800 rounded-bl-md border border-slate-100'}`}
                       style={mine && !m.deleted ? { backgroundColor: 'var(--accent)' } : undefined}>
                    <p className={`text-[10px] font-semibold mb-0.5 ${mine && !m.deleted ? 'text-white/80' : 'text-slate-500'}`}>
                      {m.from === 'admin' ? 'SKOVO Support' : (role === 'admin' ? (otherName || 'User') : 'You')} · {when(m.created_at)}
                      {m.edited && <span className="font-normal"> · edited</span>}
                    </p>
                    {m.deleted && <p className="italic flex items-center gap-1.5"><Ban size={13} /> This message was deleted</p>}
                    {m.body && <p className="whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>}
                    {role === 'admin' && m.original != null && (
                      <p className={`mt-1 text-[11px] italic ${mine && !m.deleted ? 'text-white/70' : 'text-slate-400'}`}>
                        Original (only admins see this): {m.original || (m.original_files?.length ? `${m.original_files.length} file(s)` : '—')}
                      </p>
                    )}
                    {m.attachments?.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {m.attachments.map((f, k) => (isImage(f) ? (
                          // Images show as a picture (like WhatsApp); tap opens full size.
                          <a key={k} href={f.url} target="_blank" rel="noopener noreferrer" className="block" title={f.name}>
                            <img src={f.url} alt={f.name || 'Image'} loading="lazy"
                                 className="max-h-48 max-w-full rounded-xl object-cover bg-black/10" />
                          </a>
                        ) : (
                          <a key={k} href={f.url} target="_blank" rel="noopener noreferrer"
                             className={`text-xs font-semibold px-2 py-1 rounded-lg ${mine ? 'bg-white/20 text-white' : 'bg-slate-50 border border-slate-200'}`}
                             style={mine ? undefined : { color: 'var(--accent)' }}>📄 {f.name || `File ${k + 1}`}</a>
                        )))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </>
        )}
        <div ref={endRef} />
      </div>

      {canWrite ? (
        <div className="border-t border-slate-200 p-3 space-y-2 bg-white shrink-0"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          {editing && (
            <div className="flex items-center gap-2 text-xs rounded-lg bg-slate-50 border border-slate-200 px-3 py-1.5">
              <Pencil size={12} className="text-slate-400" />
              <span className="flex-1 min-w-0 truncate text-slate-600">Editing: {editing.body}</span>
              <button type="button" aria-label="Cancel edit" onClick={() => { setEditing(null); setText(''); }}
                      className="text-slate-400 hover:text-slate-700"><X size={13} /></button>
            </div>
          )}
          {files.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {files.map((f, i) => (
                <span key={f.url} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-slate-200">
                  📎 <span className="max-w-[10rem] truncate">{f.name}</span>
                  <button type="button" aria-label="Remove file" onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}
                          className="text-slate-400 hover:text-red-500"><X size={12} /></button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={!!editing || uploading || files.length >= MAX_FILES}
                    aria-label="Attach a file"
                    className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40">
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Paperclip size={16} />}
            </button>
            <input ref={fileRef} type="file" accept="image/*,.pdf" className="hidden" onChange={pick} />
            <textarea rows={1} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                      placeholder={role === 'admin' ? 'Reply…' : 'Type a message…'}
                      className="flex-1 min-h-11 max-h-32 px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
            <button type="button" onClick={send} disabled={sending || uploading || (!text.trim() && files.length === 0)}
                    aria-label="Send"
                    className="shrink-0 min-h-11 min-w-11 flex items-center justify-center rounded-xl text-white disabled:opacity-40"
                    style={{ backgroundColor: 'var(--accent)' }}>
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : (
        <p className="border-t border-slate-200 p-3 text-xs text-slate-500 bg-white shrink-0">{closedReason || 'This chat is closed.'}</p>
      )}
    </>
  );
}

export default function SupportChatPanel({ issue, api, base, role = 'user', onClose, onSent }) {
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  const [showDetails, setShowDetails] = useState(false);
  if (!issue) return null;
  const [label, cls] = STATUS[issue.status] || STATUS.open;
  const hasDetails = !!(issue.reference_label || issue.txn_ref || issue.attachments?.length || (role === 'admin' && issue.contact_email));
  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`Chat: ${issue.subject}`}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md h-full bg-white shadow-2xl flex flex-col"
           style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        {/* Compact header: one line + "Details" so messages get the screen. */}
        <div className="shrink-0 border-b border-slate-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 font-bold text-slate-900 line-clamp-2 break-words leading-snug" title={issue.subject}>{issue.subject}</p>
            <span className={`shrink-0 text-[11px] font-bold px-2 py-0.5 rounded-full border ${cls}`}>{label}</span>
            <button type="button" onClick={onClose} aria-label="Close chat"
                    className="shrink-0 min-h-9 min-w-9 -mr-1 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100">
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-0.5">
            <span className="capitalize truncate">{issue.category}</span>
            {issue.attachments?.length > 0 && <span>· 📎 {issue.attachments.length}</span>}
            {hasDetails && (
              <button type="button" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}
                      className="ml-auto shrink-0 font-semibold min-h-8 px-1" style={{ color: 'var(--accent)' }}>
                Details {showDetails ? '▴' : '▾'}
              </button>
            )}
          </div>
          {showDetails && (
            <div className="mt-2 space-y-1 text-xs text-slate-500">
              {role === 'admin' && issue.contact_email && <p className="break-all">From {issue.contact_email}</p>}
              {issue.reference_label && <p className="flex items-start gap-1"><Link2 size={11} className="mt-0.5 shrink-0" /> {issue.reference_label}</p>}
              {issue.txn_ref && <p>UTR / transaction ID: {issue.txn_ref}</p>}
              {issue.attachments?.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-0.5">
                  {issue.attachments.map((f, k) => (
                    <a key={k} href={f.url} target="_blank" rel="noopener noreferrer"
                       className="font-semibold px-2 py-1 rounded-lg border border-slate-200" style={{ color: 'var(--accent)' }}>
                      📎 {f.name || `Proof ${k + 1}`}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <Messages key={issue.id} api={api} base={base} issueId={issue.id} role={role} onSent={onSent} />
      </div>
    </div>
  );
}
