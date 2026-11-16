"""Speed practice (feature-updates.md §7): a timed round of quick questions.

Questions come from the admin's speed lists in task_questions, keyed by owner
id: "speed-all" for every class plus "speed-<stage group>" for the student's
own class (Daily engagement -> Speed questions). Only MCQ, true/false and
numeric questions are used. Points: admin rule speed_round.

Learning paths, placement tests and Topper mode were removed for v1.
"""
import datetime
import random
import uuid

from portal.helpers.sp import call_proc
from portal.helpers import quiz as Q
from portal.helpers.engagement import _one, settings, track

QUICK_TYPES = ('mcq', 'true_false', 'numeric')


def questions_of(owner_id):
    return call_proc('sp_task_questions_list', owner_id) or []


def owners_for(user_id):
    """The speed lists this student draws from."""
    stage = call_proc('sp_stage_get_active', user_id)
    group = (stage[0] if stage else {}).get('stage_group') or ''
    return ['speed-all'] + ([f'speed-{group}'] if group else [])


# The round is stateless between start and submit: the start response carries
# the question order inside a server-signed token with the start time.

def _sign(payload):
    from itsdangerous import URLSafeTimedSerializer
    from flask import current_app
    return URLSafeTimedSerializer(current_app.secret_key, salt='speed-round').dumps(payload)


def _unsign(token, max_age):
    from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
    from flask import current_app
    try:
        return URLSafeTimedSerializer(current_app.secret_key, salt='speed-round').loads(token, max_age=max_age)
    except (BadSignature, SignatureExpired):
        return None


def speed_start(user_id):
    s = settings()
    if not s.get('speed_enabled'):
        return None, 'Speed practice is not switched on yet.'
    pool = [q for o in owners_for(user_id) for q in questions_of(o) if q.get('question_type') in QUICK_TYPES]
    if not pool:
        return None, 'No practice questions for your class yet.'
    n = max(5, min(50, int(s.get('speed_questions') or 20)))
    pick = random.sample(pool, min(n, len(pool)))
    ids, order = Q.build_attempt(pick, True, None)
    secs = max(20, min(600, int(s.get('speed_seconds') or 60)))
    token = _sign({'u': user_id, 'speed': 1, 'q': ids, 'o': order, 's': datetime.datetime.utcnow().timestamp(),
                   'sec': secs})
    by = {q['id']: q for q in pick}
    return {'token': token, 'seconds': secs, 'questions': [Q.student_view(by[i], order) for i in ids]}, None


def speed_submit(user_id, token, answers):
    data = _unsign(token, max_age=3600)
    if not data or data.get('u') != user_id or not data.get('speed'):
        return None, 'This round has expired.'
    elapsed = datetime.datetime.utcnow().timestamp() - float(data['s'])
    if elapsed > float(data['sec']) + 15:
        answers = {}                                         # too late: nothing counts
    qs = {}
    for qid in data['q']:
        r = _one("SELECT * FROM task_questions WHERE id = :i", i=qid)
        if r:
            qs[qid] = r
    correct = sum(1 for qid, q in qs.items() if Q.is_correct(q, (answers or {}).get(qid)))
    from portal.helpers import score
    score.award(user_id, 'speed_round', ref_id=f"speed-{uuid.uuid4().hex[:12]}")
    track(user_id, 'speed_round')
    return {'correct': correct, 'answered': len([a for a in (answers or {}).values() if a not in (None, '')]),
            'total': len(qs)}, None
