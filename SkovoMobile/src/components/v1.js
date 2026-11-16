// ── Version 1 shared pieces (feature-updates.md §4–§7) ───────────────────────
// Quiz runner, review list, progress bar, board row and tab chips, shared by
// Streak, Leaderboard, Practice, Tasks and Wallet screens.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { Button, Card, Chip } from './ui';

export const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function Bar({ value, max, color }) {
  const { colors } = useTheme();
  const pct = max ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <View style={{ height: 6, backgroundColor: colors.border, borderRadius: 3, overflow: 'hidden' }}>
      <View style={{ width: `${pct}%`, height: '100%', backgroundColor: color || colors.primary }} />
    </View>
  );
}

export function Tabs({ items, value, onChange }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6, paddingVertical: 4 }}>
      {items.map(([k, l]) => <Chip key={k} label={l} on={value === k} onPress={() => onChange(k)} />)}
    </ScrollView>
  );
}

export function T({ children, size = 14, bold, muted, color, style, ...rest }) {
  const { colors } = useTheme();
  return <Text style={[{ fontSize: size, fontWeight: bold ? '700' : '400', color: color || (muted ? colors.textMuted : colors.text) }, style]} {...rest}>{children}</Text>;
}

export function BoardRow({ r, follow }) {
  const { colors } = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 8, borderRadius: 12,
                   backgroundColor: r.is_me ? colors.primarySoft : 'transparent', gap: 10 }}>
      <T bold color={r.rank <= 3 ? colors.warning : colors.textMuted} style={{ width: 28, textAlign: 'center' }}>{r.rank}</T>
      <View style={{ flex: 1 }}>
        <T bold numberOfLines={1}>{r.name}{r.is_me ? ' (you)' : ''}</T>
        {(r.institute || r.league) ? <T size={11} muted numberOfLines={1}>{[r.institute, r.league].filter(Boolean).join(' · ')}</T> : null}
      </View>
      {r.stage_streak > 0 ? <T size={12} color={colors.warning}>🔥{r.stage_streak}</T> : null}
      <T bold style={{ width: 56, textAlign: 'right' }}>{Math.round(r.points)}</T>
      {follow && !r.is_me && r.user_id ? (
        <TouchableOpacity onPress={() => follow.toggle(r.user_id)} hitSlop={8}>
          <Feather name={follow.ids.has(r.user_id) ? 'user-check' : 'user-plus'} size={17} color={follow.ids.has(r.user_id) ? colors.primary : colors.textMuted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

export function QuestionInput({ q, value, onChange, disabled }) {
  const { colors } = useTheme();
  if (q.type === 'mcq' || q.type === 'true_false') {
    return (
      <View style={{ gap: 8 }}>
        {q.options.map((o) => {
          const on = value === o.key;
          return (
            <TouchableOpacity key={o.key} disabled={disabled} onPress={() => onChange(o.key)}
                              style={{ padding: 14, borderRadius: 12, borderWidth: 1.5, borderColor: on ? colors.primary : colors.border,
                                       backgroundColor: on ? colors.primarySoft : colors.surface }}>
              <T bold={on}>{q.type === 'mcq' ? `${o.key}. ` : ''}{o.value}</T>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }
  return (
    <TextInput value={value ?? ''} editable={!disabled} onChangeText={onChange} placeholder="Your answer"
               keyboardType={q.type === 'numeric' ? 'decimal-pad' : 'default'} placeholderTextColor={colors.textMuted}
               style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, color: colors.text, fontSize: 16 }} />
  );
}

/** One question at a time, timer, autosave, submit at 0. */
export function QuizRunner({ title, questions, seconds, initialAnswers, onSubmit, onAutosave, submitLabel = 'Submit' }) {
  const { colors } = useTheme();
  const [answers, setAnswers] = useState(initialAnswers || {});
  const [left, setLeft] = useState(seconds ?? null);
  const [i, setI] = useState(0);
  const [busy, setBusy] = useState(false);
  const ref = useRef(answers);
  const done = useRef(false);
  useEffect(() => { ref.current = answers; }, [answers]);

  const submit = useCallback(async () => {
    if (done.current) return;
    done.current = true; setBusy(true);
    try { await onSubmit(ref.current); } finally { setBusy(false); }
  }, [onSubmit]);

  useEffect(() => {
    if (left === null) return undefined;
    if (left <= 0) { submit(); return undefined; }
    const t = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [left, submit]);

  useEffect(() => {
    if (!onAutosave) return undefined;
    const t = setInterval(() => onAutosave(ref.current, 0), 8000);
    return () => clearInterval(t);
  }, [onAutosave]);

  const q = questions[i];
  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          {title ? <T bold size={17}>{title}</T> : null}
          <T size={12} muted>Question {i + 1} of {questions.length}</T>
        </View>
        {left !== null && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20,
                         backgroundColor: left < 30 ? colors.dangerSoft : colors.surfaceAlt }}>
            <Feather name="clock" size={13} color={left < 30 ? colors.danger : colors.text} />
            <T bold color={left < 30 ? colors.danger : colors.text}>{Math.floor(Math.max(0, left) / 60)}:{String(Math.max(0, left) % 60).padStart(2, '0')}</T>
          </View>
        )}
      </View>
      {q && (
        <Card>
          <T size={16} style={{ marginBottom: 12 }}>{q.text}</T>
          <QuestionInput q={q} value={answers[q.id]} onChange={(v) => setAnswers((p) => ({ ...p, [q.id]: v }))} disabled={busy} />
        </Card>
      )}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button title="Previous" variant="outline" onPress={() => setI((j) => Math.max(0, j - 1))} disabled={i === 0} style={{ flex: 1 }} />
        {i < questions.length - 1
          ? <Button title="Next" onPress={() => setI((j) => j + 1)} style={{ flex: 1 }} />
          : <Button title={submitLabel} onPress={submit} loading={busy} style={{ flex: 1 }} />}
      </View>
    </View>
  );
}

export function ReviewList({ questions }) {
  const { colors } = useTheme();
  return (
    <View style={{ gap: 10 }}>
      {questions.map((q, n) => (
        <View key={q.id} style={{ padding: 12, borderRadius: 12, borderWidth: 1, borderColor: q.correct ? colors.success : colors.danger,
                                  backgroundColor: q.correct ? colors.successSoft : colors.dangerSoft }}>
          <T>{n + 1}. {q.text}</T>
          <T size={12} style={{ marginTop: 6 }}>Your answer: {q.your_answer ?? '—'} · Correct: {q.type === 'fill_blank' ? (q.accepted || []).join(' / ') : q.correct_answer}</T>
          {q.explanation ? <T size={12} muted style={{ marginTop: 4 }}>{q.explanation}</T> : null}
        </View>
      ))}
    </View>
  );
}
