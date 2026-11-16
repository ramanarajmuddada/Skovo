/**
 * Education level → what a student is preparing for → which career interests.
 *
 * ONE place decides which options a student sees for their stage. Onboarding,
 * the Profile editor and the backend all read this (the backend keeps a mirror
 * at portal/helpers/education_pathways.py — change both together).
 *
 * Why this exists: the option lists still come from the master tables, as they
 * always have. What was missing was the *policy* layer saying which of those
 * rows apply to whom. Without it a B.Tech student was offered AP POLYCET (a
 * diploma entrance sat after 10th), AP DEECET (a teacher-training entrance) and
 * AP RCET (a PhD entrance) alongside GATE and CAT, because the state exam list
 * was merged in unfiltered.
 *
 * Rule for extending: an option nobody has classified is SHOWN, not hidden. A
 * new exam an admin adds tomorrow appearing in one extra stage is a small
 * annoyance; silently vanishing from the stage it was added for is a bug nobody
 * would find.
 */

/* ── Education levels ──────────────────────────────────────────────────────── */

export const SCHOOL_LEVELS     = ['school_10th', 'school_11th', 'school_12th', 'dropper'];
export const VOCATIONAL_LEVELS = ['iti', 'polytechnic'];
export const HIGHER_LEVELS     = ['ug', 'pg', 'phd', 'professional_course'];
export const OTHER_LEVELS      = ['working', 'gap_year'];

const ALL_LEVELS    = [...SCHOOL_LEVELS, ...VOCATIONAL_LEVELS, ...HIGHER_LEVELS, ...OTHER_LEVELS];
const AFTER_12      = ['school_11th', 'school_12th', 'dropper'];
const AFTER_12_ONLY = ['school_12th', 'dropper'];

/**
 * Stages a student cannot register as.
 *
 * "Govt Exam Aspirant" and "Entrance Exam Aspirant" describe what someone is
 * doing, not where they are in education — and that is the one thing the rest
 * of this file needs. A student who picked them told us nothing about their
 * level, so every list below had to fall back to showing everything.
 *
 * The four post-graduate and working stages below are hidden for a different
 * reason: they are outside the audience the portal is being pointed at, so
 * nobody new should register as one.
 *
 * Hidden is not the same as removed. These levels keep their entries in
 * TARGET_EXAM_TYPES and CAREER_INTEREST_LEVELS, and their master rows are left
 * active, because students who already registered under them still need their
 * exam and career lists to resolve — and admin screens still filter by them.
 * Deactivating the master rows instead would break both.
 */
export const HIDDEN_ONBOARDING_CATEGORIES = [
  'govt_exam', 'entrance_exam',
  'professional_course',   // CA / CS / CMA / CFA
  'pg',                    // M.Tech / MBA / MSc / MD / LLM
  'phd',                   // PhD / Research
  'working',               // Working Professional
];

/* ── 1. What are you preparing for? ────────────────────────────────────────── */

/**
 * Which exam master type(s) a stage draws from. `entrance_exam` gets a student
 * INTO their next stage; `govt_exam` is government recruitment (UPSC/SSC/bank/
 * railways), which only becomes a real target once a degree is in hand.
 */
export const TARGET_EXAM_TYPES = {
  school_10th: ['entrance_exam'], school_11th: ['entrance_exam'], school_12th: ['entrance_exam'],
  iti: ['entrance_exam'], polytechnic: ['entrance_exam'],
  ug: ['entrance_exam'], professional_course: ['entrance_exam'],
  pg: ['govt_exam'], phd: ['govt_exam'],
  working: ['govt_exam'],
  dropper: ['entrance_exam'],
  gap_year: ['entrance_exam', 'govt_exam'],
};

/**
 * State CETs, by the level they admit FROM. Matched as a substring, because the
 * same acronym recurs across states behind a different prefix — AP ECET, TS
 * ECET. Order matters: PGECET must be tested before ECET, and PGCET before
 * GCET, or the shorter token swallows the longer one.
 *
 * Unlisted exam → null → shown at every level (see the rule at the top).
 */
