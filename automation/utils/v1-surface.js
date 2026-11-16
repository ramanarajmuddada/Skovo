// THE v1 SURFACE — single source of truth for what ships in Version 1.
//
// Every screen-level spec reads its route list from here, so "what is in v1"
// is stated once. `37-v1-surface-contract.spec.js` checks these lists against
// the real router (`Skovo/src/App.jsx`) and sidebar (`MainLayout.jsx`), so the
// suite fails the moment the build and this file disagree in either direction.
//
// Keeping the HIDDEN list is as important as the live one: v1 scope is defined
// as much by the 34 screens that are built-but-hidden as by the ones that ship.

/** Live student screens: route → text that proves that screen (not a 404) mounted. */
const STUDENT_SCREENS = [
  ['/career-path',       /dashboard|welcome|readiness|score/i],
  ['/bhaai',             /bhaai|upcoming|what it will do/i],
  ['/cohorts',           /cohort/i],
  ['/colleges',          /college/i],
  ['/colleges/saved',    /saved|college/i],
  ['/college-predictor', /predictor|safe|target|reach|confidence/i],
  ['/opportunities',     /opportunit/i],
  ['/applications',      /application/i],
  ['/assemble',          /assemble|communit/i],
  ['/find-mentors',      /achiever|mentor/i],
  ['/bookings',          /booking/i],
  ['/skovo-pro',         /pro|upgrade|plan/i],
  ['/tasks',             /task/i],
  ['/notifications',     /notification/i],
  ['/document-vault',    /document|vault/i],
  ['/market',            /market|deal/i],
  ['/my-score',          /score/i],
  // Two live student routes this file did not declare, which the both-ways
  // route contract in 37-v1-surface-contract.spec.js was failing on:
  //   /colleges/predictor — the predictor moved here on 2026-09-01 when it left
  //     the sidebar to become a tab inside Colleges (the old /college-predictor
  //     is a redirect, so it is not a route in its own right).
  //   /payments — in the sidebar and in the router, and simply never listed.
  ['/colleges/predictor', /predictor|rank|chance/i],
  ['/payments',          /payment|order|invoice/i],
  ['/profile',           /profile/i],
  ['/support',           /help|support|issue/i],
];

/** Student routes that need a real id, resolved from the API at run time. */
const STUDENT_DETAIL_SCREENS = [
  ['/colleges/:id',            /college|course|fee|placement/i],
  ['/achievers/:achieverId',   /achiever|mentor|book|session/i],
];

/** Sidebar labels → the slug the link must navigate to. Mirrors MainLayout.jsx. */
const STUDENT_NAV = [
  ['Dashboard',       'career-path'],
  ['BhaAI',           'bhaai'],
  ['Cohorts',         'cohorts'],
  ['Colleges',        'colleges'],
  // Saved Colleges and College Predictor are NOT sidebar items. They were
  // folded into the Colleges page as tabs on 2026-09-01 (components/colleges/
  // CollegeTabs.jsx) and their nav entries are commented out in MainLayout on
  // purpose — the routes still exist and are still linkable, they are just
  // reached from inside Colleges. Listing them here asserted a sidebar the
  // product deliberately no longer has.
  ['Opportunities',   'opportunities'],
  ['Find Achievers',  'find-mentors'],
  ['Skovo Pro',       'skovo-pro'],
  ['My Bookings',     'bookings'],
  ['My Tasks',        'tasks'],
  ['Applications',    'applications'],
  ['Document Vault',  'document-vault'],
  // Market is NOT a sidebar item. It moved out of the sidebar's Tools group and
  // onto the Dashboard as a fifth Quick Action tile on 2026-09-01 — the route
  // and the page are unchanged, only the entry point moved. It is a button that
  // navigates, not a link, which is why a `getByRole('link', {name:'Market'})`
  // finds nothing.
  ['Payments',        'payments'],
  ['My Score',        'my-score'],
  ['Assemble',        'assemble'],
  ['Notifications',   'notifications'],
  ['Help & support',  'support'],
];

/** Built, but deliberately OUT of v1 — must 404 and must not appear in nav.
 *  Mirrors the `v1-hidden:` markers in App.jsx. */
const STUDENT_HIDDEN = [
  '/readiness-assessment', '/coaching', '/roadmap', '/career-guidance',
  '/career-guidance/entrance-exams', '/career-guidance/scholarships',
  '/career-guidance/govt-exams', '/career-guidance/abroad',
  '/career-guidance/branches', '/mock-tests', '/college-applications',
  '/forum', '/scholarship-tracker', '/resume-builder', '/exam-resources',
  '/sop-builder', '/certifications', '/leaderboard', '/courses', '/referrals',
];

