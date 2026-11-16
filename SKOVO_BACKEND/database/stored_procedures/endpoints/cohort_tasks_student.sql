-- ============================================================
-- SKOVO — cohort tasks, from the student's side and the fan-out
-- ============================================================
-- Two endpoint procedures, both replacing "pull a bounded batch of the whole
-- table and join it in Python":
--
--   sp_student_cohort_tasks_list   GET /v1/tasks/
--   sp_cohort_enrolled_students    POST /v1/achievers/portal/tasks (notify)
--
-- GET /tasks/ used to call sp_cohort_enrollments_list(50000),
-- sp_cohorts_list(5000), sp_cohort_tasks_list(50000) and
-- sp_task_submissions_list(50000) on every page load and join the four in
-- Python. Besides the obvious cost, each LIMIT is a silent correctness ceiling:
-- the 5000th cohort pushes an enrolled student's cohort out of the window and
-- their tasks disappear from My Tasks with no error anywhere. One indexed join
-- has no such ceiling.
--
-- No new table: a task is assigned to a cohort, and "assigned to every student
-- in it" is the enrolment join below rather than a row per student. That is
-- also why a student who enrols after a task is set still gets it, and why
-- there is no duplicate to guard against.

DELIMITER $$

-- ------------------------------------------------------------
-- Every active task on every cohort this student is actually enrolled in,
-- with the cohort fields the caller needs to decide whether the class has
-- started and this student's own submission if they have made one.
--
-- Deliberately NOT filtered by whether the class has started: that rule is
-- cohort_tasks_open() in portal/helpers/helpers.py, shared with the achiever
-- and certificate paths, and duplicating it here in SQL would give the two
-- copies a chance to disagree. The caller filters on the columns returned.
--
-- 'paid'/'free' is the enrolled set. A 'pending' row is a checkout that was
-- started and never finished — a seat held, not a seat taken.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_student_cohort_tasks_list`$$
CREATE PROCEDURE `sp_student_cohort_tasks_list`(IN p_user_id CHAR(36))
BEGIN
    SELECT
        t.`id`, t.`cohort_id`, t.`title`, t.`description`,
        t.`task_type`, t.`submission_type`, t.`difficulty_level`,
        t.`attachment_url`, t.`task_status`, t.`due_date`,
        t.`score_weight`, t.`created_at`,
        c.`title`            AS `cohort_title`,
        c.`status`           AS `cohort_status`,
        c.`session_date`     AS `session_date`,
        c.`duration_minutes` AS `duration_minutes`,
        s.`id`            AS `submission_id`,
        s.`status`        AS `submission_status`,
        s.`evidence_url`  AS `evidence_url`,
        s.`evidence_text` AS `evidence_text`,
        s.`mentor_score`  AS `mentor_score`,
        s.`mentor_notes`  AS `mentor_notes`,
        s.`submitted_at`  AS `submitted_at`
      FROM `cohort_enrollments` e
      JOIN `cohorts`      c ON c.`id`        = e.`cohort_id` AND c.`deleted_at` IS NULL
      JOIN `cohort_tasks` t ON t.`cohort_id` = c.`id`        AND t.`deleted_at` IS NULL
      LEFT JOIN `task_submissions` s
             ON s.`task_id` = t.`id` AND s.`user_id` = e.`user_id`
     WHERE e.`user_id` = p_user_id
       AND e.`payment_status` IN ('paid', 'free')
       -- 'draft' is a mentor still writing the task, 'inactive'/'archived' one
       -- they withdrew. Neither is work a student should be shown.
       AND LOWER(IFNULL(t.`task_status`, 'active')) = 'active'
     -- Soonest deadline first: the list is a to-do, so what is due next belongs
     -- at the top. Undated tasks sort last rather than first.
     ORDER BY (t.`due_date` IS NULL), t.`due_date` ASC, t.`created_at` DESC;
END$$

-- ------------------------------------------------------------
-- The students a task set on this cohort is assigned to — i.e. everyone who
-- joined it. Used for the notification fan-out when an achiever assigns a task.
--
-- sp_scheduler_cohort_reminder_recipients returns the same set today, but it
-- answers a different question ("who gets the T-15 reminder") and is free to
-- change with the reminder rules; this one is the assignment audience.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_cohort_enrolled_students`$$
CREATE PROCEDURE `sp_cohort_enrolled_students`(IN p_cohort_id CHAR(36))
BEGIN
    SELECT e.`user_id`, u.`email`, u.`full_name`
      FROM `cohort_enrollments` e
      LEFT JOIN `users` u ON u.`id` = e.`user_id`
     WHERE e.`cohort_id` = p_cohort_id
       AND e.`payment_status` IN ('paid', 'free');
END$$

DELIMITER ;
