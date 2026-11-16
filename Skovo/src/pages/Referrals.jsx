import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { Copy, Check, Send, Users, Gift, Clock } from 'lucide-react';

function Spin() {
  return <div className="w-5 h-5 border-2 border-slate-200 border-t-accent rounded-full animate-spin" />;
}

const STATUS_BADGE = {
  pending:   'bg-amber-50 text-amber-700 border-amber-200',
  completed: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  expired:   'bg-slate-100 text-slate-500 border-slate-200',
};

export default function Referrals() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [email,   setEmail]   = useState('');
  const [sending, setSending] = useState(false);
  const [copied,  setCopied]  = useState(false);
  const [msg,     setMsg]     = useState('');
  const [err,     setErr]     = useState('');

  const load = () => {
    setLoading(true);
    api.get('/referrals/my')
      .then(({ data: d }) => { if (d.bool) setData(d.response); })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // The link, not the bare code: signup has no field to type a code into, so
  // a friend who only has the code cannot use it.
  const link = data?.referral_code ? `${window.location.origin}/signup?ref=${data.referral_code}` : '';

  const copyCode = () => {
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const sendReferral = async (e) => {
    e.preventDefault();
    setErr(''); setMsg('');
    if (!email.trim() || !email.includes('@')) { setErr('Enter a valid email address.'); return; }
    setSending(true);
    try {
      const { data: d } = await api.post('/referrals/send', { email: email.trim().toLowerCase() });
      if (!d.bool) { setErr(d.response?.message || 'Failed to send referral.'); return; }
      setMsg('Referral recorded! Your friend will receive an invite.');
      setEmail('');
      load();
    } catch { setErr('Something went wrong. Try again.'); }
    finally { setSending(false); }
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">

      {/* Header */}
      <div>
        <h1 className="text-2xl font-black text-slate-900">Refer &amp; Earn</h1>
        <p className="text-sm text-slate-500 mt-1">Share your link. Rewards are given once your friend meets the condition below.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Spin /></div>
      ) : (
        <>
          {/* Referral code card */}
          <div className="rounded-2xl p-6 text-white" style={{ background: 'linear-gradient(135deg,var(--accent),#0369a1)' }}>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
                <Gift size={20} className="text-white" />
              </div>
              <div>
                <p className="font-bold text-lg">Your Referral Link</p>
                <p className="text-white/70 text-xs">Share this link with friends</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0 bg-white/20 rounded-xl px-3 sm:px-4 py-3 text-center">
                <p className="text-sm sm:text-lg font-black sm:tracking-wider break-all">{data?.referral_code || '—'}</p>
                {link && <p className="text-xs text-white/80 truncate mt-1">{link}</p>}
              </div>
              <button onClick={copyCode} aria-label="Copy referral link"
                className="w-11 h-11 bg-white/20 hover:bg-white/30 rounded-xl flex items-center justify-center transition-colors shrink-0">
                {copied ? <Check size={18} /> : <Copy size={18} />}
              </button>
            </div>
            <div className="flex items-center gap-6 mt-4 pt-4 border-t border-white/20">
              <div className="text-center">
                <p className="text-2xl font-black">{data?.total || 0}</p>
                <p className="text-white/70 text-xs">Total Referred</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-black">{data?.completed || 0}</p>
                <p className="text-white/70 text-xs">Joined SKOVO</p>
              </div>
            </div>
          </div>

          {!!data?.rules?.length && (
            <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm space-y-2">
              <h2 className="font-bold text-slate-900">What you can earn</h2>
              {data.rules.map((line) => (
                <p key={line} className="text-sm text-slate-600">{line}</p>
              ))}
              {!!data.my_rewards?.length && (
                <p className="text-sm font-semibold text-emerald-700">You received: {data.my_rewards.join(', ')}</p>
              )}
            </div>
          )}

          {/* Send invite */}
          <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 shadow-sm">
            <h2 className="font-bold text-slate-900 mb-1">Invite a Friend</h2>
            <p className="text-xs text-slate-500 mb-4">They receive your link. Nothing is given until they finish signup and meet the reward rule.</p>
            <form onSubmit={sendReferral} className="flex flex-col sm:flex-row gap-2">
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="friend@email.com"
                className="flex-1 min-w-0 min-h-11 border border-slate-200 rounded-xl px-4 text-sm focus:outline-none transition-shadow"
                style={{ '--tw-ring-color': 'var(--accent)' }} />
              <button type="submit" disabled={sending}
                className="flex items-center justify-center gap-2 min-h-11 px-5 rounded-xl font-bold text-white text-sm disabled:opacity-50 transition-all shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}>
                {sending ? <Spin /> : <Send size={14} />}
                {sending ? '' : 'Send'}
              </button>
            </form>
            {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
            {msg && <p className="mt-2 text-xs text-emerald-600">{msg}</p>}
          </div>

          {/* Referral history */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
              <Users size={16} className="text-slate-400" />
              <h2 className="font-bold text-slate-900 text-sm">Referral History</h2>
            </div>
            {!data?.referrals?.length ? (
              <div className="flex flex-col items-center py-12 text-slate-400 gap-2">
                <Users size={32} className="opacity-40" />
                <p className="text-sm font-medium">No referrals yet</p>
                <p className="text-xs">Invite friends to see them here</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {data.referrals.map(r => (
                  <div key={r.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                        {r.referred_email[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{r.referred_name || r.referred_email}</p>
                        {r.referred_name && <p className="text-xs text-slate-400">{r.referred_email}</p>}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {r.reward_given && (
                        <span className="flex items-center gap-1 text-xs text-emerald-600 font-semibold">
                          <Gift size={11} /> {r.reward || 'Rewarded'}
                        </span>
                      )}
                      <span className={`px-2.5 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${STATUS_BADGE[r.status] || STATUS_BADGE.expired}`}>
                        {r.status}
                      </span>
                      {r.created_at && (
                        <span className="flex items-center gap-1 text-[10px] text-slate-400">
                          <Clock size={10} /> {new Date(r.created_at).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
