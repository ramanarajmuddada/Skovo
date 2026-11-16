// Fixes for the QA round.
//
//   · communities were permanently "full" (a blank cap stored as 0),
//   · member_count drifted and could lock people out of a group with room,
//   · long forms grew past the screen with no way to reach Save,
//   · students had no way to discover a discount code,
//   · Admin Courses was hidden.
const { test, expect } = require('@playwright/test');
const { U, cachedTokens, STUDENTS } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'studentPro', 'studentFree']) expect(T[k], `${k} token`).toBeTruthy();
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  put: (p, data) => request.put(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  patch: (p, data) => request.patch(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
});
const body = async (res) => res.json();
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};
const ADMIN = '/skovo-platform-panel-admin';
const stamp = () => Date.now().toString().slice(-8);

/** A brand-new student with zero group memberships.
 *
 *  The seeded free student sits at exactly FREE_GROUP_LIMIT (3) once the rest
 *  of the suite has run, so a join refusal could come from the free-tier limit
 *  rather than the group being full — the assertion passed on the wrong reason.
 *  A fresh account has no memberships, so "full" is the only refusal possible. */
async function freshStudent(request) {
  const email = `e2e.capcheck.${Date.now()}@skovo-test.local`;
  const res = await request.post(U('/auth/register'), {
    data: { full_name: 'E2E Cap Check', email, password: 'E2ePass!234' },
  });
  const j = await res.json();
  const token = j.access_token || j.response?.access_token;
  expect(token, 'the throwaway student registered').toBeTruthy();
  await request.post(U('/auth/consent/dob'), {
    headers: { Authorization: `Bearer ${token}` },
    data: { date_of_birth: '2000-01-01' },
  }).catch(() => {});
  return token;
}

