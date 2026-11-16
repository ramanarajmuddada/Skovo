import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { adminApi } from '../../services/api';
import { User, Mail, Phone, Lock, Eye, EyeOff, Check, Edit3, X } from 'lucide-react';
import { Button, Card, Toast } from '../../components/ui/index.jsx';

const MUTED = { color: '#94a3b8' };

export default function AdminProfile() {
  const { user } = useAuth();
  const adminUser = (() => { try { return JSON.parse(localStorage.getItem('admin_user') || '{}'); } catch { return {}; } })();

  const [editing,      setEditing]      = useState(false);
  const [fullName,     setFullName]     = useState(adminUser.full_name || '');
  const [changePw,     setChangePw]     = useState(false);
  const [currentPw,   setCurrentPw]    = useState('');
  const [newPw,        setNewPw]        = useState('');
  const [confirmPw,    setConfirmPw]    = useState('');
  const [showCur,      setShowCur]      = useState(false);
  const [showNew,      setShowNew]      = useState(false);
  const [showCon,      setShowCon]      = useState(false);
  const [saving,       setSaving]       = useState(false);
  const [error,        setError]        = useState('');
  const [toast,        setToast]        = useState('');

  const initial = (adminUser.full_name || 'A').charAt(0).toUpperCase();
  const email   = adminUser.email || '';
  const phone   = adminUser.phone || '';

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3000); };

  const handleSaveName = async () => {
    if (!fullName.trim()) { setError('Name cannot be empty.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await adminApi.patch('/skovo-platform-panel-admin/profile', { full_name: fullName.trim() });
      if (data.bool) {
        const updated = { ...adminUser, full_name: fullName.trim() };
        localStorage.setItem('admin_user', JSON.stringify(updated));
        setEditing(false);
        showToast('Name updated successfully!');
      } else setError(data.response?.message || 'Failed to update.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleChangePw = async () => {
    if (!currentPw || !newPw) { setError('All password fields are required.'); return; }
    if (newPw.length < 6)      { setError('New password must be at least 6 characters.'); return; }
    if (newPw !== confirmPw)   { setError('Passwords do not match.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await adminApi.post('/skovo-platform-panel-admin/change-password', {
        current_password: currentPw, new_password: newPw,
      });
      if (data.bool) {
        setChangePw(false); setCurrentPw(''); setNewPw(''); setConfirmPw('');
        showToast('Password changed successfully!');
      } else setError(data.response?.message || 'Failed to change password.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const inputStyle = {
    width: '100%', padding: '10px 14px 10px 42px',
    border: '1px solid #e2e8f0', borderRadius: 12,
    fontSize: 14, background: '#fff', outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast message={toast} type="success" />

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-black text-slate-900">My Profile</h1>
        <p className="text-sm text-slate-500 mt-1">View and update your admin account details</p>
      </div>

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
      )}

      {/* Avatar + Name */}
      <Card className="p-4 sm:p-6 mb-4">
        <div className="flex items-center gap-3 sm:gap-5 mb-4 sm:mb-5">
          <div
            className="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center text-white text-xl sm:text-2xl font-bold shrink-0 shadow-lg"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {initial}
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-bold text-slate-900 truncate">{adminUser.full_name || 'Admin'}</h2>
            <p className="text-sm text-slate-500">Admin account</p>
          </div>
          {!editing && (
            <Button variant="secondary" size="sm" onClick={() => { setEditing(true); setError(''); }}>
              <Edit3 size={14} /> Edit
            </Button>
          )}
        </div>

        {/* Edit name */}
        {editing && (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
              <div className="relative">
                <User size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  value={fullName}
                  onChange={e => setFullName(e.target.value)}
                  placeholder="Your full name"
                  style={inputStyle}
                  autoFocus
                />
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" size="sm" onClick={() => { setEditing(false); setError(''); setFullName(adminUser.full_name || ''); }}>
                <X size={14} /> Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={saving} onClick={handleSaveName}>
                <Check size={14} /> {saving ? 'Saving…' : 'Save Name'}
              </Button>
            </div>
          </div>
        )}

        {/* Contact info (read-only) */}
        <div className="space-y-3 mt-2">
          {email && (
            <div className="flex items-center gap-3 py-2.5 border-b border-slate-100">
              <Mail size={15} style={MUTED} />
              <div className="min-w-0">
                <p className="text-xs" style={MUTED}>Email</p>
                <p className="text-sm font-semibold text-slate-900 break-all">{email}</p>
              </div>
            </div>
          )}
          {phone && (
            <div className="flex items-center gap-3 py-2.5">
              <Phone size={15} style={MUTED} />
              <div>
                <p className="text-xs" style={MUTED}>Phone</p>
                <p className="text-sm font-semibold text-slate-900">{phone}</p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Change Password */}
      <Card className="p-4 sm:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Lock size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="font-bold text-slate-900">Password</h3>
          </div>
          {!changePw && (
            <Button variant="secondary" size="sm" onClick={() => { setChangePw(true); setError(''); }}>
              Change
            </Button>
          )}
        </div>

        {!changePw ? (
          <p className="text-sm text-slate-400">••••••••••••</p>
        ) : (
          <div className="space-y-3">
            {/* Current Password */}
            {[
              { label: 'Current Password',  val: currentPw, set: setCurrentPw, show: showCur, setShow: setShowCur },
              { label: 'New Password',      val: newPw,     set: setNewPw,     show: showNew, setShow: setShowNew },
              { label: 'Confirm Password',  val: confirmPw, set: setConfirmPw, show: showCon, setShow: setShowCon },
            ].map(({ label, val, set, show, setShow }) => (
              <div key={label}>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">{label}</label>
                <div className="relative">
                  <Lock size={15} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                  <input
                    type={show ? 'text' : 'password'}
                    value={val}
                    onChange={e => set(e.target.value)}
                    placeholder="••••••••"
                    style={{ ...inputStyle, paddingRight: 42 }}
                  />
                  <button aria-label={show ? "Hide password" : "Show password"} aria-pressed={!!show}
                    type="button"
                    onClick={() => setShow(v => !v)}
                    style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
                  >
                    {show ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>
              </div>
            ))}
            <div className="flex gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { setChangePw(false); setCurrentPw(''); setNewPw(''); setConfirmPw(''); setError(''); }}>
                <X size={14} /> Cancel
              </Button>
              <Button variant="primary" size="sm" disabled={saving} onClick={handleChangePw}>
                <Check size={14} /> {saving ? 'Saving…' : 'Update Password'}
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
