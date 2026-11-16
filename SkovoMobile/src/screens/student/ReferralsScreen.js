// ── Refer & Earn (student) ───────────────────────────────────────────────────
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Share } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, Button, Input, Loader, Empty, Pill, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

const STATUS_TONE = { pending: 'warning', completed: 'success', expired: 'neutral' };

export default function ReferralsScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    studentApi.get('/referrals/my')
      .then(({ data: d }) => { if (d.bool) setData(d.response); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const code = data?.referral_code;

  const shareCode = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: `Join me on SKOVO — India's career-growth platform for students. Use my referral code ${code} when you sign up! 🚀`,
      });
    } catch { /* user dismissed */ }
  };

  const sendReferral = async () => {
    setErr(''); setMsg('');
    if (!email.trim() || !email.includes('@')) { setErr('Enter a valid email address.'); return; }
    setSending(true);
    try {
      const { data: d } = await studentApi.post('/referrals/send', { email: email.trim().toLowerCase() });
      if (!d.bool) { setErr(d.response?.message || 'Failed to send referral.'); return; }
      setMsg('Referral recorded! Your friend will receive an invite.');
      setEmail('');
      load();
    } catch { setErr('Something went wrong. Try again.'); }
    finally { setSending(false); }
  };

  if (loading) return <Screen><Loader label="Loading referrals…" /></Screen>;

  return (
    <Screen scroll>
      {/* Referral code card */}
      <LinearGradient colors={gradients.info || ['#0EA5E9', '#0369A1']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIcon}><Feather name="gift" size={20} color="#fff" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroTitle}>Your Referral Code</Text>
            <Text style={styles.heroHint}>Share it — earn rewards when friends join</Text>
          </View>
        </View>
        <View style={styles.codeRow}>
          <View style={styles.codeBox}><Text style={styles.codeText}>{code || '—'}</Text></View>
          <TouchableOpacity onPress={shareCode} style={styles.shareBtn} activeOpacity={0.8}>
            <Feather name="share-2" size={18} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.statsRow}>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{data?.total || 0}</Text>
            <Text style={styles.statLbl}>Total Referred</Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statNum}>{data?.completed || 0}</Text>
            <Text style={styles.statLbl}>Joined SKOVO</Text>
          </View>
        </View>
      </LinearGradient>

      {/* Send invite */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Invite a Friend</Text>
        <Text style={styles.cardSub}>Enter their email and we'll record the referral.</Text>
        <Input
          icon="mail"
          placeholder="friend@email.com"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {!!msg && <Text style={styles.okText}>{msg}</Text>}
        {!!err && <Text style={styles.errText}>{err}</Text>}
        <Button title="Send Invite" icon="send" onPress={sendReferral} loading={sending} />
      </View>

      {/* History */}
      <Text style={styles.section}>Referral History</Text>
      {!data?.referrals?.length ? (
        failed ? (
          <ErrorState
            title="We couldn't load your referrals"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="users" title="No referrals yet" subtitle="Invite friends to see them here" />
        )
      ) : (
        <View style={{ gap: spacing(3) }}>
          {data.referrals.map((r) => (
            <View key={r.id} style={styles.histRow}>
              <View style={styles.histAvatar}>
                <Text style={styles.histInitial}>{(r.referred_email || '?')[0].toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.histName}>{r.referred_name || r.referred_email}</Text>
                {!!r.referred_name && <Text style={styles.histMail}>{r.referred_email}</Text>}
              </View>
              <View style={{ alignItems: 'flex-end', gap: 4 }}>
                <Pill label={r.status} tone={STATUS_TONE[r.status] || 'neutral'} />
                {r.reward_given && <Text style={styles.rewarded}>Rewarded</Text>}
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  hero: { borderRadius: radius.xl, padding: spacing(5), marginBottom: spacing(4) },
  heroTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: spacing(4) },
  heroIcon: { width: 40, height: 40, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  heroTitle: { color: '#fff', fontSize: font.lg, fontWeight: font.black },
  heroHint: { color: 'rgba(255,255,255,0.75)', fontSize: font.xs, marginTop: 2 },
  codeRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  codeBox: { flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  codeText: { color: '#fff', fontSize: font.xl, fontWeight: font.black, letterSpacing: 4 },
  shareBtn: { width: 48, height: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing(6), marginTop: spacing(4), paddingTop: spacing(4), borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  statCell: { alignItems: 'center' },
  statNum: { color: '#fff', fontSize: font.xl, fontWeight: font.black },
  statLbl: { color: 'rgba(255,255,255,0.75)', fontSize: font.xs, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(5), ...shadow.card, marginBottom: spacing(5) },
  cardTitle: { fontSize: font.lg, fontWeight: font.bold, color: colors.text },
  cardSub: { fontSize: font.xs, color: colors.textMuted, marginTop: 2, marginBottom: spacing(3) },
  okText: { color: colors.success, fontSize: font.xs, marginBottom: 8 },
  errText: { color: colors.danger, fontSize: font.xs, marginBottom: 8 },
  section: { fontSize: font.lg, fontWeight: font.bold, color: colors.text, marginBottom: spacing(3) },
  histRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.soft },
  histAvatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surfaceAlt, alignItems: 'center', justifyContent: 'center' },
  histInitial: { fontSize: font.sm, fontWeight: font.bold, color: colors.textMuted },
  histName: { fontSize: font.sm, fontWeight: font.semibold, color: colors.text },
  histMail: { fontSize: font.xs, color: colors.textSubtle, marginTop: 1 },
  rewarded: { fontSize: font.xs, color: colors.success, fontWeight: font.semibold },
});
