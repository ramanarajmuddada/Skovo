"""
Migration: split the single `masters` key/value table into one table per dropdown.

Founder call: every dropdown gets its own master table rather than sharing one
`masters` table keyed by a `type` column. 122 types in, 122 `master_*` tables out.

    masters(type='cohort_status', value='live',  label='Live')
      ->  master_cohort_status(value='live', label='Live')

Each new table keeps the exact column set the old one had, so nothing is lost and
the API response shape does not change — `/auth/masters` still returns
`{grouped: {type: [{value, label}]}}`, it just reads a different table per type.

`master_registry` maps a dropdown's type name to its table. It is what makes the
generic CRUD procedures safe: they look the table name up there instead of
interpolating caller input into dynamic SQL, so `?types=x; DROP TABLE y` resolves
to nothing rather than to a statement.

The old `masters` table is deliberately LEFT IN PLACE. Verify the split in an
environment first; dropping it is a separate, one-line decision you make later.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python migrate_split_master_tables.py
"""
import sys

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

PREFIX = 'master_'

REGISTRY_DDL = """
CREATE TABLE IF NOT EXISTS `master_registry` (
  `id`          CHAR(36)     NOT NULL,
  `type`        VARCHAR(64)  NOT NULL,
  `table_name`  VARCHAR(80)  NOT NULL,
  `label`       VARCHAR(150) NOT NULL,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_master_registry_type` (`type`),
  UNIQUE KEY `uq_master_registry_table` (`table_name`)
-- COLLATE must be stated: `masters` is utf8mb4_unicode_ci, but the server's
-- default for utf8mb4 is utf8mb4_0900_ai_ci. Without this the copy below fails
-- with "Illegal mix of collations" the moment it compares a value across the two.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# Same columns as `masters` minus `type` — the table name now carries that.
# UNIQUE on value: two rows with the same value in one dropdown is always a bug,
# and the old shared table could not express that constraint per type.
TABLE_DDL = """
CREATE TABLE IF NOT EXISTS `{table}` (
  `id`          CHAR(36)     NOT NULL,
  `value`       VARCHAR(100) NOT NULL,
  `label`       VARCHAR(150) NOT NULL,
  `sort_order`  INT          NULL DEFAULT 0,
  `is_active`   TINYINT(1)   NULL DEFAULT 1,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by`  CHAR(36)     NULL,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                             ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`  CHAR(36)     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{table}_value` (`value`),
  KEY `ix_{table}_active` (`is_active`, `sort_order`)
-- COLLATE must be stated: `masters` is utf8mb4_unicode_ci, but the server's
-- default for utf8mb4 is utf8mb4_0900_ai_ci. Without this the copy below fails
-- with "Illegal mix of collations" the moment it compares a value across the two.
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def table_for(mtype):
    return PREFIX + mtype.lower()


def humanise(mtype):
    """'cohort_status' -> 'Cohort Status', for the admin dropdown-picker list."""
    return mtype.replace('_', ' ').title()


def main():
    with app.app_context():
        types = [r[0] for r in db.session.execute(
            text("SELECT DISTINCT `type` FROM `masters` ORDER BY `type`")).all()]
        if not types:
            print('no rows in `masters` — nothing to split'); return

        # Guard: a type that cannot be a safe identifier must never reach DDL.
        unsafe = [t for t in types if not t.replace('_', '').isalnum() or len(table_for(t)) > 64]
        if unsafe:
            print(f'ABORT — unsafe type names: {unsafe}'); sys.exit(1)

        # An earlier run could have created tables under the server's default
        # collation. Those can never be copied into, so drop the empty ones and
        # let the corrected DDL below rebuild them. Anything holding rows is left
        # alone and reported rather than silently destroyed.
        wrong = db.session.execute(text("""
            SELECT TABLE_NAME FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME LIKE :p
               AND TABLE_COLLATION <> 'utf8mb4_unicode_ci'
        """), {'p': PREFIX + '%'}).scalars().all()
        for tbl in wrong:
            n = db.session.execute(text(f"SELECT COUNT(*) FROM `{tbl}`")).scalar()
            if n:
                print(f'WARNING {tbl} has the wrong collation but holds {n} rows — left alone')
                continue
            db.session.execute(text(f"DROP TABLE `{tbl}`"))
        if wrong:
            print(f'rebuilt {len(wrong)} table(s) created with the wrong collation')
        db.session.commit()

        db.session.execute(text(REGISTRY_DDL))
        db.session.commit()

        created = copied = skipped = 0
        for mtype in types:
            table = table_for(mtype)
            db.session.execute(text(TABLE_DDL.format(table=table)))

            # Copy only rows this table does not already hold, so a re-run after a
            # partial failure fills the gap instead of erroring on the unique key.
            res = db.session.execute(text(f"""
                INSERT INTO `{table}`
                    (id, value, label, sort_order, is_active,
                     created_at, created_by, updated_at, updated_by)
                SELECT m.id, m.value, m.label, m.sort_order, m.is_active,
                       m.created_at, m.created_by, m.updated_at, m.updated_by
                  FROM `masters` m
                 WHERE m.`type` = :t
                   AND NOT EXISTS (SELECT 1 FROM `{table}` x WHERE x.value = m.value)
            """), {'t': mtype})
            copied += res.rowcount
            if res.rowcount:
                created += 1
            else:
                skipped += 1

            db.session.execute(text("""
                INSERT INTO `master_registry` (id, type, table_name, label, is_active)
                VALUES (UUID(), :t, :tbl, :lbl, 1)
                ON DUPLICATE KEY UPDATE table_name = VALUES(table_name),
                                        label      = VALUES(label)
            """), {'t': mtype, 'tbl': table, 'lbl': humanise(mtype)})

        db.session.commit()
        print(f'tables ensured: {len(types)}   rows copied: {copied}   '
              f'(tables already full: {skipped})')

        # ── verify row-for-row against the source ───────────────────────────
        bad, grown = [], []
        for mtype in types:
            table = table_for(mtype)
            src = db.session.execute(
                text("SELECT COUNT(*) FROM `masters` WHERE `type` = :t"), {'t': mtype}).scalar()
            dst = db.session.execute(text(f"SELECT COUNT(*) FROM `{table}`")).scalar()
            # A shortfall means the copy lost rows and this migration failed.
            # A surplus does not: `masters` is the frozen legacy source, while
            # the split tables keep being seeded by later migrations
            # (migrate_ap_telangana_masters and friends add exams that were
            # never in `masters` at all). Strict equality flagged all eight of
            # those as corruption and exited 1, failing every deploy after the
            # first seeding migration landed.
            if dst < src:
                bad.append((mtype, src, dst))
            elif dst > src:
                grown.append((mtype, src, dst))
        if bad:
            print(chr(10) + 'ROWS MISSING AFTER COPY:')
            for t, s, d in bad:
                print(f'   {t:<32} masters={s}  {table_for(t)}={d}')
            sys.exit(1)
        if grown:
            print(chr(10) + 'seeded beyond `masters` (expected, not an error):')
            for t, s, d in grown:
                print(f'   {t:<32} masters={s}  {table_for(t)}={d}')

        total_new = db.session.execute(text(
            "SELECT SUM(cnt) FROM (SELECT table_name, "
            "(SELECT COUNT(*) FROM master_registry) AS cnt FROM master_registry LIMIT 1) x")).scalar()
        old_rows = db.session.execute(text("SELECT COUNT(*) FROM `masters`")).scalar()
        reg = db.session.execute(text("SELECT COUNT(*) FROM `master_registry`")).scalar()
        print(f'verified: no type lost rows in the copy')
        print(f'registry: {reg} master tables   |   source `masters` still holds {old_rows} rows')


if __name__ == '__main__':
    main()
