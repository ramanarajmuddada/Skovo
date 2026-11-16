// ── Leaderboard (feature-updates.md §4): class boards by school / district /
//    state / India, weekly league, friends, tournament, Hall of Fame. Students
//    cannot hide; they may set an alias or hide their photo. ──────────────────
import React, { useCallback, useEffect, useState } from 'react';
import { View, TextInput, Switch } from 'react-native';
import { useTheme } from '../../theme';
import { Screen, H1, Card, Button, Loader, useToast } from '../../components/ui';
import { T, Tabs, BoardRow } from '../../components/v1';
import { studentApi } from '../../services/api';

const TABS = [['board', 'Class'], ['league', 'League'], ['friends', 'Friends'], ['tournament', 'Tournament'], ['hof', 'Hall of Fame']];
const SCOPES = [['school', 'My school'], ['district', 'District'], ['state', 'State'], ['india', 'India']];
const PERIODS = [['week', 'Week'], ['month', 'Month'], ['season', 'Season']];
const URL = { board: '/gamification/board', league: '/gamification/league', friends: '/engagement/friends-board',
              tournament: '/gamification/tournament', hof: '/gamification/hall-of-fame' };

function Privacy() {
  const { colors } = useTheme();
  const toast = useToast();
  const [p, setP] = useState(null);
  const [alias, setAlias] = useState('');
  useEffect(() => {
    studentApi.get('/gamification/board/profile').then(({ data }) => { if (data?.bool) { setP(data.response); setAlias(data.response.alias || ''); } }).catch(() => {});
  }, []);
  if (!p) return null;
  const save = async (body) => {
    const { data } = await studentApi.put('/gamification/board/profile', body);
    if (data?.bool) { setP(data.response); toast.success('Saved.'); } else toast.error(data?.response?.message || 'Could not save.');
  };
  return (
    <Card style={{ marginTop: 14, marginBottom: 24 }}>
      <T bold>How I appear</T>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
        <TextInput value={alias} onChangeText={setAlias} placeholder="Alias (optional)" placeholderTextColor={colors.textMuted}
                   style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, color: colors.text }} />
        <Button title="Save" size="sm" onPress={() => save({ alias })} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
        <T>Hide my photo</T>
        <Switch value={p.hide_photo} onValueChange={(v) => save({ hide_photo: v })} />
      </View>
      <T size={11} muted style={{ marginTop: 6 }}>Your phone number is never shown. Everyone in your class appears on the board.</T>
    </Card>
  );
}

// Follow from the board (§7 item 7) — fills Friends, the feed and friend quests.
function useFollow() {
  const toast = useToast();
  const [ids, setIds] = useState(new Set());
  useEffect(() => {
    studentApi.get('/engagement/following').then(({ data }) => data?.bool && setIds(new Set(data.response.following.map((f) => f.user_id)))).catch(() => {});
  }, []);
  const toggle = async (uid) => {
    const on = !ids.has(uid);
    const { data } = on ? await studentApi.post(`/engagement/follow/${uid}`, {}) : await studentApi.delete(`/engagement/follow/${uid}`);
    if (!data?.bool) { toast.error(data?.response?.message || 'Could not do that.'); return; }
    setIds((p) => { const n = new Set(p); if (on) n.add(uid); else n.delete(uid); return n; });
  };
  return { ids, toggle };
}

export default function LeaderboardScreen() {
  const follow = useFollow();
  const [tab, setTab] = useState('board');
  const [scope, setScope] = useState('school');
  const [period, setPeriod] = useState('week');
  const [res, setRes] = useState({ key: '', d: null });
  const key = `${tab}|${scope}|${period}`;
  const d = res.key === key ? res.d : null;

  const load = useCallback(() => {
    const k = `${tab}|${scope}|${period}`;
    studentApi.get(URL[tab], tab === 'board' ? { scope, period } : undefined)
      .then(({ data }) => setRes({ key: k, d: data?.bool ? data.response : { error: data?.response?.message || 'Could not load.' } }))
      .catch(() => setRes({ key: k, d: { error: 'Could not load.' } }));
  }, [tab, scope, period]);
  useEffect(() => { load(); }, [load]);

  let body = <Loader label="Loading…" />;
  if (d?.error) body = <T muted>{d.error}</T>;
  else if (d && d.enabled === false) body = <T muted>The leaderboard is not switched on yet.</T>;
  else if (d && tab === 'board') {
    body = d.no_stage ? <T muted>Add your class in your profile to join a board.</T> : (
      <View>
        {d.rows.length === 0 && <T muted>No points yet this {period}.</T>}
        {d.rows.map((r) => <BoardRow key={r.user_id} r={r} follow={follow} />)}
        {d.me && !d.rows.some((r) => r.is_me) && <><T muted style={{ textAlign: 'center' }}>⋯</T><BoardRow r={{ ...d.me, is_me: true }} /></>}
      </View>
    );
  } else if (d && tab === 'league') {
    body = d.tier_index === null || d.tier_index === undefined ? <T muted>You join a league after your first points this week.</T> : (
      <View>
        <T bold size={18}>{d.tier} league</T>
        <T size={12} muted>Top {d.promote_count} move up · bottom {d.demote_count} move down</T>
        {d.last_result && <T size={12} muted>Last week: rank {d.last_result.rank} — {d.last_result.result}</T>}
        {d.members.map((r) => <BoardRow key={r.user_id} r={r} follow={follow} />)}
      </View>
    );
  } else if (d && tab === 'friends') {
    body = d.rows.length ? <View>{d.rows.map((r, i) => <BoardRow key={r.user_id} r={{ ...r, rank: i + 1 }} follow={follow} />)}</View>
      : <T muted>Tap the follow icon next to a classmate on the Class board.</T>;
  } else if (d && tab === 'tournament') {
    body = !d.tournament ? <T muted>No tournament is running for your class right now.</T> : (
      <View>
        <T bold>{d.tournament.label}</T>
        <T size={12} muted>{d.tournament.starts_on} → {d.tournament.ends_on}</T>
        {d.tournament.rows.map((r) => <BoardRow key={r.user_id} r={r} follow={follow} />)}
      </View>
    );
  } else if (d && tab === 'hof') {
    body = d.entries.length ? (
      <View>{d.entries.map((e, i) => <T key={i} style={{ paddingVertical: 6 }} bold={e.is_me}>#{e.rank} {e.name} · {e.season} · {e.scope}</T>)}</View>
    ) : <T muted>The Hall of Fame fills at the end of each season.</T>;
  }

  return (
    <Screen scroll>
      <H1>Leaderboard</H1>
      <Tabs items={TABS} value={tab} onChange={setTab} />
      {tab === 'board' && (
        <>
          <Tabs items={SCOPES} value={scope} onChange={setScope} />
          <Tabs items={PERIODS} value={period} onChange={setPeriod} />
        </>
      )}
      <Card style={{ marginTop: 10 }}>{body}</Card>
      <Privacy />
    </Screen>
  );
}
