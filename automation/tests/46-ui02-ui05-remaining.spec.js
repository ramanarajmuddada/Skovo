// The nine cases the other UI specs left with no test at all.
//
// Four are UI-02 "General UI" behaviours that need an interaction rather than a
// measurement (toasts, destructive confirmations, dialogs closing, contrast),
// and five are UI-05 performance numbers that need real instrumentation —
// PerformanceObserver for LCP and CLS, request counting for the list screens,
// and frame timing for a long list.
//
// Every one of them is measured on the running app. Where the sheet names a
// condition ("under 2.5 s on 4G", "a mid-range Android") the condition is
// imposed through CDP rather than assumed: an LCP measured over gigabit
// loopback and reported as a 4G result is a number nobody can act on.
const { test, expect } = require('@playwright/test');
const { provisionStudent, studentContext } = require('../utils/api');
const { CONTRAST_FN } = require('../utils/contrast');

let student;
test.beforeAll(async () => {
  // Prefer the seeded pro student: it carries the fixture cohort, enrolment and
  // task, so the interaction cases have something to act on. provisionStudent
  // is the fallback for a machine where seed_test_accounts.py has not been run.
  const seeded = await studentContext('pro').catch(() => null);
  if (seeded && seeded.token) {
    student = { token: seeded.token, email: seeded.email };
    await seeded.api.dispose().catch(() => {});
  } else {
    student = await provisionStudent();
  }
});

function seedStudent(page) {
  return page.addInitScript(([token, email]) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
      // Without education_level MainLayout mounts the onboarding modal as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
    }));
  }, [student.token, student.email]);
}

// Open the Add Document dialog and fill it. Scoped to the dialog throughout:
// the page's own "Add Document" button and the dialog's submit share an
// accessible name, and the first `input` in the document is the page search
// box, not the form's first field — both of which made an unscoped selector
// quietly act on the wrong control.
async function openAddDocument(page, name) {
  const trigger = page.getByRole('button', { name: /add document|new document/i }).first();
  await trigger.waitFor({ state: 'visible', timeout: 15000 });
  await trigger.click();
  const dialog = page.locator('[role="dialog"]').last();
  await dialog.waitFor({ state: 'visible', timeout: 8000 });
  await dialog.getByRole('textbox').first().fill(name);
  await dialog.locator('input[type="url"]').first().fill('https://example.com/probe.pdf');
  return dialog;
}

async function submitDocument(dialog) {
  // "Add Document" inside the dialog, or "Save Changes" when editing.
  await dialog.getByRole('button', { name: /add document|save changes/i }).last().click();
}

