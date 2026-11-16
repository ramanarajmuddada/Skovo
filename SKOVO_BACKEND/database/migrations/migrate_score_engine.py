"""
Migration: Readiness Score Engine (v1 spec, Playbook §5.7 / §9).

Append-only ledger with config-driven point values and windowed caps:

  * score_event_rules  — points (fractional) + cap_type/cap_value, admin editable
  * score_events       — append-only log; capped activity is logged with delta 0
  * score_pause_tokens — 2 per calendar year, each freezing decay for 21 days
  * decay              — -1/day once a student is idle past the grace window

score = clamp(0, 100, floor(sum(ledger points) - decay_points)). Caps are
enforced at WRITE time (Playbook §9.1), so the ledger is the source of truth
and the score row is a materialisation of it.

Point values seeded from the Engineering Playbook §5.7 table, which supersedes
the earlier Product Scope handoff where the two disagree.

Idempotent. Run from SKOVO_BACKEND:  python migrate_score_engine.py
"""

# NOTE (migrate_drop_level_min_columns): readiness_rules.pioneer_min and
# achiever_min no longer exist. The three procedure bodies below used to read
# them; they now use the same numbers as literals, so this migration still
# applies cleanly to a fresh database and still produces exactly the behaviour
# it originally did. The later migration replaces all three with versions that
# resolve the band from `readiness_levels`.

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

# event_type, label, points, cap_type, cap_value, is_active
#
# cap_type: none | once | lifetime | daily | weekly | monthly | per_item
#   per_item caps are enforced by ref_id (one award per cohort/application/etc).
CAP_NONE = 'none'
V1_RULES = [
    ('profile_completed',       'Completed profile — all 4 vault folders',  5,   'once',     1,  1),
    ('college_saved',           'Saved a college',                          0,   'lifetime', 10, 1),
    ('college_viewed',          'Viewed a college in detail',               0,   'daily',    1,  1),
    ('cohort_attended',         'Attended a cohort (verified check-in)',    2,   'per_item', 1,  1),
    ('cohort_completed',        'Completed a cohort + task',                8,   'per_item', 1,  1),
    ('cohort_repeat_week',      'Repeat cohort attendance same week',       2,   'weekly',   1,  1),
    ('community_post',          'Posted in a community',                    0.5, 'daily',    3,  1),
    ('community_reactions',     'Received 5 reactions on a post',           0.5, 'daily',    1,  1),
    ('community_join',          'Joined a new community',                   1,   'lifetime', 5,  1),
    ('market_redeem',           'Redeemed a Market deal',                   2,   'monthly',  5,  1),
    ('document_uploaded',       'Uploaded a document',                      2,   'lifetime', 5,  1),
    ('application_submitted',   'Applied to an opportunity',                3,   'per_item', 1,  1),
    ('opportunity_shortlisted', 'Shortlisted for an interview',             10,  'per_item', 1,  1),
    # Not in the v1 spec list, but this build has a graded readiness assessment.
    # Written by sp_score_set_assessment, so it carries no flat value or cap.
    ('assessment_completed',    'Completed the readiness assessment',       0,   CAP_NONE,   None, 1),
]

# Rules from the earlier cut of this engine that the v1 spec does not include.
# Kept for their history but switched off so they cannot score.
RETIRED = ['cohort_enrolled', 'task_approved', 'course_completed', 'mock_test_completed',
           'certification_added', 'forum_post', 'referral_completed', 'community_post_legacy']

