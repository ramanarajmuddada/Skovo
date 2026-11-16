"""Leaderboard dropdowns move into masters (Admin > Masters).

WHAT CHANGES
    master_league_tier   league tiers, lowest first by sort_order. Seeded from
                         league_settings.tiers ("Bronze,Silver,...") in the same
                         order, because a member's tier is stored as a POSITION
                         (0 = lowest). portal/helpers/leaderboard.league_tiers()
                         reads this; the old comma setting is only a fallback.
    master_name_format   how a name shows on the leaderboard: full / initial.
                         The values are what leaderboard.display_name() handles.

Reordering tiers in Masters moves existing members with them (position, not
name) -- the Masters screen is the place to rename, not to reshuffle mid-season.

Additive, idempotent; seeds only missing rows. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_leaderboard_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def master_table(name):
    return f"""CREATE TABLE IF NOT EXISTS `{name}` (
  `id` CHAR(36) NOT NULL,
  `value` VARCHAR(100) NOT NULL,
  `label` VARCHAR(150) NOT NULL,
  `sort_order` INT DEFAULT 0,
  `is_active` TINYINT(1) DEFAULT 1,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36) DEFAULT NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{name}_value` (`value`),
  KEY `ix_{name}_active` (`is_active`, `sort_order`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""


def register(mtype, table, label):
    db.session.execute(text("""
        INSERT INTO master_registry (id, type, table_name, label, is_active)
        VALUES (:id, :t, :tbl, :lbl, 1)
        ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), label = VALUES(label), is_active = 1
    """), {'id': str(uuid.uuid4()), 't': mtype, 'tbl': table, 'lbl': label})


def seed(table, rows):
    added = 0
    for order, (value, label) in enumerate(rows, start=1):
        added += db.session.execute(text(
            f"INSERT IGNORE INTO `{table}` (id, value, label, sort_order, is_active) "
            "VALUES (:i, :v, :l, :o, 1)"),
            {'i': str(uuid.uuid4()), 'v': value, 'l': label, 'o': order * 10}).rowcount
    return added


def main():
    with app.app_context():
        current = db.session.execute(text("SELECT tiers FROM league_settings LIMIT 1")).scalar() \
            or 'Bronze,Silver,Gold,Platinum,Diamond'
        tiers = [t.strip() for t in current.split(',') if t.strip()]

        for table, mtype, label, rows in (
            ('master_league_tier', 'league_tier', 'League Tier',
             [(t.lower().replace(' ', '_'), t) for t in tiers]),
            ('master_name_format', 'name_format', 'Leaderboard Name Format',
             [('full', 'Full name'), ('initial', 'First name + initial')]),
        ):
            db.session.execute(text(master_table(table)))
            register(mtype, table, label)
            print(f"  [ok] {table}: {seed(table, rows)} new of {len(rows)}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
