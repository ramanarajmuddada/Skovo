"""
Bulk CSV import for the catalogue: colleges, college courses, cutoffs.

These three tables are what turn this from a one-state product into a national
one, and they arrive as spreadsheets — from AICTE / UGC / NIRF and the
counselling authorities — which get corrected and re-sent. So:

  * every import is an idempotent upsert on the row's natural identity, and
  * one bad row is reported, not fatal — a single typo must not reject 5,000
    good rows.

`dry_run` validates and reports without writing, which is how you check a file
before it touches live data.
"""
import csv
import io

from portal.helpers.error_capture import capture_error
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc_one
from . import ns, logger

MAX_ROWS = 20000


def _require_admin():
    claims = get_jwt() or {}
    return claims.get('role') in ('admin', 'super_admin') or claims.get('is_admin')


def _num(v, cast=int):
    """Blank cells stay NULL rather than becoming 0 — an unknown fee is not a
    free college, and an unknown rank is not rank 0."""
    if v is None:
        return None
    s = str(v).strip().replace(',', '')
    if s == '' or s.lower() in ('na', 'n/a', '-', 'null'):
        return None
    try:
        return cast(float(s)) if cast is int else cast(s)
    except (TypeError, ValueError):
        return None


def _txt(v):
    if v is None:
        return None
    s = str(v).strip()
    return s or None


# entity → (required headers, optional headers, row handler)
def _import_college(r, user_id):
    return call_proc_one(
        'sp_college_import_upsert',
        _txt(r.get('name')), _txt(r.get('type')), _txt(r.get('city')), _txt(r.get('state')),
        _num(r.get('nirf_ranking')), _txt(r.get('naac_grade')),
        _num(r.get('annual_fees_min'), float), _num(r.get('annual_fees_max'), float),
        _txt(r.get('website_url')), _txt(r.get('about')),
        _num(r.get('established_year')), user_id)


def _import_course(r, user_id):
    return call_proc_one(
        'sp_college_course_import_upsert',
        _txt(r.get('college_name')), _txt(r.get('city')),
        _txt(r.get('course_name')), _txt(r.get('branch_code')),
        _txt(r.get('degree_type')), _num(r.get('duration_years'), float),
        _num(r.get('total_seats')), _num(r.get('annual_fee'), float), user_id)


def _import_cutoff(r, user_id):
    return call_proc_one(
        'sp_cutoff_import_upsert',
        _txt(r.get('college_name')), _txt(r.get('city')), _txt(r.get('state')),
        _txt(r.get('college_type')), _txt(r.get('branch_code')), _txt(r.get('branch_name')),
        _txt(r.get('exam_type')), _num(r.get('year')), _txt(r.get('category')),
        _txt(r.get('gender')), _num(r.get('opening_rank')), _num(r.get('closing_rank')),
        _num(r.get('total_seats')), _txt(r.get('source')), user_id)


ENTITIES = {
    'colleges': {
        'required': ['name', 'city'],
        'optional': ['type', 'state', 'nirf_ranking', 'naac_grade', 'annual_fees_min',
                     'annual_fees_max', 'website_url', 'about', 'established_year'],
        'handler': _import_college,
    },
    'college_courses': {
        'required': ['college_name', 'course_name'],
        'optional': ['city', 'branch_code', 'degree_type', 'duration_years',
                     'total_seats', 'annual_fee'],
        'handler': _import_course,
    },
    'cutoffs': {
        # Year and category are required because a cutoff without them cannot be
        # compared to anything, and a student would still read it as advice.
        'required': ['college_name', 'branch_name', 'exam_type', 'year', 'category', 'closing_rank'],
        'optional': ['city', 'state', 'college_type', 'branch_code', 'gender',
                     'opening_rank', 'total_seats', 'source'],
        'handler': _import_cutoff,
    },
}


def _read_csv():
    """Accept either a multipart file or a raw CSV string in JSON."""
    if 'file' in request.files:
        raw = request.files['file'].read().decode('utf-8-sig', errors='replace')
    else:
        body = request.get_json(silent=True) or {}
        raw = body.get('csv') or ''
    return raw


