import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { H1, Muted, Pill, Loader, Empty, ErrorState, BackButton } from '../../components/ui';
import { studentApi } from '../../services/api';

function CourseCard({ c, onPress }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      <View style={styles.thumb}><Feather name="play-circle" size={24} color={colors.info} /></View>
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.title} numberOfLines={2}>{c.title}</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {c.level ? <Pill label={c.level} tone="info" /> : null}
          {c.duration_weeks ? <Muted>{c.duration_weeks} wks</Muted> : null}
        </View>
      </View>
      <Text style={styles.price}>
        {!c.price ? 'Free'
          : c.effective_price != null && c.effective_price < c.price
            ? <><Text style={styles.priceStrike}>₹{Number(c.price).toLocaleString()} </Text>₹{Number(c.effective_price).toLocaleString()}</>
            : `₹${Number(c.price).toLocaleString()}`}
      </Text>
    </TouchableOpacity>
  );
}

export default function CoursesScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The await was unguarded: a thrown request meant setLoading(false)
      // never ran and the screen span forever.
      const { data } = await studentApi.get('/courses/');
      if (data.bool) { setItems(data.response.courses || []); setFailed(false); }
      else setFailed(true);
    } catch { setFailed(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={styles.topbar}>
        <BackButton onPress={() => navigation.goBack()} />
        <Text style={styles.topTitle}>Courses</Text>
        <View style={{ width: 44 }} />
      </View>
      <View style={{ flex: 1, paddingHorizontal: spacing(5) }}>
        <H1>Courses</H1>
        <Muted style={{ marginTop: 4, marginBottom: spacing(4) }}>Self-paced learning by achievers</Muted>
        {loading ? <Loader /> : failed ? (
          <ErrorState title="We couldn't load the courses"
                      subtitle="Nothing is lost — this is a connection problem."
                      onRetry={load} />
        ) : (
          <FlatList
            data={items}
            keyExtractor={(it) => it.id}
            renderItem={({ item }) => <CourseCard c={item} onPress={() => navigation.navigate('CourseDetail', { id: item.id })} />}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: spacing(10) }}
            ListEmptyComponent={<Empty icon="book-open" title="No courses yet" subtitle="Check back soon." />}
          />
        )}
      </View>
    </SafeAreaView>
  );
}

const makeStyles = (colors, shadow) => ({
  topbar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing(5), paddingVertical: spacing(3) },
  topTitle: { fontSize: font.md, fontWeight: font.bold, color: colors.text },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), marginBottom: spacing(3), ...shadow.card },
  thumb: { width: 48, height: 48, borderRadius: 14, backgroundColor: colors.infoSoft, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: font.base, fontWeight: font.bold, color: colors.text, lineHeight: 22 },
  price: { fontSize: font.md, fontWeight: font.black, color: colors.text, marginLeft: 8 },
  priceStrike: { fontSize: font.xs, fontWeight: font.regular, color: colors.textSubtle, textDecorationLine: 'line-through' },
});
