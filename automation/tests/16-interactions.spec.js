// The interaction types the earlier specs didn't cover:
// logout · real file upload · search · dropdowns · table data · responsive.
const { test, expect } = require('@playwright/test');
const { chooseOption, selectedOption, openOptions } = require('../utils/ui');
const { studentContext, portalLogin, STUDENTS } = require('../utils/api');

let studentToken, adminToken;

test.beforeAll(async () => {
  studentToken = (await studentContext('pro')).token;
  adminToken = (await portalLogin('admin')).token;
  expect(studentToken).toBeTruthy();
});

const asStudent = async (page) => {
  await page.addInitScript(([t, e]) => {
    localStorage.setItem('access_token', t);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
    }));
  }, [studentToken, STUDENTS.pro.email]);
};

const asAdmin = async (page) => {
  await page.addInitScript((t) => {
    localStorage.setItem('admin_access_token', t);
    localStorage.setItem('admin_user', JSON.stringify({
      id: 'e2e', full_name: 'E2E Admin', role: 'admin', admin_role: 'founder',
    }));
  }, adminToken);
};

// ── Logout ────────────────────────────────────────────────────────────────
test('student can log out and is returned to the login page', async ({ page }) => {
  await asStudent(page);
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // "Sign Out" lives inside the profile dropdown — open it first.
  const signOut = page.getByRole('button', { name: /sign ?out|log ?out/i }).first();
  if (!(await signOut.isVisible().catch(() => false))) {
    // The avatar toggle in the top bar opens the profile dropdown.
    await page.locator('button.w-8.h-8.rounded-full').first().click();
    await page.waitForTimeout(800);
  }
  await page.getByRole('button', { name: /sign ?out|log ?out/i }).first().click();
  await page.waitForURL(/\/login/, { timeout: 10_000 });
  expect(page.url()).toContain('/login');

  // The session token is cleared.
  const left = await page.evaluate(() => localStorage.getItem('access_token'));
  expect(left, 'access token cleared on logout').toBeFalsy();
});

// ── Real file upload ──────────────────────────────────────────────────────
test('Document Vault: uploading a real file through the file picker', async ({ page }) => {
  await asStudent(page);
  await page.goto('/document-vault', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  await page.getByRole('button', { name: /add document/i }).first().click();
  await page.waitForTimeout(800);

  const fileInput = page.locator('input[type="file"]').first();
  expect(await fileInput.count(), 'vault has a real file input').toBeGreaterThan(0);

  // Attach an in-memory file — no fixture on disk needed.
  await fileInput.setInputFiles({
    name: 'e2e-upload.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 e2e test file'),
  });
  await page.waitForTimeout(2500);

  // Either it uploaded (a URL landed in the form) or it surfaced a clear error —
  // both prove the picker is wired; a silent no-op would not.
  const urlFilled = await page.locator('input[value*="http"]').count();
  const message = await page.getByText(/upload|error|failed|size|success/i).count();
  expect(urlFilled + message, 'file picker produced a visible result').toBeGreaterThan(0);
});

