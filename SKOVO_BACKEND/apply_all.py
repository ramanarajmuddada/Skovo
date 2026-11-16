"""
Bring a database up to what the code expects — schema, procedures, master data.

WHY THIS EXISTS
    `flask db upgrade` applies 19 Alembic revisions. The backend is SP-only and
    the repo carries 706 distinct stored procedures across 134 .sql files, plus
    53 hand-written migrations in database/migrations/ that Alembic knows
    nothing about. Nothing ran either of those at deploy time, so a fresh
    instance came up healthy and then failed every request with
    "PROCEDURE ... does not exist". This is the missing step.

ORDER, AND WHY
    1. alembic                     stamp a fresh database, upgrade an existing one
    2. database/tables/*.sql       the master_* tables no SQLAlchemy model defines
    3. stored_procedures/**.sql    every procedure body - BEFORE the migrations,
                                   because several of them seed master data by
                                   calling sp_master_create()
    4. database/migrations/*.py    the 53 migrations Alembic knows nothing about
    5. seeds/master_data.sql       the dropdowns the UI reads

    Two migrations always fail on a fresh database and that is correct:
    migrate_achievers_mentors_merge.py and migrate_full_v2.py both read FROM
    mentors, a table merged into achievers long ago. They have nothing to
    migrate and nothing to do.

    The aggregate snapshots (_all_tables.sql, _all_procedures.sql) are stale —
    _all_procedures.sql holds 376 of the 706 procedures and none of the trust
    ladder. They are loaded FIRST and the per-file sources loaded after, so a
    current body always overwrites the snapshot's older copy, never the reverse.

    Procedures load after the migrations because migrations create the tables
    the procedures read. MySQL does not resolve table names at CREATE PROCEDURE
    time, so this ordering is belt-and-braces rather than strictly required.

RE-RUNNING
    Procedures and master data are idempotent by construction — every .sql file
    drops before it creates. The migrations are not: only 32 of 53 guard
    themselves with IF NOT EXISTS or an information_schema check. A ledger table
    (`schema_apply_ledger`) records which have run, so this is safe to call on
    every deploy.

FIRST RUN AGAINST AN ALREADY-MIGRATED DATABASE
    Your existing dev and UAT databases have these migrations applied but no
    ledger, so a plain run would replay all 53 and fail on the unguarded ones.
    Use --baseline once on those: it records every migration as applied without
    executing it, then loads procedures and master data normally.

USAGE
    python apply_all.py                 # full run (fresh database)
    python apply_all.py --baseline      # existing database: record, don't replay
    python apply_all.py --procs-only    # procedures + master data only
    python apply_all.py --dry-run       # print the plan, touch nothing
"""
import argparse
import glob
import io
import logging
import os
import subprocess
import sys
import time

BACKEND_ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(BACKEND_ROOT)
if BACKEND_ROOT not in sys.path:
    sys.path.insert(0, BACKEND_ROOT)

# master_data.sql is full of rupee signs. Echoing it through a cp1252 Windows
# console raised UnicodeEncodeError from inside the logging handler and killed
# the run mid-load. Force UTF-8 out, and turn the SQL echo off entirely - this
# script replays ~2,200 statements and nobody wants them all on stdout.
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
os.environ['SQLALCHEMY_ECHO'] = '0'
logging.getLogger('sqlalchemy.engine').setLevel(logging.WARNING)

MIGRATIONS_DIR = os.path.join('database', 'migrations')
PROCS_DIR = os.path.join('database', 'stored_procedures')
TABLES_SNAPSHOT = os.path.join('database', 'tables', '_all_tables.sql')
PROCS_SNAPSHOT = os.path.join(PROCS_DIR, '_all_procedures.sql')
TABLES_DIR = os.path.join('database', 'tables')
MASTER_DATA = os.path.join('database', 'seeds', 'master_data.sql')

# Demo fixtures — never on a real deploy.
SKIP_MIGRATIONS = {
    '_bootstrap.py', 'seed_achiever_year_demo.py',
    # Superseded by migrate_ap_ts_towns.py, and never applied anywhere. It
    # shrinks AP to its 26 district names and switches every town off, so
    # running it after the towns migration would hide 100+ AP towns.
    'migrate_ap_districts.py',
}

# ASCII only: this runs under Docker and Windows consoles alike, and cp1252
# cannot encode the box-drawing characters the migrations themselves avoid.
OK, SKIP, FAIL = '[ok]', '[skip]', '[FAIL]'


def _log(msg):
    print(msg, flush=True)


