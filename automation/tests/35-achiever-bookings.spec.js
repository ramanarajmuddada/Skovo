// Bookings — 1-on-1 sessions and cohort enrolments.
//
// Phase 5 of the Achiever V1 redesign. Runs against the existing booking APIs;
// no backend or schema changed.
//
// The assertions worth keeping are the failure ones. All three writes on this
// screen used to be `if (data.bool) onUpdate();` with no else and no catch, so
// a failed Confirm or Decline changed nothing and said nothing. The tests below
// fail the request on purpose and require the screen to say so.
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
const goto = async (page) => {
  await page.goto('/skovo-achiever-portal/bookings', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
};

// The two tab buttons carry `aria-pressed`; the words also appear in copy.
const tab = (page, label) =>
  page.locator('button[aria-pressed]').filter({ hasText: label });

// ══════════════════════════════════════════════════════════════════════════
test.describe('both feeds still return what the screen reads', () => {
  test('sessions carry status, student and the tallies the strip shows', async () => {
    const r = await resp(await api.get(U('/achievers/portal/bookings')));
    expect(Array.isArray(r.bookings)).toBe(true);
    for (const k of ['total', 'pending', 'confirmed']) {
      expect(r, `bookings should expose ${k}`).toHaveProperty(k);
    }
    if (!r.bookings.length) return;                       // empty is a valid state
    for (const k of ['id', 'student_name', 'status']) {
      expect(r.bookings[0]).toHaveProperty(k);
    }
  });

  test('enrolments page', async () => {
    const e = await resp(await api.get(U('/achievers/portal/enrollments')));
    expect(Array.isArray(e.enrollments)).toBe(true);
    expect(e).toHaveProperty('total');
  });

  test('a student token cannot read an achiever’s bookings', async () => {
    const student = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${cachedTokens().studentPro}` },
    });
    // This API answers 200 with `bool:false` and carries its own code in the
    // body — the refusal is in the payload, not the HTTP status.
    const body = await (await student.get(U('/achievers/portal/bookings'))).json();
    expect(body.bool).toBe(false);
    expect(body.response.message).toMatch(/Achiever access only/i);
    await student.dispose();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The seeded achiever has no 1-on-1 bookings, and creating one would mean
// paying for a slot through Cashfree. These tests are about how the screen
// behaves when a write fails, so the list is stubbed with the exact shape the
// route returns (asserted for real by the first test above) and only the
// browser side is under test.
const FAKE_BOOKINGS = {
  bool: true,
  response: {
    bookings: [{
      id: '11111111-1111-1111-1111-111111111111',
      student_id: '22222222-2222-2222-2222-222222222222',
      student_name: 'Stubbed Student',
      student_email: 'stub@example.com',
      note: 'Need help with calculus',
      mentor_notes: '',
      status: 'pending',
      meeting_link: null,
      scheduled_at: null,
      created_at: '2026-08-01T10:00:00Z',
      amount: 500,
      achiever_earning: 350,
      payment_status: 'paid',
      duration_minutes: 60,
    }],
    total: 1, page: 1, per_page: 20, pages: 1,
    pending: 1, confirmed: 0, completed: 0, window_total: 1,
  },
};

const stubList = (page) =>
  page.route('**/achievers/portal/bookings?**', (route) =>
    (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify(FAKE_BOOKINGS) })
      : route.continue()));

// ══════════════════════════════════════════════════════════════════════════
test.describe('tabs', () => {
  // QA reported Bookings not opening on Sessions. The tab is read from
  // `?tab=` now, so this pins all three halves of that: the bare path is
  // Sessions, a chosen tab survives a reload, and a value that means nothing
  // falls back to Sessions instead of dropping through to the last branch.
  test('opens on 1-on-1 Sessions, and the tab follows the URL', async ({ page }) => {
    await asAchiever(page);
    await goto(page);

    await expect(tab(page, '1-on-1 Sessions')).toHaveAttribute('aria-pressed', 'true');
    await expect(tab(page, 'Cohort Enrollments')).toHaveAttribute('aria-pressed', 'false');
    await expect(page.getByPlaceholder(/Search by student, email or note/i)).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]tab=/);

    await tab(page, 'Cohort Enrollments').click();
    await expect(page).toHaveURL(/[?&]tab=enrollments/);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await expect(tab(page, 'Cohort Enrollments')).toHaveAttribute('aria-pressed', 'true');

    await page.goto('/skovo-achiever-portal/bookings?tab=nonsense',
                    { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    await expect(tab(page, '1-on-1 Sessions')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByPlaceholder(/Search by student, email or note/i)).toBeVisible();
  });

  test('both tabs render without a runtime error', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page);

    await expect(page.getByRole('heading', { name: /^Bookings$/i, level: 1 })).toBeVisible();

    await tab(page, 'Cohort Enrollments').click();
    await page.waitForTimeout(900);
    await expect(page.getByPlaceholder(/Search by student, email or cohort/i)).toBeVisible();

    await tab(page, '1-on-1 Sessions').click();
    await page.waitForTimeout(900);
    await expect(page.getByPlaceholder(/Search by student, email or note/i)).toBeVisible();

    expect(errors, 'no runtime errors across the two tabs').toEqual([]);
  });

  test('a search that matches nothing says so instead of showing stale rows', async ({ page }) => {
    await asAchiever(page);
    await goto(page);
    await page.getByPlaceholder(/Search by student, email or note/i).fill('zzzz-no-match-zzzz');
    await page.waitForTimeout(1200);
    await expect(page.getByText(/No bookings match these filters/i)).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('a failed write is reported', () => {
  // Open the row so the detail panel with the controls is on screen.
  const openBooking = async (page) => {
    await asAchiever(page);
    await stubList(page);
    await goto(page);
    await page.getByText('Stubbed Student').first().click();
    await expect(page.getByRole('button', { name: /Save notes/i }).first()).toBeVisible();
  };

  const stubWrite = (page, handler) =>
    page.route('**/achievers/portal/bookings/*', (route) =>
      (route.request().method() === 'PUT' ? handler(route) : route.continue()));

  test('a 500 on Save notes shows an error rather than nothing', async ({ page }) => {
    await asAchiever(page);
    await stubWrite(page, (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

    await openBooking(page);
    await page.getByRole('button', { name: /Save notes/i }).first().click();

    // The old code did nothing at all here.
    await expect(page.getByText(/Connection problem|didn't save/i).first())
      .toBeVisible({ timeout: 8000 });
  });

  test('a bool:false on Save notes is reported too', async ({ page }) => {
    await asAchiever(page);
    await stubWrite(page, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ bool: false, response: { message: 'Nope, not saved' } }),
    }));

    await openBooking(page);
    await page.getByRole('button', { name: /Save notes/i }).first().click();
    await expect(page.getByText(/Nope, not saved/i)).toBeVisible({ timeout: 8000 });
  });

  test('a successful save confirms it', async ({ page }) => {
    await asAchiever(page);
    await stubWrite(page, (route) => route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ bool: true, response: {} }),
    }));

    await openBooking(page);
    await page.getByRole('button', { name: /Save notes/i }).first().click();
    await expect(page.getByText(/Notes saved/i)).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('declining asks first', () => {
  test('Decline opens a confirmation and backing out writes nothing', async ({ page }) => {
    await asAchiever(page);
    let puts = 0;
    await page.route('**/achievers/portal/bookings/*', (route) => {
      if (route.request().method() === 'PUT') {
        puts += 1;
        return route.fulfill({ status: 200, contentType: 'application/json',
                               body: JSON.stringify({ bool: true, response: {} }) });
      }
      return route.continue();
    });
    await stubList(page);
    await goto(page);

    await page.getByText('Stubbed Student').first().click();
    await page.getByRole('button', { name: /Decline/i }).first().click();

    // Declining tells the student their request was refused and cannot be
    // undone, so it must not fire straight off the click.
    await expect(page.getByText(/Decline .*session\?/i)).toBeVisible();
    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
    await page.waitForTimeout(600);
    expect(puts, 'backing out must not write anything').toBe(0);
  });

  test('confirming the dialog does write', async ({ page }) => {
    await asAchiever(page);
    let puts = 0;
    await page.route('**/achievers/portal/bookings/*', (route) => {
      if (route.request().method() === 'PUT') {
        puts += 1;
        return route.fulfill({ status: 200, contentType: 'application/json',
                               body: JSON.stringify({ bool: true, response: {} }) });
      }
      return route.continue();
    });
    await stubList(page);
    await goto(page);

    await page.getByText('Stubbed Student').first().click();
    await page.getByRole('button', { name: /Decline/i }).first().click();
    await page.getByRole('button', { name: /Decline session/i }).click();

    await expect(page.getByText(/Session declined/i)).toBeVisible({ timeout: 8000 });
    expect(puts).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('an outage is not shown as an empty list', () => {
  test('a failed sessions load offers Try again', async ({ page }) => {
    await asAchiever(page);
    await page.route('**/achievers/portal/bookings*', (route) =>
      (route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.continue()));

    await goto(page);
    // "No session requests in this period" would be the opposite of the truth.
    await expect(page.getByText(/couldn't load/i).first()).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible();
  });

  test('a failed enrolments load does the same', async ({ page }) => {
    await asAchiever(page);
    await page.route('**/achievers/portal/enrollments*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

    await goto(page);
    await tab(page, 'Cohort Enrollments').click();
    await expect(page.getByText(/couldn't load/i).first()).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('responsive', () => {
  const SIZES = [
    ['mobile 390', 390, 844], ['tablet 820', 820, 1180],
    ['laptop 1440', 1440, 900], ['ultra 2560', 2560, 1440],
  ];

  for (const [name, w, h] of SIZES) {
    test(`Bookings @ ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await asAchiever(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await goto(page);
      await expect(page.getByRole('heading', { name: /^Bookings$/i, level: 1 })).toBeVisible();

      expect(errors).toEqual([]);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('below md the table is replaced by cards, not a sideways scroll', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await asAchiever(page);
    await stubList(page);
    await goto(page);

    // Six columns do not fit a phone. The <table> is hidden and the same row
    // renders as a stacked card instead. Both are in the DOM, so filter on
    // what is actually on screen rather than taking the first match.
    await expect(page.locator('table').first()).toBeHidden();
    await expect(page.getByText('Stubbed Student').filter({ visible: true }))
      .toHaveCount(1);
  });

  test('from md up the table is what renders', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await asAchiever(page);
    await stubList(page);
    await goto(page);

    await expect(page.locator('table').first()).toBeVisible();
    await expect(page.getByText('Stubbed Student').first()).toBeVisible();
  });

  test('both tabs fit a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await asAchiever(page);
    await goto(page);

    for (const label of ['Cohort Enrollments', '1-on-1 Sessions']) {
      await tab(page, label).click();
      await page.waitForTimeout(800);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${label} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    }
  });
});
