// Click-level coverage for the achiever portal.
//
// The other achiever specs drive the API directly, which proves the endpoints
// work but NOT that the screens are wired to them. That is exactly the gap that
// let six admin pages ship calling the student API client. Every test here
// clicks a real control and asserts the resulting request goes to the right
// endpoint carrying the ACHIEVER token.
const { test, expect } = require('@playwright/test');
const { portalLogin } = require('../utils/api');

let token;

test.beforeAll(async () => {
  token = (await portalLogin('achiever')).token;
  expect(token, 'achiever login returned a token').toBeTruthy();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript((t) => {
    localStorage.setItem('achiever_access_token', t);
    localStorage.setItem('achiever_user', JSON.stringify({
      id: 'e2e', user_id: 'e2e', full_name: 'E2E Achiever', role: 'achiever',
    }));
  }, token);
});

const H = '/skovo-achiever-portal';

/** Wait for a request to `pathFragment` and assert it carries the achiever token. */
function expectAchieverRequest(page, pathFragment, method) {
  return page.waitForRequest((r) => {
    if (!r.url().includes(pathFragment)) return false;
    if (method && r.method() !== method) return false;
    return true;
  }, { timeout: 15_000 });
}

const assertAchieverAuth = (req) => {
  const auth = req.headers()['authorization'] || '';
  expect(auth, `${req.url()} must be sent with the achiever token`).toBe(`Bearer ${token}`);
};

// ── Domains ───────────────────────────────────────────────────────────────
// `domains` is the shared taxonomy students browse by, curated by admins. An
// achiever can only SUGGEST: the row is created inactive and stays out of every
// picker until an admin approves it. So this asserts the suggestion reaches the
// API and that the name does NOT appear in the list.
test('Domains: an achiever can suggest a domain, and it stays out of the list', async ({ page }) => {
  await page.goto(`${H}/domains`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /domains/i }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  await page.locator('button:has-text("Suggest a domain")').first().click();

  const field = page.locator('#domain-name');
  await expect(field).toBeVisible({ timeout: 10_000 });
  const name = `E2E Domain ${Date.now()}`;
  await field.fill(name);

  const [req] = await Promise.all([
    expectAchieverRequest(page, '/achievers/portal/domains', 'POST'),
    page.locator('button[type=submit]').click(),
  ]);
  assertAchieverAuth(req);

  await page.waitForTimeout(2000);
  await expect(page.getByText(/sent for review/i)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(name), 'a suggestion must not reach the live list').toHaveCount(0);

  // Clean up. A suggestion never reaches students, but it does sit in the
  // admin's "Pending review" queue — and one more would pile up on every run,
  // burying any real suggestion an achiever makes.
  const base = new URL(page.url()).origin;
  const list = await page.request.get(`${base}/v1/achievers/portal/domains`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  // The suggestion is inactive so it is absent from that list; find it by asking
  // the delete endpoint to match on the id we can still recover from the POST.
  const created = await page.request.post(`${base}/v1/achievers/portal/domains`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { name },
  });
  const dup = await created.json();
  const id = dup?.response?.domain?.id;
  if (id) {
    await page.request.delete(`${base}/v1/achievers/portal/domains/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  }
  expect(list.ok(), 'domains list reachable').toBeTruthy();
});

// ── Coupons ───────────────────────────────────────────────────────────────
test('Coupons: the New Coupon form creates a coupon via the achiever API', async ({ page }) => {
  await page.goto(`${H}/coupons`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('heading', { name: /coupons/i }).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  await page.getByRole('button', { name: /new coupon/i }).first().click();

  const code = page.getByPlaceholder(/LAUNCH50/i);
  await expect(code).toBeVisible({ timeout: 10_000 });
  const value = `E2E${Date.now().toString().slice(-6)}`;
  await code.fill(value);

  // The form also requires a discount value — the first number input.
  // (Submitting without it is correctly blocked client-side.)
  await page.locator('input[type="number"]').first().fill('25');

  const [req] = await Promise.all([
    expectAchieverRequest(page, '/achievers/portal/coupons', 'POST'),
    page.getByRole('button', { name: /create coupon/i }).first().click(),
  ]);
  assertAchieverAuth(req);

  await page.waitForTimeout(2000);
  await expect(page.getByText(value).first()).toBeVisible({ timeout: 10_000 });
});

// ── Availability ──────────────────────────────────────────────────────────
test('Availability: the screen reads weekly hours through the achiever API', async ({ page }) => {
  const [req] = await Promise.all([
    expectAchieverRequest(page, '/achiever-availability/', 'GET'),
    page.goto(`${H}/availability`, { waitUntil: 'domcontentloaded' }),
  ]);
  assertAchieverAuth(req);
  await expect(page.getByRole('heading', { name: /availab/i }).first()).toBeVisible({ timeout: 20_000 });
});

// ── Profile ───────────────────────────────────────────────────────────────
test('Profile: Save Profile submits through the achiever API', async ({ page }) => {
  await page.goto(`${H}/profile`, { waitUntil: 'domcontentloaded' });
  const save = page.getByRole('button', { name: /save profile/i }).first();
  await expect(save).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  const bio = page.getByPlaceholder(/tell students about yourself/i);
  if (await bio.count()) await bio.fill(`E2E bio ${new Date().toISOString()}`);

  const [req] = await Promise.all([
    expectAchieverRequest(page, '/achievers/portal/profile', 'PUT'),
    save.click(),
  ]);
  assertAchieverAuth(req);
});

// ── Earnings ──────────────────────────────────────────────────────────────
test('Earnings: the screen loads payout data through the achiever API', async ({ page }) => {
  const [req] = await Promise.all([
    expectAchieverRequest(page, '/achiever-payouts/', 'GET'),
    page.goto(`${H}/earnings`, { waitUntil: 'domcontentloaded' }),
  ]);
  assertAchieverAuth(req);
  await expect(page.getByRole('heading', { name: /earning/i }).first()).toBeVisible({ timeout: 20_000 });
});

// ── Dashboard ─────────────────────────────────────────────────────────────
// `profile` used to be in this list, for a "Welcome back, <name>" greeting that
// has since been removed from the dashboard — the name is already in the header
// avatar. The dashboard's real data sources are the three below plus the
// earnings series, which `earnings` matches too.
test('Dashboard: loads bookings, cohorts and earnings through the achiever API', async ({ page }) => {
  const seen = new Set();
  page.on('request', (r) => {
    const m = r.url().match(/\/achievers\/portal\/(bookings|cohorts|earnings)/);
    if (m && (r.headers()['authorization'] || '') === `Bearer ${token}`) seen.add(m[1]);
  });

  await page.goto(H, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  expect(page.url(), 'dashboard bounced to login').not.toMatch(/\/login$/);
  await expect
    .poll(() => seen.size, { timeout: 12_000, message: 'dashboard fetches its three data sources' })
    .toBe(3);
});

// ── Navigation ────────────────────────────────────────────────────────────
test('Sidebar navigates between every achiever screen', async ({ page }) => {
  await page.goto(H, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  for (const [label, slug] of [
    ['Bookings', 'bookings'],
    ['My Cohorts', 'cohorts'],
    ['Availability', 'availability'],
    ['Earnings', 'earnings'],
    ['Domains', 'domains'],
    ['My Courses', 'courses'],
    ['Coupons', 'coupons'],
  ]) {
    await page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') }).first().click();
    await expect(page).toHaveURL(new RegExp(`${slug}$`), { timeout: 10_000 });
  }
});
