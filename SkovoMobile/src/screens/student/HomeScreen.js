// ── Home (student) ───────────────────────────────────────────────────────────
// The landing surface. Its whole job is to answer "where am I, and what do I do
// next" — so the Readiness Score and the distance to the Opportunities gate are
// the hero, not a decorative number.
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, StyleSheet, Animated, Easing } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font, tint, motion } from '../../theme';
import { Card, Stat, SectionHeader, Muted, Skeleton, FadeIn, Pill, ErrorState, ThemeTrigger } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import TodayCard from '../../components/TodayCard';

// Only v1 destinations, and only routes that exist. "Courses" used to sit here
// pointing at a tab that was never registered — the tap did nothing.
const QUICK = [
  { icon: 'calendar',  label: 'Cohorts',      to: ['tab', 'Cohorts'],       tone: 'primary' },
  { icon: 'users',     label: 'Achievers',    to: ['tab', 'Mentors'],       tone: 'achiever' },
  { icon: 'briefcase', label: 'Opportunities', to: ['screen', 'Opportunities'], tone: 'info' },
  { icon: 'target',    label: 'Predictor',    to: ['screen', 'CollegePredictor'], tone: 'success' },
];

/** Score dial. A number alone says how you are doing; an arc says how far is left. */
function ScoreDial({ score, target }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const pct = Math.max(0, Math.min(1, score / 100));
  const grow = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(grow, {
      toValue: pct, duration: 900, easing: Easing.bezier(0.16, 1, 0.3, 1), useNativeDriver: false,
    }).start();
  }, [grow, pct]);

  return (
    <View style={s.track}>
      <Animated.View style={[s.fill, {
        width: grow.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
      }]} />
      {/* The gate marker sits at 60 so the goal is visible on the bar itself. */}
      {target > 0 && target < 100 && <View style={[s.marker, { left: `${target}%` }]} />}
    </View>
  );
}

