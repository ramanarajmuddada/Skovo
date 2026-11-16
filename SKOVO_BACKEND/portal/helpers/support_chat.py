"""
Chat on a support issue: the person who raised it and SKOVO admins.

Rules:
  * Only the issue's owner and admins read or write it (checked by the routes).
  * A message from the person on a solved issue reopens it within 7 days of
    solving; after that they raise a new issue.
  * An admin message moves an open issue to In progress and stamps the first
    response time.
  * Messages are never edited or deleted (the record for disputes).
"""
import json
import uuid
import datetime

from sqlalchemy import text

from portal.models import db
from portal.helpers.helpers import serialize_datetime

REOPEN_DAYS = 7        # chat + Reopen stay open this long after Solved
MAX_REOPENS = 3
EDIT_MIN = 15          # like WhatsApp: edit within 15 minutes
DELETE_HOURS = 48      # delete for everyone within 2 days
MAX_FILES = 3
MAX_BODY = 4000


def clean_files(raw):
    files = []
    for a in (raw or [])[:MAX_FILES]:
        url = str((a or {}).get('url') or '').strip()
        if url.lower().startswith(('http://', 'https://')) and len(url) <= 500:
            files.append({'url': url, 'name': str((a or {}).get('name') or 'file')[:120]})
    return files


PAGE = 30


def list_messages(issue_id, before=None, limit=PAGE, viewer_id=None, viewer_role=None):
    """The newest `limit` messages (oldest first), or the ones before message
    `before`. Returns (messages, has_more)."""
    params = {'i': issue_id, 'n': limit + 1}
    cond = ""
    if before:
        ts = db.session.execute(text(
            "SELECT created_at FROM support_issue_messages WHERE id = :b AND issue_id = :i"),
            {'b': before, 'i': issue_id}).scalar()
        if ts:
            cond = " AND created_at < :ts"
            params['ts'] = ts
    rows = db.session.execute(text(
        "SELECT id, sender_role, body, attachments, created_at, sender_id, edited_at, deleted_at, original_body"
        " FROM support_issue_messages"
        f" WHERE issue_id = :i{cond} ORDER BY created_at DESC, id DESC LIMIT :n"), params).fetchall()
    has_more = len(rows) > limit
    rows = list(reversed(rows[:limit]))
    out = []
    for r in rows:
        try:
            att = json.loads(r[3]) if r[3] else []
        except ValueError:
            att = []
        now = datetime.datetime.utcnow()
        own = viewer_id is not None and r[5] == viewer_id and r[1] == viewer_role
        deleted = r[7] is not None
        m = {'id': r[0], 'from': r[1], 'created_at': serialize_datetime(r[4]),
             'body': '' if deleted else (r[2] or ''), 'attachments': [] if deleted else att,
             'edited': r[6] is not None and not deleted, 'deleted': deleted,
             'can_edit': own and not deleted and bool(r[2]) and r[4] > now - datetime.timedelta(minutes=EDIT_MIN),
             'can_delete': own and not deleted and r[4] > now - datetime.timedelta(hours=DELETE_HOURS)}
        # Admins see what was there before an edit or delete (payment disputes).
        if viewer_role == 'admin' and (r[6] or r[7]):
            m['original'] = r[8] if r[8] is not None else r[2]
            m['original_files'] = att if deleted else []
        out.append(m)
    return out, has_more


def change_message(issue_id, msg_id, sender_id, role, action, body=None):
    """Edit (15 min) or delete (2 days) your own message. Returns (ok, error)."""
    row = db.session.execute(text(
        "SELECT sender_id, sender_role, created_at, deleted_at, body FROM support_issue_messages"
        " WHERE id = :m AND issue_id = :i"), {'m': msg_id, 'i': issue_id}).first()
    if not row:
        return False, 'Message not found.'
    if row[0] != sender_id or row[1] != role:
        return False, 'You can only change your own messages.'
    if row[3] is not None:
        return False, 'This message was already deleted.'
    age = datetime.datetime.utcnow() - row[2]
    if action == 'edit':
        body = (body or '').strip()
        if not body:
            return False, 'Message cannot be empty. Delete it instead.'
        if len(body) > MAX_BODY:
            return False, 'Message is too long (4000 characters max).'
        if not row[4]:
            return False, 'Only text messages can be edited.'
        if age > datetime.timedelta(minutes=EDIT_MIN):
            return False, 'Messages can be edited for 15 minutes after sending.'
        db.session.execute(text(
            "UPDATE support_issue_messages SET original_body = IFNULL(original_body, body), body = :b,"
            " edited_at = UTC_TIMESTAMP() WHERE id = :m"), {'b': body, 'm': msg_id})
    else:
        if age > datetime.timedelta(hours=DELETE_HOURS):
            return False, 'Messages can be deleted for 2 days after sending.'
        db.session.execute(text(
            "UPDATE support_issue_messages SET original_body = IFNULL(original_body, body),"
            " deleted_at = UTC_TIMESTAMP() WHERE id = :m"), {'m': msg_id})
    db.session.commit()
    return True, None


