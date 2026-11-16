// ── Education & Goals (student) ──────────────────────────────────────────────
// The mobile twin of the web profile cards: what you study, and where you want
// to go. Every option comes from the same endpoints onboarding uses, so the
// promise "you can change this later" is actually true.
//
// Nothing here is write-once. Picking the wrong stage is the most common
// onboarding mistake there is, so changing it is a supported action with an
// explicit warning about which fields stop applying — and the API is told to
// clear them, rather than leaving a B.Tech branch on a class-10 profile.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Loader, Pill, Select} from '../../components/ui';
import { studentApi } from '../../services/api';
import { boardsForStage } from '../../config/boards';

const SCHOOL_STAGES = ['school_10th', 'school_11th', 'school_12th'];
const COURSE_LEVEL = { iti: 'iti', polytechnic: 'diploma', ug: 'ug', pg: 'pg',
                       professional_course: 'professional', phd: 'phd' };
const YEAR_TYPE = { iti: 'year_iti', polytechnic: 'year_diploma', ug: 'year_ug',
                    pg: 'year_pg', phd: 'year_phd', professional_course: 'year_professional' };
const EXAM_TYPE = { govt_exam: 'govt_exam', entrance_exam: 'entrance_exam', dropper: 'entrance_exam' };

const MASTER_TYPES = [
  'onboarding_category', 'govt_exam', 'entrance_exam', 'category',
  'industry', 'experience_range', 'prep_stage',
  'year_iti', 'year_diploma', 'year_ug', 'year_pg', 'year_phd', 'year_professional',
].join(',');

const ADMISSION_YEARS = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() + i);
const opts = (rows) => (rows || []).map((r) => ({ value: r.value, label: r.label }));

/* Fields that stop meaning anything when a student moves between stages. */
function staleFields(from, to) {
  const wasSchool = SCHOOL_STAGES.includes(from);
  const isSchool = SCHOOL_STAGES.includes(to);
  const out = [];
  if (wasSchool && !isSchool) out.push('board', 'group / stream', 'school name');
  if (!wasSchool && isSchool) out.push('course', 'branch', 'year of study', 'college name');
  if (!wasSchool && !isSchool && from !== to) out.push('course', 'branch', 'year of study');
  return out;
}

/* API keys to clear for those fields — the explicit `clear` contract, because
   an empty string is indistinguishable from "leave it alone". */
const CLEAR_KEYS = {
  school:  ['board', 'stream', 'school_name'],
  course:  ['degree_type', 'branch', 'degree_category', 'year_of_study', 'college_name'],
};

