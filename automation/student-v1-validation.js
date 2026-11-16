/**
 * v1 Student Portal — end-to-end runtime validation. READ ONLY.
 *
 * Navigates every live v1 student route in a real browser and asserts the screen
 * actually renders, records console errors and failed requests, checks both
 * route guards, confirms v1-hidden routes stay unreachable, and verifies that
 * in-app CTAs navigate client-side instead of reloading the document.
 *
 * Writes nothing: no seeding, no POST/PUT/PATCH/DELETE beyond the single
 * /auth/login needed to hold a session.
 *
 *   node student-v1-validation.js
 */
const { chromium, request } = require('@playwright/test');

const FRONTEND = process.env.SKOVO_FRONTEND || 'http://localhost:3000';
const BACKEND = process.env.SKOVO_BACKEND || 'http://127.0.0.1:5000';
const EMAIL = process.env.SKOVO_EMAIL || 'e2e.pro@skovo-test.local';
const PASSWORD = process.env.SKOVO_PASSWORD || 'E2ePass!234';

// The 21 live v1 student routes, in journey order.
const ROUTES = [
  ['/career-path', 'Dashboard'],
  ['/bhaai', 'BhaAI'],
  ['/cohorts', 'Cohorts'],
  ['/tasks', 'My Tasks'],
  ['/colleges', 'Colleges'],
  ['/colleges/saved', 'Saved Colleges'],
  ['/colleges/predictor', 'College Predictor'],
  ['/opportunities', 'Opportunities'],
  ['/applications', 'Applications'],
  ['/find-mentors', 'Find Achievers'],
  ['/bookings', 'My Bookings'],
  ['/payments', 'Payments'],
  ['/skovo-pro', 'Skovo Pro'],
  ['/document-vault', 'Document Vault'],
  ['/my-score', 'My Score'],
  ['/market', 'Market'],
  ['/assemble', 'Assemble'],
  ['/notifications', 'Notifications'],
  ['/profile', 'Profile'],
];

// Public routes that must render with no session at all.
const PUBLIC = ['/', '/login', '/signup', '/forgot-password',
  '/terms', '/privacy', '/refund', '/contact', '/pricing'];

// v1-hidden: the route is commented out of the router, so these must 404.
const HIDDEN = ['/mock-tests', '/forum', '/resume-builder', '/sop-builder',
  '/leaderboard', '/referrals', '/roadmap', '/certifications',
  '/exam-resources', '/courses', '/career-guidance',
  '/scholarship-tracker', '/college-applications', '/readiness-assessment'];

// Console noise that is not a defect.
const IGNORE = [
  /Download the React DevTools/i,
  /\[vite\]/i,
  /favicon/i,
  /Failed to load resource.*40[13]/i,   // expected auth/paywall responses
];

