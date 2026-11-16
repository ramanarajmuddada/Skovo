import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, Alert, RefreshControl } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { H2, Body, Muted, Pill, Avatar, Button, Input, Loader, Empty, ErrorState, BackButton } from '../../components/ui';
import { studentApi } from '../../services/api';
import WalletToggle from '../../components/WalletToggle';
import { checkout } from '../../services/payments';
import { useAuth } from '../../context/AuthContext';

export default function MentorBookingScreen({ route, navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { mentor } = route.params;
  const { user } = useAuth();
  const rate = Number(mentor.session_rate || 0);
  const mentorId = mentor.mentor_id || mentor.id;

  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState(null);
  const [note, setNote] = useState('');
  const [coupon, setCoupon] = useState('');
  const [couponInfo, setCouponInfo] = useState(null);
  const [useWallet, setUseWallet] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await studentApi.get(`/achiever-availability/${mentorId}/slots`);
      if (data.bool) { setSlots(data.response.slots || []); setFailed(false); }
      else setFailed(true);
    } catch {
      // An empty slot list reads as "this achiever has no time free", which
      // would send the student away for the wrong reason.
      setFailed(true);
    } finally { setLoading(false); setRefreshing(false); }
  }, [mentorId]);

  // Slots are the one thing on this screen that another person can take while
  // the student is looking at it -- another booking, or the achiever editing
  // their availability. "No open slots" is exactly the moment someone wants to
  // check again, and leaving and re-entering the screen is not an answer.
  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);
  useEffect(() => { load(); }, [load]);

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponInfo(null);
    try {
      const { data } = await studentApi.post('/billing/coupons/validate', {
        code: coupon.trim(), amount: rate, context_type: 'session', context_id: mentorId,
      });
      if (data.bool) setCouponInfo({ discount: data.response.discount, final: data.response.final_amount });
      else setCouponInfo({ error: data.response?.message || 'Invalid coupon.' });
    } catch {
      setCouponInfo({ error: "Couldn't check that code. Try again." });
    }
  };

  const book = async () => {
    if (!picked) { Alert.alert('Pick a slot', 'Please choose a time slot first.'); return; }
    setBusy(true);
    const body = { slot_id: picked, note };
    if (rate > 0 && coupon.trim()) body.coupon_code = coupon.trim();
    if (rate > 0 && useWallet) body.use_wallet = true;
    const res = await checkout({
      client: studentApi, endpoint: `/achievers/${mentorId}/book`, body,
      name: 'SKOVO', description: `1-on-1 with ${mentor.full_name}`,
      prefill: { name: user?.full_name, email: user?.email },
      // Step 1 holds the slot. If the student dismisses the payment sheet, free
      // it again — otherwise the slot stays locked behind an unpaid session.
      onAbandon: ({ session_id }) => session_id
        && studentApi.post(`/achievers/sessions/${session_id}/release`, {}),
    });
    setBusy(false);
    if (res.ok) { Alert.alert('Booked!', 'Your session request was sent.'); navigation.goBack(); }
    else Alert.alert('Could not book', res.message);
  };

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.topTitle}>Book a session</Text>
        <View style={{ width: 44 }} />
      </View>

      <ScrollView contentContainerStyle={{ padding: spacing(5), paddingBottom: spacing(8) }}
                  showsVerticalScrollIndicator={false}
                  refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
                  }>
        <View style={styles.mentor}>
          <Avatar name={mentor.full_name} size={56} color={colors.achiever} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <H2>{mentor.full_name}</H2>
            {mentor.designation ? <Muted>{mentor.designation}{mentor.company ? ` @ ${mentor.company}` : ''}</Muted> : null}
            <Text style={styles.rate}>{rate > 0 ? `₹${rate.toLocaleString()} / session` : 'Free session'}</Text>
          </View>
        </View>

        <Text style={styles.h3}>Pick a time</Text>
        {loading ? <Loader /> : failed ? (
          <ErrorState title="We couldn't load the available slots"
                      subtitle="Nothing is lost — this is a connection problem."
                      onRetry={load} />
        ) : slots.length === 0 ? (
          <Empty icon="clock" title="No open slots" subtitle="This achiever has no available times right now." />
        ) : (
          <View style={{ marginTop: spacing(2) }}>
            {slots.map(sl => {
              const sel = picked === sl.id;
              return (
                <TouchableOpacity key={sl.id} onPress={() => setPicked(sl.id)} style={[styles.slot, sel && styles.slotSel]}>
                  <Feather name={sel ? 'check-circle' : 'circle'} size={18} color={sel ? colors.primary : colors.textSubtle} />
                  <Text style={[styles.slotText, sel && { color: colors.primary, fontWeight: font.bold }]}>
                    {fmt(sl.slot_date)}{sl.start_time ? ` · ${String(sl.start_time).slice(0,5)}` : ''}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={styles.h3}>Note (optional)</Text>
        <Input icon="message-square" placeholder="What would you like help with?" value={note} onChangeText={setNote} multiline />

        {rate > 0 && (
          <>
            <Text style={styles.h3}>Coupon</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Input icon="tag" placeholder="Coupon code" autoCapitalize="characters" value={coupon} onChangeText={setCoupon} style={{ marginBottom: 0 }} /></View>
              <Button title="Apply" variant="outline" onPress={applyCoupon} style={{ marginBottom: spacing(3) }} />
            </View>
            {couponInfo?.discount != null ? <Text style={{ color: colors.success, fontSize: font.sm }}>−₹{couponInfo.discount} · you pay ₹{couponInfo.final}</Text> : null}
            {couponInfo?.error ? <Text style={{ color: colors.danger, fontSize: font.sm }}>{couponInfo.error}</Text> : null}
            <WalletToggle kind="session" value={useWallet} onChange={setUseWallet} />
          </>
        )}
      </ScrollView>

      <View style={styles.footer}>
        <Button
          title={rate > 0 ? `Pay & Book · ₹${(couponInfo?.final ?? rate).toLocaleString()}` : 'Confirm Booking'}
          icon={rate > 0 ? 'credit-card' : 'check'} loading={busy} onPress={book} accent={colors.achiever}
        />
      </View>
    </SafeAreaView>
  );
}

function fmt(d) { try { return new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }); } catch { return d; } }

const makeStyles = (colors, shadow) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), paddingVertical: spacing(3) },
  topTitle: { fontSize: font.md, fontWeight: font.bold, color: colors.text },
  mentor: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card },
  rate: { marginTop: 6, fontSize: font.base, fontWeight: font.black, color: colors.achiever },
  h3: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, marginTop: spacing(6), marginBottom: spacing(2) },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing(3.5), marginBottom: spacing(2.5), borderWidth: 1.5, borderColor: 'transparent', ...shadow.soft },
  slotSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  slotText: { fontSize: font.base, color: colors.text },
  footer: { padding: spacing(5), borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
});
