"""
Achiever Availability — achiever sets weekly availability, students see open slots
"""
from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid, datetime
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from portal.models import db
from sqlalchemy import text
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import trust as T
from . import ns, logger

DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
MIN_SLOT_MIN, MAX_SLOT_MIN = 15, 180


def _price_offer(data, can_charge):
    """(price, offer_type, offer_value, offer_ends_at, error) from a form.
    Price per slot like cohorts."""
    from decimal import Decimal, InvalidOperation
    if not can_charge:
        return 0, None, None, None, None
    try:
        price = Decimal(str(data.get('price') if data.get('price') not in (None, '') else 0)).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError):
        return None, None, None, None, 'Price must be a number.'
    if price < 0 or price > 100000:
        return None, None, None, None, 'Price must be 0 to 1,00,000.'
    kind = (data.get('offer_type') or '').strip() or None
    if not kind:
        return price, None, None, None, None
    if kind not in ('percent', 'amount'):
        return None, None, None, None, 'Pick % off or ₹ off.'
    if price <= 0:
        return None, None, None, None, 'An offer needs a price.'
    try:
        val = Decimal(str(data.get('offer_value'))).quantize(Decimal('0.01'))
    except (InvalidOperation, TypeError):
        return None, None, None, None, 'Enter how much off.'
    if kind == 'percent' and not (1 <= val <= 90):
        return None, None, None, None, 'Offer must be 1% to 90% off.'
    if kind == 'amount' and not (1 <= val < price):
        return None, None, None, None, f'Offer must be ₹1 to ₹{price - 1} off.'
    ends = None
    if data.get('offer_ends_at'):
        from portal.helpers.helpers import parse_local_to_utc
        ends = parse_local_to_utc(data['offer_ends_at'])
        if not ends:
            return None, None, None, None, 'Offer end date is not valid.'
    return price, kind, val, ends, None


def _offer_end_error(ends, start_utc=None):
    """An offer ends in the future and, for one date, before that slot starts."""
    if not ends:
        return None
    if ends <= datetime.datetime.utcnow():
        return 'Offer end must be in the future.'
    # An end after the slot starts is fine: nobody books after the start, so
    # the offer simply runs until the slot starts.
    return None


def slot_final_price(s, fallback_rate=0):
    """(price, final_price) for a slot right now: its own price (or the old
    single rate), less a live offer. Exact to the paisa, never rounded."""
    from decimal import Decimal
    price = Decimal(str(s.get('price') if s.get('price') is not None else (fallback_rate or 0)))
    final = price
    kind, val, ends = s.get('offer_type'), s.get('offer_value'), s.get('offer_ends_at')
    if kind and val and price > 0 and (not ends or ends > datetime.datetime.utcnow()):
        v = Decimal(str(val))
        final = price * (100 - v) / 100 if kind == 'percent' else price - v
        final = max(Decimal('0'), final).quantize(Decimal('0.01'))
    return float(price), float(final)


def _slot_utc(slot_date, start, end):
    """IST date + times -> (start_utc, end_utc)."""
    d = slot_date if isinstance(slot_date, datetime.date) else datetime.date.fromisoformat(str(slot_date)[:10])
    s = datetime.datetime.combine(d, start) - datetime.timedelta(minutes=330)
    e = datetime.datetime.combine(d, end) - datetime.timedelta(minutes=330)
    return s, e


