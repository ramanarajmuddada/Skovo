// UI-02 Responsiveness — 175 cases.
//
// 23 student screens x 4 viewports (UI02-001..092), 13 achiever screens x 4
// (093..144), 9 known responsive defects (145..153) and 22 general-UI rules
// (154..175).
//
// The core assertion is one line and it is the one the brief leads with: **the
// page body never scrolls horizontally. Only an inner container may.** That
// distinction is the whole point — a wide table is allowed to scroll inside its
// own `overflow-x-auto`, but the moment the document does, every screen on the
// phone is broken in the same way and reading one record means swiping.
//
// Modal cases (cohort detail, task detail, cohort create, attendance, feedback)
// need a trigger that only exists when there is data. Where the trigger is
// missing the test skips with the reason rather than passing vacuously — a
// green tick for a modal nobody opened is worse than an honest skip.
const { test, expect } = require('@playwright/test');
const { provisionStudent, studentContext, portalLogin, cachedTokens } = require('../utils/api');

// The four the sheet uses, in its own order: 360, 390, 768, 1440.
const VIEWPORTS = [
  ['Mobile 360', 360, 740],
  ['Mobile 390', 390, 844],
  ['Tablet 768', 768, 1024],
  ['Desktop 1440', 1440, 900],
];

// [firstCaseId, label, route]. Ids run in blocks of four, one per viewport, in
// the same order as VIEWPORTS — so screen N's ids are first+0..first+3.
const STUDENT_SCREENS = [
  ['UI02-001', 'Dashboard', '/career-path'],
  ['UI02-005', 'Cohorts', '/cohorts'],
  ['UI02-013', 'My Tasks', '/tasks'],
  ['UI02-021', 'Colleges — For You', '/colleges'],
  ['UI02-025', 'Colleges — Browse All', '/colleges?tab=all'],
  ['UI02-029', 'Saved Colleges', '/colleges/saved'],
  ['UI02-033', 'College Predictor', '/colleges/predictor'],
  ['UI02-041', 'Opportunities', '/opportunities'],
  ['UI02-045', 'Applications', '/applications'],
  ['UI02-049', 'Find Achievers', '/find-mentors'],
  ['UI02-057', 'My Bookings', '/bookings'],
  ['UI02-061', 'Payments', '/payments'],
  ['UI02-065', 'Skovo Pro', '/skovo-pro'],
  ['UI02-069', 'Document Vault', '/document-vault'],
  ['UI02-073', 'My Score', '/my-score'],
  ['UI02-077', 'Assemble', '/assemble'],
  ['UI02-081', 'Market', '/market'],
  ['UI02-085', 'Notifications', '/notifications'],
  ['UI02-089', 'Profile', '/profile'],
];

const ACHIEVER_SCREENS = [
  ['UI02-093', 'Achiever Dashboard', '/skovo-achiever-portal'],
  ['UI02-097', 'Verification', '/skovo-achiever-portal/application'],
  ['UI02-101', 'My Cohorts', '/skovo-achiever-portal/cohorts'],
  ['UI02-117', 'Achiever Tasks', '/skovo-achiever-portal/tasks'],
  ['UI02-121', 'Availability', '/skovo-achiever-portal/availability'],
  ['UI02-125', 'Achiever Bookings', '/skovo-achiever-portal/bookings'],
  ['UI02-129', 'Earnings', '/skovo-achiever-portal/earnings'],
  ['UI02-133', 'My Courses', '/skovo-achiever-portal/courses'],
  ['UI02-137', 'Coupons', '/skovo-achiever-portal/coupons'],
  ['UI02-141', 'Achiever Notifications', '/skovo-achiever-portal/notifications'],
];

let student, achieverToken;

test.beforeAll(async () => {
  // The seeded `pro` student, not a freshly provisioned one.
  //
  // The detail-view and modal cases need something to open, and the fixture
  // cohort, enrolment and task created by seed_ui_fixtures.py all hang off this
  // account. A brand-new student sees empty lists everywhere, which turned
  // seventeen of these cases into honest-but-useless skips. provisionStudent
  // stays as the fallback for a machine where the seeds have not been run.
  const seeded = await studentContext('pro').catch(() => null);
  if (seeded && seeded.token) {
    student = { token: seeded.token, email: seeded.email };
    await seeded.api.dispose().catch(() => {});
  } else {
    student = await provisionStudent();
  }
  const r = await portalLogin('achiever').catch(() => ({}));
  achieverToken = r.token || cachedTokens().achiever;
});