// ── UI-02 General UI ─────────────────────────────────────────────────────────
test.describe('UI-02 general UI, remaining', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedStudent(page);
  });

  test('UI02-157 [P1] a failed action toasts the server own message', async ({ page }) => {
    // The expected result is specific: the failure text comes from the SERVER,
    // not from a generic client string. So the route answers with a recognisable
    // message and the toast has to carry it through unchanged.
    const MARKER = 'Server said this exact thing';
    await page.route('**/v1/document-vault/**', async (route) => {
      if (route.request().method() === 'POST') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ bool: false, response: { message: MARKER } }),
        });
      }
      return route.continue();
    });

    await page.goto('/document-vault', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1800);

    const dialog = await openAddDocument(page, 'UI02-157 Toast Probe');
    await submitDocument(dialog);
    await page.waitForTimeout(1800);

    const text = await page.locator('body').innerText();
    await page.unroute('**/v1/document-vault/**');
    expect(text.includes(MARKER),
      'the failure message shown was not the server one — a generic string was substituted')
      .toBeTruthy();
  });

  test('UI02-159 [P1] a destructive action asks first and names what it affects',
    async ({ page }) => {
      await page.goto('/document-vault', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1600);

      const PROBE = 'UI02-159 Confirm Probe';
      // Create a row to delete, so the case does not depend on the account
      // already holding a document.
      const dialog = await openAddDocument(page, PROBE);
      await submitDocument(dialog);
      await page.waitForTimeout(2200);

      const del = page.getByRole('button', { name: /delete/i }).first();
      if (!(await del.count())) test.skip(true, 'no delete control reachable');
      await del.click().catch(() => {});
      await page.waitForTimeout(900);

      const confirm = await page.evaluate((probe) => {
        const t = document.body.innerText || '';
        return {
          asks: /are you sure|cannot be undone|permanently|confirm/i.test(t),
          // "names what will be affected" — the row's own name has to appear in
          // the confirmation, not just a bare "Delete this?".
          names: t.includes(probe),
        };
      }, PROBE);

      // Back out first: this case must not actually destroy anything.
      await page.getByRole('button', { name: /cancel|keep|dismiss|no,/i }).first()
        .click().catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});

      expect(confirm.asks, 'a delete went straight through with no confirmation step')
        .toBeTruthy();
      expect(confirm.names,
        'the confirmation does not name the document being deleted, so it is easy to '
        + 'confirm against the wrong row').toBeTruthy();
    });

  test('UI02-160 [P1] a dialog closes once its action succeeds', async ({ page }) => {
    await page.goto('/document-vault', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1600);

    const dialog = await openAddDocument(page, 'UI02-160 Dialog Probe');
    expect(await dialog.count(), 'the Add Document dialog never opened').toBeGreaterThan(0);
    await submitDocument(dialog);
    await page.waitForTimeout(2500);

    const stillOpen = await page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return false;
      return getComputedStyle(d).display !== 'none' && d.getClientRects().length > 0;
    });
    expect(stillOpen,
      'the dialog stayed open after a successful save, so the user cannot tell it worked')
      .toBeFalsy();
  });

  test('UI02-165 [P1] body text meets WCAG AA against its real background',
    async ({ page }) => {
      const ROUTES = ['/career-path', '/cohorts', '/payments', '/document-vault'];
      const failures = [];
      for (const route of ROUTES) {
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(1400);
        const bad = await page.evaluate(`(() => {
          ${CONTRAST_FN}
          const out = [];
          const seen = new Set();
          for (const el of document.querySelectorAll(
                 'p, span, td, th, li, a, button, h1, h2, h3, h4, label')) {
            const text = (el.textContent || '').trim();
            if (!text || el.children.length) continue;          // leaf text only
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const cs = getComputedStyle(el);
            if (cs.visibility === 'hidden' || cs.display === 'none') continue;
            if (parseFloat(cs.opacity) < 0.1) continue;
            const fg = _parse(cs.color);
            if (!fg) continue;
            const bg = _bgOf(el);
            // The text colour's own alpha is composited too, for the same
            // reason the background's is: a 60%-alpha grey is not that grey.
            const a = fg[3];
            const solidFg = [fg[0] * a + bg[0] * (1 - a),
                             fg[1] * a + bg[1] * (1 - a),
                             fg[2] * a + bg[2] * (1 - a)];
            const size = parseFloat(cs.fontSize);
            const bold = parseInt(cs.fontWeight, 10) >= 700;
            // WCAG AA: 3:1 for large text (24px, or 18.66px bold), else 4.5:1.
            const need = (size >= 24 || (bold && size >= 18.66)) ? 3 : 4.5;
            const ratio = _ratio(solidFg, bg);
            if (ratio + 0.05 < need) {
              const key = cs.color + '|' + text.slice(0, 20);
              if (seen.has(key)) continue;
              seen.add(key);
              out.push(text.slice(0, 24) + ' -> ' + ratio.toFixed(2) + ':1 (needs ' + need + ')');
            }
          }
          return out.slice(0, 6);
        })()`);
        if (bad.length) failures.push(`${route}: ${bad.join(' | ')}`);
      }
      expect(failures, `text below WCAG AA — ${failures.join(' || ')}`).toHaveLength(0);
    });
});

