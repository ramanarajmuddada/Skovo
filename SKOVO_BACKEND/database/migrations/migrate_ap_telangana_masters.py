"""
Migration: proper Andhra Pradesh and Telangana master data.

AP and Telangana are the launch markets, but several dropdowns only carried the
national lists plus a couple of token state entries. A student in Warangal
picking "State PSC" from the government-exam dropdown could not say TSPSC, and
the rank-data dropdown offered one ambiguous "EAMCET" even though AP and
Telangana have run separate EAPCETs since 2014.

What this adds:

  entrance_exam_AP / _TS   the remaining state CETs — EDCET, PECET, RCET,
                           DEECET — alongside the six already present
  govt_exam                APPSC and TSPSC groups, state police, DSC/TRT
                           teacher recruitment, and the state utilities
  rank_data_exam           AP/TS-specific EAPCET, ECET and POLYCET, so a cutoff
                           row says which state's exam it came from
  coaching_category        the categories AP/TS coaching centres actually sell

It also re-syncs `master_city` and `master_state` from the `cities`/`states`
entity tables. Those two master tables held a stale AP-only subset — ten cities,
no Hyderabad — which nothing currently reads (the API serves `city` and `state`
from the entity tables), but which would be wrong the day anything did.

Idempotent — every insert goes through sp_master_create, which reports
'duplicate' rather than raising. Run from anywhere:

    python database/migrations/migrate_ap_telangana_masters.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

LISTS = {
    # ── Andhra Pradesh state entrance exams ─────────────────────────────────
    # AP EAPCET / ECET / POLYCET / ICET / LAWCET / PGECET are already seeded;
    # these are the ones a student outside engineering was missing.
    'entrance_exam_AP': [
        ('AP EDCET', 'AP EDCET (B.Ed)'),
        ('AP PECET', 'AP PECET (Physical Education)'),
        ('AP RCET', 'AP RCET (PhD / Research)'),
        ('AP DEECET', 'AP DEECET (D.El.Ed)'),
        ('AP PGLCET', 'AP PGLCET (LLM)'),
    ],
    'entrance_exam_TS': [
        ('TS EDCET', 'TS EDCET (B.Ed)'),
        ('TS PECET', 'TS PECET (Physical Education)'),
        ('TS RCET', 'TS RCET (PhD / Research)'),
        ('TS DEECET', 'TS DEECET (D.El.Ed)'),
        ('TS PGLCET', 'TS PGLCET (LLM)'),
    ],

    # ── State government exams ──────────────────────────────────────────────
    # The list had one generic 'State PSC'. A student preparing for TSPSC
    # Group II could not say so, which also meant nothing could target them.
    'govt_exam': [
        ('APPSC Group I', 'APPSC Group I'),
        ('APPSC Group II', 'APPSC Group II'),
        ('APPSC Group III', 'APPSC Group III'),
        ('APPSC Group IV', 'APPSC Group IV'),
        ('APPSC AEE', 'APPSC AEE (Assistant Executive Engineer)'),
        ('AP Police SI', 'AP Police SI'),
        ('AP Police Constable', 'AP Police Constable'),
        ('AP DSC', 'AP DSC (Teacher Recruitment)'),
        ('TSPSC Group I', 'TSPSC Group I'),
        ('TSPSC Group II', 'TSPSC Group II'),
        ('TSPSC Group III', 'TSPSC Group III'),
        ('TSPSC Group IV', 'TSPSC Group IV'),
        ('TSPSC AEE', 'TSPSC AEE (Assistant Executive Engineer)'),
        ('TS Police SI', 'TS Police SI'),
        ('TS Police Constable', 'TS Police Constable'),
        ('TS TRT', 'TS TRT / DSC (Teacher Recruitment)'),
        ('TSSPDCL JLM', 'TSSPDCL / TSNPDCL Junior Lineman'),
        ('APSRTC', 'APSRTC Recruitment'),
    ],

    # ── Cutoff / rank data ──────────────────────────────────────────────────
    # A cutoff row has to say which state's exam produced the rank. One
    # 'EAMCET' entry could not, and the predictor compares ranks across states
    # that are not comparable.
    'rank_data_exam': [
        ('AP EAPCET', 'AP EAPCET (EAMCET)'),
        ('TS EAPCET', 'TS EAPCET (EAMCET)'),
        ('AP ECET', 'AP ECET'),
        ('TS ECET', 'TS ECET'),
        ('AP POLYCET', 'AP POLYCET'),
        ('TS POLYCET', 'TS POLYCET'),
        ('AP ICET', 'AP ICET'),
        ('TS ICET', 'TS ICET'),
    ],

    # ── Coaching ────────────────────────────────────────────────────────────
    'coaching_category': [
        ('eapcet', 'EAPCET / EAMCET'),
        ('polycet', 'POLYCET'),
        ('appsc_tspsc', 'APPSC / TSPSC'),
        ('state_police', 'State Police'),
    ],
}


def seed(mtype, entries):
    """Insert through the procedure so the per-table UNIQUE and the registry
    lookup both apply — a typo'd type is reported, not silently created."""
    added = 0
    for i, (value, label) in enumerate(entries):
        res = db.session.execute(
            text("CALL sp_master_create(:t, :i, :v, :l, :s, NULL)"),
            {'t': mtype, 'i': str(uuid.uuid4()), 'v': value, 'l': label,
             's': 500 + i * 10},
        ).fetchone()
        outcome = res[0] if res else 'error'
        if outcome == 'ok':
            added += 1
        elif outcome == 'unknown_type':
            print(f'  ! unknown master type {mtype!r} — skipped')
            return 0
    return added


