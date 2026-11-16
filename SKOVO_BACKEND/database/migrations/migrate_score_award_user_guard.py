"""
Migration: sp_score_award must refuse a user who does not exist.

THE HOLE
    `score_events` and `readiness_scores` carry no foreign key to `users` — the
    engine was built to be append-only and fast, and the FK was never added. So
    sp_score_award happily wrote a ledger row and materialised a
    `readiness_scores` row for any 36-character string handed to it.

    Nothing in the product passes a bad id deliberately. What passes one is a
    caller scoring against an id it read from a request body, a deleted account,
    or an achiever id where a student id was meant. The write succeeds, no error
    surfaces (portal/helpers/score.award swallows everything by contract), and
    the orphan rows land in exactly the places that must not carry them:

      * AdminAnalytics score distribution and unlock-rate counts
      * the nightly decay job, which walks readiness_scores
      * sp_score_recalc, which will keep rebuilding a score for a ghost

    Playbook §5.7 makes scoring a side effect that must never break the action
    that earned it — swallowing the failure is right. Silently persisting it is
    not.

THE FIX
    Check the user exists and is not soft-deleted before any write, and answer
    `unknown_user` with 0 points. Same shape as the existing
    `unknown_or_inactive` branch: the caller already treats any awarded=0 as
    "nothing to do", so no caller changes.

    Everything else in the procedure is untouched — caps, the capped-but-logged
    row (§9.1(5)), and ref_id idempotency all behave exactly as before.

Idempotent — the procedure is dropped and recreated. Run from SKOVO_BACKEND:
    python database/migrations/migrate_score_award_user_guard.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

DROP = "DROP PROCEDURE IF EXISTS sp_score_award"

CREATE = """
CREATE PROCEDURE sp_score_award(
    IN p_id CHAR(36), IN p_user CHAR(36), IN p_type VARCHAR(50),
    IN p_ref VARCHAR(64), IN p_meta TEXT)
proc: BEGIN
  DECLARE v_points DECIMAL(5,2) DEFAULT 0;
  DECLARE v_active TINYINT DEFAULT 0;
  DECLARE v_cap_type VARCHAR(12) DEFAULT 'none';
  DECLARE v_cap_value INT DEFAULT NULL;
  DECLARE v_used INT DEFAULT 0;
  DECLARE v_dupe INT DEFAULT 0;
  DECLARE v_award DECIMAL(5,2) DEFAULT 0;
  DECLARE v_capped TINYINT DEFAULT 0;
  DECLARE v_user INT DEFAULT 0;

  -- No FK protects score_events, so this is the only thing standing between a
  -- stale/wrong id and an orphan ledger row that analytics and decay will read.
  SELECT COUNT(*) INTO v_user
    FROM users WHERE id = p_user AND deleted_at IS NULL;

  IF v_user = 0 THEN
    SELECT 0 AS awarded, 'unknown_user' AS result;
    LEAVE proc;
  END IF;

  SELECT points, is_active, cap_type, cap_value
    INTO v_points, v_active, v_cap_type, v_cap_value
    FROM score_event_rules WHERE event_type = p_type;

  IF v_active = 0 THEN
    SELECT 0 AS awarded, 'unknown_or_inactive' AS result;
  ELSE
    -- per_item caps ride on ref_id: one award per cohort / application /
    -- document. The unique key makes this idempotent under retries.
    IF p_ref IS NOT NULL THEN
      SELECT COUNT(*) INTO v_dupe FROM score_events
       WHERE user_id = p_user AND event_type = p_type AND ref_id = p_ref;
    END IF;

    IF v_dupe > 0 THEN
      SELECT 0 AS awarded, 'duplicate' AS result;
    ELSE
      -- How many awards already landed inside this cap's window?
      -- Capped rows (meta='capped') do not consume the allowance.
      IF v_cap_type = 'daily' THEN
        SELECT COUNT(*) INTO v_used FROM score_events
         WHERE user_id = p_user AND event_type = p_type
           AND (meta IS NULL OR meta <> 'capped')
           AND occurred_at >= UTC_DATE();
      ELSEIF v_cap_type = 'weekly' THEN
        SELECT COUNT(*) INTO v_used FROM score_events
         WHERE user_id = p_user AND event_type = p_type
           AND (meta IS NULL OR meta <> 'capped')
           AND YEARWEEK(occurred_at, 1) = YEARWEEK(UTC_TIMESTAMP(), 1);
      ELSEIF v_cap_type = 'monthly' THEN
        SELECT COUNT(*) INTO v_used FROM score_events
         WHERE user_id = p_user AND event_type = p_type
           AND (meta IS NULL OR meta <> 'capped')
           AND YEAR(occurred_at) = YEAR(UTC_TIMESTAMP())
           AND MONTH(occurred_at) = MONTH(UTC_TIMESTAMP());
      ELSEIF v_cap_type IN ('lifetime', 'once') THEN
        SELECT COUNT(*) INTO v_used FROM score_events
         WHERE user_id = p_user AND event_type = p_type
           AND (meta IS NULL OR meta <> 'capped');
      ELSE
        SET v_used = 0;
      END IF;

      IF v_cap_value IS NOT NULL AND v_used >= v_cap_value THEN
        SET v_award = 0; SET v_capped = 1;
      ELSE
        SET v_award = v_points;
      END IF;

      -- Playbook §9.1(5): a capped action is still logged, with delta 0, so
      -- we keep visibility into what the student actually did.
      INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
      VALUES (p_id, p_user, p_type, v_award, p_ref,
              IF(v_capped = 1, 'capped', p_meta));

      INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
      VALUES (UUID(), p_user, 0, 'Explorer', UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE last_event_at = UTC_TIMESTAMP();

      SELECT v_award AS awarded, IF(v_capped = 1, 'capped', 'awarded') AS result;
    END IF;
  END IF;
END
"""


def main():
    with app.app_context():
        # This migration NO LONGER recreates sp_score_award.
        # migrate_score_task_batches owns it, and that version carries the batch
        # toggle, the pause release and the decay restore on top of this guard.
        # Recreating the copy below would silently drop all three, which is what
        # re-running this file used to do. The CREATE is kept only as the record
        # of what this change introduced; what runs now is the check.
        live = db.session.execute(text(
            "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_score_award'"
        )).scalar() or ''
        if 'unknown_user' in live:
            print("  sp_score_award already carries the user guard")
        else:
            raise SystemExit(
                "  sp_score_award is missing the user guard. Run "
                "migrate_score_task_batches.py -- it owns the current version.")
        db.session.commit()
        print('sp_score_award: rebuilt with the unknown-user guard')

        # Any orphan the old body left behind is unreachable data — no login can
        # ever reach it, and it skews every count that reads these two tables.
        orphan_events = db.session.execute(text("""
            SELECT COUNT(*) FROM score_events e
             WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = e.user_id)
        """)).scalar()
        orphan_scores = db.session.execute(text("""
            SELECT COUNT(*) FROM readiness_scores r
             WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)
        """)).scalar()
        print(f'orphan score_events: {orphan_events} | '
              f'orphan readiness_scores: {orphan_scores}')
        if orphan_events or orphan_scores:
            print('  -> review before deleting; this migration reports, it does not purge.')


if __name__ == '__main__':
    main()
