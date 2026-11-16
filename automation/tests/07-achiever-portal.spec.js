// Achiever / mentor portal — API + browser login, using the seeded account
// (e2e.achiever@skovo-test.local). Run seed_test_accounts.py first.
const { test, expect, request } = require('@playwright/test');
const { U, PORTAL, portalLogin } = require('../utils/api');

let token, api;

test.beforeAll(async () => {
  const r = await portalLogin('achiever');
  token = r.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
test.afterAll(async () => { await api?.dispose(); });

test('achiever logs in via the API', () => {
  expect(token, 'seeded achiever should log in — run seed_test_accounts.py').toBeTruthy();
});

const PANELS = [
  '/achiever-availability/my-availability',
  '/achiever-availability/my-slots',
  '/achiever-payouts/details',
  '/achiever-payouts/',
  '/courses/portal/',
];

for (const path of PANELS) {
  test(`achiever API ${path}`, async () => {
    const res = await api.get(U(path));
    expect(res.status(), `${path} http`).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body.bool, `${path} bool`).toBeTruthy();
  });
}

test('achiever portal loads in the browser', async ({ page }) => {
  await page.goto(PORTAL.achiever.uiLogin, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(PORTAL.achiever.email);
  await page.locator('input[type="password"]').first().fill(PORTAL.achiever.password);
  await page.getByRole('button', { name: /sign in|log in|continue|login/i }).first().click();
  // Wait for the post-login redirect rather than a fixed 2.5s, which was
  // shorter than the login round-trip against a remote RDS.
  await page.waitForURL(u => u.pathname.startsWith('/skovo-achiever-portal') && !/\/login$/.test(u.pathname),
                        { timeout: 30_000 }).catch(() => {});
  expect(page.url()).toContain('skovo-achiever-portal');
  expect(page.url(), 'should leave the login page').not.toMatch(/\/login$/);
});