const ADMIN = '/skovo-platform-panel-admin';
const SUPER = '/skovo-platform-owner';
const ACHIEVER = '/skovo-achiever-portal';

/** All 29 live admin screens (Playbook §5.8 capabilities + operator tooling). */
const ADMIN_SCREENS = [
  ['',                 /dashboard|overview|total/i],
  ['/users',           /student|user/i],
  ['/cohorts',         /cohort/i],
  ['/colleges',        /college/i],
  ['/college-reviews', /review/i],
  ['/opportunities',   /opportunit/i],
  // No '/employers': the screen was removed on 2026-08-30 along with Team &
  // Roles and Add Achiever. See the removal guards in 12-admin-writes.spec.js —
  // this list says what exists, that file says what must stay gone.
  ['/achievers',       /achiever/i],
  // '/achiever-trust' is the old path. The screen is AdminAchieverLifecycle and
  // it is routed at '/achiever-review'.
  ['/achiever-review', /trust|verif|kyc|bgv|review|probation|lifecycle/i],
  ['/courses',         /course/i],
  ['/domains',         /domain/i],
  ['/masters',         /master/i],
  ['/cities',          /cit(y|ies)/i],
  ['/course-catalogue', /course|trade/i],
  ['/import',          /import|csv|column/i],
  ['/bookings',        /booking/i],
  ['/payments',        /payment/i],
  ['/subscriptions',   /subscription|plan/i],
  ['/coupons',         /coupon/i],
  ['/market',          /market|deal/i],
  ['/tasks',           /task/i],
  ['/communities',     /communit/i],
  ['/moderation',      /moderation|report/i],
  ['/score-rules',     /score/i],
  ['/readiness-rules', /readiness|rule|explorer|minimum/i],
  ['/analytics',       /analytic|metric/i],
  ['/invites',         /invit/i],
  // No '/team': removed 2026-08-30. `admin_role` was never written to the JWT,
  // so the whole role system enforced nothing and the screen was decorative.
  ['/audit',           /audit/i],
  ['/error-logs',      /error/i],
  ['/support',         /support|contact|issue/i],
  ['/profile',         /profile|account/i],
];

/** All 12 live super-admin screens. */
const SUPER_SCREENS = [
  ['',              /dashboard|overview|platform/i],
  ['/admins',       /admin/i],
  ['/users',        /user|student/i],
  ['/achievers',    /achiever|mentor/i],
  ['/cohorts',      /cohort/i],
  ['/courses',      /course/i],
  ['/enrollments',  /enrol/i],
  ['/readiness',    /readiness|score/i],
  ['/opportunities',/opportunit/i],
  ['/communities',  /communit/i],
  ['/audit',        /audit/i],
  // Two live super-admin screens this file never listed, so the both-ways route
  // contract failed on them. Admin access is the approval queue that replaced
  // "super-admin creates an admin" — admins self-register and are approved here.
  ['/admin-approvals', /admin access|approve|suspend|pending/i],
  ['/business',     /business|revenue|owed|growth/i],
  ['/profile',      /profile|account|founder/i],
];

/** All 11 live achiever-portal screens. */
const ACHIEVER_SCREENS = [
  ['',               /dashboard|overview|welcome/i],
  ['/bookings',      /booking/i],
  ['/cohorts',       /cohort/i],
  ['/availability',  /availab/i],
  ['/earnings',      /earning|payout/i],
  ['/domains',       /domain/i],
  // My Courses is v1-hidden in App.jsx — the route is commented out.
  ['/coupons',       /coupon/i],
  ['/application',   /application|apply|verif/i],
  // Achiever Tasks, added 2026-09-01 so the person who ran the session can set
  // the homework instead of asking an admin to do it. Routed and shipped, but
  // never declared here.
  ['/tasks',         /task/i],
  ['/notifications', /notification/i],
  ['/support',       /help|support|issue/i],
  ['/profile',       /profile/i],
];

/** The 404 screen echoes the URL it failed on, so a route-derived heading regex
 *  matches the 404 page itself. Every render assertion must rule that out. */
const NOT_FOUND_MARKER = /Page not found/i;

module.exports = {
  STUDENT_SCREENS, STUDENT_DETAIL_SCREENS, STUDENT_NAV, STUDENT_HIDDEN,
  ADMIN, SUPER, ACHIEVER,
  ADMIN_SCREENS, SUPER_SCREENS, ACHIEVER_SCREENS,
  NOT_FOUND_MARKER,
};
