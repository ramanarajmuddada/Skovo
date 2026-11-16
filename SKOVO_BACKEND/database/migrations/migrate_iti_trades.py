"""
Migration: the full ITI trade master list.

`course_catalogue` held 16 ITI rows, all stamped `degree_category = 'ITI'`,
`degree = 'ITI'` and `duration_years = 2.0`. Three things were wrong with that:

  * the list was a fraction of the real NCVT trade set, so a student whose trade
    was missing had nothing to pick but "Other";
  * every trade claimed two years, which is simply false — Welder, Plumber and
    COPA are one-year trades and Tool & Die Maker is three;
  * there was no Engineering / Non-Engineering split at all, so the two halves
    of the ITI world were indistinguishable in the data.

This seeds the whole list and uses the triple the table was designed around
rather than adding columns for it:

    degree_category  →  Engineering | Non-Engineering   (the spec's split)
    degree           →  trade category                  (Electrical, Automobile…)
    branch           →  trade name                      (Electrician, Welder…)
    duration_years   →  the real duration, NULL where it varies by curriculum
    eligibility      →  NEW column, the only schema change
    is_active        →  the activate / deactivate switch admins drive

Only `eligibility` is added, and it is a COLUMN — no new table (the schema sits
at 249 and must stay there).

Safe on live data: nothing targets ITI (0 cohorts) and exactly one profile was
on the old shape; that row is migrated in step 4. The legacy flat rows are
DEACTIVATED rather than deleted, so nothing that referenced them breaks, and
`sp_course_catalogue_search` already filters on `is_active = 1`.

Idempotent — upserts on (level, degree, branch). Run from SKOVO_BACKEND:
    venv\\Scripts\\python.exe database/migrations/migrate_iti_trades.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/course_catalogue.sql'

# NSQF entry qualification. Most trades moved to 10th pass, so that is the
# default here; it is a starting value, not a claim about every state's rules —
# Admin → ITI Trades is where a wrong one gets corrected.
DEFAULT_ELIGIBILITY = '10th pass'

# What students actually type, per trade. Keyed on the trade name.
ALIASES = {
    'Electrician': 'electrical wiring lineman',
    'Fitter': 'fitting bench work',
    'Turner': 'lathe turning',
    'Machinist': 'machine shop lathe milling',
    'Mechanic (Motor Vehicle)': 'mmv automobile car mechanic auto',
    'Mechanic (Diesel)': 'diesel engine automobile',
    'Mechanic (Tractor)': 'tractor farm agriculture',
    'Refrigeration & Air Conditioning Mechanic': 'rac ac fridge hvac refrigeration airconditioning',
    'Draughtsman (Civil)': 'drafting draftsman civil autocad building',
    'Draughtsman (Mechanical)': 'drafting draftsman mechanical autocad',
    'Instrument Mechanic': 'instrumentation calibration',
    'Electronics Mechanic': 'electronics circuits',
    'Electrician (Power Distribution)': 'power distribution lineman grid electrical',
    'Tool & Die Maker': 'tool die press mould mold',
    'Welder': 'welding arc gas mig tig',
    'Plumber': 'plumbing pipe sanitary',
    'Carpenter': 'carpentry wood furniture',
    'Sheet Metal Worker': 'sheet metal fabrication',
    'Foundryman': 'foundry casting moulding',
    'Wireman': 'wiring electrical house wiring',
    'Painter (General)': 'painting spray paint',
    'COPA': 'copa computer operator programming assistant office computers',
    'Stenographer & Secretarial Assistant': 'steno shorthand typing secretarial english hindi',
    'Desktop Publishing Operator': 'dtp desktop publishing design photoshop coreldraw',
    'Basic Cosmetology': 'beauty parlour beautician hair skin care cosmetology',
    'Sewing Technology': 'sewing stitching tailoring dress making',
    'Fashion Design & Technology': 'fashion designing garment apparel',
    'Food Production (General)': 'cooking chef kitchen catering food',
    'Front Office Assistant': 'front office reception hotel hospitality',
    'Travel & Tour Assistant': 'travel tourism tour guide ticketing',
    'Baker & Confectioner': 'bakery baking confectionery cake pastry',
    'Digital Photographer': 'photography photo camera editing',
    'Interior Design & Decoration': 'interior design decoration home',
    'Fire Technology & Industrial Safety Management': 'fire safety industrial security firefighting',
    'Health Sanitary Inspector': 'health sanitary inspector hygiene public health',
}

# (trade_category, [(trade_name, duration_years)]) per stream.
# duration None = "as per the applicable curriculum", which is the honest value
# for a trade whose length varies; the UI prints that instead of a number.
ENGINEERING = [
    ('Electrical', [
        ('Electrician', 2.0),
        ('Wireman', 2.0),
        ('Electrician (Power Distribution)', 2.0),
    ]),
    ('Electronics', [
        ('Electronics Mechanic', 2.0),
        ('Instrument Mechanic', 2.0),
    ]),
    ('Mechanical', [
        ('Fitter', 2.0),
        ('Turner', 2.0),
        ('Machinist', 2.0),
        ('Tool & Die Maker', 3.0),
        ('Welder', 1.0),
        ('Sheet Metal Worker', 1.0),
        ('Foundryman', 1.0),
    ]),
    ('Automobile', [
        ('Mechanic (Motor Vehicle)', 2.0),
        ('Mechanic (Diesel)', 1.0),
        ('Mechanic (Tractor)', 1.0),
    ]),
    ('Civil & Construction', [
        ('Plumber', 1.0),
        ('Carpenter', 1.0),
        ('Painter (General)', None),
    ]),
    ('Drafting & Design', [
        ('Draughtsman (Civil)', 2.0),
        ('Draughtsman (Mechanical)', 2.0),
    ]),
    ('Refrigeration & Air Conditioning', [
        ('Refrigeration & Air Conditioning Mechanic', 2.0),
    ]),
]

NON_ENGINEERING = [
    ('Computer & Office', [
        ('COPA', 1.0),
        ('Desktop Publishing Operator', 1.0),
        ('Stenographer & Secretarial Assistant', 1.0),
    ]),
    ('Beauty & Wellness', [
        ('Basic Cosmetology', 1.0),
    ]),
    ('Fashion & Apparel', [
        ('Sewing Technology', 1.0),
        ('Fashion Design & Technology', 1.0),
    ]),
    ('Hospitality & Food', [
        ('Food Production (General)', 1.0),
        ('Baker & Confectioner', 1.0),
        ('Front Office Assistant', 1.0),
        ('Travel & Tour Assistant', 1.0),
    ]),
    ('Creative & Design', [
        ('Digital Photographer', 1.0),
        ('Interior Design & Decoration', 1.0),
    ]),
    ('Safety & Health', [
        ('Fire Technology & Industrial Safety Management', 1.0),
        ('Health Sanitary Inspector', 1.0),
    ]),
]

# The catch-all stays. A trade list can never be complete enough to drop it —
# a student whose trade is genuinely missing needs somewhere to land, and the
# row is what tells an admin a trade is worth adding.
OTHER = [('Other', [('Other', None)])]


def _search_text(stream, category, trade):
    """Words the token-prefix search matches against.

    Punctuation is stripped and the de-punctuated form appended, so
    "Draughtsman (Civil)" is findable by "civil", and "R&AC" by "rac".
    """
    parts = [trade, category, stream, ALIASES.get(trade, ''), 'iti']
    plain = ' '.join(p for p in parts if p)
    stripped = (plain.replace('.', '').replace('&', ' ')
                     .replace('(', ' ').replace(')', ' ').replace('/', ' '))
    words = f"{plain} {stripped}".lower().replace('(', ' ').replace(')', ' ')
    return ' '.join(dict.fromkeys(words.split()))[:400]


def add_eligibility_column():
    """The one schema change. A column, not a table."""
    exists = db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.columns
         WHERE table_schema = DATABASE()
           AND table_name = 'course_catalogue'
           AND column_name = 'eligibility'
    """)).scalar()
    if exists:
        return False
    db.session.execute(text("""
        ALTER TABLE `course_catalogue`
          ADD COLUMN `eligibility` VARCHAR(120) NULL AFTER `duration_years`
    """))
    db.session.commit()
    return True


