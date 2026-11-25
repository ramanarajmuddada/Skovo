import React, { useEffect, useState, useRef } from 'react';
import { api } from '../services/api';
import {
  careerInterestRows, pruneSelections, isStudentPathComplete, studentPathMissing, PATH_FIELD_LABELS,
} from '../config/educationPathways';
import { useAuth } from '../context/AuthContext';
import { Card, PageHeader, Badge, Button, Input, Toast, FormSelect, Modal, StudentPage } from '../components/ui/index.jsx';
import EducationGoals from '../components/profile/EducationGoals';
import { CareerTimeline, DataRights } from '../components/v1/ProfileV1Sections';
import DatePicker from '../components/ui/DatePicker';
import { ageFrom, isoToLong, todayIso, yearsAgoIso } from '../components/ui/dateUtils';
import {
  TrendingUp, Edit3, Check, X, Zap,
  GraduationCap, Briefcase, Mail, Phone, Camera, Loader2, Lock, Upload,
} from 'lucide-react';
import { validateImageFile, ACCEPT_IMAGE } from '../components/ui/fileRules';
import AvatarImg from '../components/ui/AvatarImg';
import { fieldErrors, profilePersonal } from '../schemas/student';

const MIN_DOB = yearsAgoIso(100);
const DOB_DEFAULT_VIEW = yearsAgoIso(18);

// Colour only. A level the admin added today has no entry here, so it takes
// the violet default rather than being mistaken for another level.
const LEVEL_COLOR = { Explorer: 'amber', Pioneer: 'blue', Achiever: 'emerald' };
const DEFAULT_LEVEL_COLOR = 'violet';

