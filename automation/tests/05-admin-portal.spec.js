// Admin portal — API panels + browser login, using the seeded founder account.
// Run automation/seed_test_accounts.py first (creates e2e.admin@skovo-test.local).
const { test, expect, request } = require('@playwright/test');
const { U, PORTAL, portalLogin } = require('../utils/api');

let token, api;

test.beforeAll(async () => {
  const r = await portalLogin('admin');
  token = r.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
test.afterAll(async () => { await api?.dispose(); });

test('admin logs in via the API', () => {
  expect(token, 'seeded admin should log in — run seed_test_accounts.py').toBeTruthy();
});

// Employers and Team & Roles were removed from the admin console on purpose
// (see CLAUDE.md) - their endpoints 404, so they are not panels to test.
const PANELS = [
  ['/skovo-platform-panel-admin/users', null],
  ['/skovo-platform-panel-admin/cohorts', null],
  ['/skovo-platform-panel-admin/opportunities', null],
  ['/skovo-platform-panel-admin/achievers', null],
  ['/skovo-platform-panel-admin/market', 'deals'],
  ['/skovo-platform-panel-admin/dm-reports', 'reports'],
  ['/skovo-platform-panel-admin/score-rules', 'rules'],
  ['/skovo-platform-panel-admin/subscriptions', 'plans'],
  ['/skovo-platform-panel-admin/analytics/v1-metrics', 'score_distribution'],
];

for (const [path, key] of PANELS) {
  test(`admin API ${path}`, async () => {
    const res = await api.get(U(path));
    expect(res.status(), `${path} http`).toBe(200);
    const body = await res.json().catch(() => ({}));
    expect(body.bool, `${path} bool`).toBeTruthy();
    if (key) expect(body.response?.[key], `${path} response.${key}`).toBeDefined();
  });
}

test('admin panel loads in the browser and shows the dashboard', async ({ page }) => {
  await page.goto(PORTAL.admin.uiLogin, { waitUntil: 'domcontentloaded' });
  await page.locator('input[type="email"]').first().fill(PORTAL.admin.email);
  await page.locator('input[type="password"]').first().fill(PORTAL.admin.password);
  await page.getByRole('button', { name: /sign in|log in|continue|login/i }).first().click();
  // Wait for the post-login redirect rather than a fixed 2.5s, which was
  // shorter than the login round-trip against a remote RDS.
  await page.waitForURL(u => u.pathname.startsWith('/skovo-platform-panel-admin') && !/\/login$/.test(u.pathname),
                        { timeout: 30_000 }).catch(() => {});
  expect(page.url()).toContain('skovo-platform-panel-admin');
  expect(page.url(), 'should leave the login page').not.toMatch(/\/login$/);
});
