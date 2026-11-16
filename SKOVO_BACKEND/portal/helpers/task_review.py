"""Reviewing a student's task submission — one implementation, two portals.

The admin panel and the achiever portal both grade the same `task_submissions`
row, and until this module existed only the admin had the code for it. Copying
that code into the achiever routes would have given the platform two answers to
the same three questions — what counts as still waiting on a reviewer, what a
score is allowed to be, and what happens to the readiness ledger on approval —
which is exactly the kind of drift that makes a task show "1 to review" on one
screen and nothing on the other.

Both portals also list submissions through here, so a submission that reaches
one screen reaches the other.

No table and no procedure is added: this calls the same sp_task_submissions_*
procedures the admin route always did.
"""
import logging
from datetime import datetime

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime

logger = logging.getLogger("skovo")

# Statuses a reviewer may set. `reviewed` is "scored, not yet decided" — it
# leaves the row in the queue on purpose.
REVIEW_STATES = ('approved', 'rejected', 'reviewed')

# Statuses that still need a human. `pending` is what sp_task_submission_upsert
# writes; `submitted` and `resubmitted` are accepted because the achiever route
# counted them and rows written by older code may still carry them.
#
# `reviewed` belongs here: a scored-but-undecided submission is still work. The
# achiever's count used to omit it while the admin's counted it, so scoring a
# submission without approving it made it vanish from the achiever's card and
# stay on the admin's — the same row, two different answers.
PENDING_STATES = ('pending', 'submitted', 'resubmitted', 'reviewed')

# Terminal: the student has an answer.
FINAL_STATES = ('approved', 'rejected')

MAX_SCORE = 10
NOTES_MAX = 2000        # mentor_notes is TEXT; this is a stated cap, not a column one.


def is_pending(status):
    return (status or 'pending') in PENDING_STATES


def clamp_score(value, fallback=None):
    """`0..10`, or `fallback` when the field was not sent / is not a number.

    Clamped rather than refused: the score feeds the readiness ledger, and a
    typo in an optional field is not worth failing a review the reviewer has
    already thought about.
    """
    if value in (None, '', 'null'):
        return fallback
    try:
        return max(0, min(MAX_SCORE, int(float(value))))
    except (TypeError, ValueError):
        return fallback


def _student(user_id):
    """The submitting student, or None. One row, not a full users scan."""
    if not user_id:
        return None
    try:
        # ── SP: sp_users_get ─────────────────────────────────────────────────
        return call_proc_one('sp_users_get', str(user_id))
    except Exception as e:                          # noqa: BLE001 — best effort
        logger.error(f"task_review: could not load user {user_id}: {e}")
        return None


def _sort_key(sub):
    """Newest first, and never a TypeError.

    Sorting on `submitted_at or created_at` raised when a row had neither —
    Python refuses to order None against a datetime, and the whole listing came
    back a 500 because of one malformed row.
    """
    return sub.get('submitted_at') or sub.get('created_at') or datetime.min


def submission_dict(sub, user=None):
    """One submission as the review screens consume it."""
    name = (user or {}).get('full_name')
    return {
        'id':            sub.get('id'),
        'task_id':       sub.get('task_id'),
        'user_id':       sub.get('user_id'),
        # A submission whose student row is missing is still a submission. It
        # used to be dropped from the list entirely, which showed the reviewer
        # "no submissions yet" next to a card counting one — unreviewable work,
        # invisible for the one reason that guarantees nobody chases it.
        'user_name':     name or 'Unknown student',
        'user_email':    (user or {}).get('email'),
        'user_missing':  user is None,
        'status':        sub.get('status') or 'pending',
        'evidence_url':  sub.get('evidence_url'),
        'evidence_text': sub.get('evidence_text'),
        'mentor_score':  sub.get('mentor_score'),
        'mentor_notes':  sub.get('mentor_notes'),
        'reviewed_by':   sub.get('reviewed_by'),
        # serialize_datetime, not .isoformat(): the DB stores naive UTC and an
        # offset-less string reads as local time in the browser.
        'reviewed_at':   serialize_datetime(sub.get('reviewed_at')),
        'submitted_at':  serialize_datetime(sub.get('submitted_at')),
    }


