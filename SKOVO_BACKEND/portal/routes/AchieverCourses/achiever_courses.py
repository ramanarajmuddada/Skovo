from portal.helpers.error_capture import capture_error
import os, json, uuid, hmac, hashlib, datetime as _dt
from sqlalchemy import text
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import offer_effective_price, parse_local_to_utc, serialize_datetime
from portal.helpers import field_limits as FL
from portal.helpers import trust as T
from . import ns, logger


def _as_list(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _get_student_profile(user_id):
    try:
        # ── SP: sp_profile_get_by_user ─────────────────────────────────────
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
    """Return True if the course/cohort is visible to this student profile. `c` is a dict row."""
    cats      = _as_list(c.get('target_categories'))
    streams   = _as_list(c.get('target_streams'))
    deg_cats  = _as_list(c.get('target_degree_cats'))
    exam_tgts = _as_list(c.get('target_exam_targets'))
    prof_crs  = _as_list(c.get('target_prof_courses'))
    years     = _as_list(c.get('target_years'))
    degrees   = _as_list(c.get('target_degrees'))
    branches  = _as_list(c.get('target_branches'))

    # Nothing targeted → visible to everyone
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

    if cats      and s_cat.lower()    not in [x.lower() for x in cats]:      return False
    if streams   and s_stream.lower() not in [x.lower() for x in streams]:   return False
    if deg_cats  and s_dgcat.lower()  not in [x.lower() for x in deg_cats]:  return False
    if exam_tgts and s_exam.lower()   not in [x.lower() for x in exam_tgts]: return False
    if prof_crs  and s_prof.lower()   not in [x.lower() for x in prof_crs]:  return False
    if years     and s_year.lower()   not in [x.lower() for x in years]:     return False
    if degrees   and not any(d.lower() in s_deg  or s_deg  in d.lower() for d in degrees):  return False
    if branches  and not any(b.lower() in s_branch or s_branch in b.lower() for b in branches): return False
    return True


# ── parsers ──────────────────────────────────────────────────────────────────

list_parser = reqparse.RequestParser()
list_parser.add_argument('page',     type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=12)
list_parser.add_argument('search',   type=str, location='args', required=False)
list_parser.add_argument('level',    type=str, location='args', required=False)

enroll_parser = reqparse.RequestParser()
# Cashfree needs a customer phone; SKOVO accounts may have none.
enroll_parser.add_argument('phone', type=str, location='json', required=False)
enroll_parser.add_argument('coupon_code',         type=str, location='json', required=False)


# ── helpers ───────────────────────────────────────────────────────────────────

def _course_dict(c, achiever=None, enrolled=False, enrollment_status=None):
    return {
        'id':             c.get('id'),
        'title':          c.get('title'),
        'description':    c.get('description'),
        'thumbnail_url':  c.get('thumbnail_url'),
        'price':          float(c.get('price')) if c.get('price') else 0,
        'effective_price': offer_effective_price(c)[0],
        'offer_label':     offer_effective_price(c)[1],
        'offer_price':     c.get('offer_price'),
        'offer_percent':   c.get('offer_percent'),
        'offer_starts_at': serialize_datetime(c.get('offer_starts_at')),
        'offer_ends_at':   serialize_datetime(c.get('offer_ends_at')),
        'duration_weeks': c.get('duration_weeks'),
        'level':          c.get('level'),
        'category':       c.get('category'),
        'what_you_learn':      _as_list(c.get('what_you_learn')),
        'requirements':        _as_list(c.get('requirements')),
        'target_categories':   _as_list(c.get('target_categories')),
        'target_streams':      _as_list(c.get('target_streams')),
        'target_degree_cats':  _as_list(c.get('target_degree_cats')),
        'target_exam_targets': _as_list(c.get('target_exam_targets')),
        'target_prof_courses': _as_list(c.get('target_prof_courses')),
        'target_years':        _as_list(c.get('target_years')),
        'target_degrees':      _as_list(c.get('target_degrees')),
        'target_branches':     _as_list(c.get('target_branches')),
        'status':          c.get('status'),
        'enrolled_count':  c.get('enrolled_count') or 0,
        'is_enrolled':    enrolled,
        'enrollment_status': enrollment_status,
        'achiever': {
            'id':           achiever.get('id'),
            'full_name':    achiever.get('full_name'),
            'designation':  achiever.get('designation'),
            'company':      achiever.get('company'),
            'avatar_url':   achiever.get('avatar_url'),
        } if achiever else None,
    }


def _module_dict(m):
    live_url = None
    is_live  = False
    can_join = True   # non-live content (video/text/resource) is always accessible
    if m.get('content_type') == 'live_session':
        now = _dt.datetime.utcnow()
        start = m.get('live_session_date')
        dur   = m.get('live_session_duration_minutes') or 90
        if start:
            end = start + _dt.timedelta(minutes=dur)
            is_live  = start <= now <= end
            # joinable from 15 min before start through the end of the session
            can_join = (start - _dt.timedelta(minutes=15)) <= now <= end
        else:
            can_join = True   # no scheduled time -> legacy always-open room
        # No room is auto-generated for a course module — `course_modules` has
        # no link column, so `live_session_url` stays None and the UI shows the
        # schedule without a join link. is_live / can_join still drive the
        # module's state.
        live_url = None
    live_session_date = m.get('live_session_date')
    return {
        'id':               m.get('id'),
        'title':            m.get('title'),
        'description':      m.get('description'),
        'order_index':      m.get('order_index'),
        'content_type':     m.get('content_type'),
        'video_url':        m.get('video_url'),
        'content_text':     m.get('content_text'),
        'live_session_date':      serialize_datetime(live_session_date) if live_session_date else None,
        'live_session_duration':  m.get('live_session_duration_minutes'),
        'live_session_url':       live_url,
        'is_live':          is_live,
        'can_join':         can_join,
        'is_free_preview':  bool(m.get('is_free_preview')),
    }


# ═══════════════════════════════════════════════════════════════════════════
# STUDENT-FACING ROUTES
# ═══════════════════════════════════════════════════════════════════════════


def _whole_numbers(data, specs):
    """Parse whole-number fields, or return a message naming the first bad one.

    (key, label, default, low, high). Absent or blank takes the default, which
    is what the previous `int(data.get(k, default))` did — the difference is
    that a non-numeric value is now a 400 naming the field rather than an
    uncaught ValueError surfacing as a 500.
    """
    out = {}
    for key, label, default, low, high in specs:
        raw = data.get(key)
        if raw in (None, '', 'null'):
            out[key] = default
            continue
        try:
            n = int(raw)
        except (ValueError, TypeError):
            return f'{label} must be a whole number.', out
        if n < low:
            return (f'{label} cannot be negative.' if low == 0
                    else f'{label} must be at least {low}.'), out
        if high is not None and n > high:
            return f'{label} must be {high} or less.', out
        out[key] = n
    return None, out


@ns.route('/')
class CourseList(Resource):
    @jwt_required()
    def get(self):
        """Browse all published courses, filtered by student audience profile."""
        try:
            import math
            user_id = get_jwt_identity()
            args    = list_parser.parse_args()
            profile = _get_student_profile(user_id)

            # ── SP: sp_achiever_courses_list — no search/level/status filter on
            # the generic CRUD proc, so pull a bounded batch and filter here. ──
            rows = call_proc('sp_achiever_courses_list', 20000, 0, 1)
            all_courses = [c for c in rows if c.get('status') == 'published']
            if args.get('search'):
                s = args['search'].lower()
                all_courses = [
                    c for c in all_courses
                    if s in (c.get('title') or '').lower() or s in (c.get('description') or '').lower()
                    or s in (c.get('category') or '').lower()
                ]
            if args.get('level'):
                all_courses = [c for c in all_courses if c.get('level') == args['level']]
            all_courses.sort(key=lambda c: c.get('created_at') or '', reverse=True)

            visible = [c for c in all_courses if _matches_audience(c, profile)]

            page     = args['page']
            per_page = args['per_page']
            total    = len(visible)
            start    = (page - 1) * per_page
            items    = visible[start:start + per_page]

            # ── SP: sp_achievers_list, sp_course_enrollments_list ─────────────
            all_achievers = call_proc('sp_achievers_list', 5000, 0, 0)
            achievers_by_id = {a['id']: a for a in all_achievers}
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enroll_by_key = {(e.get('user_id'), e.get('course_id')): e for e in all_enrollments}

            result = []
            for c in items:
                achiever   = achievers_by_id.get(c.get('achiever_id'))
                enrollment = enroll_by_key.get((user_id, c.get('id')))
                is_enrolled = enrollment is not None and enrollment.get('payment_status') in ('paid', 'free')
                result.append(_course_dict(c, achiever,
                                           enrolled=is_enrolled,
                                           enrollment_status=enrollment.get('payment_status') if enrollment else None))

            return jsonify(
                response={'courses': result},
                pagination={
                    'total':    total,
                    'pages':    math.ceil(total / per_page) if per_page else 1,
                    'page':     page,
                    'per_page': per_page,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"CourseList.get error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/my')
class MyCourses(Resource):
    @jwt_required()
    def get(self):
        """Student: list enrolled courses."""
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_course_enrollments_list, sp_achiever_courses_list,
            # sp_achievers_list, sp_course_modules_list ────────────────────────
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enrollments = [
                e for e in all_enrollments
                if e.get('user_id') == user_id and e.get('payment_status') in ('paid', 'free')
            ]
            enrollments.sort(key=lambda e: e.get('enrolled_at') or e.get('created_at'), reverse=True)

            all_courses = call_proc('sp_achiever_courses_list', 20000, 0, 0)
            courses_by_id = {c['id']: c for c in all_courses}
            all_achievers = call_proc('sp_achievers_list', 5000, 0, 0)
            achievers_by_id = {a['id']: a for a in all_achievers}
            all_modules = call_proc('sp_course_modules_list', 200000, 0, 1)
            modules_by_course = {}
            for m in all_modules:
                modules_by_course.setdefault(m.get('course_id'), []).append(m)

            result = []
            for enr in enrollments:
                c = courses_by_id.get(enr.get('course_id'))
                if not c:
                    continue
                achiever = achievers_by_id.get(c.get('achiever_id'))
                modules = sorted(modules_by_course.get(c['id'], []), key=lambda m: m.get('order_index') or 0)
                d = _course_dict(c, achiever, enrolled=True, enrollment_status=enr.get('payment_status'))
                d['modules']     = [_module_dict(m) for m in modules]
                enrolled_at = enr.get('enrolled_at')
                d['enrolled_at'] = enrolled_at.isoformat() if enrolled_at else None
                result.append(d)

            return jsonify(response={'courses': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            logger.error(f"MyCourses.get error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/<string:course_id>')
class CourseDetail(Resource):
    @jwt_required()
    def get(self, course_id):
        """Course detail — free-preview modules visible to all; full content to enrolled."""
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_achiever_courses_get, sp_achievers_get, sp_course_enrollments_list,
            # sp_course_modules_list ───────────────────────────────────────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or not c.get('is_active') or c.get('deleted_at') or c.get('status') != 'published':
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            achiever   = call_proc_one('sp_achievers_get', c.get('achiever_id'))
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enrollment = next((e for e in all_enrollments if e.get('user_id') == user_id and e.get('course_id') == course_id), None)
            is_enrolled = enrollment and enrollment.get('payment_status') in ('paid', 'free')

            all_modules = call_proc('sp_course_modules_list', 5000, 0, 1)
            course_modules = sorted(
                [m for m in all_modules if m.get('course_id') == course_id],
                key=lambda m: m.get('order_index') or 0
            )
            # locked modules show title only (no content)
            modules_out = []
            for m in course_modules:
                md = _module_dict(m)
                if not is_enrolled and not m.get('is_free_preview'):
                    md['video_url']    = None
                    md['content_text'] = None
                    md['locked']       = True
                else:
                    md['locked'] = False
                modules_out.append(md)

            data = _course_dict(c, achiever, enrolled=is_enrolled,
                                enrollment_status=enrollment.get('payment_status') if enrollment else None)
            data['modules'] = modules_out
            return jsonify(response=data, status=200, bool=True)
        except Exception as e:
            logger.error(f"CourseDetail.get error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


_COURSE_ENROLL_ERROR_STATUS = {
    'Course not found.': 404,
    'This is a paid course — use the paid flow.': 400,
    'Already enrolled.': 409,
}


@ns.route('/<string:course_id>/enroll')
class CourseEnroll(Resource):
    @jwt_required()
    def post(self, course_id):
        """
        Opens an order and returns `payment_session_id` for Cashfree checkout.
        Step 2 (with payment params): verifies signature, confirms enrollment.
        Free courses: enroll immediately.
        """
        try:
            user_id = get_jwt_identity()
            args = enroll_parser.parse_args()

            # ── SP: sp_achiever_courses_get, sp_course_enrollments_get_by_user_course ─
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('deleted_at') or not c.get('is_active') or c.get('status') != 'published':
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            existing = call_proc_one('sp_course_enrollments_get_by_user_course', user_id, course_id)
            if existing and existing.get('payment_status') in ('paid', 'free'):
                return jsonify(response={'message': 'Already enrolled.'}, status=409, bool=False)

            # ── Skovo Pro members: subscription covers the course, enrol free ──
            from portal.routes.Subscription.subscription import is_pro
            if c.get('price') and is_pro(user_id):
                result = call_proc_one('sp_student_course_enroll_pro', user_id, course_id)
                db.session.commit()
                if not result or not result.get('ok'):
                    message = (result or {}).get('message', 'Unable to enroll.')
                    return jsonify(response={'message': message}, status=_COURSE_ENROLL_ERROR_STATUS.get(message, 400), bool=False)
                try:
                    from portal.helpers.notifications import notify_user
                    notify_user(user_id, 'Enrolled with Skovo Pro!', f"'{c.get('title')}' is covered by your membership.",
                                type='course', reference_type='course', reference_id=course_id)
                except Exception:
                    pass
                return jsonify(response={'message': 'Enrolled with Skovo Pro.', 'enrollment_id': result.get('enrollment_id'), 'via': 'pro'}, status=200, bool=True)

            # ── Free course ──────────────────────────────────────────────────
            if not c.get('price'):
                # ── SP: sp_student_course_enroll_free — locks the course row,
                # checks status/duplicate, inserts the enrollment, increments
                # enrolled_count — all atomically in one transaction. ────────────
                result = call_proc_one('sp_student_course_enroll_free', user_id, course_id)
                db.session.commit()

                if not result or not result.get('ok'):
                    message = (result or {}).get('message', 'Unable to enroll.')
                    return jsonify(response={'message': message}, status=_COURSE_ENROLL_ERROR_STATUS.get(message, 400), bool=False)

                try:
                    from portal.helpers.notifications import notify_user
                    notify_user(user_id, 'Enrolled!', f"You are now enrolled in '{c.get('title')}'.",
                                type='course', reference_type='course', reference_id=course_id)
                except Exception:
                    pass
                return jsonify(response={'message': 'Enrolled successfully.', 'enrollment_id': result.get('enrollment_id')},
                               status=200, bool=True)

            # ── Coupon and the price actually charged ────────────────────────
            #
            # Same gap as the cohort checkout had: the order call below used
            # these three and nothing assigned them, so a paid course purchase
            # failed with `name 'net_price' is not defined` before the gateway
            # was ever reached.
            price = float(c.get('price') or 0)
            coupon_code = (args.get('coupon_code') or '').strip()
            discount = 0
            coupon_norm = None
            if price > 0 and coupon_code:
                # ── SP: sp_student_coupon_validate ──────────────────────────
                cv = call_proc_one('sp_student_coupon_validate',
                                   coupon_code, user_id, price, 'course', course_id)
                if not cv or not cv.get('valid'):
                    db.session.rollback()
                    return jsonify(
                        response={'message': (cv or {}).get('message') or 'Invalid coupon.'},
                        status=400, bool=False
                    )
                discount = float(cv.get('discount') or 0)
                coupon_norm = coupon_code.upper()

            net_price = max(0.0, price - discount)

            # ── Paid: open an order, then Cashfree checkout ──────────────────
            #
            # A course has no capacity, so there is nothing to reserve — the
            # order exists purely so the payment has something to attach to and
            # the commission rate is snapshotted before the price can move.
            # No step 2: the webhook confirms, the client polls
            # GET /v1/payments/orders/<id>.
            try:
                from portal.helpers.cashfree import (
                    create_order, CashfreeError, CashfreeNotConfigured,
                )
                from portal.helpers.helpers import get_payment_setting, normalise_phone

                # ── SP: sp_users_get ─────────────────────────────────────────
                me = call_proc_one('sp_users_get', user_id) or {}
                phone = normalise_phone(args.get('phone') or me.get('phone'))
                if not phone:
                    return jsonify(response={'message': 'A mobile number is required to pay.',
                                             'need_phone': True}, status=400, bool=False)

                order_uuid = str(uuid.uuid4())
                order_no = f"{get_payment_setting('order_no_prefix')}-{order_uuid[:12].upper()}"

                call_proc_one(
                    'sp_payment_order_open',
                    order_uuid, order_no, 'course', user_id, c.get('achiever_id'),
                    None, course_id, net_price, discount, coupon_norm, None,
                )
                db.session.commit()

                try:
                    checkout = create_order(
                        order_no=order_no,
                        amount=net_price,
                        currency=get_payment_setting('currency'),
                        customer={'id': user_id, 'phone': phone,
                                  'email': me.get('email'), 'name': me.get('full_name')},
                        return_url=f"{os.environ.get('FRONTEND_URL', '')}/courses?order={order_uuid}",
                        notify_url=f"{os.environ.get('API_URL', '')}/v1/webhooks/cashfree",
                        note=f"Course {course_id[:8]}",
                    )
                except (CashfreeError, CashfreeNotConfigured) as ce:
                    db.session.execute(text(
                        "UPDATE payment_orders SET status = 'failed', "
                        "failure_reason = :r, expires_at = UTC_TIMESTAMP() WHERE id = :i"
                    ), {'r': str(ce)[:200], 'i': order_uuid})
                    db.session.commit()
                    logger.error(f"Cashfree course order error: {ce}")
                    error_id = capture_error(ce)      # see cohorts.py — same gap
                    return jsonify(response={'message': 'Payment gateway error. Please try again.',
                                             'error_id': error_id},
                                   status=502, bool=False)

                return jsonify(response={
                    'message': 'Order created. Complete payment.',
                    'order_id': order_uuid,
                    'order_no': order_no,
                    'payment_session_id': checkout['payment_session_id'],
                    'mode': os.environ.get('CASHFREE_ENV', 'sandbox'),
                    'amount': float(net_price),
                    'currency': get_payment_setting('currency'),
                }, status=200, bool=True)

            except Exception as order_err:
                db.session.rollback()
                msg = str(order_err)
                if 'NO_COMMISSION_RULE' in msg or 'PAYMENT_SETTINGS_MISSING' in msg:
                    logger.error(f"Course checkout misconfigured: {order_err}")
                    return jsonify(response={'message': 'Payments are misconfigured. Contact support.'},
                                   status=500, bool=False)
                logger.error(f"Course checkout failed: {order_err}")
                return jsonify(response={'message': 'Could not start checkout. Please try again.'},
                               status=500, bool=False)

        except Exception as e:
            db.session.rollback()
            logger.error(f"CourseEnroll.post error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


# ═══════════════════════════════════════════════════════════════════════════
# ACHIEVER PORTAL ROUTES  (role=mentor required)
# ═══════════════════════════════════════════════════════════════════════════

def _require_mentor():
    claims      = get_jwt()
    achiever_id = get_jwt_identity()
    if claims.get('role') != 'mentor':
        return None, jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
    return achiever_id, None


# order matches sp_achiever_courses_create/_update after (id, achiever_id, title)
_COURSE_FIELDS = [
    ('description', None), ('thumbnail_url', None), ('price', int), ('duration_weeks', int),
    ('level', None), ('category', None), ('what_you_learn', 'json'), ('requirements', 'json'),
    ('status', None), ('enrolled_count', None), ('target_categories', 'json'), ('target_streams', 'json'),
    ('target_degree_cats', 'json'), ('target_exam_targets', 'json'), ('target_prof_courses', 'json'),
    ('target_years', 'json'), ('target_degrees', 'json'), ('target_branches', 'json'), ('is_active', 'bool'),
]


def _build_course_args(cid, achiever_id, title, d, existing=None):
    existing = existing or {}
    args = [cid, achiever_id, title]
    for field, caster in _COURSE_FIELDS:
        if field in d:
            v = d[field]
            if caster == 'json':
                v = json.dumps(v if v is not None else [])
            elif caster == 'bool':
                v = 1 if v else 0
            elif caster:
                v = caster(v)
            args.append(v)
        else:
            args.append(existing.get(field))
    return args


@ns.route('/portal/')
class AchieverCoursePortalList(Resource):
    @jwt_required()
    def get(self):
        """Achiever: list their own courses."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err

            # ── SP: sp_achiever_courses_list + sp_course_modules_list ─────────
            rows = call_proc('sp_achiever_courses_list', 20000, 0, 0)
            courses = [c for c in rows if c.get('achiever_id') == achiever_id]
            courses.sort(key=lambda c: c.get('created_at') or '', reverse=True)

            all_modules = call_proc('sp_course_modules_list', 200000, 0, 1)
            module_counts = {}
            for m in all_modules:
                module_counts[m.get('course_id')] = module_counts.get(m.get('course_id'), 0) + 1

            result = []
            for c in courses:
                d = _course_dict(c)
                d['module_count'] = module_counts.get(c.get('id'), 0)
                result.append(d)

            return jsonify(response={'courses': result, 'total': len(result)}, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """Achiever: create a new course (starts as draft)."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err

            # ── Lifecycle gate ───────────────────────────────────────────────
            # A course is a paid product, so it needs `active` — the state an
            # admin grants on verifying the achiever.
            err = T.require_state(
                achiever_id, 'can_charge',
                'Courses are a paid product, which opens once an admin has verified '
                'your account.')
            if err:
                return err

            data = request.get_json() or {}
            if not data.get('title', '').strip():
                return jsonify(response={'message': 'Title is required.'}, status=400, bool=False)

            # This module imported no field limits at all, so `level` (VARCHAR
            # 30) and `category` (VARCHAR 100) were a MySQL 1406 past the
            # column — a 500 with an opaque error id on a create form.
            verr = FL.check_all([
                (data.get('title'), 'Title', FL.COURSE_TITLE),
                (data.get('description'), 'Description', FL.COURSE_DESCRIPTION),
                (data.get('level'), 'Level', FL.COURSE_LEVEL),
                (data.get('category'), 'Category', FL.COURSE_CATEGORY),
                (data.get('thumbnail_url'), 'Thumbnail URL', FL.URL),
            ])
            if verr:
                return jsonify(response={'message': verr}, status=400, bool=False)

            # `int(data.get('price', 0))` raised an uncaught ValueError on any
            # non-numeric value — 'abc' was a 500, not a 400 naming the field.
            nerr, nums = _whole_numbers(data, [
                ('price', 'Price', 0, 0, None),
                ('duration_weeks', 'Duration in weeks', 4, 1, 520),
            ])
            if nerr:
                return jsonify(response={'message': nerr}, status=400, bool=False)

            course_id = str(uuid.uuid4())
            d = {
                'description': data.get('description', '').strip() or None,
                'thumbnail_url': data.get('thumbnail_url') or None,
                'price': nums['price'],
                'duration_weeks': nums['duration_weeks'],
                'level': data.get('level', 'beginner'),
                'category': data.get('category', '').strip() or None,
                'what_you_learn': data.get('what_you_learn') or [],
                'requirements': data.get('requirements') or [],
                'status': 'draft',
                'enrolled_count': 0,
                'target_categories': data.get('target_categories') or [],
                'target_streams': data.get('target_streams') or [],
                'target_degree_cats': data.get('target_degree_cats') or [],
                'target_exam_targets': data.get('target_exam_targets') or [],
                'target_prof_courses': data.get('target_prof_courses') or [],
                'target_years': data.get('target_years') or [],
                'target_degrees': data.get('target_degrees') or [],
                'target_branches': data.get('target_branches') or [],
                'is_active': True,
            }
            args = _build_course_args(course_id, achiever_id, data['title'].strip(), d) + [None, achiever_id, achiever_id]
            call_proc_one('sp_achiever_courses_create', *args)
            db.session.commit()
            return jsonify(response={'message': 'Course created.', 'course_id': course_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/<string:course_id>')
class AchieverCoursePortalDetail(Resource):
    @jwt_required()
    def put(self, course_id):
        """Achiever: update course details."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err

            # ── SP: sp_achiever_courses_get + _update (full replace) ──────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id or c.get('deleted_at'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            d = {}
            for field in ['title', 'description', 'thumbnail_url', 'category']:
                if field in data:
                    d[field] = (data[field] or '').strip() or None
            if 'price' in data: d['price'] = int(data['price'])
            if 'duration_weeks' in data: d['duration_weeks'] = int(data['duration_weeks'])
            if 'level' in data: d['level'] = data['level']
            for field in ['what_you_learn', 'requirements', 'target_categories', 'target_streams',
                          'target_degree_cats', 'target_exam_targets', 'target_prof_courses',
                          'target_years', 'target_degrees', 'target_branches']:
                if field in data:
                    d[field] = data[field] or []

            title = d.pop('title', c.get('title'))
            args = _build_course_args(course_id, achiever_id, title, d, c) + [c.get('deleted_at'), c.get('created_by'), achiever_id]
            call_proc_one('sp_achiever_courses_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Course updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def delete(self, course_id):
        """Achiever: soft-delete (archive) a course."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get + _update (archive) ────────────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id or c.get('deleted_at'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            args = _build_course_args(course_id, achiever_id, c.get('title'), {'status': 'archived'}, c) + [
                datetime_utcnow_iso(), c.get('created_by'), achiever_id
            ]
            call_proc_one('sp_achiever_courses_update', *args)
            db.session.commit()
            return jsonify(response={'message': 'Course archived.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


def datetime_utcnow_iso():
    from datetime import datetime
    return datetime.utcnow()


@ns.route('/portal/<string:course_id>/publish')
class AchieverCoursePublish(Resource):
    @jwt_required()
    def post(self, course_id):
        """Toggle course status between draft and published."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get + _update (toggle status) ──────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id or c.get('deleted_at'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            new_status = 'published' if c.get('status') == 'draft' else 'draft'
            args = _build_course_args(course_id, achiever_id, c.get('title'), {'status': new_status}, c) + [
                c.get('deleted_at'), c.get('created_by'), achiever_id
            ]
            call_proc_one('sp_achiever_courses_update', *args)
            db.session.commit()
            return jsonify(response={'message': f"Course is now {new_status}.", 'status': new_status}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/<string:course_id>/offer')
class AchieverCourseOffer(Resource):
    @jwt_required()
    def put(self, course_id):
        """Achiever: set or clear a promotional offer on their own course."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            d = request.get_json() or {}

            def _i(v):
                try:
                    return int(v) if v not in (None, '', 'null') else None
                except (ValueError, TypeError):
                    return None

            def _d(v):
                s = (v or '').strip() if isinstance(v, str) else v
                return s or None

            # ── SP: sp_course_set_offer (ownership-scoped) ────────────────────
            res = call_proc_one(
                'sp_course_set_offer', course_id, achiever_id,
                _i(d.get('offer_price')), _i(d.get('offer_percent')),
                (d.get('offer_label') or None), _d(d.get('offer_starts_at')), _d(d.get('offer_ends_at')),
            )
            db.session.commit()
            if not res or not res.get('updated'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Offer updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/<string:course_id>/modules')
class AchieverCourseModules(Resource):
    @jwt_required()
    def get(self, course_id):
        """Achiever: list all modules for their course."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get + sp_course_modules_list ──────────
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)
            all_modules = call_proc('sp_course_modules_list', 5000, 0, 1)
            modules = sorted(
                [m for m in all_modules if m.get('course_id') == course_id],
                key=lambda m: m.get('order_index') or 0
            )
            return jsonify(response={'modules': [_module_dict(m) for m in modules]}, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def post(self, course_id):
        """Achiever: add a module to their course."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get, sp_course_modules_list + _create ─
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id or c.get('deleted_at'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            data = request.get_json() or {}
            if not data.get('title', '').strip():
                return jsonify(response={'message': 'Module title is required.'}, status=400, bool=False)

            all_modules = call_proc('sp_course_modules_list', 5000, 0, 0)
            course_modules = [m for m in all_modules if m.get('course_id') == course_id]
            next_order = (max((m.get('order_index') or 0) for m in course_modules) + 1) if course_modules else 0

            live_date = None
            if data.get('live_session_date'):
                try:
                    # parse_local_to_utc, not raw fromisoformat. Naive datetimes
                    # are UTC everywhere in this database and the client sends
                    # local (IST) time, so parsing it as-is stores a live session
                    # 5h30m late — a 6pm class saved as 11:30pm. Exactly the bug
                    # /admin/tasks had with due dates until 2026-09-05.
                    live_date = parse_local_to_utc(data['live_session_date'])
                except Exception:
                    pass

            module_id = str(uuid.uuid4())
            m = call_proc_one(
                'sp_course_modules_create',
                module_id, course_id, data['title'].strip(), data.get('description', '').strip() or None,
                data.get('order_index', next_order), data.get('content_type', 'video'),
                data.get('video_url') or None, data.get('content_text') or None, live_date,
                int(data.get('live_session_duration_minutes', 60)), 1 if data.get('is_free_preview', False) else 0, 1,
            )
            db.session.commit()
            return jsonify(response={'message': 'Module added.', 'module': _module_dict(m)}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/<string:course_id>/modules/<string:module_id>')
class AchieverCourseModuleDetail(Resource):
    @jwt_required()
    def put(self, course_id, module_id):
        """Achiever: update a module."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get, sp_course_modules_get + _update ──
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)
            m = call_proc_one('sp_course_modules_get', module_id)
            if not m or m.get('course_id') != course_id:
                return jsonify(response={'message': 'Module not found.'}, status=404, bool=False)

            data = request.get_json() or {}

            def val(key, current):
                if key in data:
                    v = data[key]
                    return (v or '').strip() or None if isinstance(v, str) else v
                return current

            live_session_date = m.get('live_session_date')
            if data.get('live_session_date'):
                try:
                    # Same conversion as the create path above — the two must
                    # agree, or editing a module silently shifts its session.
                    live_session_date = parse_local_to_utc(data['live_session_date'])
                except Exception:
                    pass

            updated = call_proc_one(
                'sp_course_modules_update',
                module_id, course_id,
                val('title', m.get('title')), val('description', m.get('description')),
                int(data['order_index']) if 'order_index' in data else m.get('order_index'),
                data.get('content_type', m.get('content_type')),
                val('video_url', m.get('video_url')), val('content_text', m.get('content_text')),
                live_session_date,
                int(data['live_session_duration_minutes']) if 'live_session_duration_minutes' in data else m.get('live_session_duration_minutes'),
                (1 if data['is_free_preview'] else 0) if 'is_free_preview' in data else m.get('is_free_preview'),
                m.get('is_active'),
            )
            db.session.commit()
            return jsonify(response={'message': 'Module updated.', 'module': _module_dict(updated)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def delete(self, course_id, module_id):
        """Achiever: remove a module."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get, sp_course_modules_get + _update (soft-hide) ─
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)
            m = call_proc_one('sp_course_modules_get', module_id)
            if not m or m.get('course_id') != course_id:
                return jsonify(response={'message': 'Module not found.'}, status=404, bool=False)

            call_proc_one(
                'sp_course_modules_update',
                module_id, course_id, m.get('title'), m.get('description'), m.get('order_index'),
                m.get('content_type'), m.get('video_url'), m.get('content_text'), m.get('live_session_date'),
                m.get('live_session_duration_minutes'), m.get('is_free_preview'), 0,
            )
            db.session.commit()
            return jsonify(response={'message': 'Module removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


# ═══════════════════════════════════════════════════════════════════════════
# STUDENT PROGRESS & CERTIFICATE
# ═══════════════════════════════════════════════════════════════════════════

def _progress_summary(user_id, course_id):
    # ── SP: sp_course_modules_list + sp_course_progress_list ──────────────────
    all_modules_rows = call_proc('sp_course_modules_list', 5000, 0, 1)
    all_modules = [m for m in all_modules_rows if m.get('course_id') == course_id]
    all_progress = call_proc('sp_course_progress_list', 200000, 0)
    completed = [p for p in all_progress if p.get('user_id') == user_id and p.get('course_id') == course_id]
    completed_ids = {p.get('module_id') for p in completed}
    total  = len(all_modules)
    done   = sum(1 for m in all_modules if m.get('id') in completed_ids)
    pct    = int(done / total * 100) if total else 0
    return total, done, pct, completed_ids


@ns.route('/<string:course_id>/progress')
class CourseProgressResource(Resource):
    @jwt_required()
    def get(self, course_id):
        """Get module completion progress for an enrolled student."""
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_course_enrollments_list ─────────────────────────────────
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enr = next((e for e in all_enrollments if e.get('user_id') == user_id and e.get('course_id') == course_id), None)
            if not enr or enr.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'Not enrolled.'}, status=403, bool=False)
            total, done, pct, completed_ids = _progress_summary(user_id, course_id)
            return jsonify(response={
                'total_modules':     total,
                'completed_modules': done,
                'percent':           pct,
                'completed_ids':     list(completed_ids),
            }, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def post(self, course_id):
        """Mark a module as complete."""
        try:
            user_id   = get_jwt_identity()
            data      = request.get_json() or {}
            module_id = data.get('module_id')
            if not module_id:
                return jsonify(response={'message': 'module_id required.'}, status=400, bool=False)

            # ── SP: sp_course_enrollments_list, sp_course_modules_get ─────────
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enr = next((e for e in all_enrollments if e.get('user_id') == user_id and e.get('course_id') == course_id), None)
            if not enr or enr.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'Not enrolled.'}, status=403, bool=False)

            m = call_proc_one('sp_course_modules_get', module_id)
            if not m or m.get('course_id') != course_id or not m.get('is_active'):
                return jsonify(response={'message': 'Module not found.'}, status=404, bool=False)

            # ── SP: sp_student_course_complete_module — idempotent insert
            # (ON DUPLICATE KEY UPDATE completed_at = completed_at) plus the
            # completed/total recount, in one round trip instead of two.
            # Enrollment + active-module checks above aren't in the SP, so they
            # stay here as real business rules it doesn't enforce. ────────────
            call_proc_one('sp_student_course_complete_module', user_id, course_id, module_id)
            db.session.commit()

            # Career streak: a finished lesson counts (§3), if switched on.
            from portal.helpers import engagement
            engagement.track(user_id, 'lesson_finished')
            db.session.commit()

            total, done, pct, completed_ids = _progress_summary(user_id, course_id)
            return jsonify(response={
                'message':           'Module marked complete.',
                'total_modules':     total,
                'completed_modules': done,
                'percent':           pct,
                'completed_ids':     list(completed_ids),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @jwt_required()
    def delete(self, course_id):
        """Un-mark a module (undo an accidental completion tick)."""
        try:
            user_id   = get_jwt_identity()
            data      = request.get_json(silent=True) or {}
            module_id = data.get('module_id') or request.args.get('module_id')
            if not module_id:
                return jsonify(response={'message': 'module_id required.'}, status=400, bool=False)

            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enr = next((e for e in all_enrollments if e.get('user_id') == user_id and e.get('course_id') == course_id), None)
            if not enr or enr.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'Not enrolled.'}, status=403, bool=False)

            # ── SP: sp_student_course_uncomplete_module — deletes only this
            # student's own progress row for this course/module. ───────────────
            call_proc_one('sp_student_course_uncomplete_module', user_id, course_id, module_id)
            db.session.commit()

            total, done, pct, completed_ids = _progress_summary(user_id, course_id)
            return jsonify(response={
                'message':           'Module unmarked.',
                'total_modules':     total,
                'completed_modules': done,
                'percent':           pct,
                'completed_ids':     list(completed_ids),
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/<string:course_id>/certificate')
class CourseCertificateResource(Resource):
    @jwt_required()
    def get(self, course_id):
        """Return certificate data when student has completed all modules."""
        try:
            from datetime import datetime as dt
            user_id = get_jwt_identity()

            # ── SP: sp_course_enrollments_list, sp_achiever_courses_get,
            # sp_users_get, sp_achievers_get, sp_course_progress_list ─────────
            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enr = next((e for e in all_enrollments if e.get('user_id') == user_id and e.get('course_id') == course_id), None)
            if not enr or enr.get('payment_status') not in ('paid', 'free'):
                return jsonify(response={'message': 'Not enrolled.'}, status=403, bool=False)

            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or not c.get('is_active'):
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            total, done, pct, _ = _progress_summary(user_id, course_id)
            if total == 0:
                return jsonify(response={'message': 'Course has no modules.'}, status=400, bool=False)
            # Certificate is earned by completing every published module. The marketing
            # duration_weeks must NOT gate this — coupling module count to week count
            # dead-ended students who finished a course with fewer modules than weeks.
            if done < total:
                return jsonify(response={
                    'message': f'Complete all modules first. ({done}/{total} done)',
                    'percent': pct,
                }, status=400, bool=False)

            user    = call_proc_one('sp_users_get', user_id)
            achiever = call_proc_one('sp_achievers_get', c.get('achiever_id'))
            all_progress = call_proc('sp_course_progress_list', 200000, 0)
            my_progress = sorted(
                [p for p in all_progress if p.get('user_id') == user_id and p.get('course_id') == course_id],
                key=lambda p: p.get('completed_at') or dt.min, reverse=True
            )
            completion_date = my_progress[0].get('completed_at') if my_progress else dt.utcnow()

            return jsonify(response={
                'certificate_number':   f"SKOVO-{course_id[:8].upper()}-{user_id[:8].upper()}",
                'student_name':         user.get('full_name') if user else 'Student',
                'course_title':         c.get('title'),
                'course_level':         c.get('level'),
                'duration_weeks':       c.get('duration_weeks'),
                'achiever_name':        achiever.get('full_name') if achiever else 'SKOVO Achiever',
                'achiever_designation': achiever.get('designation') or '' if achiever else '',
                'achiever_company':     achiever.get('company') or '' if achiever else '',
                'completion_date':      completion_date.strftime('%B %d, %Y'),
            }, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/portal/<string:course_id>/enrollments')
class AchieverCourseEnrollments(Resource):
    @jwt_required()
    def get(self, course_id):
        """Achiever: see who enrolled in their course."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_courses_get, sp_course_enrollments_list, sp_users_list ─
            c = call_proc_one('sp_achiever_courses_get', course_id)
            if not c or c.get('achiever_id') != achiever_id:
                return jsonify(response={'message': 'Course not found.'}, status=404, bool=False)

            all_enrollments = call_proc('sp_course_enrollments_list', 200000, 0)
            enrollments = [
                e for e in all_enrollments
                if e.get('course_id') == course_id and e.get('payment_status') in ('paid', 'free')
            ]
            enrollments.sort(key=lambda e: e.get('enrolled_at') or e.get('created_at'), reverse=True)

            all_users = call_proc('sp_users_list', 50000, 0)
            users_by_id = {u['id']: u for u in all_users}

            result = []
            total_earning = 0.0
            for enr in enrollments:
                user = users_by_id.get(enr.get('user_id'))
                total_earning += float(enr.get('achiever_earning') or 0)
                enrolled_at = enr.get('enrolled_at')
                result.append({
                    'enrollment_id':    enr.get('id'),
                    'user_id':          enr.get('user_id'),
                    'full_name':        user.get('full_name') if user else 'Unknown',
                    'email':            user.get('email') if user else None,
                    'payment_status':   enr.get('payment_status'),
                    'amount_paid':      float(enr.get('amount_paid') or 0),
                    'achiever_earning': float(enr.get('achiever_earning') or 0),
                    'enrolled_at':      serialize_datetime(enrolled_at) if enrolled_at else None,
                })
            return jsonify(response={
                'enrollments':    result,
                'total':          len(result),
                'total_earning':  total_earning,
            }, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


# Same window/pager parsing as the other two Bookings tabs — imported so the
# three cannot drift apart in how they read `from`/`to`/`page`.
from portal.routes.Achiever.achiever import _range_args, _page_args


@ns.route('/portal/purchases')
class AchieverCoursePurchases(Resource):
    @jwt_required()
    def get(self):
        """Achiever: ALL course purchases across all their courses — shown as
        the 'Course Purchases' tab in the achiever Bookings page."""
        try:
            achiever_id, err = _require_mentor()
            if err:
                return err
            # ── SP: sp_achiever_purchases_page / _stats ──────────────────────
            # Previously sp_course_enrollments_list(200000) + sp_users_list(50000)
            # + sp_achiever_courses_list(5000), joined and sliced in Python. Now
            # one paged query that returns exactly the rows the screen draws.
            d_from, d_to = _range_args()
            search = (request.args.get('search') or '').strip()
            limit, offset, page, per_page = _page_args()

            rows = call_proc('sp_achiever_purchases_page', achiever_id, d_from, d_to,
                             search, limit, offset)

            result = [{
                'enrollment_id':    e.get('enrollment_id'),
                'course_id':        e.get('course_id'),
                'course_title':     e.get('course_title'),
                'student_name':     e.get('student_name') or 'Unknown',
                'student_email':    e.get('student_email'),
                'payment_status':   e.get('payment_status'),
                'amount_paid':      float(e.get('amount_paid') or 0),
                'achiever_earning': float(e.get('achiever_earning') or 0),
                'enrolled_at':      serialize_datetime(e.get('enrolled_at')),
            } for e in rows]

            matched = int(rows[0]['total_rows']) if rows else 0
            stats = call_proc_one('sp_achiever_purchases_stats', achiever_id, d_from, d_to) or {}

            return jsonify(response={
                'purchases':     result,
                'total':         matched,
                'page': page, 'per_page': per_page,
                'pages': max(1, -(-matched // per_page)),
                'window_total':  int(stats.get('total') or 0),
                'total_earning': float(stats.get('total_earning') or 0),
            }, status=200, bool=True)
        except Exception as e:
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
