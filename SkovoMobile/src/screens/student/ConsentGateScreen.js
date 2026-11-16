// ── DPDP consent gate (student) ──────────────────────────────────────────────
// Shown to any student whose consent is not granted. Collects DOB, then:
//   under 14 → blocked · 14–17 → parental email · 18+ → straight in.
import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Button, Loader } from '../../components/ui';
import { studentApi } from '../../services/api';

export default function ConsentGateScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const [stage, setStage] = useState('loading'); // loading | dob | parent | blocked | waiting
  const [dobText, setDobText] = useState(''); // DD-MM-YYYY, typed
  const [parentEmail, setParentEmail] = useState('');
  const [parentName, setParentName] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    studentApi.get('/auth/consent/status')
      .then(({ data: d }) => {
        if (!d.bool) { setStage('dob'); return; }
        const cs = d.response.consent_status;
        if (cs === 'granted') navigation.replace('Tabs');
        else if (cs === 'blocked') setStage('blocked');
        else if (cs === 'awaiting_parent' && d.response.parent_email) setStage('waiting');
        else if (cs === 'awaiting_parent') setStage('parent');
        else setStage('dob');
      })
      .catch(() => setStage('dob'));
  }, [navigation]);

  const submitDob = async () => {
    // Accept DD-MM-YYYY or DD/MM/YYYY and convert to ISO for the API.
    const m = dobText.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
    if (!m) { setErr('Enter your date of birth as DD-MM-YYYY.'); return; }
    const [, dd, mm, yyyy] = m;
    const iso = `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
    if (Number.isNaN(Date.parse(iso))) { setErr('That date does not look right.'); return; }
    setErr(''); setBusy(true);
    try {
      const { data: d } = await studentApi.post('/auth/consent/dob', { date_of_birth: iso });
      if (d.bool) {
        if (d.response.needs_parental_consent) setStage('parent');
        else navigation.replace('Tabs');
      } else if (d.response?.consent_status === 'blocked') setStage('blocked');
      else setErr(d.response?.message || 'Please check your date of birth.');
    } catch { setErr('Something went wrong.'); } finally { setBusy(false); }
  };

  const submitParent = async () => {
    if (!parentEmail.trim() || !parentEmail.includes('@')) { setErr('Enter a valid parent email.'); return; }
    setErr(''); setBusy(true);
    try {
      const { data: d } = await studentApi.post('/auth/consent/parent', {
        parent_email: parentEmail.trim(), parent_name: parentName.trim(),
      });
      if (d.bool) setStage('waiting');
      else setErr(d.response?.message || 'Could not send.');
    } catch { setErr('Something went wrong.'); } finally { setBusy(false); }
  };

  if (stage === 'loading') return <Screen><Loader /></Screen>;

  const Icon = ({ name, tone }) => (
    <View style={[s.icon, { backgroundColor: tone }]}>
      <Feather name={name} size={26} color={colors.onPrimary} />
    </View>
  );

  return (
    <Screen scroll contentStyle={{ justifyContent: 'center', flexGrow: 1 }}>
      <View style={s.card}>
        {stage === 'blocked' && (
          <>
            <Icon name="lock" tone={colors.danger} />
            <H2 style={s.title}>You need to be 14 or older</H2>
            <Muted style={s.body}>
              Skovo is built for students aged 14 and above. Please come back when you are old enough.
            </Muted>
          </>
        )}

        {stage === 'waiting' && (
          <>
            <Icon name="clock" tone={colors.warning} />
            <H2 style={s.title}>Waiting for a parent</H2>
            <Muted style={s.body}>
              We've emailed your parent or guardian to confirm your account. As soon as they click the link,
              Skovo unlocks. Check back later.
            </Muted>
            <Button title="Resend to a different email" variant="ghost"
                    onPress={() => setStage('parent')} style={{ marginTop: spacing(4) }} />
          </>
        )}

        {stage === 'parent' && (
          <>
            <Icon name="mail" tone={colors.primary} />
            <H2 style={s.title}>A parent needs to confirm</H2>
            <Muted style={s.body}>
              Because you're under 18, a parent or guardian must give consent (required by law) before your
              account activates.
            </Muted>
            <TextInput value={parentEmail} onChangeText={setParentEmail} placeholder="Parent / guardian email"
                       autoCapitalize="none" keyboardType="email-address" style={s.input} />
            <TextInput value={parentName} onChangeText={setParentName} placeholder="Parent name (optional)"
                       style={s.input} />
            {!!err && <Text style={s.err}>{err}</Text>}
            <Button title="Send consent request" icon="send" onPress={submitParent} loading={busy}
                    style={{ marginTop: spacing(3) }} />
          </>
        )}

        {stage === 'dob' && (
          <>
            <Icon name="gift" tone={colors.primary} />
            <H2 style={s.title}>One quick thing</H2>
            <Muted style={s.body}>
              Tell us your date of birth so we can set up your account correctly, as required by India's
              data-protection rules for students.
            </Muted>
            <View style={s.dobBtn}>
              <Feather name="calendar" size={16} color={colors.textMuted} />
              <TextInput value={dobText} onChangeText={setDobText} placeholder="DD-MM-YYYY"
                         keyboardType="number-pad" maxLength={10}
                         style={{ flex: 1, fontSize: font.sm, color: colors.text }} />
            </View>
            {!!err && <Text style={s.err}>{err}</Text>}
            <Button title="Continue" onPress={submitDob} loading={busy} style={{ marginTop: spacing(3) }} />
            <View style={s.dpdp}>
              <Feather name="shield" size={12} color={colors.textSubtle} />
              <Muted style={{ fontSize: font.xs }}>Protected under the DPDP Act 2023</Muted>
            </View>
          </>
        )}
      </View>
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.xl, padding: spacing(7),
    alignItems: 'center', ...shadow.card },
  icon: { width: 60, height: 60, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: spacing(4), textAlign: 'center' },
  body: { textAlign: 'center', marginTop: spacing(2) },
  input: { width: '100%', backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing(4), paddingVertical: spacing(3.5), fontSize: font.sm,
    color: colors.text, marginTop: spacing(3) },
  dobBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), width: '100%',
    backgroundColor: colors.surfaceAlt, borderRadius: radius.md, paddingHorizontal: spacing(4),
    paddingVertical: spacing(4), marginTop: spacing(4) },
  dobText: { fontSize: font.sm, color: colors.text, fontWeight: '600' },
  err: { color: colors.danger, fontSize: font.sm, marginTop: spacing(2), alignSelf: 'flex-start' },
  dpdp: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: spacing(4) },
});
