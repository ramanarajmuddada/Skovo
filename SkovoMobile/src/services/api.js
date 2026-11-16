// ── API client — same SKOVO backend as web, just RN storage ──────────────────
// Reads the base URL from app.json -> expo.extra.apiBaseUrl. In dev only the
// port and path of that value are used; the host is taken from the dev server
// (see devApiBaseUrl), so emulator and phone both work without editing it.
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { NativeModules } from 'react-native';

// EXPO_PUBLIC_API_BASE_URL wins when set, so a build can be pointed elsewhere
// without editing app.json, and the E2E build does not disturb the device setup.
// This is what a release build ships with...
const CONFIGURED_API_BASE_URL =
  Constants.expoConfig?.extra?.apiBaseUrl ||
  Constants.manifest?.extra?.apiBaseUrl ||
  'http://localhost:5000/v1';

// ...but in dev that host is wrong more often than it is right: the LAN IP goes
// stale every time DHCP moves the machine, and no single value can serve both
// the emulator (host is 10.0.2.2) and a real phone (host is the LAN IP). We do
// know one host this device can definitely reach, though -- the dev server it
// just downloaded the bundle from. So in dev keep the configured port and path
// and swap in that host. Production builds never take this branch.
function devApiBaseUrl(configured) {
  // scriptURL is the URL this bundle was actually downloaded from, so it is set
  // in Expo Go, in a dev client and in bare RN alike -- unlike Constants.hostUri,
  // which is empty in a dev-client build and silently left the stale IP in place.
  const scriptURL = NativeModules.SourceCode?.getConstants?.().scriptURL
    || NativeModules.SourceCode?.scriptURL
    || '';
  const fromScript = scriptURL.match(/^https?:\/\/([^/:]+)/)?.[1];
  const fromExpo = (Constants.expoConfig?.hostUri
    || Constants.expoGoConfig?.debuggerHost
    || Constants.manifest?.debuggerHost
    || '').split(':')[0];
  const host = fromScript || fromExpo;
  // A bundle loaded from disk (no dev server) leaves the configured value alone.
  if (!host || host === 'localhost' || host === '127.0.0.1') return configured;
  return configured.replace(/^(https?:\/\/)[^/:]+/, `$1${host}`);
}

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL
  || (__DEV__ ? devApiBaseUrl(CONFIGURED_API_BASE_URL) : CONFIGURED_API_BASE_URL);

// Which host the app is actually calling is the first question asked whenever a
// screen sits empty in dev, and it is not answerable from the UI.
if (__DEV__) console.log('[SKOVO] API_BASE_URL =', API_BASE_URL);

// token keys (kept separate per portal, exactly like the web app)
const STUDENT_TOKEN  = 'access_token';
const STUDENT_USER   = 'student_user';
const STUDENT_REFRESH  = 'refresh_token';
const ACHIEVER_TOKEN = 'achiever_access_token';
const ACHIEVER_USER  = 'achiever_user';
const ACHIEVER_REFRESH = 'achiever_refresh_token';

// Access tokens last 30 minutes; refresh tokens last 30 days. Mobile used to
// store only the access token, so half an hour after signing in every request
// came back 401 — and because screens check `data.bool` and swallow the rest,
// they rendered empty with no error and no prompt to sign in again. The app
// looked like it had lost its data. Refresh mirrors what web already did.
const REFRESH_FOR = { [STUDENT_TOKEN]: STUDENT_REFRESH, [ACHIEVER_TOKEN]: ACHIEVER_REFRESH };

// One refresh at a time: a screen that fires four requests on mount would
// otherwise spend four refresh tokens and race to store the winner.
let refreshing = null;

/** Called when a refresh fails — the session is genuinely over. Set by AuthContext. */
let onSessionExpired = () => {};
export const setSessionExpiredHandler = (fn) => { onSessionExpired = fn || (() => {}); };

// fetch has no default timeout in React Native. A connection that is dropped
// rather than refused -- a firewall that silently discards, a phone that walks
// out of wifi range mid-request -- therefore leaves the promise pending for as
// long as the OS allows, which the UI shows as a button that spins forever with
// no error and no way back. Every request gets a deadline instead.
const REQUEST_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function refreshAccessToken(tokenKey) {
  const refreshKey = REFRESH_FOR[tokenKey];
  const refreshToken = refreshKey ? await AsyncStorage.getItem(refreshKey) : null;
  if (!refreshToken) return null;

  const res = await fetchWithTimeout(`${API_BASE_URL}/auth/token/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${refreshToken}` },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.bool || !data.access_token) return null;

  await AsyncStorage.setItem(tokenKey, data.access_token);
  return data.access_token;
}

export const tokenStore = {
  get:   (k) => AsyncStorage.getItem(k),
  set:   (k, v) => AsyncStorage.setItem(k, v),
  del:   (k) => AsyncStorage.removeItem(k),
};

