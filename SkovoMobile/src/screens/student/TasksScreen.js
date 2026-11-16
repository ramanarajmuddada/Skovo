// ── My Tasks (student) ───────────────────────────────────────────────────────
// One of the v1 eighteen, and the one that carries the most score: completing a
// cohort task is +8, the single largest repeatable award in the engine. Mobile
// had no way to submit one, so a phone-only student could attend a cohort (+2)
// and never reach the points that actually move them toward the Opportunities
// Hub gate at 60.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Button, Loader, Empty, Pill, ErrorState, Chip, ChipRow } from '../../components/ui';
import { TaskQuiz, RubricMarks, Appeal, OfflinePacks } from '../../components/TaskQuiz';
import { studentApi } from '../../services/api';
import { refreshWidget } from '../../services/widget';
import { syncPendingPacks } from '../../services/offline';

const FILTERS = [
  { key: 'todo',      label: 'To do' },
  { key: 'submitted', label: 'Submitted' },
  { key: 'approved',  label: 'Approved' },
  { key: 'all',       label: 'All' },
];

const STATUS_TONE = {
  approved:  'success',
  submitted: 'info',
  pending:   'info',
  rejected:  'danger',
};

function dueLabel(due) {
  if (!due) return null;
  const ts = new Date(due).getTime();
  if (Number.isNaN(ts)) return null;
  const days = Math.ceil((ts - Date.now()) / 86400000);
  if (days < 0)  return { text: `Overdue by ${Math.abs(days)}d`, overdue: true };
  if (days === 0) return { text: 'Due today',  overdue: true };
  if (days === 1) return { text: 'Due tomorrow', overdue: false };
  return { text: `Due in ${days}d`, overdue: false };
}

