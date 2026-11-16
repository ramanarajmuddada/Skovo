"""
Readiness Score Engine — award helper.

The score is an append-only ledger: every point a student earns is a row in
score_events, and the score is always clamp(0, 100, base_points - decay_points).
Point values live in score_event_rules so admins can retune them without a
deploy.

Call `award(...)` from wherever the action actually completes. Awards are
idempotent per (user, event_type, ref_id) — pass the id of the thing that
earned the points (task id, cohort id, document id) so a retry or a
double-approval never pays twice.

Scoring must never break the action that triggered it, so every failure here is
logged and swallowed.
"""
import logging
import uuid

from portal.helpers.sp import call_proc_one

logger = logging.getLogger("skovo")

# The v1 signal set (Playbook §5.7). Keep in sync with score_event_rules,
# which migrate_score_engine.py seeds.
PROFILE_COMPLETED = 'profile_completed'            # +5   once
COLLEGE_SAVED = 'college_saved'                    # +0   10 lifetime
COLLEGE_VIEWED = 'college_viewed'                  # +0   daily
COHORT_ATTENDED = 'cohort_attended'                # +2   per cohort
COHORT_COMPLETED = 'cohort_completed'              # +8   per cohort
COHORT_REPEAT_WEEK = 'cohort_repeat_week'          # +2   weekly
COMMUNITY_POST = 'community_post'                  # +0.5 3/day
COMMUNITY_REACTIONS = 'community_reactions'        # +0.5 daily
COMMUNITY_JOIN = 'community_join'                  # +1   5 lifetime
COMMUNITY_CREATED = 'community_created'            # +2   5 lifetime (Scope §6.2)
MARKET_REDEEM = 'market_redeem'                    # +2   5/month
DOCUMENT_UPLOADED = 'document_uploaded'            # +2   5 lifetime
APPLICATION_SUBMITTED = 'application_submitted'    # +3   per apply
OPPORTUNITY_SHORTLISTED = 'opportunity_shortlisted'  # +10 per shortlist
ASSESSMENT_COMPLETED = 'assessment_completed'      # graded, set via SP

# Reactions threshold that earns the community_reactions signal.
REACTION_MILESTONE = 5

# Vault folders that must all be filled to earn PROFILE_COMPLETED (spec §4.6).
VAULT_FOLDERS = ('id_proof', 'marksheet', 'certificate', 'resume')


# sp_score_award results that mean a ledger row was actually written. A
# 'capped' row carries 0 points but still moves the cached row's derived state
# (level, the legacy cohort/task counters, last_event_at), so it has to trigger
# the rebuild too — keying the rebuild on "points > 0" left the cached score
# stale after every zero-point signal, which is most of the college and
# community set.
_WROTE_A_ROW = ('awarded', 'capped')


def evaluate(user_id):
    """Re-evaluate every admin-configured rule for one student, now.

    This is the wire between the product and the rule builder.

    The 17 award() call sites below each name a fixed event_type -- a constant
    written into the code years before the rule builder existed. sp_score_award
    looks that key up in score_event_rules and pays nothing when there is no
    row, which is the normal state now: an admin builds rules out of metrics
    ("Documents uploaded", "Cohorts enrolled"), not out of these keys. So every
    hook was firing and awarding 0.

    Rather than map each hook to a rule -- brittle, and it would only ever cover
    the "each time" shape -- the hook simply tells the engine *this student just
    did something*. sp_score_rules_run re-evaluates that one student against
    every active rule, whatever its shape, and its awards are idempotent on
    ref_id, so re-evaluating costs nothing when nothing has changed.

    That is what makes a combo pay in the same second: the upload that completes
    "register + login + join a cohort" triggers an evaluation, all three
    conditions now pass, and the rule pays -- without the upload knowing the
    rule exists.

    Cost is one pass per active rule for one student. Never raises.
    """
    if not user_id:
        return 0
    try:
        # ── SP: sp_score_rules_run — p_user scopes it to this student ─────
        res = call_proc_one('sp_score_rules_run', user_id) or {}
        return int(res.get('rules_run') or 0)
    except Exception as e:
        logger.error(f"rule evaluation failed (user={user_id}): {e}")
        return 0


