"""Version 1 master data: Class 10 boards and the missing exams.

WHY
    feature-updates.md §12 gaps 10 and 23.

    * AP and Telangana Class 10 students could only pick BIEAP / TSBIE -- the
      Intermediate boards -- because no SSC board existed. A 10th-class student
      in Vizag had to call their board "Board of Intermediate Education".
    * Tasks and cohorts for sub-branches target exams that were not in the
      masters (NORCET, GPAT, AIBE, CA levels, RGUKT, DOST / OAMDC ...).

    Courses were NOT missing: course_catalogue (what onboarding searches)
    already carries nursing, AYUSH, allied health, agri, vet, B.Arch, BCA, BBA,
    law and the ITI trades. master_degree_type is the older list and is left
    alone.

WHAT CHANGES
    boards        + level VARCHAR(20) NOT NULL DEFAULT 'all'
                    'school' = Class 10 board, 'intermediate' = Inter board,
                    'all' = national boards that cover both.
                    BIEAP / TSBIE are marked 'intermediate'.
                  + BSEAP (AP SSC) and BSETS (Telangana SSC), level 'school'.
    streams       The SSC boards get the same groups as their state's Inter
                  board: for a 10th student the picker reads "Group you are
                  planning for 11th".
    sp_boards_for_state  also returns `level`, so screens can show SSC boards
                  to Class 10 and Inter boards to Class 11 / 12.
    master_entrance_exam, master_entrance_exam_ap, master_entrance_exam_ts
                  the missing exams, inactive rows untouched, existing rows
                  never duplicated.

Additive only. Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_v1_master_data.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SSC_BOARDS = [
    # code, name, state name, mirrors the streams of
    ('BSEAP', 'BSEAP — Board of Secondary Education, Andhra Pradesh (SSC)', 'Andhra Pradesh', 'BIEAP'),
    ('BSETS', 'BSE Telangana — Board of Secondary Education, Telangana (SSC)', 'Telangana', 'TSBIE'),
]

NATIONAL_EXAMS = [
    # value, label, education_level
    ('AIIMS NORCET', 'AIIMS NORCET (Nursing Officer)', 'ug'),
    ('GPAT', 'GPAT (M.Pharm entrance)', 'ug'),
    ('AIAPGET', 'AIAPGET (AYUSH PG)', 'ug'),
    ('AIBE', 'AIBE (All India Bar Exam)', 'ug'),
    ('IMU CET', 'IMU CET (Merchant Navy)', 'school_12th,dropper'),
    ('NCHM JEE', 'NCHM JEE (Hotel Management)', 'school_12th,dropper'),
    ('NIMCET', 'NIMCET (MCA)', 'ug'),
    ('UCEED', 'UCEED (Design)', 'school_12th,dropper'),
    ('IPMAT', 'IPMAT (IIM Indore / Rohtak)', 'school_12th,dropper'),
    ('KLEEE', 'KLEEE (KL University)', 'school_12th,dropper'),
    ('CA Foundation', 'CA Foundation', 'school_12th,professional_course'),
    ('CA Intermediate', 'CA Intermediate', 'professional_course,ug'),
    ('CA Final', 'CA Final', 'professional_course,ug'),
    ('CSEET', 'CSEET (Company Secretary)', 'school_12th,professional_course'),
    ('CS Executive', 'CS Executive', 'professional_course,ug'),
    ('CS Professional', 'CS Professional', 'professional_course,ug'),
    ('CMA Foundation', 'CMA Foundation', 'school_12th,professional_course'),
    ('CMA Intermediate', 'CMA Intermediate', 'professional_course,ug'),
    ('CMA Final', 'CMA Final', 'professional_course,ug'),
    ('NCLEX-RN', 'NCLEX-RN (Nursing, abroad)', 'ug'),
    ('OET', 'OET (Healthcare English, abroad)', 'ug'),
]

STATE_EXAMS = {
    'master_entrance_exam_ap': [
        ('APRJC CET', 'APRJC CET (Residential Junior Colleges)'),
        ('AP RGUKT IIIT', 'AP RGUKT IIIT admission (SSC marks)'),
        ('OAMDC', 'OAMDC (AP degree admissions)'),
    ],
    'master_entrance_exam_ts': [
        ('TSRJC CET', 'TSRJC CET (Residential Junior Colleges)'),
        ('TS RGUKT Basara', 'RGUKT Basara IIIT admission (SSC marks)'),
        ('DOST', 'DOST (Telangana degree admissions)'),
    ],
}


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def has_table(table):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t"), {'t': table}).scalar() > 0


def boards():
    if not has_column('boards', 'level'):
        db.session.execute(text(
            "ALTER TABLE `boards` ADD COLUMN `level` VARCHAR(20) NOT NULL DEFAULT 'all'"))
        print("  boards.level added")
    db.session.execute(text(
        "UPDATE boards SET level = 'intermediate' WHERE code IN ('BIEAP','TSBIE') AND level = 'all'"))

    for code, name, state_name, mirror in SSC_BOARDS:
        state_id = db.session.execute(text(
            "SELECT id FROM states WHERE name = :n LIMIT 1"), {'n': state_name}).scalar()
        if not state_id:
            print(f"  ! state '{state_name}' not found -- {code} skipped")
            continue
        board_id = db.session.execute(text(
            "SELECT id FROM boards WHERE code = :c"), {'c': code}).scalar()
        if board_id:
            print(f"  board {code} already there")
        else:
            board_id = str(uuid.uuid4())
            sort = db.session.execute(text(
                "SELECT IFNULL(MAX(sort_order), 0) + 1 FROM boards WHERE state_id = :s"),
                {'s': state_id}).scalar()
            db.session.execute(text(
                "INSERT INTO boards (id, code, name, state_id, is_national, sort_order, "
                "is_active, level, created_at) "
                "VALUES (:i, :c, :n, :s, 0, :o, 1, 'school', UTC_TIMESTAMP())"),
                {'i': board_id, 'c': code, 'n': name, 's': state_id, 'o': sort})
            print(f"  board {code} added")

        have = db.session.execute(text(
            "SELECT COUNT(*) FROM streams WHERE board_id = :b"), {'b': board_id}).scalar()
        if have:
            print(f"  {code} streams already there ({have})")
            continue
        src = db.session.execute(text(
            "SELECT st.canonical, st.label, st.short_label, st.sort_order "
            "  FROM streams st JOIN boards b ON b.id = st.board_id "
            " WHERE b.code = :m AND st.is_active = 1 ORDER BY st.sort_order"),
            {'m': mirror}).mappings().all()
        for s in src:
            db.session.execute(text(
                "INSERT INTO streams (id, board_id, canonical, label, short_label, sort_order, "
                "is_active, created_at) VALUES (:i, :b, :c, :l, :sl, :o, 1, UTC_TIMESTAMP())"),
                {'i': str(uuid.uuid4()), 'b': board_id, 'c': s['canonical'], 'l': s['label'],
                 'sl': s['short_label'], 'o': s['sort_order']})
        print(f"  {code} streams copied from {mirror}: {len(src)}")
    db.session.commit()

    db.session.execute(text("DROP PROCEDURE IF EXISTS `sp_boards_for_state`"))
    db.session.execute(text("""
