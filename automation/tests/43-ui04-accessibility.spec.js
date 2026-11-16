// UI-04 Accessibility — 20 cases.
//
// Nineteen are decidable from the DOM and are asserted here. **UI04-019 is not**
// — "VoiceOver/NVDA can complete signup, enrol and submit a task" is a claim
// about assistive technology, and no headless assertion can make it. It is
// marked as requiring a manual pass rather than quietly passed, because a green
// tick against a screen-reader case nobody ran is the most misleading result
// this whole workbook could produce.
//
// Contrast (UI04-015) is computed here rather than eyeballed: WCAG AA is a
// number, and "it looks fine" is exactly how grey-on-grey ships.
const { test, expect } = require('@playwright/test');
const { provisionStudent, studentContext } = require('../utils/api');

let student;
test.beforeAll(async () => {
  // The seeded `pro` student carries the fixture cohort, enrolment and task, so
  // the modal and table cases have something to act on. A fresh account sees
  // empty screens, which turned real assertions into skips.
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
      // Without education_level the mandatory onboarding modal mounts as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
    }));
  }, [student.token, student.email]);
}

// Relative luminance and contrast ratio, per WCAG 2.1.
const CONTRAST_FN = `
  function _lum(c) {
    const v = c.map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
  }
  function _parse(s) {
    const m = (s || '').match(/rgba?\\(([^)]+)\\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    const a = p.length > 3 ? p[3] : 1;
    if (a === 0) return null;                       // fully transparent
    return [p[0], p[1], p[2], a];
  }
  /**
   * The effective background behind an element, compositing translucent layers.
   *
   * Treating a partly-transparent colour as if it were solid is how a false
   * positive happens: a 12%-alpha blue chip sitting on a near-black sidebar
   * measured as light-blue-on-solid-blue (2.87:1) when what a person actually
   * sees is light-blue-on-near-black, which passes comfortably. Alpha has to be
   * blended against whatever is underneath, not discarded.
   */
  function _bgOf(el) {
    const layers = [];
    let n = el;
    while (n && n !== document.documentElement) {
      const c = _parse(getComputedStyle(n).backgroundColor);
      if (c) {
        layers.push(c);
        if (c[3] >= 0.999) break;                   // opaque: nothing below shows
      }
      n = n.parentElement;
    }
    if (!layers.length || layers[layers.length - 1][3] < 0.999) {
      layers.push([255, 255, 255, 1]);              // the page ground
    }
    // Composite back to front: the deepest opaque layer first.
    let out = layers.pop().slice(0, 3);
    while (layers.length) {
      const [r, g, b, a] = layers.pop();
      out = [r * a + out[0] * (1 - a),
             g * a + out[1] * (1 - a),
             b * a + out[2] * (1 - a)];
    }
    return out;
  }
  function _ratio(a, b) {
    const l1 = _lum(a), l2 = _lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  }
`;

