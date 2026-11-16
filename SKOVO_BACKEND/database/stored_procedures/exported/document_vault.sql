-- SKOVO — document vault procedures.
--
-- Exported from the live schema by export_missing_procedures.py. These were
-- applied to the database by hand and never written back to source, so a
-- rebuild from this repo produced a database missing them.
--
-- Edit here, not in the database.

DELIMITER $$

DROP PROCEDURE IF EXISTS `sp_docvault_set_public`$$
CREATE PROCEDURE `sp_docvault_set_public`(IN `p_id` char(36), IN `p_user` char(36), IN `p_public` tinyint)
BEGIN
      UPDATE document_vault SET is_public = p_public
       WHERE id = p_id AND user_id = p_user;
      SELECT ROW_COUNT() AS updated;
    END$$

DROP PROCEDURE IF EXISTS `sp_public_profile_by_slug`$$
CREATE PROCEDURE `sp_public_profile_by_slug`(IN `p_slug` varchar(64))
BEGIN
      SELECT p.slug, p.headline, u.full_name, u.avatar_url, u.id AS user_id,
             IFNULL(rs.score, 0) AS score, rs.level
        FROM public_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN readiness_scores rs ON rs.user_id = p.user_id
       WHERE p.slug = p_slug AND p.is_enabled = 1 AND u.status = 'active';
    END$$

DROP PROCEDURE IF EXISTS `sp_public_profile_documents`$$
CREATE PROCEDURE `sp_public_profile_documents`(IN `p_user` char(36))
BEGIN
      SELECT id, name, category, file_url, created_at
        FROM document_vault
       WHERE user_id = p_user AND is_public = 1
       ORDER BY created_at DESC;
    END$$

DROP PROCEDURE IF EXISTS `sp_public_profile_get`$$
CREATE PROCEDURE `sp_public_profile_get`(IN `p_user` char(36))
BEGIN
      SELECT * FROM public_profiles WHERE user_id = p_user;
    END$$

DROP PROCEDURE IF EXISTS `sp_public_profile_upsert`$$
CREATE PROCEDURE `sp_public_profile_upsert`(IN `p_user` char(36), IN `p_slug` varchar(64), IN `p_headline` varchar(160), IN `p_enabled` tinyint)
BEGIN
      INSERT INTO public_profiles (user_id, slug, headline, is_enabled)
      VALUES (p_user, p_slug, p_headline, p_enabled)
      ON DUPLICATE KEY UPDATE slug = VALUES(slug), headline = VALUES(headline),
                              is_enabled = VALUES(is_enabled);
      SELECT * FROM public_profiles WHERE user_id = p_user;
    END$$

DELIMITER ;
