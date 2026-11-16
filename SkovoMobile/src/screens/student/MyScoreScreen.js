// ── My Readiness Score (student) ─────────────────────────────────────────────
// The Score Engine surface: current score, what it unlocks, where points came
// from, the ledger, and the pause tokens that freeze decay.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Loader, Pill, ErrorState, useToast } from '../../components/ui';
import { studentApi } from '../../services/api';

export default function MyScoreScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const [data, setData] = useState(null);
  const [unlocks, setUnlocks] = useState(null);
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [pausing, setPausing] = useState(false);

  const load = useCallback(() => {
    Promise.all([
      studentApi.get('/readiness/score').then(({ data: d }) => { if (d.bool) setData(d.response); }),
      studentApi.get('/readiness/score/unlocks').then(({ data: d }) => { if (d.bool) setUnlocks(d.response); }),
      studentApi.get('/readiness/score/events').then(({ data: d }) => { if (d.bool) setEvents(d.response.events || []); }),
    // Swallowed before: a failed load showed a zeroed score, which a student
    // reads as "I have lost my progress".
    ]).catch(() => setFailed(true)).finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const pause = data?.pause || {};
  const remaining = Math.max(0, (pause.max_tokens || 0) - (pause.used_this_year || 0));
  const isPaused = !!pause.active_until;
  const decaying = (data?.decay_points || 0) > 0;

  const doPause = () => {
    Alert.alert('Pause your score?',
      `Freeze decay for ${pause.pause_days || 21} days. Uses one of your ${pause.max_tokens || 2} yearly pauses.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Pause', onPress: async () => {
          setPausing(true);
          try {
            const { data: d } = await studentApi.post('/readiness/score/pause', {});
            Alert.alert(d.bool ? 'Done' : 'Could not pause', d.response?.message || '');
            load();
          } catch {
            toast.error('Connection problem — your score was not paused.');
          } finally { setPausing(false); }
       } }]);
  };

  if (loading) return <Screen><Loader label="Loading your score…" /></Screen>;

  // A zeroed score is a claim about the student's progress. We cannot make
  // it when the request never answered.
  if (failed) return (
    <Screen>
      <ErrorState title="We couldn't load your score"
                  subtitle="Your progress is safe — this is a connection problem."
                  onRetry={load} />
    </Screen>
  );

  const score = data?.score || 0;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1>My Score</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Every point you have earned, and what it unlocks</Muted>

      {/* Score dial */}
      <Card style={{ alignItems: 'center', paddingVertical: spacing(6) }}>
        <View style={s.ring}>
          <Text style={s.scoreNum}>{score}</Text>
          <Text style={s.scoreOf}>/ 100</Text>
        </View>
        {!!data?.level && <Pill label={data.level} tone="primary" style={{ marginTop: spacing(3) }} />}
        <Text style={s.earned}>
          {data?.base_points || 0} earned{decaying ? `  ·  −${data.decay_points} inactivity` : ''}
        </Text>
      </Card>

      {/* Decay warning / pause */}
      {isPaused ? (
        <Card style={s.pausedCard}>
          <Feather name="pause-circle" size={16} color={colors.info} />
          <Text style={s.pausedText}>
            Paused — no decay until {new Date(pause.active_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
          </Text>
        </Card>
      ) : (
        <Card style={{ marginTop: spacing(3) }}>
          <H2>{decaying ? 'Your score is dropping' : 'Taking a break?'}</H2>
          <Muted style={{ marginTop: spacing(1) }}>
            {decaying
              ? `You've lost ${data.decay_points} point(s) to inactivity. `
              : 'Your score dips slowly while you are away. '}
            Pause it for {pause.pause_days || 21} days — {remaining} of {pause.max_tokens || 2} left this year.
          </Muted>
          <Button title={remaining === 0 ? 'No pauses left' : 'Pause my score'} icon="pause-circle"
                  variant="outline" onPress={doPause} loading={pausing} disabled={remaining === 0}
                  style={{ marginTop: spacing(3) }} />
        </Card>
      )}

      {/* Unlocks */}
      <H2 style={{ marginTop: spacing(5), marginBottom: spacing(2) }}>What your score unlocks</H2>
      {(unlocks?.unlocks || []).map((u) => (
        <Card key={u.key} style={s.unlockRow}>
          <View style={[s.unlockIcon, { backgroundColor: u.unlocked ? colors.successSoft : colors.surfaceAlt }]}>
            <Feather name={u.unlocked ? 'unlock' : 'lock'} size={15}
                     color={u.unlocked ? colors.success : colors.textSubtle} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[s.unlockLabel, { color: u.unlocked ? colors.text : colors.textMuted }]}>{u.label}</Text>
            <Muted style={{ fontSize: font.xs }}>
              {u.unlocked ? 'Unlocked' : `${u.points_away} more point(s)`}
            </Muted>
          </View>
          <Text style={s.unlockReq}>{u.required}</Text>
        </Card>
      ))}

      {/* Where points come from */}
      <H2 style={{ marginTop: spacing(5), marginBottom: spacing(2) }}>Where your points come from</H2>
      {(data?.breakdown || []).filter((b) => b.points_each > 0).map((b) => {
        const ceiling = b.cap_value ? b.cap_value * b.points_each : null;
        const pct = ceiling ? Math.min(100, Math.round((b.earned / ceiling) * 100)) : 0;
        return (
          <View key={b.event_type} style={{ marginBottom: spacing(3) }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={s.bLabel}>{b.label}</Text>
              <Muted style={{ fontSize: font.xs }}>{b.earned}{ceiling ? `/${ceiling}` : ''}</Muted>
            </View>
            <View style={s.barTrack}>
              <View style={[s.barFill, { width: `${pct}%` }]} />
            </View>
          </View>
        );
      })}

      {/* Recent history */}
      <H2 style={{ marginTop: spacing(4), marginBottom: spacing(2) }}>Recent activity</H2>
      {events.length === 0 ? (
        <Muted>No points yet — complete your assessment or add a document to start.</Muted>
      ) : (
        events.slice(0, 12).map((e) => (
          <View key={e.id} style={s.evRow}>
            <Feather name="clock" size={13} color={colors.textSubtle} />
            <Text style={s.evLabel} numberOfLines={1}>{e.label}</Text>
            <Text style={s.evPts}>+{e.points}</Text>
          </View>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  ring: { width: 120, height: 120, borderRadius: 60, borderWidth: 8, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center' },
  scoreNum: { fontSize: font.huge, fontWeight: '800', color: colors.text, lineHeight: 38 },
  scoreOf: { fontSize: font.xs, color: colors.textSubtle, fontWeight: '600' },
  earned: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing(3) },
  pausedCard: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(3),
    backgroundColor: colors.infoSoft },
  pausedText: { fontSize: font.sm, color: colors.info, fontWeight: '600', flex: 1 },
  unlockRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginBottom: spacing(2) },
  unlockIcon: { width: 34, height: 34, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  unlockLabel: { fontSize: font.sm, fontWeight: '700' },
  unlockReq: { fontSize: font.sm, fontWeight: '800', color: colors.textSubtle },
  bLabel: { fontSize: font.sm, color: colors.text, fontWeight: '600', flex: 1, marginRight: spacing(2) },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surfaceAlt, marginTop: spacing(1.5), overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.primary },
  evRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), paddingVertical: spacing(2),
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  evLabel: { fontSize: font.sm, color: colors.text, flex: 1 },
  evPts: { fontSize: font.sm, fontWeight: '800', color: colors.success },
});
