// My Cohorts — the stepped create flow, list controls and responsive behaviour.
//
// Phase 3 of the Achiever V1 redesign. Everything here runs against the
// existing cohort APIs; no backend or schema changed.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin, cachedTokens } = require('../utils/api');

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

// ══════════════════════════════════════════════════════════════════════════
test.describe('cohort API still returns what the screen needs', () => {
  test('list carries capacity, status and offer fields', async () => {
    const r = await resp(await api.get(U('/achievers/portal/cohorts')));
    expect(Array.isArray(r.cohorts)).toBe(true);
    if (!r.cohorts.length) return;                     // empty is a valid state
    const c = r.cohorts[0];
    for (const k of ['id', 'title', 'total_seats', 'filled_seats', 'status', 'price']) {
      expect(c, `cohort should expose ${k}`).toHaveProperty(k);
    }
  });

  test('creating a cohort still validates server-side', async () => {
    // The stepped form validates in the browser; the server must not rely on it.
    const r = await resp(await api.post(U('/achievers/portal/cohorts'), {
      data: { title: '', price: 0 },
    }));
    expect(r.message).toMatch(/title|price/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('the stepped create flow', () => {
  test('opens on Basics and walks to Review', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Create Cohort/i }).first().click();

    await expect(page.getByText(/Step 1 of 5 · Basics/i)).toBeVisible({ timeout: 10000 });

    // Title gates step 1 — Next must refuse before it is filled.
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Give your cohort a title/i)).toBeVisible();

    await page.getByPlaceholder(/What will you teach/i).fill('E2E Stepped Cohort');
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Step 2 of 5 · Schedule/i)).toBeVisible();

    // Session date gates step 2.
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Pick when the session runs/i)).toBeVisible();

    const when = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 16);
    await page.locator('input[type="datetime-local"]').first().fill(when);
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Step 3 of 5 · Seats & price/i)).toBeVisible();

    // Price no longer gates step 3, and that is deliberate. On 2026-09-01 a
    // price of 0 became a FREE cohort — a probation achiever runs three free
    // demo sessions and could not create a cohort at all until then, because
    // `<= 0` was refused and anything above 0 needed `can_charge`, which is
    // active-only. Blank is free, 0 is free, and only a negative number is an
    // error, so the old "Price must be greater than 0" assertion was asserting
    // the bug rather than the fix.
    await page.locator('input[type="number"]').last().fill('-5');
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Price must be 0 or more/i)).toBeVisible();

    await page.locator('input[type="number"]').last().fill('1000');
    await expect(page.getByText(/You earn per seat/i)).toBeVisible();

    // Derived from THIS achiever's commission, never a fixed number.
    //
    // This asserted a literal ₹700 — 1000 less a 30% fee — which was the rate
    // when it was written and is not the rate now. Commission comes from
    // `commission_rules`, scoped achiever-over-global and versioned, precisely
    // so it can change without a deploy; a test that hardcodes the split turns
    // every legitimate rate change into a red build and pushes whoever sees it
    // to "fix" the number rather than read why it moved. The screen reads the
    // rate from the API, and so does this.
    const rate = await page.evaluate(async () => {
      const res = await fetch('/v1/achievers/portal/profile', {
        headers: { Authorization: `Bearer ${localStorage.getItem('achiever_access_token')}` },
      });
      const j = await res.json();
      return Number((j.response || {}).commission_rate);
    });
    expect(Number.isFinite(rate), 'the profile did not report a commission rate').toBe(true);

    const earns = Math.round(1000 * (1 - rate));
    await expect(
      page.getByText(`₹${earns.toLocaleString('en-IN')}`),
      `at a ${Math.round(rate * 100)}% platform fee the achiever should earn ₹${earns} per seat`,
    ).toBeVisible();

    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Step 4 of 5 · Audience/i)).toBeVisible();
    await expect(page.getByText(/Who will see this/i)).toBeVisible();
    await expect(page.getByText(/Everyone on SKOVO/i)).toBeVisible();

    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Step 5 of 5 · Review/i)).toBeVisible();
    await expect(page.getByText('E2E Stepped Cohort')).toBeVisible();
    // Review must offer the commit, not another Next.
    await expect(page.getByRole('button', { name: /Create Cohort/i }).last()).toBeVisible();

    expect(errors, 'no runtime errors through the whole flow').toEqual([]);
  });

  test('Back returns to the previous step without losing input', async ({ page }) => {
    await asAchiever(page);
    await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Create Cohort/i }).first().click();

    await page.getByPlaceholder(/What will you teach/i).fill('Remembered title');
    await page.getByRole('button', { name: /^Next$/i }).click();
    await expect(page.getByText(/Step 2 of 5/i)).toBeVisible();

    await page.getByRole('button', { name: /^Back$/i }).click();
    await expect(page.getByPlaceholder(/What will you teach/i)).toHaveValue('Remembered title');
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('list controls', () => {
  test('search and status filters are present once cohorts exist', async ({ page }) => {
    const r = await resp(await api.get(U('/achievers/portal/cohorts')));
    test.skip(!r.cohorts?.length, 'no cohorts to filter');

    await asAchiever(page);
    await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
    await expect(page.getByPlaceholder(/Search by title, domain or level/i)).toBeVisible({ timeout: 10000 });
    await expect(page.getByRole('button', { name: /^Upcoming$/ })).toBeVisible();

    // A search that matches nothing must offer a way back, not an invitation
    // to create another cohort.
    await page.getByPlaceholder(/Search by title, domain or level/i).fill('zzzz-no-match-zzzz');
    await expect(page.getByText(/No cohorts match/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear filters/i })).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('responsive', () => {
  const SIZES = [
    ['mobile 390', 390, 844], ['tablet 820', 820, 1180],
    ['laptop 1440', 1440, 900], ['ultra 2560', 2560, 1440],
  ];

  for (const [name, w, h] of SIZES) {
    test(`My Cohorts @ ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await asAchiever(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1500);
      await expect(page.getByRole('heading', { name: /My Cohorts/i, level: 1 })).toBeVisible();

      expect(errors).toEqual([]);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('the create dialog fits a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await asAchiever(page);
    await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: /Create Cohort/i }).first().click();
    await expect(page.getByText(/Step 1 of 5/i)).toBeVisible({ timeout: 10000 });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'dialog must not push the page sideways').toBeLessThanOrEqual(1);
  });
});
