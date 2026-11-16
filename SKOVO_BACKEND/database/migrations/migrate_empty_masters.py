"""
Migration: seed the master types the web app asks for but that were empty.

Cross-referencing every type the frontend requests against the database turned
up 19 with zero rows. These are not from the recent conversion work — they are
older admin screens that were already master-driven and whose data was never
seeded. The failure mode is invisible: the dropdown renders, it is simply empty,
and nothing errors.

Two of them sit on the anchor module. An admin creating an Opportunity could not
set `experience_level` (a required field, so the form could never be submitted),
`stipend_type` or `status`. Six more sit on AdminCGColleges, which is where
cutoff and course data gets entered — the exact screen the catalogue work needs.

`degree_branch` stores `degree:branch` pairs, keyed on `degree_type` values, and
its branch halves must match `branch_code` — that relationship is why they are
seeded together here.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_empty_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

BRANCH_CODES = [
    ('CSE', 'Computer Science'), ('ECE', 'Electronics & Communication'),
    ('EEE', 'Electrical & Electronics'), ('MECH', 'Mechanical'), ('CIVIL', 'Civil'),
    ('IT', 'Information Technology'), ('CHEM', 'Chemical'), ('AERO', 'Aerospace'),
    ('AUTO', 'Automobile'), ('BIOTECH', 'Biotechnology'), ('AIML', 'AI & Machine Learning'),
    ('DS', 'Data Science'), ('MET', 'Metallurgy'), ('MINING', 'Mining'),
]

# degree_type value → branch codes it offers. Degrees with no entry are treated
# as single-branch by the UI, which is the correct behaviour for MBBS or B.Com.
DEGREE_BRANCHES = {
    'btech':   ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'CHEM', 'AERO', 'AUTO', 'BIOTECH', 'AIML', 'DS'],
    'mtech':   ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'CHEM', 'AIML', 'DS'],
    'bsc':     ['CSE', 'IT', 'DS', 'BIOTECH'],
    'diploma': ['CSE', 'ECE', 'EEE', 'MECH', 'CIVIL', 'IT', 'AUTO'],
}

LISTS = {
    'branch_code': BRANCH_CODES,
    'degree_branch': [(f'{deg}:{code}', f'{deg.upper()} — {code}')
                      for deg, codes in DEGREE_BRANCHES.items() for code in codes],

    # Opportunities — the anchor module's admin form.
    'opportunity_status': [
        ('active', 'Active'), ('filled', 'Filled'), ('closed', 'Closed'),
        ('draft', 'Draft'), ('expired', 'Expired'),
    ],
    'experience_level': [
        ('fresher', 'Fresher'), ('0-1', '0-1 years'), ('1-3', '1-3 years'),
        ('3-5', '3-5 years'), ('5+', '5+ years'),
    ],
    'stipend_type': [
        ('fixed', 'Fixed'), ('range', 'Range'), ('performance', 'Performance-based'),
        ('unpaid', 'Unpaid'), ('negotiable', 'Negotiable'),
    ],

    # Career-guidance admin screens.
    'ai_impact':         [('low', 'Low'), ('medium', 'Medium'), ('high', 'High')],
    'demand_level':      [('low', 'Low'), ('medium', 'Medium'), ('high', 'High'),
                          ('very_high', 'Very High')],
    'work_life_balance': [('poor', 'Poor'), ('average', 'Average'), ('good', 'Good'),
                          ('excellent', 'Excellent')],
    'competition_level': [('low', 'Low'), ('moderate', 'Moderate'), ('high', 'High'),
                          ('very_high', 'Very High')],
    'abroad_program_type': [
        ('MS', 'MS'), ('MBA', 'MBA'), ('PhD', 'PhD'), ('BTech', 'B.Tech'),
        ('MArch', 'M.Arch'), ('Diploma', 'Diploma'), ('Certificate', 'Certificate'),
    ],
    'entrance_exam_type': [
        ('state', 'State'), ('national', 'National'), ('university', 'University'),
        ('international', 'International'),
    ],
    'entrance_exam_stream': [
        ('engineering', 'Engineering'), ('medical', 'Medical'), ('management', 'Management'),
        ('law', 'Law'), ('design', 'Design'), ('arts', 'Arts'), ('science', 'Science'),
    ],
    'exam_mode': [
        ('online', 'Online'), ('offline', 'Offline (pen & paper)'),
        ('hybrid', 'Hybrid'), ('cbt', 'Computer-based test'),
    ],
    'exam_type': [
        ('EAMCET', 'EAMCET'), ('JEE Main', 'JEE Main'), ('JEE Advanced', 'JEE Advanced'),
        ('NEET UG', 'NEET UG'), ('KCET', 'KCET'), ('MHT-CET', 'MHT-CET'),
        ('WBJEE', 'WBJEE'), ('KEAM', 'KEAM'), ('COMEDK UGET', 'COMEDK UGET'),
        ('TNEA', 'TNEA'), ('Other', 'Other'),
    ],
    'scholarship_mode': [
        ('online', 'Online'), ('offline', 'Offline'), ('both', 'Online & Offline'),
    ],
    'scholarship_benefit_type': [
        ('full_tuition', 'Full tuition'), ('partial_tuition', 'Partial tuition'),
        ('stipend', 'Monthly stipend'), ('one_time', 'One-time grant'),
        ('loan_subsidy', 'Loan subsidy'), ('other', 'Other'),
    ],

    # Cutoff entry needs both of these; `category` already exists and is the one
    # the predictor reads, so this mirrors it rather than inventing a rival list.
    'reservation_category': [
        ('general', 'General / OC'), ('obc', 'OBC / BC'), ('sc', 'SC'),
        ('st', 'ST'), ('ews', 'EWS'),
    ],
    'gender': [('all', 'All'), ('male', 'Male'), ('female', 'Female'),
               ('other', 'Other')],
}


def upsert(mtype, value, label, order):
    row = db.session.execute(
        text("SELECT `id` FROM `masters` WHERE `type` = :t AND `value` = :v"),
        {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(text(
            "UPDATE `masters` SET `label` = :l, `sort_order` = :s, `is_active` = 1 WHERE `id` = :i"),
            {'l': label, 's': order, 'i': row[0]})
        return 0
    db.session.execute(text("""
        INSERT INTO `masters` (`id`, `type`, `value`, `label`, `sort_order`, `is_active`)
        VALUES (:i, :t, :v, :l, :s, 1)
    """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 's': order})
    return 1


def main():
    with app.app_context():
        added = 0
        for mtype, rows in LISTS.items():
            for i, (value, label) in enumerate(rows):
                added += upsert(mtype, value, label, (i + 1) * 10)

        # indian_state mirrors the states table so the CG college form and the
        # student-facing pickers can never disagree about what a state is.
        states = db.session.execute(text(
            "SELECT `name` FROM `states` WHERE `is_active` = 1 ORDER BY `sort_order`")).scalars().all()
        for i, name in enumerate(states):
            added += upsert('indian_state', name, name, (i + 1) * 10)
        db.session.commit()

        types = db.session.execute(text(
            "SELECT COUNT(DISTINCT `type`) FROM `masters` WHERE `is_active` = 1")).scalar()
        rows = db.session.execute(text(
            "SELECT COUNT(1) FROM `masters` WHERE `is_active` = 1")).scalar()
        print(f"rows added: {added} | indian_state mirrored from states: {len(states)}")
        print(f"masters now: {types} active types, {rows} rows")


if __name__ == "__main__":
    main()