// ── UI-05 performance ────────────────────────────────────────────────────────
const FOUR_G = {
  offline: false,
  downloadThroughput: (4 * 1024 * 1024) / 8,    // 4 Mbps
  uploadThroughput: (3 * 1024 * 1024) / 8,
  latency: 80,                                   // ms RTT
};

async function throttle(page, cpuRate = 1) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', FOUR_G);
  if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate });
  return cdp;
}

// Installed before navigation so the observers are live for the first paint.
const PERF_INIT = () => {
  window.__perf = { lcp: 0, cls: 0, fcp: 0 };
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) window.__perf.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
  } catch { /* unsupported */ }
  try {
    new PerformanceObserver((l) => {
      for (const e of l.getEntries()) {
        if (e.name === 'first-contentful-paint') window.__perf.fcp = e.startTime;
      }
    }).observe({ type: 'paint', buffered: true });
  } catch { /* unsupported */ }
};

// The built bundle, not the dev server.
//
// `npm run dev` ships hundreds of unbundled ES modules — several hundred
// requests for one page — so an LCP measured there is a number about Vite's
// module graph, not about anything a user will ever load. The sheet says
// "measure with DevTools / Lighthouse", which means the production artefact.
//
//   Skovo> npx vite build
//   Skovo> npx vite preview --port 4173      (proxies /v1 to the API)
//
// If the preview server is not up these two cases skip with that instruction
// rather than reporting a dev-server number as if it were the product.
const PERF_BASE = process.env.SKOVO_PERF_BASE || 'http://127.0.0.1:4173';

async function previewUp(page) {
  const res = await page.request.get(PERF_BASE + '/').catch(() => null);
  return !!res && res.ok();
}

