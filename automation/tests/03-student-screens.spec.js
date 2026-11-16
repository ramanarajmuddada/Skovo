// Every live v1 student screen: navigates there with a logged-in session and
// asserts it renders (heading shows, not the 404, no runtime errors).
//
// The route list lives in utils/v1-surface.js so "what ships in v1" is stated
// once for the whole suite.
const { test, expect, request } = require('@playwright/test');
const { provisionStudent, U } = require('../utils/api');
const {
  STUDENT_SCREENS, STUDENT_DETAIL_SCREENS, STUDENT_NAV, NOT_FOUND_MARKER,
} = require('../utils/v1-surface');

let student;

test.beforeAll(async () => { student = await provisionStudent(); });

// Seed the auth the web app expects, before any app script runs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(([token, email]) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
    }));
  }, [student.token, student.email]);
});

/** Assert a route mounted its own screen — not the 404, not a login bounce. */
async function assertScreenRenders(page, route, heading) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
  // The SPA always serves 200 for app routes; a hard 4xx/5xx would be a real fault.
  if (resp) expect(resp.status(), `${route} http`).toBeLessThan(400);

  // The app keeps a Socket.IO connection open, so networkidle never fires —
  // a brief settle plus the auto-retrying assertion below is both fast and
  // reliable.
  await page.waitForTimeout(600);
  expect(page.url(), `${route} should not redirect to /login`).not.toContain('/login');

  // NotFound prints the path it failed on ("/cohorts doesn't exist"), so a
  // route-derived heading regex matches the 404 page too. Rule it out first,
  // or a deleted route passes this test.
  await expect(page.getByText(NOT_FOUND_MARKER).first(),
    `${route} fell through to the 404 screen`).toHaveCount(0);

  // The screen's heading should appear (retries up to the expect timeout).
  await expect(page.getByText(heading).first(), `${route} shows expected heading`).toBeVisible();

  // No uncaught runtime errors while rendering.
  expect(errors, `${route} console pageerrors: ${errors.join(' | ')}`).toHaveLength(0);
}

for (const [route, heading] of STUDENT_SCREENS) {
  test(`screen ${route} renders`, async ({ page }) => {
    await assertScreenRenders(page, route, heading);
  });
}

// ── Detail screens need a real id, so resolve one from the API ────────────
test.describe('detail screens', () => {
  const ids = {};

  test.beforeAll(async () => {
    const api = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${student.token}` },
    });
    const pick = async (path, arrayKey, idKey) => {
      const res = await api.get(U(path));
      const body = await res.json().catch(() => ({}));
      const row = (body.response?.[arrayKey] || [])[0];
      return row ? row[idKey] : null;
    };
    ids.college = await pick('/colleges/', 'colleges', 'id');
    ids.achiever = await pick('/achievers/?per_page=1', 'mentors', 'mentor_id');
    await api.dispose();
  });

  for (const [pattern, heading] of STUDENT_DETAIL_SCREENS) {
    test(`screen ${pattern} renders`, async ({ page }) => {
      const key = pattern.startsWith('/colleges') ? 'college' : 'achiever';
      test.skip(!ids[key], `no ${key} in the catalogue to open a detail page for`);
      const route = pattern.replace(/:\w+/, ids[key]);
      await assertScreenRenders(page, route, heading);
    });
  }
});

test('the sidebar exposes every v1 nav item', async ({ page }) => {
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  // Match on href, not the visible label: "upcoming" items (BhaAI) render a
  // "Soon" badge inside the link, which would otherwise break a name matcher.
  const hrefs = await page.locator('nav a[href]').evaluateAll(
    (as) => as.map((a) => a.getAttribute('href')));

  const missing = STUDENT_NAV
    .filter(([, slug]) => !hrefs.includes('/' + slug))
    .map(([label, slug]) => `${label} (/${slug})`);

  expect(missing, `nav items missing from the sidebar: ${missing.join(', ')}`).toHaveLength(0);
});
