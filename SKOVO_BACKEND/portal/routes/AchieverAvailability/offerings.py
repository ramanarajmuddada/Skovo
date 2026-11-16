"""
1-on-1s, the Calendly way.

The achiever says WHAT he offers (offerings: "Resume review, 30 min, ₹299")
and WHEN he is free (weekly hours in achiever_availability + one-off date
changes). Students pick an offering, SKOVO shows the start times that fit his
hours minus cohorts and other bookings, and the booking creates the slot row
then — so the rest of the 1-on-1 flow (payment hold, class rules, refunds)
keeps working on achiever_slots / achiever_sessions exactly as before.

Example: hours Mon 6–9 PM, Priya books Mock interview (60 min) at 6:00 →
6:00–7:00 is busy for every offering and every cohort; a 30-min Resume review
now shows 7:00, 7:30, 8:00, 8:30.
"""
import uuid
import datetime
from decimal import Decimal

from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
from portal.helpers.sp import call_proc_one
from . import ns, logger
from .achiever_availability import (
    _price_offer, _offer_end_error, slot_final_price, _require_mentor, _require_can_publish, _parse_time,
)

IST_MIN = 330
STEP_MIN = 30            # start times every 30 minutes
DAYS_AHEAD = 28          # students see the next 4 weeks
LENGTHS = tuple(range(15, 181, 15))   # 15 min to 3 hrs, every 15 min
DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


