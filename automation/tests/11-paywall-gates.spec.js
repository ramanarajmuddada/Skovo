// Paywall & score gates — the v1 monetization boundaries, verified as the
// seeded FREE student (score 0, no Pro).
const { test, expect } = require('@playwright/test');
const { U, studentContext } = require('../utils/api');

let api, token;

test.beforeAll(async () => {
  const s = await studentContext('free');
  api = s.api; token = s.token;
  expect(token, 'seeded free student should log in').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

const status = async (res) => (await res.json().catch(() => ({}))).status;
const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

test('free student below score 60 sees the hub as locked', async () => {
  const r = await resp(await api.get(U('/opportunities/')));
  expect(r.hub_gate?.locked, 'hub should be locked for a low score').toBe(true);
  expect(r.hub_gate?.required_score).toBe(60);
});

test('free student below the score gate cannot shortlist', async () => {
  const opps = (await resp(await api.get(U('/opportunities/')))).opportunities || [];
  test.skip(!opps.length, 'no opportunities');
  const st = await status(await api.post(U(`/opportunities/${opps[0].id}/shortlist`), { data: {} }));
  expect(st, 'shortlist blocked below the gate').toBe(403);
});

test('free student cannot apply (score + Pro gate)', async () => {
  const opps = (await resp(await api.get(U('/opportunities/')))).opportunities || [];
  test.skip(!opps.length, 'no opportunities');
  const st = await status(await api.post(U('/applications/'), { data: { opportunity_id: opps[0].id } }));
  expect(st, 'apply blocked for free/low-score user').toBe(403);
});

test('free student cannot send a direct message (Pro feature)', async () => {
  // Any user id works — the Pro gate is checked before the shared-community rule.
  const res = await api.post(U('/assemble/dm/some-other-user'), { data: { body: 'hi' } });
  const r = await resp(res);
  expect(await status(res)).toBe(403);
  expect(r.requires_pro, 'DM should require Pro').toBe(true);
});

test('free plan blocks joining a 4th community', async () => {
  const groups = (await resp(await api.get(U('/assemble/groups')))).groups || [];
  const e2e = groups.filter((g) => g.name?.startsWith('E2E Community'));
  test.skip(e2e.length < 4, 'need 4 seeded communities');

  // Join the first three (idempotent), then the 4th must be refused.
  for (let i = 0; i < 3; i++) {
    await api.post(U(`/assemble/groups/${e2e[i].id}/join`), { data: {} });
  }
  const res = await api.post(U(`/assemble/groups/${e2e[3].id}/join`), { data: {} });
  const r = await resp(res);
  // 403 with requires_pro is the contract; if the free student already had
  // memberships from a prior run they may be at the cap already — still 403.
  expect(await status(res), `4th join: ${JSON.stringify(r).slice(0, 120)}`).toBe(403);
  expect(r.requires_pro).toBe(true);
});

test('free student is blocked from a Pro-only market deal', async () => {
  const deals = (await resp(await api.get(U('/market/')))).deals || [];
  const proDeal = deals.find((d) => d.title === 'E2E Pro Deal');
  test.skip(!proDeal, 'no pro-only deal seeded');
  // Locked in the list, and redeem is refused.
  expect(proDeal.locked, 'pro-only deal shows locked to free user').toBe(true);
  const st = await status(await api.post(U(`/market/${proDeal.id}/redeem`), { data: {} }));
  expect(st).toBe(403);
});

test('free plan caps the document vault at 5', async () => {
  const meta = await resp(await api.get(U('/document-vault/')));
  expect(meta.is_pro).toBe(false);
  expect(meta.limit, 'free tier limit is 5').toBe(5);
});
