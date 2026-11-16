// ── Direct Messages (student, Skovo Pro) ─────────────────────────────────────
// Conversations with members of communities you share. Reading is open;
// sending needs Skovo Pro. Opened either from the list or from a post author.
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, FlatList, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Loader, Empty, Avatar, ErrorState, useToast } from '../../components/ui';
import { studentApi } from '../../services/api';

function Thread({ peer, onBack }) {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const navigation = useNavigation();
  const listRef = useRef(null);

  const load = useCallback(() => {
    studentApi.get(`/assemble/dm/${peer.id}`)
      .then(({ data: d }) => { if (d.bool) setMessages(d.response.messages || []); })
      // Swallowed before: an outage looked like an empty conversation.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [peer.id]);

  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    try {
      const { data: d } = await studentApi.post(`/assemble/dm/${peer.id}`, { body });
      if (d.bool) { setBody(''); load(); }
      else if (d.response?.requires_pro) {
        Alert.alert('Skovo Pro', d.response.message,
          [{ text: 'Not now' }, { text: 'Upgrade', onPress: () => navigation.navigate('SkovoPro') }]);
      } else Alert.alert('Could not send', d.response?.message || '');
    } catch {
      // The composer kept the text but said nothing, so the student could not
      // tell a sent message from an unsent one.
      toast.error('Connection problem — your message was not sent.');
    } finally { setSending(false); }
  };

  const report = () => {
    Alert.prompt?.('Report member', 'What happened?', async (reason) => {
      if (!reason) return;
      try {
        // This used to say "Thank you, our team will review this" whether or
        // not the request succeeded. Someone reporting harassment was
        // reassured while nothing had been recorded.
        const { data } = await studentApi.post(`/assemble/dm/${peer.id}/report`, { reason });
        if (data.bool) Alert.alert('Thank you', 'Our team will review this.');
        else Alert.alert('Not sent', data.response?.message || 'Please try again.');
      } catch {
        Alert.alert('Not sent', 'Connection problem — your report was not sent. Please try again.');
      }
    });
  };

  const block = () => {
    Alert.alert('Block member?', `Neither of you will be able to message the other.`,
      [{ text: 'Cancel', style: 'cancel' },
       { text: 'Block', style: 'destructive', onPress: async () => {
          try {
            // Navigating back regardless implied the block had taken effect.
            const { data } = await studentApi.post(`/assemble/dm/${peer.id}/block`, {});
            if (data.bool) { toast.success('Member blocked'); onBack(); }
            else toast.error(data.response?.message || "Couldn't block that member.");
          } catch {
            toast.error('Connection problem — the member was not blocked.');
          }
       } }]);
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <View style={s.threadHead}>
        <TouchableOpacity onPress={onBack} style={{ padding: spacing(1) }}>
          <Feather name="chevron-left" size={22} color={colors.textMuted} />
        </TouchableOpacity>
        <Avatar name={peer.name || 'Member'} size={32} />
        <Text style={s.peerName} numberOfLines={1}>{peer.name || 'Skovo member'}</Text>
        <TouchableOpacity onPress={report} style={{ padding: spacing(1.5) }}>
          <Feather name="flag" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
        <TouchableOpacity onPress={block} style={{ padding: spacing(1.5) }}>
          <Feather name="slash" size={16} color={colors.textSubtle} />
        </TouchableOpacity>
      </View>

      {loading ? <Loader /> : failed ? (
        <ErrorState title="We couldn't load this conversation"
                    subtitle="Your messages are safe — this is a connection problem."
                    onRetry={load} />
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ padding: spacing(4) }}
          ListEmptyComponent={<Muted style={{ textAlign: 'center', marginTop: spacing(10) }}>No messages yet. Say hello!</Muted>}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item: m }) => (
            <View style={[s.bubbleRow, { justifyContent: m.mine ? 'flex-end' : 'flex-start' }]}>
              <View style={[s.bubble, m.mine ? s.bubbleMine : s.bubbleTheirs]}>
                <Text style={[s.bubbleText, m.mine && { color: colors.onPrimary }]}>{m.body}</Text>
              </View>
            </View>
          )}
        />
      )}

      <View style={s.composer}>
        <TextInput value={body} onChangeText={setBody} placeholder="Message…" maxLength={2000}
                   style={s.input} multiline />
        <TouchableOpacity onPress={send} disabled={sending || !body.trim()}
                          style={[s.sendBtn, (!body.trim() || sending) && { opacity: 0.5 }]}>
          <Feather name="send" size={16} color={colors.onPrimary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export default function MessagesScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [listFailed, setListFailed] = useState(false);
  const route = useRoute();
  const [conversations, setConversations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState(route.params?.peer || null);

  const load = useCallback(() => {
    studentApi.get('/assemble/dm/conversations')
      .then(({ data: d }) => {
        if (d.bool) { setConversations(d.response.conversations || []); setListFailed(false); }
        else setListFailed(true);
      })
      // Swallowed before: an outage looked like "you have no conversations".
      .catch(() => setListFailed(true))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { if (!active) load(); }, [active, load]);

  if (active) return <Thread peer={active} onBack={() => setActive(null)} />;

  if (loading) return <Screen><Loader label="Loading messages…" /></Screen>;

  return (
    <Screen scroll>
      <H1>Messages</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Members of your communities</Muted>

      {listFailed ? (
        <ErrorState title="We couldn't load your conversations"
                    subtitle="Your messages are safe — this is a connection problem."
                    onRetry={load} />
      ) : conversations.length === 0 ? (
        <Empty icon="message-circle" title="No conversations yet"
               subtitle="Open a community and message someone from their post" />
      ) : (
        conversations.map((c) => (
          <TouchableOpacity key={c.peer.id} onPress={() => setActive(c.peer)} style={s.convRow}>
            <Avatar name={c.peer.name || 'Member'} size={44} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={s.convName} numberOfLines={1}>{c.peer.name}</Text>
              <Muted style={{ fontSize: font.xs }} numberOfLines={1}>{c.last_body}</Muted>
            </View>
            {c.unread > 0 && (
              <View style={s.badge}><Text style={s.badgeText}>{c.unread}</Text></View>
            )}
          </TouchableOpacity>
        ))
      )}
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  threadHead: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), padding: spacing(3),
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft, backgroundColor: colors.surface },
  peerName: { flex: 1, fontSize: font.md, fontWeight: '700', color: colors.text },
  bubbleRow: { flexDirection: 'row', marginBottom: spacing(2) },
  bubble: { maxWidth: '78%', paddingHorizontal: spacing(4), paddingVertical: spacing(2.5), borderRadius: radius.lg },
  bubbleMine: { backgroundColor: colors.primary, borderBottomRightRadius: radius.sm },
  bubbleTheirs: { backgroundColor: colors.surfaceAlt, borderBottomLeftRadius: radius.sm },
  bubbleText: { fontSize: font.sm, color: colors.text, lineHeight: 20 },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing(2), padding: spacing(3),
    borderTopWidth: 1, borderTopColor: colors.borderSoft, backgroundColor: colors.surface },
  input: { flex: 1, backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
    paddingHorizontal: spacing(4), paddingVertical: spacing(3), fontSize: font.sm, maxHeight: 100, color: colors.text },
  sendBtn: { width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center' },
  convRow: { flexDirection: 'row', alignItems: 'center', gap: spacing(3), paddingVertical: spacing(3),
    borderBottomWidth: 1, borderBottomColor: colors.borderSoft },
  convName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  badge: { minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: spacing(1.5),
    backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: colors.onPrimary, fontSize: font.xs, fontWeight: '800' },
});
