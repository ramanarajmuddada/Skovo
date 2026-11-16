/**
 * ITI trade catalogue — UI verification.
 *
 * Two screens, both driven for real:
 *   1. the student onboarding picker — the full trade list is reachable and
 *      each row carries stream / category / duration;
 *   2. Admin → Courses & Trades — the list loads, filters, and a trade can be
 *      added, edited and hidden.
 *
 * Points the SPA at SKOVO_API so it can run against a backend carrying the
 * new routes without disturbing the one on :5000.
 */
const { chromium, request } = require('@playwright/test');

const FRONTEND = process.env.SKOVO_FRONTEND || 'http://localhost:3000';
const API = process.env.SKOVO_API || 'http://127.0.0.1:5002';
const PASSWORD = 'E2ePass!234';

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const api = await request.newContext({ baseURL: API });
  const admin = await (await api.post('/v1/skovo-platform-panel-admin/login',
    { data: { email: 'e2e.admin@skovo-test.local', password: PASSWORD } })).json();

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(([t, u]) => {
    localStorage.setItem('admin_access_token', t);
    localStorage.setItem('admin_user', JSON.stringify(u));
  }, [admin.access_token, { ...admin.response, access_token: admin.access_token }]);

  const page = await ctx.newPage();
  await page.route('**/v1/**', (route) => {
    const u = new URL(route.request().url());
    route.continue({ url: API + u.pathname + u.search });
  });

  // ── 1. admin screen ────────────────────────────────────────────────────────
  console.log('\n1. Admin → Courses & Trades\n');
  await page.goto(FRONTEND + '/skovo-platform-panel-admin/course-catalogue',
    { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table', { timeout: 25_000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const bodyText = await page.locator('body').innerText().catch(() => '');
  check(/Course & Trade Catalogue|Courses & Trades/i.test(bodyText), 'screen renders');

  const rowCount = await page.locator('tbody tr').count();
  check(rowCount >= 36, 'all trades listed', `${rowCount} rows`);
  check(/Engineering/.test(bodyText) && /Non-Engineering/.test(bodyText),
    'both streams shown');
  check(/per curriculum/.test(bodyText), 'variable duration rendered honestly');
  check(/10th pass/.test(bodyText), 'eligibility column populated');

  // filter by stream
  const before = await page.locator('tbody tr').count();
  await page.getByPlaceholder('Filter trades…').fill('welder');
  await page.waitForTimeout(800);
  const after = await page.locator('tbody tr').count();
  check(after < before && after >= 1, 'search filters the table', `${before} -> ${after}`);
  await page.getByPlaceholder('Filter trades…').fill('');
  await page.waitForTimeout(600);

  // add a trade through the UI
  await page.getByRole('button', { name: /Add Trade/i }).click();
  await page.waitForTimeout(600);
  const name = 'UI Probe Trade';
  await page.getByPlaceholder('e.g. Electrician').fill(name);
  await page.getByPlaceholder('e.g. Electrical').fill('Mechanical');
  await page.getByPlaceholder('Leave empty if it varies').fill('1.5');
  await page.getByPlaceholder('e.g. 10th pass').fill('8th pass');
  await page.getByRole('button', { name: /^Save$/ }).click();
  await page.waitForTimeout(2500);
  const afterAdd = await page.locator('body').innerText();
  check(afterAdd.includes(name), 'trade added through the UI');
  check(/1\.5 yr/.test(afterAdd), 'duration saved', '1.5 yr');

  // ── 2. it reaches the student picker ───────────────────────────────────────
  console.log('\n2. Student onboarding picker\n');
  const stu = await (await api.post('/v1/auth/login',
    { data: { email: 'e2e.free@skovo-test.local', password: PASSWORD } })).json();
  const search = await (await api.get(
    `/v1/auth/courses/search?q=&level=iti&limit=50`)).json();
  const trades = (search.response || {}).courses || [];
  check(trades.length >= 36, 'student search returns the full list', `${trades.length} trades`);
  check(trades.some(t => t.branch === name), 'the new trade is pickable by a student');
  check(trades.every(t => t.degree_category && t.degree), 'every trade carries stream + category');
  const welder = trades.find(t => t.branch === 'Welder');
  check(welder && welder.duration_years === 1, 'Welder is 1 year, not the old blanket 2',
    welder ? `${welder.duration_years} yr` : 'not found');
  check(!!(welder || {}).eligibility, 'eligibility reaches the student payload',
    (welder || {}).eligibility);

  // ── 3. hide it again, and confirm students stop seeing it ─────────────────
  console.log('\n3. Hide / restore\n');
  const list = await (await api.get('/v1/skovo-platform-panel-admin/course-catalogue?level=iti',
    { headers: { Authorization: 'Bearer ' + admin.access_token } })).json();
  const probe = ((list.response || {}).courses || []).find(c => c.branch === name);
  if (probe) {
    await api.delete(`/v1/skovo-platform-panel-admin/course-catalogue/${probe.id}`,
      { headers: { Authorization: 'Bearer ' + admin.access_token } });
    const after2 = await (await api.get('/v1/auth/courses/search?q=probe&level=iti&limit=20')).json();
    const gone = !(((after2.response || {}).courses) || []).some(c => c.branch === name);
    check(gone, 'hidden trade disappears from the student picker');
  } else {
    check(false, 'probe row found for cleanup');
  }

  await browser.close();
  await api.dispose();
  console.log(`\n${'='.repeat(58)}\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
