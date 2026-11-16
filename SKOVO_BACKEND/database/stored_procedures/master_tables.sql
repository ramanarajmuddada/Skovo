-- SKOVO — one master table per dropdown
--
-- Every dropdown now has its own `master_<type>` table instead of sharing one
-- `masters` table keyed by a `type` column. That is 123 tables, so writing five
-- CRUD procedures per table would mean 610 near-identical procedures to keep in
-- step. These five do the same job over any of them.
--
-- The table name is never taken from the caller. It is looked up in
-- `master_registry`, so a request for a type that is not registered resolves to
-- nothing and the procedure exits — `?types=x; DROP TABLE users` finds no row
-- and never reaches PREPARE. That lookup is the whole safety model here; do not
-- "simplify" it by concatenating p_type into the SQL.
--
-- sp_master_types  / sp_master_list / sp_master_get
-- sp_master_create / sp_master_update / sp_master_delete

DELIMITER $$

-- ── every registered dropdown, for the admin master-data screen ──────────────
DROP PROCEDURE IF EXISTS `sp_master_types`$$
CREATE PROCEDURE `sp_master_types`()
BEGIN
    SELECT `type`, `table_name`, `label`, `is_active`
      FROM `master_registry`
     WHERE `is_active` = 1
     ORDER BY `label`;
END$$


-- ── one dropdown's options ───────────────────────────────────────────────────
-- p_active_only = 1 hides retired options from students while the admin screen
-- (0) still sees them, so an option can be withdrawn without deleting history.
--
-- A handful of tables (e.g. master_entrance_exam) carry an extra
-- `education_level` column — a comma-separated list of onboarding_category
-- values saying which stages the option applies to (NULL = every stage). Most
-- master_<type> tables do not have it, so this checks information_schema first
-- and only adds the column to the SELECT list when it is actually there —
-- one generic procedure stays correct for both shapes instead of forking it
-- per table.
DROP PROCEDURE IF EXISTS `sp_master_list`$$
CREATE PROCEDURE `sp_master_list`(IN p_type VARCHAR(64), IN p_active_only TINYINT)
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;
    DECLARE v_has_level INT DEFAULT 0;

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NOT NULL THEN
        SELECT COUNT(*) INTO v_has_level
          FROM `information_schema`.`COLUMNS`
         WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = v_table
           AND `COLUMN_NAME` = 'education_level';

        SET @sql = CONCAT(
            'SELECT `id`, `value`, `label`, `sort_order`, `is_active`',
            IF(v_has_level > 0, ', `education_level`', ''),
            ' FROM `', v_table, '`',
            IF(p_active_only = 1, ' WHERE `is_active` = 1', ''),
            ' ORDER BY `sort_order`, `label`');
        PREPARE stmt FROM @sql;
        EXECUTE stmt;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$


-- ── one option by id ─────────────────────────────────────────────────────────
DROP PROCEDURE IF EXISTS `sp_master_get`$$
CREATE PROCEDURE `sp_master_get`(IN p_type VARCHAR(64), IN p_id CHAR(36))
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NOT NULL THEN
        SET @sql = CONCAT('SELECT `id`, `value`, `label`, `sort_order`, `is_active` FROM `',
                          v_table, '` WHERE `id` = ? LIMIT 1');
        SET @p_id = p_id;
        PREPARE stmt FROM @sql;
        EXECUTE stmt USING @p_id;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$


-- ── add an option ────────────────────────────────────────────────────────────
-- Returns `result` so the route can tell a duplicate from an unknown type
-- without a second round trip.
DROP PROCEDURE IF EXISTS `sp_master_create`$$
CREATE PROCEDURE `sp_master_create`(
    IN p_type VARCHAR(64), IN p_id CHAR(36),
    IN p_value VARCHAR(100), IN p_label VARCHAR(150),
    IN p_sort_order INT, IN p_actor CHAR(36))
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;
    DECLARE v_exists INT DEFAULT 0;

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NULL THEN
        SELECT 'unknown_type' AS `result`, NULL AS `id`;
    ELSE
        SET @sql = CONCAT('SELECT COUNT(*) INTO @dup FROM `', v_table, '` WHERE `value` = ?');
        SET @p_value = p_value;
        PREPARE stmt FROM @sql;
        EXECUTE stmt USING @p_value;
        DEALLOCATE PREPARE stmt;
        SET v_exists = @dup;

        IF v_exists > 0 THEN
            SELECT 'duplicate' AS `result`, NULL AS `id`;
        ELSE
            SET @sql = CONCAT('INSERT INTO `', v_table,
                '` (`id`,`value`,`label`,`sort_order`,`is_active`,`created_by`,`updated_by`) ',
                'VALUES (?,?,?,?,1,?,?)');
            SET @p_id = p_id; SET @p_label = p_label;
            SET @p_sort = IFNULL(p_sort_order, 0); SET @p_actor = p_actor;
            PREPARE stmt FROM @sql;
            EXECUTE stmt USING @p_id, @p_value, @p_label, @p_sort, @p_actor, @p_actor;
            DEALLOCATE PREPARE stmt;
            SELECT 'ok' AS `result`, p_id AS `id`;
        END IF;
    END IF;
