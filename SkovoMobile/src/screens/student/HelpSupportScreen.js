import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Linking, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, Muted, Card, Button, Loader, Empty, ErrorState } from '../../components/ui';
import { studentApi } from '../../services/api';
import { useAuth } from '../../context/AuthContext';

const CATEGORIES = [
  { value: 'payments', label: 'Payments' },
  { value: 'account', label: 'Account' },
  { value: 'documents', label: 'Documents' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'other', label: 'Other' },
];

const STATUS = {
  open: 'Open',
  in_progress: 'In progress',
  solved: 'Solved',
};

function mailto(address, email) {
  const q = new URLSearchParams({ subject: 'SKOVO support' });
  if (email) q.set('body', `From: ${email}\n\n`);
  return `mailto:${address}?${q.toString()}`;
}

function tel(num) {
  return `tel:${String(num || '').replace(/[^\d+]/g, '')}`;
}

export default function HelpSupportScreen() {
  const { colors } = useTheme();
  const s = useThemedStyles(makeStyles);
  const { user } = useAuth();
  const [contacts, setContacts] = useState([]);
  const [issues, setIssues] = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [sending, setSending] = useState(false);
  const [category, setCategory] = useState('other');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  const load = useCallback(() => {
    setFailed(false);
    Promise.all([
      studentApi.get('/support/contacts'),
      studentApi.get('/support/issues'),
    ])
      .then(([cRes, iRes]) => {
        if (cRes.data?.bool) setContacts(cRes.data.response?.contacts || []);
        if (iRes.data?.bool) setIssues(iRes.data.response?.issues || []);
        if (!cRes.data?.bool && !iRes.data?.bool) setFailed(true);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const openChannel = async (c) => {
    const url = c.channel === 'email' ? mailto(c.value, user?.email) : tel(c.value);
    try {
      await Linking.openURL(url);
    } catch {
      Alert.alert('Could not open', c.channel === 'email' ? 'No mail app is available.' : 'No phone app is available.');
    }
  };

  const send = async () => {
    const sub = subject.trim();
    const text = body.trim();
    if (sub.length < 3) { Alert.alert('Subject', 'Subject must be at least 3 characters.'); return; }
    if (text.length < 10) { Alert.alert('Details', 'Describe the problem in at least 10 characters.'); return; }
    setSending(true);
    try {
      const { data } = await studentApi.post('/support/issues/raise', {
        category, subject: sub, body: text, source: 'mobile', contact_email: user?.email,
      });
      if (data.bool) {
        setSubject('');
        setBody('');
        setIssues((prev) => [data.response.issue, ...prev]);
        Alert.alert('Sent', 'We will update the status here.');
      } else {
        Alert.alert('Could not send', data.response?.message || 'Try again.');
      }
    } catch {
      Alert.alert('Could not send', 'Check your connection and try again.');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <Screen><Loader /></Screen>;
  if (failed) return <Screen><ErrorState title="Could not load Help" onRetry={() => { setLoading(true); load(); }} /></Screen>;

  return (
    <Screen scroll>
      <H1>Help & support</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Email or call, or raise an issue we can mark solved.</Muted>

      <Text style={s.sec}>Talk to us</Text>
      {contacts.length === 0 ? (
        <Card>
          <Empty icon="help-circle" title="Support contacts are being set" subtitle="You can still raise an issue below." />
        </Card>
      ) : contacts.map((c) => (
        <Card key={c.id} style={{ marginBottom: spacing(2) }}>
          <View style={s.row}>
            <View style={s.icon}>
              <Feather name={c.channel === 'email' ? 'mail' : 'phone'} size={16} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.label}>{c.label}</Text>
              <Text style={s.value}>{c.value}</Text>
              {c.hours ? <Muted style={{ marginTop: 4 }}>{c.hours}</Muted> : null}
            </View>
          </View>
          <Button
            title={c.channel === 'email' ? 'Email' : 'Call'}
            icon={c.channel === 'email' ? 'mail' : 'phone'}
            onPress={() => openChannel(c)}
            style={{ marginTop: spacing(2) }}
          />
        </Card>
      ))}

      <Text style={s.sec}>Raise an issue</Text>
      <Card>
        <View style={s.chips}>
          {CATEGORIES.map((c) => {
            const on = category === c.value;
            return (
              <TouchableOpacity
                key={c.value}
                onPress={() => setCategory(c.value)}
                style={[s.chip, on && { backgroundColor: colors.primary, borderColor: colors.primary }]}
              >
                <Text style={[s.chipTxt, on && { color: '#fff' }]}>{c.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        <TextInput
          value={subject}
          onChangeText={setSubject}
          placeholder="Subject"
          placeholderTextColor={colors.textSubtle}
          style={s.input}
          maxLength={200}
        />
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="What happened"
          placeholderTextColor={colors.textSubtle}
          style={[s.input, s.area]}
          multiline
          maxLength={4000}
        />
        <Button title={sending ? 'Sending…' : 'Send issue'} icon="send" onPress={send} disabled={sending} />
      </Card>

      <Text style={s.sec}>Your issues</Text>
      {issues.length === 0 ? (
        <Card>
          <Empty icon="send" title="No issues yet" subtitle="When you send one, the status lands here." />
        </Card>
      ) : issues.map((issue) => (
        <Card key={issue.id} style={{ marginBottom: spacing(2) }}>
          <View style={s.issueHead}>
            <Text style={s.label}>{issue.subject}</Text>
            <View style={s.badge}>
              <Text style={s.badgeTxt}>{STATUS[issue.status] || issue.status}</Text>
            </View>
          </View>
          <Muted style={{ marginTop: spacing(1) }}>{issue.body}</Muted>
        </Card>
      ))}
    </Screen>
  );
}

const makeStyles = (colors) => ({
  sec: { fontSize: font.xs, fontWeight: font.bold, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: spacing(5), marginBottom: spacing(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: font.base, fontWeight: font.semibold, color: colors.text },
  value: { fontSize: font.sm, color: colors.textMuted, marginTop: 2 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing(2) },
  chip: { minHeight: 44, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: colors.borderSoft, justifyContent: 'center' },
  chipTxt: { fontSize: font.xs, fontWeight: font.semibold, color: colors.textMuted },
  input: { minHeight: 44, borderWidth: 1, borderColor: colors.borderSoft, borderRadius: 12, paddingHorizontal: 12, color: colors.text, marginBottom: spacing(2), fontSize: font.base },
  area: { minHeight: 110, textAlignVertical: 'top', paddingTop: 12 },
  issueHead: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  badge: { backgroundColor: colors.primarySoft, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  badgeTxt: { fontSize: font.xs, fontWeight: font.bold, color: colors.primaryDark },
});
