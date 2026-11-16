"""
Migration: make the predictor's category filter actually match.

The reservation dropdown is fed by masters.category — general / obc / sc / st /
ews. The cutoff rows were loaded with the Telugu-state spellings — OC / BC / SC.
sp_college_predict compares them with `category = p_category`, so:

    student picks          rows matched
    General / OC           0
    OBC / BC               0
    ST                     0
    EWS                    0
    SC                     1   (only because the collation is case-insensitive)

Four of five categories returned "no colleges found" — not because the rank was
wrong, but because the two halves of the system spell the same fact differently.

This rewrites the cutoff rows onto the master vocabulary. It is the cutoff side
that moves, not the dropdown: masters.category is what profiles, scholarships
and the Score Engine already store, so bending those to OC/BC would spread the
problem instead of ending it.

Idempotent — re-running finds nothing left to map. Prints a before/after count
so the effect is visible, and refuses to run if it would leave rows unmapped.

Run from SKOVO_BACKEND:
    python migrate_cutoff_categories.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db

app = InitApp().app()

# Telugu-state spelling -> the master value the rest of the app stores.
# OC (Open Category) is what AP/TS call the general pool; BC (Backward Classes)
# maps onto OBC. EWS has no state-form equivalent in this data.
MAPPING = {
    'OC': 'general',
    'GENERAL': 'general',
    'BC': 'obc',
    'BC-A': 'obc', 'BC-B': 'obc', 'BC-C': 'obc', 'BC-D': 'obc', 'BC-E': 'obc',
    'OBC': 'obc',
    'SC': 'sc',
    'ST': 'st',
    'EWS': 'ews',
}


def main():
    with app.app_context():
        valid = {r[0] for r in db.session.execute(text(
            "SELECT value FROM master_category WHERE is_active = 1")).fetchall()}
        print(f'master vocabulary: {sorted(valid)}\n')

        before = db.session.execute(text(
            "SELECT category, COUNT(*) FROM cg_college_cutoffs GROUP BY category ORDER BY category"
        )).fetchall()
        print('cutoff categories before:')
        for cat, n in before:
            state = 'ok' if cat in valid else 'UNMATCHED'
            print(f'  {str(cat):12} {n:5}  {state}')

        unknown = [c for c, _ in before if c not in valid and str(c).upper() not in MAPPING]
        if unknown:
            raise SystemExit(
                f'\nRefusing to run — no mapping for: {unknown}\n'
                'Add them to MAPPING first; a silent partial rewrite is worse '
                'than the bug it is fixing.')

        changed = 0
        for old, new in MAPPING.items():
            # BINARY on the skip-guard: the column's collation is
            # case-insensitive, so a plain `category <> 'sc'` is FALSE for a
            # stored 'SC' and the row is skipped as "already correct" while
            # still holding the wrong casing.
            n = db.session.execute(text("""
                UPDATE `cg_college_cutoffs`
                   SET `category` = :new
                 WHERE UPPER(TRIM(`category`)) = :old
                   AND BINARY `category` <> :new
            """), {'old': old, 'new': new}).rowcount
            if n:
                print(f'\n  {old:8} -> {new:8}  {n} row(s)')
                changed += n
        db.session.commit()

        after = db.session.execute(text(
            "SELECT category, COUNT(*) FROM cg_college_cutoffs GROUP BY category ORDER BY category"
        )).fetchall()
        print('\ncutoff categories after:')
        leftover = []
        for cat, n in after:
            ok = cat in valid          # exact, case-sensitive membership
            if not ok:
                leftover.append(cat)
            print(f'  {str(cat):12} {n:5}  {"ok" if ok else "STILL UNMATCHED"}')

        if leftover:
            raise SystemExit(f'\nFAILED — still unmapped: {leftover}')

        print(f'\nRewrote {changed} row(s). Every cutoff category now matches a master value.')


if __name__ == '__main__':
    main()
