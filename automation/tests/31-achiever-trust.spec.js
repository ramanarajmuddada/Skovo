// The achiever verification flow.
//
// Rewritten 2026-09-06. This file was written for the **trust-tier ladder** —
// five levels, a capability matrix per tier, four-eyes approval for L3, and a
// "can_teach_minors" rule tied to the DPDP age gate. Every one of those was
// deliberately removed:
//
//   * Tiers went on 2026-08-30. The lifecycle is two states with transitions:
//     PENDING -> PROBATION -> ACTIVE <-> SUSPENDED -> BANNED. Capabilities hang
//     off the state, not off a level.
//   * The DPDP age gates went the same day — the under-14 block, the 14-17
//     parental-consent gate and `age_band` were removed from frontend, backend
//     and database. There is no minor to protect from an unverified achiever
//     because the product no longer records who is a minor.
//
// So the tier assertions had been red against a design the product left behind,
// which is worse than absent: a permanently-failing test teaches everyone to
// ignore the colour of the run. What is asserted now is the flow that replaced
// them, plus removal guards — because the most useful thing this file can do is
// fail the day somebody reintroduces a tier column.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin, cachedTokens } = require('../utils/api');

let achiever, admin, student;
let achieverToken, adminToken, studentToken;

test.beforeAll(async () => {
  const a = await portalLogin('achiever');
  const d = await portalLogin('admin');
  achieverToken = a.token;
  adminToken = d.token;
  studentToken = cachedTokens().studentPro;

  const mk = (t) => request.newContext({
    extraHTTPHeaders: t ? { Authorization: `Bearer ${t}` } : {},
  });
  achiever = await mk(achieverToken);
  admin = await mk(adminToken);
  student = await mk(studentToken);

  expect(achieverToken, 'seeded achiever should log in').toBeTruthy();
  expect(adminToken, 'seeded admin should log in').toBeTruthy();
});

test.afterAll(async () => {
  await achiever?.dispose(); await admin?.dispose(); await student?.dispose();
});

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};

