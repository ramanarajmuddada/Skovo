import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TextInput, ScrollView, Pressable, ActivityIndicator, StyleSheet, Platform,
} from 'react-native';
import { studentApi as api } from '../../services/api';
import { useTheme, useThemedStyles, spacing, radius, font } from '../../theme';
import { Select } from '../../components/ui';
import { boardsForStage } from '../../config/boards';

/**
 * Student onboarding for mobile — the same three screens as the web flow.
 *
 *   1. Where you are    — stage · state · date of birth (the DPDP gate)
 *   2. What you study   — board/stream for school, a searchable course for
 *                         college, exam for aspirants. Options follow the state.
 *   3. Where you're going — target exams, interests, target states, admission
 *                         year, reservation category.
 *
 * Until now mobile had no onboarding at all: a signup here landed with
 * education_level = NULL, which silently degraded every targeted surface —
 * cohorts, colleges, opportunities and mentors all key off it. Mobile is where
 * most Indian students sign up, so that gap was half the audience.
 *
 * Every option list comes from the API. Nothing here is hardcoded except the
 * screen copy.
 */

const SCHOOL_STAGES = ['school_10th', 'school_11th', 'school_12th'];
const COURSE_LEVEL  = { iti: 'iti', polytechnic: 'diploma', ug: 'ug', pg: 'pg',
                        professional_course: 'professional', phd: 'phd' };
const YEAR_TYPE     = { iti: 'year_iti', polytechnic: 'year_diploma', ug: 'year_ug',
                        pg: 'year_pg', phd: 'year_phd', professional_course: 'year_professional' };
const EXAM_STAGES   = { govt_exam: 'govt_exam', entrance_exam: 'entrance_exam', dropper: 'entrance_exam' };

const MASTER_TYPES = [
  'onboarding_category', 'govt_exam', 'entrance_exam', 'career_interest',
  'industry', 'experience_range', 'prep_stage', 'category',
  'year_iti', 'year_diploma', 'year_ug', 'year_pg', 'year_phd', 'year_professional',
].join(',');

const ADMISSION_YEARS = Array.from({ length: 7 }, (_, i) => String(new Date().getFullYear() + i));
const opts = (rows) => (rows || []).map(r => ({ value: r.value, label: r.label }));

/* ── pieces ────────────────────────────────────────────────────────────────── */