def sync_from_entity(mtype, rows):
    """Point a master table at the entity table that actually owns the data."""
    added = 0
    for i, (value, label) in enumerate(rows):
        res = db.session.execute(
            text("CALL sp_master_create(:t, :i, :v, :l, :s, NULL)"),
            {'t': mtype, 'i': str(uuid.uuid4()), 'v': value, 'l': label, 's': i * 10},
        ).fetchone()
        if res and res[0] == 'ok':
            added += 1
    return added


def main():
    with app.app_context():
        total = 0
        for mtype, entries in LISTS.items():
            n = seed(mtype, entries)
            total += n
            print(f'  {mtype:<22} +{n}')
        db.session.commit()

        # ── re-sync the two stale master tables from their entity tables ────
        cities = db.session.execute(text("""
            SELECT c.name FROM cities c
              JOIN states s ON s.id = c.state_id
             WHERE c.is_active = 1
             ORDER BY s.name, c.name
        """)).scalars().all()
        states = db.session.execute(text(
            "SELECT name FROM states WHERE is_active = 1 ORDER BY name")).scalars().all()

        c_added = sync_from_entity('city', [(n.lower().replace(' ', '_'), n) for n in cities])
        s_added = sync_from_entity('state', [(n.lower().replace(' ', '_'), n) for n in states])
        db.session.commit()
        print(f'  {"city (from cities)":<22} +{c_added}')
        print(f'  {"state (from states)":<22} +{s_added}')

        total += c_added + s_added
        print(f'\n{total} option(s) added')

        # Resolve the physical names through master_registry rather than
        # spelling them out. sp_master_create registers these as lowercase, and
        # RDS runs with lower_case_table_names=0, so the literal
        # `master_entrance_exam_AP` is a different table than the one that
        # exists - it works on a Windows or macOS dev box and raises 1146 on
        # Linux. The registry is the authority for the mapping either way.
        def _count(master_type):
            tbl = db.session.execute(
                text('SELECT table_name FROM master_registry WHERE type = :t'),
                {'t': master_type}).scalar()
            if not tbl:
                return 0
            return db.session.execute(text(f'SELECT COUNT(*) FROM `{tbl}`')).scalar()

        ap = _count('entrance_exam_AP')
        ts = _count('entrance_exam_TS')
        gx = db.session.execute(text('SELECT COUNT(*) FROM master_govt_exam')).scalar()
        rd = db.session.execute(text('SELECT COUNT(*) FROM master_rank_data_exam')).scalar()
        print(f'AP exams {ap} | TS exams {ts} | govt exams {gx} | rank-data exams {rd}')


if __name__ == '__main__':
    main()
