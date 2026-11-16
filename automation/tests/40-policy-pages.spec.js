// Policy pages — the five that Cashfree and AWS SES both require live before
// they approve the account (workbook UI-01, esp. UI01-011 and the P0 UI01-012).
//
// These were missing entirely; this suite is the executable half of "they now
// exist and work". Each test names the workbook Test ID it covers, because the
// audit found 0 of 1047 IDs referenced anywhere in automation — traceability
// starts here.
//
// Runs against the dev server (baseURL :3000) like every other UI spec; start it
// with `npm run dev` or let the config's webServer reuse it.
const { test, expect } = require('@playwright/test');

const PAGES = [
  ['/terms',   /Terms & Conditions/i,      'Terms'],
  ['/privacy', /Privacy Policy/i,          'Privacy'],
  ['/refund',  /Refund & Cancellation/i,   'Refund'],
  ['/contact', /Contact Us/i,              'Contact'],
  ['/pricing', /Pricing/i,                 'Pricing'],
];

// UI01-012 [P0] — the five policy pages exist, resolve signed-out, render their
// heading, carry no runtime error and do not scroll sideways on a phone.
for (const [route, heading, name] of PAGES) {
  test(`UI01-012 [P0] ${name} page is live, signed-out, clean @390`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewportSize({ width: 390, height: 844 });

    // No token set — these must be reachable without a session.
    const resp = await page.goto(route, { waitUntil: 'domcontentloaded' });
    if (resp) expect(resp.status(), `${route} http`).toBeLessThan(400);
    await expect(page.getByRole('heading', { level: 1 }), `${route} heading`).toHaveText(heading);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow, `${route} scrolls horizontally at 390px`).toBeFalsy();
    expect(errors, `${route} runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
}

// UI01-011 [P1] — every footer legal link on the landing page resolves to a real
// page, none 404.
test('UI01-011 [P1] landing footer legal links resolve', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  for (const [route, heading, name] of PAGES) {
    const link = page.locator(`footer a[href="${route}"]`).first();
    await expect(link, `footer link to ${route}`).toBeVisible();
  }
  // Follow one through to prove it is not a dead href.
  await page.locator('footer a[href="/terms"]').first().click();
  await expect(page).toHaveURL(/\/terms$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Terms & Conditions/i);
});

// UI01-009 [P1] — the Pricing page reads plan prices from the public plans
// endpoint, not hardcoded copy. Verified by intercepting the call the page makes.
test('UI01-009 [P1] Pricing page sources prices from /subscription/plans', async ({ page }) => {
  let called = false;
  page.on('request', (r) => {
    if (r.url().includes('/subscription/plans')) called = true;
  });
  await page.goto('/pricing', { waitUntil: 'networkidle' });
  expect(called, 'Pricing must fetch /subscription/plans').toBeTruthy();
});