@ns.route('/import/<string:entity>')
class AdminBulkImport(Resource):

    @ns.doc(description=(
        'Bulk CSV import. entity = colleges | college_courses | cutoffs.\n\n'
        'Send a multipart `file`, or JSON {"csv": "...", "dry_run": true}. '
        'Upserts on natural identity, so re-importing a corrected file updates '
        'rather than duplicates. Bad rows are reported with their line number; '
        'the rest still import.'
    ))
    @jwt_required()
    def post(self, entity):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)

        spec = ENTITIES.get(entity)
        if not spec:
            return jsonify(response={'message': f'Unknown import type. Use one of: {", ".join(ENTITIES)}.'},
                           status=400, bool=False)

        try:
            raw = _read_csv()
            if not raw.strip():
                return jsonify(response={'message': 'No CSV content received.'}, status=400, bool=False)

            body = request.get_json(silent=True) or {}
            dry_run = bool(body.get('dry_run')) or request.args.get('dry_run') == '1'

            reader = csv.DictReader(io.StringIO(raw))
            headers = [h.strip().lower() for h in (reader.fieldnames or [])]
            missing = [h for h in spec['required'] if h not in headers]
            if missing:
                return jsonify(response={
                    'message': f"CSV is missing required column(s): {', '.join(missing)}.",
                    'required': spec['required'], 'optional': spec['optional'], 'found': headers,
                }, status=400, bool=False)

            user_id = get_jwt_identity()
            counts = {'created': 0, 'updated': 0, 'skipped': 0}
            errors = []

            for i, row in enumerate(reader, start=2):        # line 1 is the header
                if i - 1 > MAX_ROWS:
                    errors.append({'row': i, 'error': f'File exceeds {MAX_ROWS} rows — split it.'})
                    break

                clean = {(k or '').strip().lower(): v for k, v in row.items()}
                blank = [h for h in spec['required'] if not _txt(clean.get(h))]
                if blank:
                    counts['skipped'] += 1
                    if len(errors) < 100:
                        errors.append({'row': i, 'error': f"empty required field(s): {', '.join(blank)}"})
                    continue

                if dry_run:
                    counts['created'] += 1        # "would import"
                    continue

                try:
                    res = spec['handler'](clean, user_id) or {}
                    outcome = res.get('outcome')
                    if outcome in counts:
                        counts[outcome] += 1
                    else:
                        counts['skipped'] += 1
                        if len(errors) < 100:
                            errors.append({'row': i, 'error': outcome or 'unknown failure'})
                except Exception as row_error:      # one bad row must not kill the file
                    db.session.rollback()
                    counts['skipped'] += 1
                    if len(errors) < 100:
                        errors.append({'row': i, 'error': str(row_error)[:200]})

            if not dry_run:
                db.session.commit()

            total = sum(counts.values())
            return jsonify(response={
                'entity': entity,
                'dry_run': dry_run,
                'rows_read': total,
                'created': counts['created'],
                'updated': counts['updated'],
                'skipped': counts['skipped'],
                'errors': errors,
                'message': (
                    f"Validated {total} row(s) — {counts['skipped']} would be skipped."
                    if dry_run else
                    f"Imported {counts['created']} new, updated {counts['updated']}, skipped {counts['skipped']}."
                ),
            }, status=200, bool=True)

        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /import/{entity} error: {e}")
            return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                           status=500, bool=False)


@ns.route('/import/<string:entity>/template')
class AdminImportTemplate(Resource):
    @ns.doc(description='The exact CSV header row this importer expects, with one example row.')
    @jwt_required()
    def get(self, entity):
        if not _require_admin():
            return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
        spec = ENTITIES.get(entity)
        if not spec:
            return jsonify(response={'message': 'Unknown import type.'}, status=400, bool=False)
        return jsonify(response={
            'entity': entity,
            'required': spec['required'],
            'optional': spec['optional'],
            'header_row': ','.join(spec['required'] + spec['optional']),
        }, status=200, bool=True)
