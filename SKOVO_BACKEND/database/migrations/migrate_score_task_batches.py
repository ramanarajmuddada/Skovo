"""Tasks are organised into batches, and a batch decides whether global applies.

WHY
    The Tasks tab had three cards -- everyone, a batch, one student -- and a task
    carried its own targeting. So "the B.Tech students" was not a thing you could
    point at; it was a pair of columns repeated on every task, and retargeting
    meant editing each one.

    A batch is now an object. You define the audience once and hang as many
    tasks off it as you like.

THE TOGGLE
    Each batch carries `include_global`:

        ON   students in this batch earn from Tab 1 Actions AND its own tasks
        OFF  students in this batch earn from its own tasks only

    That makes Actions no longer unconditionally global, which is a deliberate
    change: a batch can now be scored purely on assigned work.

MOST SPECIFIC BATCH WINS
    A student can match several batches -- `Any/Any` and `UG/B.Tech` both match
    a B.Tech student. The narrower one decides:

        Any  . Any        specificity 0
        UG   . Any        specificity 1
        UG   . B.Tech     specificity 2   <- this one

    Without that rule a broad batch with the toggle ON would silently override a
    narrow batch with it OFF, and the toggle would never do anything. On a tie at
    the same specificity the OFF wins, so an explicit opt-out is never lost to
    row order.

    No matching batch at all means global applies. That is the default, so
    nothing changes for a student until an admin deliberately carves them out.

FORWARD ONLY
    Turning the toggle off stops FUTURE global awards. It never removes points
    already earned: the ledger is append-only and the score sums whatever is in
    it, so past events keep counting with no clawback. A global task already
    under way stays visible and still pays if finished.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_task_batches.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

BATCHES_DDL = """
CREATE TABLE IF NOT EXISTS `score_task_batches` (
  `id`                 CHAR(36)     NOT NULL,
  `name`               VARCHAR(120) NOT NULL,
  `education_category` VARCHAR(50)  NULL,
  `degree_type`        VARCHAR(60)  NULL,
  -- ON: Tab 1 Actions apply to these students as well as the batch's own tasks.
  `include_global`     TINYINT(1)   NOT NULL DEFAULT 1,
  -- How exactly this batch describes a student. The highest one wins when
  -- several match, so a narrow batch beats `Any / Any`.
  `specificity` TINYINT AS (
      (`education_category` IS NOT NULL AND `education_category` <> '')
    + (`degree_type` IS NOT NULL AND `degree_type` <> '')
  ) STORED,
  -- UNIQUE cannot police the audience directly because NULL never collides
  -- with NULL in an index, so the pair is folded into one comparable key.
  `match_key` VARCHAR(120) AS (
      CONCAT(IFNULL(NULLIF(`education_category`, ''), '~'), '|',
             IFNULL(NULLIF(`degree_type`, ''), '~'))
  ) STORED,
  `is_active`  TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` CHAR(36)   NULL,
  `updated_at` DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` CHAR(36)   NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_batch_match` (`match_key`),
  KEY `ix_batch_specificity` (`specificity`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# The one predicate that answers "does global apply to this student". Written
# once and pasted into every reader so the rule cannot drift between them.
GLOBAL_OK = """IFNULL((
        SELECT b.`include_global`
          FROM `score_task_batches` b
          LEFT JOIN `user_profiles` up ON up.`user_id` = {user}
         WHERE b.`is_active` = 1
           AND (b.`education_category` IS NULL OR b.`education_category` = ''
                OR b.`education_category` = up.`education_category`)
           AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                OR b.`degree_type` = up.`degree_type`)
         ORDER BY b.`specificity` DESC, b.`include_global` ASC
         LIMIT 1
      ), 1)"""

# Credits that are NOT global actions and must always land, whatever the toggle
# says: a batch's own task, a manual adjustment, a referral reward.
NEVER_BLOCKED = "('admin_task', 'admin_adjustment', 'referral_bonus')"

PROCEDURES = [

    ("sp_score_batch_upsert", """
CREATE PROCEDURE `sp_score_batch_upsert`(
    IN p_id     CHAR(36),
    IN p_name   VARCHAR(120),
    IN p_edu    VARCHAR(50),
    IN p_degree VARCHAR(60),
    IN p_global TINYINT,
    IN p_admin  CHAR(36)
)
BEGIN
    IF p_id IS NULL OR p_id = '' THEN SET p_id = UUID(); END IF;
    SET p_edu    = NULLIF(TRIM(IFNULL(p_edu, '')), '');
    SET p_degree = NULLIF(TRIM(IFNULL(p_degree, '')), '');

    INSERT INTO `score_task_batches`
        (`id`, `name`, `education_category`, `degree_type`, `include_global`,
         `created_by`, `updated_by`)
    VALUES (p_id, p_name, p_edu, p_degree, IFNULL(p_global, 1), p_admin, p_admin)
    ON DUPLICATE KEY UPDATE
        `name`           = VALUES(`name`),
        `include_global` = VALUES(`include_global`),
        `is_active`      = 1,
        `updated_by`     = VALUES(`updated_by`);

    SELECT * FROM `score_task_batches`
     WHERE `match_key` = CONCAT(IFNULL(p_edu, '~'), '|', IFNULL(p_degree, '~'));
END
"""),

    ("sp_score_batch_list", """
CREATE PROCEDURE `sp_score_batch_list`()
BEGIN
    SELECT b.*,
           (SELECT COUNT(*) FROM `score_tasks` t
             WHERE t.`batch_id` = b.`id` AND t.`status` = 'active') AS task_count,
           (SELECT COUNT(*) FROM `user_profiles` p
             JOIN `users` u ON u.`id` = p.`user_id` AND u.`deleted_at` IS NULL
            WHERE (b.`education_category` IS NULL OR b.`education_category` = ''
                   OR p.`education_category` = b.`education_category`)
              AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                   OR p.`degree_type` = b.`degree_type`)) AS student_count
      FROM `score_task_batches` b
     WHERE b.`is_active` = 1
     ORDER BY b.`specificity` ASC, b.`name` ASC;
END
"""),

    ("sp_score_batch_delete", """
CREATE PROCEDURE `sp_score_batch_delete`(IN p_id CHAR(36))
BEGIN
    DECLARE v_tasks INT DEFAULT 0;
    SELECT COUNT(*) INTO v_tasks FROM `score_tasks` WHERE `batch_id` = p_id;

    IF v_tasks > 0 THEN
        -- Its tasks have paid people. Deactivating keeps the ledger readable;
        -- deleting would leave paid events pointing at nothing.
        UPDATE `score_task_batches` SET `is_active` = 0 WHERE `id` = p_id;
        SELECT 'deactivated' AS result, v_tasks AS tasks;
    ELSE
        DELETE FROM `score_task_batches` WHERE `id` = p_id;
        SELECT 'deleted' AS result, 0 AS tasks;
    END IF;
END
"""),

    ("sp_score_batch_task_upsert", """
CREATE PROCEDURE `sp_score_batch_task_upsert`(
    IN p_id     CHAR(36),
    IN p_batch  CHAR(36),
    IN p_label  VARCHAR(160),
    IN p_points DECIMAL(5,2),  -- was INT: 0.2 / 0.5 rounded to 0
    IN p_same   CHAR(36),
    IN p_status VARCHAR(20),
    -- The admin route has always sent "Where they do it" here; the procedure
    -- had no slot for it, so every save from the Tasks tab failed on arity.
    IN p_route  VARCHAR(80),
    IN p_admin  CHAR(36)
)
BEGIN
    DECLARE v_cat    VARCHAR(50);
    DECLARE v_degree VARCHAR(60);
    DECLARE v_root   CHAR(36) DEFAULT NULL;

    SELECT `education_category`, `degree_type` INTO v_cat, v_degree
      FROM `score_task_batches` WHERE `id` = p_batch;

    IF v_cat IS NULL AND v_degree IS NULL
       AND NOT EXISTS (SELECT 1 FROM `score_task_batches` WHERE `id` = p_batch) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'BATCH_NOT_FOUND';
    END IF;

    IF p_same IS NOT NULL AND p_same <> '' THEN
        SELECT IFNULL(`same_as_id`, `id`) INTO v_root
          FROM `score_tasks` WHERE `id` = p_same LIMIT 1;
        IF v_root = p_id THEN SET v_root = NULL; END IF;
    END IF;

    -- The batch's audience is COPIED onto the task. sp_score_task_roster and
    -- the legacy half of sp_score_tasks_for_student both read targeting off the
    -- task row, so a task that only carried batch_id would show to a student
    -- and then produce an empty roster for the admin crediting it.
    IF EXISTS (SELECT 1 FROM `score_tasks` WHERE `id` = p_id) THEN
        UPDATE `score_tasks`
           SET `label` = p_label,
               `points` = p_points,
               `batch_id` = p_batch,
               `scope` = 'batch',
               `education_category` = v_cat,
               `degree_type` = v_degree,
               `same_as_id` = v_root,
               `action_route` = NULLIF(p_route, ''),
               `status` = IFNULL(p_status, `status`),
               `is_active` = IF(IFNULL(p_status, `status`) = 'active', 1, 0),
               `updated_at` = UTC_TIMESTAMP()
         WHERE `id` = p_id;
    ELSE
        INSERT INTO `score_tasks`
            (`id`, `label`, `points`, `scope`, `user_id`, `education_category`,
             `degree_type`, `same_as_id`, `status`, `is_active`, `batch_id`, `action_route`,
             `created_by`, `created_at`, `updated_at`)
        VALUES (p_id, p_label, p_points, 'batch', NULL, v_cat, v_degree, v_root,
                IFNULL(p_status, 'active'), IF(IFNULL(p_status, 'active') = 'active', 1, 0), p_batch,
                NULLIF(p_route, ''),
                p_admin, UTC_TIMESTAMP(), UTC_TIMESTAMP());
    END IF;

    SELECT * FROM `score_tasks` WHERE `id` = p_id;
END
"""),

    # ── readers that must honour the toggle ─────────────────────────────────
    ("sp_score_student_global_ok", """
CREATE PROCEDURE `sp_score_student_global_ok`(IN p_user CHAR(36))
BEGIN
    -- Exposed so the admin screens can explain WHY a student is or is not
    -- earning from Actions, rather than leaving it a silent property.
    SELECT """ + GLOBAL_OK.format(user='p_user') + """ AS global_ok,
           (SELECT b.`name` FROM `score_task_batches` b
              LEFT JOIN `user_profiles` up ON up.`user_id` = p_user
             WHERE b.`is_active` = 1
               AND (b.`education_category` IS NULL OR b.`education_category` = ''
                    OR b.`education_category` = up.`education_category`)
               AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                    OR b.`degree_type` = up.`degree_type`)
             ORDER BY b.`specificity` DESC, b.`include_global` ASC
             LIMIT 1) AS deciding_batch;
END
"""),
]


def award_proc():
    """sp_score_award with the batch opt-out applied to global actions only."""
    return """
CREATE PROCEDURE `sp_score_award`(
    IN p_id CHAR(36), IN p_user CHAR(36), IN p_type VARCHAR(50),
    IN p_ref VARCHAR(64), IN p_meta TEXT
)
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

      SELECT COUNT(*) INTO v_user
        FROM users WHERE id = p_user AND deleted_at IS NULL;

      IF v_user = 0 THEN
        SELECT 0 AS awarded, 'unknown_user' AS result;
        LEAVE proc;
      END IF;

      -- A batch can switch Tab 1 Actions off for its students. Its own tasks,
      -- manual adjustments and referral rewards are never blocked -- those are
      -- not global, and silencing them would delete the point of the batch.
      IF p_type NOT IN """ + NEVER_BLOCKED + """
         AND """ + GLOBAL_OK.format(user='p_user') + """ = 0 THEN
        SELECT 0 AS awarded, 'batch_excludes_global' AS result;
        LEAVE proc;
      END IF;

      -- The student did something, so they are back: end any running pause.
      -- It only costs them one if the quiet spell outlasted the grace period.
      -- Admin credits are excluded -- an admin ticking a task is not the
      -- student returning, and would end a pause while they are still away.
      IF p_type NOT IN ("admin_task", "admin_adjustment", "referral_bonus") THEN
        CALL sp_score_pause_release(p_user);
        -- Reads last_event_at BEFORE the insert below moves it, so the
        -- gap measured is the real one.
        CALL sp_score_decay_restore(p_user);
      END IF;

      SELECT points, is_active, cap_type, cap_value
        INTO v_points, v_active, v_cap_type, v_cap_value
        FROM score_event_rules WHERE event_type = p_type;

      IF v_active = 0 THEN
        SELECT 0 AS awarded, 'unknown_or_inactive' AS result;
      ELSE
        IF p_ref IS NOT NULL THEN
          SELECT COUNT(*) INTO v_dupe FROM score_events
           WHERE user_id = p_user AND event_type = p_type AND ref_id = p_ref;
        END IF;

        IF v_dupe > 0 THEN
          SELECT 0 AS awarded, 'duplicate' AS result;
        ELSE
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

          INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta)
          VALUES (p_id, p_user, p_type, v_award, p_ref,
                  IF(v_capped = 1, 'capped', p_meta));

          -- The level here is a placeholder; sp_score_recalc overwrites it from
          -- readiness_levels on the next pass.
          INSERT INTO readiness_scores (id, user_id, score, level, last_event_at)
          VALUES (UUID(), p_user, 0, '', UTC_TIMESTAMP())
          ON DUPLICATE KEY UPDATE last_event_at = UTC_TIMESTAMP();

          SELECT v_award AS awarded, IF(v_capped = 1, 'capped', 'awarded') AS result;
        END IF;
      END IF;
    END
"""


def tasks_for_student_proc():
    return """
CREATE PROCEDURE `sp_score_tasks_for_student`(IN p_user CHAR(36))
BEGIN
    SELECT x.id, x.label, x.points, x.scope, x.status, x.done, x.batch_name
      FROM (
        SELECT t.id, t.label, t.points, t.scope, t.status, t.updated_at, t.created_at,
               t.batch_id,
               (SELECT b2.`name` FROM `score_task_batches` b2 WHERE b2.`id` = t.`batch_id`) AS batch_name,
               EXISTS (
                   SELECT 1 FROM `score_events` e
                     JOIN `score_tasks` g ON g.id = e.ref_id
                    WHERE e.user_id = p_user AND e.event_type = 'admin_task' AND e.points > 0
                      AND (g.id = IFNULL(t.same_as_id, t.id)
                           OR g.same_as_id = IFNULL(t.same_as_id, t.id))
               ) AS done
          FROM `score_tasks` t
          LEFT JOIN `user_profiles` p ON p.user_id = p_user
         WHERE (
                -- a task in a batch whose audience this student is in
                EXISTS (
                  SELECT 1 FROM `score_task_batches` b
                   WHERE b.`id` = t.`batch_id` AND b.`is_active` = 1
                     AND (b.`education_category` IS NULL OR b.`education_category` = ''
                          OR b.`education_category` = p.`education_category`)
                     AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                          OR b.`degree_type` = p.`degree_type`)
                )
                -- rows from before batches existed, kept so nothing a student
                -- already had in front of them disappears
             OR (t.batch_id IS NULL AND t.scope = 'all')
             OR (t.batch_id IS NULL AND t.scope = 'student' AND t.user_id = p_user)
             OR (t.batch_id IS NULL AND t.scope = 'batch'
                  AND ((t.education_category IS NOT NULL AND t.education_category <> '')
                       OR (t.degree_type IS NOT NULL AND t.degree_type <> ''))
                  AND (t.education_category IS NULL OR t.education_category = ''
                       OR p.education_category = t.education_category)
                  AND (t.degree_type IS NULL OR t.degree_type = ''
                       OR p.degree_type = t.degree_type))
                -- and anything already paid for, whatever it was
             OR EXISTS (
                  SELECT 1 FROM `score_events` e
                   WHERE e.user_id = p_user AND e.event_type = 'admin_task'
                     AND e.ref_id = t.id AND e.points > 0
                )
           )
      ) x
     WHERE x.status = 'active'
        OR x.done
        OR x.updated_at >= UTC_TIMESTAMP() - INTERVAL 14 DAY
     ORDER BY x.done ASC, x.created_at DESC;
END
"""


def main():
    with app.app_context():
        db.session.execute(text(BATCHES_DDL))
        print("  score_task_batches ready")

        exists = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.COLUMNS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'score_tasks' "
            "AND COLUMN_NAME = 'batch_id'")).scalar()
        if not exists:
            db.session.execute(text(
                "ALTER TABLE `score_tasks` ADD COLUMN `batch_id` CHAR(36) NULL, "
                "ADD KEY `ix_task_batch` (`batch_id`)"))
            print("  added score_tasks.batch_id")
        else:
            print("  score_tasks.batch_id already there")
        db.session.commit()

        for name, body in PROCEDURES + [
            ('sp_score_award', award_proc()),
            ('sp_score_tasks_for_student', tasks_for_student_proc()),
        ]:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        n = db.session.execute(text("SELECT COUNT(*) FROM score_task_batches")).scalar()
        legacy = db.session.execute(text(
            "SELECT COUNT(*) FROM score_tasks WHERE batch_id IS NULL")).scalar()
        print(f"  batches: {n} | tasks not yet in a batch (kept working): {legacy}")
        print("Done.")


if __name__ == '__main__':
    main()
