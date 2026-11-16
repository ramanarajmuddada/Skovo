"""
Migration: the entrance-exam list stops being national-only.

`masters.entrance_exam` held 16 exams, every one of them national. A student in
Andhra targets EAPCET, one in Karnataka targets KCET, one in Kerala targets
KEAM — and none of them could say so, which meant the whole target-exam
question quietly only worked for the JEE/NEET/CAT crowd.

Two lists now:
  entrance_exam           — national, shown to everyone
  entrance_exam_<CODE>    — that state's own CETs, shown on top of the national
                            list once the student picks their state

The state suffix reuses the namespacing already used for year_* and stream_*
types, so nothing new is needed to serve it.

This is exam NAMES only — public, stable reference data. No cutoffs, no ranks,
no dates: anything a student would plan around has to come from a verified
source through the bulk importer, not from a seed script.

The list is a starting point, not gospel. Exams get renamed and discontinued, so
admin can edit all of it from Admin → Masters.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_entrance_exams.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Shown to every student regardless of state.
NATIONAL = [
    'JEE Main', 'JEE Advanced', 'NEET UG', 'NEET PG', 'CUET UG', 'CUET PG',
    'BITSAT', 'VITEEE', 'SRMJEEE', 'NATA', 'UCEED', 'CEED', 'NIFT', 'NID',
    'CLAT', 'AILET', 'GATE', 'CAT', 'XAT', 'MAT', 'CMAT', 'SNAP', 'NMAT',
    'IIFT', 'TISSNET', 'GMAT', 'IIT JAM', 'UGC NET', 'CSIR NET',
    'ICAR AIEEA', 'INI CET', 'NEET MDS', 'NDA Exam', 'CDS', 'AFCAT', 'Other',
]

# state code → that state's own entrance exams
STATE_EXAMS = {
    'AP': ['AP EAPCET (EAMCET)', 'AP ECET', 'AP POLYCET', 'AP ICET', 'AP LAWCET', 'AP PGECET'],
    'TS': ['TS EAPCET (EAMCET)', 'TS ECET', 'TS POLYCET', 'TS ICET', 'TS LAWCET', 'TS PGECET'],
    'KA': ['KCET', 'COMEDK UGET', 'Karnataka PGCET'],
    'MH': ['MHT-CET', 'MAH MBA CET'],
    'TN': ['TNEA', 'TANCET'],
    'KL': ['KEAM'],
    'WB': ['WBJEE', 'WBJEE JELET'],
    'UP': ['JEECUP'],
    'BR': ['BCECE'],
    'JH': ['JCECE'],
    'OD': ['OJEE'],
    'CG': ['CG PET', 'CG PPHT'],
    'GJ': ['GUJCET'],
    'RJ': ['REAP'],
    'AS': ['Assam CEE'],
    'JK': ['JKCET'],
    'DL': ['IPU CET'],
    'GA': ['GCET'],
    'PY': ['CENTAC'],
    'PB': ['PU CET'],
}


def upsert(mtype, value, order):
    row = db.session.execute(
        text("SELECT `id` FROM `masters` WHERE `type` = :t AND `value` = :v"),
        {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(
            text("UPDATE `masters` SET `label` = :l, `sort_order` = :s, `is_active` = 1 WHERE `id` = :i"),
            {'l': value, 's': order, 'i': row[0]})
        return 0
    db.session.execute(text("""
        INSERT INTO `masters` (`id`, `type`, `value`, `label`, `sort_order`, `is_active`)
        VALUES (:i, :t, :v, :v, :s, 1)
    """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 's': order})
    return 1


def main():
    with app.app_context():
        known = {r[0] for r in db.session.execute(text("SELECT `code` FROM `states`")).fetchall()}

        added = 0
        for i, name in enumerate(NATIONAL):
            added += upsert('entrance_exam', name, (i + 1) * 10)

        state_types = 0
        for code, exams in STATE_EXAMS.items():
            if code not in known:
                continue                       # never seed an exam for a state we do not have
            state_types += 1
            for i, name in enumerate(exams):
                added += upsert(f'entrance_exam_{code}', name, (i + 1) * 10)
        db.session.commit()

        counts = db.session.execute(text("""
            SELECT (SELECT COUNT(1) FROM `masters` WHERE `type` = 'entrance_exam' AND `is_active` = 1) AS national,
                   (SELECT COUNT(1) FROM `masters` WHERE `type` LIKE 'entrance_exam\\_%' AND `is_active` = 1) AS state_exams,
                   (SELECT COUNT(DISTINCT `type`) FROM `masters` WHERE `type` LIKE 'entrance_exam\\_%') AS states_covered
        """)).mappings().first()

        print(f"rows added: {added} | state lists seeded: {state_types}")
        print("entrance exams:", dict(counts))


if __name__ == "__main__":
    main()
