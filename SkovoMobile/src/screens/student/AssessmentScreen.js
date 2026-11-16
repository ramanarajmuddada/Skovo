// ── Readiness Assessment (student) ───────────────────────────────────────────
// The four steps that seed a new student's score — skills, experience, career
// goal, engagement — worth up to 65 points before they have attended anything.
// Without it on mobile, a phone-only student starts at 0 and has no way to
// reach the Opportunities Hub gate at 60 except by attending eight cohorts.
//
// Payload shape matches the web build exactly (POST /readiness/assessment with
// {step, step_data}), so a student can start on one surface and finish on the other.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Loader, Pill, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

// Skills, goals and the step 2 / step 4 wording come from
// GET /readiness/assessment/options, which returns the set matching this
// student's education stage. Only the fallbacks live here, for a failed fetch.
const FALLBACK_SKILLS = ['Communication', 'Teamwork', 'Problem Solving',
                         'Time Management', 'Public Speaking', 'MS Office'];
const FALLBACK_GOALS = ['Higher studies', 'Government job', 'Private job',
                        'Start my own business', 'Not decided yet', 'Other'];

const STEPS = [
  { n: 1, title: 'Your skills',     blurb: '2 points each, up to 20',      icon: 'zap' },
  { n: 2, title: 'Your experience', blurb: 'Worth up to 25',               icon: 'briefcase' },
  { n: 3, title: 'Career goal',     blurb: 'Worth 20 once it is set',      icon: 'target' },
  { n: 4, title: 'Engagement',      blurb: 'Worth up to 10',               icon: 'users' },
];

function Chip({ label, active, onPress }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity onPress={onPress} style={[s.chip, active && s.chipOn]}>
      <Text style={[s.chipText, active && s.chipTextOn]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Toggle({ label, value, onChange }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.toggleRow}>
      <Text style={s.toggleLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: spacing(2) }}>
        <Chip label="No"  active={value === false} onPress={() => onChange(false)} />
        <Chip label="Yes" active={value === true}  onPress={() => onChange(true)} />
      </View>
    </View>
  );
}