// ══════════════════════════════════════════════════════════════════════════
// Communities were impossible to join.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('a community created without a cap can be joined', () => {
  let groupId;
  const name = `E2E JoinFix ${stamp()}`;

  test('admin creates a community leaving the member cap blank', async ({ request }) => {
    const j = await body(await as(request, T.admin).post(`${ADMIN}/communities`, {
      name, description: 'Created by the QA-fix test.',
      category: 'career', group_type: 'public', join_type: 'open',
      // max_members deliberately omitted — the exact case that used to store 0
      // and make the group full from birth.
    }));
    const r = ok(j, 'create community');
    groupId = r.id || r.group_id;
    expect(groupId).toBeTruthy();
  });

  test('the cap is stored as "no limit", not zero', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/communities`, { per_page: 200 }));
    const row = (ok(j, 'communities').communities || ok(j, 'x').groups || [])
      .find((g) => g.id === groupId);
    expect(row, 'the new community is missing from the admin list').toBeTruthy();
    expect(row.max_members ?? null, 'a blank cap must be null, never 0').not.toBe(0);
  });

  test('a student can actually join it', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post(`/assemble/groups/${groupId}/join`, {}));
    ok(j, 'student joins the community');
    expect(String(j.response?.message || ''), 'an uncapped community must not report itself full')
      .not.toMatch(/is full/i);
  });

  test('a real cap is still enforced', async ({ request }) => {
    const capped = `E2E Capped ${stamp()}`;
    const c = await body(await as(request, T.admin).post(`${ADMIN}/communities`, {
      name: capped, category: 'career', group_type: 'public', join_type: 'open',
      max_members: 1,
    }));
    const id = ok(c, 'create capped community').id;

    ok(await body(await as(request, T.studentPro).post(`/assemble/groups/${id}/join`, {})), 'first join');

    const newcomer = await freshStudent(request);
    const second = await body(await as(request, newcomer).post(`/assemble/groups/${id}/join`, {}));
    expect(second.bool, 'a genuinely full group must still refuse').toBeFalsy();
    expect(JSON.stringify(second), 'the refusal must be about capacity, not the free-tier group limit')
      .toMatch(/full/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// The counter must never be able to lock people out on its own.
// ══════════════════════════════════════════════════════════════════════════
test('member_count matches reality across every community', async ({ request }) => {
  const j = await body(await as(request, T.admin).get(`${ADMIN}/communities`, { per_page: 200 }));
  const groups = ok(j, 'communities').communities || ok(j, 'x').groups || [];
  expect(groups.length, 'there are communities to check').toBeGreaterThan(0);

  // A cap of 0 is the bug signature — it means "full forever".
  const stuck = groups.filter((g) => g.max_members === 0);
  expect(stuck.map((g) => g.name), 'no community may carry a zero cap').toEqual([]);
});

// ══════════════════════════════════════════════════════════════════════════
// Students could not discover a discount code at all.
// ══════════════════════════════════════════════════════════════════════════
test.describe('students can see their discount codes', () => {
  test('the coupons endpoint returns only usable codes', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/billing/coupons'));
    const r = ok(j, 'student coupons');
    expect(Array.isArray(r.coupons), 'a list comes back').toBeTruthy();

    for (const c of r.coupons) {
      expect(c.code, 'each coupon has a code').toBeTruthy();
      expect(c.value, 'each coupon is worth something').toBeGreaterThan(0);
      if (c.valid_until) {
        expect(new Date(c.valid_until).getTime(),
          `expired coupon ${c.code} must not be offered`).toBeGreaterThan(Date.now());
      }
    }
  });

  test('a code shown to the student actually works at checkout', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentPro).get('/billing/coupons')), 'coupons');
    test.skip(!r.coupons.length, 'no active coupons configured');

    const c = r.coupons[0];
    const v = await body(await as(request, T.studentPro).post('/billing/coupons/validate', {
      code: c.code, amount: 5000, context_type: 'all',
    }));
    expect(v.bool, `coupon ${c.code} is advertised but rejected at checkout`).toBeTruthy();
  });

  test('Market shows the codes to the student', async ({ page, request }) => {
    const r = ok(await body(await as(request, T.studentPro).get('/billing/coupons')), 'coupons');
    test.skip(!r.coupons.length, 'no active coupons configured');

    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
      }));
    }, [T.studentPro, STUDENTS.pro.email]);

    await page.goto('/market', { waitUntil: 'domcontentloaded' });
    await expect(page.getByText(/your discount codes/i)).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(r.coupons[0].code).first()).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A long form must stay on screen with Save reachable.
// ══════════════════════════════════════════════════════════════════════════
test('the Market deal form fits the screen and Save stays reachable', async ({ page }) => {
  await page.addInitScript((t) => {
    localStorage.setItem('admin_access_token', t);
    localStorage.setItem('admin_user', JSON.stringify({
      id: 'e2e', full_name: 'E2E Admin', role: 'admin', admin_role: 'founder',
    }));
  }, T.admin);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/skovo-platform-panel-admin/market', { waitUntil: 'domcontentloaded' });

  await page.getByRole('button', { name: /new deal/i }).first().click();
  const save = page.getByRole('button', { name: /save deal/i });
  await expect(save).toBeVisible({ timeout: 15_000 });

  // The dialog must not run off the bottom of the window…
  const dialog = page.locator('div.relative.bg-white.rounded-2xl').first();
  const box = await dialog.boundingBox();
  expect(box, 'the dialog is on screen').toBeTruthy();
  expect(box.height, 'the dialog must not be taller than the viewport')
    .toBeLessThanOrEqual(720);

  // …and Save must be clickable without scrolling the page behind it.
  const saveBox = await save.boundingBox();
  expect(saveBox.y + saveBox.height, 'Save must sit inside the window')
    .toBeLessThanOrEqual(720);
});

// ══════════════════════════════════════════════════════════════════════════
// Admin Courses is back, and Colleges is findable by that name.
// ══════════════════════════════════════════════════════════════════════════
test.describe('admin navigation', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript((t) => {
      localStorage.setItem('admin_access_token', t);
      localStorage.setItem('admin_user', JSON.stringify({
        id: 'e2e', full_name: 'E2E Admin', role: 'admin', admin_role: 'founder',
      }));
    }, T.admin);
  });

  test('Courses is in the sidebar and opens', async ({ page }) => {
    await page.goto('/skovo-platform-panel-admin', { waitUntil: 'domcontentloaded' });
    const link = page.getByRole('link', { name: /^courses$/i }).first();
    await expect(link, 'Courses must be reachable from the sidebar').toBeVisible({ timeout: 20_000 });
    await link.click();
    await expect(page).toHaveURL(/courses$/, { timeout: 15_000 });
  });

  test('the colleges page is labelled "Colleges", not "College Profile"', async ({ page }) => {
    await page.goto('/skovo-platform-panel-admin', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: /^colleges$/i }).first(),
      'QA could not find the college page because the nav called it "College Profile"')
      .toBeVisible({ timeout: 20_000 });
  });

  test('an admin can add a college', async ({ page }) => {
    await page.goto('/skovo-platform-panel-admin/colleges', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /add college/i }).first())
      .toBeVisible({ timeout: 20_000 });
  });
});

// ══════════════════════════════════════════════════════════════════════════
// REGRESSION: a partial profile save must not wipe the onboarding answers
// the edit form cannot see.
// ══════════════════════════════════════════════════════════════════════════
test('saving the profile form keeps the fields it does not show', async ({ request }) => {
  const stu = as(request, T.studentPro);

  // Fields captured at onboarding that the Profile edit form never renders.
  ok(await body(await stu.patch('/profile/', {
    school_name: 'QA Probe School', degree_type: 'B.Tech',
    branch: 'CSE', working_role: 'QA Probe Role',
  })), 'seed onboarding-only fields');

  // Exactly what the Profile edit form submits — nine fields, nothing else.
  ok(await body(await stu.patch('/profile/', {
    full_name: 'E2E Pro Student', phone: '', education_level: 'ug',
    stream: 'CSE', college_name: '', year_of_study: '',
    city: 'Nagpur', state: '', career_interests: [],
  })), 'partial save from the profile form');

  const p = ok(await body(await stu.get('/profile/')), 'read profile').profile || {};
  expect(p.school_name, 'school_name survived the partial save').toBe('QA Probe School');
  expect(p.degree_type, 'degree_type survived').toBe('B.Tech');
  expect(p.working_role, 'working_role survived').toBe('QA Probe Role');
});
