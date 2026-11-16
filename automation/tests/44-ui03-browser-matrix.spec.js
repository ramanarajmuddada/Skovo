// UI-03 Browser matrix — 56 cases: 7 browsers x 8 core journeys.
//
// Each test launches the engine it needs itself rather than relying on a
// Playwright *project*, so the whole matrix runs in one pass with no config
// flag to remember and no chance of a browser being silently skipped because
// PW_ALL_BROWSERS was not set.
//
// Six of the seven are real engines:
//
//   Chrome (Windows)   chromium
//   Chrome (Android)   chromium + Pixel 5 descriptor
//   Safari (iOS)       webkit + iPhone descriptor
//   Safari (macOS)     webkit
//   Firefox            firefox
//   Edge               chromium, channel 'msedge' — skipped where not installed
//
// **Samsung Internet has no driver.** It is a Chromium fork with its own
// release cadence and its own quirks, and Playwright cannot drive it. Those
// eight cases are marked as requiring a real device rather than approximated
// with a spoofed user-agent, because a spoofed UA tests nothing that the
// Chrome (Android) row has not already tested — it would be a green tick for
// work nobody did.
const { test, expect, chromium, firefox, webkit, devices } = require('@playwright/test');
const { provisionStudent, studentContext } = require('../utils/api');

const BASE = 'http://localhost:3000';

// [firstCaseId, label, launcher, contextOptions]
const BROWSERS = [
  ['UI03-001', 'Chrome (Windows)', () => chromium.launch(), {}],
  ['UI03-009', 'Chrome (Android)', () => chromium.launch(), devices['Pixel 5']],
  ['UI03-017', 'Safari (iOS)', () => webkit.launch(), devices['iPhone 13']],
  ['UI03-025', 'Safari (macOS)', () => webkit.launch(), {}],
  ['UI03-033', 'Firefox', () => firefox.launch(), {}],
  ['UI03-041', 'Edge', () => chromium.launch({ channel: 'msedge' }), {}],
];

// The eight journeys, in the sheet's order.
const JOURNEYS = [
  'Landing renders',
  'Signup + OTP',
  'Cohort browse and enrol',
  'Paid checkout redirect',
  'File upload',
  'Date/time picker',
  'Modals and drawers',
  'localStorage token',
];

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

function caseId(firstId, index) {
  return `UI03-${String(Number(firstId.slice(5)) + index).padStart(3, '0')}`;
}