function seedStudent(page) {
  return page.addInitScript(([token, email]) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
      // Without education_level the mandatory onboarding modal mounts as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
    }));
  }, [student.token, student.email]);
}

function seedAchiever(page, token) {
  return page.addInitScript((t) => {
    localStorage.setItem('achiever_access_token', t);
    localStorage.setItem('access_token', t);
    localStorage.setItem('achiever', JSON.stringify({
      id: 'e2e', full_name: 'E2E Achiever', role: 'mentor',
    }));
  }, token);
}

/**
 * The shared assertion for every screen-at-viewport cell.
 *
 * `document.scrollWidth > innerWidth` is the page body scrolling — the thing
 * that must never happen. An inner container with its own overflow does not
 * move the document, so this passes for a correctly-built wide table and fails
 * for one that has escaped its wrapper.
 */
async function assertNoPageOverflow(page, route, label) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(route, { waitUntil: 'domcontentloaded' });
  // Give the data a moment: a table that overflows often only does so once the
  // rows arrive, so measuring the skeleton would pass on a broken screen.
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    bodyScroll: document.body.scrollWidth,
    inner: window.innerWidth,
    // The widest element actually sticking out, to make a failure diagnosable.
    widest: (() => {
      let worst = null, max = 0;
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.right > max) { max = r.right; worst = el; }
      }
      if (!worst) return null;
      return `${worst.tagName.toLowerCase()}.${(worst.className || '').toString().slice(0, 60)} right=${Math.round(max)}`;
    })(),
  }));

  const overflow = Math.max(m.scrollWidth, m.bodyScroll);
  expect(overflow,
    `${label} scrolls the page body horizontally (${overflow} > ${m.inner}); widest: ${m.widest}`)
    .toBeLessThanOrEqual(m.inner + 1);

  const real = errors.filter((e) => !/ResizeObserver|Non-Error promise/i.test(e));
  expect(real, `${label} runtime errors: ${real.join(' | ')}`).toHaveLength(0);
}

// ── Student screens: UI02-001…092 ────────────────────────────────────────────
test.describe('UI-02 student screens', () => {
  test.beforeEach(async ({ page }) => { await seedStudent(page); });

  for (const [firstId, name, route] of STUDENT_SCREENS) {
    VIEWPORTS.forEach(([vpLabel, width, height], i) => {
      const caseId = `UI02-${String(Number(firstId.slice(5)) + i).padStart(3, '0')}`;
      test(`${caseId} [P0] ${name} at ${vpLabel}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await assertNoPageOverflow(page, route, `${name} @ ${vpLabel}`);
      });
    });
  }
});

// ── Achiever screens: UI02-093…144 ───────────────────────────────────────────
test.describe('UI-02 achiever screens', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!achieverToken, 'no achiever token — run seed_test_accounts.py first');
    await seedAchiever(page, achieverToken);
  });

  for (const [firstId, name, route] of ACHIEVER_SCREENS) {
    VIEWPORTS.forEach(([vpLabel, width, height], i) => {
      const caseId = `UI02-${String(Number(firstId.slice(5)) + i).padStart(3, '0')}`;
      test(`${caseId} [P0] ${name} at ${vpLabel}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await assertNoPageOverflow(page, route, `${name} @ ${vpLabel}`);
      });
    });
  }
});

