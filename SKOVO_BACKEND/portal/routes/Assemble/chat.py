"""Community live chat (feature-updates.md §6).

GET    /assemble/groups/<gid>/chat?after=&before=&limit=   messages (+ reactions, polls)
POST   /assemble/groups/<gid>/chat                          send {body, reply_to, mentions, is_doubt, media_url}
DELETE /assemble/chat/<mid>                                 delete (own within 15 min; owner any time)
POST   /assemble/chat/<mid>/react                           {emoji} toggle
POST   /assemble/chat/<mid>/solve                           {answer_id} mark a doubt solved
POST   /assemble/chat/<mid>/report                          {reason}
POST   /assemble/groups/<gid>/polls                         {question, options, multi, closes_at}
POST   /assemble/polls/<pid>/vote                           {option_index}
POST   /assemble/groups/<gid>/read                          {seq}
POST   /assemble/groups/<gid>/mute                          {muted}
GET    /assemble/chat/unread                                unread counts per community
PUT    /assemble/groups/<gid>/chat-settings                 owner: admin_only, slow_mode_seconds, allow_links
POST   /assemble/groups/<gid>/invite                        owner: new invite code (link / QR)
POST   /assemble/join/<code>                                join by invite (3-community limit applies)
GET    /assemble/members/search?q=                          owner: find students by name + school
POST   /assemble/groups/<gid>/members                       owner: add a student {user_id}
GET    /assemble/groups/<gid>/top-helpers                   this week's Top Helpers

Phone numbers are masked, outside links refused unless allowed, blocked words
masked (helpers/chat_safety.py). Points: admin rule answer_solved (0 / inactive).
"""
from portal.helpers.error_capture import capture_error
import datetime
import json
import secrets
import uuid
from flask import jsonify, request
from flask_restx import Resource
from flask_jwt_extended import jwt_required, get_jwt_identity
from portal.models import db
from portal.helpers.sp import call_proc, call_proc_one
from portal.helpers import chat_safety
from portal.helpers.storage import browser_url
from portal.routes.Assemble.assemble import _membership_quota, _upgrade_payload, _require_owner
from . import ns, logger

DELETE_WINDOW = datetime.timedelta(minutes=15)
EMOJIS = {'👍', '❤️', '😂', '🎉', '🙏', '🔥', '👏', '😮', '😢', '✅'}
PRIVILEGED = ('owner', 'admin')


def _err(where, e):
    db.session.rollback()
    logger.error(f"{where}: {e}")
    return jsonify(response={'message': 'Internal Server Error', 'error_id': capture_error(e)},
                   status=500, bool=False)


def _no(msg, code=400):
    return jsonify(response={'message': msg}, status=code, bool=False)


def _member(group_id, user_id):
    m = call_proc_one('sp_cm_member_role', group_id, user_id) or {}
    return m if m.get('status') == 'active' else None


def _group(group_id):
    g = call_proc_one('sp_cm_group_chat_settings', group_id)
    if not g or g.get('deleted_at') or not g.get('is_active'):
        return None
    return g


def _loads(v, default):
    if v is None:
        return default
    if isinstance(v, (dict, list)):
        return v
    try:
        return json.loads(v)
    except ValueError:
        return default


def _msg(m, reactions=None, me=None, polls=None):
    deleted = bool(m.get('deleted_at'))
    poll = None
    if m.get('poll_id') and polls is not None:
        poll = polls.get(m['poll_id'])
    return {
        'id': m['id'], 'seq': int(m['seq']), 'group_id': m['group_id'],
        'sender_id': m['sender_id'], 'sender_name': m.get('sender_name') or 'Student',
        'sender_avatar': browser_url(m['sender_avatar']) if m.get('sender_avatar') else None,
        'body': None if deleted else m.get('body'),
        'media_url': None if deleted else (browser_url(m['media_url']) if m.get('media_url') else None),
        'media_type': m.get('media_type'),
        'reply_to': ({'id': m['reply_to_id'], 'body': m.get('reply_body'), 'sender_name': m.get('reply_sender_name')}
                     if m.get('reply_to_id') else None),
        'mentions': _loads(m.get('mentions_json'), []),
        'is_doubt': bool(m.get('is_doubt')),
        'solved_by_message_id': m.get('solved_by_message_id'),
        'deleted': deleted, 'is_mine': m['sender_id'] == me,
        'reactions': reactions or [],
        'poll': poll,
        'created_at': m['created_at'].isoformat() + 'Z' if m.get('created_at') else None,
    }


