"""What an achiever may do right now, and what they must do next.

One endpoint drives the whole gated portal. The alternative — each screen
deciding for itself whether it should be locked — is how a screen ends up
enabled in the UI while the API refuses it, or worse, the other way round.
Capabilities are computed in the database by sp_achiever_capabilities and
simply reported here.

The guidelines are served rather than hardcoded in the frontend so the wording
can change without a deploy, and so both portals show the same thing.
"""
import json
from flask import jsonify
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text

from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime
from portal.helpers.error_capture import capture_error
from . import ns, logger

# Which portal screens are reachable in each state. The frontend renders locks
# from this rather than keeping its own copy, so the two cannot disagree.
SCREENS = {
    # One screen. A pending achiever has one job -- get their application in --
    # and Verification now carries the profile fields itself, on the step that
    # asks them to check their details. A second Profile entry in the sidebar
    # edited the same fields from somewhere else, which is how two screens
    # disagree about what was saved. It returns once they are approved.
    'pending':   ['verification'],
    'active':    ['dashboard', 'verification', 'profile', 'notifications',
                  'availability', 'bookings', 'earnings', 'cohorts', 'tasks',
                  # v1-hidden: 'courses',
                  'domains', 'coupons', 'referrals'],
    # Refer & Earn is for approved achievers: a pending or suspended
    # achiever's link does not resolve (sp_referral_find_referrer).
    'suspended': ['dashboard', 'verification', 'profile', 'notifications',
                  'bookings', 'earnings'],
    'banned':    ['dashboard', 'earnings'],
}

ALL_SCREENS = SCREENS['active']

# Said once, in the achiever's language, at the moment it applies. A student
# who does not know they are being reviewed reads silence as rejection.
GUIDELINES = {
    'pending': {
        'title': 'Welcome to SKOVO',
        'summary': 'Complete your profile and upload your documents. '
                   'We review every application by hand.',
        'steps': [
            'Fill in your profile — photo, bio, what you do, and the domains you can mentor in.',
            'Upload a government ID and a selfie so we can confirm you are you.',
            'Upload proof of your achievement — a rank card, degree, or offer letter.',
            'Submit for review. We usually respond within two working days.',
        ],
        'note': None,
        # The part that is actually worth acknowledging. Kept on the server so
        # it can be reworded without a frontend deploy, and so the text an
        # achiever accepted can be versioned alongside the agreement record.
        'sections': [
            {
                'heading': 'Who you will be mentoring',
                'points': [
                    'Students between 14 and 25, from school leavers to people a few years into a career.',
                    'Many are the first in their family to consider the path they are asking you about, '
                    'and are deciding something expensive and hard to reverse.',
                    'Assume less prior knowledge than you would with a colleague, and never assume a budget.',
                ],
            },
            {
                'heading': 'What we expect from you',
                'points': [
                    'Keep your availability honest. An open slot is a promise, and the most common '
                    'complaint on any mentoring platform is a mentor who is never actually free.',
                    'Turn up on time, and if you genuinely cannot, cancel early rather than not appearing.',
                    'Say when you do not know something. A student can tell, and a straight answer is '
                    'worth more than a confident guess about their future.',
                    'Give advice from your own experience. You were verified for what you have actually '
                    'done, not for general career advice.',
                ],
            },
            {
                'heading': 'How you get paid',
                'points': [
                    'SKOVO keeps a platform share of each paid session and cohort. '
                    'Your exact rate is shown on the agreement you accept next.',
                    'Money for a booking is held until the session or cohort is delivered, then released '
                    'to your balance. You request a payout whenever you like and an admin approves it.',
                    'Once an admin verifies your account you can create paid cohorts and set their price.',
                ],
            },
            {
                'heading': 'What will close your account',
                'points': [
                    'Taking a student off SKOVO to avoid the platform share.',
                    'Misrepresenting a qualification, employer or achievement in your profile or documents.',
                    'Repeated no-shows, or cancelling on students at short notice as a habit.',
                    'Any behaviour toward a student that would not be acceptable from a teacher — '
                    'including asking for personal contact details for reasons unrelated to mentoring.',
                ],
            },
            {
                'heading': 'What happens after you submit',
                'points': [
                    'An admin reads your documents against what your profile claims. This is done by hand '
                    'and usually takes about two working days.',
                    'We may ask you for a short call before deciding.',
                    'If something is missing or unclear we will tell you what, rather than simply rejecting you.',
                ],
            },
        ],
    },
    'active': {
        'title': 'You are live',
        'summary': 'Everything is unlocked. You earn on every session from now on.',
        # v1 is cohorts: tips about cohorts, not 1-on-1 bookings.
        'steps': [
            'Create your first paid cohort, and add an offer to fill seats faster.',
            'At class time, share the check-in code. Attendance is marked automatically.',
            'Add your bank details so you can withdraw your earnings.',
            'You can request a payout any time. An admin approves it and we transfer.',
        ],
    },
    'suspended': {
        'title': 'Your account is suspended',
        'summary': 'You are not visible to students and cannot take new bookings.',
        'steps': [
            'Sessions already booked will still go ahead — please honour them.',
            'You can still withdraw money you have already earned.',
            'Contact support if you disagree with the reason above.',
        ],
        'note': None,
    },
    'banned': {
        'title': 'Your account is closed',
        'summary': 'You can no longer teach on SKOVO.',
        'steps': [
            'Any money you have already earned is still yours — request a final payout.',
            'Contact support if you believe this was a mistake.',
        ],
        'note': None,
    },
    # Not a lifecycle state: the guide shown on Create cohort. Kept here so
    # Admin > Achiever guidelines edits it like the others.
    'cohort_guide': {
        'title': 'How a cohort works',
        'summary': 'A cohort is one live class you teach to a small group of students.',
        'steps': [
            'Create it: title, domain, what students will learn, date, time and duration. Set a price (or free) and an optional offer. Add your Meet or Teams link, now or later.',
            'Students book until the class starts. Seats are set by an admin.',
            'Late joining: if seats are free, students can still book for the minutes you set after the start, once you have pressed Start (0 closes booking at the start). It can never be longer than the class.',
            'At class time, press Start on the cohort. The meeting link opens for your students; share the check-in code.',
            'Attendance is marked automatically when a student enters the code. Only the code counts.',
            'Press End session when you finish (it opens a few minutes before the end). Your quiz then opens for students.',
            'After class, students take your quiz and leave a review. On paid classes, your earnings appear in Earnings after the complaint window.',
        ],
        'note': None,
    },
}