# ── ledger ────────────────────────────────────────────────────────────────────
def _ensure_ledger(db, text):
    db.session.execute(text("""
        CREATE TABLE IF NOT EXISTS schema_apply_ledger (
            name        VARCHAR(190) NOT NULL PRIMARY KEY,
            applied_at  DATETIME     NOT NULL,
            duration_ms INT          NULL
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """))
    db.session.commit()


def _applied(db, text):
    rows = db.session.execute(text('SELECT name FROM schema_apply_ledger')).fetchall()
    return {r[0] for r in rows}


def _record(db, text, name, duration_ms):
    db.session.execute(
        text("""INSERT INTO schema_apply_ledger (name, applied_at, duration_ms)
                VALUES (:n, NOW(), :d)
                ON DUPLICATE KEY UPDATE applied_at = NOW(), duration_ms = :d"""),
        {'n': name, 'd': duration_ms})
    db.session.commit()


# ── steps ─────────────────────────────────────────────────────────────────────
def _load_sql(path, label=None):
    """Replay one .sql file through the same loader the migrations use."""
    from portal.helpers.sql_file import apply_sql_file
    from portal.models import db

    count = apply_sql_file(path)
    db.session.commit()
    _log(f'  {OK} {label or path} - {count} statement(s)')
    return count


def _sql_files():
    """Snapshot first, then every per-file source, so the current body of a
    procedure always lands after the snapshot's older copy of it."""
    ordered = []
    if os.path.exists(PROCS_SNAPSHOT):
        ordered.append(PROCS_SNAPSHOT)
    for root, _dirs, files in os.walk(PROCS_DIR):
        for f in sorted(files):
            if not f.endswith('.sql'):
                continue
            p = os.path.join(root, f)
            if os.path.abspath(p) == os.path.abspath(PROCS_SNAPSHOT):
                continue
            ordered.append(p)
    return ordered


def _migration_files():
    if not os.path.isdir(MIGRATIONS_DIR):
        return []
    return sorted(
        f for f in os.listdir(MIGRATIONS_DIR)
        if f.endswith('.py') and f not in SKIP_MIGRATIONS
    )


def _run_migration(fname):
    """Run as a subprocess rather than importing.

    The 53 migrations disagree on their entry point - 9 expose run(), 43 expose
    main(), 4 execute at import - but 51 have a __main__ guard and all of them
    work when invoked as a script. A subprocess also means one migration that
    calls sys.exit() or leaves a broken session cannot take the rest down.
    """
    started = time.time()
    # PYTHONIOENCODING: these scripts print rupee signs and box-drawing
    # characters. Inheriting a cp1252 pipe made migrate_onboarding_all.py die
    # with UnicodeEncodeError partway through seeding - a migration lost to
    # console encoding, not to anything wrong with it.
    env = dict(os.environ, PYTHONIOENCODING='utf-8')
    proc = subprocess.run(
        [sys.executable, os.path.join(MIGRATIONS_DIR, fname)],
        capture_output=True, text=True, cwd=BACKEND_ROOT, env=env,
        encoding='utf-8', errors='replace',
    )
    return proc.returncode == 0, proc, int((time.time() - started) * 1000)


def run_migrations(db, text, baseline=False, dry_run=False):
    files = _migration_files()
    done = _applied(db, text)
    todo = [f for f in files if f not in done]

    _log(f'\n== migrations ==  {len(files)} total, {len(done)} already applied, {len(todo)} to run')
    if not todo:
        return True

    if baseline:
        for f in todo:
            if not dry_run:
                _record(db, text, f, 0)
            _log(f'  {SKIP} {f} - recorded as applied (baseline)')
        return True

    if dry_run:
        for f in todo:
            _log(f'  would run {f}')
        return True

    # Two passes. These migrations have real ordering dependencies (the trust
    # ladder reads a column that the DPDP consent migration adds) and nothing
    # in the filenames encodes that, so anything that fails is retried once
    # after its siblings have had their turn. Alphabetical order gets most of
    # them right; the retry catches the rest without me hand-deriving a
    # 53-node dependency graph I could not verify.
    pending, failures = todo, {}
    for attempt in (1, 2):
        if not pending:
            break
        if attempt == 2:
            _log(f'\n  retrying {len(pending)} migration(s) that failed the first pass')
        still_pending = []
        for f in pending:
            ok, proc, ms = _run_migration(f)
            if ok:
                _record(db, text, f, ms)
                _log(f'  {OK} {f} ({ms} ms)')
                failures.pop(f, None)
            else:
                still_pending.append(f)
                failures[f] = (proc.stdout or '') + (proc.stderr or '')
        if len(still_pending) == len(pending):
            break                      # no progress - retrying again is pointless
        pending = still_pending

    if failures:
        _log(f'\n  {FAIL} {len(failures)} migration(s) did not apply:')
        for f, out in failures.items():
            tail = [ln for ln in out.strip().splitlines() if ln.strip()][-3:]
            _log(f'    - {f}')
            for ln in tail:
                _log(f'        {ln}')
        return False
    return True


