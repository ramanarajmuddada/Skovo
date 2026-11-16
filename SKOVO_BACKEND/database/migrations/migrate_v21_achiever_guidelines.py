"""Achiever guidelines become admin-editable.

WHY
    The welcome steps and "full guidelines" an achiever reads (and accepts) on
    the Verification screen were written into achiever_lifecycle.py, so a
    one-word change needed a developer and a deploy. An admin edits them now in
    Admin > Achiever guidelines. A state with no row keeps the text in code.

WHAT THIS ADDS
    achiever_guidelines   one row per achiever state (pending / probation /
                          active / suspended / banned) holding its copy as JSON

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_achiever_guidelines.py
Safe to re-run.
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLE = """CREATE TABLE IF NOT EXISTS `achiever_guidelines` (
  `state`       VARCHAR(20) NOT NULL,
  `content`     JSON        NOT NULL,
  `version`     INT         NOT NULL DEFAULT 1,
  `updated_at`  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`  CHAR(36)    NULL,
  PRIMARY KEY (`state`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""


def main():
    with app.app_context():
        db.session.execute(text(TABLE))
        db.session.commit()
        print("migrate_v21_achiever_guidelines: done")


if __name__ == '__main__':
    main()