def _poll_dict(p, me):
    results = {int(r['option_index']): r for r in call_proc('sp_cm_poll_results', p['id']) or []}
    opts = _loads(p.get('options_json'), [])
    return {'id': p['id'], 'question': p['question'], 'multi': bool(p.get('multi')),
            'closes_at': p['closes_at'].isoformat() + 'Z' if p.get('closes_at') else None,
            'closed': bool(p.get('closes_at') and datetime.datetime.utcnow() > p['closes_at']),
            'options': [{'index': i, 'text': o, 'votes': int((results.get(i) or {}).get('votes') or 0),
                         'mine': me in ((results.get(i) or {}).get('user_ids') or '').split(',')}
                        for i, o in enumerate(opts)]}


def _emit(group_id, event, payload):
    """Push to everyone in the community room. Best effort: clients that are
    not connected pick it up from the polling endpoint."""
    try:
        from portal.whiteboard_socket import socketio
        socketio.emit(event, payload, room=f'community:{group_id}')
    except Exception as e:                                   # noqa: BLE001
        logger.warning(f"community emit failed: {e}")


def _decorate(group_id, rows, me):
    if not rows:
        return []
    lo, hi = min(int(r['seq']) for r in rows), max(int(r['seq']) for r in rows)
    reacts = {}
    for r in call_proc('sp_cm_reactions_for_group', group_id, lo, hi) or []:
        reacts.setdefault(r['message_id'], []).append(
            {'emoji': r['emoji'], 'count': int(r['n']), 'mine': me in (r.get('user_ids') or '').split(',')})
    polls = {}
    for r in rows:
        if r.get('poll_id') and r['poll_id'] not in polls:
            p = call_proc_one('sp_cm_poll_get', r['poll_id'])
            if p:
                polls[r['poll_id']] = _poll_dict(p, me)
    return [_msg(r, reacts.get(r['id']), me, polls) for r in rows]


@ns.route('/groups/<string:group_id>/chat')
class GroupChat(Resource):
    @jwt_required()
    def get(self, group_id):
        try:
            me = get_jwt_identity()
            g = _group(group_id)
            mem = _member(group_id, me)
            if not g or not mem:
                return _no('Community not found.', 404)
            a = request.args
            limit = max(1, min(100, int(a.get('limit') or 50)))
            rows = call_proc('sp_cm_messages_list', group_id, int(a.get('after') or 0),
                             int(a.get('before') or 0), limit) or []
            return jsonify(response={
                'messages': _decorate(group_id, rows, me),
                'my_role': mem.get('role'),
                'settings': {'admin_only': bool(g.get('admin_only')), 'slow_mode_seconds': int(g.get('slow_mode_seconds') or 0),
                             'allow_links': bool(g.get('allow_links'))},
                'can_post': (not g.get('admin_only')) or mem.get('role') in PRIVILEGED,
            }, status=200, bool=True)
        except Exception as e:
            return _err('GET community chat', e)

    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            g = _group(group_id)
            mem = _member(group_id, me)
            if not g or not mem:
                return _no('Community not found.', 404)
            privileged = mem.get('role') in PRIVILEGED
            if g.get('admin_only') and not privileged:
                return _no('Only community admins can post right now.', 403)
            slow = int(g.get('slow_mode_seconds') or 0)
            if slow and not privileged:
                last = (call_proc_one('sp_cm_last_sent', group_id, me) or {}).get('last_at')
                if last and (datetime.datetime.utcnow() - last).total_seconds() < slow:
                    wait = int(slow - (datetime.datetime.utcnow() - last).total_seconds())
                    return _no(f'Slow mode is on. You can send again in {wait}s.', 429)
            d = request.get_json() or {}
            raw = (d.get('body') or '').strip()
            media = (d.get('media_url') or '').strip() or None
            if not raw and not media:
                return _no('Write a message.')
            if len(raw) > 4000:
                return _no('Messages can be up to 4000 characters.')
            body, flags, refuse = chat_safety.clean(raw, allow_links=bool(g.get('allow_links')))
            if refuse:
                return _no(refuse)
            reply = d.get('reply_to') or None
            mentions = [str(x) for x in (d.get('mentions') or [])][:20]
            row = call_proc_one('sp_cm_message_create', str(uuid.uuid4()), group_id, me, body, media,
                                (d.get('media_type') or '')[:20] or None, reply,
                                json.dumps(mentions) if mentions else None, None,
                                1 if d.get('is_doubt') else 0, json.dumps(flags) if flags else None)
            db.session.commit()
            msg = _decorate(group_id, [row], me)[0]
            _emit(group_id, 'community_message', {**msg, 'is_mine': False})
            if mentions:
                from portal.helpers.notifications import notify_user
                from sqlalchemy import text
                muted = {r[0] for r in db.session.execute(text(
                    "SELECT user_id FROM community_reads WHERE group_id = :g AND muted = 1"), {'g': group_id}).all()}
                for uid in mentions:
                    if uid != me and uid not in muted and _member(group_id, uid):
                        notify_user(uid, f"{msg['sender_name']} mentioned you", (body or '')[:120],
                                    type='community', reference_type='community', reference_id=group_id)
            out = {'message': msg}
            if flags.get('phone_masked'):
                out['notice'] = 'Phone numbers are hidden on SKOVO for everyone\'s safety.'
            return jsonify(response=out, status=201, bool=True)
        except Exception as e:
            return _err('POST community chat', e)


