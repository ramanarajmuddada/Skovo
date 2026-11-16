// ── Streak (feature-updates.md §6): two counters, calendar, freezes, restore,
//    daily goal, buddy streaks ───────────────────────────────────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { View, TextInput, Share } from 'react-native';
import { useTheme } from '../../theme';
import { Screen, H1, Card, Button, Loader, Chip, useToast, confirm } from '../../components/ui';
import { T } from '../../components/v1';
import { studentApi } from '../../services/api';

export default function StreakScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const [s, setS] = useState(null);
  const [goal, setGoal] = useState(null);
  const [buddies, setBuddies] = useState({ buddies: [], max: 0 });
  const [code, setCode] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await Promise.all([
      studentApi.get('/gamification/streak').then(({ data }) => data?.bool && setS(data.response)).catch(() => {}),
      studentApi.get('/engagement/today').then(({ data }) => data?.bool && setGoal(data.response.goal)).catch(() => {}),
      studentApi.get('/gamification/streak/buddies').then(({ data }) => data?.bool && setBuddies(data.response)).catch(() => {}),
    ]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (p, ok) => {
    try {
      const { data } = await p;
      if (data?.bool) { if (ok) toast.success(data.response?.message || ok); load(); return data.response; }
      toast.error(data?.response?.message || 'Could not do that.');
    } catch { toast.error('Connection problem.'); }
    return null;
  };

  if (!s) return <Screen><Loader label="Loading…" /></Screen>;
  if (!s.enabled) return <Screen><H1>Streak</H1><T muted>Streaks are not switched on yet.</T></Screen>;

  const KIND = { kept: colors.warning, frozen: '#38bdf8', restored: '#8b5cf6', missed: colors.border };

  return (
    <Screen scroll refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <H1>Streak</H1>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
        <Card style={{ flex: 1, backgroundColor: colors.warning }}>
          <T size={32} bold color="#fff">🔥 {s.lifetime_current}</T>
          <T size={12} color="#fff">Lifetime · best {s.lifetime_best}</T>
        </Card>
        <Card style={{ flex: 1 }}>
          <T size={32} bold>{s.stage_current}</T>
          <T size={12} muted>This stage · best {s.stage_best}</T>
        </Card>
      </View>
      <T muted style={{ marginTop: 10 }}>
        {s.kept_today ? 'You kept your streak today ✓' : 'Finish one task, lesson or quiz today to keep it.'}
        {s.next_milestone ? ` Next milestone: ${s.next_milestone} days.` : ''}
      </T>
      <T style={{ marginTop: 8 }}>❄️ {s.freezes_held}/{s.freeze_cap} freezes</T>
      {s.can_restore && (
        <Button title={`Restore my ${s.restore_value}-day streak (${s.restores_left_this_month} left)`} style={{ marginTop: 10 }}
                onPress={() => call(studentApi.post('/gamification/streak/restore'), 'Restored')} />
      )}

      <Card style={{ marginTop: 14 }}>
        <T bold style={{ marginBottom: 8 }}>Last days</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
          {s.calendar.map((c) => <View key={c.day} style={{ width: 34, height: 34, borderRadius: 8, backgroundColor: KIND[c.kind] || KIND.missed }} />)}
        </View>
        <T size={11} muted style={{ marginTop: 8 }}>Orange kept · blue frozen · purple restored · grey missed</T>
      </Card>

      {goal?.enabled && (
        <Card style={{ marginTop: 14 }}>
          <T bold style={{ marginBottom: 8 }}>Daily goal</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {goal.levels.map((l) => (
              <Chip key={l.level_key} label={`${l.label} · ${l.tasks_per_day}/day`} on={goal.goal?.level_key === l.level_key}
                    onPress={() => call(studentApi.put('/engagement/goal', { level_key: l.level_key }), 'Goal saved')} />
            ))}
          </View>
          {goal.goal && <T size={12} muted style={{ marginTop: 8 }}>Today {goal.done_today}/{goal.goal.tasks_per_day} · met {goal.met_days_this_week} day(s) this week</T>}
        </Card>
      )}

      {buddies.max > 0 && (
        <Card style={{ marginTop: 14, marginBottom: 24 }}>
          <T bold style={{ marginBottom: 8 }}>Buddy streaks (up to {buddies.max})</T>
          {buddies.buddies.map((b) => (
            <View key={b.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}>
              <T style={{ flex: 1 }}>{b.status === 'pending' ? `Waiting — code ${b.invite_code || ''}` : `🔥 ${b.buddy_name}: ${b.current} days`}</T>
              <Button title="End" size="sm" variant="ghost"
                      onPress={async () => { if (await confirm({ title: 'End this buddy streak?', destructive: true, confirmLabel: 'End' })) call(studentApi.delete(`/gamification/streak/buddies/${b.id}`), 'Ended'); }} />
            </View>
          ))}
          <Button title="Invite a friend" size="sm" style={{ marginTop: 6 }}
                  onPress={async () => { const r = await call(studentApi.post('/gamification/streak/buddies/invite')); if (r?.invite_code) Share.share({ message: `Join my SKOVO streak with code ${r.invite_code}` }); }} />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
            <TextInput value={code} onChangeText={setCode} placeholder="Friend's code" autoCapitalize="characters" placeholderTextColor={colors.textMuted}
                       style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, color: colors.text }} />
            <Button title="Join" size="sm" variant="outline" onPress={() => code && call(studentApi.post('/gamification/streak/buddies/accept', { code }), 'Started').then(() => setCode(''))} />
          </View>
        </Card>
      )}
    </Screen>
  );
}
