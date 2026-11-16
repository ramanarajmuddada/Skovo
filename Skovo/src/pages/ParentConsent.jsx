import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../services/api';
import { ShieldCheck, CheckCircle2, XCircle } from 'lucide-react';

/** Public landing page a parent reaches from the emailed consent link.
 *  Calls the confirm API and shows a friendly result — no login required. */
export default function ParentConsent() {
  const [params] = useSearchParams();
  const [state, setState] = useState('loading');   // loading | ok | error
  const [message, setMessage] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) { setState('error'); setMessage('This link is missing its confirmation code.'); return; }
    api.get(`/auth/consent/parent/confirm?token=${encodeURIComponent(token)}`)
      .then(({ data }) => {
        if (data.bool) { setState('ok'); setMessage(data.response.message); }
        else { setState('error'); setMessage(data.response?.message || 'This link could not be confirmed.'); }
      })
      .catch(() => { setState('error'); setMessage('Something went wrong confirming this link.'); });
  }, [params]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8 text-center">
        {state === 'loading' && (
          <div className="w-10 h-10 rounded-full border-2 border-blue-600 border-t-transparent animate-spin mx-auto" />
        )}
        {state === 'ok' && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto">
              <CheckCircle2 size={26} />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-5">All set</h1>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">{message}</p>
          </>
        )}
        {state === 'error' && (
          <>
            <div className="w-14 h-14 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
              <XCircle size={26} />
            </div>
            <h1 className="text-xl font-bold text-slate-900 mt-5">We couldn't confirm this</h1>
            <p className="text-sm text-slate-500 mt-2 leading-relaxed">{message}</p>
          </>
        )}
        <p className="text-[11px] text-slate-400 mt-6 flex items-center justify-center gap-1">
          <ShieldCheck size={12} /> Skovo
        </p>
      </div>
    </div>
  );
}
