import React, { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { User, Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import AchieverAuthLayout from '../../components/layout/AchieverAuthLayout';
import { API_BASE_URL } from '../../services/api';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';
import { rememberReferralCode } from '../../utils/referralCode';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

function Field({ label, required, error, icon: Icon, children }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <div className="relative">
        {Icon && <Icon size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />}
        {children}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// min-h-11: py-2.5 on a 20px line box lands at 42px, two short of the
// 44px touch minimum every other field on the platform now meets.
const inputBase = 'w-full min-h-11 border rounded-xl text-sm focus:outline-none transition-shadow py-2.5';

export default function AchieverRegister() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [referralCode] = useState(() => rememberReferralCode('achiever', params.get('ref')));
  const [form, setForm]       = useState({ full_name: '', email: '', password: '', confirmPassword: '' });
  const [errors, setErrors]   = useState({});
  const [showPw, setShowPw]   = useState(false);
  const [showCf, setShowCf]   = useState(false);
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState('');

  const sf = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  // Tell them the moment the two diverge, not after they press the button.
  //
  // The rule only fires once the confirmation has stopped being a prefix of the
  // password: typing "Pav" into confirm while the password is "Pavan@0703" is
  // someone mid-keystroke, not a mismatch, and shouting at them for it is worse
  // than saying nothing. "Pavan@070323" against "Pavan@0703" is a real
  // divergence and shows immediately.
  const liveMismatch = form.confirmPassword.length > 0
    && !form.password.startsWith(form.confirmPassword)
    ? 'Passwords do not match.'
    : '';

  const handleSubmit = async (e) => {
    e.preventDefault();
    setApiError('');
    const result = schema.register.safeParse(form);
    if (!result.success) {
      setErrors(fieldErrors(result));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/achiever/register/send-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim().toLowerCase() }),
      });
      const data = await res.json();
      if (!data.bool) { setApiError(data.response?.message || 'Failed to send OTP.'); return; }
      navigate('/skovo-achiever-portal/verify-otp', {
        state: {
          email:       form.email.trim().toLowerCase(),
          full_name:   form.full_name.trim(),
          password:    form.password,
          referral_code: referralCode,
        },
      });
    } catch {
      setApiError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AchieverAuthLayout>
      <div className="mb-7">
        <h1 className="text-2xl font-black text-slate-900">Become an Achiever</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Create your account to start mentoring students</p>
        {referralCode && (
          <p className="text-sm mt-2 font-semibold text-slate-700">Joining with referral code {referralCode}</p>
        )}
      </div>

      {apiError && (
        <div className="mb-4 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{apiError}</div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <Field label="Full Name" required icon={User} error={errors.full_name}>
          <input type="text" value={form.full_name} onChange={e => sf('full_name', e.target.value)}
            placeholder="Enter your full name" autoFocus
            className={`${inputBase} border-slate-200 pl-9 pr-3`} />
        </Field>

        <Field label="Email Address" required icon={Mail} error={errors.email}>
          <input type="email" value={form.email} onChange={e => sf('email', e.target.value)}
            placeholder="Enter your email address"
            className={`${inputBase} border-slate-200 pl-9 pr-3`} />
        </Field>

        <Field label="Password" required icon={Lock} error={errors.password}>
          <input type={showPw ? 'text' : 'password'} value={form.password} onChange={e => sf('password', e.target.value)}
            placeholder="Enter your password"
            className={`${inputBase} border-slate-200 pl-9 pr-10`} />
          <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors before:absolute before:content-[''] before:-inset-[15px] before:rounded-lg" tabIndex={-1}>
            {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </Field>

        <Field label="Confirm Password" required icon={Lock} error={errors.confirmPassword || liveMismatch}>
          <input type={showCf ? 'text' : 'password'} value={form.confirmPassword} onChange={e => sf('confirmPassword', e.target.value)}
            placeholder="Re-enter your password"
            className={`${inputBase} border-slate-200 pl-9 pr-10`} />
          <button aria-label={showCf ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={!!showCf} type="button" onClick={() => setShowCf(v => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors before:absolute before:content-[''] before:-inset-[15px] before:rounded-lg" tabIndex={-1}>
            {showCf ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </Field>

        {/* Designation and company are not asked here on purpose.
            They are a claim about who someone is, and at signup nothing backs
            them — the account does not even exist yet. They belong with the
            evidence: the achiever states them on their profile, and uploads
            the office ID or employment proof the admin checks them against. */}

        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all mt-1"
          style={{ backgroundColor: 'var(--accent)' }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}>
          {loading ? 'Sending OTP...' : 'Send Verification OTP →'}
        </button>
        <p className="text-center text-xs" style={MUTED}>We'll send a 6-digit OTP to verify your email</p>
      </form>

      <div className="mt-4 space-y-3">
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-xs font-medium text-slate-400 shrink-0">or</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>
        <Link to="/skovo-achiever-portal/login"
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}>
          <ArrowLeft size={14} /> Back to Login
        </Link>
      </div>
    </AchieverAuthLayout>
  );
}