def seed_trades():
    order = 0
    rows = 0
    for stream, groups in (('Engineering', ENGINEERING),
                           ('Non-Engineering', NON_ENGINEERING),
                           ('Other', OTHER)):
        for category, trades in groups:
            for trade, duration in trades:
                order += 10
                display = f'ITI — {trade}'
                db.session.execute(text("""
                    INSERT INTO `course_catalogue`
                        (`id`, `level`, `degree_category`, `degree`, `branch`,
                         `display_name`, `search_text`, `duration_years`,
                         `eligibility`, `sort_order`, `is_active`)
                    VALUES (:i, 'iti', :cat, :deg, :br, :disp, :st, :dur, :el, :o, 1)
                    ON DUPLICATE KEY UPDATE
                        `degree_category` = :cat, `display_name` = :disp,
                        `search_text` = :st, `duration_years` = :dur,
                        `eligibility` = COALESCE(`eligibility`, :el),
                        `sort_order` = :o, `is_active` = 1
                """), {'i': str(uuid.uuid4()), 'cat': stream, 'deg': category,
                       'br': trade, 'disp': display,
                       'st': _search_text(stream, category, trade),
                       'dur': duration, 'el': DEFAULT_ELIGIBILITY, 'o': 2000 + order})
                rows += 1
    db.session.commit()
    return rows


