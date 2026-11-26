import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { adminApi } from '../../services/api';
import { adminRouteFor, NOTIFS_READ, NOTIFS_NEW } from '../../utils/adminNotifRoute';

const PAGE = '/skovo-platform-panel-admin/notifications';
const POLL_MS = 30000;

const when = (iso) => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '');

export default function AdminNotifBell() {
  const [count, setCount] = useState(0);
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const last = useRef(null);
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const refresh = useCallback(() => {
    adminApi.get('/notifications/unread-count')
      .then(({ data }) => {
        if (!data?.bool) return;
        const n = Number(data.response.count) || 0;
        const grew = last.current !== null && n > last.current;
        last.current = n;
        setCount(n);
        if (grew) window.dispatchEvent(new Event(NOTIFS_NEW));
      })
      .catch(() => {});   // the badge keeps its last value until the next poll
  }, []);

  // On every screen change, every 30 seconds, and when the tab is looked at again.
  useEffect(() => { refresh(); }, [refresh, pathname]);
  useEffect(() => {
    const tick = () => { if (!document.hidden) refresh(); };
    const id = setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    window.addEventListener(NOTIFS_READ, refresh);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', tick);
      window.removeEventListener(NOTIFS_READ, refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', away); document.removeEventListener('keydown', esc); };
  }, [open]);

  const loadRows = () => {
    setFailed(false);
    adminApi.get('/notifications/')
      .then(({ data }) => { if (data?.bool) setRows((data.response.notifications || []).slice(0, 8)); else setFailed(true); })
      .catch(() => setFailed(true));
  };

  const toggle = () => {
    if (!open) { loadRows(); refresh(); }
    setOpen((o) => !o);
  };

  const openRow = async (n) => {
    setOpen(false);
    navigate(adminRouteFor(n) || PAGE);
    if (n.is_read) return;
    try { await adminApi.patch(`/notifications/${n.id}/read`, {}); refresh(); } catch { /* stays unread */ }
  };

  const markAll = async () => {
    try {
      await adminApi.post('/notifications/mark-all-read', {});
      setRows((r) => r?.map((n) => ({ ...n, is_read: true })));
      refresh();
      window.dispatchEvent(new Event(NOTIFS_NEW));   // reloads an open page
    } catch { /* nothing changed */ }
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={toggle} aria-expanded={open} title="Notifications"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        className="relative p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-all before:absolute before:-inset-1 before:content-['']">
        <Bell size={18} />
        {count > 0 && (
          <span className="absolute top-1 right-1 translate-x-1/3 -translate-y-1/3 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-bold leading-[18px] text-center tabular-nums shadow-sm">
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>
      {open && (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden flex flex-col shadow-2xl"
             style={{ position: 'fixed', right: 8, top: 60, width: 'min(340px, calc(100vw - 16px))', maxHeight: 420, zIndex: 50 }}>
          <div className="flex items-center justify-between gap-2 px-3.5 py-2.5 border-b border-slate-100">
            <span className="text-xs font-bold text-slate-700">Notifications</span>
            {count > 0 && (
              <button type="button" onClick={markAll} className="w-auto! text-xs font-semibold text-blue-600">Mark all read</button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {failed ? (
              <p className="text-center py-6 px-3 text-xs text-slate-500">
                Could not load notifications. <button type="button" onClick={loadRows} className="font-semibold text-blue-600">Try again</button>
              </p>
            ) : !rows ? (
              <p className="text-center py-6 text-xs text-slate-400">Loading...</p>
            ) : rows.length === 0 ? (
              <p className="text-center py-6 text-xs text-slate-400">No notifications yet</p>
            ) : rows.map((n) => (
              <button type="button" key={n.id} onClick={() => openRow(n)}
                className={`block w-full text-left px-3.5 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50 ${n.is_read ? '' : 'bg-blue-50/50'}`}>
                <p className={`text-xs text-slate-800 ${n.is_read ? 'font-semibold' : 'font-bold'}`}>{n.title}</p>
                <p className="text-[11px] text-slate-500 line-clamp-2 break-words">{n.message}</p>
                <p className="text-[10px] text-slate-400 mt-0.5">{when(n.created_at)}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); navigate(PAGE); }}
            className="px-3.5 py-2.5 border-t border-slate-100 text-xs font-semibold text-blue-600 hover:bg-slate-50 text-center">
            View all notifications
          </button>
        </div>
      )}
    </div>
  );
}
