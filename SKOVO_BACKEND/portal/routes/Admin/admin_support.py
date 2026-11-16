"""Admin — Support contacts and issues."""
import uuid

from flask import jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from flask_restx import Resource

from portal.helpers.admin_auth import AREA_OPS, can
from portal.helpers.audit import log_audit
from portal.helpers.error_capture import capture_error
from portal.helpers.notifications import notify_user
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers.support import (
    AUDIENCES, CATEGORIES, CHANNELS, PORTALS, STATUSES,
    audience_values, category_values, channel_values, portal_values,
    is_email, is_phone, phone_digits, safe_search,
    serialize_contact, serialize_issue,
)
from portal.models import db
from sqlalchemy import text

from . import ns, logger


def _require_admin():
    return can(AREA_OPS)


def _contact_payload(data, partial=False):
    audience = (data.get('audience') or '').strip().lower()
    channel = (data.get('channel') or '').strip().lower()
    value = (data.get('value') or '').strip()
    label = (data.get('label') or '').strip()
    hours = (data.get('hours') or '').strip() or None
    try:
        sort_order = int(data.get('sort_order') if data.get('sort_order') not in (None, '') else 0)
    except (TypeError, ValueError):
        sort_order = 0
    is_active = data.get('is_active')
    if is_active is None:
        is_active = 1
    else:
        is_active = 1 if is_active in (True, 1, '1', 'true', 'True') else 0

    if not partial or 'audience' in data:
        if audience not in audience_values():
            return None, 'Pick who sees this contact.'
    if not partial or 'channel' in data:
        if channel not in channel_values():
            return None, 'Channel must be email or phone.'
    if not value:
        return None, 'Enter an email address or phone number.'
    if len(value) > 255:
        return None, 'Value is too long.'
    if channel == 'email' and not is_email(value):
        return None, 'Enter a valid email address.'
    if channel == 'phone':
        digits = phone_digits(value)
        if not is_phone(digits):
            return None, 'Enter a valid phone number.'
        value = digits
    if not label or len(label) > 80:
        return None, 'Label must be 1 to 80 characters.'
    if hours and len(hours) > 120:
        return None, 'Hours must be 120 characters or fewer.'
    if sort_order < 0 or sort_order > 9999:
        return None, 'Sort order must be between 0 and 9999.'
    return {
        'audience': audience,
        'channel': channel,
        'value': value,
        'label': label,
        'hours': hours,
        'sort_order': sort_order,
        'is_active': is_active,
    }, None


