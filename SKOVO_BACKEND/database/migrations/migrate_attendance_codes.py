"""
Migration: cohort attendance codes (self check-in).

The achiever reveals a short numeric code partway through the session; students
enter it in the app and their attendance marks itself. Chosen because OTP entry
is the single most familiar interaction pattern for Indian users — UPI, Aadhaar
and every login already work this way, so there is nothing to teach.

Design notes:

  * The code is revealed MID-session, not at the start, so somebody who joins
    for two minutes and leaves never sees it. That turns attendance from a
    claim into evidence.
  * Codes expire (default 20 minutes). An expired code is a clear, separate
    error from a wrong one, so a student on a flaky connection is told to ask
    the achiever to re-reveal rather than being accused of a bad code.
  * A code is scoped to one cohort and is single-use per student.
  * This never replaces the achiever's manual checkbox. A student whose 4G drops
    during the window must not lose their points, so the achiever can always
    mark them present by hand.

Idempotent. Run from SKOVO_BACKEND:  python migrate_attendance_codes.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()


def main():
    with app.app_context():
        # ── table ────────────────────────────────────────────────────────────
        db.session.execute(text("""
            CREATE TABLE IF NOT EXISTS cohort_attendance_codes (
              id            CHAR(36)     NOT NULL PRIMARY KEY,
              cohort_id     CHAR(36)     NOT NULL,
              code          VARCHAR(8)   NOT NULL,
              revealed_by   CHAR(36)     NULL,
              revealed_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              expires_at    DATETIME     NOT NULL,
              is_active     TINYINT(1)   NOT NULL DEFAULT 1,
              created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
              KEY idx_cac_cohort (cohort_id),
              KEY idx_cac_lookup (cohort_id, code, is_active),
              CONSTRAINT fk_cac_cohort FOREIGN KEY (cohort_id)
                REFERENCES cohorts (id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """))
        db.session.commit()

        # ── SPs ──────────────────────────────────────────────────────────────
        for name in ('sp_attendance_code_reveal', 'sp_attendance_code_active',
                     'sp_attendance_code_redeem'):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS {name}"))
        db.session.commit()

        # Reveal: retire any live code for the cohort, then issue a fresh one.
        # Only ever one active code per cohort, so a re-reveal invalidates the
        # old digits immediately.
        db.session.execute(text("""
            CREATE PROCEDURE sp_attendance_code_reveal(
              IN p_id CHAR(36), IN p_cohort CHAR(36), IN p_code VARCHAR(8),
              IN p_by CHAR(36), IN p_minutes INT
            )
            BEGIN
              UPDATE cohort_attendance_codes
                 SET is_active = 0
               WHERE cohort_id = p_cohort AND is_active = 1;

              INSERT INTO cohort_attendance_codes
                     (id, cohort_id, code, revealed_by, revealed_at, expires_at, is_active)
              VALUES (p_id, p_cohort, p_code, p_by, UTC_TIMESTAMP(),
                      DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE), 1);

              SELECT p_id AS id, p_code AS code,
                     DATE_ADD(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE) AS expires_at;
            END
        """))
        db.session.commit()

        # The achiever's own view of the live code (so they can re-show it).
        db.session.execute(text("""
            CREATE PROCEDURE sp_attendance_code_active(IN p_cohort CHAR(36))
            BEGIN
              SELECT id, cohort_id, code, revealed_at, expires_at,
                     (expires_at > UTC_TIMESTAMP()) AS is_valid
                FROM cohort_attendance_codes
               WHERE cohort_id = p_cohort AND is_active = 1
               ORDER BY revealed_at DESC
               LIMIT 1;
            END
        """))
        db.session.commit()

        # Redeem: distinguishes "no code live", "expired" and "wrong code" so the
        # student gets a message that tells them what to actually do next.
        # Marks the enrolment attended; the caller awards the score event.
        db.session.execute(text("""
            CREATE PROCEDURE sp_attendance_code_redeem(
              IN p_cohort CHAR(36), IN p_user CHAR(36), IN p_code VARCHAR(8)
            )
            BEGIN
              DECLARE v_code       VARCHAR(8) DEFAULT NULL;
              DECLARE v_expires    DATETIME   DEFAULT NULL;
              DECLARE v_enrollment CHAR(36)   DEFAULT NULL;
              DECLARE v_attended   TINYINT(1) DEFAULT 0;

              SELECT code, expires_at INTO v_code, v_expires
                FROM cohort_attendance_codes
               WHERE cohort_id = p_cohort AND is_active = 1
               ORDER BY revealed_at DESC
               LIMIT 1;

              SELECT id, attended INTO v_enrollment, v_attended
                FROM cohort_enrollments
               WHERE cohort_id = p_cohort AND user_id = p_user
                 AND payment_status IN ('paid', 'free')
               LIMIT 1;

              IF v_enrollment IS NULL THEN
                SELECT 0 AS ok, 'not_enrolled' AS reason, NULL AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_code IS NULL THEN
                SELECT 0 AS ok, 'no_active_code' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_expires <= UTC_TIMESTAMP() THEN
                SELECT 0 AS ok, 'expired' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSEIF v_code <> p_code THEN
                SELECT 0 AS ok, 'wrong_code' AS reason, v_enrollment AS enrollment_id, 0 AS newly_marked;
              ELSE
                UPDATE cohort_enrollments
                   SET attended = 1, updated_at = UTC_TIMESTAMP()
                 WHERE id = v_enrollment;
                SELECT 1 AS ok, 'ok' AS reason, v_enrollment AS enrollment_id,
                       IF(v_attended = 1, 0, 1) AS newly_marked;
              END IF;
            END
        """))
        db.session.commit()

        print("attendance code migration complete: 1 table, 3 procedures")


if __name__ == "__main__":
    main()
