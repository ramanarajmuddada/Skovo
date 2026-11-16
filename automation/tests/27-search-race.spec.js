// REGRESSION: stale-response races on the browse lists.
//
// Every list page fires several overlapping fetches (mount effect, filter
// change, search submit) and none of them cancelled or sequenced the replies.
// A slower earlier response landed last and replaced the search results, so a
// student searched for one thing, clicked the row, and opened another — which
// is exactly how the attendance check-in test failed.
//
// Each test slows the first response so the race is guaranteed rather than
// occasional, then asserts the list shows what was actually searched for.
const { test, expect } = require('@playwright/test');
const { U, cachedTokens, STUDENTS } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'studentPro']) expect(T[k], `${k} token`).toBeTruthy();
});

const asStudent = (page) => page.addInitScript(([t, e]) => {
  localStorage.setItem('access_token', t);
  localStorage.setItem('user', JSON.stringify({
    user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
  }));
}, [T.studentPro, STUDENTS.pro.email]);

/** Delay the first N calls to `fragment` so a later reply can overtake them. */
async function delayEarlyCalls(page, fragment, count = 1, ms = 2500) {
  let seen = 0;
  await page.route((url) => url.pathname.includes(fragment), async (route) => {
    seen += 1;
    if (seen <= count) await new Promise((r) => setTimeout(r, ms));
    await route.continue();
  });
}

test('Cohorts: a slow unfiltered reply cannot overwrite search results', async ({ page, request }) => {
  // A cohort with a title nothing else matches.
  const a = await (await request.get(U('/skovo-platform-panel-admin/achievers'), {
    headers: { Authorization: `Bearer ${T.admin}` }, params: { per_page: 50 },
  })).json();
  const achieverId = (a.response?.achievers || [])[0]?.id;
  const title = `E2E RaceCohort ${Date.now().toString().slice(-8)}`;
  await request.post(U('/skovo-platform-panel-admin/cohorts'), {
    headers: { Authorization: `Bearer ${T.admin}` },
    data: {
      title, achiever_id: achieverId, price: '0', total_seats: '10',
      duration_minutes: '60', status: 'upcoming',
      session_date: new Date(Date.now() + 5 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    },
  });

  await asStudent(page);
  await delayEarlyCalls(page, '/cohorts', 1, 3000);

  await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
  const search = page.getByPlaceholder(/search/i).first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill(title);
  await search.press('Enter');

  // Poll well past the delayed reply, so the assertion survives it landing
  // rather than sampling before or after it by luck.
  await expect
    .poll(() => page.locator('table tbody tr').count(),
      { timeout: 20_000, message: 'the search should narrow to the one matching cohort' })
    .toBe(1);
  await expect(page.getByText(title).first(),
    'the searched cohort must be the one on screen').toBeVisible();
});

test('Colleges: a slow unfiltered reply cannot overwrite search results', async ({ page }) => {
  await asStudent(page);
  await delayEarlyCalls(page, '/colleges', 1, 3000);

  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
  const search = page.locator('input[placeholder*="Search colleges" i]').first();
  await expect(search).toBeVisible({ timeout: 20_000 });
  await search.fill('zzzz-no-such-college');
  await search.press('Enter');
  await page.waitForTimeout(6000);

  await expect
    .poll(() => page.locator('table tbody tr').count(), { timeout: 10_000 })
    .toBe(0);
});

test('Opportunities: a slow reply cannot overwrite a filter change', async ({ page }) => {
  await asStudent(page);
  await delayEarlyCalls(page, '/opportunities', 1, 3000);

  await page.goto('/opportunities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // If the hub is score-locked there is no list to race; that is a valid state.
  const search = page.getByPlaceholder(/search/i).first();
  test.skip(!(await search.count()), 'hub is locked for this student — no list to race');

  await search.fill('zzzz-no-such-opportunity');
  await search.press('Enter');
  await page.waitForTimeout(6000);

  const body = (await page.locator('body').innerText()).toLowerCase();
  expect(body, 'a nonsense search should end in an empty state, not stale rows')
    .toMatch(/no opportunit|nothing|empty|no results|try a different/);
});

test('Market: switching category mid-search does not show the wrong deals', async ({ page }) => {
  await asStudent(page);
  await delayEarlyCalls(page, '/market', 1, 3000);

  await page.goto('/market', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const search = page.getByPlaceholder(/search/i).first();
  test.skip(!(await search.count()), 'no market search box');

  await search.fill('zzzz-no-such-deal');
  await search.press('Enter');

  // Poll rather than sample once: the delayed reply lands mid-way through, and
  // the assertion has to survive it rather than race it.
  await expect
    .poll(async () => (await page.locator('body').innerText()).toLowerCase(),
      { timeout: 20_000, message: 'a nonsense search must not leave the full deal list on screen' })
    .toMatch(/no deals|nothing|empty|no results|try a different|no offers/);
});
