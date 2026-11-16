"""
Stored-procedure call helpers.

Thin wrappers around ``db.session.execute`` for calling MySQL stored procedures
from route handlers, returning plain ``dict`` rows so responses serialize
exactly like the old ORM path.

The procedures must already be loaded into the database — see
``database/stored_procedures/`` (per-table CRUD + ``business/`` per-portal flows).

Usage:
    from portal.helpers.sp import call_proc, call_proc_one
    row  = call_proc_one('sp_admin_dashboard_stats')
    rows = call_proc('sp_master_list', 50, 0, 1)
"""
import datetime
import logging
from sqlalchemy import text
from portal.models import db

logger = logging.getLogger("skovo")


def _sql(proc_name, n):
    binds = ', '.join(f':p{i}' for i in range(n))
    return text(f"CALL {proc_name}({binds})")


def _coerce(value):
    """PyMySQL maps MySQL TIME columns to timedelta; the ORM used to hand back
    datetime.time. Every TIME column in this schema is a time-of-day
    (start_time/end_time), so convert — otherwise datetime.combine() and
    str() formatting break downstream. Values outside 0–24h can't be a
    time-of-day, so pass those through untouched."""
    if isinstance(value, datetime.timedelta):
        if datetime.timedelta(0) <= value < datetime.timedelta(days=1):
            return (datetime.datetime.min + value).time()
    return value


def call_proc(proc_name, *args):
    """CALL a procedure with positional args; return the first result set as a
    list of dicts (empty list if the procedure returns no rows)."""
    # Proof line — shows in the backend log every time a stored procedure runs.
    logger.info("🗄️  [STORED PROCEDURE] CALL %s(%s)",
                proc_name, ', '.join('%r' % a for a in args))
    params = {f'p{i}': a for i, a in enumerate(args)}
    res = db.session.execute(_sql(proc_name, len(args)), params)
    try:
        rows = [{k: _coerce(v) for k, v in r._mapping.items()} for r in res.fetchall()]
    except Exception:
        rows = []          # procedure returned no result set (e.g. a delete)
    finally:
        res.close()
    return rows


def call_proc_one(proc_name, *args):
    """CALL a procedure and return its first result row as a dict, or None."""
    rows = call_proc(proc_name, *args)
    return rows[0] if rows else None
