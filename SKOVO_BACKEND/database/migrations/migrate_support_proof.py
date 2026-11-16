"""
Proof on support issues.

  * support_issues.attachments: JSON list of {url, name} — screenshots or PDFs,
    required for Payments and Payouts issues (up to 3).
  * support_issues.txn_ref: UTR / transaction id the person typed (optional).

Additive and idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_support_proof.py
"""
from sqlalchemy import text
import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()


def _col(table, col, ddl):
    have = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS"
        " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"), {'t': table, 'c': col}).scalar()
    if have:
        print(f"  [ok] {table}.{col} already there")
        return
    db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
    db.session.commit()
    print(f"  [ok] {table}.{col}")


def run():
    with app.app_context():
        db.session.execute(text("SET SESSION lock_wait_timeout = 10"))
        _col('support_issues', 'attachments', 'TEXT NULL')
        _col('support_issues', 'txn_ref', 'VARCHAR(80) NULL')


if __name__ == '__main__':
    run()
