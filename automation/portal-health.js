/**
 * Portal health sweep — every screen in all four portals, in one pass.
 *
 * Loads each route with a real token and reports three things per screen:
 *   errors  runtime JS exceptions (a screen that throws is broken however it looks)
 *   api     /v1 responses that were not 200
 *   text    how much the page actually rendered (a blank shell scores near zero)
 *
 * Not a test — a diagnostic. The suite asserts these one screen at a time; this
 * exists to answer "are all four portals healthy" in ninety seconds, which is a
 * different question and one a failing spec list does not answer directly.
 *
 *   automation> node portal-health.js
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

const BASE = process.env.SKOVO_BASE || 'http://127.0.0.1:3000';
const {
  STUDENT_SCREENS, ADMIN, SUPER, ACHIEVER,
  ADMIN_SCREENS, SUPER_SCREENS, ACHIEVER_SCREENS,
} = require('./utils/v1-surface');

const tokens = JSON.parse(
  fs.readFileSync(path.join(__dirname, '.auth', 'tokens.json'), 'utf8'));

// [label, routes, how to authenticate that portal]
const PORTALS = [
  ['STUDENT', STUDENT_SCREENS.map(([r]) => r), (page) =>
    page.addInitScript((t) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E', email: 'e2e.pro@skovo-test.local',
        role: 'student', education_level: 'ug', education_category: 'ug',
      }));
    }, tokens.studentPro)],

  ['ACHIEVER', ACHIEVER_SCREENS.map(([r]) => ACHIEVER + r), (page) =>
    page.addInitScript((t) => {
      localStorage.setItem('achiever_access_token', t);
      localStorage.setItem('access_token', t);
      localStorage.setItem('achiever', JSON.stringify({
        id: 'e2e', full_name: 'E2E Achiever', role: 'mentor',
      }));
    }, tokens.achiever)],

  ['ADMIN', ADMIN_SCREENS.map(([r]) => ADMIN + r), (page) =>
    page.addInitScript((t) => {
      localStorage.setItem('admin_access_token', t);
      localStorage.setItem('admin_user', JSON.stringify({
        id: 'e2e', full_name: 'E2E Admin', role: 'admin',
      }));
    }, tokens.admin)],

  ['SUPER', SUPER_SCREENS.map(([r]) => SUPER + r), (page) =>
    page.addInitScript((t) => {
      localStorage.setItem('super_access_token', t);
      localStorage.setItem('super_user', JSON.stringify({
        id: 'e2e', full_name: 'E2E Super', role: 'super_admin',
      }));
    }, tokens.super)],
];

(async () => {
  const browser = await chromium.launch();
  const summary = [];

  for (const [label, routes, auth] of PORTALS) {
    const ctx = await browser.newContext({ baseURL: BASE, viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await auth(page);

    console.log(`\n${'='.repeat(64)}\n${label}  (${routes.length} screens)\n${'='.repeat(64)}`);
    let broken = 0;

    for (const route of routes) {
      const errors = [];
      const apiFails = [];
      const onErr = (e) => errors.push(String(e.message || e).slice(0, 120));
      const onRes = (r) => {
        if (r.url().includes('/v1/') && r.status() >= 400) {
          apiFails.push(`${r.status()} ${r.url().split('/v1/')[1].split('?')[0]}`);
        }
      };
      page.on('pageerror', onErr);
      page.on('response', onRes);

      let text = '';
      try {
        await page.goto(route || '/', { waitUntil: 'domcontentloaded', timeout: 30000 });
        // Wait for the app to actually paint, rather than sleeping a fixed
        // amount. A flat 2.6s was too short for the heavier admin tables and
        // reported nine perfectly healthy screens as blank — the probe being
        // impatient, not the screen being broken. Poll until the body has real
        // content, then give late data a moment to land.
        await page.waitForFunction(
          () => (document.body.innerText || '').trim().length > 200,
          null, { timeout: 20000 },
        ).catch(() => {});
        await page.waitForTimeout(1200);
        text = (await page.locator('body').innerText().catch(() => '')) || '';
      } catch (e) {
        errors.push('NAVIGATION: ' + String(e.message).slice(0, 90));
      }
      page.off('pageerror', onErr);
      page.off('response', onRes);

      // 401s are the token expiring mid-sweep, not a broken screen — call them
      // out separately so they do not read as application faults.
      const auth401 = apiFails.filter((f) => f.startsWith('401')).length;
      const realFails = apiFails.filter((f) => !f.startsWith('401'));
      // Health is "it threw nothing and every call it made answered", not a
      // character count. A length threshold cuts both ways and I got it wrong
      // in both directions: 40 chars passed screens that rendered only their
      // sidebar, and 400 failed a Profile page that is legitimately short.
      // Length is still printed, because a sudden drop is worth a human look —
      // it just does not decide the verdict.
      const bad = errors.length > 0 || realFails.length > 0;
      if (bad) broken += 1;

      const mark = bad ? 'FAIL' : ' ok ';
      console.log(`  ${mark}  ${(route || '/').padEnd(42)} text=${String(text.trim().length).padStart(5)}`
        + (errors.length ? `  JS=${errors.length}` : '')
        + (realFails.length ? `  API=${[...new Set(realFails)].slice(0, 3).join(', ')}` : '')
        + (auth401 ? `  (401s=${auth401})` : ''));
      if (errors.length) console.log(`          ${errors[0]}`);
    }

    summary.push([label, routes.length, broken]);
    await ctx.close();
  }

  console.log(`\n${'='.repeat(64)}\nSUMMARY\n${'='.repeat(64)}`);
  for (const [label, total, broken] of summary) {
    console.log(`  ${label.padEnd(10)} ${total - broken}/${total} healthy`
      + (broken ? `   ${broken} need attention` : ''));
  }
  await browser.close();
  process.exit(summary.some(([, , b]) => b) ? 1 : 0);
})();
