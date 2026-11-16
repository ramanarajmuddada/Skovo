"""Points carry two decimals, so 0.25 and 0.75 are sayable.

WHY
    Every points column was DECIMAL(_,1) -- one decimal place. An admin typing
    0.25 got 0.2 stored, silently, with nothing on screen to say it had been
    rounded. Half points worked; quarter points did not.

    That matters most for the actions a student does often. "A quarter point
    per login" is a reasonable rule; at 0.2 it is a different rule, and at 0.5
    it is 91 points a year for opening the app.

WHAT CHANGES
    score_event_rules.points     decimal(5,1) -> decimal(5,2)
    score_events.points          decimal(5,1) -> decimal(5,2)
    readiness_scores.base_points decimal(7,1) -> decimal(7,2)

    Widening a DECIMAL scale is lossless -- 5.0 becomes 5.00 -- so no existing
    value moves and nothing needs recalculating.

    score_tasks.points stays INT. A hand-verified task is a whole number of
    points by nature, and fractional values there would only invite 0.33s that
    never add to anything.

THE DISPLAYED SCORE IS STILL A WHOLE NUMBER
    score = FLOOR(base_points - decay_points)

    Fractions accumulate in base_points and the score floors, which is how 0.5
    already behaved. Four quarter-point logins move the score by one, not by
    nothing -- but three of them move it by zero until the fourth lands. Worth
    knowing before setting a rule that small.

THE PROCEDURES
    Their DECIMAL(5,1) parameters are widened in the migrations that own them,
    not here -- sp_score_award in migrate_score_task_batches, sp_score_recalc in
    migrate_score_direct_credits, the rule procedures in
    migrate_score_metric_rules. One owner per procedure; a second copy here
    would be the same trap that silently reverted three fixes earlier.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_points_precision.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

COLUMNS = [
    ('score_event_rules', 'points',      'DECIMAL(5,2) NOT NULL DEFAULT 0.00'),
    ('score_events',      'points',      'DECIMAL(5,2) NOT NULL DEFAULT 0.00'),
    ('readiness_scores',  'base_points', 'DECIMAL(7,2) NULL DEFAULT 0.00'),
]


def main():
    with app.app_context():
        for table, col, ddl in COLUMNS:
            now = db.session.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
            ), {'t': table, 'c': col}).scalar()
            if now and now.replace(' ', '').endswith(',2)'):
                print(f"  {table}.{col} already {now}")
                continue
            db.session.execute(text(
                f"ALTER TABLE `{table}` MODIFY COLUMN `{col}` {ddl}"))
            print(f"  {table}.{col}: {now} -> {ddl.split()[0].lower()}")
        db.session.commit()

        # Widening is lossless; prove it rather than assume it.
        drift = db.session.execute(text(
            "SELECT COUNT(*) FROM score_events WHERE points <> ROUND(points, 1)")).scalar()
        total = db.session.execute(text(
            "SELECT IFNULL(SUM(points), 0) FROM score_events")).scalar()
        print(f"  ledger rows that changed value: {drift}")
        print(f"  ledger total: {total}")

        for table, col, _ in COLUMNS:
            t = db.session.execute(text(
                "SELECT COLUMN_TYPE FROM information_schema.COLUMNS "
                "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
            ), {'t': table, 'c': col}).scalar()
            print(f"  {table}.{col} is now {t}")
        print("Done.")


if __name__ == '__main__':
    main()