# ── small helpers ─────────────────────────────────────────────────────────────
def _mins(v):
    """MySQL TIME (timedelta / time / 'HH:MM[:SS]') -> minutes after midnight."""
    if v is None:
        return None
    if isinstance(v, datetime.timedelta):
        return int(v.total_seconds() // 60)
    if isinstance(v, datetime.time):
        return v.hour * 60 + v.minute
    t = _parse_time(v)
    return t.hour * 60 + t.minute if t else None


def _hhmm(m):
    return f"{m // 60:02d}:{m % 60:02d}"


def _ist_today():
    return (datetime.datetime.utcnow() + datetime.timedelta(minutes=IST_MIN)).date()


def _date(v):
    if not v:
        return None
    if isinstance(v, datetime.date):
        return v
    try:
        return datetime.date.fromisoformat(str(v)[:10])
    except ValueError:
        return None


def _to_utc(d, m):
    return datetime.datetime.combine(d, datetime.time()) + datetime.timedelta(minutes=m - IST_MIN)


def _cutoff_min():
    try:
        from portal.helpers import class_rules as CR
        v = CR.rules().get('booking_cutoff_min')
        return int(v) if v is not None else 10
    except Exception:
        return 10


def _days_set(o):
    raw = (o.get('days') or '').strip()
    return {int(x) for x in raw.split(',') if x.strip().isdigit()} if raw else set(range(7))


def _offering_dict(o):
    price, final = slot_final_price(o)
    days = sorted(_days_set(o))
    return {
        'id': o['id'], 'title': o['title'], 'about': o.get('about'),
        'duration_min': int(o['duration_min']),
        'price': price, 'final_price': final,
        'offer_type': o.get('offer_type'),
        'offer_value': float(o['offer_value']) if o.get('offer_value') is not None else None,
        'offer_ends_at': serialize_datetime(o['offer_ends_at']) if o.get('offer_ends_at') else None,
        'meeting_link': o.get('meeting_link'),
        'days': days, 'days_label': 'Every day' if len(days) == 7 else ', '.join(DAY_SHORT[d] for d in days),
        'available_from': o['available_from'].isoformat() if o.get('available_from') else None,
        'available_to': o['available_to'].isoformat() if o.get('available_to') else None,
        'status': o.get('status'),
    }


# ── when is he free ───────────────────────────────────────────────────────────
def _merge(ranges):
    out = []
    for a, b in sorted(r for r in ranges if r[0] is not None and r[1] is not None and r[1] > r[0]):
        if out and a <= out[-1][1]:
            out[-1] = (out[-1][0], max(out[-1][1], b))
        else:
            out.append((a, b))
    return out


def hours_for(achiever_id, dates):
    """{date: [(start_min, end_min)]} from weekly hours and date changes."""
    if not dates:
        return {}
    weekly = db.session.execute(text(
        "SELECT day_of_week, start_time, end_time FROM achiever_availability"
        " WHERE mentor_id = :m AND is_active = 1"), {'m': achiever_id}).fetchall()
    over = db.session.execute(text(
        "SELECT on_date, kind, start_time, end_time FROM achiever_date_overrides"
        " WHERE mentor_id = :m AND on_date BETWEEN :f AND :t"),
        {'m': achiever_id, 'f': min(dates), 't': max(dates)}).fetchall()
    out = {}
    for d in dates:
        rows = [o for o in over if o[0] == d]
        if any(o[1] == 'off' and o[2] is None for o in rows):     # whole day off
            out[d] = []
            continue
        ranges = [(_mins(w[1]), _mins(w[2])) for w in weekly if int(w[0]) == d.weekday()]
        ranges += [(_mins(o[2]), _mins(o[3])) for o in rows if o[1] == 'extra']
        ranges = _merge(ranges)
        for o in rows:                                             # part of a day off
            if o[1] == 'off' and o[2] is not None:
                cs, ce = _mins(o[2]), _mins(o[3])
                cut = []
                for a, b in ranges:
                    if ce <= a or cs >= b:
                        cut.append((a, b))
                    else:
                        if a < cs:
                            cut.append((a, cs))
                        if ce < b:
                            cut.append((ce, b))
                ranges = cut
        out[d] = ranges
    return out


def busy_for(achiever_id, start_utc, end_utc, exclude_session=None):
    """UTC (start, end) the achiever is taken: live cohorts and 1-on-1s that are
    booked or being paid for. An ended or cancelled cohort frees its time."""
    rows = db.session.execute(text(
        "SELECT session_date, DATE_ADD(session_date, INTERVAL IFNULL(duration_minutes, 90) MINUTE)"
        "  FROM cohorts WHERE achiever_id = :a AND deleted_at IS NULL"
        "   AND status NOT IN ('cancelled', 'completed')"
        "   AND session_date < :e AND DATE_ADD(session_date, INTERVAL IFNULL(duration_minutes, 90) MINUTE) > :s"),
        {'a': achiever_id, 's': start_utc, 'e': end_utc}).fetchall()
    rows += db.session.execute(text(
        "SELECT s.start_utc, s.end_utc FROM achiever_slots s"
        "  LEFT JOIN achiever_sessions x ON x.id = s.session_id"
        " WHERE s.mentor_id = :a AND s.start_utc < :e AND s.end_utc > :s"
        "   AND (s.status IN ('blocked', 'booked')"
        "        OR (s.session_id IS NOT NULL AND x.status NOT IN ('cancelled', 'declined', 'rejected', 'expired')))"
        "   AND (:x IS NULL OR s.session_id IS NULL OR s.session_id <> :x)"),
        {'a': achiever_id, 's': start_utc, 'e': end_utc, 'x': exclude_session}).fetchall()
    return [(r[0], r[1]) for r in rows if r[0] and r[1]]


def free_times(achiever_id, length, offering=None, dates=None, exclude_session=None):
    """[{'date': 'YYYY-MM-DD', 'times': ['18:00', ...]}] the student can book."""
    today = _ist_today()
    dates = dates or [today + datetime.timedelta(days=i) for i in range(DAYS_AHEAD)]
    if offering:
        allowed = _days_set(offering)
        f, t = offering.get('available_from'), offering.get('available_to')
        dates = [d for d in dates if d.weekday() in allowed and (not f or d >= f) and (not t or d <= t)]
    dates = [d for d in dates if d >= today]
    if not dates:
        return []
    hours = hours_for(achiever_id, dates)
    busy = busy_for(achiever_id, _to_utc(min(dates), 0), _to_utc(max(dates), 24 * 60), exclude_session)
    earliest = datetime.datetime.utcnow() + datetime.timedelta(minutes=_cutoff_min())
    out = []
    for d in sorted(dates):
        times = []
        for a, b in hours.get(d, []):
            m = a
            while m + length <= b:
                s = _to_utc(d, m)
                e = s + datetime.timedelta(minutes=length)
                if s >= earliest and not any(bs < e and be > s for bs, be in busy):
                    times.append(_hhmm(m))
                m += STEP_MIN
        if times:
            out.append({'date': d.isoformat(), 'times': sorted(set(times))})
    return out


def _offering(achiever_id, offering_id, active_only=True):
    o = db.session.execute(text(
        "SELECT * FROM achiever_offerings WHERE id = :i AND mentor_id = :m AND status <> 'deleted'"),
        {'i': offering_id, 'm': achiever_id}).mappings().first()
    if not o or (active_only and o['status'] != 'active'):
        return None
    return dict(o)


def create_booking_slot(achiever_id, date_str, start_str, *, offering_id=None, copy_from=None,
                        exclude_session=None):
    """Make the slot row for a booking at a time the student picked.

    Returns (slot_id, error). Runs in the caller's transaction and does not
    commit: the achiever row is locked first, so two students picking the same
    time one after the other cannot both get it (the second sees the first's
    held slot as busy once the first commits)."""
    d = _date(date_str)
    t = _parse_time(start_str)
    if not d or not t:
        return None, 'Pick a date and a start time.'
    if copy_from:
        src = dict(copy_from)
        length = (_mins(src.get('end_time')) or 0) - (_mins(src.get('start_time')) or 0)
        offering = None
    else:
        src = _offering(achiever_id, offering_id)
        if not src:
            return None, 'This 1-on-1 is not available any more.'
        length = int(src['duration_min'])
        offering = src
    if length <= 0:
        return None, 'This 1-on-1 has no length.'
    db.session.execute(text("SELECT id FROM achievers WHERE id = :a FOR UPDATE"), {'a': achiever_id})
    start_m = t.hour * 60 + t.minute
    ok = any(start_m == _mins(_parse_time(x)) for day in free_times(
        achiever_id, length, offering=offering, dates=[d], exclude_session=exclude_session)
        for x in day['times'])
    if not ok:
        return None, 'That time was just taken or is no longer free. Please pick another.'
    s_utc = _to_utc(d, start_m)
    slot_id = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO achiever_slots (id, mentor_id, slot_date, start_time, end_time, status,"
        "  start_utc, end_utc, times_are_utc, offering_id, title, about, price, offer_type, offer_value,"
        "  offer_ends_at, meeting_link)"
        " VALUES (:id, :m, :d, :st, :et, 'available', :su, :eu, 1, :o, :ti, :ab, :p, :ot, :ov, :oe, :l)"),
        {'id': slot_id, 'm': achiever_id, 'd': d, 'st': _hhmm(start_m), 'et': _hhmm(start_m + length),
         'su': s_utc, 'eu': s_utc + datetime.timedelta(minutes=length),
         'o': src.get('offering_id') if copy_from else src['id'], 'ti': src.get('title'), 'ab': src.get('about'),
         'p': src.get('price'), 'ot': src.get('offer_type'), 'ov': src.get('offer_value'),
         'oe': src.get('offer_ends_at'), 'l': src.get('meeting_link')})
    return slot_id, None


