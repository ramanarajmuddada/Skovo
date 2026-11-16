// ── Saved Colleges (student) ─────────────────────────────────────────────────
// The comparison list. Free tier keeps 3, Skovo Pro unlimited.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Loader, Empty, Pill, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

export default function SavedCollegesScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(() => {
    studentApi.get('/colleges/saved')
      .then(({ data: d }) => { if (d.bool) setData(d.response); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const unsave = async (c) => {
    setData((prev) => ({ ...prev, colleges: prev.colleges.filter((x) => x.id !== c.id) }));
    try { await studentApi.delete(`/colleges/${c.id}/save`); } catch { load(); }
  };

  if (loading) return <Screen><Loader label="Loading saved colleges…" /></Screen>;

  const colleges = data?.colleges || [];
  const isPro = !!data?.is_pro;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1>Saved Colleges</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Your comparison list</Muted>

      {!isPro && (
        <Card style={s.banner}>
          <View style={{ flex: 1 }}>
            <Text style={s.bannerTitle}>
              {data.remaining > 0 ? `${data.remaining} of ${data.limit} saves left` : `All ${data.limit} free saves used`}
            </Text>
            <Muted style={{ fontSize: font.xs, marginTop: 2 }}>Skovo Pro saves unlimited colleges.</Muted>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('SkovoPro')} style={s.upBtn}>
            <Feather name="award" size={12} color={colors.onPrimary} />
            <Text style={s.upText}>Upgrade</Text>
          </TouchableOpacity>
        </Card>
      )}

      {colleges.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load your saved colleges"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="bookmark" title="No saved colleges"
               subtitle="Browse colleges and tap save to compare them" />
        )
      ) : (
        colleges.map((c) => (
          <Card key={c.id} style={{ marginBottom: spacing(2.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.name} numberOfLines={2}>{c.name}</Text>
                {(c.city || c.state) && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(1), marginTop: spacing(1) }}>
                    <Feather name="map-pin" size={11} color={colors.textSubtle} />
                    <Muted style={{ fontSize: font.xs }}>{[c.city, c.state].filter(Boolean).join(', ')}</Muted>
                  </View>
                )}
                <View style={{ flexDirection: 'row', gap: spacing(1.5), marginTop: spacing(2) }}>
                  {!!c.college_type && <Pill label={c.college_type} tone="primary" />}
                  {!!c.nirf_rank && <Pill label={`NIRF #${c.nirf_rank}`} tone="success" />}
                </View>
              </View>
              <TouchableOpacity onPress={() => unsave(c)} style={{ padding: spacing(1) }}>
                <Feather name="trash-2" size={16} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  banner: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), marginBottom: spacing(3) },
  bannerTitle: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  upBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing(1), backgroundColor: colors.achiever,
    paddingHorizontal: spacing(3), paddingVertical: spacing(2), borderRadius: radius.md },
  upText: { color: colors.onPrimary, fontSize: font.xs, fontWeight: '800' },
  name: { fontSize: font.md, fontWeight: '700', color: colors.text },
});
