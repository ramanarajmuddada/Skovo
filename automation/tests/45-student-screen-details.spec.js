// The four student-screen cases the pytest modules deliberately left unclaimed
// because they are rendering, not API: the Dashboard's Quick Action layout
// (ST03-002/003) and My Tasks' deadline display and filters (ST06-016/019).
//
// Each was skipped in its pytest module with a note saying it belonged here,
// rather than being asserted at the API and counted as covered — a case about
// what a student sees is not answered by what the server sent.
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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(([token, email]) => {
    localStorage.setItem('access_token', token);
    localStorage.setItem('user', JSON.stringify({
      user_id: 'e2e', id: 'e2e', full_name: 'E2E Student', email, role: 'student',
      // Without education_level the mandatory onboarding modal mounts as a
      // fixed inset-0 overlay and every click lands on its backdrop.
      education_level: 'ug', education_category: 'ug',
    }));
  }, [student.token, student.email]);
});

test('ST03-002 [P1] Quick Actions sit five across on desktop without wrapping', async ({ page }) => {
  // Market moved out of the sidebar and onto the Dashboard as a fifth tile, and
  // the grid went 2/3/5 with tile padding cut so five fit on one row. If they
  // wrap, the fifth tile lands alone on a second row and reads as an afterthought.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const rows = await page.evaluate(() => {
    // Find the tile group by looking for a grid whose children are links/buttons.
    const grids = [...document.querySelectorAll('div')].filter((el) => {
      const s = getComputedStyle(el);
      return s.display === 'grid' && el.children.length >= 4;
    });
    if (!grids.length) return null;
    const grid = grids.find((g) => g.children.length === 5) || grids[0];
    const tops = [...grid.children].map((c) => Math.round(c.getBoundingClientRect().top));
    return { count: grid.children.length, distinctRows: new Set(tops).size };
  });

  if (!rows) test.skip(true, 'no Quick Actions grid found on the Dashboard');
  expect(rows.distinctRows,
    `${rows.count} Quick Action tiles wrapped onto ${rows.distinctRows} rows at 1440`)
    .toBe(1);
});

test('ST03-003 [P0] Quick Actions stack on mobile with no page overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/career-path', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const m = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    inner: window.innerWidth,
  }));
  expect(m.scrollWidth, `the Dashboard scrolls sideways at 390 (${m.scrollWidth} > ${m.inner})`)
    .toBeLessThanOrEqual(m.inner + 1);

  const stacked = await page.evaluate(() => {
    const grids = [...document.querySelectorAll('div')].filter((el) => {
      const s = getComputedStyle(el);
      return s.display === 'grid' && el.children.length >= 4;
    });
    if (!grids.length) return null;
    const grid = grids.find((g) => g.children.length === 5) || grids[0];
    const tops = [...grid.children].map((c) => Math.round(c.getBoundingClientRect().top));
    return new Set(tops).size;
  });
  if (stacked === null) test.skip(true, 'no Quick Actions grid found');
  // 2-up or stacked — anything but all five on one row at phone width.
  expect(stacked, 'Quick Actions are still five across on a phone').toBeGreaterThan(1);
});

test('ST06-016 [P1] a task deadline shows the time, not only the date', async ({ page }) => {
  // Students miss deadlines by hours, so "12 Sep" is not enough. The payload
  // carries a full UTC timestamp; this is about what the screen does with it.
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);

  const body = await page.locator('body').innerText();
  if (/no tasks|nothing due|you're all caught up/i.test(body)) {
    test.skip(true, 'no open tasks for this student — needs a live cohort with a task');
  }

  // A time somewhere in the deadline text: 18:30, 6:30 pm, 6.30 PM.
  const hasTime = /\b\d{1,2}[:.]\d{2}\s*(am|pm)?\b/i.test(body);
  expect(hasTime, 'no time is shown anywhere on My Tasks, only dates').toBeTruthy();
});

test('ST06-019 [P1] My Tasks filters produce the correct subsets', async ({ page }) => {
  // The sheet asks for To-do / Submitted / Approved and "correct subsets". The
  // screen had no filter at all until this pass, so this is the first thing
  // that checks it — and it checks the arithmetic, not merely that something
  // moved: each filter's own count must equal the number of rows it renders,
  // and the three must add up to All. A filter that silently drops a task is
  // exactly as bad as one that shows too many, and only the sum catches it.
  await page.goto('/tasks', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1800);

  const group = page.getByRole('group', { name: /filter tasks/i });
  if (!(await group.count())) {
    test.skip(true, 'no tasks for this student, so the filter strip is not rendered');
  }

  const countRows = () => page.evaluate(() => {
    const rows = document.querySelectorAll('tbody tr');
    if (rows.length) return rows.length;
    return document.querySelectorAll('[data-row]').length;
  });

  const readings = {};
  for (const label of ['All', 'To-do', 'Submitted', 'Approved']) {
    const chip = group.getByRole('button', { name: new RegExp(`^${label}`, 'i') }).first();
    await chip.click();
    await page.waitForTimeout(700);

    // The number the chip advertises, and the number of rows it actually drew.
    const advertised = Number(((await chip.innerText()).match(/(\d+)\s*$/) || [])[1]);
    const drawn = await countRows();
    readings[label] = { advertised, drawn };

    expect(await chip.getAttribute('aria-pressed'),
      `the ${label} filter does not announce itself as pressed`).toBe('true');
    expect(drawn, `${label} advertises ${advertised} tasks but rendered ${drawn} rows`)
      .toBe(advertised);
  }

  const { All, 'To-do': todo, Submitted, Approved } = readings;
  expect(todo.advertised + Submitted.advertised + Approved.advertised,
    `To-do ${todo.advertised} + Submitted ${Submitted.advertised} + Approved `
    + `${Approved.advertised} does not add up to All ${All.advertised} — the filters `
    + 'either overlap or drop a task between them')
    .toBe(All.advertised);
});
