// API health — hit every student-facing v1 endpoint with a real token and
// report which respond correctly. This is the "are the APIs working" sweep.
const { test, expect, request } = require('@playwright/test');
const { API, U, provisionStudent } = require('../utils/api');

let token;
let api;

test.beforeAll(async () => {
  const s = await provisionStudent();
  token = s.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
});

test.afterAll(async () => { await api?.dispose(); });

test('a token was obtained for the test student', () => {
  expect(token, 'register/login should return an access token').toBeTruthy();
});

// path → the JSON key we expect inside response (loose contract check)
const ENDPOINTS = [
  ['GET', '/auth/me', 'user_id'],
  ['GET', '/auth/consent/status', 'consent_status'],
  ['GET', '/cohorts/', null],
  ['GET', '/colleges/', null],
  ['GET', '/colleges/saved', 'colleges'],
  ['GET', '/opportunities/', 'opportunities'],
  ['GET', '/opportunities/shortlist', 'opportunities'],
  ['GET', '/applications/', 'applications'],
  ['GET', '/assemble/groups', 'groups'],
  ['GET', '/assemble/dm/conversations', 'conversations'],
  ['GET', '/market/', 'deals'],
  ['GET', '/document-vault/', 'documents'],
  ['GET', '/document-vault/public-profile', null],
  ['GET', '/readiness/score', 'score'],
  ['GET', '/readiness/score/unlocks', 'unlocks'],
  ['GET', '/readiness/score/events', 'events'],
  ['GET', '/readiness/score/pause', 'max_tokens'],
  ['GET', '/profile/', null],
];

for (const [method, path, key] of ENDPOINTS) {
  test(`${method} ${path}`, async () => {
    const res = await api.fetch(U(path), { method });
    // App convention: HTTP is 200 and the real status lives in the body.
    expect(res.status(), `${path} HTTP status`).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body.bool, `${path} body.bool should be true`).toBeTruthy();
    if (key) {
      expect(body.response, `${path} response present`).toBeTruthy();
      expect(body.response[key], `${path} response.${key} present`).toBeDefined();
    }
  });
}

test('a protected endpoint rejects a missing token (401)', async () => {
  const anon = await request.newContext();
  const res = await anon.get(U('/opportunities/'));
  expect(res.status()).toBe(401);
  await anon.dispose();
});
