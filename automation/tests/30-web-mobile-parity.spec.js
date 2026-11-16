// Web ↔ mobile parity — do the two surfaces show the SAME data?
//
// Playwright drives the browser and Maestro drives the phone, so neither can
// compare the two directly. But they do not need to: both surfaces are thin
// clients over one REST API. A screen shows different data from its twin for
// exactly two reasons —
//
//   1. it calls a different set of endpoints, or
//   2. it reads a field the API does not return (renders as 0 / blank / ₹0).
//
// Both are checkable here, with no emulator, and both are the failures this
// project actually hit: the achiever dashboard read `sessions_count`,
// `cohorts_count` and `available_balance`, none of which exist in the earnings
// payload, so it showed 0/0/0 and ₹0 beside a real "Total earned ₹8,400".
//
// This spec is the regression net for that class. It is deliberately
// data-driven: SCREENS below is the contract, and adding a screen means adding
// a row, not writing a test.
const { test, expect, request } = require('@playwright/test');
const { API, U, provisionStudent, portalLogin } = require('../utils/api');

// Every v1 screen that exists on both surfaces, and the endpoints each one
// loads. Keep these in step with the screens; a drift here is the bug.
const SCREENS = [
  // name              role        web endpoints                          mobile endpoints
  ['Dashboard',       'student', ['/dashboard/', '/subscription/'],      ['/dashboard/', '/subscription/']],
  ['Cohorts',         'student', ['/cohorts/'],                          ['/cohorts/']],
  ['Colleges',        'student', ['/colleges/'],                         ['/colleges/']],
  ['SavedColleges',   'student', ['/colleges/saved'],                    ['/colleges/saved']],
  ['Predictor',       'student', ['/colleges/predict/exams'],            ['/colleges/predict/exams']],
  ['Opportunities',   'student', ['/opportunities/'],                    ['/opportunities/']],
  ['FindAchievers',   'student', ['/achievers/'],                        ['/achievers/']],
  // No '/cohorts/': the cohort side of My Bookings comes from `/bookings/`,
  // which returns cohort_id, cohort_title, cohort_status, meeting_link, is_live
  // and can_join on every row. Listing it separately claimed a call the screen
  // has no reason to make, and the contract test rightly said so.
  ['Bookings',        'student', ['/bookings/', '/achievers/my-sessions', '/billing/invoices'],
                                 ['/bookings/', '/achievers/my-sessions', '/billing/invoices']],
  ['Tasks',           'student', ['/tasks/'],                            ['/tasks/']],
  ['Applications',    'student', ['/applications/'],                     ['/applications/']],
  ['DocumentVault',   'student', ['/document-vault/', '/document-vault/public-profile'],
                                 ['/document-vault/', '/document-vault/public-profile']],
  ['Market',          'student', ['/market/'],                           ['/market/']],
  ['MyScore',         'student', ['/readiness/score', '/readiness/score/events', '/readiness/score/unlocks'],
                                 ['/readiness/score', '/readiness/score/events', '/readiness/score/unlocks']],
  ['Assemble',        'student', ['/assemble/groups'],                   ['/assemble/groups']],
  ['Notifications',   'student', ['/notifications/'],                    ['/notifications/']],
  ['Profile',         'student', ['/profile/'],                          ['/profile/']],
  ['SkovoPro',        'student', ['/subscription/'],                     ['/subscription/']],

  ['Ach·Dashboard',   'achiever', ['/achievers/portal/earnings', '/achievers/portal/bookings', '/achievers/portal/cohorts', '/courses/portal/'],
                                  ['/achievers/portal/earnings', '/achievers/portal/bookings', '/achievers/portal/cohorts', '/courses/portal/']],
  ['Ach·Bookings',    'achiever', ['/achievers/portal/bookings', '/achievers/portal/enrollments'],
                                  ['/achievers/portal/bookings', '/achievers/portal/enrollments']],
  ['Ach·Cohorts',     'achiever', ['/achievers/portal/cohorts', '/achievers/portal/domains'],
                                  ['/achievers/portal/cohorts', '/achievers/portal/domains']],
  ['Ach·Earnings',    'achiever', ['/achievers/portal/earnings', '/achiever-payouts', '/achiever-payouts/details'],
                                  ['/achievers/portal/earnings', '/achiever-payouts', '/achiever-payouts/details']],
  ['Ach·Courses',     'achiever', ['/courses/portal/'],                   ['/courses/portal/']],
  ['Ach·Coupons',     'achiever', ['/achievers/portal/coupons'],          ['/achievers/portal/coupons']],
];

