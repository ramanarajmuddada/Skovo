// CROSS-PORTAL, PART 2 — actions taken in a staff portal that change what a
// student or achiever can actually do.
//
// These are the highest-risk flows in the product: two of them drive the score
// engine (which was silently resetting scores until this suite caught it), and
// the rest gate access or move money.
const { test, expect } = require('@playwright/test');
const crypto = require('crypto');
const { U, cachedTokens, STUDENTS, login } = require('../utils/api');

let T = {};
test.beforeAll(async () => {
  T = cachedTokens();
  for (const k of ['admin', 'super', 'achiever', 'studentPro', 'studentFree']) {
    expect(T[k], `${k} token`).toBeTruthy();
  }
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  put: (p, data) => request.put(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  patch: (p, data) => request.patch(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  del: (p) => request.delete(U(p), { headers: { Authorization: `Bearer ${token}` } }),
});

const body = async (res) => res.json();
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};

const ADMIN = '/skovo-platform-panel-admin';
const SUPER = '/skovo-platform-owner';
const stamp = () => Date.now().toString().slice(-8);

const scoreOf = async (request, token) => {
  const j = await body(await as(request, token).get('/readiness/score'));
  return Number(ok(j, 'read score').score ?? 0);
};

// ══════════════════════════════════════════════════════════════════════════
// Admin marks a student as ATTENDED → the student's score must go up.
// This is the write side of the score engine (COHORT_ATTENDED award).
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('admin marks attendance → student score rises', () => {
  let cohortId, enrollmentId, before;

  test('admin creates a cohort and the student enrols', async ({ request }) => {
    const a = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 50 }));
    const achieverId = (ok(a, 'achievers').achievers || [])[0]?.id;

    const c = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
      title: `E2E Attendance ${stamp()}`,
      achiever_id: achieverId, price: '0', total_seats: '50',
      duration_minutes: '60', status: 'upcoming',
      session_date: new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    }));
    const cr = ok(c, 'create cohort');
    cohortId = cr.id || cr.cohort_id || cr.cohort?.id;
    expect(cohortId).toBeTruthy();

    ok(await body(await as(request, T.studentPro).post(`/cohorts/${cohortId}/enroll`, {})), 'enrol');
  });

  test('admin can find the enrolment', async ({ request }) => {
    before = await scoreOf(request, T.studentPro);

    const j = await body(await as(request, T.admin).get(`${ADMIN}/bookings`, { per_page: 500 }));
    const list = ok(j, 'admin bookings').bookings || [];
    const row = list.find((b) => b.cohort_id === cohortId);
    expect(row, 'enrolment not visible to admin').toBeTruthy();
    enrollmentId = row.id || row.enrollment_id;
    expect(enrollmentId).toBeTruthy();
  });

  test('admin marks the student ATTENDED', async ({ request }) => {
    const j = await body(await as(request, T.admin).patch(`${ADMIN}/bookings/${enrollmentId}`, {
      attended: true,
    }));
    ok(j, 'mark attended');
  });

  test("the attendance raises the student's score", async ({ request }) => {
    const after = await scoreOf(request, T.studentPro);
    expect(after, `score did not rise after attendance (before=${before} after=${after})`)
      .toBeGreaterThan(before);
  });

  test('marking attendance twice does not pay twice (idempotent)', async ({ request }) => {
    const twice = await scoreOf(request, T.studentPro);
    ok(await body(await as(request, T.admin).patch(`${ADMIN}/bookings/${enrollmentId}`, {
      attended: true,
    })), 're-mark attended');
    const after = await scoreOf(request, T.studentPro);
    expect(after, 'the same attendance was paid twice').toBe(twice);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Admin SUSPENDS an achiever → they stop being bookable and their slots stop
// being advertised. Reinstating puts both back.
//
// Rewritten 2026-09-06. This block used to flip `is_verified` and assert that
// an "un-verified" achiever advertised no slots. It had been passing vacuously
// and then failing outright, because **verification is not the gate any more**:
// `sp_achiever_booking_eligibility` keys on `is_active` and `state`, and the
// only states that can be booked are `active` and `probation`. Setting
// is_verified=0 correctly changes nothing, so the assertion was testing a rule
// the product no longer has.
//
// What replaced it is the more valuable assertion anyway: staying bookable is
// precisely the thing a suspension exists to stop, and slot VISIBILITY has to
// track it — otherwise a student picks a time and is refused at checkout, which
// is the defect the public slots endpoint was rewritten to remove.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('admin suspends an achiever → they stop being bookable', () => {
  const LC = `${ADMIN}/achiever-lifecycle`;
  let achieverId;

  test('find the E2E achiever, and give them a slot to advertise', async ({ request }) => {
    const j = await body(await as(request, T.achiever).get('/achievers/portal/profile'));
    achieverId = ok(j, 'achiever profile').id;
    expect(achieverId).toBeTruthy();

    const d = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);
    ok(await body(await as(request, T.achiever).post('/achiever-availability/my-slots', {
      slot_date: d, start_time: '11:00:00', end_time: '12:00:00',
    })), 'open slot');

    const s = await body(await as(request, T.studentPro)
      .get(`/achiever-availability/${achieverId}/slots`));
    expect((ok(s, 'slots').slots || []).length,
      'an active achiever should advertise slots before we suspend them')
      .toBeGreaterThan(0);
  });

  test('admin suspends the achiever', async ({ request }) => {
    // A reason is required, and rightly: suspension stops somebody earning, and
    // they cannot fix what they have not been told.
    const j = await body(await as(request, T.admin).post(`${LC}/${achieverId}/suspend`, {
      period: '1m', reason: 'E2E suspension test',
    }));
    ok(j, 'suspend achiever');
  });

  test('a suspended achiever advertises no slots to students', async ({ request }) => {
    const j = await body(await as(request, T.studentPro)
      .get(`/achiever-availability/${achieverId}/slots`));
    expect((ok(j, 'slots').slots || []).length,
      'a suspended achiever is still advertising times a student cannot book')
      .toBe(0);
  });

  test('admin reinstates the achiever', async ({ request }) => {
    const j = await body(await as(request, T.admin).post(`${LC}/${achieverId}/reinstate`, {
      reason: 'E2E reinstate after the suspension test',
    }));
    ok(j, 'reinstate achiever');
  });

  test('a reinstated achiever is bookable again', async ({ request }) => {
    // Their existing slot comes back on its own — reinstating restores the
    // state, and visibility is derived from it rather than stored per slot.
    const j = await body(await as(request, T.studentPro)
      .get(`/achiever-availability/${achieverId}/slots`));
    expect((ok(j, 'slots').slots || []).length,
      'a reinstated achiever should advertise slots again')
      .toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Admin SUSPENDS a student → that student loses access.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('admin suspends a student → the student is locked out', () => {
  let userId;
  const email = `e2e.suspend.${Date.now()}@skovo-test.local`;
  const password = 'E2ePass!234';

  test('a throwaway student registers and can log in', async ({ request }) => {
    const reg = await body(await request.post(U('/auth/register'), {
      data: { full_name: 'E2E Suspend Target', email, password },
    }));
    expect(reg.bool || reg.response?.access_token, 'register').toBeTruthy();

    const l = await login(email, password);
    expect(l.token, 'the new student can log in before suspension').toBeTruthy();
  });

  test('admin finds the student', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/users`, { search: email, per_page: 50 }));
    const list = ok(j, 'admin users').users || ok(j, 'x').data || [];
    const row = list.find((u) => u.email === email);
    expect(row, 'the new student is not visible to admin').toBeTruthy();
    userId = row.id;
  });

  test('admin blocks the student', async ({ request }) => {
    // The API's vocabulary is active|blocked (not "suspended").
    const j = await body(await as(request, T.admin).patch(`${ADMIN}/users/${userId}/status`, {
      status: 'blocked',
    }));
    ok(j, 'block student');
  });

  // REGRESSION: an out-of-range value used to answer "500 Internal Server
  // Error" with an opaque error_id, because every route wraps its body in
  // `except Exception` and reqparse's deliberate 400 got swallowed. A caller
  // could not tell a bad request from a server fault.
  test('an invalid status value returns a clear 4xx, not an opaque 500', async ({ request }) => {
    const res = await as(request, T.admin).patch(`${ADMIN}/users/${userId}/status`, {
      status: 'not-a-real-status',
    });
    const j = await res.json();
    const msg = JSON.stringify(j);
    expect(msg, 'a validation error must not be reported as Internal Server Error')
      .not.toMatch(/Internal Server Error/i);
    expect(msg, 'the error should say what was wrong').toMatch(/status|active|blocked|400|Bad Request/i);
  });

  test('the blocked student can no longer log in', async ({ request }) => {
    const res = await request.post(U('/auth/login'), { data: { email, password } });
    const j = await res.json();
    expect(j.bool, 'a suspended student must NOT be able to log in').toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Money out: the achiever requests a payout, admin sees and actions it.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('payout: achiever requests → admin sees it', () => {
  let requestId, requestCreated = false;

  test('achiever saves payout details', async ({ request }) => {
    const j = await body(await as(request, T.achiever).put('/achiever-payouts/details', {
      payout_account_name: 'E2E Achiever',
      payout_account_number: '000111222333',
      payout_ifsc: 'HDFC0000001',
      payout_upi: 'e2e@upi',
    }));
    ok(j, 'save payout details');
  });

  test('achiever requests a payout', async ({ request }) => {
    const j = await body(await as(request, T.achiever).post('/achiever-payouts/request', {
      amount: 100, method: 'upi', note: 'E2E payout request',
    }));
    // A payout may legitimately be refused for insufficient balance — that is
    // a valid business outcome, so accept either, but never a crash.
    if (!j.bool) {
      // No earnings yet is a legitimate refusal — but it must be a clear
      // business message, never a crash or an opaque 500.
      expect(String(j.response?.message || ''), 'payout refusal must be a clear business message')
        .toMatch(/balance|amount|minimum|insufficient|earning|no /i);
      requestCreated = false;
      return;
    }
    requestCreated = true;
    requestId = j.response?.id || j.response?.request_id;
  });

  test('the ADMIN payout queue is reachable and reflects the request', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/payouts`, { per_page: 200 }));
    const r = ok(j, 'admin payouts');           // the queue itself must work
    const list = r.payouts || r.requests || r.data || [];
    if (requestCreated) {
      expect(list.length, "the achiever's payout request never reached admin").toBeGreaterThan(0);
    }
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Skovo Pro subscription: a free student upgrades, and it must be reflected
// in their own account and in the staff portals.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('Skovo Pro: student subscribes → reflected for staff', () => {
  let planKey, orderId;

  test('plans are DB-driven and available', async ({ request }) => {
    const j = await body(await as(request, T.studentFree).get('/subscription/'));
    const r = ok(j, 'list plans');
    const plans = r.plans || [];
    expect(plans.length, 'no subscription plans configured').toBeGreaterThan(0);
    planKey = plans[0].plan_key || plans[0].key;
    expect(planKey).toBeTruthy();
  });

  test('step 1: subscribing starts a Cashfree checkout', async ({ request }) => {
    // Cashfree, not Razorpay. The gateway moved and this test did not, so it
    // read `razorpay_order_id` off a response that has not carried one for
    // some time. What the route returns now is an `order_id` plus the
    // `payment_session_id` the client hands to Cashfree's SDK.
    // `phone` is sent the way a real client sends it. Cashfree requires a mobile
    // number and a SKOVO account may not carry one, so the route answers
    // `need_phone` — which is what the next test covers deliberately.
    const res = await as(request, T.studentFree)
      .post('/subscription/subscribe', { plan: planKey, phone: '9876543210' });
    const j = await body(res);
    const r = j.response || {};

    if (j.bool) {
      orderId = r.order_id;
      expect(orderId, `no order in ${JSON.stringify(r).slice(0, 250)}`).toBeTruthy();
      expect(r.payment_session_id, 'no Cashfree payment session for the client').toBeTruthy();
      return;
    }
    // Or the gateway refused, which is the documented state of this account:
    // Cashfree answers "transactions are not enabled for your payment gateway
    // account" until KYC is done (CLAUDE.md §4). Asserting a completed payment
    // would be asserting something nobody can make true here.
    expect(String(r.message || ''),
      `subscribe failed for an unexpected reason: ${JSON.stringify(r).slice(0, 250)}`)
      .toMatch(/payment|gateway|transactions are not enabled/i);
  });

  test('a student with no phone is told so, in a way a screen can act on', async ({ request }) => {
    // Nothing covered this, and that is exactly why it shipped broken: the
    // Skovo Pro screen declared `needPhone`, flipped it on this refusal, and
    // never rendered a field — so the page said "Please add a mobile number to
    // continue" with nowhere to add one. Every seeded fixture had a phone, so
    // no test ever took this branch.
    //
    // The refusal has to carry the `need_phone` FLAG, not just prose: the client
    // switches on the flag to reveal the field, and a message-only refusal
    // leaves it with a string to pattern-match on.
    const j = await body(await as(request, T.studentFree)
      .post('/subscription/subscribe', { plan: planKey }));
    expect(j.bool, 'checkout should refuse without a phone number').toBeFalsy();
    const r = j.response || {};
    expect(r.need_phone,
      'the refusal carries no need_phone flag, so the screen cannot know to show '
      + 'the field and the user is left at a dead end').toBeTruthy();
    expect(String(r.message || ''), 'the refusal says nothing useful')
      .toMatch(/mobile|phone/i);
  });

  test('a forged order reference does not grant Pro', async ({ request }) => {
    // The signature-forgery case, rewritten for the gateway actually in use.
    // Cashfree's outcome is confirmed server-side by polling the order and by
    // the webhook — never by anything the client sends — so the test is that
    // an invented order reference cannot talk a membership into existence.
    await body(await as(request, T.studentFree).post('/subscription/subscribe', {
      plan: planKey,
      order_id: `forged_${stamp()}`,
      payment_session_id: 'session_that_never_existed',
    }));

    const me = await body(await as(request, T.studentFree).get('/subscription/'));
    const sub = (me.response || {});
    const active = sub.is_pro || sub.active || sub.subscription?.status === 'active';
    expect(active, 'a forged order reference granted a Skovo Pro membership').toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Super-admin WRITES: blocking an admin must actually revoke their access.
// (Admins are created through the invite flow, not by POSTing /admins — the
// super-admin endpoint exposes GET plus PATCH for status.)
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('super-admin suspends an admin → that admin loses access', () => {
  let targetId, targetEmail;
  const PASSWORD = 'E2ePass!234';

  test('super-admin can list admins', async ({ request }) => {
    const j = await body(await as(request, T.super).get(`${SUPER}/admins`, { per_page: 200 }));
    const list = ok(j, 'super admins list').admins || ok(j, 'x').data || [];
    expect(list.length, 'super-admin sees no admins').toBeGreaterThan(0);

    // ONLY the disposable seeded target. This used to be "any admin that is not
    // the E2E founder", which on an environment whose .env points at production
    // means a real person: the test set a colleague's account to `blocked` and
    // relied on a later step to put it back, so any failure or interruption
    // between the two left them locked out of the portal.
    //
    // Blocking is a destructive act on someone's access, so it gets a throwaway
    // account of its own (seed_test_accounts.py: _upsert_block_target) and this
    // refuses to reach for anything else.
    const TARGET = 'e2e.blocktarget@skovo-test.local';
    const target = list.find((a) => a.email === TARGET);
    test.skip(!target, `${TARGET} is missing — run seed_test_accounts.py`);
    targetId = target.id;
    targetEmail = target.email;
  });

  test('super-admin suspends that admin', async ({ request }) => {
    // POST /admins/<id>/state, not PATCH /admins/<id>. The owner endpoint
    // exposes GET plus a single state action — approve | reject | suspend —
    // each of which requires a reason, because the admin reads it. The old
    // PATCH with `{status:'blocked'}` was from a shape that no longer exists.
    const j = await body(await as(request, T.super)
      .post(`${SUPER}/admins/${targetId}/state`, {
        decision: 'suspend', reason: 'E2E suspension test',
      }));
    ok(j, 'super suspends admin');
  });

  test('the suspension is reflected back in the super-admin list', async ({ request }) => {
    const j = await body(await as(request, T.super).get(`${SUPER}/admins`, { per_page: 200 }));
    const list = ok(j, 'super admins list').admins || [];
    const row = list.find((a) => a.id === targetId);
    expect(row, 'the suspended admin vanished from the list').toBeTruthy();
    // `state` is the real approval gate — _install_admin_approval_gate reads
    // admins.state, not admins.status — so that is what must have moved.
    expect(String(row.state || row.status), 'the admin is not shown as suspended')
      .toMatch(/suspend|block/i);
  });

  test('a suspended admin cannot log into the admin portal', async ({ request }) => {
    const res = await request.post(U(`${ADMIN}/login`), {
      data: { email: targetEmail, password: PASSWORD },
    });
    const j = await res.json();
    const token = j.access_token || j.response?.access_token;
    expect(token, 'a suspended admin must NOT receive a token').toBeFalsy();
  });

  test('super-admin restores the admin', async ({ request }) => {
    const j = await body(await as(request, T.super)
      .post(`${SUPER}/admins/${targetId}/state`, {
        decision: 'approve', reason: 'E2E restore after the suspension test',
      }));
    ok(j, 'super restores admin');
  });
});

// ══════════════════════════════════════════════════════════════════════════
// Staff onboarding: an admin invites a colleague, and the invite is real.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('admin invites a colleague → the invite is issued', () => {
  const email = `e2e.invitee.${Date.now()}@skovo-test.local`;

  test('admin issues an invite', async ({ request }) => {
    const j = await body(await as(request, T.admin).post(`${ADMIN}/invites`, {
      email, role_code: 'admin', message: 'E2E invite',
    }));
    ok(j, 'create invite');
  });

  test('the invite appears in the admin invite list', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/invites`, { per_page: 200 }));
    const list = ok(j, 'invite list').invites || ok(j, 'x').data || [];
    expect(list.some((i) => i.email === email), 'the invite was not recorded').toBeTruthy();
  });

  test('an invalid role_code is rejected with a clear error, not a 500', async ({ request }) => {
    const res = await as(request, T.admin).post(`${ADMIN}/invites`, {
      email: `e2e.bad.${Date.now()}@skovo-test.local`, role_code: 'not-a-role',
    });
    const msg = JSON.stringify(await res.json());
    expect(msg, 'a bad role_code must not surface as Internal Server Error')
      .not.toMatch(/Internal Server Error/i);
  });
});
