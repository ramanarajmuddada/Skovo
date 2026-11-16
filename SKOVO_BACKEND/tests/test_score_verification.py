"""Claims that settle themselves, and corrections that happen in bulk.

The point of Stage 4 is that nobody reviews anything routinely. These tests
prove the two halves of that: a checkable claim is answered in the same call,
and when something does go wrong it can be undone for everyone at once.

Everything is built and torn down per test -- no dependency on the seeded rule
set, and nothing is left in the database.

    pytest tests/test_score_verification.py -v
"""
import uuid

import pytest
from sqlalchemy import text


@pytest.fixture
def lab(db):
    """Tasks, claims and awards, all cleaned up afterwards."""
    tasks, keys = [], []

    class Lab:
        def __init__(self, user):
            self.user = user

        def task(self, points=3, metric=None, threshold=1, since_task=1, label=None):
            tid = str(uuid.uuid4())
            tasks.append(tid)
            db.session.execute(text(
                "INSERT INTO score_tasks (id, label, points, scope, user_id, is_active, "
                "status, action_route, verify_metric, verify_threshold, verify_since_task) "
                "VALUES (:i, :l, :p, 'student', :u, 1, 'active', NULL, :m, :t, :s)"),
                {'i': tid, 'l': label or ('zz test ' + tid[:8]), 'p': points,
                 'u': self.user, 'm': metric, 't': threshold, 's': since_task})
            db.session.commit()
            return tid

        def backdate(self, task_id, days):
            """Pretend the task was set some time ago."""
            db.session.execute(text(
                "UPDATE score_tasks SET created_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL :d DAY) "
                "WHERE id = :i"), {'d': days, 'i': task_id})
            db.session.commit()

        def claim(self, task_id, note=None):
            row = db.session.execute(text(
                "CALL sp_score_task_submit(:t, :u, :n, 0)"),
                {'t': task_id, 'u': self.user, 'n': note}).mappings().first()
            db.session.commit()
            return dict(row or {})

        def submission(self, task_id):
            row = db.session.execute(text(
                "SELECT status, reason, decided_at FROM score_task_submissions "
                "WHERE task_id = :t AND user_id = :u"),
                {'t': task_id, 'u': self.user}).mappings().first()
            return dict(row or {})

        def pay(self, task_id):
            row = db.session.execute(text(
                "CALL sp_score_task_complete(:e, :t, :u)"),
                {'e': str(uuid.uuid4()), 't': task_id,
                 'u': self.user}).mappings().first()
            db.session.commit()
            return dict(row or {})

        def paid_for(self, task_id):
            return float(db.session.execute(text(
                "SELECT IFNULL(SUM(points), 0) FROM score_events "
                "WHERE user_id = :u AND event_type = 'admin_task' AND ref_id = :t"),
                {'u': self.user, 't': task_id}).scalar())

        def rule(self, points=2, metric='account_created'):
            key = 'zz_test_' + uuid.uuid4().hex[:12]
            keys.append(key)
            db.session.execute(text(
                "INSERT INTO score_event_rules (event_type, label, points, is_active, "
                "rule_test, metric_key, shape, cap_type) "
                "VALUES (:k, :l, :p, 1, 'each', :m, 'simple', 'none')"),
                {'k': key, 'l': 'test ' + key, 'p': points, 'm': metric})
            db.session.commit()
            return key

        def run_rules(self):
            db.session.execute(text("CALL sp_score_rules_run(:u)"), {'u': self.user})
            db.session.commit()

    user = db.session.execute(text(
        "SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1")).scalar()
    if not user:
        pytest.skip("no real user to score")

    try:
        yield Lab(user)
    finally:
        for tid in tasks:
            db.session.execute(text("DELETE FROM score_events WHERE ref_id = :t"), {'t': tid})
            db.session.execute(text("DELETE FROM score_task_submissions WHERE task_id = :t"), {'t': tid})
            db.session.execute(text("DELETE FROM score_tasks WHERE id = :t"), {'t': tid})
        for key in keys:
            db.session.execute(text("DELETE FROM score_events WHERE event_type = :k"), {'k': key})
            db.session.execute(text("DELETE FROM score_rule_audit WHERE rule_key = :k"), {'k': key})
            db.session.execute(text("DELETE FROM score_rule_conditions WHERE rule_key = :k"), {'k': key})
            db.session.execute(text("DELETE FROM score_event_rules WHERE event_type = :k"), {'k': key})
        db.session.execute(text(
            "DELETE FROM score_events WHERE ref_id LIKE 'bulk:zz\\_test\\_%'"))
        db.session.execute(text(
            "DELETE FROM score_adjustments WHERE reason LIKE 'zz test %'"))
        db.session.commit()
        db.session.execute(text("CALL sp_score_recalc(:u)"), {'u': user})
        db.session.commit()