// Fields a screen renders that MUST exist in the payload. These are the exact
// reads that were silently undefined in production code — a value that is
// absent renders as 0/blank rather than throwing, so only an assertion catches it.
const RENDERED_FIELDS = [
  ['Ach·Dashboard', '/achievers/portal/earnings', ['total_earned', 'payout_summary.available_balance']],
  ['Ach·Dashboard', '/achievers/portal/bookings', ['total']],
  ['Ach·Bookings',  '/achievers/portal/enrollments', ['enrollments', 'total']],
  ['Dashboard',     '/dashboard/', ['readiness.score', 'readiness.level', 'readiness.opportunity_hub_unlocked', 'upcoming_cohorts']],
  ['Bookings',      '/billing/invoices', ['invoices']],
  ['MyScore',       '/readiness/score', ['score', 'level', 'breakdown']],
  ['SkovoPro',      '/subscription/', ['plans', 'perks', 'is_pro']],
  ['DocumentVault', '/document-vault/', ['documents', 'is_pro', 'limit']],
  ['Opportunities', '/opportunities/', ['opportunities', 'hub_gate']],
];

// Where each screen's code lives, so the contract above can be checked against
// what the source actually calls. Without this the SCREENS table only asserts
// itself — it would stay green while a screen quietly stopped loading something.
const REPO = require('path').join(__dirname, '..', '..');
const SOURCE = {
  'Dashboard':      ['Skovo/src/pages/Dashboard.jsx',            'SkovoMobile/src/screens/student/HomeScreen.js'],
  'Cohorts':        ['Skovo/src/pages/Cohorts.jsx',              'SkovoMobile/src/screens/student/CohortsScreen.js'],
  'Colleges':       ['Skovo/src/pages/Colleges.jsx',             'SkovoMobile/src/screens/student/CollegesScreen.js'],
  'SavedColleges':  ['Skovo/src/pages/SavedColleges.jsx',        'SkovoMobile/src/screens/student/SavedCollegesScreen.js'],
  'Opportunities':  ['Skovo/src/pages/Opportunities.jsx',        'SkovoMobile/src/screens/student/OpportunitiesScreen.js'],
  'Bookings':       ['Skovo/src/pages/Bookings.jsx',             'SkovoMobile/src/screens/student/BookingsScreen.js'],
  'Tasks':          ['Skovo/src/pages/Tasks.jsx',                'SkovoMobile/src/screens/student/TasksScreen.js'],
  'Applications':   ['Skovo/src/pages/Applications.jsx',         'SkovoMobile/src/screens/student/ApplicationsScreen.js'],
  'DocumentVault':  ['Skovo/src/pages/DocumentVault.jsx',        'SkovoMobile/src/screens/student/DocumentVaultScreen.js'],
  'Market':         ['Skovo/src/pages/Market.jsx',               'SkovoMobile/src/screens/student/MarketScreen.js'],
  'Notifications':  ['Skovo/src/pages/Notifications.jsx',        'SkovoMobile/src/screens/student/NotificationsScreen.js'],
  // The achiever portal is WEB-ONLY. `SkovoMobile/src/screens` holds `auth` and
  // `student` and nothing else — there is no achiever directory and never has
  // been, so these two named mobile files that were never written. A parity
  // contract can only compare two surfaces that both exist; claiming a mobile
  // twin for a screen the mobile app does not have reports a missing FILE as a
  // missing feature, and sends whoever reads it looking for a regression that
  // is really a product decision.
  //
  // If the achiever portal ever ships on mobile, add the pair back here and the
  // endpoint comparison starts working again on its own.
};

