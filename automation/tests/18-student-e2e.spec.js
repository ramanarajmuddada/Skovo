// End-to-end coverage for the student portal screens the earlier specs only
// smoke-loaded: navigation between every screen, college details, and the
// remaining data screens proving they fetch through the student API client.
const { test, expect } = require('@playwright/test');
const { studentContext, STUDENTS } = require('../utils/api');

let token;

test.beforeAll(async () => {
  token = (await studentContext('pro')).token;
  expect(token, 'student login returned a token').toBeTruthy();
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([t, e]) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
    }));
  }, [token, STUDENTS.pro.email]);
});

/** Wait for an API request to `fragment` and assert it carries the student token.
 *  The `/v1/` guard keeps this from matching the page navigation itself, which
 *  carries no Authorization header. */
function expectStudentRequest(page, fragment, method) {
  return page.waitForRequest(
    (r) => r.url().includes('/v1/') && r.url().includes(fragment) && (!method || r.method() === method),
    { timeout: 15_000 },
  );
}

/** The table renders 8 skeleton rows while loading, and those have no click
 *  handler. Wait until a real row with content is present before clicking. */
async function firstLoadedRow(page) {
  await expect
    .poll(async () => {
      const cell = page.locator('table tbody tr').first().locator('td').nth(2);
      return (await cell.count()) ? (await cell.innerText()).trim() : '';
    }, { timeout: 25_000, message: 'colleges table finished loading' })
    .not.toBe('');
  return page.locator('table tbody tr').first();
}

const assertStudentAuth = (req) => {
  const auth = req.headers()['authorization'] || '';
  expect(auth, `${req.url()} must be sent with the student token`).toBe(`Bearer ${token}`);
};

// ── College details ───────────────────────────────────────────────────────
test('Colleges: clicking a row opens the college detail screen', async ({ page }) => {
  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
  const row = await firstLoadedRow(page);

  // td[1] is the bookmark cell, which correctly stops propagation so saving a
  // college does not navigate. Click a content cell instead.
  await row.locator('td').nth(2).click();

  await expect(page).toHaveURL(/\/colleges\/[^/]+$/, { timeout: 15_000 });
  await page.waitForTimeout(2000);
  // The detail screen renders content, not an error boundary.
  await expect(page.locator('h1, h2').first()).toBeVisible({ timeout: 15_000 });
});

test('College detail fetches the college and its reviews', async ({ page }) => {
  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
  const row = await firstLoadedRow(page);

  const seen = new Set();
  page.on('request', (r) => {
    if (!r.url().includes('/v1/')) return;
    if (/\/colleges\/[^/?]+(\?|$)/.test(r.url())) seen.add('college');
    if (r.url().includes('/college-reviews/')) seen.add('reviews');
  });

  // td[1] is the bookmark cell, which correctly stops propagation so saving a
  // college does not navigate. Click a content cell instead.
  await row.locator('td').nth(2).click();
  await expect
    .poll(() => seen.size, { timeout: 15_000, message: 'detail screen loads college + reviews' })
    .toBe(2);
});

// ── Data screens ──────────────────────────────────────────────────────────
for (const [name, route, fragment] of [
  ['Cohorts', '/cohorts', '/cohorts/'],
  ['Tasks', '/tasks', '/tasks/'],
  ['Profile', '/profile', '/profile/'],
  ['Applications', '/applications', '/applications'],
  ['Notifications', '/notifications', '/notifications'],
  ['Find Achievers', '/find-mentors', '/achievers'],
]) {
  test(`${name} fetches its data through the student API`, async ({ page }) => {
    const [req] = await Promise.all([
      expectStudentRequest(page, fragment, 'GET'),
      page.goto(route, { waitUntil: 'domcontentloaded' }),
    ]);
    assertStudentAuth(req);
    expect(page.url(), `${route} bounced to login`).not.toMatch(/\/login$/);
  });
}

// ── Profile write ─────────────────────────────────────────────────────────
test('Profile: saving submits a PATCH through the student API', async ({ page }) => {
  await page.goto('/profile', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);

  // Save is gated behind the Edit toggle.
  await page.getByRole('button', { name: /^edit/i }).first().click();
  const save = page.getByRole('button', { name: /save changes/i }).first();
  await expect(save).toBeVisible({ timeout: 20_000 });

  const [req] = await Promise.all([
    expectStudentRequest(page, '/profile/', 'PATCH'),
    save.click(),
  ]);
  assertStudentAuth(req);
});

// ── Navigation ────────────────────────────────────────────────────────────
test('Sidebar navigates between every student screen', async ({ page }) => {
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);

  for (const [label, slug] of [
    ['Cohorts', 'cohorts'],
    ['Colleges', 'colleges'],
    ['Saved Colleges', 'colleges/saved'],
    ['College Predictor', 'college-predictor'],
    ['Opportunities', 'opportunities'],
    ['Find Achievers', 'find-mentors'],
    ['Skovo Pro', 'skovo-pro'],
    ['My Bookings', 'bookings'],
    ['My Tasks', 'tasks'],
    ['Applications', 'applications'],
    ['Document Vault', 'document-vault'],
    ['Market', 'market'],
    ['My Score', 'my-score'],
    ['Assemble', 'assemble'],
    ['Notifications', 'notifications'],
  ]) {
    await page.getByRole('link', { name: new RegExp(`^${label}$`, 'i') }).first().click();
    await expect(page, `sidebar link "${label}"`).toHaveURL(new RegExp(`${slug}$`), { timeout: 10_000 });
  }
});
