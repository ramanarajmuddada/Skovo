"""
Migration: achiever trust tiers, evidence capture and BGV lifecycle.

WHY THIS EXISTS
    `achievers.is_verified` was one boolean asserting two unrelated things at
    once — "this person is who they claim" AND "this person is safe alone with
    a 14-year-old". Collapsing them forces a bad trade: verify slowly and
    starve supply, or verify fast and carry child-safety risk. There was also
    nothing behind the flip — an admin approved a `bio` text field.

WHAT IT ADDS
    * achievers.trust_level          0..4 ladder, replacing the boolean's job
    * achiever_trust_rules           what each tier unlocks — CONFIG, not code,
                                     the same shape as score_event_rules
    * achiever_documents             the evidence an admin actually reviews
    * achiever_agreements            append-only consent ledger for achievers,
                                     mirroring user_consents for students
    * achiever_trust_events          append-only tier-change ledger
    * BGV lifecycle columns          status, vendor ref, cleared/expiry dates

THE TIER LADDER
    L0 applied      email OTP only. Not listed, cannot create anything.
    L1 identity     govt ID + selfie + phone. Listed; FREE cohorts only.
    L2 credential   achievement proof validated. May charge money.
    L3 bgv_cleared  criminal + employment check. May teach 14-17 students.
    L4 featured     founder promotion. Raised rate ceiling, homepage placement.

    L3 is the minor boundary. `users.age_band` ('minor' = 14-17) already exists
    from migrate_dpdp_consent; the booking guard now reads it against this
    ladder. That is the single change on this branch with legal exposure behind
    it.

BACKWARD COMPATIBILITY
    `is_verified` is KEPT and maintained as a mirror of (trust_level >= 2) by
    sp_achiever_trust_set. Roughly a dozen call sites and several stored
    procedures still read it; breaking them to rename a column buys nothing.
    New code should read trust_level.

BACKFILL — READ THIS BEFORE RUNNING
    is_verified = 1  ->  trust_level = 2 (credential), NOT 3.
    Nobody in the current data has had a background check, because no such
    check existed. Granting L3 on migration would assert something untrue about
    every existing achiever. The visible consequence is deliberate: after this
    runs, 14-17 students cannot book anyone until that achiever clears BGV.
    That is the fix landing, not a regression.

Idempotent — safe to re-run. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_trust.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file
from sqlalchemy import text

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_trust.sql'


# ── 1. Columns on achievers ───────────────────────────────────────────────────
COLUMNS = [
    ("achievers", "trust_level",
     "ALTER TABLE achievers ADD COLUMN trust_level TINYINT NOT NULL DEFAULT 0"),
    ("achievers", "application_status",
     "ALTER TABLE achievers ADD COLUMN application_status VARCHAR(20) NOT NULL DEFAULT 'draft'"),
    ("achievers", "application_submitted_at",
     "ALTER TABLE achievers ADD COLUMN application_submitted_at DATETIME NULL"),
    ("achievers", "rejection_reason",
     "ALTER TABLE achievers ADD COLUMN rejection_reason TEXT NULL"),
    ("achievers", "bgv_status",
     "ALTER TABLE achievers ADD COLUMN bgv_status VARCHAR(20) NOT NULL DEFAULT 'none'"),
    ("achievers", "bgv_ref",
     "ALTER TABLE achievers ADD COLUMN bgv_ref VARCHAR(120) NULL"),
    ("achievers", "bgv_cleared_at",
     "ALTER TABLE achievers ADD COLUMN bgv_cleared_at DATETIME NULL"),
    ("achievers", "bgv_expires_at",
     "ALTER TABLE achievers ADD COLUMN bgv_expires_at DATETIME NULL"),
    ("achievers", "trust_updated_at",
     "ALTER TABLE achievers ADD COLUMN trust_updated_at DATETIME NULL"),
    ("achievers", "trust_updated_by",
     "ALTER TABLE achievers ADD COLUMN trust_updated_by CHAR(36) NULL"),
]

INDEXES = [
    ("achievers", "ix_achievers_trust_level",
     "CREATE INDEX ix_achievers_trust_level ON achievers (trust_level)"),
    ("achievers", "ix_achievers_application_status",
     "CREATE INDEX ix_achievers_application_status ON achievers (application_status)"),
    ("achievers", "ix_achievers_bgv_expiry",
     "CREATE INDEX ix_achievers_bgv_expiry ON achievers (bgv_status, bgv_expires_at)"),
]


# ── 2. Tables ─────────────────────────────────────────────────────────────────
TABLES = [
    # Capability matrix. In a table rather than in Python for the same reason
    # score_event_rules is: the founder changes a rate ceiling without a deploy,
    # and one row is the single answer to "what does this tier allow".
    """
    CREATE TABLE IF NOT EXISTS achiever_trust_rules (
      tier              TINYINT      NOT NULL,
      code              VARCHAR(20)  NOT NULL,
      label             VARCHAR(60)  NOT NULL,
      can_list          TINYINT(1)   NOT NULL DEFAULT 0,
      can_create_free   TINYINT(1)   NOT NULL DEFAULT 0,
      can_charge        TINYINT(1)   NOT NULL DEFAULT 0,
      can_teach_minors  TINYINT(1)   NOT NULL DEFAULT 0,
      max_session_rate  DECIMAL(10,2) NOT NULL DEFAULT 0,
      evidence_required VARCHAR(255) NULL,
      updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                     ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (tier),
      UNIQUE KEY uq_atr_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,

    # The evidence behind an approval. file_url points at S3 (private bucket) in
    # prod; the reviewing admin sees the document next to the claim it supports.
    """
    CREATE TABLE IF NOT EXISTS achiever_documents (
      id            CHAR(36)     NOT NULL,
      achiever_id   CHAR(36)     NOT NULL,
      doc_type      VARCHAR(40)  NOT NULL,
      file_url      TEXT         NOT NULL,
      original_name VARCHAR(255) NULL,
      claim         VARCHAR(255) NULL,
      status        VARCHAR(20)  NOT NULL DEFAULT 'pending',
      review_note   TEXT         NULL,
      reviewed_by   CHAR(36)     NULL,
      reviewed_at   DATETIME     NULL,
      created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_adoc_achiever (achiever_id, status),
      KEY ix_adoc_type (achiever_id, doc_type)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,

    # Append-only, never updated — same contract as user_consents. These are the
    # people you pay; there was no record they agreed to the 30% or the conduct
    # policy at all.
    """
    CREATE TABLE IF NOT EXISTS achiever_agreements (
      id             CHAR(36)    NOT NULL,
      achiever_id    CHAR(36)    NOT NULL,
      agreement_type VARCHAR(40) NOT NULL,
      policy_version VARCHAR(20) NOT NULL DEFAULT 'v1',
      granted        TINYINT(1)  NOT NULL DEFAULT 1,
      ip             VARCHAR(64) NULL,
      created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_aagr_achiever (achiever_id, agreement_type, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,

    # Append-only tier ledger. audit_logs records that a change happened;
    # this records what it was, why, and what the cascade did.
    """
    CREATE TABLE IF NOT EXISTS achiever_trust_events (
      id           CHAR(36)    NOT NULL,
      achiever_id  CHAR(36)    NOT NULL,
      from_level   TINYINT     NULL,
      to_level     TINYINT     NOT NULL,
      action       VARCHAR(30) NOT NULL,
      reason       TEXT        NULL,
      actor_id     CHAR(36)    NULL,
      actor_role   VARCHAR(20) NULL,
      cascade_note VARCHAR(255) NULL,
      created_at   DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY ix_atev_achiever (achiever_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]


# ── 3. Tier seed ──────────────────────────────────────────────────────────────
# (tier, code, label, list, free, charge, minors, max_rate, evidence)
TIER_SEED = [
    (0, 'applied', 'Applied', 0, 0, 0, 0, 0,
     'Email verified only'),
    (1, 'identity', 'Identity verified', 1, 1, 0, 0, 0,
     'Government ID + selfie match + phone OTP'),
    (2, 'credential', 'Credential verified', 1, 1, 1, 0, 2500,
     'Proof of the claimed achievement (rank card, degree, offer letter, work-email domain)'),
    (3, 'bgv_cleared', 'Background verified', 1, 1, 1, 1, 5000,
     'Criminal record check + employment verification (vendor)'),
    (4, 'featured', 'Featured achiever', 1, 1, 1, 1, 10000,
     'Founder promotion on sustained outcome data'),
]


def column_exists(conn, table, column):
    return bool(conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {"t": table, "c": column}).scalar())


def index_exists(conn, table, index):
    return bool(conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
    ), {"t": table, "i": index}).scalar())


def run():
    with app.app_context():
        conn = db.session.connection()

        # 1. Columns
        for table, column, ddl in COLUMNS:
            if column_exists(conn, table, column):
                print(f"  [skip] {table}.{column} already exists - skipped")
                continue
            conn.execute(text(ddl))
            print(f"  [ok] added {table}.{column}")

        # 2. Tables
        for ddl in TABLES:
            conn.execute(text(ddl))
        print(f"  [ok] {len(TABLES)} trust table(s) present")

        # 3. Indexes (after the columns they cover exist)
        for table, index, ddl in INDEXES:
            if index_exists(conn, table, index):
                print(f"  [skip] {index} already exists - skipped")
                continue
            conn.execute(text(ddl))
            print(f"  [ok] created {index}")

        # 4. Tier rules — upsert so re-running picks up edited defaults but
        #    never clobbers a ceiling the founder changed in the admin UI...
        #    except on first insert. ON DUPLICATE updates only the descriptive
        #    columns, leaving max_session_rate under operator control once set.
        for tier, code, label, lst, free, charge, minors, rate, evidence in TIER_SEED:
            conn.execute(text("""
                INSERT INTO achiever_trust_rules
                    (tier, code, label, can_list, can_create_free, can_charge,
                     can_teach_minors, max_session_rate, evidence_required)
                VALUES (:tier, :code, :label, :lst, :free, :charge, :minors, :rate, :ev)
                ON DUPLICATE KEY UPDATE
                    code = VALUES(code),
                    label = VALUES(label),
                    can_list = VALUES(can_list),
                    can_create_free = VALUES(can_create_free),
                    can_charge = VALUES(can_charge),
                    can_teach_minors = VALUES(can_teach_minors),
                    evidence_required = VALUES(evidence_required)
            """), {"tier": tier, "code": code, "label": label, "lst": lst,
                   "free": free, "charge": charge, "minors": minors,
                   "rate": rate, "ev": evidence})
        print(f"  [ok] seeded {len(TIER_SEED)} trust tier(s)")

        # 5. Backfill — see the module docstring. Only touches rows still at the
        #    default 0, so a re-run never demotes anyone promoted since.
        res = conn.execute(text("""
            UPDATE achievers
               SET trust_level = 2,
                   application_status = 'approved',
                   trust_updated_at = UTC_TIMESTAMP()
             WHERE is_verified = 1 AND trust_level = 0
        """))
        print(f"  [ok] backfilled {res.rowcount} verified achiever(s) -> L2 credential")

        res = conn.execute(text("""
            UPDATE achievers
               SET application_status = 'draft'
             WHERE is_verified = 0 AND application_status = 'draft'
        """))
        print(f"  [ok] {res.rowcount} unverified achiever(s) left at L0 applied")

        # 6. Seed a trust event for every backfilled row so the ledger is not
        #    silent about where the current state came from.
        conn.execute(text("""
            INSERT INTO achiever_trust_events
                (id, achiever_id, from_level, to_level, action, reason, actor_role)
            SELECT UUID(), a.id, NULL, a.trust_level, 'migration',
                   'Backfilled from is_verified during migrate_achiever_trust', 'system'
              FROM achievers a
             WHERE a.trust_level > 0
               AND NOT EXISTS (SELECT 1 FROM achiever_trust_events e
                                WHERE e.achiever_id = a.id AND e.action = 'migration')
        """))

        db.session.commit()

        # 7. Stored procedures — the .sql file in the repo stays the single
        #    source of truth for every procedure body.
        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")

        print("Achiever trust migration complete.")


if __name__ == "__main__":
    run()
