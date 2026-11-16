// ── Market — curated student deals (student) ─────────────────────────────────
// Brand offers and tool discounts. Pro-only deals show locked until the student
// upgrades; tapping a live deal reveals the coupon code and opens the offer.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, Linking, ScrollView, Modal, Share } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Loader, Empty, Pill, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

export default function MarketScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();
  const [deals, setDeals] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [redeemed, setRedeemed] = useState(null);

  const load = useCallback(() => {
    const qs = category ? `?category=${encodeURIComponent(category)}` : '';
    studentApi.get(`/market/${qs}`)
      .then(({ data: d }) => {
        if (d.bool) {
          setDeals(d.response.deals || []);
          setCategories(d.response.categories || []);
        }
      })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, [category]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const redeem = async (deal) => {
    if (deal.locked) { navigation.navigate('SkovoPro'); return; }
    try {
      const { data: d } = await studentApi.post(`/market/${deal.id}/redeem`, {});
      if (d.bool) setRedeemed({ deal, ...d.response });
    } catch { /* silent — the list stays usable */ }
  };

  // No clipboard module in this build — share sheet doubles as "copy".
  const shareCode = () => {
    if (!redeemed?.coupon_code) return;
    Share.share({ message: `${redeemed.coupon_code} — ${redeemed.deal.title} on SKOVO Market` })
      .catch(() => {});
  };

  if (loading) return <Screen><Loader label="Loading deals…" /></Screen>;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1>Market</H1>
      <Muted style={{ marginBottom: spacing(4) }}>
        Student-only deals on the tools and brands you actually use
      </Muted>

      {categories.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: spacing(4) }}>
          {['', ...categories.map((c) => c.category)].map((c) => (
            <TouchableOpacity
              key={c || 'all'}
              onPress={() => setCategory(c)}
              style={[s.chip, category === c && s.chipOn]}
            >
              <Text style={[s.chipText, category === c && s.chipTextOn]}>{c || 'All'}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      {deals.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load the deals"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="shopping-bag" title="No deals right now"
               subtitle="New student offers land here regularly — check back soon" />
        )
      ) : (
        deals.map((d) => (
          <Card key={d.id} style={{ padding: 0, overflow: 'hidden', marginBottom: spacing(3) }}>
            <View style={s.banner}>
              {d.image_url
                ? <Image source={{ uri: d.image_url }} style={s.bannerImg} resizeMode="cover" />
                : <Feather name="shopping-bag" size={28} color={colors.textSubtle} />}
              {!!d.discount_label && (
                <View style={s.discount}><Text style={s.discountText}>{d.discount_label}</Text></View>
              )}
              {!!d.is_pro_only && (
                <View style={s.pro}>
                  <Feather name="award" size={11} color={colors.onPrimary} />
                  <Text style={s.proText}>PRO</Text>
                </View>
              )}
            </View>

            <View style={{ padding: spacing(4) }}>
              {!!d.brand && <Text style={s.brand}>{d.brand.toUpperCase()}</Text>}
              <H2 style={{ marginTop: 2 }}>{d.title}</H2>
              {!!d.description && (
                <Muted style={{ marginTop: spacing(1) }} numberOfLines={2}>{d.description}</Muted>
              )}

              <View style={s.metaRow}>
                {!!d.category && <Pill label={d.category} tone="neutral" />}
                {!!d.ends_at && (
                  <Muted style={{ fontSize: font.xs }}>
                    Ends {new Date(d.ends_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </Muted>
                )}
              </View>

              <Button
                title={d.locked ? 'Unlock with Pro' : 'Get deal'}
                icon={d.locked ? 'lock' : 'external-link'}
                variant={d.locked ? 'outline' : 'primary'}
                accent={d.locked ? colors.achiever : colors.primary}
                onPress={() => redeem(d)}
                style={{ marginTop: spacing(3) }}
              />
            </View>
          </Card>
        ))
      )}

      <Modal visible={!!redeemed} transparent animationType="fade" onRequestClose={() => setRedeemed(null)}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            <H2>{redeemed?.deal?.title}</H2>
            {!!redeemed?.deal?.brand && <Muted style={{ marginTop: 2 }}>{redeemed.deal.brand}</Muted>}

            {!!redeemed?.coupon_code && (
              <View style={{ marginTop: spacing(5) }}>
                <Text style={s.codeLabel}>Your coupon code</Text>
                <TouchableOpacity style={s.code} onPress={shareCode}>
                  <Text style={s.codeText} selectable>{redeemed.coupon_code}</Text>
                  <Feather name="share-2" size={16} color={colors.textSubtle} />
                </TouchableOpacity>
                <Muted style={{ fontSize: font.xs, marginTop: spacing(1.5) }}>
                  Long-press to copy, or tap to share it to yourself.
                </Muted>
              </View>
            )}

            <Button
              title={`Continue to ${redeemed?.deal?.brand || 'offer'}`}
              icon="external-link"
              onPress={() => { Linking.openURL(redeemed.deal_url); setRedeemed(null); }}
              style={{ marginTop: spacing(5) }}
            />
            <Button title="Close" variant="ghost" onPress={() => setRedeemed(null)}
                    style={{ marginTop: spacing(2) }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  chip: {
    paddingHorizontal: spacing(4), paddingVertical: spacing(2), borderRadius: radius.pill,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginRight: spacing(2),
  },
  chipOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  chipTextOn: { color: colors.onPrimary },

  banner: {
    height: 128, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center',
  },
  bannerImg: { width: '100%', height: '100%' },
  discount: {
    position: 'absolute', top: spacing(3), left: spacing(3),
    backgroundColor: colors.success, paddingHorizontal: spacing(2.5), paddingVertical: spacing(1),
    borderRadius: radius.sm,
  },
  discountText: { color: colors.onPrimary, fontSize: font.xs, fontWeight: '800' },
  pro: {
    position: 'absolute', top: spacing(3), right: spacing(3), flexDirection: 'row', alignItems: 'center',
    gap: 3, backgroundColor: colors.achiever, paddingHorizontal: spacing(2.5), paddingVertical: spacing(1),
    borderRadius: radius.sm,
  },
  proText: { color: colors.onPrimary, fontSize: font.xs, fontWeight: '800' },

  brand: { fontSize: font.xs, fontWeight: '700', color: colors.textSubtle, letterSpacing: 0.6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(3) },

  modalWrap: {
    flex: 1, backgroundColor: colors.overlay, alignItems: 'center', justifyContent: 'center',
    padding: spacing(5),
  },
  modal: {
    width: '100%', backgroundColor: colors.surface, borderRadius: radius.lg,
    padding: spacing(6), ...shadow.card,
  },
  codeLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, marginBottom: spacing(2) },
  code: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderStyle: 'dashed', borderColor: colors.border, borderRadius: radius.md,
    paddingHorizontal: spacing(4), paddingVertical: spacing(3),
  },
  codeText: { fontSize: font.md, fontWeight: '800', color: colors.text, letterSpacing: 1.5 },
});
