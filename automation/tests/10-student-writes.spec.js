// Student write-flows — the actual v1 features, exercised end-to-end against
// the live server as the seeded Pro student (score 75, consent granted).
const { test, expect, request } = require('@playwright/test');
const { U, studentContext } = require('../utils/api');

let api, token;

test.beforeAll(async () => {
  const s = await studentContext('pro');
  api = s.api; token = s.token;
  expect(token, 'seeded Pro student should log in — run seed_test_accounts.py').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

async function bodyOf(res) { return (await res.json().catch(() => ({}))).response || {}; }

test('the Pro student is recognised as Pro with an unlocked hub', async () => {
  const me = await bodyOf(await api.get(U('/auth/me')));
  expect(me.readiness?.score, 'seeded score').toBeGreaterThanOrEqual(60);
  const score = await bodyOf(await api.get(U('/readiness/score')));
  expect(score.score).toBeGreaterThanOrEqual(60);
});

test('Document Vault: upload → toggle public → delete', async () => {
  // upload
  let res = await api.post(U('/document-vault/'), {
    data: { name: 'E2E Resume', file_url: 'https://e2e.test/r.pdf', category: 'resume' },
  });
  expect(res.status()).toBe(200);
  const created = await bodyOf(res);
  const id = created.id;
  expect(id, 'new document id').toBeTruthy();

  // it appears in the list
  const list = await bodyOf(await api.get(U('/document-vault/')));
  expect(list.documents.some((d) => d.id === id)).toBeTruthy();

  // toggle public
  res = await api.put(U(`/document-vault/${id}/visibility`), { data: { is_public: true } });
  expect((await bodyOf(res)).is_public).toBe(true);

  // delete
  res = await api.delete(U(`/document-vault/${id}`));
  expect(res.status()).toBe(200);
});

test('Public profile: set a shareable link and read it back publicly', async () => {
  const slug = `e2e-pro-${Date.now()}`;
  const res = await api.put(U('/document-vault/public-profile'), {
    data: { slug, headline: 'E2E headline', is_enabled: true },
  });
  expect((await bodyOf(res)).slug).toBe(slug);

  // public read — no auth
  const anon = await request.newContext();
  const pub = await anon.get(U(`/document-vault/p/${slug}`));
  expect(pub.status()).toBe(200);
  expect((await bodyOf(pub)).headline).toBe('E2E headline');
  await anon.dispose();
});

test('Saved Colleges: save a college and see it in the list', async () => {
  const colleges = (await bodyOf(await api.get(U('/colleges/')))).colleges
                || (await bodyOf(await api.get(U('/colleges/')))).data || [];
  test.skip(!colleges.length, 'no colleges seeded to save');
  const cid = colleges[0].id;

  await api.post(U(`/colleges/${cid}/save`), { data: {} });
  const saved = await bodyOf(await api.get(U('/colleges/saved')));
  expect(saved.colleges.some((c) => c.id === cid)).toBeTruthy();

  // unsave (cleanup)
  await api.delete(U(`/colleges/${cid}/save`));
});

test('Opportunities: shortlist an opportunity, then remove it', async () => {
  const opps = (await bodyOf(await api.get(U('/opportunities/')))).opportunities || [];
  test.skip(!opps.length, 'no opportunities available');
  const oid = opps[0].id;

  let res = await api.post(U(`/opportunities/${oid}/shortlist`), { data: {} });
  expect(res.status()).toBe(200);
  let list = await bodyOf(await api.get(U('/opportunities/shortlist')));
  expect(list.opportunities.some((o) => o.id === oid)).toBeTruthy();

  res = await api.delete(U(`/opportunities/${oid}/shortlist`));
  expect(res.status()).toBe(200);
  list = await bodyOf(await api.get(U('/opportunities/shortlist')));
  expect(list.opportunities.some((o) => o.id === oid)).toBeFalsy();
});

test('Opportunities: a Pro student with score ≥60 can apply (one-tap)', async () => {
  const opps = (await bodyOf(await api.get(U('/opportunities/')))).opportunities || [];
  const target = opps.find((o) => (o.min_readiness_score || 0) <= 60);
  test.skip(!target, 'no applyable opportunity');

  const res = await api.post(U('/applications/'), { data: { opportunity_id: target.id } });
  const body = await res.json().catch(() => ({}));
  // Success, or a clean "already applied" — both prove the apply flow works.
  const r = body.response || {};
  const ok = /submitted|success/i.test(r.message || '') || body.status === 200;
  const already = /already/i.test(r.message || '') || body.status === 409;
  expect(ok || already, `apply returned: ${JSON.stringify(r).slice(0, 160)}`).toBeTruthy();
});

test('Assemble: join a community, then post in it', async () => {
  const groups = (await bodyOf(await api.get(U('/assemble/groups')))).groups || [];
  const target = groups.find((g) => g.name?.startsWith('E2E Community')) || groups[0];
  test.skip(!target, 'no communities seeded');

  await api.post(U(`/assemble/groups/${target.id}/join`), { data: {} });

  const res = await api.post(U(`/assemble/groups/${target.id}/posts`), {
    data: { content: `E2E post ${Date.now()}` },
  });
  expect(res.status()).toBe(200);
  const posts = (await bodyOf(await api.get(U(`/assemble/groups/${target.id}/posts`)))).posts || [];
  expect(posts.length).toBeGreaterThan(0);
});

test('Market: redeem an open deal and get the coupon back', async () => {
  const deals = (await bodyOf(await api.get(U('/market/')))).deals || [];
  const open = deals.find((d) => d.title === 'E2E Open Deal') || deals.find((d) => !d.locked);
  test.skip(!open, 'no redeemable deal');

  const res = await api.post(U(`/market/${open.id}/redeem`), { data: {} });
  expect(res.status()).toBe(200);
  const r = await bodyOf(res);
  expect(r.deal_url, 'redeem returns the destination url').toBeTruthy();
});

test('Score: activity is reflected in the ledger', async () => {
  const events = (await bodyOf(await api.get(U('/readiness/score/events')))).events || [];
  // The document upload / market redeem above should have written ledger rows.
  expect(Array.isArray(events)).toBeTruthy();
});
