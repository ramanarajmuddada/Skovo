"""One set-based recalculation for many students, and the nightly sweep uses it.

THE PROBLEM
    sp_score_rules_run writes ledger rows and then stops. It collects every
    student it touched in tmp_score_touched and throws the list away. Nothing
    updates readiness_scores.

    The number still looks right, because sp_score_recalc is called on every
    page load -- see portal/routes/Readiness/score.py and
    portal/routes/Dashboard/dashboard.py. The read path is doing the sweep's
    job, which means:

      * a student who earned points overnight sees nothing until they open a
        page, so a notification or an admin list reads the stale number
      * every dashboard view re-sums that student's whole ledger AND writes the
        result back. A write on every read. Invisible at 150 ledger rows;
        the busiest thing in the database at 10,000 students.

    Fixing it by looping `CALL sp_score_recalc` over the touched set would be
    10,000 procedure calls in one job. That is the same mistake one level up.

THE FIX
    sp_score_recalc_bulk -- the same arithmetic as sp_score_recalc, expressed
    as four set-based statements over a set of users instead of one:

        base_points  one GROUP BY over score_events
        score        FLOOR(base - decay), clamped 0..100
        level        resolved from readiness_levels, never a literal
        counters     cohorts_completed / tasks_completed

    p_scope = 'touched'  only the users in tmp_score_touched (the nightly sweep)
    p_scope = 'all'      every user holding a ledger row (a rule change, a
                         points-value edit, a repair)

    sp_score_rules_run calls it once, at the end, after every rule has been
    applied -- so one pass over the changed students rather than one pass per
    student per rule. That CALL lives in migrate_score_metric_rules.py, which
    owns that procedure; this migration only creates sp_score_recalc_bulk and
    reports whether the sweep is wired to it.

WHAT IS DELIBERATELY NOT CHANGED
    The per-request sp_score_recalc calls stay. They are now a safety net rather
    than the mechanism: correct but redundant. Removing them is a separate
    change that wants its own testing, because a stale cached score is a
    user-visible bug and the read path is the last thing standing between a
    missed sweep and a wrong number on screen.

    0 and 100 stay as literals. The readiness score is 0-100 by definition of
    the product, not by configuration -- there is no setting to read.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_bulk_recalc.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

# The three bookkeeping credits that have no admin-managed rule row. Kept in
# one place here; sp_score_recalc (migrate_score_direct_credits) holds the same
# list and the guard test asserts the two agree.
DIRECT = "('admin_task', 'admin_adjustment', 'referral_bonus')"

SCORE_EXPR = "GREATEST(0, LEAST(100, FLOOR(rs.base_points - IFNULL(rs.decay_points, 0))))"

# sp_score_recalc_bulk is NOT created here any more -- migrate_v1_stages owns
# it. That version keeps this arithmetic and adds the stage filter and the
# stage_boost credit. One owner per procedure.



def main():
    with app.app_context():
        # sp_score_recalc_bulk itself comes from migrate_v1_stages (see above).

        # sp_score_rules_run is NOT modified here. migrate_score_metric_rules
        # owns it and its definition carries the CALL below. Patching a
        # procedure owned elsewhere is the same trap as copying one: whichever
        # migration ran last would decide whether the sweep rebuilds at all.
        body = db.session.execute(text(
            "SELECT ROUTINE_DEFINITION FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_score_rules_run'"
        )).scalar() or ''
        if not body:
            print("  sp_score_rules_run not installed yet -- run "
                  "migrate_score_metric_rules.py")
        elif 'sp_score_recalc_bulk' in body:
            print("  sp_score_rules_run rebuilds what it touches")
        else:
            print("  WARNING: sp_score_rules_run does not call sp_score_recalc_bulk. "
                  "Re-run migrate_score_metric_rules.py -- it owns that procedure.")

        # Prove it against the per-user procedure everyone already trusts: run
        # the bulk pass over everyone, then check no cached score disagrees with
        # what the ledger says it should be.
        db.session.execute(text("CALL sp_score_recalc_bulk('all')"))
        db.session.commit()
        rebuilt = db.session.execute(text("SELECT @score_rebuilt")).scalar()
        print(f"  students rebuilt: {rebuilt}")

        drift = db.session.execute(text(
            "SELECT COUNT(*) FROM ("
            "  SELECT e.user_id,"
            "         SUM(e.points) led,"
            "         MAX(rs.score) cached,"
            "         MAX(IFNULL(rs.decay_points,0)) dec_pts"
            "    FROM score_events e"
            "    JOIN readiness_scores rs ON rs.user_id = e.user_id"
            "    LEFT JOIN score_event_rules r ON r.event_type = e.event_type"
            "   WHERE (e.event_type IN " + DIRECT + " OR r.is_active = 1)"
            "   GROUP BY e.user_id"
            "  HAVING GREATEST(0, LEAST(100, FLOOR(led - dec_pts))) <> cached"
            ") t")).scalar()
        print(f"  students whose cached score disagrees with the ledger: {drift}")

        blank = db.session.execute(text(
            "SELECT COUNT(*) FROM readiness_scores WHERE `level` = '' OR `level` IS NULL"
        )).scalar()
        print(f"  students with no level resolved: {blank}")
        print("Done.")


if __name__ == '__main__':
    main()
