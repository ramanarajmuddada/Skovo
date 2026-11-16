// The public//gate student screens the other specs never render:
// verify-email, forgot-password, the DPDP consent gate and parent-consent.
// Kept separate because these must load with NO session.
const { test, expect } = require('@playwright/test');

const noCrash = (page) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

test('Verify Email screen guards against being opened directly', async ({ page }) => {
  const errors = noCrash(page);
  // The screen needs the signup details handed to it via router state. Opened
  // cold it must bounce to login rather than render a dead OTP box.
  await page.goto('/verify-email', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await expect(page).toHaveURL(/\/login$/, { timeout: 15_000 });
  expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Verify Email renders the OTP form when reached from signup', async ({ page }) => {
  const errors = noCrash(page);
  // Arrive the way the app does: with signup details in router state.
  await page.goto('/signup', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    window.history.pushState(
      { usr: { email: 'e2e.verify@skovo-test.local', full_name: 'E2E Verify', role: 'student' } },
      '',
      '/verify-email',
    );
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await page.waitForTimeout(2000);

  await expect(page.getByText(/enter your otp/i).first()).toBeVisible({ timeout: 15_000 });
  expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Forgot Password screen renders its email form', async ({ page }) => {
  const errors = noCrash(page);
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByPlaceholder(/you@email\.com/i).first()).toBeVisible({ timeout: 15_000 });
  expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Forgot Password: submitting an email calls the backend', async ({ page }) => {
  await page.goto('/forgot-password', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await page.getByPlaceholder(/you@email\.com/i).first().fill('e2e.pro@skovo-test.local');

  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/v1/') && r.method() === 'POST', { timeout: 15_000 }),
    page.getByRole('button', { name: /send|continue|reset|next/i }).first().click(),
  ]);
  expect(req, 'the reset form calls the backend').toBeTruthy();
});

test('Parent Consent screen renders without a crash when the token is missing', async ({ page }) => {
  const errors = noCrash(page);
  await page.goto('/parent-consent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // With no token it shows the failure state — that is still a valid render,
  // and it must not blow up or show a blank page.
  await expect(page.locator('h1').first()).toBeVisible({ timeout: 15_000 });
  expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
});

test('Consent gate loads without a crash for an anonymous visitor', async ({ page }) => {
  const errors = noCrash(page);
  await page.goto('/consent', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Anonymous users are bounced to login; either way it must not crash.
  expect(errors, `runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
  await expect(page.locator('body')).not.toBeEmpty();
});
