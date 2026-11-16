"""
Migration: achiever discovery, funnel visibility and quality ranking.

WHY THIS EXISTS
    The achiever portal could run sessions but not win them. Three holes:

    1. Find Achievers was a text box over a Python-side scan of the whole
       table. No domain, price, rating or background-verified filter — so a
       student could not find the right achiever, and achievers went unbooked.
    2. `/portal/earnings` returned money only. An achiever with no bookings
       could not tell whether nobody saw their profile or everybody bounced
       off it, because nothing counted views at all.
    3. Nothing measured whether an achiever was any good. No cancellation
       rate, no-show rate or repeat-booking rate existed anywhere, so the
       directory could not rank on merit and `is_featured` stayed a guess.

WHAT IT ADDS
    * achiever_profile_views      one row per viewer per achiever per day
    * achievers.profile_view_count denormalised counter, for cheap sorting
    * achievers.quality_score      0-100, recomputed nightly from real events
    * achiever_quality_weights     how the score is composed — CONFIG, not code,
                                   the same contract as score_event_rules

TRUST vs QUALITY — these are deliberately separate columns.
    `trust_level` is a floor: has this person been verified, and may they sit
    with a minor. `quality_score` is the ordering ABOVE that floor: are they
    any good. Conflating them is what made `is_featured` meaningless. A
    background-checked achiever who cancels every session should rank last and
    still be bookable; a brand-new one should not be buried for having no
    history yet.

NEW ACHIEVERS ARE NOT PUNISHED
    A score needs QUALITY_MIN_SESSIONS completed sessions before it means
    anything; below that the column stays NULL and the browse procedure sorts
    NULLs at a neutral 65, so a newcomer lands mid-pack rather than last.
    Ranking a new achiever below a bad one would starve your own supply.

Idempotent - safe to re-run. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_quality.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file
from sqlalchemy import text

app = InitApp().app()

SP_FILE = 'database/stored_procedures/business/achiever_quality.sql'


COLUMNS = [
    ("achievers", "profile_view_count",
     "ALTER TABLE achievers ADD COLUMN profile_view_count INT NOT NULL DEFAULT 0"),
    ("achievers", "quality_score",
     "ALTER TABLE achievers ADD COLUMN quality_score DECIMAL(5,2) NULL"),
    ("achievers", "quality_updated_at",
     "ALTER TABLE achievers ADD COLUMN quality_updated_at DATETIME NULL"),
]

INDEXES = [
    ("achievers", "ix_achievers_quality",
     "CREATE INDEX ix_achievers_quality ON achievers (quality_score)"),
]

TABLES = [
    # One row per (achiever, viewer, day). The SP dedups, so a student
    # refreshing a profile twenty times is one view — otherwise the conversion
    # denominator is noise and the funnel lies.
    """
    CREATE TABLE IF NOT EXISTS achiever_profile_views (
      id          CHAR(36)    NOT NULL,
      achiever_id CHAR(36)    NOT NULL,
      viewer_id   CHAR(36)    NULL,
      source      VARCHAR(20) NULL,
      view_date   DATE        NOT NULL,
      created_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_apv_daily (achiever_id, viewer_id, view_date),
      KEY ix_apv_achiever (achiever_id, created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,

    # How quality_score is composed. In a table so the founder can retune what
    # "good" means without a deploy — exactly why score_event_rules exists.
    """
    CREATE TABLE IF NOT EXISTS achiever_quality_weights (
      metric     VARCHAR(30)  NOT NULL,
      weight     DECIMAL(5,2) NOT NULL,
      label      VARCHAR(80)  NOT NULL,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
                              ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (metric)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """,
]

# Weights sum to 100. Rating leads because it is the student's own verdict;
# reliability is weighted heavily too, since a cancelled session costs a student
# far more than a merely average one.
WEIGHT_SEED = [
    ('rating',      40, 'Average student rating, out of 5'),
    ('completion',  25, 'Sessions completed vs cancelled by the achiever'),
    ('reliability', 20, 'Sessions the achiever showed up for'),
    ('repeat',      15, 'Students who booked them more than once'),
]


def column_exists(conn, table, column):
    return bool(conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {"t": table, "c": column}).scalar())


def index_exists(conn, table, index):
    return bool(conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :i"
    ), {"t": table, "i": index}).scalar())


def run():
    with app.app_context():
        conn = db.session.connection()

        for table, column, ddl in COLUMNS:
            if column_exists(conn, table, column):
                print(f"  [skip] {table}.{column} already exists")
                continue
            conn.execute(text(ddl))
            print(f"  [ok] added {table}.{column}")

        for ddl in TABLES:
            conn.execute(text(ddl))
        print(f"  [ok] {len(TABLES)} table(s) present")

        for table, index, ddl in INDEXES:
            if index_exists(conn, table, index):
                print(f"  [skip] {index} already exists")
                continue
            conn.execute(text(ddl))
            print(f"  [ok] created {index}")

        # Weights: insert defaults, but never overwrite a value the founder has
        # retuned in the admin UI. Only the human-readable label refreshes.
        for metric, weight, label in WEIGHT_SEED:
            conn.execute(text("""
                INSERT INTO achiever_quality_weights (metric, weight, label)
                VALUES (:m, :w, :l)
                ON DUPLICATE KEY UPDATE label = VALUES(label)
            """), {"m": metric, "w": weight, "l": label})
        print(f"  [ok] seeded {len(WEIGHT_SEED)} quality weight(s)")

        db.session.commit()

        procs = apply_sql_file(SP_FILE)
        db.session.commit()
        print(f"  [ok] loaded {procs} statement(s) from {SP_FILE}")

        # First pass so the directory has something to rank by immediately.
        # Goes through db.session, not the `conn` captured above — apply_sql_file
        # commits, which closes that connection out from under us.
        res = db.session.execute(text("CALL sp_achiever_quality_recompute_all()")).fetchall()
        db.session.commit()
        scored = res[0][0] if res else 0
        print(f"  [ok] scored {scored} achiever(s) with enough history")

        print("Achiever quality migration complete.")


if __name__ == "__main__":
    run()
