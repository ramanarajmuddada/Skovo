"""Cohort tasks with auto-checked quizzes, question bank, review queue, appeals.

WHY
    feature-updates.md §5. A cohort "quiz" was a label: the student pasted a
    link and the achiever checked it by hand. Achievers could not write
    questions (mock tests were admin-only). Now:
      * achievers build questions (MCQ, true/false, numeric, fill-in, Telugu)
        and keep a reusable question bank
      * a quiz is auto-checked on submit; timer enforced on the server; shuffle,
        attempt limit, optional negative marking, random question pool,
        answers shown after the deadline
      * written tasks get a rubric, a review queue and appeals
      * points for every task type are admin score rules (0 / inactive)

WHAT CHANGES
    cohort_tasks      + session_id, rubric_json, time_limit_minutes, max_attempts,
                        shuffle, negative_marks, review_after, grading_mode,
                        pass_percent, pool_size
    task_submissions  + auto_score, auto_total, attempt_id, rubric_scores_json,
                        review_state, appeal_text, appeal_at, appeal_resolved_at,
                        flags_json, is_late
    task_questions    questions of one task
    question_bank     an achiever's reusable questions
    quiz_attempts     server-timed attempts (answers autosaved)
    task_settings     singleton: late policy, appeal window
    mock_tests        + owner_id, cohort_id (achievers may build their own)
    score_event_rules + quiz_submitted, quiz_passed, quiz_perfect,
                        task_approved_<type> -- 0 points, inactive

Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_quizzes.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('cohort_tasks', 'session_id', "CHAR(36) NULL"),
    ('cohort_tasks', 'rubric_json', "JSON NULL"),
    ('cohort_tasks', 'time_limit_minutes', "INT NULL"),
    ('cohort_tasks', 'max_attempts', "INT NOT NULL DEFAULT 1"),
    ('cohort_tasks', 'shuffle', "TINYINT(1) NOT NULL DEFAULT 1"),
    ('cohort_tasks', 'negative_marks', "DECIMAL(4,2) NOT NULL DEFAULT 0"),
    ('cohort_tasks', 'review_after', "VARCHAR(10) NOT NULL DEFAULT 'deadline'"),
    ('cohort_tasks', 'grading_mode', "VARCHAR(10) NOT NULL DEFAULT 'manual'"),
    ('cohort_tasks', 'pass_percent', "INT NULL"),
    ('cohort_tasks', 'pool_size', "INT NULL"),
    ('task_submissions', 'auto_score', "DECIMAL(7,2) NULL"),
    ('task_submissions', 'auto_total', "DECIMAL(7,2) NULL"),
    ('task_submissions', 'attempt_id', "CHAR(36) NULL"),
    ('task_submissions', 'rubric_scores_json', "JSON NULL"),
    ('task_submissions', 'review_state', "VARCHAR(20) NULL"),
    ('task_submissions', 'appeal_text', "VARCHAR(1000) NULL"),
    ('task_submissions', 'appeal_at', "DATETIME NULL"),
    ('task_submissions', 'appeal_resolved_at', "DATETIME NULL"),
    ('task_submissions', 'flags_json', "JSON NULL"),
    ('task_submissions', 'is_late', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('mock_tests', 'owner_id', "CHAR(36) NULL"),
    ('mock_tests', 'cohort_id', "CHAR(36) NULL"),
]

QUESTION_COLS = """
  `question_type`     VARCHAR(12)  NOT NULL DEFAULT 'mcq',
  `text`              TEXT         NOT NULL,
  `options_json`      JSON         NULL,
  `correct_answer`    VARCHAR(500) NULL,
  `accepted_json`     JSON         NULL,
  `tolerance`         DECIMAL(10,4) NOT NULL DEFAULT 0,
  `marks`             DECIMAL(6,2) NOT NULL DEFAULT 1,
  `explanation`       TEXT         NULL,
  `lang`              VARCHAR(5)   NOT NULL DEFAULT 'en',
  `topic`             VARCHAR(120) NULL,
