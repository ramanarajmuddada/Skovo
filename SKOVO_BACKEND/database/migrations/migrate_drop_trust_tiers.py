"""
Drop the tier model: achievers.trust_level / trust_updated_at / trust_updated_by,
and the achiever_trust_rules table.

Capability follows achievers.state now — see achiever_lifecycle.sql and
sp_achiever_capabilities. Every read of these columns was repointed first; this
migration is the last step, not the first.

The tier rules are copied into achiever_trust_rules_archive before the drop.
Dropping a table is not reversible and the rows are small; keeping them costs
nothing and answers "what was tier 3 allowed to do" if it is ever asked.

Idempotent: each step checks before acting.
"""
import _bootstrap  # noqa: F401

from sqlalchemy import text
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = ['trust_level', 'trust_updated_at', 'trust_updated_by']


def _col_exists(table, column):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = :t AND COLUMN_NAME = :c"), {'t': table, 'c': column}).scalar() > 0


def _table_exists(table):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() "
        "AND TABLE_NAME = :t"), {'t': table}).scalar() > 0


def main():
    with app.app_context():
        # ── archive the rules before anything is destroyed ──────────────────
        if _table_exists('achiever_trust_rules') and not _table_exists('achiever_trust_rules_archive'):
            db.session.execute(text(
                "CREATE TABLE `achiever_trust_rules_archive` "
                "AS SELECT * FROM `achiever_trust_rules`"))
            db.session.commit()
            n = db.session.execute(text(
                "SELECT COUNT(*) FROM achiever_trust_rules_archive")).scalar()
            print(f"  archived achiever_trust_rules -> achiever_trust_rules_archive ({n} rows)")
        elif _table_exists('achiever_trust_rules_archive'):
            print("  archive already exists — left alone")

        # ── the columns ────────────────────────────────────────────────────
        for col in COLUMNS:
            if _col_exists('achievers', col):
                db.session.execute(text(f"ALTER TABLE `achievers` DROP COLUMN `{col}`"))
                db.session.commit()
                print(f"  dropped achievers.{col}")
            else:
                print(f"  achievers.{col} already gone")

        # ── the tier table ─────────────────────────────────────────────────
        if _table_exists('achiever_trust_rules'):
            db.session.execute(text("DROP TABLE `achiever_trust_rules`"))
            db.session.commit()
            print("  dropped achiever_trust_rules")
        else:
            print("  achiever_trust_rules already gone")

        print()
        print("verifying:")
        for col in COLUMNS:
            print(f"  achievers.{col:<20} {'STILL PRESENT' if _col_exists('achievers', col) else 'gone'}")
        print(f"  achiever_trust_rules      {'STILL PRESENT' if _table_exists('achiever_trust_rules') else 'gone'}")
        print(f"  archive kept              {'yes' if _table_exists('achiever_trust_rules_archive') else 'NO'}")


if __name__ == '__main__':
    main()
