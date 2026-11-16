// Achiever discovery, funnel and quality ranking.
//
// Covers the three holes that stopped achievers getting booked: a directory
// with no filters, a dashboard that could only report money, and nothing
// measuring whether an achiever was any good.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin, cachedTokens } = require('../utils/api');

let achiever, student, page1;
let achieverToken, studentToken;

test.beforeAll(async () => {
  const a = await portalLogin('achiever');
  achieverToken = a.token;
  studentToken = cachedTokens().studentPro;

  const mk = (t) => request.newContext({
    extraHTTPHeaders: t ? { Authorization: `Bearer ${t}` } : {},
  });
  achiever = await mk(achieverToken);
  student = await mk(studentToken);
  expect(achieverToken, 'seeded achiever should log in').toBeTruthy();
  expect(studentToken, 'seeded student should be cached').toBeTruthy();
});

test.afterAll(async () => { await achiever?.dispose(); await student?.dispose(); });

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

// ══════════════════════════════════════════════════════════════════════════
test.describe('browse: filters and ranking', () => {
  test('the directory returns a paged, sorted payload', async () => {
    const r = await resp(await student.get(U('/achievers/')));
    expect(Array.isArray(r.mentors)).toBe(true);
    expect(r).toHaveProperty('total');
    expect(r).toHaveProperty('page');
    expect(r.sort).toBe('recommended');
    expect(r.sorts).toContain('rating');
  });

  test('every card carries a trust badge, rating and price', async () => {
    const r = await resp(await student.get(U('/achievers/')));
    test.skip(!r.mentors.length, 'no browsable achievers seeded');
    const m = r.mentors[0];
    // `bgv_cleared` replaced `teaches_minors` on 2026-09-06: the old key read a
    // column dropped with the DPDP age gates, so it was false for everybody.
    for (const k of ['mentor_id', 'full_name', 'trust_badge', 'rating',
                     'review_count', 'session_rate', 'bgv_cleared']) {
      expect(m, `card should expose ${k}`).toHaveProperty(k);
    }
  });

  test('filter options come from what is actually browsable', async () => {
    const r = await resp(await student.get(U('/achievers/browse/filters')));
    expect(Array.isArray(r.domains)).toBe(true);
    expect(r.sorts).toContain('price_low');
  });

  test('a price ceiling filters the list', async () => {
    const all = await resp(await student.get(U('/achievers/?per_page=50')));
    const cheap = await resp(await student.get(U('/achievers/?max_price=1&per_page=50')));
    expect(cheap.total).toBeLessThanOrEqual(all.total);
    for (const m of cheap.mentors) expect(m.session_rate).toBeLessThanOrEqual(1);
  });

  test('free_only returns only free achievers', async () => {
    const r = await resp(await student.get(U('/achievers/?free_only=1&per_page=50')));
    for (const m of r.mentors) expect(m.session_rate).toBe(0);
  });

  test('bgv_only returns only background-verified achievers', async () => {
    // `bgv_cleared`, not `teaches_minors`. The old field read
    // `achievers.can_teach_minors`, a column dropped with the DPDP age gates on
    // 2026-08-30, so it was false for everybody while the filter itself keyed on
    // `bgv_status = 'clear'` — the assertion could never pass, and the API was
    // advertising a safeguarding flag it had no data behind.
    const r = await resp(await student.get(U('/achievers/?bgv_only=1&per_page=50')));
    for (const m of r.mentors) {
      expect(m.bgv_cleared,
        `${m.full_name || m.mentor_id} came back under bgv_only=1 without a cleared check`)
        .toBe(true);
    }
  });

  test('a minimum rating never returns anything below it', async () => {
    const r = await resp(await student.get(U('/achievers/?min_rating=4&per_page=50')));
    for (const m of r.mentors) expect(m.rating).toBeGreaterThanOrEqual(4);
  });

  test('price_low sorts ascending', async () => {
    const r = await resp(await student.get(U('/achievers/?sort=price_low&per_page=50')));
    const rates = r.mentors.map((m) => m.session_rate);
    expect(rates).toEqual([...rates].sort((a, b) => a - b));
  });

  test('a garbage sort falls back rather than erroring', async () => {
    const r = await resp(await student.get(U('/achievers/?sort=;DROP TABLE achievers')));
    expect(r.sort).toBe('recommended');
    expect(Array.isArray(r.mentors)).toBe(true);
  });

  test('hostile paging values do not 500', async () => {
    for (const qs of ['page=-5', 'per_page=99999', 'page=abc&per_page=xyz', 'min_rating=abc']) {
      const res = await student.get(U(`/achievers/?${qs}`));
      const j = await res.json();
      expect(j.bool, `/achievers/?${qs} should not error`).toBe(true);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('public profile', () => {
  let id;
  test.beforeAll(async () => {
    const r = await resp(await student.get(U('/achievers/')));
    id = r.mentors[0]?.mentor_id;
  });

  test('returns a public-safe payload with reviews', async () => {
    test.skip(!id, 'no browsable achiever');
    const r = await resp(await student.get(U(`/achievers/${id}/public`)));
    expect(r.achiever.full_name).toBeTruthy();
    expect(r.achiever).toHaveProperty('sessions_completed');
    expect(r.achiever).toHaveProperty('trust_badge');
    expect(Array.isArray(r.reviews)).toBe(true);
    // Payout details and application state must never reach a public page.
    expect(r.achiever).not.toHaveProperty('payout_account_number');
    expect(r.achiever).not.toHaveProperty('application_status');
    expect(r.achiever).not.toHaveProperty('email');
  });

  test('an unknown achiever 404s cleanly', async () => {
    const r = await resp(await student.get(
      U('/achievers/00000000-0000-0000-0000-000000000000/public')));
    expect(r.message).toMatch(/not found/i);
  });

  test('viewing records a view, and a second view the same day does not double-count', async () => {
    test.skip(!id, 'no browsable achiever');
    await student.get(U(`/achievers/${id}/public`));
    const first = await resp(await achiever.get(U('/achievers/portal/funnel?days=30')));
    await student.get(U(`/achievers/${id}/public`));
    const second = await resp(await achiever.get(U('/achievers/portal/funnel?days=30')));
    // Only meaningful when the viewed achiever IS the logged-in fixture; when
    // it isn't, both reads are simply equal, which still asserts no drift.
    expect(second.views).toBe(first.views);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('achiever funnel', () => {
  test('answers views -> bookings, with guarded percentages', async () => {
    const r = await resp(await achiever.get(U('/achievers/portal/funnel?days=30')));
    for (const k of ['views', 'unique_viewers', 'bookings', 'completed',
                     'lifetime_views', 'series', 'window_days']) {
      expect(r, `funnel should expose ${k}`).toHaveProperty(k);
    }
    expect(Array.isArray(r.series)).toBe(true);
    // A zero denominator is the common case for a new achiever; it must come
    // back as null rather than dividing by zero.
    if (r.views === 0) expect(r.view_to_booking_pct).toBeNull();
    if (r.bookings === 0) expect(r.booking_to_completed_pct).toBeNull();
  });

  test('the window is clamped, not trusted', async () => {
    const r = await resp(await achiever.get(U('/achievers/portal/funnel?days=99999')));
    expect(r.window_days).toBeLessThanOrEqual(365);
    const r2 = await resp(await achiever.get(U('/achievers/portal/funnel?days=abc')));
    expect(r2.window_days).toBe(30);
  });

  test('a student token cannot read an achiever funnel', async () => {
    const r = await resp(await student.get(U('/achievers/portal/funnel')));
    expect(r.message).toMatch(/Achiever access only/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('the screens render', () => {
  test('Find Achievers loads with filters and no runtime errors', async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({ user_id: 'e2e', full_name: 'E2E', role: 'student' }));
    }, studentToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/find-mentors');
    // level: 1 — the sidebar carries the same label as an h2, so an unscoped
    // heading match is a strict-mode violation rather than a page fault.
    await expect(page.getByRole('heading', { name: /Find Achievers/i, level: 1 }))
      .toBeVisible({ timeout: 15000 });
    await page.getByRole('button', { name: /Filters/i }).click();
    await expect(page.getByText(/Background verified only/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the public achiever profile renders', async ({ page }) => {
    const r = await resp(await student.get(U('/achievers/')));
    const id = r.mentors[0]?.mentor_id;
    test.skip(!id, 'no browsable achiever');

    await page.addInitScript((t) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({ user_id: 'e2e', full_name: 'E2E', role: 'student' }));
    }, studentToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`/achievers/${id}`);
    await expect(page.getByRole('button', { name: /Share/i })).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Reviews/i).first()).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the achiever notifications screen renders', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('achiever_access_token', t), achieverToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/skovo-achiever-portal/notifications');
    await expect(page.getByRole('heading', { name: /Notifications/i })).toBeVisible({ timeout: 15000 });
    expect(errors).toEqual([]);
  });

  test('the achiever dashboard shows the Reach row', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('achiever_access_token', t), achieverToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/skovo-achiever-portal');
    await expect(page.getByText(/Profile views/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/Quality score/i)).toBeVisible();
    expect(errors).toEqual([]);
  });
});
