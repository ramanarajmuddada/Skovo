"""
Migration: cohort duration and seat count as master data.

Both were hardcoded in sixteen places — nine in the web cohort form, three in the
mobile one, two in the API and two as column defaults. Changing 90 to 60 meant
editing all sixteen, and missing one left the form showing a number the API would
not honour.

Duration is a genuinely fixed set (a session is 30/45/60/90/120/180 minutes), so
it becomes a dropdown. Seats are rounder than they look in practice, and an admin
can add a value without a deploy — but say so if you want free entry back and the
field returns to a number input with the default sourced from here.

Idempotent. Run from anywhere:
    python database/migrations/migrate_cohort_defaults_masters.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

LISTS = {
    # sort_order puts the current default first, so a blank form still opens on
    # the value the API would have chosen anyway.
    'cohort_duration': [
        ('90', '90 minutes'), ('60', '60 minutes'), ('45', '45 minutes'),
        ('30', '30 minutes'), ('120', '2 hours'), ('180', '3 hours'),
    ],
    'cohort_seats': [
        ('50', '50 seats'), ('25', '25 seats'), ('30', '30 seats'),
        ('75', '75 seats'), ('100', '100 seats'), ('200', '200 seats'),
    ],
}


TABLE_DDL = """
CREATE TABLE IF NOT EXISTS `{table}` (
  `id`         CHAR(36)     NOT NULL,
  `value`      VARCHAR(100) NOT NULL,
  `label`      VARCHAR(150) NOT NULL,
  `sort_order` INT          NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36)     NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                            ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36)     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{table}_value` (`value`),
  KEY `ix_{table}_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def ensure_type(mtype):
    """Create the table and register it. The original split migration built these
    from the old shared `masters` table, which no longer exists — a brand new
    dropdown has to make its own."""
    table = 'master_' + mtype
    db.session.execute(text(TABLE_DDL.format(table=table)))
    db.session.execute(text("""
        INSERT INTO `master_registry` (id, type, table_name, label, is_active)
        VALUES (UUID(), :t, :tbl, :lbl, 1)
        ON DUPLICATE KEY UPDATE table_name = VALUES(table_name)
    """), {'t': mtype, 'tbl': table, 'lbl': mtype.replace('_', ' ').title()})
    db.session.commit()


def main():
    with app.app_context():
        for mtype in LISTS:
            ensure_type(mtype)
        added = 0
        for mtype, entries in LISTS.items():
            for order, (value, label) in enumerate(entries):
                res = db.session.execute(
                    text("CALL sp_master_create(:t, :i, :v, :l, :s, NULL)"),
                    {'t': mtype, 'i': str(uuid.uuid4()), 'v': value,
                     'l': label, 's': order * 10},
                ).fetchone()
                if res and res[0] == 'ok':
                    added += 1
                elif res and res[0] == 'unknown_type':
                    print(f'  ! {mtype} is not registered — run '
                          f'migrate_split_master_tables.py first')
                    return
        db.session.commit()
        print(f'{added} option(s) added')
        for t in LISTS:
            n = db.session.execute(text(f'SELECT COUNT(*) FROM `master_{t}`')).scalar()
            print(f'  master_{t}: {n} options')


if __name__ == '__main__':
    main()
