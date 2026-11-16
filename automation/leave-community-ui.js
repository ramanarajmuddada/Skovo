/**
 * UI check for the leave-a-community fix.
 *
 * Drives the real Assemble screen: joins a community, confirms the Leave
 * control appears on the joined card, clicks it, and confirms the free-tier
 * quota meter gives the slot back. Ends with the account where it started.
 *
 * Points the SPA at the backend carrying the fix via SKOVO_API.
 */
const { chromium, request } = require('@playwright/test');

const FRONTEND = process.env.SKOVO_FRONTEND || 'http://localhost:3000';
const API = process.env.SKOVO_API || 'http://127.0.0.1:5001';
const EMAIL = 'e2e.free@skovo-test.local';
const PASSWORD = 'E2ePass!234';

let pass = 0, fail = 0;
const check = (ok, name, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

(async () => {
  const api = await request.newContext({ baseURL: API });
  const body = await (await api.post('/v1/auth/login',
    { data: { email: EMAIL, password: PASSWORD } })).json();
  const user = { ...body.response, id: body.response.user_id ?? body.response.id };

  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  await ctx.addInitScript(([t, r, u]) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('refresh_token', r || '');
    localStorage.setItem('user', JSON.stringify(u));
  }, [body.access_token, body.refresh_token, user]);

  const page = await ctx.newPage();
  // Route the SPA's /v1 calls at the instance carrying the fix.
  await page.route('**/v1/**', (route) => {
    const u = new URL(route.request().url());
    route.continue({ url: API + u.pathname + u.search });
  });

  const quotaText = async () => {
    const el = page.locator("text=/You're in .* communities|You're in all/").first();
    return (await el.count()) ? (await el.innerText()).replace(/\s+/g, ' ').trim() : '(no meter)';
  };

  await page.goto(FRONTEND + '/assemble', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main#main-content', { timeout: 20_000 });
  await page.waitForFunction(
    () => (document.querySelector('main#main-content')?.innerText || '').length > 60,
    null, { timeout: 20_000 });

  console.log('\nleave-a-community — UI verification\n');
  console.log('  quota before:', await quotaText());

  // Join the first joinable community.
  const joinBtn = page.getByRole('button', { name: /^Join$/ }).first();
  // Wait for the card grid to paint before counting — .click() auto-waits, so
  // asserting on a bare count() first was racing the render, not the product.
  await joinBtn.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => {});
  check(await joinBtn.count() > 0, 'a joinable community is on screen');
  await joinBtn.click();
  await page.waitForTimeout(2000);
  console.log('  quota after join:', await quotaText());

  // The joined card must now offer a way out.
  const leaveBtn = page.locator('button[title="Leave this community"]').first();
  check(await leaveBtn.count() > 0, 'Leave control rendered on the joined card');

  const before = await quotaText();
  await leaveBtn.click();
  await page.waitForTimeout(2000);
  const after = await quotaText();
  console.log('  quota after leave:', after);
  check(before !== after, 'quota meter gave the slot back', `${before} -> ${after}`);

  const toast = await page.locator('text=/left this community/i').count();
  check(toast > 0, 'confirmation shown to the student');

  // Rejoining must still work after leaving.
  const rejoin = page.getByRole('button', { name: /^Join$/ }).first();
  check(await rejoin.count() > 0, 'community is joinable again after leaving');

  await browser.close();
  await api.dispose();
  console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
