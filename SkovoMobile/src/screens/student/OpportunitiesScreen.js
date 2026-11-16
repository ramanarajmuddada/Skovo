// ── Opportunities — jobs / internships (student) ─────────────────────────────
// Score-gated: below the floor the hub is locked and shows the path to unlock.
// Above it, free users can browse + shortlist; applying is Skovo Pro.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Pill, Loader, Empty, Card, Button, Input, Sheet, ErrorState, Chip, ChipRow } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';

const TYPE_TONE = { internship: 'info', 'full_time': 'success', 'full-time': 'success', part_time: 'warning', fresher: 'primary' };
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null;

function HubLocked({ gate }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const pct = Math.min(100, Math.round((gate.your_score / gate.required_score) * 100));
  return (
    <Card style={{ alignItems: 'center', paddingVertical: spacing(7) }}>
      <View style={styles.lockIcon}><Feather name="lock" size={24} color={colors.textSubtle} /></View>
      <H2 style={{ marginTop: spacing(4), textAlign: 'center' }}>The Opportunity Hub is locked</H2>
      <Muted style={{ textAlign: 'center', marginTop: spacing(2) }}>
        Jobs and internships open at a readiness score of {gate.required_score}. You are{' '}
        {gate.points_away} point(s) away.
      </Muted>
      <View style={styles.gateBar}>
        <View style={[styles.gateFill, { width: `${pct}%` }]} />
      </View>
      <Text style={styles.gateNums}>{gate.your_score} / {gate.required_score}</Text>
      <Button title="Raise my score" icon="trending-up"
              onPress={() => navigation.navigate('MyScore')} style={{ marginTop: spacing(5) }} />
    </Card>
  );
}

/** Apply to an opportunity. Offers the student's Document Vault files first —
 *  same one-tap flow as web — with a resume link as the fallback. */
