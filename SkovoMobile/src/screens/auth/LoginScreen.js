// ── One sign-in for both portals ─────────────────────────────────────────────
// Students and achievers are separate accounts with separate endpoints, but a
// person signing in already knows who they are — asking them to pick a role
// first is a question the app can answer itself from the address they type.
//
// It can answer it because student and achiever emails are mutually exclusive:
// registration rejects an address already used by the other portal (see
// portal/helpers/identity.py). So at most one of these two logins can succeed.
//
// Try the student endpoint, fall back to the achiever one on a 401. Deliberately
// in that order — students are the overwhelming majority, so almost every login
// costs a single request.
import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { H1, Body, Button, Input, ThemeTrigger } from '../../components/ui';
import { studentApi, achieverApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

export default function LoginScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const { loginStudent } = useAuth();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    const mail = email.trim().toLowerCase();
    if (!mail || !pw) { setError('Email and password are required.'); return; }
    setLoading(true); setError('');

    try {
      const student = await studentApi.post('/auth/login', { email: mail, password: pw });
      if (student.data.bool) {
        await loginStudent(student.data.access_token, student.data.response, student.data.refresh_token);
        return;
      }

      // Not a student. A network failure reports status 0, not 401 — retrying
      // the other portal then would just fail again and hide the real reason.
      if (student.status === 0) {
        setError(student.data.response?.message || 'Network error. Check your connection.');
        return;
      }

      // The mobile app is student-only. An achiever still authenticates here --
      // the credentials are real -- so the probe is kept purely to tell them
      // where their portal actually is. Signing them in would drop them into an
      // app that has no verification, cohort management or earnings, which reads
      // as broken rather than as "not on mobile yet".
      const achiever = await achieverApi.post('/achiever/login', { email: mail, password: pw });
      if (achiever.data.bool) {
        setError(
          'This is an achiever account. The achiever portal is on the web — '
          + 'sign in at skovoai.com/skovo-achiever-portal.'
        );
        return;
      }

      // Neither matched. Say one thing — naming which portal the address does or
      // does not belong to would let anyone probe for registered emails.
      setError('Incorrect email or password.');
    } catch {
      setError('Could not sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: spacing(5), flexGrow: 1 }}
                    keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>

          <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <LinearGradient colors={gradients.student} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                            style={s.mark}>
              <Feather name="zap" size={26} color="#fff" />
            </LinearGradient>
            <ThemeTrigger />
          </View>

          <H1 style={{ marginTop: spacing(6) }}>Welcome back</H1>
          <Body muted style={{ marginTop: 6, marginBottom: spacing(7) }}>
            Sign in with the email you registered.
          </Body>

          {error ? (
            <View style={s.errBox}>
              <Feather name="alert-circle" size={15} color={colors.danger} />
              <Text style={s.errText}>{error}</Text>
            </View>
          ) : null}

          <Input
            label="Email"
            icon="mail"
            placeholder="you@email.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
          />

          <Input
            label="Password"
            icon="lock"
            placeholder="Your password"
            value={pw}
            onChangeText={setPw}
            secureTextEntry={!showPw}
            returnKeyType="go"
            onSubmitEditing={submit}
            right={(
              <TouchableOpacity onPress={() => setShowPw((v) => !v)} hitSlop={12}
                                accessibilityRole="button"
                                accessibilityLabel={showPw ? 'Hide password' : 'Show password'}>
                <Feather name={showPw ? 'eye-off' : 'eye'} size={18} color={colors.textSubtle} />
              </TouchableOpacity>
            )}
          />

          <Button title="Sign in" icon="log-in" loading={loading} onPress={submit} full size="lg"
                  style={{ marginTop: spacing(4) }} />

          <Text style={s.foot}>
            Students sign in here. The achiever portal is on the web at skovoai.com.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const makeStyles = (colors, shadow) => ({
  mark: { width: 56, height: 56, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center',
    ...shadow.floating },
  errBox: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: colors.dangerSoft,
    borderRadius: radius.md, padding: spacing(3.5), marginBottom: spacing(4) },
  errText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 20 },
  foot: { fontSize: font.sm, color: colors.textMuted, textAlign: 'center', marginTop: spacing(5),
    lineHeight: 20 },
});
