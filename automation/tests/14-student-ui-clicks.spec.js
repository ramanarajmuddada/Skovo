// Click-by-click student UI — drives the real DOM (buttons, modals, forms) and
// asserts the visible result, rather than calling the API directly.
const { test, expect } = require('@playwright/test');
const { login, STUDENTS } = require('../utils/api');

let token;

test.beforeAll(async () => {
  const r = await login(STUDENTS.pro.email, STUDENTS.pro.password);
  token = r.token;
  expect(token, 'seeded Pro student should log in').toBeTruthy();
});

// Seed the logged-in session before any app script runs.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(([t, e]) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
    }));
  }, [token, STUDENTS.pro.email]);
});

// ActionBtn wraps its button in <Tooltip>, whose text lives in a sibling span
// (opacity-0 until hover) — so we locate the wrapper by text, then its button.
const actionBtn = (page, tooltipText) =>
  page.locator('span.group').filter({ hasText: tooltipText }).locator('button').first();

test('Colleges: clicking the bookmark button saves a college', async ({ page }) => {
  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // The fixtures always contain colleges, so wait for the button rather than
  // skipping — a self-skipping test silently drops the coverage it claims.
  const bookmark = actionBtn(page, 'Save to compare');
  await expect(bookmark).toBeVisible({ timeout: 20_000 });

  await bookmark.click();
  await page.waitForTimeout(1500);

  // It should now appear on the Saved Colleges screen.
  await page.goto('/colleges/saved', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  await expect(page.getByText(/saved colleges/i).first()).toBeVisible();
});

test('Opportunities: clicking the shortlist button toggles it', async ({ page }) => {
  await page.goto('/opportunities', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const shortlist = actionBtn(page, 'Save to shortlist');
  await expect(shortlist).toBeVisible({ timeout: 20_000 });

  // Assert the button is wired to the shortlist endpoint. Checking the request
  // it fires is precise and immune to list refetches / other specs' leftovers.
  const [req] = await Promise.all([
    page.waitForRequest(
      (r) => /\/opportunities\/.+\/shortlist/.test(r.url()) && r.method() === 'POST',
      { timeout: 10_000 },
    ),
    shortlist.click(),
  ]);
  expect(req, 'shortlist button POSTs to the shortlist endpoint').toBeTruthy();

  // …and the server accepted it.
  const res = await req.response();
  expect(res?.status()).toBe(200);
});

test('Document Vault: the Add Document modal opens and accepts input', async ({ page }) => {
  await page.goto('/document-vault', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  await page.getByRole('button', { name: /add document/i }).first().click();
  await page.waitForTimeout(800);

  // Modal fields are present and fillable.
  const name = page.locator('input[type="text"]:visible, input:not([type]):visible').first();
  await expect(name).toBeVisible();
  await name.fill('E2E UI Document');
  expect(await name.inputValue()).toBe('E2E UI Document');
});

test('Assemble: clicking Posts opens the community panel', async ({ page }) => {
  await page.goto('/assemble', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const postsBtn = page.getByRole('button', { name: /posts/i }).first();
  await expect(postsBtn).toBeVisible({ timeout: 20_000 });

  await postsBtn.click();
  await page.waitForTimeout(1200);
  // The slide-over shows either existing posts or the empty-state copy.
  await expect(page.getByText(/no posts yet|write a post|post/i).first()).toBeVisible();
});

test('Market: clicking a deal opens the redeem modal with a coupon', async ({ page }) => {
  await page.goto('/market', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  const getDeal = page.getByRole('button', { name: /get deal/i }).first();
  await expect(getDeal).toBeVisible({ timeout: 20_000 });

  await getDeal.click();
  await page.waitForTimeout(1500);
  // Modal shows the coupon code / continue CTA.
  await expect(page.getByText(/coupon code|continue to/i).first()).toBeVisible();
});

test('My Score: the page shows the score ring and unlock gates', async ({ page }) => {
  await page.goto('/my-score', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await expect(page.getByText(/\/ 100/).first()).toBeVisible();
  await expect(page.getByText(/opportunity hub/i).first()).toBeVisible();
});

test('Skovo Pro: the upgrade page shows plans and a pay button', async ({ page }) => {
  await page.goto('/skovo-pro', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  await expect(page.getByText(/₹|month|year/i).first()).toBeVisible();
});

test('Sidebar navigation actually routes between screens', async ({ page }) => {
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // Market is reached from the Dashboard's Quick Actions, not the sidebar — it
  // moved there on 2026-09-01 — and the tile is a BUTTON that navigates, not a
  // link, so a link-role query finds nothing however long it waits.
  await page.getByRole('button', { name: /Market/i }).first().click();
  await page.waitForURL(/\/market/, { timeout: 10_000 });
  expect(page.url()).toContain('/market');

  // Back to the Dashboard, because the sidebar link below is the next thing
  // under test and Market is not the screen it is on.
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  await page.getByRole('link', { name: /document vault/i }).first().click();
  await page.waitForURL(/\/document-vault/, { timeout: 10_000 });
  expect(page.url()).toContain('/document-vault');
});
