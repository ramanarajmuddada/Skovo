"""
Migration: automatic score pause (the "streak freeze" pattern).

Why this exists
---------------
The score decays -1/day once a student is idle past the grace window. The
research on streak penalties is consistent: losing a streak triggers the
abstinence-violation effect and users quit rather than rebuild. Duolingo's
answer is the Streak Freeze, and crucially it is PRE-EQUIPPED — it protects you
without you remembering to use it. That single mechanic cut their at-risk churn
by ~21%.

We already had the ingredient: 2 pause tokens per student per year, 21 days
each. But it was passive — a student had to know the feature existed and spend
one before going quiet. Nobody about to disappear for exams stops to do that.

So: the nightly sweep now spends a token FOR the student, the moment decay is
about to start, and the app tells them it happened.

Who gets auto-paused
--------------------
Only students with something to lose (base_points >= a floor). Auto-pausing an
account at 0 points would burn a token to protect nothing, and would leave a
genuinely returning student with no tokens left when they need one. A student
who never started is not the one this mechanic is for.

Indian exam seasons (boards and semesters, roughly Nov-Dec and Mar-May) are
exactly when a serious student goes quiet — decaying them for studying is the
platform working against the thing it claims to support. `autopause_months`
lets ops widen protection over those windows without a deploy.

Idempotent. Run from SKOVO_BACKEND:  python migrate_score_autopause.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

# Students below this have not built anything a pause would protect.
AUTOPAUSE_MIN_POINTS = 10


def _column_exists(table, column):
    row = db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c
    """), {'t': table, 'c': column}).scalar()
    return bool(row)


def main():
    # RETIRED. This migration introduced automatic pause protection, and
    # migrate_remove_autopause.py has since removed the feature entirely --
    # the procedures are dropped and readiness_rules.autopause_enabled /
    # autopause_min_points no longer exist. Students manage their own pauses.
    #
    # Running the original body would bring all of it back. The file is kept
    # for the history it records; the body below is unreachable.
    print("  autopause was removed by migrate_remove_autopause.py - nothing to do")
    return

    with app.app_context():
        # ── config columns on readiness_rules (admin-tunable, no deploy) ─────
        for col, ddl in [
            ('autopause_enabled',
             "ALTER TABLE readiness_rules ADD COLUMN autopause_enabled TINYINT(1) NOT NULL DEFAULT 1"),
            ('autopause_min_points',
             f"ALTER TABLE readiness_rules ADD COLUMN autopause_min_points INT NOT NULL DEFAULT {AUTOPAUSE_MIN_POINTS}"),
        ]:
            if not _column_exists('readiness_rules', col):
                db.session.execute(text(ddl))
        db.session.commit()

        # Mark tokens the system spent on the student's behalf, so the app can
        # say "we paused this for you" rather than implying they chose it.
        if not _column_exists('score_pause_tokens', 'is_auto'):
            db.session.execute(text(
                "ALTER TABLE score_pause_tokens ADD COLUMN is_auto TINYINT(1) NOT NULL DEFAULT 0"))
        db.session.commit()

        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_score_autopause_run"))
        db.session.commit()

        # Runs immediately BEFORE sp_score_decay_run in the nightly sweep. Any
        # student it pauses is then skipped by the decay pass, which already
        # excludes anyone with a live pause token.
        db.session.execute(text("""
            CREATE PROCEDURE sp_score_autopause_run()
            BEGIN
              DECLARE v_grace INT DEFAULT 7;
              DECLARE v_max   INT DEFAULT 2;
              DECLARE v_days  INT DEFAULT 21;
              DECLARE v_on    TINYINT(1) DEFAULT 1;
              DECLARE v_floor INT DEFAULT 10;
              DECLARE v_hit   INT DEFAULT 0;

              SELECT IFNULL(decay_grace_days,7), IFNULL(pause_tokens_per_year,2),
                     IFNULL(pause_days,21), IFNULL(autopause_enabled,1),
                     IFNULL(autopause_min_points,10)
                INTO v_grace, v_max, v_days, v_on, v_floor
                FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

              IF v_on = 0 THEN
                SELECT 0 AS paused;
              ELSE
                -- One row per student who is about to start decaying, still has
                -- a token this calendar year, and has points worth protecting.
                INSERT INTO score_pause_tokens (id, user_id, starts_at, ends_at, is_auto)
                SELECT UUID(), rs.user_id, UTC_TIMESTAMP(),
                       DATE_ADD(UTC_TIMESTAMP(), INTERVAL v_days DAY), 1
                  FROM readiness_scores rs
                 WHERE rs.last_event_at IS NOT NULL
                   AND rs.last_event_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL v_grace DAY)
                   AND rs.base_points >= v_floor
                   AND rs.decay_points = 0            -- not already eroding
                   AND NOT EXISTS (
                         SELECT 1 FROM score_pause_tokens p
                          WHERE p.user_id = rs.user_id
                            AND UTC_TIMESTAMP() BETWEEN p.starts_at AND p.ends_at)
                   AND (SELECT COUNT(*) FROM score_pause_tokens p2
                         WHERE p2.user_id = rs.user_id
                           AND YEAR(p2.starts_at) = YEAR(UTC_TIMESTAMP())) < v_max;

                SET v_hit = ROW_COUNT();
                SELECT v_hit AS paused;
              END IF;
            END
        """))
        db.session.commit()

        # Who was just auto-paused, so the caller can tell them.
        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_score_autopause_recent"))
        db.session.commit()
        db.session.execute(text("""
            CREATE PROCEDURE sp_score_autopause_recent(IN p_minutes INT)
            BEGIN
              SELECT t.user_id, t.ends_at, u.full_name, u.email
                FROM score_pause_tokens t
                JOIN users u ON u.id = t.user_id
               WHERE t.is_auto = 1
                 AND t.starts_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL p_minutes MINUTE);
            END
        """))
        db.session.commit()

        print("autopause migration complete: 3 columns, 2 procedures")


if __name__ == "__main__":
    main()
