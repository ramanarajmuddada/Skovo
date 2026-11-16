import React, { useState, useRef } from 'react';
import { useNavigate, Link, useLocation } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff, Loader2 } from 'lucide-react';
import { saveAchieverToken, API_BASE_URL } from '../../services/api';
import AchieverAuthLayout from '../../components/layout/AchieverAuthLayout';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

export default function AchieverLogin() {
  const navigate = useNavigate();
  const justRegistered = useLocation().state?.registered;
  const [form, setForm]     = useState({ email: '', password: '' });
  const [show, setShow]     = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [errors, setErrors] = useState({});
  const emailRef = useRef(null);
  const pwRef    = useRef(null);

  const sf = (k, v) => {
    setForm(f => ({ ...f, [k]: v }));
    if (errors[k]) setErrors(e => ({ ...e, [k]: undefined }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    const parsed = schema.login.safeParse(form);
    if (!parsed.success) {
      const fe = fieldErrors(parsed);
      setErrors(fe);
      (fe.email ? emailRef : pwRef).current?.focus();
      return;
    }
    setErrors({});
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/achiever/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email.trim().toLowerCase(), password: form.password }),
      });
      const data = await res.json();
      if (!data.bool) { setError(data.response?.message || 'Login failed.'); return; }
      saveAchieverToken(data.access_token);
      localStorage.setItem('achiever_user', JSON.stringify(data.response));
      navigate('/skovo-achiever-portal');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // min-h-11: py-2.5 lands at 42px, two short of the 44px touch minimum.
  const inputCls = 'w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-shadow';

  return (
    <AchieverAuthLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-900">Welcome back</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Sign in to your Achiever account</p>
      </div>

      {/* AchieverVerifyOTP has always navigated here with { registered: true }
          and this screen never read it, so a new achiever landed on a blank
          sign-in form with no sign the registration had worked. */}
      {justRegistered && !error && !Object.keys(errors).length && (
        <div role="status" className="mb-5 p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-700">
          Account created. Sign in to continue.
        </div>
      )}

      {error && (
        <div role="alert" className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        <div>
          <label className="block text-sm font-semibold text-slate-700 mb-1.5">Email</label>
          <div className="relative">
            <Mail size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={emailRef}
              type="email" value={form.email}
              onChange={e => sf('email', e.target.value)}
              placeholder="Enter your email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'ach-login-email-err' : undefined}
              className={inputCls}
              style={{ paddingLeft: 36 }}
            />
          </div>
          {errors.email && <p id="ach-login-email-err" role="alert" className="text-xs text-red-500 mt-1">{errors.email}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-sm font-semibold text-slate-700">Password</label>
            <Link to="/skovo-achiever-portal/forgot-password" className="text-xs font-semibold hover:opacity-80"
              style={{ color: 'var(--accent)' }}>
              Forgot password?
            </Link>
          </div>
          <div className="relative">
            <Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              ref={pwRef}
              type={show ? 'text' : 'password'} value={form.password}
              onChange={e => sf('password', e.target.value)}
              placeholder="Enter your password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'ach-login-pw-err' : undefined}
              className={inputCls}
              style={{ paddingLeft: 36, paddingRight: 36 }}
            />
            <button aria-label={show ? "Hide password" : "Show password"} aria-pressed={!!show} type="button" onClick={() => setShow(s => !s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors before:absolute before:content-[''] before:-inset-[15px] before:rounded-lg">
              {show ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          </div>
          {errors.password && <p id="ach-login-pw-err" role="alert" className="text-xs text-red-500 mt-1">{errors.password}</p>}
        </div>

        <button type="submit" disabled={loading}
          className="w-full py-3 rounded-xl font-bold text-white text-sm flex items-center justify-center gap-2 disabled:opacity-50 transition-all"
          style={{ backgroundColor: 'var(--accent)' }}
          onMouseEnter={e => { if (!loading) e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}>
          {loading ? <><Loader2 size={15} className="animate-spin" /> Signing in...</> : 'Sign In →'}
        </button>
      </form>

      <div className="mt-5 space-y-3">
        <div className="relative flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-100" />
          <span className="text-xs font-medium text-slate-400 shrink-0">or</span>
          <div className="flex-1 h-px bg-slate-100" />
        </div>
        <Link to="/skovo-achiever-portal/register"
          className="w-full inline-flex items-center justify-center py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}>
          Register as Achiever
        </Link>
      </div>
    </AchieverAuthLayout>
  );
}