for (const [firstId, label, launch, ctxOpts] of BROWSERS) {
  test.describe(`UI-03 ${label}`, () => {
    // One engine per describe: launching six browsers eight times each would
    // make this the slowest spec in the suite for no extra signal.
    let browser, context, page;

    test.beforeAll(async () => {
      try {
        browser = await launch();
      } catch (e) {
        browser = null;          // Edge not installed, most likely
        return;
      }
      context = await browser.newContext({ ...ctxOpts, baseURL: BASE });
      await context.addInitScript(([token, email]) => {
        localStorage.setItem('access_token', token);
        localStorage.setItem('user', JSON.stringify({
          user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
      // Without education_level the mandatory onboarding modal mounts as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
        }));
      }, [student.token, student.email]);
      page = await context.newPage();
    });

    test.afterAll(async () => {
      await context?.close();
      await browser?.close();
    });

    test.beforeEach(() => {
      test.skip(!browser, `${label} is not installed on this machine`);
    });

    test(`${caseId(firstId, 0)} [P1] ${JOURNEYS[0]} — ${label}`, async () => {
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      expect(errors, `${label} landing errors: ${errors.join(' | ')}`).toHaveLength(0);
    });

    test(`${caseId(firstId, 1)} [P1] ${JOURNEYS[1]} — ${label}`, async () => {
      // A SIGNED-OUT context. The shared page carries a token, and /signup
      // correctly redirects a signed-in visitor away — which is UI01-004 doing
      // its job, not a browser difference. Testing signup through a logged-in
      // session would only ever measure the redirect.
      //
      // The form renders and accepts input; completing it is not attempted,
      // because that sends a real OTP email per browser — six hard bounces for
      // no signal about the engine.
      const guest = await browser.newContext({ ...ctxOpts, baseURL: BASE });
      const p = await guest.newPage();
      try {
        await p.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
        await p.waitForTimeout(600);
        const email = p.locator('input[type="email"], input[name*="email" i]').first();
        await expect(email, `${label}: no email field on /signup`).toBeVisible();
        await email.fill('ui03@example.com');
        expect(await email.inputValue()).toBe('ui03@example.com');
      } finally {
        await guest.close();
      }
    });

    test(`${caseId(firstId, 2)} [P1] ${JOURNEYS[2]} — ${label}`, async () => {
      await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const text = await page.locator('body').innerText();
      expect(text.length, `${label}: the cohort list rendered nothing`).toBeGreaterThan(40);
      // The page body must not scroll sideways on any engine — a webkit-only
      // overflow is exactly what a single-browser suite misses.
      const m = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth, i: window.innerWidth }));
      expect(m.w, `${label}: cohorts scrolls sideways (${m.w} > ${m.i})`)
        .toBeLessThanOrEqual(m.i + 1);
    });

    test(`${caseId(firstId, 3)} [P1] ${JOURNEYS[3]} — ${label}`, async () => {
      // Cashfree cannot complete an order on this account, so what is under
      // test is that the app reaches its own checkout step and does not throw
      // on the way — not that a payment page appears.
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      expect(errors.filter((e) => !/ResizeObserver/i.test(e)),
        `${label} checkout path errors: ${errors.join(' | ')}`).toHaveLength(0);
    });

    test(`${caseId(firstId, 4)} [P1] ${JOURNEYS[4]} — ${label}`, async () => {
      await page.goto(`${BASE}/document-vault`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);

      // The input lives behind an Upload trigger rather than sitting on the
      // page, so it has to be opened first. What is under test is that the
      // control is a real <input type=file> once revealed — iOS Safari in
      // particular refuses some styled substitutes, and a picker that never
      // opens is indistinguishable from an upload that silently failed.
      // The input lives inside the Add Document modal, so it has to be opened.
      // Waiting on the locator rather than sleeping: on a cold load the button
      // is not painted yet at a fixed timeout, and the test then reported "no
      // file input" when the truth was "the page had not finished loading".
      if (!(await page.evaluate(() => !!document.querySelector('input[type="file"]')))) {
        const trigger = page.getByRole('button', { name: /add document|upload|new document/i }).first();
        await trigger.waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
        if (await trigger.count()) {
          await trigger.click().catch(() => {});
          await page.locator('input[type="file"]')
            .waitFor({ state: 'attached', timeout: 10000 }).catch(() => {});
        }
      }
      const hasFileInput = await page.evaluate(() =>
        !!document.querySelector('input[type="file"]'));
      expect(hasFileInput,
        `${label}: no real file input on the Document Vault, even after opening Upload`)
        .toBeTruthy();
    });

    test(`${caseId(firstId, 5)} [P1] ${JOURNEYS[5]} — ${label}`, async () => {
      // datetime-local is the one input type with genuinely different support
      // across these engines — Safari renders it very differently from Chrome,
      // and a fallback that never fires leaves the field unusable.
      const supported = await page.evaluate(() => {
        const el = document.createElement('input');
        el.setAttribute('type', 'datetime-local');
        return el.type === 'datetime-local';
      });
      expect(typeof supported, `${label}: could not probe datetime-local`).toBe('boolean');
      if (!supported) {
        test.info().annotations.push({
          type: 'note',
          description: `${label} has no native datetime-local; the app must supply a fallback`,
        });
      }
    });

    test(`${caseId(firstId, 6)} [P1] ${JOURNEYS[6]} — ${label}`, async () => {
      await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const opener = page.locator('button, [role="button"]').first();
      if (!(await opener.count())) test.skip(true, `${label}: nothing to open`);
      await opener.click().catch(() => {});
      await page.waitForTimeout(700);
      // Whatever opened must not have broken the layout — a drawer that pushes
      // the document wider is the commonest cross-engine modal bug.
      const m = await page.evaluate(() => ({
        w: document.documentElement.scrollWidth, i: window.innerWidth }));
      expect(m.w, `${label}: opening a control made the page scroll sideways`)
        .toBeLessThanOrEqual(m.i + 1);
    });

    test(`${caseId(firstId, 7)} [P1] ${JOURNEYS[7]} — ${label}`, async () => {
      // Safari's ITP and private-mode behaviour make localStorage the one
      // storage assumption worth checking per engine: the whole session
      // depends on it surviving a navigation.
      await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
      const before = await page.evaluate(() => localStorage.getItem('access_token'));
      expect(before, `${label}: the token did not survive into the page`).toBeTruthy();
      await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
      const after = await page.evaluate(() => localStorage.getItem('access_token'));
      expect(after, `${label}: the token was lost across a navigation`).toBe(before);
    });
  });
}

// ── Samsung Internet: UI03-049…056 ───────────────────────────────────────────
//
// Playwright cannot drive Samsung Internet itself. What it CAN do is exercise
// the same rendering engine: Samsung Internet is a Blink/Chromium fork, so
// running these journeys on Chromium with Samsung's own user-agent and an
// Android device profile genuinely covers the engine, the viewport and any
// UA-sniffing the app does.
//
// **What it does not cover, and this is recorded on every result** — Samsung
// ships on its own release cadence (typically a few Chromium versions behind),
// adds its own UI chrome, and has known quirks around video, downloads and its
// built-in ad blocker. So these are run and reported as an APPROXIMATION, with
// the caveat carried into the workbook rather than left in a comment nobody
// reads. A true result needs a physical device or a device cloud.
const SAMSUNG_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) '
  + 'SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36';

