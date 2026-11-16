import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api } from '../services/api';
import { ShieldCheck, User, Lock, Eye, EyeOff, CheckCircle, XCircle, Clock } from 'lucide-react';

const ROLE_LABEL = { mentor: 'Mentor', admin: 'Administrator' };
const ROLE_COLOR = { mentor: 'bg-purple-100 text-purple-700', admin: 'bg-amber-100 text-amber-700' };

export default function AcceptInvite() {
  const { token } = useParams();
  const navigate  = useNavigate();

  const [invite, setInvite]     = useState(null);
  const [status, setStatus]     = useState('loading'); // loading | valid | invalid | done
  const [errorMsg, setErrorMsg] = useState('');
  const [form, setForm]         = useState({ full_name: '', password: '', confirm: '' });
  const [showPw, setShowPw]     = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  useEffect(() => {
    api.get(`/auth/invite/${token}`)
      .then(({ data }) => {
        if (data.bool) { setInvite(data.response); setStatus('valid'); }
        else { setErrorMsg(data.response?.message || 'Invalid invite'); setStatus('invalid'); }
      })
      .catch(() => { setErrorMsg('Could not load invite.'); setStatus('invalid'); });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitError('');
    if (!form.full_name.trim()) { setSubmitError('Please enter your name.'); return; }
    if (form.password.length < 6) { setSubmitError('Password must be at least 6 characters.'); return; }
    if (form.password !== form.confirm) { setSubmitError('Passwords do not match.'); return; }
    setSubmitting(true);
    try {
      const { data } = await api.post(`/auth/invite/${token}`, {
        full_name: form.full_name.trim(),
        password: form.password,
      });
      if (data.bool) { setStatus('done'); }
      else setSubmitError(data.response?.message || 'Failed. The link may have expired.');
    } catch { setSubmitError('Something went wrong. Please try again.'); }
    finally { setSubmitting(false); }
  };

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (status === 'done') {
    const isAdmin = invite?.role_code === 'admin';
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle size={30} className="text-emerald-600" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">You're all set!</h1>
          <p className="text-slate-500 text-sm mb-6">
            Your account has been created with <strong>{ROLE_LABEL[invite?.role_code] || invite?.role_code}</strong> access.
          </p>
          <Link
            to={isAdmin ? '/skovo-platform-panel-admin/login' : '/login'}
            className="inline-block w-full py-3 bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-all"
          >
            Sign in to SKOVO →
          </Link>
        </div>
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-sm text-center">
          <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <XCircle size={30} className="text-red-500" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 mb-2">Invite not valid</h1>
          <p className="text-slate-500 text-sm mb-6">{errorMsg}</p>
          <Link to="/login" className="text-blue-600 font-semibold hover:underline text-sm">← Go to login</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-6">
          <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center mx-auto mb-4 shadow-lg shadow-blue-200">
            <ShieldCheck size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-slate-900 tracking-tight">You're invited!</h1>
          <p className="text-slate-500 text-sm mt-1">
            {invite?.invited_by_email ? `From ${invite.invited_by_email}` : 'SKOVO Team invited you'}
          </p>
        </div>

        {/* Invite info card */}
        <div className="bg-white border border-slate-200 rounded-2xl p-5 mb-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Your Role</span>
            <span className={`text-xs font-bold px-3 py-1 rounded-lg ${ROLE_COLOR[invite?.role_code] || 'bg-slate-100 text-slate-600'}`}>
              {ROLE_LABEL[invite?.role_code] || invite?.role_code}
            </span>
          </div>
          {invite?.message && (
            <p className="text-sm text-slate-700 bg-slate-50 rounded-xl px-4 py-3 italic">"{invite.message}"</p>
          )}
          <div className="flex items-center gap-1.5 mt-3 text-xs text-slate-400">
            <Clock size={11} />
            Expires {invite?.expires_at ? new Date(invite.expires_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
          </div>
        </div>

        {/* Form */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <p className="text-sm font-bold text-slate-900 mb-4">Create your account</p>
          <form onSubmit={handleSubmit} className="space-y-4">

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Full name</label>
              <div className="relative">
                <User size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type="text" value={form.full_name} onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
                  placeholder="Your name" required
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={showPw ? 'text' : 'password'} value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  placeholder="At least 6 characters" required
                  className="w-full pl-9 pr-10 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                  {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Confirm password</label>
              <div className="relative">
                <Lock size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                <input type={showPw ? 'text' : 'password'} value={form.confirm}
                  onChange={e => setForm(f => ({ ...f, confirm: e.target.value }))}
                  placeholder="Repeat password" required
                  className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            {submitError && (
              <div className="px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 text-center">
                {submitError}
              </div>
            )}

            <button type="submit" disabled={submitting}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all">
              {submitting ? 'Creating account…' : 'Accept Invite & Join SKOVO'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-slate-400 mt-4">
          Already have an account? <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
