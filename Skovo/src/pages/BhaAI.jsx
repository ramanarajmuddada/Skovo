import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Card, Button, StudentPage } from '../components/ui/index.jsx';
import { Sparkles, Send, Crown, ArrowRight, Loader2, Gauge, FolderOpen, GraduationCap, RotateCcw, Lock } from 'lucide-react';
import { bhaaiQuestion } from '../schemas/student';

/**
 * BhaAI v1 — a grounded career chat.
 *
 * Every answer is built from this student's own Skovo data (score, vault,
 * cohorts, saved colleges), one short model call per question, and points back
 * to screens the student already has. Opening the page never calls the model:
 * /bhaai/quota is a database read.
 *
 * Pro members chat within a daily allowance; free members see a preview and
 * the way into Pro, on this page (no hard jump). Membership is read live by
 * the server on every question, so a lapsed plan stops chatting at once.
 *
 * The thread lives only in this page's state. The server keeps counts, not
 * conversations, and receives just the last few turns with each question.
 */

const HISTORY_TURNS = 4;

const PREVIEW = [
  'How do I raise my score?',
  'What should I add to my vault?',
  'Which of my saved colleges fits my goals?',
];

// What BhaAI reads from, shown before the chat is available.
const CAN_DO = [
  { icon: Gauge, title: 'Your readiness score', body: 'What is holding it back and the next step that moves it.' },
  { icon: FolderOpen, title: 'Your document vault', body: 'What is missing and what to add for the roles you want.' },
  { icon: GraduationCap, title: 'Colleges and cohorts', body: 'How your saved colleges and cohorts fit your goals.' },
];

function Avatar({ size = 32 }) {
  return (
    <span className="shrink-0 rounded-xl flex items-center justify-center text-white"
          style={{ width: size, height: size, background: 'linear-gradient(135deg,var(--accent),#4f46e5)' }}>
      <Sparkles size={Math.round(size * 0.5)} />
    </span>
  );
}

