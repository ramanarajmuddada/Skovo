import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { Button, Input } from '../components/ui/index.jsx';
import { KeyRound, Mail, Lock, Eye, EyeOff } from 'lucide-react';

export default function ForgotPassword() {
  const { sendOtp } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(1); // 1=email, 2=otp, 3=new password
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [showCpw, setShowCpw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inputRefs = useRef([]);

  useEffect(() => {
    if (step === 2) inputRefs.current[0]?.focus();
  }, [step]);

  // Step 1 — send OTP
  const handleSendOtp = async (e) => {
    e.preventDefault();
    setError('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.'); return;
    }
    setLoading(true);
    try {
      const res = await sendOtp({ email: email.trim().toLowerCase(),
                                  purpose: 'reset', role: 'student' });
      // The server answers identically whether or not the address has an
      // account -- deliberate, so this form cannot enumerate accounts. Asserting
      // "We sent a code to <email>" over that turned a careful non-answer into a
      // false claim and sent people to wait for a code that was never sent.
      setNotice(res?.response?.message || res?.message || '');
      setStep(2);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  // OTP box handlers
  const handleOtpChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };
  const handleOtpKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) inputRefs.current[index - 1]?.focus();
  };
  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) { setOtp(pasted.split('')); inputRefs.current[5]?.focus(); }
  };

  // Step 2 — verify OTP (just move to step 3, actual verify happens with reset)
  const handleOtpNext = (e) => {
    e.preventDefault();
    if (otp.join('').length < 6) { setError('Enter all 6 digits.'); return; }
    setError('');
    setStep(3);
  };

  // Step 3 — reset password
  const handleReset = async (e) => {
    e.preventDefault();
    setError('');
    if (newPassword.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (newPassword !== confirmPassword) { setError('Passwords do not match.'); return; }
    setLoading(true);
    try {
      const { data } = await api.post('/auth/reset-password', {
        email: email.trim().toLowerCase(),
        otp: otp.join(''),
        new_password: newPassword,
      });
      if (!data.bool) { setError(data.response?.message || 'Reset failed.'); return; }
      setSuccess('Password updated! Redirecting to sign in…');
      setTimeout(() => navigate('/login'), 2000);
    } catch { setError('Something went wrong. Try again.'); }
    finally { setLoading(false); }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <div className="hidden lg:flex w-12 h-12 rounded-2xl items-center justify-center mb-5" style={{ backgroundColor: 'var(--accent)' }}>
          <KeyRound size={22} className="text-white" />
        </div>
        <h1 className="text-2xl font-black text-slate-900 tracking-tight mb-1">
          {step === 1 ? 'Reset password' : step === 2 ? 'Enter OTP' : 'Set new password'}
        </h1>
        <p className="text-sm text-slate-500">
          {step === 1 && "Enter your email and we'll send you a verification code."}
          {step === 2 && (notice
            ? notice
            : <>We sent a code to <span className="font-semibold text-slate-800">{email}</span></>)}
          {step === 3 && 'Choose a new password for your account.'}
        </p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {[1, 2, 3].map((s) => (
          <div key={s} className="h-1.5 flex-1 rounded-full transition-all" style={{ backgroundColor: s <= step ? 'var(--accent)' : 'var(--sidebar-border)' }} />
        ))}
      </div>

      {/* Step 1 — Email */}
      {step === 1 && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <Input
            label="Email address"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Enter email address"
            icon={<Mail size={15} />}
            autoFocus
            className="!text-base"
          />
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          <Button type="submit" variant="primary" size="lg" className="w-full min-h-11" disabled={loading}>
            {loading ? 'Sending OTP…' : 'Send OTP'}
          </Button>
        </form>
      )}

      {/* Step 2 — OTP */}
      {step === 2 && (
        <form onSubmit={handleOtpNext} className="space-y-5">
          <div className="flex justify-between gap-2" onPaste={handlePaste}>
            {otp.map((digit, i) => (
              <input
                key={i}
                ref={(el) => (inputRefs.current[i] = el)}
                type="text"
                inputMode="numeric"
                maxLength={1}
                // Lets iOS and Android offer the emailed code instead of making
                // someone leave the page, memorise six digits and come back. Set on
                // every box because the OS fills whichever one has focus.
                autoComplete="one-time-code"
                aria-label={`Digit ${i + 1} of 6`}
                value={digit}
                onChange={(e) => handleOtpChange(i, e.target.value)}
                onKeyDown={(e) => handleOtpKeyDown(i, e)}
                className="flex-1 min-w-0 max-w-11 h-12 text-center text-xl font-black border-2 rounded-xl focus:outline-none transition-all"
                style={digit
                  ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-light)', color: 'var(--accent-text)' }
                  : { borderColor: 'var(--sidebar-border)', backgroundColor: 'rgba(255,255,255,0.04)' }
                }
              />
            ))}
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl text-center">{error}</div>}
          <Button type="submit" variant="primary" size="lg" className="w-full min-h-11" disabled={otp.join('').length < 6}>
            Verify OTP
          </Button>
          <p className="text-center text-sm text-slate-500">
            Didn't receive it?{' '}
            <button type="button" onClick={() => { setStep(1); setOtp(['','','','','','']); setError(''); }}
              className="font-semibold transition-opacity hover:opacity-100"
              style={{ color: 'var(--accent)' }}>
              Resend
            </button>
          </p>
        </form>
      )}

      {/* Step 3 — New password */}
      {step === 3 && (
        <form onSubmit={handleReset} className="space-y-4">
          <Input
            label="New Password"
            type={showPw ? 'text' : 'password'}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
            hint="At least 6 characters"
            icon={<Lock size={15} />}
            autoFocus
            rightIcon={
              <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(v => !v)}
                style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                tabIndex={-1}>
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
          />
          <Input
            label="Confirm Password"
            type={showCpw ? 'text' : 'password'}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Enter password again"
            icon={<Lock size={15} />}
            rightIcon={
              <button aria-label={showCpw ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={!!showCpw} type="button" onClick={() => setShowCpw(v => !v)}
                style={{ color: '#94a3b8', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                tabIndex={-1}>
                {showCpw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
          />
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}
          {success && <div className="text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl text-center">{success}</div>}
          <Button type="submit" variant="primary" size="lg" className="w-full min-h-11" disabled={loading}>
            {loading ? 'Saving…' : 'Save new password'}
          </Button>
        </form>
      )}

      <div className="mt-6">
        <Link
          to="/login"
          className="w-full min-h-11 inline-flex items-center justify-center py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}
        >
          ← Back to sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