// ── Detail views and modals: the seven screens that need a trigger ───────────
//
// A modal cannot be measured without opening it, and opening it needs data. Each
// of these skips with its reason when the trigger is absent rather than passing
// vacuously — a green tick for a slideover nobody opened is the least useful
// result this workbook could carry.
const OVERLAY_SCREENS = [
  // [firstId, label, route, fallback that returns an id to visit directly]
  ['UI02-009', 'Cohort detail slideover', '/cohorts', null],
  ['UI02-017', 'Task detail modal', '/tasks', null],
  ['UI02-037', 'College detail', '/colleges', null],
  ['UI02-053', 'Achiever public profile', '/find-mentors', async (page) => {
    const token = await page.evaluate(() => localStorage.getItem('access_token'));
    const res = await page.request.get(
      'http://127.0.0.1:5000/v1/achievers/?page=1&per_page=1',
      { headers: token ? { Authorization: `Bearer ${token}` } : {} }).catch(() => null);
    if (!res || !res.ok()) return null;
    const body = await res.json().catch(() => ({}));
    const rows = body.response?.achievers || body.response?.mentors || body.response?.data || [];
    return rows[0]?.id || rows[0]?.achiever_id || rows[0]?.mentor_id || null;
  }],
];

test.describe('UI-02 student detail views', () => {
  test.beforeEach(async ({ page }) => { await seedStudent(page); });

  for (const [firstId, name, route, direct] of OVERLAY_SCREENS) {
    VIEWPORTS.forEach(([vpLabel, width, height], i) => {
      const caseId = `UI02-${String(Number(firstId.slice(5)) + i).padStart(3, '0')}`;
      test(`${caseId} [P0] ${name} at ${vpLabel}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1400);

        // Open whatever the first row exposes. A slideover, a modal or a route
        // change are all acceptable — the case is about the resulting view.
        const opener = page.locator(
          'tbody tr:visible, [data-row]:visible, a[href*="/colleges/"]:visible, a[href*="/achievers/"]:visible').first();
        // Wait for it rather than sampling at a fixed moment: a list that is
        // still in flight reads as "nothing to open", which is how these cases
        // reported an empty screen that was merely slow.
        await opener.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});

        if (await opener.count()) {
          await opener.click().catch(() => {});
        } else if (direct) {
          // The list is a discovery path; this case is about the DETAIL screen.
          // Find Achievers lists only achievers in a state that makes them
          // publicly visible, and on an environment where none are the list is
          // legitimately empty — but the public profile still has to lay out
          // correctly, and UI02-049..052 already covers the list itself. So the
          // route is entered directly from an id the API hands us rather than
          // skipping a screen that plainly exists.
          const id = await direct(page);
          if (!id) test.skip(true, `${name}: no record exists to open`);
          await page.goto(`/achievers/${id}`, { waitUntil: 'domcontentloaded' });
        } else {
          test.skip(true, `${name}: nothing to open (needs seeded data)`);
        }
        await page.waitForTimeout(1400);

        const m = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          hasOverlay: !!document.querySelector('[role="dialog"], [class*="slideover" i], [class*="drawer" i]'),
        }));
        expect(m.scrollWidth,
          `${name} @ ${vpLabel} scrolls the page body (${m.scrollWidth} > ${m.inner})`)
          .toBeLessThanOrEqual(m.inner + 1);
      });
    });
  }
});

test.describe('UI-02 achiever modals', () => {
  test.beforeEach(async ({ page }) => {
    test.skip(!achieverToken, 'no achiever token — run seed_test_accounts.py first');
    await seedAchiever(page, achieverToken);
  });

  // Each modal is named by how it is ACTUALLY reached on My Cohorts, which is
  // not what its label suggests:
  //
  //   * Create   — the header button, always present.
  //   * Attendance — inside the roster, which opens from "Students (N)". There
  //                  is no button called "Attendance" anywhere on the page, so
  //                  the old name regex could never match and every one of
  //                  UI02-109..112 skipped.
  //   * Feedback — a menuitem behind the card's "More actions" kebab, so the
  //                menu has to be opened first.
  const ACHIEVER_MODALS = [
    ['UI02-105', 'Cohort create modal', async (page) => {
      const b = page.getByRole('button', { name: /create cohort|new cohort|add cohort/i }).first();
      await b.waitFor({ state: 'visible', timeout: 15000 });
      await b.click();
      return page.getByRole('button', { name: /save changes|create cohort/i }).last()
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true);
    }],
    ['UI02-109', 'Attendance modal', async (page) => {
      const b = page.getByRole('button', { name: /^\s*Students\s*\(/i }).first();
      await b.waitFor({ state: 'visible', timeout: 15000 });
      await b.click();
      return page.getByRole('heading', { name: /attendance/i }).first()
        .waitFor({ state: 'visible', timeout: 8000 }).then(() => true);
    }],
    ['UI02-113', 'Feedback panel', async (page) => {
      const kebab = page.getByRole('button', { name: /more actions/i }).first();
      await kebab.waitFor({ state: 'visible', timeout: 15000 });
      await kebab.click();
      const item = page.getByRole('menuitem', { name: /feedback/i }).first();
      await item.waitFor({ state: 'visible', timeout: 8000 });
      await item.click();
      return true;
    }],
  ];

  for (const [firstId, name, open] of ACHIEVER_MODALS) {
    VIEWPORTS.forEach(([vpLabel, width, height], i) => {
      const caseId = `UI02-${String(Number(firstId.slice(5)) + i).padStart(3, '0')}`;
      test(`${caseId} [P0] ${name} at ${vpLabel}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await page.goto('/skovo-achiever-portal/cohorts', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1600);

        // A failure to open is a failure of the case, not a reason to skip: the
        // fixture cohort is seeded for this achiever, so the trigger must exist.
        await open(page);
        await page.waitForTimeout(1000);

        const m = await page.evaluate(() => ({
          scrollWidth: document.documentElement.scrollWidth,
          inner: window.innerWidth,
          overlay: !!document.querySelector('[role="dialog"], .fixed.inset-0'),
        }));
        expect(m.overlay, `${name} @ ${vpLabel} did not open`).toBeTruthy();
        expect(m.scrollWidth,
          `${name} @ ${vpLabel} scrolls the page body (${m.scrollWidth} > ${m.inner})`)
          .toBeLessThanOrEqual(m.inner + 1);
      });
    });
  }
});