const STATE_EXAM_TOKENS = [
  // ── Everything ending in -ECET first. "AP DEECET" and "AP PECET" both
  //    contain the substring ECET, so a bare ECET rule placed above them
  //    claims both and offers a teacher-training entrance to ITI students.
  ['PGECET',  ['ug']],                       // M.Tech, after a degree
  ['DEECET',  AFTER_12_ONLY],                // D.El.Ed, after 12th
  ['DIETCET', AFTER_12_ONLY],
  ['PECET',   [...AFTER_12_ONLY, 'ug']],     // physical education
  ['ECET',    VOCATIONAL_LEVELS],            // B.Tech lateral entry
  // Lateral entry — for someone already holding a diploma or ITI certificate
  ['JELET',   VOCATIONAL_LEVELS],
  ['PGLCET',  ['ug']],                       // LLM, after LLB
  ['PGCET',   ['ug']],                       // Karnataka PG entrance
  // Sat after 10th
  ['POLYCET', ['school_10th']],
  ['JEECUP',  ['school_10th']],
  // Sat after 12th
  ['PPHT',    AFTER_12_ONLY],                // pre-pharmacy
  ['EAPCET',  AFTER_12],
  ['EAMCET',  AFTER_12],
  // After a degree
  ['EDCET',   ['ug']],                       // B.Ed
  ['ICET',    ['ug']],                       // MBA / MCA
  ['TANCET',  ['ug']],
  ['MBA CET', ['ug']],
  ['RCET',    ['pg']],                       // PhD / research
  // A 5-year integrated course after 12th, or a 3-year one after a degree
  ['LAWCET',  [...AFTER_12_ONLY, 'ug']],
  // Plain UG entrance, sat after 12th
  ['COMEDK',   AFTER_12], ['ASSAM CEE', AFTER_12], ['CENTAC', AFTER_12],
  ['MHT-CET',  AFTER_12], ['MHT CET',   AFTER_12], ['GUJCET', AFTER_12],
  ['JKCET',    AFTER_12], ['BCECE',     AFTER_12], ['JCECE',  AFTER_12],
  ['WBJEE',    AFTER_12], ['KCET',      AFTER_12], ['KEAM',   AFTER_12],
  ['IPU CET',  AFTER_12], ['PU CET',    AFTER_12], ['CG PET', AFTER_12],
  ['TNEA',     AFTER_12], ['OJEE',      AFTER_12], ['REAP',   AFTER_12],
  ['GCET',     AFTER_12],
];

/** Levels a state exam admits from, or null when nothing classifies it. */
export function levelsForStateExam(value) {
  const v = String(value || '').toUpperCase();
  for (const [token, levels] of STATE_EXAM_TOKENS) {
    if (v.includes(token)) return levels;
  }
  return null;
}

/* ── 2. Career interests ───────────────────────────────────────────────────── */

/**
 * Which stages each career interest is offered at, keyed by the master row's
 * value. An interest missing from this map is shown everywhere.
 *
 * Most are broad enough to mean something at any stage. The ones that are
 * scoped are scoped because they need a qualification the student does not have
 * yet (Consulting wants a degree) or a route their current track does not lead
 * to (an ITI trade does not open onto Chartered Accountancy).
 */
export const CAREER_INTEREST_LEVELS = {
  'Software & IT':               ALL_LEVELS,
  'Data Science & AI':           ALL_LEVELS,
  'Core Engineering':            ALL_LEVELS,
  'Design & Creative':           ALL_LEVELS,
  'Government & Civil Services': ALL_LEVELS,
  'Defence & Armed Forces':      ALL_LEVELS,
  'Teaching & Academia':         ALL_LEVELS,
  'Entrepreneurship & Startups': ALL_LEVELS,
  'Agriculture & Allied':        ALL_LEVELS,
  'Hospitality & Tourism':       ALL_LEVELS,
  'Sports & Fitness':            ALL_LEVELS,
  'Social Impact & NGO':         ALL_LEVELS,

  'Medicine & Healthcare':       [...SCHOOL_LEVELS, ...HIGHER_LEVELS, ...OTHER_LEVELS],
  'Finance & Banking':           [...SCHOOL_LEVELS, ...HIGHER_LEVELS, ...OTHER_LEVELS],
  'Media & Journalism':          [...SCHOOL_LEVELS, ...HIGHER_LEVELS, ...OTHER_LEVELS],
  'Law & Legal':                 [...SCHOOL_LEVELS, 'ug', 'pg', 'professional_course', ...OTHER_LEVELS],
  'Chartered Accountancy':       [...SCHOOL_LEVELS, 'ug', 'professional_course', ...OTHER_LEVELS],
  'Research & Development':      [...AFTER_12, ...HIGHER_LEVELS, ...OTHER_LEVELS],
  'Marketing & Sales':           [...AFTER_12_ONLY, ...HIGHER_LEVELS, ...OTHER_LEVELS],
  'Consulting & Strategy':       [...HIGHER_LEVELS, ...OTHER_LEVELS],
};

