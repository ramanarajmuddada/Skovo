"""Community chat over Socket.IO (feature-updates.md §6).

Shares the whiteboard's Socket.IO server and its connect handler (the JWT is
checked once at connect). A client joins a community room only if it is an
active member; messages themselves are written through the REST API
(routes/Assemble/chat.py), which emits to the room after saving. Clients that
cannot hold a socket poll GET /assemble/groups/<id>/chat?after=<seq>.
"""
import logging

from flask import session
from flask_socketio import join_room, leave_room

from portal.whiteboard_socket import socketio

logger = logging.getLogger("skovo")


@socketio.on('join_community')
def handle_join_community(data):
    from portal.helpers.sp import call_proc_one
    user_id = session.get('wb_user_id')
    if not user_id:
        return {'ok': False, 'message': 'Unauthorized.'}
    group_id = (data or {}).get('group_id')
    if not group_id:
        return {'ok': False, 'message': 'group_id is required.'}
    m = call_proc_one('sp_cm_member_role', group_id, user_id) or {}
    if m.get('status') != 'active':
        return {'ok': False, 'message': 'Not a member.'}
    join_room(f'community:{group_id}')
    return {'ok': True}


@socketio.on('leave_community')
def handle_leave_community(data):
    group_id = (data or {}).get('group_id')
    if group_id:
        leave_room(f'community:{group_id}')
    return {'ok': True}


@socketio.on('community_typing')
def handle_typing(data):
    """Ephemeral 'is typing' -- relayed, never stored."""
    user_id = session.get('wb_user_id')
    group_id = (data or {}).get('group_id')
    if user_id and group_id:
        socketio.emit('community_typing', {'group_id': group_id, 'user_id': user_id},
                      room=f'community:{group_id}', include_self=False)
