"""Tasks get somewhere to go, and a student can say they have done it.

WHY
    A task row on the student's screen was text and a Waiting badge. Nothing
    else. A student read "Upload your Class 10 marksheet" and had to work out
    for themselves that it meant the Document Vault, and had no way to tell
    anyone they had done it -- they waited for an admin to notice.

    Two things fix that:

    action_route    where the task is done. Picked from a whitelist of real
                    student routes (master_task_route), so the row becomes a
                    link instead of an instruction.

    submissions     a student marks a task done; it goes to the admin as
                    "submitted" rather than being credited. This is also the
                    honest answer to "what does half-finished mean" -- until
                    now the data could not tell "working on it" from "ignoring
                    it", because a task was only ever credited or not.

WHAT A SUBMISSION IS NOT
    It is not a payment. Only an admin crediting the task writes to the ledger.
    A submission is a claim, and the roster shows claims first so there is a
    queue to work through rather than a list to guess at.

PER-STUDENT TASKS
    The Tasks tab is batches only now, but the Adjust tab works on one student,
    and a task aimed at exactly one person belongs there. `scope = 'student'`
    with `batch_id IS NULL` is that task; sp_score_tasks_for_student already
    matches it, so nothing new is needed on the student side.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_task_actions.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# Where a task can send a student. Every one is a real route in App.jsx -- a
# task pointing at a 404 is worse than a task pointing nowhere.
ROUTES = [
    ('/document-vault',    'Document Vault',      10),
    ('/cohorts',           'Cohorts',             20),
    ('/tasks',             'Cohort tasks',        30),
    ('/assemble',          'Communities',         40),
    ('/colleges',          'Colleges',            50),
    ('/opportunities',     'Opportunity Hub',     60),
    ('/applications',      'My applications',     70),
    ('/find-mentors',      'Find a mentor',       80),
    ('/bookings',          'My bookings',         90),
    ('/profile',           'Profile',            100),
    ('/certifications',    'Certifications',     110),
    ('/resume-builder',    'Resume builder',     120),
    ('/sop-builder',       'SOP builder',        130),
    ('/skovo-pro',         'Skovo Pro',          140),
    ('/referrals',         'Refer & Earn',       150),
    ('/market',            'Market',             160),
    ('/mock-tests',        'Mock tests',         170),
    ('/exam-resources',    'Exam resources',     180),
    ('/scholarship-tracker', 'Scholarships',     190),
    ('/college-predictor', 'College predictor',  200),
    ('/forum',             'Forum',              210),
    ('/courses',           'Courses',            220),
]

ROUTE_DDL = """
CREATE TABLE IF NOT EXISTS `master_task_route` (
  `id`         CHAR(36)     NOT NULL,
  `value`      VARCHAR(80)  NOT NULL,
  `label`      VARCHAR(100) NOT NULL,
  `sort_order` INT          NOT NULL DEFAULT 0,
  `is_active`  TINYINT(1)   NOT NULL DEFAULT 1,
  `created_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_task_route_value` (`value`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

# Where a task sends the student -> what proves they did it. Only the
# destinations with an unambiguous answer are here; the rest stay unverifiable
# on purpose, because a wrong auto-rejection is worse than a human glance.
ROUTE_METRIC = {
    '/document-vault':  'documents_uploaded',
    '/cohorts':         'cohorts_enrolled',
    '/assemble':        'communities_joined',
    '/forum':           'community_posts',
    '/colleges':        'colleges_saved',
    '/opportunities':   'applications_submitted',
    '/applications':    'applications_submitted',
    '/bookings':        'sessions_completed',
    '/find-mentors':    'sessions_completed',
    '/referrals':       'referrals_completed',
    '/skovo-pro':       'pro_subscription',
    '/profile':         'skills_added',
}

SUBMISSIONS_DDL = """
CREATE TABLE IF NOT EXISTS `score_task_submissions` (
  `id`           CHAR(36)   NOT NULL,
  `task_id`      CHAR(36)   NOT NULL,
  `user_id`      CHAR(36)   NOT NULL,
  -- submitted: the student says it is done, waiting on an admin.
  -- withdrawn:  they took the claim back before it was looked at.
  `status`       VARCHAR(16) NOT NULL DEFAULT 'submitted',
  `note`         VARCHAR(500) NULL,
  `submitted_at` DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`   DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  -- One live claim per student per task. Re-submitting updates the row rather
  -- than stacking duplicates in the admin's queue.
  UNIQUE KEY `uq_submission` (`task_id`, `user_id`),
  KEY `ix_submission_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

PROCEDURES = [

    ("sp_score_task_submit", """
CREATE PROCEDURE `sp_score_task_submit`(
    IN p_task CHAR(36), IN p_user CHAR(36), IN p_note VARCHAR(500), IN p_undo TINYINT
)
BEGIN
    DECLARE v_paid   INT DEFAULT 0;
    DECLARE v_metric VARCHAR(40) DEFAULT NULL;
    DECLARE v_filter VARCHAR(40) DEFAULT NULL;
    DECLARE v_thresh INT DEFAULT 1;
    DECLARE v_scoped TINYINT DEFAULT 1;
    DECLARE v_since  DATETIME DEFAULT NULL;
    DECLARE v_have   INT DEFAULT 0;

    -- Already credited: there is nothing to claim, and letting a student
    -- withdraw something they were paid for would leave the roster lying.
    SELECT COUNT(*) INTO v_paid FROM `score_events`
     WHERE `user_id` = p_user AND `event_type` = 'admin_task'
       AND `ref_id` = p_task AND `points` > 0;

    IF v_paid > 0 THEN
        SELECT 'already_paid' AS result, NULL AS reason;
    ELSEIF IFNULL(p_undo, 0) = 1 THEN
        DELETE FROM `score_task_submissions`
         WHERE `task_id` = p_task AND `user_id` = p_user;
        SELECT 'withdrawn' AS result, NULL AS reason;
    ELSE
        -- Can the platform settle this claim by itself?
        --
        -- A task that names a metric is checkable: "Upload your marksheet" can
        -- be answered by looking. A task that names none -- "Talk to your
        -- mentor about your options" -- cannot, and only those reach a human.
        -- At 10,000 students that difference is the whole design: a queue that
        -- holds only the genuinely unprovable is a queue somebody can finish.
        SELECT `verify_metric`, `verify_filter`, IFNULL(`verify_threshold`, 1),
               IFNULL(`verify_since_task`, 1),
               IF(IFNULL(`verify_since_task`, 1) = 1, `created_at`, NULL)
          INTO v_metric, v_filter, v_thresh, v_scoped, v_since
          FROM `score_tasks` WHERE `id` = p_task LIMIT 1;

        IF v_metric IS NULL OR v_metric = '' THEN
            INSERT INTO `score_task_submissions` (`id`, `task_id`, `user_id`, `status`, `note`)
            VALUES (UUID(), p_task, p_user, 'submitted', p_note)
            ON DUPLICATE KEY UPDATE `status` = 'submitted', `note` = VALUES(`note`),
                                    `submitted_at` = UTC_TIMESTAMP();
            SELECT 'submitted' AS result, NULL AS reason;
        ELSE
            -- v_since defaults to the task's creation time, so activity the
            -- student already had before they were asked does not settle the
            -- claim. Set verify_since_task = 0 on tasks like "have a complete
            -- profile", where existing state is the point.
            CALL sp_score_metric_snapshot(v_metric, v_filter, v_since, p_user);
            SELECT IFNULL(MAX(`val`), 0) INTO v_have
              FROM `tmp_score_metric` WHERE `user_id` = p_user;

            IF v_have >= v_thresh THEN
                INSERT INTO `score_task_submissions`
                       (`id`, `task_id`, `user_id`, `status`, `note`, `decided_at`)
                VALUES (UUID(), p_task, p_user, 'approved', p_note, UTC_TIMESTAMP())
                ON DUPLICATE KEY UPDATE `status` = 'approved', `note` = VALUES(`note`),
                                        `submitted_at` = UTC_TIMESTAMP(),
                                        `decided_at` = UTC_TIMESTAMP();
                -- The caller awards the points. Calling sp_score_task_complete
                -- from here would push this row out of the first result set,
                -- where every caller reads.
                SELECT 'auto_approved' AS result, NULL AS reason;
            ELSE
                INSERT INTO `score_task_submissions`
                       (`id`, `task_id`, `user_id`, `status`, `note`, `decided_at`, `reason`)
                VALUES (UUID(), p_task, p_user, 'rejected', p_note, UTC_TIMESTAMP(),
                        CONCAT('not found yet (need ', v_thresh, ', have ', v_have, ')'))
                ON DUPLICATE KEY UPDATE `status` = 'rejected', `note` = VALUES(`note`),
                                        `submitted_at` = UTC_TIMESTAMP(),
                                        `decided_at` = UTC_TIMESTAMP(),
                                        `reason` = VALUES(`reason`);
                SELECT 'auto_rejected' AS result,
                       CONCAT('We could not find this on your account yet. ',
                              'Finish it and tap again -- you will be paid straight away.')
                       AS reason;
            END IF;
        END IF;
    END IF;
END
"""),

    ("sp_score_student_tasks_admin", """
CREATE PROCEDURE `sp_score_student_tasks_admin`(IN p_user CHAR(36))
BEGIN
    -- Every task this one student can see, with where it stands. Powers the
    -- Adjust tab, which works on a person rather than an audience.
    SELECT t.`id`, t.`label`, t.`points`, t.`scope`, t.`status`, t.`action_route`,
           t.`batch_id`,
           (SELECT b.`name` FROM `score_task_batches` b WHERE b.`id` = t.`batch_id`) AS batch_name,
           EXISTS (SELECT 1 FROM `score_events` e
                    WHERE e.`user_id` = p_user AND e.`event_type` = 'admin_task'
                      AND e.`ref_id` = t.`id` AND e.`points` > 0) AS done,
           EXISTS (SELECT 1 FROM `score_task_submissions` s
                    WHERE s.`task_id` = t.`id` AND s.`user_id` = p_user
                      AND s.`status` = 'submitted') AS submitted
      FROM `score_tasks` t
      LEFT JOIN `user_profiles` p ON p.`user_id` = p_user
     WHERE t.`status` = 'active'
       AND (
            EXISTS (SELECT 1 FROM `score_task_batches` b
                     WHERE b.`id` = t.`batch_id` AND b.`is_active` = 1
                       AND (b.`education_category` IS NULL OR b.`education_category` = ''
                            OR b.`education_category` = p.`education_category`)
                       AND (b.`degree_type` IS NULL OR b.`degree_type` = ''
                            OR b.`degree_type` = p.`degree_type`))
         OR (t.`batch_id` IS NULL AND t.`scope` = 'student' AND t.`user_id` = p_user)
       )
     ORDER BY done ASC, submitted DESC, t.`created_at` DESC;
END
"""),

    ("sp_score_student_task_upsert", """
CREATE PROCEDURE `sp_score_student_task_upsert`(
    IN p_id     CHAR(36),
    IN p_user   CHAR(36),
    IN p_label  VARCHAR(160),
    IN p_points INT,
    IN p_route  VARCHAR(80),
    IN p_status VARCHAR(20),
    IN p_admin  CHAR(36)
)
BEGIN
    -- A task for exactly one student. Created from the Adjust tab, which is
    -- where one-person work belongs now the Tasks tab is audiences only.
    IF EXISTS (SELECT 1 FROM `score_tasks` WHERE `id` = p_id) THEN
        UPDATE `score_tasks`
           SET `label` = p_label, `points` = p_points, `action_route` = p_route,
               `status` = IFNULL(p_status, `status`),
               `is_active` = IF(IFNULL(p_status, `status`) = 'active', 1, 0),
               `updated_at` = UTC_TIMESTAMP()
         WHERE `id` = p_id;
    ELSE
        INSERT INTO `score_tasks`
            (`id`, `label`, `points`, `scope`, `user_id`, `education_category`,
             `degree_type`, `status`, `is_active`, `batch_id`, `action_route`,
             `created_by`, `created_at`, `updated_at`)
        VALUES (p_id, p_label, p_points, 'student', p_user, NULL, NULL,
                IFNULL(p_status, 'active'), 1, NULL, p_route,
                p_admin, UTC_TIMESTAMP(), UTC_TIMESTAMP());
    END IF;

    SELECT * FROM `score_tasks` WHERE `id` = p_id;
END
"""),

    ("sp_score_students_search", """
CREATE PROCEDURE `sp_score_students_search`(
    IN p_q VARCHAR(160), IN p_category VARCHAR(50), IN p_limit INT
)
BEGIN
    -- Name/email search with an optional stage filter, for the Adjust tab.
    DECLARE v_q VARCHAR(200);
    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 100 THEN SET p_limit = 25; END IF;
    SET v_q = CONCAT('%', TRIM(IFNULL(p_q, '')), '%');

    SELECT u.`id`, u.`full_name`, u.`email`,
           p.`education_category`, p.`degree_type`,
           IFNULL(rs.`score`, 0) AS score, rs.`level`
      FROM `users` u
      LEFT JOIN `user_profiles` p ON p.`user_id` = u.`id`
      LEFT JOIN `readiness_scores` rs ON rs.`user_id` = u.`id`
     WHERE u.`deleted_at` IS NULL
       AND (TRIM(IFNULL(p_q, '')) = ''
            OR u.`full_name` LIKE v_q OR u.`email` LIKE v_q)
       AND (p_category IS NULL OR p_category = ''
            OR p.`education_category` = p_category)
     ORDER BY u.`full_name`
     LIMIT p_limit;
END
"""),
]


def roster_proc():
    """The roster, now showing who has CLAIMED the task as well as who is paid."""
    return """
CREATE PROCEDURE `sp_score_task_roster`(
    IN p_task_id CHAR(36), IN p_q VARCHAR(160), IN p_state VARCHAR(16),
    IN p_limit INT, IN p_offset INT
)
BEGIN
    DECLARE v_scope  VARCHAR(20);
    DECLARE v_user   CHAR(36);
    DECLARE v_cat    VARCHAR(80);
    DECLARE v_degree VARCHAR(80);
    DECLARE v_group  CHAR(36);
    DECLARE v_q      VARCHAR(160);

    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 500 THEN SET p_limit = 100; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;
    SET v_q = CONCAT('%', TRIM(IFNULL(p_q, '')), '%');

    SELECT scope, user_id, education_category, degree_type, IFNULL(same_as_id, id)
      INTO v_scope, v_user, v_cat, v_degree, v_group
      FROM `score_tasks` WHERE id = p_task_id;

    IF v_scope IS NULL THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'TASK_NOT_FOUND';
    END IF;

    SELECT SQL_CALC_FOUND_ROWS
           u.id, u.full_name, u.email,
           p.education_category, p.degree_type,
           d.done, d.done_at, d.submitted, d.submitted_at
      FROM `users` u
      LEFT JOIN `user_profiles` p ON p.user_id = u.id
      JOIN (
        SELECT u2.id AS uid,
               EXISTS (
                 SELECT 1 FROM `score_events` e
                   JOIN `score_tasks` g ON g.id = e.ref_id
                  WHERE e.user_id = u2.id AND e.event_type = 'admin_task' AND e.points > 0
                    AND (g.id = v_group OR g.same_as_id = v_group)
               ) AS done,
               (SELECT MAX(e2.occurred_at) FROM `score_events` e2
                  JOIN `score_tasks` g2 ON g2.id = e2.ref_id
                 WHERE e2.user_id = u2.id AND e2.event_type = 'admin_task' AND e2.points > 0
                   AND (g2.id = v_group OR g2.same_as_id = v_group)) AS done_at,
               EXISTS (
                 SELECT 1 FROM `score_task_submissions` s
                  WHERE s.task_id = p_task_id AND s.user_id = u2.id
                    AND s.status = 'submitted'
               ) AS submitted,
               (SELECT s2.submitted_at FROM `score_task_submissions` s2
                 WHERE s2.task_id = p_task_id AND s2.user_id = u2.id
                   AND s2.status = 'submitted') AS submitted_at
          FROM `users` u2 WHERE u2.deleted_at IS NULL
      ) d ON d.uid = u.id
     WHERE u.deleted_at IS NULL
       AND (
             (v_scope = 'student' AND u.id = v_user)
          OR (v_scope = 'all')
          OR (v_scope = 'batch'
              AND (v_cat IS NULL OR v_cat = '' OR p.education_category = v_cat)
              AND (v_degree IS NULL OR v_degree = '' OR p.degree_type = v_degree))
          OR d.done
       )
       AND (TRIM(IFNULL(p_q, '')) = '' OR u.full_name LIKE v_q OR u.email LIKE v_q)
       AND (p_state IS NULL OR p_state = '' OR p_state = 'all'
            OR (p_state = 'pending'   AND d.done = 0)
            OR (p_state = 'submitted' AND d.done = 0 AND d.submitted = 1)
            OR (p_state = 'done'      AND d.done = 1))
     -- Claims first: they are the queue an admin is meant to work through.
     ORDER BY d.done ASC, d.submitted DESC, u.full_name ASC
     LIMIT p_limit OFFSET p_offset;
END
"""


def main():
    with app.app_context():
        db.session.execute(text(ROUTE_DDL))
        for value, label, order in ROUTES:
            db.session.execute(text(
                "INSERT INTO `master_task_route` (id, value, label, sort_order, is_active) "
                "VALUES (UUID(), :v, :l, :o, 1) "
                "ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order)"
            ), {'v': value, 'l': label, 'o': order})
        db.session.execute(text(
            "INSERT INTO `master_registry` (id, type, table_name, label, is_active) "
            "VALUES (UUID(), 'task_route', 'master_task_route', 'Task Route', 1) "
            "ON DUPLICATE KEY UPDATE table_name = VALUES(table_name), is_active = 1"))
        print(f"  master_task_route: {len(ROUTES)} routes")

        db.session.execute(text(SUBMISSIONS_DDL))
        print("  score_task_submissions ready")

        def add(table, col, ddl):
            n = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t "
                "AND COLUMN_NAME = :c"), {'t': table, 'c': col}).scalar()
            if n:
                print(f"  {table}.{col} already there")
                return
            db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
            print(f"  added {table}.{col}")

        add('score_tasks', 'action_route', "VARCHAR(80) NULL")

        # What a claim on this task can be checked against. NULL means the task
        # is not machine-checkable and its claims go to a human -- which should
        # be the exception, not the rule.
        add('score_tasks', 'verify_metric',     "VARCHAR(40) NULL")
        add('score_tasks', 'verify_filter',     "VARCHAR(40) NULL")
        add('score_tasks', 'verify_threshold',  "INT NOT NULL DEFAULT 1")
        # 1 = only activity after the task was created settles the claim, so a
        # student who already had five documents cannot claim a new task for
        # free. 0 = existing state counts, for tasks like "have a full profile".
        add('score_tasks', 'verify_since_task', "TINYINT(1) NOT NULL DEFAULT 1")

        add('score_task_submissions', 'decided_at', "DATETIME NULL")
        add('score_task_submissions', 'decided_by', "CHAR(36) NULL")
        add('score_task_submissions', 'reason',     "VARCHAR(255) NULL")

        # The obvious metric for each destination, so the task form can prefill
        # it. A suggestion only -- an admin can pick any metric, or none.
        add('master_task_route', 'suggest_metric', "VARCHAR(40) NULL")
        db.session.commit()

        for route, metric in ROUTE_METRIC.items():
            db.session.execute(text(
                "UPDATE `master_task_route` SET `suggest_metric` = :m "
                "WHERE `value` = :v AND (`suggest_metric` IS NULL OR `suggest_metric` = '')"
            ), {'m': metric, 'v': route})
        db.session.commit()
        print(f"  suggested a metric for {len(ROUTE_METRIC)} of {len(ROUTES)} routes")

        for name, body in PROCEDURES + [('sp_score_task_roster', roster_proc())]:
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
