// ── College Predictor (student) ──────────────────────────────────────────────
// Rank in, colleges out, sorted into Safe / Target / Reach — the language a
// counsellor uses, so the list reads as advice rather than a raw cutoff table.
//
// The exam list is derived from the cutoff data itself, not from a master
// table: offering an exam we hold no cutoffs for would promise an answer the
// data cannot give. Reservation categories do come from masters, because the
// same values are stored on profiles and compared by the scholarship matcher.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Button, Input, Loader, Empty, Pill, Select, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';

const BUCKETS = {
  safe:   { label: 'Safe',   blurb: "Comfortably inside last year's cutoff", icon: 'shield',    tone: 'success' },
  target: { label: 'Target', blurb: 'You make it, but it is close',          icon: 'crosshair', tone: 'primary' },
  reach:  { label: 'Reach',  blurb: 'Just outside — worth a shot',           icon: 'send',      tone: 'warning' },
};

function CollegeRow({ c, tone }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  return (
    <View style={s.row}>
      <View style={{ flex: 1, paddingRight: spacing(3) }}>
        <Text style={s.college} numberOfLines={1}>{c.college_name}</Text>
        <Muted style={{ fontSize: font.xs }} numberOfLines={1}>{c.branch_name}</Muted>
        {!!(c.city || c.state) && (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
            <Feather name="map-pin" size={10} color={colors.textSubtle} />
            <Muted style={{ fontSize: font.xs }}>
              {[c.city, c.state].filter(Boolean).join(', ')}
            </Muted>
          </View>
        )}
      </View>
      <View style={{ alignItems: 'flex-end' }}>
        <Muted style={{ fontSize: font.xs, textTransform: 'uppercase' }}>Closing rank</Muted>
        <Text style={[s.rank, { color: colors[tone] || colors.text }]}>
          {Number(c.closing_rank || 0).toLocaleString('en-IN')}
        </Text>
        <Muted style={{ fontSize: font.xs }}>{c.category}</Muted>
      </View>
    </View>
  );
}

export default function CollegePredictorScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const { lists } = useMasters(['category']);
  const [exams, setExams] = useState([]);
  const [exam, setExam] = useState('');
  const [rank, setRank] = useState('');
  const [category, setCategory] = useState('general');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [booting, setBooting] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    studentApi.get('/colleges/predict/exams')
      .then(({ data: d }) => {
        if (!d.bool) return;
        const list = d.response.exams || [];
        setExams(list);
        if (list.length) setExam(list[0].exam);
      })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => setBooting(false));
  }, []);

  const predict = useCallback(async () => {
    if (!exam || !rank) return;
    setLoading(true); setError(''); setResult(null);
    try {
      const { data: d } = await studentApi.post('/colleges/predict', {
        exam, rank: Number(rank), category,
      });
      if (d.bool) setResult(d.response);
      else setError(d.response?.message || 'Could not run the prediction.');
    } catch {
      setError('Could not run the prediction.');
    } finally {
      setLoading(false);
    }
  }, [exam, rank, category]);

  if (booting) return <Screen><Loader label="Loading exams…" /></Screen>;

  // The API returns the three buckets as separate arrays, already sorted.
  const buckets = result ? ['safe', 'target', 'reach'].map((k) => [k, result[k] || []]) : [];
  const found = result?.total ?? 0;

  return (
    <Screen scroll>
      <H1>College Predictor</H1>
      <Muted style={{ marginBottom: spacing(4) }}>See which colleges your rank can reach</Muted>

      <Card>
        <Select
          label="Exam" icon="file-text" required value={exam} onChange={setExam}
          options={exams.map((x) => ({ value: x.exam, label: `${x.exam} (${x.colleges})` }))}
          placeholder={exams.length ? 'Search exams…' : 'No cutoff data loaded yet'}
          hint={exams.length ? undefined : 'The predictor needs cutoff data to answer.'}
        />
        <Input
          label="Your rank" icon="hash" value={rank} onChangeText={(t) => setRank(t.replace(/\D/g, ''))}
          placeholder="e.g. 5000" keyboardType="number-pad"
        />
        <Select
          label="Reservation category" icon="users" required
          value={category} onChange={setCategory}
          options={lists.category} placeholder="Search categories…"
        />
        <Button title={loading ? 'Predicting…' : 'Predict my colleges'} icon="target"
                onPress={predict} loading={loading} disabled={!exam || !rank || loading} />
        {!!error && <Text style={s.err}>{error}</Text>}
      </Card>

      {/* Coverage first. A short list because we hold few cutoffs is a very
          different message from a short list because the rank is out of range,
          and a student cannot tell them apart without being told. The server
          already words this for each confidence level — don't reword it here. */}
      {!!result?.message && (
        <View style={[s.coverage, result.confidence === 'low' && s.coverageWarn]}>
          <Feather name={result.confidence === 'usable' ? 'info' : 'alert-triangle'} size={13}
                   color={result.confidence === 'usable' ? colors.textMuted : colors.warning} />
          <Muted style={{ flex: 1, fontSize: font.xs }}>{result.message}</Muted>
        </View>
      )}

      {result && found === 0 && (
        <Empty icon="search" title="No matches for this combination"
               subtitle="Try a nearby rank, or another category — we may not hold cutoffs for this one yet." />
      )}

      {buckets.map(([kind, list]) => {
        if (!list.length) return null;
        const b = BUCKETS[kind];
        return (
          <View key={kind} style={{ marginTop: spacing(4) }}>
            <View style={s.bucketHead}>
              <Feather name={b.icon} size={15} color={colors[b.tone] || colors.primary} />
              <Text style={s.bucketTitle}>{b.label}</Text>
              <Pill label={String(list.length)} tone={b.tone} />
            </View>
            <Muted style={{ fontSize: font.xs, marginBottom: spacing(2) }}>{b.blurb}</Muted>
            <Card style={{ padding: 0 }}>
              {list.map((c, i) => (
                <View key={`${c.college_name}-${c.branch_name}-${c.category}-${i}`}
                      style={i < list.length - 1 ? s.rowBorder : null}>
                  <CollegeRow c={c} tone={b.tone} />
                </View>
              ))}
            </Card>
          </View>
        );
      })}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  label: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted, marginBottom: spacing(2) },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipTxt: { fontSize: font.sm, fontWeight: font.semibold, color: colors.textMuted },
  chipTxtOn: { color: colors.primaryDark },
  err: { color: colors.danger, fontSize: font.sm, marginTop: spacing(2) },
  coverage: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(4),
    padding: spacing(3), borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  coverageWarn: { backgroundColor: colors.warningSoft },
  bucketHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2) },
  bucketTitle: { fontSize: font.md, fontWeight: font.bold, color: colors.text, flex: 1 },
  row: { flexDirection: 'row', alignItems: 'flex-start', padding: spacing(3.5) },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  college: { fontSize: font.sm, fontWeight: font.bold, color: colors.text },
  rank: { fontSize: font.md, fontWeight: font.bold },
});
