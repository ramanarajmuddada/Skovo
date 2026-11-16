"""Direct credits always count, whether or not a rule row exists.

THE BUG
    sp_score_recalc summed the ledger like this:

        FROM score_events e
        JOIN score_event_rules r ON r.event_type = e.event_type
       WHERE e.user_id = p_user AND r.is_active = 1

    An INNER JOIN, so an event whose rule row is missing simply vanished from
    the total. Three event types have no rule an admin manages:

        admin_task         a task you handed out and ticked
        admin_adjustment   a manual correction from the Adjust tab
        referral_bonus     a Refer & Earn reward

    admin_score_rules.py already hides those from the Actions list as "managed
    elsewhere" -- which is right, but it made them deletable by omission. Clear
    the Actions list and every manual credit ever given stops counting.

    It was visible in three places at once: the Student Dossier showed
    "+12 Manual credit" above a score of 0, the student's own screen said
    "0 points earned" above a history listing 17, and a ticked task moved
    nothing. An admin awards points, everyone can see the award, the score
    ignores it.

THE FIX
    LEFT JOIN, and let the three bookkeeping types through on their own:

        AND (e.event_type IN (...) OR r.is_active = 1)

    Rule-driven events still need an active rule, so switching an action off
    still stops its history counting -- that behaviour is deliberate and is
    kept. Direct credits are not rules and never should have depended on one.

    Every student is recalculated afterwards, because scores cached before this
    are wrong by exactly the credits that were being dropped.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_score_direct_credits.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

DIRECT = "('admin_task', 'admin_adjustment', 'referral_bonus')"

# sp_score_recalc is NOT created here any more -- migrate_v1_stages owns it.
# That version keeps the direct-credit rule this migration introduced and adds
# the stage filter, stage_boost and expires_days. One owner per procedure.



def main():
    with app.app_context():
        # sp_score_recalc itself comes from migrate_v1_stages (see above).

        # Anyone holding one of these credits has a cached score that is wrong
        # by exactly the amount that was being dropped.
        users = db.session.execute(text(
            "SELECT DISTINCT user_id FROM score_events "
            "WHERE event_type IN " + DIRECT)).scalars().all()
        print(f"  students holding direct credits: {len(users)}")

        moved = 0
        for uid in users:
            before = db.session.execute(text(
                "SELECT score FROM readiness_scores WHERE user_id = :u"), {'u': uid}).scalar()
            db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': uid})
            after = db.session.execute(text(
                "SELECT score FROM readiness_scores WHERE user_id = :u"), {'u': uid}).scalar()
            if before != after:
                moved += 1
                print(f"    {uid}  {before} -> {after}")
        db.session.commit()
        print(f"  scores corrected: {moved}")

        drift = db.session.execute(text(
            "SELECT COUNT(*) FROM ("
            "  SELECT e.user_id, SUM(e.points) led, MAX(rs.score) cached"
            "    FROM score_events e"
            "    JOIN readiness_scores rs ON rs.user_id = e.user_id"
            "    LEFT JOIN score_event_rules r ON r.event_type = e.event_type"
            "   WHERE (e.event_type IN " + DIRECT + " OR r.is_active = 1)"
            "   GROUP BY e.user_id"
            "  HAVING GREATEST(0, LEAST(100, FLOOR(led - IFNULL(MAX(rs.decay_points),0)))) <> cached"
            ") t")).scalar()
        print(f"  students whose cache still disagrees with the ledger: {drift}")
        print("Done.")


if __name__ == '__main__':
    main()
