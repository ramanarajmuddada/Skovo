import React, { useEffect, useRef, useState } from 'react';

/**
 * Second step of sign-in: the 6-digit code emailed after the password was accepted.
 * Used by both the student and the achiever login, so the behaviour is identical.
 *
 * Props
 *   emailMasked  "ra****@gmail.com" — where the code was sent
 *   resendIn     seconds until another code may be requested (from the server)
 *   onVerify(code)  -> Promise; throw an Error with a user-facing message on failure
 *   onResend()      -> Promise<{ resend_in: number }>; throws on failure
 *   onBack()        go back to the password step
 *
 * The server owns every rule (expiry, attempt limit, single use, cooldown). This
 * component only shows what it says.
 */
export default function LoginOtpStep({ emailMasked, resendIn = 60, onVerify, onResend, onBack }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [wait, setWait] = useState(resendIn);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  const submit = async (e) => {
    e.preventDefault();
    if (code.length !== 6) { setError('Enter the 6-digit code from your email.'); return; }
    setBusy(true); setError(''); setInfo('');
    try {
      await onVerify(code);
    } catch (err) {
      setError(err.message || 'Verification failed. Please try again.');
      setCode('');
      inputRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setResending(true); setError(''); setInfo('');
    try {
      const r = await onResend();
      setWait(r?.resend_in ?? 60);
      setCode('');
      setInfo('A new code is on its way. The previous code no longer works.');
      inputRef.current?.focus();
    } catch (err) {
      setError(err.message || 'Could not resend the code.');
      if (err.retryAfter) setWait(err.retryAfter);
    } finally {
      setResending(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-4" aria-live="polite">
      <div>
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary, inherit)' }}>Check your email</h2>
        <p className="text-sm mt-1" style={{ color: 'rgba(148,163,184,0.95)' }}>
          We sent a 6-digit code to <strong>{emailMasked || 'your email'}</strong>. It expires in 10 minutes and works once.
        </p>
      </div>

      <div>
        <label htmlFor="login-otp" className="block text-sm font-medium mb-1.5">Verification code</label>
        <input
          id="login-otp"
          ref={inputRef}
          value={code}
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          placeholder="000000"
          aria-invalid={!!error}
          aria-describedby={error ? 'login-otp-error' : undefined}
          className="w-full min-h-11 px-4 py-3 rounded-xl border text-center text-2xl tracking-[0.5em] font-semibold outline-none focus:ring-2"
          style={{ borderColor: error ? '#ef4444' : 'rgba(148,163,184,0.5)', background: 'transparent', color: 'inherit' }}
        />
      </div>

      {error && (
        <div id="login-otp-error" role="alert"
          className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}
      {info && !error && (
        <div role="status" className="text-sm text-green-700 bg-green-50 border border-green-200 px-4 py-3 rounded-xl">
          {info}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || code.length !== 6}
        className="w-full min-h-11 py-3 rounded-xl text-base font-semibold text-white disabled:opacity-50 transition-opacity"
        style={{ backgroundColor: 'var(--accent, #2563eb)' }}
      >
        {busy ? 'Verifying…' : 'Verify and sign in'}
      </button>

      <div className="flex items-center justify-between text-sm">
        <button type="button" onClick={onBack} className="font-medium underline-offset-2 hover:underline"
          style={{ color: 'rgba(148,163,184,0.95)' }}>
          Back
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={wait > 0 || resending}
          className="font-semibold disabled:opacity-50"
          style={{ color: 'var(--accent, #2563eb)' }}
        >
          {resending ? 'Sending…' : wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </button>
      </div>
    </form>
  );
}