export default function Profile() {
  const { user, updateUser } = useAuth();
  const [profile,   setProfile]   = useState(null);
  const [readiness, setReadiness] = useState(null);
  const [reservation, setReservation] = useState('');
  const [skillsDetail, setSkillsDetail] = useState([]);
  const [newSkill,  setNewSkill]  = useState('');
  const [skillBusy, setSkillBusy] = useState(false);
  const [loading,   setLoading]   = useState(true);
  const [editing,   setEditing]   = useState(false);
  const [saving,    setSaving]    = useState(false);
  const [formData,  setFormData]  = useState({});
  const [error,     setError]     = useState('');
  const [fieldErrs, setFieldErrs] = useState({});
  const [toast,     setToast]     = useState('');
  const [masters,   setMasters]   = useState({});
  const [gender,    setGender]    = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [uploading, setUploading] = useState(false);
  // Chosen file waits here until confirmed — same pick → preview → upload
  // sequence as the achiever profile, so a mis-click cannot replace the photo.
  const [pending,   setPending]   = useState(null);   // { file, preview }
  const [progress,  setProgress]  = useState(0);
  // Date of birth lives on users (DPDP age band), not in the profile payload,
  // so it is saved through the consent endpoint and kept out of formData.
  const [dob,      setDob]      = useState('');
  const [dobDraft, setDobDraft] = useState('');
  // State and city come from their own tables now, so the pair can never fall
  // out of step and every state in India is reachable.
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const fileRef = useRef(null);

  const applyPayload = (data, { keepForm = false } = {}) => {
    const p = data.response.profile || {};
    setProfile(p);
    setReadiness(data.response.readiness);
    setSkillsDetail(data.response.skills_detail || []);
    setAvatarUrl(data.response.avatar_url || '');
    setDob(data.response.date_of_birth || '');
    // A background refresh (education section saved, path status) must not throw
    // away a date the student has picked but not saved yet.
    if (!keepForm) setDobDraft(data.response.date_of_birth || '');
    setGender(data.response.gender || '');
    setReservation(data.response.reservation_category || '');
    if (!keepForm) {
      setFormData({
        full_name:        data.response.full_name || '',
        phone:            p.phone || '',
        gender:           data.response.gender || '',
        city:             p.city || '',
        state:            p.state || '',
        career_interests: p.career_interests || [],
      });
    }
    const complete = isStudentPathComplete(p, {
      reservation_category: data.response.reservation_category,
    });
    updateUser({
      education_level: p.education_level || p.education_category || null,
      education_category: p.education_category || null,
      path_complete: complete,
    });
    return complete;
  };

  useEffect(() => {
    api.get('/auth/masters?types=career_interest,gender')
      .then(({ data }) => { if (data.bool) setMasters(data.response.grouped || {}); })
      .catch(() => {});
    api.get('/auth/states')
      .then(({ data }) => { if (data.bool) setStates(data.response.states || []); })
      .catch(() => {});
  }, []);

  // Cities follow the chosen state.
  useEffect(() => {
    const st = states.find(s => s.name === formData.state);
    if (!st) return;
    api.get(`/auth/cities?state_id=${st.id}`)
      .then(({ data }) => { if (data.bool) setCities(data.response.cities || []); })
      .catch(() => {});
  }, [formData.state, states]);

  useEffect(() => {
    api.get('/profile/').then(({ data }) => {
      if (data.bool) applyPayload(data);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true); setError('');
    const parsed = profilePersonal.safeParse({
      full_name: formData.full_name || '',
      phone: formData.phone || '',
    });
    if (!parsed.success) {
      setFieldErrs(fieldErrors(parsed));
      setSaving(false);
      return;
    }
    setFieldErrs({});
    try {
      // A date of birth that was never captured can be set here once; it then
      // becomes read-only. The original reason -- it fixed the DPDP age band --
      // no longer applies, since there is no age band and no age rule. It stays
      // write-once because it is still a fact about the person rather than a
      // preference, not because anything downstream depends on it now.
      if (dobDraft && dobDraft !== dob) {
        const { data: c } = await api.post('/auth/consent/dob', { date_of_birth: dobDraft });
        if (!c.bool) {
          setError(c.response?.message || 'Please check your date of birth.');
          setSaving(false);
          return;
        }
        setDob(dobDraft);
      }

      const { data } = await api.patch('/profile/', { ...formData, career_interests: pickedInterests });
      if (data.bool) {
        setProfile(p => ({ ...p, ...formData, career_interests: pickedInterests }));
        setGender(formData.gender || '');
        updateUser({ full_name: formData.full_name });
        setEditing(false);
        setToast('Profile updated successfully!');
        setTimeout(() => setToast(''), 3000);
        api.get('/profile/').then(({ data: d }) => { if (d.bool) applyPayload(d); });
      } else setError(data.response?.message || 'Failed to save.');
    } catch { setError('Failed to save profile.'); }
    finally { setSaving(false); }
  };

  // The same stage scoping onboarding applies, so editing cannot reintroduce an
  // interest the student's level does not offer — and one left over from an
  // earlier level drops out of the payload rather than being saved back.
  const interestRows      = careerInterestRows(profile?.education_category, masters['career_interest']);
  const pickedInterests   = pruneSelections(formData.career_interests, interestRows);

  const toggleInterest = (i) => setFormData(p => ({
    ...p,
    career_interests: p.career_interests.includes(i)
      ? p.career_interests.filter(x => x !== i)
      : [...p.career_interests, i],
  }));

  const startEdit = () => { setFieldErrs({}); setDobDraft(dob); setEditing(true); window.scrollTo({ top: 0, behavior: 'smooth' }); };

  const field = (key, val) => setFormData(p => ({ ...p, [key]: val }));

  const pickAvatar = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const problem = validateImageFile(file);
    if (problem) { setError(problem); return; }
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setError('');
    setPending({ file, preview: URL.createObjectURL(file) });
  };

  const cancelAvatar = () => {
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending(null);
    setProgress(0);
  };

  const confirmAvatar = async () => {
    const file = pending?.file;
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('kind', 'image');
      const { data } = await api.upload('/upload/', fd, { onProgress: setProgress });

      if (!data?.bool) {
        setError(data?.response?.message || "That photo couldn't be uploaded.");
        return;
      }
      const url = data.response?.url;
      if (!url) {
        setError('The photo was uploaded but the server did not say where to.');
        return;
      }

      const { data: saved } = await api.patch('/profile/', { avatar_url: url });
      if (!saved?.bool) {
        setError(saved?.response?.message
          || 'The photo uploaded but could not be saved to your profile. Try again.');
        return;
      }

      const stored = saved.response?.avatar_url || url;
      setAvatarUrl(stored);
      updateUser({ avatar_url: stored });
      cancelAvatar();
      setToast('Profile photo updated!');
      setTimeout(() => setToast(''), 3000);
    } catch (err) {
      setError(err?.message || 'Upload failed. Check your connection and try again.');
    } finally {
      setUploading(false);
    }
  };

  if (loading) return (
    <StudentPage className="space-y-4 animate-pulse">
      <div className="h-8 bg-slate-100 rounded w-1/3" />
      <div className="h-36 bg-slate-100 rounded-2xl" />
      <div className="h-28 bg-slate-100 rounded-2xl" />
      <div className="h-48 bg-slate-100 rounded-2xl" />
    </StudentPage>
  );

  const fullName = formData.full_name || user?.full_name || '';
  const initial  = fullName.charAt(0)?.toUpperCase() || 'U';
  const missing  = studentPathMissing(profile, { reservation_category: reservation }, { includeReservation: false });

  return (
    <StudentPage>
      <Toast message={toast} type="success" />

      <PageHeader
        title="My Profile"
        subtitle="View and update your personal information"
        action={
          editing ? (
            <div className="flex flex-col sm:flex-row gap-2 w-full">
              <Button variant="secondary" size="md" onClick={() => {
                setEditing(false);
                setError('');
                setFieldErrs({});
                api.get('/profile/').then(({ data }) => { if (data.bool) applyPayload(data); }).catch(() => {});
              }}>
                <X size={15} /> Cancel
              </Button>
              <Button variant="primary" size="md" disabled={saving} onClick={handleSave}>
                <Check size={15} /> {saving ? 'Saving…' : 'Save Changes'}
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="md" onClick={startEdit}>
              <Edit3 size={15} /> Edit Profile
            </Button>
          )
        }
      />

      {!editing && missing.length > 0 && (
        <div className="mb-4 text-sm bg-indigo-50 border border-indigo-100 text-indigo-900 px-4 py-3 rounded-xl">
          <p className="font-semibold">Add these so For You lists match you</p>
          <p className="text-indigo-800/80 mt-1">
            Still open: {missing.map(k => PATH_FIELD_LABELS[k] || k).join(', ')}.
            You can fill them here, or when a screen asks.
          </p>
        </div>
      )}

      {error && (
        <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
          {error}
        </div>
      )}

      {/* ── Avatar + Name Card ── */}
      <Card className="p-6 mb-4">
        <div className="flex items-center gap-5">
          <div className="relative shrink-0">
            {avatarUrl ? (
              <AvatarImg src={avatarUrl} alt="" className="w-16 h-16 rounded-2xl object-cover shadow-lg" />
            ) : (
              <div
                className="w-16 h-16 rounded-2xl text-white flex items-center justify-center text-2xl font-bold shadow-lg"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {initial}
              </div>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              aria-label={uploading ? 'Uploading photo' : 'Change profile photo'}
              className="absolute -bottom-1.5 -right-1.5 w-7 h-7 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center shadow-sm hover:border-slate-400 transition-colors disabled:opacity-50 before:absolute before:-inset-2 before:content-['']"
              title="Upload photo">
              {uploading ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <Camera size={12} className="text-slate-500" />}
            </button>
            <input ref={fileRef} type="file" accept={ACCEPT_IMAGE} className="hidden" onChange={pickAvatar} />
          </div>
          <div className="flex-1 min-w-0">
            {editing ? (
              <Input
                label="Full name"
                required
                value={formData.full_name}
                onChange={e => { field('full_name', e.target.value); if (fieldErrs.full_name) setFieldErrs(p => ({ ...p, full_name: undefined })); }}
                placeholder="Enter your full name"
                error={fieldErrs.full_name}
              />
            ) : (
              <h2 className="text-lg font-bold text-slate-900">{fullName}</h2>
            )}
            <div className="flex flex-wrap items-center gap-3 mt-1.5">
              {(user?.email) && (
                <span className="flex items-center gap-1 text-sm text-slate-500">
                  <Mail size={13} /> {user.email}
                </span>
              )}
              {(user?.phone || profile?.phone) && (
                <span className="flex items-center gap-1 text-sm text-slate-500">
                  <Phone size={13} /> {user?.phone || profile?.phone}
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400 mt-2">Click the camera icon to upload a new photo (JPG, PNG, GIF or WEBP, max 10 MB)</p>
          </div>
        </div>
      </Card>

      <Modal
        isOpen={Boolean(pending)}
        onClose={uploading ? undefined : cancelAvatar}
        title="Use this as your profile photo?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelAvatar} disabled={uploading}
              className="px-4 py-2 min-h-11 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={confirmAvatar} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 min-h-11 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent)' }}>
              {uploading
                ? <><Loader2 size={14} className="animate-spin" /> {progress ? `Uploading ${progress}%` : 'Uploading…'}</>
                : <><Upload size={14} /> Upload photo</>}
            </button>
          </div>
        }
      >
        {pending && (
          <div className="flex items-center gap-4">
            <img src={pending.preview} alt=""
              className="w-20 h-20 rounded-2xl object-cover border-2 border-slate-200 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate">{pending.file.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {(pending.file.size / 1024 / 1024).toFixed(2)} MB
              </p>
              <p className="text-xs text-slate-500 mt-2">
                This replaces your current photo straight away.
              </p>
            </div>
          </div>
        )}
      </Modal>

      {/* ── Readiness Score ── */}
      {readiness && (
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp size={16} style={{ color: 'var(--accent)' }} />
            <h3 className="font-bold text-slate-900">Readiness Score</h3>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-4xl font-black text-slate-900">{readiness.score}</div>
            <div>
              <Badge color={LEVEL_COLOR[readiness.level] || DEFAULT_LEVEL_COLOR}>{readiness.level}</Badge>
              <p className="text-xs text-slate-500 mt-2">
                {readiness.cohorts_completed} cohorts · {readiness.tasks_completed} tasks completed
              </p>
              {!readiness.opportunity_hub_unlocked && (
                <p className="text-xs text-slate-400 mt-0.5">
                  {readiness.points_to_hub} pts to unlock Opportunity Hub
                </p>
              )}
            </div>
          </div>
          <div className="mt-4 h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{ width: `${readiness.score}%`, backgroundColor: 'var(--accent)' }}
            />
          </div>
        </Card>
      )}

      {/* ── Personal Information ── */}
      <Card className="p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <GraduationCap size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-bold text-slate-900">Personal Information</h3>
          {!editing && (
            <button type="button" onClick={startEdit}
              className="ml-auto inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Edit3 size={13} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="grid sm:grid-cols-2 gap-4">
            {/* State drives the board, stream and city options everywhere else,
                so it comes from the states table rather than free text. */}
            <FormSelect
              label="State"
              value={formData.state}
              onChange={v => { field('state', v); field('city', ''); }}
              options={states.map(s => ({ value: s.name, label: s.name }))}
              placeholder="Enter state"
            />
            <FormSelect
              label="City"
              value={formData.city}
              onChange={v => field('city', v)}
              disabled={!formData.state}
              options={cities.map(c => ({ value: c.name, label: c.name }))}
              placeholder={formData.state ? 'Enter city' : 'Pick a state first'}
            />
            <Input
              label="Phone Number"
              value={formData.phone}
              onChange={e => {
                field('phone', e.target.value.replace(/[^0-9+\s-]/g, '').slice(0, 15));
                if (fieldErrs.phone) setFieldErrs(p => ({ ...p, phone: undefined }));
              }}
              placeholder="Enter 10-digit mobile number"
              inputMode="tel"
              error={fieldErrs.phone}
            />

            <FormSelect label="Gender" value={formData.gender || ''} onChange={v => field('gender', v)}
                        placeholder="Select gender"
                        options={(masters.gender || []).filter(g => g.value !== 'all').map(g => ({ value: g.value, label: g.label }))} />

            {/* Date of birth: editable, so a wrong date can be corrected. */}
            <div>
              <label htmlFor="profile-dob" className="block text-sm font-semibold text-slate-700 mb-1.5">Date of Birth</label>
              <DatePicker id="profile-dob" value={dobDraft} onChange={setDobDraft}
                          min={MIN_DOB} max={todayIso()} defaultView={DOB_DEFAULT_VIEW} />
              {dobDraft && <p className="text-xs text-slate-400 mt-1.5">{ageFrom(dobDraft)} yrs</p>}
            </div>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-0">
            {/* Study details live in the Education card below, which owns them. */}
            {[
              { label: 'City',          value: profile?.city },
              { label: 'State',         value: profile?.state },
              { label: 'Phone',         value: profile?.phone },
              { label: 'Date of Birth', value: dob ? `${isoToLong(dob)} · ${ageFrom(dob)} yrs` : null },
              { label: 'Gender',        value: (masters.gender || []).find(g => g.value === gender)?.label || null },
            ].filter(f => f.value).map(({ label, value }) => (
              <div key={label} className="py-3 border-b border-slate-100 pr-4">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-900">{value}</p>
              </div>
            ))}
            {![profile?.city, profile?.state, profile?.phone].some(Boolean) && (
              <p className="text-sm text-slate-400 italic py-2 col-span-2">No details added — click Edit Profile.</p>
            )}
          </div>
        )}
      </Card>

      {/* ── Education + Goals — the two halves onboarding collects ── */}
      <EducationGoals
        profile={profile}
        forceEdit={editing}
        liveState={formData.state || profile?.state || ''}
        liveCity={formData.city || profile?.city || ''}
        onSaved={() => api.get('/profile/')
          .then(({ data }) => { if (data.bool) applyPayload(data, { keepForm: true }); })
          .catch(() => {})}
        onPathStatus={() => api.get('/profile/')
          .then(({ data }) => { if (data.bool) applyPayload(data, { keepForm: true }); })
          .catch(() => {})}
        onToast={(msg, ok) => {
          if (ok === false) { setError(msg); return; }
          setError('');
          setToast(msg);
          setTimeout(() => setToast(''), 3000);
        }}
      />

      {/* ── My Skills (assessment + manually added) ── */}
      <Card className="p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Zap size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-bold text-slate-900">My Skills</h3>
          <span className="ml-auto text-xs text-slate-400">{skillsDetail.length} skill{skillsDetail.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex flex-wrap gap-2 mb-3">
          {skillsDetail.map(s => (
            <span key={s.id} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-blue-50 text-blue-700">
              {s.skill_name}
              <button
                onClick={async () => {
                  try {
                    const { data } = await api.delete(`/profile/skills/${s.id}`);
                    if (data.bool) setSkillsDetail(p => p.filter(x => x.id !== s.id));
                  } catch { /* keep chip on failure */ }
                }}
                className="text-blue-400 hover:text-red-500 transition-colors"
                title="Remove skill"
              >
                <X size={12} />
              </button>
            </span>
          ))}
          {skillsDetail.length === 0 && (
            <p className="text-sm text-slate-400 italic">No skills yet — add one below or complete the assessment.</p>
          )}
        </div>
        <div className="flex gap-2">
          <Input
            value={newSkill}
            onChange={e => setNewSkill(e.target.value)}
            onKeyDown={async e => { if (e.key === 'Enter' && newSkill.trim()) document.getElementById('add-skill-btn')?.click(); }}
            placeholder="Enter a skill"
          />
          <Button
            id="add-skill-btn"
            variant="secondary"
            size="md"
            disabled={skillBusy || !newSkill.trim()}
            onClick={async () => {
              setSkillBusy(true);
              try {
                const { data } = await api.post('/profile/skills', { skill_name: newSkill.trim() });
                if (data.bool) {
                  setSkillsDetail(p => [...p, { id: data.response.id, skill_name: data.response.skill_name }]);
                  setNewSkill('');
                } else {
                  setError(data.response?.message || 'Could not add skill.');
                }
              } catch { setError('Could not add skill.'); }
              finally { setSkillBusy(false); }
            }}
          >
            Add
          </Button>
        </div>
      </Card>

      {/* ── Career Interests ── */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Briefcase size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-bold text-slate-900">Career Interests</h3>
          {!editing && (
            <button type="button" onClick={startEdit}
              className="ml-auto inline-flex items-center gap-1.5 min-h-9 px-3 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              <Edit3 size={13} /> Edit
            </button>
          )}
        </div>
        {editing ? (
          <div className="flex flex-wrap gap-2">
            {interestRows.map(({ value: i }) => {
              const sel = pickedInterests.includes(i);
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => toggleInterest(i)}
                  className={`px-3.5 py-1.5 min-h-11 rounded-xl text-sm font-medium border transition-all ${
                    sel ? 'text-white' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'
                  }`}
                  style={sel
                    ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' }
                    : undefined
                  }
                >
                  {i}
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {(profile?.career_interests || []).length === 0
              ? <p className="text-sm text-slate-400 italic">No interests selected — click Edit Profile to add.</p>
              : profile.career_interests.map(i => <Badge key={i} color="blue">{i}</Badge>)
            }
          </div>
        )}
      </Card>

      {/* Save button at bottom (mobile-friendly) */}
      {editing && (
        <div className="mt-4 flex gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => {
            setEditing(false);
            setError('');
            setFieldErrs({});
            api.get('/profile/').then(({ data }) => { if (data.bool) applyPayload(data); }).catch(() => {});
          }}>
            <X size={15} /> Cancel
          </Button>
          <Button variant="primary" size="lg" className="flex-1" disabled={saving} onClick={handleSave}>
            <Check size={15} /> {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      )}
      <CareerTimeline />
      <DataRights />
    </StudentPage>
  );
}
