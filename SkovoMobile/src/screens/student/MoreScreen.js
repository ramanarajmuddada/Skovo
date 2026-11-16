// ── More — feature hub (student) ─────────────────────────────────────────────
// Central menu for everything outside the main tabs. Items with a `route` are
// live; `soon: true` items are being built batch-by-batch to match the web app.
import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted } from '../../components/ui';
import { API_BASE_URL } from '../../services/api';
import { openLink } from '../../services/links';

// Kept in step with the web sidebar (components/layout/MainLayout.jsx). Items
// commented `v1-hidden` are out of v1 scope — Courses and the coaching
// directory are v1.5, Referrals is in neither spec document (Leaderboard is
// Version 1 per feature-updates.md §4),
// and Assessment is hidden on web too. The screens still exist; only the way
// in is closed, so re-opening one is a single line.
// The website is served from the API's host (the API lives under /v1).
const WEB_URL = process.env.EXPO_PUBLIC_WEB_URL || API_BASE_URL.replace(/\/v1\/?$/, '');

const SECTIONS = [
  {
    title: 'Discover',
    items: [
      { icon: 'home', label: 'Colleges', route: 'Colleges' },
      { icon: 'bookmark', label: 'Saved Colleges', route: 'SavedColleges' },
      { icon: 'target', label: 'College Predictor', route: 'CollegePredictor' },
      { icon: 'briefcase', label: 'Opportunities', route: 'Opportunities' },
      { icon: 'shopping-bag', label: 'Market', route: 'Market' },
      // v1-hidden: { icon: 'book-open', label: 'Courses', route: 'Courses' },
    ],
  },
  {
    title: 'Progress',
    items: [
      { icon: 'trending-up', label: 'My Score', route: 'MyScore' },
      // Reached from Profile, exactly as web nests it there — listing it here too
      // made mobile show a screen web does not have.
      // { icon: 'book-open', label: 'Education & Goals', route: 'EducationGoals' },
      { icon: 'check-square', label: 'My Tasks', route: 'Tasks' },
      { icon: 'target', label: 'Practice', route: 'Practice' },
      { icon: 'zap', label: 'Streak', route: 'Streak' },
      { icon: 'award', label: 'Leaderboard', route: 'Leaderboard' },
      { icon: 'send', label: 'Applications', route: 'Applications' },
      // v1-hidden: { icon: 'zap', label: 'Assessment', route: 'Assessment' },
    ],
  },
  {
    title: 'Career Tools',
    items: [
      { icon: 'folder', label: 'Document Vault', route: 'DocumentVault' },
    ],
  },
  {
    title: 'Community',
    items: [
      { icon: 'users', label: 'Assemble', route: 'Assemble' },
      // Reached from Assemble (tap a member to DM), exactly as web nests DMs there.
      // { icon: 'mail', label: 'Messages', route: 'Messages' },
    ],
  },
  {
    title: 'Assistant',
    items: [
      // v2 module (Scope §3.2, Playbook §4.1). The screen explains that, so the
      // row leads somewhere rather than being a dead entry.
      { icon: 'zap', label: 'BhaAI', route: 'BhaAI', soon: true },
    ],
  },
  {
    title: 'Account',
    items: [
      { icon: 'user', label: 'My Profile', route: 'Profile' },
      { icon: 'bell', label: 'Notifications', route: 'Notifications' },
      { icon: 'award', label: 'Skovo Pro', route: 'SkovoPro', accent: true },
      { icon: 'credit-card', label: 'Wallet & refunds', route: 'Wallet' },
      // v1-hidden: { icon: 'gift', label: 'Refer & Earn', route: 'Referrals' },
      { icon: 'help-circle', label: 'Help & support', route: 'HelpSupport' },
    ],
  },
  {
    // Same pages as the website (feature-updates.md §16 item 15).
    title: 'Legal',
    items: [
      { icon: 'file-text', label: 'Terms of use', url: `${WEB_URL}/terms` },
      { icon: 'rotate-ccw', label: 'Refund & cancellation policy', url: `${WEB_URL}/refund` },
      { icon: 'shield', label: 'Privacy policy', url: `${WEB_URL}/privacy` },
    ],
  },
];

export default function MoreScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  return (
    <Screen scroll>
      <H1 style={{ marginBottom: spacing(1) }}>Explore</H1>
      <Muted style={{ marginBottom: spacing(5) }}>Everything SKOVO offers, in one place</Muted>

      {SECTIONS.map((sec) => (
        <View key={sec.title} style={{ marginBottom: spacing(5) }}>
          <Text style={styles.secTitle}>{sec.title}</Text>
          <View style={styles.card}>
            {sec.items.map((it, i) => (
              // `soon` is a badge, not a lock. A row with a route always opens
              // — BhaAI's screen exists to explain why it is not here yet, and
              // a tap that does nothing explains nothing.
              <TouchableOpacity
                key={it.label}
                activeOpacity={it.route || it.url ? 0.7 : 1}
                onPress={() => (it.url ? openLink(it.url) : it.route && navigation.navigate(it.route))}
                style={[styles.row, i < sec.items.length - 1 && styles.rowBorder]}
              >
                <View style={[styles.icon, it.accent && { backgroundColor: colors.achieverSoft }]}>
                  <Feather name={it.icon} size={16} color={it.accent ? colors.achiever : colors.primary} />
                </View>
                <Text style={[styles.label, it.soon && { color: colors.textSubtle }]}>{it.label}</Text>
                {it.soon
                  ? <View style={styles.soon}><Text style={styles.soonTxt}>SOON</Text></View>
                  : <Feather name="chevron-right" size={18} color={colors.textSubtle} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      ))}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  secTitle: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: spacing(2), marginLeft: 4 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, ...shadow.card },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing(3.5), paddingHorizontal: spacing(3.5), minHeight: 56 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  label: { flex: 1, fontSize: font.base, fontWeight: font.semibold, color: colors.text },
  soon: { backgroundColor: colors.surfaceAlt, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  soonTxt: { fontSize: font.xs, fontWeight: font.black, color: colors.textMuted, letterSpacing: 0.5 },
});