function Counter({ label, value, onChange, max = 20 }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const n = parseInt(value || 0, 10) || 0;
  return (
    <View style={s.toggleRow}>
      <Text style={s.toggleLabel}>{label}</Text>
      <View style={s.counter}>
        <TouchableOpacity onPress={() => onChange(Math.max(0, n - 1))} style={s.counterBtn}>
          <Feather name="minus" size={14} color={colors.textMuted} />
        </TouchableOpacity>
        <Text style={s.counterValue}>{n}</Text>
        <TouchableOpacity onPress={() => onChange(Math.min(max, n + 1))} style={s.counterBtn}>
          <Feather name="plus" size={14} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function AssessmentScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [step, setStep] = useState(1);
  const [data, setData] = useState({ 1: {}, 2: {}, 3: {}, 4: {} });
  const [done, setDone] = useState([]);
  const [score, setScore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState(null);

  useEffect(() => {
    studentApi.get('/readiness/assessment/options')
      .then(({ data }) => { if (data.bool) setOptions(data.response); })
      .catch(() => { /* fallbacks keep the screen usable */ });
  }, []);

  const load = useCallback(() => {
    studentApi.get('/readiness/assessment')
      .then(({ data: res }) => {
        if (!res.bool || !res.response) return;
        const steps = res.response.steps || {};
        const preloaded = { 1: {}, 2: {}, 3: {}, 4: {} };
        const completed = [];
        Object.entries(steps).forEach(([k, v]) => {
          const n = parseInt(k, 10);
          preloaded[n] = v.step_data || {};
          if (v.step_data) completed.push(n);
        });
        setData(preloaded);
        setDone(completed);
        setScore(res.response.score ?? null);
        // Drop the student on the first step they have not finished.
        const next = [1, 2, 3, 4].find(n => !completed.includes(n));
        if (next) setStep(next);
      })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setData(p => ({ ...p, [step]: { ...p[step], [key]: value } }));
  const current = data[step] || {};

  const toggleSkill = (skill) => {
    const have = current.skills || [];
    set('skills', have.includes(skill) ? have.filter(x => x !== skill) : [...have, skill]);
  };

  const canContinue = (() => {
    if (step === 1) return (current.skills || []).length > 0;
    if (step === 3) return Boolean(current.career_goal);
    return true;                                   // steps 2 and 4 accept "none"
  })();

  const submit = async () => {
    if (saving || !canContinue) return;
    setSaving(true);
    try {
      let stepData = current;
      // "Other" is stored as whatever the student typed, matching the web build.
      if (step === 3 && current.career_goal === 'Other') {
        stepData = { ...current, career_goal: current.custom_goal || 'Other' };
      }
      const { data: res } = await studentApi.post('/readiness/assessment',
                                                  { step, step_data: stepData });
      if (!res.bool) {
        Alert.alert('Could not save', res.response?.message || 'Please try again.');
        return;
      }
      setScore(res.response?.score ?? score);
      setDone(prev => (prev.includes(step) ? prev : [...prev, step]));
      if (step < 4) setStep(step + 1);
      else Alert.alert('Assessment complete', 'Your readiness score has been updated.');
    } catch {
      Alert.alert('Could not save', 'Check your connection and try again.');
    } finally { setSaving(false); }
  };

  if (loading) return <Screen><Loader label="Loading your assessment…" /></Screen>;

  const cfg = STEPS[step - 1];
  const skillList = (options?.skills || []).map(x => x.label);
  const goalList  = (options?.career_goals || []).map(x => x.label);
  const skills = skillList.length ? skillList : FALLBACK_SKILLS;
  const goals  = goalList.length ? goalList : FALLBACK_GOALS;
  // Field names stay the same across stages; only the question changes.
  const q2Bool  = (options?.step2 || []).find(q => q.kind === 'bool');
  const q2Count = (options?.step2 || []).find(q => q.kind === 'count');
  const q4Bool  = (options?.step4 || []).find(q => q.kind === 'bool');
  const q4Count = (options?.step4 || []).find(q => q.kind === 'count');

  return (
    <Screen scroll>
      <View style={s.head}>
        <View style={{ flex: 1 }}>
          <H1>Readiness Assessment</H1>
          <Muted>Four steps. Worth 65+ points toward unlocking Opportunities.</Muted>
        </View>
        {score != null ? <Pill label={`${score} pts`} tone="primary" /> : null}
      </View>

      {/* Step rail */}
      <View style={s.rail}>
        {STEPS.map(st => {
          const isDone = done.includes(st.n);
          const isNow = step === st.n;
          return (
            <TouchableOpacity key={st.n} onPress={() => setStep(st.n)}
                              style={[s.railItem, isNow && s.railItemOn, isDone && s.railItemDone]}>
              <Feather name={isDone ? 'check' : st.icon} size={13}
                       color={isDone ? colors.success : isNow ? colors.primaryDark : colors.textSubtle} />
              <Text style={[s.railText, isNow && s.railTextOn]}>{st.n}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Card>
        <H2>{cfg.title}</H2>
        <Muted>{cfg.blurb}</Muted>

        {step === 1 ? (
          <View style={s.chips}>
            {skills.map(skill => (
              <Chip key={skill} label={skill}
                    active={(current.skills || []).includes(skill)}
                    onPress={() => toggleSkill(skill)} />
            ))}
          </View>
        ) : null}

        {step === 2 ? (
          <View style={{ marginTop: spacing(4) }}>
            <Toggle label={q2Bool?.label || 'Done an internship?'} value={current.has_internship ?? false}
                    onChange={v => set('has_internship', v)} />
            <Counter label={q2Count?.label || 'Projects built'} value={current.projects_count}
                     onChange={v => set('projects_count', v)} />
          </View>
        ) : null}

        {step === 3 ? (
          <>
            <View style={s.chips}>
              {goals.map(goal => (
                <Chip key={goal} label={goal} active={current.career_goal === goal}
                      onPress={() => set('career_goal', goal)} />
              ))}
            </View>
            {current.career_goal === 'Other' ? (
              <TextInput
                value={current.custom_goal || ''} onChangeText={v => set('custom_goal', v)}
                placeholder="Tell us your goal" placeholderTextColor={colors.textSubtle}
                style={s.input} />
            ) : null}
          </>
        ) : null}

        {step === 4 ? (
          <View style={{ marginTop: spacing(4) }}>
            <Toggle label={q4Bool?.label || 'Active in student groups?'} value={current.in_groups ?? false}
                    onChange={v => set('in_groups', v)} />
            <Counter label={q4Count?.label || 'Cohorts attended'} value={current.cohorts_attended}
                     onChange={v => set('cohorts_attended', v)} max={30} />
          </View>
        ) : null}
      </Card>

      <View style={s.actions}>
        {step > 1 ? (
          <Button title="Back" variant="ghost" onPress={() => setStep(step - 1)} />
        ) : <View />}
        <Button title={saving ? 'Saving…' : step === 4 ? 'Finish' : 'Save & continue'}
                loading={saving} disabled={!canContinue} onPress={submit} />
      </View>

      {!canContinue ? (
        <Muted style={{ textAlign: 'center' }}>
          {step === 1 ? 'Pick at least one skill to continue.' : 'Choose a goal to continue.'}
        </Muted>
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing(2), marginBottom: spacing(4) },

  rail:         { flexDirection: 'row', gap: spacing(2), marginBottom: spacing(4) },
  railItem:     { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
                  gap: spacing(1), paddingVertical: spacing(3), borderRadius: radius.sm,
                  borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  railItemOn:   { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  railItemDone: { borderColor: colors.success, backgroundColor: colors.successSoft },
  railText:     { fontSize: font.xs, fontWeight: font.semibold, color: colors.textSubtle },
  railTextOn:   { color: colors.primaryDark },

  chips:      { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2), marginTop: spacing(4) },
  chip:       { paddingHorizontal: spacing(3), paddingVertical: spacing(2),
                borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
                backgroundColor: colors.surface },
  chipOn:     { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText:   { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },
  chipTextOn: { color: colors.primaryDark },

  toggleRow:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 paddingVertical: spacing(3), borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  toggleLabel: { fontSize: font.sm, color: colors.text, flex: 1, paddingRight: spacing(3) },

  counter:      { flexDirection: 'row', alignItems: 'center', gap: spacing(3) },
  counterBtn:   { width: 30, height: 30, borderRadius: radius.sm, borderWidth: 1,
                  borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  counterValue: { fontSize: font.base, fontWeight: font.bold, color: colors.text, minWidth: 20,
                  textAlign: 'center' },

  input: { marginTop: spacing(3), borderWidth: 1, borderColor: colors.border,
           borderRadius: radius.sm, paddingHorizontal: spacing(3), paddingVertical: spacing(3),
           fontSize: font.sm, color: colors.text, backgroundColor: colors.surface },

  actions: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
             gap: spacing(3), marginTop: spacing(5), marginBottom: spacing(2) },
});
