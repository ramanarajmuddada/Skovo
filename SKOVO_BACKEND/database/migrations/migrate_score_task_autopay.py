"""Tasks pay themselves. Nobody clicks anything, on either side.

WHY THE CLAIM FLOW HAD TO GO
    A task used to need two human actions: the student taps "I've done this",
    then an admin looks and approves. At 10,000 students that is two failure
    points, not one:

      * the student who did the work but never tapped goes unpaid, and has no
        idea why -- the commonest outcome, because the tap is a step that earns
        them nothing on its own
      * the admin cannot check 10,000 claims, so the queue is either rubber
        stamped (the check is theatre) or it grows forever (students wait weeks)

    Auto-verified claims fixed the second problem and left the first. The tap
    itself was still load-bearing.

WHAT REPLACES IT
    sp_score_task_autopay measures the task's metric for the student and pays if
    it is met. That is the whole flow. The student uploads their marksheet and
    the points are there; they never told us, and nobody approved it.

    It runs wherever rules run -- nightly for everyone, and instantly for one
    student whenever that student does anything -- so the upload that completes
    a task pays in the same second.

THE RULE THIS MAKES EXPLICIT
    If the platform cannot prove a task, it is not a readiness task.

    A task with no verify_metric now pays nobody automatically. That is
    deliberate and it is the point: rather than quietly falling back to a queue
    nobody can work through, it stays visibly unpaid until an admin either
    gives it a metric or credits the student from Adjust, which is the honest
    place for a human judgement.

WHAT IS KEPT
    score_task_submissions and sp_score_task_complete stay. Admin crediting is
    still how an unprovable task gets paid, and the submissions table holds the
    history of claims already made. Nothing is deleted; the student-facing tap
    is simply gone.

    ref_id is still the task id, so a task pays once per student however many
    times this runs -- and a task already paid through the old claim flow is
    left exactly as it was.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_task_autopay.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

AUTOPAY = """
CREATE PROCEDURE `sp_score_task_autopay`(IN p_user CHAR(36))
BEGIN
  DECLARE v_done    INT DEFAULT 0;
  DECLARE v_task    CHAR(36);
  DECLARE v_points  DECIMAL(5,2);
  DECLARE v_metric  VARCHAR(40);
  DECLARE v_filter  VARCHAR(40);
  DECLARE v_thresh  INT;
  DECLARE v_since   DATETIME;
  DECLARE v_label   VARCHAR(160);
  DECLARE v_have    INT DEFAULT 0;
  DECLARE v_paid    INT DEFAULT 0;

  -- Every active, in-date task that applies to this student AND can be proved.
  -- The audience predicate is the same one sp_score_tasks_for_student uses --
  -- a task must not pay a student it would not have been shown to.
  DECLARE cur CURSOR FOR
      SELECT t.`id`, t.`points`, t.`verify_metric`, t.`verify_filter`,
             IFNULL(t.`verify_threshold`, 1),
             IF(IFNULL(t.`verify_since_task`, 1) = 1, t.`created_at`, NULL),
             t.`label`
        FROM `score_tasks` t
        LEFT JOIN `user_profiles` p ON p.`user_id` = p_user
       WHERE t.`is_active` = 1
         AND IFNULL(t.`status`, 'active') = 'active'
         AND (t.`expires_at` IS NULL OR UTC_TIMESTAMP() <= t.`expires_at`)
         AND t.`verify_metric` IS NOT NULL AND t.`verify_metric` <> ''
         AND (
              t.`scope` = 'all'
           OR (t.`scope` = 'student' AND t.`user_id` = p_user)
           OR (t.`scope` = 'batch'
               AND ((t.`education_category` IS NOT NULL AND t.`education_category` <> '')
                    OR (t.`degree_type` IS NOT NULL AND t.`degree_type` <> ''))
               AND (t.`education_category` IS NULL OR t.`education_category` = ''
                    OR p.`education_category` = t.`education_category`)
               AND (t.`degree_type` IS NULL OR t.`degree_type` = ''
                    OR p.`degree_type` = t.`degree_type`))
         );
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  IF p_user IS NULL THEN
      -- Guard rather than silently doing nothing: a caller that meant "everyone"
      -- wants sp_score_task_autopay_all, and a NULL here would open the cursor
      -- against a NULL profile and match nothing.
      SET @score_tasks_paid = 0;
  ELSE
      SET @score_tasks_paid = 0;

      OPEN cur;
      task_loop: LOOP
          FETCH cur INTO v_task, v_points, v_metric, v_filter, v_thresh, v_since, v_label;
          IF v_done = 1 THEN LEAVE task_loop; END IF;

          -- Already credited, by this pass or by an admin earlier. The ledger's
          -- unique key would swallow a second write anyway; checking first
          -- keeps the snapshot work off the common path.
          SELECT COUNT(*) INTO v_paid FROM `score_events`
           WHERE `user_id` = p_user AND `event_type` = 'admin_task'
             AND `ref_id` = v_task;

          IF v_paid = 0 THEN
              -- v_since is the task's creation time unless the admin said
              -- existing state counts, so a student cannot be paid for work
              -- they had already done before the task existed.
              CALL sp_score_metric_snapshot(v_metric, v_filter, v_since, p_user);
              SELECT IFNULL(MAX(`val`), 0) INTO v_have
                FROM `tmp_score_metric` WHERE `user_id` = p_user;

              IF v_have >= v_thresh THEN
                  INSERT IGNORE INTO `score_events`
                         (`id`, `user_id`, `event_type`, `points`, `ref_id`, `meta`)
                  VALUES (UUID(), p_user, 'admin_task', v_points, v_task,
                          CONCAT('auto: ', LEFT(v_label, 180)));

                  -- Record the decision too, so the roster shows it was settled
                  -- by the platform rather than looking like it never happened.
                  INSERT INTO `score_task_submissions`
                         (`id`, `task_id`, `user_id`, `status`, `note`, `decided_at`)
                  VALUES (UUID(), v_task, p_user, 'approved', 'auto-verified',
                          UTC_TIMESTAMP())
                  ON DUPLICATE KEY UPDATE `status` = 'approved',
                                          `decided_at` = UTC_TIMESTAMP();

                  SET @score_tasks_paid = @score_tasks_paid + 1;
              END IF;
          END IF;
      END LOOP;
      CLOSE cur;
  END IF;