def run_procedures(dry_run=False):
    files = _sql_files()
    _log(f'\n== stored procedures ==  {len(files)} file(s)')
    if dry_run:
        for p in files:
            _log(f'  would load {p}')
        return True

    total, failed = 0, []
    for p in files:
        try:
            total += _load_sql(p)
        except Exception as e:                       # noqa: BLE001 - report, continue
            failed.append((p, str(e).splitlines()[0] if str(e) else repr(e)))
            _log(f'  {FAIL} {p} - {failed[-1][1]}')
    _log(f'  {total} statement(s) loaded from {len(files) - len(failed)} file(s)')
    if failed:
        _log(f'  {FAIL} {len(failed)} file(s) failed')
    return not failed


def run_master_data(dry_run=False):
    _log('\n== master data ==')
    if not os.path.exists(MASTER_DATA):
        _log(f'  {SKIP} {MASTER_DATA} not present')
        return True
    if dry_run:
        _log(f'  would load {MASTER_DATA}')
        return True
    try:
        # _load_sql splits on `$$` (procedure delimiter). master_data.sql is
        # 342 KB of plain INSERTs separated by `;`, so that sent the whole file
        # as a single statement, MySQL rejected it, and the transaction rolled
        # back - which is why 8 master tables stayed empty, including
        # difficulty_level, city and state.
        ran = _load_ddl(MASTER_DATA)
        _log('  %s master_data.sql - %d statement(s)' % (OK, ran))
        return True
    except Exception as e:                           # noqa: BLE001
        _log('  %s master_data.sql - %s' % (FAIL, str(e).splitlines()[0][:200]))
        return False


def run_alembic(db, text, dry_run=False):
    """Stamp a fresh database; upgrade an existing one.

    portal/models/__init__.py calls db.create_all() on every app init, and
    `flask db upgrade` imports the app before Alembic runs. On a brand new
    database that means the models build today's schema first and Alembic then
    replays its 19 incremental revisions on top of it - the first of which dies
    with "Duplicate column name 'password_hash'". A fresh database can never be
    upgraded, only stamped.

    So: no alembic_version table means create_all() has just built the current
    schema and Alembic has nothing to do but record where it stands. An
    existing alembic_version means a real database with real history, and its
    pending revisions genuinely need applying.
    """
    _log('\n== alembic ==')
    versioned = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'alembic_version'")).scalar()
    action = 'upgrade' if versioned else 'stamp'

    if dry_run:
        _log(('  would run: flask db %s %s' % (action, '' if versioned else 'head')).rstrip())
        return True

    env = dict(os.environ, FLASK_APP='app.py')
    cmd = [sys.executable, '-m', 'flask', 'db', action] + ([] if versioned else ['head'])
    proc = subprocess.run(cmd, capture_output=True, text=True, cwd=BACKEND_ROOT, env=env)
    if proc.returncode != 0:
        _log('  %s flask db %s failed:' % (FAIL, action))
        for ln in (proc.stderr or proc.stdout or '').strip().split('\n')[-5:]:
            _log('      ' + ln)
        return False
    _log('  %s flask db %s - %s' % (
        OK, action,
        'applied pending revisions' if versioned
        else 'fresh database, recorded at head (create_all built the schema)'))
    return True


