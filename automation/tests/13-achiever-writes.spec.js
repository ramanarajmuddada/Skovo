// Achiever write-flows — availability and coupon creation, end-to-end.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin } = require('../utils/api');

let api, token;

test.beforeAll(async () => {
  const r = await portalLogin('achiever');
  token = r.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(token, 'seeded achiever should log in').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

test('Availability: create a weekly slot and read it back', async () => {
  const res = await api.post(U('/achiever-availability/my-availability'), {
    data: { day_of_week: 6, start_time: '10:00', end_time: '12:00' },
  });
  // 200/201 on create; the exact code varies, so accept either and then verify.
  expect([200, 201]).toContain(res.status());

  const list = await resp(await api.get(U('/achiever-availability/my-availability')));
  const rows = list.availability || list.slots || list.data || [];
  expect(Array.isArray(rows) ? rows.length : 0, 'availability listed').toBeGreaterThan(0);
});

test('Coupons: create a coupon and see it in the list', async () => {
  const code = `E2E${Date.now().toString().slice(-6)}`;
  const res = await api.post(U('/achievers/portal/coupons'), {
    data: { code, discount_type: 'percent', value: 20, min_amount: 0 },
  });
  expect(res.status(), 'coupon create').toBe(200);

  const list = await resp(await api.get(U('/achievers/portal/coupons')));
  const coupons = list.coupons || [];
  expect(coupons.some((c) => (c.code || '').toUpperCase() === code.toUpperCase()),
    'new coupon appears in the list').toBeTruthy();
});

test('Payout details endpoint is reachable', async () => {
  const res = await api.get(U('/achiever-payouts/details'));
  expect(res.status()).toBe(200);
});
