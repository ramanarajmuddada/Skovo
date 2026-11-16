import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Star, ArrowLeft } from 'lucide-react';
import { API_BASE_URL } from '../../services/api';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';
import { clearReferralCode } from '../../utils/referralCode';

export default function AchieverVerifyOTP() {
  const navigate = useNavigate();
  const location = useLocation();

  const { email, full_name, password, referral_code } = location.state || {};

  const [otp, setOtp]           = useState(['', '', '', '', '', '']);
  const [loading, setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!email || !full_name || !password) {
      navigate('/skovo-achiever-portal/register', { replace: true });
      return;
    }
    inputRefs.current[0]?.focus();
  }, []);

  const handleChange = (index, value) => {
    if (!/^\d?$/.test(value)) return;
    const updated = [...otp];
    updated[index] = value;
    setOtp(updated);
    if (value && index < 5) inputRefs.current[index + 1]?.focus();
  };

  const handleKeyDown = (index, e) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e) => {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      setOtp(pasted.split(''));
      inputRefs.current[5]?.focus();
    }
  };

  const handleVerify = async (e) => {
    e.preventDefault();
    const code = otp.join('');
    const parsed = schema.otp.safeParse({ otp: code });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Please enter all 6 digits.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/achiever/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          otp: code,
          full_name,
          password,
          referral_code: referral_code || '',
        }),
      });
      const data = await res.json();
      if (!data.bool) {
        setError(data.response?.message || 'Registration failed.');
        // Same as the student screen: a rejected code used to sit in the boxes
        // and the next try started with six deletions.
        setOtp(['', '', '', '', '', '']);
        inputRefs.current[0]?.focus();
        return;
      }
      if (referral_code) clearReferralCode('achiever');
      navigate('/skovo-achiever-portal/login', { state: { registered: true } });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true); setError(''); setSuccess('');
    try {
      const res = await fetch(`${API_BASE_URL}/achiever/register/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!data.bool) { setError(data.response?.message || 'Failed to resend OTP.'); return; }
      setSuccess('OTP resent! Check your inbox.');
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setTimeout(() => setSuccess(''), 5000);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ backgroundColor: 'var(--sidebar-bg)' }}>
      <div className="w-full max-w-sm">

        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl mb-4 shadow-lg"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Star size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Verify Your Email</h1>
          <p className="text-slate-500 text-sm mt-1.5">
            We sent a 6-digit code to{' '}
            <span className="text-slate-300 font-semibold">{email}</span>
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl p-5 sm:p-7 shadow-2xl" style={{ backgroundColor: 'var(--sidebar-sec)', border: '1px solid var(--sidebar-border)' }}>
          <form onSubmit={handleVerify} className="space-y-5">

            {/* 6 OTP boxes */}
            <div className="flex justify-between gap-2" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => (inputRefs.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  // Lets iOS and Android offer the emailed code instead of making
                  // someone leave the page, memorise six digits and come back. Set on
                  // every box because the OS fills whichever one has focus.
                  autoComplete="one-time-code"
                  aria-label={`Digit ${i + 1} of 6`}
                  value={digit}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className="flex-1 min-w-0 max-w-11 h-12 text-center text-xl font-black rounded-xl border-2 focus:outline-none transition-all"
                  style={digit
                    ? { borderColor: 'var(--accent)', backgroundColor: 'var(--sidebar-hover)', color: 'var(--accent-ring)' }
                    : { borderColor: 'var(--sidebar-border)', backgroundColor: 'rgba(255,255,255,0.04)', color: '#fff' }
                  }
                />
              ))}
            </div>

            {error && (
              <div className="px-4 py-3 rounded-xl text-xs text-center"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171' }}>
                {error}
              </div>
            )}
            {success && (
              <div className="px-4 py-3 rounded-xl text-xs text-center"
                style={{ backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#34d399' }}>
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.join('').length < 6}
              className="w-full py-3 rounded-xl font-bold text-white text-sm disabled:opacity-40 transition-all"
              style={{ backgroundColor: 'var(--accent)' }}
              onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.85'; }}
              onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}>
              {loading ? 'Verifying...' : 'Verify & Create Account →'}
            </button>
          </form>

          <div className="mt-5 text-center">
            <p className="text-xs text-slate-500">
              Didn't receive it?{' '}
              <button onClick={handleResend} disabled={resending}
                className="font-semibold disabled:opacity-50 transition-colors"
                style={{ color: 'var(--accent-ring)' }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.75'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                {resending ? 'Resending...' : 'Resend OTP'}
              </button>
            </p>
          </div>
        </div>

        {/* Back link */}
        <div className="text-center mt-6">
          <button onClick={() => navigate('/skovo-achiever-portal/register')}
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors">
            <ArrowLeft size={13} /> Back to Register
          </button>
        </div>

      </div>
    </div>
  );
}
