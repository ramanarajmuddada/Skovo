"""Demo-session reviews shared by the achiever case and the admin case file.

The same rows decide whether someone leaves probation. Serialising them in one
place means the achiever cannot see a different story from the admin.
"""
from portal.helpers.sp import call_proc
from portal.helpers.helpers import serialize_datetime

DEFAULT_REQUIRED = 3
MAX_REQUIRED = 12
EXTRA_ALLOWED = (1, 2, 3)


def serialize_session(s):
    return {
        'session_id': s.get('session_id'),
        # A demo is now either a 1-on-1 session or a free cohort.
        # `sp_achiever_probation_review` was widened to return both and to
        # label each row, but this serialiser is an explicit field list — so
        # the two new columns were silently dropped on the way out and the UI
        # received `demo_kind: undefined`, showing three identical unlabelled
        # cards. An explicit list is the right shape here; it just has to be
        # extended when the query is.
        'demo_kind': s.get('demo_kind'),
        'cohort_title': s.get('cohort_title'),
        'student_name': s.get('student_name'),
        'status': s.get('status'),
        'no_show': bool(s.get('no_show')),
        'rating': s.get('rating'),
        'review_text': s.get('review_text'),
        'booked_at': serialize_datetime(s['booked_at']) if s.get('booked_at') else None,
        'completed_at': serialize_datetime(s['completed_at']) if s.get('completed_at') else None,
    }


def review_payload(achiever_id):
    sessions = call_proc('sp_achiever_probation_review', achiever_id) or []
    rated = [s for s in sessions if s.get('rating') is not None]
    return {
        'sessions': [serialize_session(s) for s in sessions],
        'summary': {
            'completed': sum(1 for s in sessions
                             if s.get('status') == 'completed' and not s.get('no_show')),
            'no_shows': sum(1 for s in sessions if s.get('no_show')),
            'reviews': len(rated),
            'average_rating': round(sum(float(s['rating']) for s in rated) / len(rated), 2)
                              if rated else None,
        },
    }
