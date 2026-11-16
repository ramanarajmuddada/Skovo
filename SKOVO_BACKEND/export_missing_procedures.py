"""
Export stored procedures that exist in the live database but not in this repo.

Why this exists: 78 procedures — including the whole Score Engine, DPDP consent,
DMs, Market and the v1 metric queries — were applied to the database by hand and
never written back to source. `database/` is supposed to be the thing you can
rebuild a schema from; without these it produces a database where the anchor
mechanic, consent capture and messaging all fail at runtime while the build
stays green.

Run from SKOVO_BACKEND:
    python export_missing_procedures.py

Writes one file per functional area into database/stored_procedures/exported/.
Re-running is safe: every file is regenerated from the live definition, and
every procedure is DROP ... IF EXISTS before CREATE, so applying them is
idempotent too.
"""
import collections
import logging
import pathlib
import re

from sqlalchemy import text

from portal import InitApp
from portal.models import db

logging.disable(logging.INFO)
app = InitApp().app()

OUT_DIR = pathlib.Path('database/stored_procedures/exported')

# Which file each procedure lands in. First matching prefix wins; anything
# unmatched goes to misc.sql rather than being silently dropped.
GROUPS = [
    ('score',            ('sp_score_',)),
    ('consent_dpdp',     ('sp_parental_consent_', 'sp_consent_', 'sp_user_set_dob')),
    ('assemble_dm',      ('sp_dm_',)),
    ('market',           ('sp_market_',)),
    ('opportunities',    ('sp_opp_', 'sp_applicant_export', 'sp_employers_')),
    ('colleges',         ('sp_saved_colleges_', 'sp_college_predict', 'sp_cutoff_')),
    ('cohorts_courses',  ('sp_cohort_', 'sp_course_', 'sp_attendance_code_', 'sp_achiever_coupon_')),
    ('metrics',          ('sp_metrics_',)),
    ('admin_config',     ('sp_admin_role', 'sp_subscription_plan')),
    ('document_vault',   ('sp_docvault_', 'sp_public_profile_')),
]


def group_for(name):
    for fname, prefixes in GROUPS:
        if any(name.startswith(p) for p in prefixes):
            return fname
    return 'misc'


def called_in_code():
    names = set()
    for f in pathlib.Path('portal').rglob('*.py'):
        if '__pycache__' in f.parts:
            continue
        names |= set(re.findall(r"call_proc(?:_one)?\(\s*['\"]([a-zA-Z0-9_]+)['\"]",
                                f.read_text(encoding='utf-8', errors='replace')))
    return names


def defined_in_repo():
    names = set()
    for f in pathlib.Path('database').rglob('*.sql'):
        if OUT_DIR in f.parents:
            continue                      # don't count what we are about to write
        names |= set(re.findall(r"CREATE PROCEDURE\s+`?([a-zA-Z0-9_]+)`?",
                                f.read_text(encoding='utf-8', errors='replace')))
    return names


def signature(name):
    """`IN p_user CHAR(36), IN p_limit INT` — rebuilt from information_schema."""
    rows = db.session.execute(text("""
        SELECT PARAMETER_MODE, PARAMETER_NAME, DTD_IDENTIFIER
          FROM information_schema.PARAMETERS
         WHERE SPECIFIC_SCHEMA = DATABASE() AND SPECIFIC_NAME = :n
           AND PARAMETER_NAME IS NOT NULL
         ORDER BY ORDINAL_POSITION
    """), {'n': name}).fetchall()
    return ', '.join(f"{(m or 'IN').upper()} `{p}` {t}" for m, p, t in rows)


def main():
    with app.app_context():
        in_db = {r[0] for r in db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'")).fetchall()}

        missing = sorted((called_in_code() & in_db) - defined_in_repo())
        if not missing:
            print('Nothing to export — every called procedure is already in source.')
            return

        buckets = collections.defaultdict(list)
        for name in missing:
            buckets[group_for(name)].append(name)

        OUT_DIR.mkdir(parents=True, exist_ok=True)
        total = 0

        for fname, names in sorted(buckets.items()):
            parts = [
                f"-- SKOVO — {fname.replace('_', ' ')} procedures.\n"
                "--\n"
                "-- Exported from the live schema by export_missing_procedures.py. These were\n"
                "-- applied to the database by hand and never written back to source, so a\n"
                "-- rebuild from this repo produced a database missing them.\n"
                "--\n"
                "-- Edit here, not in the database.\n"
                "\nDELIMITER $$\n"
            ]
            for name in names:
                body = db.session.execute(text(
                    "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES "
                    "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"),
                    {'n': name}).scalar()
                if not body:
                    print(f'  !! no body for {name} — skipped')
                    continue
                parts.append(
                    f"\nDROP PROCEDURE IF EXISTS `{name}`$$\n"
                    f"CREATE PROCEDURE `{name}`({signature(name)})\n"
                    f"{body.strip()}$$\n"
                )
                total += 1
            parts.append("\nDELIMITER ;\n")

            path = OUT_DIR / f'{fname}.sql'
            path.write_text(''.join(parts), encoding='utf-8')
            print(f'  {path}  ({len(names)} procedures)')

        print(f'\nExported {total} procedure(s) into {OUT_DIR}/')


if __name__ == '__main__':
    main()
