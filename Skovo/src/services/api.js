const API_HOST = import.meta.env.VITE_API_HOST || '';
const BASE_URL = API_HOST ? `https://${API_HOST}/v1` : '/v1';
export const API_BASE_URL = BASE_URL;

// Where uploaded files are actually served from. Empty means same-origin, which
// is what the Vite dev proxy and the nginx config arrange by forwarding
// /uploads/ to the backend alongside /v1/.
export const MEDIA_ORIGIN = API_HOST ? `https://${API_HOST}` : '';

/**
 * Turn a stored file reference into a URL a browser will actually load.
 *
 * The bug this exists for: the upload API returns "/uploads/<name>", that string
 * is what gets written to the database, and a root-relative URL in an `<img src>`
 * resolves against **the page origin** — the SPA. On a split-host deploy the SPA
 * answers with its index.html catch-all, so the image fails to decode and the
 * avatar falls back to the default. The upload had succeeded, the row was
 * correct, and the photo was still invisible.
 *
 * The backend now returns an absolute URL when PUBLIC_MEDIA_BASE_URL is set, but
 * this stays on the read path for two reasons: rows written before that fix are
 * still relative and there is no migration, and a backend whose env is missing
 * the base should degrade to a working image rather than a blank one.
 *
 * Anything already absolute — http(s), protocol-relative, data: or blob: — is
 * returned untouched, so an externally hosted avatar and a local object-URL
 * preview both keep working.
 */
export function mediaUrl(u) {
  if (typeof u !== 'string') return '';
  const s = u.trim();
  if (!s) return '';
  if (/^(https?:)?\/\//i.test(s) || /^(data|blob):/i.test(s)) return s;
  if (s.startsWith('/')) return `${MEDIA_ORIGIN}${s}`;
  // A bare stored filename (the upload response also carries `filename`).
  // Nothing else is guessed at: an unrecognised string is handed back as-is
  // rather than being bent into a path that was never valid.
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9]{1,10}$/.test(s)) return `${MEDIA_ORIGIN}/uploads/${s}`;
  return s;
}

/**
 * The URL that downloads a stored file rather than rendering it in a tab.
 *
 * The backend's /uploads/<name> route answers `?download=1` with
 * Content-Disposition: attachment — set on the presigned S3 response, not here,
 * because a header this side would be lost across the 302 to S3. `filename`
 * gives the saved file a readable name; without it a person's Downloads folder
 * fills up with 32-character UUIDs.
 *
 * Only our own files get the parameters. A pasted Google Drive link is somebody
 * else's server: appending a query it does not understand is at best ignored
 * and at worst breaks the link, so it is returned exactly as stored.
 */
export function mediaDownloadUrl(u, filename) {
  const url = mediaUrl(u);
  if (!url) return '';
  const isOurs = url.startsWith(`${MEDIA_ORIGIN}/uploads/`) || url.startsWith('/uploads/');
  if (!isOurs) return url;
  const q = new URLSearchParams({ download: '1' });
  if (filename) q.set('filename', filename);
  return `${url}${url.includes('?') ? '&' : '?'}${q.toString()}`;
}

// Socket.IO (realtime whiteboard) connects to the backend's origin directly —
// no `/v1` prefix, since Socket.IO owns its own `/socket.io/` path. CORS on
// the backend already allows all origins, so this works in dev without
// needing a Vite proxy entry.
export const SOCKET_URL = API_HOST ? `https://${API_HOST}` : 'http://127.0.0.1:5000';

function getInstitutionSlug() {
  const host = window.location.hostname;
  const parts = host.split('.');

  // *.localhost (e.g. gitamskovoin.localhost) — Chrome/Firefox resolve these natively
  if (parts.length === 2 && parts[1] === 'localhost') {
    return parts[0];
  }

  // plain localhost or 127.0.0.1 — fall back to localStorage override or demo
  if (host === 'localhost' || host === '127.0.0.1') {
    return localStorage.getItem('dev_institution_slug') || 'demo';
  }

  // production: gitamskovoin.skovo.in → parts[0] = 'gitamskovoin'
  if (parts.length >= 3) {
    return parts[0];
  }

  return 'demo';
}

function getTokens() {
  return {
    accessToken: localStorage.getItem('access_token'),
    refreshToken: localStorage.getItem('refresh_token'),
  };
}

export function saveTokens(accessToken, refreshToken) {
  if (accessToken) localStorage.setItem('access_token', accessToken);
  if (refreshToken) localStorage.setItem('refresh_token', refreshToken);
}