/* ── Helpers — the only API the screens should need ────────────────────────── */

const allows = (levels, level) => !levels || !level || levels.includes(level);

/**
 * Onboarding stages a student may actually register as.
 *
 * `currentValue` is the stage the student is already on. A profile saved before
 * a stage was hidden keeps that chip visible, on the same principle as
 * yearOptionsFor below: the list narrows for the next student, it does not blank
 * the stage of the one editing an unrelated field today.
 */
export function registrableCategories(rows, currentValue) {
  return (rows || []).filter(r => r.value === currentValue
    || !HIDDEN_ONBOARDING_CATEGORIES.includes(r.value));
}

/**
 * "What are you preparing for?" for one level.
 *
 * `national` rows carry their own `education_level` column, so they are trusted
 * as-is (a row with none set — "Other" — applies everywhere). `state` rows have
 * no such column, so they are classified here.
 */
export function targetExamRows(level, { national = [], state = [], govt = [] } = {}) {
  const types = TARGET_EXAM_TYPES[level] || ['entrance_exam', 'govt_exam'];
  const out = [];
  if (types.includes('entrance_exam')) {
    out.push(...(state || []).filter(r => allows(levelsForStateExam(r.value), level)));
    out.push(...(national || []).filter(r => !r.education_level
      || r.education_level.split(',').map(s => s.trim()).includes(level)));
  }
  if (types.includes('govt_exam')) out.push(...(govt || []));
  // Both the entrance and govt lists carry an "Other" row, so a stage drawing on
  // both would list the same option twice — and FormMultiSelect keys on the value.
  const seen = new Set();
  return out.filter(r => !seen.has(r.value) && seen.add(r.value));
}

/** Career interest rows offered at one level. */
export function careerInterestRows(level, rows) {
  return (rows || []).filter(r => allows(CAREER_INTEREST_LEVELS[r.value], level));
}

/**
 * Drop selections the new level no longer offers. Called whenever the student
 * changes stage, so a target picked under the old level cannot be carried into
 * a submission the backend would strip anyway.
 */
export function pruneSelections(selected, allowedRows) {
  const ok = new Set((allowedRows || []).map(r => r.value));
  return (selected || []).filter(v => ok.has(v));
}

/**
 * Year options a student may pick, capped by how long their course runs.
 *
 * The year list was chosen by *stage* alone — `year_ug` for every UG student —
 * so a B.Com student (3 years) and a B.Tech student (4 years) were both offered
 * a 5th Year, and 95 of the 110 active UG courses do not have one. The number
 * needed to fix it was already on the row: `course_catalogue.duration_years`,
 * already returned by `/auth/courses`, just never read.
 *
 * Rules, in the order they matter:
 *
 *  - **No course picked yet → offer everything.** Hiding options before the
 *    student has told us what they study would be guessing, and the guess is
 *    wrong for the 12 UG courses that genuinely run five years or more
 *    (MBBS, B.Arch, the integrated LLBs, BDS, Pharm.D).
 *  - **Round up.** MBBS is 5.5 years and Pharm.D is 6; a student in the back
 *    half of a half-year needs the year above, and over-offering by one is a
 *    far smaller harm than a student who cannot record where they are.
 *  - **Never drop a value the student already has.** An existing profile
 *    saying "5th Year" against a 4-year course keeps that option visible, so
 *    editing an unrelated field cannot silently blank their year. The list
 *    narrows for the next person; it does not rewrite history for this one.
 */
