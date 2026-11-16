// My Courses — the card grid, module panel and the writes behind them.
//
// Phase 6 of the Achiever V1 redesign. Runs against the existing course APIs;
// no backend or schema changed.
//
// The assertions worth keeping are the earnings one and the silent-write ones.
// The earnings tile used to compute `enrolled_count * price * 0.70` in the
// browser — a number that contradicted the "Your share" figure shown by the
// enrolments modal on the same screen. And publish/archive/reorder each ignored
// their response entirely, so a failed write changed the UI anyway.
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
  await page.goto('/skovo-achiever-portal/courses', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
};

// The seeded achiever may own no courses, and creating one needs the L2
// charge capability. Stub the list so the grid always has something to act on.
const FAKE_COURSES = {
  bool: true,
  response: {
    courses: [{
      id: '33333333-3333-3333-3333-333333333333',
      title: 'Stubbed Java Bootcamp',
      description: 'A stubbed course',
      thumbnail_url: null,
      price: 1000,
      effective_price: 1000,
      offer_label: null, offer_price: null, offer_percent: null,
      offer_starts_at: null, offer_ends_at: null,
      duration_weeks: 6,
      level: 'beginner',
      category: 'Programming',
      what_you_learn: [], requirements: [],
      target_categories: [], target_streams: [], target_degree_cats: [],
      target_exam_targets: [], target_prof_courses: [], target_years: [],
      target_degrees: [], target_branches: [],
      status: 'draft',
      enrolled_count: 4,
      module_count: 2,
      achiever: null,
    }],
    total: 1,
  },
};

const stubList = (page) =>
  page.route('**/courses/portal/', (route) =>
    (route.request().method() === 'GET'
      ? route.fulfill({ status: 200, contentType: 'application/json',
                        body: JSON.stringify(FAKE_COURSES) })
      : route.continue()));

