"""
Migration: the remaining hardcoded option lists become master data.

These are flat label lists with no children and no attributes of their own, so
they belong in `masters` rather than a table each — the split is "has children
or attributes → own table (states, boards, streams, course_catalogue);
just a label → masters".

Fills three real gaps:
  career_interest — had ZERO rows, so the Profile page's Career Interests card
                    rendered empty for every student and onboarding never asked.
  year_*          — Profile.jsx looks up `year_<level>` types that did not
                    exist, so its Year dropdown never rendered at all.
  industry / experience_range / prep_stage — lived only inside OnboardingModal.jsx.

Idempotent — upserts by (type, value). Run from SKOVO_BACKEND:
    python migrate_flat_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

LISTS = {
    'career_interest': [
        'Software & IT', 'Data Science & AI', 'Core Engineering', 'Medicine & Healthcare',
        'Finance & Banking', 'Chartered Accountancy', 'Consulting & Strategy', 'Marketing & Sales',
        'Design & Creative', 'Media & Journalism', 'Law & Legal', 'Government & Civil Services',
        'Defence & Armed Forces', 'Teaching & Academia', 'Research & Development',
        'Entrepreneurship & Startups', 'Agriculture & Allied', 'Hospitality & Tourism',
        'Sports & Fitness', 'Social Impact & NGO',
    ],
    'industry': [
        'IT / Software', 'Healthcare', 'Finance / Banking', 'Manufacturing', 'Education',
        'Media / Entertainment', 'Retail / E-commerce', 'Government / PSU', 'Agriculture',
        'Consulting', 'Telecom', 'Construction / Real Estate', 'Logistics', 'Other',
    ],
    'experience_range': ['0-1 yr', '1-3 yrs', '3-5 yrs', '5-10 yrs', '10+ yrs'],

    # Year of study, per stage. Namespaced because the options genuinely differ.
    'year_school':    ['Class 9', 'Class 10', 'Class 11', 'Class 12'],
    'year_iti':       ['1st Year', '2nd Year'],
    'year_diploma':   ['1st Year', '2nd Year', '3rd Year'],
    'year_ug':        ['1st Year', '2nd Year', '3rd Year', '4th Year'],
    'year_pg':        ['1st Year', '2nd Year', '3rd Year'],
    'year_phd':       ['1st Year', '2nd Year', '3rd Year', '4th+ Year'],
    'year_professional': ['Foundation', 'Intermediate', 'Final', 'Qualified'],

    # Where an exam aspirant is in their preparation.
    'prep_stage': ['Just starting', 'Preparing', 'Appeared — awaiting result',
                   'Cleared Prelims', 'Cleared Mains / Final', 'Repeating / Dropper'],
}


def upsert(mtype, value, label, order):
    row = db.session.execute(text("SELECT `id` FROM `masters` WHERE `type` = :t AND `value` = :v"),
                             {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(text("UPDATE `masters` SET `label` = :l, `sort_order` = :s, `is_active` = 1 WHERE `id` = :i"),
                           {'l': label, 's': order, 'i': row[0]})
    else:
        db.session.execute(text("""
            INSERT INTO `masters` (`id`, `type`, `value`, `label`, `sort_order`, `is_active`)
            VALUES (:i, :t, :v, :l, :s, 1)
        """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 's': order})


def main():
    with app.app_context():
        for mtype, values in LISTS.items():
            for i, value in enumerate(values):
                upsert(mtype, value, value, (i + 1) * 10)
        db.session.commit()

        counts = db.session.execute(text("""
            SELECT `type`, COUNT(*) AS n FROM `masters`
             WHERE `type` IN :types AND `is_active` = 1
             GROUP BY `type` ORDER BY `type`
        """).bindparams(types=tuple(LISTS.keys()))).mappings().all()
        print("flat masters seeded:", {c['type']: c['n'] for c in counts})


if __name__ == "__main__":
    main()
