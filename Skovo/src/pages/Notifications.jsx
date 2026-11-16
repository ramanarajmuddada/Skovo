import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { PageHeader, EmptyState, Card, Button, StudentPage, Toast } from '../components/ui/index.jsx';
import { LoadError } from '../components/ui/TableComponents';
import {
  Bell, CheckSquare, Briefcase, BookOpen, Star, Info,
  Calendar, CheckCheck, Clock, BellDot,
} from 'lucide-react';
import { Tabs } from '../components/admin/v1/AdminV1Kit';

const TYPE_ICON = {
  task_scored:    CheckSquare,
  opportunity:    Briefcase,
  cohort:         BookOpen,
  booking:        Calendar,
  mentor:         Star,
  system:         Info,
};

function dest(n) {
  const t = `${n.reference_type || ''} ${n.type || ''}`.toLowerCase();
  if (t.includes('cohort')) return '/cohorts';
  if (t.includes('booking') || t.includes('session')) return '/bookings';
  if (t.includes('opportunit')) return '/opportunities';
  if (t.includes('task')) return '/tasks';
  if (t.includes('college')) return '/colleges';
  if (t.includes('mentor') || t.includes('achiever')) return '/find-mentors';
  if (t.includes('assemble') || t.includes('communit')) return '/assemble';
  if (t.includes('vault') || t.includes('document')) return '/document-vault';
  return null;
}

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString('en-IN', { dateStyle: 'medium' });
}

function NotifCard({ n, onOpen }) {
  const type = n.type || 'system';
  const Icon = TYPE_ICON[type] || Bell;
  const unread = !n.is_read;

  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className="w-full text-left rounded-2xl"
    >
      <Card
        className={`p-4 flex items-start gap-4 min-h-11 transition-all ${unread ? 'border-l-4' : ''}`}
        style={unread ? { borderLeftColor: 'var(--accent)' } : undefined}
      >
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border"
          style={{
            backgroundColor: unread
              ? 'color-mix(in srgb, var(--accent) 12%, transparent)'
              : undefined,
            color: unread ? 'var(--accent)' : undefined,
            borderColor: unread
              ? 'color-mix(in srgb, var(--accent) 25%, transparent)'
              : undefined,
          }}>
          <Icon size={17} className={unread ? '' : 'text-slate-500'} />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <p className={`text-sm leading-snug ${unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>
              {n.title || n.message}
            </p>
            <span className="text-[11px] text-slate-400 shrink-0 flex items-center gap-1 mt-0.5">
              <Clock size={10} /> {fmt(n.created_at)}
            </span>
          </div>

          {n.title && n.message && (
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.message}</p>
          )}

          {unread && (
            <div className="mt-2">
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md"
                style={{ color: 'var(--accent)', backgroundColor: 'color-mix(in srgb, var(--accent) 12%, transparent)' }}>
                New
              </span>
            </div>
          )}
        </div>
      </Card>
    </button>
  );
}

export default function Notifications() {
  const navigate = useNavigate();
  const [notifs, setNotifs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const unreadCount = notifs.filter((n) => !n.is_read).length;
  const visible = filter === 'unread' ? notifs.filter((n) => !n.is_read) : notifs;

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = useCallback(() => {
    setLoading(true);
    setLoadError('');
    api.get('/notifications/')
      .then(({ data }) => {
        if (data.bool) setNotifs(data.response.notifications || []);
        else {
          setNotifs([]);
          setLoadError(data.response?.message || 'Could not load notifications.');
        }
      })
      .catch(() => { setNotifs([]); setLoadError('Could not load notifications. Check your connection and try again.'); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const markRead = async (id) => {
    try {
      await api.patch(`/notifications/${id}/read`);
      setNotifs((prev) => prev.map((n) => n.id === id ? { ...n, is_read: true } : n));
    } catch {}
  };

  const open = async (n) => {
    if (!n.is_read) await markRead(n.id);
    const to = dest(n);
    if (to) navigate(to);
  };

  const markAllRead = async () => {
    setMarkingAll(true);
    try {
      const { data } = await api.post('/notifications/mark-all-read');
      if (data.bool) {
        setNotifs((prev) => prev.map((n) => ({ ...n, is_read: true })));
        flash('All notifications marked as read.');
      } else flash(data.response?.message || 'Could not mark them as read.', 'error');
    } catch { flash('Could not mark them as read.', 'error'); }
    finally { setMarkingAll(false); }
  };

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Notifications"
        subtitle={unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? 's' : ''}` : 'You are all caught up'}
        action={
          unreadCount > 0 ? (
            <Button variant="secondary" size="sm" className="min-h-11 w-full sm:w-auto" onClick={markAllRead} disabled={markingAll}>
              <CheckCheck size={14} /> {markingAll ? 'Marking…' : 'Mark all read'}
            </Button>
          ) : null
        }
      />

      <Tabs active={filter} onChange={setFilter} tabs={[
        { key: 'all', label: 'All', icon: Bell, count: notifs.length },
        { key: 'unread', label: 'Unread', icon: BellDot, count: notifs.filter((n) => !n.is_read).length },
      ]} />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-20 bg-white border border-slate-100 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : loadError ? (
        <LoadError what="notifications" message={loadError} onRetry={load} />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={Bell}
          title={filter === 'unread' ? 'Nothing unread' : 'No notifications yet'}
          subtitle={filter === 'unread'
            ? 'You are all caught up.'
            : 'Updates about cohorts, tasks, bookings and opportunities land here.'}
        />
      ) : (
        <div className="space-y-2">
          {filter === 'all' && unreadCount > 0 && (
            <div className="mb-4">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 px-1">Unread</p>
              <div className="space-y-2">
                {notifs.filter((n) => !n.is_read).map((n) => (
                  <NotifCard key={n.id} n={n} onOpen={open} />
                ))}
              </div>
            </div>
          )}

          {(filter === 'unread' ? visible : notifs.filter((n) => n.is_read)).length > 0 && (
            <div>
              {filter === 'all' && unreadCount > 0 && (
                <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 px-1">Earlier</p>
              )}
              <div className="space-y-2">
                {(filter === 'unread' ? visible : notifs.filter((n) => n.is_read)).map((n) => (
                  <NotifCard key={n.id} n={n} onOpen={open} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </StudentPage>
  );
}