// ══════════════════════════════════════════════════════════════════════════
test.describe('the APIs the screen reads', () => {
  test('the portal list returns the fields the card renders', async () => {
    const r = await resp(await api.get(U('/courses/portal/')));
    expect(Array.isArray(r.courses)).toBe(true);
    if (!r.courses.length) return;                    // empty is a valid state
    for (const k of ['id', 'title', 'price', 'status', 'level', 'enrolled_count']) {
      expect(r.courses[0], `course should expose ${k}`).toHaveProperty(k);
    }
  });

  test('purchases carries the real earnings total the tile now shows', async () => {
    // This is the number that replaced enrolled_count * price * 0.70.
    const r = await resp(await api.get(U('/courses/portal/purchases')));
    expect(r).toHaveProperty('total_earning');
    expect(typeof r.total_earning).toBe('number');
  });

  test('a student token cannot list an achiever’s courses', async () => {
    const student = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${cachedTokens().studentPro}` },
    });
    const body = await (await student.get(U('/courses/portal/'))).json();
    expect(body.bool).toBe(false);
    await student.dispose();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('the earnings tile shows real money', () => {
  test('it matches the purchases total, not price x headcount', async ({ page }) => {
    const r = await resp(await api.get(U('/courses/portal/purchases')));
    const real = Math.round(r.total_earning || 0);

    await asAchiever(page);
    await stubList(page);
    await goto(page);

    // The stub has enrolled_count 4 at price 1000, so the old formula would
    // have rendered 4 * 1000 * 0.70 = Rs 2,800.
    await expect(page.getByText('Course earnings')).toBeVisible();
    await expect(page.getByText('₹2,800')).toHaveCount(0);

    await expect(page.getByText(`₹${real.toLocaleString('en-IN')}`).first()).toBeVisible();
  });

  test('it shows a dash rather than zero when the endpoint fails', async ({ page }) => {
    await asAchiever(page);
    await page.route('**/courses/portal/purchases*', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));
    await stubList(page);
    await goto(page);

    // An absent number is not zero.
    await expect(page.getByText('Course earnings')).toBeVisible();
    await expect(page.getByText('₹0')).toHaveCount(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('a failed write is reported', () => {
  test('a failed publish says so instead of springing back', async ({ page }) => {
    await asAchiever(page);
    await stubList(page);
    await page.route('**/courses/portal/*/publish', (route) =>
      route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }));

    await goto(page);
    await page.getByTitle(/Publish|Unpublish/i).first().click();
    await expect(page.getByText(/Connection problem|Couldn't change/i).first())
      .toBeVisible({ timeout: 8000 });
  });

  test('a successful publish confirms it', async ({ page }) => {
    await asAchiever(page);
    await stubList(page);
    await page.route('**/courses/portal/*/publish', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ bool: true, response: { status: 'published' } }),
      }));

    await goto(page);
    await page.getByTitle(/Publish|Unpublish/i).first().click();
    await expect(page.getByText(/Course published/i)).toBeVisible({ timeout: 8000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('archiving asks first', () => {
  test('the dialog names the course and backing out writes nothing', async ({ page }) => {
    await asAchiever(page);
    await stubList(page);
    let deletes = 0;
    // `**/courses/portal/*` also matches the list URL, and Playwright tries
    // handlers last-registered-first. route.continue() would go straight to the
    // network and skip stubList above, leaving no card to archive - fallback()
    // hands the request down to it instead.
    await page.route('**/courses/portal/*', (route) => {
      if (route.request().method() === 'DELETE') {
        deletes += 1;
        return route.fulfill({ status: 200, contentType: 'application/json',
                               body: JSON.stringify({ bool: true, response: {} }) });
      }
      return route.fallback();
    });

    await goto(page);
    await page.getByTitle('Archive course').first().click();

    // window.confirm() said none of this.
    await expect(page.getByText(/Archive "Stubbed Java Bootcamp"\?/i)).toBeVisible();
    await expect(page.getByText(/already enrolled keeps their access/i)).toBeVisible();

    await page.getByRole('button', { name: /^Cancel$/i }).first().click();
    await page.waitForTimeout(500);
    expect(deletes, 'backing out must not archive anything').toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('an outage is not an empty shelf', () => {
  test('a failed load offers Try again, not Create First Course', async ({ page }) => {
    await asAchiever(page);
    await page.route('**/courses/portal/', (route) =>
      (route.request().method() === 'GET'
        ? route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
        : route.continue()));

    await goto(page);
    await expect(page.getByText(/couldn't load your courses/i)).toBeVisible({ timeout: 8000 });
    await expect(page.getByRole('button', { name: /Try again/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Create First Course/i })).toHaveCount(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('search and status filter', () => {
  test('a search that matches nothing offers a way back', async ({ page }) => {
    await asAchiever(page);
    await stubList(page);
    await goto(page);

    await page.getByPlaceholder(/Search by title, category or level/i).fill('zzzz-no-match-zzzz');
    await expect(page.getByText(/No courses match these filters/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /Clear filters/i })).toBeVisible();

    await page.getByRole('button', { name: /Clear filters/i }).click();
    await expect(page.getByText('Stubbed Java Bootcamp')).toBeVisible();
  });

  test('the status filter narrows to drafts', async ({ page }) => {
    await asAchiever(page);
    await stubList(page);
    await goto(page);
    // The stub is a draft, so Published must hide it and Draft must keep it.
    await expect(page.getByText('Stubbed Java Bootcamp')).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('responsive', () => {
  const SIZES = [
    ['mobile 390', 390, 844], ['tablet 820', 820, 1180],
    ['laptop 1440', 1440, 900], ['ultra 2560', 2560, 1440],
  ];

  for (const [name, w, h] of SIZES) {
    test(`My Courses @ ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await asAchiever(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await goto(page);
      await expect(page.getByRole('heading', { name: /My Courses/i, level: 1 })).toBeVisible();

      expect(errors).toEqual([]);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('the header does not collide at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await asAchiever(page);
    await stubList(page);
    await goto(page);

    const title = await page.getByRole('heading', { name: /My Courses/i, level: 1 }).boundingBox();
    const action = await page.getByRole('button', { name: /New Course/i }).first().boundingBox();
    // They used to be a fixed justify-between row and overlapped on a phone.
    expect(action.y, 'the action should sit below the title, not beside it')
      .toBeGreaterThan(title.y + title.height - 2);

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('the course dialog fits a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await asAchiever(page);
    await stubList(page);
    await goto(page);

    await page.getByRole('button', { name: /New Course/i }).first().click();
    await expect(page.getByText(/Create New Course/i)).toBeVisible({ timeout: 8000 });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, 'dialog must not push the page sideways').toBeLessThanOrEqual(1);
  });
});
