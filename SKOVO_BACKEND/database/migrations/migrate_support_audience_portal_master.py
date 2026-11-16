"""Support audience and portal become masters.

WHY
    Same duplication as category: each list was written once in
    portal/helpers/support.py and again in the JSX. Labels could drift between
    the two with nothing to catch it.

WHAT THIS DOES AND DOES NOT BUY YOU
    It makes the LABELS and the ORDER editable, and lets a value be switched off
    without a deploy -- turn `public` off and it stops being offered everywhere
    at once.

    It does NOT make a NEW value work. `public` has its own unauthenticated
    route (/v1/support/public-contacts), and portal is derived from the JWT
    role, not chosen freely. Inserting a fourth audience here produces a
    dropdown entry with no code behind it. Add the row only when the code that
    serves it exists.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support_audience_portal_master.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SETS = [
    ('support_audience', 'master_support_audience', 'Support Audience', [
        ('student',  'Student',  10),
        ('achiever', 'Achiever', 20),
        ('public',   'Public',   30),
    ]),
    ('support_portal', 'master_support_portal', 'Support Portal', [
        ('student',  'Student',  10),
        ('achiever', 'Achiever', 20),
    ]),
    # Channel carries the strongest caveat of the four. `email` renders a
    # mailto button and `phone` a tel button; the component has a case for each
    # and for nothing else. A third row here saves and lists fine and then
    # renders NO button on the portal -- it fails silently, where a bad
    # audience at least fails visibly. Edit and reorder these; do not add one
    # until the rendering case exists.
    ('support_channel', 'master_support_channel', 'Support Channel', [
        ('email', 'Email', 10),
        ('phone', 'Phone', 20),
    ]),
]

DDL = """
CREATE TABLE IF NOT EXISTS `{table}` (
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
  UNIQUE KEY `uq_{table}_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""


def main():
    with app.app_context():
        for mtype, table, label, seed in SETS:
            db.session.execute(text(DDL.format(table=table)))
            for value, lab, sort_order in seed:
                db.session.execute(text(
                    f"INSERT INTO `{table}` (id, value, label, sort_order, is_active) "
                    "VALUES (UUID(), :v, :l, :s, 1) "
                    "ON DUPLICATE KEY UPDATE label = VALUES(label), "
                    "sort_order = VALUES(sort_order)"
                ), {'v': value, 'l': lab, 's': sort_order})

            db.session.execute(text(
                "INSERT INTO `master_registry` (id, type, table_name, label, is_active) "
                "VALUES (UUID(), :t, :tab, :lab, 1) "
                "ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), "
                "label = VALUES(label), is_active = 1"
            ), {'t': mtype, 'tab': table, 'lab': label})

        db.session.commit()

        for mtype, table, _label, _seed in SETS:
            rows = db.session.execute(text(
                f"SELECT value, label, sort_order FROM `{table}` "
                "WHERE is_active = 1 ORDER BY sort_order"
            )).fetchall()
            print(f"  {table}: {len(rows)} rows")
            for r in rows:
                print(f"    {r[0]:12} {r[1]:12} {r[2]}")
        print("Done.")


if __name__ == '__main__':
    main()
