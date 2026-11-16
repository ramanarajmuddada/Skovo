// ── Skovo Pro — annual membership (student) ──────────────────────────────────
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, Button, Loader, Input, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';
import WalletToggle from '../../components/WalletToggle';
import { checkout } from '../../services/payments';
import { useAuth } from '../../context/AuthContext';

export default function SkovoProScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [plan, setPlan] = useState('annual');
  const [coupon, setCoupon] = useState('');
  const [useWallet, setUseWallet] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    studentApi.get('/subscription/')
      .then(({ data }) => { if (data.bool) setInfo(data.response); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const subscribe = async () => {
    setBusy(true); setErr(''); setMsg('');
    const res = await checkout({
      client: studentApi,
      endpoint: '/subscription/subscribe',
      body: { plan, coupon_code: coupon.trim() || undefined, use_wallet: useWallet || undefined },
      name: 'SKOVO',
      description: 'Skovo Pro Membership',
      prefill: { name: user?.full_name || '', email: user?.email || '' },
    });
    if (res.ok) { setMsg('🎉 Welcome to Skovo Pro! Your membership is active.'); load(); }
    else setErr(res.message || 'Something went wrong.');
    setBusy(false);
  };

  if (loading) return <Screen><Loader label="Loading membership…" /></Screen>;

  const isPro = info?.is_pro;
  const perks = info?.perks || [];
  const plans = info?.plans || [];
  const selected = plans.find(p => p.key === plan) || plans.find(p => p.key === 'annual');
  const price = selected?.effective_price ?? selected?.price ?? info?.price ?? 1499;
  const sub = info?.subscription;
  const credits = info?.session_credits;
  const expiry = sub?.expires_at
    ? new Date(sub.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  return (
    <Screen scroll>
      <LinearGradient colors={gradients.achiever} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <Feather name="award" size={26} color="#FDE047" />
          <Text style={styles.heroTitle}>Skovo Pro</Text>
          {isPro && (
            <View style={styles.activeBadge}><Text style={styles.activeText}>ACTIVE</Text></View>
          )}
        </View>
        {isPro ? (
          <>
            <Text style={styles.heroSub}>You're a Pro member — everything below is unlocked.</Text>
            {expiry && <Text style={styles.heroMeta}>Renews / expires on {expiry}</Text>}
            {credits && (
              <View style={styles.creditPill}>
                <Feather name="zap" size={13} color="#fff" />
                <Text style={styles.creditText}>
                  {credits.remaining} of {credits.monthly} free 1-on-1 credits left this month
                </Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.heroSub}>
            Unlock everything for <Text style={{ fontWeight: font.black }}>₹{price.toLocaleString('en-IN')}/year</Text> — less than one cohort a month.
          </Text>
        )}
      </LinearGradient>

      {!!msg && <View style={[styles.flash, styles.flashOk]}><Text style={styles.flashOkText}>{msg}</Text></View>}
      {!!err && <View style={[styles.flash, styles.flashErr]}><Text style={styles.flashErrText}>{err}</Text></View>}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>What Pro unlocks</Text>
        {perks.length === 0 ? (
          <Text style={{ color: colors.textMuted, fontSize: font.sm }}>Membership perks will appear here.</Text>
        ) : perks.map((p, i) => (
          <View key={i} style={styles.perkRow}>
            <View style={styles.perkCheck}><Feather name="check" size={12} color={colors.achieverDark} /></View>
            <Text style={styles.perkText}>{p}</Text>
          </View>
        ))}
      </View>

      {!isPro && plans.length > 0 && (
        <View style={styles.planRow}>
          {plans.map((p) => {
            const active = p.key === plan;
            return (
              <TouchableOpacity key={p.key} activeOpacity={0.8} onPress={() => setPlan(p.key)}
                style={[styles.planCard, active && styles.planCardActive]}>
                {p.key === 'annual' && <View style={styles.bestTag}><Text style={styles.bestTagTxt}>BEST</Text></View>}
                <Text style={styles.planLabel}>{p.label}</Text>
                {p.effective_price < p.price ? (
                  <>
                    <Text style={styles.planStrike}>₹{p.price.toLocaleString('en-IN')}</Text>
                    <Text style={styles.planPrice}>₹{p.effective_price.toLocaleString('en-IN')}</Text>
                  </>
                ) : (
                  <Text style={styles.planPrice}>₹{p.price.toLocaleString('en-IN')}</Text>
                )}
                <Text style={styles.planEff}>≈ ₹{p.effective_monthly}/mo</Text>
                {p.offer_label ? <Text style={styles.planOffer}>{p.offer_label}</Text> : null}
              </TouchableOpacity>
            );
          })}
        </View>
      )}

      {!isPro && (
        <View style={{ marginTop: spacing(4) }}>
          <Input placeholder="Coupon code (optional)" value={coupon}
            onChangeText={(t) => setCoupon(t.toUpperCase())} autoCapitalize="characters" />
          <WalletToggle kind="subscription" value={useWallet} onChange={setUseWallet} />
        </View>
      )}

      {!isPro && (
        <Button
          title={busy ? 'Opening checkout…' : `Get Skovo Pro — ₹${price.toLocaleString('en-IN')} (${selected?.label || 'Annual'})`}
          icon="award"
          onPress={subscribe}
          loading={busy}
          accent={colors.achiever}
          style={{ marginTop: spacing(2) }}
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  hero: { borderRadius: radius.xl, padding: spacing(6), marginBottom: spacing(4) },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  heroTitle: { color: '#fff', fontSize: font.xxl, fontWeight: font.black },
  activeBadge: { backgroundColor: '#FDE047', borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, marginLeft: 4 },
  activeText: { color: '#581C87', fontSize: font.xs, fontWeight: font.black },
  heroSub: { color: 'rgba(255,255,255,0.92)', fontSize: font.md, lineHeight: 24 },
  heroMeta: { color: 'rgba(255,255,255,0.7)', fontSize: font.sm, marginTop: 6 },
  creditPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(255,255,255,0.18)', alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.md, marginTop: 12 },
  creditText: { color: '#fff', fontSize: font.xs, fontWeight: font.semibold },
  flash: { borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, marginBottom: spacing(3) },
  flashOk: { backgroundColor: colors.successSoft },
  flashOkText: { color: colors.success, fontSize: font.sm, fontWeight: font.semibold },
  flashErr: { backgroundColor: colors.dangerSoft },
  flashErrText: { color: colors.danger, fontSize: font.sm, fontWeight: font.semibold },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(5), ...shadow.card },
  cardTitle: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, marginBottom: spacing(3) },
  perkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
  perkCheck: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.achieverSoft, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  perkText: { flex: 1, fontSize: font.sm, color: colors.text, lineHeight: 20 },
  planRow: { flexDirection: 'row', gap: spacing(2), marginTop: spacing(4) },
  planCard: { flex: 1, borderWidth: 2, borderColor: colors.border, borderRadius: radius.lg, padding: spacing(3), backgroundColor: colors.surface },
  planCardActive: { borderColor: colors.achiever, backgroundColor: colors.achieverSoft },
  bestTag: { position: 'absolute', top: -8, right: 8, backgroundColor: colors.achiever, borderRadius: radius.pill, paddingHorizontal: 7, paddingVertical: 2 },
  bestTagTxt: { color: '#fff', fontSize: font.xs, fontWeight: font.black, letterSpacing: 0.5 },
  planLabel: { fontSize: font.xs, fontWeight: font.bold, color: colors.text },
  planPrice: { fontSize: font.lg, fontWeight: font.black, color: colors.text, marginTop: 2 },
  planStrike: { fontSize: font.xs, color: colors.textSubtle, textDecorationLine: 'line-through', marginTop: 2 },
  planEff: { fontSize: font.xs, color: colors.textMuted, marginTop: 1 },
  planOffer: { fontSize: font.xs, fontWeight: font.black, color: colors.success, marginTop: 2, textTransform: 'uppercase' },
});
