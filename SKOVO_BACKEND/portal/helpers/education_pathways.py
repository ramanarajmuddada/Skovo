"""Education level -> preparing-for options -> career interest options.

Server-side mirror of Skovo/src/config/educationPathways.js. The two must be
changed together; the frontend decides what a student is *shown*, this decides
what is *kept* when it arrives. A client that skips the UI, or a student whose
level changed after they picked, cannot store an option their stage does not
offer.

Same rule as the frontend: an option nobody has classified is ALLOWED, not
dropped. A new exam an admin adds tomorrow surviving one extra stage is a small
annoyance; being silently discarded on save is a bug nobody would find.
"""

SCHOOL_LEVELS     = ['school_10th', 'school_11th', 'school_12th', 'dropper']
VOCATIONAL_LEVELS = ['iti', 'polytechnic']
HIGHER_LEVELS     = ['ug', 'pg', 'phd', 'professional_course']
OTHER_LEVELS      = ['working', 'gap_year']

ALL_LEVELS      = SCHOOL_LEVELS + VOCATIONAL_LEVELS + HIGHER_LEVELS + OTHER_LEVELS
AFTER_12        = ['school_11th', 'school_12th', 'dropper']
AFTER_12_ONLY   = ['school_12th', 'dropper']

# Stages a student cannot register as. "Govt Exam Aspirant" / "Entrance Exam
# Aspirant" say what someone is doing, not where they are in education, so they
# left every list below with nothing to filter on. The four post-graduate and
# working stages are hidden for a different reason: they are outside the
# audience the portal is aimed at, so nobody new registers as one.
#
# Hidden, not removed: these levels keep their TARGET_EXAM_TYPES and
# CAREER_INTEREST_LEVELS entries so students already on them still resolve, and
# master_onboarding_category is left untouched so admin screens are unaffected.
HIDDEN_ONBOARDING_CATEGORIES = [
    'govt_exam', 'entrance_exam',
    'professional_course',   # CA / CS / CMA / CFA
    'pg',                    # M.Tech / MBA / MSc / MD / LLM
    'phd',                   # PhD / Research
    'working',               # Working Professional
]

# Which exam master type(s) a stage draws from.
TARGET_EXAM_TYPES = {
    'school_10th': ['entrance_exam'], 'school_11th': ['entrance_exam'],
    'school_12th': ['entrance_exam'], 'dropper': ['entrance_exam'],
    'iti': ['entrance_exam'], 'polytechnic': ['entrance_exam'],
    'ug': ['entrance_exam'], 'professional_course': ['entrance_exam'],
    'pg': ['govt_exam'], 'phd': ['govt_exam'], 'working': ['govt_exam'],
    'gap_year': ['entrance_exam', 'govt_exam'],
}

# State CETs by the level they admit FROM, matched as a substring because the
# same acronym recurs behind a different state prefix (AP ECET, TS ECET).
# Order matters: PGECET before ECET, PGCET before GCET.
STATE_EXAM_TOKENS = [
    # Everything ending in -ECET first: "AP DEECET" and "AP PECET" both contain
    # the substring ECET, so a bare ECET rule above them claims both and offers
    # a teacher-training entrance to ITI students.
    ('PGECET',  ['ug']),
    ('DEECET',  AFTER_12_ONLY),
    ('DIETCET', AFTER_12_ONLY),
    ('PECET',   AFTER_12_ONLY + ['ug']),
    ('ECET',    VOCATIONAL_LEVELS),
    ('JELET',   VOCATIONAL_LEVELS),
    ('PGLCET',  ['ug']),
    ('PGCET',   ['ug']),
    ('POLYCET', ['school_10th']),
    ('JEECUP',  ['school_10th']),
    ('PPHT',    AFTER_12_ONLY),
    ('EAPCET',  AFTER_12),
    ('EAMCET',  AFTER_12),
    ('EDCET',   ['ug']),
    ('ICET',    ['ug']),
    ('TANCET',  ['ug']),
    ('MBA CET', ['ug']),
    ('RCET',    ['pg']),
    ('LAWCET',  AFTER_12_ONLY + ['ug']),
    ('COMEDK',  AFTER_12), ('ASSAM CEE', AFTER_12), ('CENTAC', AFTER_12),
    ('MHT-CET', AFTER_12), ('MHT CET',   AFTER_12), ('GUJCET', AFTER_12),
    ('JKCET',   AFTER_12), ('BCECE',     AFTER_12), ('JCECE',  AFTER_12),
    ('WBJEE',   AFTER_12), ('KCET',      AFTER_12), ('KEAM',   AFTER_12),
    ('IPU CET', AFTER_12), ('PU CET',    AFTER_12), ('CG PET', AFTER_12),
    ('TNEA',    AFTER_12), ('OJEE',      AFTER_12), ('REAP',   AFTER_12),
    ('GCET',    AFTER_12),
]