def stored_guidelines(state):
    """The admin's copy for a state (Admin > Achiever guidelines), or None to
    use GUIDELINES above. Never raises: a missing table falls back to the code."""
    try:
        row = call_proc_one('sp_ach_guidelines_get', state)
        if not row:
            return None
        c = row.get('content')
        c = json.loads(c) if isinstance(c, (str, bytes)) else c
        return {**c, 'version': row.get('version')} if isinstance(c, dict) else None
    except Exception as e:                                   # noqa: BLE001
        logger.warning(f"achiever guidelines lookup failed ({state}): {e}")
        db.session.rollback()
        return None


def guidelines_for(state):
    """Copy keyed on state: the admin's version if saved, else the built-in."""
    return stored_guidelines(state) or GUIDELINES.get(state, GUIDELINES['pending'])


@ns.route('/lifecycle')
class AchieverLifecycle(Resource):

    @jwt_required()
    def get(self):
        """State, capabilities, unlocked screens, checklist and guidelines."""
        achiever_id = get_jwt_identity()
        try:
            # ── SP: sp_achiever_capabilities ─────────────────────────────────
            caps = call_proc_one('sp_achiever_capabilities', achiever_id)
            if not caps:
                return jsonify(response={'message': 'Achiever not found.'},
                               status=404, bool=False)

            state = caps.get('state') or 'pending'
            unlocked = SCREENS.get(state, SCREENS['pending'])

            row = db.session.execute(text(
                "SELECT state_reason, suspended_until, standing, standing_score, "
                "       payout_ready, session_rate "
                "  FROM achievers WHERE id = :i"
            ), {'i': achiever_id}).fetchone()

            return jsonify(response={
                'state': state,
                'state_reason': row[0] if row else None,
                'suspended_until': serialize_datetime(row[1]) if row and row[1] else None,
                'standing': row[2] if row else 'new',
                'standing_score': float(row[3]) if row and row[3] is not None else None,
                'session_rate': float(row[5]) if row and row[5] is not None else None,

                'capabilities': {
                    'can_be_listed':       bool(caps.get('can_be_listed')),
                    'can_charge':          bool(caps.get('can_charge')),
                    'can_take_bookings':   bool(caps.get('can_take_bookings')),
                    'can_withdraw':        bool(caps.get('can_withdraw')),
                    'can_publish_content': bool(caps.get('can_publish_content')),
                    'payout_ready':        bool(row[4]) if row else False,
                },

                'screens': {
                    'unlocked': unlocked,
                    'locked': [s for s in ALL_SCREENS if s not in unlocked],
                },

                'checklist': _checklist(achiever_id, state),
                'guidelines': guidelines_for(state),
            }, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"lifecycle failed for {achiever_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id},
                           status=500, bool=False)


def _checklist(achiever_id, state):
    """What is still outstanding, derived from the data rather than a flag.

    Deriving it means the checklist cannot claim a document is uploaded when it
    is not — the usual failure of a stored 'profile_complete' boolean that
    nobody remembers to clear.
    """
    if state != 'pending':
        return []

    row = db.session.execute(text(
        "SELECT bio, profile_image_url, designation, company, domains "
        "  FROM achievers WHERE id = :i"
    ), {'i': achiever_id}).fetchone()

    profile_done = bool(row and row[0] and row[1] and row[2])

    # ── SP: sp_achiever_documents_list ───────────────────────────────────────
    try:
        docs = call_proc('sp_achiever_documents_list', achiever_id) or []
    except Exception:
        docs = []

    by_type = {}
    for d in docs:
        by_type.setdefault(d.get('doc_type'), []).append(d.get('status'))

    required = db.session.execute(text(
        "SELECT value, label FROM master_achiever_doc_type "
        " WHERE is_required = 1 AND is_active = 1 ORDER BY sort_order"
    )).fetchall()

    items = [{
        'key': 'profile',
        'label': 'Complete your profile',
        'done': profile_done,
        'hint': 'Photo, bio, designation and the domains you mentor in.',
    }]

    for value, label in required:
        states = by_type.get(value, [])
        items.append({
            'key': value,
            'label': label,
            'done': any(s in ('accepted', 'approved') for s in states),
            'pending_review': any(s == 'pending' for s in states),
            'rejected': any(s == 'rejected' for s in states),
            'hint': None,
        })

    return items