export function yearOptionsFor(rows, durationYears, currentValue) {
  const all = rows || [];
  const years = Number(durationYears);
  if (!Number.isFinite(years) || years <= 0) return all;

  const cap = Math.ceil(years);
  // Positional, not name-parsed: the labels are master data and an admin may
  // rename "1st Year" tomorrow. Sort order in the master table is the ranking,
  // and the API already returns them in it.
  const capped = all.slice(0, cap);
  if (currentValue && !capped.some(r => r.value === currentValue)) {
    const kept = all.find(r => r.value === currentValue);
    if (kept) return [...capped, kept];
  }
  return capped;
}

/* ── First-login Profile gate ─────────────────────────────────────────────── */

// Same stage-owned fields Onboarding used to collect. Dropper is an exam
// identity, not a school board/stream, even though it sits in SCHOOL_LEVELS
// for exam-list policy.
export const PROFILE_SCHOOL_STAGES = ['school_10th', 'school_11th', 'school_12th'];
export const PROFILE_COURSE_STAGES = {
  iti: true, polytechnic: true, ug: true, pg: true, professional_course: true, phd: true,
};
export const PROFILE_EXAM_STAGES = {
  govt_exam: true, entrance_exam: true, dropper: true,
};

export const PATH_FIELD_LABELS = {
  stage:        'Education stage',
  state:        'State',
  city:         'City',
  board:        'Board',
  stream:       'Group / stream',
  course:       'Course',
  year:         'Year of study',
  exam:         'Exam you are preparing for',
  prep:         'Preparation stage',
  industry:     'Industry',
  experience:   'Experience',
  reservation:  'Reservation category',
};

/**
 * Fields still empty on the path. Used for just-in-time prompts on Cohorts /
 * Colleges / Opportunities — never as a login wall.
 * Goals may be a goals object or `{ reservation_category }`.
 */
export function studentPathMissing(profile, goals, { includeReservation = true } = {}) {
  const p = profile || {};
  const stage = p.education_category || p.education_level || '';
  const missing = [];
  if (!stage) missing.push('stage');
  if (!p.state) missing.push('state');
  if (!p.city) missing.push('city');
  if (PROFILE_SCHOOL_STAGES.includes(stage)) {
    if (!p.board) missing.push('board');
    // A 10th student has no group yet: choosing one is the point of that stage.
    if (!p.stream && stage !== 'school_10th') missing.push('stream');
  } else if (PROFILE_COURSE_STAGES[stage]) {
    if (!(p.degree_type || p.branch || p.degree_category)) missing.push('course');
    if (!p.year_of_study) missing.push('year');
  } else if (PROFILE_EXAM_STAGES[stage]) {
    if (!p.exam_target) missing.push('exam');
    if (!p.year_of_study) missing.push('prep');
  } else if (stage === 'working') {
    if (!p.working_industry) missing.push('industry');
    if (!p.working_experience) missing.push('experience');
  }
  if (includeReservation && !(goals && goals.reservation_category)) missing.push('reservation');
  return missing;
}

/** Stage, place and study-now — the slice Cohorts / For You lists need. */
export function studentIdentityMissing(profile) {
  return studentPathMissing(profile, null, { includeReservation: false });
}

export function isStudentPathComplete(profile, goals) {
  return studentPathMissing(profile, goals).length === 0;
}

/* ── Boards by stage ───────────────────────────────────────────────────────── */

/**
 * Class 10 sees SSC boards, Class 11 / 12 see Inter boards; national boards
 * (CBSE, ICSE …) cover both. `level` comes from /auth/boards. A board with no
 * level is shown — the same "unclassified is shown" rule as above.
 */
export function boardsForStage(boards, category) {
  const want = category === 'school_10th' ? 'school'
    : (category === 'school_11th' || category === 'school_12th' || category === 'dropper') ? 'intermediate'
      : null;
  if (!want) return boards;
  return boards.filter(b => !b.level || b.level === 'all' || b.level === want);
}
