import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { H2, Body, Muted, Pill, Button, Input, Loader, ErrorState, BackButton } from '../../components/ui';
import { studentApi } from '../../services/api';
import WalletToggle from '../../components/WalletToggle';
import { checkout } from '../../services/payments';
import { openLink } from '../../services/links';
import { useAuth } from '../../context/AuthContext';

export default function CohortDetailScreen({ route, navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { id } = route.params;
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [coupon, setCoupon] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);
  const [useWallet, setUseWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  // Free members get one paid cohort at no cost, once ever (Scope §4.2).
  const [perk, setPerk] = useState(null);

  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await studentApi.get(`/cohorts/${id}`);
      if (data.bool) { setC(data.response); setFailed(false); }
      else setFailed(true);
    } catch {
      // Unguarded before: setLoading(false) never ran and the screen span
      // on a blank cohort for good.
      setFailed(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  // This is the screen a student sits on waiting for a cohort to start, and
  // status is derived from the clock -- upcoming becomes live with nothing
  // pushed to the device. Without a way to ask again the Join button simply
  // never appears, and force-quitting the app is not a feature.
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  const loadPerk = useCallback(() => {
    studentApi.get('/cohorts/', { per_page: 1 })
      .then(({ data: d }) => { if (d.bool) setPerk(d.response.free_cohort || null); })
      .catch(() => {});
  }, []);
  useEffect(() => { loadPerk(); }, [loadPerk]);

  const isFree = !c?.price || Number(c.price) === 0;
  const enrolled = c?.is_enrolled && ['paid', 'free'].includes(c?.enrollment_status);

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponInfo(null);
    try {
      const { data } = await studentApi.post('/billing/coupons/validate', { code: coupon.trim(), amount: c.effective_price ?? c.price, context_type: 'cohort' });
      if (data.bool) setCouponInfo({ discount: data.response.discount, final: data.response.final_amount });
      else setCouponInfo({ error: data.response?.message || 'Invalid coupon.' });
    } catch {
      // A failed check used to leave the field looking inert, which reads as
      // "this code does nothing" rather than "we could not check it".
      setCouponInfo({ error: "Couldn't check that code. Try again." });
    }
  };

  // Spending it is a deliberate choice on a specific cohort, not something
  // that happens on whichever priced cohort was tapped first — so it is its
  // own button, and it confirms before committing.
  const useFreeCohort = () => Alert.alert(
    'Use your free cohort?',
    `This books '${c.title}' at no cost. You get one free cohort ever — after this, cohorts are ₹99–299 or unlimited with Skovo Pro.`,
    [
      { text: 'Not now', style: 'cancel' },
      { text: 'Use it', onPress: async () => {
          setBusy(true);
          try {
            const { data: d } = await studentApi.post(`/cohorts/${id}/enroll`, { use_free_cohort: true });
            if (d.bool) { Alert.alert('Booked', d.response?.message || 'Enrolled.'); load(); loadPerk(); }
            else Alert.alert('Could not enroll', d.response?.message || '');
          } catch { Alert.alert('Could not enroll', 'Please try again.'); }
          finally { setBusy(false); }
        } },
    ],
  );

  const enroll = async () => {
    setBusy(true);
    const body = coupon.trim() ? { coupon_code: coupon.trim() } : {};
    if (useWallet) body.use_wallet = true;
    const res = await checkout({
      client: studentApi, endpoint: `/cohorts/${id}/enroll`, body,
      name: 'SKOVO', description: c.title,
      prefill: { name: user?.full_name, email: user?.email },
    });
    setBusy(false);
    if (res.ok) { Alert.alert('Success', res.message || 'Enrolled!'); load(); }
    else Alert.alert('Could not enroll', res.message);
  };

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Loader /></SafeAreaView>;

  // A blank detail page reads as an empty cohort rather than a failed
  // request. Say which it is, and offer the way back.
  if (failed) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ErrorState title="We couldn't load this cohort"
                  subtitle="Nothing is lost — this is a connection problem."
                  onRetry={load} />
    </SafeAreaView>
  );
  if (!c) return null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.topTitle}>Cohort</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing(5), paddingBottom: spacing(8) }}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                  }>
        {c.domain?.name ? <Pill label={c.domain.name} tone="primary" style={{ marginBottom: 10 }} /> : null}
        <H2>{c.title}</H2>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill label={c.status} tone={c.status === 'live' ? 'warning' : c.status === 'completed' ? 'success' : 'primary'} />
          {c.achiever?.full_name ? <Muted>· {c.achiever.full_name}</Muted> : null}
        </View>

        <View style={styles.grid}>
          {/* NULL or 0 total_seats means uncapped, so there is no ceiling to
              count down from. Showing "0 left" on a cohort anyone can join is
              the one message guaranteed to stop them joining. */}
          <Info icon="users" label={c.total_seats > 0 ? 'Seats' : 'Enrolled'}
                value={c.total_seats > 0
                  ? `${c.available_seats != null
                      ? c.available_seats
                      : Math.max(0, c.total_seats - (c.filled_seats || 0))} left`
                  : `${c.filled_seats || 0}`} />
          <Info icon="clock" label="Duration" value={`${c.duration_minutes || 90} min`} />
          <Info icon="dollar-sign" label="Price" value={isFree ? 'Free'
            : c.effective_price != null && c.effective_price < c.price
              ? `₹${Number(c.effective_price).toLocaleString()} (was ₹${Number(c.price).toLocaleString()})`
              : `₹${Number(c.price).toLocaleString()}`} />
        </View>

        {c.about ? (<><Text style={styles.h3}>About</Text><Body muted style={{ marginTop: 6 }}>{c.about}</Body></>) : null}

        {Array.isArray(c.what_you_learn) && c.what_you_learn.length > 0 ? (
          <>
            <Text style={styles.h3}>What you'll learn</Text>
            {c.what_you_learn.map((w, i) => (
              <View key={i} style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <Feather name="check-circle" size={16} color={colors.success} />
                <Body style={{ flex: 1 }}>{w}</Body>
              </View>
            ))}
          </>
        ) : null}
      </ScrollView>

      {/* sticky footer */}
      <View style={styles.footer}>
        {enrolled ? (
          c.can_join && c.meeting_link ? (
            <Button title={c.is_live ? 'Join Live Session' : 'Join Session'} icon="video" accent={colors.success} onPress={() => openLink(c.meeting_link)} />
          ) : (
            <View style={styles.enrolledBox}><Feather name="check-circle" size={16} color={colors.success} /><Text style={styles.enrolledText}>You're enrolled — join opens ~15 min before</Text></View>
          )
        ) : c.status !== 'upcoming' ? (
          <View style={styles.enrolledBox}><Muted>Enrollment is closed for this cohort.</Muted></View>
        ) : (
          <>
            {!isFree && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                <View style={{ flex: 1 }}><Input icon="tag" placeholder="Coupon code" autoCapitalize="characters" value={coupon} onChangeText={setCoupon} style={{ marginBottom: 0 }} /></View>
                <Button title="Apply" variant="outline" onPress={applyCoupon} style={{ marginBottom: spacing(3) }} />
              </View>
            )}
            {couponInfo?.discount != null ? <Text style={styles.couponOk}>−₹{couponInfo.discount} · you pay ₹{couponInfo.final}</Text> : null}
            {couponInfo?.error ? <Text style={styles.couponErr}>{couponInfo.error}</Text> : null}
            <WalletToggle kind="cohort" value={useWallet} onChange={setUseWallet} />

            {/* Offered above the pay button, not below it — a student should
                see the free option before deciding to pay for this one. */}
            {!isFree && perk?.available && (
              <>
                <Button title="Use my free cohort" icon="gift" variant="outline"
                        loading={busy} disabled={busy} onPress={useFreeCohort}
                        style={{ marginBottom: spacing(2) }} />
                <Text style={styles.perkNote}>Your one free cohort — yours to spend once.</Text>
              </>
            )}
            <Button
              title={isFree ? 'Enroll for Free' : `Pay & Enroll · ₹${(couponInfo?.final ?? c.effective_price ?? c.price).toLocaleString()}`}
              icon={isFree ? 'check' : 'credit-card'} loading={busy} onPress={enroll}
            />
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

function Info({ icon, label, value }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <View style={styles.info}>
      <Feather name={icon} size={16} color={colors.primary} />
      <Text style={styles.infoVal}>{value}</Text>
      <Muted style={{ fontSize: font.xs }}>{label}</Muted>
    </View>
  );
}

const makeStyles = (colors, shadow) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), paddingVertical: spacing(3) },
  topTitle: { fontSize: font.md, fontWeight: font.bold, color: colors.text },
  grid: { flexDirection: 'row', gap: spacing(3), marginTop: spacing(5) },
  info: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3.5), alignItems: 'flex-start', ...shadow.soft },
  infoVal: { fontSize: font.md, fontWeight: font.black, color: colors.text, marginTop: 8 },
  h3: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, marginTop: spacing(6) },
  footer: { padding: spacing(5), borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  enrolledBox: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12 },
  enrolledText: { color: colors.success, fontWeight: font.semibold, fontSize: font.sm },
  perkNote: { fontSize: font.xs, color: colors.textSubtle, textAlign: 'center', marginBottom: spacing(2) },
  couponOk: { color: colors.success, fontSize: font.sm, marginBottom: 8 },
  couponErr: { color: colors.danger, fontSize: font.sm, marginBottom: 8 },
});
