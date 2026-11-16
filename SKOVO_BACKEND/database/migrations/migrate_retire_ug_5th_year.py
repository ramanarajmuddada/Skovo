"""
Migration: retire the "5th Year" option from the UG year-of-study dropdown.

`master_year_ug` shipped with five options, but a UG degree in the catalogue
never runs past four years — the fifth row only ever gave students a way to
record a year that does not exist, and it showed up in Student Portal >
Profile > Edit Profile > Education. The other four options are unchanged.

Deactivated rather than deleted, matching migrate_retire_dead_masters.py:
`sp_master_list` is called with p_active_only = 1 for every public dropdown, so
is_active = 0 is enough to remove it from the UI, and the row (with its stable
id) is still there if the decision is ever reversed.

Student data is untouched. `user_profiles.year_of_study` is a plain VARCHAR
with no FK to the master table and no server-side whitelist, so a student who
already picked '5th Year' keeps that value and still sees it on their profile —
only the dropdown's own list changes. This is the same contract
migrate_dedupe_year_masters.py kept for the stale year rows.

The legacy flat `masters` table gets the same treatment when it is still around,
so an environment that has not run migrate_split_master_tables.py is consistent.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_retire_ug_5th_year.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db

app = InitApp().app()

VALUE = '5th Year'


def _table_exists(name):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"
    ), {'t': name}).scalar()


def main():
    with app.app_context():
        if _table_exists('master_year_ug'):
            res = db.session.execute(text(
                "UPDATE `master_year_ug` SET `is_active` = 0 "
                "WHERE `value` = :v AND `is_active` = 1"
            ), {'v': VALUE})
            print(f'master_year_ug: deactivated {res.rowcount} row(s)')
        else:
            print('master_year_ug: table not found — skipped')

        if _table_exists('masters'):
            res = db.session.execute(text(
                "UPDATE `masters` SET `is_active` = 0 "
                "WHERE `type` = 'year_ug' AND `value` = :v AND `is_active` = 1"
            ), {'v': VALUE})
            print(f'masters (legacy flat): deactivated {res.rowcount} row(s)')
        else:
            print('masters (legacy flat): table not found — skipped')

        db.session.commit()

        # ── verify: the dropdown the API will serve ──────────────────────────
        if _table_exists('master_year_ug'):
            live = db.session.execute(text(
                "SELECT `value` FROM `master_year_ug` WHERE `is_active` = 1 "
                "ORDER BY `sort_order`, `label`")).scalars().all()
            print('year_ug now offers:', live)
            assert VALUE not in live, f'{VALUE} is still active in master_year_ug'


if __name__ == '__main__':
    main()