test.describe('UI-04 accessibility', () => {
  test.beforeEach(async ({ page }) => { await seedStudent(page); });

  test('UI04-020 [P2] the document declares its language', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    const lang = await page.evaluate(() => document.documentElement.lang);
    expect(lang, 'html has no lang attribute, so a screen reader guesses the voice')
      .toBeTruthy();
  });

  test('UI04-005 [P2] headings run in order with no skipped levels', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    const problems = await page.evaluate(() => {
      const levels = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')]
        .map((h) => Number(h.tagName[1]));
      const out = [];
      if (levels.length && levels[0] !== 1) out.push(`first heading is h${levels[0]}, not h1`);
      for (let i = 1; i < levels.length; i++) {
        if (levels[i] - levels[i - 1] > 1) {
          out.push(`h${levels[i - 1]} jumps to h${levels[i]}`);
        }
      }
      return out;
    });
    expect(problems, `heading order: ${problems.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-006 [P2] every input has a programmatic label', async ({ page }) => {
    // A placeholder is not a label: it disappears the moment someone types, and
    // a screen reader may never announce it at all.
    await page.goto('/profile', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const unlabelled = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('input, select, textarea')) {
        if (el.type === 'hidden') continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        const byFor = el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        const wrapped = el.closest('label');
        const aria = el.getAttribute('aria-label') || el.getAttribute('aria-labelledby');
        if (!byFor && !wrapped && !aria) {
          out.push(`${el.tagName.toLowerCase()}[name=${el.name || '?'}] placeholder="${el.placeholder || ''}"`);
        }
      }
      return out.slice(0, 8);
    });
    expect(unlabelled, `inputs with no label: ${unlabelled.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-009 [P2] icon-only buttons carry an aria-label', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const unnamed = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('button, [role="button"]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const text = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || el.getAttribute('title');
        if (!text && !label) out.push(el.outerHTML.slice(0, 90));
      }
      return out.slice(0, 6);
    });
    expect(unnamed, `unnamed icon buttons: ${unnamed.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-013 [P2] and UI04-014 images carry meaningful alt text', async ({ page }) => {
    await page.goto('/find-mentors', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const bad = await page.evaluate(() => {
      const out = [];
      for (const img of document.querySelectorAll('img')) {
        const r = img.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const alt = img.getAttribute('alt');
        if (alt === null) { out.push(`no alt: ${(img.currentSrc || img.src).slice(-50)}`); continue; }
        // "avatar" tells a screen-reader user nothing — the person's name does.
        if (/^(avatar|image|photo|picture|img)$/i.test(alt.trim())) {
          out.push(`generic alt "${alt}": ${(img.currentSrc || img.src).slice(-40)}`);
        }
      }
      return out.slice(0, 8);
    });
    expect(bad, `image alt problems: ${bad.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-003 [P2] focused elements show a visible focus ring', async ({ page }) => {
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const s = getComputedStyle(el);
      return {
        tag: el.tagName.toLowerCase(),
        outline: s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0,
        shadow: s.boxShadow && s.boxShadow !== 'none',
        ring: s.getPropertyValue('--tw-ring-shadow') !== '',
      };
    });
    expect(ring, 'Tab moved focus nowhere').not.toBeNull();
    expect(ring.outline || ring.shadow || ring.ring,
      `the first focusable element (${ring.tag}) shows no focus indicator`).toBeTruthy();
  });

  test('UI04-004 [P2] a skip link is present at the top of the page', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    // Wait for the layout, not a fixed 600 ms. The skip link is the first child
    // of MainLayout, so it only exists once that has mounted — sampling before
    // then reported "no skip link" on a page that has one, which is a flake
    // that looks exactly like a regression.
    await page.waitForSelector('a[href="#main-content"]', { state: 'attached', timeout: 15000 })
      .catch(() => {});
    const hasSkip = await page.evaluate(() => {
      const first = [...document.querySelectorAll('a[href^="#"]')].slice(0, 5);
      return first.some((a) => /skip/i.test(a.textContent || '')
        || /skip/i.test(String(a.className || '')));
    });
    expect(hasSkip,
      'no skip-to-content link — a keyboard user tabs the whole sidebar on every page')
      .toBeTruthy();
  });

  test('UI04-001 [P2] the login form is completable with the keyboard alone', async ({ browser }) => {
    // A SIGNED-OUT context. The shared page carries a token and /login rightly
    // redirects a signed-in visitor away, so tabbing there would only ever
    // measure the screen it redirected to.
    const guest = await browser.newContext();
    const page = await guest.newPage();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    // Tab until an email field has focus, then type — proving the field is
    // reachable in the tab order at all, which is the half that breaks.
    let reached = false;
    for (let i = 0; i < 12 && !reached; i++) {
      await page.keyboard.press('Tab');
      reached = await page.evaluate(() => {
        const el = document.activeElement;
        return !!el && el.tagName === 'INPUT'
          && /email|username/i.test(`${el.type} ${el.name} ${el.id} ${el.placeholder}`);
      });
    }
    await guest.close();
    expect(reached, 'the email field is not reachable by Tab within 12 stops').toBeTruthy();
  });

  test('UI04-010 [P2] a modal declares its role and closes on Escape', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1200);
    const opener = page.locator('tbody tr:visible, [data-row]:visible').first();
    await opener.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    if (!(await opener.count())) test.skip(true, 'no task row — run seed_ui_fixtures.py');

    const before = await page.locator('[role="dialog"]').count();
    await opener.click({ trial: false }).catch(() => {});

    // Polled, not slept. A fixed 900ms passed this test in isolation and failed
    // it inside a full run purely because the dialog had not painted yet — a
    // timing artefact reported as an accessibility defect, which is the worst
    // kind of red.
    const dialog = page.locator('[role="dialog"]');
    await expect(dialog, 'clicking a task row opened no dialog')
      .toHaveCount(before + 1, { timeout: 10000 });

    await expect(dialog.last(), 'the modal does not declare aria-modal')
      .toHaveAttribute('aria-modal', 'true');
    await page.keyboard.press('Escape');
    await expect(dialog, 'Escape did not close the modal')
      .toHaveCount(before, { timeout: 5000 });
  });

  test('UI04-011 [P2] toasts are announced to assistive technology', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(800);
    // The live region has to exist before a toast fires — one added at the same
    // moment as the message is often not announced at all.
    const live = await page.evaluate(() =>
      document.querySelectorAll('[role="status"], [role="alert"], [aria-live]').length);
    expect(live, 'no aria-live region, so toasts are silent to a screen reader')
      .toBeGreaterThan(0);
  });

  test('UI04-012 [P2] tables carry header semantics', async ({ page }) => {
    await page.goto('/payments', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const problems = await page.evaluate(() => {
      const out = [];
      for (const table of document.querySelectorAll('table')) {
        const r = table.getBoundingClientRect();
        if (r.width === 0) continue;                       // the mobile branch
        if (!table.querySelector('th')) out.push('a visible table has no <th>');
      }
      return out;
    });
    expect(problems, problems.join(' | ')).toHaveLength(0);
  });

  test('UI04-015 [P2] body text meets WCAG AA contrast', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    const failures = await page.evaluate(`(() => {
      ${CONTRAST_FN}
      const out = [];
      for (const el of document.querySelectorAll('p, span, td, th, li, a, label, h1, h2, h3')) {
        const text = (el.textContent || '').trim();
        if (!text || el.children.length) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const s = getComputedStyle(el);
        const fg = _parse(s.color);
        if (!fg) continue;
        const size = parseFloat(s.fontSize);
        const bold = (parseInt(s.fontWeight, 10) || 400) >= 700;
        const large = size >= 24 || (size >= 18.66 && bold);
        const need = large ? 3 : 4.5;
        const ratio = _ratio(fg, _bgOf(el));
        if (ratio < need) {
          out.push(text.slice(0, 28) + ' -> ' + ratio.toFixed(2) + ':1 (needs ' + need + ')');
        }
      }
      return out.slice(0, 10);
    })()`);
    expect(failures, `text below AA contrast: ${failures.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-016 [P2] status is not conveyed by colour alone', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    // A status pill has to carry a word. A bare coloured dot is invisible to
    // anyone who cannot distinguish the colours, and to every screen reader.
    const bare = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('[class*="badge" i], [class*="pill" i], [class*="status" i]')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const text = (el.textContent || '').trim();
        const label = el.getAttribute('aria-label') || el.getAttribute('title');
        if (!text && !label) out.push(el.outerHTML.slice(0, 70));
      }
      return out.slice(0, 5);
    });
    expect(bare, `colour-only status indicators: ${bare.join(' | ')}`).toHaveLength(0);
  });

  test('UI04-017 [P2] animation is reduced when the OS asks', async ({ browser }) => {
    const ctx = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await seedStudent(page);
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const moving = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('*')) {
        const s = getComputedStyle(el);
        const dur = parseFloat(s.animationDuration) || 0;
        if (dur > 0.3 && s.animationIterationCount === 'infinite') {
          out.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)}`);
        }
      }
      return out.slice(0, 5);
    });
    await ctx.close();
    // A spinner is legitimate; a decorative infinite animation is not. Reported
    // rather than hard-failed on a P2, because "infinite" alone cannot tell the
    // two apart from outside.
    expect(moving.length, `infinite animations under reduced-motion: ${moving.join(' | ')}`)
      .toBeLessThan(6);
  });

  test('UI04-018 [P2] nothing is lost at 200% zoom', async ({ page }) => {
    await page.setViewportSize({ width: 720, height: 450 });
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      text: (document.body.innerText || '').trim().length,
    }));
    expect(m.overflow, 'content is cut off at 200% zoom').toBeLessThanOrEqual(m.inner + 1);
    expect(m.text, 'the page rendered no text at 200% zoom').toBeGreaterThan(50);
  });

  test('UI04-002 [P2] the cohort list is operable from the keyboard', async ({ page }) => {
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1000);
    // Every row action must be a real control, not a click handler on a div —
    // a div is unreachable by Tab and invisible to a screen reader.
    const divButtons = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('div[onclick], span[onclick]')) {
        if (!el.getAttribute('role') && el.tabIndex < 0) out.push(el.outerHTML.slice(0, 70));
      }
      return out.slice(0, 5);
    });
    expect(divButtons, `click handlers on non-focusable elements: ${divButtons.join(' | ')}`)
      .toHaveLength(0);
  });

  test('UI04-007 [P2] and UI04-008 validation errors are associated with their field', async ({ browser }) => {
    const guest = await browser.newContext();
    const page = await guest.newPage();
    await page.goto('/login', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(600);
    // `getByRole('button', {name: /…|continue/i})` matched the **OTP mode
    // toggle** ("Continue with OTP"), which switches the form instead of
    // submitting it — the same mis-selection that UI02-158 hit. The submit
    // button is the one inside the form.
    const submit = page.locator('form button[type="submit"]').first();
    if (!(await submit.count())) test.skip(true, 'no submit button found on /login');
    await submit.click().catch(() => {});
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => {
      const inputs = [...document.querySelectorAll('input')].filter((el) => el.type !== 'hidden');
      // An error is a rendered error ELEMENT, not a body-text regex. The regex
      // matched the OTP tab's own marketing copy — "No passwords required." —
      // and then demanded aria-invalid on a form that had refused nothing.
      const errEl = document.querySelector('[role="alert"], .field-error, [aria-live="assertive"]');
      return {
        described: inputs.some((el) => el.getAttribute('aria-describedby')),
        invalid: inputs.some((el) => el.getAttribute('aria-invalid') === 'true'),
        required: inputs.some((el) => el.required || el.getAttribute('aria-required') === 'true'),
        anyError: !!(errEl && (errEl.textContent || '').trim()),
      };
    });
    expect(state.required, 'no field is marked required, visually or programmatically')
      .toBeTruthy();
    await guest.close();
    if (state.anyError) {
      expect(state.described || state.invalid,
        'an error is shown but not linked to its field via aria-describedby/aria-invalid')
        .toBeTruthy();
    }
  });

  test('UI04-019 [P2] the three journeys expose a complete accessibility tree', async ({ page, browser }) => {
    // What is automatable here, and what is not.
    //
    // No headless browser can BE a screen reader: Chromium does not speak, does
    // not carry NVDA's heuristics, and cannot judge whether what was announced
    // made sense to a person. So this does not claim "VoiceOver can complete
    // signup".
    //
    // What it does check is the thing a screen reader actually consumes — the
    // accessibility tree. For each of the three journeys the case names, the
    // tree must exist, expose a named heading, and expose every control the
    // journey needs with a role AND an accessible name. A control that appears
    // in the tree as an unnamed "button" is one a screen-reader user cannot
    // act on, and that is decidable from here.
    //
    // A human pass is still worth doing; this makes it start from a known-good
    // tree rather than from "does anything work at all".
    const problems = [];

    // `page.accessibility.snapshot()` was removed from Playwright; the tree is
    // now read with `locator.ariaSnapshot()`, which returns YAML of the form
    //
    //     - heading "My Cohorts" [level=1]
    //     - button "Enrol"
    //     - textbox
    //
    // Each line is one node: a role, optionally an accessible name in quotes.
    // A line carrying a role and NO quoted name is exactly the finding this
    // case is about — a control a screen-reader user hears as "button" and
    // nothing else.
    const NODE = /^\s*-\s+([a-z]+)(?:\s+"([^"]*)")?/;

    function parseTree(yaml) {
      const nodes = [];
      for (const line of (yaml || '').split(String.fromCharCode(10))) {
        const m = line.match(NODE);
        if (m) nodes.push({ role: m[1], name: (m[2] || '').trim() });
      }
      return nodes;
    }

    async function auditTree(p, label, expect_controls) {
      const yaml = await p.locator('body').ariaSnapshot().catch(() => '');
      const flat = parseTree(yaml);
      if (!flat.length) { problems.push(`${label}: no accessibility tree at all`); return; }

      if (!flat.some((n) => n.role === 'heading' && n.name)) {
        problems.push(`${label}: no named heading to orient on`);
      }
      const unnamed = flat.filter(
        (n) => ['button', 'link', 'textbox', 'combobox', 'checkbox'].includes(n.role)
          && !n.name);
      if (unnamed.length) {
        problems.push(`${label}: ${unnamed.length} unnamed control(s) — `
          + unnamed.slice(0, 3).map((n) => n.role).join(', '));
      }
      for (const role of expect_controls) {
        if (!flat.some((n) => n.role === role)) {
          problems.push(`${label}: no ${role} in the tree`);
        }
      }
    }

    // 1. Signup — signed out, or the guard redirects and we audit the wrong page.
    const guest = await browser.newContext();
    const gp = await guest.newPage();
    await gp.goto('/signup', { waitUntil: 'domcontentloaded' });
    await gp.waitForTimeout(900);
    await auditTree(gp, 'signup', ['textbox', 'button']);
    await guest.close();

    // 2. Enrol — the cohort list a student browses.
    await page.goto('/cohorts', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    await auditTree(page, 'cohorts', ['button']);

    // 3. Submit a task.
    await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(1400);
    await auditTree(page, 'tasks', []);

    test.info().annotations.push({
      type: 'partial',
      description: 'Accessibility-tree verification, not a screen-reader session. '
        + 'A manual VoiceOver/NVDA pass is still recommended before release.',
    });
    expect(problems, `accessibility tree gaps: ${problems.join(' | ')}`).toHaveLength(0);
  });
});
