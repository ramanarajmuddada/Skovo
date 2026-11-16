// Shared helpers: talk to the backend directly, and provision a known test
// student so the suite is self-contained (no reliance on pre-seeded logins).
const { request: pwRequest } = require('@playwright/test');

const BACKEND = process.env.SKOVO_BACKEND || 'http://127.0.0.1:5000';
const API = BACKEND + '/v1';

// A stable-per-run student. Timestamp keeps re-runs from colliding on email.
const RUN = Date.now();
const STUDENT = {
  full_name: 'E2E Student',
  email: `e2e.student.${RUN}@skovo-test.local`,
  password: 'E2ePass!234',
};

// Absolute URLs only — a baseURL ending in /v1 silently drops the prefix when a
// path starts with "/", so we always build the full URL here.
const U = (p) => API + p;

// Tokens cached by global-setup.js. /auth/login is rate limited (50/hour/IP),
// so specs reuse these rather than logging in again.
let _cached = null;
function cachedTokens() {
  if (_cached) return _cached;
  try {
    _cached = JSON.parse(require('fs').readFileSync(
      require('path').join(__dirname, '..', '.auth', 'tokens.json'), 'utf8'));
  } catch { _cached = {}; }
  return _cached;
}

async function ctx() {
  return pwRequest.newContext();
}

function tokenFrom(body) {
  return body.access_token || body.response?.access_token
      || body.token || body.response?.token;
}

/** Register the test student and push them through the DOB consent gate (adult),
 *  so the account is fully granted and usable in the browser. Returns tokens. */
async function provisionStudent() {
  // global-setup already registered one and cleared its consent gate.
  const cache = cachedTokens();
  if (cache.fresh) return { ...STUDENT, email: cache.freshEmail || STUDENT.email, token: cache.fresh };

  const c = await ctx();
  let res = await c.post(U('/auth/register'), { data: STUDENT });
  let body = await res.json().catch(() => ({}));
  let token = tokenFrom(body);

  // If this email already exists from a previous run, fall back to login.
  if (!token) {
    res = await c.post(U('/auth/login'), { data: { email: STUDENT.email, password: STUDENT.password } });
    body = await res.json().catch(() => ({}));
    token = tokenFrom(body);
  }

  // Clear the DPDP gate with an adult DOB.
  if (token) {
    await c.post(U('/auth/consent/dob'), {
      headers: { Authorization: `Bearer ${token}` },
      data: { date_of_birth: '2000-01-01' },
    }).catch(() => {});

    // First login now lives on Profile (no onboarding modal). Incomplete
    // profiles redirect every other route to /profile, so tests seed a
    // complete path: stage, state, city, course, year, reservation.
    await c.patch(U('/profile/'), {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        education_level: 'ug', education_category: 'ug',
        state: 'Telangana', city: 'Hyderabad',
        degree_category: 'Engineering', degree_type: 'B.Tech', branch: 'CSE',
        year_of_study: '2nd Year',
      },
    }).catch(() => {});
    await c.put(U('/profile/goals'), {
      headers: { Authorization: `Bearer ${token}` },
      data: { reservation_category: 'general' },
    }).catch(() => {});
  }
  await c.dispose();
  // education_level rides back with the student so specs can put it in the
  // localStorage `user` object — MainLayout reads the flag from there, not
  // from the API, so seeding the token alone still leaves the modal up.
  return { ...STUDENT, token, education_level: 'ug' };
}

async function login(email, password) {
  const c = await ctx();
  const res = await c.post(U('/auth/login'), { data: { email, password } });
  const body = await res.json().catch(() => ({}));
  await c.dispose();
  return { status: res.status(), token: tokenFrom(body), body };
}

// Seeded portal accounts (see seed_test_accounts.py). Overridable via env.
const PORTAL = {
  admin: {
    loginPath: '/skovo-platform-panel-admin/login',
    uiLogin: '/skovo-platform-panel-admin/login',
    email: process.env.SKOVO_ADMIN_EMAIL || 'e2e.admin@skovo-test.local',
    password: process.env.SKOVO_ADMIN_PASSWORD || 'E2ePass!234',
  },
  super: {
    loginPath: '/skovo-platform-owner/login',
    uiLogin: '/skovo-platform-owner/login',
    email: process.env.SKOVO_SUPER_EMAIL || 'e2e.super@skovo-test.local',
    password: process.env.SKOVO_SUPER_PASSWORD || 'E2ePass!234',
  },
  achiever: {
    loginPath: '/achiever/login',
    uiLogin: '/skovo-achiever-portal/login',
    email: process.env.SKOVO_ACHIEVER_EMAIL || 'e2e.achiever@skovo-test.local',
    password: process.env.SKOVO_ACHIEVER_PASSWORD || 'E2ePass!234',
  },
};

/** Log into a portal via its API. Returns a token (or null if the seeded
 *  account is missing — run seed_test_accounts.py first). */
async function portalLogin(which) {
  const p = PORTAL[which];
  const cache = cachedTokens();
  if (cache[which]) return { status: 200, token: cache[which], body: {}, creds: p };

  const c = await ctx();
  const res = await c.post(U(p.loginPath), { data: { email: p.email, password: p.password } });
  const body = await res.json().catch(() => ({}));
  await c.dispose();
  return { status: res.status(), token: tokenFrom(body), body, creds: p };
}

// Seeded fixed students (seed_test_accounts.py): a Pro one (score 75) and a
// free one (score 0), both consent-granted.
const STUDENTS = {
  pro: { email: 'e2e.pro@skovo-test.local', password: 'E2ePass!234' },
  free: { email: 'e2e.free@skovo-test.local', password: 'E2ePass!234' },
};

/** Log in as a seeded student and return an authed request context + token. */
async function studentContext(which) {
  const s = STUDENTS[which];
  const cache = cachedTokens();
  const cachedKey = which === 'pro' ? 'studentPro' : 'studentFree';
  const token = cache[cachedKey] || (await login(s.email, s.password)).token;
  const api = await pwRequest.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  return { token, api, email: s.email };
}

module.exports = {
  BACKEND, API, STUDENT, STUDENTS, PORTAL, cachedTokens,
  provisionStudent, login, portalLogin, studentContext, ctx, U,
};
