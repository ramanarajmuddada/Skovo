// ── Assemble / Peer Communities (student) ────────────────────────────────────
// Browse, join and start communities. Direct messages live on the Messages
// screen (Skovo Pro).
//
// The free tier allows being in three communities. Creating one puts you in it,
// so it spends a slot the same way joining does — one rule, one counter, and
// the meter is shown up front rather than after a student picks a community and
// gets refused.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, FlatList, TextInput, Alert, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Loader, Empty, Pill, Avatar, Select, Input, ErrorState, useToast } from '../../components/ui';
import CommunityChat from '../../components/CommunityChat';
import { studentApi } from '../../services/api';
import { useMasters } from '../../hooks/useMasters';
import { useAuth } from '../../context/AuthContext';

/* ── Create ────────────────────────────────────────────────────────────────── */
function CreateModal({ onClose, onCreated, onNeedsPro }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const { lists } = useMasters(['community_category', 'community_join_policy']);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('general');
  const [joinType, setJoinType] = useState('open');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (name.trim().length < 3) { setError('Give your community a name of at least 3 characters.'); return; }
    setSaving(true); setError('');
    try {
      const { data: d } = await studentApi.post('/assemble/groups', {
        name, description, category, join_type: joinType,
      });
      if (d.bool) onCreated(d.response.group, d.response.quota, d.response.message);
      else if (d.response?.requires_pro) onNeedsPro(d.response);
      else setError(d.response?.message || 'Could not create the community.');
    } catch {
      setError('Could not create the community.');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <View style={[s.sheet, { height: '85%' }]}>
          <View style={s.sheetHead}>
            <H2 style={{ flex: 1 }}>Start a community</H2>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            <Input label="Community name" required icon="users"
                   value={name} onChangeText={setName}
                   placeholder="e.g. JEE 2027 Dropper Batch"
                   hint="Other students see this when they browse." />

            <Input label="What is it for?" icon="align-left" multiline
                   value={description} onChangeText={setDescription}
                   placeholder="Who should join, and what you'll share here." />

            <Select label="Category" icon="grid" required
                    value={category} onChange={setCategory}
                    options={lists.community_category} placeholder="Search categories…" />

            <Select label="Who can join?" icon="shield" required
                    value={joinType} onChange={setJoinType}
                    options={lists.community_join_policy} placeholder="Pick a join rule" />
            <Muted style={s.hint}>Requests appear under Manage inside the community.</Muted>

            {!!error && <Text style={s.err}>{error}</Text>}
          </ScrollView>

          <Button title={saving ? 'Creating…' : 'Create community'} icon="plus"
                  onPress={submit} loading={saving} disabled={saving || name.trim().length < 3}
                  style={{ marginTop: spacing(3) }} />
        </View>
      </View>
    </Modal>
  );
}