# ── validation ────────────────────────────────────────────────────────────────
def _offering_fields(data, can_charge):
    title = (data.get('title') or '').strip()
    if len(title) < 3 or len(title) > 80:
        return None, 'Title must be 3 to 80 characters.'
    about = (data.get('about') or '').strip() or None
    if about and len(about) > 500:
        return None, 'What we will cover must be under 500 characters.'
    try:
        length = int(data.get('duration_min'))
    except (TypeError, ValueError):
        return None, 'Pick how long it is.'
    if length not in LENGTHS:
        return None, 'Length must be 15 min to 3 hours.'
    price, okind, oval, oends, err = _price_offer(data, can_charge)
    err = err or _offer_end_error(oends)
    if err:
        return None, err
    link = (data.get('meeting_link') or '').strip() or None
    if link and not link.lower().startswith(('http://', 'https://')):
        return None, 'Meeting link must start with https://'
    days = sorted({int(x) for x in (data.get('days') or []) if str(x).isdigit() and 0 <= int(x) <= 6})
    if data.get('days') is not None and not days:
        return None, 'Pick at least one day.'
    f, t = _date(data.get('available_from')), _date(data.get('available_to'))
    if t and t < _ist_today():
        return None, 'Bookable till cannot be in the past.'
    if f and t and t < f:
        return None, 'Bookable till must be after bookable from.'
    return {'title': title, 'about': about, 'duration_min': length, 'price': price, 'offer_type': okind,
            'offer_value': oval, 'offer_ends_at': oends, 'meeting_link': link,
            'days': ','.join(map(str, days)) if days and len(days) < 7 else None,
            'available_from': f, 'available_to': t}, None


