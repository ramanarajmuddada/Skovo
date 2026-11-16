// Every admin / super / achiever panel SCREEN, rendered in the browser.
// Complements the API-level portal specs by proving the UI actually mounts.
//
// Route lists come from utils/v1-surface.js, which 37-v1-surface-contract
// checks against the real router — so a screen added to App.jsx cannot stay
// untested here.
const { test, expect } = require('@playwright/test');
const { portalLogin } = require('../utils/api');
const {
  ADMIN, SUPER, ACHIEVER,
  ADMIN_SCREENS, SUPER_SCREENS, ACHIEVER_SCREENS, NOT_FOUND_MARKER,
} = require('../utils/v1-surface');

// ── helpers ───────────────────────────────────────────────────────────────
async function seedPortalSession(page, which, token) {
  const keys = {
    admin: ['admin_access_token', 'admin_user'],
    super: ['super_access_token', 'super_user'],
    achiever: ['achiever_access_token', 'achiever_user'],
  }[which];
  await page.addInitScript(([tokenKey, userKey, t]) => {
    localStorage.setItem(tokenKey, t);
    localStorage.setItem(userKey, JSON.stringify({
      id: 'e2e', user_id: 'e2e', full_name: 'E2E', role: 'admin', admin_role: 'founder',
    }));
  }, [keys[0], keys[1], token]);
}

async function screenRenders(page, route, heading) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(route, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  expect(page.url(), `${route} bounced to login`).not.toMatch(/\/login$/);
  // NotFound echoes the failed path, so a route-derived regex matches the 404
  // page itself — rule it out before trusting the heading.
  await expect(page.getByText(NOT_FOUND_MARKER).first(),
    `${route} fell through to the 404 screen`).toHaveCount(0);
  await expect(page.getByText(heading).first(), `${route} heading`).toBeVisible();
  expect(errors, `${route} runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
}

/** Build one describe block per portal. */
function portalSuite(name, which, base, screens) {
  test.describe(`${name} screens`, () => {
    let token;
    test.beforeAll(async () => { token = (await portalLogin(which)).token; });
    test.beforeEach(async ({ page }) => {
      test.skip(!token, `no ${which} token — run seed_test_accounts.py`);
      await seedPortalSession(page, which, token);
    });

    for (const [suffix, heading] of screens) {
      test(`${name} screen ${suffix || '/'}`, async ({ page }) => {
        await screenRenders(page, base + suffix, heading);
      });
    }
  });
}

portalSuite('admin', 'admin', ADMIN, ADMIN_SCREENS);
portalSuite('super admin', 'super', SUPER, SUPER_SCREENS);
portalSuite('achiever portal', 'achiever', ACHIEVER, ACHIEVER_SCREENS);
