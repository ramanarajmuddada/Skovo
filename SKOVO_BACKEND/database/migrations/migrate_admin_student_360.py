"""Migration: the admin student page (Students list + one student, every v1 feature).

The list used to pull every user (up to 20,000) into Python and look up each
profile one by one; the detail panel only knew profile, score and counts. These
procedures do the filtering, paging and per-tab reads in MySQL, one call each.
call_proc reads only the first result set, so every procedure returns exactly
one, with lists bundled as JSON columns.

  sp_admin_students_page      search + status + class + joined range + sort, paged (total_rows)
  sp_admin_students_stats     the four tiles over the list: all, new this week, active 7 days, blocked
  sp_admin_student_summary    header: class, rank in class, streak, last points change, stage history
  sp_admin_student_habits     streaks + calendar, buddies, groups, daily goal, quests, monthly challenge
  sp_admin_student_practice   quizzes, speed rounds, My Mistakes, achievements
  sp_admin_student_points     every score event with its rule label, paged (total_rows)
  sp_admin_student_activity   cohorts, 1-on-1 bookings, applications, notifications sent
  sp_admin_student_money      wallet, payment orders, refunds, wallet ledger, plans

Dates: users.created_at etc. are UTC; p_day / p_from / p_to are IST days.
Read-only procedures; idempotent.
    venv/Scripts/python.exe database/migrations/migrate_admin_student_360.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

IST = 330  # minutes

PROCS = {
'sp_admin_students_page': f"""
CREATE PROCEDURE `sp_admin_students_page`(IN p_q VARCHAR(100), IN p_status VARCHAR(20), IN p_class VARCHAR(50),
                                          IN p_from DATE, IN p_to DATE, IN p_sort VARCHAR(20),
                                          IN p_limit INT, IN p_offset INT)
BEGIN
  SET p_q = NULLIF(TRIM(p_q), ''), p_status = NULLIF(p_status, ''), p_class = NULLIF(p_class, '');
  SELECT u.id, u.full_name, u.email, COALESCE(NULLIF(u.phone, ''), p.phone) AS phone, u.status,
         u.created_at, u.avatar_url, p.city, p.state, p.education_level, p.education_category,
         st.stage_group, mg.label AS class_label, st.sub_year,
         IFNULL(r.score, 0) AS score, r.level,
         IFNULL(cs.lifetime_current, 0) AS streak,
         (SELECT MAX(s.created_at) FROM `sessions` s WHERE s.user_id = u.id) AS last_login_at,
         COUNT(*) OVER () AS total_rows
    FROM `users` u
    LEFT JOIN `user_profiles` p      ON p.user_id = u.id
    LEFT JOIN `student_stages` st    ON st.user_id = u.id AND st.status = 'active'
    LEFT JOIN `master_stage_group` mg ON mg.value = st.stage_group
    LEFT JOIN `readiness_scores` r   ON r.user_id = u.id
    LEFT JOIN `career_streaks` cs    ON cs.user_id = u.id
   WHERE u.deleted_at IS NULL
     AND (p_q IS NULL OR u.full_name LIKE CONCAT('%', p_q, '%') OR u.email LIKE CONCAT('%', p_q, '%')
          OR u.phone LIKE CONCAT('%', p_q, '%') OR p.phone LIKE CONCAT('%', p_q, '%'))
     AND (p_status IS NULL OR u.status = p_status)
     AND (p_class IS NULL OR (p_class = '__none' AND st.stage_group IS NULL) OR st.stage_group = p_class)
     AND (p_from IS NULL OR u.created_at >= DATE_SUB(p_from, INTERVAL {IST} MINUTE))
     AND (p_to IS NULL OR u.created_at < DATE_SUB(DATE_ADD(p_to, INTERVAL 1 DAY), INTERVAL {IST} MINUTE))
   ORDER BY
     CASE WHEN p_sort = 'score'  THEN IFNULL(r.score, 0) END DESC,
     CASE WHEN p_sort = 'streak' THEN IFNULL(cs.lifetime_current, 0) END DESC,
     CASE WHEN p_sort = 'active' THEN (SELECT MAX(s.created_at) FROM `sessions` s WHERE s.user_id = u.id) END DESC,
     CASE WHEN p_sort = 'name'   THEN u.full_name END ASC,
     u.created_at DESC
   LIMIT p_limit OFFSET p_offset;
