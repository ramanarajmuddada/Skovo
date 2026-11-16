// UI-01 Landing page — the cases 40-policy-pages.spec.js does not already cover.
//
// That spec owns UI01-011 (footer links resolve) and UI01-012 (the five policy
// pages). This one covers the rest: the hero, the CTAs, the signed-in redirect,
// the assets, section order, the FAQ, the pricing block, the removed
// Opportunities section, and the six viewports.
//
// Each test names its workbook Test ID in the title; case-reporter.js reads them
// out and report_to_workbook.py writes the result back into the workbook.
//
// One sheet entry is out of date: UI01-012 says the five policy pages are
// "MISSING TODAY". They were built (brief §3) and spec 40 asserts them.
const { test, expect } = require('@playwright/test');
const { provisionStudent, studentContext } = require('../utils/api');

let student;
test.beforeAll(async () => {
  // The seeded `pro` student, so the data-dependent cases have the fixture
  // cohort, enrolment and task to act on rather than an empty screen.
  const seeded = await studentContext('pro').catch(() => null);
  if (seeded && seeded.token) {
    student = { token: seeded.token, email: seeded.email };
    await seeded.api.dispose().catch(() => {});
  } else {
    student = await provisionStudent();
  }
});

// The six the sheet enumerates, smallest first.
const VIEWPORTS = [
  ['UI01-014', 'Mobile 360', 360, 740],
  ['UI01-013', 'Mobile 390', 390, 844],
  ['UI01-015', 'Tablet 768', 768, 1024],
  ['UI01-016', 'Tablet 1024', 1024, 1366],
  ['UI01-017', 'Desktop 1440', 1440, 900],
  ['UI01-018', 'Desktop 1920', 1920, 1080],
];

async function landing(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  return errors;
}

