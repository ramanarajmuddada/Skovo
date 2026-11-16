// ── Community live chat (feature-updates.md §8) — polls every few seconds.
//    Replies, reactions, doubts → Solved, polls, report, mute, owner settings
//    and invite link. Phone numbers are masked by the server. ────────────────
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, FlatList, TextInput, TouchableOpacity, Modal, Pressable, Share, Switch } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../theme';
import { useToast, Button } from './ui';
import { T } from './v1';
import { studentApi } from '../services/api';

const EMOJI = ['👍', '❤️', '😂', '🎉', '🙏'];

export default function CommunityChat({ groupId }) {
  const { colors } = useTheme();
  const toast = useToast();
  const [msgs, setMsgs] = useState([]);
  const [meta, setMeta] = useState(null);
  const [text, setText] = useState('');
  const [reply, setReply] = useState(null);
  const [doubt, setDoubt] = useState(false);
  const [muted, setMuted] = useState(false);
  const [owner, setOwner] = useState(false);
  const [menuMsg, setMenuMsg] = useState(null);
  const lastSeq = useRef(0);

  const merge = useCallback((list) => {
    if (!list?.length) return;
    setMsgs((prev) => {
      const map = new Map(prev.map((m) => [m.id, m]));
      list.forEach((m) => map.set(m.id, { ...map.get(m.id), ...m }));
      return [...map.values()].sort((a, b) => a.seq - b.seq);
    });
    lastSeq.current = Math.max(lastSeq.current, ...list.map((m) => m.seq));
  }, []);

  const fetch = useCallback(async (full) => {
    const { data } = await studentApi.get(`/assemble/groups/${groupId}/chat`, full ? { limit: 50 } : { after: lastSeq.current });
    if (!data?.bool) return;
    setMeta({ my_role: data.response.my_role, settings: data.response.settings, can_post: data.response.can_post });
    merge(data.response.messages);
    if (lastSeq.current) studentApi.post(`/assemble/groups/${groupId}/read`, { seq: lastSeq.current }).catch(() => {});
  }, [groupId, merge]);

  useEffect(() => {
    lastSeq.current = 0;
    fetch(true).catch(() => {});
    const t = setInterval(() => fetch(false).catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [fetch]);

  const act = async (p, ok) => {
    try {
      const { data } = await p;
      if (data?.bool) { if (ok) toast.success(data.response?.message || ok); fetch(true); } else toast.error(data?.response?.message || 'Could not do that.');
    } catch { toast.error('Connection problem.'); }
  };
  const send = async () => {
    if (!text.trim()) return;
    const { data } = await studentApi.post(`/assemble/groups/${groupId}/chat`, { body: text, reply_to: reply?.id, is_doubt: doubt });
    if (data?.bool) {
      merge([data.response.message]); setText(''); setReply(null); setDoubt(false);
      if (data.response.notice) toast.info?.(data.response.notice);
    } else toast.error(data?.response?.message || 'Could not send.');
  };
  const privileged = ['owner', 'admin'].includes(meta?.my_role);
  const byId = Object.fromEntries(msgs.map((m) => [m.id, m]));

  const menuOptions = (m) => {
    const parent = m.reply_to && byId[m.reply_to.id];
    const canSolve = parent?.is_doubt && !parent.solved_by_message_id && (parent.is_mine || privileged) && !m.is_mine;
    const opts = [
      ...EMOJI.map((e) => ({ text: e, onPress: () => act(studentApi.post(`/assemble/chat/${m.id}/react`, { emoji: e })) })),
      { text: 'Reply', onPress: () => setReply(m) },
      ...(canSolve ? [{ text: 'This solved the doubt ✅', onPress: () => act(studentApi.post(`/assemble/chat/${parent.id}/solve`, { answer_id: m.id }), 'Solved') }] : []),
      ...(!m.is_mine ? [{ text: 'Report', onPress: () => act(studentApi.post(`/assemble/chat/${m.id}/report`, {}), 'Reported') }] : []),
      ...((m.is_mine || privileged) ? [{ text: 'Delete', style: 'destructive', onPress: () => act(studentApi.delete(`/assemble/chat/${m.id}`), 'Deleted') }] : []),
    ];
    return opts;
  };

  const saveSettings = (patch) => act(studentApi.put(`/assemble/groups/${groupId}/chat-settings`, { ...meta.settings, ...patch }), 'Saved');
  const invite = async () => {
    const { data } = await studentApi.post(`/assemble/groups/${groupId}/invite`, {});
    if (data?.bool) Share.share({ message: `Join my SKOVO community with code ${data.response.invite_code}` });
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', gap: 14, paddingVertical: 6, alignItems: 'center' }}>
        <TouchableOpacity onPress={async () => { const { data } = await studentApi.post(`/assemble/groups/${groupId}/mute`, { muted: !muted }); if (data?.bool) setMuted(data.response.muted); }}>
          <Feather name={muted ? 'bell-off' : 'bell'} size={18} color={colors.textMuted} />
        </TouchableOpacity>
        {privileged && <TouchableOpacity onPress={() => setOwner((o) => !o)}><Feather name="settings" size={18} color={colors.textMuted} /></TouchableOpacity>}
        {meta?.settings?.slow_mode_seconds > 0 && <T size={11} muted style={{ marginLeft: 'auto' }}>Slow mode {meta.settings.slow_mode_seconds}s</T>}
      </View>
      {owner && meta && (
        <View style={{ gap: 6, paddingBottom: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={13}>Only admins can post</T><Switch value={meta.settings.admin_only} onValueChange={(v) => saveSettings({ admin_only: v })} /></View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><T size={13}>Allow links</T><Switch value={meta.settings.allow_links} onValueChange={(v) => saveSettings({ allow_links: v })} /></View>
          <Button title="Share invite code" size="sm" variant="outline" onPress={invite} />
        </View>
      )}
      <FlatList
        data={msgs}
        keyExtractor={(m) => m.id}
        style={{ flex: 1 }}
        ListEmptyComponent={<T muted style={{ textAlign: 'center', marginTop: 40 }}>No messages yet. Say hi 👋</T>}
        renderItem={({ item: m }) => (
          <TouchableOpacity onLongPress={() => !m.deleted && setMenuMsg(m)} activeOpacity={0.9}
                            style={{ alignSelf: m.is_mine ? 'flex-end' : 'flex-start', maxWidth: '85%', marginVertical: 4, padding: 10, borderRadius: 14,
                                     backgroundColor: m.is_mine ? colors.successSoft : colors.surface,
                                     borderWidth: m.is_doubt ? 2 : 0, borderColor: colors.warning }}>
            {!m.is_mine && <T size={11} bold color={colors.primary}>{m.sender_name}</T>}
            {m.reply_to && <T size={11} muted numberOfLines={1}>↪ {m.reply_to.sender_name}: {m.reply_to.body}</T>}
            {m.is_doubt && <T size={10} bold color={colors.warning}>❓ Doubt{m.solved_by_message_id ? ' · Solved ✅' : ''}</T>}
            {m.deleted ? <T size={12} muted>Message deleted</T> : m.body ? <T>{m.body}</T> : null}
            {m.poll && (
              <View style={{ marginTop: 4, gap: 4 }}>
                <T bold size={13}>📊 {m.poll.question}</T>
                {m.poll.options.map((o) => (
                  <TouchableOpacity key={o.index} disabled={m.poll.closed} onPress={() => act(studentApi.post(`/assemble/polls/${m.poll.id}/vote`, { option_index: o.index }))}
                                    style={{ padding: 6, borderRadius: 8, borderWidth: 1, borderColor: o.mine ? colors.primary : colors.border }}>
                    <T size={12}>{o.text} · {o.votes}</T>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {m.reactions.length > 0 && <T size={11} style={{ marginTop: 4 }}>{m.reactions.map((r) => `${r.emoji} ${r.count}`).join('  ')}</T>}
          </TouchableOpacity>
        )}
      />
      <Modal visible={!!menuMsg} transparent animationType="fade" onRequestClose={() => setMenuMsg(null)}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' }} onPress={() => setMenuMsg(null)}>
          <View style={{ backgroundColor: colors.surface, padding: 16, borderTopLeftRadius: 18, borderTopRightRadius: 18, gap: 4 }}>
            {menuMsg && (
              <View style={{ flexDirection: 'row', justifyContent: 'space-around', paddingBottom: 8 }}>
                {menuOptions(menuMsg).filter((o) => EMOJI.includes(o.text)).map((o) => (
                  <TouchableOpacity key={o.text} onPress={() => { setMenuMsg(null); o.onPress(); }}><T size={26}>{o.text}</T></TouchableOpacity>
                ))}
              </View>
            )}
            {menuMsg && menuOptions(menuMsg).filter((o) => !EMOJI.includes(o.text)).map((o) => (
              <TouchableOpacity key={o.text} onPress={() => { setMenuMsg(null); o.onPress(); }} style={{ paddingVertical: 12 }}>
                <T bold color={o.style === 'destructive' ? colors.danger : colors.text}>{o.text}</T>
              </TouchableOpacity>
            ))}
          </View>
        </Pressable>
      </Modal>
      {meta?.can_post === false ? <T size={12} muted style={{ textAlign: 'center', padding: 10 }}>Only community admins can post right now.</T> : (
        <View style={{ paddingTop: 6 }}>
          {reply && (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <T size={11} muted style={{ flex: 1 }}>Replying to {reply.sender_name}</T>
              <TouchableOpacity onPress={() => setReply(null)}><Feather name="x" size={14} color={colors.textMuted} /></TouchableOpacity>
            </View>
          )}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <TouchableOpacity onPress={() => setDoubt((d) => !d)}><Feather name="help-circle" size={22} color={doubt ? colors.warning : colors.textMuted} /></TouchableOpacity>
            <TextInput value={text} onChangeText={setText} placeholder={doubt ? 'Ask your doubt' : 'Message'} placeholderTextColor={colors.textMuted} maxLength={4000}
                       style={{ flex: 1, borderWidth: 1, borderColor: colors.border, borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, color: colors.text }} />
            <TouchableOpacity onPress={send} style={{ padding: 10, borderRadius: 20, backgroundColor: colors.primary }}><Feather name="send" size={16} color="#fff" /></TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}
