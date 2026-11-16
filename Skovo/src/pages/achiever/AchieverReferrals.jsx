import React, { useEffect, useState } from 'react';
import { Copy, Check, Send, Users, Gift, UserPlus, UserCheck, Share2, GraduationCap, Award } from 'lucide-react';
import StatTile from '../../components/admin/StatTile';
import { EmptyState } from '../../components/ui/TableComponents';
import { Button } from '../../components/ui/index.jsx';
import { achieverApi } from '../../services/api';
import { studentSiteUrl } from '../../utils/portalHost';

function Spin() {
  return <div className="w-5 h-5 border-2 border-slate-200 border-t-accent rounded-full animate-spin" />;
}

export default function AchieverReferrals() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');      // what is being typed
  const [emails, setEmails] = useState([]);    // chips waiting to be sent
  const [audience, setAudience] = useState('student');
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = () => {
    setLoading(true);
    achieverApi.get('/achievers/portal/referrals')
      .then(({ data: d }) => { if (d.bool) setData(d.response); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(''), 2000);
    });
  };

  // Many at once: Enter, comma or space turns the text into a chip, and a
  // pasted list (Excel, WhatsApp) splits into one chip per address.
  const MAX_INVITES = 20;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const addEmails = (text) => {
    const found = (text || '').split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!found.length) return;
    setEmails((cur) => {
      const next = [...cur];
      found.forEach((x) => { if (!next.includes(x) && next.length < MAX_INVITES) next.push(x); });
      return next;
    });
    setEmail('');
  };
  const onEmailKey = (e) => {
    if (['Enter', ',', ' ', ';'].includes(e.key)) {
      if (email.trim()) { e.preventDefault(); addEmails(email); }
    } else if (e.key === 'Backspace' && !email && emails.length) {
      setEmails((cur) => cur.slice(0, -1));
    }
  };
  const onEmailPaste = (e) => {
    const text = e.clipboardData.getData('text');
    if (/[\s,;]/.test(text.trim())) { e.preventDefault(); addEmails(text); }
  };

  const send = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    const list = [...emails, ...(email.trim() ? [email.trim().toLowerCase()] : [])]
      .filter((x, i, a) => a.indexOf(x) === i).slice(0, MAX_INVITES);
    if (!list.length) { setErr('Add at least one email address.'); return; }
    const valid = list.filter((x) => EMAIL_RE.test(x));
    const invalid = list.length - valid.length;
    if (!valid.length) { setErr('None of these look like email addresses.'); return; }
    setSending(true);
    let sent = 0; let already = 0; let failed = 0;
    // One at a time: each invite is recorded and emailed on its own, and the
    // server answers per address (sent / already referred / not allowed).
    for (const to of valid) {
      try {
        const { data: d } = await achieverApi.post('/achievers/portal/referrals/send', { email: to, friend_audience: audience });
        if (d?.bool) sent += 1;
        else if (/already/i.test(d?.response?.message || '')) already += 1;
        else failed += 1;
      } catch (ex) {
        if (/already/i.test(ex?.response?.data?.response?.message || '')) already += 1; else failed += 1;
      }
    }
    setSending(false);
    setEmails([]); setEmail('');
    const parts = [`${sent} sent`];
    if (already) parts.push(`${already} already invited`);
    if (invalid) parts.push(`${invalid} not a valid email`);
    if (failed) parts.push(`${failed} could not be sent`);
    (sent ? setMsg : setErr)(parts.join(' · '));
    if (sent) load();
  };

  const origin = window.location.origin;
  const links = [
    { key: 'student', label: 'For students', hint: 'They sign up to SKOVO with your code', icon: GraduationCap, url: studentSiteUrl(data?.student_link || '/signup') },
    { key: 'achiever', label: 'For achievers', hint: 'They apply to teach with your code', icon: Award, url: `${origin}${data?.achiever_link || ''}` },
  ];
  // WhatsApp is how most of our students share; a prefilled message, one tap.
  const share = (url) => `https://wa.me/?text=${encodeURIComponent(`Join me on SKOVO: ${url}`)}`;
  const STATUS_STYLE = {
    completed: 'bg-emerald-50 text-emerald-700', joined: 'bg-emerald-50 text-emerald-700',
    pending: 'bg-amber-50 text-amber-700', invited: 'bg-blue-50 text-blue-700',
  };

  return (
    // No own padding or width cap: the layout's <main> pads every screen, and
    // a centred 672px column here sat apart from the rest of the portal.
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Refer &amp; Earn</h1>
        <p className="text-sm text-slate-500 mt-0.5">Share your link with a student or another achiever. Admin sets the reward; an invite alone earns nothing.</p>
      </div>
      {loading ? <div className="flex justify-center py-16"><Spin /></div> : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <StatTile label="Invited" value={data?.total || 0} icon={UserPlus} tone="blue" />
            <StatTile label="Joined" value={data?.completed || 0} icon={UserCheck} tone="emerald" />
            <StatTile label="Rewards" value={data?.my_rewards?.length || 0} icon={Gift} tone="violet" />
          </div>

          <div className="grid lg:grid-cols-2 gap-4 items-start">
            {/* Your code and the two links, each labelled for who it is for */}
            <div className="rounded-2xl p-4 sm:p-5 text-white space-y-3" style={{ background: 'linear-gradient(135deg,var(--accent),#0369a1)' }}>
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-white/70">Your code</p>
                  {/* One line, never split mid-code; a little smaller on narrow phones. */}
                  <p className="text-base sm:text-lg font-black tracking-wide whitespace-nowrap truncate">{data?.referral_code}</p>
                </div>
                <button type="button" onClick={() => copy(data?.referral_code || '', 'code')}
                        aria-label="Copy code"
                        className="shrink-0 min-h-10 px-3 rounded-xl bg-white/20 hover:bg-white/30 text-sm font-semibold flex items-center gap-1.5">
                  {copied === 'code' ? <Check size={15} /> : <Copy size={15} />}
                  <span className="hidden min-[380px]:inline">{copied === 'code' ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              {links.map((l) => (
                <div key={l.key} className="rounded-xl bg-white/10 p-3">
                  <div className="flex items-center gap-2">
                    <l.icon size={15} className="shrink-0 text-white/80" />
                    <p className="text-sm font-bold">{l.label}</p>
                    <p className="hidden sm:block text-xs text-white/70 truncate">· {l.hint}</p>
                  </div>
                  <p className="text-xs text-white/80 truncate mt-1" title={l.url}>{l.url}</p>
                  <div className="grid grid-cols-2 gap-2 mt-2.5">
                    <button type="button" aria-label={`Copy ${l.label.toLowerCase()} link`} onClick={() => copy(l.url, l.key)}
                            className="min-h-10 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-semibold flex items-center justify-center gap-1.5">
                      {copied === l.key ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy link</>}
                    </button>
                    {/* Inline colours: on the gradient it must stay white in dark mode,
                        where the theme turns every bg-white dark. */}
                    <a href={share(l.url)} target="_blank" rel="noreferrer"
                       className="min-h-10 rounded-lg text-sm font-semibold flex items-center justify-center gap-1.5"
                       style={{ backgroundColor: '#ffffff', color: '#0f172a' }}>
                      <Share2 size={14} /> WhatsApp
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="space-y-4">
              <form onSubmit={send} className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
                <h2 className="font-bold text-slate-900">Invite by email</h2>
                <div className="grid grid-cols-2 p-1 rounded-xl bg-slate-100">
                  {[['student', 'Student'], ['achiever', 'Achiever']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setAudience(k)} aria-pressed={audience === k}
                            className={`min-h-9 rounded-lg text-sm font-semibold ${audience === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>{l}</button>
                  ))}
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-2 flex flex-wrap gap-1.5 focus-within:ring-2 focus-within:ring-blue-500/30">
                  {emails.map((x) => (
                    <span key={x} className={`inline-flex items-center gap-1 rounded-full pl-2.5 pr-1 py-1 text-xs font-medium ${
                      EMAIL_RE.test(x) ? 'bg-blue-50 text-blue-700' : 'bg-red-50 text-red-700'}`}>
                      <span className="max-w-48 truncate">{x}</span>
                      <button type="button" aria-label={`Remove ${x}`} onClick={() => setEmails((cur) => cur.filter((y) => y !== x))}
                              className="w-5 h-5 rounded-full flex items-center justify-center hover:bg-black/10">×</button>
                    </span>
                  ))}
                  <input type="text" inputMode="email" value={email}
                         onChange={(e) => setEmail(e.target.value)} onKeyDown={onEmailKey} onPaste={onEmailPaste}
                         onBlur={() => email.trim() && addEmails(email)}
                         placeholder={emails.length ? 'Add another…' : 'Type or paste emails'}
                         aria-label="Friends' emails"
                         className="flex-1 min-w-40 min-h-9 px-1.5 text-sm bg-transparent focus:outline-none" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-400">Press Enter or comma after each. Up to {MAX_INVITES} at a time.</p>
                  <Button type="submit" disabled={sending || (!emails.length && !email.trim())} className="shrink-0">
                    {sending ? <Spin /> : <Send size={14} />}
                    {(() => { const n = [...emails, email.trim().toLowerCase()].filter((x) => EMAIL_RE.test(x)).length; return n > 1 ? `Send ${n} invites` : 'Send'; })()}
                  </Button>
                </div>
                {err && <p className="text-xs text-red-600">{err}</p>}
                {msg && <p className="text-xs text-emerald-600">{msg}</p>}
              </form>

              {!!data?.rules?.length && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-2">
                  <h2 className="font-bold text-slate-900">What you can earn</h2>
                  {data.rules.map((line) => <p key={line} className="text-sm text-slate-600">{line}</p>)}
                  {!!data.my_rewards?.length && (
                    <p className="text-sm font-semibold text-emerald-700">You received: {data.my_rewards.join(', ')}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-100 flex items-center gap-2">
              <Users size={16} className="text-slate-400" />
              <h2 className="font-bold text-sm text-slate-900">Referral history</h2>
            </div>
            {!data?.referrals?.length ? (
              <EmptyState icon={Users} message="No referrals yet" sub="People you invite show up here, with their status." />
            ) : (
              <ul className="divide-y divide-slate-100">
                {data.referrals.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 sm:px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-900 truncate">{r.referred_name || r.referred_email}</p>
                      <p className="text-xs text-slate-400 truncate">{r.friend_audience === 'achiever' ? 'Achiever' : 'Student'} · {r.referred_email}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className={`inline-block text-[11px] font-semibold capitalize px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status}</span>
                      {r.reward && <p className="text-xs text-emerald-700 flex items-center gap-1 justify-end mt-1"><Gift size={11} /> {r.reward}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </div>
  );
}