END$$


-- ── edit an option ───────────────────────────────────────────────────────────
-- NULL means "leave alone" on every field, so the route can send a partial edit.
DROP PROCEDURE IF EXISTS `sp_master_update`$$
CREATE PROCEDURE `sp_master_update`(
    IN p_type VARCHAR(64), IN p_id CHAR(36),
    IN p_value VARCHAR(100), IN p_label VARCHAR(150),
    IN p_sort_order INT, IN p_is_active TINYINT, IN p_actor CHAR(36))
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NULL THEN
        SELECT 'unknown_type' AS `result`;
    ELSE
        SET @sql = CONCAT('UPDATE `', v_table, '` SET ',
            '`value` = IFNULL(?, `value`), ',
            '`label` = IFNULL(?, `label`), ',
            '`sort_order` = IFNULL(?, `sort_order`), ',
            '`is_active` = IFNULL(?, `is_active`), ',
            '`updated_by` = ? WHERE `id` = ?');
        SET @p_value = p_value; SET @p_label = p_label;
        SET @p_sort = p_sort_order; SET @p_active = p_is_active;
        SET @p_actor = p_actor; SET @p_id = p_id;
        PREPARE stmt FROM @sql;
        EXECUTE stmt USING @p_value, @p_label, @p_sort, @p_active, @p_actor, @p_id;
        -- Capture before DEALLOCATE: ROW_COUNT() reflects the most recent
        -- statement, and DEALLOCATE PREPARE is itself a statement — reading it
        -- afterwards reported 'notfound' on updates that had actually applied.
        SET @affected = ROW_COUNT();
        DEALLOCATE PREPARE stmt;
        SELECT IF(@affected > 0, 'ok', 'notfound') AS `result`;
    END IF;
END$$


-- ── remove an option ─────────────────────────────────────────────────────────
-- A hard delete: these rows carry no history of their own, and profiles store
-- the `value` string rather than a foreign key to this row.
DROP PROCEDURE IF EXISTS `sp_master_delete`$$
CREATE PROCEDURE `sp_master_delete`(IN p_type VARCHAR(64), IN p_id CHAR(36))
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NULL THEN
        SELECT 'unknown_type' AS `result`;
    ELSE
        SET @sql = CONCAT('DELETE FROM `', v_table, '` WHERE `id` = ?');
        SET @p_id = p_id;
        PREPARE stmt FROM @sql;
        EXECUTE stmt USING @p_id;
        SET @affected = ROW_COUNT();      -- see sp_master_update
        DEALLOCATE PREPARE stmt;
        SELECT IF(@affected > 0, 'ok', 'notfound') AS `result`;
    END IF;
END$$

DELIMITER ;

-- ── one dropdown's options, filtered in the DATABASE ────────────────────────
-- Every dropdown searches server-side (founder call), so this is the query
-- behind all of them. Prefix matches sort first: typing "tel" surfaces
-- Telangana ahead of anything that merely contains those letters, which is the
-- same ranking the client-side filter used.
DROP PROCEDURE IF EXISTS `sp_master_search`$$
CREATE PROCEDURE `sp_master_search`(
    IN p_type  VARCHAR(64),
    IN p_q     VARCHAR(200),
    IN p_limit INT
)
BEGIN
    DECLARE v_table VARCHAR(80) DEFAULT NULL;
    DECLARE v_has_level INT DEFAULT 0;
    DECLARE v_q VARCHAR(200);

    IF p_limit IS NULL OR p_limit <= 0 OR p_limit > 200 THEN SET p_limit = 50; END IF;
    SET v_q = TRIM(IFNULL(p_q, ''));

    SELECT `table_name` INTO v_table
      FROM `master_registry`
     WHERE `type` = p_type AND `is_active` = 1
     LIMIT 1;

    IF v_table IS NOT NULL THEN
        SELECT COUNT(*) INTO v_has_level
          FROM `information_schema`.`COLUMNS`
         WHERE `TABLE_SCHEMA` = DATABASE() AND `TABLE_NAME` = v_table
           AND `COLUMN_NAME` = 'education_level';

        SET @q    = v_q;
        SET @lim  = p_limit;
        SET @like = CONCAT('%', v_q, '%');
        SET @pre  = CONCAT(v_q, '%');

        SET @sql = CONCAT(
            'SELECT `id`, `value`, `label`, `sort_order`, `is_active`',
            IF(v_has_level > 0, ', `education_level`', ''),
            ' FROM `', v_table, '`',
            ' WHERE `is_active` = 1',
            IF(v_q = '', '', ' AND (`label` LIKE ? OR `value` LIKE ?)'),
            ' ORDER BY ',
            IF(v_q = '', '', 'CASE WHEN `label` LIKE ? THEN 0 ELSE 1 END, '),
            '`sort_order`, `label` LIMIT ?');

        PREPARE stmt FROM @sql;
        IF v_q = '' THEN
            EXECUTE stmt USING @lim;
        ELSE
            EXECUTE stmt USING @like, @like, @pre, @lim;
        END IF;
        DEALLOCATE PREPARE stmt;
    END IF;
END$$