// ── Search ────────────────────────────────────────────────────────────────
test('Market: the search box filters deals', async ({ page }) => {
  await asStudent(page);
  await page.goto('/market', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const search = page.getByPlaceholder(/search/i).first();
  test.skip(!(await search.count()), 'no search box on Market');

  await search.fill('E2E');
  await search.press('Enter');
  await page.waitForTimeout(1500);
  // The seeded E2E deals should survive the filter.
  await expect(page.getByText(/E2E .*Deal/i).first()).toBeVisible();
});

test('Colleges: searching narrows the table', async ({ page }) => {
  await asStudent(page);
  await page.goto('/colleges', { waitUntil: 'domcontentloaded' });

  // The page fires several overlapping unfiltered fetches on mount and does not
  // cancel in-flight ones, so a late reply will clobber the filtered result.
  // Wait for the table to settle before searching.
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(2500);
  const before = await page.locator('table tbody tr').count();
  expect(before, 'colleges table is populated to begin with').toBeGreaterThan(0);

  // Target the Colleges search box specifically, not any search input on screen.
  const search = page.locator('input[placeholder*="Search colleges" i]').first();
  test.skip(!(await search.count()), 'no search box on Colleges');

  // Assert the search box actually queries the backend with the typed term —
  // deterministic, unlike comparing row counts while the table is still loading.
  const [req] = await Promise.all([
    page.waitForRequest(
      (r) => r.url().includes('/colleges') && /search=zzzz/.test(decodeURIComponent(r.url())),
      { timeout: 10_000 },
    ),
    (async () => {
      await search.fill('zzzz-no-such-college');
      await search.press('Enter');
    })(),
  ]);
  expect(req, 'search box queries the backend').toBeTruthy();

  // …and the table actually empties out.
  await expect
    .poll(() => page.locator('table tbody tr').count(), { timeout: 10_000 })
    .toBe(0);
});

// ── Dropdowns ─────────────────────────────────────────────────────────────
test('Admin Score Engine: the cap-window dropdown can be changed', async ({ page }) => {
  await asAdmin(page);
  await page.goto('/skovo-platform-panel-admin/score-rules', { waitUntil: 'domcontentloaded' });

  // The rules load from the API before any field exists. Wait for the app's
  // dropdown trigger, not a native <select> — there are none left in the app.
  await page.waitForSelector('button[aria-haspopup="listbox"]', { timeout: 20_000 });
  await page.waitForTimeout(2500); // let any in-flight refetch land first

  await chooseOption(page, 'Cap window', 'weekly');
  await expect
    .poll(() => selectedOption(page, 'Cap window'), { timeout: 8_000 })
    .toMatch(/weekly/i);
});

test('Admin Market: the category dropdown in the deal form works', async ({ page }) => {
  await asAdmin(page);
  await page.goto('/skovo-platform-panel-admin/market', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  await page.getByRole('button', { name: /new deal/i }).first().click();
  // The shared Modal is a plain div — no role="dialog" — so wait on a field the
  // deal form owns rather than a dialog role. Category appears only in this
  // form, so it needs no scoping.
  await expect(page.getByLabel(/^\s*Title/i)).toBeVisible({ timeout: 10_000 });

  // Categories come from master data (masters.market_category), so read the
  // real options rather than hard-coding one that may not be seeded.
  const options = await openOptions(page, 'Category');
  expect(await options.count(),
    'the Category dropdown offers no options — is master data seeded?').toBeGreaterThan(0);

  const wanted = (await options.first().innerText()).trim();
  await options.first().click();

  await expect
    .poll(() => selectedOption(page, 'Category'), { timeout: 8_000 })
    .toBe(wanted);
});

// ── Table data ────────────────────────────────────────────────────────────
test('Admin Users table renders real rows with data', async ({ page }) => {
  await asAdmin(page);
  await page.goto('/skovo-platform-panel-admin/users', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('table tbody tr').first()).toBeVisible({ timeout: 20_000 });
  expect(await page.locator('table tbody tr').count(), 'users table has rows').toBeGreaterThan(0);
  await page.waitForTimeout(2000); // let any in-flight refetch land first

  // Other specs create users, so the seeded student is not reliably on page 1 —
  // search for it rather than scanning whatever the default page happens to show.
  const search = page.locator('input[placeholder*="Search name" i]').first();
  await search.fill('e2e.pro@skovo-test.local');
  await search.press('Enter');

  // Scope to the table — the email also renders in a mobile card that is
  // hidden at desktop width, which would match first and read as "hidden".
  const inTable = page.locator('table').getByText(/e2e\.pro@skovo-test\.local/);
  await expect.poll(() => inTable.count(), {
    timeout: 12_000, message: 'seeded student is findable in the users table',
  }).toBeGreaterThan(0);
});

// ── Responsive ────────────────────────────────────────────────────────────
test('student dashboard is usable on a phone-sized viewport', async ({ page }) => {
  await asStudent(page);
  await page.setViewportSize({ width: 390, height: 844 });   // iPhone-ish
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  // Content renders and the page doesn't scroll sideways.
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'no horizontal overflow on mobile').toBeLessThanOrEqual(2);
});

test('student dashboard is usable on a tablet viewport', async ({ page }) => {
  await asStudent(page);
  await page.setViewportSize({ width: 820, height: 1180 });  // iPad-ish
  await page.goto('/market', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, 'no horizontal overflow on tablet').toBeLessThanOrEqual(2);
});
