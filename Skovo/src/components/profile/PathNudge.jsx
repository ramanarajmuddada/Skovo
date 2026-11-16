import React, { useEffect, useState } from 'react';
import { api } from '../../services/api';
import { FormSelect, Toast } from '../ui/index.jsx';
import { Sparkles, MapPin, GraduationCap, X, Check, ArrowLeft } from 'lucide-react';
import {
  studentIdentityMissing, studentPathMissing, PATH_FIELD_LABELS,
} from '../../config/educationPathways';
import { useAuth } from '../../context/AuthContext';
import EducationGoals from './EducationGoals';

/**
 * Just-in-time path collection. Dashboard, Cohorts, Colleges and Opportunities
 * stay open; this strip asks only for the slice that screen needs, using the
 * same education / goals form as Profile.
 *
 * `need`:
 *   identity     — stage, state, city, study-now
 *   reservation  — reservation category
 *   both         — identity + reservation
 */
export default function PathNudge({
  need = 'identity',
  title,
  blurb,
  onFilled,
}) {
  const { updateUser } = useAuth();
  const [profile, setProfile] = useState(null);
  const [reservation, setReservation] = useState('');
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [loc, setLoc] = useState({ state: '', city: '' });
  const [locSaving, setLocSaving] = useState(false);
  // Two steps when both are missing: where they are, then what they study.
  const [step, setStep] = useState(null);   // 'location' | 'education' | null = first missing

  const load = () => api.get('/profile/').then(({ data }) => {
    if (!data.bool) return null;
    const p = data.response.profile || {};
    const res = data.response.reservation_category || '';
    setProfile(p);
    setReservation(res);
    setLoc({ state: p.state || '', city: p.city || '' });
    const complete = studentPathMissing(p, { reservation_category: res }).length === 0;
    updateUser({
      education_level: p.education_level || p.education_category || null,
      education_category: p.education_category || null,
      path_complete: complete,
    });
    return { p, res };
  }).catch(() => null);

  useEffect(() => { load(); }, []);

  useEffect(() => {
    api.get('/auth/states')
      .then(({ data }) => { if (data.bool) setStates(data.response.states || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const st = states.find(s => s.name === loc.state);
    if (!st) { setCities([]); return; }
    api.get(`/auth/cities?state_id=${st.id}`)
      .then(({ data }) => { if (data.bool) setCities(data.response.cities || []); })
      .catch(() => {});
  }, [loc.state, states]);

  if (!profile) return null;

  const identity = studentIdentityMissing(profile);
  const reservationMissing = !reservation;
  const wantIdentity = need === 'identity' || need === 'both';
  const wantReservation = need === 'reservation' || need === 'both';
  const missing = [
    ...(wantIdentity ? identity : []),
    ...(wantReservation && reservationMissing ? ['reservation'] : []),
  ];
  if (!missing.length) return null;

  const showLocation = wantIdentity && identity.some(k => k === 'state' || k === 'city');
  const showEdu = wantIdentity && identity.some(k => k !== 'state' && k !== 'city');
  const showGoals = wantReservation && reservationMissing;
  const sections = showEdu && showGoals ? 'all' : showEdu ? 'education' : 'goals';

  const saveLocation = async (next) => {
    if (!next.state || !next.city) return;
    setLocSaving(true);
    setError('');
    try {
      const { data } = await api.patch('/profile/', { state: next.state, city: next.city });
      if (!data.bool) {
        setError(data.response?.message || 'Could not save location.');
        return;
      }
      const loaded = await load();
      if (loaded) onFilled?.();
      setStep('education');
    } catch {
      setError('Could not save location.');
    } finally {
      setLocSaving(false);
    }
  };

  const afterPathSave = async () => {
    const loaded = await load();
    onFilled?.();
    if (!loaded) return;
    const still = [
      ...(wantIdentity ? studentIdentityMissing(loaded.p) : []),
      ...(wantReservation && !loaded.res ? ['reservation'] : []),
    ];
    if (!still.length) setOpen(false);
  };

  const twoSteps = showLocation && (showEdu || showGoals);
  const current = step || (showLocation ? 'location' : 'education');
  const stepIdx = current === 'location' ? 0 : 1;

  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
        background: 'color-mix(in srgb, var(--accent) 8%, var(--bg))',
      }}
    >
      <Toast message={toast} type="success" />
      <div className="flex items-start gap-3">
        <span
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'color-mix(in srgb, var(--accent) 16%, var(--bg))' }}
        >
          <Sparkles size={17} style={{ color: 'var(--accent)' }} />
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</p>
          {blurb && <p className="text-sm text-slate-600 dark:text-slate-300 mt-0.5 leading-relaxed">{blurb}</p>}
          {/* What is missing, as chips rather than a comma list. */}
          <div className="flex flex-wrap gap-1.5 mt-2" aria-label="Still needed">
            {missing.map(k => (
              <span key={k} className="px-2 py-0.5 rounded-md text-[11px] font-semibold bg-white/60 dark:bg-white/10 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-white/10">
                {PATH_FIELD_LABELS[k] || k}
              </span>
            ))}
          </div>
        </div>
        {open && (
          <button type="button" onClick={() => setOpen(false)} aria-label="Close"
                  className="shrink-0 w-9 h-9 rounded-lg flex items-center justify-center text-slate-500 hover:bg-white/50">
            <X size={16} />
          </button>
        )}
      </div>
      {!open && (
        <button type="button" onClick={() => setOpen(true)}
          className="mt-3 inline-flex items-center justify-center gap-1.5 min-h-11 px-4 rounded-xl text-sm font-bold text-white w-full sm:w-auto"
          style={{ backgroundColor: 'var(--accent)' }}>
          Add my details · {missing.length} left
        </button>
      )}

      {open && (
        <div className="mt-4 space-y-3">
          {twoSteps && (
            <ol className="grid grid-cols-2 gap-2" aria-label="Steps">
              {[['Location', MapPin], ['Education', GraduationCap]].map(([label, Icon], i) => {
                // Ticked only when the fields are really filled, not because
                // the student jumped ahead.
                const done = i === 0 && !identity.some(k => k === 'state' || k === 'city');
                const on = i === stepIdx;
                return (
                  <li key={label}>
                    <button type="button" onClick={() => setStep(i === 0 ? 'location' : 'education')}
                      className={`w-full min-w-0 flex items-center gap-2 px-2.5 sm:px-3 min-h-11 rounded-xl border text-sm font-semibold ${on ? 'bg-white text-slate-900 border-slate-200' : 'border-transparent text-slate-500'}`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${done || on ? 'text-white' : 'bg-slate-200 text-slate-500'}`}
                            style={done || on ? { backgroundColor: 'var(--accent)' } : undefined}>
                        {done ? <Check size={12} strokeWidth={3} /> : i + 1}
                      </span>
                      <Icon size={14} className="hidden sm:block shrink-0" /> <span className="truncate">{label}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{error}</p>
          )}
          {showLocation && current === 'location' && (
            <div className="rounded-2xl border border-slate-200 bg-white p-4">
              <p className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                <MapPin size={14} style={{ color: 'var(--accent)' }} /> Where are you?
              </p>
              <p className="text-xs text-slate-500 mt-0.5 mb-3">Picking your city saves it and takes you to the next step.</p>
              <div className="grid sm:grid-cols-2 gap-3">
                <FormSelect
                  label="State"
                  required
                  value={loc.state}
                  onChange={v => {
                    const next = { state: v, city: '' };
                    setLoc(next);
                  }}
                  options={states.map(s => ({ value: s.name, label: s.name }))}
                  placeholder="Pick your state"
                />
                <FormSelect
                  label="City"
                  required
                  value={loc.city}
                  onChange={v => {
                    const next = { ...loc, city: v };
                    setLoc(next);
                    saveLocation(next);
                  }}
                  disabled={!loc.state || locSaving}
                  options={cities.map(c => ({ value: c.name, label: c.name }))}
                  placeholder={locSaving ? 'Saving…' : loc.state ? 'Pick your city' : 'Pick a state first'}
                />
              </div>
            </div>
          )}
          {(showEdu || showGoals) && (current === 'education' || !showLocation) && (
            <>
              {twoSteps && (
                <button type="button" onClick={() => setStep('location')}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
                  <ArrowLeft size={13} /> Back to location
                </button>
              )}
              <EducationGoals
                profile={profile}
                setupMode
                sections={sections}
                liveState={loc.state || profile.state || ''}
                liveCity={loc.city || profile.city || ''}
                onSaved={afterPathSave}
                onToast={(msg, ok) => {
                  if (ok === false) { setError(msg); return; }
                  setError('');
                  setToast(msg);
                  setTimeout(() => setToast(''), 3000);
                }}
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
