// v1 QUALITY GATE.
//
// Every screen a real user can reach, checked for the things that make a
// product feel broken even when every feature "works": console errors, failed
// requests, dead layouts, and horizontal scroll on a phone.
const { test, expect } = require('@playwright/test');
const { cachedTokens, STUDENTS } = require('../utils/api');
const { STUDENT_SCREENS, NOT_FOUND_MARKER } = require('../utils/v1-surface');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['studentPro', 'admin', 'achiever']) expect(T[k], `${k} token`).toBeTruthy();
});

/** Watch a page for anything that would look broken to a user. */
function watch(page) {
  const errors = [];
  const failed = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // Ignore noise the app cannot control: aborted navigations, and the
    // favicon/devtools chatter Chromium emits.
    if (/favicon|ERR_ABORTED|DevTools|Download the React DevTools/i.test(t)) return;
    errors.push(t);
  });
  page.on('response', async (r) => {
    if (!r.url().includes('/v1/')) return;
    if (r.status() >= 500) failed.push(`${r.status()} ${r.url().split('/v1')[1]}`);
    else if (r.status() === 200) {
      // The app answers 200 with the real status in the envelope, so a 500
      // hides inside a 200. Catch those too.
      try {
        const j = await r.json();
        if (j && j.status >= 500) failed.push(`body ${j.status} ${r.url().split('/v1')[1]}`);
      } catch { /* not json */ }
    }
  });
  return { errors, failed };
}

const asStudent = (page) => page.addInitScript(([t, e]) => {
  localStorage.setItem('access_token', t);
  localStorage.setItem('user', JSON.stringify({
    user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
  }));
}, [T.studentPro, STUDENTS.pro.email]);

// Read the live v1 screen list from the shared surface definition, so a screen
// entering or leaving v1 is picked up here automatically.
const SCREENS = STUDENT_SCREENS.map(([route]) => route);

for (const route of SCREENS) {
  test(`clean: ${route}`, async ({ page }) => {
    await asStudent(page);
    const seen = watch(page);

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    expect(page.url(), `${route} bounced to login`).not.toMatch(/\/login$/);

    // A 404 renders cleanly and has plenty of text, so it would sail through
    // every check below. Rule it out explicitly.
    await expect(page.getByText(NOT_FOUND_MARKER).first(),
      `${route} fell through to the 404 screen`).toHaveCount(0);

    expect(seen.errors, `${route} console errors:\n  ${seen.errors.join('\n  ')}`).toHaveLength(0);
    expect(seen.failed, `${route} server errors:\n  ${seen.failed.join('\n  ')}`).toHaveLength(0);

    // Something actually rendered — not a blank frame behind a working router.
    const text = (await page.locator('body').innerText()).trim();
    expect(text.length, `${route} rendered an empty page`).toBeGreaterThan(40);
  });
}

test('no student screen scrolls sideways on a phone', async ({ page }) => {
  await asStudent(page);
  await page.setViewportSize({ width: 360, height: 740 });   // common budget Android

  const offenders = [];
  // Every live v1 screen, not a sample — §11 of VERSION_1.md fixed overflow
  // across 56 screens, and a regression on any one of them is a phone-only bug
  // nobody sees on a laptop.
  for (const route of SCREENS) {
    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 4) offenders.push(`${route} (+${overflow}px)`);
  }
  expect(offenders, `these screens overflow horizontally on a 360px phone:\n  ${offenders.join('\n  ')}`)
    .toHaveLength(0);
});

test('the app still works when the API is slow', async ({ page }) => {
  await asStudent(page);
  const seen = watch(page);

  // Every API call takes 1.5s — a normal 3G experience in much of India.
  await page.route('**/v1/**', async (r) => {
    await new Promise((res) => setTimeout(res, 1500));
    await r.continue();
  });

  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  expect(seen.errors, `slow network broke the page:\n  ${seen.errors.join('\n  ')}`).toHaveLength(0);
  const text = (await page.locator('body').innerText()).trim();
  expect(text.length, 'the page rendered nothing on a slow connection').toBeGreaterThan(40);
});
