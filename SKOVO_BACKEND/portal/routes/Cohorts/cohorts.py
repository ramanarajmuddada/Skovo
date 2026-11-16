from portal.helpers.error_capture import capture_error
import os
import uuid
import json
import types
import hmac
import hashlib
import datetime
from portal.helpers.video import sanitize_meeting_link
from sqlalchemy import bindparam, text
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import cohort_offer_state, effective_cohort_status, format_ist, score_from_assessment_steps, serialize_datetime, split_earning
from portal.helpers import score
from . import ns, logger

list_parser = reqparse.RequestParser()
list_parser.add_argument('domain', type=str, location='args', required=False)
list_parser.add_argument('status', type=str, location='args', required=False)
list_parser.add_argument('search', type=str, location='args', required=False)
list_parser.add_argument('date_from', type=str, location='args', required=False)  # YYYY-MM-DD, IST
list_parser.add_argument('date_to', type=str, location='args', required=False)
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=10)

enroll_parser = reqparse.RequestParser()
# Cashfree requires a customer phone to create an order, and SKOVO accounts can
# be made with an email alone — so checkout collects it when the profile has none.
enroll_parser.add_argument('phone', type=str, location='json', required=False)
enroll_parser.add_argument('coupon_code', type=str, location='json', required=False)
# Opt-in, not automatic: spending the one free cohort of a student's life should
# be a decision they make on a specific cohort, not something that happens to
# them on whichever priced cohort they tapped first.
enroll_parser.add_argument('use_free_cohort', type=bool, location='json', required=False, default=False)


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _as_json(v, default=None):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return default
    return v if v is not None else default


def _update_readiness_on_cohort(user_id: str):
    """Rebuild the readiness score after a confirmed enrollment.

    ── SP: sp_score_recalc — the score_events ledger is the v1 source of truth
    (Playbook §5.7). Cohort points are awarded as ledger events when the
    student actually attends or completes, so enrolling only needs a rebuild.

    This used to call sp_student_readiness_recalc, which recomputes from live
    COUNT queries and overwrites readiness_scores.score while leaving
    base_points at the ledger value. That silently reset a student's score on
    every enrolment — a student at 77 (hub unlocked) dropped to 5 (hub
    re-locked) just by joining a cohort. ───────────────────────────────────
    """
    try:
        score.recalc(user_id)
    except Exception:
        pass


def _send_cohort_enroll_email(user_id, cohort):
    """Email an enrolment confirmation with a calendar (.ics) invite attached,
    and tell the achiever their seat was taken."""
    try:
        from portal.helpers.booking_alert import alert_cohort_booking
        alert_cohort_booking(cohort_id=cohort.get('id'), student_id=user_id)
    except Exception:
        pass
    try:
        from portal.helpers.email_template import send_email, simple_email_body
        from portal.helpers.calendar_invite import build_ics, ics_attachment
        # ── SP: sp_users_get ────────────────────────────────────────────────
        u = call_proc_one('sp_users_get', user_id)
        if not u or not u.get('email'):
            return
        atts = None
        session_date = cohort.get('session_date')
        if session_date:
            end = session_date + datetime.timedelta(minutes=(cohort.get('duration_minutes') or 90))
            ics = build_ics(cohort['id'], f"SKOVO Cohort: {cohort.get('title')}", session_date, end,
                            description=cohort.get('about') or 'Your enrolled cohort session.',
                            url=sanitize_meeting_link(cohort.get('meeting_link')), attendee_email=u['email'])
            atts = [ics_attachment(ics, 'skovo-cohort.ics')]
        # `session_date` is naive UTC. strftime alone printed it as-is, so a
        # 15:45 UTC class was announced as 3:45 PM instead of 9:15 PM IST —
        # while the .ics attached to the same mail was right, because it
        # carries a Z suffix. format_ist is the missing inverse of
        # parse_local_to_utc.
        when = format_ist(session_date) or 'soon'
        send_email(u['email'], f"SKOVO — Enrolled in '{cohort.get('title')}'",
                   simple_email_body('You are enrolled!',
                                     f"You're confirmed for '{cohort.get('title')}' on {when}. A calendar invite is attached.",
                                     None, None),
                   attachments=atts)
    except Exception:
        pass


def _active_checkout_holds(cohort_ids):
    """How many unexpired pending checkouts occupy a seat on each cohort.

    BookMyShow: a checkout greys the seat until it pays or the hold expires.
    `filled_seats` stays paid-only; available_seats subtracts these holds.
    """
    ids = [cid for cid in cohort_ids if cid]
    if not ids:
        return {}
    rows = db.session.execute(text("""
        SELECT cohort_id, COUNT(*) AS n
          FROM cohort_enrollments
         WHERE cohort_id IN :ids
           AND payment_status = 'pending'
           AND expires_at IS NOT NULL
           AND expires_at > UTC_TIMESTAMP()
         GROUP BY cohort_id
    """).bindparams(bindparam('ids', expanding=True)), {'ids': ids}).mappings().all()
    return {r['cohort_id']: int(r['n'] or 0) for r in rows}