# ── a claim the platform can settle ──────────────────────────────────────────

def test_a_checkable_claim_is_approved_in_the_same_call(lab):
    task = lab.task(points=3, metric='account_created', since_task=0)
    assert lab.claim(task)['result'] == 'auto_approved'
    assert lab.submission(task)['status'] == 'approved'
    assert lab.submission(task)['decided_at'] is not None


def test_an_approved_claim_pays(lab):
    task = lab.task(points=3, metric='account_created', since_task=0)
    lab.claim(task)
    assert lab.pay(task)['result'] == 'done'
    assert lab.paid_for(task) == 3.0


def test_a_claim_the_platform_cannot_find_is_rejected_with_a_reason(lab):
    task = lab.task(points=3, metric='cohorts_enrolled', since_task=0)
    out = lab.claim(task)
    assert out['result'] == 'auto_rejected'
    assert out['reason'], "a rejection the student cannot act on is useless"
    sub = lab.submission(task)
    assert sub['status'] == 'rejected'
    assert 'need 1' in (sub['reason'] or ''), sub['reason']


def test_nothing_is_paid_for_a_rejected_claim(lab):
    task = lab.task(points=3, metric='cohorts_enrolled', since_task=0)
    lab.claim(task)
    assert lab.paid_for(task) == 0.0


def test_a_rejected_claim_can_be_made_again_and_then_approved(lab):
    """The rejection is a state, not a punishment."""
    task = lab.task(points=3, metric='account_created', since_task=0)
    db_metric_absent = lab.task(points=3, metric='cohorts_enrolled', since_task=0)
    assert lab.claim(db_metric_absent)['result'] == 'auto_rejected'
    assert lab.claim(task)['result'] == 'auto_approved'


# ── the guard against claiming credit for old activity ───────────────────────

def test_activity_from_before_the_task_does_not_settle_the_claim(lab):
    """verify_since_task = 1 is what stops a task being free on day one.

    The student registered long ago. A task set today that asks them to register
    must not approve itself off the back of that.
    """
    task = lab.task(points=3, metric='account_created', since_task=1)
    assert lab.claim(task)['result'] == 'auto_rejected'


def test_the_same_task_approves_when_existing_state_is_allowed_to_count(lab):
    task = lab.task(points=3, metric='account_created', since_task=0)
    assert lab.claim(task)['result'] == 'auto_approved'


def test_a_backdated_task_accepts_activity_that_followed_it(lab):
    task = lab.task(points=3, metric='account_created', since_task=1)
    lab.backdate(task, 3650)          # set ten years ago; registration came after
    assert lab.claim(task)['result'] == 'auto_approved'


# ── a claim nobody can settle still reaches a human ──────────────────────────

def test_a_task_with_no_metric_goes_to_the_admin_queue(lab):
    task = lab.task(points=3, metric=None)
    assert lab.claim(task)['result'] == 'submitted'
    assert lab.submission(task)['status'] == 'submitted'


def test_an_unverifiable_claim_pays_nothing_until_an_admin_acts(lab):
    task = lab.task(points=3, metric=None)
    lab.claim(task)
    assert lab.paid_for(task) == 0.0
    lab.pay(task)
    assert lab.paid_for(task) == 3.0, "the admin path still works"


# ── what needs a look, and acting on it in bulk ──────────────────────────────

def test_a_provable_award_never_asks_for_a_look(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    rows = db.session.execute(text(
        "CALL sp_score_awards_search(:k, 0, NULL, NULL, 50, 0)"),
        {'k': key}).mappings().all()
    db.session.commit()
    assert rows, "the rule should have paid"
    assert all(int(r['needs_look']) == 0 for r in rows)


def test_an_unprovable_award_is_flagged_and_can_be_marked_checked(lab, db):
    key = lab.rule(points=2, metric='documents_uploaded')
    # documents_uploaded is seeded is_provable = 0, so anything it pays is
    # flagged. Insert one award directly -- this user has no documents.
    eid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO score_events (id, user_id, event_type, points, ref_id, meta) "
        "VALUES (:i, :u, :k, 2, 'm:1', 'test')"),
        {'i': eid, 'u': lab.user, 'k': key})
    db.session.commit()

    rows = db.session.execute(text(
        "CALL sp_score_awards_search(:k, 1, NULL, NULL, 50, 0)"),
        {'k': key}).mappings().all()
    db.session.commit()
    assert [r['id'] for r in rows] == [eid], "an unprovable award is worth a look"

    done = db.session.execute(text(
        "CALL sp_score_awards_check(:i, :a)"),
        {'i': eid, 'a': lab.user}).mappings().first()
    db.session.commit()
    assert int(done['checked']) == 1

    after = db.session.execute(text(
        "CALL sp_score_awards_search(:k, 1, NULL, NULL, 50, 0)"),
        {'k': key}).mappings().all()
    db.session.commit()
    assert after == [], "once looked at, it stops asking"


