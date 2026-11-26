from portal.helpers.error_capture import capture_error
import os
import json
import types
import uuid
import hmac
import hashlib
import datetime
import re
from sqlalchemy import text
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt, verify_jwt_in_request
from werkzeug.security import generate_password_hash
from portal.models import db
from portal.helpers.audit import log_audit
from portal.helpers.helpers import (split_earning, parse_local_to_utc, serialize_datetime,
                                    format_ist,
                                    effective_cohort_status, cohort_join_open, cohort_time_up,
                                    cohort_tasks_open, cohort_offer_state, offer_tier_price,
                                    parse_offer_tiers)
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.cohort_validation import validate_cohort_input
from portal.helpers.coupon_validation import validate_coupon_input
from portal.helpers import field_limits as FL
from portal.helpers.links import check_openable
from portal.helpers import task_review
from portal.helpers import trust as T
from portal.helpers import class_rules as CR
from portal.api import api as _api

_achievers_ns = _api.namespace('achievers', description='Browse and book achievers (student-facing)')

import logging
logger = logging.getLogger("skovo")


def _avatar_url(a):
    """This achiever's photo, as a URL a browser can actually load.

    Two columns hold it — the portal writes `profile_image_url`, older course and
    booking cards read `avatar_url` — so the newer one wins and the other is the
    fallback rather than either being trusted alone.

    Passed through storage.browser_url because rows were written in three shapes
    over time: "/uploads/x.png", "https://api.skovoai.com/uploads/x.png" and a
    bare "x.png". Only the absolute one loads from the SPA origin; a relative one
    resolves against the frontend, hits its index.html catch-all and renders as
    the default avatar with the upload having reported success. Normalising here
    fixes every row already stored, with no migration, for every client —
    including the mobile app, which has no resolver of its own.
    """
    from portal.helpers.storage import browser_url
    return browser_url(a.get('profile_image_url') or a.get('avatar_url'))


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _as_time(v):
    """PyMySQL returns TIME columns as datetime.timedelta, not datetime.time —
    datetime.combine() requires the latter, so normalize before combining."""
    if isinstance(v, datetime.timedelta):
        total_seconds = int(v.total_seconds())
        h, rem = divmod(total_seconds, 3600)
        m, s = divmod(rem, 60)
        return datetime.time(h % 24, m, s)
    return v


# ── Shared query-arg parsing for the paged Bookings tabs ──────────────────────
# All three tabs take the same window and pager, so they read them the same way.
# Bad input falls back to a sane default rather than 400-ing: a mistyped date in
# a URL should show the default period, not an error page.
def _range_args(default_days: int = 30):
    def _d(raw):
        try:
            return datetime.date.fromisoformat((raw or '').strip())
        except (TypeError, ValueError):
            return None
    today = datetime.date.today()
    d_to = _d(request.args.get('to')) or today
    d_from = _d(request.args.get('from')) or (d_to - datetime.timedelta(days=default_days - 1))
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    return d_from, d_to


def _page_args(default_per_page: int = 20):
    def _i(raw, fallback):
        try:
            return int(raw)
        except (TypeError, ValueError):
            return fallback
    # Clamped to match the procedures, so an oversized ?per_page cannot be used
    # to pull the whole table back through the paged route.
    per_page = max(1, min(_i(request.args.get('per_page'), default_per_page), 200))
    page = max(1, _i(request.args.get('page'), 1))
    return per_page, (page - 1) * per_page, page, per_page


def _session_ics(session, link, attendee_email):
    """Build a calendar-invite attachment for a confirmed 1-on-1 session."""
    try:
        from portal.helpers.calendar_invite import build_ics, ics_attachment
        # ── SP: sp_achiever_slots_list — no by-session-id filter on the generic
        # CRUD proc, so pull a bounded batch and filter here. ──────────────────
        all_slots = call_proc('sp_achiever_slots_list', 50000, 0)
        slot = next((s for s in all_slots if s.get('session_id') == session['id']), None)
        if not slot or not slot.get('slot_date') or not slot.get('start_time'):
            return None
        start = datetime.datetime.combine(slot['slot_date'], _as_time(slot['start_time']))
        end   = (datetime.datetime.combine(slot['slot_date'], _as_time(slot['end_time']))
                 if slot.get('end_time') else start + datetime.timedelta(minutes=30))
        ics = build_ics(session['id'], 'SKOVO 1-on-1 Session', start, end,
                        description='Your 1-on-1 mentoring session.',
                        url=link or '', attendee_email=attendee_email)
        return [ics_attachment(ics, 'skovo-session.ics')]
    except Exception:
        return None


def _browse_row(a):
    """One achiever card. `trust_badge` rather than a tier number — students
    should not be reading L0-L4; the only distinction that matters to them is
    whether this person cleared a background check."""
    return {
        'mentor_id':         a.get('mentor_id'),
        'full_name':         a.get('full_name'),
        'email':             a.get('email'),
        'bio':               a.get('bio'),
        'designation':       a.get('designation'),
        'company':           a.get('company'),
        'linkedin_url':      a.get('linkedin_url'),
        'domains':           _as_list(a.get('domains')),
        'suitable_for':      _as_list(a.get('suitable_for')),
        'is_verified':       bool(a.get('is_verified')),
        'is_featured':       bool(a.get('is_featured')),
        'trust_badge':       T.public_badge(a),
        # `bgv_cleared`, not `teaches_minors`.
        #
        # `achievers.can_teach_minors` was dropped from the database with the
        # DPDP age gates on 2026-08-30 — the product no longer records who is a
        # minor, so there is nothing to be cleared *for*. The key stayed behind
        # reading a column that does not exist, so it has been `false` for every
        # achiever ever since, while `?bgv_only=1` filters on something else
        # entirely (`bgv_status = 'clear'`, in sp_achievers_browse). A field the
        # filter does not agree with is worse than no field: the public profile
        # was deciding whether to show a safeguarding badge from it.
        'bgv_cleared':       (a.get('bgv_status') or '').lower() == 'clear',
        'profile_image_url': _avatar_url(a),
        'mentee_count':      int(a.get('mentee_count') or 0),
        'rating':            float(a.get('rating') or 0),
        'review_count':      int(a.get('review_count') or 0),
        'session_rate':      float(a.get('session_rate') or 0),
        'standing':          a.get('standing') or 'new',
    }


SORTS = ('recommended', 'rating', 'price_low', 'price_high', 'newest')