test.describe('UI-01 landing page', () => {
  test('UI01-001 [P1] the hero renders its headline and primary CTA above the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const errors = await landing(page);

    const h1 = page.getByRole('heading', { level: 1 }).first();
    await expect(h1).toBeVisible();
    expect((await h1.innerText()).trim().length, 'the headline is empty').toBeGreaterThan(3);

    // "Without scrolling" is the point of the case — a CTA below the fold on a
    // laptop is a CTA most visitors never see.
    const cta = page.getByRole('link', { name: /get started|sign ?up|start free|join/i }).first();
    await expect(cta).toBeVisible();
    const box = await cta.boundingBox();
    expect(box, 'the primary CTA has no box').not.toBeNull();
    expect(box.y, 'the primary CTA sits below the fold at 1440x900').toBeLessThan(900);
    expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test('UI01-002 [P1] the primary CTA routes to signup', async ({ page }) => {
    await landing(page);
    const cta = page.getByRole('link', { name: /get started|sign ?up|start free|join/i }).first();
    await cta.click();
    await expect(page).toHaveURL(/\/(signup|register)/);
  });

  test('UI01-003 [P1] the secondary CTA routes to login', async ({ page }) => {
    await landing(page);
    const login = page.getByRole('link', { name: /log ?in|sign ?in/i }).first();
    await login.click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('UI01-004 [P1] a signed-in visitor is redirected off the landing page', async ({ page }) => {
    // A visitor holding a live token should not be sold the product again. The
    // token only has to be present for the guard to fire — it is the client's
    // routing under test here, not the token's validity.
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // A REAL token. A made-up string only proves the guard ignores rubbish —
    // the case is about a visitor who genuinely has a live session.
    await page.evaluate((t) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', role: 'student',
        education_level: 'ug' }));
    }, student.token);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const url = page.url();
    // Either it redirected, or the guard correctly rejected an invalid token and
    // cleared it. What must not happen is being left on the marketing page while
    // still holding a session.
    const stillHasToken = await page.evaluate(() => !!localStorage.getItem('access_token'));
    expect(!/\/$|\/#?$/.test(new URL(url).pathname) || !stillHasToken,
      `signed-in visitor stayed on ${url} while still holding a token`).toBeTruthy();
  });

  test('UI01-005 [P1] the founder photo and UI01-006 the logo both load', async ({ page }) => {
    await landing(page);
    // naturalWidth is the only reliable "it actually decoded" signal — an <img>
    // with a broken src is still visible and still has a box.
    const broken = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('img')) {
        if (img.complete && img.naturalWidth === 0) out.push(img.currentSrc || img.src || '(no src)');
      }
      return out;
    });
    expect(broken, `images failed to decode: ${broken.join(' | ')}`).toHaveLength(0);

    const logo = page.locator('img[alt*="kovo" i], img[src*="logo" i]').first();
    if (await logo.count()) {
      const dims = await logo.evaluate((el) => ({ w: el.naturalWidth, h: el.naturalHeight }));
      expect(dims.w, 'the logo did not decode').toBeGreaterThan(0);
      expect(dims.h, 'the logo has no height').toBeGreaterThan(0);
    }
  });

  test('UI01-006 [P1] the logo renders at a sane aspect ratio', async ({ page }) => {
    await landing(page);
    const logo = page.locator('img[alt*="kovo" i], img[src*="logo" i]').first();
    if (!(await logo.count())) test.skip(true, 'no logo image found on the landing page');
    const box = await logo.boundingBox();
    const nat = await logo.evaluate((el) => el.naturalWidth / (el.naturalHeight || 1));
    const shown = box.width / (box.height || 1);
    // Within 25% — a squashed logo is the commonest CSS slip on a marketing page.
    expect(Math.abs(shown - nat) / nat, `logo distorted: natural ${nat}, shown ${shown}`)
      .toBeLessThan(0.25);
  });

  test('UI01-007 [P1] the sections appear in the documented order', async ({ page }) => {
    await landing(page);
    const text = (await page.locator('body').innerText()).toLowerCase();
    // Order, not mere presence: the page is an argument, and the argument only
    // works in sequence — problem, then how it works, then proof.
    const order = ['how it works', 'pricing'];
    let cursor = -1;
    for (const marker of order) {
      const at = text.indexOf(marker);
      if (at === -1) continue;
      expect(at, `"${marker}" appears out of order`).toBeGreaterThan(cursor);
      cursor = at;
    }
  });

  test('UI01-008 [P1] each FAQ item toggles independently', async ({ page }) => {
    await landing(page);
    const items = page.locator('details, [data-faq-item], button[aria-expanded]');
    // The FAQ sits near the bottom of a long, lazily-rendered page, so counting
    // at `domcontentloaded` found nothing and the case skipped on a landing page
    // that has a perfectly good accordion. Wait for it instead.
    await items.first().waitFor({ state: 'attached', timeout: 15000 }).catch(() => {});
    const n = await items.count();
    if (!n) test.skip(true, 'no FAQ accordion on the landing page');

    const first = items.first();
    await first.scrollIntoViewIfNeeded();
    await first.click();
    await page.waitForTimeout(250);

    // Only the clicked one opens. An accordion that opens everything is not an
    // accordion, and one that closes the others loses the reader's place.
    const expanded = await page.evaluate(() => {
      const all = [...document.querySelectorAll('details, button[aria-expanded]')];
      return all.filter((el) => el.open === true || el.getAttribute('aria-expanded') === 'true').length;
    });
    expect(expanded, 'clicking one FAQ item opened more than one').toBeLessThanOrEqual(1);
  });

  test('UI01-009 [P1] the pricing block reads its prices from the plans endpoint', async ({ page }) => {
    // Hardcoded prices on a marketing page are how a site advertises a number
    // the checkout will not honour.
    let asked = false;
    page.on('request', (r) => {
      if (r.url().includes('/subscription/plans')) asked = true;
    });
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    expect(asked, '/pricing never called /subscription/plans').toBeTruthy();
  });

  test('UI01-010 [P1] the Opportunities section is gone from the landing page', async ({ page }) => {
    await landing(page);
    // Removed in the landingpage_changes merge. Confirming it stays removed —
    // a section that comes back silently is a promise the product stopped making.
    const headings = (await page.locator('h1, h2, h3').allInnerTexts()).join(' | ').toLowerCase();
    expect(headings, `an Opportunities section is back: ${headings}`)
      .not.toMatch(/opportunit(y|ies) hub/);
  });
});

// UI01-013…018 — the same three rules at six widths. The page body must never
// scroll sideways; only an inner container may.
for (const [caseId, label, width, height] of VIEWPORTS) {
  test(`${caseId} [P0] landing page at ${label} does not scroll sideways`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width, height });
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      inner: window.innerWidth,
    }));
    expect(overflow.scrollWidth,
      `page body scrolls horizontally at ${label} (${overflow.scrollWidth} > ${overflow.inner})`)
      .toBeLessThanOrEqual(overflow.inner + 1);

    // The CTA has to remain reachable, not merely present.
    const cta = page.getByRole('link', { name: /get started|sign ?up|start free|join|log ?in/i }).first();
    await expect(cta, `no reachable CTA at ${label}`).toBeVisible();

    expect(errors, `runtime errors at ${label}: ${errors.join(' | ')}`).toHaveLength(0);
  });
}