/* ── Owner tools ───────────────────────────────────────────────────────────── */
function ManageTab({ group, onDeleted }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const toast = useToast();
  const [requests, setRequests] = useState([]);
  const [members, setMembers] = useState([]);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    studentApi.get(`/assemble/groups/${group.id}/requests`)
      .then(({ data: d }) => { if (d.bool) setRequests(d.response.requests || []); }).catch(() => {});
    studentApi.get(`/assemble/groups/${group.id}/members`)
      .then(({ data: d }) => { if (d.bool) setMembers(d.response.members || []); }).catch(() => {});
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const decide = async (id, approve) => {
    setBusy(id);
    try {
      const { data: d } = await studentApi.post(`/assemble/groups/${group.id}/requests/${id}`, { approve });
      if (d.bool) load(); else Alert.alert('Could not update', d.response?.message || '');
    } catch { toast.error('Connection problem — nothing was changed.'); }
    finally { setBusy(''); }
  };

  const remove = (id, nm) => Alert.alert('Remove member', `Remove ${nm} from ${group.name}?`, [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Remove', style: 'destructive', onPress: async () => {
        setBusy(id);
        try {
          const { data: d } = await studentApi.delete(`/assemble/groups/${group.id}/members/${id}`);
          if (d.bool) load(); else Alert.alert('Could not remove', d.response?.message || '');
        } catch { toast.error('Connection problem — the member was not removed.'); }
        finally { setBusy(''); }
      } },
  ]);

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={s.secTitle}>JOIN REQUESTS {requests.length ? `(${requests.length})` : ''}</Text>
      {requests.length === 0
        ? <Muted style={{ marginBottom: spacing(4) }}>Nothing waiting.</Muted>
        : requests.map((r) => (
            <View key={r.user_id} style={s.personRow}>
              <Avatar name={r.full_name} size={28} />
              <Text style={s.personName} numberOfLines={1}>{r.full_name}</Text>
              <Button title="Approve" size="sm" onPress={() => decide(r.user_id, true)} disabled={busy === r.user_id} />
              <Button title="Decline" size="sm" variant="ghost" onPress={() => decide(r.user_id, false)} disabled={busy === r.user_id} />
            </View>
          ))}

      <Text style={s.secTitle}>MEMBERS ({members.length})</Text>
      {members.map((m) => (
        <View key={m.user_id} style={s.personRow}>
          <Avatar name={m.full_name} size={28} />
          <Text style={s.personName} numberOfLines={1}>{m.full_name}</Text>
          {m.role === 'owner'
            ? <Pill label="OWNER" tone="warning" />
            : <Button title="Remove" size="sm" variant="ghost" onPress={() => remove(m.user_id, m.full_name)} disabled={busy === m.user_id} />}
        </View>
      ))}

      <Text style={[s.secTitle, { marginTop: spacing(4) }]}>DELETE COMMUNITY</Text>
      <Muted style={{ marginBottom: spacing(2) }}>
        Members leave, and the community disappears. This cannot be undone.
      </Muted>
      <Button title={busy === 'delete' ? 'Deleting…' : 'Delete community'} variant="danger"
              disabled={!!busy}
              onPress={() => Alert.alert('Delete community', `Delete ${group.name}? Members will be removed.`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: async () => {
                    setBusy('delete');
                    try {
                      const { data: d } = await studentApi.delete(`/assemble/groups/${group.id}`);
                      if (d.bool) onDeleted?.();
                      else Alert.alert('Could not delete', d.response?.message || '');
                    } catch { toast.error('Connection problem — the community was not deleted.'); }
                    finally { setBusy(''); }
                  } },
              ])} />
    </ScrollView>
  );
}