export function clearTokens() {
  localStorage.removeItem('access_token');
  localStorage.removeItem('refresh_token');
  localStorage.removeItem('user');
}

// ── Readiness score: telling the screens the number moved ────────────────────
//
// The score is earned as a side effect of doing something else — checking in to
// a cohort, uploading a document, joining a community — and the screen showing
// it is usually not the screen the student is on. Every score surface used to
// fetch once on mount, so a student who earned points and came back to the
// Dashboard saw the old number until they reloaded the page by hand.
//
// One place knows a scoring action just succeeded: the request layer. These are
// the endpoints wired to `portal.helpers.score.award()` on the backend; a
// successful write to any of them broadcasts, and anything rendering the score
// listens. Matching here rather than at each call site means a new caller of an
// existing endpoint is covered for free.
//
// Read-only verbs never fire this, so the Dashboard's own GET cannot loop.
const SCORE_EARNING_PATHS = [
  /^\/cohorts\/[^/]+\/check-in/,
  /^\/document-vault(\/|$)/,
  /^\/profile(\/|$)/,
  /^\/applications(\/|$)/,
  /^\/assemble(\/|$)/,
  /^\/market\/[^/]+\/redeem/,
  /^\/colleges\/[^/]+\/save/,
  /^\/readiness(\/|$)/,
];

export const SCORE_CHANGED_EVENT = 'skovo:score-changed';

function announceScoreMaybeChanged(endpoint, method, data) {
  if (method === 'GET' || typeof window === 'undefined') return;
  // `bool` is this API's success flag — a refused action earned nothing.
  if (!data?.bool) return;
  const path = endpoint.split('?')[0];
  if (!SCORE_EARNING_PATHS.some((re) => re.test(path))) return;
  window.dispatchEvent(new CustomEvent(SCORE_CHANGED_EVENT, { detail: { endpoint } }));
}

/** Subscribe to "a scoring action just succeeded". Returns an unsubscribe fn. */
export function onScoreChanged(handler) {
  if (typeof window === 'undefined') return () => {};
  window.addEventListener(SCORE_CHANGED_EVENT, handler);
  return () => window.removeEventListener(SCORE_CHANGED_EVENT, handler);
}

let isRefreshing = false;
let refreshQueue = [];

async function refreshAccessToken() {
  const { refreshToken } = getTokens();
  if (!refreshToken) throw new Error('No refresh token');

  const response = await fetch(`${BASE_URL}/auth/token/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${refreshToken}`,
      'X-Institution-Slug': getInstitutionSlug(),
    },
  });

  const data = await response.json();
  if (!response.ok || !data.bool) throw new Error('Token refresh failed');

  saveTokens(data.access_token, null);
  return data.access_token;
}

async function request(endpoint, options = {}) {
  const { accessToken } = getTokens();

  const headers = {
    'Content-Type': 'application/json',
    'X-Institution-Slug': getInstitutionSlug(),
    ...options.headers,
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });

  if (response.status === 401 && accessToken) {
    if (isRefreshing) {
      return new Promise((resolve, reject) => {
        refreshQueue.push({ resolve, reject });
      }).then(async (newToken) => {
        headers.Authorization = `Bearer ${newToken}`;
        const retryResp = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
        const retryData = await retryResp.json();
        announceScoreMaybeChanged(endpoint, options.method, retryData);
        return { data: retryData, status: retryResp.status, ok: retryResp.ok };
      });
    }

    isRefreshing = true;
    try {
      const newToken = await refreshAccessToken();
      refreshQueue.forEach((p) => p.resolve(newToken));
      refreshQueue = [];
      headers.Authorization = `Bearer ${newToken}`;
      response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
    } catch (err) {
      refreshQueue.forEach((p) => p.reject(err));
      refreshQueue = [];
      clearTokens();
      window.location.href = '/login';
      throw err;
    } finally {
      isRefreshing = false;
    }
  }

  const data = await response.json();
  announceScoreMaybeChanged(endpoint, options.method, data);
  return { data, status: response.status, ok: response.ok };
}

/**
 * Upload with progress, via XHR.
 *
 * fetch() cannot report upload progress — it only resolves once the whole body
 * has gone out. On Indian mobile data a 10 MB document is a long silence, and a
 * spinner with no number is indistinguishable from a hang, so people retry and
 * upload it twice. XHR still exposes `upload.onprogress`, so this stays on XHR.
 *
 * Resolves the same shape as the fetch uploads it replaces: { data, status, ok }.
 * Network failure, abort and timeout reject with a message worth showing.
 */