def _offer_fields(c):
    """What a student sees of the offer: effective price, label, places left, end."""
    o = cohort_offer_state(c)
    if not o:
        return {'effective_price': float(c['price']) if c.get('price') else 0,
                'offer_label': None, 'offer_left': None, 'offer_ends_at': None, 'offer_next_price': None}
    return {'effective_price': o['offer_price'], 'offer_label': o['label'],
            'offer_left': o['left'], 'offer_ends_at': serialize_datetime(o['ends_at']),
            'offer_next_price': o['next_price']}


def _cohort_dict(c, achiever=None, domain=None, held_seats=0):
    total = c.get('total_seats')
    filled = c.get('filled_seats') or 0
    held = held_seats or 0
    return {
        'id': c.get('id'),
        'title': c.get('title'),
        'domain': {'id': domain['id'], 'name': domain['name'], 'slug': domain['slug']} if domain else None,
        'achiever': {
            'id': achiever['id'],
            'full_name': achiever['full_name'],
            'designation': achiever['designation'],
            'company': achiever['company'],
            'avatar_url': achiever['avatar_url'],
        } if achiever else None,
        'session_date': serialize_datetime(c.get('session_date')),
        'duration_minutes': c.get('duration_minutes'),
        'registration_deadline': serialize_datetime(c.get('registration_deadline')),
        'total_seats': total,
        'filled_seats': filled,
        # NULL/0 total_seats means unlimited (see CLAUDE.md, "Money"). The old
        # max(0, (total or 0) - filled) turned that into a literal 0, so an
        # uncapped cohort advertised "0 seats available". None means unlimited.
        # Held checkouts occupy a seat the same way a 1-on-1 slot is blocked.
        'available_seats': (None if not total
                            else max(0, int(total) - int(filled) - int(held))),
        'price': float(c['price']) if c.get('price') else 0,
        # Public offer (v1 has no coupon codes): price, first-N places left, end.
        **_offer_fields(c),
        'status': effective_cohort_status(types.SimpleNamespace(
            status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes'),
        )),
        'is_demo': bool(c.get('is_demo')),
        'late_join_minutes': int(c.get('late_join_minutes') or 0),
        # Live, inside the achiever's late-join window: a free seat can still be taken.
        'late_join_open': bool(c.get('late_join_minutes') and c.get('session_date')
                               and c['session_date'] <= datetime.datetime.utcnow()
                               <= c['session_date'] + datetime.timedelta(minutes=int(c['late_join_minutes']))),
        'about':           c.get('about'),
        'what_you_learn':  _as_list(c.get('what_you_learn')),
        'thumbnail_url':   c.get('thumbnail_url'),
        'target_categories':   _as_list(c.get('target_categories')),
        'target_streams':      _as_list(c.get('target_streams')),
        'target_degree_cats':  _as_list(c.get('target_degree_cats')),
        'target_exam_targets': _as_list(c.get('target_exam_targets')),
        'target_prof_courses': _as_list(c.get('target_prof_courses')),
        'target_years':        _as_list(c.get('target_years')),
        'target_degrees':      _as_list(c.get('target_degrees')),
        'target_branches':     _as_list(c.get('target_branches')),
    }


def _get_student_profile(user_id):
    try:
        # ── SP: sp_profile_get_by_user ──────────────────────────────────────
        p = call_proc_one('sp_profile_get_by_user', user_id)
        if not p:
            return None
        cat = p.get('education_category') or p.get('education_level') or ''
        return {
            'education_category':       cat.lower().strip(),
            'stream':                   (p.get('stream') or '').lower().strip(),
            'degree_category':          (p.get('degree_category') or '').strip(),
            'degree_type':              (p.get('degree_type') or '').strip().lower(),
            'branch':                   (p.get('branch') or '').strip().lower(),
            'year_of_study':            (p.get('year_of_study') or '').strip(),
            'professional_course_type': (p.get('professional_course_type') or '').strip(),
            'exam_target':              (p.get('exam_target') or '').strip(),
        }
    except Exception:
        return None


def _matches_audience(c, profile):
    """Return True if the cohort is visible to this student profile."""
    cats      = _as_list(c.get('target_categories'))
    streams   = _as_list(c.get('target_streams'))
    deg_cats  = _as_list(c.get('target_degree_cats'))
    exam_tgts = _as_list(c.get('target_exam_targets'))
    prof_crs  = _as_list(c.get('target_prof_courses'))
    years     = _as_list(c.get('target_years'))
    degrees   = _as_list(c.get('target_degrees'))
    branches  = _as_list(c.get('target_branches'))

    if not any([cats, streams, deg_cats, exam_tgts, prof_crs, years, degrees, branches]):
        return True
    if not profile:
        return True

    s_cat    = profile.get('education_category', '')
    s_stream = profile.get('stream', '')
    s_dgcat  = profile.get('degree_category', '')
    s_exam   = profile.get('exam_target', '')
    s_prof   = profile.get('professional_course_type', '')
    s_year   = profile.get('year_of_study', '')
    s_deg    = profile.get('degree_type', '')
    s_branch = profile.get('branch', '')

    if cats      and s_cat    not in [x.lower() for x in cats]:      return False
    if streams   and s_stream not in [x.lower() for x in streams]:   return False
    if deg_cats  and s_dgcat  not in deg_cats:                        return False
    if exam_tgts and s_exam   not in exam_tgts:                       return False
    if prof_crs  and s_prof   not in prof_crs:                        return False
    if years     and s_year   not in years:                           return False
    if degrees   and not any(d.lower() in s_deg  or s_deg  in d.lower() for d in degrees):  return False
    if branches  and not any(b.lower() in s_branch or s_branch in b.lower() for b in branches): return False
    return True