/* ── Posts + Manage ────────────────────────────────────────────────────────── */
function GroupModal({ group, onClose, navigation, myId, onDeleted }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const toast = useToast();
  const [tab, setTab] = useState(group.is_member ? 'chat' : 'posts');
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const isOwner = group.my_role === 'owner';

  const load = useCallback(() => {
    studentApi.get(`/assemble/groups/${group.id}/posts`)
      .then(({ data: d }) => { if (d.bool) setPosts(d.response.posts || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [group.id]);
  useEffect(() => { load(); }, [load]);

  const submit = async () => {
    if (!content.trim()) return;
    setPosting(true);
    try {
      const { data: d } = await studentApi.post(`/assemble/groups/${group.id}/posts`, { content });
      // No else before this: a refused post cleared nothing and said nothing,
      // so the student retyped it or assumed it had gone up.
      if (d.bool) { setContent(''); load(); }
      else toast.error(d.response?.message || "Your post couldn't be sent.");
    } catch { toast.error('Connection problem — your post was not sent.'); }
    finally { setPosting(false); }
  };

  // Your own post, or anything in a community you own — the server decides,
  // this only avoids offering a button that would be refused.
  const removePost = (id) => Alert.alert('Delete post', 'This cannot be undone.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Delete', style: 'destructive', onPress: async () => {
        try {
          const { data: d } = await studentApi.delete(`/assemble/posts/${id}`);
          if (d.bool) setPosts((p) => p.filter((x) => x.id !== id));
          else Alert.alert('Could not delete', d.response?.message || '');
        } catch { toast.error('Connection problem — the post was not deleted.'); }
      } },
  ]);

  const toggleLike = async (id) => {
    try {
      const { data: d } = await studentApi.post(`/assemble/posts/${id}/like`, {});
      if (d.bool) {
        setPosts((prev) => prev.map((x) => x.id === id
          ? { ...x, likes_count: d.response.likes_count, is_liked: d.response.action === 'liked' }
          : x));
      }
    } catch {
      // A like that silently fails leaves the heart in the wrong state until
      // the next reload, which reads as the app ignoring the tap.
      toast.error("Couldn't register that like.");
    }
  };

  // Pinning your own post is a Skovo Pro perk — send the student there on 403
  // rather than letting the tap look broken.
  const togglePin = async (id) => {
    try {
      const { data: d } = await studentApi.post(`/assemble/posts/${id}/pin`, {});
      if (d.bool) {
        setPosts((prev) => prev.map((x) => x.id === id ? { ...x, is_pinned: d.response.is_pinned } : x));
      } else if (d.response?.requires_pro) {
        onClose();
        navigation.navigate('SkovoPro');
      } else {
        Alert.alert('Could not pin', d.response?.message || 'Please try again.');
      }
    } catch { toast.error('Connection problem — the post was not pinned.'); }
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.sheetWrap}>
        <View style={s.sheet}>
          <View style={s.sheetHead}>
            <H2 style={{ flex: 1 }}>{group.name}</H2>
            <TouchableOpacity onPress={onClose}><Feather name="x" size={20} color={colors.textMuted} /></TouchableOpacity>
          </View>

          {group.is_member && (
            <View style={s.tabs}>
              {[['chat', 'Live chat'], ['posts', 'Posts'], ...(isOwner ? [['manage', 'Manage']] : [])].map(([k, l]) => (
                <TouchableOpacity key={k} onPress={() => setTab(k)} style={[s.tab, tab === k && s.tabOn]}>
                  <Text style={[s.tabTxt, tab === k && s.tabTxtOn]}>{l}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {group.is_member && tab === 'chat' ? <CommunityChat groupId={group.id} /> : isOwner && tab === 'manage' ? <ManageTab group={group} onDeleted={onDeleted} /> : (
            <>
              {loading ? <Loader /> : (
                <FlatList
                  data={posts}
                  keyExtractor={(p) => p.id}
                  ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: spacing(8) }}>No posts yet. Be the first!</Muted>}
                  renderItem={({ item: p }) => (
                    <Card style={{ marginBottom: spacing(2.5) }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }}>
                        <Avatar name={p.author?.full_name || 'U'} size={28} />
                        <Text style={s.author}>{p.author?.full_name || 'User'}</Text>
                        {p.is_pinned ? <Feather name="bookmark" size={13} color={colors.warning} /> : null}
                        <View style={{ flexDirection: 'row', gap: spacing(3), marginLeft: 'auto' }}>
                          {group.is_member && p.author?.id && p.author.id !== myId && (
                            <TouchableOpacity onPress={() => { onClose(); navigation.navigate('Messages', { peer: { id: p.author.id, name: p.author.full_name } }); }}>
                              <Feather name="mail" size={15} color={colors.textSubtle} />
                            </TouchableOpacity>
                          )}
                          {group.is_member && p.author?.id === myId && (
                            <TouchableOpacity onPress={() => togglePin(p.id)}>
                              <Feather name="bookmark" size={15}
                                       color={p.is_pinned ? colors.warning : colors.textSubtle} />
                            </TouchableOpacity>
                          )}
                          {group.is_member && (p.author?.id === myId || isOwner) && (
                            <TouchableOpacity onPress={() => removePost(p.id)}>
                              <Feather name="trash-2" size={15} color={colors.textSubtle} />
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                      <Text style={s.postBody}>{p.content}</Text>
                      {group.is_member && (
                        <TouchableOpacity onPress={() => toggleLike(p.id)} style={s.likeRow} hitSlop={6}>
                          <Feather name="heart" size={14}
                                   color={p.is_liked ? colors.danger : colors.textSubtle} />
                          <Text style={[s.likeText, p.is_liked && { color: colors.danger }]}>
                            {p.likes_count || 0}
                          </Text>
                        </TouchableOpacity>
                      )}
                    </Card>
                  )}
                  style={{ marginBottom: spacing(2) }}
                />
              )}

              {group.is_member && (
                <View style={s.composer}>
                  <TextInput value={content} onChangeText={setContent} placeholder="Write a post…"
                             placeholderTextColor={colors.textSubtle} style={s.input} multiline />
                  <TouchableOpacity onPress={submit} disabled={posting || !content.trim()}
                                    style={[s.sendBtn, (!content.trim() || posting) && { opacity: 0.5 }]}>
                    <Feather name="send" size={16} color={colors.onPrimary} />
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

/* ── Screen ────────────────────────────────────────────────────────────────── */
export default function AssembleScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const navigation = useNavigation();
  const { user } = useAuth();
  // Login stores `id`; /auth/me answers `user_id`. Accept either.
  const myId = user?.id || user?.user_id || null;
  const [groups, setGroups] = useState([]);
  const [quota, setQuota] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [open, setOpen] = useState(null);
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const load = useCallback(() => {
    studentApi.get('/assemble/groups')
      .then(({ data: d }) => {
        if (!d.bool) { setFailed(true); return; }
        setGroups(d.response.groups || []);
        setQuota(d.response.quota || null);
        setFailed(false);
      })
      // Swallowed before: an outage showed "No communities yet" on a platform
      // that has them, so the student assumed there was nothing to join.
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  useEffect(() => { load(); }, [load]);

  const join = async (g) => {
    try {
      const { data: d } = await studentApi.post(`/assemble/groups/${g.id}/join`, {});
      if (d.bool) {
        // On an approval group you are only pending — claiming "Joined" would
        // be a lie until the owner acts, and no slot is spent yet either.
        const active = d.response.status === 'active';
        setGroups((prev) => prev.map((x) => x.id === g.id
          ? { ...x, is_member: active, membership_status: d.response.status } : x));
        if (active) {
          setQuota((q) => (q && !q.is_pro
            ? { ...q, used: q.used + 1, remaining: Math.max(0, q.remaining - 1) } : q));
        }
      } else if (d.response?.requires_pro) {
        Alert.alert('Free plan limit', d.response.message,
          [{ text: 'Not now' }, { text: 'Upgrade', onPress: () => navigation.navigate('SkovoPro') }]);
      } else Alert.alert('Could not join', d.response?.message || '');
    } catch { toast.error('Connection problem — you were not joined.'); }
  };

  if (loading) return <Screen><Loader label="Loading communities…" /></Screen>;

  const full = quota && !quota.is_pro && quota.remaining === 0;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }}>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1 }}>
          <H1>Assemble</H1>
          <Muted>Join communities, share ideas, grow together</Muted>
        </View>
        <TouchableOpacity style={s.msgBtn} onPress={() => navigation.navigate('Messages')}>
          <Feather name="mail" size={16} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {/* Free-tier meter. Hidden for Pro — "unlimited of unlimited" is noise. */}
      {quota && !quota.is_pro && (
        <View style={[s.quota, full && s.quotaFull]}>
          <Feather name="users" size={15} color={full ? colors.warning : colors.textSubtle} />
          <Muted style={{ flex: 1, fontSize: font.xs }}>
            {full
              ? `You're in all ${quota.limit} of your free communities.`
              : `In ${quota.used} of ${quota.limit} — ${quota.remaining} left on the free plan.`}
          </Muted>
          <TouchableOpacity onPress={() => navigation.navigate('SkovoPro')}>
            <Text style={s.upgrade}>Go unlimited</Text>
          </TouchableOpacity>
        </View>
      )}

      <Button title="Start a community" icon="plus" variant="outline"
              onPress={() => setCreating(true)} style={{ marginTop: spacing(3) }} />

      {/* Invite code from a friend (§8). Joining still counts toward the free limit. */}
      <View style={{ flexDirection: 'row', gap: spacing(2), marginTop: spacing(3) }}>
        <TextInput value={joinCode} onChangeText={setJoinCode} placeholder="Have an invite code?" autoCapitalize="characters"
                   placeholderTextColor={colors.textSubtle} style={[s.input, { flex: 1 }]} />
        <Button title="Join" size="sm" disabled={!joinCode.trim()} onPress={async () => {
          try {
            const { data } = await studentApi.post(`/assemble/join/${encodeURIComponent(joinCode.trim())}`, {});
            if (data?.bool) { toast.success(data.response.message); setJoinCode(''); load(); } else toast.error(data?.response?.message || 'Could not join.');
          } catch { toast.error('Connection problem.'); }
        }} />
      </View>

      <View style={{ marginTop: spacing(4) }}>
        {failed ? (
          <ErrorState title="We couldn't load the communities"
                      subtitle="They are still there — this is a connection problem."
                      onRetry={load} />
        ) : groups.length === 0 ? (
          <Empty icon="users" title="No communities yet"
                 subtitle="Start the first one — pick a name and say who it's for." />
        ) : (
          groups.map((g) => (
            <Card key={g.id} style={{ marginBottom: spacing(2.5) }}>
              {!!g.category && <Pill label={g.category} tone="primary" />}
              <Text style={s.groupName}>{g.name}</Text>
              {!!g.description && <Muted style={{ marginTop: spacing(1) }} numberOfLines={2}>{g.description}</Muted>}
              <View style={s.groupFoot}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(1) }}>
                  <Feather name="users" size={12} color={colors.textSubtle} />
                  <Muted style={{ fontSize: font.xs }}>
                    {g.member_count || 0}{g.max_members ? `/${g.max_members}` : ''} members
                  </Muted>
                </View>
                <View style={{ flexDirection: 'row', gap: spacing(2), alignItems: 'center' }}>
                  <Button title={g.is_member ? 'Open' : 'Posts'} icon="message-square" variant="outline" size="sm"
                          onPress={() => setOpen(g)} />
                  {g.membership_status === 'pending'
                    ? <Pill label="Awaiting approval" tone="warning" />
                    : g.my_role === 'owner'
                      ? <Pill label="You own this" tone="success" />
                      : g.is_member
                        ? <Pill label="Joined ✓" tone="success" />
                        : <Button title={g.join_type === 'approval' ? 'Request' : 'Join'} size="sm"
                                  onPress={() => join(g)} />}
                </View>
              </View>
            </Card>
          ))
        )}
      </View>

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreated={(group, nextQuota, msg) => {
            setCreating(false);
            if (group) setGroups((prev) => [group, ...prev]);
            if (nextQuota) setQuota(nextQuota);
            Alert.alert('Community created', msg || '');
          }}
          onNeedsPro={(res) => {
            setCreating(false);
            Alert.alert('Free plan limit', res.message,
              [{ text: 'Not now' }, { text: 'Upgrade', onPress: () => navigation.navigate('SkovoPro') }]);
          }}
        />
      )}

      {open && <GroupModal group={open} onClose={() => setOpen(null)} onDeleted={() => { setOpen(null); load(); }} navigation={navigation} myId={myId} />}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  msgBtn: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center' },
  quota: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginTop: spacing(4),
    padding: spacing(3), borderRadius: radius.md, backgroundColor: colors.surfaceAlt },
  quotaFull: { backgroundColor: colors.warningSoft },
  upgrade: { fontSize: font.xs, fontWeight: font.bold, color: colors.primary },
  groupName: { fontSize: font.lg, fontWeight: '700', color: colors.text, marginTop: spacing(2) },
  groupFoot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    marginTop: spacing(3), paddingTop: spacing(3), borderTopWidth: 1, borderTopColor: colors.borderSoft },
  sheetWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.bg, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing(5), height: '80%' },
  sheetHead: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing(4) },
  tabs: { flexDirection: 'row', gap: spacing(1), borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft, marginBottom: spacing(3) },
  tab: { paddingVertical: spacing(2), paddingHorizontal: spacing(3), borderBottomWidth: 2,
    borderBottomColor: 'transparent', marginBottom: -1 },
  tabOn: { borderBottomColor: colors.primary },
  tabTxt: { fontSize: font.sm, fontWeight: font.semibold, color: colors.textSubtle },
  tabTxtOn: { color: colors.primary },
  secTitle: { fontSize: font.xs, fontWeight: font.bold, color: colors.textSubtle,
    letterSpacing: 0.6, marginTop: spacing(3), marginBottom: spacing(2) },
  personRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(2),
    paddingVertical: spacing(2.5), borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  personName: { flex: 1, fontSize: font.sm, fontWeight: font.semibold, color: colors.text },
  author: { fontSize: font.sm, fontWeight: '700', color: colors.text },
  postBody: { fontSize: font.sm, color: colors.text, marginTop: spacing(2), lineHeight: 20 },
  likeRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing(2.5), alignSelf: 'flex-start' },
  likeText: { fontSize: font.xs, fontWeight: font.bold, color: colors.textSubtle },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing(2) },
  input: { flex: 1, backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing(4), paddingVertical: spacing(3),
    fontSize: font.sm, maxHeight: 100, color: colors.text },
  sendBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted, marginBottom: spacing(2) },
  field: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing(4), paddingVertical: spacing(3),
    fontSize: font.sm, color: colors.text },
  hint: { fontSize: font.xs, marginTop: spacing(1), marginBottom: spacing(3) },
  chip: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: radius.md, borderWidth: 1.5,
    borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipTxt: { fontSize: font.sm, fontWeight: font.semibold, color: colors.textMuted },
  chipTxtOn: { color: colors.primaryDark },
  err: { color: colors.danger, fontSize: font.sm, marginTop: spacing(2) },
});