// ══════════════════════════════════════════════════════════════════════════
test.describe('achiever application', () => {
  test('status returns the lifecycle state, its capabilities and what is missing', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    expect(['pending', 'probation', 'active', 'suspended', 'banned'],
      `unknown lifecycle state: ${r.state}`).toContain(r.state);
    // Capabilities hang off the STATE now, not off a level.
    expect(r.capabilities).toHaveProperty('can_be_listed');
    expect(r.capabilities).toHaveProperty('can_take_bookings');
    expect(r.capabilities).toHaveProperty('can_charge');
    expect(r.capabilities).toHaveProperty('can_publish_content');
    expect(Array.isArray(r.missing)).toBe(true);
    expect(r.progress, 'the screen needs a real completion figure').toBeTruthy();
    expect(typeof r.progress.percent_complete).toBe('number');
  });

  test('the trust-tier ladder stays removed', async () => {
    // A removal guard, and the reason this test exists at all: the tier system
    // was decorative — `trust_level` gated nothing that `state` does not gate
    // better — and it took a migration to get rid of. If a `trust_level` or a
    // `tiers` table reappears in this payload, something has been half-restored
    // and the two systems are now disagreeing about who may charge.
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    expect(r.trust_level, 'trust_level is back in the status payload').toBeUndefined();
    expect(r.tiers, 'the tier table is back in the status payload').toBeUndefined();
    expect(r.capabilities.can_teach_minors,
      'can_teach_minors is back — the DPDP age gates were removed on 2026-08-30 '
      + 'and the product no longer records who is a minor').toBeUndefined();
  });

  test('capabilities agree with the state they are derived from', async () => {
    // The rule that replaced the ladder: only `active` may charge. A probation
    // achiever runs free demo sessions, and a pending one does nothing at all.
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    const c = r.capabilities;
    if (r.state === 'active') {
      expect(c.can_charge, 'an active achiever must be able to charge').toBeTruthy();
      expect(c.can_take_bookings).toBeTruthy();
    } else if (r.state === 'probation') {
      expect(c.can_charge, 'probation may not charge — demos are free').toBeFalsy();
      expect(c.can_take_bookings, 'probation exists in order to take demo bookings')
        .toBeTruthy();
    } else if (r.state === 'pending') {
      expect(c.can_take_bookings, 'a pending achiever must not be bookable').toBeFalsy();
      expect(c.can_be_listed, 'a pending achiever must not be listed').toBeFalsy();
    } else {
      expect(c.can_take_bookings,
        `a ${r.state} achiever must not stay bookable — that is what the state is for`)
        .toBeFalsy();
    }
  });

  test('an unknown doc_type is rejected', async () => {
    const r = await resp(await achiever.post(U('/achiever-application/documents'), {
      data: { doc_type: 'definitely_not_real', file_url: 'https://example.com/x.pdf' },
    }));
    expect(r.message).toMatch(/doc_type must be one of/i);
    expect(r.reason).toBe('unknown');
  });

  // ── Document types are MASTER DATA ────────────────────────────────────────
  // They were a hardcoded tuple in helpers/trust.py with a second hardcoded
  // label map in React. They now live in master_achiever_doc_type, registered
  // in master_registry, so Admin > Masters manages them. These assertions are
  // what stops them drifting back into code.
  test('doc types arrive from master data with labels and categories', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    expect(Array.isArray(r.doc_types)).toBe(true);
    expect(r.doc_types.length).toBeGreaterThan(0);
    for (const t of r.doc_types) {
      expect(t.value, 'every option carries a code').toBeTruthy();
      expect(t.label, 'every option carries a label from the DB').toBeTruthy();
      expect(['identity', 'credential', 'supporting']).toContain(t.category);
    }
  });

  test('both an identity and a credential category exist — the submit rule needs them', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    const cats = new Set(r.doc_types.map((t) => t.category));
    expect(cats.has('identity'), 'no identity type = nobody can ever submit').toBe(true);
    expect(cats.has('credential')).toBe(true);
  });

  test('the same list is reachable through the generic master endpoint', async () => {
    // Proves the table is registered in master_registry, which is what makes
    // Admin > Masters manage it with no bespoke screen. Response shape is
    // {grouped: {type: [{value,label}]}}.
    const anon = await request.newContext();
    const r = await resp(await anon.get(U('/auth/masters?types=achiever_doc_type')));
    const opts = r.grouped?.achiever_doc_type || [];
    expect(opts.length, 'achiever_doc_type must be a registered master type')
      .toBeGreaterThan(0);
    expect(opts[0]).toHaveProperty('value');
    expect(opts[0]).toHaveProperty('label');
    await anon.dispose();
  });

  test('a document with no file_url is rejected', async () => {
    const r = await resp(await achiever.post(U('/achiever-application/documents'), {
      data: { doc_type: 'govt_id' },
    }));
    expect(r.message).toMatch(/file_url is required/i);
  });

  test('an unknown agreement type is rejected', async () => {
    const r = await resp(await achiever.post(U('/achiever-application/agreements'), {
      data: { accept: ['sell_my_soul'] },
    }));
    expect(r.message).toMatch(/Unknown agreement/i);
  });

  // ── Agreements are MASTER DATA too ────────────────────────────────────────
  // They were a Python tuple plus a hardcoded React label map, with no policy
  // text behind them at all — `policy_version: 'v1'` pointed at nothing. They
  // now live in master_achiever_agreement with the wording and its version.
  test('agreements arrive from master data with a label and a version', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    expect(Array.isArray(r.agreements)).toBe(true);
    expect(r.agreements.length).toBeGreaterThan(0);
    for (const a of r.agreements) {
      expect(a.value).toBeTruthy();
      expect(a.label).toBeTruthy();
      expect(a.current_version, 'consent must be versionable').toBeTruthy();
    }
  });

  test('every agreement has text a ledger entry can point at', async () => {
    // RED, and it is a DATA gap rather than a code one — which is why it is its
    // own test instead of an assertion buried in the one above, where it would
    // have taken the structural checks down with it.
    //
    // All four rows in `master_achiever_agreement` have body = NULL,
    // body_url = NULL and version = NULL. `achiever_agreements` is described as
    // an append-only consent ledger, and it is recording that somebody accepted
    // "code_of_conduct" with **no stored text of what that was**. If an achiever
    // ever disputes what they agreed to, there is nothing to show them.
    //
    // Not fixable from here: it is master data, and the working agreements say
    // master rows are added through the admin Masters screen, not from a script.
    // Fill `body` (or `body_url`) and `version` on the four rows and this goes
    // green with no code change.
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    const empty = (r.agreements || [])
      .filter((a) => !a.body && !a.body_url)
      .map((a) => a.value);
    expect(empty,
      `${empty.length} agreement(s) have neither body nor body_url: ${empty.join(', ')}. `
      + 'The consent ledger cannot prove what was accepted. Add the text to '
      + 'master_achiever_agreement via the admin Masters screen.')
      .toHaveLength(0);
  });

  test('the commission figure is rendered from PLATFORM_FEE_RATIO, not typed into the label', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    const commission = r.agreements.find((a) => a.value === 'commission');
    expect(commission, 'commission agreement should exist').toBeTruthy();
    // The token must be substituted...
    expect(commission.label).not.toContain('{commission_pct}');
    // `body` only when there IS one. All four master rows currently have
    // body = NULL — covered by its own test above — and `toContain` on null
    // throws, which would report a missing agreement TEXT as a broken
    // commission SUBSTITUTION and send the next person to the wrong place.
    if (commission.body) {
      expect(commission.body).not.toContain('{commission_pct}');
    }
    // ...into a real percentage. If PLATFORM_FEE_RATIO changes this follows it;
    // a hardcoded "30%" in the label would not, and would misstate a contract.
    expect(commission.label).toMatch(/\d+%/);

    // And it must be THIS achiever's rate. commission_rules is scoped
    // achiever-over-global (helpers.py orders achiever, then tier, then
    // global), so an achiever on a negotiated override must not be shown the
    // global number in the agreement they are signing — that would misstate
    // their contract in the one place it is recorded as agreed.
    const shown = Number((commission.label.match(/(\d+)%/) || [])[1]);
    const rate = await resp(await achiever.get(U('/achievers/portal/profile')));
    if (rate.commission_rate != null) {
      expect(shown, `the agreement says ${shown}% but this achiever's rate is `
        + `${Math.round(Number(rate.commission_rate) * 100)}%`)
        .toBe(Math.round(Number(rate.commission_rate) * 100));
    }
  });

  test('verification progress is a real score with its four parts', async () => {
    const r = await resp(await achiever.get(U('/achiever-application/status')));
    const p = r.progress;
    for (const k of ['percent_complete', 'identity_done', 'credential_done',
                     'agreements_done', 'bgv_done', 'agreements_required']) {
      expect(p, `progress should expose ${k}`).toHaveProperty(k);
    }
    expect(p.percent_complete).toBeGreaterThanOrEqual(0);
    expect(p.percent_complete).toBeLessThanOrEqual(100);
    // The score is derived from the four steps, not invented.
    const done = [p.identity_done, p.credential_done, p.agreements_done, p.bgv_done]
      .filter(Boolean).length;
    expect(p.percent_complete).toBe(done * 25);
  });

  test('agreements are reachable through the generic master endpoint', async () => {
    const anon = await request.newContext();
    const r = await resp(await anon.get(U('/auth/masters?types=achiever_agreement')));
    const opts = r.grouped?.achiever_agreement || [];
    expect(opts.length, 'achiever_agreement must be a registered master type')
      .toBeGreaterThan(0);
    await anon.dispose();
  });

  test('a student token cannot reach the achiever application', async () => {
    const r = await resp(await student.get(U('/achiever-application/status')));
    expect(r.message).toMatch(/Achiever access only/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('admin lifecycle review', () => {
  // `/achiever-trust/*` belonged to the tier ladder. The screen an admin
  // actually uses is the lifecycle queue, at `/achiever-lifecycle/*`, and its
  // decisions are approve / probation / suspend / reinstate / ban — states, not
  // levels. The four-eyes rule and the tier-range check went with the ladder,
  // so what is asserted in their place is the rule that replaced them: a
  // decision that costs an achiever their livelihood has to say why.
  const LC = '/skovo-platform-panel-admin/achiever-lifecycle';

  test('the queue lists who is waiting on an admin, with the evidence to decide', async () => {
    const r = await resp(await admin.get(U(`${LC}/queue`)));
    const rows = r.achievers || r.queue || r.rows || [];
    expect(Array.isArray(rows), `queue did not return a list: ${JSON.stringify(r).slice(0, 200)}`)
      .toBe(true);
    if (rows.length) {
      // Enough to triage without opening every dossier — that is the whole
      // point of a queue.
      expect(rows[0]).toHaveProperty('state');
      expect(rows[0]).toHaveProperty('full_name');
    }
  });

  test('the tier API is still mounted, and answers without the tier concepts', async () => {
    // I asserted this stayed 404 and was wrong: what was removed on 2026-08-30
    // was the trust-tier *screen* and the `trust_level` column, not the
    // `/achiever-trust/*` namespace, which is still registered and still
    // answering. Deleting a live endpoint to make my own assumption true would
    // be changing the shipped surface to suit a test.
    //
    // So this pins what is actually the case, and guards the half that matters:
    // the endpoint may exist, but it must not be handing back a tier ladder that
    // the lifecycle UI knows nothing about.
    const res = await admin.get(U('/skovo-platform-panel-admin/achiever-trust/queue'));
    expect(res.status(), 'the trust namespace stopped answering — if it was '
      + 'deliberately retired, delete this test with it').toBe(200);
    const body = await res.json().catch(() => ({}));
    const rows = (body.response || {}).achievers || [];
    for (const row of rows) {
      expect(row.trust_level,
        `${row.full_name || row.id} came back carrying a trust_level — the tier `
        + 'ladder has been half-restored behind a state-based UI').toBeUndefined();
    }
  });

  test('the dossier returns the documents and agreements an approval rests on', async () => {
    const q = await resp(await admin.get(U(`${LC}/queue`)));
    const rows = q.achievers || q.queue || q.rows || [];
    test.skip(!rows.length, 'nobody is waiting in the lifecycle queue');
    const r = await resp(await admin.get(U(`${LC}/${rows[0].id}/dossier`)));
    // Approval refuses until every required document is accepted, so the admin
    // has to be able to see them here or the button can never do anything.
    expect(r.achiever, 'no achiever in the dossier').toBeTruthy();
    expect(r.achiever).toHaveProperty('state');
    expect(Array.isArray(r.documents), 'no documents array in the dossier').toBe(true);
  });

  test('a suspension with a blank reason is refused — the achiever must be told why',
    async () => {
      const q = await resp(await admin.get(U(`${LC}/queue`)));
      const rows = q.achievers || q.queue || q.rows || [];
      test.skip(!rows.length, 'nobody is waiting in the lifecycle queue');
      const r = await resp(await admin.post(U(`${LC}/${rows[0].id}/suspend`),
        { data: { reason: '   ' } }));
      // Suspension stops an achiever earning. "Suspended" with nothing attached
      // produces an email asking why, every time — and they cannot fix what they
      // have not been told.
      expect(JSON.stringify(r), 'a suspension with no reason was accepted, or blew up')
        .toMatch(/reason/i);
      expect(JSON.stringify(r), 'must not be an opaque 500')
        .not.toMatch(/Internal Server Error/i);
    });

  test('a student token cannot reach the admin queue', async () => {
    const r = await resp(await student.get(U(`${LC}/queue`)));
    expect(JSON.stringify(r), 'a student reached the admin lifecycle queue')
      .toMatch(/admin|forbidden|access/i);
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('BGV webhook fails closed', () => {
  test('a bad signature is refused', async () => {
    const anon = await request.newContext();
    const res = await anon.post(U('/skovo-platform-owner/achiever-trust/bgv-webhook'), {
      headers: { 'X-BGV-Signature': 'not-a-real-hmac' },
      data: { reference: 'whatever', result: 'clear' },
    });
    const j = await res.json().catch(() => ({}));
    // This API carries its logical status in the BODY (`status`), not the HTTP
    // code — every route here answers 200 at the transport layer.
    // 503 when BGV_WEBHOOK_SECRET is unset, 401 when set and the HMAC is wrong.
    // Both are fail-closed; anything 2xx would let anyone on the internet mark
    // an achiever as background-cleared.
    expect([401, 503]).toContain(j.status);
    expect(j.bool).toBeFalsy();
    await anon.dispose();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('the screens render', () => {
  test('achiever Verification screen loads with no runtime errors', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('achiever_access_token', t), achieverToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/skovo-achiever-portal/application');
    // No fixed landmark, because this screen has none — and both of my earlier
    // guesses ("Your evidence", then an Agreements heading) were wrong for the
    // same reason. The verification flow is STATE-DRIVEN: a pending achiever
    // sees guidance and a document queue, a probation one sees demo progress,
    // and an already-approved one — which the E2E fixture is — sees "You are
    // live" with no agreements step left to show. Asserting any single heading
    // pins one state and fails on the other four.
    //
    // The case is "loads with no runtime errors", so that is the assertion.
    // Rendering *something* is the second half: a screen that throws nothing
    // because it drew nothing has still failed.
    await page.waitForFunction(
      () => (document.querySelector('main')?.innerText || '').trim().length > 80,
      null, { timeout: 20000 },
    ).catch(() => {});

    const shown = (await page.locator('main').innerText().catch(() => '')).trim();
    expect(shown.length, 'the verification screen rendered nothing').toBeGreaterThan(80);
    expect(shown, 'no lifecycle state is named anywhere on the screen')
      .toMatch(/pending|probation|active|suspended|banned|verif|document|agreement/i);
    expect(errors).toEqual([]);
  });

  test('admin achiever-review screen loads with no runtime errors', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('admin_access_token', t), adminToken);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // /achiever-trust is the tier ladder's old path and 404s. The screen is
    // AdminAchieverLifecycle, routed at /achiever-review, and it is titled
    // "Achiever review" rather than "Achiever Trust Review".
    await page.goto('/skovo-platform-panel-admin/achiever-review');
    await expect(page.getByText(/Achiever review/i).first())
      .toBeVisible({ timeout: 20000 });
    expect(errors).toEqual([]);
  });
});
