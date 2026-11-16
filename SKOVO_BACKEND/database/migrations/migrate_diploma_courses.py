"""
Migration: the full Polytechnic Diploma branch list.

`course_catalogue` held 11 diploma rows — Civil, Mechanical, Electrical,
Electronics & Communication, Computer Science, Information Technology,
Chemical, Automobile, Mining, Textile and Other — all stamped
`degree_category = 'Polytechnic'`. Two things were wrong with that:

  * the list was a fraction of the real polytechnic branch set, so a student on
    AI & ML, Cyber Security, DCCP, Hotel Management or Fashion Technology had
    nothing to pick but "Other";
  * every row shared one category, so the picker's grey sub-label read
    "Polytechnic" on all eleven and carried no information. The spec's four
    groups had nowhere to live.

This seeds the whole list using the triple the table was designed around —
no new columns and no new tables (see the 236-table ceiling):

    degree_category  →  Engineering & Technology | Modern & Emerging Tech
                        | Commercial & Management | Design & Creative Arts
    degree           →  'Diploma'                 (drives the display name)
    branch           →  the branch                (Mechanical Engineering…)
    duration_years   →  3.0 across the board, which is what the spec states

Branch names change ("Mechanical" → "Mechanical Engineering"), so the eleven
legacy rows cannot be upserted in place — the unique key is
(level, degree, branch). They are DEACTIVATED rather than deleted, exactly as
migrate_iti_trades.py retired the flat ITI rows: `sp_course_catalogue_search`
already filters on `is_active = 1`, so they vanish from the picker while
anything that recorded one keeps a row to point at.

"Other" is deliberately kept active, re-stamped into its own category. It is
the escape hatch for a branch this list misses, and the course field is
required — without it such a student cannot finish onboarding at all.

Safe on live data: 0 profiles are on `education_category = 'polytechnic'` and
none carry `degree_category = 'Polytechnic'`, so no profile rewrite is needed
and none is attempted.

Idempotent — upserts on (level, degree, branch). Run from SKOVO_BACKEND:
    venv\\Scripts\\python.exe database/migrations/migrate_diploma_courses.py
"""
import uuid

from sqlalchemy import bindparam, text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal.models import db   # the handle only — create_all() runs from InitApp

DURATION = 3.0
ELIGIBILITY = '10th pass'

# Branch names the legacy rows used. Retired by name rather than by a blanket
# "deactivate every diploma row" so a branch an admin added by hand survives.
LEGACY_BRANCHES = [
    'Civil', 'Mechanical', 'Electrical', 'Electronics & Communication',
    'Computer Science', 'Information Technology', 'Chemical', 'Automobile',
    'Mining', 'Textile',
]

# What students actually type, per branch. The abbreviations matter more than
# the full names here — a polytechnic student searches "cse", "ece", "eee" or
# "dccp", never "Computer Science & Engineering". Without these the token
# search returns nothing and the field looks broken.
CATEGORIES = [
    ('Engineering & Technology', [
        ('Mechanical Engineering',                      'mech'),
        ('Electrical & Electronics Engineering (EEE)',  'eee electrical electronics power'),
        ('Civil Engineering',                           'civil construction'),
        ('Computer Science & Engineering (CSE)',        'cse computers computer science cs'),
        ('Electronics & Communication Engineering (ECE)', 'ece electronics communication'),
        ('Automobile Engineering',                      'auto automotive vehicle'),
        ('Information Technology (IT)',                 'it infotech information'),
        ('Chemical Engineering',                        'chem chemicals'),
        ('Mining Engineering',                          'mine mines'),
        ('Metallurgical Engineering',                   'metallurgy metal materials'),
        # No "aircraft" alias: tokens match on word-start, so it would make
        # "ai" return Aeronautical above Artificial Intelligence.
        ('Aeronautical Engineering',                    'aero aerospace aviation'),
        ('Biomedical Engineering',                      'biomedical bme medical electronics'),
        ('Instrumentation & Control Engineering',       'instrumentation control ic eie'),
        ('Mechatronics Engineering',                    'mechatronics robotics automation'),
        ('Textile Technology',                          'textile fabric'),
        ('Agricultural Engineering',                    'agri agriculture farm'),
        ('Petroleum Engineering',                       'petroleum oil gas petro'),
    ]),
    ('Modern & Emerging Tech', [
        ('Artificial Intelligence (AI) & Machine Learning (ML)',
                                                        'ai ml artificial intelligence machine learning data'),
        ('Cyber Security',                              'cyber security infosec hacking network'),
        ('Cloud Computing & Big Data',                  'cloud big data devops aws azure'),
        ('Animation & Multimedia',                      'animation multimedia vfx graphics design'),
    ]),
    ('Commercial & Management', [
        ('Commercial & Computer Practice (DCCP)',       'dccp commercial computer practice office'),
        ('Hotel Management & Catering Technology',      'hotel catering hm hmct hospitality chef'),
        ('Travel & Tourism Management',                 'travel tourism tour'),
        ('Material Management',                         'material materials supply chain logistics'),
    ]),
    ('Design & Creative Arts', [
        ('Fashion Technology / Garment Technology',     'fashion garment apparel clothing dress'),
        ('Interior Design & Decoration',                'interior design decoration decor'),
        ('Textile Designing',                           'textile design print'),
    ]),
]


