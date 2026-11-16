// ── Landing (mobile) ─────────────────────────────────────────────────────────
// One screen: who we are, what we promise, a way in. Nothing else.
//
// The web landing sells to a stranger who found the site. Someone opening this
// app already installed it — they need a brand moment and a button, not a pitch.
// Headline is the web landing's own, so the two never tell different stories.
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Button, ThemeTrigger } from '../../components/ui';

export default function LandingScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <LinearGradient
      colors={gradients.student}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={{ flex: 1 }}
    >
      <SafeAreaView style={s.safe}>
        <View style={s.top}>
          <View style={s.brandRow}>
            <View style={s.mark}>
              <Feather name="zap" size={20} color="#fff" />
            </View>
            <Text style={s.brand}>SKOVO</Text>
          </View>
          <ThemeTrigger light />
        </View>

        <View style={s.middle}>
          <Text style={s.h1}>Your Career{'\n'}Starts Here.</Text>
          <Text style={s.sub}>
            Readiness, mentors, colleges and opportunities — in one place.
          </Text>
        </View>

        <View style={s.bottom}>
          <Button title="Get started" iconRight="arrow-right" full size="lg"
                  variant="inverse"
                  onPress={() => navigation.navigate('Login')} />
          <Text style={s.foot}>Sign in with your student account.</Text>
        </View>
      </SafeAreaView>
    </LinearGradient>
  );
}

const makeStyles = (colors, shadow) => ({
  safe: { flex: 1, paddingHorizontal: spacing(6), paddingVertical: spacing(4) },

  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing(2) },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  mark: {
    width: 38, height: 38, borderRadius: radius.sm,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  brand: { color: '#fff', fontSize: font.md, fontWeight: font.black, letterSpacing: font.widest },

  // The headline owns the screen: everything above and below is spacing.
  middle: { flex: 1, justifyContent: 'center' },
  h1: {
    color: '#fff', fontSize: 42, lineHeight: 46,
    fontWeight: font.black, letterSpacing: font.tightest,
  },
  sub: {
    color: 'rgba(255,255,255,0.9)', fontSize: font.md, lineHeight: 26,
    marginTop: spacing(4), maxWidth: 320,
  },

  bottom: { gap: spacing(3) },
  foot: {
    color: 'rgba(255,255,255,0.8)', fontSize: font.sm,
    textAlign: 'center', marginBottom: spacing(1),
  },
});
