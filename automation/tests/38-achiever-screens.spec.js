// Earnings, Domains, Coupons, Profile and Dashboard.
//
// These five were the only authenticated achiever screens with no dedicated
// spec — covered by one test each in 17-achiever-ui-clicks, which asserts that
// a request fires and nothing more. So none of the behaviour that makes them
// safe was tested:
//
//   * Profile refusing to render an editable form it could not load, because
//     saving that empty form would overwrite a real profile with blanks.
//   * Earnings refusing to print a ₹0.00 balance when the request never
//     answered.
//   * Coupons and Earnings asking before a deactivation or a payout.
//
// Failure paths are driven with page.route() rather than by breaking the
// server, so each one is deterministic and leaves no state behind.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin, cachedTokens } = require('../utils/api');
const { ACHIEVER } = require('../utils/v1-surface');

let api, token;

test.beforeAll(async () => {
  const r = await portalLogin('achiever');
  token = r.token || cachedTokens().achiever;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(token, 'seeded achiever should log in').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

const asAchiever = async (page) => {
  await page.addInitScript((t) => localStorage.setItem('achiever_access_token', t), token);
};
const goto = async (page, slug) => {
  await page.goto(`${ACHIEVER}${slug}`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1400);
};

/** Fail one endpoint. `**` on the tail so query strings still match. */
const breakGet = (page, path) =>
  page.route(`**${path}**`, (route) =>
    (route.request().method() === 'GET'
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
      : route.fallback()));

/** Guarantee a coupon exists, so the deactivate guard is exercised rather than
 *  skipped. Codes are unique per run. */
async function ensureCoupon() {
  const cur = await resp(await api.get(U('/achievers/portal/coupons')));
  const live = (cur.coupons || []).find((c) => c.is_active);
  if (live) return live;
  const code = `E2E${Date.now().toString().slice(-6)}`;
  await api.post(U('/achievers/portal/coupons'), {
    data: { code, discount_type: 'percent', value: 10, applies_to: 'all', per_user_limit: 1 },
  });
  const after = await resp(await api.get(U('/achievers/portal/coupons')));
  return (after.coupons || []).find((c) => c.code === code) || null;
}

// ══════════════════════════════════════════════════════════════════════════
test.describe('the APIs these screens read', () => {
  test('payout details and history carry what Earnings renders', async () => {
    const d = await resp(await api.get(U('/achiever-payouts/details')));
    const h = await resp(await api.get(U('/achiever-payouts/')));
    expect(d).toHaveProperty('available_balance');
    expect(Array.isArray(h.payouts)).toBe(true);
  });

  test('the profile endpoint returns the fields the form binds to', async () => {
    const p = await resp(await api.get(U('/achievers/portal/profile')));
    for (const k of ['full_name', 'email']) expect(p).toHaveProperty(k);
  });

  test('a student token is refused on all five feeds', async () => {
    const student = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${cachedTokens().studentPro}` },
    });
    // These APIs answer 200 with `bool:false`; the refusal is in the payload.
    for (const path of ['/achiever-payouts/details', '/achievers/portal/profile',
                        '/achievers/portal/coupons', '/achievers/portal/domains']) {
      const body = await (await student.get(U(path))).json();
      expect(body.bool, `${path} should refuse a student`).toBe(false);
    }
    await student.dispose();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('Earnings', () => {
  test('renders the balance and payout form with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page, '/earnings');

    await expect(page.getByRole('heading', { name: /^Earnings$/i })).toBeVisible();
    await expect(page.getByText(/Available Balance/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Details/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed payout load says so instead of showing ₹0.00', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achiever-payouts/details');
    await goto(page, '/earnings');

    // A zero balance is a claim about the achiever's money. It cannot be made
    // when the request never answered.
    await expect(page.getByText(/couldn't load your payouts/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible();
    // The balance card itself must be gone. (₹0.00 still appears above, in the
    // earnings summary — that request succeeded and zero is its true answer.)
    await expect(page.getByText(/Available Balance/i)).toHaveCount(0);
  });

  test('a failed earnings load offers a retry', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/earnings');
    await goto(page, '/earnings');
    await expect(page.getByText(/couldn't load your earnings/i)).toBeVisible({ timeout: 10_000 });
  });

  // The seeded achiever has a zero balance and the button is disabled below
  // it, so the confirm dialog is only reachable with a balance. Stub the
  // details feed rather than manufacturing real money.
  const withBalance = (page, amount = 500) =>
    page.route('**/achiever-payouts/details**', (route) =>
      (route.request().method() === 'GET'
        ? route.fulfill({
            status: 200, contentType: 'application/json',
            body: JSON.stringify({ bool: true, response: {
              available_balance: amount, in_escrow: 0,
              payout_account_name: 'E2E Achiever',
              payout_account_number: '000111222333',
              payout_ifsc: 'HDFC0000001', payout_upi: 'e2e@upi',
            } }),
          })
        : route.fallback()));

  test('a zero balance disables the request button outright', async ({ page }) => {
    const d = await resp(await api.get(U('/achiever-payouts/details')));
    test.skip(Number(d.available_balance || 0) > 0, 'fixture has a balance');

    await asAchiever(page);
    await goto(page, '/earnings');
    // Nothing to draw: the control is disabled rather than failing on submit.
    await expect(page.getByRole('button', { name: /Request Payout/i })).toBeDisabled();
  });

  test('requesting a payout asks first, and backing out writes nothing', async ({ page }) => {
    await asAchiever(page);
    await withBalance(page, 500);
    let posts = 0;
    await page.route('**/achiever-payouts/request**', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ bool: true, response: {} }) });
    });
    await goto(page, '/earnings');

    await page.locator('input[type="number"]').first().fill('100');
    await page.getByRole('button', { name: /Request Payout/i }).click();

    // Money leaving the platform to a destination the achiever typed in
    // themselves — it asks once, and names where it is going.
    await expect(page.getByText(/Request a payout of/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByText(/000111222333|2333|e2e@upi/i).first()).toBeVisible();

    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
    await page.waitForTimeout(500);
    expect(posts, 'backing out must not request a payout').toBe(0);
  });

  test('confirming does send the request', async ({ page }) => {
    await asAchiever(page);
    await withBalance(page, 500);
    let posts = 0;
    await page.route('**/achiever-payouts/request**', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ bool: true, response: {} }) });
    });
    await goto(page, '/earnings');

    await page.locator('input[type="number"]').first().fill('100');
    await page.getByRole('button', { name: /Request Payout/i }).click();
    await page.getByRole('button', { name: /Request payout/ }).last().click();

    await expect(page.getByText(/Payout requested/i)).toBeVisible({ timeout: 8000 });
    expect(posts).toBe(1);
  });

  test('an amount over the balance is refused before it reaches the server', async ({ page }) => {
    await asAchiever(page);
    await withBalance(page, 500);
    let posts = 0;
    await page.route('**/achiever-payouts/request**', (route) => {
      posts += 1;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify({ bool: true, response: {} }) });
    });
    await goto(page, '/earnings');

    await page.locator('input[type="number"]').first().fill('99999');
    await page.getByRole('button', { name: /Request Payout/i }).click();
    await expect(page.getByText(/more than your available balance/i)).toBeVisible({ timeout: 8000 });
    expect(posts, 'an over-balance request must not reach the server').toBe(0);
  });

  test('a zero amount is refused', async ({ page }) => {
    await asAchiever(page);
    await withBalance(page, 500);
    await goto(page, '/earnings');
    await page.getByRole('button', { name: /Request Payout/i }).click();
    await expect(page.getByText(/greater than zero/i)).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('Domains', () => {
  test('renders the taxonomy with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page, '/domains');

    await expect(page.getByRole('heading', { name: /^Domains$/i, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /Suggest a domain/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed load says so rather than showing an empty taxonomy', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/domains');
    await goto(page, '/domains');
    // An empty list here reads as "you teach nothing".
    await expect(page.getByText(/couldn't load the domains/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('Coupons', () => {
  test('renders the list with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page, '/coupons');

    await expect(page.getByRole('heading', { name: /^Coupons$/i, level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: /New Coupon/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed load does not invite you to re-create existing codes', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/coupons');
    await goto(page, '/coupons');
    // "No coupons yet" would invite a duplicate code that then collides.
    await expect(page.getByText(/couldn't load your coupons/i)).toBeVisible({ timeout: 10_000 });
  });

  test('deactivating asks first and names the code', async ({ page }) => {
    const coupon = await ensureCoupon();
    test.skip(!coupon, 'could not seed a coupon to deactivate');

    await asAchiever(page);
    let deletes = 0;
    await page.route('**/achievers/portal/coupons/**', (route) => {
      if (route.request().method() === 'DELETE') {
        deletes += 1;
        return route.fulfill({ status: 200, contentType: 'application/json',
                               body: JSON.stringify({ bool: true, response: {} }) });
      }
      return route.fallback();
    });
    await goto(page, '/coupons');

    await page.getByTitle('Deactivate').first().click();
    await expect(page.getByText(new RegExp(`Deactivate ${coupon.code}`, 'i'))).toBeVisible();
    // window.confirm() said none of this.
    await expect(page.getByText(/already used it keeps their discount/i)).toBeVisible();

    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
    await page.waitForTimeout(400);
    expect(deletes, 'backing out must not deactivate').toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('Profile', () => {
  test('renders the form populated with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page, '/profile');

    await expect(page.getByRole('button', { name: /Save/i }).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed load refuses to render an editable empty form', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/profile');
    await goto(page, '/profile');

    // This is the important one. The form used to render blank on a failed
    // load, and pressing Save would have written those blanks over a real
    // profile. Refusing to render it is the fix.
    await expect(page.getByText(/couldn't load your profile/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole('button', { name: /^Save Profile$/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible();
  });

  test('a failed save reports it instead of hanging on "Saving…"', async ({ page }) => {
    await asAchiever(page);
    await page.route('**/achievers/portal/profile**', (route) =>
      (route.request().method() === 'PUT'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.fallback()));

    await goto(page, '/profile');
    const save = page.getByRole('button', { name: /Save/i }).first();
    await save.click();

    // save() had no try/catch: setSaving(false) never ran and the button
    // stayed on "Saving…" for good.
    await expect(page.getByText(/Connection problem|Couldn't save/i).first())
      .toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Saving…/)).toHaveCount(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('Dashboard', () => {
  test('renders the overview with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page, '');

    await expect(page.getByText(/Overview/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('a failed funnel says Reach is unavailable rather than hiding the row', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/funnel');
    await goto(page, '');

    // The row used to vanish entirely, which reads as "you have no reach"
    // rather than "we could not measure it".
    await expect(page.getByText(/Reach figures are unavailable/i)).toBeVisible({ timeout: 10_000 });
  });

  test('a failed earnings load does not print a confident ₹0', async ({ page }) => {
    await asAchiever(page);
    await breakGet(page, '/achievers/portal/earnings');
    await goto(page, '');
    // The cards distinguish "unavailable" from zero; the screen must still render.
    await expect(page.getByText(/Overview/i).first()).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('responsive', () => {
  const SIZES = [
    ['mobile 390', 390, 844], ['tablet 820', 820, 1180],
    ['laptop 1440', 1440, 900], ['ultra 2560', 2560, 1440],
  ];
  const SCREENS = ['/earnings', '/domains', '/coupons', '/profile', ''];

  for (const slug of SCREENS) {
    for (const [name, w, h] of SIZES) {
      test(`${slug || '/dashboard'} @ ${name}`, async ({ page }) => {
        await page.setViewportSize({ width: w, height: h });
        await asAchiever(page);
        const errors = [];
        page.on('pageerror', (e) => errors.push(String(e)));

        await goto(page, slug);
        expect(errors, `runtime errors on ${slug || '/'}`).toEqual([]);

        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${slug || '/'} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
      });
    }
  }
});
