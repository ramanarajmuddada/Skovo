import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Pill, Loader, Empty, ErrorState, Sheet, Button, confirm, Segmented } from '../../components/ui';
import { studentApi, API_BASE_URL } from '../../services/api';
import { openLink } from '../../services/links';

const PAY_TONE = { paid: 'success', free: 'info', pending: 'warning', refunded: 'neutral', cancelled: 'danger' };

/** Pick a new slot for an existing 1-on-1. Mirrors the web RescheduleModal. */
function RescheduleSheet({ session, onClose, onDone }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [slots, setSlots] = useState(null);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    studentApi.get(`/achiever-availability/${session.mentor_id}/slots`)
      .then(({ data }) => { if (alive) setSlots(data.bool ? (data.response.slots || []) : []); })
      .catch(() => { if (alive) setSlots([]); });
    return () => { alive = false; };
  }, [session.mentor_id]);

  const save = async () => {
    if (!picked) { Alert.alert('Pick a slot', 'Choose a new time first.'); return; }
    setBusy(true);
    try {
      const { data } = await studentApi.post(`/achievers/sessions/${session.id}/reschedule`, { slot_id: picked });
      if (data.bool) { onDone(); onClose(); }
      else Alert.alert('Could not reschedule', data.response?.message || 'Please try again.');
    } catch { Alert.alert('Could not reschedule', 'Please check your connection.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      onClose={onClose}
      title={`Reschedule with ${session.mentor_name}`}
      subtitle="Pick a new time that works for you."
      height="70%"
      footer={<Button title="Reschedule" icon="calendar" loading={busy} onPress={save} style={{ flex: 1 }} />}
    >
      {slots === null ? <Loader /> : slots.length === 0 ? (
        <Empty icon="clock" title="No open slots" subtitle="This achiever has no other free times right now." />
      ) : (
        <FlatList
          data={slots}
          keyExtractor={(sl) => sl.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item: sl }) => {
            const sel = picked === sl.id;
            return (
              <TouchableOpacity onPress={() => setPicked(sl.id)} style={[styles.slot, sel && styles.slotSel]}>
                <Feather name={sel ? 'check-circle' : 'circle'} size={18} color={sel ? colors.primary : colors.textSubtle} />
                <Text style={[styles.slotText, sel && { color: colors.primary, fontWeight: font.bold }]}>
                  {fmt(sl.slot_date)}{sl.start_time ? ` · ${String(sl.start_time).slice(0, 5)}` : ''}
                </Text>
              </TouchableOpacity>
            );
          }}
        />
      )}
    </Sheet>
  );
}

