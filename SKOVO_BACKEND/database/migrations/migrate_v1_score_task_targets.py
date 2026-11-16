"""Score Engine > Tasks: target a task at courses, branches and Inter streams.

WHAT CHANGES
    score_tasks.target_degrees   comma list of course_catalogue.degree labels
    score_tasks.target_branches  comma list of course_catalogue.branch labels
    score_tasks.target_streams   comma list of streams.canonical (Inter MPC/BiPC...)
                                 Each NULL/empty = no restriction. Matched against
                                 user_profiles.degree_type / branch / stream, which
                                 onboarding fills from the same catalogue and
                                 streams tables -- so the course catalogue (Admin >
                                 Course Catalogue) is the branch master.
    sp_score_task_set_targets    sets state + the three lists in one call
    sp_score_task_target_options states, streams, catalogue degrees and branches
                                 for the admin pickers
    sp_score_tasks_for_student,
    sp_score_task_list           re-applied from stored_procedures/score_tasks.sql

Why lists on the task rather than more batches: a batch is one audience
(education category + one degree, unique), but one readiness-sheet row can be
for several courses at once, e.g. "B.Pharm / Pharm.D / D.Pharm".

Run after migrate_v1_score_task_state.py. Additive, idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_score_task_targets.py
"""
import os
import re

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SQL_FILE = os.path.join(os.path.dirname(__file__), '..', 'stored_procedures', 'score_tasks.sql')

COLUMNS = [
    ('target_degrees', 'VARCHAR(500) NULL'),
    ('target_branches', 'VARCHAR(1000) NULL'),
    ('target_streams', 'VARCHAR(255) NULL'),
]

SET_TARGETS = """
CREATE PROCEDURE `sp_score_task_set_targets`(
    IN p_id CHAR(36), IN p_state VARCHAR(60),
    IN p_degrees VARCHAR(500), IN p_branches VARCHAR(1000), IN p_streams VARCHAR(255))
BEGIN
  UPDATE `score_tasks`
     SET `state`           = NULLIF(TRIM(p_state), ''),
         `target_degrees`  = NULLIF(TRIM(p_degrees), ''),
         `target_branches` = NULLIF(TRIM(p_branches), ''),
         `target_streams`  = NULLIF(TRIM(p_streams), '')
   WHERE `id` = p_id;
END"""


# Everything the admin Tasks tab offers when targeting a task, from the masters
# the profile is filled from -- so a target can only be something a student can have.
TARGET_OPTIONS = """
CREATE PROCEDURE `sp_score_task_target_options`()
BEGIN
  SELECT 'state' AS kind, `value`, `label`, NULL AS parent
    FROM `master_indian_state` WHERE `is_active` = 1
  UNION ALL
  SELECT 'stream', `canonical`, MIN(`label`), NULL
    FROM `streams` WHERE `is_active` = 1 GROUP BY `canonical`
  UNION ALL
  SELECT 'degree', `degree`, `degree`, MIN(`level`)
    FROM `course_catalogue` WHERE `is_active` = 1 AND `degree` IS NOT NULL AND `degree` <> ''
   GROUP BY `degree`
  UNION ALL
  SELECT 'branch', `branch`, `branch`, `degree`
    FROM `course_catalogue` WHERE `is_active` = 1 AND `branch` IS NOT NULL AND `branch` <> ''
   GROUP BY `degree`, `branch`
  ORDER BY kind, parent, label;
END"""


def from_sql_file(name):
    src = open(SQL_FILE, encoding='utf-8').read()
    m = re.search(r"(CREATE PROCEDURE `%s`.*?\nEND)\$\$" % name, src, re.S)
    if not m:
        raise SystemExit('%s not found in score_tasks.sql' % name)
    return m.group(1)


def main():
    with app.app_context():
        for col, ddl in COLUMNS:
            has = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'score_tasks' AND COLUMN_NAME = :c"), {'c': col}).scalar()
            if not has:
                db.session.execute(text(f"ALTER TABLE `score_tasks` ADD COLUMN `{col}` {ddl}"))
                print(f"  [ok] score_tasks.{col} added")
        for name, body in (('sp_score_task_set_targets', SET_TARGETS),
                           ('sp_score_task_target_options', TARGET_OPTIONS),
                           ('sp_score_tasks_for_student', from_sql_file('sp_score_tasks_for_student')),
                           ('sp_score_task_list', from_sql_file('sp_score_task_list'))):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body))
            print(f"  [ok] {name}")
        db.session.commit()
        print("Done.")


if __name__ == '__main__':
    main()
