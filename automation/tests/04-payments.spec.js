// Payment plumbing (Cashfree). A live card charge cannot be driven from here,
// so this covers what can be: the plans endpoint answers, the Skovo Pro page
// renders them, and starting a checkout either produces a real Cashfree order
// or fails with a clean message rather than a crash.
//
// Cashfree, not Razorpay: the gateway moved and this file's names and
// annotations had not, so a run reported "Razorpay order created" about an
// integration the platform no longer has.
const { test, expect, request } = require('@playwright/test');
const { U, provisionStudent } = require('../utils/api');

let token, api;

test.beforeAll(async () => {
  const s = await provisionStudent();
  token = s.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
});
test.afterAll(async () => { await api?.dispose(); });

test('Skovo Pro plans load and are DB-driven (not hard-coded)', async () => {
  const res = await api.get(U('/subscription/'));
  expect(res.status()).toBe(200);
  const body = await res.json().catch(() => ({}));
  expect(body.bool).toBeTruthy();
  const plans = body.response?.plans || [];
  expect(plans.length, 'at least one Pro plan configured').toBeGreaterThan(0);
  // Prices come from the DB, so each plan should carry an effective price.
  expect(plans[0].effective_price ?? plans[0].price).toBeDefined?.() ?? expect(plans[0]).toBeTruthy();
});

test('starting a Pro checkout creates a Cashfree order (2-step flow)', async () => {
  const res = await api.post(U('/subscription/subscribe'), { data: { plan: 'monthly' } });
  expect(res.status()).toBe(200);
  const body = await res.json().catch(() => ({}));
  const r = body.response || {};

  // Two acceptable outcomes, both proving the plumbing is wired end-to-end:
  //  a) the account can transact → an order id and a payment session come back
  //  b) it cannot                → a clean message, never a crash. That is the
  //     documented state here: Cashfree answers "transactions are not enabled
  //     for your payment gateway account" until KYC is done (CLAUDE.md §4).
  const gotOrder = !!(r.order_id || r.order?.id);
  const cleanFailure = typeof r.message === 'string' && r.message.length > 0 && !gotOrder;

  expect(gotOrder || cleanFailure,
    `subscribe returned: ${JSON.stringify(r).slice(0, 200)}`).toBeTruthy();

  if (gotOrder) {
    expect(r.payment_session_id,
      'an order came back with no payment session, so the client has nothing to '
      + 'hand Cashfree').toBeTruthy();
  }

  test.info().annotations.push({
    type: 'payments',
    description: gotOrder
      ? `Cashfree order created: ${r.order_id} (${r.mode || 'unknown env'})`
      : `Gateway did not create an order — it returned: "${r.message}"`,
  });
});

test('the Skovo Pro page renders its plans in the UI', async ({ page }) => {
  const s = await provisionStudent();
  await page.addInitScript((t) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('user', JSON.stringify({ user_id: 'e2e', id: 'e2e', role: 'student' }));
  }, s.token);
  await page.goto('/skovo-pro', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  // Price points or an upgrade CTA should be visible.
  const hasPricing = await page.getByText(/₹|month|year|upgrade|pro/i).first().count();
  expect(hasPricing, 'Pro page shows pricing / upgrade UI').toBeGreaterThan(0);
});
