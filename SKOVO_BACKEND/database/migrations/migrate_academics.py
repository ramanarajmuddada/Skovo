"""
Migration: school boards and stream vocabulary become real tables.

A stream is called PCM in CBSE, MPC in Telangana and "Group 2" in Tamil Nadu —
the same subject combination under three names. Storing the display label on the
profile is what made cohort targeting miss students. Each board now owns its
labels while every row carries the same `canonical` value, which is what the
profile stores and what audience targeting compares.

Boards we have not mapped fall back to the DEFAULT board's set, so no student is
ever shown an empty stream list.

Also adds `user_profiles.board`.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_academics.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column

app = InitApp().app()

SP_FILE = 'database/stored_procedures/academics.sql'

# code, name  (national boards — offered in every state)
NATIONAL_BOARDS = [
    ('CBSE',  'CBSE — Central Board of Secondary Education'),
    ('CISCE', 'ICSE / ISC — CISCE'),
    ('NIOS',  'NIOS — National Institute of Open Schooling'),
    ('IB',    'IB — International Baccalaureate'),
]

# state code → (board code, board name)
STATE_BOARDS = {
    'AP': ('BIEAP',   'BIEAP — Board of Intermediate Education, Andhra Pradesh'),
    'TS': ('TSBIE',   'TSBIE — Telangana State Board of Intermediate Education'),
    'TN': ('TNDGE',   'Tamil Nadu State Board (DGE)'),
    'KA': ('KSEAB',   'Karnataka PUC — KSEAB'),
    'KL': ('DHSE_KL', 'Kerala HSE — DHSE'),
    'MH': ('MSBSHSE', 'Maharashtra State Board — MSBSHSE'),
    'UP': ('UPMSP',   'UP Board — UPMSP'),
    'BR': ('BSEB',    'Bihar School Examination Board'),
    'WB': ('WBCHSE',  'West Bengal Council of Higher Secondary Education'),
    'RJ': ('RBSE',    'Rajasthan Board — RBSE'),
    'GJ': ('GSEB',    'Gujarat Secondary & Higher Secondary Education Board'),
    'MP': ('MPBSE',   'Madhya Pradesh Board — MPBSE'),
    'PB': ('PSEB',    'Punjab School Education Board'),
    'HR': ('BSEH',    'Board of School Education Haryana'),
    'OD': ('CHSE_OD', 'Council of Higher Secondary Education, Odisha'),
    'JH': ('JAC',     'Jharkhand Academic Council'),
    'CG': ('CGBSE',   'Chhattisgarh Board — CGBSE'),
    'AS': ('AHSEC',   'Assam Higher Secondary Education Council'),
    'UK': ('UBSE',    'Uttarakhand Board — UBSE'),
    'HP': ('HPBOSE',  'Himachal Pradesh Board — HPBOSE'),
    'JK': ('JKBOSE',  'Jammu & Kashmir Board — JKBOSE'),
    'GA': ('GBSHSE',  'Goa Board — GBSHSE'),
    'MN': ('COHSEM',  'Council of Higher Secondary Education, Manipur'),
    'ML': ('MBOSE',   'Meghalaya Board — MBOSE'),
    'MZ': ('MBSE',    'Mizoram Board — MBSE'),
    'NL': ('NBSE',    'Nagaland Board — NBSE'),
    'TR': ('TBSE',    'Tripura Board — TBSE'),
    'PY': ('DGE_PY',  'Puducherry State Board'),
}

# canonical, label, short_label
DEFAULT_STREAMS = [
    ('science_pcm',   'PCM (Physics, Chemistry, Maths)',            'PCM'),
    ('science_pcb',   'PCB (Physics, Chemistry, Biology)',          'PCB'),
    ('science_pcmb',  'PCMB (Physics, Chemistry, Maths, Biology)',  'PCMB'),
    ('commerce',      'Commerce',                                    'Commerce'),
    ('arts',          'Arts / Humanities',                           'Arts'),
    ('vocational',    'Vocational',                                  'Vocational'),
]

# Boards whose students genuinely use different words for the same combination.
BOARD_STREAMS = {
    'BIEAP': [
        ('science_pcm',    'MPC (Maths, Physics, Chemistry)',        'MPC'),
        ('science_pcb',    'BiPC (Biology, Physics, Chemistry)',     'BiPC'),
        # MBiPC is the four-subject group — the same combination CBSE calls
        # PCMB. It was the one science group these two boards did not offer, so
        # a student who takes all four had to under-report as MPC or BiPC, and
        # cohort targeting on science_pcmb never matched them.
        ('science_pcmb',   'MBiPC (Maths, Biology, Physics, Chemistry)', 'MBiPC'),
        ('commerce_maths', 'MEC (Maths, Economics, Commerce)',       'MEC'),
        ('commerce',       'CEC (Civics, Economics, Commerce)',      'CEC'),
        ('arts',           'HEC (History, Economics, Civics)',       'HEC'),
        ('vocational',     'Vocational',                             'Vocational'),
    ],
    'KSEAB': [
        ('science_pcm',   'PCMC / PCME (Science)',                   'PCMC'),
        ('science_pcmb',  'PCMB (Science)',                          'PCMB'),
        ('commerce',      'Commerce (ABEC / SEBA)',                  'Commerce'),
        ('arts',          'Arts / Humanities',                       'Arts'),
        ('vocational',    'Vocational',                              'Vocational'),
    ],
    'TNDGE': [
        ('science_pcmb',  'Bio-Maths (Group 1)',                     'Bio-Maths'),
        ('science_pcm',   'Computer Science / Maths (Group 2)',      'CS-Maths'),
        ('science_pcb',   'Pure Science',                            'Pure Sci'),
        ('commerce',      'Commerce',                                'Commerce'),
        ('arts',          'Arts / Humanities',                       'Arts'),
        ('vocational',    'Vocational',                              'Vocational'),
    ],
    'MSBSHSE': [
        ('science_pcm',   'Science (PCM)',                           'Science PCM'),
        ('science_pcb',   'Science (PCB)',                           'Science PCB'),
        ('commerce',      'Commerce',                                'Commerce'),
        ('arts',          'Arts',                                    'Arts'),
        ('vocational',    'Bifocal / Vocational',                    'Vocational'),
    ],
}
BOARD_STREAMS['TSBIE'] = BOARD_STREAMS['BIEAP']      # same vocabulary


def _upsert_board(code, name, state_id, is_national, order):
    db.session.execute(text("""
        INSERT INTO `boards` (`id`, `code`, `name`, `state_id`, `is_national`, `sort_order`, `is_active`)
        VALUES (:i, :c, :n, :s, :nat, :o, :act)
        ON DUPLICATE KEY UPDATE `name` = :n, `state_id` = :s, `is_national` = :nat,
                                `sort_order` = :o, `is_active` = :act
    """), {'i': str(uuid.uuid4()), 'c': code, 'n': name, 's': state_id,
           'nat': is_national, 'o': order, 'act': 0 if code == 'DEFAULT' else 1})


def seed_boards():
    states = {r[0]: r[1] for r in db.session.execute(text("SELECT `code`, `id` FROM `states`")).fetchall()}

    # Holder row for the fallback stream set — inactive so it never shows.
    _upsert_board('DEFAULT', 'Default stream vocabulary', None, 0, 0)

    for i, (code, name) in enumerate(NATIONAL_BOARDS):
        _upsert_board(code, name, None, 1, (i + 1) * 10)

    covered = set()
    for state_code, (code, name) in STATE_BOARDS.items():
        if state_code in states:
            _upsert_board(code, name, states[state_code], 0, 100)
            covered.add(state_code)

    # Every remaining state still needs a state-board option, or its students
    # can only pick a national board they may not be on.
    for state_code, state_id in states.items():
        if state_code in covered:
            continue
        name = db.session.execute(text("SELECT `name` FROM `states` WHERE `code` = :c"),
                                  {'c': state_code}).scalar()
        _upsert_board(f'SB_{state_code}', f'{name} State Board', state_id, 0, 200)
    db.session.commit()


def _upsert_stream(board_id, canonical, label, short, order):
    db.session.execute(text("""
        INSERT INTO `streams` (`id`, `board_id`, `canonical`, `label`, `short_label`, `sort_order`, `is_active`)
        VALUES (:i, :b, :c, :l, :s, :o, 1)
        ON DUPLICATE KEY UPDATE `label` = :l, `short_label` = :s, `sort_order` = :o, `is_active` = 1
    """), {'i': str(uuid.uuid4()), 'b': board_id, 'c': canonical, 'l': label, 's': short, 'o': order})


def seed_streams():
    boards = {r[0]: r[1] for r in db.session.execute(text("SELECT `code`, `id` FROM `boards`")).fetchall()}

    for i, (canonical, label, short) in enumerate(DEFAULT_STREAMS):
        _upsert_stream(boards['DEFAULT'], canonical, label, short, (i + 1) * 10)

    for board_code, rows in BOARD_STREAMS.items():
        board_id = boards.get(board_code)
        if not board_id:
            continue
        for i, (canonical, label, short) in enumerate(rows):
            _upsert_stream(board_id, canonical, label, short, (i + 1) * 10)
    db.session.commit()


def main():
    with app.app_context():
        procs = apply_sql_file(SP_FILE)
        added = add_column('user_profiles', 'board', 'VARCHAR(100) NULL')
        seed_boards()
        seed_streams()

        counts = db.session.execute(text("""
            SELECT (SELECT COUNT(*) FROM `boards` WHERE `is_active` = 1) AS boards,
                   (SELECT COUNT(*) FROM `boards` WHERE `is_national` = 1) AS national,
                   (SELECT COUNT(*) FROM `streams`) AS streams,
                   (SELECT COUNT(DISTINCT `canonical`) FROM `streams`) AS canonical_values
        """)).mappings().first()
        print(f"statements run: {procs} | user_profiles.board added: {added}")
        print(f"academics seeded: {dict(counts)}")


if __name__ == "__main__":
    main()
