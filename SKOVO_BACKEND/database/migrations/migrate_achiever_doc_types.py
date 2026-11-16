"""
Migration: achiever document types become master data.

WHY
    The evidence dropdown was a hardcoded Python tuple in helpers/trust.py, with
    a SECOND hardcoded label map in the React screen. Adding a document type
    meant editing Python and JSX and redeploying — in a codebase where 123 other
    dropdowns are already master data with an admin screen behind them. That was
    an inconsistency I introduced, and this removes it.

HOW — the house pattern, not a new one
    Every dropdown here is its own `master_<type>` table registered in
    `master_registry`; the generic sp_master_* procedures resolve the physical
    table through that registry (which is also the injection guard — the table
    name is never taken from the caller). Registering this table means the
    existing Admin > Masters screen manages it on day one, with no new UI.

THE ONE EXTRA COLUMN
    `category` — identity | credential | supporting.

    This is why a dedicated table is right rather than a row in a shared one:
    the submit rule is "at least one IDENTITY document and at least one
    CREDENTIAL document", so the category is not decoration, it drives
    validation. sp_master_list names its columns explicitly, so the extra column
    is invisible to the generic CRUD and the admin screen keeps working.

    Consequence worth knowing: an admin adding a type through Admin > Masters
    gets category NULL, which counts as 'supporting' — it will not satisfy the
    identity or credential requirement. That is the safe default; a new document
    type should not silently become proof of identity.

Idempotent - safe to re-run. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_doc_types.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file
from sqlalchemy import text

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_doc_types.sql'

MASTER_TYPE = 'achiever_doc_type'
MASTER_TABLE = 'master_achiever_doc_type'
MASTER_LABEL = 'Achiever Document Types'

# (value, label, category, sort_order)
# Labels are the ones the achiever reads, so they carry the examples that make
# the choice obvious — "Government ID" alone leaves people guessing.
SEED = [
    ('govt_id',           'Government ID (Aadhaar, PAN or Passport)',                          'identity',   10),
    ('selfie',            'Your recent photo (clear face, admin compares it with your ID)',     'identity',   20),
    ('achievement_proof', 'Proof of expertise (rank card, degree, offer letter or company ID)', 'credential', 30),
    ('rank_card',         'Extra: Exam rank card or scorecard',                                 'credential', 40),
    ('degree',            'Extra: Degree certificate or marksheet',                             'credential', 50),
    ('offer_letter',      'Extra: Job offer letter',                                            'credential', 60),
    ('employment_proof',  'Extra: Company ID or experience letter',                             'supporting', 70),
    ('other',             'Extra: Any other document',                                          'supporting', 80),
]


def run():
    with app.app_context():
        conn = db.session.connection()

        # Standard master columns first, so the generic sp_master_* procedures
        # and the Admin > Masters screen work against it unchanged.
        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS `{MASTER_TABLE}` (
              id         CHAR(36)     NOT NULL,
              value      VARCHAR(100) NOT NULL,
              label      VARCHAR(150) NOT NULL,
              sort_order INT          NULL DEFAULT 0,
              is_active  TINYINT(1)   NOT NULL DEFAULT 1,
              category   VARCHAR(20)  NULL,
              help_text  VARCHAR(255) NULL,
              created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              created_by CHAR(36)     NULL,
              updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                      ON UPDATE CURRENT_TIMESTAMP,
              updated_by CHAR(36)     NULL,
              PRIMARY KEY (id),
              UNIQUE KEY uq_madt_value (value),
              KEY ix_madt_category (category, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        print(f"  [ok] {MASTER_TABLE} present")

        # The CREATE above is a no-op when migrate_split_master_tables.py has
        # already built this table from the generic five-column master shape,
        # which it does because it runs first. Add what that shape lacks.
        grew = _bootstrap.ensure_columns(conn, text, MASTER_TABLE, {
            "category":  "VARCHAR(20) NULL",
            "help_text": "VARCHAR(255) NULL",
        })
        if grew:
            print(f"  [ok] added missing column(s): {', '.join(grew)}")

        # master_registry.id is a CHAR(36) PK with no default, so it must be
        # supplied. `type` and `table_name` are both UNIQUE, which is what makes
        # the upsert idempotent.
        conn.execute(text("""
            INSERT INTO master_registry (id, type, table_name, label, is_active)
            VALUES (:id, :t, :tbl, :lbl, 1)
            ON DUPLICATE KEY UPDATE table_name = VALUES(table_name),
                                    label = VALUES(label),
                                    is_active = 1
        """), {"id": str(uuid.uuid4()), "t": MASTER_TYPE,
               "tbl": MASTER_TABLE, "lbl": MASTER_LABEL})
        print(f"  [ok] registered '{MASTER_TYPE}' -> {MASTER_TABLE}")

        # Seed only what is missing. An operator may have renamed a label or
        # retired an option; re-running must not undo that. Category is
        # refreshed because it drives validation and must stay correct.
        added = 0
        for value, label, category, sort_order in SEED:
            res = conn.execute(text(f"""
                INSERT INTO `{MASTER_TABLE}` (id, value, label, sort_order, is_active, category)
                VALUES (:id, :v, :l, :s, 1, :c)
                ON DUPLICATE KEY UPDATE category = VALUES(category)
            """), {"id": str(uuid.uuid4()), "v": value, "l": label,
                   "s": sort_order, "c": category})
            if res.rowcount == 1:
                added += 1
        print(f"  [ok] seeded {added} new document type(s), {len(SEED)} total")

        db.session.commit()

        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")

        print("Achiever document type migration complete.")


if __name__ == "__main__":
    run()
