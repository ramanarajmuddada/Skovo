import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Shield, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export default function AdminVerifyOTP() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const { adminSendOtp, adminRegister } = useAuth();

  const { full_name, email, password } = location.state || {};

  const [otp, setOtp]           = useState(['', '', '', '', '', '']);
  const [loading, setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError]       = useState('');
  const [success, setSuccess]   = useState('');
  const inputRefs = useRef([]);

  useEffect(() => {
    if (!email || !password || !full_name) {
      navigate('/skovo-platform-panel-admin/register', { replace: true });
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
    if (code.length < 6) { setError('Please enter all 6 digits.'); return; }
    setError('');
    setLoading(true);
    try {
      await adminRegister({ full_name, email, password, otp: code });
      navigate('/skovo-platform-panel-admin/login', {
        state: { registered: true, email },
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setResending(true); setError('');
    try {
      await adminSendOtp({ email });
      setSuccess('OTP resent! Check your inbox.');
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
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-4 shadow-lg shadow-blue-900/40">
            <Shield size={26} className="text-white" />
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">Verify Your Email</h1>
          <p className="text-slate-500 text-sm mt-1">
            We sent a 6-digit code to{' '}
            <span className="text-slate-300 font-semibold">{email}</span>
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-7 shadow-2xl">
          <form onSubmit={handleVerify} className="space-y-5">

            {/* OTP boxes */}
            <div className="flex justify-between gap-2" onPaste={handlePaste}>
              {otp.map((digit, i) => (
                <input
                  key={i}
                  ref={el => (inputRefs.current[i] = el)}
                  type="text"
                  inputMode="numeric"
                  maxLength={1}
                  value={digit}
                  onChange={e => handleChange(i, e.target.value)}
                  onKeyDown={e => handleKeyDown(i, e)}
                  className={`w-11 h-12 text-center text-xl font-black rounded-xl border-2 focus:outline-none transition-all
                    ${digit
                      ? 'border-blue-500 bg-blue-950 text-blue-300'
                      : 'border-slate-700 bg-slate-800 text-white focus:border-blue-500'
                    }`}
                />
              ))}
            </div>

            {error && (
              <div className="px-4 py-3 bg-red-950 border border-red-800 rounded-xl text-xs text-red-400 text-center">
                {error}
              </div>
            )}
            {success && (
              <div className="px-4 py-3 bg-emerald-950 border border-emerald-800 rounded-xl text-xs text-emerald-400 text-center">
                {success}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || otp.join('').length < 6}
              className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-all shadow-lg shadow-blue-900/30"
            >
              {loading ? 'Verifying…' : 'Verify & Create Account →'}
            </button>
          </form>

          <div className="mt-5 text-center space-y-3">
            <p className="text-xs text-slate-500">
              Didn't receive it?{' '}
              <button
                onClick={handleResend}
                disabled={resending}
                className="text-blue-400 font-semibold hover:text-blue-300 disabled:opacity-50 transition-colors"
              >
                {resending ? 'Resending…' : 'Resend OTP'}
              </button>
            </p>
          </div>
        </div>

        <div className="text-center mt-6">
          <button
            onClick={() => navigate('/skovo-platform-panel-admin/register')}
            className="inline-flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-400 transition-colors"
          >
            <ArrowLeft size={13} /> Back to Register
          </button>
        </div>
      </div>
    </div>
  );
}
