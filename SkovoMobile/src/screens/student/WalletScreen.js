// ── SKOVO Wallet + refund tracker (refunds & wallet spreadsheet) ─────────────
import React, { useCallback, useEffect, useState } from 'react';
import { View, TextInput } from 'react-native';
import { useTheme } from '../../theme';
import { Screen, H1, Card, Button, Loader, useToast, confirm } from '../../components/ui';
import { T, rupee } from '../../components/v1';
import { studentApi } from '../../services/api';

const date = (v) => (v ? new Date(v).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');

export default function WalletScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const [w, setW] = useState(null);
  const [refunds, setRefunds] = useState([]);
  const [amount, setAmount] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await Promise.all([
      studentApi.get('/payments/wallet').then(({ data }) => data?.bool && setW(data.response)).catch(() => {}),
      studentApi.get('/payments/refunds').then(({ data }) => data?.bool && setRefunds(data.response.refunds || [])).catch(() => {}),
    ]);
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (url, body, ok) => {
    const { data } = await studentApi.post(url, body);
    if (data?.bool) { toast.success(data.response?.message || ok); load(); } else toast.error(data?.response?.message || 'Could not do that.');
  };

  if (!w) return <Screen><Loader label="Loading…" /></Screen>;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}>
      <H1>Wallet & refunds</H1>
      {w.enabled ? (
        <>
          <Card style={{ backgroundColor: '#0f172a', marginTop: 12 }}>
            <T size={12} color="#cbd5e1">SKOVO Wallet</T>
            <T size={30} bold color="#fff">{rupee(w.total)}</T>
            <View style={{ flexDirection: 'row', gap: 24, marginTop: 8 }}>
              <View><T size={11} color="#94a3b8">Refund money</T><T bold color="#fff">{rupee(w.refund_money)}</T></View>
              <View><T size={11} color="#94a3b8">Bonus credit</T><T bold color="#fff">{rupee(w.bonus_credit)}</T></View>
            </View>
            {w.bonus_expiring_amount > 0 && <T size={11} color="#fcd34d" style={{ marginTop: 8 }}>{rupee(w.bonus_expiring_amount)} bonus expires on {date(w.bonus_expires_next)}</T>}
          </Card>
          <T size={12} muted style={{ marginTop: 8 }}>
            Use it at checkout{w.usable_on.length ? ` for ${w.usable_on.join(', ')}` : ''}.{w.bonus_cap_pct > 0 ? ` Bonus can pay up to ${w.bonus_cap_pct}% of an order.` : ''} Bonus credit cannot be sent to a bank.
          </T>
          {w.refund_money > 0 && w.send_to_bank_days > 0 && (
            <Card style={{ marginTop: 12 }}>
              <T bold>Send refund money to my bank</T>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
                <TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder={`Up to ${rupee(w.refund_money)}`} placeholderTextColor={colors.textMuted}
                           style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 10, color: colors.text }} />
                <Button title="Request" size="sm" onPress={() => amount && post('/payments/wallet/send-to-bank', { amount: Number(amount) }, 'Requested').then(() => setAmount(''))} />
              </View>
              <T size={11} muted style={{ marginTop: 6 }}>Reaches your original payment method within {w.send_to_bank_days} working days.</T>
              {w.payout_requests.map((p) => <T key={p.id} size={12}>{rupee(p.amount)} · {p.status} · {date(p.at)}</T>)}
            </Card>
          )}
          <Card style={{ marginTop: 12 }}>
            <T bold style={{ marginBottom: 6 }}>History</T>
            {w.history.length === 0 ? <T size={12} muted>No wallet activity yet.</T> : w.history.map((h, i) => (
              <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 }}>
                <View style={{ flex: 1 }}><T>{h.reason || h.kind}</T><T size={11} muted>{date(h.at)}{h.expires_at ? ` · expires ${date(h.expires_at)}` : ''}</T></View>
                <T bold color={h.amount < 0 ? colors.danger : colors.success}>{h.amount < 0 ? '−' : '+'}{rupee(Math.abs(h.amount))}</T>
              </View>
            ))}
          </Card>
        </>
      ) : <T muted style={{ marginTop: 10 }}>The SKOVO Wallet is not switched on. Refunds go back to your original payment method.</T>}

      <T bold size={16} style={{ marginTop: 18, marginBottom: 6 }}>Refunds</T>
      {refunds.length === 0 && <T size={12} muted>No refunds.</T>}
      {refunds.map((r) => (
        <Card key={r.id} style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <View style={{ flex: 1 }}>
              <T bold>{rupee(r.amount)}{r.bonus > 0 ? ` + ${rupee(r.bonus)} bonus` : ''}</T>
              <T size={12} muted>{r.kind} · to {r.destination === 'wallet' ? 'SKOVO Wallet' : 'original payment'}</T>
            </View>
            <T size={12} bold>{r.status_label}</T>
          </View>
          {r.timeline.map((t, i) => <T key={i} size={12} color={t.done ? colors.success : colors.textMuted}>{t.done ? '✓' : '○'} {t.step}{t.reference ? ` (ref ${t.reference})` : ''}</T>)}
          {r.can_move_to_wallet && <Button title="Bank refund failed — add to my wallet" size="sm" variant="soft" style={{ marginTop: 8 }} onPress={() => post(`/payments/refunds/${r.id}/to-wallet`, {}, 'Moved')} />}
        </Card>
      ))}
      <Button title="Refund Skovo Pro" variant="ghost" size="sm" style={{ marginTop: 8 }} onPress={async () => {
        if (!(await confirm({ title: 'Refund Skovo Pro?', message: 'Pro turns off right away. Pro bought through Google Play or the App Store is refunded by them.', confirmLabel: 'Refund', destructive: true }))) return;
        const toWallet = w.enabled && await confirm({ title: 'Refund to SKOVO Wallet?', message: 'Choose Cancel to get it back to your original payment.', confirmLabel: 'Wallet' });
        post('/payments/subscription-refund', toWallet ? { refund_to: 'wallet' } : {}, 'Refund issued');
      }} />
      <View style={{ height: 24 }} />
    </Screen>
  );
}
