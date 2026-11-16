from portal.helpers.error_capture import capture_error
import json
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.education_pathways import filter_career_interests
from portal.helpers.storage import browser_url, delete_file, object_name
from portal.helpers import profile_cache
from portal.helpers.helpers import opportunity_hub_min_score
from . import ns, logger


def _as_list(v):
    """MySQL JSON column -> Python list (raw SQL returns it as a string)."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return []
    return v or []


def _as_date_str(v):
    """DATE column -> 'YYYY-MM-DD' for the frontend, None when unset."""
    if not v:
        return None
    return v.isoformat() if hasattr(v, 'isoformat') else str(v)

profile_parser = reqparse.RequestParser()
profile_parser.add_argument('full_name',                  type=str,  location='json', required=False)
profile_parser.add_argument('avatar_url',                 type=str,  location='json', required=False)
profile_parser.add_argument('phone',                      type=str,  location='json', required=False)
profile_parser.add_argument('gender',                     type=str,  location='json', required=False)
profile_parser.add_argument('city',                       type=str,  location='json', required=False)
profile_parser.add_argument('state',                      type=str,  location='json', required=False)
profile_parser.add_argument('career_interests',           type=list, location='json', required=False)
# Education — core
profile_parser.add_argument('education_level',            type=str,  location='json', required=False)
profile_parser.add_argument('education_category',         type=str,  location='json', required=False)
# School
profile_parser.add_argument('school_name',                type=str,  location='json', required=False)
profile_parser.add_argument('stream',                     type=str,  location='json', required=False)
# Board decides the stream vocabulary a school student is shown (MPC vs PCM).
profile_parser.add_argument('board',                      type=str,  location='json', required=False)
# ITI
profile_parser.add_argument('iti_trade',                  type=str,  location='json', required=False)
# UG / PG / Polytechnic
profile_parser.add_argument('college_name',               type=str,  location='json', required=False)
profile_parser.add_argument('degree_category',            type=str,  location='json', required=False)
profile_parser.add_argument('degree_type',                type=str,  location='json', required=False)
profile_parser.add_argument('branch',                     type=str,  location='json', required=False)
profile_parser.add_argument('year_of_study',              type=str,  location='json', required=False)
# Professional courses
profile_parser.add_argument('professional_course_type',   type=str,  location='json', required=False)
profile_parser.add_argument('professional_course_level',  type=str,  location='json', required=False)
# Exam aspirants
profile_parser.add_argument('exam_target',                type=str,  location='json', required=False)
# Working professionals
profile_parser.add_argument('working_industry',           type=str,  location='json', required=False)
profile_parser.add_argument('working_experience',         type=str,  location='json', required=False)
profile_parser.add_argument('working_role',               type=str,  location='json', required=False)


def _profile_dict(profile):
    if not profile:
        return {}
    g = profile.get
    return {
        'phone':                      g('phone'),
        'education_level':            g('education_level'),
        'education_category':         g('education_category'),
        'stream':                     g('stream'),
        'board':                      g('board'),
        'city':                       g('city'),
        'state':                      g('state'),
        'career_interests':           _as_list(g('career_interests')),
        'school_name':                g('school_name'),
        'iti_trade':                  g('iti_trade'),
        'college_name':               g('college_name'),
        'degree_category':            g('degree_category'),
        'degree_type':                g('degree_type'),
        'branch':                     g('branch'),
        'year_of_study':              g('year_of_study'),
        'professional_course_type':   g('professional_course_type'),
        'professional_course_level':  g('professional_course_level'),
        'exam_target':                g('exam_target'),
        'working_industry':           g('working_industry'),
        'working_experience':         g('working_experience'),
        'working_role':               g('working_role'),
    }


# Saving any of these can move a student to a new stage (helpers/stages.py).
_STAGE_FIELDS = ('education_category', 'year_of_study', 'board', 'stream', 'degree_category',
                 'degree_type', 'branch', 'school_name', 'college_name', 'state')

# Maps new education_category back to legacy education_level for compat.
# Reference copy only — the live derivation is the CASE inside sp_profile_upsert;
# keep the two in step when a category is added.
_CAT_TO_LEVEL = {
    'school_10th':        '10th',
    'school_11th':        '11th_12th',
    'school_12th':        '12th',
    'iti':                'diploma',
    'polytechnic':        'diploma',
    'ug':                 'ug',
    'professional_course':'ug',
    'pg':                 'graduated',
    'phd':                'graduated',
    'working':            'graduated',
    'govt_exam':          'ug',
    'entrance_exam':      '12th',
}


def _retire_old_avatar(user_id, old_url, new_url):
    """Delete the file a student's avatar just stopped pointing at.

    Best effort, never fatal. Replacing a photo only moves the pointer on the
    `users` row, so without this every avatar anyone has ever uploaded stays in
    the bucket for good. Mirrors `_retire_old_avatar` in the achiever portal.

    Guarded twice, because the alternative is destroying something
    irreplaceable. `storage.object_name` refuses anything that is not an
    /uploads/<name> URL this codebase produced, so an externally hosted avatar
    is left alone; and the file survives while any `document_vault` row still
    points at it — a student who also saved that image as a document must not
    lose the document because they changed their photo.

    Compared by stored name, not by string: the same file is held as
    "/uploads/x.png" on older rows and as an absolute URL on newer ones, and a
    string comparison reads those as two different files.
    """
    try:
        old_name = object_name(old_url)
        if not old_name or old_name == object_name(new_url):
            return
        still_used = db.session.execute(
            text("SELECT 1 FROM document_vault "
                 "WHERE file_url = :exact OR file_url LIKE :suffix LIMIT 1"),
            {'exact': old_url, 'suffix': f'%/{old_name}'},
        ).first()
        if still_used:
            logger.info(f"avatar {old_name} kept — still referenced by a document row")
            return
        if delete_file(old_url):
            logger.info(f"replaced avatar removed for user {user_id}: {old_name}")
    except Exception as e:
        # A stale file is untidy; a failed profile save is not acceptable.
        logger.warning(f"old avatar cleanup skipped for {user_id}: {e}")


@ns.route('/')
class MyProfile(Resource):
    @ns.doc(description='Get full profile with readiness score and career interests.')
    @jwt_required()
    def get(self):
        try:
            user_id = get_jwt_identity()
            user = call_proc_one('sp_users_get', user_id)
            if not user:
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            profile   = call_proc_one('sp_profile_get_by_user', user_id)
            skills    = call_proc('sp_user_skills_by_user', user_id)
            readiness = call_proc_one('sp_readiness_score_get', user_id)
            try:
                goals = call_proc_one('sp_student_goals_get', user_id) or {}
            except Exception:
                goals = {}
            r_score   = readiness['score'] if readiness else 0
            hub_min   = opportunity_hub_min_score()

            return jsonify(
                response={
                    'user_id':    user['id'],
                    'full_name':  user['full_name'],
                    'email':      user['email'],
                    # Normalised on read. Rows written before uploads returned
                    # an absolute URL still hold a bare "/uploads/<name>", which
                    # a browser resolves against the SPA and not the API: the
                    # catch-all answers index.html, the <img> fails to decode,
                    # and the student sees the default avatar over an upload
                    # that genuinely succeeded.
                    'avatar_url': browser_url(user['avatar_url']),
                    # DPDP fields live on users, not user_profiles — surfaced here
                    # so Profile can show the date of birth alongside the rest.
                    'date_of_birth':  _as_date_str(user.get('date_of_birth')),
                    'gender':         user.get('gender'),
                    'consent_status': user.get('consent_status') or 'granted',
                    'profile':    _profile_dict(profile),
                    # First-login Profile gate: reservation lives on goals, not
                    # user_profiles. Surfaced here so the shell can tell whether
                    # the student still has to finish Profile.
                    'reservation_category': goals.get('reservation_category'),
                    'skills':     [s['skill_name'] for s in skills],
                    'skills_detail': [{'id': s.get('id'), 'skill_name': s.get('skill_name')} for s in skills],
                    'readiness': {
                        'score':                    r_score,
                        'level':                    readiness['level'] if readiness else 'Explorer',
                        'cohorts_completed':        readiness['cohorts_completed'] if readiness else 0,
                        'tasks_completed':          readiness['tasks_completed'] if readiness else 0,
                        # The gate is config (readiness_rules), not a constant:
                        # hardcoding 60 here promised the Hub at a score the
                        # Opportunities screen would still refuse.
                        'opportunity_hub_unlocked': r_score >= hub_min,
                        'hub_min_score':            hub_min,
                        'points_to_hub':            max(0, hub_min - r_score),
                    }
                },
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"Error in GET /profile: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)

    @ns.doc(description='Update profile — full Indian education structure supported.')
    @jwt_required()
    def patch(self):
        try:
            user_id = get_jwt_identity()
            args = profile_parser.parse_args()

            current_user = call_proc_one('sp_users_get', user_id)
            if not current_user:
                return jsonify(response={'message': 'User not found.'}, status=404, bool=False)

            # The upsert proc COALESCEs NULL to keep existing values, but the
            # Clearing a field has to be asked for by name. The frontend
            # initialises untouched inputs as '', so treating '' as "clear"
            # would let a partial save wipe stored city/state/education — the
            # bug this guard was added for. `clear` states the intent instead:
            #
            #   {"clear": ["degree_type", "branch"]}
            #
            # which is what the Education card sends when a student changes
            # stage, so a 10th-class profile stops carrying a B.Tech.
            clear = request.get_json(silent=True) or {}
            clear = {str(k) for k in (clear.get('clear') or [])}

            def g(key):
                if key in clear:
                    return ''          # explicit: the procedure nulls it
                v = args.get(key)
                return None if isinstance(v, str) and v.strip() == '' else v

            ci = args.get('career_interests')
            if ci is not None:
                # Career interests are offered per education stage (see
                # portal/helpers/education_pathways.py). Filter against the stage
                # being written, falling back to the stored one when this is a
                # partial edit that does not touch education. Dropped rather than
                # rejected: a student whose level changed should not have an
                # unrelated profile save fail because of a stale interest.
                level = args.get('education_category')
                if not level:
                    current = call_proc_one('sp_profile_get_by_user', user_id) or {}
                    level = current.get('education_category')
                ci = filter_career_interests(level, ci)
            # ── SP: upsert user + profile (partial), derive education_level ────
            call_proc(
                'sp_profile_upsert',
                user_id,
                g('full_name'), g('avatar_url'),
                g('phone'), g('city'), g('state'),
                json.dumps(ci) if ci is not None else None,
                g('education_level'), g('education_category'),
                g('school_name'), g('stream'), g('iti_trade'),
                g('college_name'), g('degree_category'), g('degree_type'),
                g('branch'), g('year_of_study'),
                g('professional_course_type'), g('professional_course_level'),
                g('exam_target'),
                g('working_industry'), g('working_experience'), g('working_role'),
                g('board'),
            )

            # The Colleges list caches this profile for a few seconds to keep
            # paging off the database — drop it now so the education banner and
            # the personalised filter reflect this save immediately.
            profile_cache.invalidate(user_id)

            # Score signal: profile_completed (+5, once) becomes true at two
            # moments — the last vault folder being filled, and the profile
            # being finished. Only the first was wired, so a student who
            # uploaded all four documents before finishing their profile never
            # got the check re-run and never earned the points.
            from portal.helpers import score
            score.award_vault_complete(user_id)

            # Stages (feature-updates.md §2): a change of education stage closes
            # the old one (snapshot on the career timeline) and the score starts
            # again; a change inside the stage (11th -> 12th, new branch) only
            # updates its details. Only when education was part of this save.
            stage = None
            if any(args.get(k) is not None for k in _STAGE_FIELDS) or clear & set(_STAGE_FIELDS):
                from portal.helpers import stages
                stage = stages.sync_from_profile(user_id)
            # Gender lives on users (sent: set or clear; not sent: keep).
            if args.get('gender') is not None:
                from portal.helpers.gender import clean_gender
                gv, ok = clean_gender(args.get('gender'))
                if not ok:
                    return jsonify(response={'message': 'Pick a gender from the list.'}, status=400, bool=False)
                db.session.execute(text("UPDATE users SET gender = :g WHERE id = :u"), {'g': gv, 'u': user_id})
            db.session.commit()

            # None = not sent (keep), '' = cleared, otherwise the new URL.
            # Only after the commit: the previous file must not be removed while
            # the pointer to the new one could still roll back.
            new_avatar = g('avatar_url')
            if new_avatar is not None:
                _retire_old_avatar(user_id, current_user.get('avatar_url'), new_avatar)
                stored_avatar = browser_url(new_avatar) if new_avatar else None
            else:
                stored_avatar = browser_url(current_user.get('avatar_url'))

            return jsonify(response={
                'message': 'Profile updated successfully.',
                # 'promoted' tells the screen to show "new stage started".
                'stage': stage,
                # Echoed back so the client renders what was *stored*, not its
                # own copy of what it hoped was stored. The avatar step PATCHes
                # {avatar_url} on its own and previously trusted its own value.
                'avatar_url': stored_avatar,
            }, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PATCH /profile: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/skills')
class ProfileSkills(Resource):
    @ns.doc(description='Add a skill to the current user (manual, alongside assessment skills).')
    @jwt_required()
    def post(self):
        try:
            user_id = get_jwt_identity()
            data = request.get_json() or {}
            name = (data.get('skill_name') or '').strip()
            if not name:
                return jsonify(response={'message': 'skill_name is required.'}, status=400, bool=False)
            if len(name) > 100:
                return jsonify(response={'message': 'Skill name too long (max 100 chars).'}, status=400, bool=False)

            # ── SP: sp_user_skills_by_user — duplicate check (case-insensitive) ──
            existing = call_proc('sp_user_skills_by_user', user_id)
            if any((s.get('skill_name') or '').lower() == name.lower() for s in existing):
                return jsonify(response={'message': 'You already have this skill.'}, status=409, bool=False)

            new_id = str(uuid.uuid4())
            # ── SP: sp_user_skills_create ────────────────────────────────────
            call_proc('sp_user_skills_create', new_id, user_id, name, user_id, user_id)
            db.session.commit()
            return jsonify(response={'message': 'Skill added.', 'id': new_id, 'skill_name': name}, status=201, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in POST /profile/skills: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/skills/<string:skill_id>')
class ProfileSkillDetail(Resource):
    @ns.doc(description='Remove one of the current user\'s skills.')
    @jwt_required()
    def delete(self, skill_id):
        try:
            user_id = get_jwt_identity()
            # ── SP: sp_user_skills_by_user — ownership check before delete ──────
            mine = call_proc('sp_user_skills_by_user', user_id)
            if not any(s.get('id') == skill_id for s in mine):
                return jsonify(response={'message': 'Skill not found.'}, status=404, bool=False)
            # ── SP: sp_user_skills_delete ────────────────────────────────────
            call_proc('sp_user_skills_delete', skill_id)
            db.session.commit()
            return jsonify(response={'message': 'Skill removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in DELETE /profile/skills/{skill_id}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)
