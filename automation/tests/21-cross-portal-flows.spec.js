// CROSS-PORTAL SCENARIOS.
//
// Everything else in this suite tests one portal in isolation. These tests
// follow a single piece of data all the way through the product: created in
// one portal, consumed in another. That is where integration bugs actually
// live — an admin can create a cohort and a student can list cohorts, yet the
// cohort still never reaches the student.
//
// Each describe block is serial: later steps depend on earlier ones.
const { test, expect } = require('@playwright/test');
const { API, U, cachedTokens, STUDENTS, login } = require('../utils/api');


let T = {};

test.beforeAll(async () => {
  T = cachedTokens();
  expect(T.admin, 'admin token').toBeTruthy();
  expect(T.studentPro, 'student token').toBeTruthy();
  expect(T.achiever, 'achiever token').toBeTruthy();
});

const as = (request, token) => ({
  get: (p, params) => request.get(U(p), { headers: { Authorization: `Bearer ${token}` }, params }),
  post: (p, data) => request.post(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  put: (p, data) => request.put(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  patch: (p, data) => request.patch(U(p), { headers: { Authorization: `Bearer ${token}` }, data }),
  del: (p) => request.delete(U(p), { headers: { Authorization: `Bearer ${token}` } }),
});

/** Unwrap the app envelope: HTTP is always 200, the real status is in the body. */
async function body(res) {
  const j = await res.json();
  return j;
}
const ok = (j, what) => {
  expect(j.bool, `${what} failed: ${JSON.stringify(j.response ?? j).slice(0, 400)}`).toBeTruthy();
  return j.response ?? {};
};

const ADMIN = '/skovo-platform-panel-admin';
const stamp = () => Date.now().toString().slice(-8);

// ══════════════════════════════════════════════════════════════════════════
// A cohort created in the ADMIN portal must reach the STUDENT, and once the
// student enrols, the enrolment must appear for the ACHIEVER who runs it and
// back in the ADMIN booking list.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('cohort: admin → student → achiever → admin', () => {
  let achieverId, cohortId, cohortTitle;

  test('admin can see the achiever to assign the cohort to', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 200 }));
    const list = ok(j, 'admin achievers list').achievers || ok(j, 'x').data || [];
    expect(list.length, 'there is at least one achiever').toBeGreaterThan(0);

    // The E2E achiever specifically, not `list[0]`. Later steps act with the
    // achiever TOKEN, and the ownership guard answers 404 rather than 403 so an
    // id cannot be probed — so a cohort assigned to anyone else fails with
    // "Cohort not found", which points at the cohort instead of at the fixture
    // that picked the wrong owner. Taking the first row worked only for as long
    // as the E2E achiever happened to sort first.
    const mine = list.find((a) => a.email === 'e2e.achiever@skovo-test.local');
    expect(mine, 'the E2E achiever is missing — run seed_test_accounts.py').toBeTruthy();
    achieverId = mine.id;
  });

  test('admin creates a free cohort', async ({ request }) => {
    cohortTitle = `E2E Cohort ${stamp()}`;
    const j = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
      title: cohortTitle,
      achiever_id: achieverId,
      price: '0',
      total_seats: '50',
      duration_minutes: '90',
      status: 'upcoming',
      about: 'Created by the cross-portal E2E test.',
      session_date: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    }));
    const r = ok(j, 'admin create cohort');
    cohortId = r.id || r.cohort_id || r.cohort?.id;
    expect(cohortId, `no cohort id in ${JSON.stringify(r).slice(0, 200)}`).toBeTruthy();
  });

  test('the new cohort is visible to a STUDENT', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/cohorts/', { per_page: 200, show_all: 1 }));
    const list = ok(j, 'student cohorts list').cohorts || [];
    const found = list.find((c) => c.id === cohortId);
    expect(found, `cohort ${cohortTitle} did not reach the student list`).toBeTruthy();
  });

  test('the STUDENT enrols in the cohort', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post(`/cohorts/${cohortId}/enroll`, {}));
    ok(j, 'student enrol');
  });

  // REGRESSION: enrolling used to call the legacy sp_student_readiness_recalc,
  // which overwrote the score from live COUNT queries and ignored the ledger.
  // A student at 77 (Opportunities Hub unlocked) collapsed to 5 (hub re-locked)
  // just by joining a cohort.
  test('enrolling does NOT reset the readiness score', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/readiness/score'));
    const r = ok(j, 'student score after enrolling');
    const score = Number(r.score ?? r.readiness_score ?? r.total ?? 0);
    expect(score, `score collapsed to ${score} after enrolling in a cohort`).toBeGreaterThanOrEqual(60);
  });

  test("the enrolment shows in the STUDENT's bookings", async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/bookings/', { per_page: 200 }));
    const r = ok(j, 'student bookings');
    const list = r.bookings || r.enrollments || r.data || [];
    expect(
      list.some((b) => b.cohort_id === cohortId || b.cohort?.id === cohortId || b.id === cohortId),
      'the cohort the student just enrolled in is missing from /bookings',
    ).toBeTruthy();
  });

  test('the enrolment reaches the ACHIEVER who runs the cohort', async ({ request }) => {
    const j = await body(await as(request, T.achiever).get(`/achievers/portal/cohorts/${cohortId}/enrollments`));
    const r = ok(j, 'achiever cohort enrollments');
    const list = r.enrollments || r.data || [];
    expect(list.length, 'achiever sees no enrolments for their own cohort').toBeGreaterThan(0);
  });

  test('the booking reaches the ADMIN booking list', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/bookings`, { per_page: 500 }));
    const r = ok(j, 'admin bookings');
    const list = r.bookings || r.enrollments || r.data || [];
    expect(
      list.some((b) => b.cohort_id === cohortId || b.cohort?.id === cohortId),
      'the student enrolment never appeared in the admin booking list',
    ).toBeTruthy();
  });

  test('the cohort is visible to the SUPER-ADMIN', async ({ request }) => {
    const j = await body(await as(request, T.super).get('/skovo-platform-owner/cohorts', { per_page: 500 }));
    const r = ok(j, 'super cohorts');
    const list = r.cohorts || r.data || [];
    expect(list.some((c) => c.id === cohortId), 'cohort missing from super-admin').toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A PAID cohort. Rewritten 2026-09-06: this block used to drive **Razorpay**,
// signing a fake payment with a test secret — an integration the platform does
// not use any more. It has been red ever since the move to Cashfree, which is
// worse than absent: a permanently-failing test for a gateway nobody calls
// teaches everyone to ignore the colour of the run.
//
// What can honestly be asserted on this account, and what cannot:
//
//   CAN   — a paid cohort routes into checkout rather than enrolling for free;
//           the order carries a real amount matching the price; a `free`
//           enrolment is NOT created by merely starting checkout; and a forged
//           or unknown order reference does not enrol anybody.
//   CANNOT— that a payment completes. Cashfree returns "transactions are not
//           enabled for your payment gateway account" on every order (CLAUDE.md
//           §4 — a KYC step in their dashboard, not a code path), so asserting
//           a completed purchase would be asserting something nobody can make
//           true here. The gateway's own refusal is accepted as a valid outcome
//           of step 1 and said so in the message.
//
// NOTE: Skovo Pro includes cohort enrolment ("Enrolled with Skovo Pro"), so a
// Pro student bypasses checkout entirely. The paid flow must use a FREE student.
test.describe.serial('paid cohort purchase: checkout is reached and cannot be forged', () => {
  let achieverId, cohortId, orderId;

  test('admin creates a PAID cohort', async ({ request }) => {
    const a = await body(await as(request, T.admin).get(`${ADMIN}/achievers`, { per_page: 100 }));
    achieverId = (ok(a, 'achievers').achievers || [])[0]?.id;

    const j = await body(await as(request, T.admin).post(`${ADMIN}/cohorts`, {
      title: `E2E Paid Cohort ${stamp()}`,
      achiever_id: achieverId,
      price: '499',
      total_seats: '25',
      duration_minutes: '60',
      status: 'upcoming',
      session_date: new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 19).replace('T', ' '),
    }));
    const r = ok(j, 'admin create paid cohort');
    cohortId = r.id || r.cohort_id || r.cohort?.id;
    expect(cohortId).toBeTruthy();
  });

  test('a paid cohort routes the student into checkout, not into a free seat', async ({ request }) => {
    // `phone` the way a real client sends it: Cashfree requires a mobile number
    // and a SKOVO account may not carry one, so the route answers `need_phone`.
    // That refusal is covered on its own in 22-admin-actions — it is the branch
    // the Skovo Pro screen got wrong by never rendering the field.
    const res = await as(request, T.studentFree)
      .post(`/cohorts/${cohortId}/enroll`, { phone: '9876543210' });
    const j = await body(res);
    const r = j.response || {};

    if (j.bool) {
      // The order was created. It must be a real order for the real amount —
      // and it must NOT be an enrolment.
      orderId = r.order_id;
      expect(orderId, `no order in ${JSON.stringify(r).slice(0, 250)}`).toBeTruthy();
      expect(r.payment_session_id, 'no Cashfree payment session to hand the client')
        .toBeTruthy();
      expect(Number(r.amount), 'the order amount does not match the cohort price')
        .toBe(499);
      expect(String(r.message || ''), 'a paid cohort must not report itself as enrolled')
        .not.toMatch(/enrolled/i);
      return;
    }

    // Or the gateway refused. That is the documented state of this account, and
    // the only thing under test then is that the app said so clearly rather
    // than half-enrolling the student.
    const msg = String(r.message || '');
    expect(msg, `checkout failed for an unexpected reason: ${JSON.stringify(r).slice(0, 250)}`)
      .toMatch(/payment|gateway|transactions are not enabled/i);
  });

  test('starting checkout does not enrol the student', async ({ request }) => {
    // `filled_seats` counts paid students only, and the hold is not an
    // enrolment — this is the invariant the 2026-08-30 change moved the counter
    // to protect, and an abandoned checkout is exactly the case it was for.
    const j = await body(await as(request, T.studentFree)
      .get(`/cohorts/${cohortId}`));
    const c = ok(j, 'cohort detail');
    expect(c.is_enrolled, 'an unpaid checkout enrolled the student anyway').toBeFalsy();
  });

  test('a forged order reference does not enrol anybody', async ({ request }) => {
    const j = await body(await as(request, T.studentFree).post(`/cohorts/${cohortId}/enroll`, {
      order_id: `forged_${stamp()}`,
      payment_session_id: 'session_that_never_existed',
    }));
    // Either it is refused outright, or it is treated as a fresh checkout — what
    // must never happen is a confirmed seat off the back of an invented order.
    if (j.bool) {
      expect(String((j.response || {}).message || ''),
        'a made-up order reference produced a confirmed enrolment')
        .not.toMatch(/enrolled|confirmed/i);
    }
    const detail = await body(await as(request, T.studentFree).get(`/cohorts/${cohortId}`));
    expect(ok(detail, 'cohort detail').is_enrolled,
      'a forged order reference enrolled the student').toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// An opportunity posted by ADMIN must reach STUDENTS, and a student's
// application must come back to the admin pipeline.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('opportunity: admin posts → student applies → admin pipeline', () => {
  let oppId;

  test('admin posts an opportunity', async ({ request }) => {
    const j = await body(await as(request, T.admin).post(`${ADMIN}/opportunities`, {
      title: `E2E Role ${stamp()}`,
      company: 'E2E Test Corp',
      type: 'internship',
      location: 'Remote',
      description: 'Posted by the cross-portal E2E test.',
      is_active: true,
    }));
    const r = ok(j, 'admin create opportunity');
    oppId = r.id || r.opportunity_id || r.opportunity?.id;
    expect(oppId).toBeTruthy();
  });

  test('the opportunity reaches the STUDENT list', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/opportunities/', { per_page: 200 }));
    const list = ok(j, 'student opportunities').opportunities || [];
    expect(list.some((o) => o.id === oppId), 'new opportunity never reached students').toBeTruthy();
  });

  test('the STUDENT applies', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post('/applications/', {
      opportunity_id: oppId,
      cover_note: 'Applying via the cross-portal E2E test.',
    }));
    ok(j, 'student apply');
  });

  test('the application appears in the ADMIN applicant pipeline', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/opportunities/${oppId}/applications`));
    const r = ok(j, 'admin applicant pipeline');
    const list = r.applications || r.data || [];
    expect(list.length, "the student's application never reached the admin pipeline").toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A market deal created in ADMIN must be redeemable by a STUDENT, and the