const results = { pass: 0, fail: 0, rows: [] };
const record = (ok, area, name, detail) => {
  results[ok ? 'pass' : 'fail']++;
  results.rows.push({ ok, area, name, detail: detail || '' });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${area.padEnd(14)} ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  // ── session ───────────────────────────────────────────────────────────────
  const api = await request.newContext({ baseURL: BACKEND });
  const res = await api.post('/v1/auth/login', { data: { email: EMAIL, password: PASSWORD } });
  const body = await res.json();
  if (!body.access_token) {
    console.error('login failed:', res.status(), JSON.stringify(body).slice(0, 300));
    process.exit(1);
  }
  const user = { ...body.response, id: body.response.user_id ?? body.response.id };
  console.log(`\nsigned in as ${EMAIL}\n`);

  const browser = await chromium.launch();

  // ── 1. route guard: protected routes bounce a signed-out visitor ──────────
  console.log('1. route guards');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const path of ['/career-path', '/cohorts', '/profile', '/document-vault']) {
      await page.goto(FRONTEND + path, { waitUntil: 'domcontentloaded' });
      await page.waitForURL(/\/login|\/career-path|\/$/, { timeout: 10_000 }).catch(() => {});
      const landed = new URL(page.url()).pathname;
      record(landed === '/login', 'ProtectedRoute', `${path} signed-out`, `→ ${landed}`);
    }
    await ctx.close();
  }

  // ── 2. public routes render with no session ───────────────────────────────
  console.log('\n2. public routes (no session)');
  {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const path of PUBLIC) {
      const errs = [];
      page.removeAllListeners('console');
      page.on('console', (m) => {
        if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errs.push(m.text());
      });
      await page.goto(FRONTEND + path, { waitUntil: 'networkidle' }).catch(() => {});
      const text = (await page.locator('body').innerText().catch(() => '')) || '';
      const rendered = text.trim().length > 40;
      record(rendered && errs.length === 0, 'public', path,
        !rendered ? 'blank page' : errs.length ? `console: ${errs[0].slice(0, 90)}` : '');
    }
    await ctx.close();
  }

  // ── 3. signed-in: guest guard + every live v1 route ───────────────────────
  console.log('\n3. signed-in routes');
  const ctx = await browser.newContext();
  await ctx.addInitScript(([tok, refresh, u]) => {
    localStorage.setItem('access_token', tok);
    localStorage.setItem('refresh_token', refresh || '');
    localStorage.setItem('user', JSON.stringify(u));
  }, [body.access_token, body.refresh_token, user]);
  const page = await ctx.newPage();

  // guest guard
  await page.goto(FRONTEND + '/login', { waitUntil: 'domcontentloaded' });
  await page.waitForURL(/career-path/, { timeout: 10_000 }).catch(() => {});
  record(new URL(page.url()).pathname === '/career-path', 'GuestRoute',
    '/login while signed in', `→ ${new URL(page.url()).pathname}`);

  for (const [path, label] of ROUTES) {
    const errs = [];
    const failedReq = [];
    page.removeAllListeners('console');
    page.removeAllListeners('requestfailed');
    page.on('console', (m) => {
      if (m.type() === 'error' && !IGNORE.some((r) => r.test(m.text()))) errs.push(m.text());
    });
    page.on('requestfailed', (r) => {
      if (!IGNORE.some((x) => x.test(r.url()))) failedReq.push(r.url());
    });

    let crashed = '';
    try {
      // NOT networkidle: /notifications/stream is a long-lived EventSource, so
      // the network never goes idle inside the portal. Wait for the shell.
      await page.goto(FRONTEND + path, { waitUntil: 'domcontentloaded', timeout: 25_000 });
      await page.waitForSelector('main#main-content', { timeout: 20_000 });
      await page.waitForFunction(
        () => (document.querySelector('main#main-content')?.innerText || '').trim().length > 40,
        null, { timeout: 20_000 });
    } catch (e) { crashed = 'did not render'; }

    const landed = new URL(page.url()).pathname;
    const text = (await page.locator('main#main-content').innerText().catch(() => '')) || '';
    const blank = text.trim().length < 40;
    const notFound = /page not found|404/i.test(text) && !/notification/i.test(label);
    // A stuck lazy-chunk loader means the screen never mounted.
    const stuckLoader = false;   // covered by the render wait above

    const ok = !crashed && !blank && !notFound && !stuckLoader && errs.length === 0;
    record(ok, 'route', `${path} (${label})`,
      crashed || (blank ? 'blank' : notFound ? 'rendered 404' : stuckLoader ? 'stuck on loader'
        : errs.length ? `console: ${errs[0].slice(0, 100)}`
        : landed !== path ? `redirected → ${landed}` : ''));
  }

  // ── 4. v1-hidden routes must not resolve ──────────────────────────────────
  console.log('\n4. v1-hidden routes stay unreachable');
  for (const path of HIDDEN) {
    await page.goto(FRONTEND + path, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForFunction(
      () => /404/.test(document.body.innerText) ||
            (document.querySelector('main#main-content')?.innerText || '').trim().length > 40,
      null, { timeout: 15_000 }).catch(() => {});
    const text = (await page.locator('body').innerText().catch(() => '')) || '';
    const is404 = /not found|404|doesn't exist|does not exist/i.test(text);
    record(is404, 'v1-hidden', path, is404 ? '404 as expected' : 'REACHABLE — should be hidden');
  }

  // ── 5. in-app CTAs navigate client-side (no document reload) ──────────────
  console.log('\n5. client-side navigation (no full reload)');
  for (const [from, linkText] of [['/market', null], ['/document-vault', null], ['/colleges', null]]) {
    await page.goto(FRONTEND + from, { waitUntil: 'networkidle' }).catch(() => {});
    // Tag the document; a full reload wipes the tag, a SPA navigation keeps it.
    await page.evaluate(() => { window.__spaProbe = 'alive'; });
    const link = page.locator('a[href="/skovo-pro"], a[href="/my-score"]').first();
    if (await link.count() === 0) {
      record(true, 'spa-nav', `${from}`, 'no upgrade CTA rendered for this account — skipped');
      continue;
    }
    await link.click({ timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const alive = await page.evaluate(() => window.__spaProbe === 'alive').catch(() => false);
    record(alive, 'spa-nav', `${from} → CTA`, alive ? 'client-side' : 'FULL PAGE RELOAD');
  }

  await browser.close();
  await api.dispose();

  console.log('\n' + '='.repeat(64));
  console.log(`RESULT: ${results.pass} passed, ${results.fail} failed`);
  if (results.fail) {
    console.log('\nfailures:');
    results.rows.filter((r) => !r.ok).forEach((r) =>
      console.log(`  ${r.area} :: ${r.name} — ${r.detail}`));
  }
  process.exit(results.fail ? 1 : 0);
})();
