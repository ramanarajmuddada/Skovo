import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import DatePicker from './ui/DatePicker';
import { Input, FormSelect, FormMultiSelect, Button } from './ui/index.jsx';
import { ageFrom, todayIso, yearsAgoIso } from './ui/dateUtils';
import {
  registrableCategories, targetExamRows, careerInterestRows, pruneSelections,
  yearOptionsFor, boardsForStage,
} from '../config/educationPathways';
import {
  BookOpen, Wrench, Building2, Briefcase, GraduationCap, FlaskConical, Shield,
  Target, Award, Calculator, RefreshCw, Coffee, ChevronRight, ArrowLeft, Check,
  Search, Cake, ShieldCheck, Mail, Lock, Clock, Compass, Loader2,
  Plus,
} from 'lucide-react';

/**
 * Student onboarding — three screens, every list from the database.
 *
 *   1. Where you are   — stage · state · date of birth (the DPDP gate)
 *   2. What you study  — board/stream for school, a searchable course for
 *                        college, exam for aspirants. Options rewrite by state.
 *   3. Where you're going — target exams, interests, target states/cities,
 *                        admission year, reservation category.
 *
 * Screen 3 is the point of the whole thing: SKOVO is a guidance product, so the
 * payload is the aspiration, not just the present. Current state and target
 * state are deliberately separate — a Hyderabad student aiming for Chennai needs
 * Tamil Nadu cutoffs and Telangana scholarships at the same time.
 *
 * No option list is hardcoded here. Categories, exams, interests, industries and
 * years come from `masters`; states, cities, boards, streams and courses come
 * from their own tables. The old copies of those lists in this file were the
 * reason a cohort targeted at "Mass Comm" could never reach a student who had
 * picked "Mass Comm & Journalism".
 */

// Icon and colour are presentation, so they stay in code — keyed by the value
// the masters row carries. Anything new an admin adds still renders, with the
// default look.
const CATEGORY_STYLE = {
  school_10th:         { icon: BookOpen,      color: '#22c55e' },
  school_11th:         { icon: BookOpen,      color: '#0ea5e9' },
  school_12th:         { icon: BookOpen,      color: '#8b5cf6' },
  iti:                 { icon: Wrench,        color: '#f59e0b' },
  polytechnic:         { icon: Building2,     color: '#f97316' },
  ug:                  { icon: GraduationCap, color: '#10b981' },
  professional_course: { icon: Calculator,    color: '#14b8a6' },
  pg:                  { icon: Award,         color: '#6366f1' },
  phd:                 { icon: FlaskConical,  color: '#a855f7' },
  working:             { icon: Briefcase,     color: '#f43f5e' },
  govt_exam:           { icon: Shield,        color: '#3b82f6' },
  entrance_exam:       { icon: Target,        color: '#ec4899' },
  dropper:             { icon: RefreshCw,     color: '#ef4444' },
  gap_year:            { icon: Coffee,        color: '#64748b' },
};
const DEFAULT_STYLE = { icon: GraduationCap, color: '#6366f1' };

// Which screen-2 shape a stage gets, and which lookups it needs.
const SCHOOL_STAGES  = ['school_10th', 'school_11th', 'school_12th'];
const COURSE_LEVEL   = {                       // stage → course_catalogue level
  iti: 'iti', polytechnic: 'diploma', ug: 'ug', pg: 'pg',
  professional_course: 'professional', phd: 'phd',
};
const YEAR_TYPE = {                            // stage → masters type for "year"
  iti: 'year_iti', polytechnic: 'year_diploma', ug: 'year_ug', pg: 'year_pg',
  phd: 'year_phd', professional_course: 'year_professional',
};
const EXAM_STAGES = { govt_exam: 'govt_exam', entrance_exam: 'entrance_exam', dropper: 'entrance_exam' };

// Which exams and career interests each stage sees now lives in one place —
// src/config/educationPathways.js — because the same policy has to hold in
// onboarding, in the Profile editor and on the server.

const MASTER_TYPES = [
  'onboarding_category', 'govt_exam', 'entrance_exam', 'career_interest',
  'career_goal_school', 'career_goal_college', 'gender',
  'industry', 'experience_range', 'prep_stage', 'category',
  'year_iti', 'year_diploma', 'year_ug', 'year_pg', 'year_phd', 'year_professional',
].join(',');

const MIN_DOB          = yearsAgoIso(100);
const DOB_DEFAULT_VIEW = yearsAgoIso(18);