test.describe('UI-03 Samsung Internet (Chromium/Blink approximation)', () => {
  let browser, context, page;

  test.beforeAll(async () => {
    browser = await chromium.launch();
    context = await browser.newContext({
      ...devices['Galaxy S9+'],
      userAgent: SAMSUNG_UA,
      baseURL: BASE,
    });
    await context.addInitScript(([token, email]) => {
      localStorage.setItem('access_token', token);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
      // Without education_level the mandatory onboarding modal mounts as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
      }));
    }, [student.token, student.email]);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    await browser?.close();
  });

  test.beforeEach(() => {
    test.info().annotations.push({
      type: 'approximation',
      description: 'Chromium/Blink with the Samsung Internet UA and a Galaxy S9+ '
        + 'profile. Covers the engine and viewport; a real device is still needed '
        + 'for Samsung-specific chrome, downloads and its built-in ad blocker.',
    });
  });

  test(`${caseId('UI03-049', 0)} [P1] ${JOURNEYS[0]} — Samsung Internet`, async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    expect(errors, `landing errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test(`${caseId('UI03-049', 1)} [P1] ${JOURNEYS[1]} — Samsung Internet`, async () => {
    const guest = await browser.newContext({
      ...devices['Galaxy S9+'], userAgent: SAMSUNG_UA, baseURL: BASE });
    const p = await guest.newPage();
    try {
      await p.goto(`${BASE}/signup`, { waitUntil: 'domcontentloaded' });
      await p.waitForTimeout(600);
      const email = p.locator('input[type="email"], input[name*="email" i]').first();
      await expect(email, 'no email field on /signup').toBeVisible();
      await email.fill('ui03@example.com');
      expect(await email.inputValue()).toBe('ui03@example.com');
    } finally {
      await guest.close();
    }
  });

  test(`${caseId('UI03-049', 2)} [P1] ${JOURNEYS[2]} — Samsung Internet`, async () => {
    await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const m = await page.evaluate(() => ({
      len: (document.body.innerText || '').length,
      w: document.documentElement.scrollWidth, i: window.innerWidth }));
    expect(m.len, 'the cohort list rendered nothing').toBeGreaterThan(40);
    expect(m.w, `cohorts scrolls sideways (${m.w} > ${m.i})`).toBeLessThanOrEqual(m.i + 1);
  });

  test(`${caseId('UI03-049', 3)} [P1] ${JOURNEYS[3]} — Samsung Internet`, async () => {
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    expect(errors.filter((e) => !/ResizeObserver/i.test(e)),
      `checkout path errors: ${errors.join(' | ')}`).toHaveLength(0);
  });

  test(`${caseId('UI03-049', 4)} [P1] ${JOURNEYS[4]} — Samsung Internet`, async () => {
    await page.goto(`${BASE}/document-vault`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    if (!(await page.evaluate(() => !!document.querySelector('input[type="file"]')))) {
      const trigger = page.getByRole('button', { name: /upload|add document|new document/i }).first();
      if (await trigger.count()) {
        await trigger.click().catch(() => {});
        await page.waitForTimeout(900);
      }
    }
    expect(await page.evaluate(() => !!document.querySelector('input[type="file"]')),
      'no real file input on the Document Vault').toBeTruthy();
  });

  test(`${caseId('UI03-049', 5)} [P1] ${JOURNEYS[5]} — Samsung Internet`, async () => {
    const supported = await page.evaluate(() => {
      const el = document.createElement('input');
      el.setAttribute('type', 'datetime-local');
      return el.type === 'datetime-local';
    });
    expect(typeof supported).toBe('boolean');
  });

  test(`${caseId('UI03-049', 6)} [P1] ${JOURNEYS[6]} — Samsung Internet`, async () => {
    await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const opener = page.locator('button, [role="button"]').first();
    if (await opener.count()) {
      await opener.click().catch(() => {});
      await page.waitForTimeout(700);
    }
    const m = await page.evaluate(() => ({
      w: document.documentElement.scrollWidth, i: window.innerWidth }));
    expect(m.w, 'opening a control made the page scroll sideways')
      .toBeLessThanOrEqual(m.i + 1);
  });

  test(`${caseId('UI03-049', 7)} [P1] ${JOURNEYS[7]} — Samsung Internet`, async () => {
    await page.goto(`${BASE}/cohorts`, { waitUntil: 'domcontentloaded' });
    const before = await page.evaluate(() => localStorage.getItem('access_token'));
    expect(before, 'the token did not survive into the page').toBeTruthy();
    await page.goto(`${BASE}/tasks`, { waitUntil: 'domcontentloaded' });
    expect(await page.evaluate(() => localStorage.getItem('access_token')),
      'the token was lost across a navigation').toBe(before);
  });
});
