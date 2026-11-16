// ── My Applications (student) ────────────────────────────────────────────────
// The student's opportunity applications with pipeline stats and status.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Loader, Empty, Pill, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

const STATUS_TONE = { applied: 'primary', interviewing: 'warning', offered: 'success',
                      rejected: 'danger', withdrawn: 'neutral' };
const STATUS_LABEL = { applied: 'Applied', interviewing: 'Shortlisted', offered: 'Offered',
                       rejected: 'Rejected', withdrawn: 'Withdrawn' };

export default function ApplicationsScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [apps, setApps] = useState([]);
  const [stats, setStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    studentApi.get('/applications/')
      .then(({ data: d }) => {
        if (d.bool) { setApps(d.response.applications || []); setStats(d.response.stats || {}); }
      })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  if (loading) return <Screen><Loader label="Loading applications…" /></Screen>;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1>Applications</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Track where you have applied</Muted>

      {/* Pipeline stats */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing(4) }}>
        {['applied', 'interviewing', 'offered', 'rejected'].map((k) => (
          <View key={k} style={s.stat}>
            <Text style={s.statNum}>{stats[k] || 0}</Text>
            <Text style={s.statLabel}>{STATUS_LABEL[k]}</Text>
          </View>
        ))}
      </ScrollView>

      {apps.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load your applications"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="send" title="No applications yet"
               subtitle="Apply to opportunities once your score unlocks the hub" />
        )
      ) : (
        apps.map((a) => (
          <Card key={a.id} style={{ marginBottom: spacing(2.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.title} numberOfLines={1}>{a.title || 'Opportunity'}</Text>
                {!!a.company && <Muted style={{ marginTop: 2 }}>{a.company}</Muted>}
              </View>
              <Pill label={STATUS_LABEL[a.status] || a.status} tone={STATUS_TONE[a.status] || 'neutral'} />
            </View>
            <View style={s.meta}>
              {!!a.location && (
                <View style={s.metaItem}>
                  <Feather name="map-pin" size={11} color={colors.textSubtle} />
                  <Muted style={{ fontSize: font.xs }}>{a.location}{a.is_remote ? ' · Remote' : ''}</Muted>
                </View>
              )}
              {!!a.applied_at && (
                <View style={s.metaItem}>
                  <Feather name="calendar" size={11} color={colors.textSubtle} />
                  <Muted style={{ fontSize: font.xs }}>
                    {new Date(a.applied_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Muted>
                </View>
              )}
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  stat: { backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: spacing(3),
    paddingHorizontal: spacing(5), alignItems: 'center', marginRight: spacing(2.5),
    borderWidth: 1, borderColor: colors.borderSoft },
  statNum: { fontSize: font.xl, fontWeight: '800', color: colors.text },
  statLabel: { fontSize: font.xs, color: colors.textMuted, marginTop: 2 },
  title: { fontSize: font.md, fontWeight: '700', color: colors.text },
  meta: { flexDirection: 'row', gap: spacing(4), marginTop: spacing(3) },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: spacing(1) },
});
