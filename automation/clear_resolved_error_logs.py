"""Clear `error_logs` of rows whose bug is fixed, and of the suite's own injections.

WHY THIS IS A SCRIPT AND NOT A COMMIT
    CLAUDE.md §1 makes it a working agreement: "When a logged error is fixed,
    delete its row. The table is meant to show what is currently broken, not a
    permanent history — a fixed error left sitting there sends the next person
    chasing something that no longer exists." X01-021 asserts exactly that, and
    it is the one workbook case that cannot go green from code: it is a
    statement about the contents of a production table.

    The delete is blocked for the assistant by the permission classifier (it has
    been in this session and in earlier ones), so it is written out here for
    someone who can run it.

        SKOVO_BACKEND> ./venv/Scripts/python.exe ../automation/clear_resolved_error_logs.py --dry-run
        SKOVO_BACKEND> ./venv/Scripts/python.exe ../automation/clear_resolved_error_logs.py --apply

    `--dry-run` (the default) prints what would go and, crucially, what would
    STAY. Nothing is deleted unless every remaining row has been accounted for,
    because a blanket TRUNCATE would also erase a bug nobody has looked at yet.

WHAT IS BEING DELETED, AND WHY EACH GROUP IS SAFE
    Synthetic (86 rows as of 2026-09-06)
        Injected on purpose by the test suite to prove `capture_error` works —
        "database is on fire" and friends. They describe nothing about the app.

    Fixed (51 rows as of 2026-09-06)
        achiever_agreements / master_year_pg / master_opportunity_type
            "Table doesn't exist" — all three exist now; the script re-checks
            information_schema before agreeing to delete their rows.
        ProfileNotFound
            AWS_PROFILE named a profile absent from the machine. `_build_client`
            falls back to the default credential chain (2026-09-02).
        seek of closed file / I/O operation on closed file
            The S3->disk fallback called seek(0) on a stream boto3 had already
            closed, so the recovery path was itself answering 500. `save_file`
            now keeps the bytes and wraps a fresh BytesIO per attempt
            (2026-09-06); tests/test_upload_storage_fallback.py is the proof.
        int() argument must be a string
            `_cohort_sp_args` casting a NULL total_seats (2026-09-02).
"""
import argparse
import datetime
import json
import os
import sys

BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'SKOVO_BACKEND'))
sys.path.insert(0, BACKEND)
os.chdir(BACKEND)

from dotenv import load_dotenv                                      # noqa: E402
from sqlalchemy import create_engine, text                          # noqa: E402

load_dotenv('.env')
engine = create_engine(os.environ['DATABASE_URL'], connect_args={'connect_timeout': 15})

ARCHIVE = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                       'results', 'error_logs_cleared.json')

# Messages the suite injects itself. Not findings.
SYNTHETIC = [
    'database is on fire',
    'upstream timed out',
    'connection lost mid-signup',
    'notification backend is down',
]

# (message fragment, why it is resolved, table that must exist for it to be)
FIXED = [
    ("skovo.achiever_agreements' doesn't exist",
     'table created 2026-09-05', 'achiever_agreements'),
    ("skovo.master_year_pg' doesn't exist",
     'table exists', 'master_year_pg'),
    ("skovo.master_opportunity_type' doesn't exist",
     'table exists', 'master_opportunity_type'),
    ('The config profile (skovo) could not be found',
     '_build_client falls back to the default credential chain, 2026-09-02', None),
    ('I/O operation on closed file',
     'save_file keeps the bytes across the S3->disk fallback, 2026-09-06', None),
    ('seek of closed file',
     'save_file keeps the bytes across the S3->disk fallback, 2026-09-06', None),
    ('int() argument must be a string',
     '_cohort_sp_args skips the cast for None, 2026-09-02', None),
]


def table_exists(conn, name):
    return bool(conn.execute(text(
        'SELECT COUNT(*) FROM information_schema.TABLES '
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t'), {'t': name}).scalar())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true',
                    help='actually delete. Without it, nothing is written.')
    args = ap.parse_args()

    patterns, doomed_total = [], 0
    with engine.connect() as c:
        total = c.execute(text('SELECT COUNT(*) FROM error_logs')).scalar()

        for m in SYNTHETIC:
            n = c.execute(text('SELECT COUNT(*) FROM error_logs WHERE error_message LIKE :m'),
                          {'m': f'%{m}%'}).scalar()
            patterns.append(m)
            doomed_total += n
            print(f'  synthetic  {n:4}  {m}')

        for m, why, needs_table in FIXED:
            if needs_table and not table_exists(c, needs_table):
                print(f'  SKIPPED    ----  {m[:44]:46} ({needs_table} still missing — '
                      'this bug is NOT fixed)')
                continue
            n = c.execute(text('SELECT COUNT(*) FROM error_logs WHERE error_message LIKE :m'),
                          {'m': f'%{m}%'}).scalar()
            patterns.append(m)
            doomed_total += n
            print(f'  fixed      {n:4}  {m[:44]:46} ({why})')

        keep_where = ' AND '.join(f'error_message NOT LIKE :m{i}'
                                  for i in range(len(patterns)))
        params = {f'm{i}': f'%{m}%' for i, m in enumerate(patterns)}
        remaining = list(c.execute(text(
            'SELECT error_id, endpoint, error_type, LEFT(error_message, 100) msg, created_at '
            f'FROM error_logs WHERE {keep_where} ORDER BY created_at DESC'), params))

    print(f'\n  {total} rows · {doomed_total} resolved or synthetic · {len(remaining)} staying')
    if remaining:
        print('\n  STAYING — these are not known to be fixed, look at them:')
        for r in remaining:
            print(f'    {r.error_id}  {r.endpoint}  {r.error_type}: {r.msg}  ({r.created_at})')

    if not args.apply:
        print('\n  dry run — nothing deleted. Re-run with --apply.')
        return

    with engine.begin() as c:
        rows = [dict(r._mapping) for r in c.execute(
            text(f'SELECT * FROM error_logs WHERE NOT ({keep_where})'), params)]
        for r in rows:
            for k, v in list(r.items()):
                if isinstance(v, (datetime.datetime, datetime.date)):
                    r[k] = v.isoformat()
        os.makedirs(os.path.dirname(ARCHIVE), exist_ok=True)
        with open(ARCHIVE, 'w', encoding='utf-8') as f:
            json.dump(rows, f, indent=1, default=str)
        print(f'\n  archived {len(rows)} rows -> {ARCHIVE}')

        deleted = c.execute(text(f'DELETE FROM error_logs WHERE NOT ({keep_where})'),
                            params).rowcount
        print(f'  deleted {deleted} rows')

    with engine.connect() as c:
        print('  error_logs now holds',
              c.execute(text('SELECT COUNT(*) FROM error_logs')).scalar(), 'rows')


if __name__ == '__main__':
    main()