export default function HomeScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { user } = useAuth();
  const [dash, setDash] = useState(null);
  // Assume Pro until we know, so the upgrade banner never flashes for a paying
  // member on a slow connection — same default web uses.
  const [isPro, setIsPro] = useState(true);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [d, sub] = await Promise.all([
        studentApi.get('/dashboard/'),
        studentApi.get('/subscription/'),
      ]);
      if (d.data.bool) setDash(d.data.response);
      if (sub.data.bool) setIsPro(!!sub.data.response.is_pro);
      setFailed(!d.data.bool);
    } catch {
      // Swallowed before: the home screen rendered a blank dashboard, which
      // looks like an account with nothing in it rather than a failed request.
      setFailed(true);
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  // These come from `readiness`, not the top level. Reading them off the root
  // is why every tile on this screen used to show zero.
  const r = dash?.readiness || {};
  const score = r.score ?? 0;
  const unlocked = !!r.opportunity_hub_unlocked;
  const away = r.points_needed_for_hub ?? 0;

  const go = ([kind, name]) =>
    kind === 'tab' ? navigation.navigate(name) : navigation.navigate(name);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: spacing(12) }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />}
      >
        {/* The dashboard is many independent sections, so a whole-screen error
            would hide the parts that did load. A banner says the numbers below
            are stale without pretending they are current. */}
        {failed && !loading ? (
          <TouchableOpacity onPress={onRefresh} activeOpacity={0.8} style={s.staleBanner}>
            <Feather name="alert-triangle" size={15} color={colors.danger} />
            <Text style={s.staleText}>
              Couldn't refresh your dashboard. Tap to try again.
            </Text>
          </TouchableOpacity>
        ) : null}

        {/* ── Hero ── */}
        <LinearGradient colors={gradients.student} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={s.hero}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={s.hi} numberOfLines={1}>
                Hi {user?.full_name?.split(' ')[0] || 'there'} 👋
              </Text>
              <Text style={s.subhi}>Let's grow your career today</Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <ThemeTrigger light />
              <TouchableOpacity
                style={s.bell}
                onPress={() => navigation.navigate('Notifications')}
                accessibilityRole="button"
                accessibilityLabel="Notifications"
              >
                <Feather name="bell" size={19} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>

          <TouchableOpacity activeOpacity={0.9} style={s.readiness}
                            onPress={() => navigation.navigate('MyScore')}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}>
                <Text style={s.rLabel}>Readiness Score</Text>
                {loading
                  ? <Skeleton width={110} height={38} style={{ marginTop: 6, backgroundColor: 'rgba(255,255,255,0.25)' }} />
                  : <Text style={s.rScore}>{score}<Text style={s.rOf}>/100</Text></Text>}
              </View>
              {!loading && !!r.level && (
                <View style={s.levelTag}><Text style={s.levelTxt}>{r.level}</Text></View>
              )}
            </View>

            {!loading && (
              <>
                <ScoreDial score={score} target={score + away} />
                <Text style={s.rHint}>
                  {unlocked
                    ? '🎉 Opportunities Hub is unlocked — go apply.'
                    : `${away} more ${away === 1 ? 'point' : 'points'} to unlock the Opportunities Hub`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </LinearGradient>

        <View style={{ padding: spacing(5) }}>
          <TodayCard navigation={navigation} refreshKey={refreshing} />
          {/* ── Pro upsell — same banner web shows a free member ── */}
          {!isPro && (
            <TouchableOpacity activeOpacity={0.85} onPress={() => navigation.navigate('SkovoPro')}>
              <LinearGradient colors={gradients.achiever} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
                              style={s.proBanner}>
                <View style={s.proIcon}>
                  <Feather name="award" size={20} color="#FDE047" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={s.proTitle}>Get Skovo Pro — unlock everything</Text>
                  <Text style={s.proSub}>
                    All cohorts + courses free, free 1-on-1 sessions, AI tools & more.
                  </Text>
                </View>
                <Feather name="chevron-right" size={18} color="rgba(255,255,255,0.9)" />
              </LinearGradient>
            </TouchableOpacity>
          )}

          {/* ── Quick actions ── */}
          <View style={s.quickRow}>
            {QUICK.map((q, i) => (
              <FadeIn key={q.label} index={i} style={s.quickCell}>
                <TouchableOpacity activeOpacity={0.8} style={s.quick} onPress={() => go(q.to)}>
                  <View style={[s.quickIcon, { backgroundColor: tint(colors[q.tone], 0.12) }]}>
                    <Feather name={q.icon} size={20} color={colors[q.tone]} />
                  </View>
                  <Text style={s.quickLabel} numberOfLines={1}>{q.label}</Text>
                </TouchableOpacity>
              </FadeIn>
            ))}
          </View>

          {/* ── Activity ── */}
          <SectionHeader title="Your activity" subtitle="What the score is built on" />
          {loading ? (
            <View style={{ flexDirection: 'row', gap: spacing(3) }}>
              {[0, 1, 2].map((i) => <Skeleton key={i} height={104} radius={radius.lg} style={{ flex: 1 }} />)}
            </View>
          ) : (
            <View style={{ flexDirection: 'row', gap: spacing(3) }}>
              <Stat index={0} icon="calendar"     value={r.cohorts_completed ?? 0} label="Cohorts done" tone="primary" />
              <Stat index={1} icon="check-square" value={r.tasks_completed ?? 0}   label="Tasks done"   tone="success" />
              <Stat index={2} icon="trending-up"  value={score}                    label="Score"        tone="achiever" />
            </View>
          )}

          {/* ── Upcoming cohorts ── */}
          {(loading || dash?.upcoming_cohorts?.length > 0) && (
            <>
              <SectionHeader title="Happening soon" action="See all"
                             onAction={() => navigation.navigate('Cohorts')} />
              {loading ? <Skeleton height={92} radius={radius.lg} /> : (
                dash.upcoming_cohorts.slice(0, 3).map((c, i) => (
                  <Card key={c.id} index={i} style={{ marginBottom: spacing(2.5) }}
                        onPress={() => navigation.navigate('CohortDetail', { id: c.id })}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
                      <View style={s.cohortIcon}>
                        <Feather name="video" size={17} color={colors.primary} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={s.cohortTitle} numberOfLines={1}>{c.title}</Text>
                        <Muted style={{ fontSize: font.xs, marginTop: 2 }} numberOfLines={1}>
                          {c.achiever?.full_name || 'Skovo'}
                          {c.achiever?.company ? ` · ${c.achiever.company}` : ''}
                        </Muted>
                      </View>
                      {c.price === 0
                        ? <Pill label="Free" tone="success" />
                        : <Pill label={`₹${c.price}`} tone="primary" />}
                    </View>
                  </Card>
                ))
              )}
            </>
          )}

          {/* ── Nudge ── */}
          <Card index={3} style={{ marginTop: spacing(3), flexDirection: 'row', alignItems: 'center', gap: 14 }}
                onPress={() => navigation.navigate('Mentors')}>
            <View style={s.nudgeIcon}>
              <Feather name="zap" size={19} color={colors.achiever} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.nudgeTitle}>Book a 1-on-1</Text>
              <Muted style={{ marginTop: 2 }}>
                Personalised guidance from an achiever.
              </Muted>
            </View>
            <Feather name="chevron-right" size={20} color={colors.textSubtle} />
          </Card>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (colors, shadow) => ({
  staleBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing(2),
    backgroundColor: colors.dangerSoft, borderRadius: radius.md,
    paddingVertical: spacing(3), paddingHorizontal: spacing(4),
    marginHorizontal: spacing(5), marginTop: spacing(4) },
  staleText: { flex: 1, fontSize: font.sm, color: colors.danger, fontWeight: font.semibold },
  hero: { paddingTop: spacing(4), paddingBottom: spacing(9), paddingHorizontal: spacing(5),
    borderBottomLeftRadius: radius.xl, borderBottomRightRadius: radius.xl },
  hi: { color: '#fff', fontSize: font.xxl, fontWeight: font.black, letterSpacing: font.tightest },
  subhi: { color: 'rgba(255,255,255,0.9)', fontSize: font.sm, marginTop: 4 },
  bell: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center' },

  readiness: { backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: radius.lg,
    padding: spacing(4), marginTop: spacing(5) },
  rLabel: { color: 'rgba(255,255,255,0.85)', fontSize: font.sm, fontWeight: font.semibold },
  rScore: { color: '#fff', fontSize: font.huge, fontWeight: font.black, marginTop: 2, letterSpacing: font.tightest },
  rOf: { fontSize: font.md, fontWeight: font.semibold, color: 'rgba(255,255,255,0.7)' },
  rHint: { color: 'rgba(255,255,255,0.92)', fontSize: font.sm, fontWeight: font.semibold, marginTop: 10 },
  levelTag: { backgroundColor: 'rgba(255,255,255,0.22)', borderRadius: radius.pill,
    paddingHorizontal: 10, paddingVertical: 4 },
  levelTxt: { color: '#fff', fontSize: font.xs, fontWeight: font.black, letterSpacing: font.wide },

  track: { height: 7, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.25)',
    marginTop: spacing(3), overflow: 'hidden', flexDirection: 'row', alignItems: 'center' },
  fill: { height: 7, borderRadius: radius.pill, backgroundColor: '#fff' },
  marker: { position: 'absolute', width: 2, height: 11, backgroundColor: 'rgba(255,255,255,0.9)' },

  proBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing(3),
    borderRadius: radius.lg, padding: spacing(4), marginBottom: spacing(4), ...shadow.lifted },
  proIcon: { width: 42, height: 42, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center', justifyContent: 'center' },
  proTitle: { color: '#fff', fontSize: font.base, fontWeight: font.bold },
  proSub: { color: 'rgba(255,255,255,0.9)', fontSize: font.sm, marginTop: 3, lineHeight: 20 },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    marginTop: -spacing(8), marginBottom: spacing(4), rowGap: spacing(3) },
  quickCell: { width: '48%' },
  quick: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing(4), minHeight: 88, ...shadow.card },
  quickIcon: { width: 44, height: 44, borderRadius: radius.sm, alignItems: 'center',
    justifyContent: 'center', marginBottom: 8 },
  quickLabel: { fontSize: font.sm, fontWeight: font.bold, color: colors.text },

  cohortIcon: { width: 40, height: 40, borderRadius: radius.sm, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center' },
  cohortTitle: { fontSize: font.base, fontWeight: font.bold, color: colors.text },

  nudgeIcon: { width: 44, height: 44, borderRadius: radius.sm, backgroundColor: colors.achieverSoft,
    alignItems: 'center', justifyContent: 'center' },
  nudgeTitle: { fontWeight: font.bold, color: colors.text, fontSize: font.base },
});
