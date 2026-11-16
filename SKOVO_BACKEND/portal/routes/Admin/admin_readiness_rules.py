from portal.helpers.error_capture import capture_error
import uuid
from flask import jsonify, request
from flask_restx import Resource, reqparse
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from sqlalchemy import text
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_SCORE
from portal.helpers.helpers import OPPORTUNITY_HUB_MIN_SCORE, serialize_datetime


def _int(v, default=None):
    try:
        return int(v) if v not in (None, '', 'null') else default
    except (ValueError, TypeError):
        return default


update_parser = reqparse.RequestParser()
update_parser.add_argument('opportunity_unlock_score', type=str, location='json', required=False)
# Decay and pause were read by the nightly job and shown read-only, but no
# endpoint accepted them -- the only way to change how fast a score fell was
# to edit the row by hand.
update_parser.add_argument('decay_grace_days',      type=str, location='json', required=False)
update_parser.add_argument('decay_interval_days', type=str, location='json', required=False)
update_parser.add_argument('decay_restore_percent', type=str, location='json', required=False)
update_parser.add_argument('decay_per_day',         type=str, location='json', required=False)
update_parser.add_argument('pause_tokens_per_year', type=str, location='json', required=False)
update_parser.add_argument('pause_days',            type=str, location='json', required=False)


def _get_or_create_rules():
    # ── SP: sp_readiness_rules_list + _create — this is a singleton table
    # (one row of scoring config), auto-created with defaults if absent. ────
    rows = call_proc('sp_readiness_rules_list', 1, 0)
    if rows:
        return rows[0]
    admin_id = get_jwt_identity()
    # The Hub gate default is the spec floor, not a number typed here. Seeding
    # it at 65 is what put the live config four points above every screen that
    # counts down to it, so a student who reached 60 was still refused.
    rules = call_proc_one(
        'sp_readiness_rules_create',
        str(uuid.uuid4()), OPPORTUNITY_HUB_MIN_SCORE,
        admin_id, admin_id,
    )
    db.session.commit()
    return rules


def _rules_dict(r):
    updated_at = r.get('updated_at')
    return {
        'opportunity_unlock_score': r.get('opportunity_unlock_score'),
        'decay_grace_days': r.get('decay_grace_days'),
        'decay_per_day': r.get('decay_per_day'),
        'decay_interval_days': r.get('decay_interval_days'),
        'decay_restore_percent': r.get('decay_restore_percent'),
        'pause_tokens_per_year': r.get('pause_tokens_per_year'),
        'pause_days': r.get('pause_days'),
        'updated_at': serialize_datetime(updated_at) if updated_at else None,
    }