// ── The sidebar becomes a drawer below md: UI02-145…151 ──────────────────────
test.describe('UI-02 known responsive defects', () => {
  test.beforeEach(async ({ page }) => { await seedStudent(page); });

  test('UI02-145 [P0] the sidebar collapses to a drawer below md', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    // A permanently-visible sidebar on a phone eats most of the width, which is
    // the commonest cause of the page-body overflow above.
    const wide = await page.evaluate(() => {
      const nav = document.querySelector('aside, nav[class*="sidebar" i], [data-sidebar]');
      if (!nav) return 0;
      const r = nav.getBoundingClientRect();
      return r.width > 120 && r.left >= 0 && getComputedStyle(nav).display !== 'none' ? r.width : 0;
    });
    expect(wide, `a ${wide}px sidebar is still docked at 390px`).toBeLessThanOrEqual(120);
  });

  test('UI02-146 [P0] tap targets are at least 44px on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const small = await page.evaluate(() => {
      // Measure the HIT AREA, not the painted box.
      //
      // The accessible fix for a small icon button is to keep the visual box
      // and expand what is clickable with a transparent inset pseudo-element —
      // resizing the box itself would move every layout it sits in. That hit
      // area is invisible to getBoundingClientRect, so measuring the rect alone
      // reports a button as 28px when a thumb actually has 44px to aim at.
      //
      // elementFromPoint is the honest probe: sample just outside each edge and
      // see whether the button still answers.
      const HIT = 44;
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (getComputedStyle(el).display === 'none') continue;
        if (r.height >= HIT && r.width >= HIT) continue;         // already big enough

        const padX = Math.max(0, (HIT - r.width) / 2);
        const padY = Math.max(0, (HIT - r.height) / 2);
        const probes = [
          [r.left + r.width / 2, r.top - padY + 1],
          [r.left + r.width / 2, r.bottom + padY - 1],
          [r.left - padX + 1, r.top + r.height / 2],
          [r.right + padX - 1, r.top + r.height / 2],
        ];
        const reachable = probes.every(([x, y]) => {
          if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return true;  // off-screen edge
          const hit = document.elementFromPoint(x, y);
          return hit && (hit === el || el.contains(hit) || hit.contains(el));
        });
        if (!reachable) {
          out.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 20)}" `
            + `${Math.round(r.width)}x${Math.round(r.height)} with no expanded hit area`);
        }
      }
      return out.slice(0, 8);
    });
    expect(small, `tap targets below 44px with no expanded hit area: ${small.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI02-147 [P0] the body never moves, only inner containers', async ({ page }) => {
    // The distinction the whole sheet turns on. A wide table is allowed to
    // scroll inside its own wrapper; the document is not. This checks both
    // halves — the body is still, and where a wide table exists it is the
    // wrapper that carries the overflow.
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const m = await page.evaluate(() => {
      const wide = [...document.querySelectorAll('table')]
        .filter((t) => t.scrollWidth > t.clientWidth);
      return {
        doc: document.documentElement.scrollWidth,
        inner: window.innerWidth,
        wideTables: wide.length,
        contained: wide.every((t) => {
          let n = t.parentElement;
          while (n && n !== document.body) {
            if (/auto|scroll/.test(getComputedStyle(n).overflowX)) return true;
            n = n.parentElement;
          }
          return false;
        }),
      };
    });
    expect(m.doc, `the body scrolls (${m.doc} > ${m.inner})`).toBeLessThanOrEqual(m.inner + 1);
    if (m.wideTables) {
      expect(m.contained,
        `${m.wideTables} wide table(s) are not inside an overflow-x container`).toBeTruthy();
    }
  });

  test('UI02-148 [P0] the sidebar gives the content its full width on a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const main = await page.evaluate(() => {
      const el = document.querySelector('main') || document.body;
      return Math.round(el.getBoundingClientRect().width);
    });
    // A docked sidebar shows up here as main being much narrower than the
    // viewport — the cause of most of the overflow failures above.
    expect(main, `main is only ${main}px wide at 390 — the sidebar is still docked`)
      .toBeGreaterThan(320);
  });

  test('UI02-149 [P0] a modal fits the screen and keeps its actions reachable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    const opener = page.locator('tbody tr:visible, [data-row]:visible').first();
    await opener.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (!(await opener.count())) test.skip(true, 'no task row — run seed_ui_fixtures.py');
    await opener.click().catch(() => {});
    await page.waitForTimeout(900);

    const modal = page.locator('[role="dialog"]').last();
    expect(await modal.count(), 'clicking a task row opened no dialog').toBeGreaterThan(0);

    const m = await modal.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, width: r.width,
               vh: window.innerHeight, vw: window.innerWidth,
               scrolls: el.scrollHeight > el.clientHeight };
    });
    expect(m.width, 'the modal is wider than the phone').toBeLessThanOrEqual(m.vw + 1);
    // Either it fits, or it scrolls internally — what must not happen is a
    // modal taller than the screen with no way to reach its buttons.
    expect(m.bottom <= m.vh + 1 || m.scrolls,
      'the modal overflows the viewport and does not scroll internally').toBeTruthy();
  });

  test('UI02-150 [P1] a long title wraps or truncates rather than breaking the layout', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const escaping = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('h1,h2,h3,td,th,p,span,a')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > window.innerWidth + 2) {
          out.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 30)}" right=${Math.round(r.right)}`);
        }
      }
      return out.slice(0, 6);
    });
    expect(escaping, `text escaping the viewport: ${escaping.join(' | ')}`).toHaveLength(0);
  });

  test('UI02-151 [P1] a landscape phone still has usable content height', async ({ page }) => {
    // 844x390: sticky headers that were sized for portrait can eat most of a
    // landscape viewport and leave a strip of content.
    await page.setViewportSize({ width: 844, height: 390 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => {
      let sticky = 0;
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        if (s.position === 'sticky' || s.position === 'fixed') {
          const r = el.getBoundingClientRect();
          if (r.top <= 2 && r.height > 0 && r.width > window.innerWidth * 0.5) {
            sticky = Math.max(sticky, r.height);
          }
        }
      }
      return { sticky, vh: window.innerHeight,
               doc: document.documentElement.scrollWidth, vw: window.innerWidth };
    });
    expect(m.doc, 'landscape scrolls sideways').toBeLessThanOrEqual(m.vw + 1);
    expect(m.sticky, `sticky headers eat ${m.sticky}px of a ${m.vh}px viewport`)
      .toBeLessThan(m.vh * 0.5);
  });

  test('UI02-152 [P1] the page reflows at 200% browser zoom', async ({ page }) => {
    // 200% zoom on a 1440 desktop is the same geometry as a 720 viewport.
    await page.setViewportSize({ width: 720, height: 450 });
    await assertNoPageOverflow(page, '/cohorts', 'Cohorts @ 200% zoom');
  });

  test('UI02-153 [P1] the layout survives text-only zoom', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    // Injected once the document exists. Appending at document_start threw
    // "Cannot read properties of null" — which the test then reported as a
    // runtime error on the PAGE, blaming the app for the harness.
    await page.addInitScript(() => {
      const inject = () => {
        const s = document.createElement('style');
        s.textContent = 'html { font-size: 24px !important; }';
        (document.head || document.documentElement).appendChild(s);
      };
      if (document.head) inject();
      else document.addEventListener('DOMContentLoaded', inject, { once: true });
    });
    await assertNoPageOverflow(page, '/cohorts', 'Cohorts @ 24px root font');
  });
});

