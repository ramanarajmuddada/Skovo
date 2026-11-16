import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi, saveSuperToken } from '../../services/api';
import { Mail, Lock, Eye, EyeOff } from 'lucide-react';
import AuthLayout from '../../components/layout/AuthLayout';
import { Button, Input } from '../../components/ui/index.jsx';

const MUTED = { color: 'rgba(148, 163, 184, 0.9)' };

export default function SuperLogin() {
  const navigate = useNavigate();
  const [form, setForm]           = useState({ email: '', password: '' });
  const [showPassword, setShowPw] = useState(false);
  const [error, setError]         = useState('');
  const [loading, setLoading]     = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    if (!form.email || !form.password) { setError('Email and password are required.'); return; }
    setLoading(true);
    try {
      const { data, ok } = await superApi.post('/skovo-platform-owner/login', form);
      if (!ok || !data.bool) { setError(data.response?.message || 'Invalid credentials.'); return; }
      saveSuperToken(data.access_token);
      localStorage.setItem('super_user', JSON.stringify(data.response));
      navigate('/skovo-platform-owner');
    } catch {
      setError('Connection error. Is the backend running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthLayout variant="super">
      <div className="mb-8">
        <h1 className="text-2xl font-black text-slate-900 tracking-tight">Founder Console</h1>
        <p className="text-sm mt-1.5" style={MUTED}>Sign in to your SKOVO super admin account</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Email */}
        <Input
          label="Email address"
          type="email"
          value={form.email}
          onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
          placeholder="super@skovo.in"
          icon={<Mail size={15} />}
          autoComplete="email"
          autoFocus
        />

        {/* Password */}
        <div>
          <Input
            label="Password"
            type={showPassword ? 'text' : 'password'}
            value={form.password}
            onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
            placeholder="Your password"
            icon={<Lock size={15} />}
            autoComplete="current-password"
            rightIcon={
              <button aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={!!showPassword}
                type="button"
                onClick={() => setShowPw(v => !v)}
                style={MUTED}
                className="hover:opacity-100 transition-opacity"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
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
