from portal.helpers.error_capture import capture_error
from portal.helpers.helpers import serialize_datetime
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from . import ns, logger
from portal.helpers.admin_auth import can, AREA_CONTENT


def _require_admin():
    """This module lives in the 'content' area — see portal/helpers/admin_auth."""
    return can(AREA_CONTENT)


def _dict(r):
    if not r:
        return None
    created_at = r.get('created_at')
    return {
        'id': r.get('id'), 'exam_type': r.get('exam_type'), 'year': r.get('year'),
        'marks_obtained': r.get('marks_obtained'), 'total_marks': r.get('total_marks'),
        'marks_percentage': r.get('marks_percentage'), 'rank_obtained': r.get('rank_obtained'),
        'category': r.get('category'), 'state': r.get('state'), 'data_source': r.get('data_source'),
        'created_at': serialize_datetime(created_at) if created_at else None,
    }


@ns.route('/cg/rank-data')
class AdminCGRankDataList(Resource):
    @jwt_required()
    def get(self):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            exam_type = request.args.get('exam_type', '')
            year      = request.args.get('year', type=int)
            page      = request.args.get('page', 1, type=int)
            per_page  = request.args.get('per_page', 50, type=int)

            # ── SP: sp_cg_rank_data_list — no exam_type/year filters on the
            # generic CRUD proc, so pull a bounded batch and filter here. ────
            rows = call_proc('sp_cg_rank_data_list', 20000, 0)
            if exam_type:
                rows = [r for r in rows if r.get('exam_type') == exam_type]
            if year:
                rows = [r for r in rows if r.get('year') == year]
            rows.sort(key=lambda r: r.get('rank_obtained') if r.get('rank_obtained') is not None else 0)

            total = len(rows)
            pages = (total + per_page - 1) // per_page if per_page else 1
            start = (page - 1) * per_page
            page_rows = rows[start:start + per_page]

            return jsonify(
                response={'records': [_dict(r) for r in page_rows]},
                pagination={'total': total, 'pages': pages, 'page': page},
                status=200, bool=True
            )
        except Exception as e:
            logger.error(f"CG GET /rank-data: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        """Accepts a single record or a list of records for bulk insert."""
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            body = request.get_json() or {}
            rows = body if isinstance(body, list) else [body]
            admin_id = get_jwt_identity()
            added = 0
            # ── SP: sp_cg_rank_data_create ─────────────────────────────────────
            for d in rows:
                if not d.get('exam_type') or not d.get('year') or d.get('rank_obtained') is None:
                    continue
                call_proc(
                    'sp_cg_rank_data_create',
                    str(uuid.uuid4()), d['exam_type'], d['year'], d.get('marks_obtained', 0),
                    d.get('total_marks'), d.get('marks_percentage'), d['rank_obtained'],
                    d.get('category'), d.get('state', 'Andhra Pradesh'), d.get('data_source'),
                    admin_id, admin_id,
                )
                added += 1
            db.session.commit()
            return jsonify(response={'message': f'{added} record(s) added.'}, status=201, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG POST /rank-data: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/cg/rank-data/<string:rid>')
class AdminCGRankDataDetail(Resource):
    @jwt_required()
    def delete(self, rid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_rank_data_get + _delete (hard delete) ────────────────
            existing = call_proc_one('sp_cg_rank_data_get', rid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            call_proc('sp_cg_rank_data_delete', rid)
            db.session.commit()
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG DELETE /rank-data/{rid}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, rid):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            # ── SP: sp_cg_rank_data_get + _update (full replace) ───────────────
            existing = call_proc_one('sp_cg_rank_data_get', rid)
            if not existing:
                return jsonify(response={'message': 'Not found.'}, status=404, bool=False)
            d = request.get_json() or {}

            def val(key):
                return d[key] if key in d else existing.get(key)

            admin_id = get_jwt_identity()
            call_proc_one(
                'sp_cg_rank_data_update',
                rid, val('exam_type'), val('year'), val('marks_obtained'), val('total_marks'),
                val('marks_percentage'), val('rank_obtained'), val('category'), val('state'),
                val('data_source'), existing.get('created_by'), admin_id,
            )
            db.session.commit()
            return jsonify(response={'message': 'Updated.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback(); logger.error(f"CG PUT /rank-data/{rid}: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)}, status=500, bool=False)


@ns.route('/cg/rank-data/predict-rank')
class AdminCGRankPredict(Resource):
    @jwt_required()
    def get(self):
        """Predict rank from marks using historical data."""
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        try:
            marks    = request.args.get('marks', type=float)
            exam_type = request.args.get('exam_type', 'EAMCET')
            year     = request.args.get('year', type=int, default=2024)
            if marks is None:
                return jsonify(response={'message': 'marks parameter required.'}, status=400, bool=False)

            # ── SP: sp_cg_rank_data_list — no range-filter proc exists, so pull
            # a bounded batch and apply the ±5-mark window in Python. ─────────
            rows = call_proc('sp_cg_rank_data_list', 20000, 0)
            records = [
                r for r in rows
                if r.get('exam_type') == exam_type and r.get('year') == year
                and r.get('marks_obtained') is not None
                and (marks - 5) <= r['marks_obtained'] <= (marks + 5)
            ]
            records.sort(key=lambda r: r['marks_obtained'], reverse=True)
            records = records[:10]

            if records:
                ranks = [r['rank_obtained'] for r in records]
                est_rank = int(sum(ranks) / len(ranks))
                return jsonify(response={'estimated_rank': est_rank, 'sample_size': len(ranks),
                    'rank_range': {'min': min(ranks), 'max': max(ranks)}}, status=200, bool=True)
            return jsonify(response={'message': 'Not enough data for this marks range.', 'estimated_rank': None}, status=200, bool=True)
        except Exception as e:
            logger.error(f"CG GET /rank-data/predict-rank: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
