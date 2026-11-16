-- SKOVO — free paid-cohort seats a free member gets.
-- Allowance is passed in from Admin → Subscriptions (pro_free_limits.free_paid_cohorts).
-- 0 means no free perk: they pay or take Pro.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_cohort_free_perk_status`$$
CREATE PROCEDURE `sp_cohort_free_perk_status`(
    IN p_user_id CHAR(36),
    IN p_allowance INT
)
BEGIN
    DECLARE v_used INT DEFAULT 0;
    DECLARE v_allow INT DEFAULT 1;

    SET v_allow = IFNULL(p_allowance, 1);
    IF v_allow < 0 THEN SET v_allow = 0; END IF;

    SELECT COUNT(*) INTO v_used
      FROM `cohort_enrollments`
     WHERE `user_id` = p_user_id
       AND `enrolled_via` = 'free_perk'
       AND `payment_status` IN ('paid', 'free');

    SELECT v_used AS used,
           v_allow AS allowance,
           (v_used < v_allow) AS available;
END$$


DROP PROCEDURE IF EXISTS `sp_student_cohort_enroll_free_perk`$$
CREATE PROCEDURE `sp_student_cohort_enroll_free_perk`(
    IN p_user_id   CHAR(36),
    IN p_cohort_id CHAR(36),
    IN p_allowance INT
)
BEGIN
    DECLARE v_price INT; DECLARE v_status VARCHAR(20);
    DECLARE v_total INT; DECLARE v_filled INT; DECLARE v_deleted DATETIME;
    DECLARE v_exists VARCHAR(20) DEFAULT NULL;
    DECLARE v_used INT DEFAULT 0;
    DECLARE v_allow INT DEFAULT 1;
    DECLARE v_eid CHAR(36);
    DECLARE v_taken INT DEFAULT 0;
    DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

    SET v_allow = IFNULL(p_allowance, 1);
    IF v_allow < 0 THEN SET v_allow = 0; END IF;

    START TRANSACTION;

    SELECT `price`, `status`, `total_seats`, `filled_seats`, `deleted_at`
      INTO v_price, v_status, v_total, v_filled, v_deleted
      FROM `cohorts` WHERE `id` = p_cohort_id FOR UPDATE;

    SELECT COUNT(*) INTO v_used
      FROM `cohort_enrollments`
     WHERE `user_id` = p_user_id
       AND `enrolled_via` = 'free_perk'
       AND `payment_status` IN ('paid', 'free');

    IF v_price IS NULL OR v_deleted IS NOT NULL THEN
        ROLLBACK; SELECT 0 AS ok, 'notfound' AS result, 'Cohort not found.' AS message, NULL AS enrollment_id;
    ELSEIF v_status <> 'upcoming' AND NOT EXISTS (SELECT 1 FROM `cohorts` lj WHERE lj.id = p_cohort_id AND lj.status = 'live' AND lj.late_join_minutes > 0 AND UTC_TIMESTAMP() <= lj.session_date + INTERVAL lj.late_join_minutes MINUTE) THEN  -- late joining
        ROLLBACK; SELECT 0 AS ok, 'closed' AS result, 'Enrollment is closed for this cohort.' AS message, NULL AS enrollment_id;
    ELSEIF v_price = 0 THEN
        ROLLBACK; SELECT 0 AS ok, 'not_paid_cohort' AS result, 'This cohort is already free — no need to use a free seat.' AS message, NULL AS enrollment_id;
    ELSEIF v_used >= v_allow THEN
        ROLLBACK; SELECT 0 AS ok, 'perk_spent' AS result, 'You have used your free cohort seats. Take Skovo Pro for unlimited.' AS message, NULL AS enrollment_id;
    ELSE
        SELECT `payment_status` INTO v_exists FROM `cohort_enrollments`
          WHERE `user_id` = p_user_id AND `cohort_id` = p_cohort_id LIMIT 1;

        IF v_exists IN ('paid', 'free') THEN
            ROLLBACK; SELECT 0 AS ok, 'already_enrolled' AS result, 'You are already enrolled in this cohort.' AS message, NULL AS enrollment_id;
        ELSE
            SELECT COUNT(*) INTO v_taken
              FROM `cohort_enrollments`
             WHERE `cohort_id` = p_cohort_id
               AND (
                    `payment_status` IN ('paid', 'free')
                 OR (`payment_status` = 'pending'
                     AND `expires_at` IS NOT NULL
                     AND `expires_at` > UTC_TIMESTAMP()
                     AND `user_id` <> p_user_id)
                   );
        IF v_total IS NOT NULL AND v_total > 0 AND IFNULL(v_taken, 0) >= v_total THEN
            ROLLBACK; SELECT 0 AS ok, 'full' AS result, 'No seats available.' AS message, NULL AS enrollment_id;
        ELSE
            SET v_eid = UUID();
            INSERT INTO `cohort_enrollments`
                (`id`, `user_id`, `cohort_id`, `payment_status`, `amount_paid`, `enrolled_via`, `enrolled_at`)
            VALUES
                (v_eid, p_user_id, p_cohort_id, 'free', 0, 'free_perk', UTC_TIMESTAMP())
            ON DUPLICATE KEY UPDATE
                `payment_status` = 'free', `amount_paid` = 0, `enrolled_via` = 'free_perk';

            SELECT `id` INTO v_eid FROM `cohort_enrollments`
              WHERE `user_id` = p_user_id AND `cohort_id` = p_cohort_id LIMIT 1;

            UPDATE `cohorts` SET `filled_seats` = `filled_seats` + 1 WHERE `id` = p_cohort_id;
            COMMIT;
            SELECT 1 AS ok, 'ok' AS result, 'Enrolled with a free cohort seat.' AS message, v_eid AS enrollment_id;
        END IF;
        END IF;
    END IF;
END$$

DELIMITER ;
