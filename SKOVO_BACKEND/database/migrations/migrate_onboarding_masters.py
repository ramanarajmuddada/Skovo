"""
Migration: onboarding option lists become master data.

The onboarding modal's education categories, government-exam list and
entrance-exam list were hardcoded in the React file. That meant two things
were wrong: admin could not change them without a deploy, and the options a
student picked did not map to anything the masters table (and therefore the
reporting) knew about.

This seeds those lists into the masters table under three types:
  onboarding_category  — the 11 tiles a student first chooses from
  govt_exam            — UPSC / SSC / Banking / …
  entrance_exam        — JEE / NEET / CAT / …

The label carries the short helper text after a pipe ("Title|subtitle") so the
tile can show both without a second column. Icon and colour stay in the UI —
they are presentation, not data.

Idempotent: upserts by (type, value). Run from SKOVO_BACKEND:
    python migrate_onboarding_masters.py
"""
import uuid
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

# value, "label|subtitle", sort_order
ONBOARDING_CATEGORY = [
    ('school_10th',        'In 10th Class|Currently studying in 10th',         5),
    ('school_11th',        'In 11th Class|Currently studying in 11th',        10),
    ('school_12th',        'In 12th Class|Currently in 12th / boards prep',   20),
    ('iti',                'ITI Student|Vocational training (Elec, Fitter…)', 30),
    ('polytechnic',        'Polytechnic Diploma|Civil, Mech, CS, EEE diploma', 40),
    ('ug',                 'UG Degree Student|B.Tech / MBBS / BCA / BCom / BA…', 50),
    ('professional_course','CA / CS / CMA / CFA|Professional course student', 60),
    ('pg',                 'PG Student|M.Tech / MBA / MSc / MD / LLM…',        70),
    ('phd',                'PhD / Research|Doctoral or research student',     80),
    ('working',            'Working Professional|Employed, looking to upskill', 90),
    ('govt_exam',          'Govt Exam Aspirant|UPSC / SSC / Banking / Railway…', 100),
    ('entrance_exam',      'Entrance Exam Aspirant|JEE / NEET / CAT / GATE / CLAT…', 110),
]

GOVT_EXAMS = ['UPSC', 'SSC CGL', 'SSC CHSL', 'SSC MTS', 'IBPS PO', 'IBPS Clerk',
              'SBI PO', 'SBI Clerk', 'RBI Grade B', 'RRB NTPC', 'RRB Group D',
              'RRB ALP', 'CDS', 'NDA', 'CAPF', 'Agniveer', 'CTET', 'TET', 'KVS',
              'State PSC', 'Other']

ENTRANCE_EXAMS = ['JEE Main', 'JEE Advanced', 'NEET UG', 'NEET PG', 'CAT', 'XAT',
                  'GMAT', 'CLAT', 'GATE', 'CUET', 'NDA Exam', 'NIFT', 'NID',
                  'CMAT', 'MAT', 'Other']


def _upsert(mtype, value, label, sort_order):
    row = db.session.execute(text(
        "SELECT id FROM masters WHERE type=:t AND value=:v"),
        {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(text(
            "UPDATE masters SET label=:l, sort_order=:s, is_active=1 WHERE id=:i"),
            {'l': label, 's': sort_order, 'i': row[0]})
    else:
        db.session.execute(text("""
            INSERT INTO masters (id, type, value, label, sort_order, is_active)
            VALUES (:i, :t, :v, :l, :s, 1)
        """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 's': sort_order})


def main():
    with app.app_context():
        for value, label, order in ONBOARDING_CATEGORY:
            _upsert('onboarding_category', value, label, order)
        for i, name in enumerate(GOVT_EXAMS):
            _upsert('govt_exam', name, name, i * 10)
        for i, name in enumerate(ENTRANCE_EXAMS):
            _upsert('entrance_exam', name, name, i * 10)
        db.session.commit()

        counts = {r[0]: r[1] for r in db.session.execute(text("""
            SELECT type, COUNT(*) FROM masters
             WHERE type IN ('onboarding_category','govt_exam','entrance_exam')
             GROUP BY type""")).fetchall()}
        print("onboarding masters seeded:", counts)


if __name__ == "__main__":
    main()
