import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, Alert, ActivityIndicator } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, Avatar, Muted, SectionHeader, ThemePanel } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { CareerTimeline, DataRights } from '../../components/ProfileV1';

// Rows without a `route` were placeholders that did nothing when tapped; the
// ones that remain all go somewhere. Refer & Earn is v1-hidden, matching web.
const ROWS = [
  { icon: 'award', label: 'Skovo Pro', route: 'SkovoPro', highlight: true },
  { icon: 'book-open', label: 'Education & Goals', route: 'EducationGoals' },
  { icon: 'folder', label: 'Document Vault', route: 'DocumentVault' },
  { icon: 'trending-up', label: 'My Score', route: 'MyScore' },
  { icon: 'bell', label: 'Notifications', route: 'Notifications' },
  // v1-hidden: { icon: 'gift', label: 'Refer & Earn', route: 'Referrals' },
  { icon: 'help-circle', label: 'Help & support', route: 'HelpSupport' },
];

/** Manual skills — the same add/remove list web shows under the profile.
 *  Assessment-derived skills arrive here too; both come back in skills_detail. */
function Skills() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [skills, setSkills] = useState(null);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setFailed(false);
    studentApi.get('/profile/')
      .then(({ data }) => {
        if (data.bool) setSkills(data.response.skills_detail || []);
        else { setSkills([]); setFailed(true); }
      })
      // Swallowed before as setSkills([]), which rendered "No skills yet. Add
      // the ones you want achievers and employers to see." on a request that
      // never arrived -- telling a student their skills are gone and inviting
      // them to type them in again.
      .catch(() => { setSkills([]); setFailed(true); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const name = draft.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const { data } = await studentApi.post('/profile/skills', { skill_name: name });
      if (data.bool) { setDraft(''); load(); }
      // 409 = already have it; say so rather than failing silently.
      else Alert.alert('Could not add', data.response?.message || 'Please try again.');
    } catch { Alert.alert('Could not add', 'Please check your connection.'); }
    finally { setBusy(false); }
  };

  const remove = async (sk) => {
    // Optimistic — a failed delete restores the chip below.
    setSkills((prev) => prev.filter((x) => x.id !== sk.id));
    try {
      const { data } = await studentApi.delete(`/profile/skills/${sk.id}`);
      if (!data.bool) { load(); Alert.alert('Could not remove', data.response?.message || 'Please try again.'); }
    } catch { load(); }
  };

  return (
    <View style={{ marginTop: spacing(5) }}>
      <SectionHeader title="My Skills" />
      <View style={styles.skillBox}>
        {skills === null ? (
          <ActivityIndicator color={colors.primary} style={{ paddingVertical: spacing(3) }} />
        ) : failed ? (
          <TouchableOpacity onPress={load} style={{ paddingVertical: spacing(2) }}>
            <Muted style={{ marginBottom: 4 }}>We couldn't load your skills.</Muted>
            <Text style={{ color: colors.primary, fontWeight: font.semibold, fontSize: font.sm }}>Tap to retry</Text>
          </TouchableOpacity>
        ) : skills.length === 0 ? (
          <Muted style={{ marginBottom: spacing(3) }}>
            No skills yet. Add the ones you want achievers and employers to see.
          </Muted>
        ) : (
          <View style={styles.chipWrap}>
            {skills.map((sk) => (
              <View key={sk.id} style={styles.skillChip}>
                <Text style={styles.skillText}>{sk.skill_name}</Text>
                <TouchableOpacity onPress={() => remove(sk)} hitSlop={8}>
                  <Feather name="x" size={13} color={colors.primary} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}

        <View style={styles.addRow}>
          <TextInput
            style={styles.addInput}
            placeholder="Add a skill (e.g. Python)"
            placeholderTextColor={colors.textSubtle}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={add}
            returnKeyType="done"
            maxLength={100}
          />
          <TouchableOpacity onPress={add} disabled={!draft.trim() || busy}
                            style={[styles.addBtn, (!draft.trim() || busy) && { opacity: 0.45 }]}>
            <Feather name="plus" size={16} color={colors.onPrimary} />
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

export default function ProfileScreen() {
  const { colors, gradients } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const { user, logout } = useAuth();
  const navigation = useNavigation();
  return (
    <Screen scroll>
      <LinearGradient colors={gradients.student} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <Avatar name={user?.full_name} size={68} color="rgba(255,255,255,0.25)" />
        <Text style={styles.name}>{user?.full_name || 'Student'}</Text>
        <Text style={styles.email}>{user?.email || ''}</Text>
      </LinearGradient>

      <View style={styles.menu}>
        {ROWS.map((r, i) => (
          <TouchableOpacity
            key={r.label}
            activeOpacity={r.route ? 0.7 : 1}
            onPress={() => r.route && navigation.navigate(r.route)}
            style={[styles.row, i < ROWS.length - 1 && styles.rowBorder]}
          >
            <View style={[styles.rowIcon, r.highlight && { backgroundColor: colors.achieverSoft }]}>
              <Feather name={r.icon} size={17} color={r.highlight ? colors.achiever : colors.primary} />
            </View>
            <Text style={styles.rowLabel}>{r.label}</Text>
            {r.highlight && <View style={styles.proTag}><Text style={styles.proTagText}>PRO</Text></View>}
            <Feather name="chevron-right" size={20} color={colors.textSubtle} />
          </TouchableOpacity>
        ))}
      </View>

      <View style={{ marginTop: spacing(5) }}>
        <SectionHeader title="Appearance" subtitle="Light, dark, and the accent used on web" />
        <View style={styles.themeCard}>
          <ThemePanel />
        </View>
      </View>

      <Skills />

      <TouchableOpacity onPress={logout} style={styles.logout}>
        <Feather name="log-out" size={17} color={colors.danger} />
        <Text style={styles.logoutText}>Sign out</Text>
      </TouchableOpacity>

      <Muted style={{ textAlign: 'center', marginTop: spacing(4) }}>SKOVO · v1.0.0</Muted>
      <CareerTimeline />
      <DataRights />
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  hero: { alignItems: 'center', paddingVertical: spacing(7), borderRadius: radius.xl, marginBottom: spacing(5) },
  name: { color: '#fff', fontSize: font.xl, fontWeight: font.black, marginTop: 12 },
  email: { color: 'rgba(255,255,255,0.85)', fontSize: font.sm, marginTop: 2 },
  menu: { backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.card },
  themeCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', padding: spacing(4), minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  rowIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  rowLabel: { flex: 1, fontSize: font.base, fontWeight: font.semibold, color: colors.text },
  proTag: { backgroundColor: colors.achiever, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2, marginRight: 8 },
  proTagText: { color: '#fff', fontSize: font.xs, fontWeight: font.black, letterSpacing: 0.5 },
  logout: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.dangerSoft, borderRadius: radius.md, paddingVertical: 14, minHeight: 48, marginTop: spacing(5) },
  logoutText: { color: colors.danger, fontWeight: font.bold, fontSize: font.base },

  skillBox: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing(3) },
  skillChip: { flexDirection: 'row', alignItems: 'center', gap: 7, backgroundColor: colors.primarySoft,
    borderRadius: radius.pill, paddingLeft: 12, paddingRight: 9, paddingVertical: 7 },
  skillText: { fontSize: font.sm, fontWeight: font.semibold, color: colors.primary },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  addInput: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 11, fontSize: font.base, color: colors.text },
  addBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center' },
});
