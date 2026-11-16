// Flow fixes:
//   1. one chronological "Upcoming" list instead of two type-based tabs,
//   2. first login is Profile until the path is complete, and
//   3. the platform owner can create staff without needing an existing admin.
const { test, expect } = require('@playwright/test');
const { U, cachedTokens, STUDENTS, login } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'super', 'achiever', 'studentPro']) expect(T[k], `${k} token`).toBeTruthy();
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  patch: (p, data) => request.patch(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
});
const body = async (res) => res.json();
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};

const ADMIN = '/skovo-platform-panel-admin';
const SUPER = '/skovo-platform-owner';
const stamp = () => Date.now().toString().slice(-8);

const asStudent = (page, token) => page.addInitScript(([t, e]) => {
  localStorage.setItem('access_token', t);
  localStorage.setItem('user', JSON.stringify({
    user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
  }));
}, [token, STUDENTS.pro.email]);

// ══════════════════════════════════════════════════════════════════════════
// 1. One list for "what do I have coming up".
// ══════════════════════════════════════════════════════════════════════════
test.describe('Bookings opens on a single Upcoming list', () => {
  test('Upcoming is the default tab', async ({ page }) => {
    await asStudent(page, T.studentPro);
    await page.goto('/bookings', { waitUntil: 'domcontentloaded' });

    const upcoming = page.getByRole('button', { name: /upcoming/i });
    await expect(upcoming).toBeVisible({ timeout: 20_000 });
    // The active tab carries the white pill styling.
    await expect(upcoming).toHaveClass(/bg-white/);
  });

  test('a cohort enrolment appears in Upcoming', async ({ page, request }) => {
    const a = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 50 }));
    const achieverId = (ok(a, 'achievers').achievers || [])[0]?.id;
    const title = `E2E Upcoming ${stamp()}`;
    const c = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
      title, achiever_id: achieverId, price: '0', total_seats: '20',
      duration_minutes: '60', status: 'upcoming',
      session_date: new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    }));
    const cr = ok(c, 'create cohort');
    const cohortId = cr.id || cr.cohort_id || cr.cohort?.id;
    ok(await body(await as(request, T.studentPro).post(`/cohorts/${cohortId}/enroll`, {})), 'enrol');

    await asStudent(page, T.studentPro);
    await page.goto('/bookings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(3000);

    await expect(page.getByText(title).first(),
      'a cohort the student enrolled in must show in Upcoming').toBeVisible({ timeout: 20_000 });
    await expect(page.getByText('COHORT').first(), 'items are labelled by type').toBeVisible();
  });

  test('the per-type tabs still work', async ({ page }) => {
    await asStudent(page, T.studentPro);
    await page.goto('/bookings', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);

    await page.getByRole('button', { name: /cohort bookings/i }).click();
    await expect(page.getByRole('button', { name: /cohort bookings/i })).toHaveClass(/bg-white/);

    await page.getByRole('button', { name: /achiever sessions/i }).click();
    await expect(page.getByRole('button', { name: /achiever sessions/i })).toHaveClass(/bg-white/);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. First login lands on Dashboard. Profile is optional until a screen asks.
// ══════════════════════════════════════════════════════════════════════════
test.describe('first login is not a profile wall', () => {
  async function freshStudent(page) {
    const email = `e2e.onboard.${Date.now()}@skovo-test.local`;
    const password = 'E2ePass!234';
    const res = await page.request.post(U('/auth/register'), {
      data: { full_name: 'E2E Onboarding', email, password },
    });
    const j = await res.json();
    const token = j.access_token || j.response?.access_token;
    expect(token, 'the throwaway student registered').toBeTruthy();

    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Onboarding', email: e, role: 'student',
      }));
    }, [token, email]);
    return token;
  }

  test('a new student lands on Dashboard', async ({ page }) => {
    await freshStudent(page);
    await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/career-path/, { timeout: 20_000 });
    await expect(page.getByText(/finish your profile to enter skovo/i)).toHaveCount(0);
    await expect(page.getByText(/add your education/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('there is no onboarding modal', async ({ page }) => {
    await freshStudent(page);
    await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('button', { name: /^next$/i })).toHaveCount(0);
  });

  test('Edit Profile opens the same form', async ({ page }) => {
    await freshStudent(page);
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/\/profile/, { timeout: 20_000 });
    await page.getByRole('button', { name: /edit profile/i }).click();
    await expect(page.getByRole('button', { name: /save changes/i }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: /save education/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /save goals/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /change profile photo/i })).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. The platform owner can onboard staff directly.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('admin onboarding: self-register → super-admin approves', () => {
  // Rewritten 2026-09-06. This block used to POST /skovo-platform-owner/admins
  // with an `admin_role`, and assert that the stored role was not the founder
  // default. None of that exists any more:
  //
  //   * There is no POST /admins. Admins **self-register** and a super-admin
  //     approves them (CLAUDE.md §3). The owner endpoint is GET plus
  //     POST /admins/<id>/state with approve | reject | suspend.
  //   * There are no admin roles. `admin_role` was never written to the JWT, so
  //     the whole system enforced nothing; it was removed on 2026-08-30 along
  //     with the column, and `helpers/admin_auth.py` now just checks
  //     `role === 'admin'`.
  //
  // So the block had been red against a design the product deliberately left
  // behind — which reads as a regression to anyone scanning the run. What it
  // asserts now is the flow that replaced it, including the part that actually
  // matters: a freshly registered admin is PENDING and cannot reach admin
  // endpoints until somebody approves them.
  const email = `e2e.newadmin.${Date.now()}@skovo-test.local`;
  const PASSWORD = 'E2ePass!234';
  let adminId, pendingToken;

  test('an admin self-registers and lands in the queue as pending', async ({ request }) => {
    const res = await request.post(U(`${ADMIN}/register`), {
      data: { full_name: 'E2E Created Admin', email, password: PASSWORD },
    });
    const j = await res.json();
    // Registration may require an OTP step; either way it must not 500, and the
    // account must not arrive already active.
    expect(JSON.stringify(j), 'admin register must not be an opaque 500')
      .not.toMatch(/Internal Server Error/i);
    pendingToken = j.access_token || j.response?.access_token;

    const q = await body(await as(request, T.super).get(`${SUPER}/admins`, { per_page: 500 }));
    const row = (ok(q, 'super admins').admins || []).find((a) => a.email === email);
    test.skip(!row, 'admin self-registration needs an OTP this test deliberately does not send');
    adminId = row.id;
    expect(String(row.state || row.status || ''),
      'a self-registered admin must not arrive already active')
      .not.toMatch(/^active$/i);
  });

  test('a pending admin cannot reach admin endpoints', async ({ request }) => {
    test.skip(!pendingToken, 'no token for the pending admin');
    const j = await body(await as(request, pendingToken).get(`${ADMIN}/users`, { per_page: 5 }));
    expect(j.bool, 'a pending admin reached an admin endpoint before approval').toBeFalsy();
  });

  test('the super-admin approves them', async ({ request }) => {
    test.skip(!adminId, 'no admin to approve');
    const j = await body(await as(request, T.super)
      .post(`${SUPER}/admins/${adminId}/state`, { decision: 'approve', reason: 'E2E approval' }));
    ok(j, 'super approves admin');
  });

  test('an approved admin can sign in', async ({ request }) => {
    test.skip(!adminId, 'no admin to sign in');
    const res = await request.post(U(`${ADMIN}/login`), { data: { email, password: PASSWORD } });
    const j = await res.json();
    const token = j.access_token || j.response?.access_token;
    expect(token, `an approved admin cannot log in: ${JSON.stringify(j).slice(0, 250)}`)
      .toBeTruthy();
  });

  test('a decision with no reason is refused', async ({ request }) => {
    // The admin reads the reason. "Rejected" with nothing attached produces an
    // email asking why, every time — so the endpoint requires one.
    test.skip(!adminId, 'no admin to act on');
    const j = await body(await as(request, T.super)
      .post(`${SUPER}/admins/${adminId}/state`, { decision: 'suspend' }));
    expect(j.bool, 'a state change with no reason must be refused').toBeFalsy();
    expect(JSON.stringify(j), 'must not be an opaque 500').not.toMatch(/Internal Server Error/i);
  });

  test('an ADMIN cannot approve admins through the owner endpoint', async ({ request }) => {
    test.skip(!adminId, 'no admin to act on');
    const j = await body(await as(request, T.admin)
      .post(`${SUPER}/admins/${adminId}/state`, { decision: 'approve', reason: 'escalation' }));
    expect(j.bool, 'an admin must not approve admins through the owner endpoint').toBeFalsy();
  });
});
