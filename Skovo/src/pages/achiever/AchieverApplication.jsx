import FormSelect from '../../components/ui/FormSelect';
import React, { useEffect, useState } from 'react';
import {
  Loader2, Trash2, Check, ShieldCheck, AlertCircle, FileText, Send,
  ExternalLink, ChevronDown, Star, } from 'lucide-react';
import { achieverApi } from '../../services/api';
// No PageHeader here on purpose: the layout header already shows "Verification",
// and the tier card below is this screen's hero. A second title would repeat it.
import { ErrorState, Skeleton, useToast, FilePicker } from '../../components/ui/index.jsx';
import DatePicker from '../../components/ui/DatePicker';
import { yearsAgoIso, isoToLong } from '../../components/ui/dateUtils';
import { ConfirmModal } from '../../components/ui/TableComponents';

/**
 * Achiever Verification — trust tier, evidence, agreements and BGV.
 *
 * Everything on this screen is master data or ledger state from the API:
 *   • document types  → master_achiever_doc_type
 *   • agreements      → master_achiever_agreement (text + version)
 *   • progress score  → sp_achiever_verification_progress
 *   • capabilities    → sp_achiever_capabilities (lifecycle state)
 *
 * Nothing is hardcoded here except copy that describes the UI itself. Adding a
 * document type or an agreement is a master-data row, not a deploy.
 */


// Keyed on the lifecycle state. It was keyed on a trust tier, which no longer
// exists — every achiever resolved to 0 and read "Complete your application".
const STATE_BLURB = {
  pending:   'Upload your documents, then an admin reviews them.',
  probation: 'You are listed. Sessions are free until an admin reads the student reviews.',
  active:    'Fully approved. You can charge for sessions and cohorts.',
  suspended: 'Your account is suspended. See the reason above.',
  banned:    'This account is closed.',
};

const STATE_LABEL = {
  pending: 'Pending review', probation: 'On probation', active: 'Active',
  suspended: 'Suspended', banned: 'Closed',
};

function DemoStars({ value }) {
  if (value == null) return <span className="text-slate-400 text-sm">Not rated</span>;
  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map(n => (
        <Star key={n} size={14}
              className={n <= Math.round(value) ? 'text-amber-500 fill-amber-500' : 'text-slate-200'} />
      ))}
      <span className="text-sm font-semibold text-slate-700 ml-1">{Number(value).toFixed(1)}</span>
    </span>
  );
}

