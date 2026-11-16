"""
Lets a reviewer ask an achiever for a document.

Until now the only levers were Accept and Reject, which both need the document
to already be there. An admin who wanted something else -- an employment proof
to back up a job title, a clearer marksheet, a second ID -- had no way to say so.
The achiever saw an application sitting in review with nothing to act on, and the
admin had to approve on incomplete evidence or reject the whole thing.

One table. A request names a document type from the same master data the upload
picker uses, so the achiever gets a real upload slot rather than a message asking
them to work out what to attach. `note` is why it is being asked for.

Fulfilment is not stored: a request is satisfied when a document of that type
exists for that achiever and has not been rejected. Deriving it means the two can
never disagree, which is the failure a `fulfilled` flag invites.

Idempotent: re-running changes nothing.
"""
import _bootstrap  # noqa: F401

from sqlalchemy import text
from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLE = 'achiever_document_requests'

DDL = """
CREATE TABLE IF NOT EXISTS `achiever_document_requests` (
  `id`           CHAR(36)     NOT NULL,
  `achiever_id`  CHAR(36)     NOT NULL,
  `doc_type`     VARCHAR(100) NOT NULL,
  `note`         TEXT         NULL,
  `requested_by` CHAR(36)     NULL,
  `created_at`   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `cancelled_at` DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `idx_adr_achiever` (`achiever_id`),
  KEY `idx_adr_open` (`achiever_id`, `cancelled_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""


def main():
    with app.app_context():
        existed = db.session.execute(
            text("SELECT COUNT(*) FROM information_schema.TABLES "
                 "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"),
            {'t': TABLE},
        ).scalar()

        db.session.execute(text(DDL))
        db.session.commit()

        if existed:
            print(f"{TABLE} already existed - nothing to do")
        else:
            print(f"created {TABLE}")

        cols = db.session.execute(
            text("SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE "
                 "FROM information_schema.COLUMNS "
                 "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                 "ORDER BY ORDINAL_POSITION"),
            {'t': TABLE},
        ).fetchall()
        print()
        for c in cols:
            print(f"  {c[0]:<14} {c[1]:<14} null={c[2]}")

        n = db.session.execute(text(f"SELECT COUNT(*) FROM `{TABLE}`")).scalar()
        print(f"\nrows: {n}")


if __name__ == '__main__':
    main()
