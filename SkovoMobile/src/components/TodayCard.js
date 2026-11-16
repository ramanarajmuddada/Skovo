// ── Home "Today" card (feature-updates.md §6, §7). Each block hides itself
//    while the admin has the feature switched off. ───────────────────────────
import React, { useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useTheme } from '../theme';
import { Card } from './ui';
import { T, Bar } from './v1';
import { studentApi } from '../services/api';
import { refreshWidget } from '../services/widget';

export default function TodayCard({ navigation, refreshKey }) {
  const { colors } = useTheme();
  const [d, setD] = useState(null);
  useEffect(() => {
    studentApi.get('/engagement/today').then(({ data }) => data?.bool && setD(data.response)).catch(() => {});
    refreshWidget();
  }, [refreshKey]);
  if (!d) return null;
  const st = d.streak || {};
  const coins = d.coins !== null && d.coins !== undefined;
  if (!st.enabled && !d.goal && !d.quests?.length && !d.mistakes_due && !d.boost && !coins) return null;

  return (
    <Card style={{ marginBottom: 16, gap: 10 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <T bold>Today</T>
        {coins && <TouchableOpacity onPress={() => navigation.navigate('Practice', { tab: 'shop' })}><T bold color={colors.warning}>🪙 {d.coins}</T></TouchableOpacity>}
      </View>
      {st.enabled && (
        <TouchableOpacity onPress={() => navigation.navigate('Streak')}
                          style={{ padding: 12, borderRadius: 12, backgroundColor: st.at_risk ? colors.dangerSoft : colors.warningSoft }}>
          <T bold>🔥 {st.lifetime_current} day streak <T size={12} muted>· this stage {st.stage_current}</T></T>
          <T size={12} muted>{st.kept_today ? 'Kept for today ✓' : st.at_risk ? 'Do one task today to keep it' : 'Start your streak with one task'}{st.can_restore ? ' · tap to restore' : ''}</T>
        </TouchableOpacity>
      )}
      {d.boost && <T size={12} color={colors.primary}>⚡ {d.boost.multiplier}× points boost is on</T>}
      {d.goal?.goal && (
        <View style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={12} bold>Daily goal</T><T size={12}>{d.goal.done_today}/{d.goal.goal.tasks_per_day}{d.goal.met_today ? ' ✓' : ''}</T></View>
          <Bar value={d.goal.done_today} max={d.goal.goal.tasks_per_day} />
        </View>
      )}
      {(d.quests || []).map((q) => (
        <View key={q.quest_id} style={{ gap: 4 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={12} muted={q.done}>{q.label}</T><T size={12}>{q.progress}/{q.target}</T></View>
          <Bar value={q.progress} max={q.target} />
        </View>
      ))}
      {d.friend_quest && <T size={12}>👥 {d.friend_quest.label} with {d.friend_quest.with}: {d.friend_quest.progress}/{d.friend_quest.target}</T>}
      {d.challenge && <T size={12} muted>🏅 Monthly challenge: {d.challenge.label} — {d.challenge.done}/{d.challenge.target}{d.challenge.earned ? ' · earned' : ''}</T>}
      {d.mistakes_due > 0 && (
        <TouchableOpacity onPress={() => navigation.navigate('Practice', { tab: 'mistakes' })}><T size={12} bold color={colors.danger}>↻ {d.mistakes_due} question(s) to retry</T></TouchableOpacity>
      )}
    </Card>
  );
}