def is_closed(issue):
    """Solved more than 7 days ago = Closed (no chat, no reopen)."""
    solved = issue.get('resolved_at')
    if isinstance(solved, str):
        try:
            solved = datetime.datetime.fromisoformat(solved.replace('Z', ''))
        except ValueError:
            solved = None
    return (issue.get('status') == 'solved' and solved is not None
            and solved <= datetime.datetime.utcnow() - datetime.timedelta(days=REOPEN_DAYS))


def reopen(issue, user_id, reason):
    """The person reopens a Solved issue (7 days, max 3 times). Returns (ok, error)."""
    if issue.get('status') != 'solved':
        return False, 'Only a solved issue can be reopened.'
    if is_closed(issue):
        return False, 'This issue is closed. Raise a new issue if you need help.'
    n = db.session.execute(text("SELECT reopen_count FROM support_issues WHERE id = :i"),
                           {'i': issue['id']}).scalar() or 0
    if n >= MAX_REOPENS:
        return False, 'This issue was reopened 3 times. Please raise a new issue.'
    reason = (reason or '').strip()
    if len(reason) < 5:
        return False, 'Tell us what is still wrong (at least 5 characters).'
    db.session.execute(text(
        "UPDATE support_issues SET status = 'open', resolved_at = NULL, resolved_by = NULL, confirmed_at = NULL,"
        " reopened_at = UTC_TIMESTAMP(), reopen_count = reopen_count + 1, updated_at = UTC_TIMESTAMP()"
        " WHERE id = :i"), {'i': issue['id']})
    db.session.execute(text(
        "INSERT INTO support_issue_messages (id, issue_id, sender_id, sender_role, body)"
        " VALUES (:id, :i, :s, 'user', :b)"),
        {'id': str(uuid.uuid4()), 'i': issue['id'], 's': user_id, 'b': f"Reopened: {reason[:3900]}"})
    db.session.commit()
    return True, None


def can_write(issue, role):
    """(ok, message). The person can write on open / in-progress issues, and on
    a solved one within 7 days (that reopens it). Admins can always write."""
    if (issue.get('status') or 'open') != 'solved':
        return True, None
    if not is_closed(issue):
        return True, None
    return False, ('This issue is closed. Raise a new issue if you need help.' if role == 'user'
                   else 'This issue is closed (7 days after it was solved).')


def add_message(issue, sender_id, role, body, files):
    """Save the message and move the issue on. Returns the message dict."""
    mid = str(uuid.uuid4())
    db.session.execute(text(
        "INSERT INTO support_issue_messages (id, issue_id, sender_id, sender_role, body, attachments)"
        " VALUES (:id, :i, :s, :r, :b, :a)"),
        {'id': mid, 'i': issue['id'], 's': sender_id, 'r': role, 'b': body or None,
         'a': json.dumps(files) if files else None})
    status = issue.get('status') or 'open'
    if role == 'admin' and status != 'solved':
        db.session.execute(text(
            "UPDATE support_issues SET first_response_at = IFNULL(first_response_at, UTC_TIMESTAMP()),"
            " status = IF(status = 'open', 'in_progress', status), updated_at = UTC_TIMESTAMP()"
            " WHERE id = :i"), {'i': issue['id']})
    else:
        db.session.execute(text("UPDATE support_issues SET updated_at = UTC_TIMESTAMP() WHERE id = :i"),
                           {'i': issue['id']})
    db.session.commit()
    return {'id': mid, 'from': role, 'body': body or '', 'attachments': files,
            'created_at': serialize_datetime(datetime.datetime.utcnow()),
            'edited': False, 'deleted': False, 'can_edit': bool(body), 'can_delete': True}


def message_counts(issue_ids):
    """{issue_id: (count, last_from)} for list badges."""
    from sqlalchemy import bindparam
    ids = [i for i in issue_ids if i]
    if not ids:
        return {}
    rows = db.session.execute(text(
        "SELECT m.issue_id, COUNT(*), (SELECT sender_role FROM support_issue_messages x"
        "   WHERE x.issue_id = m.issue_id ORDER BY x.created_at DESC, x.id DESC LIMIT 1)"
        "  FROM support_issue_messages m WHERE m.issue_id IN :ids GROUP BY m.issue_id"
    ).bindparams(bindparam('ids', expanding=True)), {'ids': ids}).fetchall()
    return {r[0]: (int(r[1]), r[2]) for r in rows}