def list_for_task(task_id):
    """Every submission on one task, newest first, with the student attached.

    ── SP: sp_task_submissions_list + sp_users_get ──
    The list procedure takes no task filter, so the batch is pulled and filtered
    here — the same thing the admin route has always done. The user lookup is
    per submission rather than a 50k-row `sp_users_list` scan: a task has tens of
    submissions, not tens of thousands, and the scan was both the slowest and the
    most fragile part of opening this panel.
    """
    subs = [
        s for s in (call_proc('sp_task_submissions_list', 200000, 0) or [])
        if s.get('task_id') == task_id
    ]
    subs.sort(key=_sort_key, reverse=True)

    seen = {}
    out = []
    for s in subs:
        uid = s.get('user_id')
        if uid not in seen:
            seen[uid] = _student(uid)
        out.append(submission_dict(s, seen[uid]))
    return out


def counts_by_task(task_ids):
    """`({task_id: total}, {task_id: pending})` over a set of task ids.

    One pass for both numbers so the two portals' cards cannot disagree.
    """
    wanted = set(task_ids or ())
    total, pending = {}, {}
    if not wanted:
        return total, pending
    for s in (call_proc('sp_task_submissions_list', 200000, 0) or []):
        tid = s.get('task_id')
        if tid not in wanted:
            continue
        total[tid] = total.get(tid, 0) + 1
        if is_pending(s.get('status')):
            pending[tid] = pending.get(tid, 0) + 1
    return total, pending


def _notify_student(sub, task, status, mentor_score, mentor_notes):
    """Tell the student their work was looked at.

    Best-effort and after the commit: the review is already saved by this point,
    and a notification failure must not turn a graded submission into a 500 that
    sends the reviewer back to grade it again.
    """
    verdict = {
        'approved': 'approved',
        'rejected': 'sent back for another go',
        'reviewed': 'reviewed',
    }.get(status, status)
    title = (task or {}).get('title') or 'your task'
    body = f"Your submission for '{title}' was {verdict}."
    if mentor_score is not None:
        body += f" Score: {mentor_score}/{MAX_SCORE}."
    if mentor_notes:
        body += f" Feedback: {mentor_notes[:200]}"
    try:
        from portal.helpers.notifications import notify_user
        notify_user(sub.get('user_id'), 'Task reviewed', body,
                    type='cohort', reference_type='task_submission',
                    reference_id=sub.get('id'))
    except Exception as e:                          # noqa: BLE001 — best effort
        logger.error(f"task_review: notify {sub.get('user_id')} failed: {e}")


# task_type -> the admin score rule an approval pays (migrate_v1_quizzes).
_APPROVAL_TYPES = ('assignment', 'reflection', 'worksheet', 'project', 'presentation',
                   'realworld', 'coding', 'capstone')


def approval_rule(task):
    t = ((task or {}).get('task_type') or '').strip().lower()
    return f"task_approved_{t if t in _APPROVAL_TYPES else 'other'}"


def _cohort_has_capstone(cohort_id):
    if not cohort_id:
        return False
    from sqlalchemy import text
    return bool(db.session.execute(text(
        "SELECT 1 FROM cohort_tasks WHERE cohort_id = :c AND task_type = 'capstone' "
        "AND deleted_at IS NULL LIMIT 1"), {'c': cohort_id}).first())


def _rubric(task):
    import json
    r = (task or {}).get('rubric_json')
    if r is None and (task or {}).get('id'):
        from sqlalchemy import text
        r = db.session.execute(text("SELECT rubric_json FROM cohort_tasks WHERE id = :i"),
                               {'i': task['id']}).scalar()
    if isinstance(r, str):
        try:
            r = json.loads(r)
        except ValueError:
            r = None
    return r or []


