"""
Migration: remove stale rows left behind by an abandoned taxonomy.

`master_v2_bugfixes.py` (now superseded) seeded `year_ug` / `year_diploma` /
`career_interest` a second time for an old `education_level` scheme
('11th_12th', 'diploma', 'ug', 'graduated') that the current frontend does not
use any more — it was replaced by `onboarding_category`
('school_10th', 'ug', 'pg', ...). That old seed used a different `value`
convention for the same three type names still read by today's UI:

    year_ug        canonical: value='1st Year' .. '5th Year'   (master_data.sql)
                    stale:     value='1' .. '4'                 (migrate_v2_bugfixes.py)
    year_diploma    canonical: value='1st Year' .. '3rd Year'
                    stale:     value='1' .. '3'
    career_interest canonical: 'Software & IT', 'Data Science & AI', ... (20 rows)
                    stale:     'technology', 'finance', ... (12 rows, different wording)

Because the two batches used different `value` strings, the UNIQUE(value)
constraint never caught the overlap — both rows exist, so the Year dropdown
shows every option twice ("1st Year, 2nd Year, 3rd Year, 4th Year, 1st Year,
...") and Career Interests shows old and new wording side by side.

This deletes exactly the stale rows, matched by the literal (type, value)
pairs the old migration inserted — nothing fuzzy, nothing guessed. Any student
who already picked a stale value (e.g. year_of_study='2') keeps that value on
their profile; only the dropdown's own list is cleaned up.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_dedupe_year_masters.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

# table -> stale values to remove (the old, now-abandoned convention)
STALE = {
    'master_year_ug':        ['1', '2', '3', '4'],
    'master_year_diploma':   ['1', '2', '3'],
    'master_career_interest': [
        'technology', 'finance', 'management', 'design', 'marketing',
        'healthcare', 'government', 'research', 'law', 'media',
        'education', 'entrepreneurship',
    ],
}


def main():
    with app.app_context():
        total = 0
        for table, values in STALE.items():
            exists = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
            ), {'t': table}).scalar()
            if not exists:
                print(f'{table}: table not found — skipped')
                continue

            res = db.session.execute(
                text(f"DELETE FROM `{table}` WHERE `value` IN :vals").bindparams(
                    db.bindparam('vals', expanding=True)),
                {'vals': values},
            )
            print(f'{table}: removed {res.rowcount} stale row(s)')
            total += res.rowcount

        db.session.commit()
        print(f'\ndone — {total} stale row(s) removed')

        # ── verify: no duplicate labels remain in the affected tables ────────
        bad = []
        for table in STALE:
            exists = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.TABLES "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
            ), {'t': table}).scalar()
            if not exists:
                continue
            dupes = db.session.execute(text(
                f"SELECT `label`, COUNT(*) c FROM `{table}` "
                f"WHERE `is_active` = 1 GROUP BY `label` HAVING c > 1"
            )).all()
            if dupes:
                bad.append((table, dupes))
        if bad:
            print('\nSTILL DUPLICATED:')
            for table, dupes in bad:
                for label, c in dupes:
                    print(f'   {table}: "{label}" x{c}')
        else:
            print('verified: no duplicate labels remain in year_ug / year_diploma / career_interest')


if __name__ == '__main__':
    main()