@ns.route('/support/contacts')
class AdminSupportContacts(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            audience = (request.args.get('audience') or '').strip().lower()
            if audience and audience not in audience_values():
                audience = ''
            active_only = 1 if request.args.get('active') in ('1', 'true') else 0
            rows = call_proc('sp_support_contacts_list', audience or None, active_only) or []
            return jsonify(response={'contacts': [serialize_contact(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/support/contacts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            payload, err = _contact_payload(request.get_json() or {})
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            admin_id = str(get_jwt_identity())
            contact_id = str(uuid.uuid4())
            row = call_proc_one(
                'sp_support_contacts_create',
                contact_id, payload['audience'], payload['channel'], payload['value'],
                payload['label'], payload['hours'], payload['sort_order'], payload['is_active'],
                admin_id,
            )
            db.session.commit()
            log_audit(
                'support.contact.create', 'support_contact', contact_id,
                actor_id=admin_id,
                meta={'audience': payload['audience'], 'channel': payload['channel']},
            )
            return jsonify(response={'contact': serialize_contact(row)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /admin/support/contacts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/contacts/<string:contact_id>')
class AdminSupportContactOne(Resource):
    @jwt_required()
    def put(self, contact_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            current = call_proc_one('sp_support_contacts_get', contact_id)
            if not current:
                return jsonify(response={'message': 'Contact not found.'}, status=404, bool=False)
            data = request.get_json() or {}
            merged = {
                'audience': data.get('audience', current.get('audience')),
                'channel': data.get('channel', current.get('channel')),
                'value': data.get('value', current.get('value')),
                'label': data.get('label', current.get('label')),
                'hours': data.get('hours', current.get('hours')),
                'sort_order': data.get('sort_order', current.get('sort_order')),
                'is_active': data.get('is_active', current.get('is_active')),
            }
            payload, err = _contact_payload(merged)
            if err:
                return jsonify(response={'message': err}, status=400, bool=False)
            row = call_proc_one(
                'sp_support_contacts_update',
                contact_id, payload['audience'], payload['channel'], payload['value'],
                payload['label'], payload['hours'], payload['sort_order'], payload['is_active'],
            )
            db.session.commit()
            log_audit(
                'support.contact.update', 'support_contact', contact_id,
                actor_id=str(get_jwt_identity()),
                meta={'audience': payload['audience'], 'channel': payload['channel']},
            )
            return jsonify(response={'contact': serialize_contact(row)}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/support/contacts/{contact_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def delete(self, contact_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            call_proc('sp_support_contacts_delete', contact_id)
            db.session.commit()
            log_audit(
                'support.contact.delete', 'support_contact', contact_id,
                actor_id=str(get_jwt_identity()),
            )
            return jsonify(response={'message': 'Contact removed.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"DELETE /admin/support/contacts/{contact_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/issues')
class AdminSupportIssues(Resource):
    @jwt_required()
    def get(self):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            portal = (request.args.get('portal') or '').strip().lower()
            status = (request.args.get('status') or '').strip().lower()
            category = (request.args.get('category') or '').strip().lower()
            search = safe_search(request.args.get('q') or request.args.get('search'))
            try:
                page = max(1, int(request.args.get('page') or 1))
            except (TypeError, ValueError):
                page = 1
            try:
                per_page = min(100, max(1, int(request.args.get('per_page') or 20)))
            except (TypeError, ValueError):
                per_page = 20
            if portal and portal not in portal_values():
                portal = ''
            if status and status not in STATUSES:
                status = ''
            if category and category not in category_values():
                category = ''
            offset = (page - 1) * per_page
            # Date raised (IST days), for Solved / All: the procedure has no
            # date filter, so this path reads the table with the same filters.
            d_from = (request.args.get('date_from') or '').strip()[:10] or None
            d_to = (request.args.get('date_to') or '').strip()[:10] or None
            if d_from or d_to:
                where = ["1=1"]
                params = {'f': d_from or '2000-01-01', 't': d_to or '2999-12-31', 'lim': per_page, 'off': offset}
                where.append("DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) BETWEEN :f AND :t")
                if portal:
                    where.append("portal = :p"); params['p'] = portal
                if status:
                    where.append("status = :s"); params['s'] = status
                if category:
                    where.append("category = :c"); params['c'] = category
                if search:
                    where.append("(subject LIKE :q OR body LIKE :q OR contact_email LIKE :q)"); params['q'] = f"%{search}%"
                w = " AND ".join(where)
                total = db.session.execute(text(f"SELECT COUNT(*) FROM support_issues WHERE {w}"), params).scalar() or 0
                rows = [dict(r) for r in db.session.execute(text(
                    f"SELECT * FROM support_issues WHERE {w} ORDER BY created_at DESC LIMIT :lim OFFSET :off"),
                    params).mappings().all()]
            else:
                rows = call_proc(
                    'sp_support_issues_list',
                    portal or None, status or None, category or None,
                    search or None, per_page, offset,
                ) or []
                total = int(rows[0].get('total') or 0) if rows else 0
            from portal.helpers.support import with_extras
            issues = with_extras([serialize_issue(r) for r in rows])
            for item in issues:
                item.pop('total', None)
            pages = max(1, (total + per_page - 1) // per_page) if total else 1

            # Per-status counts for the segmented control, so an admin arriving
            # at this screen can see how much is waiting on them without
            # changing the filter to find out.
            #
            # Three calls to the SAME list procedure with per_page=1, reading
            # only its `total`, rather than a new counts SP or a raw GROUP BY:
            # this backend is stored-procedure-only and nothing here needs a
            # migration to deploy. They deliberately ignore `status` (that is
            # the axis being counted) while respecting portal, category and
            # search, so the numbers match what each tab would actually show.
            status_counts = {}
            for st in STATUSES:
                try:
                    r = call_proc('sp_support_issues_list',
                                  portal or None, st, category or None,
                                  search or None, 1, 0) or []
                    status_counts[st] = int(r[0].get('total') or 0) if r else 0
                except Exception:
                    # A count is a convenience. Losing one must never take the
                    # list down with it.
                    status_counts[st] = None

            # Solved and All tabs look back over a date range; their counts must
            # match what those tabs list (Open / In progress stay all-time).
            range_counts = {}
            c_from = (request.args.get('count_from') or '').strip()[:10] or None
            c_to = (request.args.get('count_to') or '').strip()[:10] or None
            if c_from or c_to:
                where = ["DATE(DATE_ADD(created_at, INTERVAL 330 MINUTE)) BETWEEN :f AND :t"]
                params = {'f': c_from or '2000-01-01', 't': c_to or '2999-12-31'}
                if portal:
                    where.append("portal = :p"); params['p'] = portal
                if category:
                    where.append("category = :c"); params['c'] = category
                if search:
                    where.append("(subject LIKE :q OR body LIKE :q OR contact_email LIKE :q)"); params['q'] = f"%{search}%"
                w = " AND ".join(where)
                row = db.session.execute(text(
                    f"SELECT COUNT(*), SUM(status = 'solved') FROM support_issues WHERE {w}"), params).first()
                range_counts = {'all': int(row[0] or 0), 'solved': int(row[1] or 0)}

            return jsonify(response={
                'range_counts': range_counts,
                'issues': issues,
                'page': page,
                'per_page': per_page,
                'pages': pages,
                'total': total,
                'status_counts': status_counts,
            }, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/support/issues: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/issues/<string:issue_id>')
class AdminSupportIssueOne(Resource):
    @jwt_required()
    def get(self, issue_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not row:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            from portal.helpers.support import with_extras
            return jsonify(response={'issue': with_extras([serialize_issue(row)])[0]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /admin/support/issues/{issue_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/issues/<string:issue_id>/status')
class AdminSupportIssueStatus(Resource):
    @jwt_required()
    def put(self, issue_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            data = request.get_json() or {}
            status = (data.get('status') or '').strip().lower()
            if status not in STATUSES:
                return jsonify(response={'message': 'Status must be open, in progress, or solved.'}, status=400, bool=False)
            current = call_proc_one('sp_support_issues_get', issue_id)
            if not current:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            if current.get('status') == 'solved' and status != 'solved':
                return jsonify(response={'message': 'Only the person who raised it can reopen a solved issue. Ask them in the chat.'},
                               status=409, bool=False)
            admin_id = str(get_jwt_identity())
            row = call_proc_one('sp_support_issues_update_status', issue_id, status, admin_id)
            if status == 'solved':
                db.session.execute(text("UPDATE support_issues SET confirmed_at = NULL WHERE id = :i"), {'i': issue_id})
            db.session.commit()
            log_audit(
                'support.issue.status', 'support_issue', issue_id,
                actor_id=admin_id,
                meta={'from': current.get('status'), 'to': status},
            )
            if status == 'solved' and current.get('status') != 'solved' and current.get('user_id'):
                notify_user(
                    current['user_id'],
                    'Your support issue is solved',
                    f"We marked “{current.get('subject') or 'your issue'}” as solved.",
                    type='system',
                    reference_type='support_issue',
                    reference_id=issue_id,
                )
            from portal.helpers.support import with_extras
            return jsonify(response={'issue': with_extras([serialize_issue(row)])[0]}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"PUT /admin/support/issues/{issue_id}/status: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/issues/<string:issue_id>/messages')
class AdminSupportIssueMessages(Resource):
    """Admin side of an issue's chat. Each reply notifies and emails the person."""

    @jwt_required()
    def get(self, issue_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from portal.helpers.support_chat import list_messages
            msgs, more = list_messages(issue_id, request.args.get('before'),
                                       viewer_id=str(get_jwt_identity()), viewer_role='admin')
            # The person's name, so the chat says "Pavan Kumar" not "User".
            row = call_proc_one('sp_support_issues_get', issue_id) or {}
            name = None
            if row.get('user_id'):
                proc = 'sp_achievers_get' if row.get('portal') == 'achiever' else 'sp_users_get'
                name = (call_proc_one(proc, str(row['user_id'])) or {}).get('full_name')
            return jsonify(response={'messages': msgs, 'has_more': more, 'can_write': True,
                                     'other_name': name or row.get('contact_email')}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, issue_id):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not row:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            from portal.helpers.support_chat import add_message, clean_files, MAX_BODY
            data = request.get_json() or {}
            body = (data.get('body') or '').strip()
            files = clean_files(data.get('attachments'))
            if not body and not files:
                return jsonify(response={'message': 'Write a reply or attach a file.'}, status=400, bool=False)
            if len(body) > MAX_BODY:
                return jsonify(response={'message': 'Reply is too long (4000 characters max).'}, status=400, bool=False)
            admin_id = str(get_jwt_identity())
            msg = add_message(row, admin_id, 'admin', body, files)
            log_audit('support.issue.reply', 'support_issue', issue_id, actor_id=admin_id, meta={'files': len(files)})
            if row.get('user_id'):
                notify_user(row['user_id'], 'SKOVO support replied',
                            f"On {row.get('subject') or 'your issue'}: {(body or 'sent you a file')[:140]}",
                            type='system', reference_type='support_issue', reference_id=issue_id)
            try:
                from portal.helpers.email_template import send_email, simple_email_body
                from portal.helpers.support import is_email
                to = row.get('contact_email')
                if to and is_email(to):
                    send_email(to, f"SKOVO support replied: {row.get('subject')}",
                               simple_email_body('SKOVO support replied',
                                                 body or 'We sent you a file. Open Help & support to see it.'))
            except Exception as mail_err:
                logger.warning(f"support reply mail failed: {mail_err}")
            return jsonify(response={'message': msg}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/support/issues/<string:issue_id>/messages/<string:msg_id>')
class AdminSupportIssueMessage(Resource):
    """An admin edits (15 min) or deletes (2 days) their own reply."""

    def _go(self, issue_id, msg_id, action):
        try:
            if not _require_admin():
                return jsonify(response={'message': 'Admin access required'}, status=403, bool=False)
            from portal.helpers.support_chat import change_message
            admin_id = str(get_jwt_identity())
            ok, err = change_message(issue_id, msg_id, admin_id, 'admin', action,
                                     (request.get_json(silent=True) or {}).get('body'))
            if not ok:
                return jsonify(response={'message': err}, status=409, bool=False)
            log_audit(f'support.message.{action}', 'support_issue', issue_id, actor_id=admin_id, meta={'message': msg_id})
            return jsonify(response={'message': 'Saved.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def put(self, issue_id, msg_id):
        return self._go(issue_id, msg_id, 'edit')

    @jwt_required()
    def delete(self, issue_id, msg_id):
        return self._go(issue_id, msg_id, 'delete')