async function request(endpoint, { method = 'GET', body, tokenKey, _retried } = {}) {
  const token = tokenKey ? await AsyncStorage.getItem(tokenKey) : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  let res, data;
  try {
    res = await fetchWithTimeout(`${API_BASE_URL}${endpoint}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
    data = await res.json().catch(() => ({}));
  } catch (e) {
    const message = e?.name === 'AbortError'
      ? 'The server took too long to respond. Please try again.'
      : 'Network error. Check your connection / API URL.';
    return { ok: false, status: 0, data: { bool: false, response: { message } } };
  }

  // Expired access token — refresh once and replay. `_retried` stops a loop if
  // the fresh token is rejected too.
  if (res.status === 401 && tokenKey && !_retried) {
    refreshing = refreshing || refreshAccessToken(tokenKey).finally(() => { refreshing = null; });
    const fresh = await refreshing;
    if (fresh) return request(endpoint, { method, body, tokenKey, _retried: true });

    // Refresh failed: the session is over. Say so instead of leaving every
    // screen blank — that is the state this whole path exists to prevent.
    await AsyncStorage.multiRemove([tokenKey, REFRESH_FOR[tokenKey]].filter(Boolean));
    onSessionExpired();
    return { ok: false, status: 401,
             data: { bool: false, response: { message: 'Your session expired. Please sign in again.' } } };
  }

  return { ok: res.ok, status: res.status, data };
}

function makeClient(tokenKey) {
  return {
    get:    (endpoint, params) => {
      const qs = params ? '?' + new URLSearchParams(params).toString() : '';
      return request(endpoint + qs, { method: 'GET', tokenKey });
    },
    post:   (endpoint, body) => request(endpoint, { method: 'POST', body, tokenKey }),
    put:    (endpoint, body) => request(endpoint, { method: 'PUT', body, tokenKey }),
    patch:  (endpoint, body) => request(endpoint, { method: 'PATCH', body, tokenKey }),
    delete: (endpoint) => request(endpoint, { method: 'DELETE', tokenKey }),

    /** Multipart upload to /upload/, which returns the stored file's URL.
     *
     * `file` is React Native's shape: { uri, name, type }. RN's FormData
     * handles that natively, so no extra dependency is needed for the transfer
     * itself — only for CHOOSING a file, which is why the achiever verification
     * screen still sends document uploads to the web portal. Add
     * expo-image-picker (or expo-document-picker), hand the result straight to
     * this, and that handoff goes away.
     *
     * Content-Type is deliberately unset: RN must add its own multipart
     * boundary, and naming the header here would clobber it.
     */
    upload: async (endpoint, file, fieldName = 'file') => {
      const token = tokenKey ? await AsyncStorage.getItem(tokenKey) : null;
      const form = new FormData();
      form.append(fieldName, file);
      try {
        const res = await fetch(`${API_BASE_URL}${endpoint}`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          body: form,
        });
        const data = await res.json().catch(() => ({}));
        return { ok: res.ok, status: res.status, data };
      } catch (e) {
        return { ok: false, status: 0,
                 data: { bool: false, response: { message: 'Upload failed. Check your connection.' } } };
      }
    },
  };
}

// student + achiever API clients (same backend)
export const studentApi  = makeClient(STUDENT_TOKEN);
export const achieverApi = makeClient(ACHIEVER_TOKEN);

// auth helpers
export const auth = {
  // student
  saveStudent: async (token, user, refresh) => {
    if (token)   await AsyncStorage.setItem(STUDENT_TOKEN, token);
    if (refresh) await AsyncStorage.setItem(STUDENT_REFRESH, refresh);
    if (user)    await AsyncStorage.setItem(STUDENT_USER, JSON.stringify(user));
  },
  getStudent: async () => {
    const token = await AsyncStorage.getItem(STUDENT_TOKEN);
    const user = JSON.parse((await AsyncStorage.getItem(STUDENT_USER)) || 'null');
    return token ? { token, user } : null;
  },
  clearStudent: async () => { await AsyncStorage.multiRemove([STUDENT_TOKEN, STUDENT_USER, STUDENT_REFRESH]); },

  // achiever
  saveAchiever: async (token, user, refresh) => {
    if (token)   await AsyncStorage.setItem(ACHIEVER_TOKEN, token);
    if (refresh) await AsyncStorage.setItem(ACHIEVER_REFRESH, refresh);
    if (user)    await AsyncStorage.setItem(ACHIEVER_USER, JSON.stringify(user));
  },
  getAchiever: async () => {
    const token = await AsyncStorage.getItem(ACHIEVER_TOKEN);
    const user = JSON.parse((await AsyncStorage.getItem(ACHIEVER_USER)) || 'null');
    return token ? { token, user } : null;
  },
  clearAchiever: async () => { await AsyncStorage.multiRemove([ACHIEVER_TOKEN, ACHIEVER_USER, ACHIEVER_REFRESH]); },
};
