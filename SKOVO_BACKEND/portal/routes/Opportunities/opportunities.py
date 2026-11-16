import re
import json
import math
import datetime
from portal.helpers.error_capture import capture_error
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.helpers import serialize_datetime, opportunity_hub_min_score
from . import ns, logger


# The Opportunity Hub gate has exactly one reader:
# helpers.opportunity_hub_min_score(). This module and Applications each kept a
# private copy that read the same config row and fell back to the same 60 - so
# all three agreed, which is precisely how the 60-vs-65 bug shipped: three places
# to change and one of them missed. The copy here also returned the raw column,
# so a NULL config value came back as None and was then compared against a score,
# where the helper falls back to the spec floor instead.
_opportunity_unlock_floor = opportunity_hub_min_score
list_parser = reqparse.RequestParser()
list_parser.add_argument('type', type=str, location='args', required=False,
                         help='internship | fresher_job | part_time | fellowship')
list_parser.add_argument('domain', type=str, location='args', required=False)
list_parser.add_argument('location', type=str, location='args', required=False)
list_parser.add_argument('remote_only', type=bool, location='args', required=False, default=False)
list_parser.add_argument('search', type=str, location='args', required=False)
list_parser.add_argument('page', type=int, location='args', default=1)
list_parser.add_argument('per_page', type=int, location='args', default=10)
list_parser.add_argument('for_you', type=int, location='args', default=0,
                         help='1 = personalised ranking (Skovo Pro)')

# Opportunity types not relevant for pre-degree students
_FUTURE_LEVELS = {'10th', '11th_12th', '12th'}
_EXCLUDE_TYPES_FOR_FUTURE = {'fresher_job'}


def _get_student_level(user_id):
    try:
        # ── SP: sp_profile_get_by_user ──────────────────────────────────────
        profile = call_proc_one('sp_profile_get_by_user', user_id)
        return (profile.get('education_level') or '').lower().strip() if profile else None
    except Exception:
        return None


def _build_opp_context(level):
    if level in {'10th', '11th_12th'}:
        label = '10th grade' if level == '10th' else '11th / 12th grade'
        return {
            'level': level,
            'banner': (
                f"You're in {label}. Internships and fellowships are great right now — "
                f"fresher jobs require a degree but bookmark those for after graduation!"
            ),
            'banner_type': 'info',
            'hide_types': list(_EXCLUDE_TYPES_FOR_FUTURE),
        }
    if level == '12th':
        return {
            'level': level,
            'banner': "You're in 12th grade — internships and fellowships are a great fit. Fresher jobs open up after your degree.",
            'banner_type': 'info',
            'hide_types': list(_EXCLUDE_TYPES_FOR_FUTURE),
        }
    return {'level': level, 'banner': None, 'hide_types': []}


# ══════════════════════════════════════════════════════════════════════════
# "Personalised Fresh Job Opportunities" — the Skovo Pro feed
# ══════════════════════════════════════════════════════════════════════════
# The default listing sorts by deadline, which answers "what closes soonest",
# not "what is worth my time". For Pro members `for_you=1` re-sorts the same
# rows by how well each matches the student's own branch, interests and city,
# with recency as the tie-break — so a strong match posted last week beats a
# generic role closing tomorrow.
#
# It re-ranks; it never hides. A student who could not see a role they would
# have found on the default list would rightly read the paid tier as taking
# something away. Nothing is filtered out here.

FRESH_DAYS = 30          # a role posted inside this window counts as "fresh"
_MATCH_STOPWORDS = {'and', 'the', 'of', 'in', 'for', 'engineering', 'science', 'general'}


def _tokens(*values):
    """Lowercase word set from mixed strings/lists, minus noise words."""
    out = set()
    for v in values:
        if not v:
            continue
        parts = v if isinstance(v, (list, tuple, set)) else [v]
        for part in parts:
            for w in re.split(r'[^a-z0-9+#]+', str(part).lower()):
                if len(w) > 2 and w not in _MATCH_STOPWORDS:
                    out.add(w)
    return out


def _student_match_profile(user_id):
    """What the ranking runs against — branch, degree, interests, city/state."""
    try:
        # ── SP: sp_profile_get_by_user ──────────────────────────────────────
        pr = call_proc_one('sp_profile_get_by_user', user_id) or {}
    except Exception:
        pr = {}
    interests = pr.get('career_interests')
    if isinstance(interests, str):
        try:
            interests = json.loads(interests)
        except Exception:
            interests = []
    return {
        'terms': _tokens(pr.get('branch'), pr.get('degree_type'), pr.get('stream'),
                         pr.get('working_role'), pr.get('working_industry'), interests or []),
        'city': (pr.get('city') or '').strip().lower(),
        'state': (pr.get('state') or '').strip().lower(),
    }


