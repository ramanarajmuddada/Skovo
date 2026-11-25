"""
Migration: the achiever lifecycle — five states, three demo sessions, timed
suspension, and standing earned from outcomes.

Replaces `trust_level 0-4`. That ladder made one number answer two unrelated
questions — "do we know who this person is" (compliance) and "are they any
good" (quality) — which forces a false ordering, so admins fudge it. The one
achiever in the database reached tier 2 with zero documents on file, promoted
by a data backfill. This makes that impossible: capability follows approved
evidence, never a number someone typed.

    PENDING -> PROBATION -> ACTIVE -> SUSPENDED -> BANNED
                              ^__________|         (terminal)

PROBATION is the interesting part. An approved applicant teaches three FREE
sessions to real students, who review them. An admin reads those reviews before
any money can be charged. Credentials show someone is an engineer at TCS; they
cannot show whether that person can hold the attention of a seventeen-year-old.

`trust_level` is left in place, unread. Dropping a column that stored
procedures still mention is a bigger blast radius than leaving it; a later
migration can remove it once nothing references it.

Idempotent - safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_achiever_lifecycle.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 - puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_lifecycle.sql'

# (table, column, DDL) - each added only if absent.
COLUMNS = [
    # ── lifecycle state ──────────────────────────────────────────────────
    ('achievers', 'state',
     "ALTER TABLE `achievers` ADD COLUMN `state` VARCHAR(20) NOT NULL "
     "DEFAULT 'pending' AFTER `status`"),

    # Why they are in that state, in their own words to them. Shown in the
    # portal, so it must read as an explanation rather than a code.
    ('achievers', 'state_reason',
     "ALTER TABLE `achievers` ADD COLUMN `state_reason` TEXT NULL AFTER `state`"),
    ('achievers', 'state_changed_at',
     "ALTER TABLE `achievers` ADD COLUMN `state_changed_at` DATETIME NULL "
     "AFTER `state_reason`"),
    ('achievers', 'state_changed_by',
     "ALTER TABLE `achievers` ADD COLUMN `state_changed_by` CHAR(36) NULL "
     "AFTER `state_changed_at`"),

    # NULL on an indefinite suspension; a date means the nightly job lifts it
    # automatically. Without the auto-lift, admins avoid suspending at all
    # because every suspension becomes a thing they must remember to undo.
    ('achievers', 'suspended_until',
     "ALTER TABLE `achievers` ADD COLUMN `suspended_until` DATETIME NULL "
     "AFTER `state_changed_by`"),

    # ── probation ────────────────────────────────────────────────────────
    # Denormalised counter so the browse query does not join sessions on every
    # page load. sp_achiever_demo_complete keeps it true.
    ('achievers', 'demo_sessions_done',
     "ALTER TABLE `achievers` ADD COLUMN `demo_sessions_done` INT NOT NULL "
     "DEFAULT 0 AFTER `suspended_until`"),
    ('achievers', 'demo_submitted_at',
     "ALTER TABLE `achievers` ADD COLUMN `demo_submitted_at` DATETIME NULL "
     "AFTER `demo_sessions_done`"),

    # ── money plumbing, independent of trust ─────────────────────────────
    # Someone can be teaching before their bank details land; conflating the
    # two would block a verified achiever from working over a missing IFSC.
    ('achievers', 'payout_ready',
     "ALTER TABLE `achievers` ADD COLUMN `payout_ready` TINYINT(1) NOT NULL "
     "DEFAULT 0 AFTER `demo_submitted_at`"),

    # ── standing: earned, recomputed, never set by hand ──────────────────
    ('achievers', 'standing',
     "ALTER TABLE `achievers` ADD COLUMN `standing` VARCHAR(20) NOT NULL "
     "DEFAULT 'new' AFTER `payout_ready`"),
    ('achievers', 'standing_score',
     "ALTER TABLE `achievers` ADD COLUMN `standing_score` DECIMAL(6,2) NULL "
     "AFTER `standing`"),
    ('achievers', 'standing_updated_at',
     "ALTER TABLE `achievers` ADD COLUMN `standing_updated_at` DATETIME NULL "
     "AFTER `standing_score`"),

    # ── sessions: which ones are unpaid probation demos ──────────────────
    ('achiever_sessions', 'is_demo',
     "ALTER TABLE `achiever_sessions` ADD COLUMN `is_demo` TINYINT(1) NOT NULL "
     "DEFAULT 0 AFTER `status`"),

    # ── reviews: the admin's probation verdict lives on the review row ───
    ('achiever_reviews', 'is_demo_review',
     "ALTER TABLE `achiever_reviews` ADD COLUMN `is_demo_review` TINYINT(1) "
     "NOT NULL DEFAULT 0 AFTER `context_id`"),
    ('achiever_reviews', 'session_id',
     "ALTER TABLE `achiever_reviews` ADD COLUMN `session_id` CHAR(36) NULL "
     "AFTER `is_demo_review`"),
]

INDEXES = [
    ('achievers', 'ix_achievers_state',
     "CREATE INDEX ix_achievers_state ON `achievers` (`state`)"),
    ('achievers', 'ix_achievers_suspended_until',
     "CREATE INDEX ix_achievers_suspended_until ON `achievers` (`suspended_until`)"),
    ('achievers', 'ix_achievers_standing',
     "CREATE INDEX ix_achievers_standing ON `achievers` (`standing`)"),
    ('achiever_sessions', 'ix_sessions_demo',
     "CREATE INDEX ix_sessions_demo ON `achiever_sessions` (`mentor_id`, `is_demo`, `status`)"),
]

TABLES = [
    # Every state change, who made it and why. An achiever asking "why was I
    # suspended in March" needs an answer, and a suspension with no recorded
    # reason is one an admin cannot defend later.
    ("achiever_state_events", """
        CREATE TABLE IF NOT EXISTS `achiever_state_events` (
          `id` CHAR(36) NOT NULL,
          `achiever_id` CHAR(36) NOT NULL,
          `from_state` VARCHAR(20) NULL,
          `to_state` VARCHAR(20) NOT NULL,
          `reason` TEXT NULL,
          `suspended_until` DATETIME NULL,
          `actor_id` CHAR(36) NULL,
          `actor_role` VARCHAR(20) NULL,
          `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (`id`),
          KEY `ix_ase_achiever` (`achiever_id`, `created_at`)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """),
]

# Which documents must be approved before an application can be accepted.
# In a table rather than in code so the requirement can change without a
# deploy - the same reason commission lives in commission_rules.
REQUIRED_DOCS = [
    ('govt_id', 1),
    ('selfie', 1),
    ('achievement_proof', 1),
]


def _has_column(conn, table, column):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar() > 0


def _has_index(conn, table, index):
    return conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
    ), {'t': table, 'i': index}).scalar() > 0


def main():
    with app.app_context():
        conn = db.session

        for name, ddl in TABLES:
            conn.execute(text(ddl))
            print(f"  table ready: {name}")

        for table, column, ddl in COLUMNS:
            if _has_column(conn, table, column):
                print(f"  {table}.{column}: already present")
            else:
                conn.execute(text(ddl))
                print(f"  {table}.{column}: added")

        for table, index, ddl in INDEXES:
            if _has_index(conn, table, index):
                print(f"  {index}: already present")
            else:
                conn.execute(text(ddl))
                print(f"  {index}: created")

        # Mark which doc types gate an application. is_required lives on the
        # master row so admins can add a new required document later.
        if not _has_column(conn, 'master_achiever_doc_type', 'is_required'):
            conn.execute(text(
                "ALTER TABLE `master_achiever_doc_type` "
                "ADD COLUMN `is_required` TINYINT(1) NOT NULL DEFAULT 0"
            ))
            print("  master_achiever_doc_type.is_required: added")
        for value, required in REQUIRED_DOCS:
            conn.execute(text(
                "UPDATE `master_achiever_doc_type` SET is_required = :r WHERE value = :v"
            ), {'r': required, 'v': value})
        print(f"  required documents marked: {', '.join(v for v, _ in REQUIRED_DOCS)}")

        # Carry existing achievers across. trust_level 0 was 'applied' and
        # invisible; anything higher was already listed and charging, so those
        # people keep working rather than being knocked back into probation.
        #
        # Only when the old column is still there. A database built from today's
        # models never had `trust_level`, and has no pre-lifecycle achievers to
        # carry across -- reading the missing column used to abort the whole
        # migration here and roll back the required-document flags set above, so
        # a fresh install showed achievers an empty "Documents you need" list.
        if _has_column(conn, 'achievers', 'trust_level'):
            moved = conn.execute(text("""
                UPDATE `achievers`
                   SET state = CASE
                           WHEN IFNULL(is_active, 0) = 0 THEN 'suspended'
                           WHEN IFNULL(trust_level, 0) = 0 THEN 'pending'
                           ELSE 'active'
                       END,
                       state_changed_at = UTC_TIMESTAMP(),
                       state_reason = 'Migrated from trust_level'
                 WHERE state = 'pending'
                   AND state_changed_at IS NULL
            """)).rowcount
            print(f"  existing achievers migrated to states: {moved}")
        else:
            print("  no trust_level column (fresh schema): nothing to carry across")

        # Anyone already holding bank details keeps the ability to withdraw.
        ready = conn.execute(text("""
            UPDATE `achievers`
               SET payout_ready = 1
             WHERE payout_ready = 0
               AND ((payout_account_number IS NOT NULL AND payout_ifsc IS NOT NULL)
                     OR payout_upi IS NOT NULL)
        """)).rowcount
        print(f"  achievers marked payout_ready: {ready}")

        conn.commit()

        procs = apply_sql_file(SP_FILE)
        print(f"  procedures: {procs} statement(s) from {SP_FILE.split('/')[-1]}")

        print()
        print("verifying:")
        for table, column, _ in COLUMNS:
            ok = _has_column(conn, table, column)
            print(f"  {table}.{column:<22} {'OK' if ok else 'MISSING'}")
        for r in conn.execute(text(
                "SELECT state, COUNT(*) FROM `achievers` GROUP BY state")):
            print(f"  state {r[0]:<12} {r[1]}")

        print()
        print("done")


if __name__ == '__main__':
    main()
