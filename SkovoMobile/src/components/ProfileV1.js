// ── Profile additions (feature-updates.md §2, §16): journey across stages,
//    download my data, delete my account. ─────────────────────────────────────
import React, { useEffect, useState } from 'react';
import { View, TextInput, Share, Modal, Pressable } from 'react-native';
import { useTheme } from '../theme';
import { Card, Button, useToast } from './ui';
import { T } from './v1';
import { studentApi } from '../services/api';
import { useAuth } from '../context/AuthContext';

function recapText(x) {
  const r = x.best_rank || {};
  const bits = [`My ${x.stage_label} on SKOVO 🎓`, `Readiness score ${x.final_score ?? 0}${x.final_level ? ` (${x.final_level})` : ''}`];
  if (x.stage_best_streak) bits.push(`Best streak ${x.stage_best_streak} days 🔥`);
  if (r.league_best_tier) bits.push(`${r.league_best_tier} league${r.league_best_rank ? `, best rank #${r.league_best_rank}` : ''}`);
  (r.hall_of_fame || []).slice(0, 1).forEach((h) => bits.push(`Hall of Fame #${h.rank} (${h.scope})`));
  if (x.tasks_completed) bits.push(`${x.tasks_completed} tasks · ${x.cohorts_completed || 0} cohorts`);
  return bits.join('\n');
}

// Season recap card for a closed stage (§10) — shareable.
function RecapCard({ x, onClose }) {
  const r = x.best_rank || {};
  const badges = Array.isArray(x.badges) ? x.badges : [];
  const Stat = ({ label, value }) => (
    <View style={{ width: '48%', padding: 10, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.15)' }}>
      <T size={11} color="#e0e7ff">{label}</T><T size={17} bold color="#fff">{value}</T>
    </View>
  );
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: 20 }} onPress={onClose}>
        <Pressable style={{ borderRadius: 24, padding: 20, backgroundColor: '#5b21b6', gap: 12 }}>
          <T size={12} color="#ddd6fe">SKOVO · {x.started_at?.slice(0, 4)}{x.ended_at ? `–${x.ended_at.slice(0, 4)}` : ''}</T>
          <T size={24} bold color="#fff">{x.stage_label}</T>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 8 }}>
            <Stat label="Readiness score" value={`${x.final_score ?? 0}${x.final_level ? ` · ${x.final_level}` : ''}`} />
            <Stat label="Best streak" value={`${x.stage_best_streak || 0} 🔥`} />
            <Stat label="Best league" value={r.league_best_tier ? `${r.league_best_tier}${r.league_best_rank ? ` #${r.league_best_rank}` : ''}` : '—'} />
            <Stat label="Tasks · cohorts" value={`${x.tasks_completed || 0} · ${x.cohorts_completed || 0}`} />
          </View>
          {(r.hall_of_fame || []).length > 0 && <T color="#fff">🏆 Hall of Fame: {r.hall_of_fame.map((h) => `#${h.rank} ${h.scope}`).join(', ')}</T>}
          {badges.length > 0 && <T size={12} color="#ede9fe">Earned: {badges.slice(0, 8).join(' · ')}</T>}
          <Button title="Share my recap" variant="inverse" onPress={() => Share.share({ message: recapText(x) })} />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function CareerTimeline() {
  const { colors } = useTheme();
  const [d, setD] = useState(null);
  const [recap, setRecap] = useState(null);
  useEffect(() => { studentApi.get('/profile/stages').then(({ data }) => data?.bool && setD(data.response)).catch(() => {}); }, []);
  if (!d?.timeline?.length) return null;
  return (
    <Card style={{ marginTop: 16 }}>
      <T bold style={{ marginBottom: 8 }}>My journey</T>
      {d.timeline.map((x) => (
        <View key={x.id} style={{ borderLeftWidth: 2, borderLeftColor: x.status === 'active' ? colors.primary : colors.border, paddingLeft: 10, marginBottom: 10 }}>
          <T bold>{x.stage_label}{x.sub_year ? ` · year ${x.sub_year}` : ''}</T>
          <T size={12} muted>{[x.board, x.stream, x.degree_type, x.branch, x.institute].filter(Boolean).join(' · ')}</T>
          <T size={11} muted>{x.started_at?.slice(0, 10)}{x.ended_at ? ` → ${x.ended_at.slice(0, 10)}` : ' → now'}</T>
          {x.status !== 'active' && x.final_score !== null && x.final_score !== undefined && (
            <T size={12}>Score {x.final_score}{x.final_level ? ` (${x.final_level})` : ''}{x.tasks_completed ? ` · ${x.tasks_completed} tasks` : ''}</T>
          )}
          {x.status !== 'active' && <Button title="View recap card" size="sm" variant="ghost" onPress={() => setRecap(x)} />}
        </View>
      ))}
      {recap && <RecapCard x={recap} onClose={() => setRecap(null)} />}
    </Card>
  );
}

export function DataRights() {
  const { colors } = useTheme();
  const toast = useToast();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [needWallet, setNeedWallet] = useState('');

  const download = async () => {
    const { data } = await studentApi.get('/profile/my-data');
    if (!data?.bool) { toast.error('Could not prepare your data.'); return; }
    Share.share({ title: 'skovo-my-data.json', message: JSON.stringify(data.response, null, 2) });
  };
  const del = async (forfeit) => {
    const { data } = await studentApi.post('/profile/delete-account', { confirm, forfeit_wallet: !!forfeit });
    if (data?.bool) { toast.success(data.response.message); logout(); return; }
    if (data?.response?.needs_wallet_decision) { setNeedWallet(data.response.message); return; }
    toast.error(data?.response?.message || 'Could not delete.');
  };

  return (
    <Card style={{ marginTop: 16, marginBottom: 24, gap: 8 }}>
      <T bold>My data</T>
      <Button title="Download my data" variant="outline" size="sm" onPress={download} />
      <Button title="Delete my account" variant="ghost" size="sm" onPress={() => setOpen((o) => !o)} />
      {open && (
        <View style={{ gap: 8, padding: 10, borderRadius: 10, backgroundColor: colors.dangerSoft }}>
          <T size={12} color={colors.danger}>This removes your profile, scores and streaks. Payment records are kept as the law requires. Type DELETE to confirm.</T>
          <TextInput value={confirm} onChangeText={setConfirm} autoCapitalize="characters" placeholderTextColor={colors.textMuted}
                     style={{ borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 10, color: colors.text, backgroundColor: colors.surface }} />
          {needWallet ? (
            <>
              <T size={12} color={colors.danger}>{needWallet}</T>
              <Button title="Give up my wallet balance and delete" variant="danger" size="sm" onPress={() => del(true)} />
            </>
          ) : <Button title="Delete forever" variant="danger" size="sm" disabled={confirm !== 'DELETE'} onPress={() => del(false)} />}
        </View>
      )}
    </Card>
  );
}
