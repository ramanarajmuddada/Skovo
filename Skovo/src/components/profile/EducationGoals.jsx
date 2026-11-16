import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../../services/api';
import { Card, Input, FormSelect, FormMultiSelect, FieldLabel } from '../ui/index.jsx';
import { useAuth } from '../../context/AuthContext';
import {
  registrableCategories, yearOptionsFor, isStudentPathComplete, boardsForStage,
} from '../../config/educationPathways';
import {
  GraduationCap, Target, Edit3, Check, X, AlertTriangle, Search, Loader2, Compass,
} from 'lucide-react';

/**
 * The two profile cards that mirror onboarding: what you study, and where you
 * want to go. Every option comes from the same endpoints the onboarding modal
 * uses, so the promise "you can change this later in Profile" is actually true —
 * the old page looked up `stream_*` / `year_*` master types that never existed,
 * so its Stream and Year dropdowns silently never rendered.
 *
 * Nothing is write-once. Picking the wrong stage is the most common onboarding
 * mistake there is, so changing it is a supported action with an explicit
 * warning about which fields stop applying.
 */

const SCHOOL_STAGES = ['school_10th', 'school_11th', 'school_12th'];
const PLAN_10 = [
  { value: 'plan:polytechnic', label: 'Polytechnic Diploma', goal: 'Polytechnic Diploma' },
  { value: 'plan:iti',         label: 'ITI',                 goal: 'ITI' },
  { value: 'plan:not_sure',    label: 'Not sure yet',        goal: 'Not decided yet' },
];
const PLAN_GOALS = PLAN_10.map(p => p.goal);
const COURSE_LEVEL  = { iti: 'iti', polytechnic: 'diploma', ug: 'ug', pg: 'pg',
                        professional_course: 'professional', phd: 'phd' };
// Keyed on catalogue level, not on stage, because that is what CourseSearch is
// given. Mirrors COURSE_PLACEHOLDER in OnboardingModal.jsx — a Diploma student
// must not be shown B.Tech and MBA examples their level can never return.
const COURSE_HINT   = { iti: 'e.g. electrician, fitter', diploma: 'e.g. cse, mechanical, ece',
                        ug: 'e.g. btech cse, bcom', pg: 'e.g. mtech, mba finance',
                        professional: 'e.g. ca, cs, cma', phd: 'e.g. phd computer science' };
const YEAR_TYPE     = { iti: 'year_iti', polytechnic: 'year_diploma', ug: 'year_ug',
                        pg: 'year_pg', phd: 'year_phd', professional_course: 'year_professional' };
const EXAM_TYPE     = { govt_exam: 'govt_exam', entrance_exam: 'entrance_exam', dropper: 'entrance_exam' };

// Mirrors OnboardingModal.jsx's TARGET_EXAM_TYPES — which exam master type(s)
// belong in "Preparing for" per stage, so the goals card doesn't offer UPSC to
// a 10th-grader or JEE to a working professional. Keep the two in sync.
const TARGET_EXAM_TYPES = {
  school_10th: ['entrance_exam'], school_11th: ['entrance_exam'], school_12th: ['entrance_exam'],
  iti: ['entrance_exam'], polytechnic: ['entrance_exam'],
  ug: ['entrance_exam'], professional_course: ['entrance_exam'],
  pg: ['govt_exam'], phd: ['govt_exam'],
  working: ['govt_exam'],
  govt_exam: ['govt_exam'], entrance_exam: ['entrance_exam'], dropper: ['entrance_exam'],
  gap_year: ['entrance_exam', 'govt_exam'],
};

// Mirrors OnboardingModal.jsx's EXAM_IDENTITY_STAGES / forStage — see there
// for why the two exam-identity stages skip the per-exam education_level tag.
const EXAM_IDENTITY_STAGES = ['govt_exam', 'entrance_exam'];
const forStage = (rows, stage) => (rows || []).filter(r =>
  !r.education_level || r.education_level.split(',').includes(stage));

const MASTER_TYPES = [
  'onboarding_category', 'govt_exam', 'entrance_exam', 'career_interest', 'category',
  'industry', 'experience_range', 'prep_stage',
  'year_iti', 'year_diploma', 'year_ug', 'year_pg', 'year_phd', 'year_professional',
].join(',');

const opts = (rows) => (rows || []).map(r => ({ value: r.value, label: r.label }));

