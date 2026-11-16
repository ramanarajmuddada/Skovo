// Offline quiz packs (feature-updates.md §7 item 14). A pack is an open quiz
// attempt with no deadline: download it, answer without internet, and the
// answers are submitted (auto-checked) the next time the app is online.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { studentApi } from './api';

const KEY = (taskId) => `offline_pack_${taskId}`;
const INDEX = 'offline_pack_index';

async function index() {
  try { return JSON.parse((await AsyncStorage.getItem(INDEX)) || '[]'); } catch { return []; }
}
async function setIndex(ids) { await AsyncStorage.setItem(INDEX, JSON.stringify([...new Set(ids)])); }

export async function getPack(taskId) {
  try { return JSON.parse((await AsyncStorage.getItem(KEY(taskId))) || 'null'); } catch { return null; }
}

export async function downloadPack(taskId) {
  const { data } = await studentApi.get(`/engagement/offline-pack/${taskId}`);
  if (!data?.bool) return { ok: false, message: data?.response?.message || 'Could not download.' };
  const pack = { ...data.response, answers: {}, pending: false };
  await AsyncStorage.setItem(KEY(taskId), JSON.stringify(pack));
  await setIndex([...(await index()), taskId]);
  return { ok: true, pack };
}

export async function saveAnswers(taskId, answers, pending = false) {
  const pack = await getPack(taskId);
  if (!pack) return;
  await AsyncStorage.setItem(KEY(taskId), JSON.stringify({ ...pack, answers, pending }));
}

async function removePack(taskId) {
  await AsyncStorage.removeItem(KEY(taskId));
  await setIndex((await index()).filter((x) => x !== taskId));
}

/** Submit one pack. Returns the result, or null when still offline. */
export async function submitPack(taskId) {
  const pack = await getPack(taskId);
  if (!pack) return null;
  try {
    const { data } = await studentApi.post(`/tasks/${taskId}/quiz/${pack.attempt_id}/submit`, { answers: pack.answers });
    if (data?.bool) { await removePack(taskId); return { ok: true, result: data.response }; }
    // The server answered but refused (already submitted, removed…): drop the pack.
    await removePack(taskId);
    return { ok: false, message: data?.response?.message || 'Could not submit.' };
  } catch {
    await saveAnswers(taskId, pack.answers, true);
    return null;
  }
}

/** Submit every finished pack. Call when the app is online (Tasks load). */
export async function syncPendingPacks() {
  let synced = 0;
  for (const taskId of await index()) {
    const pack = await getPack(taskId);
    if (pack?.pending && (await submitPack(taskId))?.ok) synced += 1;
  }
  return synced;
}

export async function listPacks() {
  const out = [];
  for (const taskId of await index()) {
    const p = await getPack(taskId);
    if (p) out.push(p);
  }
  return out;
}
