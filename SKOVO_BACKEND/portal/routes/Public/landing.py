from flask import jsonify
from flask_restx import Resource

from portal.helpers.error_capture import capture_error
from portal.helpers.sp import call_proc, call_proc_one

from . import ns, logger


def _num(v):
    """Decimal/None -> int when whole, float otherwise (JSON-friendly)."""
    if v is None:
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


@ns.route('/company')
class PublicCompany(Resource):
    """Registered business details for the legal / contact pages and footer
    (Admin › Support › Company). Empty fields come back as '' = not confirmed."""
    @ns.doc(description='Public: company details for the legal and contact pages.')
    def get(self):
        try:
            from portal.routes.Admin.admin_company import serialize_company
            return jsonify(response=serialize_company(call_proc_one('sp_company_details_get')),
                           status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /public/company: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/landing')
class PublicLanding(Resource):
    """What skovoai.com shows, read from the same tables Admin edits.

    The homepage used to carry these as literals -- sample cohorts, "30+
    achievers", "+5 for a cohort" -- so an Admin change never reached it and
    the page promised things the platform did not do. Unauthenticated and
    narrow: upcoming cohort cards, two headline counts, and the active Score
    Engine actions. Nothing about any individual user.
    """
    @ns.doc(description='Public: upcoming cohorts, headline counts and score actions for the landing page.')
    def get(self):
        try:
            cohorts = [{
                'id': c['id'],
                'title': c['title'],
                'session_date': c['session_date'].isoformat() + 'Z' if c.get('session_date') else None,
                'duration_minutes': c.get('duration_minutes'),
                'price': _num(c.get('price')) or 0,
                'total_seats': c.get('total_seats'),
                'seats_left': c.get('seats_left'),
                'host': ' · '.join(x for x in (c.get('host_designation'), c.get('host_company')) if x) or None,
            } for c in call_proc('sp_public_upcoming_cohorts', 3)]

            counts = call_proc_one('sp_public_counts') or {}
            rules = [{
                'event_type': r['event_type'],
                'label': r['label'],
                'points': _num(r['points']),
                'cap_type': r.get('cap_type'),
            } for r in call_proc('sp_public_score_rules', 16)]

            return jsonify(response={
                'cohorts': cohorts,
                'counts': {
                    'verified_achievers': int(counts.get('verified_achievers') or 0),
                    'students': int(counts.get('students') or 0),
                    'min_upcoming_price': _num(counts.get('min_upcoming_price')),
                    'upcoming_cohorts': int(counts.get('upcoming_cohorts') or 0),
                    'colleges': int(counts.get('colleges') or 0),
                    'open_opportunities': int(counts.get('open_opportunities') or 0),
                    'communities': int(counts.get('communities') or 0),
                },
                'score_rules': rules,
                # Admin › Platform settings › Landing FAQs.
                'faqs': [{'id': f['id'], 'question': f['question'], 'answer': f['answer']}
                         for f in call_proc('sp_site_faqs_public')],
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /public/landing: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