END""",

'sp_admin_students_stats': """
CREATE PROCEDURE `sp_admin_students_stats`()
BEGIN
  SELECT COUNT(*) AS total,
         SUM(u.created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS new_week,
         SUM(u.status = 'blocked') AS blocked,
         (SELECT COUNT(DISTINCT s.user_id) FROM `sessions` s JOIN `users` u2 ON u2.id = s.user_id AND u2.deleted_at IS NULL
           WHERE s.created_at >= UTC_TIMESTAMP() - INTERVAL 7 DAY) AS active_week
    FROM `users` u WHERE u.deleted_at IS NULL;
END""",

'sp_admin_student_summary': """
CREATE PROCEDURE `sp_admin_student_summary`(IN p_user CHAR(36))
BEGIN
  DECLARE v_group VARCHAR(50) DEFAULT NULL;
  DECLARE v_sub   VARCHAR(20) DEFAULT NULL;
  DECLARE v_since DATETIME    DEFAULT NULL;
  DECLARE v_score INT         DEFAULT 0;
  SELECT st.stage_group, st.sub_year, st.started_at INTO v_group, v_sub, v_since
    FROM `student_stages` st WHERE st.user_id = p_user AND st.status = 'active'
   ORDER BY st.started_at DESC LIMIT 1;
  SELECT IFNULL(MAX(score), 0) INTO v_score FROM `readiness_scores` WHERE user_id = p_user;
  SELECT v_group AS stage_group,
         (SELECT label FROM `master_stage_group` WHERE value = v_group LIMIT 1) AS class_label,
         v_sub AS sub_year, v_since AS stage_started_at, v_score AS score,
         IF(v_group IS NULL, NULL, 1 + (
            SELECT COUNT(*) FROM `student_stages` s2
              JOIN `readiness_scores` r2 ON r2.user_id = s2.user_id
              JOIN `users` u2 ON u2.id = s2.user_id AND u2.deleted_at IS NULL
             WHERE s2.status = 'active' AND s2.stage_group = v_group AND r2.score > v_score)) AS class_rank,
         IF(v_group IS NULL, NULL, (
            SELECT COUNT(*) FROM `student_stages` s3 JOIN `users` u3 ON u3.id = s3.user_id AND u3.deleted_at IS NULL
             WHERE s3.status = 'active' AND s3.stage_group = v_group)) AS class_size,
         (SELECT MAX(t) FROM (SELECT MAX(occurred_at) AS t FROM `score_events` WHERE user_id = p_user
                              UNION ALL
                              SELECT MAX(created_at) FROM `score_adjustments` WHERE user_id = p_user) x) AS last_points_at,
         (SELECT COUNT(*) FROM `score_events` WHERE user_id = p_user) AS points_events,
         (SELECT lifetime_current FROM `career_streaks` WHERE user_id = p_user) AS streak,
         (SELECT lifetime_best FROM `career_streaks` WHERE user_id = p_user) AS streak_best,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT(
                    'stage_group', h.stage_group,
                    'label', (SELECT m.label FROM `master_stage_group` m WHERE m.value = h.stage_group LIMIT 1),
                    'sub_year', h.sub_year, 'status', h.status, 'started_at', h.started_at,
                    'ended_at', h.ended_at, 'final_score', h.final_score, 'close_reason', h.close_reason))
            FROM (SELECT * FROM `student_stages` WHERE user_id = p_user ORDER BY started_at DESC LIMIT 10) h) AS stages_json;