function Chips({ options, value, onPick, multi, values, label, placeholder }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  // Single-select is a searchable dropdown — same rule as the rest of the app.
  // `multi` keeps the chip grid: a Select cannot express "pick several", and the
  // multi lists here (target exams, target states) are chosen by tapping a few.
  if (!multi) {
    return (
      <Select options={options} value={value} onChange={(v) => onPick(v || '')}
              label={label} placeholder={placeholder || 'Search…'} />
    );
  }
  return (
    <View style={s.chips}>
      {options.map((o) => {
        const on = multi ? (values || []).includes(o.value) : String(value) === String(o.value);
        return (
          <TouchableOpacity key={o.value} onPress={() => onPick(o.value)} style={[s.chip, on && s.chipOn]}>
            {on && <Feather name="check" size={10} color={colors.primaryDark} />}
            <Text style={[s.chipTxt, on && s.chipTxtOn]}>{o.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function Field({ label, required, children, hint }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={{ marginBottom: spacing(3.5) }}>
      <Text style={s.label}>{label}{required ? ' *' : ''}</Text>
      {children}
      {!!hint && <Muted style={{ fontSize: font.xs, marginTop: 4 }}>{hint}</Muted>}
    </View>
  );
}

export default function EducationGoalsScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [masters, setMasters] = useState({});
  const [boards, setBoards] = useState([]);
  const [streams, setStreams] = useState([]);
  const [states, setStates] = useState([]);
  const [profile, setProfile] = useState(null);
  const [goals, setGoals] = useState(null);

  const [form, setForm] = useState({});
  const [goalForm, setGoalForm] = useState({});
  const [warn, setWarn] = useState(null);

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));
  const setG = (k, v) => setGoalForm((p) => ({ ...p, [k]: v }));

  const stage = form.education_category;
  const isSchool = SCHOOL_STAGES.includes(stage);
  const level = COURSE_LEVEL[stage];
  const examType = EXAM_TYPE[stage];

  const load = useCallback(() => {
    Promise.all([
      studentApi.get('/profile/'),
      studentApi.get('/profile/goals').catch(() => ({ data: {} })),
      studentApi.get('/auth/masters', { types: MASTER_TYPES }).catch(() => ({ data: {} })),
      studentApi.get('/auth/states').catch(() => ({ data: {} })),
    ]).then(([p, g, m, st]) => {
      if (m.data?.bool) setMasters(m.data.response.grouped || {});
      if (st.data?.bool) setStates(st.data.response.states || []);
      if (g.data?.bool) { setGoals(g.data.response); setGoalForm(g.data.response || {}); }
      if (p.data?.bool) {
        const pr = p.data.response.profile || {};
        setProfile(pr);
        setForm({
          education_category: pr.education_category || '',
          board: pr.board || '', stream: pr.stream || '',
          school_name: pr.school_name || '', college_name: pr.college_name || '',
          degree_type: pr.degree_type || '', branch: pr.branch || '',
          year_of_study: pr.year_of_study || '', exam_target: pr.exam_target || '',
          working_industry: pr.working_industry || '', working_experience: pr.working_experience || '',
        });
      }
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Boards follow the student's state (national + that state's boards), the
  // same as the web. Without state_id only national boards came back, so an AP
  // or Telangana student never saw BIEAP / TSBIE or their SSC board here.
  const stateId = states.find((x) => x.name === profile?.state)?.id;
  useEffect(() => {
    const params = stateId ? { state_id: stateId } : undefined;
    studentApi.get('/auth/boards', params)
      .then(({ data }) => { if (data.bool) setBoards(data.response.boards || []); })
      .catch(() => {});
  }, [stateId]);
  useEffect(() => {
    if (!form.board) { setStreams([]); return; }
    studentApi.get('/auth/streams', { board_code: form.board })
      .then(({ data }) => { if (data.bool) setStreams(data.response.streams || []); })
      .catch(() => {});
  }, [form.board]);

  const requestStage = (next) => {
    if (next === form.education_category) return;
    const stale = staleFields(form.education_category, next);
    if (!stale.length || !form.education_category) { set('education_category', next); return; }
    setWarn({ next, stale });
  };

  const confirmStage = () => {
    const wasSchool = SCHOOL_STAGES.includes(form.education_category);
    const nowSchool = SCHOOL_STAGES.includes(warn.next);
    const clear = wasSchool && !nowSchool ? CLEAR_KEYS.school
                : !wasSchool ? CLEAR_KEYS.course : [];
    setForm((p) => {
      const next = { ...p, education_category: warn.next };
      clear.forEach((k) => { next[k] = ''; });
      return next;
    });
    setWarn(null);
  };

  const saveEdu = async () => {
    setSaving(true);
    try {
      // Tell the API which fields to null out. An empty string on its own means
      // "unchanged" to the upsert, so a stale branch would survive the change.
      const clear = Object.entries(form).filter(([, v]) => v === '').map(([k]) => k);
      const { data } = await studentApi.patch('/profile/', { ...form, clear });
      if (data.bool) { Alert.alert('Saved', 'Your education details are up to date.'); load(); }
      else Alert.alert('Could not save', data.response?.message || '');
    } catch { Alert.alert('Could not save', 'Please try again.'); }
    finally { setSaving(false); }
  };

  const saveGoals = async () => {
    setSaving(true);
    try {
      const { data } = await studentApi.put('/profile/goals', goalForm);
      if (data.bool) { Alert.alert('Saved', 'Your goals drive your predictor and scholarship matches.'); load(); }
      else Alert.alert('Could not save', data.response?.message || '');
    } catch { Alert.alert('Could not save', 'Please try again.'); }
    finally { setSaving(false); }
  };

  const toggle = (key, value, max) => {
    const cur = goalForm[key] || [];
    if (cur.includes(value)) setG(key, cur.filter((v) => v !== value));
    else if (!max || cur.length < max) setG(key, [...cur, value]);
  };

  if (loading) return <Screen><Loader label="Loading your profile…" /></Screen>;

  return (
    <Screen scroll>
      <H1>Education & Goals</H1>
      <Muted style={{ marginBottom: spacing(4) }}>What you study, and where you want to go</Muted>

      {/* ── Education ── */}
      <Card>
        <View style={s.cardHead}>
          <Feather name="book-open" size={16} color={colors.primary} />
          <H2 style={{ flex: 1 }}>My Education</H2>
        </View>

        <Field label="Stage" required>
          <Chips options={(masters.onboarding_category || []).map((c) => ({
                   value: c.value, label: String(c.label).split('|')[0] }))}
                 value={stage} onPick={requestStage} />
        </Field>

        {warn && (
          <View style={s.warn}>
            <Text style={s.warnTitle}>
              <Feather name="alert-triangle" size={12} /> Changing your stage
            </Text>
            <Muted style={{ fontSize: font.xs, marginTop: 4 }}>
              We'll clear: {warn.stale.join(', ')} — they don't apply any more.{'\n'}
              We'll keep: state, city, target exams, documents and your score.
            </Muted>
            <View style={{ flexDirection: 'row', gap: spacing(2), marginTop: spacing(3) }}>
              <Button title="Cancel" variant="ghost" size="sm" onPress={() => setWarn(null)} />
              <Button title="Change stage" size="sm" onPress={confirmStage} />
            </View>
          </View>
        )}

        {isSchool && (
          <>
            <Field label="Board" required hint="Your stream options depend on this.">
              <Chips options={boardsForStage(boards, stage).map((b) => ({ value: b.code, label: b.name.split('—')[0].trim() }))}
                     value={form.board} onPick={(v) => { set('board', v); set('stream', ''); }} />
            </Field>
            {!!form.board && (
              <Field label="Group / Stream" required>
                <Chips options={streams.map((x) => ({ value: x.canonical, label: x.short_label }))}
                       value={form.stream} onPick={(v) => set('stream', v)} />
              </Field>
            )}
            <Field label="School name">
              <TextInput value={form.school_name} onChangeText={(v) => set('school_name', v)}
                         style={s.input} placeholder="e.g. Narayana Junior College"
                         placeholderTextColor={colors.textSubtle} />
            </Field>
          </>
        )}

        {!!level && (
          <>
            <Field label="What are you studying?" required
                   hint="Type a course name — e.g. btech cse, mba finance.">
              <TextInput value={form.degree_type} onChangeText={(v) => set('degree_type', v)}
                         style={s.input} placeholder="e.g. B.Tech"
                         placeholderTextColor={colors.textSubtle} />
            </Field>
            <Field label="Branch / specialisation">
              <TextInput value={form.branch} onChangeText={(v) => set('branch', v)}
                         style={s.input} placeholder="e.g. Computer Science"
                         placeholderTextColor={colors.textSubtle} />
            </Field>
            <Field label="Year" required>
              <Chips options={opts(masters[YEAR_TYPE[stage]])} value={form.year_of_study}
                     onPick={(v) => set('year_of_study', v)} />
            </Field>
            <Field label="College / institute">
              <TextInput value={form.college_name} onChangeText={(v) => set('college_name', v)}
                         style={s.input} placeholder="e.g. IIM Visakhapatnam"
                         placeholderTextColor={colors.textSubtle} />
            </Field>
          </>
        )}

        {!!examType && (
          <>
            <Field label="Exam" required>
              <Chips options={opts(masters[examType])} value={form.exam_target}
                     onPick={(v) => set('exam_target', v)} />
            </Field>
            <Field label="Preparation stage">
              <Chips options={opts(masters.prep_stage)} value={form.year_of_study}
                     onPick={(v) => set('year_of_study', v)} />
            </Field>
          </>
        )}

        {stage === 'working' && (
          <>
            <Field label="Industry">
              <Chips options={opts(masters.industry)} value={form.working_industry}
                     onPick={(v) => set('working_industry', v)} />
            </Field>
            <Field label="Experience">
              <Chips options={opts(masters.experience_range)} value={form.working_experience}
                     onPick={(v) => set('working_experience', v)} />
            </Field>
          </>
        )}

        <Button title={saving ? 'Saving…' : 'Save education'} icon="check"
                onPress={saveEdu} loading={saving} disabled={saving || !!warn} />
      </Card>

      {/* ── Goals ── */}
      <Card style={{ marginTop: spacing(4) }}>
        <View style={s.cardHead}>
          <Feather name="target" size={16} color={colors.primary} />
          <H2 style={{ flex: 1 }}>My Goals</H2>
        </View>

        <Field label="Preparing for" hint="Up to 5.">
          <Chips multi values={goalForm.target_exams}
                 options={[...opts(masters.entrance_exam), ...opts(masters.govt_exam)]}
                 onPick={(v) => toggle('target_exams', v, 5)} />
        </Field>

        <Field label="Where do you want to study?"
               hint="Not where you live — where you want to go. Up to 5.">
          <Chips multi values={goalForm.target_states}
                 options={states.map((x) => ({ value: x.name, label: x.name }))}
                 onPick={(v) => toggle('target_states', v, 5)} />
        </Field>

        <Field label="Target admission year">
          <Chips options={ADMISSION_YEARS.map((y) => ({ value: y, label: String(y) }))}
                 value={goalForm.admission_year} onPick={(v) => setG('admission_year', v)} />
        </Field>

        <Field label="Reservation category"
               hint="Used for cutoff and scholarship matching.">
          <Chips options={opts(masters.category)} value={goalForm.reservation_category}
                 onPick={(v) => setG('reservation_category', v)} />
        </Field>

        <Button title={saving ? 'Saving…' : 'Save goals'} icon="check"
                onPress={saveGoals} loading={saving} disabled={saving} />
      </Card>
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(4) },
  label: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted, marginBottom: spacing(2) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 7, paddingHorizontal: 12,
    borderRadius: radius.md, borderWidth: 1.5, borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipTxt: { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },
  chipTxtOn: { color: colors.primaryDark },
  input: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing(4), paddingVertical: spacing(3),
    fontSize: font.sm, color: colors.text },
  warn: { borderWidth: 1, borderColor: colors.warning, backgroundColor: colors.warningSoft,
    borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(3.5) },
  warnTitle: { fontSize: font.xs, fontWeight: font.bold, color: colors.warning },
});
