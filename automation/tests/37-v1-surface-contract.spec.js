// THE v1 SURFACE CONTRACT.
//
// v1 is defined as much by what is hidden as by what ships: 34 screens are
// built and parked behind `v1-hidden:` markers. Nothing stops someone
// uncommenting one, and no other test would notice — the screen would simply
// start working.
//
// This spec reads the real router and sidebar and asserts three things:
//   1. the live route set matches utils/v1-surface.js exactly, both ways;
//   2. every hidden screen really is unreachable (renders the 404);
//   3. no hidden screen leaks into the student sidebar.
//
// It is the test that makes the rest of the suite trustworthy: every other
// screen spec takes its route list from the same file this one verifies.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { cachedTokens, STUDENTS } = require('../utils/api');
const {
  STUDENT_SCREENS, STUDENT_HIDDEN, STUDENT_NAV,
  ADMIN, SUPER, ACHIEVER,
  ADMIN_SCREENS, SUPER_SCREENS, ACHIEVER_SCREENS, NOT_FOUND_MARKER,
} = require('../utils/v1-surface');

const SRC = path.join(__dirname, '..', '..', 'Skovo', 'src');
const APP = fs.readFileSync(path.join(SRC, 'App.jsx'), 'utf8');
const LAYOUT = fs.readFileSync(
  path.join(SRC, 'components', 'layout', 'MainLayout.jsx'), 'utf8');

/** Route paths that are actually live — commented-out lines don't count. */
function liveRoutes(source) {
  const out = [];
  for (const line of source.split('\n')) {
    const t = line.trim();
    if (t.startsWith('//') || t.startsWith('{/*') || t.startsWith('*')) continue;
    const m = line.match(/<Route\s+path="([^"]*)"/);
    if (m) out.push(m[1]);
  }
  return out;
}

const LIVE = liveRoutes(APP);

/** Live child routes under a portal's layout route, as "/suffix" strings. */
function portalSuffixes(base) {
  // Portal children are declared as bare `path="users"`, so anything that is
  // not an absolute path and not a known top-level route belongs to a portal.
  // Slice the source between this portal's layout route and the next one.
  const start = APP.indexOf(`path="${base}"`);
  expect(start, `${base} layout route not found in App.jsx`).toBeGreaterThan(-1);
  const rest = APP.slice(start);
  const end = rest.indexOf('</Route>');
  const block = rest.slice(0, end);
  const out = liveRoutes(block).filter((p) => !p.startsWith('/'));
  if (/<Route index/.test(block.split('\n').filter(
    (l) => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n'))) {
    out.unshift('');
  }
  return out.map((p) => (p === '' ? '' : '/' + p));
}

// ══ 1. the declared surface matches the router ════════════════════════════
test('student v1 routes match the router exactly', () => {
  const declared = STUDENT_SCREENS.map(([r]) => r).sort();
  // Live student routes = absolute paths inside the MainLayout block.
  const start = APP.indexOf('<MainLayout />');
  const block = APP.slice(start, start + APP.slice(start).indexOf('</Route>'));
  const routed = liveRoutes(block)
    .filter((p) => !p.includes(':'))          // detail screens tested separately
    .sort();

  expect(routed, 'App.jsx has a live student route this suite does not test')
    .toEqual(declared);
});

for (const [label, base, declared] of [
  ['admin', ADMIN, ADMIN_SCREENS],
  ['super admin', SUPER, SUPER_SCREENS],
  ['achiever', ACHIEVER, ACHIEVER_SCREENS],
]) {
  test(`${label} portal routes match the router exactly`, () => {
    const want = declared.map(([s]) => s).sort();
    const got = portalSuffixes(base).sort();
    expect(got, `${label}: App.jsx and utils/v1-surface.js disagree`).toEqual(want);
  });
}

// ══ 2. every hidden screen is genuinely out of v1 ═════════════════════════
test('every v1-hidden route is commented out in the router', () => {
  const leaked = STUDENT_HIDDEN.filter((r) => LIVE.includes(r));
  expect(leaked, `these screens are meant to be out of v1 but are routable: ${leaked.join(', ')}`)
    .toHaveLength(0);
});

test.describe('hidden screens are unreachable in the browser', () => {
  let T = {};
  test.beforeAll(() => {
    T = cachedTokens();
    expect(T.studentPro, 'studentPro token').toBeTruthy();
  });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(([t, e]) => {
      localStorage.setItem('access_token', t);
      localStorage.setItem('user', JSON.stringify({
        user_id: 'e2e', id: 'e2e', full_name: 'E2E Pro Student', email: e, role: 'student',
      }));
    }, [T.studentPro, STUDENTS.pro.email]);
  });

  // A sample, not all 20 — enough to catch an accidental un-hiding without
  // spending 20 page loads. Assessment leads because it is the one the docs
  // still describe as shipping.
  for (const route of ['/readiness-assessment', '/courses', '/leaderboard',
                       '/referrals', '/forum', '/career-guidance']) {
    test(`hidden: ${route} shows the 404`, async ({ page }) => {
      await page.goto(route, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(800);
      expect(page.url(), `${route} bounced to login`).not.toMatch(/\/login$/);
      await expect(page.getByText(NOT_FOUND_MARKER).first(),
        `${route} is hidden from nav but still renders a real screen`).toBeVisible();
    });
  }
});

// ══ 3. nothing hidden leaks into the sidebar ═════════════════════════════
test('the sidebar lists exactly the v1 nav items', () => {
  const live = [];
  for (const line of LAYOUT.split('\n')) {
    if (line.trim().startsWith('//')) continue;
    const m = line.match(/\{\s*to:\s*'([^']+)'/);
    if (m) live.push(m[1]);
  }
  const declared = STUDENT_NAV.map(([, slug]) => '/' + slug).sort();
  expect(live.sort(), 'MainLayout.jsx sidebar and utils/v1-surface.js disagree')
    .toEqual(declared);

  const leaked = STUDENT_HIDDEN.filter((r) => live.includes(r));
  expect(leaked, `hidden screens present in the sidebar: ${leaked.join(', ')}`).toHaveLength(0);
});
