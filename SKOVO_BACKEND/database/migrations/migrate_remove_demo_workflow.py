"""Demo sessions are removed: verification alone lets an achiever teach.

BEFORE   pending -> probation (3 free demo sessions, reviewed) -> active
AFTER    pending -> active

WHAT THIS DOES
  * Every achiever still on 'probation' has already had their documents verified
    by an admin, so they become 'active'. Each move is written to
    achiever_state_events, and the old values are kept in
    achiever_demo_removal_backup so the move can be undone.
  * The "In probation" filter on the admin queue is switched off.
  * The three demo-only procedures are dropped.

WHAT IT LEAVES ALONE
  No column or row is deleted. achiever_sessions.is_demo, cohorts.is_demo,
  achievers.demo_sessions_* and the review flags are history: past free demo
  classes stay recorded as such and stay out of earnings and standing.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_remove_demo_workflow.py

Rollback (puts the achievers this moved back on probation; the previous code
must be redeployed and its stored procedures reloaded as well):
    python database/migrations/migrate_remove_demo_workflow.py --rollback
"""
import sys

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

REASON = 'Demo sessions removed - verified achiever made active'
UNDO_REASON = 'Rollback of demo session removal'

BACKUP = """
CREATE TABLE IF NOT EXISTS `achiever_demo_removal_backup` (
  `achiever_id`            CHAR(36)    NOT NULL,
  `old_state`              VARCHAR(20) NOT NULL,
  `demo_sessions_done`     INT         NULL,
  `demo_sessions_required` INT         NULL,
  `demo_submitted_at`      DATETIME    NULL,
  `migrated_at`            DATETIME    NOT NULL,
  PRIMARY KEY (`achiever_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
"""

EVENT = text("""
    INSERT INTO `achiever_state_events`
        (id, achiever_id, from_state, to_state, reason, actor_id, actor_role, created_at)
    VALUES (UUID(), :a, :f, :t, :r, NULL, 'system', UTC_TIMESTAMP())
""")

MOVE = text("""
    UPDATE `achievers`
       SET state = :t, state_reason = :r, state_changed_at = UTC_TIMESTAMP(),
           state_changed_by = NULL, updated_at = UTC_TIMESTAMP()
     WHERE id = :a AND state = :f
""")


def _move(achiever_id, from_state, to_state, reason):
    n = db.session.execute(MOVE, {'a': achiever_id, 'f': from_state, 't': to_state, 'r': reason}).rowcount
    if n:
        db.session.execute(EVENT, {'a': achiever_id, 'f': from_state, 't': to_state, 'r': reason})
    return n


def forward():
    db.session.execute(text(BACKUP))
    db.session.execute(text("""
        INSERT IGNORE INTO `achiever_demo_removal_backup`
        SELECT id, state, demo_sessions_done, demo_sessions_required,
               demo_submitted_at, UTC_TIMESTAMP()
          FROM `achievers` WHERE state = 'probation'
    """))
    ids = [r[0] for r in db.session.execute(
        text("SELECT id FROM `achievers` WHERE state = 'probation'")).fetchall()]
    moved = sum(_move(i, 'probation', 'active', REASON) for i in ids)

    db.session.execute(text(
        "UPDATE `master_achiever_queue_filter` SET is_active = 0 WHERE value = 'probation'"))
    db.session.execute(text(
        "UPDATE `score_metrics` SET description = 'Paid mentor sessions finished.' "
        " WHERE description = 'Paid mentor sessions finished. Demos excluded.'"))
    db.session.commit()

    for name in ('sp_achiever_demo_complete', 'sp_achiever_probation_review',
                 'sp_achiever_set_demo_target'):
        db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
    db.session.commit()
    print(f'achievers moved from probation to active: {moved}')


def rollback():
    rows = db.session.execute(text(
        "SELECT achiever_id, old_state FROM `achiever_demo_removal_backup`")).fetchall()
    # Only those still active: anyone suspended or banned since keeps that.
    undone = sum(_move(a, 'active', old, UNDO_REASON) for a, old in rows)
    db.session.execute(text(
        "UPDATE `master_achiever_queue_filter` SET is_active = 1 WHERE value = 'probation'"))
    db.session.commit()
    print(f'achievers put back: {undone} of {len(rows)} recorded')


def main():
    with app.app_context():
        rollback() if '--rollback' in sys.argv else forward()


if __name__ == '__main__':
    main()
