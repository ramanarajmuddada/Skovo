"""
Migration: repair the Career Readiness Score pipeline.

Three things, all idempotent:

  1. Install `sp_score_cohort_week_count` — the lookup behind the
     `cohort_repeat_week` rule. That rule has been active in
     score_event_rules since the engine shipped, but nothing ever raised the
     signal, so it was config with no code behind it. `award_cohort_attendance`
     in portal/helpers/score.py now calls this.

  2. Rebuild every student's cached score from the ledger. `readiness_scores`
     is a cache of `score_events`; the dashboard reads the cache. Any award
     whose recalc was skipped — zero-point signals and capped rows both took
     that path before this change — left the cache behind the ledger, and the
     student saw the stale number.

  3. Report what the ledger actually holds, so "the score is stuck at 0" can be
     told apart from "the student has not done anything that scores yet".
     Nothing here invents points: a score of 0 with an empty ledger is the
     engine working, not the engine broken.

Run from SKOVO_BACKEND:
    ./venv/Scripts/python.exe database/migrations/migrate_score_repair.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

WEEK_COUNT_SP = """
CREATE PROCEDURE sp_score_cohort_week_count(IN p_user CHAR(36), IN p_cohort VARCHAR(64))
BEGIN
  -- Cohorts this student has already been paid for attending inside the
  -- current ISO week, excluding the one being checked in to right now.
  -- Anything above zero makes the check-in a repeat, which is what the
  -- cohort_repeat_week rule pays for. Excluding p_cohort means the answer does
  -- not depend on whether the new cohort_attended row is in yet.
  SELECT COUNT(*) AS prior_this_week,
         YEARWEEK(UTC_TIMESTAMP(), 1) AS week_key
    FROM score_events
   WHERE user_id = p_user
     AND event_type = 'cohort_attended'
     AND (p_cohort IS NULL OR ref_id IS NULL OR ref_id <> p_cohort)
     AND YEARWEEK(occurred_at, 1) = YEARWEEK(UTC_TIMESTAMP(), 1);
END
"""


def main():
    with app.app_context():
        # ── 1. the repeat-week lookup ───────────────────────────────────────
        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_score_cohort_week_count"))
        db.session.execute(text(WEEK_COUNT_SP))
        db.session.commit()
        print("installed sp_score_cohort_week_count")

        # ── 2. rebuild every cached score off the ledger ────────────────────
        users = db.session.execute(text(
            "SELECT id FROM users WHERE deleted_at IS NULL")).fetchall()
        moved = []
        for (uid,) in users:
            before = db.session.execute(text(
                "SELECT IFNULL(score, 0) FROM readiness_scores WHERE user_id = :u"),
                {"u": uid}).scalar()
            db.session.execute(text("CALL sp_score_recalc(:u)"), {"u": uid})
            after = db.session.execute(text(
                "SELECT IFNULL(score, 0) FROM readiness_scores WHERE user_id = :u"),
                {"u": uid}).scalar()
            if int(before or 0) != int(after or 0):
                moved.append((uid, int(before or 0), int(after or 0)))
        db.session.commit()
        print(f"rebuilt {len(users)} score(s); {len(moved)} changed")
        for uid, b, a in moved:
            print(f"  {uid}  {b} -> {a}")

        # ── 3. what the ledger holds ────────────────────────────────────────
        print("\nledger by event type:")
        rows = db.session.execute(text(
            "SELECT event_type, COUNT(*) n, IFNULL(SUM(points), 0) pts "
            "  FROM score_events GROUP BY event_type ORDER BY n DESC")).fetchall()
        if not rows:
            print("  (empty — no student has completed a scoring action yet)")
        for et, n, pts in rows:
            print(f"  {et:<26} {n:>5} event(s)  {pts:>7} pt(s)")

        gate = db.session.execute(text(
            "SELECT opportunity_unlock_score FROM readiness_rules "
            " ORDER BY created_at DESC LIMIT 1")).scalar()
        print(f"\nOpportunity Hub gate (readiness_rules): {gate}")
        print("Every screen now reads that number — nothing hardcodes 60 any more.")


if __name__ == "__main__":
    main()