def _match_score(o, mp):
    """0-100, plus why. Deterministic, and explainable in one line to the student."""
    terms = mp['terms']
    text = _tokens(o.get('title'), o.get('domain'), o.get('skills_required'),
                   o.get('description'))
    overlap = (terms & text) if terms else set()

    score, reasons = 0, []
    if overlap:
        score += min(45, 15 * len(overlap))
        reasons.append('matches ' + ', '.join(sorted(overlap)[:3]))

    loc = (o.get('location') or '').lower()
    if o.get('is_remote'):
        score += 15
        reasons.append('remote')
    elif mp['city'] and mp['city'] in loc:
        score += 20
        reasons.append('in ' + mp['city'].title())
    elif mp['state'] and mp['state'] in loc:
        score += 10
        reasons.append('in ' + mp['state'].title())

    created = o.get('created_at')
    fresh = False
    if isinstance(created, datetime.datetime):
        age = (datetime.datetime.utcnow() - created).days
        if age <= 7:
            score += 25
            fresh = True
            reasons.append('posted this week')
        elif age <= FRESH_DAYS:
            score += 15
            fresh = True
            reasons.append('recently posted')

    if o.get('is_featured'):
        score += 10
        reasons.append('featured')

    return min(100, score), fresh, reasons[:3]


def _opp_dict(o, user_score=0, unlock_floor=None):
    # None means "ask the config", not "no gate".
    if unlock_floor is None:
        unlock_floor = opportunity_hub_min_score()
    effective_min = max(unlock_floor, o.get('min_readiness_score') or 0)
    return {
        'id': o['id'],
        'title': o.get('title'),
        'company': o.get('company'),
        'type': o.get('type'),
        'domain': o.get('domain'),
        'location': o.get('location'),
        'is_remote': bool(o.get('is_remote')),
        'duration': o.get('duration'),
        'stipend_min': o.get('stipend_min'),
        'stipend_max': o.get('stipend_max'),
        'stipend_type': o.get('stipend_type'),
        'min_readiness_score': effective_min,
        'deadline': serialize_datetime(o.get('deadline')),
        'description': o.get('description'),
        'is_unlocked': user_score >= effective_min,
        'status': o.get('status'),
    }


