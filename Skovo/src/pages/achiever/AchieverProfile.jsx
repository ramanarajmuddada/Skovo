import { studentSiteUrl } from '../../utils/portalHost';
import React, { useEffect, useState, useRef } from 'react';
import { Save, Loader2, Camera, Upload, X, Trash2, ExternalLink, Link2, CheckCircle2, Circle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { achieverApi, publishAchieverUser } from '../../services/api';
import { Button, ErrorState, useToast, Modal, FormSelect } from '../../components/ui/index.jsx';
import DatePicker from '../../components/ui/DatePicker';
import { yearsAgoIso } from '../../components/ui/dateUtils';
import { validateImageFile, ACCEPT_IMAGE } from '../../components/ui/fileRules';
import AvatarImg from '../../components/ui/AvatarImg';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

export default function AchieverProfile() {
  const [form,        setForm]        = useState({});
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  // Field-level messages, keyed by field. A toast alone does not tell the
  // achiever which box to fix on a form this long.
  const [errors,      setErrors]      = useState({});
  // The chosen file waits here until it is confirmed. Uploading straight
  // from the file input's onChange meant one mis-click replaced the photo
  // students see, with no chance to look at what was picked.
  const [pending,     setPending]     = useState(null);   // { file, preview }
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [failed,      setFailed]      = useState(false);
  const [uploading,   setUploading]   = useState(false);
  // A spinner with no number is indistinguishable from a hang on mobile data,
  // and xhrUpload already reports real progress — so show it.
  const [progress,    setProgress]    = useState(0);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [saved,       setSaved]       = useState({});
  const fileRef = useRef(null);
  const toast = useToast();
  const [genders, setGenders] = useState([]);

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    let alive = true;
    achieverApi.get('/auth/masters?types=gender')
      .then(({ data }) => setGenders(((data?.response?.grouped || {}).gender || []).filter(g => g.value !== 'all')))
      .catch(() => {});
    achieverApi.get('/achievers/portal/profile')
      .then(({ data }) => {
        if (!alive) return;
        if (!data.bool) { setFailed(true); return; }
        setForm({
          ...data.response,
          domains: data.response.domains || [],
        });
        setSaved(data.response);
        setFailed(false);
      })
      // There was no catch at all. A failed load rendered the form EMPTY, and
      // pressing Save would then have written those blanks over a real profile.
      // Refusing to render the form is the only safe behaviour here.
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const retry = () => { setLoading(true); setReloadKey((k) => k + 1); };

  // LinkedIn is the one profile field that is checkable by a human: it is how
  // an admin confirms the person reviewing as "Senior Engineer at Google" is
  // that person. Required for that reason. Shape lives in schema.profile so
  // the rule is not restated here.
  const validate = () => {
    const url = (form.linkedin_url || '').trim().replace(/^@/, '');
    return fieldErrors(schema.profile.safeParse({
      full_name: form.full_name || '',
      linkedin_url: url,
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    const problems = validate();
    setErrors(problems);
    if (Object.keys(problems).length) {
      toast.error(problems.full_name || problems.linkedin_url || 'Please fix the highlighted fields.');
      return;
    }
    setSaving(true);
    try {
      const payload = { ...form };
      // Stored with a scheme even when it was typed without one, so every
      // consumer -- the public profile link, an admin opening it to check the
      // person -- gets a URL a browser will actually follow.
      if (payload.linkedin_url) {
        const li = payload.linkedin_url.trim().replace(/^@/, '');
        payload.linkedin_url = /^https?:\/\//i.test(li) ? li : `https://${li}`;
      }
      // No password field on this screen any more; an achiever changes their
      // password through Forgot password, which verifies the email by OTP first.
      delete payload.new_password;
      // The achiever does not set their own price -- an admin sets it when they
      // approve. `form` is seeded from the GET, so without this the value would
      // still ride along in the payload and be re-clamped on every save.
      delete payload.session_rate;
      const { data } = await achieverApi.put('/achievers/portal/profile', payload);
      if (data.bool) {
        setErrors({});
        setSaved(payload);
        // Same reason as the upload path: the header reads a cached copy, so a
        // name or photo changed here has to be pushed to it.
        publishAchieverUser({
          full_name: payload.full_name,
          profile_image_url: payload.profile_image_url,
        });
        toast.success('Profile saved');
      } else {
        toast.error(data.response?.message || "Couldn't save your profile.");
      }
    } catch {
      // Previously unguarded: a thrown request meant setSaving(false) never
      // ran and the button stayed on "Saving..." for good.
      toast.error('Connection problem - nothing was saved.');
    } finally {
      setSaving(false);
    }
  };

  // Step 1: choose. Nothing leaves the browser here.
  const pickAvatar = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';               // so re-picking the same file still fires
    if (!file) return;
    // Checked before anything is sent. The server applies the same limits, but
    // finding out after a 9 MB upload on mobile data is a wasted upload.
    const problem = validateImageFile(file);
    if (problem) { toast.error(problem); return; }
    setPending({ file, preview: URL.createObjectURL(file) });
  };

  const cancelAvatar = () => {
    // Revoked, or every cancelled pick leaks its blob for the life of the tab.
    if (pending?.preview) URL.revokeObjectURL(pending.preview);
    setPending(null);
  };

  // Step 2: confirm. Only now is anything uploaded.
  const confirmAvatar = async () => {
    const file = pending?.file;
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const fd = new FormData();
      fd.append('file', file);
      // The server applies its own rules; `kind` tells it this one is an avatar,
      // so a PDF -- or a file renamed to .png -- is refused before it can become
      // somebody's profile photo.
      fd.append('kind', 'image');
      const { data } = await achieverApi.upload('/upload/', fd, { onProgress: setProgress });

      if (!data?.bool) {
        toast.error(data?.response?.message || "That photo couldn't be uploaded.");
        return;
      }
      const url = data.response?.url;
      if (!url) {
        toast.error('The photo was uploaded but the server did not say where to.');
        return;
      }

      // Persist immediately — matches the student portal, so the photo survives
      // a reload even if the user never presses Save.
      let saved = null;
      try {
        const res = await achieverApi.put('/achievers/portal/profile', { profile_image_url: url });
        // A rejected save comes back as {bool:false} and does NOT throw, so the
        // old catch-only check never saw it: any refusal here still announced
        // "Photo updated" while the row was unchanged. That is the second,
        // independent way this screen could claim a success it had not had.
        if (res.data?.bool) {
          // Trust what the server says it stored over our own copy of it.
          saved = res.data.response?.profile_image_url || url;
        } else {
          toast.error(res.data?.response?.message
            || 'Photo uploaded, but it could not be saved to your profile — press Save Profile.');
        }
      } catch {
        toast.info('Photo uploaded - press Save to apply it.');
      }

      // Set either way: when the save failed the file still exists, so keeping
      // the URL in the form is what makes Save Profile able to finish the job.
      sf('profile_image_url', saved || url);
      if (saved) {
        // So the header avatar picks the new photo up now, not at next sign-in.
        publishAchieverUser({ profile_image_url: saved });
        toast.success('Photo updated');
      }
    } catch (err) {
      // xhrUpload rejects with a message worth showing (offline, timeout, a
      // proxy returning HTML); fall back only if there isn't one.
      toast.error(err?.message || 'Connection problem - the photo was not uploaded.');
    } finally {
      setUploading(false);
      setProgress(0);
      cancelAvatar();
    }
  };

  // Going back to no photo at all.
  //
  // Uploading was one-way: once a photo was up, the camera icon could only
  // replace it. Someone who uploaded the wrong image -- or simply decided they
  // would rather not have their face on a public profile -- had no route back
  // to the default avatar. The profile PUT already treated an empty string as
  // "clear this", so only the control was missing.
  //
  // The file itself is left in the bucket. The row stops pointing at it, which
  // is what "remove my photo" means here; deleting the object is a separate
  // job with its own failure modes, and an orphaned image nobody links to is
  // the cheaper problem.
  const removeAvatar = async () => {
    if (!form.profile_image_url) return;
    setUploading(true);
    try {
      const res = await achieverApi.put('/achievers/portal/profile',
                                        { profile_image_url: '' });
      if (res.data?.bool) {
        sf('profile_image_url', '');
        publishAchieverUser({ profile_image_url: '' });
        toast.success('Photo removed');
      } else {
        toast.error(res.data?.response?.message || 'Could not remove the photo.');
      }
    } catch {
      toast.error('Connection problem — the photo was not removed.');
    } finally {
      setUploading(false);
      setConfirmRemove(false);
    }
  };

  if (loading) return (
    <div className="flex justify-center py-12">
      <div className="w-8 h-8 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
    </div>
  );

  const inputCls = 'w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/30 transition-shadow';

  // What students see on the public profile; each missing item is a reason
  // fewer of them book.
  const CHECKS = [
    ['Photo', !!form.profile_image_url],
    ['Designation', !!(form.designation || '').trim()],
    ['Company', !!(form.company || '').trim()],
    ['LinkedIn', !!(form.linkedin_url || '').trim()],
    ['Bio', (form.bio || '').trim().length >= 40],
  ];
  const doneCount = CHECKS.filter(([, ok]) => ok).length;
  const pct = Math.round((doneCount / CHECKS.length) * 100);
  const FIELDS = ['full_name', 'designation', 'company', 'linkedin_url', 'bio', 'gender', 'date_of_birth'];
  const dirty = FIELDS.some((k) => (form[k] || '') !== (saved[k] || ''));
  const role = [form.designation, form.company].filter(Boolean).join(' at ');

  const inp = (label, key, type = 'text', placeholder = '', required = false) => (
    <div>
      <label className="block text-xs font-semibold text-slate-600 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type={type} value={form[key] || ''} onChange={e => sf(key, e.target.value)}
        placeholder={placeholder}
        className={`${inputCls} ${required && errors[key] ? 'border-red-400' : ''}`} />
      {errors[key] && (
        <p className="text-xs text-red-600 mt-1">{errors[key]}</p>
      )}
    </div>
  );

  // Refusing to render the form on a failed load is deliberate: an empty form
  // that can be saved would overwrite a real profile with blanks.
  if (failed) return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <ErrorState
        title="We couldn't load your profile"
        subtitle="Nothing has changed - this is a connection problem."
        onRetry={retry}
      />
    </div>
  );

  return (
    <form onSubmit={save} className="space-y-5 md:space-y-6">
      {/* Visible hero is a card, by design — but a page still has to start at
          heading level 1, or a screen-reader user lands mid-outline with
          nothing above them. Hidden visually, announced normally. */}
      <h1 className="sr-only">Profile</h1>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        {/* gap-5 beside an 80px avatar left 190px for the text on a 320px
            screen, and the column would not shrink into it: a flex child's
            min-width is auto, so it sized to its longest word -- the email --
            and pushed the block to 352px. The page does not scroll sideways, so
            those 32px were cut off rather than reachable, and the address read
            "pavankumarsarakam@gmail". */}
        <div className="flex items-start sm:items-center gap-3 sm:gap-5 min-w-0">
          <div className="relative shrink-0">
            {/* AvatarImg keeps the failure in state, so a photo deleted from the
                bucket falls back to the shared default and stays there across
                re-renders -- the DOM-mutation version did not. */}
            <AvatarImg src={form.profile_image_url} alt=""
              className="w-14 h-14 sm:w-20 sm:h-20 rounded-2xl object-cover border-2 border-slate-200" />
            {/* Named, because it is icon-only: without this a screen reader
                announces "button" and nothing else. `before:-inset-2` lifts the
                HIT area to 44px without resizing the visible 28px circle — the
                same technique ActionBtn uses. */}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
              aria-label={uploading ? 'Uploading photo' : 'Change profile photo'}
              className="absolute -bottom-2 -right-2 w-7 h-7 rounded-full bg-white border-2 border-slate-200 flex items-center justify-center shadow-sm hover:border-slate-400 transition-colors disabled:opacity-50 before:absolute before:-inset-2 before:content-['']">
              {uploading ? <Loader2 size={12} className="animate-spin text-slate-500" /> : <Camera size={12} className="text-slate-500" />}
            </button>
            <input ref={fileRef} type="file" accept={ACCEPT_IMAGE} className="hidden" onChange={pickAvatar} />
          </div>
          <div className="min-w-0">
            <p className="text-lg font-bold text-slate-900 break-words leading-tight">{form.full_name || 'Your Name'}</p>
            {role && <p className="text-sm text-slate-600 mt-0.5 break-words">{role}</p>}
            {/* Truncated with the full address on hover: break-all split it
                mid-word at 320px ("gmail.co / m"). */}
            <p className="text-xs text-slate-400 mt-0.5 truncate" title={form.email}>{form.email || ''}</p>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
              {form.id && (
                <a href={studentSiteUrl(`/achievers/${form.id}`)} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700">
                  <ExternalLink size={12} /> Public profile
                </a>
              )}
              {saved.linkedin_url && (
                <a href={saved.linkedin_url} target="_blank" rel="noreferrer"
                   className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700">
                  <Link2 size={12} /> LinkedIn
                </a>
              )}
            {/* Only when there is something to remove. An always-present
                "Remove photo" beside a default avatar is a button that does
                nothing, and the header on a 320px screen has no room for one. */}
            {form.profile_image_url && (
              <button type="button" onClick={() => setConfirmRemove(true)} disabled={uploading}
                className="text-xs font-semibold text-slate-400 hover:text-red-600
                           transition-colors disabled:opacity-50">
                Remove photo
              </button>
            )}
            </div>
            {/* The camera-icon instruction is gone. On a 320px screen it ran to
                four lines beside an 80px avatar -- more of the header than the
                name and email it sat under -- to explain a control that is a
                camera icon on a photo, which needs no explaining. The file
                picker enforces the types and the size either way, and says so
                when a file is rejected. */}
          </div>
        </div>

        {/* Completeness: what is still missing from the public profile. */}
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-slate-600">Profile {pct}% complete</p>
            <p className="text-[11px] text-slate-400">{doneCount} of {CHECKS.length}</p>
          </div>
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CHECKS.map(([label, ok]) => (
              <span key={label} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium ${ok ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                {ok ? <CheckCircle2 size={11} /> : <Circle size={11} />} {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Asked in a dialog, like the upload it mirrors. Removing was a row of
          inline links under the email -- a different way of asking the same
          shape of question on the same screen, and on a 320px header the three
          words had nowhere to sit. */}
      <Modal
        isOpen={confirmRemove}
        onClose={uploading ? undefined : () => setConfirmRemove(false)}
        title="Remove your profile photo?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmRemove(false)} disabled={uploading}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Keep it
            </button>
            <button type="button" onClick={removeAvatar} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold
                         text-white bg-red-600 hover:bg-red-700 disabled:opacity-60">
              {uploading
                ? <><Loader2 size={14} className="animate-spin" /> Removing…</>
                : <><Trash2 size={14} /> Remove photo</>}
            </button>
          </div>
        }
      >
        <div className="flex items-center gap-4">
          {/* The photo they are about to lose, at the size students see it. */}
          <AvatarImg src={form.profile_image_url} alt=""
            className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm text-slate-700">
              Students will see the default avatar instead.
            </p>
            <p className="text-xs text-slate-400 mt-1">
              You can upload a new one whenever you like.
            </p>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={Boolean(pending)}
        onClose={uploading ? undefined : cancelAvatar}
        title="Use this as your profile photo?"
        size="sm"
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={cancelAvatar} disabled={uploading}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={confirmAvatar} disabled={uploading}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
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
            {/* Shown at the size and shape students will see it, so a badly
                cropped photo is obvious before it goes up rather than after. */}
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

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <h3 className="font-bold text-slate-900">Basic info</h3>
        <p className="text-xs text-slate-500 mt-0.5 mb-4">Shown to students on your public profile.</p>
        <div className="grid md:grid-cols-2 gap-4">
          {inp('Full name', 'full_name', 'text', 'Your full name', true)}
          {inp('LinkedIn URL', 'linkedin_url', 'url', 'https://linkedin.com/in/...', true)}
          {inp('Designation', 'designation', 'text', 'e.g. Senior Engineer')}
          {inp('Company', 'company', 'text', 'e.g. Google')}
          <FormSelect label="Gender" value={form.gender || ''} onChange={v => sf('gender', v)}
                      placeholder="Select gender"
                      options={genders.map(g => ({ value: g.value, label: g.label }))} />
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Date of birth</label>
            <DatePicker value={form.date_of_birth || ''} onChange={v => sf('date_of_birth', v)}
                        min={yearsAgoIso(90)} max={yearsAgoIso(16)} defaultView={yearsAgoIso(25)} />
            <p className="text-[11px] text-slate-400 mt-1">Admin matches this with your ID. Not shown to students.</p>
          </div>
          <div className="md:col-span-2">
            <div className="flex items-baseline justify-between mb-1">
              <label htmlFor="ach-bio" className="block text-xs font-semibold text-slate-600">Bio</label>
              <span className="text-[11px] text-slate-400">{(form.bio || '').length} characters{(form.bio || '').trim().length < 40 ? ' · 40+ reads best' : ''}</span>
            </div>
            <textarea id="ach-bio" value={form.bio || ''} onChange={e => sf('bio', e.target.value)} rows={4}
              placeholder="What you do, what you can help students with, and how you got there."
              className={`${inputCls} resize-none`} />
          </div>
        </div>
        <div className="mt-5 pt-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className={`text-xs ${dirty ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
            {dirty ? 'You have unsaved changes' : 'All changes saved'}
          </p>
          <Button type="submit" variant="primary" disabled={saving || !dirty} className="w-full sm:w-auto">
            {saving ? <><Loader2 size={15} className="animate-spin" /> Saving…</> : <><Save size={15} /> Save profile</>}
          </Button>
        </div>
      </div>
    </form>
  );
}