export default function BookingsScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [tab, setTab] = useState('cohorts');
  const [cohorts, setCohorts] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [reschedule, setReschedule] = useState(null);
  const [invoices, setInvoices] = useState({});
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);

  // Three requests, and none of them was wrapped. A throw on any one skipped
  // setLoading(false) entirely, so the screen sat on the spinner for ever —
  // worse than an empty list, because nothing tells the student to retry.
  const load = useCallback(async () => {
    setFailed(false);
    try {
      const [b, s, inv] = await Promise.all([
        studentApi.get('/bookings/', { per_page: 30 }),
        studentApi.get('/achievers/my-sessions'),
        studentApi.get('/billing/invoices'),
      ]);
      if (b.data.bool) setCohorts(b.data.response.bookings || []);
      if (s.data.bool) setSessions(s.data.response.sessions || []);
      // {context_id: invoice} — a booking offers an Invoice button only when one
      // was actually raised for it, same rule web uses.
      if (inv.data.bool) {
        const map = {};
        (inv.data.response.invoices || []).forEach((i) => { if (i.context_id) map[i.context_id] = i; });
        setInvoices(map);
      }
    } catch {
      // Say "we could not ask", never render it as "you have no bookings".
      setFailed(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const onRefresh = useCallback(() => { setRefreshing(true); load(); }, [load]);

  /** Shared cancel path — the two endpoints differ, the handling does not. */
  // Refund choice (refunds & wallet spreadsheet): SKOVO Wallet instantly (plus
  // any admin bonus) or the original payment in 5–7 days.
  const askRefundTo = (preview) => new Promise((resolve) => {
    Alert.alert('Where should the refund go?',
      `Wallet: ₹${preview.wallet_amount} instantly${preview.wallet_bonus > 0 ? ` (incl. ₹${preview.wallet_bonus} bonus)` : ''}.\nOriginal payment: ₹${preview.original_amount ?? preview.refund} in ${preview.original_days || '5–7 days'}.`,
      [{ text: 'Keep booking', style: 'cancel', onPress: () => resolve(null) },
       { text: 'Original payment', onPress: () => resolve('original') },
       { text: 'SKOVO Wallet', onPress: () => resolve('wallet') }],
      { cancelable: true, onDismiss: () => resolve(null) });
  });

  const cancel = async ({ id, endpoint, previewUrl, title, message }) => {
    let preview = null;
    if (previewUrl) {
      try { const { data } = await studentApi.get(previewUrl); if (data?.bool) preview = data.response; } catch { /* fall through */ }
    }
    const msg = preview?.text || (preview && Number(preview.refund) > 0 ? `You'll be refunded ₹${preview.refund}.` : message);
    if (!(await confirm({ title, message: msg, confirmLabel: 'Cancel booking', destructive: true }))) return;
    let body = {};
    if (preview?.wallet_available && Number(preview.refund) > 0) {
      const to = await askRefundTo(preview);
      if (!to) return;
      body = { refund_to: to };
    }
    setBusyId(id);
    try {
      const { data } = await studentApi.post(endpoint, body);
      if (data.bool) { await load(); Alert.alert('Cancelled', data.response?.message || 'Your booking was cancelled.'); }
      else Alert.alert('Could not cancel', data.response?.message || 'Please try again.');
    } catch { Alert.alert('Could not cancel', 'Please check your connection.'); }
    finally { setBusyId(null); }
  };

  const decideProposal = async (s, accept) => {
    const when = s.proposed_slot_date
      ? `${fmt(s.proposed_slot_date)}${s.proposed_slot_start ? ` · ${String(s.proposed_slot_start).slice(0, 5)}` : ''}`
      : 'the new time';
    const ok = await confirm({
      title: accept ? `Accept ${when}?` : `Decline ${when}?`,
      message: accept
        ? 'Your 1-on-1 moves to this slot. Payment stays the same.'
        : 'The session is cancelled and you get a full refund.',
      confirmLabel: accept ? 'Accept' : 'Decline and refund',
      destructive: !accept,
    });
    if (!ok) return;
    setBusyId(s.id);
    try {
      const { data } = await studentApi.post(
        `/achievers/sessions/${s.id}/proposal/${accept ? 'accept' : 'decline'}`, {});
      if (data.bool) { await load(); Alert.alert(accept ? 'Accepted' : 'Declined', data.response?.message || ''); }
      else Alert.alert('Could not update', data.response?.message || 'Please try again.');
    } catch { Alert.alert('Could not update', 'Please check your connection.'); }
    finally { setBusyId(null); }
  };

  const data = tab === 'cohorts' ? cohorts : sessions;

  const renderCohort = ({ item: b }) => {
    // Same rule as web: refunded/cancelled rows, and anything already live or
    // finished, cannot be cancelled.
    const canCancel = ['paid', 'free', 'pending'].includes(b.payment_status)
      && b.cohort_status !== 'completed' && b.cohort_status !== 'live' && !b.is_live;
    return (
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.title} numberOfLines={2}>{b.cohort_title}</Text>
          <Pill label={b.payment_status} tone={PAY_TONE[b.payment_status] || 'neutral'} />
        </View>
        <View style={styles.row}>
          <View style={styles.meta}><Feather name="calendar" size={13} color={colors.textSubtle} /><Muted>{fmt(b.session_date)}</Muted></View>
          <View style={styles.actions}>
            {canCancel ? (
              <TouchableOpacity
                style={styles.ghostBtn}
                disabled={busyId === b.id}
                onPress={() => cancel({
                  id: b.id,
                  endpoint: `/bookings/${b.id}/cancel`,
                  previewUrl: b.payment_status === 'paid' ? `/bookings/${b.id}/refund-preview` : null,
                  title: 'Cancel booking?',
                  message: b.payment_status === 'paid'
                    ? 'Your seat is released and a refund is raised per policy.'
                    : 'This releases your seat in the cohort.',
                })}
              >
                <Feather name="x" size={13} color={colors.danger} />
                <Text style={styles.ghostText}>{busyId === b.id ? 'Cancelling…' : 'Cancel'}</Text>
              </TouchableOpacity>
            ) : null}
            {invoices[b.cohort_id] ? (
              <TouchableOpacity style={styles.ghostBtn}
                                onPress={() => openLink(`${API_BASE_URL}/billing/invoices/${invoices[b.cohort_id].id}`)}>
                <Feather name="file-text" size={13} color={colors.textMuted} />
                <Text style={[styles.ghostText, { color: colors.textMuted }]}>Invoice</Text>
              </TouchableOpacity>
            ) : null}
            {b.can_join && b.meeting_link ? (
              <TouchableOpacity style={styles.join} onPress={() => openLink(b.meeting_link)}><Feather name="video" size={13} color="#fff" /><Text style={styles.joinText}>Join</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  const renderSession = ({ item: s }) => {
    const open = s.status !== 'cancelled' && s.status !== 'completed';
    return (
      <View style={styles.card}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={styles.title}>{s.mentor_name}</Text>
          <Pill label={s.status} tone={s.status === 'confirmed' ? 'success' : s.status === 'cancelled' ? 'danger' : 'warning'} />
        </View>
        <View style={styles.row}>
          <View style={styles.meta}><Feather name="clock" size={13} color={colors.textSubtle} /><Muted>{s.slot_date ? fmt(s.slot_date) : 'Requested'}{s.slot_start ? ` · ${String(s.slot_start).slice(0,5)}` : ''}</Muted></View>
          <View style={styles.actions}>
            {s.proposed_slot_id && open ? (
              <>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => decideProposal(s, true)}>
                  <Feather name="check" size={13} color={colors.primary} />
                  <Text style={[styles.ghostText, { color: colors.primary }]}>Accept new time</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.ghostBtn} disabled={busyId === s.id} onPress={() => decideProposal(s, false)}>
                  <Feather name="x" size={13} color={colors.danger} />
                  <Text style={styles.ghostText}>Decline</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {open ? (
              <>
                <TouchableOpacity style={styles.ghostBtn} onPress={() => setReschedule(s)}>
                  <Feather name="calendar" size={13} color={colors.primary} />
                  <Text style={[styles.ghostText, { color: colors.primary }]}>Reschedule</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.ghostBtn}
                  disabled={busyId === s.id}
                  onPress={() => cancel({
                    id: s.id,
                    endpoint: `/achievers/sessions/${s.id}/cancel`,
                    previewUrl: s.payment_status === 'paid' ? `/achievers/sessions/${s.id}/refund-preview` : null,
                    title: 'Cancel this session?',
                    message: `Your 1-on-1 with ${s.mentor_name} will be cancelled and the slot freed.`,
                  })}
                >
                  <Feather name="x" size={13} color={colors.danger} />
                  <Text style={styles.ghostText}>{busyId === s.id ? 'Cancelling…' : 'Cancel'}</Text>
                </TouchableOpacity>
              </>
            ) : null}
            {s.meeting_link ? (
              <TouchableOpacity style={[styles.join, { backgroundColor: colors.success }]} onPress={() => openLink(s.meeting_link)}><Feather name="video" size={13} color="#fff" /><Text style={styles.joinText}>Join</Text></TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>
    );
  };

  return (
    <Screen>
      <H1>My Bookings</H1>
      {reschedule ? (
        <RescheduleSheet session={reschedule} onClose={() => setReschedule(null)} onDone={load} />
      ) : null}
      <Segmented
        value={tab}
        onChange={setTab}
        options={[
          { value: 'cohorts', label: 'Cohorts' },
          { value: 'sessions', label: '1-on-1' },
        ]}
      />
      {loading ? <Loader /> : failed ? (
        <ErrorState
          title="We couldn't load your bookings"
          subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
        />
      ) : (
        <FlatList
          data={data}
          keyExtractor={(it) => it.id}
          renderItem={tab === 'cohorts' ? renderCohort : renderSession}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing(20) }}
          // A booking changes state somewhere else — the mentor completes it, a
          // payment confirms — so the student needs a way to ask again without
          // force-quitting the app.
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={<Empty icon="bookmark" title="Nothing booked yet" subtitle="Your cohorts and sessions will show up here." />}
        />
      )}
    </Screen>
  );
}

function fmt(d) { try { return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return '—'; } }

const makeStyles = (colors, shadow) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), marginBottom: spacing(3), ...shadow.card },
  title: { flex: 1, fontSize: font.base, fontWeight: font.bold, color: colors.text, paddingRight: 10 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  join: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary, paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, borderRadius: radius.pill },
  joinText: { color: '#fff', fontSize: font.sm, fontWeight: font.bold },
  ghostBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 40, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  ghostText: { fontSize: font.sm, fontWeight: font.bold, color: colors.danger },
  slot: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md,
    padding: spacing(3.5), marginBottom: spacing(2.5), borderWidth: 1.5, borderColor: 'transparent', ...shadow.soft },
  slotSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  slotText: { fontSize: font.base, color: colors.text },
});
