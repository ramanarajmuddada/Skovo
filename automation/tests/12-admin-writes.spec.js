// Admin write-flows — the CRUD the admin panels perform, end-to-end.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin } = require('../utils/api');

let api, token;
const P = '/skovo-platform-panel-admin';

test.beforeAll(async () => {
  const r = await portalLogin('admin');
  token = r.token;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(token, 'seeded admin should log in').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

test('Market deal: create → edit → delete', async () => {
  // App convention: HTTP is always 200; the real status is in the body.
  let res = await api.post(U(`${P}/market`), {
    data: { title: 'E2E Admin Deal', deal_url: 'https://e2e.test/x', category: 'software',
            commission_rate: 12.5, is_featured: true },
  });
  expect(res.status()).toBe(200);
  let json = await res.json();
  expect(json.bool, 'create succeeded').toBeTruthy();
  const deal = json.response.deal;
  expect(deal.id).toBeTruthy();
  expect(deal.commission_rate).toBe(12.5);

  res = await api.put(U(`${P}/market/${deal.id}`), {
    data: { title: 'E2E Admin Deal (edited)', deal_url: 'https://e2e.test/x', category: 'software' },
  });
  expect((await resp(res)).deal.title).toContain('edited');

  res = await api.delete(U(`${P}/market/${deal.id}`));
  expect(res.status()).toBe(200);
});

test('Employers stays removed', async () => {
  // Inverted on 2026-09-06. This used to create and edit an employer, and had
  // been failing ever since the screen was deleted on 2026-08-30 — a red test
  // asserting a feature the product deliberately dropped, which reads as a
  // regression to anyone scanning the run and is worse than no test at all.
  //
  // The useful assertion is the opposite one: the endpoint must stay gone. An
  // admin screen that comes back by accident is a real thing to catch, and this
  // is now the only thing watching for it.
  const res = await api.post(U(`${P}/employers`), {
    data: { name: 'E2E Employer', contact_name: 'Riya', contact_email: 'r@e2e.test' },
  });
  expect([404, 405], `POST ${P}/employers answered ${res.status()} — the Employers `
    + 'screen was removed on 2026-08-30 and its API should be gone with it')
    .toContain(res.status());
});

test('Score rule: retune points + cap, then restore', async () => {
  let res = await api.put(U(`${P}/score-rules`), {
    data: { event_type: 'document_uploaded', points: 3, cap_type: 'lifetime', cap_value: 6, is_active: true },
  });
  expect((await resp(res)).rule.points).toBe(3);

  // restore the shipped default
  res = await api.put(U(`${P}/score-rules`), {
    data: { event_type: 'document_uploaded', points: 2, cap_type: 'lifetime', cap_value: 5, is_active: true },
  });
  expect((await resp(res)).rule.points).toBe(2);
});

test('Manual score adjustment requires a reason and is audited', async () => {
  // needs a target user — use the seeded pro student's id via /users
  const users = (await resp(await api.get(U(`${P}/users`)))).users
             || (await resp(await api.get(U(`${P}/users`)))).data || [];
  const target = users.find((u) => (u.email || '').includes('e2e.pro')) || users[0];
  test.skip(!target, 'no target user for adjustment');

  // no reason → rejected
  let res = await api.post(U(`${P}/score-rules/adjust`), {
    data: { user_id: target.id, delta: 5 },
  });
  expect((await res.json()).status).toBe(400);

  // with reason → applied
  res = await api.post(U(`${P}/score-rules/adjust`), {
    data: { user_id: target.id, delta: 3, reason: 'E2E goodwill adjustment' },
  });
  expect(res.status()).toBe(200);

  // shows up in the audit log
  const log = (await resp(await api.get(U(`${P}/score-rules/adjust?user_id=${target.id}`)))).adjustments || [];
  expect(log.some((a) => /E2E goodwill/.test(a.reason))).toBeTruthy();
});

test('Subscription plan: update price and read it back', async () => {
  const before = (await resp(await api.get(U(`${P}/subscriptions`)))).plans || [];
  test.skip(!before.length, 'no plans configured');
  const plan = before[0];

  const res = await api.put(U(`${P}/subscriptions`), {
    data: { key: plan.key, price: plan.price, is_active: true },
  });
  expect(res.status()).toBe(200);
  const after = (await resp(res)).plans || [];
  expect(after.length).toBeGreaterThan(0);
});

test('DM report moderation: an open report can be actioned', async () => {
  const reports = (await resp(await api.get(U(`${P}/dm-reports?status=open`)))).reports || [];
  test.skip(!reports.length, 'no open reports to action');
  const res = await api.patch(U(`${P}/dm-reports/${reports[0].id}`), { data: { status: 'dismissed' } });
  expect(res.status()).toBe(200);
});

test('Team & Roles stays removed', async () => {
  // Same inversion as Employers above. `admin_role` was never written to the
  // JWT, so the permission map this used to read enforced nothing anywhere —
  // the whole system was decorative and was removed on 2026-08-30 rather than
  // left to look like access control. `helpers/admin_auth.py` now just checks
  // `role == 'admin'`.
  const res = await api.get(U(`${P}/team`));
  expect([404, 405], `GET ${P}/team answered ${res.status()} — Team & Roles was `
    + 'removed on 2026-08-30 and its API should be gone with it')
    .toContain(res.status());
});
