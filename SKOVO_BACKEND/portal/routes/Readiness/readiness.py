from portal.helpers.error_capture import capture_error
import json
from flask import jsonify
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.helpers.sp import call_proc, call_proc_one
from portal.models import db
from . import ns, logger


def _as_obj(v):
    """MySQL JSON columns come back as strings over raw SQL — reparse to dict."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v

step_parser = reqparse.RequestParser()
step_parser.add_argument('step', type=int, location='json', required=True, help='Assessment step number: 1, 2, 3, or 4.')
step_parser.add_argument('step_data', type=dict, location='json', required=True, help='Step answers as a JSON object.')


# education_category → assessment bucket. Kept server-side, like the score
# unlocks in §9.2, so neither client has to know the mapping — and a category
# added later only has to be mapped in one place.
_CATEGORY_BUCKET = {
    'school_10th': 'school', 'school_11th': 'school', 'school_12th': 'school',
    'entrance_exam': 'school', 'dropper': 'school', 'gap_year': 'school',
    'iti': 'vocational', 'polytechnic': 'vocational',
    'ug': 'college', 'pg': 'college', 'phd': 'college',
    'professional_course': 'college', 'govt_exam': 'college',
    'working': 'working',
}
_DEFAULT_BUCKET = 'college'


def _bucket_for(profile):
    """Which set of questions this student should be asked.

    A 10th-class student cannot answer "have you done an internship" or claim
    Django as a skill, and the assessment carries 65 of the ~100 points that
    gate Opportunities at 60 — so asking the wrong questions does not just read
    oddly, it locks them out.
    """
    category = (profile or {}).get('education_category') or ''
    if category in _CATEGORY_BUCKET:
        return _CATEGORY_BUCKET[category]

    # Fall back on the legacy level for profiles predating education_category.
    level = ((profile or {}).get('education_level') or '').lower()
    if level in ('10th', '11th_12th', '12th'):
        return 'school'
    if level == 'diploma':
        return 'vocational'
    return _DEFAULT_BUCKET


def _options(mtype):
    # ── SP: sp_master_list — every dropdown has its own `master_<type>` table
    # now; the proc resolves the table through `master_registry`. ────────────
    rows = call_proc('sp_master_list', mtype, 1) or []
    return [{'value': r.get('value'), 'label': r.get('label')} for r in rows]


def _questions(mtype):
    """Step 2 / step 4 rows: value is `bool:field` or `count:field`, label is
    the question. The field names stay constant across buckets so scoring never
    has to care which wording the student saw."""
    out = []
    for row in _options(mtype):
        raw = row['value'] or ''
        kind, _, field = raw.partition(':')
        if not field:
            kind, field = 'bool', raw
        out.append({'kind': kind, 'field': field, 'label': row['label']})
    return out


@ns.route('/assessment/options')
class AssessmentOptions(Resource):
    @ns.doc(description='The assessment lists for this student, chosen by their education '
                        'stage: skills, career goals, and the step 2 / step 4 questions.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_profile_get_by_user ──────────────────────────────────
            profile = call_proc_one('sp_profile_get_by_user', user_id)
            bucket = _bucket_for(profile)

            return jsonify(response={
                'bucket': bucket,
                'skills':       _options(f'skill_{bucket}'),
                'career_goals': _options(f'career_goal_{bucket}'),
                'step2':        _questions(f'assessment_step2_{bucket}'),
                'step4':        _questions(f'assessment_step4_{bucket}'),
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /readiness/assessment/options error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/assessment')
class ReadinessAssessmentAPI(Resource):
    @ns.doc(
        description=(
            'Submit or update a step of the 4-step readiness assessment. '
            'Score auto-recalculates after each step. '
            'Completing all 4 steps awards up to 75 pts; each cohort attended adds 5 pts (max 25).'
        )
    )
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            args = step_parser.parse_args()
            step_num = args['step']
            step_data = args['step_data']

            if step_num not in (1, 2, 3, 4):
                return jsonify(response={'message': 'Step must be 1, 2, 3, or 4.'}, status=400, bool=False)

            if not isinstance(step_data, dict):
                return jsonify(response={'message': 'step_data must be a JSON object.'}, status=400, bool=False)

            # ── SP: upsert step, re-sync skills, recompute score (all in SQL) ──
            row = call_proc_one('sp_readiness_submit_step', user_id, step_num, json.dumps(step_data))
            steps_done = int(row['steps_completed']) if row else 0

            # Mirror the graded assessment total into the score ledger, then let
            # the engine restate the score so ledger-only points (documents,
            # applications, community activity) are included too.
            # ── SP: sp_score_set_assessment, sp_score_recalc ─────────────────
            assessment_points = int(row['assessment_points']) if row else 0
            call_proc_one('sp_score_set_assessment', user_id, assessment_points)
            recomputed = call_proc_one('sp_score_recalc', user_id) or {}
            db.session.commit()

            score = int(recomputed.get('score') or (row['current_score'] if row else 0))

            return jsonify(
                response={
                    'message': f'Step {step_num} saved successfully.',
                    'steps_completed': steps_done,
                    'total_steps': 4,
                    'progress_percent': int((steps_done / 4) * 100),
                    'assessment_points': assessment_points,
                    'cohort_points': int(row['cohort_points']) if row else 0,
                    'current_score': score,
                    'level': recomputed.get('level') or (row['level'] if row else 'Explorer'),
                    'assessment_complete': bool(row['assessment_complete']) if row else False,
                    'opportunity_hub_unlocked': score >= 60,
                },
                status=200, bool=True
            )
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /readiness/assessment: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Get current assessment progress and per-step completion status.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()

            # ── SP: per-step rows + current score ───────────────────────────
            steps = call_proc('sp_readiness_steps', user_id)
            completed = [s for s in steps if s['is_complete']]
            steps_map = {
                s['step']: {'is_complete': bool(s['is_complete']), 'step_data': _as_obj(s['step_data'])}
                for s in steps
            }

            readiness = call_proc_one('sp_readiness_score_get', user_id)
            score = readiness['score'] if readiness else 0
            level = readiness['level'] if readiness else 'Explorer'

            return jsonify(
                response={
                    'steps_completed': len(completed),
                    'total_steps': 4,
                    'progress_percent': int((len(completed) / 4) * 100),
                    'steps': steps_map,
                    'current_score': score,
                    'level': level,
                    'opportunity_hub_unlocked': score >= 60,
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /readiness/assessment: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
