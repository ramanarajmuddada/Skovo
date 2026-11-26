"""Student and achiever Help & support — contacts they can tap, issues they raise."""
import uuid
import datetime
from portal.helpers.helpers import serialize_datetime

from flask import jsonify, request
from flask_jwt_extended import decode_token, get_jwt_identity, jwt_required
from flask_limiter.util import get_remote_address
from flask_restx import Resource

from portal.helpers.audit import log_audit
from portal.helpers.error_capture import capture_error
from portal.helpers.email_template import send_email, simple_email_body
from portal.helpers.rate_limit import limiter
from portal.helpers.sp import call_proc, call_proc_one
from sqlalchemy import text
from portal.helpers.support import (
    CATEGORIES, REFERENCE_TYPES, SOURCES, category_options, category_values,
    is_email, portal_from_jwt, serialize_contact, serialize_issue, support_inbox,
)
from portal.models import db
from portal.helpers.admin_notify import tell_admins, achiever_name

from . import ns, logger


def _actor_contact(portal, user_id):
    if portal == 'student':
        row = call_proc_one('sp_users_get', str(user_id)) or {}
    else:
        row = call_proc_one('sp_achievers_get', str(user_id)) or {}
    return (row.get('email') or '').strip(), (row.get('full_name') or '').strip()


def _mirror_new_issue(issue, name, email):
    inbox = support_inbox()
    if not inbox or not is_email(inbox):
        return
    subject = f"SKOVO support — {issue.get('category')}: {issue.get('subject')}"
    who = name or email or issue.get('user_id') or 'someone'
    msg = (
        f"{who} raised an issue from the {issue.get('portal')} portal "
        f"({issue.get('source')}).\n\n"
        f"Category: {issue.get('category')}\n"
        f"From: {email or '—'}\n"
        f"Reference: {issue.get('reference_type') or '—'} {issue.get('reference_id') or ''}\n\n"
        f"{issue.get('body')}"
    )
    send_email(inbox, subject, simple_email_body('New support issue', msg))


