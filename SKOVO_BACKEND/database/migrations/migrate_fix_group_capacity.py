"""
Migration: communities were permanently "full".

Two faults, both fixed here.

1. `max_members = 0` meant "capacity zero", not "no limit".
   The admin create endpoint stored a blank cap as 0, and sp_assemble_group_join
   tested `max_members IS NOT NULL AND member_count >= max_members`. With 0 that
   is `0 >= 0` — true — so every community created without an explicit cap was
   full from the moment it existed and nobody could ever join it.
   The route now stores NULL (see admin_communities._capacity); this backfills
   the rows already saved as 0.

2. `member_count` was trusted blindly for the capacity check.
   It is a denormalised counter that only ever increments on join. Nothing in
   the app removes a membership today, but anything that ever does — an admin
   removing a member, a user deletion, a manual fix — silently leaves the
   counter too high and starts refusing joins to a group with free space.
   The join procedure now counts live rows for the capacity decision, so the
   gate is always based on reality and self-corrects. The counter is still
   maintained for cheap display, and is re-synced here.

Idempotent. Run from SKOVO_BACKEND:  python migrate_fix_group_capacity.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()


def main():
    with app.app_context():
        # ── 1. a cap of 0 means "no cap" ─────────────────────────────────────
        zeroed = db.session.execute(text(
            "SELECT COUNT(*) FROM `groups` WHERE max_members = 0")).scalar()
        db.session.execute(text(
            "UPDATE `groups` SET max_members = NULL WHERE max_members = 0"))
        db.session.commit()

        # ── 2. re-sync the display counter with reality ──────────────────────
        drifted = db.session.execute(text("""
            SELECT COUNT(*) FROM `groups` g
             WHERE g.member_count <> (
               SELECT COUNT(*) FROM group_memberships m
                WHERE m.group_id = g.id AND m.status = 'active')
        """)).scalar()
        db.session.execute(text("""
            UPDATE `groups` g
               SET g.member_count = (
                 SELECT COUNT(*) FROM group_memberships m
                  WHERE m.group_id = g.id AND m.status = 'active')
        """))
        db.session.commit()

        # ── 3. base the capacity gate on live rows, not the counter ──────────
        db.session.execute(text("DROP PROCEDURE IF EXISTS sp_assemble_group_join"))
        db.session.commit()
        db.session.execute(text("""
            CREATE PROCEDURE sp_assemble_group_join(IN p_user_id CHAR(36), IN p_group_id CHAR(36))
            BEGIN
                DECLARE v_deleted DATETIME; DECLARE v_join VARCHAR(20); DECLARE v_max INT;
                DECLARE v_count INT; DECLARE v_status VARCHAR(20); DECLARE v_new VARCHAR(20);
                DECLARE EXIT HANDLER FOR SQLEXCEPTION BEGIN ROLLBACK; RESIGNAL; END;

                SELECT `deleted_at`, `join_type`, `max_members`
                  INTO v_deleted, v_join, v_max
                  FROM `groups` WHERE `id` = p_group_id AND `is_active` = 1 LIMIT 1;

                -- Count real memberships rather than trusting member_count, so a
                -- drifted counter can never lock people out of a group with room.
                SELECT COUNT(*) INTO v_count FROM `group_memberships`
                 WHERE `group_id` = p_group_id AND `status` = 'active';

                IF v_join IS NULL OR v_deleted IS NOT NULL THEN
                    SELECT 'notfound' AS result, NULL AS status;
                ELSE
                    SELECT `status` INTO v_status FROM `group_memberships`
                     WHERE `user_id` = p_user_id AND `group_id` = p_group_id LIMIT 1;

                    IF v_status = 'active' THEN
                        SELECT 'already_member' AS result, 'active' AS status;
                    ELSEIF v_status = 'pending' THEN
                        SELECT 'already_pending' AS result, 'pending' AS status;
                    ELSEIF v_status IN ('rejected', 'left') THEN
                        SET v_new = IF(v_join = 'open', 'active', 'pending');
                        START TRANSACTION;
                        UPDATE `group_memberships`
                           SET `status` = v_new, `role` = 'member',
                               `joined_at` = IF(v_new = 'active', UTC_TIMESTAMP(), NULL)
                         WHERE `user_id` = p_user_id AND `group_id` = p_group_id;
                        UPDATE `groups` SET `member_count` = (
                            SELECT COUNT(*) FROM `group_memberships`
                             WHERE `group_id` = p_group_id AND `status` = 'active')
                         WHERE `id` = p_group_id;
                        COMMIT;
                        SELECT 'rejoined' AS result, v_new AS status;
                    -- v_max > 0 guards against a legacy 0 sneaking back in.
                    ELSEIF v_max IS NOT NULL AND v_max > 0 AND v_count >= v_max THEN
                        SELECT 'full' AS result, NULL AS status;
                    ELSE
                        SET v_new = IF(v_join = 'open', 'active', 'pending');
                        START TRANSACTION;
                        INSERT INTO `group_memberships` (`id`,`user_id`,`group_id`,`role`,`status`,`joined_at`)
                        VALUES (UUID(), p_user_id, p_group_id, 'member', v_new,
                                IF(v_new = 'active', UTC_TIMESTAMP(), NULL));
                        UPDATE `groups` SET `member_count` = (
                            SELECT COUNT(*) FROM `group_memberships`
                             WHERE `group_id` = p_group_id AND `status` = 'active')
                         WHERE `id` = p_group_id;
                        COMMIT;
                        SELECT 'joined' AS result, v_new AS status;
                    END IF;
                END IF;
            END
        """))
        db.session.commit()

        print(f"group capacity fix complete: {zeroed} cap(s) un-stuck, "
              f"{drifted} counter(s) re-synced, join procedure rebuilt")


if __name__ == "__main__":
    main()