/* ── Small building blocks ─────────────────────────────────────────────────── */

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-all ${
        active ? 'chip-active'
               : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'
      }`}>
      {active && <Check size={10} className="inline mr-1" />}{label}
    </button>
  );
}

/** Single-select chips. `options` is [{value, label}]. */
function ChipGrid({ options, value, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => (
        <Chip key={o.value} label={o.label} active={value === o.value}
              onClick={() => onChange(value === o.value ? '' : o.value)} />
      ))}
    </div>
  );
}

function MultiChips({ options, values, onChange, max = 3 }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map(o => {
        const on = values.includes(o.value);
        return (
          <Chip key={o.value} label={o.label} active={on}
                // Functional update: two quick taps both count.
                onClick={() => onChange(cur => (cur.includes(o.value) ? cur.filter(v => v !== o.value)
                  : cur.length >= max ? cur : [...cur, o.value]))} />
        );
      })}
    </div>
  );
}

function Label({ children, hint, required }) {
  return (
    <p className="text-xs font-semibold text-slate-600 mb-1.5">
      {children}{required && <span className="text-red-400"> *</span>}
      {hint && <span className="font-normal text-slate-400"> · {hint}</span>}
    </p>
  );
}

/* These two exist only so the call sites below can keep passing the value
   straight to a setter (`onChange={setPlace}`) instead of unwrapping an event.
   The look and behaviour come entirely from the shared controls. */
function Text({ label, value, onChange, placeholder, required, hint }) {
  return (
    <Input label={label} value={value} placeholder={placeholder} required={required} hint={hint}
           onChange={e => onChange(e.target.value)} />
  );
}

function Select(props) {
  return <FormSelect {...props} />;
}

/**
 * School / college picker: the platform dropdown over the list for the
 * student's state, and "+ Add" underneath for a name that is not listed yet
 * (same pattern as the achiever's "Add domain"). A typed name is kept as the
 * student's answer; admin can add it to the list later.
 */
function PlacePicker({ label, noun, placeholder, options, value, onChange }) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const listed = options.some(o => o.value === value);
  const all = value && !listed ? [{ value, label: value }, ...options] : options;
  const save = () => {
    const v = name.trim();
    if (v.length < 3) return;
    onChange(v); setAdding(false); setName('');
  };
  return (
    <div>
      <FormSelect label={label} required value={value} onChange={onChange} options={all}
                  placeholder={options.length ? placeholder : `No ${noun}s listed yet. Add yours below.`} />
      {!adding ? (
        <button type="button" onClick={() => setAdding(true)}
                className="mt-2 text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
          <Plus size={13} /> My {noun} is not listed
        </button>
      ) : (
        <div className="mt-2 flex flex-col sm:flex-row gap-2">
          <div className="flex-1 min-w-0">
            <Input value={name} onChange={e => setName(e.target.value)} autoFocus
                   placeholder={`Full ${noun} name`}
                   onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); save(); } }} />
          </div>
          <div className="grid grid-cols-2 sm:flex gap-2 shrink-0">
            <Button variant="secondary" onClick={() => { setAdding(false); setName(''); }}>Cancel</Button>
            <Button onClick={save} disabled={name.trim().length < 3}>Add</Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Type-ahead over a server endpoint. Students say "btech cse", not
 * Engineering → B.Tech → CSE, so the course question is one box instead of
 * three cascading dropdowns.
 */
function AsyncSearch({ label, required, hint, placeholder, value, onPick, fetcher, emptyText }) {
  const [q, setQ]         = useState('');
  const [rows, setRows]   = useState([]);
  const [open, setOpen]   = useState(false);
  const [busy, setBusy]   = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // Debounced so a fast typist doesn't fire a request per keystroke. The
    // spinner is turned on inside the timer, not in the effect body — a
    // synchronous setState here would re-render before the fetch even starts.
    const t = setTimeout(() => {
      if (!alive) return;
      setBusy(true);
      fetcher(q)
        .then(r => { if (alive) setRows(r); })
        .catch(() => { if (alive) setRows([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, fetcher]);

  return (
    <div>
      <Label required={required} hint={hint}>{label}</Label>
      {value ? (
        <div className="flex items-center gap-2 w-full field-picked border rounded-xl px-3 py-2.5">
          <Check size={14} className="text-accent shrink-0" />
          <span className="text-sm font-semibold text-slate-800 truncate">{value}</span>
          <button type="button" onClick={() => { onPick(null); setQ(''); setOpen(true); }}
                  className="ml-auto text-xs font-semibold text-slate-400 hover:text-slate-600">Change</button>
        </div>
      ) : (
        <div className="relative">
          <Input
            icon={<Search size={15} />}
            rightIcon={busy ? <Loader2 size={14} className="animate-spin text-slate-400" /> : null}
            value={q} placeholder={placeholder}
            onChange={e => { setQ(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)} />
          {open && (
            <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
              {rows.length === 0 && !busy && (
                <p className="px-3 py-2.5 text-xs text-slate-400">{emptyText || 'No matches — try a shorter word.'}</p>
              )}
              {rows.map(r => (
                <button key={r.key} type="button"
                        onClick={() => { onPick(r); setOpen(false); setQ(''); }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  {r.label}
                  {r.sub && <span className="block text-[11px] text-slate-400">{r.sub}</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One-question card, used by every consent outcome. Module scope on purpose —
 *  declared inside the component it would remount on each keystroke. */
function ConsentPanel({ Icon, tone, title, desc, error, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mx-auto ${tone}`}>
          <Icon size={26} />
        </div>
        <h2 className="text-xl font-bold text-slate-900 text-center mt-5">{title}</h2>
        <p className="text-sm text-slate-500 text-center mt-2 leading-relaxed">{desc}</p>
        {children}
        {error && <p className="text-sm text-red-600 mt-3 text-center">{error}</p>}
      </div>
    </div>
  );
}