def _message_with_access(mid, me):
    m = call_proc_one('sp_cm_message_get', mid)
    if not m:
        return None, None, _no('Message not found.', 404)
    mem = _member(m['group_id'], me)
    if not mem:
        return None, None, _no('Message not found.', 404)
    return m, mem, None


@ns.route('/chat/<string:mid>')
class ChatMessage(Resource):
    @jwt_required()
    def delete(self, mid):
        try:
            me = get_jwt_identity()
            m, mem, err = _message_with_access(mid, me)
            if err:
                return err
            own = m['sender_id'] == me
            if not (mem.get('role') in PRIVILEGED or (own and datetime.datetime.utcnow() - m['created_at'] <= DELETE_WINDOW)):
                return _no('You can delete your own message within 15 minutes.', 403)
            call_proc_one('sp_cm_message_delete', mid, me)
            db.session.commit()
            _emit(m['group_id'], 'community_message_deleted', {'id': mid})
            return jsonify(response={'message': 'Deleted.'}, status=200, bool=True)
        except Exception as e:
            return _err('DELETE community message', e)


@ns.route('/chat/<string:mid>/react')
class ChatReact(Resource):
    @jwt_required()
    def post(self, mid):
        try:
            me = get_jwt_identity()
            m, _mem, err = _message_with_access(mid, me)
            if err:
                return err
            emoji = (request.get_json() or {}).get('emoji') or ''
            if emoji not in EMOJIS:
                return _no('Pick one of the reactions.')
            res = call_proc_one('sp_cm_react_toggle', mid, me, emoji) or {}
            db.session.commit()
            _emit(m['group_id'], 'community_reaction', {'message_id': mid, 'emoji': emoji, 'user_id': me,
                                                        'result': res.get('result')})
            return jsonify(response={'result': res.get('result')}, status=200, bool=True)
        except Exception as e:
            return _err('POST community react', e)


