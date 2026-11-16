"""
Migration: retire the master types that real tables replaced.

`state`, `city` and `stream` rows in the generic `masters` table are dead:

  * state (6 rows)  → superseded by `states` (36, all of India)
  * city (10 rows)  → superseded by `cities` (234, every state)
  * stream (6 rows) → superseded by `streams` (34 rows, 7 canonical values,
                      with per-board labels)

Nothing reads them any more — the /auth/masters compatibility shim serves
`state` and `city` from the new tables, and streams come from /auth/streams.
Leaving them in place is how a codebase ends up with two answers to the same
question: the old `stream` rows say mpc/bipc/cec while the real table stores
canonical values, and a future developer reading `masters` would believe the
wrong one.

Deactivated rather than deleted, so this is reversible and any forgotten reader
fails loudly (empty list) instead of silently getting stale data.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_retire_dead_masters.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

RETIRED = ('state', 'city', 'stream')


def main():
    with app.app_context():
        before = db.session.execute(text("""
            SELECT `type`, COUNT(1) AS n FROM `masters`
             WHERE `type` IN :types AND `is_active` = 1
             GROUP BY `type`
        """).bindparams(types=RETIRED)).mappings().all()

        db.session.execute(text("""
            UPDATE `masters` SET `is_active` = 0 WHERE `type` IN :types
        """).bindparams(types=RETIRED))
        db.session.commit()

        still_active = db.session.execute(text("""
            SELECT COUNT(1) FROM `masters` WHERE `type` IN :types AND `is_active` = 1
        """).bindparams(types=RETIRED)).scalar()

        replacements = db.session.execute(text("""
            SELECT (SELECT COUNT(1) FROM `states` WHERE `is_active` = 1) AS states,
                   (SELECT COUNT(1) FROM `cities` WHERE `is_active` = 1) AS cities,
                   (SELECT COUNT(1) FROM `streams` WHERE `is_active` = 1) AS streams
        """)).mappings().first()

        print("deactivated:", {r['type']: r['n'] for r in before} or "already retired")
        print(f"still active among retired types: {still_active}")
        print("live replacements:", dict(replacements))


if __name__ == "__main__":
    main()