"""

TABLES = [
"""CREATE TABLE IF NOT EXISTS `task_questions` (
  `id`       CHAR(36) NOT NULL,
  `task_id`  CHAR(36) NOT NULL,
  `position` INT      NOT NULL DEFAULT 0,""" + QUESTION_COLS + """
  `bank_id`    CHAR(36) NULL,
  `created_by` CHAR(36) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_tq_task` (`task_id`, `position`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `question_bank` (
  `id`       CHAR(36) NOT NULL,
  `owner_id` CHAR(36) NOT NULL,""" + QUESTION_COLS + """
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `ix_qb_owner` (`owner_id`, `topic`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `quiz_attempts` (
  `id`                  CHAR(36)     NOT NULL,
  `task_id`             CHAR(36)     NOT NULL,
  `user_id`             CHAR(36)     NOT NULL,
  `attempt_no`          INT          NOT NULL DEFAULT 1,
  `question_ids_json`   JSON         NOT NULL,
  `option_order_json`   JSON         NULL,
  `answers_json`        JSON         NULL,
  `started_at`          DATETIME     NOT NULL,
  `deadline_at`         DATETIME     NULL,
  `submitted_at`        DATETIME     NULL,
  `status`              VARCHAR(12)  NOT NULL DEFAULT 'in_progress',
  `score`               DECIMAL(7,2) NULL,
  `total`               DECIMAL(7,2) NULL,
  `percent`             DECIMAL(5,1) NULL,
  `tab_switches`        INT          NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `ix_qa_task_user` (`task_id`, `user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci""",

"""CREATE TABLE IF NOT EXISTS `task_settings` (
  `id`          TINYINT     NOT NULL DEFAULT 1,
  `late_policy` VARCHAR(8)  NOT NULL DEFAULT 'full',
  `appeal_days` INT         NOT NULL DEFAULT 7,
  `updated_at`  DATETIME    NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`  CHAR(36)    NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB""",
]

RULES = [
    ('quiz_submitted', 'Submitted a quiz'),
    ('quiz_passed', 'Passed a quiz (pass % set on the quiz)'),
    ('quiz_perfect', 'Scored 100% in a quiz'),
    ('task_approved_assignment', 'Assignment approved'),
    ('task_approved_reflection', 'Reflection approved'),
    ('task_approved_worksheet', 'Worksheet approved'),
    ('task_approved_project', 'Project approved'),
    ('task_approved_presentation', 'Presentation / video approved'),
    ('task_approved_realworld', 'Real-world task approved'),
    ('task_approved_coding', 'Coding task approved'),
    ('task_approved_capstone', 'Capstone approved'),
    ('task_approved_other', 'Other task approved'),
]

Q_FIELDS = ("question_type, text, options_json, correct_answer, accepted_json, tolerance, marks, "
            "explanation, lang, topic")
Q_PARAMS = """IN p_type VARCHAR(12), IN p_text TEXT, IN p_options JSON, IN p_correct VARCHAR(500),
  IN p_accepted JSON, IN p_tolerance DECIMAL(10,4), IN p_marks DECIMAL(6,2), IN p_expl TEXT,
  IN p_lang VARCHAR(5), IN p_topic VARCHAR(120)"""
Q_VALUES = "p_type, p_text, p_options, p_correct, p_accepted, IFNULL(p_tolerance, 0), IFNULL(p_marks, 1), p_expl, IFNULL(p_lang, 'en'), p_topic"

PROCS = {
'sp_task_settings_get': """
CREATE PROCEDURE `sp_task_settings_get`()
BEGIN
  INSERT IGNORE INTO task_settings (id) VALUES (1);
  SELECT * FROM task_settings WHERE id = 1;
END""",

'sp_task_settings_set': """
CREATE PROCEDURE `sp_task_settings_set`(IN p_late VARCHAR(8), IN p_appeal INT, IN p_admin CHAR(36))
BEGIN
  INSERT IGNORE INTO task_settings (id) VALUES (1);
  UPDATE task_settings SET late_policy = IFNULL(p_late, late_policy),
         appeal_days = GREATEST(0, IFNULL(p_appeal, appeal_days)), updated_by = p_admin WHERE id = 1;
  SELECT * FROM task_settings WHERE id = 1;
END""",

'sp_task_quiz_settings_set': """
CREATE PROCEDURE `sp_task_quiz_settings_set`(
  IN p_task CHAR(36), IN p_session CHAR(36), IN p_rubric JSON, IN p_limit INT, IN p_attempts INT,
  IN p_shuffle TINYINT, IN p_negative DECIMAL(4,2), IN p_review VARCHAR(10), IN p_mode VARCHAR(10),
  IN p_pass INT, IN p_pool INT, IN p_actor CHAR(36))
BEGIN
  UPDATE cohort_tasks
     SET session_id = NULLIF(p_session, ''), rubric_json = p_rubric,
         time_limit_minutes = NULLIF(p_limit, 0), max_attempts = GREATEST(1, IFNULL(p_attempts, 1)),
         shuffle = IFNULL(p_shuffle, 1), negative_marks = GREATEST(0, IFNULL(p_negative, 0)),
         review_after = IFNULL(p_review, 'deadline'), grading_mode = IFNULL(p_mode, 'manual'),
         pass_percent = p_pass, pool_size = NULLIF(p_pool, 0), updated_by = p_actor
   WHERE id = p_task AND deleted_at IS NULL;
  SELECT * FROM cohort_tasks WHERE id = p_task;
END""",

'sp_task_questions_list': """
CREATE PROCEDURE `sp_task_questions_list`(IN p_task CHAR(36))
BEGIN
  SELECT * FROM task_questions WHERE task_id = p_task AND deleted_at IS NULL ORDER BY position, created_at;
END""",

'sp_task_question_upsert': """
CREATE PROCEDURE `sp_task_question_upsert`(IN p_id CHAR(36), IN p_task CHAR(36), IN p_position INT,
  """ + Q_PARAMS + """, IN p_bank CHAR(36), IN p_actor CHAR(36))
BEGIN
  INSERT INTO task_questions (id, task_id, position, """ + Q_FIELDS + """, bank_id, created_by)
  VALUES (p_id, p_task, IFNULL(p_position, 0), """ + Q_VALUES + """, p_bank, p_actor)
  ON DUPLICATE KEY UPDATE position = IFNULL(p_position, position), question_type = p_type, text = p_text,
         options_json = p_options, correct_answer = p_correct, accepted_json = p_accepted,
         tolerance = IFNULL(p_tolerance, 0), marks = IFNULL(p_marks, 1), explanation = p_expl,
         lang = IFNULL(p_lang, 'en'), topic = p_topic;
  SELECT * FROM task_questions WHERE id = p_id;
END""",

'sp_task_question_delete': """
CREATE PROCEDURE `sp_task_question_delete`(IN p_id CHAR(36), IN p_task CHAR(36))
BEGIN
  UPDATE task_questions SET deleted_at = UTC_TIMESTAMP() WHERE id = p_id AND task_id = p_task AND deleted_at IS NULL;
  SELECT ROW_COUNT() AS deleted;
END""",

'sp_task_question_reorder': """
CREATE PROCEDURE `sp_task_question_reorder`(IN p_id CHAR(36), IN p_task CHAR(36), IN p_position INT)
BEGIN
  UPDATE task_questions SET position = p_position WHERE id = p_id AND task_id = p_task;
  SELECT ROW_COUNT() AS moved;
END""",

'sp_question_bank_list': """
CREATE PROCEDURE `sp_question_bank_list`(IN p_owner CHAR(36), IN p_topic VARCHAR(120), IN p_search VARCHAR(100),
  IN p_limit INT, IN p_offset INT)
BEGIN
  SELECT * FROM question_bank
   WHERE owner_id = p_owner AND deleted_at IS NULL
     AND (p_topic IS NULL OR p_topic = '' OR topic = p_topic)
     AND (p_search IS NULL OR p_search = '' OR text LIKE CONCAT('%', p_search, '%'))
   ORDER BY created_at DESC LIMIT p_limit OFFSET p_offset;
END""",

'sp_question_bank_upsert': """
CREATE PROCEDURE `sp_question_bank_upsert`(IN p_id CHAR(36), IN p_owner CHAR(36), """ + Q_PARAMS + """)
BEGIN
  INSERT INTO question_bank (id, owner_id, """ + Q_FIELDS + """)
  VALUES (p_id, p_owner, """ + Q_VALUES + """)
  ON DUPLICATE KEY UPDATE question_type = p_type, text = p_text, options_json = p_options,
         correct_answer = p_correct, accepted_json = p_accepted, tolerance = IFNULL(p_tolerance, 0),
         marks = IFNULL(p_marks, 1), explanation = p_expl, lang = IFNULL(p_lang, 'en'), topic = p_topic;
  SELECT * FROM question_bank WHERE id = p_id AND owner_id = p_owner;
END""",

'sp_question_bank_delete': """
CREATE PROCEDURE `sp_question_bank_delete`(IN p_id CHAR(36), IN p_owner CHAR(36))
BEGIN
  UPDATE question_bank SET deleted_at = UTC_TIMESTAMP() WHERE id = p_id AND owner_id = p_owner AND deleted_at IS NULL;
  SELECT ROW_COUNT() AS deleted;
END""",

'sp_question_bank_get': """
CREATE PROCEDURE `sp_question_bank_get`(IN p_id CHAR(36), IN p_owner CHAR(36))
BEGIN
  SELECT * FROM question_bank WHERE id = p_id AND owner_id = p_owner AND deleted_at IS NULL;
END""",

'sp_quiz_attempts_for': """
CREATE PROCEDURE `sp_quiz_attempts_for`(IN p_task CHAR(36), IN p_user CHAR(36))
BEGIN
  SELECT * FROM quiz_attempts WHERE task_id = p_task AND user_id = p_user ORDER BY attempt_no;
END""",

'sp_quiz_attempt_create': """
CREATE PROCEDURE `sp_quiz_attempt_create`(IN p_id CHAR(36), IN p_task CHAR(36), IN p_user CHAR(36),
  IN p_no INT, IN p_qids JSON, IN p_opts JSON, IN p_deadline DATETIME)
BEGIN
  INSERT INTO quiz_attempts (id, task_id, user_id, attempt_no, question_ids_json, option_order_json,
                             started_at, deadline_at, status)
  VALUES (p_id, p_task, p_user, p_no, p_qids, p_opts, UTC_TIMESTAMP(), p_deadline, 'in_progress');
  SELECT * FROM quiz_attempts WHERE id = p_id;
END""",

'sp_quiz_attempt_get': """
CREATE PROCEDURE `sp_quiz_attempt_get`(IN p_id CHAR(36))
BEGIN
  SELECT * FROM quiz_attempts WHERE id = p_id;
END""",

'sp_quiz_attempt_save': """
CREATE PROCEDURE `sp_quiz_attempt_save`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_answers JSON, IN p_tabs INT)
BEGIN
  UPDATE quiz_attempts SET answers_json = IFNULL(p_answers, answers_json),
         tab_switches = tab_switches + IFNULL(p_tabs, 0)
   WHERE id = p_id AND user_id = p_user AND status = 'in_progress';
  SELECT ROW_COUNT() AS saved;
END""",

'sp_quiz_attempt_finish': """
CREATE PROCEDURE `sp_quiz_attempt_finish`(IN p_id CHAR(36), IN p_answers JSON, IN p_status VARCHAR(12),
  IN p_score DECIMAL(7,2), IN p_total DECIMAL(7,2), IN p_percent DECIMAL(5,1))
BEGIN
  UPDATE quiz_attempts SET answers_json = p_answers, status = p_status, submitted_at = UTC_TIMESTAMP(),
         score = p_score, total = p_total, percent = p_percent
   WHERE id = p_id AND status = 'in_progress';
  SELECT ROW_COUNT() AS finished;
END""",

'sp_quiz_submission_write': """
CREATE PROCEDURE `sp_quiz_submission_write`(IN p_task CHAR(36), IN p_user CHAR(36), IN p_attempt CHAR(36),
  IN p_score DECIMAL(7,2), IN p_total DECIMAL(7,2), IN p_summary TEXT, IN p_late TINYINT, IN p_flags JSON)
BEGIN
  -- One submission row per student per task, holding the latest attempt.
  -- Auto-checked = approved immediately (review_state auto_approved).
  DECLARE v_id CHAR(36) DEFAULT NULL;
  DECLARE v_old VARCHAR(20) DEFAULT NULL;
  SELECT id, status INTO v_id, v_old FROM task_submissions WHERE task_id = p_task AND user_id = p_user LIMIT 1;
  IF v_id IS NULL THEN
    SET v_id = UUID();
    INSERT INTO task_submissions (id, task_id, user_id, status, evidence_text, submitted_at, reviewed_at,
                                  auto_score, auto_total, attempt_id, review_state, is_late, flags_json,
                                  created_at, created_by, updated_at, updated_by)
    VALUES (v_id, p_task, p_user, 'approved', p_summary, UTC_TIMESTAMP(), UTC_TIMESTAMP(),
            p_score, p_total, p_attempt, 'auto_approved', IFNULL(p_late, 0), p_flags,
            UTC_TIMESTAMP(), p_user, UTC_TIMESTAMP(), p_user);
  ELSE
    UPDATE task_submissions
       SET status = 'approved', evidence_text = p_summary, submitted_at = UTC_TIMESTAMP(),
           reviewed_at = UTC_TIMESTAMP(), auto_score = p_score, auto_total = p_total,
           attempt_id = p_attempt, review_state = 'auto_approved', is_late = IFNULL(p_late, 0),
           flags_json = p_flags, updated_at = UTC_TIMESTAMP(), updated_by = p_user
     WHERE id = v_id;
  END IF;
  SELECT v_id AS submission_id, v_old AS previous_status;
END""",

'sp_quiz_answer_sets': """
CREATE PROCEDURE `sp_quiz_answer_sets`(IN p_task CHAR(36), IN p_exclude CHAR(36))
BEGIN
  -- Other students' final answers on this task, for the identical-pattern check.
  SELECT user_id, answers_json FROM quiz_attempts
   WHERE task_id = p_task AND status = 'submitted' AND user_id <> p_exclude
   ORDER BY submitted_at DESC LIMIT 500;
END""",

'sp_task_results': """
CREATE PROCEDURE `sp_task_results`(IN p_task CHAR(36))
BEGIN
  -- Latest submitted attempt per student.
  SELECT a.user_id, u.full_name, a.score, a.total, a.percent, a.answers_json, a.tab_switches,
         a.submitted_at, ts.flags_json, ts.is_late
    FROM quiz_attempts a
    JOIN users u ON u.id = a.user_id
    LEFT JOIN task_submissions ts ON ts.task_id = a.task_id AND ts.user_id = a.user_id
   WHERE a.task_id = p_task AND a.status = 'submitted'
     AND a.attempt_no = (SELECT MAX(a2.attempt_no) FROM quiz_attempts a2
                          WHERE a2.task_id = a.task_id AND a2.user_id = a.user_id AND a2.status = 'submitted');
END""",

'sp_task_enrolled_students': """
CREATE PROCEDURE `sp_task_enrolled_students`(IN p_task CHAR(36))
BEGIN
  SELECT ce.user_id, u.full_name
    FROM cohort_tasks t
    JOIN cohort_enrollments ce ON ce.cohort_id = t.cohort_id AND ce.payment_status IN ('paid', 'free')
                              AND ce.cancelled_at IS NULL
    JOIN users u ON u.id = ce.user_id
   WHERE t.id = p_task;
END""",

'sp_review_queue': """
CREATE PROCEDURE `sp_review_queue`(IN p_achiever CHAR(36), IN p_state VARCHAR(20), IN p_limit INT, IN p_offset INT)
BEGIN
  -- Submissions on this achiever's cohorts that need a human.
  SELECT ts.*, t.title AS task_title, t.task_type, t.rubric_json, t.due_date, c.title AS cohort_title,
         u.full_name AS student_name
    FROM task_submissions ts
    JOIN cohort_tasks t ON t.id = ts.task_id AND t.deleted_at IS NULL
    JOIN cohorts c ON c.id = t.cohort_id AND c.achiever_id = p_achiever
    JOIN users u ON u.id = ts.user_id
   WHERE (p_state = 'appealed' AND ts.review_state = 'appealed')
      OR (p_state = 'queued' AND ts.status IN ('pending', 'submitted', 'resubmitted')
          AND IFNULL(ts.review_state, 'queued') <> 'auto_approved')
      OR (p_state = 'all')
   ORDER BY IFNULL(t.due_date, '9999-12-31'), ts.submitted_at
   LIMIT p_limit OFFSET p_offset;
END""",

'sp_submission_review_extra': """
CREATE PROCEDURE `sp_submission_review_extra`(IN p_id CHAR(36), IN p_rubric JSON, IN p_state VARCHAR(20))
BEGIN
  UPDATE task_submissions
     SET rubric_scores_json = IFNULL(p_rubric, rubric_scores_json),
         review_state = IFNULL(p_state, review_state),
         appeal_resolved_at = IF(review_state = 'appealed' AND p_state = 'reviewed', UTC_TIMESTAMP(), appeal_resolved_at)
   WHERE id = p_id;
  SELECT * FROM task_submissions WHERE id = p_id;
END""",

'sp_submission_appeal': """
CREATE PROCEDURE `sp_submission_appeal`(IN p_id CHAR(36), IN p_user CHAR(36), IN p_text VARCHAR(1000), IN p_days INT)
proc: BEGIN
  DECLARE v_reviewed DATETIME DEFAULT NULL;
  DECLARE v_state VARCHAR(20) DEFAULT NULL;
  SELECT reviewed_at, review_state INTO v_reviewed, v_state FROM task_submissions
   WHERE id = p_id AND user_id = p_user;
  IF v_reviewed IS NULL THEN SELECT 0 AS ok, 'not_reviewed' AS result; LEAVE proc; END IF;
  IF v_state = 'appealed' THEN SELECT 0 AS ok, 'already_appealed' AS result; LEAVE proc; END IF;
  IF p_days > 0 AND v_reviewed < DATE_SUB(UTC_TIMESTAMP(), INTERVAL p_days DAY) THEN
    SELECT 0 AS ok, 'window_closed' AS result; LEAVE proc;
  END IF;
  UPDATE task_submissions SET review_state = 'appealed', appeal_text = p_text, appeal_at = UTC_TIMESTAMP()
   WHERE id = p_id;
  SELECT 1 AS ok, 'appealed' AS result;
END""",
}


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
                print(f"  {table}.{col} added")
        # 'auto_approved' is 13 characters; the first run created VARCHAR(12).
        db.session.execute(text("ALTER TABLE task_submissions MODIFY COLUMN review_state VARCHAR(20) NULL"))
        db.session.execute(text("UPDATE task_submissions SET review_state = 'auto_approved' WHERE review_state = 'auto_approve'"))
        for ddl in TABLES:
            db.session.execute(text(ddl))
        db.session.execute(text("INSERT IGNORE INTO task_settings (id) VALUES (1)"))
        for key, label in RULES:
            db.session.execute(text(
                "INSERT IGNORE INTO score_event_rules (event_type, label, points, is_active, cap_type) "
                "VALUES (:k, :l, 0, 0, 'per_item')"), {'k': key, 'l': label})
        db.session.commit()
        print("  tables + inactive task rules ready")
        for name, ddl in PROCS.items():
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(ddl))
        db.session.commit()
        print(f"  {len(PROCS)} procedures")
        print("Done.")


if __name__ == '__main__':
    main()