@ns.route('/chat/<string:mid>/solve')
class ChatSolve(Resource):
    @jwt_required()
    def post(self, mid):
        try:
            me = get_jwt_identity()
            doubt, mem, err = _message_with_access(mid, me)
            if err:
                return err
            if not doubt.get('is_doubt'):
                return _no('Only a doubt can be marked solved.')
            if doubt['sender_id'] != me and mem.get('role') not in PRIVILEGED:
                return _no('Only the student who asked, or the owner, can mark it solved.', 403)
            answer_id = (request.get_json() or {}).get('answer_id')
            answer = call_proc_one('sp_cm_message_get', answer_id) if answer_id else None
            if not answer or answer['group_id'] != doubt['group_id'] or answer.get('deleted_at'):
                return _no('Pick the answer that solved it.')
            if (call_proc_one('sp_cm_mark_solved', mid, answer_id) or {}).get('solved', 0) == 0:
                return _no('This doubt is already solved.', 409)
            db.session.commit()
            # Points go to whoever answered -- never for answering yourself.
            if answer['sender_id'] != doubt['sender_id']:
                from portal.helpers import score, engagement
                score.award(answer['sender_id'], 'answer_solved', ref_id=f'cm-{mid}')
                engagement.track(answer['sender_id'], 'answer_solved')
                from portal.helpers.notifications import notify_user
                notify_user(answer['sender_id'], 'Your answer solved a doubt ✅',
                            'Thanks for helping a classmate.', type='community',
                            reference_type='community', reference_id=doubt['group_id'])
                db.session.commit()
            _emit(doubt['group_id'], 'community_solved', {'id': mid, 'answer_id': answer_id})
            return jsonify(response={'message': 'Marked solved ✅'}, status=200, bool=True)
        except Exception as e:
            return _err('POST community solve', e)


