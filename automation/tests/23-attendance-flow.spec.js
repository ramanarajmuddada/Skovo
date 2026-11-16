// THE ATTENDANCE FLOW.
//
// The person who ran the session records who attended — not an admin who was
// not in the room. Two paths:
//   1. the achiever ticks the list in their own portal, and
//   2. students self check-in with a code the achiever reads out mid-session.
//
// Both must award the score immediately, refuse to pay twice, and stay sealed
// against an achiever touching a cohort that is not theirs.
const { test, expect } = require('@playwright/test');
const { U, cachedTokens, STUDENTS } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'achiever', 'studentPro']) expect(T[k], `${k} token`).toBeTruthy();
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  patch: (p, data) => request.patch(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  // PUT was missing, and the failure is `as(...).put is not a function` rather
  // than anything about the request — an easy one to misread as a routing
  // problem. The admin cohort update is a PUT.
  put: (p, data) => request.put(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
});
const body = async (res) => res.json();
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};

const ADMIN = '/skovo-platform-panel-admin';
const stamp = () => Date.now().toString().slice(-8);

const scoreOf = async (request, token) =>
  Number(ok(await body(await as(request, token).get('/readiness/score')), 'score').score ?? 0);

/** A `YYYY-MM-DD HH:MM:SS` string, in **IST**, offset from now by `minutes`.
 *
 *  IST, not UTC, and that is not a detail. The cohort routes run every incoming
 *  date through `parse_local_to_utc` — the client sends local time and the
 *  server converts, because the DB clock is UTC and the team is IST (+5:30).
 *  Handing it a UTC string means it subtracts another 5h30m, so a session meant
 *  to be 15 minutes old lands nearly six hours old and a 120-minute class comes
 *  back `completed` rather than `live`. The symptom is a refusal that reads
 *  like a broken guard ("This session has ended") when the guard is right and
 *  the fixture's clock is wrong.
 *
 *  Named for what it produces, so the next person does not have to work this
 *  out from a status they did not expect. */
const IST_OFFSET_MIN = 330;
const istAt = (minutes) =>
  new Date(Date.now() + (minutes + IST_OFFSET_MIN) * 60_000)
    .toISOString().slice(0, 19).replace('T', ' ');

/** Admin creates a cohort owned by the E2E achiever, and the Pro student enrols.
 *
 *  The session is placed 15 minutes IN THE PAST with a 120-minute duration, so
 *  `effective_cohort_status` derives **live**. That is not decoration: on
 *  2026-09-05 all three attendance actions gained the state gates the workbook
 *  asked for — revealing the code and the student's own check-in are live-only,
 *  marking the register is live-or-completed — because a code read aloud to a
 *  room still redeemed after the class ended, and an achiever could mark a full
 *  register on a session scheduled for next month and every name on it
 *  collected the readiness points.
 *
 *  This fixture still used `status: 'upcoming'` two days out, so the whole file
 *  had been failing against a rule that is working exactly as intended. The
 *  `status` column is deliberately left stale: these routes derive the status
 *  rather than trusting the 60-second scheduler, and leaving it wrong proves it.
 */
async function cohortWithEnrolledStudent(request, label, { when = 'live' } = {}) {
  // The E2E achiever specifically, not `achievers[0]`.
  //
  // Every test below acts with the achiever TOKEN, so a cohort owned by anyone
  // else 404s on the roster and the reveal — deliberately, since the ownership
  // guard answers 404 rather than 403 so an id cannot be probed. Taking the
  // first row out of the admin list worked only for as long as the E2E achiever
  // happened to sort first, and the failure when it stopped ("Cohort not
  // found.") points at the cohort rather than at the fixture that picked it.
  const a = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 200 }));
  const all = ok(a, 'achievers').achievers || [];
  const mine = all.find((x) => x.email === 'e2e.achiever@skovo-test.local');
  expect(mine, 'the E2E achiever is missing — run seed_test_accounts.py').toBeTruthy();
  const achieverId = mine.id;

  const title = `E2E ${label} ${stamp()}`;

  // ORDER MATTERS, and getting it wrong is silent.
  //
  // The cohort has to be **upcoming** while the student joins — `POST
  // /cohorts/<id>/enroll` derives the status and refuses anything that is
  // already live, completed or cancelled, which is correct: you cannot join a
  // class that has started. It then has to become **live** before the tests
  // run, because reveal-code and student check-in are live-only and marking the
  // register is live-or-completed (gates added 2026-09-05, after a code read
  // aloud to a room kept redeeming once the class was over).
  //
  // So: create it in the future, enrol, then move session_date into the past.
  // Creating it live in the first place — my own first attempt — fails at the
  // enrol step, and the failure reads as "the fixture is broken" rather than as
  // "the guard is working".
  const c = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
    title,
    achiever_id: achieverId, price: '0', total_seats: '50',
    duration_minutes: '120', status: 'upcoming',
    session_date: istAt(2 * 24 * 60),
  }));
  const cr = ok(c, 'create cohort');
  const cohortId = cr.id || cr.cohort_id || cr.cohort?.id;
  ok(await body(await as(request, T.studentPro).post(`/cohorts/${cohortId}/enroll`, {})), 'enrol');

  if (when === 'live') {
    // 15 minutes into a 120-minute session. `status` is deliberately left as
    // 'upcoming' so these tests exercise `effective_cohort_status` rather than
    // the column the 60-second scheduler writes — which is also X02-078, that a
    // scheduler outage must change nothing.
    ok(await body(await as(request, T.admin).put(`${ADMIN}/cohorts/${cohortId}`, {
      session_date: istAt(-15),
    })), 'move the session into the past');
  }
  return { cohortId, achieverId, title };
}