@_achievers_ns.route('/')
class PublicAchieverList(Resource):
    @jwt_required()
    def get(self):
        """Browse achievers — filtered, ranked, and age-aware.

        This route used to pull sp_achievers_list(5000) plus
        sp_achiever_mentees_list(50000) plus sp_achiever_reviews_list(50000)
        and join them in Python on every page load, then offer no filters at
        all beyond a client-side text match. It was fine at three achievers and
        was the screen that would break first at a hundred.

        sp_achievers_browse does the filtering, the aggregation and the ranking
        in one indexed query — including the child-safety rule, applied as a
        filter rather than an error: a 14-17 student simply never sees an
        achiever they would be refused at checkout.
        """
        try:
            student_id = get_jwt_identity()
            args = request.args

            def _num(key):
                try:
                    v = float(args.get(key) or 0)
                    return v if v > 0 else None
                except (TypeError, ValueError):
                    return None

            sort = args.get('sort') or 'recommended'
            if sort not in SORTS:
                sort = 'recommended'
            try:
                page = max(1, int(args.get('page') or 1))
                per_page = min(60, max(1, int(args.get('per_page') or 24)))
            except (TypeError, ValueError):
                page, per_page = 1, 24

            q = (args.get('q') or '').strip() or None
            domain = (args.get('domain') or '').strip() or None
            bgv_only = 1 if args.get('bgv_only') in ('1', 'true', 'True') else 0
            free_only = 1 if args.get('free_only') in ('1', 'true', 'True') else 0

            # ── SP: sp_achievers_browse + sp_achievers_browse_count ──────────
            # _v2: the same search plus a minimum price (the price slider).
            rows = call_proc('sp_achievers_browse_v2', student_id, q, domain,
                             _num('min_rating'), _num('max_price'), _num('min_price'),
                             bgv_only, free_only, sort,
                             per_page, (page - 1) * per_page) or []
            total = (call_proc_one('sp_achievers_browse_count_v2', student_id, q, domain,
                                   _num('min_rating'), _num('max_price'), _num('min_price'),
                                   bgv_only, free_only) or {}).get('total') or 0
            bounds = call_proc_one('sp_achievers_price_bounds') or {}

            # Students taught: distinct students across their classes and 1-on-1s.
            taught = {}
            if rows:
                for aid, n in db.session.execute(text(
                    "SELECT x.aid, COUNT(DISTINCT x.uid) FROM ("
                    "  SELECT c.achiever_id AS aid, e.user_id AS uid FROM cohort_enrollments e"
                    "    JOIN cohorts c ON c.id = e.cohort_id WHERE e.payment_status IN ('paid', 'free')"
                    "  UNION ALL"
                    "  SELECT s.mentor_id, s.student_id FROM achiever_sessions s"
                    "   WHERE s.status IN ('confirmed', 'completed')"
                    ") x GROUP BY x.aid")).fetchall():
                    taught[aid] = int(n)
            out = []
            _slugs = achiever_slugs()
            for a in rows:
                d = _browse_row(a)
                d['slug'] = _slugs.get(d.get('mentor_id'))
                d['students_taught'] = taught.get(d.get('mentor_id') or a.get('id'), 0)
                # Paused (strikes) or suspended: still listed, but the card says so
                # and Book is off -- the student no longer finds out only at Confirm.
                from portal.helpers import class_rules as CR
                d['paused'] = CR.paused(d.get('mentor_id') or a.get('id'))
                out.append(d)
            return jsonify(response={
                'mentors': out,
                'price_bounds': {'min': float(bounds.get('min_price') or 0),
                                 'max': float(bounds.get('max_price') or 0)},
                'total': int(total),
                'page': page,
                'per_page': per_page,
                'sort': sort,
                'sorts': list(SORTS),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /achievers: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/browse/filters')
class AchieverBrowseFilters(Resource):
    @jwt_required()
    def get(self):
        """Filter options, derived from what is actually browsable — so the UI
        never offers a domain that returns an empty list."""
        try:
            rows = call_proc('sp_achiever_browse_domains') or []
            return jsonify(response={
                'domains': [r['domain'] for r in rows if r.get('domain')],
                'sorts': list(SORTS),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _slugify(name):
    s = re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-')
    return s or 'achiever'


def achiever_slugs():
    """Readable profile links: 'pavan-kumar'; a short id is added when two
    achievers share a name ('pavan-kumar-0c8b'). Built from names, so nothing
    new is stored. {achiever_id: slug}."""
    rows = db.session.execute(text(
        "SELECT id, full_name FROM achievers WHERE state = 'active' ORDER BY created_at"
    )).fetchall()
    seen, out = {}, {}
    for aid, name in rows:
        base = _slugify(name)
        seen[base] = seen.get(base, 0) + 1
        out[aid] = base if seen[base] == 1 else f"{base}-{aid[:4]}"
    return out


def _resolve_achiever(key):
    """An achiever id, or the readable link made from the name."""
    if re.fullmatch(r'[0-9a-f-]{36}', key or ''):
        return key
    for aid, slug in achiever_slugs().items():
        if slug == key:
            return aid
    return None


def _short_name(name):
    """Public pages show 'Ravi K.', never a full name."""
    parts = (name or '').split()
    if not parts:
        return 'A student'
    return parts[0] if len(parts) == 1 else f"{parts[0]} {parts[-1][0].upper()}."


def _public_class(c, reviews):
    """One class on the achiever's public profile, with its own rating."""
    st = effective_cohort_status(types.SimpleNamespace(
        status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes')))
    mine = [r['rating'] for r in reviews if r['context_type'] == 'cohort' and r['context_id'] == c['id']]
    when = c.get('session_date')
    upcoming = st in ('live', 'upcoming')
    return {
        'id': c['id'], 'title': c.get('title'), 'status': st,
        'about': c.get('about'), 'what_you_learn': _as_list(c.get('what_you_learn')), 'level': c.get('level'),
        'session_date': serialize_datetime(when) if when else None,
        'duration_minutes': c.get('duration_minutes'),
        'price': float(c.get('price') or 0), 'total_seats': c.get('total_seats'),
        'filled_seats': int(c.get('filled_seats') or 0),
        'rating': round(sum(mine) / len(mine), 1) if mine else None, 'reviews': len(mine),
        # Upcoming soonest first; past most recent first.
        'sort_key': (when.timestamp() if upcoming else -when.timestamp()) if when else 0,
    }


@_achievers_ns.route('/<string:achiever_id>/public')
class AchieverPublicProfile(Resource):
    # No login needed: this is the page achievers share. Booking asks to log in.
    def get(self, achiever_id):
        """The shareable achiever page.

        Narrower than the portal view on purpose: no email, no payout details,
        no application state. Viewing also records a profile view, which is the
        only reason the achiever's funnel has a denominator at all.
        """
        try:
            try:
                verify_jwt_in_request(optional=True)
                viewer_id = get_jwt_identity()
            except Exception:
                viewer_id = None
            achiever_id = _resolve_achiever(achiever_id)
            if not achiever_id:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)
            # ── SP: sp_achiever_public_profile ───────────────────────────────
            a = call_proc_one('sp_achiever_public_profile', achiever_id)
            if not a:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)

            reviews = call_proc('sp_achiever_public_reviews', achiever_id, 20) or []
            # Profile tabs: every review with where it came from (class or 1-on-1),
            # the achiever's classes with their own rating, and students taught.
            src_reviews = db.session.execute(text(
                "SELECT r.id, r.rating, r.review_text, r.created_at, r.context_type, r.context_id,"
                "       u.full_name AS student_name, c.title AS class_title"
                "  FROM achiever_reviews r"
                "  LEFT JOIN users u ON u.id = r.user_id"
                "  LEFT JOIN cohorts c ON r.context_type = 'cohort' AND c.id = r.context_id"
                " WHERE r.achiever_id = :a AND IFNULL(r.is_active, 1) = 1"
                " ORDER BY r.created_at DESC LIMIT 200"), {'a': achiever_id}).mappings().all()
            class_rows = [c for c in (call_proc('sp_cohorts_list', 5000, 0) or [])
                          if c.get('achiever_id') == achiever_id and not c.get('deleted_at')]
            taught = db.session.execute(text(
                "SELECT COUNT(DISTINCT x.uid) FROM ("
                "  SELECT e.user_id AS uid FROM cohort_enrollments e JOIN cohorts c ON c.id = e.cohort_id"
                "   WHERE c.achiever_id = :a AND e.payment_status IN ('paid', 'free')"
                "  UNION ALL"
                "  SELECT s.student_id FROM achiever_sessions s"
                "   WHERE s.mentor_id = :a AND s.status IN ('confirmed', 'completed')) x"), {'a': achiever_id}).scalar() or 0

            # ── SP: sp_achiever_view_record — deduped to one per viewer per
            # day, and ignores an achiever viewing their own page. Best-effort:
            # analytics must never break the page it measures. ───────────────
            try:
                if viewer_id:
                    call_proc_one('sp_achiever_view_record', str(uuid.uuid4()), achiever_id,
                                  viewer_id, (request.args.get('source') or 'profile')[:20])
                db.session.commit()
            except Exception as ve:
                db.session.rollback()
                logger.warning(f"view record failed for {achiever_id}: {ve}")

            return jsonify(response={
                'achiever': {
                    'id': a.get('id'),
                    'full_name': a.get('full_name'),
                    'achievement_title': a.get('achievement_title'),
                    'designation': a.get('designation'),
                    'company': a.get('company'),
                    'bio': a.get('bio'),
                    'profile_image_url': _avatar_url(a),
                    # No photo uploaded: the page shows the initial tile, like the card.
                    'has_photo': bool(a.get('profile_image_url')),
                    'linkedin_url': a.get('linkedin_url'),
                    'domains': _as_list(a.get('domains')),
                    'skills': _as_list(a.get('skills')),
                    'suitable_for': _as_list(a.get('suitable_for')),
                    'session_rate': float(a.get('session_rate') or 0),
                    'can_charge': bool(a.get('can_charge')),
                    'trust_badge': T.public_badge(a),
                    # See the note on the browse row above: can_teach_minors is
                    # a dropped column, and bgv_status is what bgv_only filters.
                    'bgv_cleared': (a.get('bgv_status') or '').lower() == 'clear',
                    'is_featured': bool(a.get('is_featured')),
                    'rating': float(a.get('rating') or 0),
                    'review_count': int(a.get('review_count') or 0),
                    'sessions_completed': int(a.get('sessions_completed') or 0),
                    'cohorts_hosted': int(a.get('cohorts_hosted') or 0),
                    'member_since': serialize_datetime(a['created_at']) if a.get('created_at') else None,
                },
                'slug': achiever_slugs().get(achiever_id),
                'logged_in': bool(viewer_id),
                'session_reviews': sum(1 for r in src_reviews if r['context_type'] != 'cohort'),
                'students_taught': int(taught),
                'classes': sorted([_public_class(c, src_reviews) for c in class_rows
                                   if _public_class(c, src_reviews)['status'] != 'cancelled'],
                                  key=lambda c: (c['status'] not in ('live', 'upcoming'), c['sort_key'])),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in GET /achievers/{achiever_id}/public: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/<string:achiever_id>/public/reviews')
class AchieverPublicReviews(Resource):
    def get(self, achiever_id):
        """?cohort_id=... or ?source=session; sort=newest|highest|lowest; page; per_page."""
        try:
            achiever_id = _resolve_achiever(achiever_id)
            if not achiever_id:
                return jsonify(response={'message': 'Achiever not found.'}, status=404, bool=False)
            args = request.args
            cohort_id = (args.get('cohort_id') or '').strip() or None
            where = "r.achiever_id = :a AND IFNULL(r.is_active, 1) = 1"
            params = {'a': achiever_id}
            if cohort_id:
                where += " AND r.context_type = 'cohort' AND r.context_id = :c"
                params['c'] = cohort_id
            elif args.get('source') == 'session':
                where += " AND (r.context_type IS NULL OR r.context_type <> 'cohort')"
            order = {'highest': 'r.rating DESC, r.created_at DESC', 'lowest': 'r.rating ASC, r.created_at DESC'}.get(
                args.get('sort'), 'r.created_at DESC')
            try:
                per_page = min(20, max(1, int(args.get('per_page') or 5)))
                page = max(1, int(args.get('page') or 1))
            except (TypeError, ValueError):
                per_page, page = 5, 1
            summary = db.session.execute(text(
                f"SELECT COUNT(*) AS n, ROUND(AVG(r.rating), 1) AS avg_rating,"
                f" SUM(r.rating = 5) AS s5, SUM(r.rating = 4) AS s4, SUM(r.rating = 3) AS s3,"
                f" SUM(r.rating = 2) AS s2, SUM(r.rating = 1) AS s1 FROM achiever_reviews r WHERE {where}"),
                params).mappings().first() or {}
            rows = db.session.execute(text(
                f"SELECT r.id, r.rating, r.review_text, r.created_at, u.full_name FROM achiever_reviews r"
                f" LEFT JOIN users u ON u.id = r.user_id WHERE {where} ORDER BY {order}"
                f" LIMIT {per_page} OFFSET {(page - 1) * per_page}"), params).mappings().all()
            n = int(summary.get('n') or 0)
            return jsonify(response={
                'items': [{'id': r['id'], 'rating': r['rating'], 'text': r['review_text'],
                           'student_name': _short_name(r['full_name']),
                           'created_at': serialize_datetime(r['created_at']) if r['created_at'] else None}
                          for r in rows],
                'total': n, 'page': page, 'has_more': page * per_page < n,
                'summary': {'avg': float(summary.get('avg_rating') or 0), 'count': n,
                            'stars': {str(k): int(summary.get(f's{k}') or 0) for k in (5, 4, 3, 2, 1)}},
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/funnel')
class AchieverFunnel(Resource):
    @jwt_required()
    def get(self):
        """Views -> bookings, for the achiever's own dashboard.

        The question an unbooked achiever actually has is "did nobody see me,
        or did everybody bounce?" — and until now nothing counted views at all,
        so /portal/earnings could only answer with money.
        """
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            try:
                days = min(365, max(7, int(request.args.get('days') or 30)))
            except (TypeError, ValueError):
                days = 30

            # ── SP: sp_achiever_funnel + sp_achiever_view_series ─────────────
            f = call_proc_one('sp_achiever_funnel', achiever_id, days) or {}
            series = call_proc('sp_achiever_view_series', achiever_id, days) or []

            views = int(f.get('views') or 0)
            bookings = int(f.get('bookings') or 0)
            completed = int(f.get('completed') or 0)

            return jsonify(response={
                'window_days': days,
                'views': views,
                'unique_viewers': int(f.get('unique_viewers') or 0),
                'bookings': bookings,
                'paid_bookings': int(f.get('paid_bookings') or 0),
                'completed': completed,
                'cancelled': int(f.get('cancelled') or 0),
                'cohort_enrolments': int(f.get('cohort_enrolments') or 0),
                'lifetime_views': int(f.get('lifetime_views') or 0),
                # Guarded: a zero denominator is the common case for a new
                # achiever, and dividing by it is how a dashboard 500s.
                'view_to_booking_pct': round(bookings * 100.0 / views, 1) if views else None,
                'booking_to_completed_pct': round(completed * 100.0 / bookings, 1) if bookings else None,
                'quality_score': float(f['quality_score']) if f.get('quality_score') is not None else None,
                'series': [{'date': str(r.get('d')), 'views': int(r.get('views') or 0)} for r in series],
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _session_titles(ids):
    """{session_id: (title, about)} — which 1-on-1 each booking was."""
    ids = [i for i in ids if i]
    if not ids:
        return {}
    from sqlalchemy import bindparam
    rows = db.session.execute(text(
        "SELECT session_id, title, about FROM achiever_slots"
        " WHERE session_id IN :ids AND title IS NOT NULL").bindparams(bindparam('ids', expanding=True)),
        {'ids': ids}).fetchall()
    return {r[0]: (r[1], r[2]) for r in rows}


@_achievers_ns.route('/my-sessions')
class MyAchieverSessions(Resource):
    @jwt_required()
    def get(self):
        try:
            student_id = get_jwt_identity()
            # ── SP: sp_achiever_sessions_list, sp_achievers_list, sp_achiever_slots_list
            # — no by-student-id or by-session-id filtered procs exist, so pull
            # bounded batches and join/filter in Python. ────────────────────────
            all_sessions = call_proc('sp_achiever_sessions_list', 50000, 0)
            sessions = [s for s in all_sessions if s.get('student_id') == student_id]
            sessions.sort(key=lambda s: s.get('created_at') or datetime.datetime.min, reverse=True)

            all_achievers = {a['id']: a for a in call_proc('sp_achievers_list', 50000, 0, 0)}
            slot_rows = call_proc('sp_achiever_slots_list', 50000, 0) or []
            slots_by_id = {s['id']: s for s in slot_rows}

            result = []
            _rules = CR.rules()
            _titles = _session_titles([s['id'] for s in sessions])
            # A cancelled/missed session releases its slot; the paid order still
            # points at it, so the time and title stay visible.
            from sqlalchemy import bindparam
            _oids = [s['payment_order_id'] for s in sessions if s.get('payment_order_id')]
            _order_slot = dict(db.session.execute(text(
                "SELECT id, slot_id FROM payment_orders WHERE id IN :ids").bindparams(
                bindparam('ids', expanding=True)), {'ids': _oids}).fetchall()) if _oids else {}
            _missed = dict(db.session.execute(text(
                "SELECT id, missed_at IS NOT NULL FROM achiever_sessions WHERE student_id = :u"),
                {'u': student_id}).fetchall())
            for s in sessions:
                achiever = all_achievers.get(s.get('mentor_id'))
                _full = call_proc_one('sp_session_with_times', s['id']) or {}
                _cls = CR.state(_full, _full.get('start_utc'), _full.get('duration_minutes'),
                                'cancelled' if s.get('status') == 'cancelled'
                                else 'completed' if s.get('status') == 'completed' else 'live', _rules)
                prop_id = s.get('proposed_slot_id')
                slot = next((sl for sl in slot_rows
                             if sl.get('session_id') == s['id'] and sl.get('id') != prop_id), None)
                if not slot:
                    slot = slots_by_id.get(_order_slot.get(s.get('payment_order_id')))
                if s['id'] not in _titles and slot and slot.get('title'):
                    _titles[s['id']] = (slot.get('title'), slot.get('about'))
                prop = slots_by_id.get(prop_id) if prop_id else None
                # Prefer the achiever's own link; otherwise a deterministic Jitsi room once confirmed.
                meet_url = s.get('meeting_link') or (f"https://meet.jit.si/skovo-session-{s['id'][:12]}" if s.get('status') in ('confirmed', 'completed') else None)
                result.append({
                    'id':           s['id'],
                    'title':        (_titles.get(s['id']) or (None, None))[0],
                    'about':        (_titles.get(s['id']) or (None, None))[1],
                    'mentor_id':    s.get('mentor_id'),
                    'mentor_name':  achiever.get('full_name') if achiever else 'Unknown',
                    'mentor_designation': achiever.get('designation') if achiever else None,
                    'mentor_company':     achiever.get('company') if achiever else None,
                    'note':         s.get('note'),
                    'mentor_notes': s.get('mentor_notes'),
                    'status':       s.get('status'),
                    'meeting_link': meet_url if _cls['started'] else None,
                    'class': _cls,
                    'can_report': bool(_cls['rules'] and s.get('status') == 'completed'
                                       and s.get('payment_status') == 'paid' and CR.complaint_open(_full, _rules)),
                    'created_at':   serialize_datetime(s['created_at']) if s.get('created_at') else None,
                    'slot_date':    str(slot['slot_date']) if slot and slot.get('slot_date') else None,
                    'slot_start':   str(slot['start_time']) if slot and slot.get('start_time') else None,
                    'slot_end':     str(slot['end_time']) if slot and slot.get('end_time') else None,
                    'payment_status': s.get('payment_status'),
                    'missed':       bool(_missed.get(s['id'])),
                    'proposed_slot_id': prop_id,
                    'proposed_slot_date': str(prop['slot_date']) if prop and prop.get('slot_date') else None,
                    'proposed_slot_start': str(prop['start_time'])[:8] if prop and prop.get('start_time') else None,
                })
            return jsonify(response={'sessions': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /achievers/my-sessions: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Achiever portal routes (authenticated achiever only) ─────────────────────

def _retire_old_avatar(achiever_id, old_url, new_url):
    """Delete the file an avatar just stopped pointing at. Best effort, never fatal.

    Replacing a photo only moves the row pointer, so without this every avatar
    anyone has ever uploaded stays in the bucket for good.

    Guarded twice, because the alternative is destroying something irreplaceable:
    `storage.object_name` refuses anything that is not an /uploads/<name> URL we
    produced (an admin can paste an arbitrary avatar URL into this column), and
    the old file is left alone if any row in `achiever_documents` still points at
    it — those are identity documents and proofs of achievement, and one of them
    sharing a URL with the avatar must never mean the document is deleted.

    Compared by stored name, not by string — the same fix the student portal's
    copy of this already carries. The GET hands the form `browser_url(...)`, an
    absolute "https://api.skovoai.com/uploads/x.png", while the row may still
    hold "/uploads/x.png"; Save Profile posts the whole form back, so a string
    comparison read those two shapes as two different files and deleted the one
    the row had just been pointed at. The profile fields saved, the avatar file
    was destroyed, and the next render fell back to the default photo. Same
    reason the document guard matches on the name as well as the exact URL: an
    identity document written in the other shape was invisible to it.
    """
    from portal.helpers.storage import delete_file, object_name
    try:
        old_name = object_name(old_url)
        if not old_name or old_name == object_name(new_url):
            return
        still_used = db.session.execute(
            text("SELECT 1 FROM achiever_documents "
                 "WHERE file_url = :exact OR file_url LIKE :suffix LIMIT 1"),
            {'exact': old_url, 'suffix': f'%/{old_name}'},
        ).first()
        if still_used:
            logger.info(f"avatar {old_name} kept — still referenced by a document row")
            return
        if delete_file(old_url):
            logger.info(f"replaced avatar removed for achiever {achiever_id}: {old_name}")
    except Exception as e:
        # A stale file is untidy; a failed profile save is not acceptable.
        logger.warning(f"old avatar cleanup skipped for {achiever_id}: {e}")


def _commission_rate_for(achiever_id):
    """This achiever's effective commission as a ratio, e.g. 0.10 for 10%.

    Resolved, not assumed: sp_commission_rate_resolve applies their own rule if
    one exists and the platform default otherwise. Falls back to the platform
    default on error rather than guessing a number — a wrong split shown to an
    achiever is worse than a missing one.
    """
    try:
        row = call_proc_one('sp_commission_rate_resolve', achiever_id, 'session')
        return float(row['rate']) if row and row.get('rate') is not None else None
    except Exception as e:
        logger.error(f"commission lookup failed for {achiever_id}: {e}")
        return None


def _seat_allocation_for(achiever_id):
    """How many seats each of this achiever's cohorts may hold, or None.

    None means an admin has not set a cap, which is how every cohort behaved
    before the column existed — unlimited. Achievers approved before the
    allocation shipped therefore keep working instead of being locked out.

    On error this returns None rather than a guess: refusing enrolments
    because a lookup failed would be a worse failure than an uncapped cohort.
    """
    try:
        row = db.session.execute(
            text("SELECT cohort_seat_allocation FROM achievers WHERE id = :i"),
            {'i': achiever_id},
        ).fetchone()
        return int(row[0]) if row and row[0] is not None else None
    except Exception as e:
        logger.error(f"seat allocation lookup failed for {achiever_id}: {e}")
        return None


@_achievers_ns.route('/portal/profile')
class AchieverPortalProfile(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get + sp_achiever_reviews_list ────────────────
            a = call_proc_one('sp_achievers_get', achiever_id)
            if not a:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            all_reviews = call_proc('sp_achiever_reviews_list', 5000, 0, 1)
            reviews = [r for r in all_reviews if r.get('achiever_id') == achiever_id]
            review_count = len(reviews)
            rating = round(sum(r['rating'] for r in reviews) / review_count, 1) if review_count else 0
            return jsonify(response={
                'id': a['id'], 'full_name': a['full_name'], 'email': a['email'],
                'bio': a['bio'], 'designation': a['designation'], 'company': a['company'],
                'linkedin_url': a['linkedin_url'], 'domains': _as_list(a.get('domains')),
                **_achiever_identity(achiever_id),
                'skills': _as_list(a.get('skills')), 'profile_image_url': _avatar_url(a),
                'suitable_for': _as_list(a.get('suitable_for')),
                'is_verified': bool(a['is_verified']), 'is_active': bool(a['is_active']),
                'rating': rating, 'review_count': review_count,
                'session_rate': float(a.get('session_rate') or 0),
                # The achiever's real commission — theirs if one was negotiated,
                # otherwise the platform default. The cohort and course screens
                # had 30% typed into them, so an achiever was being shown a
                # split that had nothing to do with what they are actually paid.
                'commission_rate': _commission_rate_for(a['id']),
                # Seats per cohort, granted by an admin at approval. The create
                # form shows it read-only; null means no cap was set and the
                # form says so rather than inventing a number.
                'cohort_seat_allocation': _seat_allocation_for(a['id']),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achievers_get + _update (full replace) ──────────────────
            a = call_proc_one('sp_achievers_get', achiever_id)
            if not a:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            data = request.get_json() or {}

            def val(key):
                return (data[key] or '').strip() or None if key in data else a.get(key)

            # LinkedIn is required, and it is the one profile field an admin can
            # independently check -- it is how "Senior Engineer at Google" gets
            # confirmed against a real person before approval.
            #
            # Validated only when the payload actually carries the field. This
            # endpoint also takes targeted writes -- the avatar upload PUTs
            # {profile_image_url} on its own -- and an unconditional check read
            # the *stored* value for those, so uploading a photo before filling
            # in LinkedIn failed with a 400 about a field the caller never sent.
            # Presence is enforced where it matters instead: the form requires it
            # to save, and submit-for-review refuses without it.
            if 'linkedin_url' in data:
                _li = (data.get('linkedin_url') or '').strip().lstrip('@')
                if not _li:
                    return jsonify(response={'message': 'A LinkedIn profile URL is required.',
                                             'field': 'linkedin_url'}, status=400, bool=False)
                # The scheme is optional on the way in -- LinkedIn displays the
                # profile address without one -- and added before storing, so
                # what is saved is always followable.
                if not re.match(r'^(https?://)?([a-z]{2,3}\.)?linkedin\.com/.+', _li, re.I):
                    return jsonify(response={
                        'message': 'That does not look like a LinkedIn profile URL. '
                                   'Use the full address, e.g. https://linkedin.com/in/your-name',
                        'field': 'linkedin_url'}, status=400, bool=False)
                if not re.match(r'^https?://', _li, re.I):
                    _li = 'https://' + _li
                data['linkedin_url'] = _li

            # Stated maximums for the free-text profile fields. Checked only for
            # keys the payload actually carries, for the same reason the LinkedIn
            # check above is: this endpoint takes targeted writes (the avatar
            # upload PUTs {profile_image_url} alone), and validating the *stored*
            # value would fail a save over a field the caller never sent.
            # X04-043/046/051/058.
            _limits = [(k, lbl, cap) for k, lbl, cap in (
                ('full_name', 'Full name', FL.FULL_NAME),
                ('designation', 'Designation', FL.DESIGNATION),
                ('company', 'Company', FL.COMPANY),
                ('bio', 'Bio', FL.BIO),
                ('linkedin_url', 'LinkedIn URL', FL.URL),
            ) if k in data]
            verr = FL.check_all([(data.get(k), lbl, cap) for k, lbl, cap in _limits])
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            full_name = data['full_name'].strip() if data.get('full_name') and data['full_name'].strip() else a['full_name']
            profile_image_url = val('profile_image_url')
            # Keep the two avatar columns in sync: the portal writes profile_image_url,
            # but course/booking cards read avatar_url. Mirror it so they never disagree.
            avatar_url = profile_image_url if 'profile_image_url' in data else a.get('avatar_url')

            # ── Rate ceiling ─────────────────────────────────────────────────
            # This accepted any positive number, so an achiever could set ₹1 or
            # ₹5,00,000 and it went live with no approval. The ceiling comes
            # from their tier in achiever_trust_rules; clamp_rate returns a note
            # when it had to intervene, because silently rewriting someone's
            # price is how you get a support ticket.
            session_rate = a.get('session_rate')
            rate_note = None
            if 'session_rate' in data:
                session_rate, rate_note = T.clamp_rate(achiever_id, data.get('session_rate'))

            password_hash = a.get('password_hash')
            if data.get('new_password') and len(data['new_password']) >= 6:
                password_hash = generate_password_hash(data['new_password'])

            call_proc_one(
                'sp_achievers_update',
                achiever_id, full_name, a.get('achievement_title'), val('designation'), val('company'),
                val('bio'), avatar_url, json.dumps(_as_list(a.get('skills'))) if 'skills' not in data else json.dumps(data['skills'] or []),
                a.get('domain_id'), val('linkedin_url'),
                a.get('is_verified'), a.get('is_featured'), a.get('is_active'), a.get('email'),
                password_hash, a.get('status'), a.get('phone'), profile_image_url,
                json.dumps(data['domains'] or []) if 'domains' in data else json.dumps(_as_list(a.get('domains'))),
                json.dumps(data['suitable_for'] or []) if 'suitable_for' in data else json.dumps(_as_list(a.get('suitable_for'))),
                session_rate, a.get('payout_account_name'), a.get('payout_account_number'),
                a.get('payout_ifsc'), a.get('payout_upi'), a.get('created_by'), achiever_id,
            )
            id_err = _save_achiever_identity(achiever_id, data)
            if id_err:
                db.session.rollback()
                return jsonify(response={'message': id_err}, status=400, bool=False)
            db.session.commit()

            # Only after the row is committed: the old file must not be removed
            # while the pointer to the new one could still roll back.
            if 'profile_image_url' in data:
                _retire_old_avatar(achiever_id, a.get('profile_image_url'), profile_image_url)

            return jsonify(response={
                'message': 'Profile updated.',
                # Echoed back so the client renders what was *stored*, not what
                # it hoped was stored. The avatar step PUTs {profile_image_url}
                # on its own and previously trusted its own copy of the value.
                #
                # Normalised through the same helper the GET uses, so the two
                # never disagree about the shape of the URL. The raw column
                # value can be a bare "/uploads/x.png", which a browser resolves
                # against the SPA origin rather than the API — the web portal
                # has mediaUrl() to repair that, but the mobile app has no
                # resolver of its own and rendered the default avatar instead.
                'profile_image_url': _avatar_url({'profile_image_url': profile_image_url}),
                # Present only when the tier ceiling changed what they asked for.
                'rate_note': rate_note,
                'session_rate': float(session_rate or 0),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/bookings')
class AchieverPortalBookings(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_achiever_bookings_page / sp_achiever_bookings_stats ────
            # This used to call sp_achiever_sessions_list(50000) +
            # sp_users_list(50000) + sp_achiever_slots_list(50000) and filter in
            # Python — three whole tables pulled across the wire to answer a
            # question about one page of one achiever's sessions. The procedures
            # now filter, join, order and page in SQL.
            d_from, d_to = _range_args()
            status = (request.args.get('status') or 'all').strip()
            search = (request.args.get('search') or '').strip()
            limit, offset, page, per_page = _page_args()

            rows = call_proc('sp_achiever_bookings_page', achiever_id, d_from, d_to,
                             status, search, limit, offset)

            result = []
            _rules = CR.rules()
            _titles = _session_titles([s['id'] for s in rows])
            for s in rows:
                meet_url = s.get('meeting_link') or None
                _full = call_proc_one('sp_session_with_times', s['id']) or {}
                _cls = CR.state(_full, _full.get('start_utc'), _full.get('duration_minutes'),
                                'cancelled' if s.get('status') == 'cancelled'
                                else 'completed' if s.get('status') == 'completed' else 'live', _rules)
                result.append({
                    'class': _cls,
                    'id': s['id'],
                    'title': (_titles.get(s['id']) or (None, None))[0],
                    'about': (_titles.get(s['id']) or (None, None))[1],
                    'student_id': s.get('student_id'),
                    'student_name': s.get('student_name') or 'Deleted student',
                    'student_email': s.get('student_email'),
                    'note': s.get('note'),
                    'mentor_notes': s.get('mentor_notes'),
                    'status': s.get('status'),
                    'meeting_link': meet_url,
                    # NOT serialize_datetime: that appends `Z`, and a slot is not
                    # UTC. /achiever-availability/my-slots stores slot_date and
                    # start_time exactly as the achiever typed them — local wall
                    # clock, no conversion — unlike cohorts.session_date, which is
                    # converted on write. Stamping `Z` here would tell the browser
                    # to shift a 14:00 slot to 19:30 IST.
                    'scheduled_at': (s['scheduled_at'].strftime('%Y-%m-%dT%H:%M:%S')
                                     if hasattr(s.get('scheduled_at'), 'strftime')
                                     else (str(s['scheduled_at']).replace(' ', 'T').rstrip('Z')
                                           if s.get('scheduled_at') else None)),
                    'created_at': serialize_datetime(s.get('created_at')),
                    'amount': float(s['amount']) if s.get('amount') is not None else None,
                    'achiever_earning': (float(s['achiever_earning'])
                                         if s.get('achiever_earning') is not None else None),
                    'payment_status': s.get('payment_status'),
                    'duration_minutes': s.get('duration_minutes'),
                    'proposed_slot_id': s.get('proposed_slot_id'),
                    'proposed_slot_date': (
                        str(s['proposed_slot_date']) if s.get('proposed_slot_date') else None),
                    'proposed_slot_start': (
                        str(s['proposed_slot_start'])[:8] if s.get('proposed_slot_start') else None),
                })

            # `total` is the number of rows matching the filter, not the length of
            # this page — the pager needs the former to know how many pages exist.
            matched = int(rows[0]['total_rows']) if rows else 0
            stats = call_proc_one('sp_achiever_bookings_stats', achiever_id, d_from, d_to) or {}

            return jsonify(response={
                'bookings': result,
                'total': matched,
                'page': page, 'per_page': per_page,
                'pages': max(1, -(-matched // per_page)),
                # Window tallies for the cards — independent of the status filter.
                'pending':   int(stats.get('pending') or 0),
                'confirmed': int(stats.get('confirmed') or 0),
                'completed': int(stats.get('completed') or 0),
                'window_total': int(stats.get('total') or 0),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/bookings/<string:session_id>')
class AchieverPortalBookingDetail(Resource):
    @jwt_required()
    def put(self, session_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achiever_sessions_get ─────────────────────────────────────
            existing = call_proc_one('sp_achiever_sessions_get', session_id)
            if not existing or existing.get('mentor_id') != achiever_id:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            old_status = existing.get('status')

            new_status = data['status'] if data.get('status') in ('confirmed', 'completed', 'cancelled') else None
            _full = call_proc_one('sp_session_with_times', session_id) or {}
            _r = CR.rules()
            _st = CR.state(_full, _full.get('start_utc'), _full.get('duration_minutes'), 'live', _r)
            if new_status == 'completed' and _st['rules']:
                if not _st['started']:
                    return jsonify(response={'message': 'Press Start first.'}, status=400, bool=False)
                if not _st['can_end']:
                    return jsonify(response={'message': 'You can end the session from 5 minutes before its end.'},
                                   status=400, bool=False)
            _late_cancel = (new_status == 'cancelled' and old_status in ('pending', 'confirmed')
                            and CR.follows(_full, _r) and CR.change_locked(_full.get('start_utc'), _r))
            new_meeting_link = (data['meeting_link'] or '').strip() or None if 'meeting_link' in data else None
            new_mentor_notes = (data['mentor_notes'] or '').strip() or None if 'mentor_notes' in data else None
            new_no_show = (1 if data['no_show'] else 0) if 'no_show' in data else None

            # ── SP: sp_achiever_session_set_status — the DB write for the 4
            # updatable fields. External side effects (slot release, gateway
            # refund, email/notification) can't live in SQL, so they stay here,
            # reading the SP's committed row directly. ─────────────────────────
            s = call_proc_one('sp_achiever_session_set_status', session_id, achiever_id,
                               new_status, new_meeting_link, new_mentor_notes, new_no_show)
            if new_status == 'completed':
                call_proc_one('sp_session_mark_ended', session_id)
            db.session.commit()

            if new_status == 'cancelled':
                # Releasing a cancelled session frees its slot so it can be booked again.
                # ── SP: sp_achiever_slots_list, sp_achiever_slots_update ────────────
                all_slots = call_proc('sp_achiever_slots_list', 50000, 0)
                slot = next((sl for sl in all_slots if sl.get('session_id') == s['id']), None)
                if slot:
                    call_proc_one(
                        'sp_achiever_slots_update',
                        slot['id'], slot.get('mentor_id'), slot.get('slot_date'), slot.get('start_time'),
                        slot.get('end_time'), None, 'available',
                    )
                # The achiever cancelled: 100% back to the student's SKOVO wallet.
                if s.get('payment_status') == 'paid' and s.get('payment_order_id'):
                    try:
                        CR.refund_session(session_id, 'achiever_cancel', 'Achiever cancelled the session',
                                          actor_id=achiever_id, suffix='ac')
                    except Exception as re:
                        # Never silent: a swallowed refund is money the student
                        # is owed that nobody knows about.
                        logger.error("Refund error for session %s: %s", s.get('id'), re)
                    s = call_proc_one('sp_achiever_sessions_get', session_id) or s
                db.session.commit()
                if _late_cancel:
                    CR.add_strike(achiever_id, 'late_cancel', 'session', session_id, note='1-on-1 session')

            # Notify student on status change
            if 'status' in data and data['status'] != old_status:
                try:
                    from portal.helpers.notifications import notify_user
                    # The join link opens only after the achiever presses Start,
                    # so the confirmation points to My Bookings instead of the link.
                    link = s.get('meeting_link') or None
                    confirm_body = 'Your achiever confirmed your 1-on-1 session. Join opens on My Bookings when they start.'
                    msgs = {
                        'confirmed': ('Session Confirmed!', confirm_body),
                        'completed': ('Session Completed', 'Your session has been marked as completed.'),
                        'cancelled': ('Session Cancelled', 'Your achiever cancelled the session. You got 100% back in your SKOVO Wallet.'),
                    }
                    title, body = msgs.get(data['status'], ('Session Update', 'Your session status was updated.'))
                    notify_user(user_id=s.get('student_id'), title=title, body=body, type='session', reference_type='session', reference_id=session_id)
                    # Also email the student for confirmed/cancelled (not for completed).
                    if data['status'] in ('confirmed', 'cancelled'):
                        try:
                            from portal.helpers.email_template import send_email, simple_email_body
                            student = call_proc_one('sp_users_get', s.get('student_id'))
                            if student and student.get('email'):
                                import os as _os
                                _bk = (_os.environ.get('FRONTEND_URL') or 'https://skovoai.com').rstrip('/') + '/bookings'
                                btn = (_bk, 'Open My Bookings') if data['status'] == 'confirmed' else (None, None)
                                # Attach a calendar invite on confirmation so the session
                                # lands in the student's calendar with a 15-min alarm.
                                atts = None
                                if data['status'] == 'confirmed':
                                    atts = _session_ics(s, None, student['email'])  # link opens at Start, not before
                                send_email(student['email'], f"SKOVO — {title}",
                                           simple_email_body(title, body, btn[0], btn[1]),
                                           attachments=atts)
                        except Exception:
                            pass
                except Exception:
                    pass

            # Meeting link added/updated on an already-confirmed session without a
            # status change — the block above only fires on status change, so push
            # the new join link to the student here, otherwise they never receive it.
            elif 'meeting_link' in data and s.get('meeting_link') and s.get('status') == 'confirmed':
                try:
                    from portal.helpers.notifications import notify_user
                    # Before Start the link stays hidden; after Start it is shown.
                    started = bool(s.get('started_at'))
                    body = (f"Your session join link is ready: {s['meeting_link']}" if started
                            else "Your achiever updated the meeting link. Join opens on My Bookings when they start.")
                    notify_user(user_id=s.get('student_id'), title='Session Link Updated', body=body,
                                type='session', reference_type='session', reference_id=session_id)
                    try:
                        from portal.helpers.email_template import send_email, simple_email_body
                        student = call_proc_one('sp_users_get', s.get('student_id'))
                        if student and student.get('email'):
                            send_email(student['email'], "SKOVO — Session Link Updated",
                                       simple_email_body('Session Link Updated',
                                                         body,
                                                         (s['meeting_link'] if started else
                                                          (__import__('os').environ.get('FRONTEND_URL') or 'https://skovoai.com').rstrip('/') + '/bookings'),
                                                         'Join Session' if started else 'Open My Bookings'))
                    except Exception:
                        pass
                except Exception:
                    pass

            return jsonify(response={'message': 'Session updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/sessions/<string:session_id>/start')
class AchieverPortalSessionStart(Resource):
    @jwt_required()
    def post(self, session_id):
        """Achiever starts a 1-on-1; the student's Join opens only now."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            s = call_proc_one('sp_session_with_times', session_id)
            if not s or s.get('mentor_id') != achiever_id:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            if s.get('status') != 'confirmed' or s.get('missed_at'):
                return jsonify(response={'message': 'This session is not open.'}, status=409, bool=False)
            r = CR.rules()
            st = CR.state(s, s.get('start_utc'), s.get('duration_minutes'), 'live', r)
            if st['rules'] and not s.get('started_at') and not st['can_start']:
                if st.get('start_late'):
                    msg = 'The time to start has passed. The session is marked missed and the student gets 100% back.'
                else:
                    opens = s['start_utc'] - datetime.timedelta(minutes=int(r['start_before_min']))
                    msg = f"You can start from {format_ist(opens, fmt='%d %b, %I:%M %p')}."
                return jsonify(response={'message': msg}, status=400, bool=False)
            call_proc_one('sp_session_mark_started', session_id)
            if not s.get('meeting_link'):
                link = db.session.execute(text(
                    "SELECT COALESCE(sl.meeting_link, a.session_meeting_link) FROM achiever_sessions x"
                    "  LEFT JOIN achiever_slots sl ON sl.session_id = x.id"
                    "  LEFT JOIN achievers a ON a.id = x.mentor_id WHERE x.id = :i LIMIT 1"), {'i': session_id}).scalar()
                if link:
                    db.session.execute(text("UPDATE achiever_sessions SET meeting_link = :l WHERE id = :i"),
                                       {'l': link, 'i': session_id})
                    s['meeting_link'] = link
            db.session.commit()
            try:
                from portal.helpers.notifications import notify_user
                notify_user(s.get('student_id'), 'Session started', 'Your 1-on-1 has started. Join now.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass
            return jsonify(response={'message': 'Session started.', 'meeting_link': s.get('meeting_link')},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/domains')
class AchieverPortalDomains(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_domains_list ──────────────────────────────────────────
            # Two levels now: a domain (Engineering) and its sub-domains
            # (Computer Science, Robotics). Seeded from `course_catalogue`, which
            # is the taxonomy students' courses already use — so an achiever's
            # expertise and a student's course finally share one spine.
            domains = call_proc('sp_domains_list', 5000, 0, 1)
            by_id = {d['id']: d for d in domains}

            tops = sorted((d for d in domains if not d.get('parent_id')),
                          key=lambda d: (d.get('name') or ''))
            kids = {}
            for d in domains:
                if d.get('parent_id') and d['parent_id'] in by_id:
                    kids.setdefault(d['parent_id'], []).append(d)

            result = [{
                'id': p['id'],
                'name': p.get('name'),
                'children': [{'id': c['id'], 'name': c.get('name')}
                             for c in sorted(kids.get(p['id'], []),
                                             key=lambda c: (c.get('name') or ''))],
            } for p in tops]

            # Flat list too: existing callers (the cohort form, the profile
            # screen) expect `domains` to be pickable rows, and a sub-domain is
            # just as valid a choice as a top-level one.
            flat = [{'id': d['id'], 'name': d.get('name'),
                     'parent_id': d.get('parent_id'),
                     'parent_name': by_id.get(d.get('parent_id'), {}).get('name')}
                    for d in sorted(domains, key=lambda d: (d.get('name') or ''))]

            return jsonify(response={'domains': flat, 'tree': result},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            from flask import request as req
            data = req.get_json() or {}
            name = (data.get('name') or '').strip()
            if not name:
                return jsonify(response={'message': 'Domain name is required.'}, status=400, bool=False)
            # ── SP: sp_domains_list — no case-insensitive-name/slug lookup proc
            # exists, so pull a bounded batch and check here. ──────────────────
            # 0 = include inactive, so a name already awaiting review is not
            # suggested a second time.
            all_domains = call_proc('sp_domains_list', 5000, 0, 0)
            _k = lambda v: re.sub(r'[^a-z0-9]', '', (v or '').lower())
            existing = next((d for d in all_domains if _k(d.get('name')) == _k(name)), None)
            if existing:
                pending = not existing.get('is_active')
                return jsonify(response={
                    'message': (f'"{existing.get("name")}" is already awaiting review.' if pending
                                else f'"{existing.get("name")}" is already in the list.'),
                    'domain': {'id': existing['id'], 'name': existing.get('name')},
                }, status=409, bool=False)
            slug = name.lower().replace(' ', '-').replace('&', 'and')
            slug = re.sub(r'[^a-z0-9-]', '', slug)
            slug = re.sub(r'-+', '-', slug).strip('-')
            # Ensure slug is unique
            existing_slugs = {d.get('slug') for d in all_domains}
            base_slug = slug
            counter = 1
            while slug in existing_slugs:
                slug = f'{base_slug}-{counter}'
                counter += 1
            # ── SP: sp_domains_create ────────────────────────────────────────────
            domain_id = str(uuid.uuid4())
            # Record the author. This was passing NULL for created_by, so nothing
            # knew which achiever added a domain — and since removal is limited to
            # your own rows, an achiever could add to the shared list but never
            # take anything back out of it.
            # SUGGESTION used to park the row at is_active=0 until an admin
            # approved it — then the achiever could not use React Native on the
            # cohort they were creating. Insert is live immediately; created_by
            # records who added it. Duplicates are still refused case-insensitively.
            domain = call_proc_one(
                'sp_domains_create',
                domain_id, name, slug, None, None, 1, achiever_id, achiever_id,
            )
            db.session.commit()
            logger.info(f"Achiever {achiever_id} added domain '{name}' ({domain_id})")
            return jsonify(response={
                'message': f'"{name}" added.',
                'status': 'active',
                'domain': {'id': domain['id'], 'name': domain.get('name'), 'is_active': True},
            }, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/domains/<string:domain_id>')
class AchieverPortalDomainDetail(Resource):
    @jwt_required()
    def put(self, domain_id):
        claims = get_jwt()
        if claims.get('role') != 'mentor':
            return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
        # Domains are shared platform taxonomy. Achievers may create new ones, but
        # renaming an existing domain would change it for every achiever using it, so
        # editing is restricted to admins (see /admin/domains).
        return jsonify(response={'message': 'Domains are managed by admins and cannot be edited here.'}, status=403, bool=False)

    @jwt_required()
    def delete(self, domain_id):
        """Remove a domain this achiever added and nobody is using.

        Creating was allowed but removing was not, so a typo entered here became
        a permanent row in the platform-wide list for every achiever. Deleting is
        deliberately narrow: your own, and unused.
        """
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_domains_get ───────────────────────────────────────────
            domain = call_proc_one('sp_domains_get', domain_id)
            if not domain:
                return jsonify(response={'message': 'Domain not found.'}, status=404, bool=False)
            if domain.get('created_by') != achiever_id:
                return jsonify(response={
                    'message': 'You can only remove a domain you added. Ask an admin to remove others.'},
                    status=403, bool=False)

            # ── SP: sp_cohorts_list — no by-domain-id filter on the generic proc
            used = any(c.get('domain_id') == domain_id and not c.get('deleted_at')
                       for c in call_proc('sp_cohorts_list', 5000, 0))
            if used:
                return jsonify(response={
                    'message': 'This domain is used by a cohort and cannot be removed.'},
                    status=409, bool=False)

            # ── SP: sp_domains_delete ────────────────────────────────────────
            call_proc('sp_domains_delete', domain_id)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} removed domain {domain_id}")
            return jsonify(response={'message': 'Domain removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# order matches sp_cohorts_create/_update after (id, title)
_COHORT_FIELDS = [
    ('achiever_id', None), ('domain_id', None), ('session_date', 'date'), ('duration_minutes', int),
    ('total_seats', int), ('filled_seats', None), ('price', int), ('status', None), ('reminder_sent', None),
    ('about', None), ('what_you_learn', 'json'), ('thumbnail_url', None), ('level', None),
    ('registration_deadline', 'date'), ('meeting_link', None),
    ('target_categories', 'json'), ('target_streams', 'json'), ('target_degree_cats', 'json'),
    ('target_exam_targets', 'json'), ('target_prof_courses', 'json'), ('target_years', 'json'),
    ('target_degrees', 'json'), ('target_branches', 'json'),
]


def _cohort_sp_args(cid, title, d, existing=None):
    existing = existing or {}
    args = [cid, title]
    for field, caster in _COHORT_FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v) if v is not None else None
            elif caster == 'date':
                v = parse_local_to_utc(v) if v else None
            elif caster:
                # NULL survives the cast. The json and date branches above have
                # always guarded None; this one did not, and `total_seats` is
                # deliberately None for an uncapped cohort — which is every
                # cohort, since seat limits were removed. So `int(None)` raised
                # a TypeError on the way to sp_cohorts_create and *every* create
                # answered 500, whatever the achiever typed. NULL is what the
                # column and the enrolment procedures already expect: NULL or 0
                # means unlimited, only a positive value is a ceiling.
                # '' is folded in too — an emptied number input posts a string.
                v = caster(v) if v not in (None, '') else None
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


def _late_join_minutes(v):
    """Minutes after the start a student may still take a leftover seat
    (0 = closes at the start, None = not sent). Capped by _late_join_error."""
    if v in (None, ''):
        return None
    try:
        return max(0, int(v))
    except (TypeError, ValueError):
        return None


def _time_clash_error(achiever_id, start_utc, duration, exclude_cohort=None):
    """One achiever cannot teach two things at once: another of their cohorts
    or a booked 1-on-1 overlapping this class refuses the save."""
    try:
        duration = int(duration or 0)
    except (TypeError, ValueError):
        return None
    if not start_utc or duration <= 0:
        return None
    end_utc = start_utc + datetime.timedelta(minutes=duration)
    # ── SP: sp_achiever_time_clash ─────────────────────────────────────────
    hit = call_proc_one('sp_achiever_time_clash', achiever_id, start_utc, end_utc, exclude_cohort)
    if not hit:
        # A 1-on-1 being paid for right now holds the time too.
        slot = db.session.execute(text(
            "SELECT start_utc FROM achiever_slots WHERE mentor_id = :a AND status = 'blocked'"
            "   AND start_utc IS NOT NULL AND start_utc < :e AND end_utc > :s ORDER BY start_utc LIMIT 1"),
            {'a': achiever_id, 's': start_utc, 'e': end_utc}).first()
        if slot:
            return (f"A student is booking a 1-on-1 with you at {format_ist(slot[0], '%d %b, %I:%M %p')}. "
                    "Pick a time that does not overlap.")
        return None
    when = f"{format_ist(hit['starts_at'], '%d %b, %I:%M %p')} to {format_ist(hit['ends_at'], '%I:%M %p')}"
    what = f"'{hit['title']}'" if hit.get('kind') == 'cohort' else 'a booked 1-on-1 session'
    return f"You already have {what} from {when}. Pick a time that does not overlap."


def _late_join_error(late, duration):
    """Late joining can never run past the end of the class."""
    try:
        duration = int(duration or 0)
    except (TypeError, ValueError):
        return None
    if late is not None and duration and late > duration:
        return f'Late joining cannot be longer than the class ({duration} minutes).'
    return None


def _existing_slabs(c):
    """A cohort's offer as slabs, including one saved before slabs existed."""
    t = parse_offer_tiers(c.get('offer_tiers'))
    if t:
        return t
    price = int(c.get('price') or 0)
    if int(c.get('offer_percent') or 0) > 0:
        return {'type': 'percent', 'tiers': [{'seats': c.get('offer_seats'), 'value': int(c['offer_percent'])}]}
    if c.get('offer_price') is not None:
        return {'type': 'amount', 'tiers': [{'seats': c.get('offer_seats'), 'value': price - int(c['offer_price'])}]}
    return None


def _offer_from(data, price, session_utc, total_seats, existing=None, used=0):
    """Public offer in slabs from the cohort form (v1 has no coupon codes).

    Slabs: first 3 students at 50% off, next 3 at 40%, ... One slab is a plain
    offer. A blank `seats` on the last slab means every remaining seat.
    Returns (offer, error). offer is None when the form did not send one
    (leave it), {} to clear it, else {'legacy': sp_cohort_offer_set args,
    'tiers': JSON}. Once students have bought at the offer the slabs are fixed;
    the end date can only move later, or the offer can be stopped.
    """
    if 'offer_type' not in data:
        return None, None
    kind = (data.get('offer_type') or '').strip()
    if not kind:
        return {}, None
    if kind not in ('percent', 'amount'):
        return None, 'Pick % off or ₹ off.'
    if price <= 0:
        return None, 'An offer needs a price. Free classes cannot have one.'
    raw = data.get('offer_tiers')
    if not raw:  # a single offer sent the old way
        raw = [{'seats': data.get('offer_seats'), 'value': data.get('offer_value')}]
    if not isinstance(raw, list) or not 1 <= len(raw) <= 5:
        return None, 'Add between 1 and 5 offer slabs.'
    tiers, prev = [], None
    for i, t in enumerate(raw):
        n = i + 1
        try:
            val = int((t or {}).get('value'))
        except (TypeError, ValueError):
            return None, f'Slab {n}: enter how much off.'
        if kind == 'percent' and not 1 <= val <= 90:
            return None, f'Slab {n}: discount must be between 1% and 90%.'
        if kind == 'amount' and not 1 <= val < price:
            return None, f'Slab {n}: discount must be between ₹1 and ₹{price - 1}.'
        if offer_tier_price(price, kind, val) < 1:
            return None, f'Slab {n}: the price must stay at least ₹1.'
        if prev is not None and val > prev:
            return None, f'Slab {n}: later students cannot get a bigger discount than earlier ones.'
        seats = (t or {}).get('seats')
        if seats in (None, ''):
            if n != len(raw):
                return None, f'Slab {n}: enter how many students.'
            seats = None
        else:
            try:
                seats = int(seats)
            except (TypeError, ValueError):
                return None, f'Slab {n}: number of students must be a whole number.'
            if seats < 1:
                return None, f'Slab {n}: at least 1 student.'
        tiers.append({'seats': seats, 'value': val})
        prev = val
    counted = sum(t['seats'] for t in tiers if t['seats'] is not None)
    if total_seats and counted > int(total_seats):
        return None, f'The slabs add up to {counted} students, but the class has {total_seats} seats.'
    ends = data.get('offer_ends_at') or None
    if ends:
        ends = parse_local_to_utc(ends)
        if not ends:
            return None, 'Offer end date is not valid.'
        if ends <= datetime.datetime.utcnow():
            return None, 'Offer end date must be in the future.'
        if session_utc and ends > session_utc:
            return None, 'The offer must end before the class starts.'
    slabs = {'type': kind, 'tiers': tiers}
    if existing and used:
        old = _existing_slabs(existing)
        old_ends = existing.get('offer_ends_at')
        if old != slabs or (old_ends is not None and ends is not None and ends < old_ends):
            return None, ("Students have already booked, so the offer can't be changed. "
                          'You can only move its end date later.')
    first = tiers[0]
    open_end = tiers[-1]['seats'] is None
    legacy = (price - first['value'] if kind == 'amount' else None,
              first['value'] if kind == 'percent' else None,
              f"{first['value']}% off" if kind == 'percent' else f"₹{first['value']} off",
              ends, None if open_end else counted)
    return {'legacy': legacy, 'tiers': json.dumps(slabs)}, None


def _apply_offer(cohort_id, achiever_id, offer):
    """Save what _offer_from returned ({} clears the offer)."""
    if offer is None:
        return
    if not offer:
        call_proc_one('sp_cohort_offer_set', cohort_id, achiever_id, None, None, None, None, None)
        call_proc_one('sp_cohort_offer_tiers_set', cohort_id, achiever_id, None)
        return
    call_proc_one('sp_cohort_offer_set', cohort_id, achiever_id, *offer['legacy'])
    call_proc_one('sp_cohort_offer_tiers_set', cohort_id, achiever_id, offer['tiers'])


@_achievers_ns.route('/portal/cohorts')
class AchieverPortalCohorts(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_cohorts_list, sp_domains_list — no by-achiever-id filter
            # on the generic CRUD proc, so pull bounded batches and join here. ──
            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
            cohorts = [c for c in all_cohorts if c.get('achiever_id') == achiever_id]
            cohorts.sort(key=lambda c: c.get('created_at') or datetime.datetime.min, reverse=True)
            domains_by_id = {d['id']: d for d in call_proc('sp_domains_list', 5000, 0, 0)}

            result = []
            _rules = CR.rules()
            for c in cohorts:
                domain = domains_by_id.get(c.get('domain_id')) if c.get('domain_id') else None
                status_shim = types.SimpleNamespace(
                    status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes'),
                )
                _cls = CR.state(c, c.get('session_date'), c.get('duration_minutes'),
                                effective_cohort_status(status_shim), _rules)
                result.append({
                    'id': c['id'],
                    'title': c.get('title'),
                    'domain_id': c.get('domain_id'),
                    'domain_name': domain.get('name') if domain else None,
                    'session_date': serialize_datetime(c.get('session_date')),
                    'duration_minutes': c.get('duration_minutes'),
                    'total_seats': c.get('total_seats'),
                    'filled_seats': c.get('filled_seats'),
                    # Price and offer are fixed once anyone has booked (see PUT).
                    'price_locked': int(c.get('filled_seats') or 0) > 0,
                    'price': c.get('price'),
                    'offer_price': c.get('offer_price'),
                    'offer_percent': c.get('offer_percent'),
                    'offer_label': c.get('offer_label'),
                    'offer_starts_at': serialize_datetime(c.get('offer_starts_at')),
                    'offer_ends_at': serialize_datetime(c.get('offer_ends_at')),
                    'offer_seats': c.get('offer_seats'),
                    'offer_tiers': parse_offer_tiers(c.get('offer_tiers')),
                    # What a student pays right now (slab-aware), for the card.
                    'offer_now_price': ((cohort_offer_state(c) or {}).get('offer_price')
                                        if (c.get('offer_tiers') or c.get('offer_price') is not None
                                            or int(c.get('offer_percent') or 0) > 0) else None),
                    'status': effective_cohort_status(status_shim),
                    'about': c.get('about'),
                    'what_you_learn': _as_list(c.get('what_you_learn')),
                    'level': c.get('level'),
                    'registration_deadline': serialize_datetime(c.get('registration_deadline')),
                    'meeting_link': c.get('meeting_link'),
                    # Under the class rules the link opens only after Start.
                    'can_join': bool(c.get('meeting_link') and cohort_join_open(status_shim) and _cls['started']),
                    'class': _cls,
                    'time_up': cohort_time_up(status_shim),
                    'created_at': serialize_datetime(c.get('created_at')),
                })
            return jsonify(response={'cohorts': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── Lifecycle gate ───────────────────────────────────────────────
            # Only a verified (active) achiever may create a cohort.
            err = T.require_state(
                achiever_id, 'can_take_bookings',
                'Your account must be verified by an admin before you can create cohorts.')
            if err:
                return err
            # Paused (too many strikes): no new classes until an admin reviews.
            from portal.helpers import class_rules as CR
            if CR.paused(achiever_id):
                return jsonify(response={'message': 'New classes are paused until an admin reviews your account.'},
                               status=403, bool=False)
            data = request.get_json() or {}

            title = (data.get('title') or '').strip()
            if not title:
                return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)

            # 0 is a free cohort, not a missing price. Blank means free.
            price = data.get('price')
            try:
                price = int(price if price not in (None, '') else 0)
            except (ValueError, TypeError):
                return jsonify(response={'message': 'Price must be a whole number of rupees.'}, status=400, bool=False)
            if price < 0:
                return jsonify(response={'message': 'Price cannot be negative.'}, status=400, bool=False)

            # Paid cohort → needs the tier that permits taking money.
            if price > 0:
                err = T.require_state(
                    achiever_id, 'can_charge',
                    'Paid cohorts open once an admin has verified your account.')
                if err:
                    return err

            # Everything else the form collects, checked before MySQL sees it.
            # Covers session_date (which had its own check here), the
            # registration_deadline beside it that never had one, the two int
            # columns whose cast raised an uncaught ValueError, and the VARCHAR(50)
            # `level`. Each returns a 400 naming the field instead of a 500 with
            # an error id the achiever can do nothing with. See X-04.
            verr = validate_cohort_input(data, require_title=False, creating=True)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            lerr = _late_join_error(_late_join_minutes(data.get('late_join_minutes')), data.get('duration_minutes'))
            if lerr:
                return jsonify(response={'message': lerr}, status=400, bool=False)

            cerr = _time_clash_error(
                achiever_id, parse_local_to_utc(data['session_date']) if data.get('session_date') else None,
                data.get('duration_minutes'))
            if cerr:
                return jsonify(response={'message': cerr}, status=409, bool=False)

            offer_args, oerr = _offer_from(
                data, price, parse_local_to_utc(data['session_date']) if data.get('session_date') else None,
                _seat_allocation_for(achiever_id))
            if oerr:
                return jsonify(response={'message': oerr}, status=400, bool=False)

            cohort_id_new = str(uuid.uuid4())
            # Achiever supplies their own Teams / Google Meet link — no
            # auto-generated room. Optional at create; can be added later via Edit.
            provided_link = (data.get('meeting_link') or '').strip() or None
            learn = [s.strip() for s in (data.get('what_you_learn') or []) if str(s).strip()]

            create_defaults = {
                'achiever_id': achiever_id, 'domain_id': data.get('domain_id') or None,
                'duration_minutes': int(data['duration_minutes']),
                # The cap is the admin's number, not the achiever's. It is
                # copied onto the cohort at creation so the cohort keeps the
                # size it was published with: raising an achiever's allocation
                # later must not silently widen a cohort students already
                # chose to join. None (no allocation set) stays uncapped,
                # which is how every cohort behaved before this existed.
                'total_seats': _seat_allocation_for(achiever_id),
                'filled_seats': 0, 'price': price,
                'status': 'upcoming', 'reminder_sent': 0,
                'about': (data.get('about') or '').strip() or None,
                'what_you_learn': learn,
                'level': data.get('level') or None,
                'meeting_link': provided_link,
                # Anyone can enrol. Targeting is not collected on create.
                'target_categories': [], 'target_streams': [], 'target_degree_cats': [],
                'target_exam_targets': [], 'target_prof_courses': [], 'target_years': [],
                'target_degrees': [], 'target_branches': [],
            }
            if data.get('session_date'):
                create_defaults['session_date'] = data['session_date']
            # registration_deadline is not collected. Enrolment closes when live.

            # ── SP: sp_cohorts_create ──────────────────────────────────────────
            sp_args = _cohort_sp_args(cohort_id_new, title, create_defaults) + [achiever_id, achiever_id, None]
            cohort = call_proc_one('sp_cohorts_create', *sp_args)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} created cohort {cohort['id']}")

            tpl = 'standard'  # v1: admin's cancellation rules apply to every class
            db.session.execute(text(
                "UPDATE cohorts SET refund_template = :t WHERE id = :i"
            ), {'t': tpl, 'i': cohort['id']})
            late = _late_join_minutes(data.get('late_join_minutes'))
            if late is not None:
                db.session.execute(text("UPDATE cohorts SET late_join_minutes = :m WHERE id = :i"),
                                   {'m': late, 'i': cohort['id']})
            _apply_offer(cohort['id'], achiever_id, offer_args)
            db.session.commit()

            try:
                from portal.helpers.analytics import track_event
                track_event('cohort_created', entity_type='cohort', entity_id=cohort['id'], user_id=achiever_id, meta={'title': title, 'price': price}, req=request)
            except Exception:
                pass

            return jsonify(response={'message': 'Cohort created.', 'cohort_id': cohort['id'], 'meeting_link': provided_link}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/coupons')
class AchieverCoupons(Resource):
    @jwt_required()
    def get(self):
        """Achiever: list their own coupons."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            rows = call_proc('sp_achiever_coupon_list', achiever_id) or []

            def _cd(c):
                return {
                    'id': c.get('id'), 'code': c.get('code'),
                    'discount_type': c.get('discount_type'), 'value': float(c.get('value') or 0),
                    'max_discount': float(c['max_discount']) if c.get('max_discount') is not None else None,
                    'min_amount': float(c.get('min_amount') or 0),
                    'applies_to': c.get('applies_to'), 'max_uses': c.get('max_uses'),
                    'used_count': c.get('used_count') or 0, 'per_user_limit': c.get('per_user_limit'),
                    'valid_from': serialize_datetime(c.get('valid_from')),
                    'valid_until': serialize_datetime(c.get('valid_until')),
                    'is_active': bool(c.get('is_active')),
                }
            return jsonify(response={'coupons': [_cd(c) for c in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """Achiever: create a coupon (applies to their own cohorts/courses)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # Coupons are `active`-only in SCREENS, and until now that was
            # enforced by the sidebar alone -- a pending, suspended or
            # banned achiever could mint discount codes straight through the API,
            # and sp_student_coupon_validate honours them at checkout. AC01-009.
            err = T.require_screen(
                achiever_id, 'coupons',
                'Coupons open once your account is fully approved.')
            if err:
                return err
            d = request.get_json() or {}
            # Covers the code (presence, 40-char column cap, character set),
            # the discount value — including the PERCENTAGE CEILING that
            # existed nowhere before, so 500% was accepted by the form, this
            # route and the procedure alike — the numeric limits, and the
            # valid_from/valid_until ordering. See helpers/coupon_validation.py.
            verr = validate_coupon_input(d)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)
            code = (d.get('code') or '').strip().upper()
            dtype = d.get('discount_type') if d.get('discount_type') in ('percent', 'flat') else 'percent'
            applies = (d.get('applies_to') or '').strip()
            if applies not in ('cohort', 'session'):
                return jsonify(response={
                    'message': "applies_to must be 'cohort' or 'session'.",
                }, status=400, bool=False)

            def _f(v):
                try:
                    return float(v) if v not in (None, '', 'null') else None
                except (ValueError, TypeError):
                    return None

            def _i(v):
                try:
                    return int(v) if v not in (None, '', 'null') else None
                except (ValueError, TypeError):
                    return None

            def _d(v):
                s = (v or '').strip() if isinstance(v, str) else v
                return s or None

            res = call_proc_one(
                'sp_achiever_coupon_create', str(uuid.uuid4()), achiever_id, code, dtype,
                _f(d.get('value')) or 0, _f(d.get('max_discount')), _f(d.get('min_amount')) or 0,
                applies, _i(d.get('max_uses')), _i(d.get('per_user_limit')) or 1,
                _d(d.get('valid_from')), _d(d.get('valid_until')),
            )
            db.session.commit()
            if not res or not res.get('ok'):
                return jsonify(response={'message': (res or {}).get('message') or 'Could not create coupon.'}, status=400, bool=False)
            return jsonify(response={'message': 'Coupon created.', 'id': res.get('id')}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/coupons/<string:coupon_id>')
class AchieverCouponDetail(Resource):
    @jwt_required()
    def delete(self, coupon_id):
        """Achiever: deactivate their own coupon."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            res = call_proc_one('sp_achiever_coupon_deactivate', coupon_id, achiever_id)
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Coupon not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Coupon deactivated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/reschedule')
class AchieverCohortReschedule(Resource):
    @jwt_required()
    def post(self, cohort_id):
        """Move an upcoming cohort. Mail everyone. Refund clock uses the new time."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff in ('live', 'completed', 'cancelled'):
                return jsonify(response={
                    'message': 'Only an upcoming class can be rescheduled.',
                }, status=409, bool=False)
            data = request.get_json() or {}
            raw = (data.get('session_date') or '').strip()
            if not raw:
                return jsonify(response={'message': 'New session date is required.'}, status=400, bool=False)
            from portal.helpers.helpers import parse_local_to_utc
            new_dt = parse_local_to_utc(raw)
            if not new_dt:
                return jsonify(response={'message': 'Invalid session date.'}, status=400, bool=False)
            import datetime as _dt
            if new_dt < _dt.datetime.utcnow():
                return jsonify(response={'message': 'New time cannot be in the past.'}, status=400, bool=False)
            if CR.change_locked(cohort.get('session_date')):
                return jsonify(response={'message': CR.lock_message()}, status=409, bool=False)
            db.session.execute(text(
                "UPDATE cohorts SET session_date = :d, reminder_sent = 0, "
                "timeup_notice_sent = 0, updated_at = UTC_TIMESTAMP() "
                " WHERE id = :i AND achiever_id = :a"
            ), {'d': new_dt, 'i': cohort_id, 'a': achiever_id})
            # Students who booked before this may now cancel for 100% back.
            call_proc_one('sp_class_mark', 'cohort', cohort_id, 'rescheduled', None)
            db.session.commit()
            students = call_proc('sp_cohort_enrolled_students', cohort_id) or []
            from portal.helpers.notifications import notify_user
            # Was `strftime(...) + ' IST'` on a naive-UTC value: it did not
            # just show the wrong hour, it labelled UTC as IST.
            when = format_ist(new_dt, fmt='%d %b, %I:%M %p')
            for st in students:
                try:
                    notify_user(
                        st['user_id'], 'Class rescheduled',
                        f"'{cohort.get('title')}' has moved to {when}.",
                        type='cohort', reference_type='cohort', reference_id=cohort_id)
                except Exception:
                    pass
            return jsonify(response={'message': 'Class rescheduled.', 'session_date': serialize_datetime(new_dt)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/offer')
class AchieverCohortOffer(Resource):
    @jwt_required()
    def put(self, cohort_id):
        """Achiever: stop the offer on their own cohort (Achiever > Offers).

        An offer is set only in Create / Edit cohort, where its rules are
        checked. Seats already bought at the offer keep their price.
        """
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_cohort_offer_set (ownership-scoped; all NULL = stop) ───
            res = call_proc_one('sp_cohort_offer_set', cohort_id, achiever_id, None, None, None, None, None)
            call_proc_one('sp_cohort_offer_tiers_set', cohort_id, achiever_id, None)
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Offer stopped.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohort-guide')
class AchieverCohortGuide(Resource):
    @jwt_required()
    def get(self):
        """The 'How a cohort works' guide on Create cohort (admin-editable)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            from portal.routes.AchieverApplication.achiever_lifecycle import guidelines_for
            # Rules tabs come from admin's live numbers (Class rules, Cancellation rules).
            tabs = CR.guide_tabs()
            db.session.commit()
            return jsonify(response={'guide': guidelines_for('cohort_guide'), 'tabs': tabs}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohort-bookings')
class AchieverCohortBookings(Resource):
    @jwt_required()
    def get(self):
        """Bookings > Cohorts: one row per cohort (students, attended, earned)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            from portal.routes.Admin.admin_achiever_cohorts import cohort_rows
            return jsonify(response={'cohorts': cohort_rows(get_jwt_identity())}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohort-bookings/<string:cohort_id>')
class AchieverCohortBookingDetail(Resource):
    @jwt_required()
    def get(self, cohort_id):
        """One cohort's students, payments and reviews (own cohorts only: the
        procedure joins on the achiever id)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            from portal.routes.Admin.admin_achiever_cohorts import cohort_detail
            return jsonify(response=cohort_detail(get_jwt_identity(), cohort_id), status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/offers')
class AchieverOffers(Resource):
    @jwt_required()
    def get(self):
        """Achiever > Offers: every cohort offer, places used, end, live or not."""
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            rows = call_proc('sp_achiever_offers_list', achiever_id) or []
            # Offer places taken by students who were later refunded: still
            # counted as used (the offer was taken), shown as "(n refunded)".
            refunded = {r[0]: int(r[1]) for r in db.session.execute(text(
                "SELECT e.cohort_id, COUNT(*) FROM cohort_enrollments e JOIN cohorts c ON c.id = e.cohort_id"
                " WHERE c.achiever_id = :a AND e.payment_status NOT IN ('pending', 'expired', 'failed')"
                "   AND (e.payment_status = 'refunded' OR e.cancelled_at IS NOT NULL)"
                " GROUP BY e.cohort_id"), {'a': achiever_id}).fetchall()}
            out = []
            now = datetime.datetime.utcnow()
            for r in rows:
                price = int(r.get('price') or 0)
                slabs = _existing_slabs(r)
                used = int(r.get('offer_used') or 0)
                ends = r.get('offer_ends_at')
                live = cohort_offer_state(r) if slabs else None
                counted = sum(int(t['seats']) for t in (slabs or {}).get('tiers', []) if t.get('seats') is not None)
                open_end = bool(slabs) and slabs['tiers'][-1].get('seats') is None
                if not slabs:
                    state = 'stopped'
                elif ends and ends <= now:
                    state = 'ended'
                elif r.get('status') in ('completed', 'cancelled') or (r.get('session_date') and r['session_date'] <= now):
                    state = 'ended'
                elif not live:
                    state = 'used_up'
                else:
                    state = 'active'
                out.append({
                    'cohort_id': r['id'], 'title': r['title'], 'price': price,
                    'offer_price': live['offer_price'] if live else None,
                    'label': live['label'] if live else r.get('offer_label'),
                    'slab': live['slab'] if live else None,
                    'slabs': [{'seats': t.get('seats'), 'value': t['value'],
                               'price': offer_tier_price(price, slabs['type'], t['value'])}
                              for t in (slabs or {}).get('tiers', [])],
                    'seats': None if open_end else (counted or None), 'used': used,
                    'used_refunded': min(used, refunded.get(r['id'], 0)),
                    'ends_at': serialize_datetime(ends) if ends else None,
                    'session_date': serialize_datetime(r.get('session_date')),
                    'state': state,
                })
            return jsonify(response={'offers': out}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/start')
class AchieverPortalCohortStart(Resource):
    @jwt_required()
    def post(self, cohort_id):
        """Achiever starts the class. The meeting link opens for everyone only now,
        and the recorded time is the proof the achiever was there. Start is open
        from a few minutes before to a few minutes after the class time
        (Admin > Class rules); after that the class is missed."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            c = call_proc_one('sp_cohorts_get', cohort_id)
            if not c or c.get('achiever_id') != achiever_id or c.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            eff = effective_cohort_status(types.SimpleNamespace(
                status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes')))
            r = CR.rules()
            st = CR.state(c, c.get('session_date'), c.get('duration_minutes'), eff, r)
            if eff in ('cancelled', 'completed') or st.get('missed'):
                return jsonify(response={'message': 'This class is closed.'}, status=409, bool=False)
            if st['rules'] and not c.get('started_at') and not st['can_start']:
                if st.get('start_late'):
                    msg = 'The time to start has passed. The class is marked missed and students get 100% back.'
                else:
                    opens = c['session_date'] - datetime.timedelta(minutes=int(r['start_before_min']))
                    msg = f"You can start from {format_ist(opens, fmt='%d %b, %I:%M %p')}."
                return jsonify(response={'message': msg}, status=400, bool=False)
            call_proc_one('sp_cohort_mark_started', cohort_id)
            db.session.commit()
            try:
                from portal.helpers.notifications import notify_user
                for st_row in call_proc('sp_cohort_enrolled_students', cohort_id) or []:
                    notify_user(st_row['user_id'], 'Class started',
                                f"'{c.get('title')}' has started. Join now and enter the check-in code.",
                                type='cohort', reference_type='cohort', reference_id=cohort_id)
            except Exception as ne:
                logger.error(f"cohort {cohort_id}: start notify failed: {ne}")
            return jsonify(response={'message': 'Class started.', 'meeting_link': c.get('meeting_link')},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/end')
class AchieverPortalCohortEnd(Resource):
    @jwt_required()
    def post(self, cohort_id):
        """Achiever ends a live class. Completing is not on the clock."""
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            existing = call_proc_one('sp_cohorts_get', cohort_id)
            if not existing or existing.get('achiever_id') != achiever_id or existing.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            shim = types.SimpleNamespace(
                status=existing.get('status'),
                session_date=existing.get('session_date'),
                duration_minutes=existing.get('duration_minutes'),
            )
            eff = effective_cohort_status(shim)
            if eff == 'completed':
                return jsonify(response={'message': 'This session has already ended.'}, status=409, bool=False)
            if eff == 'cancelled':
                return jsonify(response={'message': 'This cohort was cancelled.'}, status=409, bool=False)
            if eff != 'live':
                return jsonify(response={
                    'message': 'End session when the class is live.',
                    'status_reason': eff,
                }, status=400, bool=False)
            _r = CR.rules()
            _st = CR.state(existing, existing.get('session_date'), existing.get('duration_minutes'), eff, _r)
            if _st['rules'] and not _st['started']:
                return jsonify(response={'message': 'Press Start first.'}, status=400, bool=False)
            if _st['rules'] and not _st['can_end']:
                opens = (existing['session_date'] + datetime.timedelta(
                    minutes=int(existing.get('duration_minutes') or 60) - int(_r['end_before_min'])))
                return jsonify(response={'message': f"End session opens at {format_ist(opens, fmt='%I:%M %p')}."},
                               status=400, bool=False)
            update_data = {'status': 'completed'}
            title = existing.get('title')
            sp_args = _cohort_sp_args(cohort_id, title, update_data, existing) + [
                existing.get('created_by'), achiever_id, existing.get('deleted_at')]
            call_proc_one('sp_cohorts_update', *sp_args)
            db.session.commit()
            call_proc_one('sp_cohort_mark_ended', cohort_id)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} ended cohort {cohort_id}")
            # Same check as the automatic close: booked but nobody checked in
            # means admin decides who is paid -- the money is held, not released.
            try:
                n_booked, n_in = db.session.execute(text(
                    "SELECT COUNT(*), IFNULL(SUM(attended = 1), 0) FROM cohort_enrollments"
                    " WHERE cohort_id = :c AND payment_status IN ('paid', 'free')"),
                    {'c': cohort_id}).fetchone()
                if int(n_booked or 0) and not int(n_in or 0):
                    call_proc_one('sp_class_issue_add', 'no_checkins', 'cohort', cohort_id, None, achiever_id, None,
                                  'Ended, but nobody checked in. Money held until admin checks.', 'open')
                    db.session.commit()
            except Exception as ci_err:
                db.session.rollback()
                logger.warning(f"no-checkins check for {cohort_id} failed: {ci_err}")
            # Tasks set before or during the class open now: tell who attended.
            _open_tasks_now(call_proc_one('sp_cohorts_get', cohort_id) or existing)

            # Ask everyone who attended to rate it while it is fresh; a reminder
            # follows the next day for anyone who has not (jobs_v1.review_reminder).
            try:
                from portal.helpers.notifications import notify_user
                for r in db.session.execute(text(
                        "SELECT user_id FROM cohort_enrollments WHERE cohort_id = :c AND attended = 1"),
                        {'c': cohort_id}).fetchall():
                    notify_user(r[0], f"How was {existing.get('title')}?",
                                'Rate your session — it takes 10 seconds and helps other students choose.',
                                type='cohort', reference_type='cohort_review', reference_id=cohort_id)
                db.session.commit()
            except Exception as ne:                       # noqa: BLE001 -- never fail the End
                db.session.rollback()
                logger.warning(f"review request notify failed for {cohort_id}: {ne}")
            return jsonify(response={'message': 'Session ended.', 'status': 'completed'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>')
class AchieverPortalCohortDetail(Resource):
    @jwt_required()
    def put(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_cohorts_get + _update (full replace) ────────────────────
            existing = call_proc_one('sp_cohorts_get', cohort_id)
            if not existing or existing.get('achiever_id') != achiever_id or existing.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            update_data = {}

            if data.get('domain_id') is not None:
                update_data['domain_id'] = data['domain_id'] or None
            # Once anyone has booked (paid, free, or paying right now) the price
            # and the offer are fixed: lowering it is unfair to those who paid,
            # raising it charges one class two prices, and free -> paid would
            # charge students who joined free. Cancel and re-create instead.
            booked = int(db.session.execute(text(
                "SELECT COUNT(*) FROM cohort_enrollments WHERE cohort_id = :c "
                "   AND (payment_status IN ('paid', 'free') "
                "        OR (payment_status = 'pending' AND expires_at > UTC_TIMESTAMP()))"
            ), {'c': cohort_id}).scalar() or 0)
            LOCKED = ("Price and offer can't be changed after students have booked. "
                      "To change them, cancel this class (students get 100% back) and create a new one.")
            if booked and data.get('price') is not None:
                try:
                    _p = int(data['price'] if data['price'] != '' else 0)
                except (ValueError, TypeError):
                    _p = None
                if _p != int(existing.get('price') or 0):
                    return jsonify(response={'message': LOCKED}, status=409, bool=False)
            if booked and 'offer_type' in data and not (data.get('offer_type') or '').strip()                     and _existing_slabs(existing):
                return jsonify(response={'message': LOCKED}, status=409, bool=False)
            if booked and data.get('total_seats') not in (None, ''):
                try:
                    if int(data['total_seats']) < booked:
                        return jsonify(response={
                            'message': f'{booked} students have booked, so seats cannot go below {booked}.'},
                            status=409, bool=False)
                except (TypeError, ValueError):
                    pass

            _moved = False
            if data.get('session_date') is not None:
                try:
                    _new = parse_local_to_utc(data['session_date'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid session_date format.'}, status=400, bool=False)
                _moved = bool(_new and existing.get('session_date') and _new != existing['session_date'])
                if _moved and CR.change_locked(existing.get('session_date')):
                    return jsonify(response={'message': CR.lock_message()}, status=409, bool=False)
                update_data['session_date'] = data['session_date']
            if data.get('duration_minutes') is not None:
                update_data['duration_minutes'] = data['duration_minutes'] or 90
            if data.get('total_seats') is not None:
                # Clamped to the admin's allocation. Without this the whole
                # feature is decorative: the create form can show a disabled
                # field all it likes while a hand-made PATCH raises the cap to
                # anything. Lowering is allowed — an achiever may want a
                # smaller room than they were granted — raising is not.
                allowed = _seat_allocation_for(achiever_id)
                try:
                    wanted = int(data['total_seats']) or None
                except (TypeError, ValueError):
                    return jsonify(response={'message': 'total_seats must be a whole number.'},
                                   status=400, bool=False)
                if allowed is not None and (wanted is None or wanted > allowed):
                    return jsonify(response={
                        'message': (f'An admin has allocated you {allowed} seats per cohort. '
                                    f'You can lower this cohort below that, but not raise it.'),
                        'cohort_seat_allocation': allowed,
                    }, status=400, bool=False)
                update_data['total_seats'] = wanted
            if data.get('price') is not None:
                # Was `if p > 0`, which silently discarded a price of 0 — so a
                # cohort could never be made free again, and a bad value was
                # swallowed rather than answered. Both now say what happened.
                try:
                    p = int(data['price'] if data['price'] != '' else 0)
                except (ValueError, TypeError):
                    return jsonify(response={'message': 'Price must be a whole number of rupees.'}, status=400, bool=False)
                if p < 0:
                    return jsonify(response={'message': 'Price cannot be negative.'}, status=400, bool=False)
                # The same gate POST has, so an edit cannot sidestep it.
                if p > 0 and int(existing.get('price') or 0) != p:
                    err = T.require_state(
                        achiever_id, 'can_charge',
                        'Paid cohorts open once an admin has verified your account.')
                    if err:
                        return err
                update_data['price'] = p
            if data.get('about') is not None:
                update_data['about'] = data['about'].strip() or None
            if data.get('what_you_learn') is not None:
                update_data['what_you_learn'] = data['what_you_learn'] or []
            if data.get('level') is not None:
                update_data['level'] = data['level'] or None
            if data.get('meeting_link') is not None:
                update_data['meeting_link'] = data['meeting_link'].strip() or None
            if data.get('status') is not None:
                if data['status'] not in ('upcoming', 'live', 'completed', 'cancelled'):
                    return jsonify(response={'message': 'Invalid status.'}, status=400, bool=False)
                update_data['status'] = data['status']
            if data.get('registration_deadline') is not None:
                update_data['registration_deadline'] = data['registration_deadline']
            for f in ('target_categories', 'target_streams', 'target_degree_cats', 'target_exam_targets',
                      'target_prof_courses', 'target_years', 'target_degrees', 'target_branches'):
                if f in data:
                    update_data[f] = data[f] or []

            # Same gate as POST. PUT accepted a 51-char level, a non-numeric
            # duration and an unparseable registration_deadline that POST would
            # have refused — the edit form is the same form, so an achiever who
            # could not create a bad cohort could still edit one into that state.
            verr = validate_cohort_input(data, require_title=False)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            lerr = _late_join_error(_late_join_minutes(data.get('late_join_minutes')),
                                    data.get('duration_minutes') or existing.get('duration_minutes'))
            if lerr:
                return jsonify(response={'message': lerr}, status=400, bool=False)

            new_price = int(update_data.get('price', existing.get('price') or 0) or 0)
            sd = update_data.get('session_date')
            session_utc = (parse_local_to_utc(sd) if isinstance(sd, str) else sd) or existing.get('session_date')
            if data.get('session_date') or data.get('duration_minutes'):
                cerr = _time_clash_error(achiever_id, session_utc,
                                         data.get('duration_minutes') or existing.get('duration_minutes'),
                                         exclude_cohort=cohort_id)
                if cerr:
                    return jsonify(response={'message': cerr}, status=409, bool=False)
            used = int((call_proc_one('sp_cohort_offer_used', cohort_id) or {}).get('used') or 0)
            offer_args, oerr = _offer_from(data, new_price, session_utc, existing.get('total_seats'),
                                           existing=existing, used=max(used, booked))
            if oerr:
                return jsonify(response={'message': oerr}, status=400, bool=False)

            title = data['title'].strip() if data.get('title') and data['title'].strip() else existing.get('title')
            sp_args = _cohort_sp_args(cohort_id, title, update_data, existing) + [existing.get('created_by'), achiever_id, existing.get('deleted_at')]
            call_proc_one('sp_cohorts_update', *sp_args)
            late = _late_join_minutes(data.get('late_join_minutes'))
            if late is not None:
                db.session.execute(text("UPDATE cohorts SET late_join_minutes = :m WHERE id = :i"),
                                   {'m': late, 'i': cohort_id})
            _apply_offer(cohort_id, achiever_id, offer_args)
            if _moved:
                call_proc_one('sp_class_mark', 'cohort', cohort_id, 'rescheduled', None)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} updated cohort {cohort_id}")
            return jsonify(response={'message': 'Cohort updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_cohorts_get + _delete (soft delete) ─────────────────────
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # Cancelling is for a class that has not happened yet, or is happening
            # now and has to be abandoned. A *completed* class cannot be cancelled:
            # people attended it, some of them paid, and this is a soft delete, so
            # it would vanish from their Bookings while their enrolment and payment
            # rows stayed behind. X02-010/025/040/055/070.
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff == 'completed':
                return jsonify(response={
                    'message': 'This session has already been taught, so it cannot be cancelled.',
                    'status_reason': eff}, status=409, bool=False)
            # Already cancelled is refused too, and not merely for tidiness: the
            # fan-out below runs on every successful cancel, so re-cancelling
            # sent a second "your class is cancelled" to everyone enrolled in a
            # class that was called off days ago. X02-055.
            if eff == 'cancelled':
                return jsonify(response={
                    'message': 'This session is already cancelled.',
                    'status_reason': eff}, status=409, bool=False)

            # Who is affected has to be read BEFORE the soft delete, while the
            # cohort is still visible to the procedure that lists its students.
            try:
                students = call_proc('sp_cohort_enrolled_students', cohort_id) or []
            except Exception as e:
                logger.error(f"cohort {cohort_id}: could not list students before cancel: {e}")
                students = []

            # Inside the lock window (default 24 h) a cancel with students is a strike.
            _late = CR.follows(cohort) and CR.change_locked(cohort.get('session_date'))
            from portal.helpers.refunds import issue_refund
            refunded = 0
            enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0) or []
            paid_here = [e for e in enrollments
                         if e.get('cohort_id') == cohort_id and e.get('payment_status') == 'paid']
            for enr in paid_here:
                oid = enr.get('payment_order_id')
                amt = float(enr.get('amount_paid') or 0)
                if not oid or amt <= 0:
                    continue
                # The achiever cancelled: the student did nothing wrong. Original
                # method by default (they never chose); the case carries the
                # staff-cancel bonus if a student later moves it to the wallet.
                ok, info = issue_refund(
                    oid, amt, 'Achiever cancelled the class',
                    actor_id=achiever_id,
                    refund_key='rf-%s-ac' % str(oid)[:22],
                    case_key='achiever_cancel',
                )
                if not ok:
                    db.session.rollback()
                    return jsonify(response={
                        'message': 'A paid seat could not be refunded. The class was not cancelled. Try again or contact support.',
                    }, status=502, bool=False)
                call_proc_one('sp_student_cohort_booking_cancel', enr.get('id'), None, 1)
                refunded += 1
            db.session.commit()

            # Cancelled, not deleted: the class stays on the achiever's Cancelled
            # tab, on students' bookings and in admin, with its refunds. A soft
            # delete here made a cancelled class vanish from every list.
            db.session.execute(text(
                "UPDATE cohorts SET status = 'cancelled', updated_at = UTC_TIMESTAMP() "
                "WHERE id = :i AND achiever_id = :a AND deleted_at IS NULL"
            ), {'i': cohort_id, 'a': achiever_id})
            db.session.commit()
            logger.info(f"Achiever {achiever_id} cancelled cohort {cohort_id} refunded={refunded}")
            if _late and students:
                CR.add_strike(achiever_id, 'late_cancel', 'cohort', cohort_id, note=cohort.get('title'))

            notified = 0
            from portal.helpers.notifications import notify_user
            for st in students:
                try:
                    notify_user(
                        st['user_id'], 'Session cancelled',
                        f"'{cohort.get('title')}' has been cancelled. "
                        f"{'You got 100% back in your SKOVO Wallet.' if refunded else 'The class will not run.'}",
                        type='cohort', reference_type='cohort', reference_id=cohort_id)
                    notified += 1
                except Exception as e:
                    logger.error(f"cohort {cohort_id}: notify {st.get('user_id')} failed: {e}")

            return jsonify(response={'message': 'Cohort cancelled.',
                                     'students_notified': notified,
                                     'seats_refunded': refunded},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/enrollments')
class AchieverPortalCohortEnrollments(Resource):
    @jwt_required()
    def get(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_cohorts_get, sp_cohort_enrollments_list, sp_users_list —
            # no by-cohort-id filter on the generic CRUD proc, so pull a bounded
            # batch and filter/join in Python. ──────────────────────────────────
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            all_enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0)
            enrollments = [e for e in all_enrollments if e.get('cohort_id') == cohort_id]
            users_by_id = {u['id']: u for u in call_proc('sp_users_list', 50000, 0)}

            result = []
            for e in enrollments:
                user = users_by_id.get(e.get('user_id'))
                result.append({
                    'enrollment_id': e['id'],
                    'user_id': e.get('user_id'),
                    'full_name': user.get('full_name') if user else 'Deleted student',
                    'email': user.get('email') if user else None,
                    'payment_status': e.get('payment_status'),
                    'amount_paid': float(e.get('amount_paid')) if e.get('amount_paid') else 0,
                    'attended': e.get('attended'),
                    'enrolled_at': serialize_datetime(e['enrolled_at']) if e.get('enrolled_at') else None,
                })
            return jsonify(response={'enrollments': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/feedback')
class AchieverPortalCohortFeedback(Resource):
    @_achievers_ns.doc(description="Achiever: what students said about one of their own classes.")
    @jwt_required()
    def get(self, cohort_id):
        """Ratings and written feedback students left on this cohort.

        Reads `achiever_reviews` rows scoped to this class — the same rows the
        student writes from the cohort screen and the same ones an admin reads.
        One store, three readers; a second table for "cohort feedback" would
        have split the achiever's public rating away from the feedback that
        produced it.
        """
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_cohorts_get — ownership first. Same 404 for missing and
            # for someone else's, so the id cannot be probed. ──
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('deleted_at') or cohort.get('achiever_id') != achiever_id:
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # ── SP: sp_achiever_reviews_list, sp_users_list — no by-context
            # filter on the generic CRUD proc, so one bounded batch joined here. ──
            rows = [
                r for r in (call_proc('sp_achiever_reviews_list', 100000, 0, 1) or [])
                if r.get('context_type') == 'cohort'
                and r.get('context_id') == cohort_id
                and r.get('achiever_id') == achiever_id
            ]
            rows.sort(key=lambda r: r.get('created_at') or datetime.datetime.min, reverse=True)

            users_by_id = {u['id']: u for u in (call_proc('sp_users_list', 50000, 0) or [])}
            items = []
            for r in rows:
                u = users_by_id.get(r.get('user_id')) or {}
                items.append({
                    'id': r.get('id'),
                    'rating': r.get('rating'),
                    'review_text': r.get('review_text'),
                    'student_name': u.get('full_name') or 'Student',
                    'created_at': serialize_datetime(r.get('created_at')),
                })

            ratings = [r['rating'] for r in rows if r.get('rating') is not None]
            avg = round(sum(ratings) / len(ratings), 1) if ratings else None
            # Whole scale, always. A histogram missing its empty rows reads as
            # though nobody ever gave a 2, rather than that nobody did here.
            breakdown = {str(n): sum(1 for x in ratings if x == n) for n in range(1, 6)}

            return jsonify(response={
                'cohort_id': cohort_id,
                'cohort_title': cohort.get('title'),
                'feedback': items,
                'count': len(items),
                'avg_rating': avg,
                'breakdown': breakdown,
                # How many joined, so "3 of 12 responded" is answerable rather
                # than leaving 3 ratings looking like the whole class.
                #
                # Counted from enrolments, NOT from filled_seats. That counter
                # is incremented only in sp_payment_cohort_mark_paid — paid
                # students — so on a free cohort it is 0, and the response rate
                # became "3 out of 0": a division by zero, or a rate over 100%.
                'enrolled_count': sum(
                    1 for e in call_proc('sp_cohort_enrolled_students', cohort_id) or []
                ),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/reviews')
class AchieverPortalReviews(Resource):
    @_achievers_ns.doc(description='Achiever: every rating and review students have left them.')
    @jwt_required()
    def get(self):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            # Own reviews only: the id comes from the token, never the request.
            rows = db.session.execute(text(
                "SELECT r.id, r.rating, r.review_text, r.context_type, r.created_at,"
                "       u.full_name, c.title"
                "  FROM achiever_reviews r"
                "  LEFT JOIN users u ON u.id = r.user_id"
                "  LEFT JOIN cohorts c ON r.context_type = 'cohort' AND c.id = r.context_id"
                " WHERE r.achiever_id = :a AND r.is_active = 1"
                " ORDER BY r.created_at DESC LIMIT 500"), {'a': get_jwt_identity()}).mappings().all()
            ratings = [int(r['rating']) for r in rows if r['rating'] is not None]
            return jsonify(response={
                'reviews': [{
                    'id': r['id'], 'rating': r['rating'], 'review_text': r['review_text'],
                    'context_type': r['context_type'], 'cohort_title': r['title'],
                    'student_name': r['full_name'] or 'Student',
                    'created_at': serialize_datetime(r['created_at']) if r['created_at'] else None,
                } for r in rows],
                'count': len(ratings),
                'avg_rating': round(sum(ratings) / len(ratings), 1) if ratings else None,
                'breakdown': {str(n): ratings.count(n) for n in range(1, 6)},
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            logger.error(f"GET /achievers/portal/reviews: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/attendance')
class AchieverCohortAttendance(Resource):
    @_achievers_ns.doc(description=(
        'Achiever: mark attendance for their own cohort in one save.\n\n'
        'Send `present` — the enrollment ids of everyone who attended. Anyone '
        'enrolled and not listed is marked absent, so unticking works too.\n\n'
        'The person who ran the session records it. Admin keeps '
        'PATCH /skovo-platform-panel-admin/bookings/<id> as an override for '
        'corrections and disputes.'
    ))
    @jwt_required()
    def patch(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # Ownership: an achiever may only mark their OWN cohort. Same 404 as
            # the GET above so this never confirms another achiever's cohort id.
            # ── SP: sp_cohorts_get ────────────────────────────────────────────
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # Attendance can be marked while the class runs and afterwards, but
            # not before it starts and not on a cancelled one. There was no state
            # check here — ownership was the only gate — so an achiever could mark
            # a full register on a cohort scheduled for next month, or on one that
            # had been called off, and every student named collected the
            # cohort_attended readiness points for it. X02-012/027/042/057/072.
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff not in ('live', 'completed'):
                reason = {
                    'upcoming': 'This session has not started yet, so there is no attendance to record.',
                    'cancelled': 'This session was cancelled, so attendance cannot be recorded.',
                }.get(eff, 'Attendance can only be marked once the class has started.')
                return jsonify(response={'message': reason, 'status_reason': eff},
                               status=409, bool=False)

            data = request.get_json() or {}
            present = data.get('present')
            if not isinstance(present, list):
                return jsonify(response={'message': 'Send `present` as a list of enrollment ids.'},
                               status=400, bool=False)
            present_ids = {str(p) for p in present}

            # ── SP: sp_cohort_enrollments_list ────────────────────────────────
            enrollments = [
                e for e in call_proc('sp_cohort_enrollments_list', 50000, 0)
                if e.get('cohort_id') == cohort_id
            ]

            unknown = present_ids - {str(e['id']) for e in enrollments}
            if unknown:
                return jsonify(
                    response={'message': 'Some ids are not enrolled in this cohort.',
                              'unknown': sorted(unknown)},
                    status=400, bool=False)

            marked_present, newly_awarded = 0, 0
            rebuild = set()
            newly_present = []
            for e in enrollments:
                attended_now = str(e['id']) in present_ids
                was_attended = bool(e.get('attended'))
                if attended_now:
                    marked_present += 1
                if attended_now == was_attended:
                    continue  # nothing changed for this student

                # ── SP: sp_cohort_enrollments_update (full replace) ───────────
                call_proc_one(
                    'sp_cohort_enrollments_update',
                    e['id'], e.get('user_id'), e.get('cohort_id'), e.get('payment_status'),
                    e.get('payment_order_id'), e.get('payment_id'), e.get('amount_paid'),
                    e.get('platform_fee'), e.get('achiever_earning'), 1 if attended_now else 0,
                    e.get('coupon_code'), e.get('discount_amount'), e.get('created_by'), achiever_id,
                )

                # Score signal fires only on the transition into attended. The
                # per-item cap on the cohort id means a re-save never pays twice.
                if attended_now:
                    newly_present.append(e.get('user_id'))
                    from portal.helpers import score
                    # recalc=False: one rebuild per student at the end of the
                    # loop instead of two per row across a whole cohort.
                    if score.award_cohort_attendance(e.get('user_id'), cohort_id,
                                                     recalc=False):
                        newly_awarded += 1
                        rebuild.add(e.get('user_id'))

            if rebuild:
                from portal.helpers import score
                for uid in rebuild:
                    score.recalc(uid)
            db.session.commit()

            # Once the whole sheet is saved, never inside the loop: the
            # referral check commits and rolls back on its own, which would
            # split or undo the attendance rows written above.
            if newly_present:
                from portal.helpers.referral_rewards import evaluate_friend
                for uid in newly_present:
                    evaluate_friend(uid)

            log_audit('cohort.attendance_marked', 'cohort', cohort_id, actor_id=achiever_id,
                      meta={'present': marked_present, 'enrolled': len(enrollments)})

            return jsonify(response={
                'message': f'Attendance saved for {marked_present} of {len(enrollments)} students.',
                'present': marked_present,
                'enrolled': len(enrollments),
                'points_awarded': newly_awarded,
            }, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/attendance-code')
class AchieverAttendanceCode(Resource):
    @_achievers_ns.doc(description=(
        'Achiever: read the live self check-in code for their cohort, if any.'
    ))
    @jwt_required()
    def get(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # ── SP: sp_attendance_code_active ─────────────────────────────────
            row = call_proc_one('sp_attendance_code_active', cohort_id)
            if not row or not row.get('is_valid'):
                return jsonify(response={'code': None, 'message': 'No live code.'},
                               status=200, bool=True)
            return jsonify(response={
                'code': row.get('code'),
                'expires_at': serialize_datetime(row.get('expires_at')),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)

    @_achievers_ns.doc(description=(
        'Achiever: reveal a fresh self check-in code for their cohort.\n\n'
        'Reveal this PART-WAY through the session, not at the start — a student '
        'who joins for two minutes and leaves should never see it. That is what '
        'makes the code evidence of attendance rather than a claim.\n\n'
        'Revealing again retires the previous code immediately.'
    ))
    @jwt_required()
    def post(self, cohort_id):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # A code may only be revealed while the class is actually running.
            # There was no state check here at all — ownership was the only gate —
            # so a code could be revealed on an upcoming, completed or *cancelled*
            # cohort, and any enrolled student could then redeem it. Check-in
            # awards readiness points, so that was attendance credit for a class
            # that had not happened, was already over, or had been called off.
            # X02-011/026/041/056/071.
            #
            # Derived, not the raw column, and the refusal names the state rather
            # than answering a generic "Unable to…" — the same rule the enrolment
            # guard follows.
            eff = effective_cohort_status(types.SimpleNamespace(
                status=cohort.get('status'),
                session_date=cohort.get('session_date'),
                duration_minutes=cohort.get('duration_minutes'),
            ))
            if eff != 'live':
                reason = {
                    'upcoming': 'This session has not started yet, so there is no code to read out.',
                    'completed': 'This session has ended. A code can only be revealed while the class is live.',
                    'cancelled': 'This session was cancelled, so attendance cannot be recorded.',
                }.get(eff, 'A code can only be revealed while the class is live.')
                return jsonify(response={'message': reason, 'status_reason': eff},
                               status=409, bool=False)

            data = request.get_json(silent=True) or {}
            try:
                minutes = int(data.get('valid_minutes') or 20)
            except (TypeError, ValueError):
                minutes = 20
            minutes = max(1, min(minutes, 180))

            # secrets, not random: the code is the proof of presence, so it must
            # not be guessable from a previous one.
            import secrets
            code = f"{secrets.randbelow(10000):04d}"

            # ── SP: sp_attendance_code_reveal ─────────────────────────────────
            row = call_proc_one('sp_attendance_code_reveal', str(uuid.uuid4()), cohort_id,
                                code, achiever_id, minutes) or {}
            db.session.commit()

            log_audit('cohort.attendance_code_revealed', 'cohort', cohort_id,
                      actor_id=achiever_id, meta={'valid_minutes': minutes})

            return jsonify(response={
                'code': row.get('code') or code,
                'expires_at': serialize_datetime(row.get('expires_at')),
                'valid_minutes': minutes,
                'message': f'Read this code out. It works for {minutes} minutes.',
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


def _cohort_session_dict(s):
    sd = s.get('session_date')
    return {
        'id': s.get('id'),
        'title': s.get('title'),
        'session_date': serialize_datetime(sd),
        'duration_minutes': s.get('duration_minutes'),
        'meeting_link': s.get('meeting_link'),
        'sort_order': s.get('sort_order'),
        'status': s.get('status'),
    }


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/sessions')
class AchieverCohortSessions(Resource):
    @jwt_required()
    def get(self, cohort_id):
        """List the sessions of a multi-session cohort (achiever's own)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            sessions = call_proc('sp_cohort_sessions_list', cohort_id)
            return jsonify(response={'sessions': [_cohort_session_dict(s) for s in sessions]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, cohort_id):
        """Add a session to a cohort."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            if not data.get('session_date'):
                return jsonify(response={'message': 'session_date is required.'}, status=400, bool=False)
            try:
                when = parse_local_to_utc(data['session_date'])
            except ValueError:
                return jsonify(response={'message': 'Invalid session_date format.'}, status=400, bool=False)
            # Achiever supplies their own Teams / Google Meet link per session.
            link = (data.get('meeting_link') or '').strip() or None
            new_id = str(uuid.uuid4())
            # ── SP: sp_cohort_sessions_create ────────────────────────────────
            call_proc_one('sp_cohort_sessions_create', new_id, cohort_id,
                          (data.get('title') or '').strip() or None, when,
                          data.get('duration_minutes') or 90, link, data.get('sort_order') or 0)
            db.session.commit()
            return jsonify(response={'message': 'Session added.', 'id': new_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/cohorts/<string:cohort_id>/sessions/<string:session_id>')
class AchieverCohortSessionDetail(Resource):
    @jwt_required()
    def put(self, cohort_id, session_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            when = None
            if data.get('session_date'):
                try:
                    when = parse_local_to_utc(data['session_date'])
                except ValueError:
                    return jsonify(response={'message': 'Invalid session_date format.'}, status=400, bool=False)
            # ── SP: sp_cohort_sessions_update ────────────────────────────────
            res = call_proc_one('sp_cohort_sessions_update', session_id, cohort_id,
                                (data.get('title') or '').strip() or None, when,
                                data.get('duration_minutes') or 90,
                                (data.get('meeting_link') or '').strip() or None,
                                data.get('sort_order'))
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Session updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, cohort_id, session_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            # ── SP: sp_cohort_sessions_delete ────────────────────────────────
            res = call_proc_one('sp_cohort_sessions_delete', session_id, cohort_id)
            db.session.commit()
            if not res or not res.get('deleted'):
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Session removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Cohort tasks, owned by the achiever who runs the cohort ───────────────────
# Tasks already existed, but only /admin/tasks could create one: an achiever ran
# the session and then had to ask an admin to set the homework for it. Since the
# achiever is the person who knows what the cohort just covered, that round trip
# was the only thing standing between a session and its follow-up work.
#
# These call the same procedures the admin routes do — sp_cohort_tasks_create /
# _get / _list / _update / _delete — so no table and no procedure is added. What
# is added is the ownership check: sp_cohort_tasks_get takes a task id and knows
# nothing about who is asking, so every route below resolves the task's cohort
# first and refuses unless this achiever owns it. Without that, a valid achiever
# token plus a guessed task id would edit somebody else's homework.

_TASK_STATUSES = ('active', 'inactive', 'archived')

# What counts as still waiting on the achiever now comes from
# helpers.task_review, which the admin panel reads too. This list used to be
# local and omitted `reviewed`, so a submission an admin had scored but not yet
# decided disappeared from the achiever's "to review" count while still sitting
# in the admin's queue — one row, two answers.


def _owned_cohorts(achiever_id):
    """`{cohort_id: cohort}` for the cohorts this achiever owns.

    ── SP: sp_cohorts_list — no by-achiever filter on the generic CRUD proc, so
    pull a bounded batch and filter here, exactly as the cohort list above does.
    The proc already excludes soft-deleted rows. ──
    """
    return {
        c['id']: c
        for c in (call_proc('sp_cohorts_list', 5000, 0) or [])
        if c.get('achiever_id') == achiever_id
    }


# Points are admin-owned (feature-updates.md §5): nothing earns points by
# default, only what admin sets and switches on. An achiever writes the task,
# never its weight: create stores this default, edit keeps whatever is already
# on the row, and any `score_weight` in the request body is ignored. Admin sets
# it through /admin/tasks and the score rules.
DEFAULT_TASK_WEIGHT = 0


def _task_due(v):
    """`(datetime | None, error | None)` for a due date from the form.

    parse_local_to_utc, not fromisoformat: naive datetimes are UTC everywhere in
    this codebase (see serialize_datetime), and the form sends naive IST from a
    `datetime-local` input. Parsing it raw would store a due date 5h30m late —
    which is what /admin/tasks does today.
    """
    if not v:
        return None, None
    try:
        return parse_local_to_utc(v), None
    except (ValueError, TypeError):
        return None, 'Invalid due date. Use ISO 8601.'


# Column widths from portal/models/cohort_tasks.py. A title one character over
# 255 reached MySQL and came back as a 500 with an error id, which tells the
# achiever nothing they can act on. The limit is a fact about the form, so it
# belongs in a 400 that names the field.
_TASK_LIMITS = {
    'title':            (255, 'Title'),
    'task_type':        (50,  'Type'),
    'submission_type':  (50,  'Submission type'),
    'difficulty_level': (50,  'Difficulty'),
}


def _task_too_long(values):
    """The first over-length field as a message, or None."""
    for key, (limit, label) in _TASK_LIMITS.items():
        v = values.get(key)
        if isinstance(v, str) and len(v) > limit:
            return f'{label} must be {limit} characters or fewer.'
    return None


def _task_attachment(v):
    """`(url | None, error | None)` for the optional brief attached to a task.

    A student opens this from My Tasks, so it has to be openable: a pasted
    filename or a local drive path renders as a dead link, which is worse than
    no attachment at all. Relative paths are allowed because that is what
    /v1/upload hands back for a stored file.
    """
    v = (v or '').strip()
    if not v:
        return None, None
    # helpers.links owns the scheme allowlist — the student submission path
    # needs exactly this rule for evidence_url, and two copies of a URL check
    # that drift is an XSS hole rather than a cosmetic difference.
    err = check_openable(v, 'Attachment')
    if err:
        return None, err
    return v, None


def _notify_task_assigned(cohort, task_id, title, due_date):
    """Tell everyone enrolled in the cohort that this task is now theirs.

    A task is assigned to a cohort, not copied per student, so this is the only
    per-student step in the flow -- and it is why a student who enrols later
    still gets the task with no risk of a duplicate assignment: there is no row
    to duplicate, only a notification that has already been sent.

    Silent when the class has not started, because cohort_tasks_open() is also
    what decides whether the task is in My Tasks yet, and a notification
    pointing at a list that does not show it is a support ticket waiting to
    happen.

    Best-effort throughout: the task is already committed by this point, and a
    notification failure must not turn a successful assignment into a 500.
    """
    if not cohort_tasks_open(cohort):
        return 0
    try:
        # -- SP: sp_cohort_enrolled_students ---------------------------------
        students = call_proc('sp_cohort_enrolled_students', cohort['id']) or []
        if CR.follows(cohort):
            present = {r[0] for r in db.session.execute(text(
                "SELECT user_id FROM cohort_enrollments WHERE cohort_id = :c AND attended = 1"),
                {'c': cohort['id']}).fetchall()}
            students = [s for s in students if s.get('user_id') in present]
    except Exception as e:
        logger.error(f"task {task_id}: could not list cohort {cohort.get('id')} students: {e}")
        return 0

    when = f" Due {serialize_datetime(due_date)[:10]}." if due_date else ''
    body = f"New task for '{cohort.get('title')}': {title}.{when}"
    sent = 0
    from portal.helpers.notifications import notify_user
    for st in students:
        try:
            notify_user(st['user_id'], 'New task assigned', body,
                        type='cohort', reference_type='cohort_task', reference_id=task_id)
            sent += 1
        except Exception as e:
            logger.error(f"task {task_id}: notify {st.get('user_id')} failed: {e}")
    return sent


def _open_tasks_now(cohort):
    """The class just ended: its tasks open, so notify the attendees once."""
    try:
        for t in call_proc('sp_cohort_tasks_list', 20000, 0) or []:
            if t.get('cohort_id') == cohort.get('id') and not t.get('deleted_at') \
                    and (t.get('task_status') or 'active') == 'active':
                _notify_task_assigned(cohort, t['id'], t.get('title'), t.get('due_date'))
    except Exception as e:
        logger.error(f"open tasks for cohort {cohort.get('id')} failed: {e}")


def _achiever_task_dict(t, cohort_title, submitted=0, pending=0):
    return {
        'id': t['id'],
        'cohort_id': t.get('cohort_id'),
        'cohort_title': cohort_title,
        'title': t.get('title'),
        'description': t.get('description'),
        'task_type': t.get('task_type'),
        'submission_type': t.get('submission_type'),
        'difficulty_level': t.get('difficulty_level'),
        'attachment_url': t.get('attachment_url'),
        'task_status': t.get('task_status'),
        'due_date': serialize_datetime(t.get('due_date')),
        'score_weight': t.get('score_weight'),
        'submission_count': submitted,
        'pending_count': pending,
        'created_at': serialize_datetime(t.get('created_at')),
    }


def _load_owned_task(task_id, achiever_id):
    """`(task, cohort, error response)` — the ownership check every write shares.

    ── SP: sp_cohort_tasks_get + sp_cohorts_get ──
    """
    task = call_proc_one('sp_cohort_tasks_get', task_id)
    if not task or task.get('deleted_at'):
        return None, None, jsonify(response={'message': 'Task not found.'}, status=404, bool=False)
    cohort = call_proc_one('sp_cohorts_get', task.get('cohort_id'))
    # Deliberately the same 404 as a missing task. Saying "not yours" would
    # confirm the id exists to anyone probing with a valid achiever token.
    if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
        return None, None, jsonify(response={'message': 'Task not found.'}, status=404, bool=False)
    return task, cohort, None


@_achievers_ns.route('/portal/tasks')
class AchieverPortalTasks(Resource):
    @_achievers_ns.doc(params={'cohort_id': 'Only tasks on this cohort. Must be one the achiever owns.'},
                       description='Achiever: every task across their own cohorts, newest first.')
    @jwt_required()
    def get(self):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            cohorts = _owned_cohorts(achiever_id)
            if not cohorts:
                return jsonify(response={'tasks': [], 'cohorts': [], 'total': 0}, status=200, bool=True)

            # The cohort picker in the create dialog needs this list whether or
            # not a task exists yet, so it ships alongside the tasks rather than
            # costing the screen a second round trip — and it is the same set the
            # writes below validate against, so the dropdown cannot offer a
            # cohort the POST would refuse.
            cohort_options = [
                {'id': c['id'], 'title': c.get('title'),
                 'status': effective_cohort_status(types.SimpleNamespace(
                     status=c.get('status'), session_date=c.get('session_date'),
                     duration_minutes=c.get('duration_minutes'))),
                 'session_date': serialize_datetime(c.get('session_date'))}
                for c in sorted(cohorts.values(),
                                key=lambda c: c.get('created_at') or datetime.datetime.min,
                                reverse=True)
                # Cancelled / missed classes never ran: no task can belong to them.
                if (c.get('status') or '') != 'cancelled' and not c.get('missed_at')
            ]

            wanted = (request.args.get('cohort_id') or '').strip() or None
            if wanted and wanted not in cohorts:
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)

            # ── SP: sp_cohort_tasks_list, sp_task_submissions_list — neither
            # takes a filter, so bounded batches joined here. ──
            tasks = [
                t for t in (call_proc('sp_cohort_tasks_list', 20000, 0) or [])
                if t.get('cohort_id') in cohorts and (not wanted or t.get('cohort_id') == wanted)
            ]
            tasks.sort(key=lambda t: t.get('created_at') or datetime.datetime.min, reverse=True)

            # Same counter the admin task list uses, so the two screens agree.
            submitted, pending = task_review.counts_by_task({t['id'] for t in tasks})

            result = []
            for t in tasks:
                c = cohorts.get(t.get('cohort_id')) or {}
                d = _achiever_task_dict(t, c.get('title'), submitted.get(t['id'], 0), pending.get(t['id'], 0))
                # Draft until the class ends; withdrawn if the class was cancelled or missed.
                d['state'] = ('withdrawn' if (c.get('status') == 'cancelled' or c.get('missed_at'))
                              else 'open' if cohort_tasks_open(c) else 'draft')
                result.append(d)
            return jsonify(response={'tasks': result, 'cohorts': cohort_options,
                                     'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @_achievers_ns.doc(description='Achiever: set a task on one of their own cohorts.')
    @jwt_required()
    def post(self):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # The same gate creating a cohort passes: a verified account.
            err = T.require_state(achiever_id, 'can_take_bookings',
                                  'Your account is not approved for sessions yet.')
            if err:
                return err

            d = request.get_json() or {}
            if not isinstance(d, dict):
                return jsonify(response={'message': 'Expected a JSON object.'}, status=400, bool=False)
            cohort_id = (d.get('cohort_id') or '').strip()
            title     = (d.get('title') or '').strip()
            if not cohort_id:
                return jsonify(response={'message': 'Choose a cohort for this task.'}, status=400, bool=False)
            if not title:
                return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)

            fields = {k: (d.get(k) or '').strip() for k in _TASK_LIMITS}
            fields['title'] = title
            too_long = _task_too_long(fields)
            if too_long:
                return jsonify(response={'message': too_long}, status=400, bool=False)

            if d.get('task_status') and d['task_status'] not in _TASK_STATUSES:
                return jsonify(response={'message': 'Invalid task status.'}, status=400, bool=False)

            attachment, att_err = _task_attachment(d.get('attachment_url'))
            if att_err:
                return jsonify(response={'message': att_err}, status=400, bool=False)

            cohort = call_proc_one('sp_cohorts_get', cohort_id)
            if not cohort or cohort.get('achiever_id') != achiever_id or cohort.get('deleted_at'):
                return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
            if cohort.get('status') == 'cancelled' or cohort.get('missed_at'):
                return jsonify(response={'message': 'This class was cancelled, so it cannot have tasks.'},
                               status=409, bool=False)

            due_date, due_err = _task_due(d.get('due_date'))
            if due_err:
                return jsonify(response={'message': due_err}, status=400, bool=False)
            # The task opens when the class ends, so it cannot be due before that.
            if due_date and cohort.get('session_date'):
                _end = cohort['session_date'] + datetime.timedelta(minutes=int(cohort.get('duration_minutes') or 60))
                if due_date <= _end:
                    return jsonify(response={'message': 'Set the due date after the class ends.'},
                                   status=400, bool=False)

            status = d.get('task_status') if d.get('task_status') in _TASK_STATUSES else 'active'
            task_id = str(uuid.uuid4())
            # ── SP: sp_cohort_tasks_create ────────────────────────────────────
            call_proc_one(
                'sp_cohort_tasks_create', task_id, cohort_id, title,
                (d.get('description') or '').strip() or None,
                fields['task_type'] or None,
                fields['submission_type'] or None,
                fields['difficulty_level'] or None,
                attachment,
                status,
                due_date, DEFAULT_TASK_WEIGHT,
                achiever_id, achiever_id, None,
            )
            db.session.commit()
            logger.info(f"Achiever {achiever_id} created task {task_id} on cohort {cohort_id}")

            # The assignment itself reaches every enrolled student through the
            # cohort, so this is only the announcement. It runs after the commit
            # and cannot fail the request: a notification problem must not lose
            # a task that is already saved.
            # ...which it could, until this try was added. The call sat bare, so
            # anything it raised fell through to the outer `except`, which
            # rolled back (harmlessly — the task was already committed above)
            # and answered 500. The row survived and the achiever was told it
            # had not, so they set the task again and the cohort got two. That
            # is precisely the duplicate this comment claimed to prevent.
            # AC03-011.
            notified = 0
            if status == 'active':
                try:
                    notified = _notify_task_assigned(cohort, task_id, title, due_date)
                except Exception as notify_error:      # noqa: BLE001 — best effort
                    logger.warning(
                        f'task {task_id} saved but notification failed: {notify_error}')

            return jsonify(response={'message': 'Task created.', 'task_id': task_id,
                                     'students_notified': notified},
                           status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/tasks/<string:task_id>')
class AchieverPortalTaskDetail(Resource):
    @_achievers_ns.doc(description='Achiever: update a task on one of their own cohorts.')
    @jwt_required()
    def put(self, task_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            task, cohort, err = _load_owned_task(task_id, achiever_id)
            if err:
                return err

            d = request.get_json() or {}

            # sp_cohort_tasks_update is a full replace — every column it does not
            # receive is overwritten with NULL. So an omitted key must fall back
            # to what the row already holds, never to a default.
            def val(key):
                if key not in d:
                    return task.get(key)
                v = d[key]
                return (v.strip() or None) if isinstance(v, str) else v

            title = task.get('title')
            if 'title' in d:
                title = (d.get('title') or '').strip()
                if not title:
                    return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)

            due_date = task.get('due_date')
            if 'due_date' in d:
                due_date, due_err = _task_due(d.get('due_date'))
                if due_err:
                    return jsonify(response={'message': due_err}, status=400, bool=False)

            status = task.get('task_status')
            if 'task_status' in d:
                if d['task_status'] not in _TASK_STATUSES:
                    return jsonify(response={'message': 'Invalid task status.'}, status=400, bool=False)
                status = d['task_status']

            # Only what this request sends. val() falls back to the stored row
            # for everything else, and a value already in the column is by
            # definition short enough to go back into it.
            sent = {k: d[k] for k in _TASK_LIMITS if isinstance(d.get(k), str)}
            sent['title'] = title
            too_long = _task_too_long(sent)
            if too_long:
                return jsonify(response={'message': too_long}, status=400, bool=False)

            attachment = task.get('attachment_url')
            if 'attachment_url' in d:
                attachment, att_err = _task_attachment(d.get('attachment_url'))
                if att_err:
                    return jsonify(response={'message': att_err}, status=400, bool=False)

            # A task cannot be moved to a cohort the achiever does not own — the
            # one write here that could otherwise reach outside their own data.
            cohort_id = task.get('cohort_id')
            if d.get('cohort_id') and d['cohort_id'] != cohort_id:
                target = call_proc_one('sp_cohorts_get', d['cohort_id'])
                if not target or target.get('achiever_id') != achiever_id or target.get('deleted_at'):
                    return jsonify(response={'message': 'Cohort not found.'}, status=404, bool=False)
                cohort_id = d['cohort_id']

            weight = task.get('score_weight')

            # ── SP: sp_cohort_tasks_update (full replace) ─────────────────────
            call_proc_one(
                'sp_cohort_tasks_update', task_id, cohort_id, title,
                val('description'), val('task_type'), val('submission_type'),
                val('difficulty_level'), attachment,
                status, due_date, weight,
                task.get('created_by'), achiever_id, task.get('deleted_at'),
            )
            db.session.commit()
            logger.info(f"Achiever {achiever_id} updated task {task_id}")
            return jsonify(response={'message': 'Task updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @_achievers_ns.doc(description='Achiever: remove a task from one of their own cohorts.')
    @jwt_required()
    def delete(self, task_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            task, cohort, err = _load_owned_task(task_id, achiever_id)
            if err:
                return err
            # ── SP: sp_cohort_tasks_delete (soft delete) ─────────────────────
            # Soft, so the submissions students already made against it are not
            # orphaned — the same thing /admin/tasks does.
            call_proc('sp_cohort_tasks_delete', task_id)
            db.session.commit()
            logger.info(f"Achiever {achiever_id} deleted task {task_id}")
            return jsonify(response={'message': 'Task deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── Reviewing what students submitted ─────────────────────────────────────────
# The achiever could set a task and could see that N students had submitted, and
# there it stopped: the count was a dead number on a card, and the only person
# who could actually grade the work was an admin who had never taught the class.
#
# These two routes close that. They reuse helpers.task_review, which is also what
# /admin/tasks now calls, so an achiever's verdict and an admin's verdict write
# the same columns, award the same readiness points and send the same
# notification — no second grading path to drift.
#
# Ownership is the whole security story here: a submission id says nothing about
# who may read it, so both routes resolve submission → task → cohort → achiever
# and refuse anything that does not land on this achiever's own cohort.

def _load_owned_submission(submission_id, achiever_id):
    """`(submission, task, error response)` for a submission on the achiever's own task.

    ── SP: sp_task_submissions_get, then the same ownership walk _load_owned_task
    does. The 404 is deliberately identical to a missing submission: saying "not
    yours" would confirm the id exists to anyone probing with a valid token.
    """
    sub = call_proc_one('sp_task_submissions_get', submission_id)
    if not sub:
        return None, None, jsonify(response={'message': 'Submission not found.'},
                                   status=404, bool=False)
    task, _cohort, err = _load_owned_task(sub.get('task_id'), achiever_id)
    if err:
        return None, None, jsonify(response={'message': 'Submission not found.'},
                                   status=404, bool=False)
    return sub, task, None


@_achievers_ns.route('/portal/tasks/<string:task_id>/submissions')
class AchieverPortalTaskSubmissions(Resource):
    @_achievers_ns.doc(description=(
        'Achiever: every student submission for one of their own tasks, newest '
        'first, with the student and any review already recorded.'))
    @jwt_required()
    def get(self, task_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            task, cohort, err = _load_owned_task(task_id, achiever_id)
            if err:
                return err

            submissions = task_review.list_for_task(task_id)
            pending = sum(1 for s in submissions if task_review.is_pending(s['status']))

            return jsonify(
                response={
                    'submissions': submissions,
                    'pending_count': pending,
                    'total': len(submissions),
                    # The drawer titles itself from this rather than from the
                    # card it opened on, so a refresh still knows what it shows.
                    'task': {
                        'id': task.get('id'),
                        'title': task.get('title'),
                        'description': task.get('description'),
                        'submission_type': task.get('submission_type'),
                        'score_weight': task.get('score_weight'),
                        'due_date': serialize_datetime(task.get('due_date')),
                        'cohort_title': cohort.get('title'),
                    },
                },
                status=200, bool=True,
            )
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/submissions/<string:submission_id>')
class AchieverPortalSubmissionReview(Resource):
    @_achievers_ns.doc(description=(
        'Achiever: approve, reject or score a submission on one of their own '
        'tasks. Approving awards the student their readiness points.'))
    @jwt_required()
    def patch(self, submission_id):
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # The same gate setting a task passes. An achiever whose account has
            # been suspended should not still be grading — and the students in
            # a cohort they can no longer run need an admin to pick the work up.
            err = T.require_state(achiever_id, 'can_take_bookings',
                                  'Your account is not approved for sessions yet.')
            if err:
                return err

            sub, task, err = _load_owned_submission(submission_id, achiever_id)
            if err:
                return err

            d = request.get_json() or {}
            if not isinstance(d, dict):
                return jsonify(response={'message': 'Expected a JSON object.'}, status=400, bool=False)

            status = (d.get('status') or '').strip()
            if status not in task_review.REVIEW_STATES:
                return jsonify(
                    response={'message': f"Status must be one of: {', '.join(task_review.REVIEW_STATES)}."},
                    status=400, bool=False)

            # Rubric click-scoring (feature-updates.md §5): one score per rubric
            # line; the 0-10 mentor score follows from them unless sent.
            rubric_scores, rerr = task_review.rubric_scores(task, d.get('rubric_scores'))
            if rerr:
                return jsonify(response={'message': rerr}, status=400, bool=False)
            if rubric_scores is not None and d.get('mentor_score') in (None, ''):
                d['mentor_score'] = task_review.score_from_rubric(task, rubric_scores)

            # Approving without a score would put a student's readiness points
            # on the ledger with nothing to show for them on the task.
            mentor_score = task_review.clamp_score(d.get('mentor_score'), sub.get('mentor_score'))
            if status == 'approved' and mentor_score is None:
                return jsonify(response={'message': f'Give this a score out of {task_review.MAX_SCORE} before approving.'},
                               status=400, bool=False)

            mentor_notes = d['mentor_notes'] if 'mentor_notes' in d else sub.get('mentor_notes')
            if isinstance(mentor_notes, str):
                mentor_notes = mentor_notes.strip() or None
            # mentor_notes is TEXT, so an over-long paste is a 500 rather than a
            # refusal — the same cap the student's own evidence text gets.
            verr = FL.check(mentor_notes, 'Feedback', task_review.NOTES_MAX)
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            task_review.apply_review(sub, task, status, mentor_score,
                                     mentor_notes, achiever_id)
            # Rubric lines + review state (closes an appeal).
            call_proc_one('sp_submission_review_extra', submission_id,
                          json.dumps(rubric_scores) if rubric_scores is not None else None, 'reviewed')
            db.session.commit()
            logger.info(f"Achiever {achiever_id} marked submission {submission_id} {status}")

            return jsonify(response={'message': f'Submission {status}.', 'status': status},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/earnings/series')
class AchieverPortalEarningsSeries(Resource):
    @_achievers_ns.doc(
        params={
            'from': 'Start date, inclusive (YYYY-MM-DD). Defaults to 30 days before `to`.',
            'to': 'End date, inclusive (YYYY-MM-DD). Defaults to today.',
        },
        description=(
            'Achiever: daily earnings by source across a date range, plus that '
            'range against the equal-length one before it. '
            'The dashboard chart needs every day present, including the ones with '
            'no money — a line that skips empty days implies activity that did not '
            'happen. The procedure only returns days that have rows, so the gaps '
            'are filled here.'))
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            def _date(raw):
                try:
                    return datetime.date.fromisoformat((raw or '').strip())
                except (TypeError, ValueError):
                    return None

            today = datetime.date.today()
            d_to = _date(request.args.get('to')) or today
            d_from = _date(request.args.get('from')) or (d_to - datetime.timedelta(days=29))
            if d_from > d_to:                      # a picker slip, not an empty answer
                d_from, d_to = d_to, d_from

            # A range is capped at two years and cannot start in the future: the
            # chart plots one point per day, and an unbounded range would ask the
            # browser to draw an arbitrary number of them.
            d_to = min(d_to, today)
            d_from = min(d_from, d_to)
            if (d_to - d_from).days > 730:
                d_from = d_to - datetime.timedelta(days=730)

            # ── SP: sp_achiever_earnings_series ──────────────────────────────
            rows = call_proc('sp_achiever_earnings_series', achiever_id, d_from, d_to)

            by_day = {}
            for r in rows:
                d = r.get('day')
                if not d:
                    continue
                key = d.isoformat()
                bucket = by_day.setdefault(key, {'cohorts': 0.0, 'courses': 0.0, 'sessions': 0.0})
                bucket[r.get('source')] = float(r.get('earned') or 0)

            span = (d_to - d_from).days
            series = []
            for i in range(span + 1):
                d = (d_from + datetime.timedelta(days=i)).isoformat()
                b = by_day.get(d) or {'cohorts': 0.0, 'courses': 0.0, 'sessions': 0.0}
                series.append({'date': d, **b, 'total': round(sum(b.values()), 2)})

            # ── SP: sp_achiever_earnings_totals — the delta the tiles show ────
            t = call_proc_one('sp_achiever_earnings_totals', achiever_id, d_from, d_to) or {}
            cur, prev = float(t.get('current_earned') or 0), float(t.get('previous_earned') or 0)
            # No previous period means no comparison to make. Reporting +100%
            # against zero would be a decorative arrow, which is what this
            # endpoint exists to avoid.
            change = round(((cur - prev) / prev) * 100, 1) if prev > 0 else None
            # SKOVO's fee on what was paid in this period (IST days), so the
            # Platform fee tile follows the filter like Earned does.
            fee = db.session.execute(text(
                "SELECT IFNULL(SUM(platform_fee), 0) FROM payment_orders"
                " WHERE achiever_id = :a AND status IN ('paid', 'settled')"
                "   AND DATE(DATE_ADD(paid_at, INTERVAL 330 MINUTE)) BETWEEN :f AND :t"),
                {'a': achiever_id, 'f': d_from, 't': d_to}).scalar() or 0

            return jsonify(
                response={
                    'from': serialize_datetime(d_from),
                    'to': serialize_datetime(d_to),
                    'days': span + 1,
                    'series': series,
                    'current_earned': cur,
                    'previous_earned': prev,
                    'change_pct': change,
                    'period_platform_fee': float(fee),
                    'current_count': int(float(t.get('current_count') or 0)),
                    'previous_count': int(float(t.get('previous_count') or 0)),
                },
                status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@_achievers_ns.route('/portal/earnings')
class AchieverPortalEarnings(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_cohorts_list, sp_cohort_enrollments_list, sp_achiever_sessions_list
            # — no by-achiever-id/by-cohort-id/by-mentor-id filters on the generic
            # CRUD procs, so pull bounded batches and aggregate in Python. ────────
            all_cohorts = call_proc('sp_cohorts_list', 5000, 0)
            cohorts = [c for c in all_cohorts if c.get('achiever_id') == achiever_id]
            all_enrollments = call_proc('sp_cohort_enrollments_list', 50000, 0)

            total_earned = 0.0          # net to achiever (after platform fee)
            total_gross = 0.0           # gross paid by students
            total_platform_fee = 0.0    # platform's cut
            total_enrollments = 0
            pending_amount = 0.0        # net achiever earning still pending
            breakdown = []

            # Net achiever earning per enrollment, falling back to the 70% split for
            # legacy rows created before the platform fee was recorded on cohorts.
            def _net(e):
                if e.get('achiever_earning') is not None:
                    return float(e['achiever_earning'])
                return split_earning(e.get('amount_paid'))[1]

            for c in cohorts:
                enrollments = [e for e in all_enrollments if e.get('cohort_id') == c['id']]
                paid = [e for e in enrollments if e.get('payment_status') == 'paid']
                pending = [e for e in enrollments if e.get('payment_status') == 'pending']
                earned = sum(_net(e) for e in paid)
                gross  = sum(float(e.get('amount_paid') or 0) for e in paid)
                fee    = sum(float(e.get('platform_fee') or 0) for e in paid)
                pend   = sum(_net(e) for e in pending)
                total_earned += earned
                total_gross += gross
                total_platform_fee += fee
                total_enrollments += len(paid)
                pending_amount += pend
                if paid or pending:
                    breakdown.append({
                        'cohort_id': c['id'],
                        'title': c.get('title'),
                        'session_date': serialize_datetime(c.get('session_date')),
                        'status': effective_cohort_status(types.SimpleNamespace(status=c.get('status'), session_date=c.get('session_date'), duration_minutes=c.get('duration_minutes'))) if c.get('status') != 'cancelled' else 'cancelled',
                        'paid_count': len(paid),
                        'total_seats': c.get('total_seats'),
                        'price': float(c.get('price')),
                        'earned': round(earned, 2),
                        'gross': round(gross, 2),
                        'platform_fee': round(fee, 2),
                        'pending': round(pend, 2),
                    })

            breakdown.sort(key=lambda x: x['earned'], reverse=True)

            # Paid 1-on-1 sessions: add their achiever_earning to the running totals.
            all_sessions = call_proc('sp_achiever_sessions_list', 50000, 0)
            paid_sessions = [s for s in all_sessions if s.get('mentor_id') == achiever_id and s.get('payment_status') == 'paid']
            session_earned = 0.0
            session_gross = 0.0
            session_fee = 0.0
            for s in paid_sessions:
                amt = float(s.get('amount') or 0)
                earn = float(s['achiever_earning']) if s.get('achiever_earning') is not None else split_earning(amt)[1]
                fee = float(s['platform_fee']) if s.get('platform_fee') is not None else split_earning(amt)[0]
                session_earned += earn
                session_gross += amt
                session_fee += fee
            total_earned += session_earned
            total_gross += session_gross
            total_platform_fee += session_fee

            # ── SP: sp_achiever_earnings_summary — this ORM calculation above
            # never counted course earnings (achiever_courses/course_enrollments),
            # so course income was silently missing from the total. The SP also
            # tracks payout_requests, giving the available balance the "Request
            # Payout" screen needs. Both are merged in without touching the
            # existing cohort/session breakdown detail, which the SP doesn't provide.
            sp_summary = call_proc_one('sp_achiever_earnings_summary', achiever_id) or {}
            from_courses = float(sp_summary.get('from_courses') or 0)
            total_earned += from_courses
            # Courses do record their own gross and fee — the SP simply wasn't
            # returning them, so this used the net figure as gross and dropped
            # course platform fee from the total altogether. On a live account
            # that understated the platform's cut by a quarter.
            total_gross += float(sp_summary.get('course_gross') or from_courses)
            total_platform_fee += float(sp_summary.get('course_platform_fee') or 0)

            return jsonify(response={
                'total_earned': round(total_earned, 2),
                'total_gross': round(total_gross, 2),
                'total_platform_fee': round(total_platform_fee, 2),
                'total_enrollments': total_enrollments,
                'pending_amount': round(pending_amount, 2),
                'cohort_breakdown': breakdown,
                'session_earnings': {
                    'earned': round(session_earned, 2),
                    'gross': round(session_gross, 2),
                    'platform_fee': round(session_fee, 2),
                    'paid_count': len(paid_sessions),
                },
                'course_earnings': {
                    'earned': round(from_courses, 2),
                },
                'payout_summary': {
                    'total_paid_out': float(sp_summary.get('total_paid_out') or 0),
                    'pending_payout_requests': float(sp_summary.get('pending_payouts') or 0),
                    'available_balance': float(sp_summary.get('available_balance') or 0),
                    # Earned but not yet withdrawable — held until the cohort/
                    # session is actually delivered (escrow).
                    'in_escrow': float(sp_summary.get('in_escrow') or 0),
                },
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/enrollments')
class AchieverPortalAllEnrollments(Resource):
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()

            # ── SP: sp_achiever_enrollments_page / _stats ────────────────────
            # Previously sp_cohorts_list(5000) + sp_cohort_enrollments_list(50000)
            # + sp_users_list(50000), joined in Python. Now one paged query.
            d_from, d_to = _range_args()
            status = (request.args.get('status') or 'all').strip()
            search = (request.args.get('search') or '').strip()
            limit, offset, page, per_page = _page_args()

            rows = call_proc('sp_achiever_enrollments_page', achiever_id, d_from, d_to,
                             status, search, limit, offset)

            result = [{
                'enrollment_id': e['enrollment_id'],
                'user_id': e.get('user_id'),
                'full_name': e.get('full_name') or 'Deleted student',
                'email': e.get('email'),
                'cohort_id': e.get('cohort_id'),
                'cohort_title': e.get('cohort_title') or 'Deleted cohort',
                'payment_status': e.get('payment_status'),
                'amount_paid': float(e.get('amount_paid') or 0),
                'achiever_earning': float(e.get('achiever_earning') or 0),
                'attended': e.get('attended'),
                'enrolled_at': serialize_datetime(e.get('enrolled_at')),
                'session_date': serialize_datetime(e.get('session_date')),
                'cohort_status': e.get('cohort_status'),
                'meeting_link': e.get('meeting_link'),
                'duration_minutes': e.get('duration_minutes'),
            } for e in rows]

            matched = int(rows[0]['total_rows']) if rows else 0
            stats = call_proc_one('sp_achiever_enrollments_stats', achiever_id, d_from, d_to) or {}

            return jsonify(response={
                'enrollments': result,
                'total': matched,
                'page': page, 'per_page': per_page,
                'pages': max(1, -(-matched // per_page)),
                'paid': int(stats.get('paid') or 0),
                'free': int(stats.get('free') or 0),
                'window_total': int(stats.get('total') or 0),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/mentees')
class AchieverPortalMentees(Resource):
    @jwt_required()
    def get(self):
        """Achiever: list students assigned to them as mentees."""
        try:
            claims = get_jwt()
            if claims.get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            # ── SP: sp_achiever_mentees_list, sp_users_list — no by-mentor-id
            # filter on the generic CRUD proc, so pull bounded batches and
            # join/filter in Python. ────────────────────────────────────────────
            all_links = call_proc('sp_achiever_mentees_list', 50000, 0)
            links = [l for l in all_links if l.get('mentor_id') == achiever_id and l.get('status') == 'active']
            links.sort(key=lambda l: l.get('created_at') or datetime.datetime.min, reverse=True)
            users_by_id = {u['id']: u for u in call_proc('sp_users_list', 50000, 0)}

            result = []
            for link in links:
                u = users_by_id.get(link.get('mentee_id'))
                result.append({
                    'mentee_id': link.get('mentee_id'),
                    'full_name': u.get('full_name') if u else 'Deleted student',
                    'email': u.get('email') if u else None,
                    'assigned_at': serialize_datetime(link['created_at']) if link.get('created_at') else None,
                })
            return jsonify(response={'mentees': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/<string:achiever_id>/book')
class BookAchieverSession(Resource):
    @jwt_required()
    def post(self, achiever_id):
        try:
            student_id = get_jwt_identity()
            # ── SP: sp_achievers_get ─────────────────────────────────────────
            achiever = call_proc_one('sp_achievers_get', achiever_id)
            if not achiever or not achiever.get('email'):
                return jsonify(response={'message': 'Achiever not found or not yet available for bookings.'}, status=404, bool=False)
            if CR.paused(achiever_id):
                return jsonify(response={'message': CR.PAUSED_MSG}, status=403, bool=False)

            # ── THE AGE GATE ────────────────────────────────────────────────
            # This used to be `is_verified`, which asserted identity and
            # child-safety with the same bit — so a 16-year-old could book
            # anyone an admin had ticked, and nobody's background had ever been
            # checked. sp_achiever_booking_eligibility evaluates the student's
            # age band, their parental-consent state and the achiever's tier
            # together; splitting them into three Python checks would let them
            # drift apart the first time one changed. It fails closed.
            ok, reason, _level = T.booking_eligibility(achiever_id, student_id)
            if not ok:
                logger.info(f"booking refused a={achiever_id} s={student_id}: {reason}")
                status = 404 if reason == 'not_found' else 403
                return jsonify(response={
                    'message': T.booking_denied_message(reason),
                    'reason': reason,
                }, status=status, bool=False)

            data = request.get_json() or {}
            slot_id = data.get('slot_id')

            # A session must have a scheduled time — the time lives on the slot, so a slot
            # is required. Without it the achiever would get a request with no "when".
            if not slot_id and not (data.get('offering_id') and data.get('date') and data.get('start_time')):
                return jsonify(response={'message': 'Please pick a 1-on-1 and a time to book.'}, status=400, bool=False)

            rate = float(achiever.get('session_rate') or 0)

            # Only a verified, active achiever takes bookings.
            # ── SP: sp_achiever_capabilities ────────────────────────────────
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            if not caps.get('can_take_bookings'):
                return jsonify(response={
                    'message': 'This achiever is not accepting bookings right now.',
                }, status=409, bool=False)

            # Lock the slot row so two students can't grab the same slot concurrently
            # (the check-then-update below must be atomic). No internal transaction on
            # this proc — the lock is held on the ambient session transaction, across
            # the gateway HTTP call below, exactly like the old `.with_for_update()`.
            # 1-on-1s: the student picked a 1-on-1 and a free start time; the
            # slot row is made here, inside this transaction (achiever row locked).
            if not slot_id:
                from portal.routes.AchieverAvailability.offerings import create_booking_slot
                slot_id, _err = create_booking_slot(achiever_id, data['date'], data['start_time'],
                                                    offering_id=data['offering_id'])
                if _err:
                    db.session.rollback()
                    return jsonify(response={'message': _err}, status=409, bool=False)
            # ── SP: sp_achiever_slots_lock_available ────────────────────────────
            slot = call_proc_one('sp_achiever_slots_lock_available', slot_id, achiever_id)
            # Price per slot (like cohorts), less a live offer. The 1-on-1's own
            # price decides the charge (session_rate is the old profile-wide rate
            # and is often empty).
            if slot:
                from portal.routes.AchieverAvailability.achiever_availability import slot_final_price
                _row = db.session.execute(text(
                    "SELECT price, offer_type, offer_value, offer_ends_at, start_utc FROM achiever_slots WHERE id = :i"),
                    {'i': slot_id}).mappings().first() or {}
                if _row.get('price') is not None:
                    rate = float(slot_final_price(_row, rate)[1])
                _cut = int(CR.rules().get('booking_cutoff_min') if CR.rules().get('booking_cutoff_min') is not None else 10)
                if _row.get('start_utc') and _row['start_utc'] < datetime.datetime.utcnow() + datetime.timedelta(minutes=_cut):
                    db.session.rollback()
                    return jsonify(response={'message': 'This time is too soon to book. Pick a later slot.'},
                                   status=400, bool=False)
            if not slot:
                return jsonify(response={'message': 'Slot not available.'}, status=400, bool=False)

            # ── Coupon (paid sessions only) ──────────────────────────────────
            coupon_code = (data.get('coupon_code') or '').strip()
            discount = 0
            coupon_norm = None
            if rate > 0 and coupon_code:
                # ── SP: sp_student_coupon_validate ──────────────────────────────
                cv = call_proc_one('sp_student_coupon_validate', coupon_code, student_id, rate, 'session', achiever_id)
                if not cv or not cv.get('valid'):
                    db.session.rollback()
                    return jsonify(response={'message': (cv or {}).get('message') or 'Invalid coupon.'}, status=400, bool=False)
                discount = float(cv.get('discount') or 0)
                coupon_norm = coupon_code.strip().upper()
            net_rate = max(0.0, rate - discount)

            # ── Paid flow: hold the slot, then open a Cashfree order ────────
            #
            # sp_payment_order_open takes the row lock, checks the slot is still
            # available, snapshots the commission rate and stamps the hold
            # deadline — all in one transaction, before the gateway is called.
            # There is no step 2: the Cashfree webhook confirms and the client
            # polls GET /v1/payments/orders/<id>.
            if rate > 0 and net_rate > 0:
                from portal.helpers.cashfree import (
                    create_order, CashfreeError, CashfreeNotConfigured,
                )
                from portal.helpers.helpers import get_payment_setting, normalise_phone

                # ── SP: sp_users_get ─────────────────────────────────────────
                me = call_proc_one('sp_users_get', student_id) or {}
                phone = normalise_phone(data.get('phone') or me.get('phone'))
                from portal.helpers import wallet as _W
                wallet_pays_all = bool(data.get('use_wallet')) and _W.covers(student_id, net_rate, 'session')
                if not phone and not wallet_pays_all:
                    db.session.rollback()
                    return jsonify(response={
                        'message': 'A mobile number is required to pay.',
                        'need_phone': True,
                    }, status=400, bool=False)

                order_uuid = str(uuid.uuid4())
                order_no = f"{get_payment_setting('order_no_prefix')}-{order_uuid[:12].upper()}"

                try:
                    hold = call_proc_one(
                        'sp_payment_order_open',
                        order_uuid, order_no, 'session', student_id, achiever_id,
                        slot_id, None, net_rate, discount, coupon_norm, None,
                    )
                    _note = (data.get('note') or '').strip()[:1000]
                    if _note:   # copied to the session when it is paid
                        db.session.execute(text("UPDATE payment_orders SET note = :n WHERE id = :o"),
                                           {'n': _note, 'o': order_uuid})
                    db.session.commit()
                except Exception as hold_err:
                    db.session.rollback()
                    msg = str(hold_err)
                    if 'SLOT_UNAVAILABLE' in msg or 'SLOT_NOT_FOUND' in msg:
                        return jsonify(response={'message': 'That slot was just taken. Please pick another.'},
                                       status=409, bool=False)
                    if 'NO_COMMISSION_RULE' in msg or 'PAYMENT_SETTINGS_MISSING' in msg:
                        logger.error(f"Session hold misconfigured: {hold_err}")
                        return jsonify(response={'message': 'Payments are misconfigured. Contact support.'},
                                       status=500, bool=False)
                    logger.error(f"Session hold failed: {hold_err}")
                    return jsonify(response={'message': 'Could not start checkout. Please try again.'},
                                   status=500, bool=False)

                # SKOVO Wallet (§15): pays first; only the rest goes to Cashfree.
                from portal.helpers import wallet as W
                to_pay = W.apply_to_order(order_uuid, student_id, net_rate, 'session',
                                          bool((request.get_json(silent=True) or {}).get('use_wallet')))
                db.session.commit()
                if to_pay <= 0:
                    outcome = W.complete_wallet_order(order_uuid, 'session')
                    db.session.commit()
                    if outcome in ('paid', 'already_paid'):
                        return jsonify(response={'message': 'Paid with your SKOVO Wallet. Your session is confirmed.',
                                                 'order_id': order_uuid, 'paid_with_wallet': True},
                                       status=200, bool=True)

                try:
                    checkout = create_order(
                        order_no=order_no,
                        amount=to_pay,
                        currency=get_payment_setting('currency'),
                        customer={'id': student_id, 'phone': phone,
                                  'email': me.get('email'), 'name': me.get('full_name')},
                        return_url=f"{os.environ.get('FRONTEND_URL', '')}/bookings?order={order_uuid}",
                        notify_url=f"{os.environ.get('API_URL', '')}/v1/webhooks/cashfree",
                        note=f"Session with {achiever.get('full_name') or 'achiever'}",
                    )
                except (CashfreeError, CashfreeNotConfigured) as ce:
                    # Hold exists but is unpayable — expire it now instead of
                    # leaving the slot blocked for the whole window.
                    db.session.execute(text(
                        "UPDATE payment_orders SET status = 'failed', "
                        "failure_reason = :r, expires_at = UTC_TIMESTAMP() WHERE id = :i"
                    ), {'r': str(ce)[:200], 'i': order_uuid})
                    db.session.commit()
                    logger.error(f"Cashfree order failed (session): {ce}")
                    error_id = capture_error(ce)      # see cohorts.py — same gap
                    return jsonify(response={'message': 'Payment gateway error. Please try again.',
                                             'error_id': error_id},
                                   status=502, bool=False)

                return jsonify(response={
                    'message': 'Order created. Complete payment to confirm your session.',
                    'order_id': order_uuid,
                    'order_no': order_no,
                    'payment_session_id': checkout['payment_session_id'],
                    'mode': os.environ.get('CASHFREE_ENV', 'sandbox'),
                    'amount': float(to_pay),
                    'wallet_used': round(float(net_rate) - float(to_pay), 2),
                    'currency': get_payment_setting('currency'),
                    'expires_at': str(hold.get('expires_at')) if hold else None,
                }, status=200, bool=True)

            # ── Free flow (free achiever OR a 100%-off coupon) ───────────────
            # ── SP: sp_student_session_book — locks the seat, checks
            # availability, inserts the session, updates the slot — atomically. ─
            result = call_proc_one(
                'sp_student_session_book',
                student_id, achiever_id, slot_id, (data.get('note') or '').strip() or None,
                0, coupon_norm, discount, None,
            )
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Slot not available.')
                return jsonify(response={'message': message}, status=400, bool=False)

            session_id = result.get('session_id')

            # Notify achiever + track event
            try:
                from portal.helpers.notifications import notify_user
                from portal.helpers.analytics import track_event
                student = call_proc_one('sp_users_get', student_id)
                sname = student.get('full_name') if student else 'A student'
                notify_user(
                    user_id=achiever_id,
                    title='New Session Request',
                    body=f"{sname} requested a 1-on-1 session with you.",
                    type='session',
                    reference_type='session',
                    reference_id=session_id,
                )
                track_event('session_booked', entity_type='session', entity_id=session_id, user_id=student_id, meta={'achiever_id': achiever_id, 'slot_id': slot_id}, req=request)
            except Exception:
                pass

            from portal.helpers.booking_alert import alert_new_booking
            alert_new_booking(session_id=session_id)
            return jsonify(response={'message': 'Session request sent.', 'session_id': session_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /achievers/{achiever_id}/book: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/release')
class ReleasePendingSession(Resource):
    @jwt_required()
    def post(self, session_id):
        """Release a still-unpaid pending session (e.g. the student dismissed the
        checkout popup). Frees the held slot and removes the ghost session so the
        slot can be booked again. Only the owning student, only while unpaid."""
        try:
            student_id = get_jwt_identity()
            # ── SP: sp_student_session_release — checks ownership/status, frees
            # the slot, deletes the ghost session — atomically. ──────────────────
            result = call_proc_one('sp_student_session_release', session_id, student_id)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            return jsonify(response={'message': 'Booking released.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /achievers/sessions/{session_id}/release: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/report')
class StudentReportSession(Resource):
    @jwt_required()
    def post(self, session_id):
        """Student reports a problem with a 1-on-1 that ended (complaint window)."""
        try:
            student_id = get_jwt_identity()
            s = call_proc_one('sp_session_with_times', session_id)
            if not s or s.get('student_id') != student_id:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            if s.get('status') != 'completed' or s.get('payment_status') != 'paid' or not CR.complaint_open(s):
                return jsonify(response={'message': 'This session can no longer be reported here. Use Help & support.'},
                               status=400, bool=False)
            reason = ((request.get_json(silent=True) or {}).get('reason') or '').strip()[:1000]
            if len(reason) < 5:
                return jsonify(response={'message': 'Tell us what went wrong.'}, status=400, bool=False)
            call_proc_one('sp_class_issue_add', 'student_report', 'session', session_id, session_id,
                          s.get('mentor_id'), student_id, reason, 'open')
            db.session.commit()
            return jsonify(response={'message': "Thanks. An admin will check it. The achiever's payment is on hold until then."},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/refund-preview')
class SessionRefundPreview(Resource):
    @jwt_required()
    def get(self, session_id):
        try:
            student_id = get_jwt_identity()
            quote = call_proc_one('sp_refund_preview_session', session_id, student_id, 'student') or {}
            if not quote.get('ok'):
                message = quote.get('message') or 'Session not found.'
                status = 404 if 'not found' in message.lower() else 400
                return jsonify(response={'message': message}, status=status, bool=False)
            refund = float(quote.get('refund') or 0)
            from portal.helpers.wallet import choice_preview
            from portal.helpers.refunds import refund_text
            return jsonify(response={
                'refund': refund,
                'tier': quote.get('tier') or 'none',
                'hours_until': float(quote.get('hours_until') or 0),
                'text': refund_text(refund),
                # Wallet choice (feature-updates.md §15): instant + admin bonus.
                **choice_preview(refund, 'student_cancel', quote.get('order_id')),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/cancel')
class StudentCancelSession(Resource):
    @jwt_required()
    def post(self, session_id):
        """Student cancels their own pending/confirmed 1-on-1. Gateway first."""
        try:
            student_id = get_jwt_identity()
            quote = call_proc_one('sp_refund_preview_session', session_id, student_id, 'student') or {}
            if not quote.get('ok'):
                message = quote.get('message') or 'Session not found.'
                status = 404 if 'not found' in message.lower() else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            refund_amt = float(quote.get('refund') or 0)
            tier = quote.get('tier') or 'none'
            order_id = quote.get('order_id')
            old_status = quote.get('old_status')

            if old_status == 'paid' and order_id and refund_amt > 0:
                from portal.helpers.refunds import issue_refund
                from portal.helpers.refunds import choice_from
                destination, reason_code, reason_text = choice_from(request.get_json(silent=True))
                ok, info = issue_refund(
                    order_id, refund_amt, 'cancellation refund',
                    actor_id=student_id,
                    refund_key='rf-%s-c' % str(order_id)[:24],
                    destination=destination, case_key='student_cancel',
                    reason_code=reason_code, reason_text=reason_text,
                )
                if not ok:
                    return jsonify(response={
                        'message': 'Refund could not be issued. Your session is unchanged.',
                    }, status=502, bool=False)

            result = call_proc_one('sp_student_session_cancel', session_id, student_id, 0)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            s = call_proc_one('sp_achiever_sessions_get', session_id)
            try:
                from portal.helpers.notifications import notify_user
                notify_user(s.get('mentor_id') if s else None, 'Session Cancelled', 'A student cancelled their 1-on-1 session.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass

            msg = 'Session cancelled.'
            if old_status == 'paid' and refund_amt > 0:
                from portal.helpers.refunds import inr
                msg = f'Session cancelled. {inr(refund_amt)} is back in your SKOVO Wallet.'
            return jsonify(response={'message': msg, 'refund_amount': refund_amt}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /achievers/sessions/{session_id}/cancel: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _slot_for_move(session_id, data, owner):
    """A new slot for moving a booking: same 1-on-1 (title, price, link, length),
    at a free time; its own current time does not count as busy."""
    from portal.routes.AchieverAvailability.offerings import create_booking_slot
    col, who = owner
    sess = db.session.execute(text(
        f"SELECT mentor_id FROM achiever_sessions WHERE id = :s AND {col} = :w"),
        {'s': session_id, 'w': who}).first()
    if not sess:
        return None, 'Session not found.'
    cur = db.session.execute(text(
        "SELECT offering_id, title, about, price, offer_type, offer_value, offer_ends_at, meeting_link,"
        "       start_time, end_time FROM achiever_slots WHERE session_id = :s ORDER BY start_utc LIMIT 1"),
        {'s': session_id}).mappings().first()
    if not cur:
        return None, 'Session not found.'
    return create_booking_slot(sess[0], data['date'], data['start_time'], copy_from=cur,
                               exclude_session=session_id)


@_achievers_ns.route('/sessions/<string:session_id>/reschedule')
class RescheduleSession(Resource):
    @jwt_required()
    def post(self, session_id):
        """Student moves a pending/confirmed 1-on-1 to another available slot of the
        same achiever. Frees the old slot, holds the new one, keeps the payment."""
        try:
            student_id = get_jwt_identity()
            data = request.get_json() or {}
            new_slot_id = data.get('slot_id')
            if not new_slot_id and data.get('date') and data.get('start_time'):
                new_slot_id, _err = _slot_for_move(session_id, data, owner=('student_id', student_id))
                if _err:
                    db.session.rollback()
                    return jsonify(response={'message': _err}, status=409, bool=False)
            if not new_slot_id:
                return jsonify(response={'message': 'Pick a new time slot.'}, status=400, bool=False)

            # ── SP: sp_student_session_reschedule — checks ownership/status,
            # locks the new slot, frees the old one, moves the session — atomically. ─
            result = call_proc_one('sp_student_session_reschedule', session_id, student_id, new_slot_id)
            db.session.commit()

            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            # ── SP: sp_achiever_sessions_get ────────────────────────────────────
            s = call_proc_one('sp_achiever_sessions_get', session_id)
            try:
                from portal.helpers.notifications import notify_user
                notify_user(s.get('mentor_id') if s else None, 'Session Rescheduled', 'A student moved their 1-on-1 to a new time.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass
            return jsonify(response={'message': 'Session rescheduled.', 'session_id': session_id}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/portal/sessions/<string:session_id>/propose')
class AchieverProposeSession(Resource):
    @jwt_required()
    def post(self, session_id):
        """Achiever offers another free slot. Student accepts or declines (100%)."""
        try:
            if get_jwt().get('role') != 'mentor':
                return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}
            slot_id = data.get('slot_id')
            _full = call_proc_one('sp_session_with_times', session_id) or {}
            if CR.change_locked(_full.get('start_utc')):
                return jsonify(response={'message': CR.lock_message()}, status=409, bool=False)
            if not slot_id and data.get('date') and data.get('start_time'):
                slot_id, _err = _slot_for_move(session_id, data, owner=('mentor_id', achiever_id))
                if _err:
                    db.session.rollback()
                    return jsonify(response={'message': _err}, status=409, bool=False)
            if not slot_id:
                return jsonify(response={'message': 'Pick a new time slot.'}, status=400, bool=False)
            result = call_proc_one('sp_achiever_session_propose', session_id, achiever_id, slot_id)
            db.session.commit()
            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)
            s = call_proc_one('sp_achiever_sessions_get', session_id)
            try:
                from portal.helpers.notifications import notify_user
                notify_user(s.get('student_id') if s else None, 'New time proposed',
                            'Your achiever suggested a different time for your 1-on-1.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass
            return jsonify(response={'message': 'New time proposed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/proposal/accept')
class AcceptSessionProposal(Resource):
    @jwt_required()
    def post(self, session_id):
        """Student keeps the same pay and moves onto the proposed slot."""
        try:
            student_id = get_jwt_identity()
            result = call_proc_one('sp_student_session_accept_proposal', session_id, student_id)
            db.session.commit()
            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)
            s = call_proc_one('sp_achiever_sessions_get', session_id)
            try:
                from portal.helpers.notifications import notify_user
                notify_user(s.get('mentor_id') if s else None, 'New time accepted',
                            'The student accepted your proposed 1-on-1 time.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass
            return jsonify(response={'message': 'New time accepted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@_achievers_ns.route('/sessions/<string:session_id>/proposal/decline')
class DeclineSessionProposal(Resource):
    @jwt_required()
    def post(self, session_id):
        """Student refuses the proposed slot → 100% refund, session cancelled."""
        try:
            student_id = get_jwt_identity()
            existing = call_proc_one('sp_achiever_sessions_get', session_id)
            if not existing or existing.get('student_id') != student_id:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            if not existing.get('proposed_slot_id'):
                return jsonify(response={'message': 'No new time has been proposed.'}, status=400, bool=False)

            quote = call_proc_one('sp_refund_preview_session', session_id, student_id, 'achiever') or {}
            if not quote.get('ok'):
                message = quote.get('message') or 'Session not found.'
                status = 404 if 'not found' in message.lower() else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            refund_amt = float(quote.get('refund') or 0)
            order_id = quote.get('order_id')
            old_status = quote.get('old_status')

            if old_status == 'paid' and order_id and refund_amt > 0:
                from portal.helpers.refunds import issue_refund
                from portal.helpers.refunds import choice_from
                destination, reason_code, reason_text = choice_from(request.get_json(silent=True))
                ok, info = issue_refund(
                    order_id, refund_amt, 'declined reschedule',
                    actor_id=student_id,
                    refund_key='rf-%s-d' % str(order_id)[:24],
                    destination=destination, case_key='reschedule_rejected',
                    reason_code=reason_code, reason_text=reason_text,
                )
                if not ok:
                    return jsonify(response={
                        'message': 'Refund could not be issued. Your session is unchanged.',
                    }, status=502, bool=False)

            result = call_proc_one('sp_student_session_cancel', session_id, student_id, 1)
            db.session.commit()
            if not result or not result.get('ok'):
                message = (result or {}).get('message', 'Session not found.')
                status = 404 if message == 'Session not found.' else 400
                return jsonify(response={'message': message}, status=status, bool=False)

            try:
                from portal.helpers.notifications import notify_user
                notify_user(existing.get('mentor_id'), 'Proposed time declined',
                            'The student declined the new time. The session was cancelled and refunded.',
                            type='session', reference_type='session', reference_id=session_id)
            except Exception:
                pass
            msg = 'Proposed time declined. Session cancelled.'
            if old_status == 'paid' and refund_amt > 0:
                from portal.helpers.refunds import inr
                msg = f'Session cancelled. {inr(refund_amt)} is back in your SKOVO Wallet.'
            return jsonify(response={'message': msg, 'refund_amount': refund_amt}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)



def _achiever_identity(achiever_id):
    """Gender and date of birth (admin checks them against the ID)."""
    try:
        r = db.session.execute(text(
            "SELECT gender, date_of_birth FROM achievers WHERE id = :i"), {'i': achiever_id}).fetchone()
        return {'gender': r[0] if r else None,
                'date_of_birth': r[1].isoformat() if r and r[1] else None}
    except Exception:
        return {'gender': None, 'date_of_birth': None}


def _save_achiever_identity(achiever_id, data):
    """Apply gender / date_of_birth from a profile PUT. Returns an error message or ''."""
    sets, params = [], {'i': achiever_id}
    if 'gender' in data:
        from portal.helpers.gender import clean_gender
        gv, ok = clean_gender(data.get('gender'))
        if not ok:
            return 'Pick a gender from the list.'
        sets.append('gender = :g'); params['g'] = gv
    if 'date_of_birth' in data:
        raw = (data.get('date_of_birth') or '').strip()[:10]
        if raw:
            import datetime as _d
            try:
                dob = _d.date.fromisoformat(raw)
            except ValueError:
                return 'Enter your date of birth as a date.'
            age = (_d.date.today() - dob).days // 365
            if age < 16 or age > 90:
                return 'Check your date of birth.'
            params['d'] = dob
        else:
            params['d'] = None
        sets.append('date_of_birth = :d')
    if sets:
        db.session.execute(text("UPDATE achievers SET " + ", ".join(sets) + " WHERE id = :i"), params)
    return ''
