// ── Practice (feature-updates.md §7): learning paths + placement + Topper
//    mode, My Mistakes, speed round, shop, achievements, friends' feed ────────
import React, { useCallback, useEffect, useState } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../../theme';
import { Screen, H1, Card, Button, Loader, useToast, confirm } from '../../components/ui';
import { T, Tabs, Bar, QuizRunner, ReviewList, QuestionInput } from '../../components/v1';
import { studentApi } from '../../services/api';

const TABS = [['paths', 'Paths'], ['mistakes', 'My Mistakes'], ['speed', 'Speed'], ['shop', 'Shop'], ['achievements', 'Achievements'], ['feed', 'Friends']];
const Off = ({ what }) => <T muted>{what} is not switched on yet.</T>;

function useLoad(url) {
  const [d, setD] = useState(null);
  const load = useCallback(() => {
    studentApi.get(url).then(({ data }) => setD(data?.bool ? data.response : { error: true })).catch(() => setD({ error: true }));
  }, [url]);
  useEffect(() => { load(); }, [load]);
  return [d, load];
}

function Runner({ run, onDone }) {
  const toast = useToast();
  const [result, setResult] = useState(null);
  const submit = async (answers) => {
    const { data } = await studentApi.post(run.submitUrl, { token: run.token, answers });
    if (data?.bool) setResult(data.response); else { toast.error(data?.response?.message || 'Could not submit.'); onDone(); }
  };
  if (result) {
    const title = run.kind === 'speed' ? `${result.correct}/${result.total} right` : run.kind === 'placement' ? `You scored ${result.percent}%`
      : result.topper_cleared ? 'Topper mode cleared 🥇' : result.passed ? `🎉 Level passed · ${result.percent}%` : `${result.percent}% — try again`;
    return (
      <View style={{ gap: 12 }}>
        <T bold size={18}>{title}</T>
        {result.review ? <ReviewList questions={result.review} /> : null}
        <Button title="Back" onPress={onDone} />
      </View>
    );
  }
  return <QuizRunner title={run.title} questions={run.questions} seconds={run.seconds || null} onSubmit={submit} />;
}

