import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import AuthLayout from '../../components/layout/AuthLayout';
import { Button, Input } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/admin';
import { fieldErrors } from '../../schemas/achiever';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

export default function AdminLogin() {
  const navigate = useNavigate();
  const { adminLogin } = useAuth();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    const token = localStorage.getItem('admin_access_token');
    if (token) navigate('/skovo-platform-panel-admin', { replace: true });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    // Was `if (!email || !password)`, which accepted anything non-empty as an
    // email address. Typing `skovoadmin` instead of the full address sent it,
    // and the server answered "invalid credentials" -- so a mistyped address
    // read as a wrong password, which is the one thing it was not.
    const parsed = schema.login.safeParse({ email, password });
    if (!parsed.success) {
      setError(Object.values(fieldErrors(parsed))[0] || 'Email and password are required.');
      return;
    }
    setLoading(true);
    try {
      await adminLogin({ email, password });
      navigate('/skovo-platform-panel-admin', { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout variant="admin">
      <div className="mb-8 text-center lg:text-left">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Admin Portal</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Sign in to your SKOVO admin account</p>
      </div>

      {/* noValidate, so the schema above is what speaks. Without it the browser
          got there first with its own grey tooltip -- "Please include an '@' in
          the email address" -- in the OS's styling, in the OS's language, and
          nothing we wrote ever ran. The achiever login already does this; this
          form was the odd one out. */}
      <form onSubmit={handleSubmit} noValidate className="space-y-4">
        {/* Email */}
        <Input
          label="Email address"
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@skovoai.com"
          icon={<Mail size={15} />}
          autoComplete="email"
          autoFocus
        />

        {/* Password */}
        <div>
          <Input
            label="Password"
            type={showPw ? 'text' : 'password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="Your password"
            icon={<Lock size={15} />}
            autoComplete="current-password"
            rightIcon={
              <button aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={!!showPw}
                type="button"
                onClick={() => setShowPw(p => !p)}
                style={MUTED}
                className="p-2.5 -m-2.5 hover:opacity-100 transition-opacity"
                tabIndex={-1}
              >
                {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            }
          />
        </div>

        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
            {error}
          </div>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="w-full">
          {loading ? 'Signing in…' : 'Sign In →'}
        </Button>
      </form>

    </AuthLayout>
  );
}