function Bubble({ turn }) {
  const mine = turn.role === 'user';
  if (mine) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[70%] rounded-2xl rounded-br-md px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line text-white"
             style={{ backgroundColor: 'var(--accent)' }}>
          {turn.content}
        </div>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2.5">
      <Avatar size={30} />
      <div className="max-w-[85%] sm:max-w-[75%] rounded-2xl rounded-tl-md px-4 py-3 text-sm leading-relaxed whitespace-pre-line bg-slate-100 text-slate-800">
        {turn.content}
        {!!turn.links?.length && (
          <div className="flex flex-wrap gap-2 mt-3">
            {turn.links.map((l) => (
              <Link key={l.key} to={l.to}
                className="inline-flex items-center gap-1 min-h-9 px-3 rounded-xl text-xs font-semibold bg-white border border-slate-200 text-slate-700 hover:border-slate-300">
                {l.label} <ArrowRight size={12} />
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Typing() {
  return (
    <div className="flex items-start gap-2.5" aria-label="BhaAI is typing">
      <Avatar size={30} />
      <div className="rounded-2xl rounded-tl-md px-4 py-3.5 bg-slate-100 flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
        ))}
      </div>
    </div>
  );
}

function ProCard() {
  return (
    <div className="rounded-2xl border border-purple-200 bg-purple-50 p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-3">
      <span className="shrink-0 w-10 h-10 rounded-xl bg-white/70 flex items-center justify-center text-purple-600"><Crown size={18} /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">BhaAI chat is part of Skovo Pro</p>
        <p className="text-sm text-slate-600 mt-0.5 leading-relaxed">
          Ask about your path every day and get answers built from your own score, vault, cohorts and colleges.
        </p>
      </div>
      <Link to="/skovo-pro"
        className="shrink-0 inline-flex items-center justify-center gap-1.5 px-4 min-h-11 rounded-xl text-sm font-bold text-white"
        style={{ background: 'linear-gradient(135deg,#7c3aed 0%,#4f46e5 100%)' }}>
        <Crown size={14} /> Take Skovo Pro
      </Link>
    </div>
  );
}

/** What BhaAI does, for the states where the chat is not open yet. */
function Intro({ title, body, children }) {
  return (
    <Card className="p-5 sm:p-6 space-y-5">
      <div className="flex items-start gap-3">
        <Avatar size={44} />
        <div className="min-w-0">
          <p className="text-base font-bold text-slate-900">{title}</p>
          <p className="text-sm text-slate-500 mt-0.5">{body}</p>
        </div>
      </div>
      <div className="grid sm:grid-cols-3 gap-3">
        {CAN_DO.map(({ icon: Icon, title: t, body: b }) => (
          <div key={t} className="rounded-xl border border-slate-200 p-3.5">
            <span className="w-8 h-8 rounded-lg flex items-center justify-center mb-2"
                  style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
              <Icon size={16} />
            </span>
            <p className="text-sm font-semibold text-slate-900">{t}</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{b}</p>
          </div>
        ))}
      </div>
      {children}
    </Card>
  );
}

export default function BhaAI() {
  const [info, setInfo] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [thread, setThread] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [gate, setGate] = useState(null);     // 'pro_required' | 'quota' | null
  const endRef = useRef(null);

  useEffect(() => {
    api.get('/bhaai/quota')
      .then(({ data }) => {
        if (data.bool) setInfo(data.response);
        else setLoadError(data.response?.message || 'Could not load BhaAI.');
      })
      .catch(() => setLoadError('Could not load BhaAI. Check your connection and try again.'));
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' }); }, [thread, sending]);

  const quota = info?.quota;
  const canChat = !!info?.enabled && (quota?.limit || 0) > 0;
  const outOfQuestions = canChat && quota.remaining <= 0;
  const maxChars = info?.max_chars || 500;

  const ask = async (text) => {
    if (sending) return;
    const parsed = bhaaiQuestion.safeParse({ message: text });
    if (!parsed.success) { setError(parsed.error.issues[0]?.message || 'Check your question.'); return; }
    const question = parsed.data.message;
    const history = thread.slice(-HISTORY_TURNS).map(({ role, content }) => ({ role, content }));
    setError('');
    setSending(true);
    setThread((t) => [...t, { role: 'user', content: question }]);
    setInput('');
    try {
      const { data } = await api.post('/bhaai/ask', { message: question, history });
      const r = data.response || {};
      if (r.quota) setInfo((i) => ({ ...i, quota: r.quota }));
      if (data.bool) {
        setThread((t) => [...t, { role: 'assistant', content: r.reply, links: r.links || [] }]);
      } else {
        // The question was not answered: take it back out of the thread so a
        // retry does not show it twice, and put it back in the box.
        setThread((t) => t.slice(0, -1));
        setInput(question);
        if (r.code === 'pro_required' || r.code === 'quota') setGate(r.code);
        setError(r.message || 'BhaAI could not answer that.');
      }
    } catch (e) {
      setThread((t) => t.slice(0, -1));
      setInput(question);
      setError(e?.response?.status === 429
        ? 'That was quick. Wait a moment and try again.'
        : 'BhaAI could not answer just now. Try again in a minute.');
    } finally {
      setSending(false);
    }
  };

  const submit = (e) => { e.preventDefault(); ask(input); };
  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(input); }
  };

  const firstName = (() => {
    try { return (JSON.parse(localStorage.getItem('user') || '{}').full_name || '').split(' ')[0]; } catch { return ''; }
  })();
  const nearLimit = input.length > maxChars * 0.8;
  const resetChat = () => { setThread([]); setError(''); setGate(null); };

  return (
    <StudentPage className="space-y-4">
      {loadError && (
        <Card className="p-5"><p className="text-sm text-red-600">{loadError}</p></Card>
      )}

      {!info && !loadError && (
        <div className="h-[60vh] rounded-2xl bg-white border border-slate-100 animate-pulse" />
      )}

      {info && !info.enabled && (
        <>
          <h1 className="text-2xl font-black text-slate-900">BhaAI</h1>
          <Intro title="BhaAI isn't switched on yet"
                 body="Your career guide that answers from your own Skovo data. Check back shortly.">
            <div className="flex flex-wrap gap-2">
              <Link to="/my-score"><Button variant="secondary">See my score</Button></Link>
              <Link to="/document-vault"><Button variant="secondary">Open my vault</Button></Link>
            </div>
          </Intro>
        </>
      )}

      {info?.enabled && !canChat && (
        <>
          <h1 className="text-2xl font-black text-slate-900">BhaAI</h1>
          <Intro title="Ask BhaAI about your path"
                 body="Answers built from your score, vault, cohorts and saved colleges, with a link to the screen that helps.">
            <div className="flex flex-wrap gap-2">
              {PREVIEW.map((q) => (
                <span key={q} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm bg-slate-50 border border-slate-200 text-slate-500">
                  <Lock size={12} /> {q}
                </span>
              ))}
            </div>
            <ProCard />
          </Intro>
        </>
      )}

      {canChat && (
        // A chat window: header, a scrolling thread, and the composer pinned to
        // the bottom, filling the screen below the top bar.
        <div className="bg-white rounded-2xl border border-slate-200 flex flex-col h-[calc(100dvh-9rem)] min-h-[28rem] overflow-hidden">
          <h1 className="sr-only">BhaAI</h1>
          <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
            <Avatar size={36} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold text-slate-900">BhaAI</p>
              <p className="hidden sm:block text-[11px] text-slate-500 truncate">Answers from your own Skovo data</p>
            </div>
            {quota?.limit ? (
              <span className={`shrink-0 text-[11px] font-semibold px-2 py-1 rounded-full ${quota.remaining > 0 ? 'bg-slate-100 text-slate-600' : 'bg-red-50 text-red-600'}`}
                    aria-live="polite">
                {quota.remaining}/{quota.limit} left today
              </span>
            ) : null}
            {thread.length > 0 && (
              <button type="button" onClick={resetChat} aria-label="New chat"
                      className="shrink-0 min-h-9 px-2.5 rounded-lg text-xs font-semibold text-slate-500 hover:bg-slate-100 flex items-center gap-1">
                <RotateCcw size={13} /> <span className="hidden sm:inline">New chat</span>
              </button>
            )}
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-5 space-y-4" aria-live="polite">
            {thread.length === 0 && (
              <div className="min-h-full flex flex-col items-center justify-center text-center max-w-xl mx-auto py-2">
                <Avatar size={52} />
                <p className="text-lg font-bold text-slate-900 mt-3">Hi{firstName ? ` ${firstName}` : ''}, I'm BhaAI</p>
                <p className="text-sm text-slate-500 mt-1">Ask about your score, your vault, cohorts or colleges. I answer from your own Skovo data.</p>
                <div className="grid sm:grid-cols-2 gap-2 mt-5 w-full">
                  {(info.starters || []).map((q) => (
                    <button key={q} type="button" disabled={sending || outOfQuestions} onClick={() => ask(q)}
                      className="min-h-12 px-3.5 py-2.5 rounded-xl text-sm text-left border border-slate-200 text-slate-700 hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50 flex items-center gap-2">
                      <Sparkles size={14} className="shrink-0" style={{ color: 'var(--accent)' }} />
                      <span className="min-w-0">{q}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {thread.map((turn, i) => <Bubble key={i} turn={turn} />)}
            {sending && <Typing />}
            {(gate === 'pro_required' || ((gate === 'quota' || outOfQuestions) && !info.is_pro)) && <ProCard />}
            <div ref={endRef} />
          </div>

          <form onSubmit={submit} noValidate className="border-t border-slate-100 p-3">
            <label htmlFor="bhaai-q" className="sr-only">Your question</label>
            <div className="flex gap-2 items-end">
              <textarea
                id="bhaai-q" rows={1} value={input} maxLength={maxChars}
                onChange={(e) => {
                  setInput(e.target.value); if (error) setError('');
                  // Grow with the text, up to about five lines.
                  e.target.style.height = 'auto';
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 132)}px`;
                }}
                onKeyDown={onKeyDown}
                disabled={outOfQuestions}
                placeholder={outOfQuestions ? "No questions left today" : 'Ask about your path…'}
                aria-invalid={!!error}
                className="flex-1 min-w-0 resize-none min-h-11 max-h-33 px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:bg-slate-50"
              />
              <button type="submit" disabled={sending || outOfQuestions || !input.trim()} aria-label="Send question"
                      className="shrink-0 w-11 h-11 rounded-full flex items-center justify-center text-white disabled:opacity-40"
                      style={{ backgroundColor: 'var(--accent)' }}>
                {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </div>
            <div className="flex items-center justify-between gap-3 mt-1.5 min-h-4">
              {error ? <p className="text-xs text-red-600" role="alert">{error}</p>
                : <p className="text-[11px] text-slate-400 hidden sm:block">Enter to send · Shift + Enter for a new line</p>}
              {nearLimit && <span className="text-[11px] text-slate-400 ml-auto">{input.length}/{maxChars}</span>}
            </div>
          </form>
        </div>
      )}
    </StudentPage>
  );
}
