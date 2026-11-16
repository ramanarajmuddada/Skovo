// Super-admin / owner portal — API + browser login, using the seeded account
// (e2e.super@skovo-test.local). Run seed_test_accounts.py first.
const { test, expect, request } = require('@playwright/test');
const { U, PORTAL, portalLogin } = require('../utils/api');

let token, api;

test.beforeAll(async () => {
  const r = await portalLogin('super');
  token = r.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
test.afterAll(async () => { await api?.dispose(); });

test('super admin logs in via the API', () => {
  expect(token, 'seeded super admin should log in — run seed_test_accounts.py').toBeTruthy();
});

const PANELS = [
  '/skovo-platform-owner/me',
  '/skovo-platform-owner/admins',
  '/skovo-platform-owner/achievers',
  '/skovo-platform-owner/cohorts',
  '/skovo-platform-owner/communities',
  '/skovo-platform-owner/opportunities',
  '/skovo-platform-owner/enrollments',
  '/skovo-platform-owner/readiness',
  '/skovo-platform-owner/audit',
];

for (const path of PANELS) {
  test(`super API ${path}`, async () => {
    const res = await api.get(U(path));
    expect(res.status(), `${path} http`).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body.bool, `${path} bool`).toBeTruthy();
  });
}

test('super admin panel loads in the browser', async ({ page }) => {
  await page.goto(PORTAL.super.uiLogin, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(PORTAL.super.email);
  await page.locator('input[type="password"]').first().fill(PORTAL.super.password);
  await page.getByRole('button', { name: /sign in|log in|continue|login/i }).first().click();
  // Wait for the post-login redirect rather than a fixed 2.5s, which was
  // shorter than the login round-trip against a remote RDS.
  await page.waitForURL(u => u.pathname.startsWith('/skovo-platform-owner') && !/\/login$/.test(u.pathname),
                        { timeout: 30_000 }).catch(() => {});
  expect(page.url()).toContain('skovo-platform-owner');
  expect(page.url(), 'should leave the login page').not.toMatch(/\/login$/);
});
