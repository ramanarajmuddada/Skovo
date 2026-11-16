"""
Student goals — the aspiration half of the profile.

GET  /profile/goals  → what the student is aiming for, dream colleges resolved.
PUT  /profile/goals  → partial write; onboarding sends it in pieces and Profile
                       edits one field at a time, so anything omitted is kept.
"""
import json

from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.education_pathways import filter_target_exams
from . import ns, logger

LIST_FIELDS = ('target_exams', 'target_courses', 'target_states', 'target_cities', 'target_college_ids')
VALID_CATEGORIES = ('general', 'obc', 'sc', 'st', 'ews')


def _exams_for_stage(user_id, exams):
    """Keep only the exams this student's education stage actually sits.

    The state CETs carry no education_level of their own — master_entrance_exam
    has that column, the per-state tables do not — so the classification lives in
    portal/helpers/education_pathways.py and is applied to both here. Invalid
    picks are dropped, not rejected: goals are enrichment, and onboarding already
    treats a failed goals write as non-blocking.
    """
    profile = call_proc_one('sp_profile_get_by_user', user_id) or {}
    level = profile.get('education_category')
    if not level:
        return exams
    # ── SP: sp_master_list — education_level comes back only for the tables
    # that carry it, which is exactly master_entrance_exam. Presence in this
    # dict is what marks a value as a national entrance exam, so rows with no
    # level ("Other") are kept in it rather than filtered out.
    national = {r.get('value'): r.get('education_level')
                for r in call_proc('sp_master_list', 'entrance_exam', 1)}
    govt = [r.get('value') for r in call_proc('sp_master_list', 'govt_exam', 1)]
    return filter_target_exams(level, exams, national, govt)


def _as_list(v):
    """MySQL JSON column -> list (raw SQL hands it back as a string)."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _goals_dict(g, colleges=None):
    g = g or {}
    return {
        'target_exams':         _as_list(g.get('target_exams')),
        'target_courses':       _as_list(g.get('target_courses')),
        'target_states':        _as_list(g.get('target_states')),
        'target_cities':        _as_list(g.get('target_cities')),
        'target_college_ids':   _as_list(g.get('target_college_ids')),
        'target_colleges':      colleges or [],
        'admission_year':       g.get('admission_year'),
        'reservation_category': g.get('reservation_category'),
        'budget_max':           g.get('budget_max'),
    }


@ns.route('/goals')
class MyGoals(Resource):
    @ns.doc(description="The student's targets: exams, courses, where they want to study, "
                        'dream colleges, admission year, reservation category.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_student_goals_get ─────────────────────────────────────
            goals = call_proc_one('sp_student_goals_get', user_id)
            colleges = []
            if goals:
                # ── SP: sp_student_goals_colleges ────────────────────────────
                colleges = [{
                    'id':    c.get('id'),
                    'name':  c.get('name'),
                    'city':  c.get('location_city'),
                    'state': c.get('location_state'),
                    'nirf':  c.get('nirf_ranking'),
                    'logo_url': c.get('logo_url'),
                } for c in call_proc('sp_student_goals_colleges', user_id)]
            return jsonify(response={'goals': _goals_dict(goals, colleges)}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /profile/goals error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)

    @ns.doc(description='Partial update — omitted fields keep their current value.')
    @jwt_required()
    def put(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}

            # Only serialise the list fields the caller actually sent; the proc
            # COALESCEs, so NULL means "leave it alone" rather than "clear it".
            payload = {}
            for f in LIST_FIELDS:
                if f in data:
                    v = data.get(f)
                    if not isinstance(v, list):
                        return jsonify(response={'message': f'{f} must be a list.'}, status=400, bool=False)
                    v = [str(x) for x in v]
                    if f == 'target_exams':
                        v = _exams_for_stage(user_id, v)
                    payload[f] = json.dumps(v)
                else:
                    payload[f] = None

            year = data.get('admission_year')
            if year not in (None, ''):
                try:
                    year = int(year)
                except (TypeError, ValueError):
                    return jsonify(response={'message': 'admission_year must be a year.'}, status=400, bool=False)
            else:
                year = None

            category = (data.get('reservation_category') or '').strip().lower() or None
            if category and category not in VALID_CATEGORIES:
                return jsonify(response={'message': 'Unknown reservation category.'}, status=400, bool=False)

            budget = data.get('budget_max')
            budget = int(budget) if str(budget or '').isdigit() else None

            # ── SP: sp_student_goals_upsert ──────────────────────────────────
            call_proc('sp_student_goals_upsert', user_id,
                      payload['target_exams'], payload['target_courses'],
                      payload['target_states'], payload['target_cities'],
                      payload['target_college_ids'],
                      year, category, budget)
            db.session.commit()

            saved = call_proc_one('sp_student_goals_get', user_id)
            return jsonify(response={'message': 'Goals saved.', 'goals': _goals_dict(saved)},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /profile/goals error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)