def _split_ddl(sql):
    """Split a plain DDL file on statement-terminating semicolons.

    portal.helpers.sql_file.apply_sql_file splits on `$$`, which is right for
    procedures and wrong here - database/tables/*.sql uses ordinary `;`. Files
    holding one CREATE TABLE survived that by accident; master_tables.sql (124
    tables) and _all_tables.sql went to the server as a single statement and
    came back as a syntax error, which is how the fresh database ended up 34
    tables short.

    Semicolons inside quotes and comments are not terminators, so this walks
    the text rather than calling split(';').
    """
    out, buf = [], []
    i, n = 0, len(sql)
    quote = None
    while i < n:
        ch = sql[i]
        nxt = sql[i + 1] if i + 1 < n else ''

        if quote:
            buf.append(ch)
            if ch == '\\' and quote in ("'", '"'):
                if nxt:                       # escaped char - take it verbatim
                    buf.append(nxt)
                    i += 2
                    continue
            elif ch == quote:
                quote = None
            i += 1
            continue

        if ch in ("'", '"', '`'):
            quote = ch
            buf.append(ch)
            i += 1
            continue

        if ch == '-' and nxt == '-':
            while i < n and sql[i] != '\n':
                i += 1
            continue
        if ch == '#':
            while i < n and sql[i] != '\n':
                i += 1
            continue
        if ch == '/' and nxt == '*':
            end = sql.find('*/', i + 2)
            i = n if end == -1 else end + 2
            continue

        if ch == ';':
            stmt = ''.join(buf).strip()
            if stmt:
                out.append(stmt)
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    tail = ''.join(buf).strip()
    if tail:
        out.append(tail)
    return out


def _load_ddl(path):
    """Replay a plain DDL file. Every statement in database/tables is
    CREATE TABLE IF NOT EXISTS, so re-running is a no-op by design."""
    from sqlalchemy import text as _text
    from portal.models import db

    ran = 0
    for stmt in _split_ddl(io.open(path, encoding='utf-8').read()):
        db.session.execute(_text(stmt))
        ran += 1
    db.session.commit()
    return ran


def run_tables(dry_run=False):
    """Load database/tables/*.sql.

    db.create_all() covers only the tables that have a SQLAlchemy model. The
    master_* dropdown tables and a handful of others (cohort_sessions,
    cg_guidance_sessions) are pure SQL and exist nowhere else, so a database
    built from the models alone is 34 tables short and every dropdown in the
    product comes back empty.

    All 399 statements here are CREATE TABLE IF NOT EXISTS, so this is safe to
    replay on every deploy and needs no guard.
    """
    files = sorted(glob.glob(os.path.join(TABLES_DIR, '*.sql')))
    # Snapshot first, per-file after, same reasoning as the procedures.
    snap = os.path.join(TABLES_DIR, '_all_tables.sql')
    files = ([snap] if os.path.exists(snap) else []) + [f for f in files if f != snap]

    _log('%s== table definitions ==  %d file(s)' % ('\n', len(files)))
    if dry_run:
        for f in files:
            _log('  would load ' + f)
        return True

    total, failed = 0, []
    for f in files:
        try:
            ran = _load_ddl(f)
            total += ran
        except Exception as e:                       # noqa: BLE001 - report, continue
            failed.append(f)
            _log('  %s %s - %s' % (FAIL, f, str(e).splitlines()[0][:160]))
    _log('  %d statement(s) from %d file(s)' % (total, len(files) - len(failed)))
    return not failed

# ── entry point ───────────────────────────────────────────────────────────────
def main():
    ap = argparse.ArgumentParser(description=__doc__.strip().splitlines()[0])
    ap.add_argument('--baseline', action='store_true',
                    help='record migrations as applied without running them '
                         '(use once on a database that is already migrated)')
    ap.add_argument('--procs-only', action='store_true',
                    help='load stored procedures and master data only')
    ap.add_argument('--skip-master-data', action='store_true')
    ap.add_argument('--dry-run', action='store_true')
    args = ap.parse_args()

    from sqlalchemy import text
    from portal import InitApp
    from portal.models import db

    app = InitApp().app()
    with app.app_context():
        _ensure_ledger(db, text)

        ok = True
        if not args.procs_only:
            ok &= run_alembic(db, text, args.dry_run)
            ok &= run_tables(args.dry_run)

        # Procedures BEFORE the migrations. Several migrations seed master data
        # by calling sp_master_create(), so on a fresh database they died with
        # "PROCEDURE does not exist" and left 31 master tables empty - including
        # difficulty_level, which fills the Level dropdown when an achiever
        # creates a course. Procedures reference tables only at execution time,
        # so nothing is lost by creating them first.
        ok &= run_procedures(args.dry_run)

        if not args.procs_only:
            ok &= run_migrations(db, text, baseline=args.baseline, dry_run=args.dry_run)
        if not args.skip_master_data:
            ok &= run_master_data(args.dry_run)

        _log('\n' + ('All steps completed.' if ok else
                     'FINISHED WITH ERRORS - see the [FAIL] lines above.'))
        # Non-zero stops a deploy rather than letting a half-migrated database
        # start serving traffic.
        return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