@ns.route('/public-contacts')
class PublicSupportContacts(Resource):
    @ns.doc(description='Public contact rows for /contact. No session required.')
    def get(self):
        try:
            rows = call_proc('sp_support_contacts_list', 'public', 1) or []
            return jsonify(response={'contacts': [serialize_contact(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /support/public-contacts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/contacts')
class SupportContacts(Resource):
    @ns.doc(description='Active contacts for the signed-in portal.')
    @jwt_required()
    def get(self):
        try:
            portal = portal_from_jwt()
            if not portal:
                return jsonify(response={'message': 'Sign in to see support contacts.'}, status=403, bool=False)
            rows = call_proc('sp_support_contacts_list', portal, 1) or []
            return jsonify(response={'contacts': [serialize_contact(r) for r in rows]}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /support/contacts: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues')
class SupportIssueList(Resource):
    @ns.doc(description='Issues the signed-in person raised.')
    @jwt_required()
    def get(self):
        try:
            portal = portal_from_jwt()
            if not portal:
                return jsonify(response={'message': 'Sign in to see your issues.'}, status=403, bool=False)
            user_id = get_jwt_identity()
            rows = call_proc('sp_support_issues_list_for_user', str(user_id), portal) or []
            from portal.helpers.support import with_extras
            return jsonify(response={'issues': with_extras([serialize_issue(r) for r in rows])}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /support/issues: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


def _raise_issue_key():
    """One budget per signed-in person. A shared college network is not one person."""
    auth = (request.headers.get('Authorization') or '').strip()
    if auth.lower().startswith('bearer '):
        try:
            ident = decode_token(auth.split(None, 1)[1].strip()).get('sub')
            if ident:
                return f'support-issue:{ident}'
        except Exception:
            pass
    return get_remote_address()


@ns.route('/my-references')
class SupportMyReferences(Resource):
    @ns.doc(description='Your own payments or payouts to attach to an issue (?category=payments|payouts).')
    @jwt_required()
    def get(self):
        try:
            portal = portal_from_jwt()
            if not portal:
                return jsonify(response={'message': 'Sign in first.'}, status=403, bool=False)
            from portal.helpers.support import reference_options
            kind, opts = reference_options(portal, str(get_jwt_identity()), (request.args.get('category') or '').lower())
            return jsonify(response={'reference_type': kind, 'items': opts}, status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues/raise')
class SupportIssueCreate(Resource):
    decorators = [limiter.limit("8 per hour", key_func=_raise_issue_key)]

    @ns.doc(description='Raise an issue. Email and call do not use this.')
    @jwt_required()
    def post(self):
        try:
            portal = portal_from_jwt()
            if not portal:
                return jsonify(response={'message': 'Sign in to raise an issue.'}, status=403, bool=False)
            user_id = str(get_jwt_identity())
            data = request.get_json() or {}

            subject = (data.get('subject') or '').strip()
            body = (data.get('body') or '').strip()
            category = (data.get('category') or 'other').strip().lower()
            source = (data.get('source') or 'web').strip().lower()
            reference_type = (data.get('reference_type') or '').strip().lower() or None
            reference_id = (data.get('reference_id') or '').strip() or None

            if len(subject) < 3 or len(subject) > 200:
                return jsonify(response={'message': 'Subject must be 3 to 200 characters.'}, status=400, bool=False)
            if len(body) < 10 or len(body) > 4000:
                return jsonify(response={'message': 'Describe the problem in 10 to 4000 characters.'}, status=400, bool=False)
            if category not in category_values():
                return jsonify(response={'message': 'Pick a category.'}, status=400, bool=False)
            if source not in SOURCES:
                source = 'web'
            if reference_type and reference_type not in REFERENCE_TYPES:
                return jsonify(response={'message': 'That reference type is not valid.'}, status=400, bool=False)
            if reference_id and len(reference_id) > 36:
                return jsonify(response={'message': 'Reference id is too long.'}, status=400, bool=False)
            if reference_id and not reference_type:
                reference_type = 'other'

            # Money issues: proof is required, and a picked item must be theirs.
            import json
            from portal.helpers.support import PROOF_REQUIRED, MAX_PROOF, reference_options
            files = []
            for a in (data.get('attachments') or [])[:MAX_PROOF]:
                url = str((a or {}).get('url') or '').strip()
                if url.lower().startswith(('http://', 'https://')) and len(url) <= 500:
                    files.append({'url': url, 'name': str((a or {}).get('name') or 'proof')[:120]})
            if category in PROOF_REQUIRED and not files:
                return jsonify(response={'message': 'Attach proof: a screenshot or PDF of the payment or bank statement.'},
                               status=400, bool=False)
            txn_ref = (data.get('txn_ref') or '').strip()[:80] or None
            if reference_type in ('payment_orders', 'payout_requests') and reference_id:
                kind, opts = reference_options(portal, user_id, category)
                if kind != reference_type or reference_id not in {o['id'] for o in opts}:
                    return jsonify(response={'message': 'Pick one of your own payments or payouts.'}, status=400, bool=False)

            email, name = _actor_contact(portal, user_id)
            extra = (data.get('contact_email') or '').strip()
            if extra and is_email(extra):
                email = extra

            issue_id = str(uuid.uuid4())
            row = call_proc_one(
                'sp_support_issues_create',
                issue_id, user_id, email or None, portal, subject, body, category, 'open',
                reference_type, reference_id, source, user_id,
            )
            db.session.execute(text(
                # created_at too: the create procedure never set it, so every
                # issue showed no date and sorted at random.
                "UPDATE support_issues SET attachments = :a, txn_ref = :t,"
                " created_at = IFNULL(created_at, UTC_TIMESTAMP()), updated_at = IFNULL(updated_at, UTC_TIMESTAMP())"
                " WHERE id = :i"),
                {'a': json.dumps(files) if files else None, 't': txn_ref, 'i': issue_id})
            db.session.commit()
            issue = serialize_issue(row)
            issue['attachments'], issue['txn_ref'] = files, txn_ref
            if not issue.get('created_at'):
                issue['created_at'] = serialize_datetime(datetime.datetime.utcnow())

            log_audit(
                'support.issue.create', 'support_issue', issue_id,
                actor_id=user_id,
                meta={'portal': portal, 'category': category, 'source': source},
            )
            try:
                _mirror_new_issue(issue, name, email)
            except Exception as mail_err:
                logger.warning(f"support issue email mirror failed: {mail_err}")
            if portal == 'achiever':
                tell_admins('Achiever support request',
                            f"{name or 'An achiever'} raised an issue: {subject}",
                            reference_type='support_issue', reference_id=issue_id)

            return jsonify(response={'issue': issue}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            logger.error(f"POST /support/issues/raise: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues/<string:issue_id>')
class SupportIssueOne(Resource):
    @jwt_required()
    def get(self, issue_id):
        try:
            portal = portal_from_jwt()
            if not portal:
                return jsonify(response={'message': 'Sign in to see this issue.'}, status=403, bool=False)
            user_id = str(get_jwt_identity())
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not row or str(row.get('user_id') or '') != user_id or row.get('portal') != portal:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            return jsonify(response={'issue': serialize_issue(row)}, status=200, bool=True)
        except Exception as e:
            logger.error(f"GET /support/issues/{issue_id}: {e}")
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues/<string:issue_id>/messages')
class SupportIssueMessages(Resource):
    """Chat on your own issue with SKOVO support."""

    def _issue(self, issue_id):
        portal = portal_from_jwt()
        if not portal:
            return None, jsonify(response={'message': 'Sign in first.'}, status=403, bool=False)
        user_id = str(get_jwt_identity())
        row = call_proc_one('sp_support_issues_get', issue_id)
        if not row or str(row.get('user_id') or '') != user_id or row.get('portal') != portal:
            return None, jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
        return row, None

    @jwt_required()
    def get(self, issue_id):
        try:
            row, err = self._issue(issue_id)
            if err:
                return err
            from portal.helpers.support_chat import list_messages, can_write
            ok, why = can_write(row, 'user')
            msgs, more = list_messages(issue_id, request.args.get('before'), viewer_id=str(get_jwt_identity()), viewer_role='user')
            return jsonify(response={'messages': msgs, 'has_more': more, 'can_write': ok, 'closed_reason': why},
                           status=200, bool=True)
        except Exception as e:
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)

    @jwt_required()
    def post(self, issue_id):
        try:
            row, err = self._issue(issue_id)
            if err:
                return err
            from portal.helpers.support_chat import add_message, can_write, clean_files, MAX_BODY
            ok, why = can_write(row, 'user')
            if not ok:
                return jsonify(response={'message': why}, status=409, bool=False)
            data = request.get_json() or {}
            body = (data.get('body') or '').strip()
            files = clean_files(data.get('attachments'))
            if not body and not files:
                return jsonify(response={'message': 'Write a message or attach a file.'}, status=400, bool=False)
            if len(body) > MAX_BODY:
                return jsonify(response={'message': 'Message is too long (4000 characters max).'}, status=400, bool=False)
            msg = add_message(row, str(get_jwt_identity()), 'user', body, files)
            try:
                inbox = support_inbox()
                if inbox and is_email(inbox):
                    send_email(inbox, f"SKOVO support - new message: {row.get('subject')}",
                               simple_email_body('New message on a support issue',
                                                 f"{row.get('contact_email') or 'The user'} wrote:\n\n{body or '(file attached)'}"))
            except Exception as mail_err:
                logger.warning(f"support chat mail failed: {mail_err}")
            if row.get('portal') == 'achiever':
                tell_admins('New message from an achiever',
                            f"{achiever_name(get_jwt_identity())} replied on: {row.get('subject')}",
                            reference_type='support_issue', reference_id=issue_id,
                            once_while_unread=True)
            return jsonify(response={'message': msg, 'reopened': row.get('status') == 'solved'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues/<string:issue_id>/messages/<string:msg_id>')
class SupportIssueMessage(Resource):
    """Edit (15 min) or delete (2 days) your own chat message."""

    def _go(self, issue_id, msg_id, action):
        try:
            portal = portal_from_jwt()
            user_id = str(get_jwt_identity())
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not portal or not row or str(row.get('user_id') or '') != user_id or row.get('portal') != portal:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            from portal.helpers.support_chat import change_message
            ok, err = change_message(issue_id, msg_id, user_id, 'user', action,
                                     (request.get_json(silent=True) or {}).get('body'))
            if not ok:
                return jsonify(response={'message': err}, status=409, bool=False)
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


@ns.route('/issues/<string:issue_id>/reopen')
class SupportIssueReopen(Resource):
    """The person reopens their Solved issue (within 7 days, max 3 times, with a reason)."""

    @jwt_required()
    def post(self, issue_id):
        try:
            portal = portal_from_jwt()
            user_id = str(get_jwt_identity())
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not portal or not row or str(row.get('user_id') or '') != user_id or row.get('portal') != portal:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            from portal.helpers.support_chat import reopen
            ok, err = reopen(row, user_id, (request.get_json() or {}).get('reason'))
            if not ok:
                return jsonify(response={'message': err}, status=409, bool=False)
            log_audit('support.issue.reopen', 'support_issue', issue_id, actor_id=user_id, meta={})
            try:
                inbox = support_inbox()
                if inbox and is_email(inbox):
                    send_email(inbox, f"SKOVO support - issue reopened: {row.get('subject')}",
                               simple_email_body('A support issue was reopened',
                                                 f"{row.get('contact_email') or 'The user'} reopened it."))
            except Exception as mail_err:
                logger.warning(f"support reopen mail failed: {mail_err}")
            if portal == 'achiever':
                tell_admins('Achiever reopened an issue',
                            f"{achiever_name(user_id)} reopened: {row.get('subject')}",
                            reference_type='support_issue', reference_id=issue_id)
            return jsonify(response={'message': 'Reopened. Support will look again.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)


@ns.route('/issues/<string:issue_id>/confirm')
class SupportIssueConfirm(Resource):
    """The person taps "Yes, solved"."""

    @jwt_required()
    def post(self, issue_id):
        try:
            portal = portal_from_jwt()
            user_id = str(get_jwt_identity())
            row = call_proc_one('sp_support_issues_get', issue_id)
            if not portal or not row or str(row.get('user_id') or '') != user_id or row.get('portal') != portal:
                return jsonify(response={'message': 'Issue not found.'}, status=404, bool=False)
            if row.get('status') != 'solved':
                return jsonify(response={'message': 'Only a solved issue can be confirmed.'}, status=409, bool=False)
            db.session.execute(text("UPDATE support_issues SET confirmed_at = UTC_TIMESTAMP() WHERE id = :i"),
                               {'i': issue_id})
            db.session.commit()
            return jsonify(response={'message': 'Thanks for confirming.'}, status=200, bool=True)
        except Exception as e:
            db.session.rollback()
            error_id = capture_error(e)
            return jsonify(response={'message': 'Internal Server Error', 'error_id': error_id}, status=500, bool=False)
