import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import DatePicker from '../components/ui/DatePicker';
import { ageFrom, todayIso, yearsAgoIso } from '../components/ui/dateUtils';
import { ShieldCheck, Cake, Mail, Lock, Clock } from 'lucide-react';

/**
 * DPDP consent gate (§11.1). Collects DOB, then routes:
 *   under 14 → blocked · 14–17 → parental email · 18+ → straight in.
 *
 * The in-app gate now lives in OnboardingModal so a signed-in student is never
 * bounced out of the shell for one field. This page stays for direct hits on
 * /consent (old links, emails) and runs the identical flow.
 */
const MIN_DOB = yearsAgoIso(100);
const DOB_DEFAULT_VIEW = yearsAgoIso(18);

/** Module scope: nested in the component it would remount on every keystroke. */
function Shell({ icon: Icon, tone, title, children }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-md bg-white rounded-3xl shadow-xl p-8">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${tone}`}>
          <Icon size={26} />
        </div>
        <h1 className="text-xl font-bold text-slate-900 text-center mt-5">{title}</h1>
        {children}
      </div>
    </div>
  );
}

export default function ConsentGate() {
  const navigate = useNavigate();
  const [stage, setStage] = useState('loading');   // loading | dob | parent | blocked | waiting
  const [dob, setDob] = useState('');
  const [parentEmail, setParentEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/auth/consent/status')
      .then(({ data }) => {
        if (!data.bool) { setStage('dob'); return; }
        const cs = data.response.consent_status;
        if (cs === 'granted') navigate('/career-path', { replace: true });
        else if (cs === 'blocked') setStage('blocked');
        else if (cs === 'awaiting_parent' && data.response.parent_email) setStage('waiting');
        else if (cs === 'awaiting_parent') setStage('parent');
        else setStage('dob');
      })
      .catch(() => setStage('dob'));
  }, [navigate]);

  const submitDob = async () => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/consent/dob', { date_of_birth: dob });
      // No age gate, no parental consent: every valid date of birth goes
      // straight through. The 'parent' and 'blocked' stages below are no longer
      // reachable -- the server cannot return either status any more.
      if (data.bool) navigate('/career-path', { replace: true });
      else setError(data.response?.message || 'Please check your date of birth.');
    } catch { setError('Something went wrong. Please try again.'); } finally { setBusy(false); }
  };

  const submitParent = async () => {
    setError(''); setBusy(true);
    try {
      const { data } = await api.post('/auth/consent/parent', {
        parent_email: parentEmail.trim(), parent_name: parentName.trim(),
      });
      if (data.bool) setStage('waiting');
      else setError(data.response?.message || 'Please enter a valid parent email.');
    } catch { setError('Something went wrong. Please try again.'); } finally { setBusy(false); }
  };

  if (stage === 'loading') {
    return <div className="min-h-screen flex items-center justify-center bg-slate-50"><div className="w-10 h-10 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" /></div>;
  }

  if (stage === 'blocked') {
    return (
      <Shell icon={Lock} tone="bg-red-50 text-red-600" title="You need to be 14 or older">
        <p className="text-sm text-slate-500 text-center mt-2 leading-relaxed">
          Skovo is built for students aged 14 and above. Please come back when you are old enough — we will be here.
        </p>
      </Shell>
    );
  }

  if (stage === 'waiting') {
    return (
      <Shell icon={Clock} tone="bg-amber-50 text-amber-600" title="Waiting for a parent">
        <p className="text-sm text-slate-500 text-center mt-2 leading-relaxed">
          We have emailed your parent or guardian to confirm your account. As soon as they click the link,
          your Skovo account unlocks. You can close this page and check back later.
        </p>
        <button onClick={() => setStage('parent')}
                className="mt-5 w-full py-2.5 text-sm font-semibold text-blue-600 hover:text-blue-700">
          Sent to the wrong email? Resend →
        </button>
      </Shell>
    );
  }

  if (stage === 'parent') {
    return (
      <Shell icon={Mail} tone="bg-blue-50 text-blue-600" title="A parent needs to confirm">
        <p className="text-sm text-slate-500 text-center mt-2 leading-relaxed">
          Because you are under 18, we need a parent or guardian's consent (required by law) before your
          account activates. We will email them a confirmation link.
        </p>
        <div className="mt-6 space-y-3">
          <input type="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)}
                 placeholder="Parent / guardian email"
                 className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input value={parentName} onChange={(e) => setParentName(e.target.value)}
                 placeholder="Parent / guardian name (optional)"
                 className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
        <button onClick={submitParent} disabled={busy || !parentEmail.trim()}
                className="mt-5 w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-sm font-semibold transition-colors">
          {busy ? 'Sending…' : 'Send consent request'}
        </button>
      </Shell>
    );
  }

  // stage === 'dob'
  return (
    <Shell icon={Cake} tone="bg-blue-50 text-blue-600" title="One quick thing">
      <p className="text-sm text-slate-500 text-center mt-2 leading-relaxed">
        Tell us your date of birth so we can set up your account correctly. We ask this to comply with
        India's data-protection rules for students.
      </p>
      <div className="mt-6">
        <label htmlFor="dob-input" className="block text-xs font-semibold text-slate-500 mb-1.5">Date of birth</label>
        <DatePicker id="dob-input" value={dob} onChange={setDob}
                    min={MIN_DOB} max={todayIso()} defaultView={DOB_DEFAULT_VIEW} />
        {ageFrom(dob) !== null && (
          <p className="text-xs text-slate-400 mt-2">
            You are {ageFrom(dob)} years old.
            {ageFrom(dob) >= 14 && ageFrom(dob) < 18 && ' A parent will need to confirm your account.'}
          </p>
        )}
      </div>
      {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      <button onClick={submitDob} disabled={busy || !dob}
              className="mt-5 w-full py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white rounded-xl text-sm font-semibold transition-colors">
        {busy ? 'Saving…' : 'Continue'}
      </button>
      <p className="text-[11px] text-slate-400 text-center mt-4 flex items-center justify-center gap-1">
      </p>
    </Shell>
  );
}