function Paths({ start }) {
  const { colors } = useTheme();
  const [list] = useLoad('/engagement/paths');
  const [open, setOpen] = useState(null);
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!open) return;
    studentApi.get(`/engagement/paths/${open}`).then(({ data }) => data?.bool && setMap(data.response)).catch(() => {});
  }, [open]);
  if (!list) return <Loader />;
  if (!list.enabled) return <Off what="Learning paths" />;
  if (!open) {
    return list.paths.length ? list.paths.map((p) => (
      <Card key={p.id} onPress={() => { setMap(null); setOpen(p.id); }} style={{ marginBottom: 8 }}>
        <T bold>{p.title}</T>
        {p.exam ? <T size={12} color={colors.primary}>{p.exam}</T> : null}
        {p.description ? <T size={12} muted numberOfLines={2}>{p.description}</T> : null}
      </Card>
    )) : <T muted>No paths for your class yet.</T>;
  }
  if (!map) return <Loader />;
  const tone = { passed: colors.success, open: colors.primary, locked: colors.border };
  return (
    <View style={{ gap: 10 }}>
      <Button title="← All paths" variant="ghost" size="sm" onPress={() => setOpen(null)} />
      <T bold size={18}>{map.title}</T>
      {map.placement && !map.placement.taken && (
        <Button title="Already know this? Take the placement test" variant="soft"
                onPress={() => start(`/engagement/placement/${map.placement.id}/start`, '/engagement/placement/submit', 'placement')} />
      )}
      {map.units.map((u) => (
        <View key={u.id} style={{ gap: 8 }}>
          <T bold muted>{u.title}</T>
          {u.levels.map((l, i) => (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: (i % 3) * 30 }}>
              <TouchableOpacity disabled={l.state === 'locked'} onPress={() => start(`/engagement/levels/${l.id}/start`, '/engagement/levels/submit', 'level')}
                                style={{ width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: tone[l.state],
                                         borderWidth: l.is_checkpoint ? 3 : 0, borderColor: colors.warning }}>
                <Feather name={l.state === 'passed' ? 'check' : l.state === 'open' ? 'play' : 'lock'} size={20} color="#fff" />
              </TouchableOpacity>
              <View style={{ flex: 1 }}>
                <T bold numberOfLines={1}>{l.title}</T>
                <T size={12} muted>{l.best_percent ? `best ${l.best_percent}%` : `${l.questions} questions`}{l.topper_done ? ' · 🥇' : ''}</T>
                {l.state === 'passed' && l.topper_enabled && !l.topper_done && (
                  <TouchableOpacity onPress={() => start(`/engagement/levels/${l.id}/start`, '/engagement/levels/submit', 'level', { topper: true })}>
                    <T size={12} bold color={colors.warning}>⭐ Topper mode</T>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

function Mistakes() {
  const { colors } = useTheme();
  const [d, load] = useLoad('/engagement/mistakes');
  const [ans, setAns] = useState({});
  const [res, setRes] = useState({});
  if (!d) return <Loader />;
  if (!d.enabled) return <Off what="My Mistakes" />;
  if (!d.questions.length) return <T muted>Nothing to retry today. Questions you get wrong come back here. ✨</T>;
  const check = async (q) => {
    const { data } = await studentApi.post(`/engagement/mistakes/${q.id}/answer`, { answer: ans[q.id] });
    if (data?.bool) setRes((p) => ({ ...p, [q.id]: data.response }));
  };
  return (
    <View style={{ gap: 10 }}>
      {d.questions.map((q) => (
        <Card key={q.id}>
          <T style={{ marginBottom: 8 }}>{q.text}</T>
          <QuestionInput q={q} value={ans[q.id]} onChange={(v) => setAns((p) => ({ ...p, [q.id]: v }))} disabled={!!res[q.id]} />
          {res[q.id]
            ? <T size={12} style={{ marginTop: 8 }} color={res[q.id].correct ? colors.success : colors.danger}>{res[q.id].correct ? 'Right! ' : `Answer: ${res[q.id].correct_answer}. `}{res[q.id].explanation || ''}</T>
            : <Button title="Check" size="sm" style={{ marginTop: 8 }} disabled={!ans[q.id]} onPress={() => check(q)} />}
        </Card>
      ))}
      <Button title="Refresh" variant="ghost" size="sm" onPress={() => { setAns({}); setRes({}); load(); }} />
    </View>
  );
}

function Shop() {
  const toast = useToast();
  const [d, load] = useLoad('/engagement/shop');
  if (!d) return <Loader />;
  if (!d.enabled) return <Off what="The shop" />;
  const act = async (p, ok) => {
    const { data } = await p;
    if (data?.bool) { toast.success(ok); load(); } else toast.error(data?.response?.message || 'Could not do that.');
  };
  return (
    <View style={{ gap: 8 }}>
      <T>You have <T bold>{d.balance} 🪙</T>. Coins never buy points or rank.</T>
      {d.items.map((i) => (
        <Card key={i.item_key} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <T bold>{i.label}</T>
            <T size={12} muted>{i.price} 🪙{i.owned > 0 ? ` · you have ${i.owned}` : ''}</T>
          </View>
          {i.owned > 0 && i.kind === 'frame'
            ? <Button title={i.equipped ? 'Remove' : 'Use'} size="sm" variant="outline" onPress={() => act(studentApi.put(`/engagement/inventory/${i.item_key}/equip`, { equipped: !i.equipped }), 'Saved')} />
            : <Button title="Buy" size="sm" disabled={d.balance < i.price}
                      onPress={async () => { if (await confirm({ title: `Buy ${i.label}?`, message: `${i.price} coins`, confirmLabel: 'Buy' })) act(studentApi.post(`/engagement/shop/${i.item_key}/buy`), 'Bought'); }} />}
        </Card>
      ))}
    </View>
  );
}

function Achievements() {
  const { colors } = useTheme();
  const [d] = useLoad('/engagement/achievements');
  if (!d) return <Loader />;
  if (!d.enabled) return <Off what="Achievements" />;
  return d.achievements.map((a) => (
    <Card key={a.key} style={{ marginBottom: 8 }}>
      <T bold>{a.label}</T>
      <T size={12} muted>{a.earned.length ? `Earned: ${a.earned.join(', ')}` : 'Not earned yet'}</T>
      {a.next && <View style={{ marginTop: 6 }}><Bar value={a.value} max={a.next.target} color={colors.warning} /><T size={11} muted>{a.value}/{a.next.target} for {a.next.tier}</T></View>}
    </Card>
  ));
}

function Feed() {
  const { colors } = useTheme();
  const [d, load] = useLoad('/engagement/feed');
  if (!d) return <Loader />;
  if (d.error) return <Off what="Friends" />;
  if (!d.items.length) return <><Following /><T muted>Follow classmates from the Leaderboard to see their wins here.</T></>;
  return [<Following key="following" />, ...d.items.map((f) => (
    <Card key={f.id} style={{ marginBottom: 8, flexDirection: 'row', alignItems: 'center' }}>
      <T style={{ flex: 1 }}><T bold>{f.name}</T> {f.text}</T>
      <TouchableOpacity disabled={f.cheered} onPress={async () => { await studentApi.post(`/engagement/feed/${f.id}/cheer`); load(); }}>
        <T color={f.cheered ? colors.danger : colors.textMuted}>♥ {f.cheers}</T>
      </TouchableOpacity>
    </Card>
  ))];
}

function Following() {
  const [d, load] = useLoad('/engagement/following');
  if (!d?.following?.length) return null;
  return (
    <Card style={{ marginBottom: 8 }}>
      <T size={12} bold style={{ marginBottom: 6 }}>Following ({d.following.length})</T>
      {d.following.map((f) => (
        <View key={f.user_id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 4 }}>
          <T style={{ flex: 1 }}>{f.name}{f.follows_back ? ' · follows you' : ''}</T>
          <Button title="Unfollow" size="sm" variant="ghost" onPress={async () => { await studentApi.delete(`/engagement/follow/${f.user_id}`); load(); }} />
        </View>
      ))}
    </Card>
  );
}

export default function PracticeScreen({ route }) {
  const toast = useToast();
  const [tab, setTab] = useState(route?.params?.tab || 'paths');
  const [run, setRun] = useState(null);
  const start = async (url, submitUrl, kind, body) => {
    const { data } = await studentApi.post(url, body || {});
    if (data?.bool) setRun({ ...data.response, submitUrl, kind }); else toast.error(data?.response?.message || 'Could not start.');
  };
  return (
    <Screen scroll>
      <H1>Practice</H1>
      {run ? <Runner run={run} onDone={() => setRun(null)} /> : (
        <View style={{ gap: 10, paddingBottom: 24 }}>
          <Tabs items={TABS} value={tab} onChange={setTab} />
          {tab === 'paths' && <Paths start={start} />}
          {tab === 'mistakes' && <Mistakes />}
          {tab === 'speed' && (
            <Card>
              <T muted style={{ marginBottom: 10 }}>Answer as many as you can before the timer ends.</T>
              <Button title="Start speed round" onPress={() => start('/engagement/speed/start', '/engagement/speed/submit', 'speed')} />
            </Card>
          )}
          {tab === 'shop' && <Shop />}
          {tab === 'achievements' && <Achievements />}
          {tab === 'feed' && <Feed />}
        </View>
      )}
    </Screen>
  );
}
