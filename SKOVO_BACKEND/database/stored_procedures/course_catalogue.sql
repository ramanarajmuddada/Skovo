-- ============================================================
-- SKOVO stored procedures: course_catalogue
-- ============================================================
-- One searchable row per course, carrying degree_category / degree / branch.
-- Onboarding searches it; the profile stores the three columns off the chosen
-- row; achiever audience targeting picks from the same list.
-- ============================================================

DELIMITER $$

-- Tokens, not one string: a student typing "btech cs" means B.Tech AND CSE, and
-- those two words are nowhere adjacent in the text. The caller splits the query
-- and passes up to five tokens, each of which must match. (Fulltext is not an
-- option here — its default minimum token length would drop "cs", "it", "ai"
-- and "ca", which are exactly the searches that matter.)
DROP PROCEDURE IF EXISTS `sp_course_catalogue_search`$$
CREATE PROCEDURE `sp_course_catalogue_search`(
    IN p_t1 VARCHAR(60), IN p_t2 VARCHAR(60), IN p_t3 VARCHAR(60),
    IN p_t4 VARCHAR(60), IN p_t5 VARCHAR(60),
    IN p_level VARCHAR(20), IN p_limit INT
)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 25; END IF;

    SELECT `id`, `level`, `degree_category`, `degree`, `branch`,
           `display_name`, `duration_years`
      FROM `course_catalogue`
     WHERE `is_active` = 1
       AND (p_level IS NULL OR p_level = '' OR `level` = p_level)
       -- Each token must start a word. A plain '%cs%' would match "electronics",
       -- so "btech cs" would drag in every ECE and EEE row.
       AND (p_t1 IS NULL OR p_t1 = '' OR `search_text` LIKE CONCAT(p_t1, '%') OR `search_text` LIKE CONCAT('% ', p_t1, '%'))
       AND (p_t2 IS NULL OR p_t2 = '' OR `search_text` LIKE CONCAT(p_t2, '%') OR `search_text` LIKE CONCAT('% ', p_t2, '%'))
       AND (p_t3 IS NULL OR p_t3 = '' OR `search_text` LIKE CONCAT(p_t3, '%') OR `search_text` LIKE CONCAT('% ', p_t3, '%'))
       AND (p_t4 IS NULL OR p_t4 = '' OR `search_text` LIKE CONCAT(p_t4, '%') OR `search_text` LIKE CONCAT('% ', p_t4, '%'))
       AND (p_t5 IS NULL OR p_t5 = '' OR `search_text` LIKE CONCAT(p_t5, '%') OR `search_text` LIKE CONCAT('% ', p_t5, '%'))
     ORDER BY
           -- Exact degree match first, then a prefix hit, then everything else.
           (LOWER(`degree`) = p_t1) DESC,
           (`search_text` LIKE CONCAT(p_t1, '%')) DESC,
           `sort_order`, `display_name`
     LIMIT p_limit;
END$$

-- Distinct degree categories for a level — the coarse filter chips above the
-- search box, and the list audience targeting offers.
DROP PROCEDURE IF EXISTS `sp_course_categories_by_level`$$
CREATE PROCEDURE `sp_course_categories_by_level`(IN p_level VARCHAR(20))
BEGIN
    SELECT `degree_category`, COUNT(*) AS `course_count`, MIN(`sort_order`) AS `sort_order`
      FROM `course_catalogue`
     WHERE `is_active` = 1
       AND (p_level IS NULL OR p_level = '' OR `level` = p_level)
     GROUP BY `degree_category`
     ORDER BY `sort_order`, `degree_category`;
END$$

DROP PROCEDURE IF EXISTS `sp_course_catalogue_list`$$
CREATE PROCEDURE `sp_course_catalogue_list`(
    IN p_level VARCHAR(20), IN p_limit INT, IN p_offset INT, IN p_only_active TINYINT
)
BEGIN
    IF p_limit IS NULL OR p_limit <= 0 THEN SET p_limit = 100; END IF;
    IF p_offset IS NULL OR p_offset < 0 THEN SET p_offset = 0; END IF;
    SELECT * FROM `course_catalogue`
     WHERE (p_only_active = 0 OR `is_active` = 1)
       AND (p_level IS NULL OR p_level = '' OR `level` = p_level)
     ORDER BY `level`, `sort_order`, `display_name`
     LIMIT p_limit OFFSET p_offset;
END$$

DELIMITER ;