def retire_legacy_rows():
    """Switch off the old flat rows, now that a categorised row exists for each.

    Deactivated rather than deleted: the search already filters on is_active,
    so they vanish from the picker, and anything that recorded one keeps a row
    to point at. Deleting would be the change that cannot be undone.
    """
    res = db.session.execute(text("""
        UPDATE `course_catalogue`
           SET `is_active` = 0
         WHERE `level` = 'iti' AND `degree` = 'ITI'
    """))
    db.session.commit()
    return res.rowcount


def migrate_existing_profiles():
    """Move profiles off the retired shape onto the categorised one.

    A profile stores the course as text (degree_category / degree_type /
    branch), not as a foreign key, so retiring a catalogue row would otherwise
    leave the student describing a course that no longer exists.
    """
    moved = 0
    rows = db.session.execute(text("""
        SELECT `user_id`, `branch`, `iti_trade`
          FROM `user_profiles`
         WHERE `education_category` = 'iti' AND `degree_category` = 'ITI'
    """)).mappings().all()
    for r in rows:
        trade = (r['branch'] or r['iti_trade'] or '').strip()
        if not trade:
            continue
        match = db.session.execute(text("""
            SELECT `degree_category`, `degree` FROM `course_catalogue`
             WHERE `level` = 'iti' AND `is_active` = 1 AND `branch` = :b
             LIMIT 1
        """), {'b': trade}).mappings().first()
        if not match:
            continue
        db.session.execute(text("""
            UPDATE `user_profiles`
               SET `degree_category` = :cat, `degree_type` = :deg
             WHERE `user_id` = :u
        """), {'cat': match['degree_category'], 'deg': match['degree'], 'u': r['user_id']})
        moved += 1
    db.session.commit()
    return moved


def main():
    with app.app_context():
        added = add_eligibility_column()
        print(f"eligibility column: {'added' if added else 'already present'}")

        rows = seed_trades()
        retired = retire_legacy_rows()
        moved = migrate_existing_profiles()
        procs = apply_sql_file(SP_FILE)

        summary = db.session.execute(text("""
            SELECT `degree_category` AS stream, COUNT(*) AS n
              FROM `course_catalogue`
             WHERE `level` = 'iti' AND `is_active` = 1
             GROUP BY `degree_category` ORDER BY `degree_category`
        """)).mappings().all()
        total = sum(s['n'] for s in summary)
        print(f"trades upserted: {rows} | legacy rows retired: {retired} | "
              f"profiles migrated: {moved} | SP statements: {procs}")
        print(f"active ITI trades: {total} -> " +
              ", ".join(f"{s['stream']}: {s['n']}" for s in summary))


if __name__ == "__main__":
    main()
