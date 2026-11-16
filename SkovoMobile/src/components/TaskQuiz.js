// ── Quiz, rubric marks and appeal inside a task (feature-updates.md §5) ──────
import React, { useEffect, useState } from 'react';
import { View, Modal, ScrollView, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { Button } from './ui';
import { T, QuizRunner, ReviewList } from './v1';
import { studentApi } from '../services/api';
import { getPack, downloadPack, saveAnswers, submitPack, listPacks } from '../services/offline';

export function TaskQuiz({ task, onDone }) {
  const { colors } = useTheme();
  const [attempt, setAttempt] = useState(null);
  const [result, setResult] = useState(null);
  const [review, setReview] = useState(null);
  const [err, setErr] = useState('');
  const [pack, setPack] = useState(null);       // downloaded offline pack, if any
  const [offlineRun, setOfflineRun] = useState(false);
  const q = task.quiz || {};
  useEffect(() => { if (q.offline_allowed) getPack(task.id).then(setPack); }, [task.id, q.offline_allowed]);

  const download = async () => {
    setErr('');
    const res = await downloadPack(task.id);
    if (res.ok) setPack(res.pack); else setErr(res.message);
  };
  const submitOffline = async (answers) => {
    await saveAnswers(task.id, answers, true);
    setOfflineRun(false);
    const res = await submitPack(task.id);
    if (res?.ok) { setResult(res.result); setPack(null); onDone?.(); }
    else if (res) { setErr(res.message); setPack(null); }
    else { setPack({ ...pack, answers, pending: true }); setErr('Saved on your phone. It will be submitted when you are online.'); }
  };
  const sub = task.submission;

  const start = async () => {
    setErr('');
    const { data } = await studentApi.post(`/tasks/${task.id}/quiz/start`, {});
    if (data?.bool) setAttempt(data.response); else setErr(data?.response?.message || 'Could not start.');
  };
  const autosave = async (answers) => {
    if (attempt) await studentApi.put(`/tasks/${task.id}/quiz/${attempt.attempt_id}`, { answers }).catch(() => {});
  };
  const submit = async (answers) => {
    const { data } = await studentApi.post(`/tasks/${task.id}/quiz/${attempt.attempt_id}/submit`, { answers });
    if (data?.bool) { setResult(data.response); setAttempt(null); onDone?.(); } else setErr(data?.response?.message || 'Could not submit.');
  };
  const loadReview = async () => {
    const { data } = await studentApi.get(`/tasks/${task.id}/quiz/review`);
    if (data?.bool) setReview(data.response); else setErr(data?.response?.message || 'Answers are not open yet.');
  };
  const last = result || (sub?.auto_total ? { score: sub.auto_score, total: sub.auto_total } : null);

  return (
    <View style={{ marginTop: 10, gap: 6 }}>
      <T size={12} muted>{q.questions} questions{q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''} · {q.max_attempts} attempt(s)</T>
      {last && <T bold>Your score: {last.score}/{last.total}{result?.percent !== undefined ? ` (${result.percent}%)` : ''}</T>}
      {err ? <T size={12} color={colors.danger}>{err}</T> : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={last ? 'Try again' : 'Start quiz'} size="sm" onPress={start} />
        {last && q.review_after !== 'never' && <Button title="See answers" size="sm" variant="outline" onPress={loadReview} />}
      </View>
      {q.offline_allowed && (
        pack ? (
          pack.pending
            ? <T size={12} muted>Offline answers saved — they will be submitted when you are online.</T>
            : <Button title="Take offline copy" size="sm" variant="soft" onPress={() => setOfflineRun(true)} />
        ) : <Button title="Download for offline" size="sm" variant="ghost" onPress={download} />
      )}
      <Modal visible={!!attempt || !!review || offlineRun} animationType="slide" onRequestClose={() => { setAttempt(null); setReview(null); setOfflineRun(false); }}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            {attempt && <QuizRunner title={task.title} questions={attempt.questions} initialAnswers={attempt.answers}
                                    seconds={attempt.seconds_left} onSubmit={submit} onAutosave={autosave} submitLabel="Submit quiz" />}
            {offlineRun && pack && <QuizRunner title={`${task.title} (offline)`} questions={pack.questions} initialAnswers={pack.answers}
                                               onSubmit={submitOffline} onAutosave={(a) => saveAnswers(task.id, a)} submitLabel="Finish" />}
            {review && (
              <>
                <T bold size={17}>{review.score}/{review.total} · {review.percent}%</T>
                <ReviewList questions={review.questions} />
                <Button title="Close" onPress={() => setReview(null)} />
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}

export function RubricMarks({ rubric, scores }) {
  if (!rubric?.length || !scores || !Object.keys(scores).length) return null;
  return (
    <View style={{ marginTop: 8 }}>
      <T size={12} bold>Rubric</T>
      {rubric.map((l) => <T key={l.label} size={12}>{l.label}: {scores[l.label] ?? '—'}/{l.max}</T>)}
    </View>
  );
}

export function Appeal({ sub, onDone }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [msg, setMsg] = useState('');
  if (!sub?.id) return null;
  if (sub.appeal_text) return <T size={12} muted style={{ marginTop: 6 }}>Appeal sent: “{sub.appeal_text}”</T>;
  if (!['rejected', 'approved'].includes(sub.status)) return null;
  const send = async () => {
    const { data } = await studentApi.post(`/tasks/submissions/${sub.id}/appeal`, { text });
    setMsg(data?.response?.message || (data?.bool ? 'Appeal sent.' : 'Could not send.'));
    if (data?.bool) { setOpen(false); onDone?.(); }
  };
  return (
    <View style={{ marginTop: 8, gap: 6 }}>
      {!open ? <Button title="Disagree? Appeal" size="sm" variant="ghost" onPress={() => setOpen(true)} /> : (
        <>
          <TextInput value={text} onChangeText={setText} multiline maxLength={1000} placeholder="Explain why (at least 10 characters)"
                     placeholderTextColor={colors.textMuted}
                     style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 10, padding: 10, minHeight: 70, color: colors.text }} />
          <Button title="Send appeal" size="sm" disabled={text.trim().length < 10} onPress={send} />
        </>
      )}
      {msg ? <T size={12} muted>{msg}</T> : null}
    </View>
  );
}

/** Packs saved on this phone — usable with no internet (the task list needs it). */
export function OfflinePacks({ refreshKey, onSynced }) {
  const { colors } = useTheme();
  const [packs, setPacks] = useState([]);
  const [run, setRun] = useState(null);
  const reload = () => listPacks().then(setPacks).catch(() => {});
  useEffect(() => { reload(); }, [refreshKey]);
  if (!packs.length) return null;
  const finish = async (answers) => {
    const taskId = run.task_id;
    await saveAnswers(taskId, answers, true);
    setRun(null);
    const res = await submitPack(taskId);
    if (res?.ok) onSynced?.();
    reload();
  };
  return (
    <View style={{ padding: 12, borderRadius: 12, backgroundColor: colors.primarySoft, marginBottom: 12, gap: 6 }}>
      <T bold>Quizzes saved on this phone</T>
      {packs.map((p) => (
        <View key={p.task_id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <T style={{ flex: 1 }} numberOfLines={1}>{p.title}</T>
          {p.pending ? <T size={12} muted>Waiting to sync</T>
            : <Button title="Take" size="sm" onPress={() => setRun(p)} />}
        </View>
      ))}
      <Modal visible={!!run} animationType="slide" onRequestClose={() => setRun(null)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            {run && <QuizRunner title={`${run.title} (offline)`} questions={run.questions} initialAnswers={run.answers}
                                onSubmit={finish} onAutosave={(a) => saveAnswers(run.task_id, a)} submitLabel="Finish" />}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </View>
  );
}
