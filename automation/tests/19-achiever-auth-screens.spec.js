// The four public achiever auth screens. Kept in their own spec because these
// must render with NO session — the other achiever spec seeds a token on every
// navigation, which would bounce these straight to the dashboard.
const { test, expect } = require('@playwright/test');

const H = '/skovo-achiever-portal';

for (const [name, route, heading] of [
  ['Login', `${H}/login`, /welcome back/i],
  ['Register', `${H}/register`, /become an achiever/i],
  ['Verify OTP', `${H}/verify-otp`, /verify your email/i],
  ['Forgot Password', `${H}/forgot-password`, /reset password/i],
]) {
  test(`achiever auth screen: ${name}`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(route, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);

    await expect(page.getByText(heading).first(), `${route} heading`).toBeVisible({ timeout: 15_000 });
    expect(errors, `${route} runtime errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
}

test('achiever login: the form has email, password and a submit button', async ({ page }) => {
  await page.goto(`${H}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await expect(page.getByPlaceholder(/you@email\.com/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder(/your password/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /sign in|log ?in/i }).first()).toBeVisible();
});

test('achiever login: bad credentials are rejected, not let through', async ({ page }) => {
  await page.goto(`${H}/login`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.getByPlaceholder(/you@email\.com/i).fill('e2e.nobody@skovo-test.local');
  await page.getByPlaceholder(/your password/i).fill('definitely-wrong-password');
  await page.getByRole('button', { name: /sign in|log ?in/i }).first().click();
  await page.waitForTimeout(3000);

  expect(page.url(), 'bad credentials must not grant portal access').toMatch(/login/);
});

test('achiever register: the signup form renders its fields', async ({ page }) => {
  await page.goto(`${H}/register`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  await expect(page.getByPlaceholder(/your full name/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByPlaceholder(/you@email\.com/i)).toBeVisible();
  await expect(page.getByPlaceholder(/minimum 6 characters/i)).toBeVisible();
  await expect(page.getByPlaceholder(/repeat your password/i)).toBeVisible();
});

test('achiever forgot-password: entering an email requests a reset code', async ({ page }) => {
  await page.goto(`${H}/forgot-password`, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const email = page.getByPlaceholder(/you@email\.com/i);
  await expect(email).toBeVisible({ timeout: 15_000 });
  await email.fill('e2e.achiever@skovo-test.local');

  const [req] = await Promise.all([
    page.waitForRequest((r) => r.url().includes('/v1/') && r.method() === 'POST', { timeout: 15_000 }),
    page.getByRole('button', { name: /send|continue|reset/i }).first().click(),
  ]);
  expect(req, 'the reset form calls the backend').toBeTruthy();
});
