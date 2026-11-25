import React, { useState } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from '../components/ui/index.jsx';
import { Lock, Mail, Eye, EyeOff } from 'lucide-react';
import { postAuthPath } from '../utils/checkoutIntent';
import LoginOtpStep from '../components/auth/LoginOtpStep';
import { login as loginSchema, otpLogin as otpLoginSchema, fieldErrors } from '../schemas/student';

/* Muted text colour that is readable in both light and dark mode.
   We bypass the global dark-mode slate overrides which make slate-400 too dark. */
const MUTED = { color: 'rgba(148, 163, 184, 0.9)' }; // slate-400 equivalent, always readable

export default function Login() {
  const { sendOtp, loginWithPassword, verifyLoginOtp, resendLoginOtp } = useAuth();
  // Set once the password is accepted and a code has been emailed: the screen
  // then asks for the code instead of the password.
  const [challenge, setChallenge] = useState(null);
  const navigate = useNavigate();

  const justRegistered = useLocation().state?.registered;
  const [mode,         setMode]         = useState('password'); // 'password' | 'otp'
  const [email,        setEmail]        = useState('');
  const [password,     setPassword]     = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otpInput,     setOtpInput]     = useState('');
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState('');
  const [fieldErr,     setFieldErr]     = useState({});

  const clearField = (k) => {
    if (fieldErr[k]) setFieldErr(e => ({ ...e, [k]: undefined }));
  };

  /* ── Password login — direct, no OTP step ── */
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      setFieldErr(fieldErrors(parsed));
      return;
    }
    setFieldErr({});
    setLoading(true);
    try {
      const result = await loginWithPassword({ email: parsed.data.email.toLowerCase(), password: parsed.data.password });
      if (result?.otpRequired) {
        // Password accepted; a code was emailed. No session exists yet.
        setPassword('');
        setChallenge(result);
        return;
      }
      // A plan picked on the landing page survives the login detour.
      navigate(postAuthPath());
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /* ── OTP login ── */
  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const parsed = otpLoginSchema.safeParse({ identifier: otpInput });
    if (!parsed.success) {
      setFieldErr(fieldErrors(parsed));
      return;
    }
    setFieldErr({});
    const ident = parsed.data.identifier;
    const phone = /^\+?[0-9]{7,15}$/.test(ident);
    setLoading(true);
    try {
      // purpose+role, or the server falls back to the SIGNUP branch, which
      // expects the account NOT to exist and so mails a code to any address.
      const sent = await sendOtp({
        phone: phone ? ident : undefined,
        email: phone ? undefined : ident.toLowerCase(),
        purpose: 'login',
        role: 'student',
      });
      navigate('/verify-email', {
        state: {
          phone: phone ? ident : undefined,
          email: phone ? undefined : ident.toLowerCase(),
          notice: sent?.response?.message || sent?.message || '',
        },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const switchMode = (m) => { setMode(m); setError(''); setFieldErr({}); };

  if (challenge) {
    return (
      <AuthLayout>
        <LoginOtpStep
          emailMasked={challenge.emailMasked}
          resendIn={challenge.resendIn}
          onVerify={async (otp) => {
            await verifyLoginOtp({ challengeId: challenge.challengeId, otp });
            navigate(postAuthPath());
          }}
          onResend={async () => {
            const r = await resendLoginOtp({ challengeId: challenge.challengeId });
            // The server issues a new challenge id with every code.
            setChallenge((c) => ({ ...c, challengeId: r.challenge_id, resendIn: r.resend_in }));
            return r;
          }}
          onBack={() => setChallenge(null)}
        />
      </AuthLayout>
    );
  }

  const fieldCls = '!text-base min-h-11';
  const eyeBtn = 'relative p-2 -m-1 hover:opacity-100 transition-opacity before:absolute before:-inset-2 before:content-[\'\']';

  return (
    <AuthLayout>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Welcome back</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Sign in to your SKOVO account</p>
      </div>

      {/* Arriving from a finished signup. Without this the person lands on an
          empty sign-in form and cannot tell whether the account was created. */}
      {justRegistered && !error && !Object.keys(fieldErr).length && (
        <div role="status" className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          Account created. Sign in to continue.
        </div>
      )}

      {/* Tab toggle — Password first */}
      <div className="flex gap-1 p-1 bg-slate-100 rounded-xl mb-5 sm:mb-6">
        <button
          type="button"
          onClick={() => switchMode('password')}
          className={`flex-1 min-h-11 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            mode === 'password'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Password
        </button>
        <button
          type="button"
          onClick={() => switchMode('otp')}
          className={`flex-1 min-h-11 py-2.5 text-sm font-semibold rounded-lg transition-all ${
            mode === 'otp'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          OTP Login
        </button>
      </div>

      {/* ── Password form ── */}
      {mode === 'password' ? (
        <form onSubmit={handlePasswordSubmit} noValidate className="space-y-3.5 sm:space-y-4">
          <Input
            label="Email Address"
            type="email"
            name="email"
            autoComplete="email"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            required
            value={email}
            onChange={(e) => { setEmail(e.target.value); clearField('email'); }}
            placeholder="Enter email address"
            icon={<Mail size={16} />}
            error={fieldErr.email}
            className={fieldCls}
            autoFocus
            aria-describedby={error ? 'login-error' : undefined}
          />
          <div>
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => { setPassword(e.target.value); clearField('password'); }}
              placeholder="Enter password"
              icon={<Lock size={16} />}
              error={fieldErr.password}
              className={fieldCls}
              aria-describedby={error ? 'login-error' : undefined}
              rightIcon={
                <button aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={!!showPassword}
                  type="button"
                  onClick={() => setShowPassword(v => !v)}
                  style={MUTED}
                  className={eyeBtn}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              }
            />
            <div className="flex justify-end mt-1">
              <Link
                to="/forgot-password"
                className="text-xs font-semibold py-2 transition-opacity hover:opacity-100"
                style={{ color: 'var(--accent)' }}
              >
                Forgot password?
              </Link>
            </div>
          </div>

          {error && (
            <div id="login-error" role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full min-h-11 !text-base">
            {loading ? 'Signing in…' : 'Sign In'}
          </Button>
        </form>

      ) : (
        /* ── OTP form ── */
        <form onSubmit={handleOtpSubmit} noValidate className="space-y-3.5 sm:space-y-4">
          <Input
            label="Email Address"
            type="email"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            inputMode="email"
            required
            value={otpInput}
            onChange={(e) => { setOtpInput(e.target.value); clearField('identifier'); }}
            placeholder="Enter email address"
            icon={<Mail size={16} />}
            error={fieldErr.identifier}
            className={fieldCls}
            autoFocus
            aria-describedby={error ? 'login-error' : undefined}
          />

          {error && (
            <div id="login-error" role="alert"
              className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
              {error}
            </div>
          )}

          <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full min-h-11 !text-base">
            {loading ? 'Sending OTP…' : 'Continue with OTP'}
          </Button>
        </form>
      )}

      {/* Bottom links */}
      <div className="mt-5 space-y-3">
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(148,163,184,0.25)' }} />
          <span className="text-xs font-medium shrink-0" style={MUTED}>or</span>
          <div className="flex-1 h-px" style={{ backgroundColor: 'rgba(148,163,184,0.25)' }} />
        </div>
        <Link
          to="/signup"
          className="w-full min-h-11 inline-flex items-center justify-center py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}
        >
          Create account
        </Link>
      </div>
    </AuthLayout>
  );
}
