import React, { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, Mail, Lock, Eye, EyeOff, Loader2, ArrowLeft } from 'lucide-react';
import AchieverAuthLayout from '../../components/layout/AchieverAuthLayout';
import { API_BASE_URL } from '../../services/api';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

export default function AchieverForgotPassword() {
  const navigate = useNavigate();
  const [step, setStep]         = useState(1);
  const [email, setEmail]       = useState('');
  const [otp, setOtp]           = useState(['', '', '', '', '', '']);
  const [newPw, setNewPw]       = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [showCpw, setShowCpw]   = useState(false);
  const [loading, setLoading]   = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const inputRefs = useRef([]);

  useEffect(() => { if (step === 2) inputRefs.current[0]?.focus(); }, [step]);

  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    const emailParsed = schema.login.pick({ email: true }).safeParse({ email: email.trim() });
    if (!emailParsed.success) {
      setError(Object.values(fieldErrors(emailParsed))[0] || 'Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/auth/otp/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // purpose + role, or the server applies the SIGNUP guard to a reset and
        // refuses every address that actually has an account.
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          purpose: 'reset',
          role: 'achiever',
        }),
      });
      const data = await res.json();
      if (!data.bool) { setError(data.response?.message || 'Failed to send OTP.'); return; }
      // The server answers identically whether or not the address has an account
      // -- deliberate, so this form cannot be used to enumerate accounts. Showing
      // our own "Code sent to <email>" over the top of that turned a careful
      // non-answer into a false claim: an unregistered address was marched to the
      // OTP screen to wait for a code the server had already decided not to send.
      setNotice(data.response?.message || '');
      setStep(2);
    } catch { setError('Network error. Please try again.'); }
    finally { setLoading(false); }
  };

  const handleOtpChange = (i, v) => {
    if (!/^\d?$/.test(v)) return;
    const u = [...otp]; u[i] = v; setOtp(u);
    if (v && i < 5) inputRefs.current[i + 1]?.focus();
  };
  const handleOtpKey = (i, e) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) inputRefs.current[i - 1]?.focus();
  };
  const handlePaste = (e) => {
    const p = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (p.length === 6) { setOtp(p.split('')); inputRefs.current[5]?.focus(); }
  };

  const handleOtpNext = (e) => {
    e.preventDefault();
    const parsed = schema.otp.safeParse({ otp: otp.join('') });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Enter all 6 digits.');
      return;
    }
    setError(''); setSuccess(''); setStep(3);
  };

  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    const parsed = schema.resetPassword.safeParse({
      email: email.trim(),
      otp: otp.join(''),
      password: newPw,
      confirmPassword: confirmPw,
    });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Check your password and try again.');
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/achiever/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), otp: otp.join(''), new_password: newPw }),
      });
      const data = await res.json();
      if (!data.bool) { setError(data.response?.message || 'Reset failed.'); return; }
      setSuccess('Password updated! Redirecting to sign in…');
      setTimeout(() => navigate('/skovo-achiever-portal/login'), 2000);
    } catch { setError('Something went wrong. Try again.'); }
    finally { setLoading(false); }
  };

  // min-h-11: py-2.5 lands at 42px, two short of the 44px touch minimum.
  const inputCls = 'w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-shadow';

  return (
    <AchieverAuthLayout>
      <div className="mb-7">
        <div className="hidden lg:flex w-12 h-12 rounded-2xl items-center justify-center mb-5 shadow-lg"
          style={{ backgroundColor: 'var(--accent)' }}>
          <KeyRound size={22} className="text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-900">
          {step === 1 ? 'Reset password' : step === 2 ? 'Enter OTP' : 'Set new password'}
        </h1>
        <p className="text-sm mt-1.5" style={MUTED}>
          {step === 1 && "Enter your email and we'll send a verification code."}
          {step === 2 && (notice
            ? notice
            : <>Code sent to <span className="font-semibold text-slate-800">{email}</span></>)}
          {step === 3 && 'Choose a new password for your Achiever account.'}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map(s => (
          <div key={s} className="h-1.5 flex-1 rounded-full transition-all"
            style={{ backgroundColor: s <= step ? 'var(--accent)' : 'var(--sidebar-border)' }} />
        ))}
      </div>

      {/* Step 1 — Email */}
      {step === 1 && (
        <form onSubmit={handleSendOtp} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email address</label>
            <div className="relative">
              <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Enter your email" autoFocus className={inputCls} style={{ paddingLeft: 36 }} />
            </div>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            style={{ backgroundColor: 'var(--accent)' }}>
            {loading ? <><Loader2 size={15} className="animate-spin" /> Sending…</> : 'Send OTP →'}
          </button>
        </form>
      )}

      {/* Step 2 — OTP */}
      {step === 2 && (
        <form onSubmit={handleOtpNext} noValidate className="space-y-5">
          {success && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl text-center">{success}</div>}
          <div className="flex justify-between gap-2" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input key={i} ref={el => (inputRefs.current[i] = el)}
                type="text" inputMode="numeric" maxLength={1} value={digit}
                // Lets iOS and Android offer the emailed code instead of making
                // someone leave the page, memorise six digits and come back.
                autoComplete="one-time-code"
                aria-label={`Digit ${i + 1} of 6`}
                onChange={e => handleOtpChange(i, e.target.value)}
                onKeyDown={e => handleOtpKey(i, e)}
                className="flex-1 min-w-0 max-w-11 h-12 text-center text-xl font-black border-2 rounded-xl focus:outline-none transition-all"
                style={digit
                  ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-light,#f0fdf4)', color: 'var(--accent)' }
                  : { borderColor: 'var(--sidebar-border)', backgroundColor: 'rgba(255,255,255,0.04)' }}
              />
            ))}
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl text-center">{error}</div>}
          <button type="submit" disabled={otp.join('').length < 6}
            className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-40 transition-all"
            style={{ backgroundColor: 'var(--accent)' }}>
            Verify OTP →
          </button>
          <p className="text-center text-sm text-slate-500">
            Didn't receive it?{' '}
            <button type="button" onClick={() => { setStep(1); setOtp(['','','','','','']); setError(''); setSuccess(''); }}
              className="font-semibold hover:opacity-75 transition-opacity" style={{ color: 'var(--accent)' }}>
              Resend
            </button>
          </p>
        </form>
      )}

      {/* Step 3 — New password */}
      {step === 3 && (
        <form onSubmit={handleReset} noValidate className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">New Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type={showPw ? 'text' : 'password'} value={newPw} onChange={e => setNewPw(e.target.value)}
                placeholder="Enter your new password" autoFocus className={inputCls} style={{ paddingLeft: 36, paddingRight: 36 }} />
              <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors before:absolute before:content-[''] before:-inset-[15px] before:rounded-lg">
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Confirm Password</label>
            <div className="relative">
              <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input type={showCpw ? 'text' : 'password'} value={confirmPw} onChange={e => setConfirmPw(e.target.value)}
                placeholder="Re-enter your password" className={inputCls} style={{ paddingLeft: 36, paddingRight: 36 }} />
              <button aria-label={showCpw ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={!!showCpw} type="button" onClick={() => setShowCpw(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors before:absolute before:content-[''] before:-inset-[15px] before:rounded-lg">
                {showCpw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl text-center">{success}</div>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
            style={{ backgroundColor: 'var(--accent)' }}>
            {loading ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : 'Save New Password →'}
          </button>
        </form>
      )}

      <div className="mt-6">
        <button onClick={() => navigate('/skovo-achiever-portal/login')}
          className="w-full inline-flex items-center justify-center gap-1.5 py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}>
          <ArrowLeft size={14} /> Back to sign in
        </button>
      </div>
    </AchieverAuthLayout>
  );
}