function Chip({ label, active, onPress }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Pressable onPress={onPress} style={[s.chip, active && s.chipOn]}>
      <Text style={[s.chipText, active && s.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

// Single-select lists are searchable dropdowns, not chip rows: this screen asks
// for a state (36), a board, a stream and an exam, and a chip row of 36 states is
// a swipe-hunt. MultiChipRow below stays chips — a Select cannot express "pick
// several", and those lists are short by design.
function ChipRow({ options, value, onChange, label, placeholder }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Select options={options} value={value} onChange={(v) => onChange(v || '')}
            label={label} placeholder={placeholder || 'Search…'} />
  );
}

function MultiChipRow({ options, values = [], onChange, max }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const toggle = (v) => {
    if (values.includes(v)) return onChange(values.filter(x => x !== v));
    if (max && values.length >= max) return;
    onChange([...values, v]);
  };
  return (
    <View style={s.chipWrap}>
      {options.map(o => (
        <Chip key={o.value} label={o.label} active={values.includes(o.value)}
              onPress={() => toggle(o.value)} />
      ))}
    </View>
  );
}

function Label({ children, required, hint }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <Text style={s.label}>
      {children}{required ? <Text style={s.req}> *</Text> : null}
      {hint ? <Text style={s.hint}>  {hint}</Text> : null}
    </Text>
  );
}

/** Type-ahead over an endpoint — students type "btech cse", not a three-level path. */
function Search({ placeholder, value, onPick, fetcher, emptyText }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [q, setQ]       = useState('');
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    const t = setTimeout(() => {
      if (!alive) return;
      setBusy(true);
      fetcher(q)
        .then(r => { if (alive) setRows(r); })
        .catch(() => { if (alive) setRows([]); })
        .finally(() => { if (alive) setBusy(false); });
    }, 220);
    return () => { alive = false; clearTimeout(t); };
  }, [q, open, fetcher]);

  if (value) {
    return (
      <View style={s.picked}>
        <Text style={s.pickedText} numberOfLines={1}>{value}</Text>
        <Pressable onPress={() => { onPick(null); setOpen(true); }} hitSlop={8}>
          <Text style={s.change}>Change</Text>
        </Pressable>
      </View>
    );
  }
  return (
    <View>
      <View style={s.inputRow}>
        <TextInput
          value={q} onChangeText={t => { setQ(t); setOpen(true); }} onFocus={() => setOpen(true)}
          placeholder={placeholder} placeholderTextColor={colors.textSubtle}
          style={s.inputFlex} autoCorrect={false} />
        {busy ? <ActivityIndicator size="small" color={colors.textSubtle} /> : null}
      </View>
      {open ? (
        <View style={s.dropdown}>
          {rows.length === 0 && !busy ? (
            <Text style={s.dropEmpty}>{emptyText || 'No matches — try a shorter word.'}</Text>
          ) : rows.map(r => (
            <Pressable key={r.key} onPress={() => { onPick(r); setOpen(false); setQ(''); }} style={s.dropRow}>
              <Text style={s.dropLabel}>{r.label}</Text>
              {r.sub ? <Text style={s.dropSub}>{r.sub}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Panel({ title, desc, children }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.panelWrap}>
      <View style={s.panel}>
        <Text style={s.panelTitle}>{title}</Text>
        <Text style={s.panelDesc}>{desc}</Text>
        {children}
      </View>
    </View>
  );
}

/* ── screen ────────────────────────────────────────────────────────────────── */

export default function OnboardingScreen({ consentStatus = 'granted', onDone = () => {} }) {
  const consentDone = consentStatus === 'granted';

  const [step, setStep]   = useState(1);
  const [phase, setPhase] = useState(
    consentStatus === 'blocked' ? 'blocked'
      : consentStatus === 'awaiting_parent' ? 'parent' : 'flow');
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState('');

  const [masters, setMasters] = useState({});
  const [states, setStates]   = useState([]);
  const [boards, setBoards]   = useState([]);
  const [streams, setStreams] = useState([]);
  const [cities, setCities]   = useState([]);

  const [cat, setCat]         = useState('');
  const [stateId, setStateId] = useState('');
  const [dob, setDob]         = useState('');          // dd-mm-yyyy as typed

  const [board, setBoard]   = useState('');
  const [stream, setStream] = useState('');
  const [course, setCourse] = useState(null);
  const [year, setYear]     = useState('');
  const [place, setPlace]   = useState('');
  const [city, setCity]     = useState('');
  const [exam, setExam]     = useState('');
  const [prep, setPrep]     = useState('');
  const [industry, setIndustry]     = useState('');
  const [experience, setExperience] = useState('');

  const [targetExams, setTargetExams]     = useState([]);
  const [interests, setInterests]         = useState([]);
  const [targetStates, setTargetStates]   = useState([]);
  const [admissionYear, setAdmissionYear] = useState('');
  const [reservation, setReservation]     = useState('');

  const [parentEmail, setParentEmail] = useState('');

  const isSchool  = SCHOOL_STAGES.includes(cat);
  const level     = COURSE_LEVEL[cat];
  const examType  = EXAM_STAGES[cat];
  const isWorking = cat === 'working';
  const stateName = states.find(x => x.id === stateId)?.name || '';

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get('/auth/masters', { types: MASTER_TYPES }).catch(() => ({ data: {} })),
      api.get('/auth/states').catch(() => ({ data: {} })),
    ]).then(([m, st]) => {
      if (!alive) return;
      setMasters(m.data?.response?.grouped || {});
      setStates(st.data?.response?.states || []);
    });
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    if (!stateId) return;
    let alive = true;
    Promise.all([
      api.get('/auth/boards', { state_id: stateId }).catch(() => ({ data: {} })),
      api.get('/auth/cities', { state_id: stateId }).catch(() => ({ data: {} })),
    ]).then(([b, c]) => {
      if (!alive) return;
      setBoards(b.data?.response?.boards || []);
      setCities(c.data?.response?.cities || []);
    });
    return () => { alive = false; };
  }, [stateId]);

  useEffect(() => {
    if (!board) return;
    let alive = true;
    api.get('/auth/streams', { board_code: board })
      .then(({ data }) => { if (alive) setStreams(data?.response?.streams || []); })
      .catch(() => { if (alive) setStreams([]); });
    return () => { alive = false; };
  }, [board]);

  const searchCourses = useCallback((q) =>
    api.get('/auth/courses/search', { q, level, limit: 12 })
      .then(({ data }) => (data?.response?.courses || []).map(c => ({
        key: c.id, label: c.display_name, sub: c.degree_category, row: c,
      }))), [level]);

  // dd-mm-yyyy is how an Indian student writes a date; the API wants ISO.
  const isoDob = (() => {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(dob.trim());
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  })();

  const step1Ready = Boolean(cat && stateId && (consentDone || isoDob));
  const step2Ready = (() => {
    if (cat === 'gap_year') return true;
    if (isSchool)  return Boolean(board && stream && city);
    if (level)     return Boolean(course && year && city);
    if (examType)  return Boolean(exam && prep && city);
    if (isWorking) return Boolean(industry && experience && city);
    return Boolean(city);
  })();
  const step3Ready = interests.length > 0;
  const ready = step === 1 ? step1Ready : step === 2 ? step2Ready : step3Ready;

  async function next() {
    if (busy || !ready) return;
    setError('');

    if (step === 1 && !consentDone) {
      setBusy(true);
      try {
        const { data } = await api.post('/auth/consent/dob', { date_of_birth: isoDob });
        if (!data.bool) {
          if (data.response?.consent_status === 'blocked') { setPhase('blocked'); return; }
          setError(data.response?.message || 'Please check your date of birth.');
          return;
        }
        if (data.response?.needs_parental_consent) { setPhase('parent'); return; }
      } catch {
        setError('Something went wrong. Please try again.');
        return;
      } finally { setBusy(false); }
    }

    if (step < 3) { setStep(step + 1); return; }
    await save();
  }

  async function save() {
    setBusy(true); setError('');
    try {
      const payload = {
        education_category: cat,
        state: stateName,
        city,
        board:  isSchool ? board : undefined,
        stream: isSchool ? stream : undefined,
        school_name:  isSchool ? place : undefined,
        college_name: !isSchool ? place : undefined,
        degree_category: course?.degree_category,
        degree_type:     course?.degree,
        branch:          course?.branch,
        iti_trade:       cat === 'iti' ? course?.branch : undefined,
        professional_course_type:  cat === 'professional_course' ? course?.degree : undefined,
        professional_course_level: cat === 'professional_course' ? course?.branch : undefined,
        year_of_study: year || prep,
        exam_target: exam,
        working_industry: industry,
        working_experience: experience,
        career_interests: interests,
      };
      Object.keys(payload).forEach(k => {
        if (payload[k] === undefined || payload[k] === '') delete payload[k];
      });

      const { data } = await api.patch('/profile/', payload);
      if (!data.bool) throw new Error(data.response?.message || 'Could not save.');

      // Goals are enrichment — a failure here must not block entry to the app.
      await api.put('/profile/goals', {
        target_exams:   targetExams,
        target_states:  targetStates,
        target_courses: course ? [course.display_name] : [],
        admission_year: admissionYear || null,
        reservation_category: reservation || null,
      }).catch(() => {});

      onDone();
    } catch (e) {
      setError(e.message || 'Something went wrong.');
      setBusy(false);
    }
  }

  async function sendParent() {
    if (busy || !parentEmail.trim()) return;
    setBusy(true); setError('');
    try {
      const { data } = await api.post('/auth/consent/parent', { parent_email: parentEmail.trim() });
      if (data.bool) setPhase('waiting');
      else setError(data.response?.message || 'Please enter a valid email.');
    } catch { setError('Something went wrong.'); }
    finally { setBusy(false); }
  }

  if (phase === 'blocked') return (
    <Panel title="You need to be 14 or older"
           desc="Skovo is built for students aged 14 and above. Please come back when you are old enough — we will be here." />
  );

  if (phase === 'waiting') return (
    <Panel title="Waiting for a parent"
           desc={`We have emailed ${parentEmail || 'your parent or guardian'} to confirm your account. As soon as they tap the link, Skovo unlocks.`}>
      <Pressable onPress={() => setPhase('parent')} style={s.secondaryBtn}>
        <Text style={s.secondaryText}>Sent to the wrong email? Resend</Text>
      </Pressable>
    </Panel>
  );

  if (phase === 'parent') return (
    <Panel title="A parent needs to confirm"
           desc="Because you are under 18, a parent or guardian has to give consent (required by law) before your account activates.">
      <TextInput value={parentEmail} onChangeText={setParentEmail}
                 placeholder="Parent / guardian email" placeholderTextColor={colors.textSubtle}
                 autoCapitalize="none" keyboardType="email-address" style={s.input} />
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Pressable onPress={sendParent} disabled={busy || !parentEmail.trim()}
                 style={[s.primaryBtn, (busy || !parentEmail.trim()) && s.btnOff]}>
        <Text style={s.primaryText}>{busy ? 'Sending…' : 'Send consent request'}</Text>
      </Pressable>
    </Panel>
  );

  const HEAD = {
    1: ['Welcome to SKOVO', 'Tell us where you are — everything else shapes around it.'],
    2: ['A few study details', 'This decides which cohorts, colleges and mentors you see.'],
    3: ['Where do you want to go?', 'The part that makes your roadmap yours.'],
  }[step];

  return (
    <View style={s.root}>
      <View style={s.header}>
        <Text style={s.title}>{HEAD[0]}</Text>
        <Text style={s.subtitle}>{HEAD[1]}</Text>
        <View style={s.steps}>
          {[1, 2, 3].map(n => (
            <View key={n} style={[s.stepBar, n <= step && s.stepBarOn]} />
          ))}
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={s.bodyContent} keyboardShouldPersistTaps="handled">
        {step === 1 ? (
          <>
            <Label required>Where are you right now?</Label>
            <View style={s.tiles}>
              {(masters.onboarding_category || []).map(c => {
                const [name, sub = ''] = String(c.label || '').split('|');
                const on = cat === c.value;
                return (
                  <Pressable key={c.value} onPress={() => setCat(c.value)} style={[s.tile, on && s.tileOn]}>
                    <Text style={[s.tileName, on && s.tileNameOn]}>{name}</Text>
                    <Text style={s.tileSub} numberOfLines={2}>{sub}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Label required>Which state are you in?</Label>
            <ChipRow options={states.map(x => ({ value: x.id, label: x.name }))}
                     value={stateId}
                     onChange={v => {
                       setStateId(v);
                       setBoards([]); setCities([]); setStreams([]);
                       setBoard(''); setStream(''); setCity('');
                     }} />

            {!consentDone ? (
              <>
                <Label required hint="required by the DPDP Act">Date of birth</Label>
                <TextInput value={dob} onChangeText={setDob} placeholder="dd-mm-yyyy"
                           placeholderTextColor={colors.textSubtle} keyboardType="number-pad"
                           maxLength={10} style={s.input} />
              </>
            ) : null}
          </>
        ) : null}

        {step === 2 ? (
          <>
            {isSchool ? (
              <>
                <Label required hint="decides your subject group names">Board</Label>
                <ChipRow options={boardsForStage(boards, cat).map(b => ({ value: b.code, label: b.name.split('—')[0].trim() }))}
                         value={board} onChange={v => { setBoard(v); setStream(''); setStreams([]); }} />
                {board ? (
                  <>
                    <Label required>
                      {cat === 'school_10th' ? 'Group you are planning for 11th' : 'Your group / stream'}
                    </Label>
                    <ChipRow options={streams.map(x => ({ value: x.canonical, label: x.short_label }))}
                             value={stream} onChange={setStream} />
                  </>
                ) : null}
                <Label>School name</Label>
                <TextInput value={place} onChangeText={setPlace} placeholder="Optional"
                           placeholderTextColor={colors.textSubtle} style={s.input} />
              </>
            ) : null}

            {level ? (
              <>
                <Label required hint="type it the way you say it">What are you studying?</Label>
                <Search placeholder={cat === 'iti' ? 'e.g. electrician' : 'e.g. btech cse, mba finance'}
                        value={course?.display_name} onPick={r => setCourse(r ? r.row : null)}
                        fetcher={searchCourses} emptyText="No match — try just the degree." />
                <Label required>Year</Label>
                <ChipRow options={opts(masters[YEAR_TYPE[cat]])} value={year} onChange={setYear} />
                <Label>College / institute</Label>
                <TextInput value={place} onChangeText={setPlace} placeholder="Optional"
                           placeholderTextColor={colors.textSubtle} style={s.input} />
              </>
            ) : null}

            {examType ? (
              <>
                <Label required>Which exam are you preparing for?</Label>
                <ChipRow options={opts(masters[examType])} value={exam} onChange={setExam} />
                <Label required>Where are you in your preparation?</Label>
                <ChipRow options={opts(masters.prep_stage)} value={prep} onChange={setPrep} />
              </>
            ) : null}

            {isWorking ? (
              <>
                <Label required>Industry</Label>
                <ChipRow options={opts(masters.industry)} value={industry} onChange={setIndustry} />
                <Label required>Experience</Label>
                <ChipRow options={opts(masters.experience_range)} value={experience} onChange={setExperience} />
              </>
            ) : null}

            <Label required>Which city are you in?</Label>
            <ChipRow options={cities.map(c => ({ value: c.name, label: c.name }))}
                     value={city} onChange={setCity} />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <Label hint="this is what we build your roadmap around">What are you preparing for?</Label>
            <MultiChipRow options={[...opts(masters.entrance_exam), ...opts(masters.govt_exam)]}
                          values={targetExams} onChange={setTargetExams} max={5} />

            <Label required hint="up to 5">Career interests</Label>
            <MultiChipRow options={opts(masters.career_interest)} values={interests}
                          onChange={setInterests} max={5} />

            <Label hint="not where you live — where you want to study">Where do you want to study?</Label>
            <MultiChipRow options={states.map(x => ({ value: x.name, label: x.name }))}
                          values={targetStates} onChange={setTargetStates} max={5} />

            <Label>Target admission year</Label>
            <ChipRow options={ADMISSION_YEARS.map(y => ({ value: y, label: y }))}
                     value={admissionYear} onChange={setAdmissionYear} />

            <Label>Reservation category</Label>
            <ChipRow options={opts(masters.category)} value={reservation} onChange={setReservation} />
            <Text style={s.footnote}>
              Category and target locations decide which cutoffs and scholarships we show you.
              You can change all of this later in your Profile.
            </Text>
          </>
        ) : null}
      </ScrollView>

      <View style={s.footer}>
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable onPress={next} disabled={busy || !ready} style={[s.primaryBtn, (busy || !ready) && s.btnOff]}>
          <Text style={s.primaryText}>
            {busy ? 'Saving…' : step === 3 ? 'Continue to SKOVO' : 'Next'}
          </Text>
        </Pressable>
        {step > 1 ? (
          <Pressable onPress={() => { setStep(step - 1); setError(''); }} disabled={busy} style={s.secondaryBtn}>
            <Text style={s.secondaryText}>Back</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors, shadow) => ({
  root:   { flex: 1, backgroundColor: colors.bg },
  header: { paddingTop: spacing(14), paddingHorizontal: spacing(5), paddingBottom: spacing(3) },
  title:    { fontSize: font.xl, fontWeight: font.bold, color: colors.text },
  subtitle: { fontSize: font.sm, color: colors.textMuted, marginTop: spacing(1) },
  steps:    { flexDirection: 'row', gap: spacing(2), marginTop: spacing(4) },
  stepBar:  { flex: 1, height: 5, borderRadius: radius.pill, backgroundColor: colors.border },
  stepBarOn:{ backgroundColor: colors.primary },

  body:        { flex: 1 },
  bodyContent: { paddingHorizontal: spacing(5), paddingBottom: spacing(8) },

  label: { fontSize: font.sm, fontWeight: font.semibold, color: colors.text, marginTop: spacing(5), marginBottom: spacing(2) },
  req:   { color: colors.danger },
  hint:  { fontSize: font.xs, fontWeight: font.regular, color: colors.textSubtle },

  tiles:    { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  tile:     { width: '48%', backgroundColor: colors.surface, borderRadius: radius.md,
              borderWidth: 2, borderColor: colors.border, padding: spacing(3) },
  tileOn:   { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  tileName: { fontSize: font.sm, fontWeight: font.bold, color: colors.text },
  tileNameOn:{ color: colors.primaryDark },
  tileSub:  { fontSize: font.xs, color: colors.textSubtle, marginTop: spacing(1) },

  chipWrap:   { flexDirection: 'row', flexWrap: 'wrap', gap: spacing(2) },
  chip:       { paddingHorizontal: spacing(3), paddingVertical: spacing(2),
                borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border,
                backgroundColor: colors.surface },
  chipOn:     { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText:   { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },
  chipTextOn: { color: colors.primaryDark },

  input:     { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
               borderRadius: radius.md, paddingHorizontal: spacing(3),
               paddingVertical: Platform.OS === 'ios' ? spacing(3) : spacing(2),
               fontSize: font.base, color: colors.text },
  inputRow:  { flexDirection: 'row', alignItems: 'center', gap: spacing(2),
               backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
               borderRadius: radius.md, paddingHorizontal: spacing(3) },
  inputFlex: { flex: 1, paddingVertical: Platform.OS === 'ios' ? spacing(3) : spacing(2),
               fontSize: font.base, color: colors.text },

  dropdown:  { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
               borderRadius: radius.md, marginTop: spacing(1), overflow: 'hidden' },
  dropRow:   { paddingHorizontal: spacing(3), paddingVertical: spacing(2.5),
               borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  dropLabel: { fontSize: font.sm, color: colors.text },
  dropSub:   { fontSize: font.xs, color: colors.textSubtle, marginTop: 2 },
  dropEmpty: { fontSize: font.xs, color: colors.textSubtle, padding: spacing(3) },

  picked:     { flexDirection: 'row', alignItems: 'center', gap: spacing(2),
                backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary,
                borderRadius: radius.md, paddingHorizontal: spacing(3), paddingVertical: spacing(3) },
  pickedText: { flex: 1, fontSize: font.sm, fontWeight: font.semibold, color: colors.text },
  change:     { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },

  footer:      { padding: spacing(5), borderTopWidth: 1, borderTopColor: colors.borderSoft,
                 backgroundColor: colors.surface },
  primaryBtn:  { backgroundColor: colors.primary, borderRadius: radius.md,
                 paddingVertical: spacing(4), minHeight: 48, justifyContent: 'center', alignItems: 'center', ...shadow.card },
  primaryText: { color: colors.onPrimary, fontWeight: font.bold, fontSize: font.base },
  btnOff:      { opacity: 0.4 },
  secondaryBtn:{ paddingVertical: spacing(3), alignItems: 'center' },
  secondaryText:{ color: colors.textMuted, fontWeight: font.semibold, fontSize: font.sm },
  error:       { color: colors.danger, fontSize: font.sm, textAlign: 'center', marginBottom: spacing(2) },
  footnote:    { fontSize: font.xs, color: colors.textMuted, marginTop: spacing(4), lineHeight: 18 },

  panelWrap:  { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', padding: spacing(5) },
  panel:      { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(6), ...shadow.card },
  panelTitle: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, textAlign: 'center' },
  panelDesc:  { fontSize: font.sm, color: colors.textMuted, textAlign: 'center',
                marginTop: spacing(2), lineHeight: 20 },
});
