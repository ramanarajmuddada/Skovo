// ── Notifications (student) ──────────────────────────────────────────────────
// One of the v1 eighteen. Mobile had no notification surface at all, so a
// student on the phone never saw a cohort reminder, a booking confirmation or
// an application update — every one of which is a reason to come back.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme, useThemedStyles, radius, spacing, font, tint } from '../../theme';
import { Screen, H1, Muted, Card, Loader, Empty, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

// Icon and tone by notification type; anything unmapped still renders.
const TYPE_LOOK = {
  cohort:       { icon: 'users',       tone: 'primary' },
  booking:      { icon: 'calendar',    tone: 'info' },
  session:      { icon: 'video',       tone: 'info' },
  opportunity:  { icon: 'briefcase',   tone: 'success' },
  application:  { icon: 'file-text',   tone: 'success' },
  score:        { icon: 'trending-up', tone: 'warning' },
  task:         { icon: 'check-square', tone: 'primary' },
  payment:      { icon: 'credit-card', tone: 'success' },
  system:       { icon: 'bell',        tone: 'textMuted' },
};

function relativeTime(value) {
  if (!value) return '';
  const then = new Date(value).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(value).toLocaleDateString('en-IN');
}

export default function NotificationsScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  // The app is student-only, so there is one token and one client. This screen
  // used to switch on route.params.role because the achiever stack registered
  // it too; that stack is gone, and a role param would now select a client with
  // no session behind it.
  const api = studentApi;

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/notifications/')
      .then(({ data }) => { if (data.bool) setItems(data.response?.notifications || []); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [api]);

  useEffect(() => { load(); }, [load]);

  const unread = items.filter(n => !n.is_read).length;

  const markOne = async (id) => {
    // Optimistic: the badge should drop the instant it is tapped.
    setItems(prev => prev.map(n => (n.id === id ? { ...n, is_read: true } : n)));
    // PATCH, not POST — the route is PATCH-only and a POST returns 405, which
    // the catch below swallowed, so the row silently bounced back to unread.
    try { await api.patch(`/notifications/${id}/read`); } catch { load(); }
  };

  const markAll = async () => {
    if (busy || !unread) return;
    setBusy(true);
    setItems(prev => prev.map(n => ({ ...n, is_read: true })));
    try { await api.post('/notifications/mark-all-read', {}); } catch { load(); }
    finally { setBusy(false); }
  };

  if (loading) return <Screen><Loader label="Loading notifications…" /></Screen>;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <H1>Notifications</H1>
          <Muted>{unread ? `${unread} unread` : 'You are all caught up'}</Muted>
        </View>
        {unread > 0 ? (
          <TouchableOpacity onPress={markAll} disabled={busy} style={s.markAll}>
            <Text style={s.markAllText}>Mark all read</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {items.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load your notifications"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="bell" title="Nothing yet"
               subtitle="Cohort reminders, booking updates and opportunity news will land here." />
        )
      ) : items.map(n => {
        const look = TYPE_LOOK[n.type] || TYPE_LOOK.system;
        const tone = colors[look.tone] || colors.primary;
        return (
          <Card key={n.id} onPress={() => !n.is_read && markOne(n.id)}
                style={[s.row, !n.is_read && s.rowUnread]}>
            <View style={[s.icon, { backgroundColor: tint(tone, 0.1) }]}>
              <Feather name={look.icon} size={16} color={tone} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.title, !n.is_read && s.titleUnread]} numberOfLines={2}>
                {n.title || 'Update'}
              </Text>
              {n.message ? <Text style={s.body} numberOfLines={3}>{n.message}</Text> : null}
              <Text style={s.time}>{relativeTime(n.created_at)}</Text>
            </View>
            {!n.is_read ? <View style={s.dot} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  head:        { flexDirection: 'row', alignItems: 'flex-start', marginBottom: spacing(4) },
  markAll:     { paddingHorizontal: spacing(3), paddingVertical: spacing(2.5), minHeight: 36,
                 justifyContent: 'center', borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  markAllText: { fontSize: font.sm, fontWeight: font.semibold, color: colors.primaryDark },

  row:        { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(3), marginBottom: spacing(3) },
  rowUnread:  { borderColor: colors.primary, borderWidth: 1 },
  icon:       { width: 40, height: 40, borderRadius: radius.sm,
                alignItems: 'center', justifyContent: 'center' },
  title:      { fontSize: font.base, color: colors.text, fontWeight: font.medium },
  titleUnread:{ fontWeight: font.bold },
  body:       { fontSize: font.sm, color: colors.textMuted, marginTop: 4, lineHeight: 20 },
  time:       { fontSize: font.xs, color: colors.textSubtle, marginTop: spacing(1) },
  dot:        { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.primary, marginTop: 6 },
});
