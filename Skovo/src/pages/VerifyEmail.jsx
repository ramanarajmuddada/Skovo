import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/index.jsx';
import { ShieldCheck } from 'lucide-react';
import { postAuthPath } from '../utils/checkoutIntent';
import { clearReferralCode } from '../utils/referralCode';
import { otp as otpSchema, fieldErrors } from '../schemas/student';

export default function VerifyEmail() {
  const { verifyOtp, sendOtp, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const { phone, email, whatsapp, full_name, role, institution_name, institution_subdomain, password, referral_code, notice } = location.state || {};
  const target = phone || email || '';

  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!target) navigate('/login');
    else inputRefs.current[0]?.focus();
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
    const parsed = otpSchema.safeParse({ otp: otp.join('') });
    if (!parsed.success) {
      setError(fieldErrors(parsed).otp || 'Enter the 6-digit code.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await verifyOtp({ phone, email, whatsapp, otp: parsed.data.otp, full_name, role, institution_name, institution_subdomain, password, referral_code });
      if (referral_code) clearReferralCode('student');
      if (result?.response?.role === 'admin') {
        navigate('/skovo-platform-panel-admin');
      } else if (password) {
        // Signing UP, not signing in. Verifying the code used to drop the
        // person straight into the app, while the achiever's identical flow
        // sent them to its login screen -- two registrations, two different
        // endings. Both finish at login now.
        //
        // The session the verify call just issued has to go with it, or they
        // are "logged out" while still holding a valid token.
        await logout();
        navigate('/login', { state: { registered: true } });
      } else {
        // No password in state means this was OTP sign-IN, where being signed
        // in IS the point. Straight to checkout if they came from the landing
        // page's pricing cards.
        navigate(postAuthPath());
      }
    } catch (err) {
      setError(err.message);
      // Clear the boxes and go back to the first one. A rejected code stayed
      // on screen, so the next attempt began by deleting six digits one at a
      // time -- on a phone keyboard, with a countdown of attempts running.
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true); setError('');
    try {
      await sendOtp({ phone, email });
      setSuccess('OTP resent! Check your messages.');
      setOtp(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout>
      {/* Header */}
      <div className="mb-8">
        <div className="hidden lg:flex w-12 h-12 rounded-2xl items-center justify-center mb-5" style={{ backgroundColor: 'var(--accent)' }}>
          <ShieldCheck size={22} className="text-white" />
        </div>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight mb-1">Enter your OTP</h1>
        <p className="text-sm" style={{ color: 'rgba(148,163,184,0.9)' }}>
          {/* On the OTP sign-in path the server answers the same whether or not
              the account exists, and sends nothing when it does not. Asserting
              "We sent a 6-digit code to <target>" over that non-answer is a
              claim the server never made. */}
          {notice ? notice : <>
            We sent a 6-digit code to{' '}
            <span className="font-semibold text-slate-900">{target}</span>
          </>}
        </p>
      </div>

      <form onSubmit={handleVerify} noValidate>
        {/* OTP boxes */}
        <div className="flex justify-between gap-1.5 sm:gap-2 mb-5" onPaste={handlePaste}>
          {otp.map((digit, i) => (
            <input
              key={i}
              ref={(el) => (inputRefs.current[i] = el)}
              type="text"
              inputMode="numeric"
              maxLength={1}
              autoComplete="one-time-code"
              aria-label={`Digit ${i + 1} of 6`}
              value={digit}
              onChange={(e) => handleChange(i, e.target.value)}
              onKeyDown={(e) => handleKeyDown(i, e)}
              style={digit ? { borderColor: 'var(--accent)', backgroundColor: 'var(--accent-light)', color: 'var(--accent-text)' } : {}}
              className={`flex-1 min-w-0 max-w-12 h-12 min-h-11 text-center text-xl font-black border-2 rounded-xl focus:outline-none transition-all ${
                digit ? '' : 'border-slate-200 bg-slate-50 text-slate-900'
              }`}
            />
          ))}
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl text-center">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 text-sm text-emerald-600 bg-emerald-50 border border-emerald-200 px-4 py-3 rounded-xl text-center">
            {success}
          </div>
        )}

        <Button
          type="submit"
          variant="primary"
          size="lg"
          className="w-full min-h-11"
          disabled={loading}
        >
          {/* One screen, two jobs. On the signup path this now ends at the
              login form, so promising a sign-in here would be a label that
              describes what the button used to do. */}
          {loading ? 'Verifying…' : (password ? 'Verify email' : 'Verify & Sign In')}
        </Button>
      </form>

      <div className="mt-6 text-center space-y-3">
        <p className="text-sm" style={{ color: 'rgba(148,163,184,0.9)' }}>
          Didn't receive it?{' '}
          <button
            onClick={handleResend}
            disabled={resending}
            className="font-semibold min-h-11 hover:underline disabled:opacity-50 transition-opacity"
            style={{ color: 'var(--accent)' }}
          >
            {resending ? 'Resending…' : 'Resend OTP'}
          </button>
        </p>
        <Link
          to="/login"
          className="block text-xs transition-opacity hover:opacity-100"
          style={{ color: 'rgba(148,163,184,0.7)' }}
        >
          {/* Both routes into this screen -- signup and OTP sign-in -- are
              email only now, so "phone / email" offered a choice that is not
              on either form. `phone` is still read from location.state above
              so an older link mid-flow keeps working. */}
          ← Change email
        </Link>
      </div>
    </AuthLayout>
  );
}
