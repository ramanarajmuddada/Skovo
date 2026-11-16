import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Avatar, Pill, Loader, Empty, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';

function MentorCard({ m, onPress }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const rate = Number(m.session_rate || 0);
  return (
    <TouchableOpacity activeOpacity={0.9} style={styles.card} onPress={onPress}>
      <Avatar name={m.full_name} size={52} color={colors.achiever} />
      <View style={{ flex: 1, marginLeft: 14 }}>
        <Text style={styles.name} numberOfLines={1}>{m.full_name}</Text>
        {m.designation ? <Muted numberOfLines={1}>{m.designation}{m.company ? ` @ ${m.company}` : ''}</Muted> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 }}>
          {m.is_verified ? <Pill label="Verified" tone="success" /> : null}
          {Array.isArray(m.domains) && m.domains[0] ? <Pill label={m.domains[0]} tone="achiever" /> : null}
        </View>
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Text style={styles.rate}>{rate > 0 ? `₹${rate.toLocaleString()}` : 'Free'}</Text>
        <Muted style={{ fontSize: font.xs }}>{rate > 0 ? '/session' : ''}</Muted>
        <View style={styles.book}><Feather name="arrow-right" size={15} color="#fff" /></View>
      </View>
    </TouchableOpacity>
  );
}

export default function MentorsScreen({ navigation }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [refreshing, setRefreshing] = useState(false);

  // `quiet` keeps the list on screen during a pull-to-refresh; flipping
  // `loading` would blank the rows the student is holding.
  const load = useCallback(async (quiet) => {
    if (!quiet) setLoading(true);
    try {
      const { data } = await studentApi.get('/achievers/');
      if (data.bool) {
        setItems(data.response.achievers || data.response.mentors || []);
        setFailed(false);
      } else setFailed(true);
    } catch { setFailed(true); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Availability changes on the achiever's side, so the student needs to be
  // able to ask again rather than restart the app.
  const onRefresh = useCallback(() => { setRefreshing(true); load(true); }, [load]);

  return (
    <Screen>
      <H1>Find Mentors</H1>
      <Muted style={{ marginTop: 4, marginBottom: spacing(4) }}>Book a 1-on-1 with an achiever</Muted>
      {loading ? <Loader /> : failed ? (
        <ErrorState title="We couldn't load the achievers"
                    subtitle="Nothing is lost — this is a connection problem."
                    onRetry={load} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id || it.mentor_id}
          renderItem={({ item }) => <MentorCard m={item} onPress={() => navigation.navigate('MentorBooking', { mentor: item })} />}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: spacing(20) }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
          }
          ListEmptyComponent={<Empty icon="users" title="No mentors yet" subtitle="Check back soon." />}
        />
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), marginBottom: spacing(3), ...shadow.card },
  name: { fontSize: font.md, fontWeight: font.bold, color: colors.text },
  rate: { fontSize: font.md, fontWeight: font.black, color: colors.text },
  book: { width: 44, height: 44, borderRadius: 12, backgroundColor: colors.achiever, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
});