@ns.route('/')
class CohortList(Resource):
    @ns.doc(description='List cohorts with optional domain/status filter and search.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            args    = list_parser.parse_args()

            # ── SP: sp_cohorts_list — no domain/search filter on the generic
            # CRUD proc, so pull a bounded batch and filter here. ─────────────
            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)

            if args.get('domain'):
                # ── SP: sp_domains_list — resolve slug -> id, then filter. ──────
                domains = call_proc('sp_domains_list', 5000, 0, 0)
                domain_obj = next((d for d in domains if d.get('slug') == args['domain']), None)
                if domain_obj:
                    all_cohorts = [c for c in all_cohorts if c.get('domain_id') == domain_obj['id']]

            if args.get('search'):
                s = args['search'].lower()
                all_cohorts = [
                    c for c in all_cohorts
                    if s in (c.get('title') or '').lower() or s in (c.get('about') or '').lower()
                ]

            # Date range on the class day in IST (session_date is stored in UTC).
            if args.get('date_from') or args.get('date_to'):
                _ist = lambda d: (d + datetime.timedelta(minutes=330)).strftime('%Y-%m-%d') if d else ''  # noqa: E731
                _lo, _hi = args.get('date_from') or '0000', args.get('date_to') or '9999'
                all_cohorts = [c for c in all_cohorts
                               if c.get('session_date') and _lo <= _ist(c['session_date']) <= _hi]

            all_cohorts.sort(key=lambda c: c.get('session_date') or datetime.datetime.min)

            # Anyone can see and enrol. Year / GATE / class targeting is not used.
            visible = list(all_cohorts)

            # Real-time status filter (applied in Python so the scheduler's 60-second
            # lag never causes a 'live' cohort to stay hidden or an 'upcoming' one to
            # appear live).
            requested_status = args.get('status')
            if requested_status:
                visible = [
                    c for c in visible
                    if effective_cohort_status(types.SimpleNamespace(
                        status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes'),
                    )) == requested_status
                ]

            # Manual pagination after filtering
            page     = args['page']
            per_page = args['per_page']
            total    = len(visible)
            start    = (page - 1) * per_page
            items    = visible[start:start + per_page]

            # Which of these the student is already in. `is_enrolled` lived only
            # on the detail endpoint, so the browse list looked identical before
            # and after joining — the student had to open each cohort one at a
            # time to find out which ones they were already in.
            #
            # ── SP: sp_cohort_enrollments_list — no by-user filter on the
            # generic CRUD proc, so one bounded batch, filtered here. One call
            # for the page rather than one per row. ──
            try:
                enrolled_ids = {
                    e['cohort_id']
                    for e in (call_proc('sp_cohort_enrollments_list', 50000, 0) or [])
                    if e.get('user_id') == user_id and e.get('payment_status') in ('paid', 'free')
                }
            except Exception:
                # Advisory only. A cohort shown without its badge is a smaller
                # failure than a listing that 500s, and the detail screen still
                # answers authoritatively before anyone can enrol twice.
                enrolled_ids = set()

            # ── SP: sp_achievers_get, sp_domains_get — memoised per request ────
            #
            # These sat inside the loop, so a page cost two extra round trips
            # PER ROW: twenty at the default per_page of 10, and two hundred at
            # per_page=100, every one of them to a remote RDS. The lookups
            # repeat heavily in practice — one achiever usually runs several of
            # the cohorts on a page, and most cohorts share a handful of domains
            # — so caching by id collapses the fan-out to one call per distinct
            # achiever and domain without needing a new by-ids procedure.
            #
            # Request-scoped on purpose: an achiever renamed between requests
            # must show their new name on the next load, so there is no TTL to
            # get wrong. UI05-015.
            achievers, domains = {}, {}

            def _achiever(aid):
                if aid not in achievers:
                    achievers[aid] = call_proc_one('sp_achievers_get', aid)
                return achievers[aid]

            def _domain(did):
                if did not in domains:
                    domains[did] = call_proc_one('sp_domains_get', did)
                return domains[did]

            held = _active_checkout_holds([c['id'] for c in items])
            result = []
            for c in items:
                achiever = _achiever(c['achiever_id']) if c.get('achiever_id') else None
                domain = _domain(c['domain_id']) if c.get('domain_id') else None
                d = _cohort_dict(c, achiever, domain, held_seats=held.get(c['id'], 0))
                d['is_enrolled'] = c['id'] in enrolled_ids
                result.append(d)

            # Ship the free-cohort allowance with the list so a student sees
            # "your first cohort is free" on the browse screen, where it can
            # actually change what they tap — not after they hit the price.
            try:
                from portal.helpers.pro_limits import cohort_free_perk_status
                free_perk = cohort_free_perk_status(user_id)
            except Exception:
                free_perk = {}      # advisory only — never break the listing

            import math
            return jsonify(
                response={'cohorts': result, 'free_cohort': free_perk},
                pagination={
                    'total':    total,
                    'page':     page,
                    'pages':    math.ceil(total / per_page) if per_page else 1,
                    'per_page': per_page,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /cohorts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:cohort_id>')
class CohortDetail(Resource):
    @ns.doc(description='Get full details of a cohort including enrollment status for current user.')
    @jwt_required()
    def get(self, cohort_id):
        try:
            # ── SP: sp_cohorts_get ───────────────────────────────────────────
            c = call_proc_one('sp_cohorts_get', cohort_id)
            if not c or c.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            user_id = get_jwt_identity()
            # ── SP: sp_achievers_get, sp_domains_get, sp_cohort_enrollments_get_by_user_cohort ─
            achiever = call_proc_one('sp_achievers_get', c['achiever_id']) if c.get('achiever_id') else None
            domain = call_proc_one('sp_domains_get', c['domain_id']) if c.get('domain_id') else None
            enrollment = call_proc_one('sp_cohort_enrollments_get_by_user_cohort', user_id, cohort_id)

            held = _active_checkout_holds([cohort_id]).get(cohort_id, 0)
            data = _cohort_dict(c, achiever, domain, held_seats=held)
            # 'paid'/'free' is the enrolled set. A 'pending' row is a checkout
            # hold: it greys the seat (available_seats) but is not enrolment,
            # which is why `filled_seats` counts paid students only.
            #
            # The local below always had that right and the gates below use it;
            # the PAYLOAD did not. `is_enrolled: enrollment is not None` reported
            # true the moment an order was created, so a student who opened
            # checkout and closed the window saw "Joined" on a class they had
            # never paid for, on the detail screen and in the browse list's
            # badge. The browse list next to it has always filtered on
            # payment_status; only this line disagreed with it.
            is_enrolled = enrollment is not None and enrollment.get('payment_status') in ('paid', 'free')
            data['is_enrolled'] = is_enrolled
            # The raw status stays, so a screen can tell "never started" from
            # "started and unpaid" and offer to resume the checkout.
            data['enrollment_status'] = enrollment.get('payment_status') if enrollment else None
            # Only a student who checked in may rate the class (the code is the proof).
            data['attended'] = bool(enrollment and enrollment.get('attended') and is_enrolled)

            # Time-gate the join: a session is joinable while live, or from 15 min
            # before its start.
            #
            # Derived, not the raw column. This block read `c['status']` directly
            # while `_cohort_dict` above already reports the *derived* status, so
            # the same response could say status='completed' and is_live=true.
            # Both directions were wrong, and one leaked:
            #   * a stale 'live' (scheduler down, or just between its 60s ticks)
            #     kept `meeting_link` served to every enrolled student long after
            #     the class ended -- X02-033 says only while live;
            #   * a stale 'upcoming' on a session that had actually started
            #     reported is_live=false on screen.
            # X02-078 is explicit that a scheduler outage must not change any of
            # this. The 15-minute early-join window still hangs off 'upcoming'.
            now = datetime.datetime.utcnow()
            session_date = c.get('session_date')
            eff = effective_cohort_status(types.SimpleNamespace(
                status=c.get('status'), session_date=session_date,
                duration_minutes=c.get('duration_minutes'),
            ))
            can_join = False
            if eff == 'live':
                can_join = True
            elif eff == 'upcoming' and session_date:
                can_join = session_date <= now + datetime.timedelta(minutes=15)
            from portal.helpers import class_rules as CR
            _cls = CR.state(c, session_date, c.get('duration_minutes'), eff)
            can_join = can_join and _cls['started']
            data['class'] = _cls
            data['is_live']  = (eff == 'live')
            data['can_join'] = bool(can_join and is_enrolled)
            # Only surface the join link to confirmed-enrolled students, and only
            # once it's joinable — not all day from creation. For private Daily
            # rooms this also mints a per-user token (no-op otherwise).
            if is_enrolled and can_join and c.get('meeting_link'):
                from portal.helpers.video import tokenized_join_url
                data['meeting_link'] = tokenized_join_url(c['meeting_link'], user_name='', is_owner=False) or None
            else:
                data['meeting_link'] = None

            # Multi-session schedule (empty for single-session cohorts). The join
            # link on each session is only revealed to confirmed-enrolled students.
            sessions = call_proc('sp_cohort_sessions_list', cohort_id)
            data['sessions'] = [{
                'id': s.get('id'),
                'title': s.get('title'),
                'session_date': serialize_datetime(s.get('session_date')),
                'duration_minutes': s.get('duration_minutes'),
                'status': s.get('status'),
                'meeting_link': (sanitize_meeting_link(s.get('meeting_link')) or None) if is_enrolled else None,
            } for s in sessions]

            return jsonify(response=data, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /cohorts/{cohort_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# Business SP failure messages mapped to HTTP status codes for the
# free/confirm flows (sp_student_cohort_enroll_free / _confirm).
_ENROLL_ERROR_STATUS = {
    'Cohort not found.': 404,
    'Enrollment is closed for this cohort.': 400,
    'This is a paid cohort — use the paid flow.': 400,
    'You are already enrolled in this cohort.': 409,
    'No seats available.': 400,
}


@ns.route('/<string:cohort_id>/enroll')
class CohortEnroll(Resource):
    @ns.doc(
        description=(
            'Enroll in a cohort.\n\n'
            '**Free cohorts:** No extra params needed — enrolls immediately.\n\n'
            '**Paid cohorts:** Send `phone` if the profile has none. Reserves the '
            'seat under a row lock, then returns `payment_session_id` for Cashfree '
            'checkout.\n\n'
            'There is no verify step: the Cashfree webhook confirms payment and the '
            'client polls GET /v1/payments/orders/<order_id> for the outcome.'
        )
    )
    @jwt_required()
    def post(self, cohort_id):
        try:
            user_id = get_jwt_identity()
            args = enroll_parser.parse_args()

            # ── SP: sp_cohorts_get, sp_cohort_enrollments_get_by_user_cohort ──
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # The same real-time status the list and detail screens compute, not
            # the raw column. The scheduler writes `status` every 60s and can
            # miss the window entirely after a restart, so the column and what
            # the student is looking at routinely disagree — a card reading
            # "Upcoming · Join" would answer "Enrollment is closed", and a
            # cohort the scheduler had not caught up with yet would still take
            # enrolments hours after it ended. One function decides now.
            eff_status = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            from portal.helpers import class_rules as CR
            if CR.paused(cohort.get('achiever_id')):
                return jsonify(response={'message': CR.PAUSED_MSG}, status=403, bool=False)
            # Late joining: the achiever may keep free seats open for a few
            # minutes after the start (cohorts.late_join_minutes, 0 = off).
            late_ok = False
            if eff_status == 'live' and cohort.get('session_date'):
                late = int(cohort.get('late_join_minutes') or 0)
                late_ok = late > 0 and datetime.datetime.utcnow() <= cohort['session_date'] + datetime.timedelta(minutes=late)
                # Late booking only once the achiever has started: nobody pays
                # for a class that may never run.
                from portal.helpers import class_rules as CR
                if late_ok and CR.follows(cohort) and not cohort.get('started_at'):
                    return jsonify(response={'message': 'Booking opens when the achiever starts the class.'},
                                   status=400, bool=False)
            if eff_status != 'upcoming' and not late_ok:
                # Say which of the three it is. "Enrollment is closed" on a
                # cancelled cohort and on one that ended last month are
                # different facts, and the student can act on only one of them.
                msg = {
                    'live': 'This session has already started, so enrolment has closed.',
                    'completed': 'This cohort has finished. Look for an upcoming one.',
                    'cancelled': 'This cohort was cancelled.',
                }.get(eff_status, 'Enrollment is closed for this cohort.')
                return jsonify(response={'message': msg, 'status_reason': eff_status},
                               status=400, bool=False)

            existing = call_proc_one('sp_cohort_enrollments_get_by_user_cohort', user_id, cohort_id)
            if existing and existing.get('payment_status') in ('paid', 'free'):
                return jsonify(response={'message': 'You are already enrolled in this cohort.'}, status=409, bool=False)

            # ── Skovo Pro members: subscription covers the seat, enrol free ──
            from portal.routes.Subscription.subscription import is_pro
            if cohort.get('price') and is_pro(user_id):
                result = call_proc_one('sp_student_cohort_enroll_pro', user_id, cohort_id)
                if not result or not result.get('ok'):
                    db.session.commit()
                    message = (result or {}).get('message', 'Unable to enroll.')
                    return jsonify(response={'message': message}, status=_ENROLL_ERROR_STATUS.get(message, 400), bool=False)
                _update_readiness_on_cohort(user_id)
                db.session.commit()
                try:
                    from portal.helpers.notifications import notify_user
                    from portal.helpers.analytics import track_event
                    notify_user(user_id, 'Enrolled with Skovo Pro!', f"You're in '{cohort.get('title')}' — covered by your membership.", type='cohort', reference_type='cohort', reference_id=cohort_id)
                    _send_cohort_enroll_email(user_id, cohort)
                    track_event('cohort_enrolled', entity_type='cohort', entity_id=cohort_id, user_id=user_id, meta={'payment_status': 'free', 'via': 'pro'}, req=request)
                except Exception:
                    pass
                return jsonify(response={'message': 'Enrolled with Skovo Pro.', 'enrollment_id': result.get('enrollment_id'), 'via': 'pro'}, status=200, bool=True)

            # ── Free paid-cohort seats (Admin → Subscriptions sets N) ────
            # Counted inside the procedure, in the same transaction that takes
            # the seat — checking here first would let two taps both spend it.
            if cohort.get('price') and args.get('use_free_cohort'):
                from portal.helpers.pro_limits import (
                    cohort_free_perk_status, upgrade_payload,
                )
                perk = cohort_free_perk_status(user_id)
                allowance = perk['allowance']
                if not perk['available']:
                    db.session.commit()
                    return jsonify(
                        response=upgrade_payload('cohorts', used=perk['used'], limit=allowance),
                        status=403, bool=False,
                    )
                try:
                    res = call_proc_one(
                        'sp_student_cohort_enroll_free_perk', user_id, cohort_id, allowance,
                    ) or {}
                except Exception:
                    res = call_proc_one(
                        'sp_student_cohort_enroll_free_perk', user_id, cohort_id,
                    ) or {}
                if not res.get('ok'):
                    db.session.commit()
                    if res.get('result') == 'perk_spent':
                        return jsonify(
                            response=upgrade_payload('cohorts', used=perk['used'], limit=allowance),
                            status=403, bool=False,
                        )
                    return jsonify(response={
                        'message': res.get('message') or 'Unable to use your free cohort.',
                        'result': res.get('result'),
                    }, status=_ENROLL_ERROR_STATUS.get(res.get('message'), 400), bool=False)

                _update_readiness_on_cohort(user_id)
                db.session.commit()
                logger.info(f"User {user_id} spent their free cohort on {cohort_id}")
                try:
                    from portal.helpers.notifications import notify_user
                    from portal.helpers.analytics import track_event
                    notify_user(user_id, 'Your free cohort is booked!',
                                f"You're in '{cohort.get('title')}'.",
                                type='cohort', reference_type='cohort', reference_id=cohort_id)
                    _send_cohort_enroll_email(user_id, cohort)
                    track_event('cohort_enrolled', entity_type='cohort', entity_id=cohort_id,
                                user_id=user_id, meta={'payment_status': 'free', 'via': 'free_perk'}, req=request)
                except Exception:
                    pass
                return jsonify(response={
                    'message': res.get('message'),
                    'enrollment_id': res.get('enrollment_id'),
                    'via': 'free_perk',
                }, status=200, bool=True)

            # ── Free cohort ──────────────────────────────────────────────────
            if not cohort.get('price'):
                # ── SP: sp_student_cohort_enroll_free — locks the seat, checks
                # status/seats/duplicate, inserts the enrollment, increments
                # filled_seats — all atomically in one transaction. ────────────
                result = call_proc_one('sp_student_cohort_enroll_free', user_id, cohort_id)

                if not result or not result.get('ok'):
                    db.session.commit()
                    message = (result or {}).get('message', 'Unable to enroll.')
                    return jsonify(response={'message': message}, status=_ENROLL_ERROR_STATUS.get(message, 400), bool=False)

                _update_readiness_on_cohort(user_id)
                db.session.commit()

                logger.info(f"User {user_id} enrolled (free) in cohort {cohort_id}")

                try:
                    from portal.helpers.notifications import notify_user
                    from portal.helpers.analytics import track_event
                    notify_user(user_id, 'Enrolled!', f"You're in '{cohort.get('title')}'. See you at the session!", type='cohort', reference_type='cohort', reference_id=cohort_id)
                    _send_cohort_enroll_email(user_id, cohort)
                    track_event('cohort_enrolled', entity_type='cohort', entity_id=cohort_id, user_id=user_id, meta={'payment_status': 'free'}, req=request)
                except Exception:
                    pass

                return jsonify(
                    response={'message': 'Enrolled successfully.', 'enrollment_id': result.get('enrollment_id')},
                    status=200, bool=True
                )

            # ── Coupon and the price actually charged ────────────────────────
            #
            # These three were referenced by the hold call below and assigned
            # nowhere, so every paid cohort checkout died on
            # `name 'net_price' is not defined` and the student saw
            # "Could not start checkout" -- nothing to do with the gateway.
            # Same shape as the 1-on-1 flow in Achiever/achiever.py.
            price = float(cohort.get('price') or 0)
            # v1: no coupon codes. A live public offer applies automatically,
            # and the hold procedure re-checks its first-N limit under lock.
            offer = cohort_offer_state(cohort)
            coupon_code = ''
            discount = 0
            coupon_norm = None
            if price > 0 and coupon_code:
                # ── SP: sp_student_coupon_validate ──────────────────────────
                cv = call_proc_one('sp_student_coupon_validate',
                                   coupon_code, user_id, price, 'cohort', cohort_id)
                if not cv or not cv.get('valid'):
                    db.session.rollback()
                    return jsonify(
                        response={'message': (cv or {}).get('message') or 'Invalid coupon.'},
                        status=400, bool=False
                    )
                discount = float(cv.get('discount') or 0)
                coupon_norm = coupon_code.upper()

            # What the card is charged. A coupon worth more than the cohort
            # cannot make it negative.
            if offer:
                discount = float(offer['discount'])
            net_price = max(0.0, price - discount)

            # ── Paid cohort: reserve the seat, then open a Cashfree order ────
            #
            # Order of operations is the whole point. The seat is claimed under
            # a row lock BEFORE the gateway is called, so two students cannot
            # both be sent to checkout for the last seat. Previously the seat
            # was only counted at confirm time, which meant the loser of that
            # race had already paid.
            #
            # There is no step 2. The Cashfree webhook confirms the payment; the
            # client polls GET /v1/payments/orders/<id>. A browser callback can
            # be closed, replayed or forged, so it is not trusted to move money.
            try:
                from portal.helpers.cashfree import (
                    create_order, CashfreeError, CashfreeNotConfigured,
                )
                from portal.helpers.helpers import get_payment_setting, normalise_phone

                # ── SP: sp_users_get ─────────────────────────────────────
                me = call_proc_one('sp_users_get', user_id) or {}
                phone = normalise_phone(args.get('phone') or me.get('phone'))
                if not phone:
                    return jsonify(
                        response={'message': 'A mobile number is required to pay.',
                                  'need_phone': True},
                        status=400, bool=False
                    )

                order_id = str(uuid.uuid4())
                order_no = f"{get_payment_setting('order_no_prefix')}-{order_id[:12].upper()}"

                # Reserves the seat, snapshots the commission rate, sets the
                # hold deadline. Raises NO_SEATS_AVAILABLE / ALREADY_ENROLLED /
                # COHORT_CLOSED rather than returning them.
                hold = call_proc_one(
                    'sp_payment_cohort_hold_offer',
                    order_id, order_no, user_id, cohort_id,
                    net_price, discount, coupon_norm, None, 1 if offer else 0,
                )
                db.session.commit()

                # SKOVO Wallet (feature-updates.md §15): bonus first (capped),
                # then refund money; only the rest goes to Cashfree.
                from portal.helpers import wallet as W
                use_wallet = bool((request.get_json(silent=True) or {}).get('use_wallet'))
                to_pay = W.apply_to_order(order_id, user_id, net_price, 'cohort', use_wallet)
                db.session.commit()
                if to_pay <= 0:
                    outcome = W.complete_wallet_order(order_id, 'cohort')
                    db.session.commit()
                    if outcome in ('paid', 'already_paid'):
                        _update_readiness_on_cohort(user_id)
                        db.session.commit()
                        return jsonify(response={
                            'message': 'Paid with your SKOVO Wallet. Your seat is confirmed.',
                            'order_id': order_id, 'paid_with_wallet': True, 'amount': 0.0,
                        }, status=200, bool=True)

                try:
                    session = create_order(
                        order_no=order_no,
                        amount=to_pay,
                        currency=get_payment_setting('currency'),
                        customer={
                            'id': user_id,
                            'phone': phone,
                            'email': (me or {}).get('email'),
                            'name': (me or {}).get('full_name'),
                        },
                        return_url=f"{os.environ.get('FRONTEND_URL', '')}/bookings?order={order_id}",
                        notify_url=f"{os.environ.get('API_URL', '')}/v1/webhooks/cashfree",
                        note=f"Cohort {cohort_id[:8]}",
                    )
                except (CashfreeError, CashfreeNotConfigured) as ce:
                    # Order is unpayable. The enrolment hold stays until
                    # expires_at so a retry keeps this seat (BookMyShow) instead
                    # of releasing it for someone else to snatch mid-retry.
                    db.session.execute(text(
                        "UPDATE payment_orders SET status = 'failed', "
                        "failure_reason = :r, expires_at = UTC_TIMESTAMP() "
                        "WHERE id = :i"
                    ), {'r': str(ce)[:200], 'i': order_id})
                    db.session.commit()
                    logger.error(f"Cashfree order failed for cohort {cohort_id}: {ce}")
                    # A gateway failure is the most important thing error_logs can
                    # carry, and it was the one thing missing from it: this block
                    # only reached the server log, so support saw "Payment gateway
                    # error" with nothing behind it. The id goes back to the client
                    # so a student can quote it.
                    error_id = capture_error(ce)
                    return jsonify(
                        response={'message': 'Payment gateway error. Please try again.',
                                  'error_id': error_id},
                        status=502, bool=False
                    )

                return jsonify(
                    response={
                        'message': 'Order created. Complete payment to confirm your seat.',
                        'order_id': order_id,
                        'order_no': order_no,
                        'payment_session_id': session['payment_session_id'],
                        'mode': os.environ.get('CASHFREE_ENV', 'sandbox'),
                        'amount': float(to_pay),
                        'wallet_used': round(float(net_price) - float(to_pay), 2),
                        'currency': get_payment_setting('currency'),
                        'expires_at': str(hold.get('expires_at')) if hold else None,
                        'seats_left': hold.get('seats_left') if hold else None,
                    },
                    status=200, bool=True
                )

            except Exception as hold_err:
                db.session.rollback()
                msg = str(hold_err)
                # The procedure signals these; surface them as the user-facing
                # reason instead of a generic 500.
                for code, text_msg, http in (
                    ('NO_SEATS_AVAILABLE', 'This cohort is full.', 409),
                    ('OFFER_GONE', f"The offer just ran out. The price is now ₹{int(price)}. Tap Join again to continue.", 409),
                    ('ALREADY_ENROLLED',   'You are already enrolled.', 409),
                    ('COHORT_CLOSED',      'Enrollment is closed for this cohort.', 409),
                    ('COHORT_NOT_FOUND',   'Cohort not found.', 404),
                    ('NO_COMMISSION_RULE', 'Pricing is misconfigured. Contact support.', 500),
                    ('PAYMENT_SETTINGS_MISSING', 'Payments are misconfigured.', 500),
                ):
                    if code in msg:
                        return jsonify(response={'message': text_msg}, status=http, bool=False)
                logger.error(f"Cohort hold failed for {cohort_id}: {hold_err}")
                return jsonify(
                    response={'message': 'Could not start checkout. Please try again.'},
                    status=500, bool=False
                )

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /cohorts/{cohort_id}/enroll: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:cohort_id>/check-in')
class CohortCheckIn(Resource):
    @ns.doc(description=(
        'Student: check in to a live session with the code the achiever read out.\n\n'
        'Marks attendance and awards the cohort_attended points immediately, so '
        'the student sees their score move while they are still in the session.'
    ))
    @jwt_required()
    def post(self, cohort_id):
        try:
            user_id = get_jwt_identity()
            data = request.get_json(silent=True) or {}
            code = str(data.get('code') or '').strip()
            if not code:
                return jsonify(response={'message': 'Enter the code your achiever read out.'},
                               status=400, bool=False)

            # Check-in is live-only, and this gate was missing. The 5 Sep pass
            # closed the achiever-side holes -- reveal (live only) and manual
            # attendance (live/completed) -- but the student's redeem went
            # straight to the procedure with no state check, and redeeming
            # awards `cohort_attended` readiness points.
            #
            # It is reachable without any tampering: a code revealed near the
            # end of a session stays active for its 30-minute window, the
            # session ends, the cohort derives as 'completed', and the code --
            # which is read aloud to a room and trivially passed on -- still
            # redeems. That is attendance credit for a class that is over, and
            # on a *cancelled* class, for one that never happened.
            #
            # Derived, not the column, like every other guard here: a scheduler
            # outage must not decide whether attendance can be claimed. X02-004
            # /019/034/049/064.
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff != 'live':
                reason = {
                    'upcoming':  'This session has not started yet.',
                    'completed': 'This session has ended, so check-in is closed.',
                    'cancelled': 'This session was cancelled.',
                }.get(eff, 'Check-in is only open while the session is live.')
                return jsonify(response={'message': reason, 'status_reason': eff},
                               status=409, bool=False)

            # ── SP: sp_attendance_code_redeem ─────────────────────────────────
            row = call_proc_one('sp_attendance_code_redeem', cohort_id, user_id, code) or {}
            if not row.get('ok'):
                # Each reason gets its own message: a student whose connection
                # dropped during the window must be told to ask for a re-reveal,
                # not accused of entering a wrong code.
                reason = row.get('reason')
                msg = {
                    'not_enrolled': 'You are not enrolled in this cohort.',
                    'no_active_code': 'No code is live right now. Ask your achiever to show it.',
                    'expired': 'That code has expired. Ask your achiever to show it again.',
                    'wrong_code': "That code doesn't match. Check the digits and try again.",
                }.get(reason, 'Could not check you in.')
                return jsonify(response={'message': msg, 'reason': reason}, status=400, bool=False)

            db.session.commit()

            awarded = 0
            if row.get('newly_marked'):
                # +2 for the check-in, and +2 more if this is a second cohort
                # inside the same week — the repeat-week signal the spec pays
                # for. One helper so all three attendance paths pay the same.
                awarded = score.award_cohort_attendance(user_id, cohort_id)
                db.session.commit()
                # After the commit: the referral check commits and rolls back
                # on its own, so it must not run inside this transaction.
                from portal.helpers.referral_rewards import evaluate_friend
                evaluate_friend(user_id)

            return jsonify(response={
                'message': "You're checked in." + (f' +{awarded} points.' if awarded else ''),
                'attended': True,
                'points_awarded': awarded,
            }, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/<string:cohort_id>/certificate')
class CohortCertificate(Resource):
    @jwt_required()
    def get(self, cohort_id):
        """Completion certificate for a student who attended a finished cohort."""
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_cohorts_get, sp_cohort_enrollments_get_by_user_cohort ──
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            enr = call_proc_one('sp_cohort_enrollments_get_by_user_cohort', user_id, cohort_id)
            if not enr or enr.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'You were not enrolled in this cohort.'}, status=403, bool=False)

            # Only issue once the cohort has actually finished (effective status).
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'), session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff != 'completed':
                return jsonify(response={'message': 'Certificate is available after the cohort completes.'}, status=400, bool=False)

            user = call_proc_one('sp_users_get', user_id)
            achiever = call_proc_one('sp_achievers_get', cohort.get('achiever_id')) if cohort.get('achiever_id') else None
            sd = cohort.get('session_date')
            return jsonify(response={
                'certificate_number':   f"SKOVO-CH-{cohort_id[:8].upper()}-{user_id[:8].upper()}",
                'student_name':         user.get('full_name') if user else 'Student',
                'cohort_title':         cohort.get('title'),
                'cohort_level':         cohort.get('level'),
                'achiever_name':        achiever.get('full_name') if achiever else 'SKOVO Achiever',
                'achiever_designation': (achiever.get('designation') or '') if achiever else '',
                'achiever_company':     (achiever.get('company') or '') if achiever else '',
                'completion_date':      sd.strftime('%B %d, %Y') if sd else datetime.datetime.utcnow().strftime('%B %d, %Y'),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