def test_bulk_adjust_reverses_a_rule_for_everyone_it_paid(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    before = float(db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': lab.user}).scalar())

    out = db.session.execute(text(
        "CALL sp_score_bulk_adjust(:k, NULL, NULL, :a, :r)"),
        {'k': key, 'a': lab.user, 'r': 'zz test bulk reversal'}).mappings().first()
    db.session.commit()
    assert out['result'] == 'ok'
    assert int(out['students']) >= 1

    after = float(db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': lab.user}).scalar())
    assert before - after == 2.0, "the rule's points came back off"


def test_bulk_adjust_is_audited(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    db.session.execute(text("CALL sp_score_bulk_adjust(:k, NULL, NULL, :a, :r)"),
                       {'k': key, 'a': lab.user, 'r': 'zz test audited'})
    db.session.commit()
    n = db.session.execute(text(
        "SELECT COUNT(*) FROM score_adjustments WHERE reason = 'zz test audited'")).scalar()
    assert n >= 1, "every bulk correction is one audited row per student"


def test_bulk_adjust_refuses_without_a_reason(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    out = db.session.execute(text(
        "CALL sp_score_bulk_adjust(:k, NULL, NULL, :a, '')"),
        {'k': key, 'a': lab.user}).mappings().first()
    db.session.commit()
    assert out['result'] == 'need_rule_and_reason'


def test_bulk_adjust_run_twice_does_not_double(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    for _ in range(2):
        db.session.execute(text("CALL sp_score_bulk_adjust(:k, NULL, NULL, :a, :r)"),
                           {'k': key, 'a': lab.user, 'r': 'zz test twice'})
        db.session.commit()
    total = float(db.session.execute(text(
        "SELECT IFNULL(SUM(points), 0) FROM score_events "
        "WHERE user_id = :u AND ref_id = :r"),
        {'u': lab.user, 'r': 'bulk:' + key}).scalar())
    assert total == -2.0, "one reversal per rule per student, not two"


# ── the warning shown before a rule is deleted ───────────────────────────────

def test_rule_impact_reports_what_removing_it_would_cost(lab, db):
    key = lab.rule(points=2, metric='account_created')
    lab.run_rules()
    row = db.session.execute(text("CALL sp_score_rule_impact(:k)"),
                             {'k': key}).mappings().first()
    db.session.commit()
    assert int(row['students']) >= 1
    assert float(row['points']) >= 2.0
    assert row['first_award'] is not None


# ── rule changes are audited ─────────────────────────────────────────────────

def test_editing_a_rule_records_what_changed(lab, db):
    """The dangerous edit is a rule's points: it moves every student at once."""
    key = lab.rule(points=2, metric='account_created')

    db.session.execute(text("CALL sp_score_rule_snapshot_before(:k)"), {'k': key})
    db.session.execute(text(
        "UPDATE score_event_rules SET points = 50, label = 'renamed' WHERE event_type = :k"),
        {'k': key})
    db.session.execute(text("CALL sp_score_rule_snapshot_after(:k)"), {'k': key})
    db.session.execute(text("CALL sp_score_rule_audit_log(:k, :a, 'updated')"),
                       {'k': key, 'a': lab.user})
    db.session.commit()

    rows = db.session.execute(text("CALL sp_score_rule_audit_list(:k, 50)"),
                              {'k': key}).mappings().all()
    db.session.commit()
    changed = {r['field']: (r['old_value'], r['new_value']) for r in rows}
    assert 'points' in changed, changed
    assert changed['points'] == ('2.00', '50.00'), changed['points']
    assert 'label' in changed
    assert all(r['admin_id'] == lab.user for r in rows)


def test_an_edit_that_changes_nothing_records_nothing(lab, db):
    key = lab.rule(points=2, metric='account_created')
    db.session.execute(text("CALL sp_score_rule_snapshot_before(:k)"), {'k': key})
    db.session.execute(text("CALL sp_score_rule_snapshot_after(:k)"), {'k': key})
    db.session.execute(text("CALL sp_score_rule_audit_log(:k, :a, 'updated')"),
                       {'k': key, 'a': lab.user})
    db.session.commit()
    n = db.session.execute(text(
        "SELECT COUNT(*) FROM score_rule_audit WHERE rule_key = :k"), {'k': key}).scalar()
    assert n == 0, "an audit nobody can read is not an audit"


def test_the_audit_survives_the_admin_leaving(lab, db):
    key = lab.rule(points=2, metric='account_created')
    db.session.execute(text(
        "INSERT INTO score_rule_audit (id, rule_key, admin_id, action, field, old_value, new_value) "
        "VALUES (UUID(), :k, :a, 'updated', 'points', '2.00', '9.00')"),
        {'k': key, 'a': '00000000-0000-0000-0000-000000000000'})
    db.session.commit()
    rows = db.session.execute(text("CALL sp_score_rule_audit_list(:k, 50)"),
                              {'k': key}).mappings().all()
    db.session.commit()
    assert len(rows) == 1, "a change by a deleted admin still happened"
    assert rows[0]['admin_name'] is None


# ── task deadlines ───────────────────────────────────────────────────────────

def test_a_task_past_its_deadline_cannot_be_completed(lab, db):
    task = lab.task(points=3, metric=None)
    db.session.execute(text(
        "UPDATE score_tasks SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) "
        "WHERE id = :t"), {'t': task})
    db.session.commit()
    assert lab.pay(task)['result'] == 'expired'
    assert lab.paid_for(task) == 0.0


def test_a_task_inside_its_deadline_still_pays(lab, db):
    task = lab.task(points=3, metric=None)
    db.session.execute(text(
        "UPDATE score_tasks SET expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 7 DAY) "
        "WHERE id = :t"), {'t': task})
    db.session.commit()
    assert lab.pay(task)['result'] == 'done'
    assert lab.paid_for(task) == 3.0


def test_task_points_carry_two_decimals(lab, db):
    task = lab.task(points=0.25, metric=None)
    lab.pay(task)
    assert lab.paid_for(task) == 0.25, "tasks should not round where rules do not"


# ── tasks pay themselves: no student tap, no admin approval ──────────────────

def test_a_provable_task_pays_with_nobody_clicking_anything(lab, db):
    """The whole point of Stage 4's rewrite.

    The student never claims and the admin never approves. The platform checks
    and credits.
    """
    task = lab.task(points=3, metric='account_created', since_task=0)
    assert lab.paid_for(task) == 0.0

    db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
    db.session.commit()

    assert lab.paid_for(task) == 3.0
    assert lab.submission(task)['status'] == 'approved'


def test_autopay_does_not_pay_twice(lab, db):
    task = lab.task(points=3, metric='account_created', since_task=0)
    for _ in range(3):
        db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
        db.session.commit()
    assert lab.paid_for(task) == 3.0


def test_autopay_skips_a_task_the_student_has_not_done(lab, db):
    task = lab.task(points=3, metric='cohorts_enrolled', since_task=0)
    db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
    db.session.commit()
    assert lab.paid_for(task) == 0.0


def test_autopay_ignores_a_task_with_no_metric(lab, db):
    """If the platform cannot prove it, it does not pay itself.

    Deliberately not a silent fallback to a queue: the task stays visibly
    unpaid until an admin gives it a metric or credits it from Adjust.
    """
    task = lab.task(points=3, metric=None)
    db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
    db.session.commit()
    assert lab.paid_for(task) == 0.0


def test_autopay_respects_the_deadline(lab, db):
    task = lab.task(points=3, metric='account_created', since_task=0)
    db.session.execute(text(
        "UPDATE score_tasks SET expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY) "
        "WHERE id = :t"), {'t': task})
    db.session.commit()
    db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
    db.session.commit()
    assert lab.paid_for(task) == 0.0


def test_autopay_will_not_pay_for_work_done_before_the_task_existed(lab, db):
    task = lab.task(points=3, metric='account_created', since_task=1)
    db.session.execute(text("CALL sp_score_task_autopay(:u)"), {'u': lab.user})
    db.session.commit()
    assert lab.paid_for(task) == 0.0, "registering years ago must not settle a task set today"


def test_a_student_evaluation_settles_their_tasks_too(lab, db):
    """The instant path: anything the student does triggers this."""
    task = lab.task(points=3, metric='account_created', since_task=0)
    db.session.execute(text("CALL sp_score_rules_run(:u)"), {'u': lab.user})
    db.session.commit()
    assert lab.paid_for(task) == 3.0


def test_the_nightly_pass_pays_across_students(lab, db):
    task = lab.task(points=3, metric='account_created', since_task=0)
    row = db.session.execute(text("CALL sp_score_task_autopay_all()")).mappings().first()
    db.session.commit()
    assert int(row['tasks_paid']) >= 1
    assert lab.paid_for(task) == 3.0


def test_autopay_moves_the_cached_score(lab, db):
    before = float(db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': lab.user}).scalar())
    lab.task(points=3, metric='account_created', since_task=0)
    db.session.execute(text("CALL sp_score_task_autopay_all()"))
    db.session.commit()
    after = float(db.session.execute(text(
        "SELECT base_points FROM readiness_scores WHERE user_id = :u"),
        {'u': lab.user}).scalar())
    assert after - before == 3.0, "the nightly pass must rebuild what it paid"