# Which stages each career interest is offered at, keyed by the master row value.
CAREER_INTEREST_LEVELS = {
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

    'Medicine & Healthcare':  SCHOOL_LEVELS + HIGHER_LEVELS + OTHER_LEVELS,
    'Finance & Banking':      SCHOOL_LEVELS + HIGHER_LEVELS + OTHER_LEVELS,
    'Media & Journalism':     SCHOOL_LEVELS + HIGHER_LEVELS + OTHER_LEVELS,
    'Law & Legal':            SCHOOL_LEVELS + ['ug', 'pg', 'professional_course'] + OTHER_LEVELS,
    'Chartered Accountancy':  SCHOOL_LEVELS + ['ug', 'professional_course'] + OTHER_LEVELS,
    'Research & Development': AFTER_12 + HIGHER_LEVELS + OTHER_LEVELS,
    'Marketing & Sales':      AFTER_12_ONLY + HIGHER_LEVELS + OTHER_LEVELS,
    'Consulting & Strategy':  HIGHER_LEVELS + OTHER_LEVELS,
}


def _allows(levels, level):
    """Unclassified option, or unknown level -> allowed."""
    return not levels or not level or level in levels


def levels_for_state_exam(value):
    """Levels a state CET admits from, or None when nothing classifies it."""
    v = str(value or '').upper()
    for token, levels in STATE_EXAM_TOKENS:
        if token in v:
            return levels
    return None


def career_interest_allowed(level, interest):
    return _allows(CAREER_INTEREST_LEVELS.get(interest), level)


def filter_career_interests(level, interests):
    """Drop interests this stage does not offer. Order is preserved."""
    return [i for i in (interests or []) if career_interest_allowed(level, i)]


def filter_target_exams(level, exams, national=None, govt_values=None):
    """Drop target exams this stage does not sit. Order is preserved.

    `national` is {value: education_level-or-None} from master_entrance_exam —
    presence in the dict is what marks a value as a national entrance exam, and
    a None level (the "Other" row) means it applies everywhere. `govt_values` is
    the master_govt_exam list.

    Both are needed because a handful of values live in BOTH masters — CDS is a
    national entrance exam tagged `ug` and also a government recruitment exam.
    Keyed on the value alone, a PG student's CDS was matched against the
    entrance tagging and dropped, even though PG draws on the govt list where it
    is perfectly valid. State CETs appear in neither dict and are classified by
    STATE_EXAM_TOKENS; anything unrecognised is kept.
    """
    types = TARGET_EXAM_TYPES.get(level) or ['entrance_exam', 'govt_exam']
    national = national or {}
    govt = set(govt_values or ())
    seen, out = set(), []
    for e in (exams or []):
        if e in seen:
            continue
        allowed = False
        if 'entrance_exam' in types:
            if e in national:
                lv = national[e]
                allowed = (level in [x.strip() for x in lv.split(',')]) if lv else True
            elif e not in govt:
                # A state CET, or something nobody has classified.
                allowed = _allows(levels_for_state_exam(e), level)
        if not allowed and 'govt_exam' in types and e in govt:
            allowed = True
        if allowed:
            seen.add(e)
            out.append(e)
    return out


def target_exam_allowed(level, exam, national=None, govt_values=None):
    """Single-value form of filter_target_exams."""
    return bool(filter_target_exams(level, [exam], national, govt_values))
