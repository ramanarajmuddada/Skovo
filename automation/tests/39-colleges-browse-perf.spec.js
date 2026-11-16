// Browse Colleges — the request budget for opening the screen.
//
// WHY THIS EXISTS
//   The complaint was that Colleges takes a visible moment to appear. Two
//   things caused it. The server pulled every college row and every course row
//   out of RDS on each request and paged them in Python; and the page itself
//   asked for the same list twice on mount, because it had two effects —
//   one on [type, showAll], one on [page] — that both ran on first render.
//
//   The server half is covered by the procedures (sp_colleges_browse). This
//   file covers the client half, which is the part that silently comes back:
//   an extra useEffect is an easy thing to add and impossible to see in review.
//
// WHAT IT ASSERTS
//   Opening Colleges issues exactly ONE GET /v1/colleges/ list request, and
//   each subsequent interaction (filter, paginate, search) issues exactly one
//   more. It does not assert row content — the catalogue may legitimately be
//   empty in a given environment, and this is a request-budget test.
// Takes an access token from SKOVO_E2E_TOKEN when one is set, so the run can
// borrow an existing student instead of registering a new one. The suite's
// usual provisionStudent() writes a row, which is the wrong thing to do against
// an environment whose .env points at the shared database.
const { test, expect } = require('@playwright/test');

async function studentToken() {
  if (process.env.SKOVO_E2E_TOKEN) return { token: process.env.SKOVO_E2E_TOKEN };
  const { provisionStudent } = require('../utils/api');
  return provisionStudent();
}

// Counts only the list endpoint. /colleges/saved and /auth/masters are
// separate calls with their own budgets, checked at the end.
const isListCall = (url) => {
  const u = new URL(url);
  return u.pathname.endsWith('/v1/colleges/') || u.pathname === '/v1/colleges';
};

/** Attach counters before any navigation, so the mount burst is caught. */
function trackRequests(page) {
  const calls = { list: [], saved: 0, masters: 0 };
  page.on('request', (req) => {
    if (req.method() !== 'GET') return;
    const url = req.url();
    if (!url.includes('/v1/')) return;
    if (isListCall(url)) calls.list.push(new URL(url).search || '(no query)');
    else if (url.includes('/v1/colleges/saved')) calls.saved += 1;
    else if (url.includes('/v1/auth/masters')) calls.masters += 1;
  });
  return calls;
}

/** Let the 400ms search debounce and any follow-up request land.
 *
 * Deliberately a plain wait. waitForLoadState('networkidle') is the obvious
 * choice and the wrong one here: against the Vite dev server the HMR websocket
 * never closes, so the network is never idle and the wait burns the whole test
 * timeout instead of failing on the assertion you care about. */
const settle = (page, ms = 1200) => page.waitForTimeout(ms);

test.describe('Colleges browse — request budget', () => {
  let student;

  test.beforeAll(async () => {
    student = await studentToken();
  });

  test.beforeEach(async ({ page }) => {
    // Seed the token the way the app stores it, so we land on Colleges
    // already authenticated rather than paying for a login round trip.
    // `user` matters as much as the token: App.jsx's guard redirects to /login
    // on a missing user object, whatever the token says.
    await page.addInitScript((token) => {
      localStorage.setItem('access_token', token);
      localStorage.setItem('user', JSON.stringify({
        id: 'e2e', full_name: 'E2E Student', email: 'e2e@skovo-test.local', role: 'student',
      }));
    }, student.token);
  });

  test('UI05-004 [P0] opening Colleges fires the list request exactly once', async ({ page }) => {
    const calls = trackRequests(page);

    await page.goto('/colleges');
    await expect(page.getByRole('heading', { level: 1, name: 'Colleges', exact: true })).toBeVisible();
    await settle(page);

    // The regression this guards: two mount effects => two identical requests.
    expect(calls.list, `list calls: ${JSON.stringify(calls.list)}`).toHaveLength(1);
    expect(calls.saved).toBe(1);
    expect(calls.masters).toBe(1);
  });

  test('UI05-004 [P0] filter, paginate and search each cost one request', async ({ page }) => {
    const calls = trackRequests(page);
    await page.goto('/colleges');
    await expect(page.getByRole('heading', { level: 1, name: 'Colleges', exact: true })).toBeVisible();
    await settle(page);
    const afterMount = calls.list.length;

    // A type chip. Previously this also called setPage(1), and when the student
    // was past page 1 the [page] effect fired a second, identical request.
    //
    // The chips used to render the master's raw *value* ('government') with CSS
    // text-transform on top, so the accessible name was the storage token. That
    // was fixed on 2026-09-05 — they carry {value,label} and render the label —
    // so this now matches the label, case-insensitively, rather than pinning the
    // old defect's spelling.
    await page.getByRole('button', { name: /^government$/i }).first().click();
    await settle(page);
    expect(calls.list.length - afterMount,
      `after filter: ${JSON.stringify(calls.list)}`).toBe(1);
    const afterFilter = calls.list.length;

    // Typing must not fire per keystroke — the debounce collapses it to one.
    await page.getByPlaceholder(/Search colleges/i).fill('engineering');
    await settle(page);
    expect(calls.list.length - afterFilter,
      `after search: ${JSON.stringify(calls.list)}`).toBe(1);

    // And the search actually reached the server as a query param.
    expect(calls.list[calls.list.length - 1]).toContain('search=engineering');
  });

  test('UI05-009 [P0] the list request carries page, per_page and the active filters', async ({ page }) => {
    const calls = trackRequests(page);
    await page.goto('/colleges?all=1');
    await expect(page.getByRole('heading', { level: 1, name: 'Colleges', exact: true })).toBeVisible();
    await settle(page);

    expect(calls.list).toHaveLength(1);
    const q = calls.list[0];
    expect(q).toContain('page=1');
    expect(q).toContain('per_page=');
    // ?all=1 seeds Browse All, which must reach the API as show_all=1 —
    // otherwise the student silently gets the personalised list instead.
    expect(q).toContain('show_all=1');
  });

  test('UI05-007 [P2] re-entering Colleges does not blank the table', async ({ page }) => {
    await page.goto('/colleges');
    await expect(page.getByRole('heading', { level: 1, name: 'Colleges', exact: true })).toBeVisible();
    await settle(page);

    // Leave and come back. The cached page is served immediately, so the
    // skeleton must not reappear on a warm return.
    await page.goto('/dashboard');
    await page.waitForTimeout(300);
    await page.goto('/colleges');

    await expect(page.getByRole('heading', { level: 1, name: 'Colleges', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'College Name' })).toBeVisible();
    await settle(page);
    // No crash, no error state — the screen is usable on re-entry.
    await expect(page.getByText('Internal Server Error')).toHaveCount(0);
  });
});