# Playbook v2.1: once the new engine is on, everyday activity earns Streak Points
# only, and an employer shortlist is checked readiness proof. Nothing else here
# may ever write readiness (playbook rule 1).
_V21_SP = {
    COMMUNITY_POST: 'community_post', COMMUNITY_REACTIONS: 'post_reactions', COMMUNITY_JOIN: 'community_join',
    COHORT_ATTENDED: 'cohort_attended', DOCUMENT_UPLOADED: 'document_upload',
    APPLICATION_SUBMITTED: 'opportunity_apply', PROFILE_COMPLETED: 'profile_complete',
}
_V21_READINESS = {OPPORTUNITY_SHORTLISTED: 'shortlisted'}


def _route_v21(user_id, event_type, ref_id):
    """None while v2.1 is off (the old engine runs); otherwise the points added."""
    try:
        from portal.helpers import readiness_v21 as rv
        if not rv.enabled():
            return None
        if event_type in _V21_SP:
            from portal.helpers import streak_points
            return streak_points.award(user_id, _V21_SP[event_type], ref_id=ref_id)
        if event_type in _V21_READINESS:
            return (rv.award(user_id, _V21_READINESS[event_type], ref_id, source='app') or {}).get('applied', 0)
        return 0
    except Exception as e:                                   # noqa: BLE001
        logger.error(f"score._route_v21({user_id}, {event_type}) failed: {e}")
        return 0


def award(user_id, event_type, ref_id=None, meta=None, recalc=True):
    """Append a score event, re-evaluate the student's rules, rebuild the score.

    Returns the number of points awarded by the legacy event_type (0 if no rule
    row exists for it, which is the usual case). Points earned by admin rules in
    the same call are not counted in the return value -- callers only use it to
    decide whether to mention the award, and `recalc` reports the real total.

    Never raises — the caller's own work is what matters.
    """
    if not user_id or not event_type:
        return 0
    routed = _route_v21(user_id, event_type, ref_id)
    if routed is not None:
        return routed
    try:
        # ── SP: sp_score_award (idempotent on ref_id) ─────────────────────
        res = call_proc_one('sp_score_award', str(uuid.uuid4()), user_id, event_type,
                            str(ref_id) if ref_id is not None else None, meta) or {}
        awarded = int(res.get('awarded') or 0)
        wrote = (res.get('result') or '') in _WROTE_A_ROW

        # The student just did something. Whatever the admin has configured
        # about it pays now, not at 02:30 tomorrow.
        #
        # Gated on `recalc` because evaluating also rebuilds: a caller passing
        # recalc=False is batching several awards and will rebuild once at the
        # end, and doing it here anyway would both break that contract and do
        # the expensive half of the work N times.
        before = _score_of(user_id) if recalc else None
        evaluated = evaluate(user_id) if recalc else 0

        if recalc and (wrote or evaluated):
            # ── SP: sp_score_recalc ──────────────────────────────────────
            row = call_proc_one('sp_score_recalc', user_id) or {}
            _tell_them(user_id, before, int(row.get('score') or 0), row.get('level'))
        return awarded
    except Exception as e:
        logger.error(f"score award failed (user={user_id} type={event_type}): {e}")
        return 0


def _score_of(user_id):
    try:
        row = call_proc_one('sp_readiness_score_get', user_id) or {}
        return int(row.get('score') or 0), row.get('level')
    except Exception:
        return None


