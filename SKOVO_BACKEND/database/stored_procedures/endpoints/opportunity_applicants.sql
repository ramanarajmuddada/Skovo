-- ============================================================
-- SKOVO — the applicant pipeline for one opportunity
-- ============================================================
--   sp_opportunity_applicants   GET /v1/skovo-platform-panel-admin/opportunities/<id>/applications
--
-- WHY THIS EXISTS
--   An admin could post a role and students could apply to it, and there was no
--   way — API or screen — to see who had. The applications were being collected
--   into a table nobody could read, which is worse than not collecting them:
--   the students believe someone is looking.
--
-- WHY IT IS A PROCEDURE RATHER THAN A PYTHON FILTER
--   The obvious first version read `sp_opportunity_applications_list(50000, 0)`
--   and filtered by opportunity in Python — the shape this codebase already
--   carries 101 times, and `tests/test_ui05_performance.py` pins that count so
--   the next one is caught the day it is written. It caught this one. That LIMIT
--   is a silent correctness ceiling as much as a cost: past it, an application
--   stops existing as far as the screen is concerned, and the applicant is never
--   told. One indexed join has no such ceiling.
--
--   It also folds in the per-applicant `sp_users_get` the route was making one
--   row at a time, so the endpoint is a single round trip whatever the pipeline
--   holds.

DELIMITER $$

-- ------------------------------------------------------------
-- Everyone who applied to one opportunity, newest first, with the name and
-- email an admin needs to act on the row.
--
-- Ordered by applied_at DESC with id ASC as the tie-break. The tie-break is not
-- decoration: two applications submitted in the same second are otherwise
-- ordered however the engine feels, and a list that reshuffles between reads is
-- one an admin cannot work down.
-- ------------------------------------------------------------
DROP PROCEDURE IF EXISTS `sp_opportunity_applicants`$$
CREATE PROCEDURE `sp_opportunity_applicants`(IN p_opportunity_id CHAR(36))
BEGIN
    SELECT
        oa.id,
        oa.user_id,
        oa.opportunity_id,
        oa.status,
        oa.cover_note,
        oa.resume_link,
        oa.applied_at,
        oa.status_updated_at,
        u.full_name,
        u.email
    FROM opportunity_applications oa
    -- LEFT JOIN, not INNER: a deleted student must not make their application
    -- vanish from the pipeline. The admin still needs to see that a row exists,
    -- with a blank name, rather than have the count quietly disagree with the list.
    LEFT JOIN users u ON u.id = oa.user_id
    WHERE oa.opportunity_id = p_opportunity_id
    ORDER BY oa.applied_at DESC, oa.id ASC;
END$$

-- The index the WHERE above needs. Without it this is a full scan of every
-- application on the platform to render one opportunity's list — the same cost
-- the Python filter had, just moved into SQL, which would be no fix at all.
--
-- Guarded because MySQL has no CREATE INDEX IF NOT EXISTS, and wrapped in a
-- throwaway PROCEDURE rather than written as bare `SET @sql := ...; PREPARE`
-- statements at file scope. The bare version worked when applied by hand and
-- FAILED every deploy: apply_all.py splits this file on the doubled-dollar
-- delimiter, so the `;` separating the two SET statements is not a boundary
-- and both arrive as one statement — errno 1064, and a deploy that reports
-- "FINISHED WITH ERRORS" for an index that is in fact already there. Keeping
-- the whole guard inside a single delimited block means the splitter sees
-- exactly one statement and the file is genuinely re-runnable.
--
-- NOTE, and this cost a second failed run: do not write the delimiter itself
-- anywhere in these comments. The splitter is a plain text split — it does not
-- skip comments — so a comment ABOUT the delimiter gets cut in half by it, and
-- the fragment is then sent to MySQL as SQL. Spell it out in words instead.
DROP PROCEDURE IF EXISTS `sp__ensure_idx_oa_opportunity`$$
CREATE PROCEDURE `sp__ensure_idx_oa_opportunity`()
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME  = 'opportunity_applications'
           AND INDEX_NAME  = 'idx_oa_opportunity'
    ) THEN
        CREATE INDEX idx_oa_opportunity
            ON opportunity_applications (opportunity_id, applied_at);
    END IF;
END$$

CALL `sp__ensure_idx_oa_opportunity`()$$

-- Leaves nothing behind: the helper exists only for the length of this file.
DROP PROCEDURE IF EXISTS `sp__ensure_idx_oa_opportunity`$$

DELIMITER ;
