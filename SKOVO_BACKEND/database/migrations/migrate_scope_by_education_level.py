"""
Migration: scope exam options to the selected education level, and retire
four onboarding stages that are no longer offered.

Two independent changes:

1. Retire onboarding categories. `master_onboarding_category` keeps the row
   (history matters — a student who already picked "PG Student" keeps a valid
   profile) but flips it inactive, so it stops appearing in the picker. Same
   treatment for the one medical career interest.

       professional_course  ("CA / CS / CMA / CFA")
       pg                   ("PG Student")
       phd                  ("PhD / Research")
       working               ("Working Professional")
       career_interest: "Medicine & Healthcare"

2. Tag `master_entrance_exam` rows with which onboarding stage(s) they apply
   to, so "What are you preparing for?" can filter instead of always showing
   all 37 national entrance exams to every stage (a 10th-grader was seeing
   GATE and UGC NET next to JEE). Adds a nullable `education_level` column —
   a comma-separated list of onboarding_category values, NULL meaning "shown
   to every stage" (used for the literal 'Other' row). `sp_master_list`
   (database/stored_procedures/master_tables.sql) already knows how to surface
   this column generically when it exists; this migration is what makes it
   exist and backfills it. The frontend then filters client-side against the
   list — see TARGET_EXAM_TYPES / the education_level check in
   OnboardingModal.jsx and EducationGoals.jsx.

   The category-to-stage mapping below is an editorial call (which exam
   "belongs" to which stage), not something derivable from existing data —
   review it against SKOVO's own guidance content before trusting it blindly.
   It lives in a real column now, so correcting it later is an UPDATE, not a
   frontend deploy.

Idempotent — safe to re-run. Run from SKOVO_BACKEND:
    python database/migrations/migrate_scope_by_education_level.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

RETIRE_ONBOARDING_CATEGORY = ['professional_course', 'pg', 'phd', 'working']
RETIRE_CAREER_INTEREST = ['Medicine & Healthcare']

# exam value -> comma list of onboarding_category values it should be offered to.
# Exams not listed here (e.g. a future addition) default to NULL — shown to all,
# same as today's behaviour, so nothing new goes silently missing.
ENTRANCE_EXAM_LEVELS = {
    'JEE Main':      'school_11th,school_12th,dropper',
    'JEE Advanced':  'school_12th,dropper',
    'NEET UG':       'school_11th,school_12th,dropper',
    'CUET UG':       'school_12th,dropper',
    'CUET':          'school_12th,dropper',
    'BITSAT':        'school_12th,dropper',
    'VITEEE':        'school_12th,dropper',
    'SRMJEEE':       'school_12th,dropper',
    'NATA':          'school_12th,dropper',
    'UCEED':         'school_12th,dropper',
    'NIFT':          'school_12th,dropper',
    'NID':           'school_12th,dropper',
    'CLAT':          'school_12th,dropper',
    'AILET':         'school_12th,dropper',
    'ICAR AIEEA':    'school_12th,dropper',
    'NDA Exam':      'school_11th,school_12th,dropper',
    # PG-entry — taken by UG students (finishing degree or already graduated).
    'NEET PG':       'ug',
    'CUET PG':       'ug',
    'GATE':          'ug',
    'CAT':           'ug',
    'XAT':           'ug',
    'MAT':           'ug',
    'CMAT':          'ug',
    'SNAP':          'ug',
    'NMAT':          'ug',
    'IIFT':          'ug',
    'TISSNET':       'ug',
    'GMAT':          'ug',
    'IIT JAM':       'ug',
    'CEED':          'ug',
    'INI CET':       'ug',
    'NEET MDS':      'ug',
    'CDS':           'ug',
    'AFCAT':         'ug',
    # Research / doctoral entry.
    'UGC NET':       'pg,phd',
    'CSIR NET':      'pg,phd',
    # 'Other' intentionally absent — always shown, at every stage.
}


def column_exists(conn, table, column):
    return bool(conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar())


def main():
    with app.app_context():
        conn = db.session.connection()

        # 1. Retire onboarding categories + the medical career interest.
        res = conn.execute(
            text("UPDATE `master_onboarding_category` SET `is_active` = 0 "
                 "WHERE `value` IN :vals").bindparams(db.bindparam('vals', expanding=True)),
            {'vals': RETIRE_ONBOARDING_CATEGORY},
        )
        print(f'onboarding_category: deactivated {res.rowcount} row(s)')

        res = conn.execute(
            text("UPDATE `master_career_interest` SET `is_active` = 0 "
                 "WHERE `value` IN :vals").bindparams(db.bindparam('vals', expanding=True)),
            {'vals': RETIRE_CAREER_INTEREST},
        )
        print(f'career_interest: deactivated {res.rowcount} row(s)')

        # 2. Tag entrance exams with the stage(s) they apply to.
        if not column_exists(conn, 'master_entrance_exam', 'education_level'):
            conn.execute(text(
                "ALTER TABLE `master_entrance_exam` "
                "ADD COLUMN `education_level` VARCHAR(255) NULL "
                "COMMENT 'comma-separated onboarding_category values; NULL = all stages' "
                "AFTER `label`"
            ))
            print('master_entrance_exam: added education_level column')
        else:
            print('master_entrance_exam: education_level column already exists')

        tagged = 0
        for value, levels in ENTRANCE_EXAM_LEVELS.items():
            res = conn.execute(text(
                "UPDATE `master_entrance_exam` SET `education_level` = :lv WHERE `value` = :v"
            ), {'lv': levels, 'v': value})
            tagged += res.rowcount
        print(f'master_entrance_exam: tagged {tagged} row(s)')

        untagged = conn.execute(text(
            "SELECT `value` FROM `master_entrance_exam` "
            "WHERE `education_level` IS NULL AND `is_active` = 1"
        )).scalars().all()
        print(f'master_entrance_exam: {len(untagged)} row(s) left untagged (shown to all stages): {untagged}')

        db.session.commit()

        # 3. Re-deploy sp_master_list so it starts returning education_level —
        #    keep this in sync with database/stored_procedures/master_tables.sql.
        # A fresh db.session.execute (not the `conn` grabbed at the top) — that
        # connection was invalidated by the commit() above.
        db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_master_list`"))
        db.session.execute(text("""
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
            END
        """))
        db.session.commit()
        print('sp_master_list: redeployed with education_level support')


if __name__ == '__main__':
    main()