def _tell_them(user_id, before, after, level):
    """Tell the student their score moved, without becoming noise.

    Only on a whole-point change, because the score itself is a whole number --
    a 0.2 login banks silently until the fourth one tips it over, and a message
    saying "your score is still 23" four times a week would train them to ignore
    the next one.

    A level change is always worth saying. Never raises: a missed notification
    must not roll back the points.
    """
    if before is None or after is None:
        return
    old_score, old_level = before
    if old_score is None or after == old_score:
        return
    try:
        from portal.helpers.notifications import notify_user
        gained = after - old_score
        if level and level != old_level:
            notify_user(user_id, f"You reached {level}",
                        f"Your readiness score is now {after}.",
                        type='system', reference_type='readiness_score')
        elif gained > 0:
            notify_user(user_id, f"+{gained} readiness points",
                        f"Your readiness score is now {after}.",
                        type='system', reference_type='readiness_score')
    except Exception as e:
        logger.error(f"score notification failed (user={user_id}): {e}")


def award_cohort_attendance(user_id, cohort_id, recalc=True):
    """Score a verified cohort check-in: +2, and +2 more for a repeat that week.

    `cohort_repeat_week` is in the spec table and in score_event_rules, but no
    caller ever raised it, so the signal was config with nothing behind it.
    It belongs here rather than at each of the three attendance call sites
    (student self check-in, achiever bulk mark, admin booking edit) so all
    three pay the same.

    Returns the total points awarded across both signals.
    """
    if not user_id or not cohort_id:
        return 0

    # Career streak (feature-updates.md §3): attending is a qualifying action
    # when admin has switched it on. Best effort; never blocks the check-in.
    from portal.helpers import engagement
    engagement.track(user_id, 'session_attended')

    # Asked before the new row lands — and it excludes this cohort anyway, so
    # the answer does not depend on which order the two run in.
    prior_this_week, week_key = 0, None
    try:
        # ── SP: sp_score_cohort_week_count ────────────────────────────────
        # The week key comes back from the same query, so it is the database's
        # week — the one the rule's weekly cap is measured in. Deriving it from
        # the app server's clock instead would disagree across a midnight or a
        # timezone, and pay a second bonus in a week the cap thought was over.
        row = call_proc_one('sp_score_cohort_week_count', user_id, str(cohort_id)) or {}
        prior_this_week = int(row.get('prior_this_week') or 0)
        week_key = row.get('week_key')
    except Exception as e:
        # A failed lookup costs the student the repeat bonus, never the +2.
        logger.error(f"repeat-week check failed (user={user_id}): {e}")

    total = award(user_id, COHORT_ATTENDED, ref_id=cohort_id, recalc=False)

    if total and prior_this_week and week_key is not None:
        # The weekly cap already allows one of these per week; the week key as
        # ref_id makes a retry inside the same week a no-op rather than a
        # second row that the cap then has to reject.
        total += award(user_id, COHORT_REPEAT_WEEK,
                       ref_id=f"week-{week_key}", recalc=False)

    if recalc:
        try:
            # ── SP: sp_score_recalc — one rebuild for both signals ─────────
            call_proc_one('sp_score_recalc', user_id)
        except Exception as e:
            logger.error(f"score recalc failed (user={user_id}): {e}")
    return total


def recalc(user_id):
    """Rebuild a user's score from the ledger. Returns the score row or None."""
    try:
        return call_proc_one('sp_score_recalc', user_id)
    except Exception as e:
        logger.error(f"score recalc failed (user={user_id}): {e}")
        return None


def award_vault_complete(user_id):
    """Award PROFILE_COMPLETED once the vault holds all four spec folders."""
    try:
        from portal.helpers.sp import call_proc
        docs = call_proc('sp_docvault_by_user', user_id, None) or []
        have = {(d.get('category') or '').lower() for d in docs}
        if all(f in have for f in VAULT_FOLDERS):
            return award(user_id, PROFILE_COMPLETED, ref_id='vault-complete')
    except Exception as e:
        logger.error(f"vault-complete check failed (user={user_id}): {e}")
    return 0