END
"""

# The nightly pass. One cursor over students who could plausibly be affected,
# rather than all 10,000 -- see the comment inside.
AUTOPAY_ALL = """
CREATE PROCEDURE `sp_score_task_autopay_all`()
BEGIN
  DECLARE v_done INT DEFAULT 0;
  DECLARE v_user CHAR(36);
  DECLARE v_n    INT DEFAULT 0;

  -- Only students who have an unpaid, provable task that applies to them. At
  -- 10,000 students with a handful of tasks that is a small set, and it shrinks
  -- as tasks get paid -- whereas walking every student every night would not.
  DECLARE cur CURSOR FOR
      SELECT DISTINCT u.`id`
        FROM `users` u
        LEFT JOIN `user_profiles` p ON p.`user_id` = u.`id`
        JOIN `score_tasks` t
          ON t.`is_active` = 1
         AND IFNULL(t.`status`, 'active') = 'active'
         AND (t.`expires_at` IS NULL OR UTC_TIMESTAMP() <= t.`expires_at`)
         AND t.`verify_metric` IS NOT NULL AND t.`verify_metric` <> ''
         AND (
              t.`scope` = 'all'
           OR (t.`scope` = 'student' AND t.`user_id` = u.`id`)
           OR (t.`scope` = 'batch'
               AND ((t.`education_category` IS NOT NULL AND t.`education_category` <> '')
                    OR (t.`degree_type` IS NOT NULL AND t.`degree_type` <> ''))
               AND (t.`education_category` IS NULL OR t.`education_category` = ''
                    OR p.`education_category` = t.`education_category`)
               AND (t.`degree_type` IS NULL OR t.`degree_type` = ''
                    OR p.`degree_type` = t.`degree_type`))
         )
       WHERE u.`deleted_at` IS NULL
         AND NOT EXISTS (
               SELECT 1 FROM `score_events` e
                WHERE e.`user_id` = u.`id` AND e.`event_type` = 'admin_task'
                  AND e.`ref_id` = t.`id`);
  DECLARE CONTINUE HANDLER FOR NOT FOUND SET v_done = 1;

  DROP TEMPORARY TABLE IF EXISTS `tmp_score_touched`;
  CREATE TEMPORARY TABLE `tmp_score_touched` (
      `user_id` CHAR(36) NOT NULL, PRIMARY KEY (`user_id`)
  ) ENGINE=MEMORY;

  OPEN cur;
  u_loop: LOOP
      FETCH cur INTO v_user;
      IF v_done = 1 THEN LEAVE u_loop; END IF;
      CALL sp_score_task_autopay(v_user);
      IF IFNULL(@score_tasks_paid, 0) > 0 THEN
          INSERT IGNORE INTO `tmp_score_touched` (`user_id`) VALUES (v_user);
          SET v_n = v_n + IFNULL(@score_tasks_paid, 0);
      END IF;
  END LOOP;
  CLOSE cur;

  CALL sp_score_recalc_bulk('touched');
  DROP TEMPORARY TABLE IF EXISTS `tmp_score_touched`;

  SELECT v_n AS tasks_paid;
END
"""


def main():
    with app.app_context():
        for name, body in (('sp_score_task_autopay', AUTOPAY),
                           ('sp_score_task_autopay_all', AUTOPAY_ALL)):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        # How many tasks can actually pay themselves today. A task with no
        # metric is a task nobody will ever be paid for automatically, so this
        # number is worth printing rather than hiding.
        rows = db.session.execute(text(
            "SELECT label, points, verify_metric FROM score_tasks "
            "WHERE is_active = 1 AND IFNULL(status,'active') = 'active' "
            "ORDER BY verify_metric IS NULL, label")).mappings().all()
        provable = [r for r in rows if r['verify_metric']]
        print(f"  active tasks: {len(rows)} -- {len(provable)} can pay themselves")
        for r in rows:
            mark = r['verify_metric'] or 'NO METRIC - needs one, or pay from Adjust'
            print(f"    {float(r['points']):>6}  {(r['label'] or '')[:44]:<46} {mark}")
        print("Done.")


if __name__ == '__main__':
    main()
