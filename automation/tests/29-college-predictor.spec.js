// College predictor + the admin→student college flow.
//
// A student enters exam + rank + category and gets colleges bucketed into
// Safe / Target / Reach from last year's cutoffs. Also confirms the thing QA
// asked about: a college created in admin is listed to students.
const { test, expect } = require('@playwright/test');
const { openOptions } = require('../utils/ui');
const { U, cachedTokens, STUDENTS } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'studentPro']) expect(T[k], `${k} token`).toBeTruthy();
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
const asStudent = (page) => page.addInitScript(([t, e]) => {
  localStorage.setItem('access_token', t);
  localStorage.setItem('user', JSON.stringify({
    user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
  }));
}, [T.studentPro, STUDENTS.pro.email]);

// ══════════════════════════════════════════════════════════════════════════
// The admin→student college flow QA asked about.
// ══════════════════════════════════════════════════════════════════════════
test('a college created in admin is listed to students', async ({ request }) => {
  const name = `E2E College ${Date.now().toString().slice(-8)}`;
  const c = await body(await as(request, T.admin).post('/skovo-platform-panel-admin/colleges', {
    name, type: 'government', state: 'Andhra Pradesh',
  }));
  // Some builds nest the id; either way the create must succeed.
  ok(c, 'admin creates a college');

  const list = ok(await body(await as(request, T.studentPro)
    .get('/colleges/', { per_page: 200, show_all: 1 })), 'student college list').colleges || [];
  expect(list.some((x) => x.name === name),
    'a college created in admin must appear in the student list').toBeTruthy();
});

