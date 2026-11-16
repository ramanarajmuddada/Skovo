// ── Colleges — browse and save (student) ────────────────────────────────────
// Saving is the free tier's comparison list: three colleges free, unlimited on
// Pro. Hitting that cap is the highest-intent moment a free student has — they
// are comparing colleges right now — so the server answers it with what Pro
// gains them, and this screen shows that rather than a bare refusal.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Input, Pill, Loader, Empty, ErrorState, Chip, ChipRow } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';

const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;

export default function CollegesScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState('');
  // Same filter the web screen offers, off the same master.
  const { lists } = useMasters(['college_type']);
  const [type, setType] = useState('all');
  const [saved, setSaved] = useState(new Set());
  const [quota, setQuota] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback((q = '') => {
    studentApi.get('/colleges/', { page: 1, per_page: 30, ...(q ? { search: q } : {}) })
      .then(({ data }) => { if (data.bool) setList(data.response.colleges || []); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  // Which colleges are already on the list, and how much room is left. Read
  // from the same endpoint the Saved screen uses so the two never disagree.
  const loadSaved = useCallback(() => {
    studentApi.get('/colleges/saved')
      .then(({ data }) => {
        if (!data.bool) return;
        setSaved(new Set((data.response.colleges || []).map((c) => c.id)));
        setQuota({
          is_pro: !!data.response.is_pro,
          limit: data.response.limit,
          remaining: data.response.remaining,
          total: data.response.total,
        });
      })
      // Deliberately silent, and the only silent catch on this screen. The
      // colleges list is the point of the page and renders from its own
      // request; this one decorates it with save state and the free-tier
      // quota. Blocking the whole screen because a decoration failed would be
      // the worse trade. The cost is bounded: a save that is really a
      // duplicate is refused by the server and toggleSave surfaces that
      // message, so the student is never silently lied to about what happened.
      .catch(() => {});
  }, []);

  useEffect(() => { load(); loadSaved(); }, [load, loadSaved]);

  const onRefresh = () => { setRefreshing(true); load(search); loadSaved(); };

  const toggleSave = async (c) => {
    const on = saved.has(c.id);
    setBusy(c.id);
    try {
      const { data } = on
        ? await studentApi.delete(`/colleges/${c.id}/save`)
        : await studentApi.post(`/colleges/${c.id}/save`, {});
      if (data.bool) {
        setSaved((prev) => {
          const next = new Set(prev);
          if (on) next.delete(c.id); else next.add(c.id);
          return next;
        });
        loadSaved();
      } else if (data.response?.requires_pro) {
        Alert.alert(
          data.response.upgrade?.headline || 'Free plan limit',
          data.response.message,
          [{ text: 'Not now' }, { text: 'See Pro', onPress: () => navigation.navigate('SkovoPro') }],
        );
      } else {
        Alert.alert('Could not save', data.response?.message || '');
      }
    } catch {
      Alert.alert('Could not save', 'Please try again.');
    } finally { setBusy(''); }
  };

  const shown = type === 'all' ? list : list.filter((c) => c.type === type);

  return (
    <Screen scroll refreshing={refreshing} onRefresh={onRefresh}>
      <H1 style={{ marginBottom: spacing(2) }}>Colleges</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Explore colleges, fees and rankings</Muted>

      <Input icon="search" placeholder="Search colleges…" value={search}
        onChangeText={setSearch} onSubmitEditing={() => load(search)} returnKeyType="search" autoCapitalize="none" />

      {/* The comparison-list meter. Hidden for Pro — telling a paying member
          they have "unlimited of unlimited" is noise. */}
      {quota && !quota.is_pro && (
        <TouchableOpacity style={[styles.quota, quota.remaining === 0 && styles.quotaFull]}
                          onPress={() => navigation.navigate('SavedColleges')}>
          <Feather name="bookmark" size={14}
                   color={quota.remaining === 0 ? colors.warning : colors.textSubtle} />
          <Muted style={{ flex: 1, fontSize: font.xs }}>
            {quota.remaining === 0
              ? `Comparing all ${quota.limit} — Pro tracks as many as you like.`
              : `Comparing ${quota.total} of ${quota.limit} colleges.`}
          </Muted>
          <Feather name="chevron-right" size={14} color={colors.textSubtle} />
        </TouchableOpacity>
      )}

      <ChipRow>
        {[{ value: 'all', label: 'All types' }, ...(lists.college_type || [])].map((o) => (
          <Chip key={o.value} label={o.label} on={type === o.value} onPress={() => setType(o.value)} />
        ))}
      </ChipRow>

      {loading ? <Loader label="Loading colleges…" /> : shown.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load colleges"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="home" title="No colleges found" subtitle="Try a different search or type" />
        )
      ) : (
        <View style={{ gap: spacing(3), marginTop: spacing(2) }}>
          {shown.map((c) => (
            <View key={c.id} style={styles.card}>
              <View style={styles.iconBox}><Feather name="home" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={2}>{c.name}</Text>
                  <TouchableOpacity onPress={() => toggleSave(c)} disabled={busy === c.id}
                                    hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                    style={{ paddingLeft: spacing(2), minWidth: 44, minHeight: 44, alignItems: 'flex-end', justifyContent: 'center', opacity: busy === c.id ? 0.4 : 1 }}>
                    <Feather name="bookmark" size={17}
                             color={saved.has(c.id) ? colors.primary : colors.textSubtle} />
                  </TouchableOpacity>
                </View>
                <View style={styles.metaRow}>
                  {!!c.type && <Pill label={c.type} tone="primary" />}
                  {(c.location_city || c.location_state) && (
                    <Text style={styles.meta}>
                      <Feather name="map-pin" size={10} color={colors.textSubtle} /> {[c.location_city, c.location_state].filter(Boolean).join(', ')}
                    </Text>
                  )}
                </View>
                <View style={styles.statRow}>
                  {c.nirf_ranking ? <Text style={styles.stat}>NIRF #{c.nirf_ranking}</Text> : null}
                  {c.naac_grade ? <Text style={styles.stat}>NAAC {c.naac_grade}</Text> : null}
                  {c.annual_fees_min ? (
                    <Text style={styles.fees}>
                      {inr(c.annual_fees_min)}{c.annual_fees_max ? ` – ${inr(c.annual_fees_max)}` : ''}/yr
                    </Text>
                  ) : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  card: { flexDirection: 'row', gap: 12, backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card },
  iconBox: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: font.base, fontWeight: font.bold, color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  meta: { fontSize: font.xs, color: colors.textMuted },
  statRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 8, flexWrap: 'wrap' },
  stat: { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },
  fees: { fontSize: font.xs, fontWeight: font.bold, color: colors.success },
  quota: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: 8,
    padding: 12, borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  quotaFull: { backgroundColor: colors.warningSoft },
});