function ApplySheet({ opp, onClose, onApplied }) {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const navigation = useNavigation();
  const [docs, setDocs] = useState([]);
  const [docId, setDocId] = useState(null);
  const [resumeLink, setResumeLink] = useState('');
  const [coverNote, setCoverNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsPro, setNeedsPro] = useState(false);

  useEffect(() => {
    let alive = true;
    studentApi.get('/document-vault/')
      .then(({ data }) => { if (alive && data.bool) setDocs(data.response.documents || []); })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true));
    return () => { alive = false; };
  }, []);

  const submit = async () => {
    setBusy(true); setError(''); setNeedsPro(false);
    try {
      const { data } = await studentApi.post('/applications/', {
        opportunity_id: opp.id,
        document_id: docId || undefined,
        resume_link: resumeLink.trim() || undefined,
        cover_note: coverNote.trim() || undefined,
      });
      if (data.bool) { onApplied(); onClose(); Alert.alert('Applied', 'Your application was sent.'); }
      else { setError(data.response?.message || 'Application failed.'); setNeedsPro(!!data.response?.requires_pro); }
    } catch { setError('Could not submit. Please check your connection.'); }
    finally { setBusy(false); }
  };

  return (
    <Sheet
      onClose={onClose}
      title={`Apply — ${opp.title}`}
      subtitle={opp.company}
      height="82%"
      footer={
        needsPro ? (
          <Button title="Get Skovo Pro" icon="award" style={{ flex: 1 }}
                  onPress={() => { onClose(); navigation.navigate('SkovoPro'); }} />
        ) : (
          <Button title="Submit Application" icon="send" loading={busy} onPress={submit} style={{ flex: 1 }} />
        )
      }
    >
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {error ? (
          <View style={styles.errBox}>
            <Feather name={needsPro ? 'award' : 'alert-circle'} size={14} color={colors.danger} />
            <Text style={styles.errText}>{error}</Text>
          </View>
        ) : null}

        <Text style={styles.label}>Attach from Document Vault</Text>
        {docs.length === 0 ? (
          <Muted style={{ marginBottom: spacing(3) }}>
            No documents saved yet — paste a resume link below instead.
          </Muted>
        ) : (
          <View style={{ marginBottom: spacing(3) }}>
            {docs.map((d) => {
              const sel = docId === d.id;
              return (
                <TouchableOpacity key={d.id} onPress={() => setDocId(sel ? null : d.id)}
                                  style={[styles.docRow, sel && styles.docRowSel]}>
                  <Feather name={sel ? 'check-circle' : 'file-text'} size={16}
                           color={sel ? colors.primary : colors.textSubtle} />
                  <Text style={[styles.docName, sel && { color: colors.primary, fontWeight: font.bold }]}
                        numberOfLines={1}>
                    {d.title || d.file_name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}

        <Text style={styles.label}>Resume link {docId ? '(optional)' : ''}</Text>
        <Input icon="link" placeholder="https://drive.google.com/…" autoCapitalize="none"
               keyboardType="url" value={resumeLink} onChangeText={setResumeLink} />

        <Text style={styles.label}>Cover note</Text>
        <Input icon="message-square" placeholder="Why you are a good fit for this role"
               value={coverNote} onChangeText={setCoverNote} multiline />
      </ScrollView>
    </Sheet>
  );
}

export default function OpportunitiesScreen() {
  const { colors, gradients, shadow } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const navigation = useNavigation();
  const [list, setList] = useState([]);
  const [gate, setGate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  // Same filter the web screen offers, off the same master.
  const { lists } = useMasters(['opportunity_type']);
  const [type, setType] = useState('all');
  const [applying, setApplying] = useState(null);

  const load = useCallback(() => {
    studentApi.get('/opportunities/', { page: 1, per_page: 30 })
      .then(({ data }) => {
        if (data.bool) { setList(data.response.opportunities || []); setGate(data.response.hub_gate || null); }
      })
      .catch(() => {})
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleShortlist = async (o) => {
    const next = !o.is_shortlisted;
    setList((prev) => prev.map((x) => x.id === o.id ? { ...x, is_shortlisted: next } : x));
    try {
      if (next) await studentApi.post(`/opportunities/${o.id}/shortlist`, {});
      else await studentApi.delete(`/opportunities/${o.id}/shortlist`);
    } catch { setList((prev) => prev.map((x) => x.id === o.id ? { ...x, is_shortlisted: !next } : x)); }
  };

  const shown = list
    .filter((o) => (savedOnly ? o.is_shortlisted : true))
    .filter((o) => (type === 'all' ? true : o.type === type));

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <H1 style={{ marginBottom: spacing(2) }}>Opportunities</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Fresher jobs, internships & more</Muted>

      {loading ? <Loader label="Loading opportunities…" /> : gate?.locked ? (
        <HubLocked gate={gate} />
      ) : list.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load opportunities"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="briefcase" title="No opportunities yet" subtitle="Check back soon" />
        )
      ) : (
        <View style={{ gap: spacing(3) }}>
          <ChipRow wrap>
            <Chip label="All" on={!savedOnly} onPress={() => setSavedOnly(false)} />
            <Chip label="Shortlisted" icon="bookmark" on={savedOnly} onPress={() => setSavedOnly(true)} />
          </ChipRow>
          <ChipRow>
            {[{ value: 'all', label: 'All types' }, ...(lists.opportunity_type || [])].map((o) => (
              <Chip key={o.value} label={o.label} on={type === o.value} onPress={() => setType(o.value)} />
            ))}
          </ChipRow>

          {shown.map((o) => (
            <View key={o.id} style={styles.card}>
              <View style={styles.head}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={2}>{o.title}</Text>
                  <Text style={styles.company}>{o.company}</Text>
                </View>
                <TouchableOpacity onPress={() => toggleShortlist(o)} style={{ padding: spacing(1) }}>
                  <Feather name="bookmark" size={18}
                           color={o.is_shortlisted ? colors.primary : colors.textSubtle}
                           style={o.is_shortlisted ? { opacity: 1 } : { opacity: 0.6 }} />
                </TouchableOpacity>
                {!!o.type && <Pill label={(o.type || '').replace('_', ' ')} tone={TYPE_TONE[o.type] || 'neutral'} />}
              </View>
              <View style={styles.metaRow}>
                {(o.location || o.is_remote) && (
                  <Text style={styles.meta}>
                    <Feather name="map-pin" size={11} color={colors.textSubtle} /> {o.location || 'Anywhere'}{o.is_remote ? ' · Remote' : ''}
                  </Text>
                )}
                {o.stipend_min ? (
                  <Text style={styles.stipend}>₹{o.stipend_min}{o.stipend_max ? `–${o.stipend_max}` : ''}/mo</Text>
                ) : null}
              </View>
              <View style={styles.footRow}>
                {o.deadline ? (
                  <Text style={styles.deadline}>
                    <Feather name="clock" size={10} color={colors.warning} /> Apply by {fmtDate(o.deadline)}
                  </Text>
                ) : <View />}
                <TouchableOpacity style={styles.applyBtn} onPress={() => setApplying(o)}>
                  <Feather name="send" size={12} color={colors.onPrimary} />
                  <Text style={styles.applyText}>Apply</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      {applying ? (
        <ApplySheet opp={applying} onClose={() => setApplying(null)} onApplied={load} />
      ) : null}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing(4), ...shadow.card },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  lockIcon: { width: 56, height: 56, borderRadius: radius.lg, backgroundColor: colors.surfaceAlt,
    alignItems: 'center', justifyContent: 'center' },
  gateBar: { width: '100%', height: 8, borderRadius: 4, backgroundColor: colors.surfaceAlt,
    marginTop: spacing(4), overflow: 'hidden' },
  gateFill: { height: '100%', borderRadius: 4, backgroundColor: colors.primary },
  gateNums: { fontSize: font.sm, fontWeight: '800', color: colors.textMuted, marginTop: spacing(2) },
  title: { fontSize: font.base, fontWeight: font.bold, color: colors.text },
  company: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, flexWrap: 'wrap' },
  meta: { fontSize: font.xs, color: colors.textMuted },
  stipend: { fontSize: font.xs, fontWeight: font.bold, color: colors.success },
  deadline: { fontSize: font.xs, color: colors.warning, fontWeight: font.semibold },
  footRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 },
  applyBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.primary,
    paddingHorizontal: 14, paddingVertical: 10, minHeight: 40, borderRadius: radius.pill },
  applyText: { color: colors.onPrimary, fontSize: font.sm, fontWeight: font.bold },

  label: { fontSize: font.sm, fontWeight: font.bold, color: colors.text, marginBottom: spacing(2), marginTop: spacing(1) },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface,
    borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(2),
    borderWidth: 1.5, borderColor: 'transparent', ...shadow.soft },
  docRowSel: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  docName: { flex: 1, fontSize: font.sm, color: colors.text },
  errBox: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, backgroundColor: colors.dangerSoft,
    borderRadius: radius.md, padding: spacing(3), marginBottom: spacing(3) },
  errText: { flex: 1, fontSize: font.sm, color: colors.danger, lineHeight: 19 },
});
