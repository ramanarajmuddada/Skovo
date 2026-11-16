// ── BhaAI (student) ──────────────────────────────────────────────────────────
// The assistant, deferred to v2 (Scope §3.2, Playbook §4.1). This screen exists
// so the menu row leads somewhere: it sets the expectation, explains the reason
// for the wait in the Playbook's own terms, and sends the student back to
// something that works. Mirrors the web page at /bhaai.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Button } from '../../components/ui';

const COMING = [
  { icon: 'message-square', title: 'Ask anything about your path',
    body: 'Which stream fits my marks? Is this college worth the fee? Answers grounded in your own profile and score.' },
  { icon: 'target', title: 'Weekly plans that adapt',
    body: 'Tasks that change based on where your Readiness Score is stalling — not a generic checklist.' },
  { icon: 'file-text', title: 'Resume built from your Vault',
    body: 'Turns the documents and achievements you already store into a resume worth sending.' },
  { icon: 'mic', title: 'Mock interviews',
    body: 'Practise for the roles in your Opportunities shortlist, with feedback you can act on.' },
  { icon: 'globe', title: 'Telugu, Hindi and Tamil',
    body: 'The whole app in the language you think in, not just the language you were taught in.' },
];

export default function BhaAIScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  return (
    <Screen scroll>
      <H1>BhaAI</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Your career assistant — in the works</Muted>

      <Card>
        <View style={s.badge}>
          <Feather name="zap" size={11} color={colors.primaryDark} />
          <Text style={s.badgeTxt}>COMING SOON</Text>
        </View>

        <Text style={s.lead}>
          We're building BhaAI on your actual progress — not on guesswork.
        </Text>
        <Muted style={s.para}>
          An assistant that hasn't seen how you study, what you've applied to, or where your score
          keeps stalling can only give advice you could have found anywhere. So BhaAI arrives once
          Skovo knows enough about your journey to say something only Skovo could say.
        </Muted>
        <Muted style={s.para}>
          Nothing to do in the meantime — keep using the app. Every cohort you attend, document you
          add and community you join is what BhaAI will reason over on day one.
        </Muted>

        <View style={{ flexDirection: 'row', gap: spacing(2), marginTop: spacing(4) }}>
          <Button title="My score" icon="trending-up" style={{ flex: 1 }}
                  onPress={() => navigation.navigate('MyScore')} />
          <Button title="Cohorts" variant="outline" style={{ flex: 1 }}
                  onPress={() => navigation.navigate('Tabs', { screen: 'Cohorts' })} />
        </View>
      </Card>

      <Text style={s.secTitle}>WHAT IT WILL DO</Text>
      {COMING.map(({ icon, title, body }) => (
        <Card key={title} style={{ marginBottom: spacing(2.5) }}>
          <View style={s.iconWrap}>
            <Feather name={icon} size={16} color={colors.primary} />
          </View>
          <Text style={s.cardTitle}>{title}</Text>
          <Muted style={{ marginTop: spacing(1), lineHeight: 19 }}>{body}</Muted>
        </Card>
      ))}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  badge: { flexDirection: 'row', alignItems: 'center', gap: 5, alignSelf: 'flex-start',
    backgroundColor: colors.primarySoft, paddingHorizontal: 9, paddingVertical: 4,
    borderRadius: radius.sm, marginBottom: spacing(3) },
  badgeTxt: { fontSize: font.xs, fontWeight: font.bold, color: colors.primaryDark, letterSpacing: 0.7 },
  lead: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, lineHeight: 26 },
  para: { marginTop: spacing(3), lineHeight: 20 },
  secTitle: { fontSize: font.xs, fontWeight: font.bold, color: colors.textSubtle,
    letterSpacing: 0.6, marginTop: spacing(5), marginBottom: spacing(2), marginLeft: 4 },
  iconWrap: { width: 36, height: 36, borderRadius: 11, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing(2) },
  cardTitle: { fontSize: font.sm, fontWeight: font.bold, color: colors.text },
});
