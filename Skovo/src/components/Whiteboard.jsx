import React, { useEffect, useRef, useState } from 'react';
import { Tldraw, useEditor } from 'tldraw';
import 'tldraw/tldraw.css';
import { io } from 'socket.io-client';
import { X, Loader2, WifiOff } from 'lucide-react';
import { SOCKET_URL } from '../services/api';

const SAVE_INTERVAL_MS = 5000;
const PATCH_DEBOUNCE_MS = 250;

/**
 * Mounted once the tldraw editor is ready. Wires up the two directions of
 * sync: local user edits -> debounced full-snapshot broadcast, and incoming
 * `board_patch` events -> merged into the store as remote changes (so they
 * never re-trigger the local "user" listener and loop back out).
 */
function SyncedBoard({ socket, contextType, contextId, initialSnapshot }) {
  const editor = useEditor();
  const patchTimer = useRef(null);
  const loadedInitial = useRef(false);

  // Load the last-saved snapshot once, before wiring up the local listener,
  // so restoring it is never mistaken for a "user" edit.
  useEffect(() => {
    if (loadedInitial.current) return;
    loadedInitial.current = true;
    if (initialSnapshot) {
      try {
        editor.store.mergeRemoteChanges(() => {
          editor.store.loadStoreSnapshot(JSON.parse(initialSnapshot));
        });
      } catch {
        // corrupt/old snapshot format — start from a blank board rather than crash
      }
    }
  }, [editor, initialSnapshot]);

  // Broadcast local edits (debounced) as a full document snapshot.
  useEffect(() => {
    const unlisten = editor.store.listen(
      () => {
        clearTimeout(patchTimer.current);
        patchTimer.current = setTimeout(() => {
          const snapshot = editor.store.getStoreSnapshot();
          socket.emit('board_patch', { context_type: contextType, context_id: contextId, patch: snapshot });
        }, PATCH_DEBOUNCE_MS);
      },
      { source: 'user', scope: 'document' }
    );
    return () => {
      clearTimeout(patchTimer.current);
      unlisten();
    };
  }, [editor, socket, contextType, contextId]);

  // Apply incoming remote snapshots.
  useEffect(() => {
    const onPatch = (snapshot) => {
      if (!snapshot) return;
      editor.store.mergeRemoteChanges(() => {
        editor.store.loadStoreSnapshot(snapshot);
      });
    };
    socket.on('board_patch', onPatch);
    return () => socket.off('board_patch', onPatch);
  }, [editor, socket]);

  // Periodically persist a full snapshot so a refresh/late-joiner restores state.
  useEffect(() => {
    const save = () => {
      const snapshot = editor.store.getStoreSnapshot();
      socket.emit('board_save', { context_type: contextType, context_id: contextId, canvas_data: JSON.stringify(snapshot) });
    };
    const interval = setInterval(save, SAVE_INTERVAL_MS);
    return () => {
      clearInterval(interval);
      save(); // final save on close
    };
  }, [editor, socket, contextType, contextId]);

  return null;
}

/**
 * Full-screen realtime whiteboard modal.
 *
 * @param contextType 'session' | 'cohort'
 * @param contextId   the achiever_sessions.id or cohorts.id being taught in
 * @param token       the caller's JWT access token (student/achiever/etc.)
 * @param title       header text (e.g. the other participant's name)
 * @param onClose     called when the user closes the modal
 */
export default function Whiteboard({ contextType, contextId, token, title, onClose }) {
  const [status, setStatus] = useState('connecting'); // connecting | ready | denied | error
  const [message, setMessage] = useState('');
  const [initialSnapshot, setInitialSnapshot] = useState(null);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io(SOCKET_URL, { auth: { token }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => {
      socket.emit('join_board', { context_type: contextType, context_id: contextId }, (res) => {
        if (res && res.ok) {
          setInitialSnapshot(res.canvas_data || null);
          setStatus('ready');
        } else {
          setMessage((res && res.message) || 'Could not open the whiteboard.');
          setStatus('denied');
        }
      });
    });

    socket.on('connect_error', () => {
      setMessage('Could not connect to the whiteboard server.');
      setStatus('error');
    });

    return () => {
      socket.emit('leave_board', { context_type: contextType, context_id: contextId });
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextType, contextId, token]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/60">
      <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-slate-200 shrink-0">
        <div>
          <p className="font-bold text-slate-900 text-sm">Whiteboard{title ? ` — ${title}` : ''}</p>
          <p className="text-[11px] text-slate-400">Drawings sync live and are saved automatically.</p>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="relative flex-1 bg-white">
        {status === 'ready' ? (
          <Tldraw>
            <SyncedBoard
              socket={socketRef.current}
              contextType={contextType}
              contextId={contextId}
              initialSnapshot={initialSnapshot}
            />
          </Tldraw>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-slate-400">
            {status === 'connecting' && (
              <>
                <Loader2 size={28} className="animate-spin" />
                <p className="text-sm font-medium">Opening whiteboard…</p>
              </>
            )}
            {(status === 'denied' || status === 'error') && (
              <>
                <WifiOff size={28} />
                <p className="text-sm font-medium text-slate-500">{message}</p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