STMTS = [
    # ── config: what each action is worth ─────────────────────────────────
    ("table", """
    CREATE TABLE IF NOT EXISTS score_event_rules (
      event_type VARCHAR(50) PRIMARY KEY,
      label VARCHAR(160) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      max_total INT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    """),

    # ── the ledger: append-only, one row per award (or capped attempt) ─────
    ("table", """
    CREATE TABLE IF NOT EXISTS score_events (
      id CHAR(36) PRIMARY KEY,
      seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
      user_id CHAR(36) NOT NULL,
      event_type VARCHAR(50) NOT NULL,
      points INT NOT NULL DEFAULT 0,
      ref_id VARCHAR(64) NULL,
      meta TEXT NULL,
      occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_se_user (user_id, occurred_at),
      INDEX idx_se_type (user_id, event_type),
      UNIQUE KEY uq_se_ref (user_id, event_type, ref_id)
    )
    """),

    ("table", """
    CREATE TABLE IF NOT EXISTS score_pause_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      starts_at DATETIME NOT NULL,
      ends_at DATETIME NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_spt_user (user_id, starts_at)
    )
    """),

    # ── admin score adjustments carry a mandatory audit trail (§5.7) ───────
    ("table", """
    CREATE TABLE IF NOT EXISTS score_adjustments (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      admin_id CHAR(36) NOT NULL,
      delta INT NOT NULL,
      reason TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_sadj_user (user_id, created_at)
    )
    """),

    ("alter", "ALTER TABLE score_events ADD COLUMN seq BIGINT NOT NULL AUTO_INCREMENT UNIQUE"),

    # ── fractional points (+0.5 signals in the spec) ───────────────────────
    ("modify", "ALTER TABLE score_events MODIFY COLUMN points DECIMAL(5,2) NOT NULL DEFAULT 0"),
    ("modify", "ALTER TABLE score_event_rules MODIFY COLUMN points DECIMAL(5,2) NOT NULL DEFAULT 0"),
    ("modify", "ALTER TABLE score_adjustments MODIFY COLUMN delta DECIMAL(5,2) NOT NULL DEFAULT 0"),

    # ── windowed caps replace the old points-total cap ─────────────────────
    ("alter", "ALTER TABLE score_event_rules ADD COLUMN cap_type VARCHAR(12) NOT NULL DEFAULT 'none'"),
    ("alter", "ALTER TABLE score_event_rules ADD COLUMN cap_value INT NULL"),
    # max_total was a points ceiling; caps are now counts within a window.
    ("drop", "ALTER TABLE score_event_rules DROP COLUMN max_total"),

    ("alter", "ALTER TABLE readiness_rules ADD COLUMN decay_grace_days INT NOT NULL DEFAULT 7"),
    ("alter", "ALTER TABLE readiness_rules ADD COLUMN decay_per_day INT NOT NULL DEFAULT 1"),
    ("alter", "ALTER TABLE readiness_rules ADD COLUMN pause_tokens_per_year INT NOT NULL DEFAULT 2"),
    ("alter", "ALTER TABLE readiness_rules ADD COLUMN pause_days INT NOT NULL DEFAULT 21"),

    ("alter", "ALTER TABLE readiness_scores ADD COLUMN base_points INT NOT NULL DEFAULT 0"),
    ("modify", "ALTER TABLE readiness_scores MODIFY COLUMN base_points DECIMAL(7,2) NOT NULL DEFAULT 0"),
    ("alter", "ALTER TABLE readiness_scores ADD COLUMN decay_points INT NOT NULL DEFAULT 0"),
    ("alter", "ALTER TABLE readiness_scores ADD COLUMN last_event_at DATETIME NULL"),
    ("alter", "ALTER TABLE readiness_scores ADD COLUMN last_decay_on DATE NULL"),

    # ══ award, with write-time cap enforcement ════════════════════════════
    # sp_score_award is NOT created here -- migrate_score_task_batches owns it.
    # That version carries: batch toggle, pause release, decay restore.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # ══ rebuild the score from the ledger ═════════════════════════════════
    # sp_score_recalc is NOT created here -- migrate_score_direct_credits owns it.
    # That version carries: direct credits count without a rule row.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # ══ graded assessment restates rather than appends ════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_score_set_assessment"),
    ("sp", """
    CREATE PROCEDURE sp_score_set_assessment(IN p_user CHAR(36), IN p_points INT)
    BEGIN
      -- Re-graded on every step save, so this is the one correcting write in an
      -- otherwise append-only log.
      DELETE FROM score_events
       WHERE user_id = p_user AND event_type = 'assessment_completed';

      IF IFNULL(p_points, 0) > 0 THEN
        INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
        VALUES (UUID(), p_user, 'assessment_completed', p_points, 'assessment',
                'graded readiness assessment total');
      END IF;

      INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
      VALUES (UUID(), p_user, 0,
              IFNULL((SELECT l.label FROM readiness_levels l
                       WHERE l.is_active = 1 AND l.min_score <= 0
                       ORDER BY l.min_score DESC LIMIT 1), ''),
              UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE last_event_at = UTC_TIMESTAMP();

      SELECT IFNULL(p_points, 0) AS points;
    END
    """),

    # ══ admin manual adjustment, always audited ═══════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_score_adjust"),
    ("sp", """
    CREATE PROCEDURE sp_score_adjust(IN p_id CHAR(36), IN p_user CHAR(36),
                                     IN p_admin CHAR(36), IN p_delta DECIMAL(5,2), IN p_reason TEXT)
    BEGIN
      INSERT INTO score_adjustments (id, user_id, admin_id, delta, reason)
      VALUES (p_id, p_user, p_admin, p_delta, p_reason);

      INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
      VALUES (UUID(), p_user, 'admin_adjustment', p_delta, p_id,
              CONCAT('admin adjustment: ', LEFT(p_reason, 200)));

      INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
      VALUES (UUID(), p_user, 0,
              IFNULL((SELECT l.label FROM readiness_levels l
                       WHERE l.is_active = 1 AND l.min_score <= 0
                       ORDER BY l.min_score DESC LIMIT 1), ''),
              UTC_TIMESTAMP())
      ON DUPLICATE KEY UPDATE last_event_at = last_event_at;

      SELECT 1 AS ok, p_delta AS delta;
    END
    """),

    ("sp", "DROP PROCEDURE IF EXISTS sp_score_adjustments_list"),
    ("sp", """
    CREATE PROCEDURE sp_score_adjustments_list(IN p_user CHAR(36), IN p_limit INT)
    BEGIN
      SELECT a.id, a.user_id, a.admin_id, a.delta, a.reason, a.created_at
        FROM score_adjustments a
       WHERE (p_user IS NULL OR a.user_id = p_user)
       ORDER BY a.created_at DESC LIMIT p_limit;
    END
    """),

    # ══ ledger + breakdown ════════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_score_events_list"),
    ("sp", """
    CREATE PROCEDURE sp_score_events_list(IN p_user CHAR(36), IN p_limit INT, IN p_offset INT)
    BEGIN
      SELECT e.id, e.event_type, e.points, e.ref_id, e.occurred_at, e.meta,
             COALESCE(
               r.label,
               CASE e.event_type
                 WHEN 'admin_adjustment' THEN 'Adjustment by Skovo'
                 WHEN 'admin_task'       THEN 'Task from Skovo'
                 WHEN 'referral_bonus'   THEN 'Referral reward'
               END,
               -- No rule and no name: spell the key as words rather than show
               -- a student raw snake_case.
               CONCAT(UPPER(LEFT(REPLACE(e.event_type, '_', ' '), 1)),
                      SUBSTRING(REPLACE(e.event_type, '_', ' '), 2))
             ) AS label
        FROM score_events e
        LEFT JOIN score_event_rules r ON r.event_type = e.event_type
       WHERE e.user_id = p_user
       ORDER BY e.seq DESC
       LIMIT p_limit OFFSET p_offset;
    END
    """),

    # sp_score_breakdown is NOT created here -- migrate_v1_stages owns it.
    # That version counts only the active stage and labels the stage_boost
    # credit. One owner per procedure, always.

    # ══ nightly decay sweep ═══════════════════════════════════════════════
    # sp_score_decay_run is NOT created here -- migrate_decay_interval owns it.
    # That version carries: decay_interval_days, level from readiness_levels.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # ══ pause tokens ══════════════════════════════════════════════════════
    # sp_score_pause_start is NOT created here -- migrate_pause_fairness owns it.
    # That version carries: signup-anniversary window, charge only if it helped.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # sp_score_pause_status is NOT created here -- migrate_pause_fairness owns it.
    # That version carries: grace_days and resets_on.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # ══ unlocks ═══════════════════════════════════════════════════════════
    # sp_score_unlocks is NOT created here -- migrate_drop_level_min_columns owns it.
    # That version carries: pioneer_min/achiever_min dropped.
    # An older copy lived here and a re-run of this file reverted the
    # live procedure to it. One owner per procedure, always.

    # ══ admin config ══════════════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_score_rules_list"),
    ("sp", """
    CREATE PROCEDURE sp_score_rules_list(IN p_active_only TINYINT)
    BEGIN
      SELECT * FROM score_event_rules
       WHERE (p_active_only = 0 OR is_active = 1)
       ORDER BY is_active DESC, points DESC, event_type ASC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_score_rule_update"),
    ("sp", """
    CREATE PROCEDURE sp_score_rule_update(
        IN p_type VARCHAR(50), IN p_label VARCHAR(160), IN p_points DECIMAL(5,2),
        IN p_cap_type VARCHAR(12), IN p_cap_value INT, IN p_is_active TINYINT)
    BEGIN
      UPDATE score_event_rules SET
        label = COALESCE(p_label, label),
        points = COALESCE(p_points, points),
        cap_type = COALESCE(p_cap_type, cap_type),
        cap_value = p_cap_value,
        is_active = COALESCE(p_is_active, is_active)
      WHERE event_type = p_type;
      SELECT * FROM score_event_rules WHERE event_type = p_type;
    END
    """),
]


def main():
    with app.app_context():
        for kind, s in STMTS:
            try:
                db.session.execute(text(s)); db.session.commit()
            except Exception as e:
                db.session.rollback()
                msg = str(e)
                if kind == "alter" and ("Duplicate column" in msg or "Duplicate key" in msg):
                    pass
                elif kind == "drop" and ("check that it exists" in msg or "Can't DROP" in msg):
                    pass
                else:
                    raise

        # Seed the v1 rule set ONCE, on a fresh install only.
        #
        # This used to re-seed on every run, with ON DUPLICATE KEY UPDATE
        # pinning the shipped points back. That is wrong twice over: it undid
        # an admin's edits, and -- worse -- it resurrected every action the
        # admin had DELETED. Deleting an action is a decision, and a migration
        # re-run (which is how a procedure change gets applied) silently
        # reversed it, putting 15 scoring rules back and moving 52 students'
        # scores on the next recalc.
        #
        # An empty table means a fresh database. A table with anything in it is
        # a live configuration and this migration does not touch it.
        seeded = db.session.execute(text(
            "SELECT COUNT(*) FROM score_event_rules")).scalar()
        if seeded:
            print(f"  score_event_rules already configured ({seeded} rows) - seed skipped")
        for event_type, label, points, cap_type, cap_value, is_active in ([] if seeded else V1_RULES):
            db.session.execute(text("""
                INSERT INTO score_event_rules
                       (event_type, label, points, cap_type, cap_value, is_active)
                VALUES (:t, :l, :p, :ct, :cv, :a)
                ON DUPLICATE KEY UPDATE
                       label = VALUES(label),
                       points = VALUES(points),
                       cap_type = VALUES(cap_type),
                       cap_value = VALUES(cap_value),
                       is_active = VALUES(is_active)
            """), {'t': event_type, 'l': label, 'p': points,
                   'ct': cap_type, 'cv': cap_value, 'a': is_active})

        if not seeded:
            # Retire pre-spec rules (kept for history, switched off).
            db.session.execute(text(
                "UPDATE score_event_rules SET is_active = 0 WHERE event_type IN :r"
            ).bindparams(r=tuple(RETIRED)))

            # Admin adjustments are a real event type but never auto-awarded.
            db.session.execute(text("""
                INSERT INTO score_event_rules (event_type, label, points, cap_type, cap_value, is_active)
                VALUES ('admin_adjustment', 'Manual adjustment by Skovo team', 0, 'none', NULL, 1)
                ON DUPLICATE KEY UPDATE label = VALUES(label)
            """))
            print(f"  seeded {len(V1_RULES)} v1 rules")
        db.session.commit()

        # ── Backfill: the ledger now owns cohorts, so mint events for history
        # that the retired derived path used to score. Unique key makes it safe
        # to re-run.
        db.session.execute(text("""
            INSERT IGNORE INTO score_events (id, user_id, event_type, points, ref_id, meta)
            SELECT UUID(), e.user_id, 'cohort_attended', 2, e.cohort_id, 'backfill'
              FROM cohort_enrollments e
             WHERE e.payment_status IN ('paid','free')
        """))
        db.session.execute(text("""
            INSERT IGNORE INTO score_events (id, user_id, event_type, points, ref_id, meta)
            SELECT UUID(), t.user_id, 'cohort_completed', 8, t.id, 'backfill'
              FROM task_submissions t
             WHERE t.status = 'approved'
        """))
        db.session.commit()

        # Rebuild every score off the new ledger.
        users = db.session.execute(text("SELECT user_id FROM readiness_scores")).fetchall()
        for (uid,) in users:
            db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': uid})
        db.session.commit()

        print(f"score engine migration complete. rules={len(V1_RULES)} rescored={len(users)}")


if __name__ == "__main__":
    main()
