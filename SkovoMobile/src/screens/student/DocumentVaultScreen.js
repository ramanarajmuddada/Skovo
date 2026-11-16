// ── Document Vault (student) ─────────────────────────────────────────────────
// Free tier keeps 5 documents; Skovo Pro unlocks unlimited. Stores a name +
// link per document under a category, and can mark one public for the profile.
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Linking, ScrollView, TextInput, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useTheme, useThemedStyles, radius, spacing, font } from '../../theme';
import { Screen, H1, H2, Muted, Card, Button, Input, Loader, Empty, Pill, Select, ErrorState } from '../../components/ui';
import { studentApi, API_BASE_URL } from '../../services/api';

// The public profile is a web page; strip the API path to get its origin.
const WEB_ORIGIN = String(API_BASE_URL || '').replace(/\/v1\/?$/, '');
import { useMasters } from '../../hooks/useMasters';

// CATEGORIES comes from master data (masters.document_category) — the same list the
// web build reads, so the two surfaces cannot drift apart.

export default function DocumentVaultScreen() {
  const { colors, gradients, shadow } = useTheme();
  const s = useThemedStyles(makeStyles);
  const [failed, setFailed] = useState(false);
  // Shareable mini-resume link — a Pro feature (Scope §4.6). Free members see
  // what it is rather than nothing at all, so the upgrade has a reason.
  const [pub, setPub] = useState(null);
  const [slug, setSlug] = useState('');
  const [savingSlug, setSavingSlug] = useState(false);

  const { lists } = useMasters(['document_category']);
  const CATEGORIES = [...(lists.document_category || []).map(o => o.value)];

  const navigation = useNavigation();
  const [docs, setDocs] = useState([]);
  const [meta, setMeta] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', file_url: '', category: 'general' });
  const [editId, setEditId] = useState(null);   // null = the sheet is creating
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    studentApi.get('/document-vault/')
      .then(({ data: d }) => {
        if (d.bool) {
          setDocs(d.response.documents || []);
          setMeta({ is_pro: d.response.is_pro, used: d.response.used,
                    limit: d.response.limit, remaining: d.response.remaining });
        }
      })
      // Swallowed before: a failed request rendered an empty list,
      // which reads as "nothing here" instead of "we could not ask".
      .catch(() => setFailed(true))
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);
  const loadPublic = useCallback(() => {
    studentApi.get('/document-vault/public-profile')
      .then(({ data: d }) => { if (d.bool) { setPub(d.response); setSlug(d.response.slug || ''); } })
      .catch(() => {});
  }, []);

  const saveSlug = async () => {
    if (!slug.trim()) return;
    setSavingSlug(true);
    try {
      const { data: d } = await studentApi.put('/document-vault/public-profile', {
        slug: slug.trim(), headline: pub?.headline || '', is_enabled: true,
      });
      if (d.bool) { Alert.alert('Saved', 'Your public link is live.'); loadPublic(); }
      else Alert.alert('Could not save', d.response?.message || '');
    } catch { Alert.alert('Could not save', 'Please try again.'); }
    finally { setSavingSlug(false); }
  };

  useEffect(() => { load(); loadPublic(); }, [load, loadPublic]);

  /** Open the same sheet in edit mode. PUT only accepts name/category/tags —
   *  the stored file itself is replaced by uploading a new document. */
  const openEdit = (doc) => {
    setEditId(doc.id);
    setForm({ name: doc.name || doc.title || '', file_url: doc.file_url || '', category: doc.category || 'general' });
    setErr('');
    setAdding(true);
  };

  const closeSheet = () => {
    setAdding(false); setEditId(null);
    setForm({ name: '', file_url: '', category: 'general' });
  };

  const save = async () => {
    setErr('');
    // On edit the file link is already stored and not editable, so only require it when creating.
    if (!form.name.trim() || (!editId && !form.file_url.trim())) {
      setErr(editId ? 'Name is required.' : 'Name and file link are required.');
      return;
    }
    setSaving(true);
    try {
      const { data: d } = editId
        ? await studentApi.put(`/document-vault/${editId}`, { name: form.name, category: form.category })
        : await studentApi.post('/document-vault/', form);
      if (d.bool) { closeSheet(); load(); }
      else if (d.response?.limit_reached) setErr(d.response.message);
      else setErr(d.response?.message || 'Could not save.');
    } catch { setErr('Something went wrong.'); } finally { setSaving(false); }
  };

  const remove = async (doc) => {
    setDocs((prev) => prev.filter((x) => x.id !== doc.id));
    try { await studentApi.delete(`/document-vault/${doc.id}`); } catch { load(); }
  };

  const togglePublic = async (doc) => {
    const next = !doc.is_public;
    setDocs((prev) => prev.map((x) => x.id === doc.id ? { ...x, is_public: next } : x));
    try { await studentApi.put(`/document-vault/${doc.id}/visibility`, { is_public: next }); }
    catch { load(); }
  };

  if (loading) return <Screen><Loader label="Loading your vault…" /></Screen>;

  const atLimit = !meta.is_pro && meta.remaining === 0;

  return (
    <Screen scroll refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); loadPublic(); }}>
      <H1>Document Vault</H1>
      <Muted style={{ marginBottom: spacing(4) }}>Keep your marksheets, IDs and resumes in one place</Muted>

      {meta.is_pro ? (
        <Card style={s.proBanner}>
          <Feather name="award" size={15} color={colors.achiever} />
          <Text style={s.proText}>Skovo Pro · unlimited storage</Text>
        </Card>
      ) : (
        <Card style={s.limitBanner}>
          <Text style={s.limitText}>{meta.used} of {meta.limit} documents used</Text>
          <TouchableOpacity onPress={() => navigation.navigate('SkovoPro')}>
            <Text style={s.upgrade}>{atLimit ? 'Vault full — Upgrade →' : 'Upgrade'}</Text>
          </TouchableOpacity>
        </Card>
      )}

      {/* Public profile — Pro. Free members see what it is; a locked feature
          with no description is just a wall. */}
      {pub && (pub.is_pro ? (
        <Card style={{ marginTop: spacing(3) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2), marginBottom: spacing(3) }}>
            <Feather name="globe" size={15} color={colors.primary} />
            <H2 style={{ flex: 1 }}>Public profile link</H2>
          </View>
          <Muted style={{ fontSize: font.xs, marginBottom: spacing(2) }}>
            Only documents you mark public appear here.
          </Muted>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(2) }}>
            <TextInput value={slug} onChangeText={setSlug} autoCapitalize="none"
                       placeholder="your-name" placeholderTextColor={colors.textSubtle}
                       style={[s.slugInput, { flex: 1 }]} />
            <Button title={savingSlug ? '…' : 'Save'} size="sm"
                    onPress={saveSlug} loading={savingSlug} disabled={savingSlug || !slug.trim()} />
          </View>
          {!!pub.slug && (
            <TouchableOpacity onPress={() => Linking.openURL(`${WEB_ORIGIN}/p/${pub.slug}`)}
                              style={{ marginTop: spacing(2) }}>
              <Text style={s.slugLink}>{WEB_ORIGIN}/p/{pub.slug}</Text>
            </TouchableOpacity>
          )}
        </Card>
      ) : (
        <TouchableOpacity onPress={() => navigation.navigate('SkovoPro')}>
          <Card style={{ marginTop: spacing(3), flexDirection: 'row', alignItems: 'center', gap: spacing(3) }}>
            <Feather name="globe" size={16} color={colors.achiever} />
            <View style={{ flex: 1 }}>
              <Text style={s.proText}>Share a public mini-resume</Text>
              <Muted style={{ fontSize: font.xs, marginTop: 2 }}>
                Skovo Pro gives you a link showing your score and chosen documents.
              </Muted>
            </View>
            <Feather name="chevron-right" size={16} color={colors.textSubtle} />
          </Card>
        </TouchableOpacity>
      ))}

      <Button title="Add document" icon="plus" onPress={() => { setEditId(null); setForm({ name: '', file_url: '', category: 'general' }); setErr(''); setAdding(true); }}
              disabled={atLimit} style={{ marginVertical: spacing(3) }} />

      {docs.length === 0 ? (
        failed ? (
          <ErrorState
            title="We couldn't load your documents"
            subtitle="Nothing is lost — this is a connection problem."
          onRetry={load}
          />
        ) : (
          <Empty icon="folder" title="No documents yet" subtitle="Add your resume, marksheets and IDs" />
        )
      ) : (
        docs.map((d) => (
          <Card key={d.id} style={{ marginBottom: spacing(2.5) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={s.docIcon}><Feather name="file-text" size={18} color={colors.primary} /></View>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={s.docName} numberOfLines={1}>{d.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing(1.5), marginTop: 2 }}>
                  <Pill label={d.category || 'general'} tone="neutral" />
                  {d.is_public && <Pill label="Public" tone="success" />}
                </View>
              </View>
            </View>
            <View style={s.docActions}>
              {!!d.file_url && (
                <TouchableOpacity style={s.act} onPress={() => Linking.openURL(d.file_url)}>
                  <Feather name="external-link" size={15} color={colors.textMuted} />
                  <Text style={s.actText}>Open</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={s.act} onPress={() => togglePublic(d)}>
                <Feather name="globe" size={15} color={d.is_public ? colors.success : colors.textMuted} />
                <Text style={s.actText}>{d.is_public ? 'Public' : 'Private'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.act} onPress={() => openEdit(d)}>
                <Feather name="edit-2" size={15} color={colors.textMuted} />
                <Text style={s.actText}>Edit</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.act} onPress={() => remove(d)}>
                <Feather name="trash-2" size={15} color={colors.danger} />
              </TouchableOpacity>
            </View>
          </Card>
        ))
      )}

      <Modal visible={adding} transparent animationType="slide" onRequestClose={closeSheet}>
        <View style={s.modalWrap}>
          <View style={s.modal}>
            <H2>{editId ? 'Edit document' : 'Add a document'}</H2>
            <Input label="Name" value={form.name}
                   onChangeText={(t) => setForm((f) => ({ ...f, name: t }))}
                   placeholder="Class 12 Marksheet" style={{ marginTop: spacing(3) }} />
            {editId ? null : (
              <Input label="File link (URL)" value={form.file_url}
                     onChangeText={(t) => setForm((f) => ({ ...f, file_url: t }))}
                     placeholder="https://…" autoCapitalize="none" />
            )}
            <Select label="Category" icon="folder" required
                    value={form.category}
                    onChange={(v) => setForm((f) => ({ ...f, category: v }))}
                    options={lists.document_category} placeholder="Search categories…" />
            {!!err && <Text style={s.err}>{err}</Text>}
            <Button title="Save" icon="check" onPress={save} loading={saving} style={{ marginTop: spacing(2) }} />
            <Button title="Cancel" variant="ghost" onPress={closeSheet} style={{ marginTop: spacing(1) }} />
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

const makeStyles = (colors, shadow) => ({
  proBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing(2), backgroundColor: colors.achieverSoft },
  proText: { fontSize: font.sm, fontWeight: '700', color: colors.achiever },
  limitBanner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  limitText: { fontSize: font.sm, fontWeight: '600', color: colors.textMuted },
  slugInput: { backgroundColor: colors.surfaceAlt, borderRadius: radius.md, borderWidth: 1,
    borderColor: colors.border, paddingHorizontal: spacing(3), paddingVertical: spacing(2.5),
    fontSize: font.sm, color: colors.text },
  slugLink: { fontSize: font.xs, color: colors.primary, fontWeight: font.semibold },
  upgrade: { fontSize: font.sm, fontWeight: '800', color: colors.achiever },
  docIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing(3) },
  docName: { fontSize: font.md, fontWeight: '700', color: colors.text },
  docActions: { flexDirection: 'row', gap: spacing(4), marginTop: spacing(3),
    paddingTop: spacing(3), borderTopWidth: 1, borderTopColor: colors.borderSoft },
  act: { flexDirection: 'row', alignItems: 'center', gap: spacing(1.5) },
  actText: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  modalWrap: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  modal: { backgroundColor: colors.surface, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl,
    padding: spacing(6), ...shadow.card },
  catLabel: { fontSize: font.xs, fontWeight: '700', color: colors.textMuted, marginBottom: spacing(2) },
  cat: { paddingHorizontal: spacing(3.5), paddingVertical: spacing(2), borderRadius: radius.pill,
    backgroundColor: colors.surfaceAlt, borderWidth: 1, borderColor: colors.border, marginRight: spacing(2) },
  catOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  catText: { fontSize: font.sm, color: colors.textMuted, fontWeight: '600' },
  catTextOn: { color: colors.onPrimary },
  err: { color: colors.danger, fontSize: font.sm, marginBottom: spacing(2) },
});