// ══════════════════════════════════════════════════════════════════════════
// The predictor.
// ══════════════════════════════════════════════════════════════════════════
test.describe('college predictor', () => {
  test('the exams list only contains exams that have cutoff data', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentPro).get('/colleges/predict/exams')), 'exams');
    expect(Array.isArray(r.exams), 'a list of exams comes back').toBeTruthy();
    for (const e of r.exams) {
      expect(e.exam, 'each exam is named').toBeTruthy();
      expect(e.colleges, 'each listed exam actually has colleges').toBeGreaterThan(0);
    }
  });

  test('a rank is bucketed Safe / Target / Reach correctly', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentPro).post('/colleges/predict', {
      exam: 'EAMCET', rank: 5000, category: 'OC',
    })), 'predict');

    expect(r.total, 'rank 5000 OC returns matches').toBeGreaterThan(0);
    expect(r.based_on_year, 'the source year is disclosed').toBeTruthy();

    // Every safe closing rank must clear the safety margin (1.3x); every reach
    // must genuinely be below the student's rank.
    for (const c of r.safe) expect(c.closing_rank).toBeGreaterThanOrEqual(Math.round(5000 * 1.3));
    for (const c of r.target) {
      expect(c.closing_rank).toBeGreaterThanOrEqual(5000);
      expect(c.closing_rank).toBeLessThan(Math.round(5000 * 1.3));
    }
    for (const c of r.reach) expect(c.closing_rank).toBeLessThan(5000);
  });

  test('a top rank makes everything Safe', async ({ request }) => {
    const r = ok(await body(await as(request, T.studentPro).post('/colleges/predict', {
      exam: 'EAMCET', rank: 1, category: 'OC',
    })), 'predict rank 1');
    expect(r.reach.length, 'rank 1 has nothing out of reach').toBe(0);
    expect(r.total, 'rank 1 still matches colleges').toBeGreaterThan(0);
  });

  test('an unknown exam returns an empty prediction, not an error', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post('/colleges/predict', {
      exam: 'NO_SUCH_EXAM', rank: 100, category: 'OC',
    }));
    expect(j.bool, 'an unknown exam is a valid empty result, not a failure').toBeTruthy();
    expect(j.response.total, 'no matches for an unknown exam').toBe(0);
    expect(j.response.message, 'the student is told there is no data').toMatch(/no cutoff data/i);
  });

  test('a missing rank is rejected clearly', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post('/colleges/predict', { exam: 'EAMCET' }));
    expect(j.bool).toBeFalsy();
    expect(JSON.stringify(j), 'not an opaque 500').not.toMatch(/Internal Server Error/i);
  });

  test('the predictor page runs a prediction and respects its confidence gate',
    async ({ page }) => {
      await asStudent(page);
      await page.goto('/college-predictor', { waitUntil: 'domcontentloaded' });

      await expect(page.getByRole('heading', { name: /college predictor/i }).first())
        .toBeVisible({ timeout: 20_000 });

      // The Exam field is a FormSelect, not a native <select>. Its labels read
      // "EAMCET (2 colleges)", so take the first real option rather than
      // assuming a seeded exam name — and fail loudly if there are none.
      const exams = await openOptions(page, 'Exam');
      expect(await exams.count(),
        'the Exam dropdown offers no exams — is cutoff data seeded?').toBeGreaterThan(0);
      await exams.first().click();

      const categories = await openOptions(page, 'Category');
      if (await categories.count()) await categories.first().click();

      await page.getByPlaceholder(/e\.g\. 5000/i).fill('5000');
      await page.getByRole('button', { name: /predict my colleges/i }).click();

      // THE POINT OF THIS SCREEN'S SAFETY GATE (VERSION_1.md §6.2): with thin
      // cutoff data the API answers `confidence: low`, and the UI must refuse
      // the tidy Safe/Target/Reach split — a confident-looking bucket built on
      // a handful of rows tells a student something specific and wrong about
      // their future. Assert whichever branch the live data produces, and that
      // the other one is genuinely absent.
      const lowConfidence = page.getByText(/early data — treat this as a rough indication only/i);
      const safeBucket = page.getByText(/^Safe$/);

      await expect(lowConfidence.or(safeBucket).first(),
        'the predictor returned neither a result nor a confidence warning')
        .toBeVisible({ timeout: 20_000 });

      if (await lowConfidence.count()) {
        for (const bucket of [/^Safe$/, /^Target$/, /^Reach$/]) {
          await expect(page.getByText(bucket),
            'a low-confidence prediction must never render the confident split')
            .toHaveCount(0);
        }
        // It still has to show the student something, or say there is nothing.
        await expect(
          page.getByText(/possible matches/i).or(page.getByText(/no matches for that rank yet/i)).first(),
          'a low-confidence result must still resolve to matches or an honest empty state',
        ).toBeVisible();
      } else {
        await expect(safeBucket.first(), 'a confident prediction renders a Safe bucket').toBeVisible();
        await expect(page.getByText(/based on \d{4} cutoffs/i),
          'a confident prediction discloses the year it is based on').toBeVisible();
      }
    });

  test('the predictor is reachable from the Colleges tab strip', async ({ page }) => {
    // Not the sidebar. College Predictor and Saved Colleges were folded out of
    // the sidebar and into the Colleges page as tabs on 2026-09-01
    // (components/colleges/CollegeTabs.jsx), and the predictor moved to
    // /colleges/predictor with the old /college-predictor left as a redirect.
    // The tab strip is route-driven rather than local state precisely so each
    // tab keeps its own URL and back-button behaviour, so this can assert the
    // URL the way it always did.
    await asStudent(page);
    await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);
    const tab = page.getByRole('button', { name: /college predictor/i })
      .or(page.getByRole('link', { name: /college predictor/i })).first();
    await expect(tab, 'College Predictor is not offered anywhere on the Colleges page')
      .toBeVisible({ timeout: 20_000 });
    await tab.click();
    await expect(page).toHaveURL(/colleges\/predictor/, { timeout: 15_000 });
  });

  test('the old /college-predictor URL still redirects', async ({ page }) => {
    // Anyone who bookmarked it before the move must still land on the screen.
    await asStudent(page);
    await page.goto('/college-predictor', { waitUntil: 'domcontentloaded' });
    await expect(page).toHaveURL(/colleges\/predictor/, { timeout: 15_000 });
  });
});