export default function TasksScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('todo');
  const [openId, setOpenId] = useState(null);
  const [text, setText] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    // Finished offline packs are submitted first, so the list shows their results.
    syncPendingPacks().catch(() => 0).then(() => studentApi.get('/tasks/'))
      .then(({ data }) => { if (data.bool) setTasks(data.response?.tasks || []); refreshWidget(); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => ({
    todo:      tasks.filter(t => !t.submission).length,
    submitted: tasks.filter(t => t.submission && t.submission.status !== 'approved').length,
    approved:  tasks.filter(t => t.submission?.status === 'approved').length,
    all:       tasks.length,
  }), [tasks]);

  const visible = useMemo(() => {
    if (filter === 'todo')      return tasks.filter(t => !t.submission);
    if (filter === 'submitted') return tasks.filter(t => t.submission && t.submission.status !== 'approved');
    if (filter === 'approved')  return tasks.filter(t => t.submission?.status === 'approved');
    return tasks;
  }, [tasks, filter]);

  const submit = async (task) => {
    if (busy) return;
    if (!text.trim() && !link.trim()) {
      Alert.alert('Nothing to submit', 'Add a note or a link before submitting.');
      return;
    }
    setBusy(true);
    try {
      const { data } = await studentApi.post(`/tasks/${task.id}/submit`, {
        evidence_text: text.trim() || null,
        evidence_url:  link.trim() || null,
      });
      if (data.bool) {
        setOpenId(null); setText(''); setLink('');
        Alert.alert('Submitted', 'Your achiever will review it and award your points.');
        load();
      } else {
        Alert.alert('Could not submit', data.response?.message || 'Please try again.');
      }
    } catch {
      Alert.alert('Could not submit', 'Check your connection and try again.');
    } finally { setBusy(false); }
  };

  if (loading) return <Screen><Loader label="Loading your tasks…" /></Screen>;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1>My Tasks</H1>
      <Muted>Finish a cohort task to earn +8 — the biggest single award in your score.</Muted>

      <View style={{ marginTop: spacing(4), marginBottom: spacing(4) }}>
        <ChipRow wrap>
          {FILTERS.map(f => (
            <Chip key={f.key}
                  label={`${f.label}${counts[f.key] ? ` (${counts[f.key]})` : ''}`}
                  on={filter === f.key}
                  onPress={() => setFilter(f.key)} />
          ))}
        </ChipRow>
      </View>

      <OfflinePacks refreshKey={`${tasks.length}-${failed}`} onSynced={load} />
      {visible.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load your tasks"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="check-square"
               title={filter === 'todo' ? 'Nothing pending' : 'Nothing here yet'}
               subtitle={filter === 'todo'
                 ? 'Tasks appear when you join a cohort. Enrol in one to get started.'
                 : 'Switch filters to see your other tasks.'} />
        )
      ) : visible.map(task => {
        const sub = task.submission;
        const due = dueLabel(task.due_date);
        const open = openId === task.id;
        return (
          <Card key={task.id} style={s.card}>
            <View style={s.cardHead}>
              <View style={{ flex: 1 }}>
                <Text style={s.title}>{task.title}</Text>
                {task.cohort_title ? <Text style={s.cohort}>{task.cohort_title}</Text> : null}
              </View>
              {sub ? (
                <Pill label={sub.status || 'submitted'} tone={STATUS_TONE[sub.status] || 'info'} />
              ) : task.is_quiz ? (
                <Pill label="Quiz" tone="primary" />
              ) : null}
            </View>

            {task.description ? (
              <Text style={s.desc} numberOfLines={open ? undefined : 3}>{task.description}</Text>
            ) : null}

            <View style={s.metaRow}>
              {due ? (
                <Text style={[s.meta, due.overdue && { color: colors.danger }]}>
                  <Feather name="clock" size={11} /> {due.text}
                </Text>
              ) : null}
              {sub?.mentor_score != null ? (
                <Text style={s.meta}><Feather name="award" size={11} /> Scored {sub.mentor_score}</Text>
              ) : null}
            </View>

            {sub?.mentor_notes ? (
              <View style={s.notes}>
                <Text style={s.notesLabel}>Achiever feedback</Text>
                <Text style={s.notesText}>{sub.mentor_notes}</Text>
              </View>
            ) : null}

            <RubricMarks rubric={task.rubric} scores={sub?.rubric_scores} />

            {/* Approved work is final — the engine pays once per task. */}
            {task.is_quiz ? (
              <TaskQuiz task={task} onDone={load} />
            ) : (!sub || (sub.status === 'rejected' && open)) ? (
              open ? (
                <View style={s.form}>
                  <TextInput
                    value={text} onChangeText={setText} multiline
                    placeholder="What did you do? A few lines is enough."
                    placeholderTextColor={colors.textSubtle}
                    style={[s.input, s.inputMulti]} />
                  <TextInput
                    value={link} onChangeText={setLink}
                    placeholder="Link to your work (optional)"
                    placeholderTextColor={colors.textSubtle}
                    autoCapitalize="none" style={s.input} />
                  <View style={s.formButtons}>
                    <Button title="Cancel" variant="ghost" size="sm"
                            onPress={() => { setOpenId(null); setText(''); setLink(''); }} />
                    <Button title={busy ? 'Submitting…' : 'Submit'} size="sm"
                            loading={busy} onPress={() => submit(task)} />
                  </View>
                </View>
              ) : (
                <Button title="Submit work" size="sm" icon="upload" style={{ marginTop: spacing(3) }}
                        onPress={() => { setOpenId(task.id); setText(''); setLink(''); }} />
              )
            ) : sub.status === 'rejected' ? (
              <Button title="Resubmit" size="sm" icon="refresh-cw" style={{ marginTop: spacing(3) }}
                      onPress={() => { setOpenId(task.id); setText(''); setLink(''); }} />
            ) : null}
            <Appeal sub={sub} onDone={load} />
          </Card>
        );
      })}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  card:      { marginBottom: spacing(3) },
  cardHead:  { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2) },
  title:     { fontSize: font.base, fontWeight: font.bold, color: colors.text },
  cohort:    { fontSize: font.xs, color: colors.textSubtle, marginTop: 2 },
  desc:      { fontSize: font.sm, color: colors.textMuted, marginTop: spacing(2), lineHeight: 19 },

  metaRow:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(4), marginTop: spacing(3) },
  meta:      { fontSize: font.xs, color: colors.textSubtle },

  notes:      { marginTop: spacing(3), padding: spacing(3),
                backgroundColor: colors.surfaceAlt, borderRadius: radius.sm },
  notesLabel: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted },
  notesText:  { fontSize: font.sm, color: colors.text, marginTop: 2, lineHeight: 18 },

  form:        { marginTop: spacing(3), gap: spacing(2) },
  input:       { borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm,
                 paddingHorizontal: spacing(3), paddingVertical: spacing(3),
                 fontSize: font.sm, color: colors.text, backgroundColor: colors.surface },
  inputMulti:  { minHeight: 84, textAlignVertical: 'top' },
  formButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing(2) },
});