function xhrUpload(endpoint, formData, { token, onProgress, signal, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BASE_URL}${endpoint}`);
    xhr.timeout = timeout;
    xhr.setRequestHeader('X-Institution-Slug', getInstitutionSlug());
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);

    if (onProgress) {
      xhr.upload.onprogress = e => {
        // Not every transfer reports a total; report only real percentages.
        if (e.lengthComputable && e.total > 0) {
          onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
        }
      };
      // The bytes are out, but the server has not answered yet. Holding at 99
      // until it does is honest; jumping to 100 and then sitting there is not.
      xhr.upload.onload = () => onProgress(99);
    }

    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // An HTML error page from a proxy, or a body cut off mid-flight.
        reject(new Error(
          xhr.status >= 500
            ? 'The server had a problem saving this file. Try again in a moment.'
            : 'The server sent back something unreadable. Try again.'
        ));
        return;
      }
      announceScoreMaybeChanged(endpoint, 'POST', data);
      resolve({ data, status: xhr.status, ok: xhr.status >= 200 && xhr.status < 300 });
    };

    // `network: true` lets the file picker retry once. The wording no longer
    // blames the server: this fires for any request the browser could not send,
    // including a chosen file it can no longer read.
    xhr.onerror   = () => reject(Object.assign(
      new Error('Could not send the file. Check your connection and try again. '
              + 'If it keeps failing, choose the file again or take a fresh photo.'),
      { network: true }));
    xhr.ontimeout = () => reject(new Error('The upload timed out. On a slow connection, try a smaller file.'));
    xhr.onabort   = () => reject(Object.assign(new Error('Upload cancelled.'), { cancelled: true }));

    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener('abort', () => xhr.abort(), { once: true });
    }

    xhr.send(formData);
  });
}

// ── GET caching ───────────────────────────────────────────────────────────────
// Two problems, one mechanism.
//
// 1. Duplicate requests. React runs every effect twice under StrictMode, and
//    screens legitimately fire the same GET from more than one place. Without
//    this, the Colleges list asked the server for the same page four times on a
//    single mount. `inFlight` collapses concurrent callers onto one request.
//
// 2. Re-entry. Going Colleges -> a college -> back re-mounts the page with
//    nothing in hand, so it shows a skeleton and waits on the network for a
//    list it displayed seconds ago. A short TTL means the second visit paints
//    immediately.
//
// Deliberately opt-in: `api.get` is untouched, so nothing caches unless the
// caller asked. Use it for reads that are safe a few seconds stale — a browse
// list, a dropdown's options. Never for anything the user just wrote.
const getCache = new Map();     // url -> { at, value }
const inFlight = new Map();     // url -> Promise

/** Forget cached GETs. Pass a prefix to drop one screen's, nothing for all. */
export function invalidateGetCache(prefix) {
  if (!prefix) return getCache.clear();
  for (const key of [...getCache.keys()]) {
    if (key.startsWith(prefix)) getCache.delete(key);
  }
}

function buildUrl(endpoint, params) {
  return params ? `${endpoint}?${new URLSearchParams(params).toString()}` : endpoint;
}

export const api = {
  get: (endpoint, params) => request(buildUrl(endpoint, params), { method: 'GET' }),

  /**
   * Is there a warm cache entry for this GET?
   *
   * Screens ask before deciding whether to show a skeleton: with an answer
   * already in hand, a loading state is a flash of grey bars over data that
   * never actually went away.
   */
  hasCached: (endpoint, params, ttl = 60000) => {
    const hit = getCache.get(buildUrl(endpoint, params));
    return !!hit && Date.now() - hit.at < ttl;
  },

  /**
   * GET, served from a short-lived cache when one is warm.
   *
   * `ttl`   how long a cached response stays servable, in ms.
   * `onStale` if given, a cache hit is returned immediately AND the request is
   *         still made; `onStale(result)` fires only if the fresh response
   *         differs from what was served. That is the stale-while-revalidate
   *         path: the screen paints instantly and corrects itself if the
   *         server has moved on. Without it, a hit simply skips the network.
   *
   * Only successful responses (`data.bool`) are cached — an error must never
   * become the answer for the next few seconds.
   */
  getCached: (endpoint, params, { ttl = 60000, onStale } = {}) => {
    const url = buildUrl(endpoint, params);
    const hit = getCache.get(url);
    const fresh = hit && Date.now() - hit.at < ttl;

    if (fresh && !onStale) return Promise.resolve(hit.value);

    const pending = inFlight.get(url) || (() => {
      const p = request(url, { method: 'GET' })
        .then((res) => {
          if (res?.data?.bool) getCache.set(url, { at: Date.now(), value: res });
          return res;
        })
        .finally(() => inFlight.delete(url));
      inFlight.set(url, p);
      return p;
    })();

    if (!fresh) return pending;

    // Cache hit with a revalidator: hand back the cached copy now, and call
    // back later only if the server disagrees with it.
    pending
      .then((res) => {
        if (res?.data?.bool && JSON.stringify(res.data) !== JSON.stringify(hit.value.data)) {
          onStale(res);
        }
      })
      .catch(() => {});          // a failed refresh leaves the cached list up
    return Promise.resolve(hit.value);
  },
  post: (endpoint, body) => request(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  put: (endpoint, body) => request(endpoint, { method: 'PUT', body: JSON.stringify(body) }),
  patch: (endpoint, body) => request(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint) => request(endpoint, { method: 'DELETE' }),
  // An access token lives 30 minutes. request() quietly swaps in a fresh one when
  // the server says it has expired; uploads used to send whatever was stored and
  // fail with "Signature has expired" on a session that was perfectly fine.
  upload: async (endpoint, formData, opts = {}) => {
    const { accessToken, refreshToken } = getTokens();
    const res = await xhrUpload(endpoint, formData, { ...opts, token: accessToken });
    if (res.status !== 401 || !refreshToken) return res;
    let fresh;
    try {
      fresh = await refreshAccessToken();
    } catch (err) {
      clearTokens();
      window.location.href = '/login';
      throw err;
    }
    return xhrUpload(endpoint, formData, { ...opts, token: fresh });
  },
};

// ── Admin API ─────────────────────────────────────────────────────────────────
// Uses admin_access_token (separate from regular user access_token)

function getAdminToken() {
  return localStorage.getItem('admin_access_token');
}

export function clearAdminToken() {
  localStorage.removeItem('admin_access_token');
  localStorage.removeItem('admin_user');
}

async function adminRequest(endpoint, options = {}) {
  const token = getAdminToken();

  const headers = {
    'Content-Type': 'application/json',
    'X-Institution-Slug': getInstitutionSlug(),
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });

  if (response.status === 401 && await isTokenDead(response)) {
    clearAdminToken();
    goToLogin('/skovo-platform-panel-admin/login');
    throw new Error('Admin session expired');
  }

  const data = await response.json();
  return { data, status: response.status, ok: response.ok };
}

export const adminApi = {
  get:    (endpoint, params) => {
    const url = params ? `${endpoint}?${new URLSearchParams(params).toString()}` : endpoint;
    return adminRequest(url, { method: 'GET' });
  },
  post:   (endpoint, body)  => adminRequest(endpoint, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (endpoint, body)  => adminRequest(endpoint, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (endpoint, body)  => adminRequest(endpoint, { method: 'PATCH',  body: JSON.stringify(body) }),
  // Optional body: cancelling a booking sends where the refund goes and why.
  delete: (endpoint, body)  => adminRequest(endpoint, { method: 'DELETE', ...(body !== undefined && { body: JSON.stringify(body) }) }),
};

/**
 * Is this 401 the token being dead, or an endpoint saying no?
 *
 * They are very different things and the portals treated them the same: any 401
 * cleared the session and bounced to the login page. One background poll hitting
 * a guard -- a role check, a route the account cannot reach -- logged the person
 * out mid-task, with no way to tell why.
 *
 * portal/helpers/jwt.py answers this for us. Genuine token failures come back
 * with a top-level `error` code; every application-level guard returns the app's
 * own {response, status, bool} shape and no such code.
 */
const TOKEN_DEAD = new Set([
  'token_expired', 'invalid_token', 'token_revoked', 'authorization_required',
]);

async function isTokenDead(response) {
  try {
    // Cloned: the caller still needs to read the body.
    const body = await response.clone().json();
    return TOKEN_DEAD.has(body?.error);
  } catch {
    // A 401 with no readable body is not evidence of a dead token, and guessing
    // wrong costs someone their session.
    return false;
  }
}

/** Send them to a login page, unless they are already looking at one. */
function goToLogin(path) {
  if (window.location.pathname !== path) window.location.href = path;
}

// ── Achiever Portal API ───────────────────────────────────────────────────────

function getAchieverToken() {
  return localStorage.getItem('achiever_access_token');
}

export function saveAchieverToken(token) {
  if (token) localStorage.setItem('achiever_access_token', token);
}

export function clearAchieverToken() {
  localStorage.removeItem('achiever_access_token');
  localStorage.removeItem('achiever_user');
}

/**
 * Merge fields into the cached achiever and tell the app about it.
 *
 * `achiever_user` was only ever written at login, so anything the achiever
 * changed about themselves afterwards — a new profile photo, most visibly —
 * did not reach the header avatar until they signed in again. The student
 * portal has an AuthContext doing this; the achiever portal has no equivalent,
 * and a context added for one field would be the larger change.
 *
 * The event is what makes it live: a localStorage write fires `storage` in
 * *other* tabs only, never the one that wrote it.
 */
export function publishAchieverUser(patch) {
  let current = {};
  try { current = JSON.parse(localStorage.getItem('achiever_user') || '{}'); } catch { current = {}; }
  const next = { ...current, ...patch };
  try { localStorage.setItem('achiever_user', JSON.stringify(next)); } catch { /* quota / private mode */ }
  window.dispatchEvent(new CustomEvent('achiever-user-updated', { detail: next }));
  return next;
}

async function achieverRequest(endpoint, options = {}) {
  const token = getAchieverToken();
  const headers = {
    'Content-Type': 'application/json',
    'X-Institution-Slug': getInstitutionSlug(),
    ...options.headers,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401 && await isTokenDead(response)) {
    clearAchieverToken();
    goToLogin('/skovo-achiever-portal/login');
    throw new Error('Achiever session expired');
  }
  const data = await response.json();
  return { data, status: response.status, ok: response.ok };
}

// Identical GETs that overlap in time share one request.
//
// Loading the verification screen fired /achievers/portal/profile four times:
// AchieverLayout wants the commission rate and seat allocation, ProfileReview
// wants the same row to fill its form, and StrictMode double-invokes both
// effects in dev. Four identical round trips, on the screen an achiever opens
// on a phone before anything else.
//
// In flight only — the entry is dropped the moment the request settles, so this
// coalesces concurrent callers without ever serving a stale body. Anything
// wanting a real TTL cache should use the main api's getCached instead.
const achieverInFlight = new Map();

export const achieverApi = {
  get:    (endpoint, params) => {
    const url = params ? `${endpoint}?${new URLSearchParams(params).toString()}` : endpoint;
    const existing = achieverInFlight.get(url);
    if (existing) return existing;
    const pending = achieverRequest(url, { method: 'GET' })
      .finally(() => achieverInFlight.delete(url));
    achieverInFlight.set(url, pending);
    return pending;
  },
  post:   (endpoint, body)  => achieverRequest(endpoint, { method: 'POST',   body: JSON.stringify(body) }),
  put:    (endpoint, body)  => achieverRequest(endpoint, { method: 'PUT',    body: JSON.stringify(body) }),
  patch:  (endpoint, body)  => achieverRequest(endpoint, { method: 'PATCH',  body: JSON.stringify(body) }),
  delete: (endpoint)        => achieverRequest(endpoint, { method: 'DELETE' }),
  upload: (endpoint, formData, opts = {}) =>
    xhrUpload(endpoint, formData, { ...opts, token: getAchieverToken() }),
};

// ── Super Admin API ───────────────────────────────────────────────────────────
// Uses a separate token stored in super_access_token

function getSuperToken() {
  return localStorage.getItem('super_access_token');
}

export function saveSuperToken(token) {
  if (token) localStorage.setItem('super_access_token', token);
}

export function clearSuperToken() {
  localStorage.removeItem('super_access_token');
  localStorage.removeItem('super_user');
}

async function superRequest(endpoint, options = {}) {
  const token = getSuperToken();

  const headers = {
    'Content-Type': 'application/json',
    'X-Institution-Slug': getInstitutionSlug(),
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, { ...options, headers });
  if (response.status === 401 && await isTokenDead(response)) {
    clearSuperToken();
    goToLogin('/skovo-platform-owner/login');
    throw new Error('Super session expired');
  }
  const data = await response.json();
  return { data, status: response.status, ok: response.ok };
}

export const superApi = {
  get: (endpoint, params) => {
    const url = params
      ? `${endpoint}?${new URLSearchParams(params).toString()}`
      : endpoint;
    return superRequest(url, { method: 'GET' });
  },
  post: (endpoint, body) => superRequest(endpoint, { method: 'POST', body: JSON.stringify(body) }),
  patch: (endpoint, body) => superRequest(endpoint, { method: 'PATCH', body: JSON.stringify(body) }),
  delete: (endpoint) => superRequest(endpoint, { method: 'DELETE' }),
};