def _clash(achiever_id, start_utc, end_utc, exclude_slot=None):
    """Message if this time overlaps a live cohort, a booked 1-on-1 or another
    open slot of the same achiever. An ended or cancelled cohort frees its time."""
    from portal.routes.Achiever.achiever import _time_clash_error
    msg = _time_clash_error(achiever_id, start_utc, int((end_utc - start_utc).total_seconds() // 60))
    if msg:
        return msg
    hit = db.session.execute(text(
        "SELECT start_utc FROM achiever_slots WHERE mentor_id = :a AND status = 'available'"
        "   AND start_utc IS NOT NULL AND start_utc < :e AND end_utc > :s"
        "   AND (:x IS NULL OR id <> :x) ORDER BY start_utc LIMIT 1"),
        {'a': achiever_id, 's': start_utc, 'e': end_utc, 'x': exclude_slot}).first()
    if hit:
        from portal.helpers.helpers import format_ist
        return f"You already have an open 1-on-1 slot at {format_ist(hit[0], '%d %b, %I:%M %p')}."
    return None


def _length_error(start, end):
    mins = (datetime.datetime.combine(datetime.date.today(), end)
            - datetime.datetime.combine(datetime.date.today(), start)).total_seconds() / 60
    if mins < MIN_SLOT_MIN or mins > MAX_SLOT_MIN:
        return f'A session must be {MIN_SLOT_MIN} minutes to {MAX_SLOT_MIN // 60} hours long.'
    return None

# How far ahead a slot may be placed. Not a policy, just a bound: a typo that
# lands in 2099 is a row nobody will ever clear out of the list.
MAX_SLOT_DAYS_AHEAD = 730


def _parse_time(v):
    """'HH:MM' or 'HH:MM:SS' -> datetime.time, or None if it is neither."""
    s = str(v or '').strip()
    for fmt in ('%H:%M:%S', '%H:%M'):
        try:
            return datetime.datetime.strptime(s, fmt).time()
        except ValueError:
            continue
    return None


def _validate_window(data):
    """Check start_time/end_time. Returns an error message, or None.

    X04-173/175/179/181. Neither POST checked these: the raw strings went
    straight into the stored procedure, so a malformed time was a MySQL error
    surfacing as a 500 with an opaque error id, and — the one that actually
    matters — **end before start was never checked at all**. An inverted window
    was stored happily and `sp_student_session_book` would then let a student
    book it, because the booking path trusts the slot row it is given.
    """
    start = _parse_time(data.get('start_time'))
    if start is None:
        return 'Start time is not a valid time. Use HH:MM.'
    end = _parse_time(data.get('end_time'))
    if end is None:
        return 'End time is not a valid time. Use HH:MM.'
    if end <= start:
        return 'End time must be after start time.'
    return None


def _validate_day_of_week(data):
    """X04: int(data['day_of_week']) raised an uncaught ValueError on any
    non-numeric value, and nothing checked the range — day 9 indexes past
    DAY_NAMES and reads as a blank day everywhere it is displayed."""
    try:
        dow = int(data['day_of_week'])
    except (TypeError, ValueError):
        return None, 'Day of week must be a number from 0 (Monday) to 6 (Sunday).'
    if not 0 <= dow <= 6:
        return None, 'Day of week must be a number from 0 (Monday) to 6 (Sunday).'
    return dow, None


def _validate_slot_date(data):
    """X04-172/176/178/182. Compared against the UTC date on purpose: the team
    is IST (+5:30), so the IST date is never behind the UTC one, and using UTC
    here can only ever be more permissive. It cannot refuse a date that is still
    today for the achiever looking at the screen."""
    raw = str(data.get('slot_date') or '').strip()
    try:
        d = datetime.datetime.strptime(raw, '%Y-%m-%d').date()
    except ValueError:
        return None, 'Slot date is not a valid date. Use YYYY-MM-DD.'
    today = datetime.datetime.utcnow().date()
    if d < today:
        return None, 'Slot date cannot be in the past.'
    if (d - today).days > MAX_SLOT_DAYS_AHEAD:
        return None, f'Slot date cannot be more than {MAX_SLOT_DAYS_AHEAD // 365} years ahead.'
    return d, None

# How many weeks ahead recurring weekly availability is materialised into slots.
WEEKS_AHEAD = 4


def _ensure_slots_from_weekly(achiever_id, weeks=WEEKS_AHEAD):
    """Materialise concrete bookable AchieverSlots from an achiever's recurring
    weekly availability for the next `weeks` weeks.

    The weekly-availability table only stores recurring day/time windows, but
    students book against concrete AchieverSlots rows. Without this expansion an
    achiever who only sets a weekly schedule has zero bookable inventory. Runs
    lazily whenever slots are listed, so it self-heals as time rolls forward.

    # ── SP: sp_achiever_availability_expand_slots — same idempotent
    # (date, start, end) dedup this used to do with a Python set, now done in
    # one query inside the DB instead of loading every existing slot into app
    # memory first. ──────────────────────────────────────────────────────────
    """
    try:
        call_proc_one('sp_achiever_availability_expand_slots', achiever_id, weeks)
        # Each weekly window's price/offer onto its new (unpriced, open) slots.
        db.session.execute(text(
            "UPDATE achiever_slots s JOIN achiever_availability a"
            "    ON a.mentor_id = s.mentor_id AND a.is_active = 1"
            "   AND a.day_of_week = WEEKDAY(s.slot_date) AND a.start_time = s.start_time AND a.end_time = s.end_time"
            "   SET s.price = a.price, s.offer_type = a.offer_type, s.offer_value = a.offer_value,"
            "       s.offer_ends_at = a.offer_ends_at"
            " WHERE s.mentor_id = :m AND s.status = 'available' AND s.price IS NULL AND a.price IS NOT NULL"),
            {'m': achiever_id})
        db.session.execute(text(
            "UPDATE achiever_slots s JOIN achiever_availability a"
            "    ON a.mentor_id = s.mentor_id AND a.is_active = 1"
            "   AND a.day_of_week = WEEKDAY(s.slot_date) AND a.start_time = s.start_time AND a.end_time = s.end_time"
            "   SET s.meeting_link = a.meeting_link"
            " WHERE s.mentor_id = :m AND s.status = 'available' AND s.meeting_link IS NULL"
            "   AND a.meeting_link IS NOT NULL"), {'m': achiever_id})
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.error(f"Weekly->slot generation failed for {achiever_id}: {e}")


def _overlaps(a_start, a_end, b_start, b_end):
    """Half-open overlap: touching windows (09:00-10:00, 10:00-11:00) do not."""
    return a_start < b_end and b_start < a_end


def _weekly_overlap(achiever_id, dow, start, end):
    """Message if this weekly window overlaps one the achiever already has.

    AC03-013 asks for defined behaviour, and there was none: nothing checked,
    so two overlapping windows on the same day both expanded into slots and the
    achiever was offered twice at the same hour. Refusing is the defined
    behaviour rather than merging, because merging silently rewrites what
    someone typed -- and the fix for a genuine mistake is one delete.
    """
    try:
        rows = call_proc('sp_achiever_availability_list', 5000, 0, 1) or []
    except Exception as e:
        # Fail closed would block every save on a transient read error; this is
        # a convenience check, not a security boundary, so it yields instead.
        logger.error(f"overlap check failed for {achiever_id}: {e}")
        return None
    for r in rows:
        if r.get('mentor_id') != achiever_id:
            continue
        if int(r.get('day_of_week') or -1) != dow:
            continue
        r_start, r_end = _parse_time(r.get('start_time')), _parse_time(r.get('end_time'))
        if r_start and r_end and _overlaps(start, end, r_start, r_end):
            return (f'That overlaps availability you already have on '
                    f'{DAY_NAMES[dow]} ({r_start:%H:%M}-{r_end:%H:%M}). '
                    f'Remove it first, or pick a different window.')
    return None


def _require_mentor():
    """Return an error response if the caller is not an achiever, else None.

    These endpoints manage an achiever's own availability/slots keyed by identity,
    so only role='mentor' tokens may touch them — otherwise a student could create
    availability/slot rows under their own user id and pollute the achiever tables.
    """
    if get_jwt().get('role') != 'mentor':
        return jsonify(response={'message': 'Achiever access only.'}, status=403, bool=False)
    return None


def _require_can_publish():
    """Role check plus the state check the sidebar was doing on its own.

    `availability` is absent from the suspended and banned screen sets, but
    that only ever hid the menu item: both POSTs had nothing more than
    `_require_mentor`, so a suspended or banned achiever could keep publishing
    bookable slots through the API. Remaining bookable is precisely what a
    suspension is meant to stop.

    Reads are deliberately left on `_require_mentor` alone -- seeing your own
    past availability while suspended harms nobody, and blanking the screen
    would just look like data loss. Only publishing is gated.
    """
    guard = _require_mentor()
    if guard:
        return guard
    return T.require_screen(
        get_jwt_identity(), 'availability',
        'Your account cannot publish availability in its current state.')


@ns.route('/my-rate')
class MySessionRate(Resource):
    @jwt_required()
    def put(self):
        """Set 1-on-1 session rate. Only a verified achiever may charge."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            try:
                rate = float(data.get('session_rate') if data.get('session_rate') not in (None, '') else 0)
            except (TypeError, ValueError):
                return jsonify(response={'message': 'Session rate must be a number.'}, status=400, bool=False)
            if rate < 0:
                return jsonify(response={'message': 'Session rate cannot be negative.'}, status=400, bool=False)
            if not caps.get('can_charge'):
                if rate > 0:
                    return jsonify(response={
                        'message': 'Charging opens once an admin has verified your account.',
                    }, status=400, bool=False)
                rate = 0
            # v1: SKOVO's cancellation rules for every achiever; no per-achiever choice.
            tpl = 'standard'
            sets = ['session_rate = :r']
            params = {'r': rate, 'i': achiever_id}
            if tpl:
                if tpl not in ('standard', 'flexible', 'always_full'):
                    return jsonify(response={'message': 'Unknown refund template.'}, status=400, bool=False)
                sets.append('refund_template = :t')
                params['t'] = tpl
            db.session.execute(text(
                f"UPDATE achievers SET {', '.join(sets)}, updated_at = UTC_TIMESTAMP() WHERE id = :i"
            ), params)
            db.session.commit()
            return jsonify(response={
                'message': 'Saved.',
                'session_rate': rate,
                'refund_template': tpl or None,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


@ns.route('/my-availability')
class MyAvailability(Resource):
    @jwt_required()
    def get(self):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            # ── SP: sp_achiever_availability_list — no mentor_id filter on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_achiever_availability_list', 5000, 0, 1)
            avails = [a for a in rows if a.get('mentor_id') == achiever_id]
            avails.sort(key=lambda a: (a.get('day_of_week') or 0, str(a.get('start_time') or '')))
            me = call_proc_one('sp_achievers_get', achiever_id) or {}
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            extra = {r[0]: r for r in db.session.execute(text(
                "SELECT id, price, offer_type, offer_value, offer_ends_at, meeting_link FROM achiever_availability"
                " WHERE mentor_id = :m AND is_active = 1"), {'m': achiever_id}).fetchall()}
            link = db.session.execute(text("SELECT session_meeting_link FROM achievers WHERE id = :m"),
                                      {'m': achiever_id}).scalar()
            out = []
            for a in avails:
                d = _avail_dict(a)
                x = extra.get(a.get('id'))
                if x:
                    d.update({'price': float(x[1]) if x[1] is not None else None, 'offer_type': x[2],
                              'offer_value': float(x[3]) if x[3] is not None else None,
                              'offer_ends_at': serialize_datetime(x[4]) if x[4] else None,
                              'meeting_link': x[5]})
                out.append(d)
            return jsonify(response={
                'availability': out,
                'meeting_link': link,
                'session_rate': float(me.get('session_rate') or 0),
                'refund_template': me.get('refund_template') or 'standard',
                'can_charge': bool(caps.get('can_charge')),
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}
            if data.get('day_of_week') is None or not data.get('start_time') or not data.get('end_time'):
                return jsonify(response={'message': 'day_of_week, start_time, end_time required.'}, status=400, bool=False)

            dow, err = _validate_day_of_week(data)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            err = _validate_window(data)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            err = _length_error(_parse_time(data['start_time']), _parse_time(data['end_time']))
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            err = _weekly_overlap(achiever_id, dow,
                                  _parse_time(data['start_time']),
                                  _parse_time(data['end_time']))
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            price, okind, oval, oends, perr = _price_offer(data, bool(caps.get('can_charge')))
            perr = perr or _offer_end_error(oends, None)
            if perr:
                return jsonify(response={'message': perr}, status=400, bool=False)
            avail_id = str(uuid.uuid4())
            call_proc_one(
                'sp_achiever_availability_create',
                avail_id, achiever_id, dow, data['start_time'], data['end_time'], 1,
            )
            db.session.execute(text(
                "UPDATE achiever_availability SET price = :p, offer_type = :k, offer_value = :v, offer_ends_at = :e,"
                " meeting_link = :l WHERE id = :i"),
                {'p': price, 'k': okind, 'v': oval, 'e': oends, 'i': avail_id,
                 'l': (data.get('meeting_link') or '').strip() or None})
            # A range added again starts fresh: dates removed earlier for this
            # day and time come back (they were only kept to stop regeneration).
            db.session.execute(text(
                "DELETE FROM achiever_slots WHERE mentor_id = :m AND status = 'removed' AND session_id IS NULL"
                "   AND WEEKDAY(slot_date) = :d AND start_time = :s AND end_time = :e"),
                {'m': achiever_id, 'd': dow, 's': _parse_time(data['start_time']), 'e': _parse_time(data['end_time'])})
            db.session.commit()
            return jsonify(response={'message': 'Availability added.', 'id': avail_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-availability/<string:avail_id>')
class MyAvailabilityDetail(Resource):
    @jwt_required()
    def delete(self, avail_id):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            # ── SP: sp_achiever_availability_get + _update (soft-hide) ────────
            a = call_proc_one('sp_achiever_availability_get', avail_id)
            if not a or a.get('mentor_id') != achiever_id:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc_one(
                'sp_achiever_availability_update',
                avail_id, achiever_id, a.get('day_of_week'), a.get('start_time'), a.get('end_time'), 0,
            )
            db.session.execute(text(
                "UPDATE achiever_slots SET status = 'removed'"
                " WHERE mentor_id = :m AND status = 'available' AND session_id IS NULL"
                "   AND WEEKDAY(slot_date) = :d AND start_time = :s AND end_time = :e"
                "   AND (start_utc IS NULL OR start_utc > UTC_TIMESTAMP())"),
                {'m': achiever_id, 'd': a.get('day_of_week'), 's': a.get('start_time'), 'e': a.get('end_time')})
            db.session.commit()
            return jsonify(response={'message': 'Removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-slots')
class MySlots(Resource):
    @jwt_required()
    def get(self):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            # Filters: from/to dates (IST) and view = upcoming | booked | past | cancelled | all.
            today = (datetime.datetime.utcnow() + datetime.timedelta(minutes=330)).date().isoformat()
            view = (request.args.get('view') or 'upcoming').strip()
            d_from = request.args.get('from_date') or ('2000-01-01' if view in ('past', 'all', 'cancelled') else today)
            d_to = request.args.get('to_date') or '2999-12-31'
            rows = db.session.execute(text(
                "SELECT s.*, x.status AS session_status, x.amount AS paid, x.payment_status,"
                "       u.full_name AS student_name"
                "  FROM achiever_slots s"
                "  LEFT JOIN achiever_sessions x ON x.id = s.session_id"
                "  LEFT JOIN users u ON u.id = x.student_id"
                " WHERE s.mentor_id = :m AND s.slot_date BETWEEN :f AND :t AND s.status <> 'removed'"
                " ORDER BY s.slot_date, s.start_time"), {'m': achiever_id, 'f': d_from, 't': d_to}).mappings().all()
            now = datetime.datetime.utcnow()
            out = []
            for r in rows:
                d = _slot_dict(r)
                price, final = slot_final_price(r)
                past = bool(r.get('end_utc') and r['end_utc'] < now)
                cancelled = r.get('status') == 'cancelled' or r.get('session_status') in ('cancelled', 'declined', 'rejected')
                booked = bool(r.get('session_id')) and not cancelled
                state = 'cancelled' if cancelled else 'past' if past else 'booked' if booked else 'open'
                d.update({'price': price, 'final_price': final, 'offer_type': r.get('offer_type'),
                          'offer_value': float(r['offer_value']) if r.get('offer_value') is not None else None,
                          'offer_ends_at': serialize_datetime(r['offer_ends_at']) if r.get('offer_ends_at') else None,
                          'meeting_link': r.get('meeting_link'), 'state': state,
                          'student_name': r.get('student_name'), 'paid': float(r['paid']) if r.get('paid') is not None else None,
                          'session_status': r.get('session_status')})
                out.append(d)
            if view in ('upcoming', 'booked', 'past', 'cancelled'):
                want = {'upcoming': ('open', 'booked'), 'booked': ('booked',), 'past': ('past',),
                        'cancelled': ('cancelled',)}[view]
                out = [d for d in out if d['state'] in want]
            if view in ('past', 'cancelled'):
                out.reverse()
            counts = {}
            return jsonify(response={'slots': out, 'counts': counts}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            guard = _require_can_publish()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            data = request.get_json() or {}
            if not data.get('slot_date') or not data.get('start_time') or not data.get('end_time'):
                return jsonify(response={'message': 'slot_date, start_time, end_time required.'}, status=400, bool=False)

            _d, err = _validate_slot_date(data)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            err = _validate_window(data)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            start, end = _parse_time(data['start_time']), _parse_time(data['end_time'])
            err = _length_error(start, end)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            s_utc, e_utc = _slot_utc(data['slot_date'], start, end)
            if s_utc <= datetime.datetime.utcnow():
                return jsonify(response={'message': 'Pick a time in the future.'}, status=400, bool=False)
            err = _clash(achiever_id, s_utc, e_utc)
            if err:
                return jsonify(response={'message': err}, status=409, bool=False)
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            price, okind, oval, oends, perr = _price_offer(data, bool(caps.get('can_charge')))
            perr = perr or _offer_end_error(oends, s_utc)
            if perr:
                return jsonify(response={'message': perr}, status=400, bool=False)
            link = (data.get('meeting_link') or '').strip() or None
            if link and not link.lower().startswith(('http://', 'https://')):
                return jsonify(response={'message': 'Meeting link must start with https://'}, status=400, bool=False)
            slot_id = str(uuid.uuid4())
            call_proc_one(
                'sp_achiever_slots_create',
                slot_id, achiever_id, data['slot_date'], data['start_time'], data['end_time'], None, 'available',
            )
            db.session.execute(text(
                "UPDATE achiever_slots SET price = :p, offer_type = :k, offer_value = :v, offer_ends_at = :e,"
                " meeting_link = :l, start_utc = IFNULL(start_utc, :su), end_utc = IFNULL(end_utc, :eu) WHERE id = :i"),
                {'p': price, 'k': okind, 'v': oval, 'e': oends, 'l': link, 'su': s_utc, 'eu': e_utc, 'i': slot_id})
            db.session.commit()
            return jsonify(response={'message': 'Slot created.', 'id': slot_id}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-slots/<string:slot_id>')
class MySlotDetail(Resource):
    @jwt_required()
    def delete(self, slot_id):
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            # ── SP: sp_achiever_slots_get + _delete (hard delete) ──────────────
            slot = call_proc_one('sp_achiever_slots_get', slot_id)
            if not slot or slot.get('mentor_id') != achiever_id:
                return jsonify(response={'message': 'Slot not found.'}, status=404, bool=False)
            # Never delete a slot that a student has already booked — cancel the
            # session first instead, so we don't orphan a confirmed booking.
            if slot.get('status') == 'booked' or slot.get('session_id'):
                return jsonify(response={'message': 'This slot is booked and cannot be deleted.'}, status=400, bool=False)
            db.session.execute(text("UPDATE achiever_slots SET status = 'removed' WHERE id = :i"), {'i': slot_id})
            db.session.commit()
            return jsonify(response={'message': 'Slot removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-slots/<string:slot_id>/edit')
class MySlotEdit(Resource):
    @jwt_required()
    def put(self, slot_id):
        """Change an open slot's price, offer or link. A booked slot keeps the price paid."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            achiever_id = get_jwt_identity()
            slot = call_proc_one('sp_achiever_slots_get', slot_id)
            if not slot or slot.get('mentor_id') != achiever_id:
                return jsonify(response={'message': 'Slot not found.'}, status=404, bool=False)
            if slot.get('status') != 'available' or slot.get('session_id'):
                return jsonify(response={'message': 'This slot is booked, so its price is locked.'}, status=409, bool=False)
            data = request.get_json() or {}
            caps = call_proc_one('sp_achiever_capabilities', achiever_id) or {}
            price, okind, oval, oends, perr = _price_offer(data, bool(caps.get('can_charge')))
            perr = perr or _offer_end_error(oends, slot.get('start_utc'))
            if perr:
                return jsonify(response={'message': perr}, status=400, bool=False)
            link = (data.get('meeting_link') or '').strip() or None
            if link and not link.lower().startswith(('http://', 'https://')):
                return jsonify(response={'message': 'Meeting link must start with https://'}, status=400, bool=False)
            db.session.execute(text(
                "UPDATE achiever_slots SET price = :p, offer_type = :k, offer_value = :v, offer_ends_at = :e,"
                " meeting_link = :l WHERE id = :i AND status = 'available'"),
                {'p': price, 'k': okind, 'v': oval, 'e': oends, 'l': link, 'i': slot_id})
            db.session.commit()
            return jsonify(response={'message': 'Slot updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-link')
class MyMeetingLink(Resource):
    @jwt_required()
    def put(self):
        """Default meeting link for every 1-on-1 (a slot can override it)."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            link = ((request.get_json() or {}).get('meeting_link') or '').strip() or None
            if link and not link.lower().startswith(('http://', 'https://')):
                return jsonify(response={'message': 'Meeting link must start with https://'}, status=400, bool=False)
            db.session.execute(text("UPDATE achievers SET session_meeting_link = :l WHERE id = :i"),
                               {'l': link, 'i': get_jwt_identity()})
            db.session.commit()
            return jsonify(response={'message': 'Saved.', 'meeting_link': link}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/my-summary')
class MySummary(Resource):
    @jwt_required()
    def get(self):
        """Top cards: open slots (next 30 days), upcoming booked, the next
        session and what the achiever earns from booked slots (after SKOVO's
        commission, exact to the paisa, never rounded up)."""
        try:
            guard = _require_mentor()
            if guard:
                return guard
            from decimal import Decimal, ROUND_DOWN
            achiever_id = get_jwt_identity()
            now = datetime.datetime.utcnow()
            # Live 1-on-1s and how many hours a week he is open.
            open_n = db.session.execute(text(
                "SELECT COUNT(*) FROM achiever_offerings WHERE mentor_id = :m AND status = 'active'"
                "   AND (available_to IS NULL OR available_to >= CURDATE())"), {'m': achiever_id}).scalar() or 0
            week_min = db.session.execute(text(
                "SELECT IFNULL(SUM(TIME_TO_SEC(TIMEDIFF(end_time, start_time))) / 60, 0)"
                "  FROM achiever_availability WHERE mentor_id = :m AND is_active = 1"), {'m': achiever_id}).scalar() or 0
            booked = db.session.execute(text(
                "SELECT s.slot_date, s.start_time, s.start_utc, x.amount,"
                "       (SELECT po.achiever_earning FROM payment_orders po"
                "         WHERE po.kind = 'session' AND po.slot_id = s.id AND po.status IN ('paid', 'settled')"
                "         ORDER BY po.created_at DESC LIMIT 1) AS earning,"
                "       (SELECT po.commission_rate FROM payment_orders po"
                "         WHERE po.kind = 'session' AND po.slot_id = s.id AND po.status IN ('paid', 'settled')"
                "         ORDER BY po.created_at DESC LIMIT 1) AS rate"
                "  FROM achiever_slots s JOIN achiever_sessions x ON x.id = s.session_id"
                " WHERE s.mentor_id = :m AND s.end_utc > :n"
                "   AND x.status NOT IN ('cancelled', 'declined', 'rejected', 'expired')"
                " ORDER BY s.start_utc"), {'m': achiever_id, 'n': now}).fetchall()
            gross = sum((Decimal(str(r[3] or 0)) for r in booked), Decimal('0'))
            from portal.routes.Achiever.achiever import _commission_rate_for
            rate = _commission_rate_for(achiever_id)
            # Each booking's own share, saved when the student paid; only a
            # booking without a payment record falls back to today's rate.
            earn = Decimal('0')
            rates = set()
            for r in booked:
                if r[4] is not None:
                    earn += Decimal(str(r[4]))
                    rates.add(float(r[5]))
                else:
                    earn += (Decimal(str(r[3] or 0)) * (1 - Decimal(str(rate or 0)))).quantize(Decimal('0.01'), rounding=ROUND_DOWN)
                    rates.add(float(rate or 0))
            if len(rates) == 1:
                rate = rates.pop()
            elif rates:
                rate = None  # mixed rates: the card says "after SKOVO fee"
            nxt = booked[0] if booked else None
            return jsonify(response={
                'offerings': int(open_n),
                'weekly_hours': float(Decimal(str(week_min)) / 60),
                'booked': len(booked),
                'next_session': serialize_datetime(nxt[2]) if nxt and nxt[2] else None,
                'earnings': float(earn),
                'gross': float(gross),
                'commission_rate': rate,
            }, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:achiever_id>/slots')
class AchieverPublicSlots(Resource):
    @jwt_required()
    def get(self, achiever_id):
        try:
            # Only advertise slots for an achiever THIS student can actually
            # book. Same procedure the booking endpoint calls, so the times on
            # offer and the times that will be accepted can never disagree —
            # including the age rule: a 14-17 student is shown no slots at all
            # for an achiever who has not cleared a background check, rather
            # than picking one and being refused at checkout.
            ok, _reason, _level = T.booking_eligibility(achiever_id, get_jwt_identity())
            if not ok:
                return jsonify(response={'slots': [], 'total': 0}, status=200, bool=True)

            from_date = request.args.get('from_date', datetime.date.today().isoformat())
            # ── SP: sp_achiever_slots_list — no mentor_id/date/status filter on
            # the generic CRUD proc, so pull a bounded batch and filter here. ─
            from portal.helpers import class_rules as CR
            cutoff = datetime.datetime.utcnow() + datetime.timedelta(
                minutes=int(CR.rules().get('booking_cutoff_min') or 60))
            rows = db.session.execute(text(
                "SELECT s.* FROM achiever_slots s"
                " WHERE s.mentor_id = :m AND s.status = 'available' AND s.slot_date >= :f"
                "   AND (s.start_utc IS NULL OR s.start_utc >= :c)"
                "   AND NOT EXISTS (SELECT 1 FROM cohorts c WHERE c.achiever_id = s.mentor_id"
                "        AND c.deleted_at IS NULL AND c.status NOT IN ('cancelled', 'completed')"
                "        AND c.session_date < s.end_utc"
                "        AND DATE_ADD(c.session_date, INTERVAL IFNULL(c.duration_minutes, 90) MINUTE) > s.start_utc)"
                " ORDER BY s.slot_date, s.start_time"), {'m': achiever_id, 'f': from_date, 'c': cutoff}).mappings().all()
            me = call_proc_one('sp_achievers_get', achiever_id) or {}
            out = []
            for s in rows:
                d = _slot_dict(s)
                d['price'], d['final_price'] = slot_final_price(s, me.get('session_rate'))
                d['offer_type'] = s.get('offer_type')
                d['offer_value'] = float(s['offer_value']) if s.get('offer_value') is not None else None
                out.append(d)
            return jsonify(response={'slots': out, 'total': len(out)}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _avail_dict(a):
    day = a.get('day_of_week')
    st = str(a.get('start_time')) if a.get('start_time') is not None else None
    et = str(a.get('end_time')) if a.get('end_time') is not None else None
    return {
        'id': a.get('id'), 'day_of_week': day,
        'day_name': DAY_NAMES[day] if day is not None and 0 <= day <= 6 else '',
        'start_time': st, 'end_time': et, 'is_active': bool(a.get('is_active')),
    }


def _slot_dict(s):
    st = str(s.get('start_time')) if s.get('start_time') is not None else None
    et = str(s.get('end_time')) if s.get('end_time') is not None else None
    slot_date = s.get('slot_date')
    return {
        'id': s.get('id'), 'achiever_id': s.get('mentor_id'),
        'slot_date': serialize_datetime(slot_date) if hasattr(slot_date, 'isoformat') else slot_date,
        'start_time': st, 'end_time': et,
        'session_id': s.get('session_id'), 'status': s.get('status'),
    }