/** Same student reviews an admin reads. Read-only. */
function DemoReviewsPanel({ done, required, reviews, reason, approved = false }) {
  const sessions = reviews?.sessions || [];
  // The server sends one row per student. A demo cohort with four students is
  // still one demo, so group the rows: one card per demo, its reviews inside.
  const demos = [];
  sessions.forEach((s) => {
    const key = s.session_id || s.cohort_title;
    let d = demos.find((x) => x.key === key);
    if (!d) { d = { key, title: s.cohort_title, kind: s.demo_kind, at: s.completed_at, rows: [] }; demos.push(d); }
    d.rows.push(s);
  });
  const summary = reviews?.summary || {};
  const needed = required || 3;
  const have = done ?? summary.completed ?? 0;
  const pct = needed > 0 ? Math.min(100, (have / needed) * 100) : 0;

  return (
    <div className="bg-white rounded-2xl border border-amber-200 p-4 sm:p-6 space-y-4">
      <div>
        <p className="text-[11px] font-bold uppercase tracking-wide text-amber-700">Demo sessions</p>
        <h3 className="font-bold text-slate-900 mt-0.5">{have} of {needed} complete</h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Students review after class. Only completed sessions count — no-shows do not.
          An admin reads the same reviews you see here.
        </p>
      </div>

      <div className="h-2 rounded-full bg-amber-100 overflow-hidden">
        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {reason && (
        <div className="rounded-xl bg-amber-50 border border-amber-200 p-3.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-800">From the admin</p>
          <p className="text-sm text-amber-900 mt-1 leading-relaxed">{reason}</p>
        </div>
      )}

      {have >= needed && (
        <p className="text-sm text-amber-900 font-medium">
          {approved
            ? 'Demo approved. You can now charge for sessions and cohorts.'
            : <>{needed === 1 ? 'Your demo is done.' : `All ${needed} demos are done.`} An admin is reading the reviews and will be in touch.</>}
        </p>
      )}

      {summary.no_shows > 0 && (
        <p className="text-xs text-slate-500">
          {summary.no_shows} no-show{summary.no_shows === 1 ? '' : 's'} — not counted toward {needed}.
        </p>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-slate-400 italic">No demo sessions booked yet. Set your availability so students can find you.</p>
      ) : (
        <div className="space-y-3">
          {demos.map((d, i) => {
            const rated = d.rows.filter((r) => r.rating != null);
            const avg = rated.length ? rated.reduce((a, r) => a + Number(r.rating), 0) / rated.length : null;
            return (
              <div key={d.key || i} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Demo {i + 1}{d.kind === 'cohort' ? ' · Cohort' : d.kind === 'session' ? ' · 1-on-1' : ''}
                    </p>
                    <p className="font-semibold text-slate-900 mt-0.5 break-words">{d.title || d.rows[0]?.student_name || 'Demo'}</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      {d.at ? new Date(d.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not completed'}
                      {' · '}{d.rows.length} student{d.rows.length === 1 ? '' : 's'}
                    </p>
                  </div>
                  {avg != null && (
                    <div className="text-right">
                      <DemoStars value={Math.round(avg * 10) / 10} />
                      <p className="text-xs text-slate-400 mt-1">{rated.length} review{rated.length === 1 ? '' : 's'}</p>
                    </div>
                  )}
                </div>
                <div className="mt-3 divide-y divide-slate-100 border-t border-slate-100">
                  {d.rows.map((s, j) => (
                    <div key={s.student_id || j} className="py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold text-slate-800 min-w-0 truncate">{s.student_name || 'Student'}</p>
                        <span className="text-xs text-slate-500 shrink-0">{s.rating != null ? `${s.rating} / 5` : 'No rating'}</span>
                      </div>
                      {s.no_show && <p className="text-xs text-red-600 mt-1">Marked as a no-show.</p>}
                      {s.review_text
                        ? <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap break-words">{s.review_text}</p>
                        : <p className="text-xs text-slate-400 italic mt-1">No written feedback.</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── Completion ring ──────────────────────────────────────────────────────
 * The score comes from the same procedure that gates submit, so the number and
 * the rule can never disagree.
 */
function ProgressRing({ percent }) {
  const r = 26;
  const circ = 2 * Math.PI * r;
  return (
    <div className="relative w-[68px] h-[68px] shrink-0">
      <svg width="68" height="68" className="-rotate-90">
        {/* The track needs a dark counterpart. slate-100 is near-white, so on a
            dark card the unfilled part of the ring was brighter than the filled
            part: a 0% ring read as a finished one, which is the opposite of
            what it says in the middle. */}
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="6"
                className="stroke-slate-100 dark:stroke-slate-700" />
        <circle cx="34" cy="34" r={r} fill="none" strokeWidth="6" strokeLinecap="round"
          style={{ stroke: 'var(--accent)' }}
          strokeDasharray={circ} strokeDashoffset={circ - (circ * percent) / 100} />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-slate-900">
        {percent}%
      </span>
    </div>
  );
}

/* ─── Platform guidelines ──────────────────────────────────────────────────
 * Replaces a "what you have unlocked" ladder whose four rungs read capability
 * keys the API does not send -- can_list, can_create_free and can_teach_minors
 * were never in the payload, so three of them sat permanently locked under a
 * heading promising that each step unlocks the next.
 *
 * The copy is the server's, not this file's: same GUIDELINES the lifecycle
 * endpoint serves, keyed on state, so it changes with a backend deploy and can
 * never contradict what the rest of the flow says.
 */
function PlatformGuidelines({ guidelines }) {
  // Returning null here left the step titled "Guidelines" showing nothing but a
  // checkbox asking you to confirm you had read them. If the copy is missing,
  // say so -- an empty panel reads as a broken page, and worse, as something
  // safe to tick past.
  if (!guidelines) {
    return (
      <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 p-3.5">
        <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-900">Guidelines could not be loaded</p>
          <p className="text-xs text-amber-800 mt-0.5 leading-relaxed">
            Please refresh. If this persists, do not confirm below — tell us instead,
            so nobody accepts something they were never shown.
          </p>
        </div>
      </div>
    );
  }
  const steps = guidelines.steps || [];
  const sections = guidelines.sections || [];
  return (
    <div>
      <h3 className="font-bold text-slate-900">{guidelines.title}</h3>
      {guidelines.summary && (
        <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-prose">{guidelines.summary}</p>
      )}

      {steps.length > 0 && (
        <>
          <p className="mt-5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
            Before you start
          </p>
          <ol className="mt-2 space-y-3">
            {steps.map((text, i) => (
              <li key={i} className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 text-[11px]
                                 font-bold flex items-center justify-center shrink-0 mt-0.5">
                  {i + 1}
                </span>
                <p className="text-sm text-slate-600 leading-relaxed">{text}</p>
              </li>
            ))}
          </ol>
        </>
      )}

    </div>
  );
}

/* ─── The guidelines proper ────────────────────────────────────────────────
 * Its own card, below the welcome. Headed sections rather than one long list,
 * because "what will close your account" should be findable later without
 * re-reading everything above it.
 *
 * Shown open, not behind a disclosure: collapsed, the card shrank to a single
 * row and the rest of the page jumped up under it, which read as content
 * disappearing rather than folding. A separate card keeps the welcome short
 * without hiding anything.
 */
function GuidelineSections({ guidelines }) {
  const sections = guidelines?.sections || [];
  const note = guidelines?.note;
  if (sections.length === 0) return null;
  return (
    <>
      {/* Two columns from lg up: one column of prose left half a laptop screen empty. */}
      <div className="grid gap-x-10 gap-y-5 lg:grid-cols-2">
      {sections.map((sec) => (
        <section key={sec.heading}>
          <h4 className="text-sm font-bold text-slate-900">{sec.heading}</h4>
          <ul className="mt-2 space-y-2">
            {(sec.points || []).map((pt, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="w-1 h-1 rounded-full bg-slate-300 shrink-0 mt-2" />
                <p className="text-sm text-slate-600 leading-relaxed">{pt}</p>
              </li>
            ))}
          </ul>
        </section>
      ))}
      </div>

      {/* Still rendered because the probation and active states carry their own
          note. The pending one was dropped on the server, not here. */}
      {note && (
        <p className="mt-6 text-xs text-slate-500 leading-relaxed bg-slate-50
                      border border-slate-100 rounded-xl p-3.5 max-w-prose">
          {note}
        </p>
      )}
    </>
  );
}

/* ─── Agreement row ────────────────────────────────────────────────────────
 * Expandable so the achiever can read what they are accepting. The body, the
 * version and the timestamp all come from master data + the consent ledger —
 * which is the point: a tick next to a sentence that exists only in a React
 * file proves nothing.
 */
function AgreementRow({ a, busy, onAccept }) {
  const [open, setOpen] = useState(false);
  // Disabled-but-unstyled is the worst of both: the box refuses the click and
  // still invites it, so it reads as broken rather than as "not yet". Split out
  // so the cursor, the border and the label all say the same thing.
  const blocked = !a.accepted && busy;
  return (
    <div className={`rounded-xl border transition-all ${
      a.accepted ? 'border-emerald-200 bg-emerald-50/60'
        : blocked ? 'border-slate-200 bg-slate-50/60' : 'border-slate-200'}`}>
      {/* Centred on the label as a block. Anchoring the box to the first line
          is the textbook rule, and it measured exact -- but every label here
          wraps to two or more lines on a phone, and a box pinned to the top
          of a four-line paragraph reads as belonging to that first line
          rather than to the whole statement being accepted. */}
      <div className="flex items-center gap-3 px-4 py-3 min-h-11">
        <button type="button" disabled={a.accepted || busy}
          onClick={() => onAccept(a.value)}
          title={blocked ? 'Available once the text above has loaded' : undefined}
          aria-label={a.accepted ? 'Accepted' : `Accept ${a.label}`}
          className={`w-11 h-11 rounded-lg flex items-center justify-center shrink-0 -ml-2 transition-colors ${
            a.accepted ? 'text-emerald-600'
              : blocked ? 'text-slate-300 cursor-not-allowed'
              : 'text-slate-400 hover:bg-slate-50'}`}>
          <span className={`w-5 h-5 rounded border-2 flex items-center justify-center ${
            a.accepted ? 'border-emerald-500 bg-emerald-500'
              : blocked ? 'border-slate-200 bg-slate-100'
              : 'border-slate-300'}`}>
            {a.accepted && <Check size={11} className="text-white" strokeWidth={3} />}
          </span>
        </button>

        <div className="min-w-0 flex-1">
          <p className={`text-sm max-w-prose ${
            a.accepted ? 'text-emerald-900' : blocked ? 'text-slate-400' : 'text-slate-700'}`}>
            {a.label}
          </p>
          {/* The acceptance stamp carries a dark variant because emerald-700 is
              a dark green: on the dark card behind it, it measured 2.16:1 --
              the receipt for a policy the achiever is bound by was the least
              legible text on the screen. */}
          {a.accepted && (
            <p className="text-[11px] text-emerald-700/80 dark:text-emerald-300/90 mt-0.5">
              Accepted {a.accepted_at ? new Date(a.accepted_at).toLocaleDateString('en-IN', {
                day: 'numeric', month: 'short', year: 'numeric' }) : ''}
              {a.accepted_version && ` · policy ${a.accepted_version}`}
            </p>
          )}
          {a.stale && (
            <p className="text-[11px] text-amber-700 mt-0.5">
              Updated to {a.current_version} since you accepted {a.accepted_version}.
            </p>
          )}
        </div>

        {(a.body || a.body_url) && (
          <button type="button" onClick={() => setOpen((o) => !o)}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 shrink-0 min-h-9">
            Read
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        )}
      </div>

      {open && (
        <div className="px-4 pb-4 pl-11">
          {a.body && (
            <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-line">{a.body}</p>
          )}
          {a.body_url && (
            <a href={a.body_url} target="_blank" rel="noreferrer"
              className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 mt-2">
              Full policy <ExternalLink size={11} />
            </a>
          )}
          <p className="text-[11px] text-slate-400 mt-2">Version {a.current_version}</p>
        </div>
      )}
    </div>
  );
}

const GUIDE = 'guidelines';

function DocPill({ status }) {
  const cls = status === 'accepted' || status === 'approved'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'rejected' ? 'bg-red-50 text-red-700'
    : 'bg-slate-100 text-slate-600';
  const label = status === 'accepted' || status === 'approved' ? 'Accepted'
    : status === 'rejected' ? 'Sent back'
    : status === 'pending' ? 'With admin' : (status || 'Needed');
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cls}`}>
      {label}
    </span>
  );
}

/* ─── Review your details ──────────────────────────────────────────────────
 * The last step before submitting, and the only one that writes to the profile
 * rather than the application. It exists so nobody submits a profile they have
 * not looked at since they typed it -- an admin reviewing evidence against a
 * half-empty profile is reviewing nothing.
 *
 * Editable after approval too. Documents and the background check are frozen
 * once a decision is made; a bio, a photo and a job title are not, and an
 * achiever who changes employer should not need an admin to fix it.
 */
function ProfileReview({ onDirtyChange, onSaved, locked }) {
  const [form, setForm] = useState(null);
  const [genders, setGenders] = useState([]);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/profile')
      .then(({ data }) => { if (alive && data.bool) setForm(data.response); })
      .catch(() => { if (alive) setError('Could not load your profile.'); });
    achieverApi.get('/auth/masters?types=gender')
      .then(({ data }) => { if (alive) setGenders(((data?.response?.grouped || {}).gender || []).filter(g => g.value !== 'all')); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const save = async () => {
    // LinkedIn shows the profile address without a scheme -- "Public profile &
    // URL" reads www.linkedin.com/in/name -- so that is what people copy. The
    // scheme is optional here and added before saving, rather than rejecting the
    // exact string LinkedIn just handed them.
    const raw = (form.linkedin_url || '').trim().replace(/^@/, '');
    if (!raw || !/^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+/i.test(raw)) {
      setError('Enter your LinkedIn profile address, e.g. linkedin.com/in/your-name');
      return;
    }
    const li = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    if (!form.date_of_birth) { setError('Add your date of birth. Admin matches it with your ID.'); return; }
    if (!form.gender) { setError('Select your gender.'); return; }
    setError(''); setSaving(true);
    try {
      const { data } = await achieverApi.put('/achievers/portal/profile', {
        full_name: form.full_name,
        designation: form.designation,
        company: form.company,
        linkedin_url: li,
        bio: form.bio,
        gender: form.gender,
        date_of_birth: form.date_of_birth,
      });
      if (data.bool) {
        toast.success('Profile updated');
        setEditing(false);
        onDirtyChange?.(false);
        // Submit reads `missing` from the application-status endpoint, not
        // from here. Without this the LinkedIn URL saved fine and Submit stayed
        // disabled, still asking for the thing that had just been provided.
        onSaved?.();
      }
      else setError(data.response?.message || 'Could not save your profile.');
    } catch {
      setError('Connection problem - nothing was saved.');
    } finally { setSaving(false); }
  };

  if (error && !form) return <p className="text-sm text-red-600">{error}</p>;
  if (!form) return <Skeleton className="h-40" />;

  // min-h-11: px-3 py-2.5 rendered 42px, two under the 44px minimum a finger
  // needs. Everything else on this screen already clears it.
  const cls = 'w-full min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-shadow';
  // The fifth slot carries the input's own attributes. Without a type the
  // LinkedIn field got the plain alphabetic keyboard on a phone -- no slash, no
  // ".com" key -- for a value that is nothing but a URL, and no autocomplete
  // meant the browser never offered the name it already knows.
  const rows = [
    ['Full name', 'full_name', 'Your full name', true,
      { type: 'text', autoComplete: 'name' }],
    ['Designation', 'designation', 'e.g. Senior Engineer', false,
      { type: 'text', autoComplete: 'organization-title' }],
    ['Company', 'company', 'e.g. Google', false,
      { type: 'text', autoComplete: 'organization' }],
    ['LinkedIn URL', 'linkedin_url', 'https://linkedin.com/in/your-name', true,
      { type: 'url', inputMode: 'url', autoComplete: 'url', spellCheck: false,
        autoCapitalize: 'none' }],
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-900">Check your details</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {locked
              ? 'Approved, so this is now what your students see. Edit it from your Profile screen.'
              : 'This is what an admin reads beside your documents. You can still change it while you wait.'}
          </p>
        </div>
        {/* Editable right up to approval. */}
        {!editing && !locked && (
          <button type="button" onClick={() => setEditing(true)}
            className="text-sm font-semibold shrink-0 min-h-11 px-3"
            style={{ color: 'var(--accent)' }}>
            Edit
          </button>
        )}
      </div>

      {!editing ? (
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
          {/* The `required` flag was already in `rows` and the summary threw
              it away, so all four rows read an identical grey "Not given" —
              yet only two of them block Submit. The screen said "Still needed:
              your LinkedIn URL" at the bottom while the field itself looked
              exactly as optional as Company and Designation above it.

              A required field that is empty is now marked twice: a red
              asterisk on the label, matching the edit form, and the value in
              red rather than grey. Optional-and-empty keeps the quiet grey —
              that distinction is the whole point. */}
          {rows.map(([label, key, , required]) => {
            const missingRequired = required && !form[key];
            return (
              <div key={key}>
                <dt className="text-xs font-semibold text-slate-500">
                  {label}
                  {required && <span className="text-red-500 ml-0.5" aria-hidden="true">*</span>}
                </dt>
                <dd className={`text-sm mt-0.5 break-words ${
                  form[key] ? 'text-slate-800'
                            : missingRequired ? 'text-red-500 italic'
                                              : 'text-slate-300 italic'}`}>
                  {form[key] || (missingRequired ? 'Required — add this' : 'Not given')}
                </dd>
              </div>
            );
          })}
          {[['Date of birth', form.date_of_birth ? isoToLong(form.date_of_birth) : ''],
            ['Gender', genders.find(g => g.value === form.gender)?.label || '']].map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-semibold text-slate-500">
                {label}<span className="text-red-500 ml-0.5" aria-hidden="true">*</span>
              </dt>
              <dd className={`text-sm mt-0.5 ${value ? 'text-slate-800' : 'text-red-500 italic'}`}>
                {value || 'Required — add this'}
              </dd>
            </div>
          ))}
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold text-slate-500">Bio</dt>
            <dd className={`text-sm mt-0.5 leading-relaxed ${form.bio ? 'text-slate-800' : 'text-slate-300 italic'}`}>
              {form.bio || 'Not given'}
            </dd>
          </div>
        </dl>
      ) : (
        <div className="space-y-3">
          {/* htmlFor/id on every field: the labels were visual only, so tapping
              one did not focus its input and a screen reader read four unnamed
              text boxes. */}
          {rows.map(([label, key, ph, req, attrs]) => (
            <div key={key}>
              <label htmlFor={`profile-${key}`} className="block text-xs font-semibold text-slate-600 mb-1">
                {label}{req && <span className="text-red-500 ml-0.5">*</span>}
              </label>
              <input id={`profile-${key}`} name={key} {...attrs}
                value={form[key] || ''} placeholder={ph} className={cls}
                onChange={e => { sf(key, e.target.value); onDirtyChange?.(true); }} />
            </div>
          ))}
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">
                Date of birth<span className="text-red-500 ml-0.5">*</span>
              </label>
              <DatePicker value={form.date_of_birth || ''}
                          onChange={v => { sf('date_of_birth', v); onDirtyChange?.(true); }}
                          min={yearsAgoIso(90)} max={yearsAgoIso(16)} defaultView={yearsAgoIso(25)} />
            </div>
            <FormSelect label="Gender" required value={form.gender || ''}
                        onChange={v => { sf('gender', v); onDirtyChange?.(true); }}
                        placeholder="Select gender"
                        options={genders.map(g => ({ value: g.value, label: g.label }))} />
          </div>
          <div>
            <label htmlFor="profile-bio" className="block text-xs font-semibold text-slate-600 mb-1">Bio</label>
            <textarea id="profile-bio" name="bio" rows={4} value={form.bio || ''}
              placeholder="Tell students about yourself…"
              className={`${cls} resize-none`}
              onChange={e => { sf('bio', e.target.value); onDirtyChange?.(true); }} />
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex flex-col-reverse sm:flex-row gap-2">
            <button type="button" onClick={() => { setEditing(false); setError(''); }} disabled={saving}
              className="w-full sm:w-auto min-h-11 px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-100">
              Cancel
            </button>
            <button type="button" onClick={save} disabled={saving}
              className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
              style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AchieverApplication() {
  const [state,     setState]     = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [failed,    setFailed]    = useState(false);
  const [busy,      setBusy]      = useState(false);
  const toast = useToast();
  // Starts empty and takes its default from master data once loaded — hardcoding
  // 'govt_id' here would break the moment an admin retires that option.
  const [docType,   setDocType]   = useState('');
  // Bumped after each attach so FilePicker clears itself for the next one.
  const [docSeq, setDocSeq] = useState(0);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const load = () => {
    setFailed(false);
    return achieverApi.get('/achiever-application/status')
      .then(({ data }) => {
        if (!data.bool) { setFailed(true); return; }
        setState(data.response);
        setDocType(cur => cur || data.response.doc_types?.[0]?.value || '');
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Called by FilePicker once the person has picked a file and confirmed it.
  // Throwing here keeps the file selected and shows the message inline, so a
  // failure halfway through is one retry rather than a fresh hunt for the file.
  // The type is passed in rather than read from state: each required step owns
  // its own type, and a picker that uploaded whatever the dropdown happened to
  // say would file the selfie as a government ID.
  const uploadDoc = async (file, { onProgress, signal, docType: type }) => {
    // Two steps on purpose: /upload/ owns storage (S3), and the application
    // only ever records the URL it hands back.
    const fd = new FormData();
    fd.append('file', file);
    const up = await achieverApi.upload('/upload/', fd, { onProgress, signal });
    if (!up.data.bool) throw new Error(up.data.response?.message || 'Upload failed.');

    const { data } = await achieverApi.post('/achiever-application/documents', {
      doc_type: type || docType,
      file_url: up.data.response.url,
      original_name: up.data.response.original_name,
    });
    // The file is in storage but not attached. Say so precisely — "upload
    // failed" would send them to re-upload something already stored.
    if (!data.bool) throw new Error(data.response?.message || 'Uploaded, but could not attach it. Try again.');

    setDocSeq(n => n + 1);
    toast.success('Document attached');
    await load();
  };

  // Deleting a document destroys a file the achiever uploaded — getting it
  // back means finding the original and uploading it again, from a phone more
  // often than not. The trash icon sits right beside the preview link, so it
  // asks first and names what is being removed.
  const confirmRemove = (d) => {
    const name = (state?.doc_types || []).find(t => t.value === d.doc_type)?.label || d.doc_type;
    setConfirmDlg({
      message: `Remove ${name}?`,
      detail: d.original_name
        ? `"${d.original_name}" will be deleted. You would need to upload it again.`
        : 'The file will be deleted. You would need to upload it again.',
      confirmLabel: 'Remove',
      danger: true,
      onConfirm: () => removeDoc(d.id),
    });
  };

  const removeDoc = async (id) => {
    setBusy(true);
    try {
      const { data } = await achieverApi.delete(`/achiever-application/documents/${id}`);
      if (data.bool) {
        // Removing a required document pulls the application out of the review
        // queue, and that is worth more than "Document removed" — it changes
        // what the achiever has to do next. The server says which happened.
        if (data.response?.returned_to_draft) toast.info(data.response.message);
        else toast.success('Document removed');
      }
      else toast.error(data.response?.message || 'Could not remove it');
      await load();
    } catch {
      toast.error('Could not remove that document.');
    } finally { setBusy(false); }
  };

  const accept = async (type) => {
    setBusy(true);
    try {
      const { data } = await achieverApi.post('/achiever-application/agreements', { accept: [type] });
      if (!data.bool) throw new Error(data.response?.message);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not record that.');
    } finally { setBusy(false); }
  };

  const submit = async () => {
    setBusy(true);
    try {
      const { data } = await achieverApi.post('/achiever-application/submit', {});
      if (data.bool) toast.success(data.response?.message || 'Submitted for review');
      else toast.error(data.response?.message || 'Not ready to submit yet');
      await load();
    } catch {
      toast.error('Could not submit. Try again.');
    } finally { setBusy(false); }
  };

  // Skeletons in the shape of the real sections, rather than a bare spinner —
  // the page stops jumping when the data lands.
  if (loading) return (
    <div className="space-y-6">
      <Skeleton className="h-44" />
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-56" /><Skeleton className="h-56" />
      </div>
      <Skeleton className="h-64" />
    </div>
  );

  if (failed || !state) return (
    <div className="bg-white rounded-2xl border border-slate-200">
      <ErrorState
        title="We couldn't load your verification"
        subtitle="Your documents and tier are safe — this is a connection problem."
        onRetry={() => { setLoading(true); load(); }}
      />
    </div>
  );

  const { state: lifecycle, documents, missing, can_submit,
          application_status: status, rejection_reason, bgv } = state;
  const progress = state.progress || {};
  const agreements = state.agreements || [];
  const docTypes = state.doc_types || [];
  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-shadow';
  const labelFor = (v) => docTypes.find(t => t.value === v)?.label || v;

  // The guidelines acknowledgement lives in the same ledger as the policies but
  // is ticked separately, so it is split out rather than listed with them.
  const guideAgreement  = agreements.find(a => a.value === GUIDE);
  const policyAgreements = agreements.filter(a => a.value !== GUIDE);
  // Read off `missing`, which the server computes from sp_achiever_document_coverage
  // -- one identity document and one credential document, counting anything not
  // rejected. Deriving it here from `documents` instead would be a second copy of
  // the rule, and the two would drift.
  // Straight from master data, already in sort_order: government ID, then
  // selfie, then proof of achievement. Asking for all three at once behind one
  // dropdown meant an achiever uploaded whichever was selected and stopped.
  // A rejection only needs acting on while nothing has replaced it. Once a new
  // file of that type is up, the old rejection is history and belongs in the
  // list below rather than at the top of the screen.
  const rejectedOpen = documents.filter(d =>
    d.status === 'rejected'
    && !documents.some(o => o.doc_type === d.doc_type && o.status !== 'rejected'));

  const requiredDocs = state.required_documents || [];
  // Asked for by a reviewer, by hand, on top of the standard three. Kept
  // separate because they carry a note explaining what is wanted -- the
  // standard ones never need one.
  const askedDocs = (state.document_requests || []).filter(r => !r.done);
  const nextDoc = requiredDocs.find(d => !d.done) || null;
  const optionalTypes = docTypes.filter(t => !t.is_required);

  // Frozen on approval, not on submission. Being in the queue is not a decision,
  // and an achiever who spots a blurry ID while waiting should be able to replace
  // it rather than wait to be rejected for it. After approval the documents are
  // what the decision was made on, so they stop being editable.
  const evidenceLocked = status === 'approved';

  const waitingOnYou = rejectedOpen.length > 0 || askedDocs.length > 0;
  const stillBuilding = status !== 'submitted' && status !== 'approved';

  const banner = (status === 'approved' || lifecycle === 'active') && !waitingOnYou
    ? { tone: 'ok', title: 'All documents approved', body: 'Your documents stay on file. An admin can still ask for more if they need them.' }
    : status === 'rejected'
      ? { tone: 'alert', title: 'Application sent back', body: 'Read the reason below, fix what was asked, and submit again.' }
      : waitingOnYou
        ? { tone: 'wait', title: 'Waiting on you', body: 'An admin asked for something below. Send it and they will look again. You do not start over.' }
        : status === 'submitted'
          ? { tone: 'review', title: 'With the admin team', body: 'Your application is in the queue. We will email you when there is a decision.' }
          : { tone: 'build', title: 'Documents an admin will review', body: 'Upload everything on the list, accept the agreements, check your details, then submit.' };

  const bannerCls = {
    ok:     'bg-emerald-50 border-emerald-200',
    alert:  'bg-red-50 border-red-200',
    wait:   'bg-amber-50 border-amber-200',
    review: 'bg-blue-50 border-blue-200',
    build:  'bg-white border-slate-200',
  }[banner.tone];
  const titleCls = {
    ok: 'text-emerald-900', alert: 'text-red-900', wait: 'text-amber-900',
    review: 'text-blue-900', build: 'text-slate-900',
  }[banner.tone];
  const bodyCls = {
    ok: 'text-emerald-800', alert: 'text-red-800', wait: 'text-amber-800',
    review: 'text-blue-800', build: 'text-slate-500',
  }[banner.tone];

  const latestFor = (type) => {
    const ofType = documents.filter(d => d.doc_type === type);
    return ofType.find(d => d.status !== 'rejected') || ofType[0] || null;
  };
  // Files already shown on their required row are not listed again below.
  const shownIds = new Set(requiredDocs.map((d) => latestFor(d.value)?.id).filter(Boolean));
  const otherDocs = documents.filter((d) => !shownIds.has(d.id));

  // Shown first while the application is being built (read, accept, upload).
  // Once it is in, every box here is ticked and it only pushed the one thing
  // still asked of the achiever 1,600px down, so it folds away at the bottom.
  const readFirst = (
    <>
    {/* The welcome and what you are agreeing to come first. They used to sit
        third, below the progress ring and the whole upload list, so a new
        achiever met a 0% score and three "Needed" badges before anything had
        explained what this is. Read, accept, then upload. */}
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
      <PlatformGuidelines guidelines={state.guidelines} />
    </div>

    {/* The long read gets its own card so the welcome above stays short. Not
        conditional on there being sections: the acknowledgement lives here,
        and it has to stay reachable even if the copy fails to load. */}
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-5">
      <div>
        <h3 className="font-bold text-slate-900">The full guidelines</h3>
        <p className="text-xs text-slate-400 mt-0.5">
          Read these before you accept below.
        </p>
      </div>
      <GuidelineSections guidelines={state.guidelines} />
      {guideAgreement
        ? <AgreementRow a={guideAgreement} busy={busy || !state.guidelines} onAccept={accept} />
        : <p className="text-xs text-slate-400 italic">The acknowledgement step has not loaded. Refresh to try again.</p>}
    </div>

    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-5">
      <div>
        <h3 className="font-bold text-slate-900">Agreements</h3>
        <p className="text-xs text-slate-400 mt-0.5 mb-3">
          Each acceptance is recorded with its policy version, timestamp and IP.
        </p>
        {policyAgreements.length === 0
          ? <p className="text-sm text-slate-400 italic">No agreements configured.</p>
          : <div className="space-y-2">
              {policyAgreements.map(a => (
                <AgreementRow key={a.value} a={a} busy={busy} onAccept={accept} />
              ))}
            </div>}
      </div>
    </div>
    </>
  );
  const acceptedN = agreements.filter((a) => a.accepted).length;

  const statusCard = (
    <>
      <div className={`rounded-2xl border p-4 sm:p-6 ${bannerCls}`}>
        {/* The ring pairs with the HEADING, and the prose runs full width
            underneath both. Two earlier attempts got this wrong in opposite
            ways: a min width flex-wrap could not honour put the ring on a line
            of its own, 68px of ring beside 203px of nothing on a 288px card;
            floating it then let the body wrap around the ring, which left the
            paragraph with one indented line and the rest full width.
  
            Pairing ring with heading fixes both. The heading and its badge are
            roughly the ring's height, so nothing is left over beside it, and
            every line of the body starts at the same edge. */}
        <div className="flex items-start gap-4 sm:gap-5">
          {status !== 'approved' && (
            <div className="text-center shrink-0">
              <ProgressRing percent={progress.percent_complete ?? 0} />
              <p className="text-[11px] text-slate-400 mt-1">complete</p>
            </div>
          )}
          <div className="min-w-0 flex-1">
            {/* The icon is INSIDE the heading, not a sibling flex item. As a
                sibling it was its own wrappable unit, so on a narrow card the
                shield took a line to itself and the words it belongs to started
                on the next one. Inline, it sits on the first line of the text
                and the text wraps under it the way any sentence would. */}
            <h2 className={`font-bold ${titleCls}`}>
              <ShieldCheck size={18} style={{ color: 'var(--accent)' }}
                           className="inline-block align-[-3px] mr-2" />
              {banner.title}
            </h2>
            <span className={`inline-block mt-2 text-xs font-semibold px-2.5 py-1 rounded-full ${
              status === 'approved'  ? 'bg-emerald-100 text-emerald-800' :
              status === 'submitted' ? 'bg-blue-100 text-blue-800' :
              status === 'rejected'  ? 'bg-red-100 text-red-800' : 'bg-slate-100 text-slate-600'}`}>
              {STATE_LABEL[lifecycle] || 'Pending'}
            </span>
          </div>
        </div>
  
        <p className={`text-sm mt-3 leading-relaxed ${bodyCls}`}>{banner.body}</p>
        <p className="text-xs text-slate-500 mt-2">{STATE_BLURB[lifecycle]}</p>
        {bgv?.status && bgv.status !== 'none' && (
          <p className="text-xs text-slate-500 mt-2">
            Background check: {bgv.status === 'pending' ? 'in progress'
              : bgv.status === 'failed' ? 'returned an adverse result'
              : bgv.status === 'expired' ? 'expired — a renewal is needed'
              : bgv.expires_at
                ? `clear until ${new Date(bgv.expires_at).toLocaleDateString('en-IN')}`
                : 'clear'}
          </p>
        )}
  
        {status === 'rejected' && rejection_reason && (
          <div className="mt-5 p-3.5 rounded-xl bg-white/80 text-sm text-red-800 border border-red-200">
            <p className="font-semibold">Why it was sent back</p>
            <p className="mt-0.5 leading-relaxed">{rejection_reason}</p>
          </div>
        )}
      </div>
    </>
  );
  const work = (
    <>
      {askedDocs.length > 0 && (
        <div className="bg-white rounded-2xl border border-blue-200 p-4 sm:p-6 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-blue-700">Admin asked for</p>
            <h3 className="font-bold text-slate-900 mt-0.5">Extra documents</h3>
            <p className="text-xs text-slate-500 mt-0.5">Specific to your application. Upload each one.</p>
          </div>
          {askedDocs.map(r => (
            <div key={r.doc_type} className="rounded-xl border border-blue-200 bg-blue-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">{r.label}</p>
              {r.note && <p className="text-sm text-slate-600 mt-1 leading-relaxed">{r.note}</p>}
              <div className="mt-3">
                <FilePicker
                    key={`req-${r.doc_type}-${docSeq}`}
                    disabled={busy}
                    label={`Upload your ${r.label.toLowerCase().replace(/^your /, "")}`}
                    onUpload={(file, opts) => uploadDoc(file, { ...opts, docType: r.doc_type })}
                  />
              </div>
            </div>
          ))}
        </div>
      )}
  
      {rejectedOpen.length > 0 && (
        <div className="bg-white rounded-2xl border border-red-200 p-4 sm:p-6 space-y-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-red-700">Sent back</p>
            <h3 className="font-bold text-slate-900 mt-0.5">Replace these files</h3>
            <p className="text-xs text-slate-500 mt-0.5">The admin’s reason is on each card. Nothing else needs redoing.</p>
          </div>
          {rejectedOpen.map(d => (
            <div key={d.id} className="rounded-xl border border-red-200 bg-red-50/60 p-4">
              <p className="text-sm font-semibold text-slate-900">{labelFor(d.doc_type)}</p>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {d.review_note || <span className="italic text-slate-400">No reason was given. Upload a clearer copy.</span>}
              </p>
              <div className="mt-3">
                <FilePicker
                  key={`fix-${d.doc_type}-${docSeq}`}
                  disabled={busy}
                  label={`Upload a new ${labelFor(d.doc_type).toLowerCase()}`}
                  onUpload={(file, opts) => uploadDoc(file, { ...opts, docType: d.doc_type })}
                />
              </div>
            </div>
          ))}
        </div>
      )}
  
      {/* What the admin asked for sits right under "Waiting on you"; the
          demo progress follows. */}
      {(lifecycle === 'probation' || lifecycle === 'active') && (
        <DemoReviewsPanel
          done={state.demos_done}
          required={state.demos_required}
          reviews={state.demo_reviews}
          approved={lifecycle === 'active'}
          reason={lifecycle === 'probation'
            && state.state_reason
            && !/^Application approved/i.test(state.state_reason)
            ? state.state_reason
            : null}
        />
      )}
  
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6 space-y-4">
        <div>
          <h3 className="font-bold text-slate-900">Documents you need</h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {requiredDocs.length > 0
              ? `${requiredDocs.length} required, up to 10 MB each.`
              : 'An admin reads these against what your profile claims.'}
          </p>
        </div>
  
        {requiredDocs.length === 0 && (
          <div className="flex items-start gap-2.5 rounded-xl bg-amber-50 border border-amber-200 p-3.5">
            <AlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-900">The required list did not load. Refresh and try again.</p>
          </div>
        )}
  
        <ol className="space-y-2.5">
          {requiredDocs.map((d, i) => {
            const file = latestFor(d.value);
            const sentBack = rejectedOpen.some(r => r.doc_type === d.value);
            const canUpload = !evidenceLocked && !d.done;
            return (
              <li key={d.value} className={`rounded-xl border p-4 ${
                d.done ? 'border-emerald-200 bg-emerald-50/40'
                  : sentBack ? 'border-red-200 bg-red-50/30'
                  : 'border-slate-200'}`}>
                <div className="flex items-start gap-3">
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
                    d.done ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    {d.done ? <Check size={13} strokeWidth={3} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold text-slate-900">{d.label}</p>
                      {file && <DocPill status={file.status} />}
                      {!file && <DocPill status="" />}
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {d.done ? (file?.original_name || 'Uploaded') : (d.help_text || 'Not uploaded yet')}
                    </p>
                  </div>
                  {file?.file_url && (
                    <a href={file.file_url} target="_blank" rel="noreferrer" aria-label="Preview"
                      className="p-2.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 shrink-0">
                      <ExternalLink size={15} />
                    </a>
                  )}
                  {file?.status === 'pending' && !evidenceLocked && (
                    <button type="button" onClick={() => confirmRemove(file)} disabled={busy}
                      aria-label="Remove document"
                      className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600 shrink-0">
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
                {canUpload && (
                  <div className="mt-3 sm:pl-10">
                    <FilePicker
                      key={`${d.value}-${docSeq}`}
                      disabled={busy}
                      label={`Upload your ${d.label.toLowerCase().replace(/^your /, "")}`}
                      onUpload={(file, opts) => uploadDoc(file, { ...opts, docType: d.value })}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
  
        {requiredDocs.length > 0 && !nextDoc && optionalTypes.length > 0 && !evidenceLocked && (
          <details className="rounded-xl border border-slate-200 p-3.5">
            <summary className="text-sm font-semibold text-slate-700 cursor-pointer">
              Add a supporting document
              <span className="font-normal text-slate-400"> (optional)</span>
            </summary>
            <div className="mt-3 space-y-3">
              <div>
                <label htmlFor="optional-doc-type" className="block text-xs font-semibold text-slate-600 mb-1">Document type</label>
                <FormSelect value={docType} onChange={(v) => setDocType(v || '')} clearable={false}
                            options={optionalTypes.map((t) => ({ value: t.value, label: t.label }))} />
              </div>
              <FilePicker
                key={`optional-${docSeq}`}
                label="Choose a file"
                onUpload={(file, opts) => uploadDoc(file, { ...opts, docType })}
              />
            </div>
          </details>
        )}
  
        {otherDocs.length > 0 && (
          <div className="pt-2">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-2">Other uploads</p>
            <div className="space-y-2">
              {otherDocs.map(d => (
                <div key={d.id} className="rounded-xl border border-slate-200">
                <div className="flex items-start gap-3 p-3">
                    <FileText size={16} className="text-slate-400 shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-slate-800 truncate">{labelFor(d.doc_type)}</p>
                        <DocPill status={d.status} />
                      </div>
                      <p className="text-xs text-slate-400 truncate">{d.original_name || ''}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                    {d.file_url && (
                      <a href={d.file_url} target="_blank" rel="noreferrer" aria-label="Preview"
                        className="p-2.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50">
                        <ExternalLink size={15} />
                      </a>
                    )}
                    {d.status === 'pending' && !evidenceLocked && (
                      <button type="button" onClick={() => confirmRemove(d)} disabled={busy}
                        aria-label="Remove document"
                        className="p-2 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600">
                        <Trash2 size={14} />
                      </button>
                    )}
                    </div>
                  </div>
                  {d.review_note && (
                    <p className={`px-3 pb-3 pl-11 text-xs ${
                      d.status === 'rejected' ? 'text-red-700' : 'text-slate-500'}`}>
                      <span className="font-semibold">Admin: </span>{d.review_note}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
  const profileCard = (
    <>
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-6">
        <ProfileReview onSaved={load} locked={status === 'approved'} />
      </div>
    </>
  );
  const fold = (
    <>
      {!stillBuilding && (
        <details className="group bg-white rounded-2xl border border-slate-200">
          <summary className="flex items-center gap-3 p-4 sm:px-6 cursor-pointer list-none">
            <span className="min-w-0 flex-1">
              <span className="block font-bold text-slate-900">Guidelines &amp; agreements</span>
              <span className="block text-xs text-slate-500 mt-0.5">What you read and accepted when you applied.</span>
            </span>
            <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
              acceptedN === agreements.length ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
              {acceptedN} of {agreements.length} accepted
            </span>
            <ChevronDown size={16} className="shrink-0 text-slate-400 transition-transform group-open:rotate-180" />
          </summary>
          <div className="px-4 pb-4 sm:px-6 sm:pb-6 space-y-6 [&>div]:border-0 [&>div]:p-0 [&>div]:bg-transparent [&>div]:pt-4 [&>div]:border-t [&>div]:border-slate-100 [&>div]:rounded-none">{readFirst}</div>
        </details>
      )}
    </>
  );
  const submitBar = (
    <>
      {stillBuilding && (
        <div className="bg-white border border-slate-200 rounded-2xl p-3 sm:p-4 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-3 shadow-sm"
             style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={submit} disabled={!can_submit || busy}
            className="w-full sm:w-auto min-h-11 flex items-center justify-center gap-2 px-6 py-2.5 text-white font-semibold rounded-xl text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: 'var(--accent)' }}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
            Submit for review
          </button>
          {!can_submit && (
            <p className="text-xs text-slate-500">
              Still needed: {(() => {
                // Every agreement mapped to the same literal, so four outstanding
                // ones read "an agreement, an agreement, an agreement, an agreement".
                // Counted instead: shorter on a 320px screen, and it stops reading
                // like a stutter.
                const agreements = missing.filter(m => m.startsWith('agreement:')).length;
                const rest = missing
                  .filter(m => !m.startsWith('agreement:'))
                  .map(m => m === 'linkedin_url' ? 'your LinkedIn URL'
                    : m.startsWith('document:') ? labelFor(m.slice(9)).toLowerCase()
                    : m.replace(/_/g, ' '));
                if (agreements) rest.push(agreements === 1 ? 'an agreement' : `${agreements} agreements`);
                return rest.join(', ');
              })()}.
            </p>
          )}
        </div>
      )}
    </>
  );

  return (
    // Full width, like the rest of the portal: the 1024px cap left a third of
    // a laptop screen empty. Long prose keeps its own max-w-prose where set.
    <div className="space-y-5">
      <h1 className="sr-only">Verification</h1>
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}

      {stillBuilding && readFirst}
      {statusCard}
      {work}
      {profileCard}
      {fold}
      {submitBar}
    </div>
  );
}