// redemption must be counted back in admin.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('market deal: admin creates → student redeems → admin counts it', () => {
  let dealId;

  test('admin creates a market deal', async ({ request }) => {
    const j = await body(await as(request, T.admin).post(`${ADMIN}/market`, {
      title: `E2E Deal ${stamp()}`,
      brand: 'E2E Brand',
      category: 'software',
      deal_url: 'https://example.com/e2e-deal',
      coupon_code: `E2E${stamp()}`,
      discount_label: '50% OFF',
      is_pro_only: false,
      is_active: true,
    }));
    const r = ok(j, 'admin create deal');
    dealId = r.id || r.deal_id || r.deal?.id;
    expect(dealId).toBeTruthy();
  });

  test('the deal reaches the STUDENT market', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).get('/market/', { per_page: 200 }));
    const list = ok(j, 'student market').deals || [];
    expect(list.some((d) => d.id === dealId), 'new deal never reached the student market').toBeTruthy();
  });

  test('the STUDENT redeems it and gets the coupon', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post(`/market/${dealId}/redeem`, {}));
    const r = ok(j, 'student redeem');
    expect(r.coupon_code || r.deal?.coupon_code, 'redeem returns the coupon code').toBeTruthy();
  });

  test('the redemption is counted in ADMIN', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/market`));
    const list = ok(j, 'admin market').deals || [];
    const row = list.find((d) => d.id === dealId);
    expect(row, 'deal missing in admin').toBeTruthy();
    expect(Number(row.clicks || 0), 'admin click count did not register the redemption').toBeGreaterThan(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// 1-ON-1 SESSION BOOKING, exact time slot.
// The achiever opens a specific slot, the student books that exact slot, and
// it must come back to the achiever's booking list at the right time — and
// nobody else may book the same slot.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('1-on-1 booking: achiever opens a slot → student is routed to checkout', () => {
  // Rewritten 2026-09-06, and the reason matters more than the change.
  //
  // This block used to book a slot end to end and assert the booking appeared
  // in the achiever portal. It cannot, on this account or any other: the seeded
  // achiever's session_rate is 500, a paid 1-on-1 opens a Cashfree order rather
  // than a session, and Cashfree answers "transactions are not enabled" until
  // KYC is done (CLAUDE.md §4). No session is created, so the achiever portal
  // correctly shows nothing — which is the app being right, not wrong.
  //
  // My first attempt was to zero the rate through the admin endpoint for the
  // duration. That silently does nothing: `session_rate` is in
  // `_ACHIEVER_FIELDS` but is NOT declared in `update_parser`, so reqparse drops
  // it, the route answers "Achiever updated." and the stored value never moves.
  // Combined with the 1-on-1 rate having been removed from the achiever's own
  // profile form on 2026-08-30, **nothing in the product can currently set an
  // achiever's session rate**. That is flagged in the change log rather than
  // patched here: whether rates should be editable, and by whom, is a product
  // decision and not one a test should make by widening a parser.
  //
  // So this asserts what is actually true and actually valuable: the slot is
  // published, a student sees it, booking it routes into checkout rather than
  // silently confirming, and an unpaid attempt creates no session for either
  // side. The free-booking path is covered by ST-07 in the pytest suite, which
  // builds its own achiever at rate 0.
  let achieverId, slotId, slotDate;

  test('the achiever is bookable, and publishes a specific slot', async ({ request }) => {
    const j = await body(await as(request, T.achiever).get('/achievers/portal/profile'));
    const p = ok(j, 'achiever profile');
    achieverId = p.id || p.achiever?.id || p.profile?.id;
    expect(achieverId, 'achiever id').toBeTruthy();

    const d = new Date(Date.now() + 5 * 864e5);
    slotDate = d.toISOString().slice(0, 10);
    const s = await body(await as(request, T.achiever).post('/achiever-availability/my-slots', {
      slot_date: slotDate, start_time: '14:00:00', end_time: '15:00:00',
    }));
    const r = ok(s, 'achiever create slot');
    slotId = r.id || r.slot_id || r.slot?.id;
    expect(slotId, `no slot id in ${JSON.stringify(r).slice(0, 200)}`).toBeTruthy();
  });

  test('the STUDENT sees that exact slot as available', async ({ request }) => {
    const j = await body(await as(request, T.studentPro)
      .get(`/achiever-availability/${achieverId}/slots`));
    const r = ok(j, 'public slots');
    const mine = (r.slots || r.data || []).find((s) => s.id === slotId);
    expect(mine, 'the slot the achiever just opened is not visible to students').toBeTruthy();
    // The times must survive the round trip exactly. They are stored UTC and
    // shown IST, and a slot that drifts by 5h30m is the defect that keeps
    // recurring in this codebase.
    expect(String(mine.start_time), 'the slot lost its exact start time').toContain('14:00');
    expect(String(mine.slot_date), 'the slot lost its exact date').toContain(slotDate);
  });

  test('booking a paid slot opens checkout rather than confirming a session',
    async ({ request }) => {
      const j = await body(await as(request, T.studentPro).post(`/achievers/${achieverId}/book`, {
        slot_id: slotId,
        topic: 'E2E cross-portal 1-on-1',
        phone: '9876543210',
      }));

      if (j.bool) {
        const r = j.response || {};
        expect(r.order_id, `no order in ${JSON.stringify(r).slice(0, 200)}`).toBeTruthy();
        expect(Number(r.amount), 'the order is for nothing').toBeGreaterThan(0);
        expect(String(r.message || ''), 'a paid booking must not report itself as confirmed')
          .not.toMatch(/confirmed|booked/i);
        return;
      }
      // Or the gateway refused, which is this account's documented state.
      expect(String((j.response || {}).message || ''),
        `booking failed for an unexpected reason: ${JSON.stringify(j.response).slice(0, 200)}`)
        .toMatch(/payment|gateway|transactions are not enabled/i);
    });

  test('an unpaid checkout creates no session for either side', async ({ request }) => {
    // The invariant. A held slot is not a booked one, and both portals have to
    // agree about that — otherwise the achiever blocks out an hour for somebody
    // who never paid, or the student believes they have a session they do not.
    const a = await body(await as(request, T.achiever).get('/achievers/portal/bookings'));
    const theirs = (ok(a, 'achiever bookings').bookings || []).filter(
      (b) => String(b.scheduled_at || '').startsWith(slotDate));
    expect(theirs, 'an unpaid checkout put a session in the achiever portal').toHaveLength(0);

    const s = await body(await as(request, T.studentPro).get('/achievers/my-sessions'));
    const mine = (ok(s, 'student sessions').sessions || []).filter(
      (x) => String(x.scheduled_at || x.slot_date || '').startsWith(slotDate));
    expect(mine, "an unpaid checkout put a session in the student's list").toHaveLength(0);
  });

  // REGRESSION: the public slots endpoint used to filter only on achiever id,
  // date and slot status — never on whether the achiever was bookable. A
  // suspended achiever still advertised open times, and the student got
  // "Achiever not found" after picking one. Slot visibility must match the
  // booking guard.
  test('slots are not advertised for an achiever who cannot be booked', async ({ request }) => {
    const fake = '00000000-0000-4000-8000-00000000dead';
    const j = await body(await as(request, T.studentPro).get(`/achiever-availability/${fake}/slots`));
    const r = ok(j, 'slots for a non-bookable achiever');
    expect((r.slots || []).length, 'a non-bookable achiever must advertise no slots').toBe(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A coupon created by an ACHIEVER must actually discount a STUDENT's checkout.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('coupon: achiever creates → student gets the discount', () => {
  let code;

  test('the ACHIEVER creates a 25% coupon', async ({ request }) => {
    code = `E2EX${stamp()}`;
    const j = await body(await as(request, T.achiever).post('/achievers/portal/coupons', {
      code,
      discount_type: 'percent',
      value: 25,
      applies_to: 'all',
      per_user_limit: 1,
    }));
    ok(j, 'achiever create coupon');
  });

  test('the STUDENT gets the discount at checkout', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post('/billing/coupons/validate', {
      code,
      amount: 1000,
      context_type: 'all',
    }));
    const r = ok(j, 'student validates the achiever coupon');
    expect(r.valid, 'the achiever coupon is not accepted for the student').toBeTruthy();
    expect(Number(r.discount), '25% of 1000').toBe(250);
    expect(Number(r.final_amount), 'final amount after the discount').toBe(750);
  });

  test('a made-up coupon code is rejected', async ({ request }) => {
    const j = await body(await as(request, T.studentPro).post('/billing/coupons/validate', {
      code: `NOPE${stamp()}`,
      amount: 1000,
      context_type: 'all',
    }));
    expect(j.bool, 'an unknown coupon must not be accepted').toBeFalsy();
  });
});

// ══════════════════════════════════════════════════════════════════════════
// A domain created by an ACHIEVER must be usable platform-wide.
// ══════════════════════════════════════════════════════════════════════════
test.describe.serial('achiever content reaches the rest of the platform', () => {
  let domainName;
  let domainId;

  test('achiever suggests a domain', async ({ request }) => {
    domainName = `E2E XPortal Domain ${stamp()}`;
    const j = await body(await as(request, T.achiever).post('/achievers/portal/domains', { name: domainName }));
    // The create response nests the row: { message, domain: { id, name } }.
    domainId = ok(j, 'achiever create domain')?.domain?.id;
  });

  // Suggestions are created inactive; admin still sees them, which is the
  // point — that list is where they get approved or rejected.
  test('the suggested domain reaches the ADMIN domain list for review', async ({ request }) => {
    const j = await body(await as(request, T.admin).get(`${ADMIN}/domains`, { per_page: 500 }));
    const list = ok(j, 'admin domains').domains || ok(j, 'x').data || [];
    expect(
      list.some((d) => (d.name || '').trim() === domainName),
      'a domain created by an achiever never reached admin',
    ).toBeTruthy();
  });

  // `domains` is shared platform taxonomy — a row left here shows up for every
  // achiever, and one more accumulates on every run. Removable because this
  // suite created it and nothing uses it.
  test.afterAll(async ({ request }) => {
    if (!domainId) return;
    await as(request, T.achiever).del(`/achievers/portal/domains/${domainId}`);
  });
});