def rubric_scores(task, sent):
    """Validate {line label: score} against the task rubric -> (dict | None, error)."""
    if sent in (None, '', {}):
        return None, None
    if not isinstance(sent, dict):
        return None, 'Rubric scores must be an object of {line: score}.'
    lines = {l['label']: int(l['max']) for l in _rubric(task)}
    if not lines:
        return None, 'This task has no rubric.'
    out = {}
    for label, mx in lines.items():
        try:
            v = float(sent.get(label, 0))
        except (TypeError, ValueError):
            return None, f'"{label}" needs a number.'
        if not (0 <= v <= mx):
            return None, f'"{label}" must be 0–{mx}.'
        out[label] = v
    return out, None


def score_from_rubric(task, scores):
    """Rubric total scaled to the 0–MAX_SCORE mentor score."""
    lines = _rubric(task)
    mx = sum(int(l['max']) for l in lines) or 1
    return round(sum(scores.values()) * MAX_SCORE / mx)


def apply_review(sub, task, status, mentor_score, mentor_notes, reviewer_id):
    """Write the verdict, award the points, tell the student.

    `sub` is the row as sp_task_submissions_get returned it. Returns the saved
    status. Raises on a DB failure so the caller's `except` can roll back — the
    scoring and notification that follow are best-effort and never do.

    sp_task_submissions_update is a full replace, so every column it is not
    given is overwritten with NULL. Evidence, task and user are therefore passed
    back verbatim: a review must not erase the work being reviewed.
    """
    old_status = sub.get('status')

    # ── SP: sp_task_submissions_update (full replace) ────────────────────────
    call_proc_one(
        'sp_task_submissions_update',
        sub.get('id'), sub.get('task_id'), sub.get('user_id'), status,
        sub.get('evidence_url'), sub.get('evidence_text'),
        mentor_score, mentor_notes,
        reviewer_id, datetime.utcnow(),
        sub.get('created_by'), reviewer_id,
    )
    db.session.commit()

    # Points are awarded once, on the transition into `approved`. Re-approving
    # an already-approved submission must not pay twice.
    if status == 'approved' and old_status != 'approved':
        try:
            from portal.helpers import readiness_v21
            if readiness_v21.enabled():
                # Playbook v2.1: a marked cohort task is Skill evidence, paid once
                # per cohort (+2 pass, +3 at 7/10 or above) by the Score Engine.
                readiness_v21.award(sub.get('user_id'), 'cohort_task', (task or {}).get('cohort_id') or sub.get('id'),
                                    mark=mentor_score, source='achiever', actor_id=reviewer_id)
                db.session.commit()
                _notify_student(sub, task, status, mentor_score, mentor_notes)
                return status
        except Exception as e:                      # noqa: BLE001 — best effort
            logger.error(f"task_review: v21 scoring {sub.get('user_id')} failed: {e}")
            db.session.rollback()
        try:
            from portal.helpers import score
            score.recalc(sub.get('user_id'))
            # Per-type approval rule (feature-updates.md §5): admin prices
            # task_approved_<type>; 0 / inactive until then, so this pays nothing
            # by default.
            score.award(sub.get('user_id'), approval_rule(task), ref_id=sub.get('id'), recalc=False)
            # Cohort completed: on the capstone when the cohort has one, else on
            # the first approved task (cohorts made before capstones existed).
            # Keyed on the cohort, so it pays once per cohort either way.
            cohort_id = (task or {}).get('cohort_id')
            if (task or {}).get('task_type') == 'capstone' or not _cohort_has_capstone(cohort_id):
                score.award(sub.get('user_id'), score.COHORT_COMPLETED,
                            ref_id=cohort_id or sub.get('id'))
            db.session.commit()
        except Exception as e:                      # noqa: BLE001 — best effort
            logger.error(f"task_review: scoring {sub.get('user_id')} failed: {e}")
            db.session.rollback()

    _notify_student(sub, task, status, mentor_score, mentor_notes)
    return status