END""",

'sp_admin_student_habits': """
CREATE PROCEDURE `sp_admin_student_habits`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  SELECT cs.lifetime_current, cs.lifetime_best, cs.stage_current, cs.stage_best, cs.freezes_held,
         cs.covered_through, cs.broken_on,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('day', d.day, 'kind', d.kind))
            FROM `streak_days` d WHERE d.user_id = p_user AND d.day > DATE_SUB(p_day, INTERVAL 35 DAY)) AS days_json,
         g.level_key AS goal_key, gl.label AS goal_label, gl.tasks_per_day,
         (SELECT IFNULL(SUM(`count`), 0) FROM `daily_activity`
           WHERE user_id = p_user AND day = p_day AND action_key <> 'daily_goal_met') AS today_tasks,
         (SELECT COUNT(*) FROM `daily_activity` WHERE user_id = p_user AND action_key = 'daily_goal_met'
             AND day BETWEEN DATE_SUB(p_day, INTERVAL WEEKDAY(p_day) DAY) AND p_day) AS goal_days_week,
         (SELECT COUNT(*) FROM `daily_activity` WHERE user_id = p_user AND action_key = 'daily_goal_met') AS goal_days_total,
         (SELECT COUNT(*) FROM `score_events` WHERE user_id = p_user AND event_type = 'perfect_week') AS perfect_weeks,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('label', q.label, 'difficulty', q.difficulty, 'progress', uq.progress,
                                           'target', uq.target, 'done', uq.done_at IS NOT NULL))
            FROM `user_quests` uq JOIN `quests` q ON q.id = uq.quest_id
           WHERE uq.user_id = p_user AND uq.day = p_day) AS quests_json,
         (SELECT COUNT(*) FROM `user_quests` WHERE user_id = p_user AND done_at IS NOT NULL) AS quests_done_total,
         mc.label AS challenge_label, mc.target_quests AS challenge_target, mc.badge_label AS challenge_badge,
         (SELECT COUNT(*) FROM `user_quests` WHERE user_id = p_user AND done_at IS NOT NULL
             AND DATE_FORMAT(day, '%Y-%m') = DATE_FORMAT(p_day, '%Y-%m')) AS challenge_done,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('month', a.month, 'badge', c.badge_label, 'at', a.awarded_at))
            FROM `user_challenge_awards` a LEFT JOIN `monthly_challenges` c ON c.month = a.month
           WHERE a.user_id = p_user) AS badges_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', b.id, 'name', u2.full_name, 'status', b.status,
                                           'current', b.current, 'best', b.best))
            FROM `buddy_streaks` b LEFT JOIN `users` u2 ON u2.id = IF(b.user_a = p_user, b.user_b, b.user_a)
           WHERE (b.user_a = p_user OR b.user_b = p_user) AND b.status IN ('pending', 'active')) AS buddies_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('id', g2.id, 'name', g2.name, 'status', g2.status,
                                           'current', g2.current, 'best', g2.best,
                                           'members', (SELECT COUNT(*) FROM `streak_group_members` m2
                                                        WHERE m2.group_id = g2.id AND m2.left_at IS NULL)))
            FROM `streak_groups` g2
            JOIN `streak_group_members` m ON m.group_id = g2.id AND m.user_id = p_user AND m.left_at IS NULL
           WHERE g2.status IN ('forming', 'active')) AS groups_json
    FROM (SELECT 1 AS one) x
    LEFT JOIN `career_streaks` cs  ON cs.user_id = p_user
    LEFT JOIN `user_goals` g       ON g.user_id = p_user
    LEFT JOIN `goal_levels` gl     ON gl.level_key = g.level_key
    LEFT JOIN `monthly_challenges` mc ON mc.month = DATE_FORMAT(p_day, '%Y-%m') AND mc.is_active = 1;
END""",

'sp_admin_student_practice': """
CREATE PROCEDURE `sp_admin_student_practice`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  SELECT (SELECT COUNT(*) FROM `quiz_attempts` WHERE user_id = p_user AND status IN ('submitted', 'expired')) AS quizzes_taken,
         (SELECT ROUND(AVG(percent), 1) FROM `quiz_attempts` WHERE user_id = p_user AND status IN ('submitted', 'expired')) AS quiz_avg,
         (SELECT MAX(percent) FROM `quiz_attempts` WHERE user_id = p_user AND status IN ('submitted', 'expired')) AS quiz_best,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', z.title, 'cohort', z.cohort, 'percent', z.percent, 'at', z.submitted_at))
            FROM (SELECT t.title, c.title AS cohort, qa.percent, qa.submitted_at
                    FROM `quiz_attempts` qa
                    LEFT JOIN `cohort_tasks` t ON t.id = qa.task_id
                    LEFT JOIN `cohorts` c      ON c.id = t.cohort_id
                   WHERE qa.user_id = p_user AND qa.status IN ('submitted', 'expired')
                   ORDER BY qa.submitted_at DESC LIMIT 8) z) AS quizzes_json,
         (SELECT IFNULL(SUM(`count`), 0) FROM `daily_activity` WHERE user_id = p_user AND action_key = 'speed_round') AS speed_rounds,
         (SELECT MAX(day) FROM `daily_activity` WHERE user_id = p_user AND action_key = 'speed_round') AS speed_last,
         (SELECT COUNT(*) FROM `mistake_reviews` WHERE user_id = p_user AND cleared_at IS NULL AND due_on <= p_day) AS mistakes_due,
         (SELECT COUNT(*) FROM `mistake_reviews` WHERE user_id = p_user AND cleared_at IS NULL) AS mistakes_open,
         (SELECT COUNT(*) FROM `mistake_reviews` WHERE user_id = p_user AND cleared_at IS NOT NULL) AS mistakes_cleared,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('key', ua.ach_key, 'label', a.label, 'tier', ua.tier, 'at', ua.earned_at))
            FROM `user_achievements` ua LEFT JOIN `achievements` a ON a.ach_key = ua.ach_key
           WHERE ua.user_id = p_user) AS achievements_json;
