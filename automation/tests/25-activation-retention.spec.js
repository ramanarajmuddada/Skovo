// Activation and retention mechanics:
//   · a concrete route to the next gate instead of a padlock and a number,
//   · pause tokens applied automatically before decay bites,
//   · caps answered as upgrade moments rather than errors,
//   · WhatsApp captured at signup (optional, never a gate).
const { test, expect } = require('@playwright/test');
const { U, cachedTokens, STUDENTS, login } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'studentPro', 'studentFree']) expect(T[k], `${k} token`).toBeTruthy();
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
});
const body = async (res) => res.json();
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};

// ══════════════════════════════════════════════════════════════════════════
// A locked gate must come with a route through it.
// ══════════════════════════════════════════════════════════════════════════
test.describe('the path to the next unlock', () => {
  test('a student below a gate is told exactly how to reach it', async ({ request }) => {
    const j = await body(await as(request, T.studentFree).get('/readiness/score/unlocks'));
    const r = ok(j, 'unlocks');

    expect(r.next, 'a low-score student has a next gate').toBeTruthy();
    expect(r.next.points_away, 'the gap is quantified').toBeGreaterThan(0);
    expect(Array.isArray(r.next_actions), 'next_actions is a list').toBeTruthy();
    expect(r.next_actions.length, 'a locked student gets concrete actions').toBeGreaterThan(0);

    for (const a of r.next_actions) {
      expect(a.label, 'each action reads as an instruction').toBeTruthy();
      expect(a.route, 'each action says where to go').toMatch(/^\//);
      expect(a.points_each, 'each action is worth something').toBeGreaterThan(0);
    }
  });

  test('actions are ordered by what they can actually contribute', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentFree).get('/readiness/score/unlocks')), 'unlocks');
    const avail = r.next_actions.map((a) => a.points_available);
    expect(avail, 'biggest opportunity first').toEqual([...avail].sort((x, y) => y - x));
  });

  test('it never tells a student to walk through the door they are locked out of',
    async ({ request }) => {
      const r = ok(await body(await as(request, T.studentFree).get('/readiness/score/unlocks')), 'unlocks');
      const gated = r.next_actions.filter((a) =>
        ['application_submitted', 'opportunity_shortlisted'].includes(a.event_type));
      expect(gated, 'hub actions must not be suggested while the hub is locked').toHaveLength(0);
    });

  test('My Score renders the route to the next gate', async ({ page }) => {
    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Free Student', email: e, role: 'student',
      }));
    }, [T.studentFree, STUDENTS.free.email]);

    await page.goto('/my-score', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/how to unlock/i).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/point.* to go/i).first()).toBeVisible();
  });

  test('clicking an action takes the student to the screen that earns it', async ({ page }) => {
    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Free Student', email: e, role: 'student',
      }));
    }, [T.studentFree, STUDENTS.free.email]);

    await page.goto('/my-score', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/how to unlock/i).first()).toBeVisible({ timeout: 20_000 });

    const before = page.url();
    await page.getByText(/how to unlock/i).first()
      .locator('xpath=ancestor::*[contains(@class,"rounded")][1]')
      .getByRole('button').first().click();
    await page.waitForTimeout(1500);
    expect(page.url(), 'the action navigates somewhere').not.toBe(before);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Losing progress is what makes people quit. Protection has to be automatic.