CREATE PROCEDURE `sp_boards_for_state`(IN p_state_id CHAR(36))
BEGIN
    SELECT b.`id`, b.`code`, b.`name`, b.`state_id`, b.`is_national`, b.`sort_order`,
           IFNULL(b.`level`, 'all') AS `level`
      FROM `boards` b
     WHERE b.`is_active` = 1
       AND (b.`is_national` = 1 OR (p_state_id IS NOT NULL AND b.`state_id` = p_state_id))
     ORDER BY b.`is_national` DESC, b.`sort_order`, b.`name`;
END
"""))
    db.session.commit()
    print("  sp_boards_for_state returns level")


def insert_master(table, value, label, extra=None):
    exists = db.session.execute(text(
        f"SELECT COUNT(*) FROM `{table}` WHERE value = :v"), {'v': value}).scalar()
    if exists:
        return False
    sort = db.session.execute(text(f"SELECT IFNULL(MAX(sort_order), 0) + 1 FROM `{table}`")).scalar()
    cols = "id, value, label, sort_order, is_active, created_at"
    vals = ":i, :v, :l, :o, 1, UTC_TIMESTAMP()"
    params = {'i': str(uuid.uuid4()), 'v': value, 'l': label, 'o': sort}
    for k, v in (extra or {}).items():
        cols += f", {k}"
        vals += f", :{k}"
        params[k] = v
    db.session.execute(text(f"INSERT INTO `{table}` ({cols}) VALUES ({vals})"), params)
    return True


def exams():
    added = 0
    for value, label, level in NATIONAL_EXAMS:
        if insert_master('master_entrance_exam', value, label, {'education_level': level}):
            added += 1
    print(f"  master_entrance_exam: {added} added")
    for table, rows in STATE_EXAMS.items():
        if not has_table(table):
            print(f"  ! {table} missing -- skipped")
            continue
        n = sum(1 for v, l in rows if insert_master(table, v, l))
        print(f"  {table}: {n} added")
    db.session.commit()


def main():
    with app.app_context():
        boards()
        exams()
        rows = db.session.execute(text(
            "SELECT code, level FROM boards WHERE code IN ('BSEAP','BSETS','BIEAP','TSBIE') ORDER BY code"
        )).all()
        print("  boards:", ', '.join(f"{c}={l}" for c, l in rows))
        print("Done.")


if __name__ == '__main__':
    main()