test.describe('UI-05 performance', () => {
  test('UI05-001 [P1] the landing page reaches LCP inside 2.5 s on 4G', async ({ page }) => {
    if (!(await previewUp(page))) {
      test.skip(true, `no build being served at ${PERF_BASE} — run: npx vite build && npx vite preview --port 4173`);
    }
    await page.addInitScript(PERF_INIT);
    const cdp = await throttle(page);
    await page.goto(PERF_BASE + '/', { waitUntil: 'load' });
    // LCP is only final once the page settles; give the largest element time to
    // arrive over the throttled link before reading it.
    await page.waitForTimeout(3500);
    const lcp = await page.evaluate(() => window.__perf.lcp);
    await cdp.detach().catch(() => {});
    expect(lcp, 'no LCP entry was recorded at all').toBeGreaterThan(0);
    expect(lcp, `landing LCP was ${Math.round(lcp)} ms on a 4 Mbps / 80 ms link`)
      .toBeLessThan(2500);
  });

  test('UI05-002 [P1] the dashboard paints structure in 1 s and content in 3 s',
    async ({ page }) => {
      if (!(await previewUp(page))) {
        test.skip(true, `no build being served at ${PERF_BASE} — run: npx vite build && npx vite preview --port 4173`);
      }
      await seedStudent(page);
      await page.addInitScript(PERF_INIT);
      const cdp = await throttle(page);

      const started = Date.now();
      await page.goto(PERF_BASE + '/career-path', { waitUntil: 'domcontentloaded' });

      // "Skeleton within 1 s" — something structural on screen, not a blank page.
      await page.waitForSelector(
        '[class*="skeleton" i], [class*="animate-pulse"], main, [role="main"]',
        { state: 'attached', timeout: 5000 });
      const skeletonAt = Date.now() - started;

      // "Content within 3 s" — real text, not the shell.
      await page.waitForFunction(
        () => (document.querySelector('main')?.innerText || '').trim().length > 120,
        null, { timeout: 10000 });
      const contentAt = Date.now() - started;

      const fcp = await page.evaluate(() => window.__perf.fcp);
      await cdp.detach().catch(() => {});

      expect(skeletonAt, `first structure took ${skeletonAt} ms (FCP ${Math.round(fcp)} ms)`)
        .toBeLessThan(1000);
      expect(contentAt, `dashboard content took ${contentAt} ms on 4G`).toBeLessThan(3000);
    });

  test('UI05-003 [P0] the cohort list fires exactly one request per interaction',
    async ({ page }) => {
      // The same defect Colleges had: two effects both firing on mount, doubled
      // again by StrictMode. Counted per interaction, not in total — the mount
      // and the filter change are separate budgets.
      await seedStudent(page);
      const calls = [];
      page.on('request', (r) => {
        if (/\/v1\/cohorts\/?(\?|$)/.test(r.url())) calls.push(r.url());
      });

      await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(2500);
      const onMount = calls.length;
      expect(onMount, `mounting Cohorts fired ${onMount} list requests`).toBe(1);

      calls.length = 0;
      const filter = page.locator('select').first();
      if (await filter.count()) {
        const options = await filter.locator('option').count();
        if (options > 1) {
          await filter.selectOption({ index: 1 });
          await page.waitForTimeout(2000);
          expect(calls.length,
            `one filter change fired ${calls.length} list requests`).toBeLessThanOrEqual(1);
        }
      }
    });

  test('UI05-012 [P1] the dashboard settles with a cumulative layout shift near zero',
    async ({ page }) => {
      await seedStudent(page);
      await page.addInitScript(PERF_INIT);
      await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(4000);
      const cls = await page.evaluate(() => window.__perf.cls);
      // Google's "good" threshold. A skeleton that does not reserve the height
      // its content will take is what pushes this up, and it is why a tap lands
      // on the row below the one that was aimed at.
      expect(cls, `cumulative layout shift was ${cls.toFixed(3)} — skeletons are not `
        + 'reserving the height their content will take').toBeLessThan(0.1);
    });

  test('UI05-013 [P2] a long list scrolls without dropping frames on a throttled device',
    async ({ page }) => {
      await seedStudent(page);
      // 4x CPU throttling stands in for the mid-range Android the sheet names.
      const cdp = await throttle(page, 4);
      await page.goto('/cohorts?per_page=100', { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(3000);

      const rows = await page.evaluate(() =>
        document.querySelectorAll('tbody tr, [data-row]').length);

      const frames = await page.evaluate(async () => await new Promise((resolve) => {
        const times = [];
        let last = performance.now();
        let ticks = 0;
        function step() {
          const now = performance.now();
          times.push(now - last);
          last = now;
          window.scrollBy(0, 120);
          if (++ticks < 60) requestAnimationFrame(step);
          else resolve(times.slice(1));           // drop the first: it includes setup
        }
        requestAnimationFrame(step);
      }));
      await cdp.detach().catch(() => {});

      if (!frames.length) test.skip(true, 'no frames sampled');

      // Say how long the list actually was. The sheet says "a 500-row list" and
      // this environment does not have one — there are a dozen cohorts in the
      // database — so the annotation carries the real row count rather than
      // letting a green tick imply 500 rows were scrolled. What IS covered is
      // the frame budget under 4x CPU throttling on the real component; what is
      // not is whether the list stays smooth at 500 rows, which needs either a
      // fuller database or virtualisation and is worth re-running then.
      test.info().annotations.push({
        type: 'partial',
        description: `Measured over ${rows} rendered rows, not the 500 the case names — `
          + 'the cohort table is small in this environment. Re-run against a full '
          + 'list before relying on this for a long-list verdict.',
      });

      const sorted = [...frames].sort((a, b) => a - b);
      const p95 = sorted[Math.floor(sorted.length * 0.95)];
      // Two dropped frames at 60 Hz. Below this a scroll reads as smooth; above
      // it, it visibly stutters.
      expect(p95, `p95 frame time was ${p95.toFixed(1)} ms over ${rows} rows `
        + 'at 4x CPU throttling').toBeLessThan(34);
    });
});