@ns.route('/chat/<string:mid>/report')
class ChatReport(Resource):
    @jwt_required()
    def post(self, mid):
        try:
            me = get_jwt_identity()
            m, _mem, err = _message_with_access(mid, me)
            if err:
                return err
            reason = ((request.get_json() or {}).get('reason') or '').strip()[:300] or None
            created = (call_proc_one('sp_cm_report_create', str(uuid.uuid4()), mid, m['group_id'], me, reason)
                       or {}).get('created', 0)
            db.session.commit()
            if created:
                g = _group(m['group_id']) or {}
                if g.get('created_by'):
                    from portal.helpers.notifications import notify_user
                    notify_user(g['created_by'], 'A message was reported', f"In {g.get('name')}: please review it.",
                                type='community', reference_type='community', reference_id=m['group_id'])
            return jsonify(response={'message': 'Reported. The owner and SKOVO will review it.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST community report', e)


@ns.route('/groups/<string:group_id>/polls')
class GroupPolls(Resource):
    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            g = _group(group_id)
            mem = _member(group_id, me)
            if not g or not mem:
                return _no('Community not found.', 404)
            if g.get('admin_only') and mem.get('role') not in PRIVILEGED:
                return _no('Only community admins can post right now.', 403)
            d = request.get_json() or {}
            q, _f, refuse = chat_safety.clean((d.get('question') or '')[:300], allow_links=bool(g.get('allow_links')))
            if refuse or not q:
                return _no(refuse or 'Write the poll question.')
            opts = [str(o).strip()[:100] for o in (d.get('options') or []) if str(o).strip()]
            if not (2 <= len(opts) <= 10):
                return _no('A poll needs 2–10 options.')
            closes = None
            if d.get('closes_at'):
                try:
                    closes = datetime.datetime.fromisoformat(str(d['closes_at']).replace('Z', ''))
                except ValueError:
                    return _no('Closing time is not a valid date.')
            pid = str(uuid.uuid4())
            call_proc_one('sp_cm_poll_create', pid, group_id, q, json.dumps(opts, ensure_ascii=False),
                          1 if d.get('multi') else 0, closes, me)
            row = call_proc_one('sp_cm_message_create', str(uuid.uuid4()), group_id, me, q, None, None, None,
                                None, pid, 0, None)
            db.session.commit()
            msg = _decorate(group_id, [row], me)[0]
            _emit(group_id, 'community_message', {**msg, 'is_mine': False})
            return jsonify(response={'message': msg}, status=201, bool=True)
        except Exception as e:
            return _err('POST community poll', e)


@ns.route('/polls/<string:pid>/vote')
class PollVote(Resource):
    @jwt_required()
    def post(self, pid):
        try:
            me = get_jwt_identity()
            p = call_proc_one('sp_cm_poll_get', pid)
            if not p or not _member(p['group_id'], me):
                return _no('Poll not found.', 404)
            if p.get('closes_at') and datetime.datetime.utcnow() > p['closes_at']:
                return _no('This poll has closed.', 409)
            try:
                idx = int((request.get_json() or {}).get('option_index'))
            except (TypeError, ValueError):
                return _no('Pick an option.')
            if not (0 <= idx < len(_loads(p.get('options_json'), []))):
                return _no('Pick an option.')
            call_proc_one('sp_cm_poll_vote', pid, me, idx, p.get('multi'))
            db.session.commit()
            data = _poll_dict(p, me)
            _emit(p['group_id'], 'community_poll', {'poll_id': pid})
            return jsonify(response={'poll': data}, status=200, bool=True)
        except Exception as e:
            return _err('POST poll vote', e)


@ns.route('/groups/<string:group_id>/read')
class GroupRead(Resource):
    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            if not _member(group_id, me):
                return _no('Community not found.', 404)
            seq = int((request.get_json() or {}).get('seq') or 0)
            call_proc_one('sp_cm_read_set', me, group_id, seq)
            db.session.commit()
            return jsonify(response={'ok': True}, status=200, bool=True)
        except Exception as e:
            return _err('POST community read', e)


@ns.route('/groups/<string:group_id>/mute')
class GroupMute(Resource):
    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            if not _member(group_id, me):
                return _no('Community not found.', 404)
            muted = 1 if (request.get_json() or {}).get('muted') in (True, 1, '1', 'true') else 0
            call_proc_one('sp_cm_mute_set', me, group_id, muted)
            db.session.commit()
            return jsonify(response={'muted': bool(muted)}, status=200, bool=True)
        except Exception as e:
            return _err('POST community mute', e)


@ns.route('/chat/unread')
class ChatUnread(Resource):
    @jwt_required()
    def get(self):
        try:
            rows = call_proc('sp_cm_unread_counts', get_jwt_identity()) or []
            return jsonify(response={'groups': [{
                'group_id': r['group_id'], 'unread': int(r['unread'] or 0), 'muted': bool(r['muted']),
                'last_message_at': r['last_message_at'].isoformat() + 'Z' if r.get('last_message_at') else None,
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET community unread', e)


@ns.route('/groups/<string:group_id>/chat-settings')
class GroupChatSettings(Resource):
    @jwt_required()
    def put(self, group_id):
        try:
            me = get_jwt_identity()
            denied = _require_owner(me, group_id)
            if denied:
                return denied
            d = request.get_json() or {}

            def b(k):
                v = d.get(k)
                return None if v is None else (1 if v in (True, 1, '1', 'true') else 0)
            slow = d.get('slow_mode_seconds')
            try:
                slow = None if slow in (None, '') else int(slow)
            except (TypeError, ValueError):
                return _no('Slow mode must be a number of seconds.')
            if slow is not None and not (0 <= slow <= 3600):
                return _no('Slow mode must be 0–3600 seconds.')
            row = call_proc_one('sp_cm_group_settings_set', group_id, b('admin_only'), slow, b('allow_links'), me)
            db.session.commit()
            return jsonify(response={'settings': {'admin_only': bool(row['admin_only']),
                                                  'slow_mode_seconds': int(row['slow_mode_seconds'] or 0),
                                                  'allow_links': bool(row['allow_links'])}},
                           status=200, bool=True)
        except Exception as e:
            return _err('PUT community chat settings', e)


@ns.route('/groups/<string:group_id>/invite')
class GroupInvite(Resource):
    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            denied = _require_owner(me, group_id)
            if denied:
                return denied
            code = secrets.token_urlsafe(6)[:8].upper().replace('-', 'X').replace('_', 'Y')
            row = call_proc_one('sp_cm_invite_code_set', group_id, code)
            db.session.commit()
            return jsonify(response={'invite_code': row['invite_code']}, status=200, bool=True)
        except Exception as e:
            return _err('POST community invite', e)


def _join(user_id, group_id):
    """Same rules as POST /groups/<id>/join: the 3-community limit applies."""
    quota = _membership_quota(user_id)
    if not quota['can_add']:
        return None, jsonify(response=_upgrade_payload(quota['used']), status=403, bool=False)
    res = call_proc_one('sp_assemble_group_join', user_id, group_id) or {}
    result, status = res.get('result'), res.get('status')
    if result == 'notfound':
        return None, _no('Community not found.', 404)
    if result in ('already_member',):
        return None, _no('Already a member.', 409)
    if result == 'full':
        return None, _no('This community is full.')
    if status == 'pending':
        # An invite or an owner add is the owner's approval.
        res = call_proc_one('sp_assemble_request_decide', group_id, user_id, 1) or {}
        if res.get('result') == 'full':
            return None, _no('This community is full.')
    from portal.helpers import score
    score.award(user_id, score.COMMUNITY_JOIN, ref_id=group_id)
    return True, None


@ns.route('/join/<string:code>')
class JoinByInvite(Resource):
    @jwt_required()
    def post(self, code):
        try:
            me = get_jwt_identity()
            g = call_proc_one('sp_cm_group_by_invite', (code or '').strip().upper())
            if not g or g.get('deleted_at') or not g.get('is_active'):
                return _no('This invite link is not valid any more.', 404)
            ok, err = _join(me, g['id'])
            if err:
                return err
            db.session.commit()
            return jsonify(response={'message': f"Joined {g['name']}.", 'group_id': g['id']}, status=200, bool=True)
        except Exception as e:
            return _err('POST join by invite', e)


@ns.route('/members/search')
class MemberSearch(Resource):
    @jwt_required()
    def get(self):
        try:
            q = (request.args.get('q') or '').strip()
            if len(q) < 2:
                return jsonify(response={'students': []}, status=200, bool=True)
            rows = call_proc('sp_cm_member_search', q[:100], 20) or []
            return jsonify(response={'students': [{
                'user_id': r['user_id'], 'name': r['full_name'],
                'photo': browser_url(r['avatar_url']) if r.get('avatar_url') else None,
                'institute': r.get('institute'), 'city': r.get('city'),
            } for r in rows]}, status=200, bool=True)
        except Exception as e:
            return _err('GET member search', e)


@ns.route('/groups/<string:group_id>/members')
class OwnerAddMember(Resource):
    @jwt_required()
    def post(self, group_id):
        try:
            me = get_jwt_identity()
            denied = _require_owner(me, group_id)
            if denied:
                return denied
            uid = ((request.get_json() or {}).get('user_id') or '').strip()
            if not uid or uid == me:
                return _no('Choose a student to add.')
            ok, err = _join(uid, group_id)
            if err:
                body = err.get_json() or {}
                if body.get('status') == 403:
                    return _no('That student is already in 3 communities on the free plan.', 403)
                return err
            db.session.commit()
            g = _group(group_id) or {}
            from portal.helpers.notifications import notify_user
            notify_user(uid, 'You were added to a community', f"You're now in {g.get('name')}.",
                        type='community', reference_type='community', reference_id=group_id)
            return jsonify(response={'message': 'Student added.'}, status=200, bool=True)
        except Exception as e:
            return _err('POST owner add member', e)


@ns.route('/groups/<string:group_id>/top-helpers')
class TopHelpers(Resource):
    @jwt_required()
    def get(self, group_id):
        try:
            me = get_jwt_identity()
            if not _member(group_id, me):
                return _no('Community not found.', 404)
            ist = datetime.datetime.utcnow() + datetime.timedelta(hours=5, minutes=30)
            monday = (ist - datetime.timedelta(days=ist.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
            since = monday - datetime.timedelta(hours=5, minutes=30)
            rows = call_proc('sp_cm_top_helpers', group_id, since, 10) or []
            return jsonify(response={'helpers': [{
                'rank': i, 'user_id': r['user_id'], 'name': r['full_name'],
                'photo': browser_url(r['avatar_url']) if r.get('avatar_url') else None,
                'solved': int(r['solved']), 'is_me': r['user_id'] == me,
            } for i, r in enumerate(rows, 1)]}, status=200, bool=True)
        except Exception as e:
            return _err('GET top helpers', e)