/** Endpoints a source file actually GETs, normalised to how SCREENS writes them. */
function endpointsInSource(relPath) {
  const fs = require('fs');
  const file = require('path').join(REPO, relPath);
  if (!fs.existsSync(file)) return null;
  const src = fs.readFileSync(file, 'utf8');
  const out = new Set();
  // `getCached` as well as `get`. api.getCached is opt-in caching over the same
  // endpoint - Colleges has used it since the browse-perf work, and Cohorts
  // moved to it on 2026-09-06 to collapse duplicate concurrent requests. A
  // scanner that only knows `.get(` reports those screens as calling nothing,
  // and the contract test then fails on a screen that is working perfectly.
  for (const m of src.matchAll(/\b(?:api|studentApi|achieverApi)\.get(?:Cached)?\(\s*[`'"]([^`'"]+)/g)) {
    let u = m[1].split('?')[0];
    if (!u.startsWith('/')) continue;
    out.add(u);
  }
  return out;
}

const dig = (obj, path) => path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);

let ctxFor = {};

test.beforeAll(async () => {
  const s = await provisionStudent();
  const a = await portalLogin('achiever');
  ctxFor.student = await request.newContext({
    extraHTTPHeaders: s.token ? { Authorization: `Bearer ${s.token}` } : {},
  });
  ctxFor.achiever = await request.newContext({
    extraHTTPHeaders: a?.token ? { Authorization: `Bearer ${a.token}` } : {},
  });
});

test.afterAll(async () => {
  for (const c of Object.values(ctxFor)) await c?.dispose?.();
});

test.describe('web ↔ mobile parity', () => {
  // 1. Same endpoints. If web loads an endpoint mobile does not, mobile is
  //    showing less — which is how the achiever lost sight of cohort
  //    enrolments on the phone.
  for (const [name, role, web, mobile] of SCREENS) {
    test(`${name} — both surfaces load the same endpoints`, async () => {
      const onlyWeb = web.filter((e) => !mobile.includes(e));
      const onlyMobile = mobile.filter((e) => !web.includes(e));
      expect(onlyWeb, `${name}: web loads ${onlyWeb.join(', ')} but mobile does not`).toEqual([]);
      expect(onlyMobile, `${name}: mobile loads ${onlyMobile.join(', ')} but web does not`).toEqual([]);
    });
  }

  // 1b. The code matches the contract. Without this the table above only agrees
  //     with itself — a screen could stop loading an endpoint and stay green.
  for (const [name, screenWeb, screenMobile] of Object.entries(SOURCE).map(([k, v]) => [k, ...v])) {
    const row = SCREENS.find((s) => s[0] === name);
    if (!row) continue;
    test(`${name} — source calls what the contract declares`, () => {
      const [, , declaredWeb, declaredMobile] = row;
      for (const [side, file, declared] of [['web', screenWeb, declaredWeb],
                                            ['mobile', screenMobile, declaredMobile]]) {
        const actual = endpointsInSource(file);
        expect(actual, `${name}: ${side} source not found at ${file}`).not.toBeNull();
        const missing = declared.filter((d) => {
          // A screen may append a query string or an id; match on the stem.
          for (const a of actual) if (a === d || a.startsWith(d) || d.startsWith(a)) return false;
          return true;
        });
        expect(missing,
          `${name} (${side}): the contract says it loads ${missing.join(', ')}, ` +
          `but ${file} never calls it — that surface is showing less than its twin`).toEqual([]);
      }
    });
  }

  // 2. Those endpoints actually answer, for both roles.
  const seen = new Set();
  for (const [name, role, web] of SCREENS) {
    for (const ep of web) {
      const key = role + ep;
      if (seen.has(key)) continue;
      seen.add(key);
      test(`${role} ${ep} — responds 200`, async () => {
        const res = await ctxFor[role].get(U(ep));
        expect(res.status(), `${ep} HTTP`).toBe(200);
        const body = await res.json();
        expect(body.status, `${ep} envelope status`).toBe(200);
        expect(body.bool, `${ep} envelope bool`).toBeTruthy();
      });
    }
  }

  // 3. Every field a screen renders is present. This is the check that would
  //    have caught the 0/0/0 achiever dashboard.
  for (const [name, ep, fields] of RENDERED_FIELDS) {
    const role = SCREENS.find((s) => s[0] === name)[1];
    test(`${name} — ${ep} returns the fields the screens render`, async () => {
      const res = await ctxFor[role].get(U(ep));
      expect(res.status()).toBe(200);
      const payload = (await res.json()).response;
      for (const f of fields) {
        expect(dig(payload, f),
          `${name}: screens render "${f}" from ${ep}, but the payload has no such field ` +
          `— it will display as 0/blank, not as an error`).toBeDefined();
      }
    });
  }
});
