import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import AuthLayout from '../components/layout/AuthLayout';
import { useAuth } from '../context/AuthContext';
import { Button, Input } from '../components/ui/index.jsx';
import { User, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { z } from 'zod';
import { rememberReferralCode } from '../utils/referralCode';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

const schema = z.object({
  fullName:        z.string().min(2, 'Full name must be at least 2 characters'),
  email:           z.string().email('Enter a valid email address'),
  password:        z.string().min(6, 'Password must be at least 6 characters'),
  // min(1) so an empty box says so. Without it the only rule on this field was
  // the mismatch refine below, and two empty boxes "match" -- so leaving both
  // blank flagged the password and said nothing at all about this one. The
  // achiever's register form has always asked for it explicitly.
  confirmPassword: z.string().min(1, 'Confirm your password'),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export default function SignUp() {
  const { sendOtp } = useAuth();
  const navigate    = useNavigate();

  const [params] = useSearchParams();
  const [referralCode] = useState(() => rememberReferralCode('student', params.get('ref')));
  const [form, setForm] = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors]   = useState({});
  const [showPw, setShowPw]   = useState(false);
  const [showCf, setShowCf]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const sf = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    const result = schema.safeParse(form);
    if (!result.success) {
      const fe = {};
      result.error.issues.forEach(i => { fe[i.path[0]] = i.message; });
      setErrors(fe);
      return;
    }
    setLoading(true);
    try {
      await sendOtp({ email: form.email.trim().toLowerCase() });
      navigate('/verify-email', {
        state: {
          email: form.email.trim().toLowerCase(),
          full_name: form.fullName.trim(),
          password: form.password,
          role: 'student',
          referral_code: referralCode,
        },
      });
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fieldCls = '!text-base min-h-11';
  const eyeBtn = 'relative p-2 -m-1 hover:opacity-100 transition-opacity before:absolute before:-inset-2 before:content-[\'\']';

  return (
    <AuthLayout>
      <div className="mb-5 sm:mb-6">
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 tracking-tight">Create account</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Join thousands building their careers on SKOVO</p>
        {referralCode && (
          <p className="text-sm mt-2 font-semibold text-slate-700">Joining with referral code {referralCode}</p>
        )}
      </div>

      {/* noValidate, like the sign-in form. Without it the browser's native
          bubble intercepts submit on the type="email" field before
          handleSubmit runs, so the schema below never executed and the person
          got an unstyled OS tooltip in place of this form's own inline errors
          -- grey box, light-mode only, wrong typeface, and nothing said about
          the other four fields. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-3.5 sm:space-y-4">
        <Input
          label="Full Name" required
          type="text"
          name="name"
          autoComplete="name"
          autoCapitalize="words"
          autoCorrect="off"
          value={form.fullName}
          onChange={e => sf('fullName', e.target.value)}
          placeholder="Enter your full name"
          icon={<User size={16} />}
          error={errors.fullName}
          className={fieldCls}
          autoFocus
        />
        <Input
          label="Email Address" required
          type="email"
          name="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          inputMode="email"
          value={form.email}
          onChange={e => sf('email', e.target.value)}
          placeholder="Enter your email address"
          icon={<Mail size={16} />}
          error={errors.email}
          className={fieldCls}
        />
        <Input
          label="Password" required
          type={showPw ? 'text' : 'password'}
          name="password"
          autoComplete="new-password"
          value={form.password}
          onChange={e => sf('password', e.target.value)}
          placeholder="Enter your password"
          icon={<Lock size={16} />}
          error={errors.password}
          hint={errors.password ? undefined : 'At least 6 characters'}
          className={fieldCls}
          rightIcon={
            <button aria-label={showPw ? 'Hide password' : 'Show password'} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(v => !v)} style={MUTED} className={eyeBtn} tabIndex={-1}>
              {showPw ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />
        <Input
          label="Confirm Password" required
          type={showCf ? 'text' : 'password'}
          name="confirmPassword"
          autoComplete="new-password"
          value={form.confirmPassword}
          onChange={e => sf('confirmPassword', e.target.value)}
          placeholder="Re-enter your password"
          icon={<Lock size={16} />}
          error={errors.confirmPassword}
          className={fieldCls}
          rightIcon={
            <button aria-label={showCf ? 'Hide confirmation password' : 'Show confirmation password'} aria-pressed={!!showCf} type="button" onClick={() => setShowCf(v => !v)} style={MUTED} className={eyeBtn} tabIndex={-1}>
              {showCf ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          }
        />

        {apiError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{apiError}</div>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full min-h-11 !text-base">
          {loading ? 'Sending OTP…' : 'Continue'}
        </Button>
      </form>

      <p className="mt-4 text-xs sm:text-[13px] text-center leading-relaxed" style={MUTED}>
        By creating an account you agree to our{' '}
        <span className="font-semibold" style={{ color: 'var(--accent)' }}>Terms of Service</span> and{' '}
        <span className="font-semibold" style={{ color: 'var(--accent)' }}>Privacy Policy</span>.
      </p>

      <div className="mt-5 pt-5 text-center text-sm" style={{ borderTop: '1px solid rgba(148,163,184,0.2)', ...MUTED }}>
        Already have an account?{' '}
        <Link to="/login" className="font-semibold hover:underline inline-block py-1" style={{ color: 'var(--accent)' }}>
          Sign in
        </Link>
      </div>
    </AuthLayout>
  );
}
