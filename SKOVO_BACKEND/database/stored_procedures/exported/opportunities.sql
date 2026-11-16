-- SKOVO — opportunities procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_opp_shortlist_add`$$
CREATE PROCEDURE `sp_opp_shortlist_add`(IN `p_id` char(36), IN `p_user` char(36), IN `p_opp` char(36))
BEGIN
      IF EXISTS (SELECT 1 FROM opportunity_shortlist
                  WHERE user_id = p_user AND opportunity_id = p_opp) THEN
        SELECT 0 AS added, 'already' AS result;
      ELSE
        INSERT INTO opportunity_shortlist (id, user_id, opportunity_id)
        VALUES (p_id, p_user, p_opp);
        SELECT 1 AS added, 'saved' AS result;
      END IF;
    END$$

DROP PROCEDURE IF EXISTS `sp_opp_shortlist_ids`$$
CREATE PROCEDURE `sp_opp_shortlist_ids`(IN `p_user` char(36))
BEGIN
      SELECT opportunity_id FROM opportunity_shortlist WHERE user_id = p_user;
    END$$

DROP PROCEDURE IF EXISTS `sp_opp_shortlist_list`$$
CREATE PROCEDURE `sp_opp_shortlist_list`(IN `p_user` char(36))
BEGIN
      SELECT o.*, sl.created_at AS saved_at
        FROM opportunity_shortlist sl
        JOIN opportunities o ON o.id = sl.opportunity_id
       WHERE sl.user_id = p_user
       ORDER BY sl.created_at DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_opp_shortlist_remove`$$
CREATE PROCEDURE `sp_opp_shortlist_remove`(IN `p_user` char(36), IN `p_opp` char(36))
BEGIN
      DELETE FROM opportunity_shortlist WHERE user_id = p_user AND opportunity_id = p_opp;
      SELECT ROW_COUNT() AS removed;
    END$$

DELIMITER ;
