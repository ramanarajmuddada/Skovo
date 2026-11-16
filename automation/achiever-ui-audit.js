/**
 * Achiever portal UI consistency — measured, not eyeballed.
 *
 * Loads all 16 achiever screens (12 authed portal + 4 public auth) and reports
 * the COMPUTED styles that were found to drift: the page title's size/weight and
 * the primary action button's padding, size, weight and focus ring. Computed
 * values, because a class list tells you what someone typed and this tells you
 * what the user actually sees.
 *
 * Selector note, learned the hard way: "first element with white text on a
 * coloured background" matched the sidebar AVATAR on every screen — a 0-padding
 * circle whose label is one letter — and so reported "1 distinct style" while
 * measuring nothing. The button probe now scopes to <main>, requires a real
 * multi-character label, and requires a real box.
 *
 *   automation> node achiever-ui-audit.js
 */
const { chromium } = require('@playwright/test');
const fs = require('fs');

const PORTAL = [
  ['Dashboard', ''], ['Verification', '/application'], ['My Cohorts', '/cohorts'],
  ['Tasks', '/tasks'], ['Bookings', '/bookings'], ['Availability', '/availability'],
  ['Earnings', '/earnings'], ['My Courses', '/courses'], ['Coupons', '/coupons'],
  ['Domains', '/domains'], ['Notifications', '/notifications'], ['Profile', '/profile'],
];
const AUTH = [
  ['Login', '/login'], ['Register', '/register'],
  ['Verify OTP', '/verify-otp'], ['Forgot password', '/forgot-password'],
];

const PROBE = () => {
  const root = document.querySelector('main') || document.body;
  const h = root.querySelector('h1') || document.querySelector('h1');
  const t = h ? getComputedStyle(h) : null;
  // An sr-only h1 is clipped to 1px, so its computed size is the inherited body
  // font and says nothing about the visible design. Report it as what it is,
  // rather than letting it count as a fourth title style.
  const srOnly = !!h && h.getBoundingClientRect().width <= 1;

  // The primary CTA: a real, labelled, filled button inside the page body.
  const btn = [...root.querySelectorAll('button, a[role="button"]')].find((el) => {
    const c = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    const label = (el.innerText || '').trim();
    if (label.length < 3 || r.width < 60 || r.height < 28) return false;
    if (c.backgroundColor === 'rgba(0, 0, 0, 0)' || c.backgroundColor === 'transparent') return false;
    // Filled = light text on a dark ground.
    const m = c.color.match(/\d+/g) || [];
    const lum = (Number(m[0]) + Number(m[1]) + Number(m[2])) / 3;
    return lum > 200;
  });
  const bc = btn ? getComputedStyle(btn) : null;
  return {
    title: !t ? '—' : srOnly ? 'sr-only' : `${t.fontSize}/${t.fontWeight}`,
    hasH1: !!h,
    btn: bc ? `pad ${bc.paddingTop}/${bc.paddingLeft}  ${bc.fontSize}/${bc.fontWeight}  r${bc.borderRadius}` : '—',
    label: btn ? (btn.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 18) : '',
  };
};

(async () => {
  const tok = JSON.parse(fs.readFileSync('.auth/tokens.json', 'utf8'));
  const b = await chromium.launch();
  const titles = new Set(); const btns = new Set(); const noH1 = [];

  const run = async (page, list, prefix) => {
    for (const [name, path] of list) {
      await page.goto('/skovo-achiever-portal' + path, { waitUntil: 'domcontentloaded' });
      await page.waitForFunction(() => (document.body.innerText || '').length > 120,
        null, { timeout: 15000 }).catch(() => {});
      // Wait for the screen itself, not just for the shell. The dashboard holds a
      // spinner until its data lands and a fixed 900ms measured the spinner.
      await page.waitForFunction(
        () => !!(document.querySelector('main h1') || document.querySelector('main h2')),
        null, { timeout: 15000 },
      ).catch(() => {});
      await page.waitForTimeout(600);
      const m = await page.evaluate(PROBE);
      titles.add(m.title);
      if (!m.hasH1) noH1.push(prefix + name);
      if (m.btn !== '—') btns.add(m.btn);
      console.log(`${name.padEnd(16)} ${m.title.padEnd(10)} ${m.btn.padEnd(38)} ${m.label}`);
    }
  };

  console.log('SCREEN           TITLE      PRIMARY BUTTON                         LABEL');
  console.log('-'.repeat(92));

  const authed = await b.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 900 } });
  const p1 = await authed.newPage();
  await p1.addInitScript((t) => {
    localStorage.setItem('achiever_access_token', t);
    localStorage.setItem('access_token', t);
    localStorage.setItem('achiever', JSON.stringify({ id: 'e2e', full_name: 'E2E Achiever', role: 'mentor' }));
  }, tok.achiever);
  await run(p1, PORTAL, '');
  await authed.close();

  // Signed OUT — /login and /register redirect an authenticated visitor away,
  // so measuring them in the authed context measures the dashboard instead.
  console.log('-'.repeat(92));
  const anon = await b.newContext({ baseURL: 'http://127.0.0.1:3000', viewport: { width: 1440, height: 900 } });
  const p2 = await anon.newPage();
  await run(p2, AUTH, '');
  await anon.close();

  console.log('\n' + '='.repeat(92));
  console.log(`distinct TITLE styles : ${titles.size}   ${[...titles].join('   ')}`);
  if (noH1.length) console.log(`screens with NO <h1>  : ${noH1.join(', ')}`);
  console.log(`distinct BUTTON styles: ${btns.size}`);
  for (const s of btns) console.log(`   ${s}`);
  await b.close();
})();