// ══════════════════════════════════════════════════════════════════════════
// 1. The achiever ticks the list.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('achiever marks attendance for their own cohort', () => {
  let cohortId, enrollmentId, before;

  test('setup: cohort exists with an enrolled student', async ({ request }) => {
    ({ cohortId } = await cohortWithEnrolledStudent(request, 'AchieverMarks'));
    expect(cohortId).toBeTruthy();
  });

  test('the achiever sees the enrolled student on their own roster', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .get(`/achievers/portal/cohorts/${cohortId}/enrollments`));
    const list = ok(j, 'achiever roster').enrollments || [];
    const row = list.find((e) => e.email === STUDENTS.pro.email);
    expect(row, 'the enrolled student is missing from the achiever roster').toBeTruthy();
    expect(row.attended, 'nobody is marked present before the session').toBeFalsy();
    enrollmentId = row.enrollment_id;
  });

  test('the achiever marks the student present', async ({ request }) => {
    before = await scoreOf(request, T.studentPro);
    const j = await body(await as(request, T.achiever)
      .patch(`/achievers/portal/cohorts/${cohortId}/attendance`, { present: [enrollmentId] }));
    const r = ok(j, 'achiever marks attendance');
    expect(r.present, 'one student marked present').toBe(1);
  });

  test("the student's score rises immediately", async ({ request }) => {
    const after = await scoreOf(request, T.studentPro);
    expect(after, `score did not move (before=${before} after=${after})`).toBeGreaterThan(before);
  });

  test('the roster now shows them as attended', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .get(`/achievers/portal/cohorts/${cohortId}/enrollments`));
    const row = (ok(j, 'roster').enrollments || []).find((e) => e.enrollment_id === enrollmentId);
    expect(row.attended, 'attendance did not stick').toBeTruthy();
  });

  test('saving the same attendance again does not pay twice', async ({ request }) => {
    const twice = await scoreOf(request, T.studentPro);
    ok(await body(await as(request, T.achiever)
      .patch(`/achievers/portal/cohorts/${cohortId}/attendance`, { present: [enrollmentId] })), 're-save');
    expect(await scoreOf(request, T.studentPro), 'the same attendance paid twice').toBe(twice);
  });

  test('unticking marks the student absent again', async ({ request }) => {
    ok(await body(await as(request, T.achiever)
      .patch(`/achievers/portal/cohorts/${cohortId}/attendance`, { present: [] })), 'untick');
    const j = await body(await as(request, T.achiever)
      .get(`/achievers/portal/cohorts/${cohortId}/enrollments`));
    const row = (ok(j, 'roster').enrollments || []).find((e) => e.enrollment_id === enrollmentId);
    expect(row.attended, 'unticking did not take effect').toBeFalsy();
  });

  test('a bogus enrollment id is refused with a clear error, not a 500', async ({ request }) => {
    const res = await as(request, T.achiever)
      .patch(`/achievers/portal/cohorts/${cohortId}/attendance`, { present: ['not-an-enrolment'] });
    const j = await res.json();
    expect(j.bool).toBeFalsy();
    expect(JSON.stringify(j), 'must not be an opaque 500').not.toMatch(/Internal Server Error/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 2. Security: an achiever must never reach another achiever's cohort.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('attendance is sealed to the cohort owner', () => {
  let foreignCohortId;

  test("setup: a cohort owned by somebody else", async ({ request }) => {
    const a = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 100 }));
    const achievers = ok(a, 'achievers').achievers || [];
    const mine = await body(await as(request, T.achiever).get('/achievers/portal/profile'));
    const myId = ok(mine, 'profile').id;
    const other = achievers.find((x) => x.id !== myId);
    test.skip(!other, 'only one achiever exists — cannot test cross-achiever isolation');

    const c = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
      title: `E2E Foreign ${stamp()}`,
      achiever_id: other.id, price: '0', total_seats: '10',
      // Live, so the refusals below can only be about ownership. A cohort in
      // the wrong state would be refused by the state gate first and the test
      // would pass without ever exercising the thing it names. Safe to create
      // live directly: nobody enrols in this one.
      duration_minutes: '120', status: 'upcoming',
      session_date: istAt(-15),
    }));
    const cr = ok(c, 'create foreign cohort');
    foreignCohortId = cr.id || cr.cohort_id || cr.cohort?.id;
  });

  test('marking attendance on a cohort you do not own is refused', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .patch(`/achievers/portal/cohorts/${foreignCohortId}/attendance`, { present: [] }));
    expect(j.bool, "an achiever must not mark another achiever's cohort").toBeFalsy();
  });

  test('revealing a code for a cohort you do not own is refused', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .post(`/achievers/portal/cohorts/${foreignCohortId}/attendance-code`, {}));
    expect(j.bool, "an achiever must not reveal another achiever's code").toBeFalsy();
  });

  test('a STUDENT cannot mark attendance at all', async ({ request }) => {
    const j = await body(await as(request, T.studentPro)
      .patch(`/achievers/portal/cohorts/${foreignCohortId}/attendance`, { present: [] }));
    expect(j.bool, 'a student must never reach the attendance endpoint').toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 3. Self check-in with the code the achiever reads out.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('student self check-in with the session code', () => {
  let cohortId, code, before;

  test('setup: cohort exists with an enrolled student', async ({ request }) => {
    ({ cohortId } = await cohortWithEnrolledStudent(request, 'CheckIn'));
  });

  test('before any code is revealed, check-in is refused with a useful message', async ({ request }) => {
    const j = await body(await as(request, T.studentPro)
      .post(`/cohorts/${cohortId}/check-in`, { code: '0000' }));
    expect(j.bool).toBeFalsy();
    expect(j.response?.reason, 'the student should be told no code is live').toBe('no_active_code');
  });

  test('the achiever reveals the code', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .post(`/achievers/portal/cohorts/${cohortId}/attendance-code`, { valid_minutes: 20 }));
    const r = ok(j, 'reveal code');
    code = r.code;
    expect(code, 'a code was issued').toMatch(/^\d{4}$/);
    expect(r.expires_at, 'the code expires').toBeTruthy();
  });

  test('a wrong code is refused and does not mark attendance', async ({ request }) => {
    const wrong = code === '1234' ? '4321' : '1234';
    const j = await body(await as(request, T.studentPro)
      .post(`/cohorts/${cohortId}/check-in`, { code: wrong }));
    expect(j.bool).toBeFalsy();
    expect(j.response?.reason).toBe('wrong_code');
  });

  test('the right code checks the student in and awards points', async ({ request }) => {
    before = await scoreOf(request, T.studentPro);
    const j = await body(await as(request, T.studentPro)
      .post(`/cohorts/${cohortId}/check-in`, { code }));
    const r = ok(j, 'check in');
    expect(r.attended).toBeTruthy();
    expect(await scoreOf(request, T.studentPro), 'score did not move on check-in')
      .toBeGreaterThan(before);
  });

  test('checking in twice does not pay twice', async ({ request }) => {
    const twice = await scoreOf(request, T.studentPro);
    await as(request, T.studentPro).post(`/cohorts/${cohortId}/check-in`, { code });
    expect(await scoreOf(request, T.studentPro), 'a second check-in paid again').toBe(twice);
  });

  test('the check-in shows up on the achiever roster', async ({ request }) => {
    const j = await body(await as(request, T.achiever)
      .get(`/achievers/portal/cohorts/${cohortId}/enrollments`));
    const row = (ok(j, 'roster').enrollments || []).find((e) => e.email === STUDENTS.pro.email);
    expect(row?.attended, 'the self check-in never reached the achiever roster').toBeTruthy();
  });

  test('re-revealing retires the previous code', async ({ request }) => {
    const old = code;
    const j = await body(await as(request, T.achiever)
      .post(`/achievers/portal/cohorts/${cohortId}/attendance-code`, {}));
    const fresh = ok(j, 're-reveal').code;
    expect(fresh).toMatch(/^\d{4}$/);

    if (fresh !== old) {
      const r = await body(await as(request, T.studentPro)
        .post(`/cohorts/${cohortId}/check-in`, { code: old }));
      expect(r.bool, 'a retired code must no longer work').toBeFalsy();
    }
  });

  test('a student who is not enrolled cannot check in', async ({ request }) => {
    const j = await body(await as(request, T.studentFree)
      .post(`/cohorts/${cohortId}/check-in`, { code }));
    expect(j.bool).toBeFalsy();
    expect(j.response?.reason).toBe('not_enrolled');
  });

  test('an empty code is refused cleanly', async ({ request }) => {
    const res = await as(request, T.studentPro).post(`/cohorts/${cohortId}/check-in`, { code: '' });
    const j = await res.json();
    expect(j.bool).toBeFalsy();
    expect(JSON.stringify(j), 'must not be an opaque 500').not.toMatch(/Internal Server Error/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 4. The screens themselves — the achiever's attendance panel and the
//    student's check-in box, driven through the real UI.
// ══════════════════════════════════════════════════════════════════════════
test.describe('attendance UI', () => {
  test('achiever: the Attendance panel shows the roster, a code and a save button',
    async ({ page, request }) => {
      const { cohortId } = await cohortWithEnrolledStudent(request, 'UIRoster');
      expect(cohortId).toBeTruthy();

      await page.addInitScript((t) => {
        localStorage.setItem('achiever_access_token', t);
        localStorage.setItem('achiever_user', JSON.stringify({
          id: 'e2e', user_id: 'e2e', full_name: 'E2E Achiever', role: 'achiever',
        }));
      }, T.achiever);

      await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
      // Phase 3 of the achiever redesign moved the roster behind the card's
      // "Students (n)" action — six flex-1 buttons were clipping the card, so
      // only the two used during a session stayed on it.
      await expect(page.getByRole('button', { name: /^students/i }).first())
        .toBeVisible({ timeout: 20_000 });
      await page.getByRole('button', { name: /^students/i }).first().click();

      await expect(page.getByRole('heading', { name: /^attendance$/i })).toBeVisible({ timeout: 10_000 });
      await expect(page.getByRole('button', { name: /show code|new code/i })).toBeVisible();
      await expect(page.getByRole('button', { name: /save attendance/i })).toBeVisible();
    });

  test('achiever: clicking Show code reveals four digits', async ({ page, request }) => {
    const { cohortId } = await cohortWithEnrolledStudent(request, 'UICode');
    expect(cohortId).toBeTruthy();

    await page.addInitScript((t) => {
      localStorage.setItem('achiever_access_token', t);
      localStorage.setItem('achiever_user', JSON.stringify({
        id: 'e2e', full_name: 'E2E Achiever', role: 'achiever',
      }));
    }, T.achiever);

    await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
    const students = page.getByRole('button', { name: /^students/i }).first();
    await expect(students).toBeVisible({ timeout: 20_000 });
    await students.click();
    await expect(page.getByRole('heading', { name: /^attendance$/i })).toBeVisible({ timeout: 10_000 });

    const show = page.getByRole('button', { name: /show code/i });
    if (await show.count()) {
      const [req] = await Promise.all([
        page.waitForRequest((r) => r.url().includes('/attendance-code') && r.method() === 'POST',
          { timeout: 15_000 }),
        show.click(),
      ]);
      expect(req).toBeTruthy();
      await expect(page.getByText(/^\d{4}$/).first()).toBeVisible({ timeout: 10_000 });
    }
  });

  test('student: an enrolled cohort offers a check-in box', async ({ page, request }) => {
    const { cohortId, title } = await cohortWithEnrolledStudent(request, 'UICheckIn');
    ok(await body(await as(request, T.achiever)
      .post(`/achievers/portal/cohorts/${cohortId}/attendance-code`, {})), 'reveal');

    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
      }));
    }, [T.studentPro, STUDENTS.pro.email]);

    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2000);

    // Search for the exact cohort we enrolled in, so we open ours and not
    // whatever happens to sort first.
    const search = page.getByPlaceholder(/search/i).first();
    await expect(search).toBeVisible({ timeout: 20_000 });
    await search.fill(title);
    await search.press('Enter');
    await page.waitForTimeout(2500);

    const view = page.locator('span.group').filter({ hasText: 'View cohort details' })
      .locator('button').first();
    await expect(view, 'the enrolled cohort should be findable by search').toBeVisible({ timeout: 20_000 });
    await view.click();
    await page.waitForTimeout(2500);

    const checkIn = page.getByRole('button', { name: /i have a check-in code/i });
    await expect(checkIn, 'an enrolled cohort must offer check-in').toBeVisible({ timeout: 15_000 });
    await checkIn.click();
    await expect(page.getByLabel(/code your achiever read out/i)).toBeVisible({ timeout: 10_000 });
  });
});
