import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { H2, Body, Muted, Pill, Button, Input, Loader, ErrorState, BackButton } from '../../components/ui';
import { studentApi } from '../../services/api';
import { checkout } from '../../services/payments';
import { openLink } from '../../services/links';
import { useAuth } from '../../context/AuthContext';

const MODULE_ICON = { video: 'play-circle', text: 'file-text', live_session: 'radio', resource: 'link' };

export default function CourseDetailScreen({ route, navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { id } = route.params;
  const { user } = useAuth();
  const [c, setC] = useState(null);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [coupon, setCoupon] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const detail = await studentApi.get(`/courses/${id}`);
      if (detail.data.bool) { setC(detail.data.response); setFailed(false); }
      else setFailed(true);
      // Modules are secondary: the course still reads without them.
      const mods = await studentApi.get(`/courses/${id}/modules`).catch(() => null);
      if (mods?.data?.bool) setModules(mods.data.response.modules || []);
    } catch {
      setFailed(true);
    } finally { setLoading(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const isFree = !c?.price || Number(c.price) === 0;
  const enrolled = c?.is_enrolled;

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponInfo(null);
    try {
      const { data } = await studentApi.post('/billing/coupons/validate', { code: coupon.trim(), amount: c.effective_price ?? c.price, context_type: 'course' });
      if (data.bool) setCouponInfo({ discount: data.response.discount, final: data.response.final_amount });
      else setCouponInfo({ error: data.response?.message || 'Invalid coupon.' });
    } catch {
      setCouponInfo({ error: "Couldn't check that code. Try again." });
    }
  };

  const enroll = async () => {
    setBusy(true);
    const body = coupon.trim() ? { coupon_code: coupon.trim() } : {};
    const res = await checkout({
      client: studentApi, endpoint: `/courses/${id}/enroll`, body,
      name: 'SKOVO', description: c.title, prefill: { name: user?.full_name, email: user?.email },
    });
    setBusy(false);
    if (res.ok) { Alert.alert('Success', res.message || 'Enrolled!'); load(); }
    else Alert.alert('Could not enroll', res.message);
  };

  const openModule = (m) => {
    const accessible = m.is_free_preview || enrolled;
    if (!accessible) { Alert.alert('Locked', 'Enroll to access this module.'); return; }
    if (m.content_type === 'live_session' && m.can_join === false) {
      Alert.alert('Not open yet', 'This live session unlocks ~15 minutes before it starts.'); return;
    }
    const url = m.video_url || m.live_session_url || (m.content_type === 'resource' ? m.content_text : null);
    if (m.content_type === 'text' && m.content_text) Alert.alert(m.title, m.content_text);
    else if (url) openLink(url);
  };

  if (loading) return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}><Loader /></SafeAreaView>;

  // A blank detail page reads as an empty course rather than a failed
  // request. Say which it is, and offer the way back.
  if (failed) return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }}>
      <ErrorState title="We couldn't load this course"
                  subtitle="Nothing is lost — this is a connection problem."
                  onRetry={load} />
    </SafeAreaView>
  );
  if (!c) return null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.topTitle}>Course</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing(5), paddingBottom: spacing(8) }} showsVerticalScrollIndicator={false}>
        <H2>{c.title}</H2>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.level ? <Pill label={c.level} tone="info" /> : null}
          {c.duration_weeks ? <Muted>· {c.duration_weeks} weeks</Muted> : null}
          {c.achiever?.full_name ? <Muted>· {c.achiever.full_name}</Muted> : null}
        </View>
        {c.description ? <Body muted style={{ marginTop: 14 }}>{c.description}</Body> : null}

        <Text style={styles.h3}>Content</Text>
        {modules.length === 0 ? <Muted>No modules yet.</Muted> : modules.map(m => {
          const accessible = m.is_free_preview || enrolled;
          return (
            <TouchableOpacity key={m.id} onPress={() => openModule(m)} style={[styles.mod, !accessible && { opacity: 0.6 }]}>
              <View style={[styles.modIcon, { backgroundColor: m.content_type === 'live_session' ? colors.dangerSoft : colors.primarySoft }]}>
                <Feather name={MODULE_ICON[m.content_type] || 'play-circle'} size={16} color={m.content_type === 'live_session' ? colors.danger : colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modTitle} numberOfLines={1}>{m.title}</Text>
                <Muted style={{ fontSize: font.xs }}>{(m.content_type || '').replace('_', ' ')}{m.is_live ? ' · LIVE NOW' : ''}</Muted>
              </View>
              <Feather name={accessible ? 'chevron-right' : 'lock'} size={18} color={colors.textSubtle} />
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      <View style={styles.footer}>
        {enrolled ? (
          <View style={styles.enrolledBox}><Feather name="check-circle" size={16} color={colors.success} /><Text style={styles.enrolledText}>You're enrolled · learn at your pace</Text></View>
        ) : (
          <>
            {!isFree && (
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                <View style={{ flex: 1 }}><Input icon="tag" placeholder="Coupon code" autoCapitalize="characters" value={coupon} onChangeText={setCoupon} style={{ marginBottom: 0 }} /></View>
                <Button title="Apply" variant="outline" onPress={applyCoupon} style={{ marginBottom: spacing(3) }} />
              </View>
            )}
            {couponInfo?.discount != null ? <Text style={{ color: colors.success, fontSize: font.sm, marginBottom: 8 }}>−₹{couponInfo.discount} · you pay ₹{couponInfo.final}</Text> : null}
            {couponInfo?.error ? <Text style={{ color: colors.danger, fontSize: font.sm, marginBottom: 8 }}>{couponInfo.error}</Text> : null}
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

const makeStyles = (colors, shadow) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), paddingVertical: spacing(3) },
  topTitle: { fontSize: font.md, fontWeight: font.bold, color: colors.text },
  h3: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, marginTop: spacing(6), marginBottom: spacing(2) },
  mod: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3.5), marginBottom: spacing(2.5), ...shadow.soft },
  modIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  modTitle: { fontSize: font.base, fontWeight: font.semibold, color: colors.text },
  footer: { padding: spacing(5), borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  enrolledBox: { flexDirection: 'row', alignItems: 'center', gap: 8, justifyContent: 'center', paddingVertical: 12 },
  enrolledText: { color: colors.success, fontWeight: font.semibold, fontSize: font.sm },
});