END""",

'sp_admin_student_points': """
CREATE PROCEDURE `sp_admin_student_points`(IN p_user CHAR(36), IN p_limit INT, IN p_offset INT)
BEGIN
  SELECT e.id, e.event_type, IFNULL(r.label, e.event_type) AS label, e.points, e.occurred_at,
         COUNT(*) OVER () AS total_rows
    FROM `score_events` e LEFT JOIN `score_event_rules` r ON r.event_type = e.event_type
   WHERE e.user_id = p_user
   ORDER BY e.occurred_at DESC, e.seq DESC
   LIMIT p_limit OFFSET p_offset;
END""",

'sp_admin_student_activity': """
CREATE PROCEDURE `sp_admin_student_activity`(IN p_user CHAR(36))
BEGIN
  SELECT (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', z.title, 'status', z.status, 'session_date', z.session_date,
                                           'payment', z.payment_status, 'attended', z.attended))
            FROM (SELECT c.title, c.status, c.session_date, ce.payment_status, ce.attended
                    FROM `cohort_enrollments` ce JOIN `cohorts` c ON c.id = ce.cohort_id
                   WHERE ce.user_id = p_user ORDER BY c.session_date DESC LIMIT 10) z) AS cohorts_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('mentor', z.full_name, 'status', z.status, 'amount', z.amount,
                                           'demo', z.is_demo, 'payment', z.payment_status, 'at', z.created_at))
            FROM (SELECT a.full_name, s.status, s.amount, s.is_demo, s.payment_status, s.created_at
                    FROM `achiever_sessions` s LEFT JOIN `achievers` a ON a.id = s.mentor_id
                   WHERE s.student_id = p_user ORDER BY s.created_at DESC LIMIT 10) z) AS bookings_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', z.title, 'company', z.company, 'status', z.status, 'at', z.applied_at))
            FROM (SELECT o.title, o.company, oa.status, oa.applied_at
                    FROM `opportunity_applications` oa LEFT JOIN `opportunities` o ON o.id = oa.opportunity_id
                   WHERE oa.user_id = p_user ORDER BY oa.applied_at DESC LIMIT 10) z) AS applications_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('title', z.title, 'body', z.body, 'type', z.type, 'read', z.is_read, 'at', z.created_at))
            FROM (SELECT title, body, type, is_read, created_at FROM `notification_logs`
                   WHERE user_id = p_user ORDER BY created_at DESC LIMIT 15) z) AS notifications_json;
END""",

'sp_admin_student_money': """
CREATE PROCEDURE `sp_admin_student_money`(IN p_user CHAR(36))
BEGIN
  SELECT (SELECT IFNULL(SUM(amount), 0) FROM `wallet_ledger` WHERE user_id = p_user AND kind = 'refund') AS wallet_refund,
         (SELECT IFNULL(SUM(remaining), 0) FROM `wallet_bonus_lots`
           WHERE user_id = p_user AND remaining > 0 AND expires_at > UTC_TIMESTAMP()) AS wallet_bonus,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('order_no', z.order_no, 'kind', z.kind, 'gross', z.gross, 'discount', z.discount,
                                           'status', z.status, 'refunded', z.refunded_amount, 'wallet', z.wallet_amount,
                                           'at', IFNULL(z.paid_at, z.created_at)))
            FROM (SELECT order_no, kind, gross, discount, status, refunded_amount, wallet_amount, paid_at, created_at
                    FROM `payment_orders` WHERE student_id = p_user ORDER BY created_at DESC LIMIT 10) z) AS orders_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('order_no', z.order_no, 'amount', z.amount, 'status', z.status,
                                           'destination', z.destination, 'at', z.created_at))
            FROM (SELECT r.order_no, r.amount, r.status, r.destination, r.created_at
                    FROM `refunds` r JOIN `payment_orders` o ON o.id = r.order_id
                   WHERE o.student_id = p_user ORDER BY r.created_at DESC LIMIT 10) z) AS refunds_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('type', z.type, 'kind', z.kind, 'amount', z.amount, 'reason', z.reason, 'at', z.created_at))
            FROM (SELECT type, kind, amount, reason, created_at FROM `wallet_ledger`
                   WHERE user_id = p_user ORDER BY id DESC LIMIT 10) z) AS ledger_json,
         (SELECT JSON_ARRAYAGG(JSON_OBJECT('plan', z.plan, 'status', z.status, 'amount', z.amount,
                                           'started_at', z.started_at, 'expires_at', z.expires_at))
            FROM (SELECT plan, status, amount, started_at, expires_at FROM `subscriptions`
                   WHERE user_id = p_user ORDER BY created_at DESC LIMIT 5) z) AS plans_json;
END""",
}


def main():
    with app.app_context():
        for name, body in PROCS.items():
            db.session.execute(text(f'DROP PROCEDURE IF EXISTS `{name}`'))
            db.session.execute(text(body))
        db.session.commit()
        print(f'student 360 procedures ready: {len(PROCS)}')


if __name__ == '__main__':
    main()
