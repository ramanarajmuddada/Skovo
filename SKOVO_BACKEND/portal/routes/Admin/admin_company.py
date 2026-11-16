"""Admin › Support › Company — the registered business details.

These used to live in Skovo/src/config/company.js, so confirming an address or
naming the grievance officer meant a code change and a deploy. They are now one
row (company_details.id = 1) that the legal, contact and footer pages read
through /public/company. An empty field stays "To confirm" on those pages.
"""
import re

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from flask_restx import Resource

from portal.helpers.admin_auth import AREA_OPS, can
from portal.helpers.audit import log_audit
from portal.helpers.error_capture import capture_error
from portal.helpers.sp import call_proc_one
from portal.helpers.support import is_email, is_phone
from portal.models import db
from . import ns, logger

# field -> (max length, label)
FIELDS = {
    'legal_name':         (200, 'Registered company name'),
    'support_email':      (255, 'Support email'),
    'phone':              (30,  'Phone'),
    'registered_address': (400, 'Registered address'),
    'gstin':              (20,  'GSTIN'),
    'grievance_officer':  (120, 'Grievance Officer name'),
    'grievance_email':    (255, 'Grievance email'),
    'jurisdiction':       (200, 'Jurisdiction'),
    'support_hours':      (120, 'Support hours'),
}
GSTIN_RE = re.compile(r'^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$')


def serialize_company(r):
    r = r or {}
    out = {k: (r.get(k) or '') for k in FIELDS}
    out['updated_at'] = r['updated_at'].isoformat() if r.get('updated_at') else None
    return out


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


@ns.route('/company-details')
class AdminCompanyDetails(Resource):
    @jwt_required()
    def get(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            return jsonify(response=serialize_company(call_proc_one('sp_company_details_get')),
                           status=200, bool=True)
        except Exception as e:
            return _err('GET company details', e)

    @jwt_required()
    def put(self):
        try:
            if not can(AREA_OPS):
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            d = request.get_json() or {}
            vals = {k: str(d.get(k) or '').strip() for k in FIELDS}
            errors = {}
            for k, (mx, label) in FIELDS.items():
                if len(vals[k]) > mx:
                    errors[k] = f'{label} must be {mx} characters or fewer.'
            for k in ('support_email', 'grievance_email'):
                if vals[k] and not is_email(vals[k]):
                    errors[k] = 'Enter a valid email address.'
            if vals['phone'] and not is_phone(vals['phone']):
                errors['phone'] = 'Enter a valid phone number.'
            if vals['gstin'] and not GSTIN_RE.match(vals['gstin'].upper()):
                errors['gstin'] = 'GSTIN must be 15 characters, e.g. 37ABCDE1234F1Z5.'
            if errors:
                return jsonify(response={'message': next(iter(errors.values())), 'errors': errors},
                               status=400, bool=False)

            admin = get_jwt_identity()
            r = call_proc_one('sp_company_details_update',
                              vals['legal_name'], vals['support_email'], vals['phone'],
                              vals['registered_address'], vals['gstin'], vals['grievance_officer'],
                              vals['grievance_email'], vals['jurisdiction'], vals['support_hours'], admin)
            db.session.commit()
            log_audit('company_details_updated', 'company_details', '1', admin,
                      {k: v for k, v in vals.items() if v})
            return jsonify(response={**serialize_company(r), 'message': 'Company details saved.'},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT company details', e)
