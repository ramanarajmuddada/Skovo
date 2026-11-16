"""Admin — school / college list clean-up and rank-data review (feature-updates.md §16).

GET  /institutions?q=&min=2          spellings in use, with student counts
POST /institutions/merge             {canonical, variants: [...]}  rename everywhere + remember
GET  /institutions/aliases
GET/PUT /platform-settings           rank_data_due (MM-DD), mark rank data reviewed today
"""
from portal.helpers.error_capture import capture_error
import re
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy import text, bindparam
from portal.models import db
from portal.helpers.admin_auth import can, AREA_CONTENT
from portal.helpers.audit import log_audit
from . import ns, logger


def _denied():
    return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _norm(s):
    """'Z.P. High School, Vizag' ~ 'zp high school vizag' — used to suggest groups."""
    s = re.sub(r'[^a-z0-9 ]', ' ', (s or '').lower())
    s = re.sub(r'\b(zphs)\b', 'zp high school', s)
    return ' '.join(s.split())


@ns.route('/institutions')
class AdminInstitutions(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            q = (request.args.get('q') or '').strip()
            rows = db.session.execute(text(
                "SELECT name, COUNT(*) AS students FROM ("
                "  SELECT NULLIF(TRIM(school_name), '') AS name FROM user_profiles "
                "  UNION ALL SELECT NULLIF(TRIM(college_name), '') FROM user_profiles) x "
                "WHERE name IS NOT NULL AND (:q = '' OR name LIKE CONCAT('%', :q, '%')) "
                "GROUP BY name ORDER BY students DESC LIMIT 500"), {'q': q}).mappings().all()
            groups = {}
            for r in rows:
                groups.setdefault(_norm(r['name']), []).append({'name': r['name'], 'students': int(r['students'])})
            suggestions = [{'key': k, 'spellings': v, 'students': sum(x['students'] for x in v)}
                           for k, v in groups.items() if len(v) > 1]
            return jsonify(response={'institutions': [{'name': r['name'], 'students': int(r['students'])} for r in rows],
                                     'merge_suggestions': sorted(suggestions, key=lambda s: -s['students'])},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET /admin/institutions', e)


@ns.route('/institutions/merge')
class AdminInstitutionsMerge(Resource):
    @jwt_required()
    def post(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            d = request.get_json() or {}
            canonical = (d.get('canonical') or '').strip()[:200]
            variants = [str(v).strip()[:200] for v in (d.get('variants') or []) if str(v).strip() and str(v).strip() != canonical]
            if not canonical or not variants:
                return jsonify(response={'message': 'Give the correct name and the spellings to merge into it.'},
                               status=400, bool=False)
            admin = get_jwt_identity()
            p = {'c': canonical, 'v': variants}
            n1 = db.session.execute(text("UPDATE user_profiles SET school_name = :c WHERE school_name IN :v")
                                    .bindparams(bindparam('v', expanding=True)), p).rowcount
            n2 = db.session.execute(text("UPDATE user_profiles SET college_name = :c WHERE college_name IN :v")
                                    .bindparams(bindparam('v', expanding=True)), p).rowcount
            n3 = db.session.execute(text("UPDATE student_stages SET institute = :c WHERE institute IN :v")
                                    .bindparams(bindparam('v', expanding=True)), p).rowcount
            for v in variants:
                db.session.execute(text(
                    "INSERT INTO institution_aliases (variant, canonical, created_by) VALUES (:v, :c, :a) "
                    "ON DUPLICATE KEY UPDATE canonical = :c"), {'v': v, 'c': canonical, 'a': admin})
            db.session.commit()
            log_audit('institutions_merged', 'institution_aliases', canonical, admin,
                      {'variants': variants, 'profiles': n1 + n2, 'stages': n3})
            return jsonify(response={'message': f'Merged {len(variants)} spelling(s) into "{canonical}".',
                                     'profiles_updated': n1 + n2, 'stages_updated': n3}, status=200, bool=True)
        except Exception as e:
            return _err('POST /admin/institutions/merge', e)


@ns.route('/institutions/aliases')
class AdminInstitutionAliases(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            rows = db.session.execute(text("SELECT variant, canonical, created_at FROM institution_aliases "
                                           "ORDER BY canonical, variant")).mappings().all()
            return jsonify(response={'aliases': [{'variant': r['variant'], 'canonical': r['canonical']} for r in rows]},
                           status=200, bool=True)
        except Exception as e:
            return _err('GET aliases', e)


@ns.route('/platform-settings')
class AdminPlatformSettings(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            r = db.session.execute(text("SELECT rank_data_due, rank_data_reviewed_on FROM platform_settings WHERE id = 1")
                                   ).mappings().first() or {}
            return jsonify(response={'rank_data_due': r.get('rank_data_due'),
                                     'rank_data_reviewed_on': r['rank_data_reviewed_on'].isoformat()
                                     if r.get('rank_data_reviewed_on') else None}, status=200, bool=True)
        except Exception as e:
            return _err('GET platform settings', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_CONTENT):
                return _denied()
            d = request.get_json() or {}
            admin = get_jwt_identity()
            if d.get('rank_data_due'):
                if not re.fullmatch(r'(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])', str(d['rank_data_due'])):
                    return jsonify(response={'message': 'Date must be MM-DD.'}, status=400, bool=False)
                db.session.execute(text("UPDATE platform_settings SET rank_data_due = :d, updated_by = :a WHERE id = 1"),
                                   {'d': d['rank_data_due'], 'a': admin})
            if d.get('mark_rank_data_reviewed'):
                db.session.execute(text("UPDATE platform_settings SET rank_data_reviewed_on = UTC_DATE(), updated_by = :a "
                                        "WHERE id = 1"), {'a': admin})
                db.session.execute(text("UPDATE admin_alerts SET status = 'closed', closed_by = :a, closed_at = UTC_TIMESTAMP() "
                                        "WHERE kind = 'rank_data_review' AND status = 'open'"), {'a': admin})
            db.session.commit()
            log_audit('platform_settings_updated', 'platform_settings', '1', admin, d)
            return self.get()
        except Exception as e:
            return _err('PUT platform settings', e)