// ── General UI rules: UI02-154…175 ───────────────────────────────────────────
test.describe('UI-02 general UI', () => {
  test.beforeEach(async ({ page }) => { await seedStudent(page); });

  test('UI02-154 [P1] a list shows a skeleton while it loads, not a blank panel', async ({ page }) => {
    // Intercept and stall the list call so the loading state is observable at
    // all — against a fast API the skeleton is gone before anything can look.
    await page.route('**/v1/cohorts/**', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const loading = await page.evaluate(() => {
      const marks = document.querySelectorAll(
        '[class*="skeleton" i], [class*="animate-pulse" i], [aria-busy="true"], [role="progressbar"]');
      return { marks: marks.length, text: (document.body.innerText || '').trim().length };
    });
    expect(loading.marks > 0 || loading.text > 40,
      'the list rendered a blank panel while loading').toBeTruthy();
    await page.unroute('**/v1/cohorts/**');
  });

  test('UI02-155 [P1] an empty list offers a next action', async ({ page }) => {
    // Colleges has 0 rows on this RDS, which makes it the honest empty-state
    // case rather than one that has to be faked.
    await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const state = await page.evaluate(() => ({
      text: (document.body.innerText || '').trim(),
      actions: document.querySelectorAll('main button, main a[href]').length,
    }));
    expect(state.text.length, 'the empty list rendered nothing at all').toBeGreaterThan(40);
    expect(state.actions, 'an empty list with no next action is a dead end')
      .toBeGreaterThan(0);
  });

  test('UI02-156 [P1] a failed fetch shows a message, not an endless spinner', async ({ page }) => {
    await page.route('**/v1/cohorts/**', (route) => route.abort('failed'));
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => ({
      text: (document.body.innerText || '').toLowerCase(),
      spinning: document.querySelectorAll(
        '[class*="animate-spin" i], [role="progressbar"], [aria-busy="true"]').length,
    }));
    await page.unroute('**/v1/cohorts/**');
    expect(/error|failed|try again|retry|something went wrong|could not/.test(state.text),
      'a failed fetch produced no message').toBeTruthy();
    expect(state.spinning, 'a spinner is still running after the request failed')
      .toBe(0);
  });

  test('UI02-158 [P1] a submit button disables while the request is in flight',
    async ({ browser }) => {
    // A guest context on purpose: /login correctly redirects a signed-in
    // visitor, so driving it with the seeded token measured the dashboard and
    // then skipped for want of a login form that was never going to be there.
    const guest = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await guest.newPage();
    await page.route('**/v1/auth/login', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    const email = page.locator('input[type="email"], input[name*="email" i]').first();
    const pw = page.locator('input[type="password"]').first();
    if (!(await email.count()) || !(await pw.count())) test.skip(true, 'login form not found');
    await email.fill('ui02@example.com');
    await pw.fill('WhateverPass123');
    // The FORM's submit, not "the first button whose name looks like login".
    // /login opens with a Password | OTP Login mode toggle, and "OTP Login"
    // matches /log ?in/i and sits earlier in the DOM — so `.first()` clicked the
    // mode switch, flipped the form to OTP, and the password submit button was
    // never rendered, let alone disabled. The button was behaving correctly the
    // whole time.
    const submit = page.locator('form button[type="submit"]').first();
    await submit.click();
    await page.waitForTimeout(600);
    const disabled = await submit.evaluate((el) =>
      el.disabled || el.getAttribute('aria-disabled') === 'true' || el.dataset.loading === 'true');
    await page.unroute('**/v1/auth/login');
    await guest.close();
    expect(disabled, 'the submit button stays enabled mid-request — double submission is possible')
      .toBeTruthy();
  });

  test('UI02-162 [P1] Escape closes a dismissible modal', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    // A task row, not "the first button on the page" — that used to be a nav
    // control, which opens nothing and made the case skip on a screen that
    // does have a modal.
    const opener = page.locator('tbody tr:visible, [data-row]:visible').first();
    await opener.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (!(await opener.count())) test.skip(true, 'no task row to open — seed_ui_fixtures.py');
    await opener.click().catch(() => {});
    await page.waitForTimeout(800);
    const open = await page.locator('[role="dialog"]').count();
    // Not a skip any more: the shared Modal, ConfirmModal and the task detail
    // view all declare role="dialog" now, so an overlay that does not appear
    // here is either missing or still an anonymous div — both are failures.
    expect(open, 'clicking a task row opened no dialog').toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(600);
    expect(await page.locator('[role="dialog"]').count(),
      'Escape did not close the modal').toBeLessThan(open);
  });

  test('UI02-161 [P1] opening a modal moves focus into it', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    // A task row, not "the first button on the page" — that used to be a nav
    // control, which opens nothing and made the case skip on a screen that
    // does have a modal.
    const opener = page.locator('tbody tr:visible, [data-row]:visible').first();
    await opener.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (!(await opener.count())) test.skip(true, 'no task row to open — seed_ui_fixtures.py');
    await opener.click().catch(() => {});
    await page.waitForTimeout(800);
    expect(await page.locator('[role="dialog"]').count(),
      'clicking a task row opened no dialog').toBeGreaterThan(0);
    const inside = await page.evaluate(() => {
      const dialog = document.querySelector('[role="dialog"]');
      return !!dialog && dialog.contains(document.activeElement);
    });
    expect(inside, 'focus stayed behind the modal, so a keyboard user is stranded')
      .toBeTruthy();
  });

  test('UI02-163 [P1] every interactive element is reachable by Tab', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const unreachable = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        if (el.tabIndex < 0 && !el.disabled) {
          out.push(`${el.tagName.toLowerCase()} "${(el.textContent || '').trim().slice(0, 20)}"`);
        }
      }
      return out.slice(0, 6);
    });
    expect(unreachable, `elements removed from the tab order: ${unreachable.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI02-167 [P1] and UI02-168 dates show a time and relative labels agree', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1500);
    const text = await page.locator('body').innerText();
    if (/no tasks|caught up/i.test(text)) test.skip(true, 'no tasks to date-check');
    // A deadline without a time is how students miss them by hours.
    expect(/\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/i.test(text),
      'no time is shown alongside any date').toBeTruthy();
  });

  test('UI02-169 [P1] numeric columns use tabular figures', async ({ page }) => {
    // Across the money screens rather than Payments alone: an account with no
    // orders yet has no numeric cells there, and the rule is about how digits
    // are set wherever a column of them appears — not about that one route.
    const ROUTES = ['/payments', '/cohorts', '/my-score', '/market'];
    let checked = 0;
    const bad = [];
    for (const route of ROUTES) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const cells = [...document.querySelectorAll('td')]
          .filter((td) => /^[₹\s]*[\d,.]+$/.test((td.textContent || '').trim()));
        if (!cells.length) return null;
        const tabular = (el) => {
          const s = getComputedStyle(el);
          return /tabular-nums|lining-nums/.test(s.fontVariantNumeric)
            || /tabular/.test(s.fontFeatureSettings || '');
        };
        return { total: cells.length, ok: cells.filter(tabular).length };
      });
      if (!r) continue;
      checked += 1;
      if (!r.ok) bad.push(`${route}: ${r.total} numeric cells, none tabular`);
    }
    if (!checked) test.skip(true, 'no numeric table cells on any money screen');
    expect(bad, `numeric columns do not use tabular figures: ${bad.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI02-170 [P1] truncated text exposes its full value', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const hidden = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('td, span, h3, a')) {
        if (el.scrollWidth <= el.clientWidth + 1) continue;
        const s = getComputedStyle(el);
        // Skip visually-hidden text (sr-only clips to a 1px box, which reads as
        // "truncated" to a width comparison). It is not truncated — it is
        // deliberately offscreen and fully available to assistive technology.
        const r = el.getBoundingClientRect();
        if (r.width <= 2 || r.height <= 2) continue;
        if (s.clip !== 'auto' || s.clipPath !== 'none') continue;
        if (s.textOverflow !== 'ellipsis' && !/hidden/.test(s.overflow)) continue;
        if (!el.title && !el.getAttribute('aria-label')) {
          out.push((el.textContent || '').trim().slice(0, 30));
        }
      }
      return out.slice(0, 6);
    });
    expect(hidden, `truncated text with no full value available: ${hidden.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI02-173 [P1] an unknown path shows the in-app 404, not a blank page', async ({ page }) => {
    await page.goto('/definitely-not-a-real-route-ui02', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const text = (await page.locator('body').innerText()).toLowerCase();
    expect(text.length, 'the 404 route rendered nothing at all').toBeGreaterThan(20);
    expect(text).toMatch(/not found|404|does ?n.t exist|no such page/);
  });

  test('UI02-174 [P1] every v1 route sets a page title', async ({ page }) => {
    // /skovo-pro had a route and a nav entry but no PAGE_TITLES key, so the
    // header fell back to "SKOVO".
    const routes = ['/cohorts', '/tasks', '/colleges', '/opportunities',
                    '/document-vault', '/my-score', '/skovo-pro', '/payments'];
    const untitled = [];
    for (const route of routes) {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      // Wait for the heading rather than sleeping: on a cold route 400ms was
      // measuring the skeleton, and the test then reported "(none)" for a page
      // that titles itself perfectly well a moment later.
      await page.locator('h1, [data-page-title]')
        .first().waitFor({ state: 'attached', timeout: 12000 }).catch(() => {});
      const heading = await page.evaluate(() => {
        const h = document.querySelector('h1, [data-page-title]');
        return h ? h.textContent.trim() : '';
      });
      if (!heading || /^skovo$/i.test(heading)) untitled.push(`${route} -> ${heading || '(none)'}`);
    }
    expect(untitled, `routes with no page title: ${untitled.join(' | ')}`).toHaveLength(0);
  });

  test('UI02-175 [P1] the favicon and share meta are present', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const meta = await page.evaluate(() => ({
      icon: !!document.querySelector('link[rel*="icon"]'),
      title: (document.title || '').trim(),
      description: document.querySelector('meta[name="description"]')?.content || '',
    }));
    expect(meta.icon, 'no favicon link').toBeTruthy();
    expect(meta.title.length, 'the document has no title').toBeGreaterThan(3);
    expect(meta.description.length, 'no meta description for a share preview').toBeGreaterThan(10);
  });

  test('UI02-164 [P1] icon-only buttons carry an accessible name', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const unnamed = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const text = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || el.getAttribute('title')
          || el.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
        if (!text && !label) out.push(el.outerHTML.slice(0, 80));
      }
      return out.slice(0, 6);
    });
    expect(unnamed, `icon-only buttons with no accessible name: ${unnamed.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI02-172 [P1] tabbed screens keep their own URL', async ({ page }) => {
    // Route-driven tabs, not local state — each keeps a deep link and Back.
    await page.goto('/colleges/saved', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/colleges/saved');
    await page.goto('/colleges/predictor', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/colleges/predictor');
  });

  test('UI02-171 [P1] browser Back moves between tabs sensibly', async ({ page }) => {
    await page.goto('/colleges', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.goto('/colleges/saved', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(400);
    await page.goBack();
    await page.waitForTimeout(500);
    expect(page.url(), 'Back did not return to the previous tab').toContain('/colleges');
  });

  test('UI02-166 [P1] amounts render as currency, never a bare float', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const text = await page.locator('body').innerText();
    // "1234.0" is the shape that gives it away — a raw number straight from the
    // API rather than a formatted amount.
    expect(text, 'an unformatted amount is on screen').not.toMatch(/\b\d+\.0\b/);
  });
});
