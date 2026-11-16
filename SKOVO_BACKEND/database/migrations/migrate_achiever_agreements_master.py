"""
Migration: achiever agreements become master data, with real policy text.

WHY
    Document types were moved to master data; the agreements next to them were
    left as a Python tuple plus a hardcoded label map in React — the same
    inconsistency, one screen apart:

        REQUIRED_AGREEMENTS = ('code_of_conduct', 'commission', 'cancellation_policy')
        AGREEMENT_LABELS = { commission: 'I understand SKOVO retains 30% ...' }

    Three defects came with that:

    1. Adding or rewording an agreement meant editing Python AND JSX, then
       redeploying — for a legal document.
    2. The "30%" was typed into the label. PLATFORM_FEE_RATIO lives in
       helpers.py; change the commission and the sentence an achiever legally
       accepted still says 30%. The label now carries a `{commission_pct}`
       token that the API substitutes from the real constant, so the two
       cannot drift.
    3. **There was no policy text at all.** `policy_version = 'v1'` was
       recorded against nothing. An achiever accepted "the code of conduct"
       and SKOVO could not produce what they accepted — which is exactly what
       a consent ledger exists to prove. Each row now carries `body` (and an
       optional `body_url`), and the version is stored per agreement rather
       than as one global constant.

WHAT IT ADDS
    * master_achiever_agreement   registered master table, so Admin > Masters
                                  manages it like every other dropdown
    * body / body_url / version   the text that was accepted
    * is_required / sort_order    which ones gate submission, and their order

    Extra columns beyond the standard master shape are invisible to
    sp_master_list, which names its columns explicitly — so the generic admin
    screen keeps working.

NOTE ON EXISTING CONSENT ROWS
    `achiever_agreements` rows already recorded carry policy_version 'v1'. The
    seed below is also v1, so history stays coherent. Any future wording change
    must bump `version` on the master row — never edit the text in place, or
    past consent silently starts pointing at wording nobody agreed to.

Idempotent - safe to re-run. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_agreements_master.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file
from sqlalchemy import text

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_agreement_types.sql'

MASTER_TYPE = 'achiever_agreement'
MASTER_TABLE = 'master_achiever_agreement'
MASTER_LABEL = 'Achiever Agreements'

# (value, label, body, version, is_required, sort_order)
#
# `{commission_pct}` is substituted by the API from PLATFORM_FEE_RATIO. Keep the
# token — typing the number here re-creates the drift this migration removes.
SEED = [
    (
        'code_of_conduct',
        'I accept the SKOVO achiever code of conduct',
        'I will treat every student with respect and professionalism. I will not '
        'contact students outside SKOVO for paid work, share their personal '
        'information, or make guarantees about admissions, ranks or outcomes. '
        'I will keep sessions appropriate at all times, and I understand that '
        'sessions with students aged 14-17 additionally require a completed '
        'background check.',
        'v1', 1, 10,
    ),
    (
        'commission',
        'I understand SKOVO retains {commission_pct}% of each paid session or cohort',
        'SKOVO retains {commission_pct}% of the gross value of every paid session, '
        'cohort and course as a platform fee. The remaining {achiever_pct}% is '
        'credited to my earnings balance once the session or cohort is delivered, '
        'and becomes available to withdraw through the payout process. Taxes '
        'applicable to my earnings are my own responsibility.',
        'v1', 1, 20,
    ),
    (
        'cancellation_policy',
        'I accept the cancellation and refund policy',
        'A student may cancel a booked session and receive a refund under the '
        'published cancellation window. If I cancel a confirmed session or '
        'cohort, the student is refunded in full and the cancellation is '
        'recorded against my reliability record. Repeated cancellations may '
        'result in my tier being lowered, which cancels and refunds any '
        'sessions the lower tier no longer permits.',
        'v1', 1, 30,
    ),
]


def run():
    with app.app_context():
        conn = db.session.connection()

        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS `{MASTER_TABLE}` (
              id          CHAR(36)     NOT NULL,
              value       VARCHAR(100) NOT NULL,
              label       VARCHAR(150) NOT NULL,
              sort_order  INT          NULL DEFAULT 0,
              is_active   TINYINT(1)   NOT NULL DEFAULT 1,
              body        TEXT         NULL,
              body_url    VARCHAR(255) NULL,
              version     VARCHAR(20)  NOT NULL DEFAULT 'v1',
              is_required TINYINT(1)   NOT NULL DEFAULT 1,
              created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              created_by  CHAR(36)     NULL,
              updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                                       ON UPDATE CURRENT_TIMESTAMP,
              updated_by  CHAR(36)     NULL,
              PRIMARY KEY (id),
              UNIQUE KEY uq_maa_value (value),
              KEY ix_maa_required (is_required, is_active)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        print(f"  [ok] {MASTER_TABLE} present")

        # Same reason as the doc-type table: the generic master shape gets there
        # first, so CREATE IF NOT EXISTS never adds these four.
        grew = _bootstrap.ensure_columns(conn, text, MASTER_TABLE, {
            "body":        "TEXT NULL",
            "body_url":    "VARCHAR(255) NULL",
            "version":     "VARCHAR(20) NOT NULL DEFAULT 'v1'",
            "is_required": "TINYINT(1) NOT NULL DEFAULT 1",
        })
        if grew:
            print(f"  [ok] added missing column(s): {', '.join(grew)}")

        conn.execute(text("""
            INSERT INTO master_registry (id, type, table_name, label, is_active)
            VALUES (:id, :t, :tbl, :lbl, 1)
            ON DUPLICATE KEY UPDATE table_name = VALUES(table_name),
                                    label = VALUES(label), is_active = 1
        """), {"id": str(uuid.uuid4()), "t": MASTER_TYPE,
               "tbl": MASTER_TABLE, "lbl": MASTER_LABEL})
        print(f"  [ok] registered '{MASTER_TYPE}' -> {MASTER_TABLE}")

        # Insert only what is missing. Never overwrite `body` or `version` on
        # re-run: the text is what past achievers consented to, and rewriting it
        # in place would make the ledger describe wording nobody agreed to.
        added = 0
        for value, label, body, version, required, sort_order in SEED:
            res = conn.execute(text(f"""
                INSERT INTO `{MASTER_TABLE}`
                    (id, value, label, body, version, is_required, sort_order, is_active)
                VALUES (:id, :v, :l, :b, :ver, :req, :s, 1)
                ON DUPLICATE KEY UPDATE sort_order = VALUES(sort_order)
            """), {"id": str(uuid.uuid4()), "v": value, "l": label, "b": body,
                   "ver": version, "req": required, "s": sort_order})
            if res.rowcount == 1:
                added += 1
        print(f"  [ok] seeded {added} new agreement(s), {len(SEED)} total")

        db.session.commit()

        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")

        print("Achiever agreement master-data migration complete.")


if __name__ == "__main__":
    run()