def _search_text(category, branch, aliases):
    """Words the token-prefix search matches against.

    Punctuation is stripped and the de-punctuated form appended, so
    "Computer Science & Engineering (CSE)" is findable by "cse", and
    "Fashion Technology / Garment Technology" by "garment". Duplicates are
    dropped because the column is VARCHAR(400) and the long branch names here
    repeat "engineering" and "technology" heavily.
    """
    parts = ['diploma', branch, category, aliases, 'polytechnic']
    plain = ' '.join(p for p in parts if p)
    stripped = (plain.replace('.', '').replace('&', ' ')
                     .replace('(', ' ').replace(')', ' ').replace('/', ' '))
    words = f"{plain} {stripped}".lower().replace('(', ' ').replace(')', ' ')
    return ' '.join(dict.fromkeys(words.split()))[:400]


def seed_branches():
    order = 0
    rows = 0
    for category, branches in CATEGORIES:
        for branch, aliases in branches:
            order += 10
            db.session.execute(text("""
                INSERT INTO `course_catalogue`
                    (`id`, `level`, `degree_category`, `degree`, `branch`,
                     `display_name`, `search_text`, `duration_years`,
                     `eligibility`, `sort_order`, `is_active`)
                VALUES (:i, 'diploma', :cat, 'Diploma', :br, :disp, :st, :dur, :el, :o, 1)
                ON DUPLICATE KEY UPDATE
                    `degree_category` = :cat, `display_name` = :disp,
                    `search_text` = :st, `duration_years` = :dur,
                    `eligibility` = COALESCE(`eligibility`, :el),
                    `sort_order` = :o, `is_active` = 1
            """), {'i': str(uuid.uuid4()), 'cat': category, 'br': branch,
                   'disp': f'Diploma — {branch}',
                   'st': _search_text(category, branch, aliases),
                   'dur': DURATION, 'el': ELIGIBILITY, 'o': 1770 + order})
            rows += 1
    db.session.commit()
    return rows


def retire_legacy_rows():
    """Switch off the eleven old rows now that a categorised row supersedes each.

    Deactivated rather than deleted: the search already filters on is_active,
    so they leave the picker, and deleting would be the change that cannot be
    undone. "Other" is excluded — it is still the escape hatch.
    """
    res = db.session.execute(text("""
        UPDATE `course_catalogue`
           SET `is_active` = 0
         WHERE `level` = 'diploma'
           AND `degree` = 'Diploma'
           AND `branch` IN :legacy
    """).bindparams(bindparam('legacy', expanding=True)), {'legacy': LEGACY_BRANCHES})
    db.session.commit()
    return res.rowcount


def restamp_other():
    """Keep "Other" pickable, but out of the four real categories.

    Left under 'Polytechnic' it would print a category that no longer exists
    anywhere else in the list.
    """
    res = db.session.execute(text("""
        UPDATE `course_catalogue`
           SET `degree_category` = 'Other',
               `display_name`    = 'Diploma — Other',
               `search_text`     = 'diploma other polytechnic none not listed',
               `duration_years`  = :dur,
               `sort_order`      = 2190,
               `is_active`       = 1
         WHERE `level` = 'diploma' AND `degree` = 'Diploma' AND `branch` = 'Other'
    """), {'dur': DURATION})
    db.session.commit()
    return res.rowcount


def check_profiles():
    """Guard rail, not a migration step.

    The branch renames are only safe while nothing has stored the old spelling.
    If that stops being true between writing this and running it, say so loudly
    rather than leaving profiles pointing at a deactivated row.
    """
    return db.session.execute(text("""
        SELECT COUNT(*) FROM `user_profiles`
         WHERE `education_category` = 'polytechnic'
            OR `degree_category` = 'Polytechnic'
    """)).scalar()


def main():
    # Imported here, not at module scope: InitApp() runs db.create_all(), so a
    # plain `import migrate_diploma_courses` would touch the schema as a side
    # effect. Keeping it inside main() makes the pure parts — _search_text and
    # the branch list — importable and testable without booting anything.
    from portal import InitApp
    app = InitApp().app()

    with app.app_context():
        stranded = check_profiles()
        if stranded:
            print(f"WARNING: {stranded} profile(s) are on the old diploma shape. "
                  f"They will keep their text values but point at a retired row — "
                  f"review before treating this migration as complete.")

        rows = seed_branches()
        retired = retire_legacy_rows()
        other = restamp_other()

        summary = db.session.execute(text("""
            SELECT `degree_category` AS category, COUNT(*) AS n
              FROM `course_catalogue`
             WHERE `level` = 'diploma' AND `is_active` = 1
             GROUP BY `degree_category` ORDER BY MIN(`sort_order`)
        """)).mappings().all()
        total = sum(s['n'] for s in summary)
        print(f"branches upserted: {rows} | legacy rows retired: {retired} | "
              f"'Other' re-stamped: {other}")
        print(f"active diploma branches: {total} -> " +
              ", ".join(f"{s['category']}: {s['n']}" for s in summary))


if __name__ == "__main__":
    main()
