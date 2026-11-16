import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { User, Mail, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import { z } from 'zod';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/layout/AuthLayout';
import { Button, Input } from '../../components/ui/index.jsx';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

const schema = z.object({
  fullName:        z.string().min(2, 'Full name must be at least 2 characters'),
  email:           z.string().email('Enter a valid email address'),
  password:        z.string().min(6, 'Password must be at least 6 characters'),
  confirmPassword: z.string(),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match',
  path: ['confirmPassword'],
});

export default function AdminRegister() {
  const navigate      = useNavigate();
  const { adminSendOtp } = useAuth();

  const [form, setForm]       = useState({ fullName: '', email: '', password: '', confirmPassword: '' });
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
      await adminSendOtp({ email: form.email.trim().toLowerCase() });
      navigate('/skovo-platform-panel-admin/verify-otp', {
        state: { full_name: form.fullName.trim(), email: form.email.trim().toLowerCase(), password: form.password },
      });
    } catch (err) {
      setApiError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout>
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Create Admin Account</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Set up your admin account to manage SKOVO</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Full Name" required
          type="text"
          value={form.fullName}
          onChange={e => sf('fullName', e.target.value)}
          placeholder="Your full name"
          icon={<User size={15} />}
          error={errors.fullName}
          autoFocus
        />
        <Input
          label="Email Address" required
          type="email"
          value={form.email}
          onChange={e => sf('email', e.target.value)}
          placeholder="admin@yourdomain.com"
          icon={<Mail size={15} />}
          error={errors.email}
          autoComplete="email"
        />
        <Input
          label="Password" required
          type={showPw ? 'text' : 'password'}
          value={form.password}
          onChange={e => sf('password', e.target.value)}
          placeholder="Minimum 6 characters"
          icon={<Lock size={15} />}
          error={errors.password}
          autoComplete="new-password"
          rightIcon={
            <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw} type="button" onClick={() => setShowPw(p => !p)} style={MUTED} className="hover:opacity-100 transition-opacity" tabIndex={-1}>
              {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />
        <Input
          label="Confirm Password" required
          type={showCf ? 'text' : 'password'}
          value={form.confirmPassword}
          onChange={e => sf('confirmPassword', e.target.value)}
          placeholder="Repeat your password"
          icon={<Lock size={15} />}
          error={errors.confirmPassword}
          autoComplete="new-password"
          rightIcon={
            <button aria-label={showCf ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={!!showCf} type="button" onClick={() => setShowCf(p => !p)} style={MUTED} className="hover:opacity-100 transition-opacity" tabIndex={-1}>
              {showCf ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          }
        />

        {apiError && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{apiError}</div>
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
          to="/skovo-platform-panel-admin/login"
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold border-2 transition-all"
          style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--accent)'; }}
        >
          <ArrowLeft size={14} /> Back to Admin Login
        </Link>
      </div>
    </AuthLayout>
  );
}