const phaseFor = (status) => (
  status === 'blocked' ? 'blocked'
    : status === 'awaiting_parent' ? 'parent'
      : status && status !== 'granted' ? 'flow'
        : 'flow'
);

const opts = (rows) => (rows || []).map(r => ({ value: r.value, label: r.label }));


/* ── Main component ────────────────────────────────────────────────────────── */

export default function OnboardingModal({
  consentStatus = 'granted',
  needsProfile = true,
  onConsentChange = () => {},
}) {
  const { user, updateUser } = useAuth();

  const [screen, setScreen] = useState(1);
  const [phase,  setPhase]  = useState(() => phaseFor(consentStatus));
  const [busy,   setBusy]   = useState(false);
  const [error,  setError]  = useState('');
  const [plan10, setPlan10] = useState('');
  const [goal,   setGoal]   = useState('');
  const [gender, setGender] = useState('');   // one goal card (masters: career_goal_school / career_goal_college)   // 10th: a group, 'plan:polytechnic', 'plan:iti' or 'plan:not_sure'
  const [done,   setDone]   = useState(false);

  const consentDone = consentStatus === 'granted';

  // ── Lookups, all from the API ──────────────────────────────────────────────
  const [masters, setMasters] = useState({});
  const [states,  setStates]  = useState([]);
  const [boards,  setBoards]  = useState([]);
  const [streams, setStreams] = useState([]);
  const [cities,  setCities]  = useState([]);
  // The student's own state CETs — EAPCET in Andhra, KCET in Karnataka. The
  // national list alone only ever worked for the JEE/NEET/CAT crowd.
  const [stateExams, setStateExams] = useState([]);

  // ── Screen 1 ───────────────────────────────────────────────────────────────
  const [cat,     setCat]     = useState('');
  const [stateId, setStateId] = useState('');
  const [dob,     setDob]     = useState('');

  // ── Screen 2 ───────────────────────────────────────────────────────────────
  const [board,  setBoard]  = useState('');          // board code
  const [stream, setStream] = useState('');          // canonical value
  const [course, setCourse] = useState(null);        // course_catalogue row
  const [year,   setYear]   = useState('');
  const [place,  setPlace]  = useState('');          // school / college / institute
  const [city,   setCity]   = useState('');
  const [exam,   setExam]   = useState('');
  const [prep,   setPrep]   = useState('');
  const [industry,   setIndustry]   = useState('');
  const [experience, setExperience] = useState('');
  const [role,       setRole]       = useState('');

  // ── Screen 3 ───────────────────────────────────────────────────────────────
  const [targetExams,   setTargetExams]   = useState([]);
  const [interests,     setInterests]     = useState([]);
  const [reservation] = useState('');   // asked on My Profile now, not at sign-up

  // ── Parent consent (14–17) ─────────────────────────────────────────────────
  const [parentEmail, setParentEmail] = useState('');
  const [parentName,  setParentName]  = useState('');

  const stateName = states.find(s => s.id === stateId)?.name || '';
  const style     = CATEGORY_STYLE[cat] || DEFAULT_STYLE;
  const catLabel  = (masters.onboarding_category || []).find(c => c.value === cat)?.label?.split('|')[0] || '';

  // Every screen-2 answer belongs to exactly one stage: a trade to ITI, a board
  // and stream to school, an exam to a dropper. Carrying them across a stage
  // change is how a student who filled in ITI, went Back and picked something
  // else still saw their ITI trade in the form -- and still submitted it, since
  // save() gated only some of these by stage. Cleared in the handler rather
  // than through an effect on `cat`, the same way the state picker clears
  // everything downstream of it, so no render ever shows a stale answer.
  // `city` is not stage-scoped -- it hangs off the state picked on screen 1 --
  // and screen 3 prunes rather than clears (see pickedExams below).
  const pickCategory = (value) => {
    if (value === cat) return;
    setCat(value);
    setBoard(''); setStream(''); setStreams([]);
    setCourse(null); setYear(''); setPlace('');
    setExam(''); setPrep('');
    setIndustry(''); setExperience(''); setRole('');
  };

  const isSchool = SCHOOL_STAGES.includes(cat);
  const courseLevel = COURSE_LEVEL[cat];
  const examType    = EXAM_STAGES[cat];
  const isWorking   = cat === 'working';
  const isGapYear   = cat === 'gap_year';

  // Both lists are scoped to the stage the student picked on screen 1. The
  // state CETs used to be concatenated in unfiltered, which is how a B.Tech
  // student ended up being offered AP POLYCET and AP DEECET.
  const allowedExamRows = targetExamRows(cat, {
    national: masters.entrance_exam, state: stateExams, govt: masters.govt_exam,
  });
  const allowedInterestRows = careerInterestRows(cat, masters.career_interest);

  // Changing stage rewrites both screen-3 lists, so a pick made under the old
  // stage may no longer be on offer. Pruned on the way out rather than cleared
  // on stage change: a student who corrects 11th → 12th keeps the JEE they
  // already chose, and one who switches to PG silently loses only the picks
  // that stopped applying. Derived rather than synced through an effect, so
  // there is no render in which an invalid value is displayed or submitted.
  // FormMultiSelect builds its next value from what it is handed, so the pruned
  // list is also what a click commits back to state.
  const pickedExams     = pruneSelections(targetExams, allowedExamRows);
  const pickedInterests = pruneSelections(interests, allowedInterestRows);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/auth/masters?types=${MASTER_TYPES}`).catch(() => ({ data: {} })),
      api.get('/auth/states').catch(() => ({ data: {} })),
    ]).then(([m, s]) => {
      if (!alive) return;
      setMasters(m.data?.response?.grouped || {});
      setStates(s.data?.response?.states || []);
    });
    return () => { alive = false; };
  }, []);

  // Board and city lists follow the state — this is what makes the flow work
  // outside one state: pick Telangana and the board list is TSBIE + national.
  // Clearing the old lists happens in the state picker's handler, not here, so
  // this effect only ever fetches.
  useEffect(() => {
    if (!stateId) return;
    let alive = true;
    Promise.all([
      api.get(`/auth/boards?state_id=${stateId}`).catch(() => ({ data: {} })),
      api.get(`/auth/cities?state_id=${stateId}`).catch(() => ({ data: {} })),
    ]).then(([b, c]) => {
      if (!alive) return;
      setBoards(b.data?.response?.boards || []);
      setCities(c.data?.response?.cities || []);
    });
    return () => { alive = false; };
  }, [stateId]);

  // State CETs follow the state, the same way boards and cities do.
  useEffect(() => {
    const code = states.find(s => s.id === stateId)?.code;
    if (!code) return;
    let alive = true;
    api.get(`/auth/masters?types=entrance_exam_${code}`)
      .then(({ data }) => {
        if (!alive) return;
        setStateExams(data?.response?.grouped?.[`entrance_exam_${code}`] || []);
      })
      .catch(() => { if (alive) setStateExams([]); });
    return () => { alive = false; };
  }, [stateId, states]);

  // Streams follow the board — MPC/BiPC in Telangana, PCM/PCB in CBSE, both
  // stored as the same canonical value.
  useEffect(() => {
    if (!board) return;
    let alive = true;
    api.get(`/auth/streams?board_code=${encodeURIComponent(board)}`)
      .then(({ data }) => { if (alive) setStreams(data?.response?.streams || []); })
      .catch(() => { if (alive) setStreams([]); });
    return () => { alive = false; };
  }, [board]);

  // College: picked from the colleges list so every student of one college is
  // saved under the same name (campus leaderboards group on it). A college that
  // is not in the list yet can still be typed: the last row offers the typed name.
  // Schools / colleges in the student's state, for the picker on screen 2.
  const [placeOptions, setPlaceOptions] = useState([]);
  useEffect(() => {
    if (!stateName) return undefined;
    let alive = true;
    api.get('/colleges/', { state: stateName, per_page: 100 })
      .then(({ data }) => {
        if (!alive) return;
        setPlaceOptions((data?.response?.colleges || []).map(c => ({
          value: c.name,
          label: [c.name, c.location_city || c.city].filter(Boolean).join(', '),
        })));
      })
      .catch(() => { if (alive) setPlaceOptions([]); });
    return () => { alive = false; };
  }, [stateName]);

  const searchCourses = useCallback((q) =>
    api.get(`/auth/courses/search?q=${encodeURIComponent(q)}&level=${courseLevel}&limit=12`)
      .then(({ data }) => (data?.response?.courses || []).map(c => ({
        key: c.id, label: c.display_name, sub: c.degree_category, row: c,
      }))), [courseLevel]);


  /* ── Validation — only the fields that break a feature are required ──────── */
  // Profile already there, only the date of birth missing: ask just for that.
  const dobOnly = !needsProfile && !consentDone;
  const screen1Ready = dobOnly ? Boolean(dob) : Boolean(cat && stateId && (consentDone || dob));
  const screen2Ready = Boolean(stateId) && (() => {
    if (isGapYear) return Boolean(city);
    if (isSchool)  return Boolean(board && city && place && (cat === 'school_10th' || stream));
    if (courseLevel) return Boolean(course && year && city && place);
    if (examType)  return Boolean(exam && prep && city);
    if (isWorking) return Boolean(industry && experience && city);
    return Boolean(city);
  })() && (consentDone || Boolean(dob)) && Boolean(gender);
  const isCollegeGoal = ['ug', 'pg', 'phd', 'professional_course', 'working'].includes(cat);
  const goalRows = (isCollegeGoal ? masters.career_goal_college : masters.career_goal_school) || [];
  const notSure = plan10 === 'plan:not_sure' || /not decided|not sure/i.test(goal);
  const showExams = allowedExamRows.length > 0 && !notSure && !isCollegeGoal && !examType
    && (cat === 'school_10th' ? Boolean(plan10) : Boolean(goal) && !/^other$/i.test(goal));

  /* ── Consent ─────────────────────────────────────────────────────────────── */
  async function submitDob() {
    const { data } = await api.post('/auth/consent/dob', { date_of_birth: dob });
    // No age gate and no parental-consent step. There used to be two exits
    // here -- under-14 to a dead-end 'blocked' screen, 14-17 to 'parent' -- and
    // the server can no longer return either, so a date of birth is recorded
    // and onboarding simply carries on.
    if (data.bool) {
      onConsentChange('granted');
      return true;
    }
    setError(data.response?.message || 'Please check your date of birth.');
    return false;
  }

  async function submitParent() {
    if (busy || !parentEmail.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/consent/parent', {
        parent_email: parentEmail.trim(), parent_name: parentName.trim(),
      });
      if (data.bool) setPhase('waiting');
      else setError(data.response?.message || 'Please enter a valid parent email.');
    } catch { setError('Something went wrong. Please try again.'); }
    finally { setBusy(false); }
  }

  // The parent confirms on their own device, with no way to notify this tab
  // directly — so while we're parked on "Waiting for a parent", poll the
  // account's own consent status every few seconds and leave the screen the
  // moment it flips to granted. Without this, the panel sat there forever no
  // matter how fast the parent clicked, because nothing ever re-checked.
  useEffect(() => {
    if (phase !== 'waiting') return;
    let alive = true;
    const tick = () => {
      api.get('/auth/consent/status')
        .then(({ data }) => {
          if (!alive || !data.bool) return;
          if (data.response.consent_status === 'granted') {
            onConsentChange('granted');
            setPhase('flow');
          }
        })
        .catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, [phase]);

  /* ── Navigation ──────────────────────────────────────────────────────────── */
  async function next() {
    if (busy) return;
    setError('');
    if (screen === 1) {
      // Date of birth is a field here, not its own screen — but the age gate is
      // unchanged: the server decides, and a minor still cannot get past it.
      if (dobOnly) {
        setBusy(true);
        try {
          const ok = await submitDob();
          if (!ok) return;
        } catch { setError('Something went wrong. Please try again.'); return; }
        finally { setBusy(false); }
      }
      if (dobOnly) return;   // nothing else to ask; the layout closes this
      setScreen(2);
      return;
    }
    // Two screens: screen 2 saves.
    await save();
  }

  async function save() {
    setBusy(true); setError('');
    try {
      if (!consentDone) {
        const ok = await submitDob();
        if (!ok) { setBusy(false); return; }
      }
      const planStream = cat === 'school_10th' ? (plan10 && !plan10.startsWith('plan:') ? plan10 : '') : stream;
      const profile = {
        education_category: cat,
        state: stateName,
        city,
        board:  isSchool ? board : undefined,
        stream: isSchool ? planStream : undefined,
        school_name: isSchool ? place : undefined,
        degree_category: course?.degree_category,
        degree_type:     course?.degree,
        branch:          course?.branch || (cat === 'iti' ? course?.branch : undefined),
        iti_trade:       cat === 'iti' ? course?.branch : undefined,
        professional_course_type:  cat === 'professional_course' ? course?.degree : undefined,
        professional_course_level: cat === 'professional_course' ? course?.branch : undefined,
        college_name: !isSchool ? place : undefined,
        year_of_study: courseLevel ? year : examType ? prep : undefined,
        exam_target: examType ? exam : undefined,
        working_industry:   isWorking ? industry   : undefined,
        working_experience: isWorking ? experience : undefined,
        working_role:       isWorking ? role       : undefined,
        career_interests: pickedInterests,
        gender,
      };
      Object.keys(profile).forEach(k => {
        if (profile[k] === undefined || profile[k] === '') delete profile[k];
      });

      const { data } = await api.patch('/profile/', profile);
      if (!data.bool) throw new Error(data.response?.message || 'Failed to save');

      // The aspiration half lives in its own table — it is multi-valued.
      await api.put('/profile/goals', {
        target_exams:   showExams ? pickedExams : [],
        target_courses: [
          ...(course ? [course.display_name] : []),
          ...(plan10 === 'plan:polytechnic' ? ['Polytechnic Diploma'] : plan10 === 'plan:iti' ? ['ITI']
            : plan10 === 'plan:not_sure' ? ['Not decided yet'] : []),
          ...(goal ? [goal] : []),
        ],
        reservation_category: reservation || undefined,
      }).catch(() => { /* goals are enrichment — never block entry on them */ });

      setDone(true); setBusy(false);
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setBusy(false);
    }
  }

  /* ── Consent outcome panels ──────────────────────────────────────────────── */
  if (phase === 'blocked') return (
    <ConsentPanel Icon={Lock} tone="bg-red-50 text-red-600" title="You need to be 14 or older"
      desc="Skovo is built for students aged 14 and above. Please come back when you are old enough — we will be here." />
  );

  if (phase === 'waiting') return (
    <ConsentPanel Icon={Clock} tone="bg-amber-50 text-amber-600" title="Waiting for a parent"
      desc={`We have emailed ${parentEmail || 'your parent or guardian'} to confirm your account. As soon as they click the link, your Skovo account unlocks.`}>
      <button onClick={() => { setPhase('parent'); setError(''); }}
              className="mt-5 w-full py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700 transition-colors">
        Sent to the wrong email? Resend →
      </button>
    </ConsentPanel>
  );

  if (phase === 'parent') return (
    <ConsentPanel Icon={Mail} tone="bg-blue-50 text-blue-600" title="A parent needs to confirm" error={error}
      desc="Because you are under 18, we need a parent or guardian's consent (required by law) before your account activates.">
      <div className="mt-6 space-y-3">
        <input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)}
               placeholder="Parent / guardian email"
               className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none" />
        <input value={parentName} onChange={e => setParentName(e.target.value)}
               placeholder="Parent / guardian name (optional)"
               className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm outline-none" />
      </div>
      <button onClick={submitParent} disabled={busy || !parentEmail.trim()}
              className="mt-5 w-full py-3.5 rounded-2xl font-bold text-white text-sm disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
        {busy ? 'Sending…' : 'Send consent request'}
      </button>
    </ConsentPanel>
  );

  if (done) {
    const first = (user?.full_name || user?.name || '').trim().split(' ')[0];
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-2 sm:p-4">
        <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-4 flex items-center justify-center bg-emerald-50 text-emerald-600">
            <Check size={26} />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Welcome{first ? `, ${first}` : ''}!</h2>
          <p className="text-sm text-slate-600 mb-1">Your profile is ready{catLabel ? ` (${catLabel})` : ''}.</p>
          <p className="text-sm text-slate-500 mb-6">
            Your first task is waiting on the dashboard: set your goal and earn your first readiness points.
          </p>
          <Button className="w-full" onClick={() => updateUser({ education_category: cat, education_level: cat })}>
            Go to my dashboard
          </Button>
        </div>
      </div>
    );
  }

  if (consentDone && !needsProfile) return null;

  /* ── The flow ────────────────────────────────────────────────────────────── */
  const HEADINGS = {
    1: ['Welcome to SKOVO!', 'What are you doing right now? Tap one.'],
    2: ['Where do you study?',  'This decides which cohorts, colleges and mentors you see.'],
    3: ['About you and your goal', 'Almost done. You can change all of this later.'],
  };
  const [title, subtitle] = dobOnly
    ? ['One quick thing', 'Add your date of birth to finish your profile.']
    : HEADINGS[screen];
  const age = ageFrom(dob);
  const stateField = (
    <Select label="State" required value={stateId}
                        placeholder="Select your state"
                        onChange={v => {
                          // Everything downstream of the state is now stale.
                          setStateId(v);
                          setBoards([]); setCities([]); setStreams([]);
                          setBoard(''); setStream(''); setCity('');
                        }}
                        options={states.map(s => ({ value: s.id, label: s.name }))} />
  );
  const dobField = (
    <div>
                    <Label required>Date of birth</Label>
                    <DatePicker value={dob} onChange={setDob} min={MIN_DOB} max={todayIso()}
                                defaultView={DOB_DEFAULT_VIEW} />
                    {age !== null && (
                      <p className="text-[11px] text-slate-400 mt-1.5">
                        You are {age}.
                      </p>
                    )}
                  </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-2 sm:p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl flex flex-col max-h-[92vh]">

        <div className="text-center px-4 sm:px-8 pt-5 sm:pt-7 pb-4 shrink-0">
          <div className="w-12 h-12 rounded-2xl mx-auto mb-3 shadow-lg overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
          <h2 className="text-xl font-bold text-slate-900 mb-1">{title}</h2>
          <p className="text-slate-500 text-sm">{subtitle}</p>
        </div>

        <div className={`items-center gap-2 px-4 sm:px-8 mb-4 shrink-0 ${dobOnly ? 'hidden' : 'flex'}`}>
          {[1, 2].map(s => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-all ${s <= screen ? '' : 'bg-slate-200'}`}
                 style={s <= screen ? { backgroundColor: 'var(--accent, #4f46e5)' } : undefined} />
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-8 pb-2 space-y-5">

          {/* ── Screen 1 — stage · state · date of birth ── */}
          {screen === 1 && (
            <>
              <div className={`grid-cols-2 gap-2.5 ${dobOnly ? 'hidden' : 'grid'}`}>
                {registrableCategories(masters.onboarding_category).map(({ value, label }) => {
                  const [name, rawSub = ''] = String(label || '').split('|');
                  // The list text ends some lines with "…", which reads as cut-off text.
                  const sub = rawSub.replace(/\s*(…|\.\.\.)/g, ' and more');
                  const { icon: Icon, color } = CATEGORY_STYLE[value] || DEFAULT_STYLE;
                  const sel = cat === value;
                  return (
                    <button key={value} onClick={() => { pickCategory(value); if (!dobOnly) { setError(''); setScreen(2); } }}
                      aria-pressed={sel}
                      className={`text-left p-3 sm:p-3.5 rounded-2xl border-2 transition-all cursor-pointer min-h-11 last:odd:col-span-2 ${sel ? '' : 'border-slate-200 bg-slate-50 hover:border-slate-300'}`}
                      style={sel ? { borderColor: color, backgroundColor: `${color}14` } : undefined}>
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${sel ? '' : 'bg-slate-100 text-slate-500'}`}
                           style={sel ? { backgroundColor: `${color}20`, color } : undefined}>
                        <Icon size={16} />
                      </div>
                      <p className={`text-sm font-semibold leading-tight ${sel ? '' : 'text-slate-800'}`} style={sel ? { color } : undefined}>{name}</p>
                      <p className="text-[11px] mt-0.5 leading-snug text-slate-400">{sub}</p>
                    </button>
                  );
                })}
              </div>

              {dobOnly && <div className="pt-1">{dobField}</div>}
            </>
          )}

          {/* ── Screen 2 — what you study (options follow the state) ── */}
          {screen === 2 && (
            <>
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-bold w-fit"
                   style={{ backgroundColor: `${style.color}14`, color: style.color }}>
                <style.icon size={13} /> {catLabel}
                {stateName && <span className="font-normal opacity-70">· {stateName}</span>}
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                {stateField}
                <Select label="City" required value={city} onChange={setCity}
                        placeholder={stateId ? 'Select your city' : 'Pick your state first'}
                        options={cities.map(c => ({ value: c.name, label: c.name }))} />
              </div>

              {isSchool && (
                <>
                  <div>
                    <Label required hint="decides your subject group names">Board</Label>
                    <ChipGrid options={boardsForStage(boards, cat).map(b => ({ value: b.code, label: b.name.split('—')[0].trim() }))}
                              value={board} onChange={v => { setBoard(v); setStream(''); setStreams([]); }} />
                  </div>
                  {board && cat !== 'school_10th' && (
                    <div>
                      <Label required>Your group / stream</Label>
                      <ChipGrid options={streams.map(s => ({ value: s.canonical, label: s.short_label }))}
                                value={stream} onChange={setStream} />
                    </div>
                  )}
                  <PlacePicker
                    label={cat === 'school_10th' ? 'School' : 'School / junior college'}
                    noun="school"
                    placeholder="Select your school"
                    options={placeOptions} value={place} onChange={setPlace} />
                </>
              )}

              {courseLevel && (
                <>
                  <AsyncSearch
                    label="What are you studying?" required
                    hint="type it the way you say it"
                    placeholder={{ iti: 'e.g. electrician, fitter', polytechnic: 'e.g. diploma mechanical, diploma cse', pg: 'e.g. mba finance, mtech cse', phd: 'e.g. phd chemistry' }[cat] || 'e.g. btech cse, bsc, bcom, mbbs'}
                    value={course?.display_name}
                    onPick={r => {
                      const row = r ? r.row : null;
                      setCourse(row);
                      // Switching from a 5-year course to a 3-year one must not
                      // leave "5th Year" selected and invisible. Cleared only
                      // when the new course genuinely cannot hold it — picking
                      // a longer course keeps the answer already given.
                      const next = yearOptionsFor(opts(masters[YEAR_TYPE[cat]]),
                                                  row?.duration_years);
                      if (year && !next.some(o => o.value === year)) setYear('');
                    }}
                    fetcher={searchCourses}
                    emptyText="No match — try just the degree, e.g. “btech”." />
                  <div className="grid grid-cols-2 gap-3">
                    <Select label="Year" required value={year} onChange={setYear}
                            options={yearOptionsFor(opts(masters[YEAR_TYPE[cat]]),
                                                    course?.duration_years, year)}
                            placeholder="Which year are you in?" />
                    <PlacePicker
                      label="College / institute"
                      noun="college"
                      placeholder="Select your college"
                      options={placeOptions} value={place} onChange={setPlace} />
                  </div>
                </>
              )}

              {examType && (
                <>
                  <div>
                    <Label required>Which exam are you preparing for?</Label>
                    <ChipGrid
                      options={examType === 'entrance_exam'
                        ? [...opts(stateExams), ...opts(masters.entrance_exam)]
                        : opts(masters[examType])}
                      value={exam} onChange={setExam} />
                  </div>
                  <div>
                    <Label required>Where are you in your preparation?</Label>
                    <ChipGrid options={opts(masters.prep_stage)} value={prep} onChange={setPrep} />
                  </div>
                  <Text label="Coaching institute (optional)" value={place} onChange={setPlace}
                        placeholder="e.g. Allen, Unacademy" />
                </>
              )}

              {isWorking && (
                <>
                  <div>
                    <Label required>Industry</Label>
                    <ChipGrid options={opts(masters.industry)} value={industry} onChange={setIndustry} />
                  </div>
                  <div>
                    <Label required>Experience</Label>
                    <ChipGrid options={opts(masters.experience_range)} value={experience} onChange={setExperience} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Text label="Current role (optional)" value={role} onChange={setRole}
                          placeholder="e.g. Software Engineer" />
                    <Text label="Company (optional)" value={place} onChange={setPlace} placeholder="e.g. Infosys" />
                  </div>
                </>
              )}

              {/* About you: the last two answers before Finish. */}
              <div className="grid sm:grid-cols-2 gap-4">
                {!consentDone && dobField}
                <Select label="Gender" required hint="not shown publicly" value={gender} onChange={setGender}
                        placeholder="Select gender"
                        options={opts((masters.gender || []).filter(g => g.value !== 'all'))} />
              </div>
            </>
          )}

          {/* ── Screen 3 — not used any more: the goal is the first Dashboard task ── */}
          {screen === 3 && (
            <>

              {/* 1 · The goal: one tap. 10th picks what comes after 10th; the
                  other stages pick from the goal lists admin edits in Masters. */}
              {cat === 'school_10th' ? (
                <div>
                  <Label required>What do you plan after 10th?</Label>
                  <ChipGrid
                    options={[
                      ...streams.map(st => ({ value: st.canonical, label: `Inter ${st.short_label}` })),
                      { value: 'plan:polytechnic', label: 'Polytechnic Diploma' },
                      { value: 'plan:iti', label: 'ITI' },
                      { value: 'plan:not_sure', label: 'Not sure yet' },
                    ]}
                    value={plan10} onChange={setPlan10} />
                </div>
              ) : !examType && goalRows.length > 0 && (
                <div>
                  <Label required>{isCollegeGoal ? 'What do you want to become?' : 'What do you want to do next?'}</Label>
                  <ChipGrid options={opts(goalRows)} value={goal} onChange={setGoal} />
                </div>
              )}

              {/* 2 · Follow-up: which exams, only when the goal needs one. */}
              {showExams && (
                <div>
                  <Label hint="optional, up to 3">Which exams?</Label>
                  <MultiChips options={opts(allowedExamRows).slice(0, 12)} values={pickedExams}
                              onChange={setTargetExams} max={3} />
                </div>
              )}

              {notSure && (
                <p className="text-sm rounded-xl px-3 py-2.5 bg-slate-50 text-slate-600 border border-slate-200">
                  No problem. We will help you decide: your first step is a short interest check.
                </p>
              )}

              {/* 3 · Interests: taps, not a search box. */}
              {allowedInterestRows.length > 0 && (
                <div>
                  <Label hint="optional, up to 3">What do you enjoy?</Label>
                  <MultiChips options={opts(allowedInterestRows).slice(0, 12)} values={pickedInterests}
                              onChange={setInterests} max={3} />
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-8 pb-5 sm:pb-7 pt-4 shrink-0">
          {error && <p className="text-red-500 text-xs mb-3 text-center">{error}</p>}
          <button
            hidden={screen === 1 && !dobOnly}
            onClick={next}
            disabled={busy || (screen === 1 ? !screen1Ready : !screen2Ready)}
            className="w-full py-3.5 rounded-2xl font-bold text-white text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2"
            style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', boxShadow: '0 4px 20px rgba(99,102,241,0.35)' }}>
            {busy ? 'Saving…' : dobOnly ? 'Save' : screen === 2 ? 'Finish' : <>Next <ChevronRight size={16} /></>}
          </button>
          {screen > 1 && (
            <button onClick={() => { setScreen(screen - 1); setError(''); }} disabled={busy}
                    className="w-full py-2.5 mt-2 rounded-2xl text-sm font-semibold text-slate-500 hover:text-slate-700 flex items-center justify-center gap-1.5 transition-colors">
              <ArrowLeft size={14} /> Back
            </button>
          )}
          <p className="text-center text-[11px] text-slate-400 mt-3 flex items-center justify-center gap-1">
            <><Cake size={11} className="opacity-0 w-0" />You can update all of this any time from your Profile.</>
          </p>
        </div>
      </div>
    </div>
  );
}
