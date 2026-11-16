import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Pill, Loader, Empty, ErrorState, Chip, ChipRow } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';

// TABS comes from master data (masters.cohort_status) — the same list the
// web build reads, so the two surfaces cannot drift apart.
const TONE = { upcoming: 'primary', live: 'warning', completed: 'success', cancelled: 'danger' };

function CohortCard({ c, onPress }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  // Cohorts are uncapped unless someone deliberately set a ceiling: total_seats
  // NULL or 0 means unlimited. Subtracting from `|| 0` turned that into
  // "0 seats left" — the strongest possible discouragement from joining, shown
  // on exactly the cohorts anyone can join. Only a positive value is a cap.
  const capped = c.total_seats > 0;
  const left = c.available_seats != null
    ? c.available_seats
    : Math.max(0, c.total_seats - (c.filled_seats || 0));
  const seatsLabel = capped
    ? `${left} seats left`
    : `${c.filled_seats || 0} enrolled`;
  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <View style={{ flex: 1, paddingRight: 10 }}>
          {c.domain?.name ? <Pill label={c.domain.name} tone="primary" style={{ marginBottom: 8 }} /> : null}
          <Text style={styles.title} numberOfLines={2}>{c.title}</Text>
        </View>
        <Pill label={c.status} tone={TONE[c.status] || 'neutral'} />
      </View>

      {c.achiever?.full_name ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <Feather name="user" size={13} color={colors.textSubtle} />
          <Muted>{c.achiever.full_name}{c.achiever.company ? ` · ${c.achiever.company}` : ''}</Muted>
        </View>
      ) : null}

      <View style={styles.metaRow}>
        <View style={styles.meta}><Feather name="users" size={13} color={colors.textSubtle} /><Muted>{seatsLabel}</Muted></View>
        <Text style={styles.price}>
          {!c.price ? 'Free'
            : c.effective_price != null && c.effective_price < c.price
              ? <><Text style={styles.priceStrike}>₹{Number(c.price).toLocaleString()} </Text>₹{Number(c.effective_price).toLocaleString()}</>
              : `₹${Number(c.price).toLocaleString()}`}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

export default function CohortsScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { lists } = useMasters(['cohort_status']);
  const TABS = ['all', ...(lists.cohort_status || []).map(o => o.value)];

  const [tab, setTab] = useState('all');
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  // One paid cohort free, once ever (Scope §4.2). Shown on the browse screen
  // because that is where it can change which cohort a student opens.
  const [perk, setPerk] = useState(null);

  const [refreshing, setRefreshing] = useState(false);

  // `quiet` is the pull-to-refresh path: the list stays on screen and only the
  // RefreshControl spinner moves. Flipping `loading` there would blank the list
  // the student is holding, which reads as the data being lost.
  const load = useCallback(async (status, quiet) => {
    if (!quiet) setLoading(true);
    const params = status && status !== 'all' ? { status } : undefined;
    try {
      const { data } = await studentApi.get('/cohorts/', params);
      if (data.bool) {
        setItems(data.response.cohorts || []);
        setPerk(data.response.free_cohort || null);
        setFailed(false);
      } else setFailed(true);
    } catch { setFailed(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(tab); }, [tab, load]);

  // A cohort goes live on the clock, so the status a student is looking at can
  // be stale the moment they stop scrolling. Pull to refresh is how they ask.
  const onRefresh = useCallback(() => { setRefreshing(true); load(tab, true); }, [tab, load]);

  return (
    <Screen>
      <H1>Cohorts</H1>
      <Muted style={{ marginTop: 4, marginBottom: spacing(3) }}>Live group sessions by achievers</Muted>

      {perk?.available && (
        <View style={styles.perk}>
          <Feather name="gift" size={14} color={colors.success} />
          <Muted style={{ flex: 1, fontSize: font.xs }}>
            Your first cohort is free — pick any one and use it at checkout.
          </Muted>
        </View>
      )}

      <View style={{ marginBottom: spacing(4) }}>
        <ChipRow>
          {TABS.map(t => (
            <Chip key={t} label={t} on={tab === t} onPress={() => setTab(t)} />
          ))}
        </ChipRow>
      </View>

      {loading ? <Loader /> : failed ? (
        <ErrorState title="We couldn't load the cohorts"
                    subtitle="Nothing is lost — this is a connection problem."
                    onRetry={() => load(tab)} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={({ item }) => <CohortCard c={item} onPress={() => navigation.navigate('CohortDetail', { id: item.id })} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing(20) }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={<Empty icon="calendar" title="No cohorts here" subtitle="Try another tab or check back soon." />}
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  perk: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, marginBottom: spacing(3),
    borderRadius: radius.md, backgroundColor: colors.successSoft },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), marginBottom: spacing(3), ...shadow.card },
  title: { fontSize: font.md, fontWeight: font.bold, color: colors.text, lineHeight: 22 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.borderSoft },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  price: { fontSize: font.md, fontWeight: font.black, color: colors.text },
  priceStrike: { fontSize: font.xs, fontWeight: font.regular, color: colors.textSubtle, textDecorationLine: 'line-through' },
});