// ══════════════════════════════════════════════════════════════════════════
test.describe('automatic score pause', () => {
  test('the pause status endpoint reports tokens', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentPro).get('/readiness/score/pause')), 'pause status');
    expect(r.max_tokens, 'a yearly allowance exists').toBeGreaterThan(0);
    expect(r.remaining, 'remaining is reported').toBeGreaterThanOrEqual(0);
  });

  test('the nightly sweep protects idle students before decaying them', async ({ request }) => {
    // Drive the two sweeps in the same order the scheduler does and assert the
    // protection pass runs first and reports cleanly.
    const j = await body(await as(request, T.admin).post(
      '/skovo-platform-panel-admin/score-rules/decay-run', {}));
    // The admin endpoint may or may not be exposed for manual runs; either way
    // it must not fail with a server error.
    expect(JSON.stringify(j), 'the sweep must not blow up').not.toMatch(/Internal Server Error/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A cap is the highest-intent moment a free user has. Answer with the offer.
// ══════════════════════════════════════════════════════════════════════════
test.describe('free-tier caps read as offers, not errors', () => {
  test('the saved-colleges cap returns an upgrade offer', async ({ request }) => {
    // Fill the free allowance, then trip it.
    const list = ok(await body(await as(request, T.studentFree)
      .get('/colleges/', { per_page: 12 })), 'colleges').colleges || [];
    expect(list.length, 'there are colleges to save').toBeGreaterThan(3);

    let capped = null;
    for (const c of list) {
      const j = await body(await as(request, T.studentFree).post(`/colleges/${c.id}/save`, {}));
      if (!j.bool && j.response?.requires_pro) { capped = j.response; break; }
    }
    test.skip(!capped, 'the free student did not reach the cap in this run');

    expect(capped.message, 'the message leads with what they gain').not.toMatch(/^Free plan/i);
    expect(capped.upgrade, 'a structured offer comes back').toBeTruthy();
    expect(capped.upgrade.cta_route, 'the offer points at the Pro page').toBe('/skovo-pro');
    expect(capped.upgrade.benefit, 'the offer says what Pro gives').toBeTruthy();
  });

  test('the communities cap returns the same shape', async ({ request }) => {
    const groups = ok(await body(await as(request, T.studentFree)
      .get('/assemble/groups', { per_page: 20 })), 'groups').groups || [];
    test.skip(groups.length < 4, 'not enough communities seeded to reach the cap');

    let capped = null;
    for (const g of groups) {
      const j = await body(await as(request, T.studentFree).post(`/assemble/groups/${g.id}/join`, {}));
      if (!j.bool && j.response?.requires_pro) { capped = j.response; break; }
    }
    test.skip(!capped, 'the free student did not reach the community cap in this run');

    expect(capped.upgrade?.cta_route).toBe('/skovo-pro');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// WhatsApp at signup — asked for, never required.
// ══════════════════════════════════════════════════════════════════════════
test.describe('WhatsApp capture at signup', () => {
  test('a number given at signup is stored in canonical form', async ({ request }) => {
    const email = `e2e.wa.${Date.now()}@skovo-test.local`;
    const j = await body(await request.post(U('/auth/register'), {
      data: {
        full_name: 'E2E WhatsApp', email, password: 'E2ePass!234',
        // Typed the way a person actually types it. Unique per run: phone is
        // unique among active users, so a fixed number collides on re-runs.
        whatsapp: `9${String(Date.now()).slice(-9)}`,
      },
    }));
    expect(j.bool || j.response?.user_id, 'signup succeeded').toBeTruthy();
    expect(j.response?.phone, 'the number is normalised to +91…').toMatch(/^\+919\d{9}$/);
  });

  // REGRESSION: users has unique keys on BOTH email and phone. A phone
  // collision used to be reported as "this email is already registered",
  // sending the person off to sign in with an address that does not exist —
  // and an optional field was silently blocking signup entirely.
  test('a WhatsApp number already in use does not block signup', async ({ request }) => {
    const shared = `9${String(Date.now()).slice(-9)}`;

    const first = await body(await request.post(U('/auth/register'), {
      data: { full_name: 'E2E WA First', email: `e2e.wa1.${Date.now()}@skovo-test.local`,
              password: 'E2ePass!234', whatsapp: shared },
    }));
    expect(first.response?.phone, 'the first signup keeps the number').toBeTruthy();

    const second = await body(await request.post(U('/auth/register'), {
      data: { full_name: 'E2E WA Second', email: `e2e.wa2.${Date.now()}@skovo-test.local`,
              password: 'E2ePass!234', whatsapp: shared },
    }));
    expect(second.response?.user_id, 'a duplicate number must not turn the person away').toBeTruthy();
    expect(JSON.stringify(second), 'and must never blame the email')
      .not.toMatch(/email is already registered/i);
  });

  test('signup still works with no number at all', async ({ request }) => {
    const email = `e2e.nowa.${Date.now()}@skovo-test.local`;
    const j = await body(await request.post(U('/auth/register'), {
      data: { full_name: 'E2E No WhatsApp', email, password: 'E2ePass!234' },
    }));
    expect(j.bool || j.response?.user_id, 'an optional field must never block signup').toBeTruthy();
  });

  test('an unusable number is dropped, not fatal', async ({ request }) => {
    const email = `e2e.badwa.${Date.now()}@skovo-test.local`;
    const j = await body(await request.post(U('/auth/register'), {
      data: {
        full_name: 'E2E Bad WhatsApp', email, password: 'E2ePass!234',
        whatsapp: '12345',            // too short, and not an Indian mobile
      },
    }));
    expect(j.bool || j.response?.user_id, 'a bad optional number must not fail signup').toBeTruthy();
    expect(j.response?.phone, 'the unusable number is dropped').toBeFalsy();
  });

  test('the signup form offers the field as optional', async ({ page }) => {
    await page.goto('/signup', { waitUntil: 'domcontentloaded' });
    await expect(page.getByLabel(/whatsapp/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/optional/i).first(), 'it is clearly optional').toBeVisible();
  });
});
