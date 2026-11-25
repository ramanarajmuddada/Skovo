-- Readiness level bands: the badge a student wears for their score.
--
-- This table is read by portal/helpers/helpers.py (compute_readiness_level,
-- readiness_level_gates), the Readiness Rules admin screen and the score stored
-- procedures, and written by the admin screen -- but nothing in the repository
-- created it. A database built from the repo therefore had no such table, every
-- score migration that touches levels failed, and the badge silently fell back
-- to hardcoded names. apply_all.py loads database/tables/*.sql before the
-- procedures and migrations, so this now exists first on a fresh install.
--
-- Safe to re-run: the table is IF NOT EXISTS and the three starting bands are
-- only inserted into an empty table, so an admin's edits are never overwritten.
CREATE TABLE IF NOT EXISTS `readiness_levels` (
  `id`          CHAR(36)     NOT NULL,
  `label`       VARCHAR(60)  NOT NULL,
  `min_score`   INT          NOT NULL DEFAULT 0,
  `sort_order`  INT          NOT NULL DEFAULT 0,
  `is_active`   TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_by`  CHAR(36)     NULL,
  `created_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_readiness_levels_active_score` (`is_active`, `min_score`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO `readiness_levels` (`id`, `label`, `min_score`, `sort_order`, `is_active`)
SELECT UUID(), v.label, v.min_score, v.sort_order, 1
  FROM (SELECT 'Explorer' AS label, 0  AS min_score, 10 AS sort_order
        UNION ALL SELECT 'Pioneer',  30, 20
        UNION ALL SELECT 'Achiever', 65, 30) AS v
 WHERE NOT EXISTS (SELECT 1 FROM `readiness_levels`);