def _can_charge(achiever_id):
    caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
    return bool(caps.get('can_charge'))


# ── achiever: My 1-on-1s ──────────────────────────────────────────────────────
@ns.route('/my-offerings')
class MyOfferings(Resource):
    @jwt_required()
    def get(self):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            me = get_jwt_identity()
            rows = db.session.execute(text(
                "SELECT o.*, (SELECT COUNT(*) FROM achiever_slots s JOIN achiever_sessions x ON x.id = s.session_id"
                "              WHERE s.offering_id = o.id AND s.end_utc > UTC_TIMESTAMP()"
                "                AND x.status NOT IN ('cancelled', 'declined', 'rejected', 'expired')) AS upcoming"
                "  FROM achiever_offerings o WHERE o.mentor_id = :m AND o.status <> 'deleted'"
                " ORDER BY o.status = 'active' DESC, o.created_at"), {'m': me}).mappings().all()
            out = []
            for r in rows:
                d = _offering_dict(r)
                d['upcoming'] = int(r['upcoming'] or 0)
                d['expired'] = bool(r.get('available_to') and r['available_to'] < _ist_today())
                out.append(d)
            return jsonify(response={'offerings': out, 'can_charge': _can_charge(me), 'lengths': LENGTHS},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            me = get_jwt_identity()
            from portal.helpers import class_rules as CR
            if CR.paused(me):   # too many strikes: no new 1-on-1s until an admin reviews
                return jsonify(response={'message': 'New classes are paused until an admin reviews your account.'},
                               status=403, bool=False)
            f, err = _offering_fields(request.get_json() or {}, _can_charge(me))
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            oid = str(uuid.uuid4())
            db.session.execute(text(
                "INSERT INTO achiever_offerings (id, mentor_id, title, about, duration_min, price, offer_type,"
                "  offer_value, offer_ends_at, meeting_link, days, available_from, available_to, status)"
                " VALUES (:id, :m, :title, :about, :duration_min, :price, :offer_type, :offer_value,"
                "  :offer_ends_at, :meeting_link, :days, :available_from, :available_to, 'active')"),
                {**f, 'id': oid, 'm': me})
            db.session.commit()
            return jsonify(response={'message': '1-on-1 added.', 'id': oid}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-offerings/<string:offering_id>')
class MyOffering(Resource):
    @jwt_required()
    def put(self, offering_id):
        """Edit. Bookings already made keep the title, time and price they had."""
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            me = get_jwt_identity()
            if not _offering(me, offering_id, active_only=False):
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            f, err = _offering_fields(request.get_json() or {}, _can_charge(me))
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            db.session.execute(text(
                "UPDATE achiever_offerings SET title = :title, about = :about, duration_min = :duration_min,"
                "  price = :price, offer_type = :offer_type, offer_value = :offer_value,"
                "  offer_ends_at = :offer_ends_at, meeting_link = :meeting_link, days = :days,"
                "  available_from = :available_from, available_to = :available_to, updated_at = UTC_TIMESTAMP()"
                " WHERE id = :id AND mentor_id = :m"), {**f, 'id': offering_id, 'm': me})
            db.session.commit()
            return jsonify(response={'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, offering_id):
        """Remove from the list. Upcoming bookings of it still happen."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            me = get_jwt_identity()
            n = db.session.execute(text(
                "UPDATE achiever_offerings SET status = 'deleted', updated_at = UTC_TIMESTAMP()"
                " WHERE id = :id AND mentor_id = :m AND status <> 'deleted'"), {'id': offering_id, 'm': me}).rowcount
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-offerings/<string:offering_id>/status')
class MyOfferingStatus(Resource):
    @jwt_required()
    def put(self, offering_id):
        """Pause (hidden from students) or resume."""
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            me = get_jwt_identity()
            status = (request.get_json() or {}).get('status')
            if status not in ('active', 'paused'):
                return jsonify(response={'message': 'Status must be active or paused.'}, status=400, bool=False)
            n = db.session.execute(text(
                "UPDATE achiever_offerings SET status = :s, updated_at = UTC_TIMESTAMP()"
                " WHERE id = :id AND mentor_id = :m AND status <> 'deleted'"),
                {'s': status, 'id': offering_id, 'm': me}).rowcount
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Paused.' if status == 'paused' else 'Live again.'},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── achiever: date changes (day off / extra hours) ────────────────────────────
@ns.route('/my-dates')
class MyDates(Resource):
    @jwt_required()
    def get(self):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            rows = db.session.execute(text(
                "SELECT id, on_date, kind, start_time, end_time FROM achiever_date_overrides"
                " WHERE mentor_id = :m AND on_date >= :t ORDER BY on_date, start_time"),
                {'m': get_jwt_identity(), 't': _ist_today()}).fetchall()
            return jsonify(response={'dates': [{
                'id': r[0], 'date': r[1].isoformat(), 'kind': r[2],
                'start_time': _hhmm(_mins(r[3])) if r[3] is not None else None,
                'end_time': _hhmm(_mins(r[4])) if r[4] is not None else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """{date, kind: 'off'} or {date, kind: 'extra', start_time, end_time}."""
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            me = get_jwt_identity()
            data = request.get_json() or {}
            d = _date(data.get('date'))
            kind = data.get('kind')
            if not d or d < _ist_today():
                return jsonify(response={'message': 'Pick today or a later date.'}, status=400, bool=False)
            if kind not in ('off', 'extra'):
                return jsonify(response={'message': 'Pick Not free or Extra hours.'}, status=400, bool=False)
            st = et = None
            part = kind == 'off' and data.get('start_time') and data.get('end_time')
            if kind == 'extra' or part:
                st, et = _mins(data.get('start_time')), _mins(data.get('end_time'))
                if st is None or et is None or et - st < 15:
                    return jsonify(response={'message': 'The time must be at least 15 minutes, end after start.'},
                                   status=400, bool=False)
                if d == _ist_today():
                    now_m = (datetime.datetime.utcnow() + datetime.timedelta(minutes=IST_MIN))
                    if et <= now_m.hour * 60 + now_m.minute:
                        return jsonify(response={'message': 'Those hours are already over.'}, status=400, bool=False)
            elif db.session.execute(text(
                    "SELECT COUNT(*) FROM achiever_date_overrides WHERE mentor_id = :m AND on_date = :d AND kind = 'off'"
                    " AND start_time IS NULL"),
                    {'m': me, 'd': d}).scalar():
                return jsonify(response={'message': 'That day is already marked not free.'}, status=409, bool=False)
            db.session.execute(text(
                "INSERT INTO achiever_date_overrides (id, mentor_id, on_date, kind, start_time, end_time)"
                " VALUES (:i, :m, :d, :k, :s, :e)"),
                {'i': str(uuid.uuid4()), 'm': me, 'd': d, 'k': kind,
                 's': _hhmm(st) if st is not None else None, 'e': _hhmm(et) if et is not None else None})
            db.session.commit()
            # Bookings already inside the blocked time are NOT cancelled: say so.
            booked = 0
            if kind == 'off':
                cond = ""
                params = {'m': me, 'd': d}
                if st is not None:
                    cond = " AND s.start_time < :e AND s.end_time > :s"
                    params.update({'s': _hhmm(st), 'e': _hhmm(et)})
                booked = db.session.execute(text(
                    "SELECT COUNT(*) FROM achiever_slots s JOIN achiever_sessions x ON x.id = s.session_id"
                    " WHERE s.mentor_id = :m AND s.slot_date = :d"
                    "   AND x.status NOT IN ('cancelled', 'declined', 'rejected', 'expired')" + cond), params).scalar()
            msg = 'Saved.' + (f' You still have {booked} booked 1-on-1 session(s) in that time. They are not cancelled;'
                              ' cancel them in Bookings if you cannot attend.' if booked else '')
            return jsonify(response={'message': msg}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-dates/<string:override_id>')
class MyDate(Resource):
    @jwt_required()
    def delete(self, override_id):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            n = db.session.execute(text(
                "DELETE FROM achiever_date_overrides WHERE id = :i AND mentor_id = :m"),
                {'i': override_id, 'm': get_jwt_identity()}).rowcount
            db.session.commit()
            if not n:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            return jsonify(response={'message': 'Removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── students (no login needed to look) ───────────────────────────────────────
def _public_offerings(achiever_id):
    rows = db.session.execute(text(
        "SELECT * FROM achiever_offerings WHERE mentor_id = :m AND status = 'active'"
        "   AND (available_to IS NULL OR available_to >= :t) ORDER BY created_at"),
        {'m': achiever_id, 't': _ist_today()}).mappings().all()
    out = []
    for r in rows:
        d = _offering_dict(r)
        d.pop('meeting_link', None)   # the link is shown only after Start
        times = free_times(achiever_id, int(r['duration_min']), offering=dict(r))
        d['next_free'] = {'date': times[0]['date'], 'time': times[0]['times'][0]} if times else None
        d['free_days'] = len(times)
        out.append(d)
    return out


@ns.route('/<string:achiever_id>/offerings')
class PublicOfferings(Resource):
    def get(self, achiever_id):
        try:
            return jsonify(response={'offerings': _public_offerings(achiever_id)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:achiever_id>/times')
class PublicTimes(Resource):
    def get(self, achiever_id):
        """Free start times for one 1-on-1 (?offering_id=), or for a booked
        session being moved (?session_id=, same length, its own time not busy)."""
        try:
            oid = request.args.get('offering_id')
            sid = request.args.get('session_id')
            if sid:
                src = db.session.execute(text(
                    "SELECT start_time, end_time, offering_id FROM achiever_slots WHERE session_id = :s"),
                    {'s': sid}).mappings().first()
                if not src:
                    return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
                length = _mins(src['end_time']) - _mins(src['start_time'])
                return jsonify(response={'dates': free_times(achiever_id, length, exclude_session=sid),
                                         'duration_min': length}, status=200, bool=True)
            o = _offering(achiever_id, oid)
            if not o:
                return jsonify(response={'message': 'This 1-on-1 is not available.'}, status=404, bool=False)
            return jsonify(response={'dates': free_times(achiever_id, int(o['duration_min']), offering=o),
                                     'duration_min': int(o['duration_min'])}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-times')
class MyTimes(Resource):
    @jwt_required()
    def get(self):
        """Achiever proposing a new time for a booking: free times of that length."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            me = get_jwt_identity()
            sid = request.args.get('session_id')
            src = db.session.execute(text(
                "SELECT start_time, end_time FROM achiever_slots WHERE session_id = :s AND mentor_id = :m"),
                {'s': sid, 'm': me}).mappings().first()
            if not src:
                return jsonify(response={'message': 'Session not found.'}, status=404, bool=False)
            length = _mins(src['end_time']) - _mins(src['start_time'])
            return jsonify(response={'dates': free_times(me, length, exclude_session=sid), 'duration_min': length},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ── students: every live 1-on-1, across achievers (the "1-on-1 sessions" screen) ──
@ns.route('/browse')
class BrowseOfferings(Resource):
    def get(self):
        """Search / domain / length / price / offer / when (today|week) / sort
        (soonest|price_low|price_high|rating), 20 a page. No login needed."""
        try:
            a = request.args
            search = (a.get('search') or '').strip()[:80]
            domain = (a.get('domain') or '').strip()[:120]
            when = (a.get('when') or '').strip()
            sort = (a.get('sort') or 'soonest').strip()
            try:
                length = int(a.get('length') or 0)
            except ValueError:
                length = 0
            try:
                min_p = float(a.get('min_price')) if a.get('min_price') not in (None, '') else None
                max_p = float(a.get('max_price')) if a.get('max_price') not in (None, '') else None
            except ValueError:
                min_p = max_p = None
            try:
                page = max(1, int(a.get('page') or 1))
                per = min(50, max(1, int(a.get('per_page') or 20)))
            except ValueError:
                page, per = 1, 20

            where = ["o.status = 'active'", "(o.available_to IS NULL OR o.available_to >= :today)",
                     "IFNULL(m.status, 'active') = 'active'", "IFNULL(m.state, 'active') IN ('active', 'probation')"]
            params = {'today': _ist_today()}
            if search:
                where.append("(o.title LIKE :q OR o.about LIKE :q OR m.full_name LIKE :q OR m.company LIKE :q OR m.designation LIKE :q)")
                params['q'] = f"%{search}%"
            if domain:
                where.append("JSON_CONTAINS(m.domains, JSON_QUOTE(:d))")
                params['d'] = domain
            if length:
                where.append("o.duration_min = :len")
                params['len'] = length
            if a.get('offer') in ('1', 'true'):
                where.append("o.offer_type IS NOT NULL AND (o.offer_ends_at IS NULL OR o.offer_ends_at > UTC_TIMESTAMP())")
            rows = db.session.execute(text(
                "SELECT o.*, m.full_name, m.designation, m.company, m.profile_image_url, m.state AS m_state,"
                "  (SELECT ROUND(AVG(r.rating), 1) FROM achiever_reviews r WHERE r.achiever_id = m.id AND r.is_active = 1) AS rating,"
                "  (SELECT COUNT(*) FROM achiever_reviews r WHERE r.achiever_id = m.id AND r.is_active = 1) AS reviews"
                "  FROM achiever_offerings o JOIN achievers m ON m.id = o.mentor_id"
                f" WHERE {' AND '.join(where)} ORDER BY o.created_at DESC LIMIT 300"), params).mappings().all()

            today = _ist_today()
            week_end = today + datetime.timedelta(days=6)
            items, prices = [], []
            for r in rows:
                d = _offering_dict(r)
                d.pop('meeting_link', None)
                if r['m_state'] == 'probation':
                    d['final_price'], d['demo'] = 0.0, True      # free demo while on probation
                price = float(d['final_price'] or 0)
                prices.append(price)
                if (min_p is not None and price < min_p) or (max_p is not None and price > max_p):
                    continue
                times = free_times(r['mentor_id'], int(r['duration_min']), offering=dict(r))
                if not times:
                    continue                                       # nothing bookable: don't list it
                nxt = {'date': times[0]['date'], 'time': times[0]['times'][0]}
                nd = _date(nxt['date'])
                if when == 'today' and nd != today:
                    continue
                if when == 'week' and nd > week_end:
                    continue
                d.update({'next_free': nxt, 'achiever': {
                    'id': r['mentor_id'], 'name': r['full_name'], 'designation': r['designation'],
                    'company': r['company'], 'photo': r['profile_image_url'],
                    'rating': float(r['rating']) if r['rating'] is not None else None, 'reviews': int(r['reviews'] or 0)}})
                items.append(d)

            key = {
                'price_low': lambda x: (float(x['final_price'] or 0), x['next_free']['date'], x['next_free']['time']),
                'price_high': lambda x: (-float(x['final_price'] or 0), x['next_free']['date'], x['next_free']['time']),
                'rating': lambda x: (-(x['achiever']['rating'] or 0), x['next_free']['date'], x['next_free']['time']),
            }.get(sort, lambda x: (x['next_free']['date'], x['next_free']['time']))
            items.sort(key=key)
            total = len(items)
            return jsonify(response={
                'items': items[(page - 1) * per: page * per], 'total': total, 'page': page,
                'pages': max(1, -(-total // per)),
                'price_bounds': {'min': min(prices) if prices else 0, 'max': max(prices) if prices else 0},
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