@ns.route('/readiness-levels')
class AdminReadinessLevels(Resource):
    """The named bands a score falls into.

    Was three literals hardcoded in sp_score_recalc and eight other files, which
    fixed the count at three and named the top one "Achiever" -- already the
    mentor role. Rows now, so any number of levels works and renaming one is a
    field, not a deploy.
    """

    @jwt_required()
    def get(self):
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            rows = db.session.execute(text(
                "SELECT id, label, min_score FROM readiness_levels "
                "WHERE is_active = 1 ORDER BY min_score"
            )).mappings().all()
            return jsonify(response={'levels': [dict(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/readiness-levels: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self):
        """Replace the whole set. Sent as a list because the levels only make
        sense together -- saving one at a time can leave two bands claiming the
        same score, or a gap with no level at all."""
        try:
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            levels = (request.get_json() or {}).get('levels')
            if not isinstance(levels, list) or not levels:
                return jsonify(response={'message': 'Send at least one level.'}, status=400, bool=False)
            if len(levels) > 10:
                return jsonify(response={'message': 'Up to 10 levels.'}, status=400, bool=False)

            cleaned, seen = [], set()
            for lv in levels:
                label = (str(lv.get('label') or '')).strip()
                score = _int(lv.get('min_score'))
                if not label or len(label) > 40:
                    return jsonify(response={'message': 'Every level needs a name, up to 40 characters.'},
                                   status=400, bool=False)
                if score is None or not (0 <= score <= 100):
                    return jsonify(response={'message': f'"{label}" needs a score from 0 to 100.'},
                                   status=400, bool=False)
                if score in seen:
                    return jsonify(response={'message': f'Two levels both start at {score}.'},
                                   status=400, bool=False)
                seen.add(score)
                cleaned.append((label, score))

            # Somebody has to hold the bottom, or a score of 0 has no level.
            if min(s for _, s in cleaned) != 0:
                return jsonify(response={'message': 'The lowest level must start at 0.'},
                               status=400, bool=False)

            cleaned.sort(key=lambda x: x[1])

            # The top level has to reach the Opportunity Hub gate. Without this
            # the highest level a student can earn still leaves the Hub locked:
            # the screen calls them ready and the product disagrees. The two
            # numbers are set on different cards, so nothing else would catch it.
            gate = db.session.execute(text(
                "SELECT opportunity_unlock_score FROM readiness_rules LIMIT 1"
            )).scalar()
            if gate is not None:
                top_label, top_score = cleaned[-1]
                if top_score < int(gate):
                    msg = ('"%s" starts at %d, but the Opportunity Hub only unlocks '
                           'at %d. Start the top level at %d or above, or lower the '
                           'unlock score first.' % (top_label, top_score, int(gate), int(gate)))
                    return jsonify(response={'message': msg}, status=400, bool=False)

            admin_id = get_jwt_identity()
            db.session.execute(text("DELETE FROM readiness_levels"))
            for i, (label, score) in enumerate(cleaned):
                db.session.execute(text(
                    "INSERT INTO readiness_levels (id, label, min_score, sort_order, is_active, updated_by) "
                    "VALUES (UUID(), :l, :s, :o, 1, :by)"
                ), {'l': label, 's': score, 'o': (i + 1) * 10, 'by': admin_id})
            db.session.commit()

            # Every stored score carries its level as text, so a rename leaves
            # old rows showing the old word until they are rebuilt.
            db.session.execute(text(
                "UPDATE readiness_scores r SET r.level = ("
                "  SELECT l.label FROM readiness_levels l"
                "   WHERE l.is_active = 1 AND l.min_score <= r.score"
                "   ORDER BY l.min_score DESC LIMIT 1)"
            ))
            db.session.commit()

            rows = db.session.execute(text(
                "SELECT id, label, min_score FROM readiness_levels ORDER BY min_score"
            )).mappings().all()
            return jsonify(response={'message': 'Levels saved.', 'levels': [dict(r) for r in rows]},
                           status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/readiness-levels: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/readiness-rules')
class AdminReadinessRules(Resource):
    @ns.doc(description='Admin: get readiness scoring rules for this institution (auto-created with defaults if absent).')
    @jwt_required()
    def get(self):
        try:
            claims = get_jwt()
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            rules = _get_or_create_rules()
            return jsonify(response=_rules_dict(rules), status=200, bool=True)

        except Exception as e:
            logger.error(f"Error in GET /admin/readiness-rules: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @ns.doc(description='Admin: update readiness scoring rules.')
    @jwt_required()
    def put(self):
        try:
            claims = get_jwt()
            if not can(AREA_SCORE):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

            rules = _get_or_create_rules()
            args = update_parser.parse_args(strict=False)

            def val(key):
                return _int(args[key]) if args.get(key) is not None else rules.get(key)

            new_gate = val('opportunity_unlock_score')
            top = db.session.execute(text(
                "SELECT label, min_score FROM readiness_levels "
                "WHERE is_active = 1 ORDER BY min_score DESC LIMIT 1"
            )).mappings().first()
            if new_gate is not None and top is not None and int(new_gate) > int(top['min_score']):
                msg = ('The Hub would unlock at %d, above the top level "%s" which '
                       'starts at %d. Raise that level under Level Thresholds first.'
                       % (int(new_gate), top['label'], int(top['min_score'])))
                return jsonify(response={'message': msg}, status=400, bool=False)

            admin_id = get_jwt_identity()
            # ── SP: sp_readiness_rules_update ─────────────────────────────────
            updated = call_proc_one(
                'sp_readiness_rules_update',
                rules['id'], val('opportunity_unlock_score'),
                val('decay_grace_days'), val('decay_per_day'),
                val('decay_interval_days'), val('decay_restore_percent'),
                val('pause_tokens_per_year'), val('pause_days'),
                rules.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Readiness rules updated.', 'rules': _rules_dict(updated)}, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"Error in PUT /admin/readiness-rules: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
