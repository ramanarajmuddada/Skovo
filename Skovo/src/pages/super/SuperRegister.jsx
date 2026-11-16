import React, { useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { superApi } from '../../services/api';
import AuthLayout from '../../components/layout/AuthLayout';
import { Button, Input } from '../../components/ui/index.jsx';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

export default function SuperRegister() {
  const navigate = useNavigate();

  const [form, setForm]                   = useState({ full_name: '', email: '', password: '', confirm_password: '' });
  const [showPw, setShowPw]               = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [step, setStep]                   = useState(1);
  const [otp, setOtp]                     = useState(['', '', '', '', '', '']);
  const inputRefs                         = useRef([]);
  const [error, setError]                 = useState('');
  const [success, setSuccess]             = useState('');
  const [loading, setLoading]             = useState(false);
  const [resending, setResending]         = useState(false);

  // ── Step 1: Send OTP ──────────────────────────────────────────────────────

  async function handleSendOtp(e) {
    e.preventDefault();
    setError('');
    if (!form.full_name.trim())                        { setError('Please enter your full name.'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) { setError('Enter a valid email address.'); return; }
    if (form.password.length < 8)                      { setError('Password must be at least 8 characters.'); return; }
    if (form.password !== form.confirm_password)       { setError('Passwords do not match.'); return; }

    setLoading(true);
    try {
      const { data, ok } = await superApi.post('/skovo-platform-owner/register/send-otp', { email: form.email });
      if (!ok || !data.bool) { setError(data.response?.message || 'Failed to send OTP.'); return; }
      setStep(2);
      setTimeout(() => inputRefs.current[0]?.focus(), 100);
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  // ── Step 2: Resend OTP ────────────────────────────────────────────────────

  async function handleResend() {
    setResending(true); setError('');
    try {
      const { data, ok } = await superApi.post('/skovo-platform-owner/register/send-otp', { email: form.email });
      if (!ok || !data.bool) { setError(data.response?.message || 'Failed to resend OTP.'); return; }
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setSuccess('OTP resent! Check your inbox.');
      setTimeout(() => setSuccess(''), 4000);
    } catch {
      setError('Connection error.');
    } finally {
      setResending(false);
    }
  }

  // ── Step 2: Verify & Register ─────────────────────────────────────────────

  async function handleRegister(e) {
    e.preventDefault();
    const code = otp.join('');
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    setError('');
    setLoading(true);
    try {
      const { data, ok } = await superApi.post('/skovo-platform-owner/register', {
        full_name: form.full_name,
        email:     form.email,
        password:  form.password,
        otp:       code,
      });
      if (!ok || !data.bool) { setError(data.response?.message || 'Registration failed.'); return; }
      setSuccess('Super admin account created! Redirecting to login…');
      setTimeout(() => navigate('/skovo-platform-owner/login'), 2000);
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  // ── OTP helpers ───────────────────────────────────────────────────────────

  function handleOtpChange(index, value) {
    if (!/^\d?$/.test(value)) return;
    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  }

  function handleOtpKeyDown(index, e) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }

  function handleOtpPaste(e) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) { setOtp(pasted.split('')); inputRefs.current[5]?.focus(); }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <AuthLayout>
      {step === 1 ? (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Create Super Admin</h1>
            <p className="text-sm mt-1.5" style={MUTED}>Platform owner account setup</p>
          </div>

          <form onSubmit={handleSendOtp} className="space-y-4">
            <Input
              label="Full Name"
              type="text"
              value={form.full_name}
              onChange={e => setForm(f => ({ ...f, full_name: e.target.value }))}
              placeholder="Your full name"
              icon={<User size={15} />}
              autoFocus
            />

            <Input
              label="Email"
              type="email"
              value={form.email}
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="super@skovo.in"
              icon={<Mail size={15} />}
              autoComplete="email"
            />

            <Input
              label="Password"
              type={showPw ? 'text' : 'password'}
              value={form.password}
              onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
              placeholder="Min 8 characters"
              icon={<Lock size={15} />}
              autoComplete="new-password"
              rightIcon={
                <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(p => !p)} style={MUTED} className="hover:opacity-100 transition-opacity" tabIndex={-1}>
                  {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            />

            <Input
              label="Confirm Password"
              type={showConfirm ? 'text' : 'password'}
              value={form.confirm_password}
              onChange={e => setForm(f => ({ ...f, confirm_password: e.target.value }))}
              placeholder="Repeat your password"
              icon={<Lock size={15} />}
              autoComplete="new-password"
              rightIcon={
                <button aria-label={showConfirm ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={!!showConfirm} type="button" onClick={() => setShowConfirm(p => !p)} style={MUTED} className="hover:opacity-100 transition-opacity" tabIndex={-1}>
                  {showConfirm ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            />

            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
              {loading ? 'Sending OTP…' : 'Send Verification OTP →'}
            </Button>

            <p className="text-center text-xs" style={MUTED}>We'll send a 6-digit OTP to verify your email</p>
          </form>

          <div className="mt-4 space-y-3">
            <div className="relative flex items-center gap-3">
              <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(148,163,184,0.25)' }} />
              <span className="text-xs font-medium shrink-0" style={MUTED}>or</span>
              <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(148,163,184,0.25)' }} />
            </div>
            <Link
              to="/skovo-platform-owner/login"
              className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 transition-all"
              style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
              onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
              onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}
            >
              <ArrowLeft size={14} /> Back to Super Admin Login
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="mb-8">
            <h1 className="text-2xl font-black text-slate-900 tracking-tight">Verify your email</h1>
            <p className="text-sm mt-1.5" style={MUTED}>
              Enter the 6-digit OTP sent to{' '}
              <span className="font-semibold text-slate-700">{form.email}</span>
            </p>
          </div>

          <form onSubmit={handleRegister} className="space-y-5">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
            )}
            {success && (
              <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl">{success}</div>
            )}

            {/* OTP boxes */}
            <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => (inputRefs.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleOtpChange(i, e.target.value)}
                  onKeyDown={e => handleOtpKeyDown(i, e)}
                  className={`w-11 h-12 text-center text-xl font-bold rounded-xl border-2 focus:outline-none transition-all
                    ${digit
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-slate-200 bg-white text-slate-900 focus:border-violet-400'
                    }`}
                />
              ))}
            </div>

            <Button
              type="submit"
              variant="primary"
              size="lg"
              disabled={loading || otp.join('').length < 6}
              className="w-full"
            >
              {loading ? 'Creating account…' : 'Verify & Create Account'}
            </Button>

            <div className="text-center space-y-2">
              <p className="text-sm" style={MUTED}>
                Didn't receive it?{' '}
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={resending}
                  className="font-semibold text-slate-700 hover:underline disabled:opacity-50"
                >
                  {resending ? 'Resending…' : 'Resend OTP'}
                </button>
              </p>
              <button
                type="button"
                onClick={() => { setStep(1); setOtp(['', '', '', '', '', '']); setError(''); }}
                className="text-xs hover:underline"
                style={MUTED}
              >
                ← Change email
              </button>
            </div>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
