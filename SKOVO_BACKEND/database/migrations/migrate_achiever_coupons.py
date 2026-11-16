"""
Migration: achiever-owned coupons.

Adds coupons.owner_achiever_id (NULL = platform/admin coupon), rebuilds
sp_student_coupon_validate to return the owner (so enrol routes can scope a
coupon to its owner's cohorts/courses), and adds achiever coupon CRUD procs.
Idempotent. Run from SKOVO_BACKEND:  python migrate_achiever_coupons.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("alter", "ALTER TABLE coupons ADD COLUMN owner_achiever_id CHAR(36) NULL"),
    ("sp", "DROP PROCEDURE IF EXISTS sp_student_coupon_validate"),
    ("sp", """
    CREATE PROCEDURE sp_student_coupon_validate(
        IN p_code VARCHAR(40), IN p_user_id CHAR(36), IN p_amount DECIMAL(10,2), IN p_context_type VARCHAR(10))
    BEGIN
        DECLARE v_id CHAR(36); DECLARE v_active TINYINT; DECLARE v_type VARCHAR(10);
        DECLARE v_value DECIMAL(10,2); DECLARE v_maxdisc DECIMAL(10,2);
        DECLARE v_minamt DECIMAL(10,2); DECLARE v_applies VARCHAR(10);
        DECLARE v_maxuses INT; DECLARE v_used INT; DECLARE v_peruser INT;
        DECLARE v_from DATETIME; DECLARE v_until DATETIME; DECLARE v_owner CHAR(36);
        DECLARE v_userused INT DEFAULT 0;
        DECLARE v_discount DECIMAL(10,2) DEFAULT 0;
        DECLARE v_now DATETIME DEFAULT UTC_TIMESTAMP();
        SELECT id, is_active, discount_type, value, max_discount, min_amount, applies_to,
               max_uses, used_count, per_user_limit, valid_from, valid_until, owner_achiever_id
          INTO v_id, v_active, v_type, v_value, v_maxdisc, v_minamt, v_applies,
               v_maxuses, v_used, v_peruser, v_from, v_until, v_owner
          FROM coupons WHERE code = UPPER(TRIM(p_code)) LIMIT 1;
        IF v_id IS NULL OR v_active = 0 THEN
            SELECT 0 AS valid, 0 AS discount, p_amount AS final_amount, 'Invalid coupon.' AS message, NULL AS coupon_id, NULL AS owner_achiever_id;
        ELSEIF v_from IS NOT NULL AND v_now < v_from THEN
            SELECT 0, 0, p_amount, 'Coupon not yet active.', NULL, NULL;
        ELSEIF v_until IS NOT NULL AND v_now > v_until THEN
            SELECT 0, 0, p_amount, 'Coupon expired.', NULL, NULL;
        ELSEIF v_applies NOT IN ('all', p_context_type) THEN
            SELECT 0, 0, p_amount, 'Coupon not valid for this purchase.', NULL, NULL;
        ELSEIF p_amount < IFNULL(v_minamt,0) THEN
            SELECT 0, 0, p_amount, CONCAT('Minimum order ', v_minamt, ' required.'), NULL, NULL;
        ELSEIF v_maxuses IS NOT NULL AND IFNULL(v_used,0) >= v_maxuses THEN
            SELECT 0, 0, p_amount, 'Coupon usage limit reached.', NULL, NULL;
        ELSE
            IF v_peruser IS NOT NULL AND v_peruser > 0 THEN
                SELECT COUNT(*) INTO v_userused FROM coupon_redemptions WHERE coupon_id = v_id AND user_id = p_user_id;
            END IF;
            IF v_peruser IS NOT NULL AND v_peruser > 0 AND v_userused >= v_peruser THEN
                SELECT 0, 0, p_amount, 'You have already used this coupon.', NULL, NULL;
            ELSE
                IF v_type = 'flat' THEN SET v_discount = v_value;
                ELSE
                    SET v_discount = p_amount * v_value / 100.0;
                    IF v_maxdisc IS NOT NULL THEN SET v_discount = LEAST(v_discount, v_maxdisc); END IF;
                END IF;
                SET v_discount = ROUND(LEAST(v_discount, p_amount), 2);
                IF v_discount <= 0 THEN
                    SELECT 0, 0, p_amount, 'Coupon gives no discount on this order.', NULL, NULL;
                ELSE
                    SELECT 1 AS valid, v_discount AS discount, ROUND(p_amount - v_discount, 2) AS final_amount,
                           NULL AS message, v_id AS coupon_id, v_owner AS owner_achiever_id;
                END IF;
            END IF;
        END IF;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_achiever_coupon_create"),
    ("sp", """
    CREATE PROCEDURE sp_achiever_coupon_create(
        IN p_id CHAR(36), IN p_owner CHAR(36), IN p_code VARCHAR(40), IN p_type VARCHAR(10),
        IN p_value DECIMAL(10,2), IN p_max_discount DECIMAL(10,2), IN p_min_amount DECIMAL(10,2),
        IN p_applies VARCHAR(10), IN p_max_uses INT, IN p_per_user INT, IN p_from DATETIME, IN p_until DATETIME)
    BEGIN
        IF EXISTS (SELECT 1 FROM coupons WHERE code = UPPER(TRIM(p_code))) THEN
            SELECT 0 AS ok, 'Coupon code already exists.' AS message, NULL AS id;
        ELSE
            INSERT INTO coupons (id, code, discount_type, value, max_discount, min_amount, applies_to,
                                 max_uses, per_user_limit, valid_from, valid_until, is_active, owner_achiever_id, created_by)
            VALUES (p_id, UPPER(TRIM(p_code)), COALESCE(p_type,'percent'), IFNULL(p_value,0), p_max_discount,
                    IFNULL(p_min_amount,0), COALESCE(p_applies,'all'), p_max_uses, IFNULL(p_per_user,1),
                    p_from, p_until, 1, p_owner, p_owner);
            SELECT 1 AS ok, 'Coupon created.' AS message, p_id AS id;
        END IF;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_achiever_coupon_list"),
    ("sp", """
    CREATE PROCEDURE sp_achiever_coupon_list(IN p_owner CHAR(36))
    BEGIN
        SELECT id, code, discount_type, value, max_discount, min_amount, applies_to, max_uses, used_count,
               per_user_limit, valid_from, valid_until, is_active, created_at
          FROM coupons WHERE owner_achiever_id = p_owner ORDER BY created_at DESC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_achiever_coupon_deactivate"),
    ("sp", """
    CREATE PROCEDURE sp_achiever_coupon_deactivate(IN p_id CHAR(36), IN p_owner CHAR(36))
    BEGIN
        UPDATE coupons SET is_active = 0 WHERE id = p_id AND owner_achiever_id = p_owner;
        SELECT ROW_COUNT() AS updated;
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
                if kind == "alter" and "Duplicate column" in str(e):
                    pass
                else:
                    raise
        print("achiever coupons migration complete.")


if __name__ == "__main__":
    main()