/* Fields that stop meaning anything when the student moves between stages. */
function staleFields(from, to) {
  const wasSchool = SCHOOL_STAGES.includes(from);
  const isSchool  = SCHOOL_STAGES.includes(to);
  const out = [];
  if (wasSchool && !isSchool) out.push('board', 'group / stream', 'school name');
  if (!wasSchool && isSchool) out.push('course', 'branch', 'year of study', 'college name');
  if (!wasSchool && !isSchool && from !== to) out.push('course', 'branch', 'year of study');
  return out;
}

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`px-2.5 py-1.5 min-h-11 text-xs font-semibold rounded-lg border transition-all mo-press ${
        active ? 'chip-active'
               : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>
      {active && <Check size={10} className="inline mr-1" />}{label}
    </button>
  );
}

function Row({ label, value }) {
  if (!value) return null;
  return (
    <div className="py-3 border-b border-slate-100 pr-4">
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-slate-900">{value}</p>
    </div>
  );
}

/* Wrapper for the controls FormSelect doesn't cover — the chip groups and the
   course searcher. Uses the shared label so the required star matches. */
function Field({ label, children, required }) {
  return (
    <div>
      <FieldLabel required={required}>{label}</FieldLabel>
      {children}
    </div>
  );
}

// One page of course results — sized so one branch of every degree at a level
// fits. The search spreads across degrees before returning a second branch of
// any one, and 60 clears the widest level ('ug', 43 degrees).
const COURSE_PAGE = 60;

/** Rows into degree_category buckets, in the order the server first used each.
 *  Server order is relevance, then catalogue order, so it is kept as-is. */
function byCategory(rows) {
  const out = [];
  const seen = new Map();
  for (const c of rows) {
    const key = c.degree_category || '';
    if (!seen.has(key)) { const g = { category: key, items: [] }; seen.set(key, g); out.push(g); }
    seen.get(key).items.push(c);
  }
  return out;
}

function CourseSearch({ value, level, onPick }) {
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  // Results carry the level they were fetched for and are read back only while
  // that is still the level in play, so changing stage cannot leave another
  // level's courses on screen. Derived rather than cleared in an effect, so
  // there is no render in which the stale list is live.
  const [result, setResult] = useState({ level: null, rows: [] });
  const rows = result.level === level ? result.rows : [];

  useEffect(() => {
    if (!open || !level) return;
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      setBusy(true);
      // An empty query is how a student browses, so the page has to be big
      // enough to show the shape of the whole level. At 25 a UG list stopped
      // inside Engineering — a degree's branches are consecutive — so B.Sc,
      // B.Com, BBA, BA and BCA never appeared for anyone who did not already
      // know to type them.
      api.get(`/auth/courses/search?q=${encodeURIComponent(q)}`
              + `&level=${encodeURIComponent(level)}&limit=${COURSE_PAGE}`)
        .then(({ data }) => {
          // Drop anything off-level: the in-flight response for the previous
          // level can land after the student has already switched.
          const list = (data?.response?.courses || [])
            .filter(c => !c.level || c.level === level);
          if (alive) setResult({ level, rows: list });
        })
        .catch(() => { if (alive) setResult({ level, rows: [] }); })
        .finally(() => { if (alive) setBusy(false); });
    }, 180);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, level]);

  if (value) {
    return (
      <div className="field-picked flex items-center gap-2 border rounded-xl px-3 py-2.5">
        <Check size={14} className="text-accent shrink-0" />
        <span className="text-sm font-semibold text-slate-800 truncate">{value}</span>
        <button type="button" onClick={() => { onPick(null); setOpen(true); }}
                className="ml-auto text-xs font-semibold text-slate-400 hover:text-slate-600">Change</button>
      </div>
    );
  }
  return (
    <div className="relative">
      <div className="field-within flex items-center min-h-11 border border-slate-200 rounded-xl px-3 transition-all">
        <Search size={14} className="text-slate-400 shrink-0" />
        <input value={q} placeholder={COURSE_HINT[level] || 'e.g. btech cse'}
               onChange={e => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)}
               className="w-full min-w-0 px-2 py-2.5 text-base outline-none bg-transparent
                          placeholder:text-slate-500 placeholder:font-normal text-ellipsis" />
        {busy && <Loader2 size={13} className="animate-spin text-slate-300 shrink-0" />}
      </div>
      {open && rows.length > 0 && (
        <div className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto bg-white border border-slate-200 rounded-xl shadow-lg">
          {byCategory(rows).map(g => (
            <div key={g.category}>
              {/* The heading replaces the per-row category line: it is what
                  shows a UG student that the list runs past Engineering. */}
              {g.category && (
                <p className="sticky top-0 z-10 bg-slate-50/95 backdrop-blur px-3 py-1
                              text-[10px] font-bold uppercase tracking-wide text-slate-500
                              border-b border-slate-100">{g.category}</p>
              )}
              {g.items.map(c => (
                <button key={c.id} type="button" onClick={() => { onPick(c); setOpen(false); setQ(''); }}
                        className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 border-b border-slate-50 last:border-0">
                  {c.display_name}
                  {c.degree && c.degree !== c.degree_category && (
                    <span className="block text-[11px] text-slate-400">{c.degree}</span>
                  )}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function EducationGoals({
  profile, onSaved, onToast, setupMode = false, forceEdit = false,
  sections = 'all', liveState = '', liveCity = '', onPathStatus,
}) {
  const { updateUser } = useAuth();
  const [masters, setMasters] = useState({});
  const [states,  setStates]  = useState([]);
  const [boards,  setBoards]  = useState([]);
  const [boardsBusy, setBoardsBusy] = useState(false);
  const [streams, setStreams] = useState([]);
  const [goals,   setGoals]   = useState(null);
  // The student's own state CETs, alongside the national list.
  const [stateExams, setStateExams] = useState([]);
  // canonical → short label, for the read-only view. The board-scoped `streams`
  // list only loads once a board is picked in edit mode, so without this the
  // card printed the stored value raw — "science_pcb" instead of "BiPC".
  const [streamLabels, setStreamLabels] = useState({});

  const [editEdu,  setEditEdu]  = useState(false);
  const [editGoal, setEditGoal] = useState(false);
  const [saving,   setSaving]   = useState(false);
  const [warn,     setWarn]     = useState(null);       // pending stage change

  const [form, setForm] = useState({});
  const [goalForm, setGoalForm] = useState({});

  const set  = (k, v) => setForm(p => ({ ...p, [k]: v }));
  const setG = (k, v) => setGoalForm(p => ({ ...p, [k]: v }));

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/auth/masters?types=${MASTER_TYPES}`).catch(() => ({ data: {} })),
      api.get('/auth/states').catch(() => ({ data: {} })),
      api.get('/profile/goals').catch(() => ({ data: {} })),
      api.get('/auth/streams/canonical').catch(() => ({ data: {} })),
    ]).then(([m, s, g, st]) => {
      if (!alive) return;
      setMasters(m.data?.response?.grouped || {});
      setStates(s.data?.response?.states || []);
      setGoals(g.data?.response?.goals || null);
      setStreamLabels(Object.fromEntries(
        (st.data?.response?.streams || []).map(x => [x.canonical, x.short_label])));
    });
    return () => { alive = false; };
  }, []);

  // Seed the edit form from whatever the profile already holds.
  const startEdit = () => {
    setForm({
      education_category: profile?.education_category || '',
      board:  profile?.board || '',
      stream: profile?.stream || '',
      school_name:   profile?.school_name || '',
      college_name:  profile?.college_name || '',
      year_of_study: profile?.year_of_study || '',
      exam_target:   profile?.exam_target || '',
      working_industry:   profile?.working_industry || '',
      working_experience: profile?.working_experience || '',
      course_display: [profile?.degree_type, profile?.branch].filter(Boolean).join(' — '),
      degree_category: profile?.degree_category || '',
      degree_type:     profile?.degree_type || '',
      branch:          profile?.branch || '',
      plan10: PLAN_10.find(p => (goals?.target_courses || []).includes(p.goal))?.value || '',
    });
    setEditEdu(true);
  };

  const stage = form.education_category || profile?.education_category || '';
  const isSchool = SCHOOL_STAGES.includes(stage);
  const level    = COURSE_LEVEL[stage];
  const examType = EXAM_TYPE[stage];

  const loadBoards = useCallback((stateName) => {
    const st = states.find(s => s.name === stateName);
    if (!st) { setBoards([]); setBoardsBusy(false); return; }
    setBoardsBusy(true);
    api.get(`/auth/boards?state_id=${st.id}`)
      .then(({ data }) => setBoards(data?.response?.boards || []))
      .catch(() => setBoards([]))
      .finally(() => setBoardsBusy(false));
  }, [states]);

  const stateName = liveState || profile?.state || '';

  useEffect(() => {
    if (editEdu && isSchool && stateName) loadBoards(stateName);
  }, [editEdu, isSchool, stateName, loadBoards]);

  useEffect(() => {
    const code = states.find(s => s.name === stateName)?.code;
    if (!code) return;
    api.get(`/auth/masters?types=entrance_exam_${code}`)
      .then(({ data }) => setStateExams(data?.response?.grouped?.[`entrance_exam_${code}`] || []))
      .catch(() => setStateExams([]));
  }, [states, stateName]);

  const locked = setupMode || forceEdit;
  const showEducation = sections !== 'goals';
  const showGoalsCard = sections !== 'education';

  useEffect(() => {
    if (!locked) {
      setEditEdu(false);
      setEditGoal(false);
      return;
    }
    if (showEducation) startEdit();
    if (showGoalsCard) {
      setEditGoal(true);
      setGoalForm(g => (g && Object.keys(g).length ? g : { ...(goals || {}) }));
    }
    // Seed once when the parent opens the form. Re-running on a section
    // change (PathNudge hiding a card that is now complete) would wipe the
    // other card's in-progress values.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked]);

  useEffect(() => {
    if (!locked || !showGoalsCard || !goals || !editGoal) return;
    setGoalForm(p => (p && p.reservation_category ? p : { ...goals }));
  }, [locked, showGoalsCard, goals, editGoal]);

  // The view uses the saved board's own wording too (MPC, not PCM), the same
  // names the setup screen showed; editing switches to the board being picked.
  const streamBoard = form.board || profile?.board;
  useEffect(() => {
    if (!streamBoard) return;
    api.get(`/auth/streams?board_code=${encodeURIComponent(streamBoard)}`)
      .then(({ data }) => setStreams(data?.response?.streams || []))
      .catch(() => setStreams([]));
  }, [streamBoard]);

  /** Stage changes are allowed — with the consequences spelled out first. */
  const requestStage = (next) => {
    const current = profile?.education_category;
    const stale = current && current !== next ? staleFields(current, next) : [];
    if (stale.length) setWarn({ next, stale });
    else set('education_category', next);
  };

  const confirmStage = () => {
    set('education_category', warn.next);
    // Clear what no longer applies rather than leaving stale values behind.
    setForm(p => ({ ...p, board: '', stream: '', school_name: '', course_display: '',
                    degree_category: '', degree_type: '', branch: '', year_of_study: '',
                    // Stale duration would keep capping the Year list against a
                    // course the student no longer says they are on.
                    duration_years: null }));
    setWarn(null);
  };

  function eduReady() {
    if (!form.education_category) return 'Pick your education stage.';
    if (!stateName) return 'Save your state and city in Personal Information first.';
    if (isSchool && !form.board) return 'Board is required.';
    if (isSchool && !form.stream && form.education_category !== 'school_10th') return 'Group / stream is required.';
    if (level && (!(form.degree_type || form.branch) || !form.year_of_study)) {
      return 'Course and year are required.';
    }
    if (examType && (!form.exam_target || !form.year_of_study)) {
      return 'Exam and preparation stage are required.';
    }
    if (stage === 'working' && (!form.working_industry || !form.working_experience)) {
      return 'Industry and experience are required.';
    }
    return '';
  }

  async function saveEdu() {
    const blocked = eduReady();
    if (blocked) { onToast?.(blocked, false); return; }
    setSaving(true);
    try {
      // Which fields the chosen stage actually owns. Anything it does not own
      // is named in `clear`, so the server nulls it rather than leaving a
      // 10th-class profile still holding "B.Tech — CSE, 2nd Year".
      const isExam = Boolean(examType);
      const hasCourse = Boolean(level);
      const owns = {
        board: isSchool, stream: isSchool, school_name: isSchool,
        college_name: hasCourse, degree_category: hasCourse,
        degree_type: hasCourse, branch: hasCourse,
        // Exam aspirants reuse year_of_study for their preparation stage.
        year_of_study: hasCourse || isExam,
        exam_target: isExam,
        working_industry: stage === 'working',
        working_experience: stage === 'working',
      };

      const payload = { education_category: form.education_category, clear: [] };
      Object.entries(owns).forEach(([field, applies]) => {
        if (applies && form[field]) payload[field] = form[field];
        else if (!applies) payload.clear.push(field);
      });
      const tenth = form.education_category === 'school_10th';
      if (tenth && !form.stream && !payload.clear.includes('stream')) payload.clear.push('stream');
      if (stateName) payload.state = stateName;
      const city = liveCity || profile?.city || '';
      if (city) payload.city = city;

      const { data } = await api.patch('/profile/', payload);
      if (!data.bool) throw new Error(data.response?.message || 'Failed to save');
      if (tenth) {
        const keep = (goals?.target_courses || []).filter(c => !PLAN_GOALS.includes(c));
        const plan = PLAN_10.find(p => p.value === form.plan10);
        const target_courses = plan ? [...keep, plan.goal] : keep;
        await api.put('/profile/goals', { target_courses })
          .then(() => setGoals(g => ({ ...(g || {}), target_courses })))
          .catch(() => {});
      }
      if (!locked) setEditEdu(false);
      updateUser({
        education_level: form.education_category,
        education_category: form.education_category,
      });
      onToast?.('Education updated.');
      onSaved?.();
    } catch (e) { onToast?.(e.message || 'Could not save.', false); }
    finally { setSaving(false); }
  }

  async function saveGoals() {
    if (!goalForm.reservation_category) {
      onToast?.('Reservation category is required.', false);
      return;
    }
    setSaving(true);
    try {
      const { data } = await api.put('/profile/goals', {
        target_exams:  goalForm.target_exams || [],
        reservation_category: goalForm.reservation_category,
      });
      if (!data.bool) throw new Error(data.response?.message || 'Failed to save');
      const saved = data.response?.goals || goalForm;
      setGoals(saved);
      if (!locked) setEditGoal(false);
      onToast?.('Goals updated.');
      onPathStatus?.(isStudentPathComplete(profile, saved));
      onSaved?.();
    } catch (e) { onToast?.(e.message || 'Could not save.', false); }
    finally { setSaving(false); }
  }

  const catLabel = (v) => ((masters.onboarding_category || [])
    .find(c => c.value === v)?.label || v || '').split('|')[0];
  // Prefer the board's own wording when it is loaded (MPC in Telangana), else
  // the canonical short label (PCB). Never the stored value itself.
  const streamLabel = streams.find(s => s.canonical === profile?.stream)?.short_label
    || streamLabels[profile?.stream]
    || profile?.stream;

  // Each stage owns a different set of fields, and the card must only show the
  // ones that apply — otherwise a profile contradicts itself, e.g. "In 10th
  // Class" sitting above "B.Tech — CSE, 2nd Year" left behind by an earlier
  // stage. The save path clears those values; this stops any that predate the
  // fix from being displayed.
  const profileStage = profile?.education_category;
  const profileIsSchool = SCHOOL_STAGES.includes(profileStage);
  const profileHasCourse = Boolean(COURSE_LEVEL[profileStage]);
  const profileIsExam = Boolean(EXAM_TYPE[profileStage]);

  return (
    <>
      {/* ── Education ── */}
      {showEducation && <Card className="p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <GraduationCap size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-bold text-slate-900">Education</h3>
          {!(locked && editEdu) && (
            <button onClick={() => (editEdu ? setEditEdu(false) : startEdit())}
                    className="ml-auto py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
              {editEdu ? <><X size={12} /> Cancel</> : <><Edit3 size={12} /> Edit</>}
            </button>
          )}
        </div>

        {!editEdu ? (
          <div className="grid sm:grid-cols-2 gap-0">
            <Row label="Stage"          value={catLabel(profile?.education_category)} />
            <Row label="Board"          value={profileIsSchool ? profile?.board : null} />
            <Row label={profile?.education_category === 'school_10th' ? 'Plan after 10th' : 'Group / Stream'}
                 value={profileIsSchool && profile?.stream && streamLabel
                   ? (profile?.education_category === 'school_10th' ? `Inter ${streamLabel}` : streamLabel)
                   : profile?.education_category === 'school_10th'
                     ? (PLAN_10.find(p => (goals?.target_courses || []).includes(p.goal))?.label || null)
                     : null} />
            <Row label="Course"
                 value={profileHasCourse
                   ? [profile?.degree_type, profile?.branch].filter(Boolean).join(' — ')
                   : null} />
            <Row label={profileIsExam ? 'Preparation stage' : 'Year'}
                 value={profileHasCourse || profileIsExam ? profile?.year_of_study : null} />
            <Row label="School"         value={profileIsSchool ? profile?.school_name : null} />
            <Row label="College"        value={profileHasCourse ? profile?.college_name : null} />
            <Row label="Target exam"    value={profileIsExam ? profile?.exam_target : null} />
            {!profile?.education_category && (
              <p className="text-sm text-slate-400 italic py-2 col-span-2">Not set yet — click Edit.</p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Stage" required>
              <div className="flex flex-wrap gap-1.5">
                {/* Same list onboarding offers, so a stage a new student cannot
                    register as cannot be reached from the profile either. The
                    student's own stage is passed through, so an existing
                    profile on a now-hidden stage still shows what it is set to
                    rather than an empty row of chips. */}
                {registrableCategories(masters.onboarding_category, stage).map(c => (
                  <Chip key={c.value} label={String(c.label).split('|')[0]}
                        active={stage === c.value} onClick={() => requestStage(c.value)} />
                ))}
              </div>
            </Field>

            {warn && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-3.5">
                <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                  <AlertTriangle size={13} /> Changing to “{catLabel(warn.next)}”
                </p>
                <p className="text-xs text-amber-700 mt-1.5 leading-relaxed">
                  We'll clear: <b>{warn.stale.join(', ')}</b> — they don't apply any more.<br />
                  We'll keep: state, city, target exams, dream colleges, documents and your score.
                </p>
                <div className="flex gap-2 mt-3">
                  <button onClick={() => setWarn(null)}
                          className="px-3 py-1.5 text-xs font-semibold text-slate-600 bg-white border border-slate-200 rounded-lg">
                    Cancel
                  </button>
                  <button onClick={confirmStage}
                          className="px-3 py-1.5 text-xs font-bold text-white bg-amber-600 rounded-lg">
                    Change stage
                  </button>
                </div>
              </div>
            )}

            {isSchool && (
              <>
                <FormSelect
                  label="Board" required
                  value={form.board}
                  onChange={v => { set('board', v); set('stream', ''); }}
                  options={boardsForStage(boards, stage).map(b => ({ value: b.code, label: b.name.split('—')[0].trim() }))}
                  placeholder={boardsBusy ? 'Loading boards…' : 'Enter board'}
                  disabled={boardsBusy || !stateName}
                  hint="Your stream options depend on this."
                />
                {form.board && (
                  <Field label={form.education_category === 'school_10th' ? 'Plan after 10th (optional)' : 'Group / Stream'}
                         required={form.education_category !== 'school_10th'}>
                    <div className="flex flex-wrap gap-1.5">
                      {streams.map(s => (
                        <Chip key={s.canonical}
                              label={form.education_category === 'school_10th' ? `Inter ${s.short_label}` : s.short_label}
                              active={form.stream === s.canonical}
                              onClick={() => setForm(f => ({ ...f, stream: s.canonical, plan10: '' }))} />
                      ))}
                      {form.education_category === 'school_10th' && PLAN_10.map(p => (
                        <Chip key={p.value} label={p.label} active={form.plan10 === p.value}
                              onClick={() => setForm(f => ({ ...f, stream: '', plan10: p.value }))} />
                      ))}
                    </div>
                  </Field>
                )}
                <Input label="School name" value={form.school_name}
                       onChange={e => set('school_name', e.target.value)}
                       placeholder="Enter school name" />
              </>
            )}

            {level && (
              <>
                <Field label="What are you studying?" required>
                  <CourseSearch value={form.course_display} level={level}
                                onPick={c => setForm(p => ({
                                  ...p,
                                  course_display:  c ? c.display_name : '',
                                  degree_category: c ? c.degree_category : '',
                                  degree_type:     c ? c.degree : '',
                                  branch:          c ? (c.branch || '') : '',
                                  // Not persisted — it belongs to the course,
                                  // not the student. Held only to size the
                                  // Year list below.
                                  duration_years:  c ? c.duration_years : null,
                                }))} />
                </Field>
                <div className="grid sm:grid-cols-2 gap-3">
                  <FormSelect
                    label="Year" required
                    value={form.year_of_study}
                    onChange={v => set('year_of_study', v)}
                    options={yearOptionsFor(opts(masters[YEAR_TYPE[stage]]),
                                           form.duration_years, form.year_of_study)}
                    placeholder="Which year are you in?"
                  />
                  <Input label="College / institute" value={form.college_name}
                         onChange={e => set('college_name', e.target.value)}
                         placeholder="Enter college or institute name" />
                </div>
              </>
            )}

            {examType && (
              <div className="grid sm:grid-cols-2 gap-3">
                <FormSelect
                  label="Exam" required
                  value={form.exam_target}
                  onChange={v => set('exam_target', v)}
                  options={opts(masters[examType])}
                  placeholder="Enter exam"
                />
                <FormSelect
                  label="Preparation stage" required
                  value={form.year_of_study}
                  onChange={v => set('year_of_study', v)}
                  options={opts(masters.prep_stage)}
                  placeholder="How far along are you?"
                />
              </div>
            )}

            {stage === 'working' && (
              <div className="grid sm:grid-cols-2 gap-3">
                <FormSelect
                  label="Industry" required
                  value={form.working_industry}
                  onChange={v => set('working_industry', v)}
                  options={opts(masters.industry)}
                  placeholder="Enter industry"
                />
                <FormSelect
                  label="Experience" required
                  value={form.working_experience}
                  onChange={v => set('working_experience', v)}
                  options={opts(masters.experience_range)}
                  placeholder="How many years?"
                />
              </div>
            )}

            <button onClick={saveEdu} disabled={saving || Boolean(warn) || Boolean(eduReady())}
                    className="w-full min-h-11 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                    style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Saving…' : 'Save education'}
            </button>
          </div>
        )}
      </Card>}

      {/* ── Goals ── */}
      {showGoalsCard && <Card className="p-5 mb-4">
        <div className="flex items-center gap-2 mb-4">
          <Target size={16} style={{ color: 'var(--accent)' }} />
          <h3 className="font-bold text-slate-900">My Goals</h3>
          {!(locked && editGoal) && (
            <button onClick={() => { setGoalForm(goals || {}); setEditGoal(!editGoal); }}
                    className="ml-auto py-3 text-xs font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1">
              {editGoal ? <><X size={12} /> Cancel</> : <><Edit3 size={12} /> Edit</>}
            </button>
          )}
        </div>

        {!editGoal ? (
          <div className="grid sm:grid-cols-2 gap-0">
            <Row label="Preparing for"    value={(goals?.target_exams || []).join(', ')} />
            <Row label="Want to study"    value={(goals?.target_courses || []).join(', ')} />
            <Row label="Category"         value={(goals?.reservation_category || '').toUpperCase()} />
            {!goals?.target_exams?.length && !goals?.reservation_category && (
              <p className="text-sm text-slate-400 italic py-2 col-span-2">
                No goals set — add them so your roadmap, cutoffs and scholarships match what you're aiming for.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <FormMultiSelect
              label="Preparing for"
              max={5}
              placeholder="Search exams"
              noOptionsText="No exams listed for this education level yet"
              values={goalForm.target_exams || []}
              onChange={v => setG('target_exams', v)}
              options={(() => {
                const types = TARGET_EXAM_TYPES[profileStage] || ['entrance_exam', 'govt_exam'];
                const stageEntranceExams = EXAM_IDENTITY_STAGES.includes(profileStage)
                  ? masters.entrance_exam
                  : forStage(masters.entrance_exam, profileStage);
                return [
                  ...(types.includes('entrance_exam') ? [...opts(stateExams), ...opts(stageEntranceExams)] : []),
                  ...(types.includes('govt_exam') ? opts(masters.govt_exam) : []),
                ];
              })()} />
            <FormSelect
              label="Reservation category" required
              value={goalForm.reservation_category || ''}
              onChange={v => setG('reservation_category', v)}
              options={opts(masters.category)}
              placeholder="Enter reservation category"
              hint="Used for cutoff and scholarship matching."
            />
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              <Compass size={11} /> These drive your predictor, cutoffs and scholarship matches.
            </p>
            <button onClick={saveGoals} disabled={saving}
                    className="w-full min-h-11 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-40"
                    style={{ backgroundColor: 'var(--accent)' }}>
              {saving ? 'Saving…' : 'Save goals'}
            </button>
          </div>
        )}
      </Card>}
    </>
  );
}
