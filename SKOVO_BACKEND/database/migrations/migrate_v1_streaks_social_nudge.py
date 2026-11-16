"""
Migration: nudges, today's status and the evening alert for buddy & group streaks.

Sorts after migrate_v1_streaks_social.py (it redefines sp_buddy_list and
sp_group_list from there and from migrate_v1_streaks.py).

  * streak_nudges + sp_streak_nudge — "👋 Nudge" a buddy or group member who
    has not acted today. Once per person per day, and only between students
    who share an active pair or group.
  * sp_buddy_list / sp_group_list now say, per partner, whether they acted
    today and whether you already nudged them — the ✅ / ⏳ on the Streak page.
  * sp_social_risk_candidates — at the admin's reminder hour, everyone in a
    live pair or group who has not acted yet gets "your shared streak breaks
    at midnight".

Idempotent.
    venv/Scripts/python.exe database/migrations/migrate_v1_streaks_social_nudge.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

TABLE = """CREATE TABLE IF NOT EXISTS `streak_nudges` (
  `from_user`  CHAR(36) NOT NULL,
  `to_user`    CHAR(36) NOT NULL,
  `day`        DATE     NOT NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`from_user`, `to_user`, `day`),
  KEY `ix_streak_nudges_to` (`to_user`, `day`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"""

ACTED = "EXISTS (SELECT 1 FROM streak_days d WHERE d.user_id = {u} AND d.day = p_day AND d.kind = 'action')"

PROCS = {
'sp_buddy_list': """
CREATE PROCEDURE `sp_buddy_list`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  SELECT b.*, IF(b.user_a = p_user, b.user_b, b.user_a) AS buddy_id,
         u.full_name AS buddy_name, u.avatar_url AS buddy_avatar,
         """ + ACTED.format(u='IF(b.user_a = p_user, b.user_b, b.user_a)') + """ AS buddy_done_today,
         EXISTS (SELECT 1 FROM streak_nudges n WHERE n.from_user = p_user
                  AND n.to_user = IF(b.user_a = p_user, b.user_b, b.user_a) AND n.day = p_day) AS nudged_today
    FROM buddy_streaks b
    LEFT JOIN users u ON u.id = IF(b.user_a = p_user, b.user_b, b.user_a)
   WHERE (b.user_a = p_user OR b.user_b = p_user) AND b.status IN ('pending', 'active')
   ORDER BY b.status = 'active' DESC, b.current DESC;
END""",

'sp_group_list': """
CREATE PROCEDURE `sp_group_list`(IN p_user CHAR(36), IN p_day DATE)
BEGIN
  SELECT g.id, g.name, g.invite_code, g.status, g.current, g.best, g.created_by,
         m.user_id, u.full_name,
         """ + ACTED.format(u='m.user_id') + """ AS done_today,
         EXISTS (SELECT 1 FROM streak_nudges n WHERE n.from_user = p_user
                  AND n.to_user = m.user_id AND n.day = p_day) AS nudged_today
    FROM streak_groups g
    JOIN streak_group_members me ON me.group_id = g.id AND me.user_id = p_user AND me.left_at IS NULL
    JOIN streak_group_members m  ON m.group_id = g.id AND m.left_at IS NULL
    LEFT JOIN users u ON u.id = m.user_id
   WHERE g.status IN ('forming','active')
   ORDER BY g.created_at, m.joined_at;
END""",

'sp_streak_nudge': """
CREATE PROCEDURE `sp_streak_nudge`(IN p_from CHAR(36), IN p_to CHAR(36), IN p_day DATE)
proc: BEGIN
  IF p_from = p_to THEN SELECT 'self' AS result; LEAVE proc; END IF;
  -- Only partners: an active pair, or members of the same live group.
  IF NOT EXISTS (SELECT 1 FROM buddy_streaks b WHERE b.status = 'active'
                  AND ((b.user_a = p_from AND b.user_b = p_to) OR (b.user_a = p_to AND b.user_b = p_from)))
     AND NOT EXISTS (SELECT 1 FROM streak_group_members a
                       JOIN streak_group_members c ON c.group_id = a.group_id
                       JOIN streak_groups g ON g.id = a.group_id
                      WHERE a.user_id = p_from AND c.user_id = p_to
                        AND a.left_at IS NULL AND c.left_at IS NULL
                        AND g.status IN ('forming','active')) THEN
    SELECT 'not_partners' AS result; LEAVE proc;
  END IF;
  IF """ + ACTED.format(u='p_to') + """ THEN SELECT 'already_done' AS result; LEAVE proc; END IF;
  INSERT IGNORE INTO streak_nudges (from_user, to_user, day) VALUES (p_from, p_to, p_day);
  SELECT IF(ROW_COUNT() > 0, 'sent', 'already_nudged') AS result,
         (SELECT full_name FROM users WHERE id = p_from) AS from_name;
END""",

'sp_social_risk_candidates': """
CREATE PROCEDURE `sp_social_risk_candidates`(IN p_day DATE)
BEGIN
  -- Members of a live pair or group (current > 0) who have not acted today.
  SELECT b.user_a AS user_id, 'pair' AS kind, b.current,
         (SELECT full_name FROM users WHERE id = b.user_b) AS with_name
    FROM buddy_streaks b
   WHERE b.status = 'active' AND b.current > 0 AND NOT """ + ACTED.format(u='b.user_a') + """
  UNION ALL
  SELECT b.user_b, 'pair', b.current, (SELECT full_name FROM users WHERE id = b.user_a)
    FROM buddy_streaks b
   WHERE b.status = 'active' AND b.current > 0 AND NOT """ + ACTED.format(u='b.user_b') + """
  UNION ALL
  SELECT m.user_id, 'group', g.current, g.name
    FROM streak_groups g JOIN streak_group_members m ON m.group_id = g.id AND m.left_at IS NULL
   WHERE g.status = 'active' AND g.current > 0 AND NOT """ + ACTED.format(u='m.user_id') + """;
END""",
}


def main():
    with app.app_context():
        db.session.execute(text(TABLE))
        for name, body in PROCS.items():
            db.session.execute(text(f'DROP PROCEDURE IF EXISTS `{name}`'))
            db.session.execute(text(body))
        db.session.commit()
        print('nudges & evening alert ready')


if __name__ == '__main__':
    main()