@ns.route('/')
class OpportunityList(Resource):
    @ns.doc(description='List opportunities with filters. Returns student_context for education-level-aware UI.')
    @jwt_required()
    def get(self):
        try:
            args      = list_parser.parse_args()
            user_id   = get_jwt_identity()
            # ── SP: sp_readiness_score_get ──────────────────────────────────────
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            user_score = readiness.get('score') if readiness else 0
            unlock_floor = _opportunity_unlock_floor()
            level     = _get_student_level(user_id)
            ctx       = _build_opp_context(level)

            # ── SP: sp_opportunities_list — no type/domain/location/search
            # filters on the generic CRUD proc, so pull a bounded batch and
            # filter/sort/paginate in Python. ──────────────────────────────────
            items = call_proc('sp_opportunities_list', 5000, 0)
            items = [o for o in items if o.get('status') == 'active']

            # Filter out job types not relevant for pre-degree students
            if ctx['hide_types'] and not args.get('type'):
                items = [o for o in items if o.get('type') not in ctx['hide_types']]

            if args.get('type'):
                items = [o for o in items if o.get('type') == args['type']]
            if args.get('domain'):
                items = [o for o in items if o.get('domain') == args['domain']]
            if args.get('location'):
                loc = args['location'].lower()
                items = [o for o in items if loc in (o.get('location') or '').lower()]
            if args.get('remote_only'):
                items = [o for o in items if o.get('is_remote')]
            if args.get('search'):
                s = args['search'].lower()
                items = [o for o in items if s in (o.get('title') or '').lower() or s in (o.get('company') or '').lower()]

            # ── Skovo Pro: the For You ranking ───────────────────────────────
            from portal.routes.Subscription.subscription import is_pro
            pro = is_pro(user_id)
            want_for_you = bool(args.get('for_you'))
            personalised = want_for_you and pro
            match_by_id = {}
            if personalised:
                mp = _student_match_profile(user_id)
                scored = []
                for o in items:
                    ms, fresh, why = _match_score(o, mp)
                    match_by_id[o['id']] = {'match_score': ms, 'is_fresh': fresh, 'why': why}
                    scored.append((ms, o))
                # Best match first; deadline still breaks ties, so two equally
                # good roles are ordered by which one closes first.
                scored.sort(key=lambda t: (-t[0], t[1].get('deadline') is None,
                                           t[1].get('deadline') or datetime.datetime.max))
                items = [o for _, o in scored]
            else:
                # MySQL ASC puts NULLs first — replicate that ordering in Python.
                items.sort(key=lambda o: (o.get('deadline') is not None, o.get('deadline')))

            total = len(items)
            page = args['page']
            per_page = args['per_page']
            pages = math.ceil(total / per_page) if per_page else 1
            start = (page - 1) * per_page
            page_items = items[start:start + per_page]

            result = [_opp_dict(o, user_score, unlock_floor) for o in page_items]
            for r in result:
                r.update(match_by_id.get(r['id'], {}))

            # ── SP: sp_opp_shortlist_ids — flag what the student has saved ───
            saved = {r['opportunity_id'] for r in (call_proc('sp_opp_shortlist_ids', user_id) or [])}
            for r in result:
                r['is_shortlisted'] = r.get('id') in saved

            # v1 §4.5: below the floor the module is locked, and the client
            # renders a screen explaining how to get there. Everything it needs
            # to draw that screen ships here.
            hub_locked = user_score < unlock_floor
            gate = {
                'locked': hub_locked,
                'your_score': user_score,
                'required_score': unlock_floor,
                'points_away': max(0, unlock_floor - user_score),
            }

            # `for_you` is a mode the client may offer, not one it may assume:
            # requested + free comes back as available:False with the reason, so
            # the tab renders as an upgrade prompt rather than silently showing
            # the ordinary list under a "For You" heading.
            for_you = {
                'available': pro,
                'active': personalised,
                'requested': want_for_you,
                'requires_pro': want_for_you and not pro,
                'message': None if pro else
                           'A feed ranked to your branch, interests and city is a Skovo Pro feature.',
                'cta_route': None if pro else '/skovo-pro',
            }

            return jsonify(
                response={'opportunities': result, 'student_context': ctx, 'hub_gate': gate,
                          'is_pro': pro, 'for_you': for_you},
                pagination={
                    'total': total,
                    'page': page,
                    'pages': pages,
                    'per_page': per_page,
                },
                user_readiness_score=user_score,
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /opportunities: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:opportunity_id>')
class OpportunityDetail(Resource):
    @ns.doc(description='Get full opportunity details.')
    @jwt_required()
    def get(self, opportunity_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_readiness_score_get, sp_opportunities_get ─────────────────
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            user_score = readiness.get('score') if readiness else 0

            o = call_proc_one('sp_opportunities_get', opportunity_id)
            if not o or o.get('status') != 'active':
                return jsonify(response={'message': 'Opportunity not found.'}, status=404, bool=False)

            data = _opp_dict(o, user_score, _opportunity_unlock_floor())
            data['requirements'] = o.get('requirements')
            return jsonify(response=data, status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /opportunities/{opportunity_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


# ══════════════════════════════════════════════════════════════════════════
# Shortlist — free tier, once the score gate is cleared (v1 §4.5)
# ══════════════════════════════════════════════════════════════════════════

@ns.route('/shortlist')
class OpportunityShortlist(Resource):
    @ns.doc(description='The student\'s saved opportunities.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            user_score = readiness.get('score') if readiness else 0
            unlock_floor = _opportunity_unlock_floor()
            # ── SP: sp_opp_shortlist_list ────────────────────────────────────
            rows = call_proc('sp_opp_shortlist_list', user_id) or []
            items = [_opp_dict(o, user_score, unlock_floor) for o in rows]
            for it in items:
                it['is_shortlisted'] = True
            return jsonify(response={'opportunities': items, 'total': len(items)},
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"Error in GET /opportunities/shortlist: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/<string:opportunity_id>/shortlist')
class OpportunityShortlistItem(Resource):
    @ns.doc(description='Save an opportunity to the shortlist. Free once the score gate is cleared.')
    @jwt_required()
    def post(self, opportunity_id):
        try:
            import uuid
            from portal.models import db
            user_id = get_jwt_identity()

            opp = call_proc_one('sp_opportunities_get', opportunity_id)
            if not opp or opp.get('status') != 'active':
                return jsonify(response={'message': 'Opportunity not found or no longer active.'},
                               status=404, bool=False)

            # Saving is a free action, but the hub itself is score-gated — you
            # cannot shortlist what you are not allowed to browse.
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            user_score = readiness.get('score') if readiness else 0
            required = max(_opportunity_unlock_floor(), opp.get('min_readiness_score') or 0)
            if user_score < required:
                return jsonify(response={
                    'message': f'Reach a readiness score of {required} to unlock the Opportunity Hub.',
                    'required_score': required, 'your_score': user_score,
                }, status=403, bool=False)

            # ── SP: sp_opp_shortlist_add ─────────────────────────────────────
            res = call_proc_one('sp_opp_shortlist_add', str(uuid.uuid4()), user_id, opportunity_id) or {}
            db.session.commit()
            return jsonify(response={
                'message': 'Saved to your shortlist.' if res.get('result') == 'saved'
                           else 'Already in your shortlist.',
                'is_shortlisted': True,
            }, status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"Error in POST /opportunities/{opportunity_id}/shortlist: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Remove an opportunity from the shortlist.')
    @jwt_required()
    def delete(self, opportunity_id):
        try:
            from portal.models import db
            user_id = get_jwt_identity()
            # ── SP: sp_opp_shortlist_remove ──────────────────────────────────
            call_proc_one('sp_opp_shortlist_remove', user_id, opportunity_id)
            db.session.commit()
            return jsonify(response={'message': 'Removed from your shortlist.', 'is_shortlisted': False},
                           status=200, bool=True)
        except Exception as e:
            from portal.models import db
            db.session.rollback()
            logger.error(f"Error in DELETE /opportunities/{opportunity_id}/shortlist: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
