"""Support issue categories become a master.

WHY
    The five categories were a tuple in portal/helpers/support.py AND a copy of
    the same five in Skovo/src/pages/admin/AdminSupport.jsx. Adding one meant a
    deploy of both, and forgetting one half meant the server accepted a category
    the admin filter would not offer -- the same drift `educationPathways.js` /
    `education_pathways.py` is already called out for.

    Category is the only one of the support vocabularies that is pure
    classification: nothing in the code branches on it, unlike `audience`
    (public has its own unauthenticated route), `channel` (phone renders a Call
    button) or `status` (solved fires a notification). So it is the only one
    that belongs in masters -- a new row there works immediately, where a new
    audience would just be a dead dropdown entry.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support_category_master.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLE = 'master_support_category'
MTYPE = 'support_category'

# Seeded from the tuple this replaces, same order, so nothing an admin or a
# stored issue already refers to stops resolving.
SEED = [
    ('payments',  'Payments',  10),
    ('account',   'Account',   20),
    ('documents', 'Documents', 30),
    ('payouts',   'Payouts',   40),
    ('other',     'Other',     50),
]

DDL = f"""
CREATE TABLE IF NOT EXISTS `{TABLE}` (
  `id`         CHAR(36)     NOT NULL,
  `value`      VARCHAR(50)  NOT NULL,
  `label`      VARCHAR(100) NOT NULL,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36)     NULL,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36)     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_{TABLE}_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def main():
    with app.app_context():
        db.session.execute(text(DDL))

        for value, label, sort_order in SEED:
            db.session.execute(text(
                f"INSERT INTO `{TABLE}` (id, value, label, sort_order, is_active) "
                "VALUES (UUID(), :v, :l, :s, 1) "
                "ON DUPLICATE KEY UPDATE label = VALUES(label), "
                "sort_order = VALUES(sort_order)"
            ), {'v': value, 'l': label, 's': sort_order})

        # sp_master_list resolves master_<type> through this registry, so the
        # table is invisible to every reader until the row exists.
        db.session.execute(text(
            "INSERT INTO `master_registry` (id, type, table_name, label, is_active) "
            "VALUES (UUID(), :t, :tab, :lab, 1) "
            "ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), "
            "label = VALUES(label), is_active = 1"
        ), {'t': MTYPE, 'tab': TABLE, 'lab': 'Support Category'})

        db.session.commit()

        rows = db.session.execute(text(
            f"SELECT value, label, sort_order FROM `{TABLE}` "
            "WHERE is_active = 1 ORDER BY sort_order"
        )).fetchall()
        reg = db.session.execute(text(
            "SELECT type, table_name FROM `master_registry` WHERE type = :t"
        ), {'t': MTYPE}).fetchone()

        print(f"  {TABLE}: {len(rows)} rows")
        for r in rows:
            print(f"    {r[0]:12} {r[1]:12} {r[2]}")
        print(f"  registry: {reg[0]} -> {reg[1]}" if reg else "  registry: MISSING")
        print("Done.")


if __name__ == '__main__':
    main()
