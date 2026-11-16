/**
 * Per-SCREEN coverage: every live screen, and which tests name it.
 *
 * Reads the screen lists from utils/v1-surface.js rather than re-parsing
 * App.jsx. That file is reconciled against the router in BOTH directions by
 * 37-v1-surface-contract.spec.js — declared-not-live and live-not-declared are
 * both empty — so it is the verified list, and re-deriving it here only creates
 * a second copy that can disagree. (It did: a hand-rolled parser reported
 * AchieverTasks as a super-admin screen, because portal blocks are not
 * contiguous in App.jsx and most <Route> tags are self-closing.)
 *
 *   automation> node screen_coverage.js
 *
 * "0 tests" is not automatically a defect — some screens are exercised inside a
 * journey rather than by name. It is the list worth reading before shipping.
 */
const fs = require('fs');
const path = require('path');
const S = require('./utils/v1-surface');

const ROOT = path.join(__dirname, '..');
const files = [
  ...fs.readdirSync(path.join(__dirname, 'tests')).filter((f) => f.endsWith('.spec.js'))
      .map((f) => ['automation/tests/' + f, path.join(__dirname, 'tests', f)]),
  ...fs.readdirSync(path.join(ROOT, 'SKOVO_BACKEND', 'tests')).filter((f) => f.startsWith('test_'))
      .map((f) => ['SKOVO_BACKEND/tests/' + f, path.join(ROOT, 'SKOVO_BACKEND', 'tests', f)]),
];
const blobs = files.map(([name, p]) => [name, fs.readFileSync(p, 'utf8')]);

const PORTALS = [
  ['STUDENT',  S.STUDENT_SCREENS.map(([r]) => r)],
  ['ACHIEVER', S.ACHIEVER_SCREENS.map(([r]) => S.ACHIEVER + r)],
  ['ADMIN',    S.ADMIN_SCREENS.map(([r]) => S.ADMIN + r)],
  ['SUPER',    S.SUPER_SCREENS.map(([r]) => S.SUPER + r)],
];

let total = 0;
const gaps = [];

for (const [label, routes] of PORTALS) {
  console.log(`\n=== ${label}  (${routes.length} screens) ===`);
  for (const route of routes) {
    total += 1;
    const shown = route || '/';
    const hits = blobs.filter(([, b]) => b.includes(shown)).map(([n]) => n);
    if (!hits.length) gaps.push([label, shown]);
    console.log(`  ${shown.padEnd(46)} ${String(hits.length).padStart(3)}  `
      + `${hits.slice(0, 2).map((h) => h.split('/').pop()).join(', ').slice(0, 44)}`
      + `${hits.length ? '' : '   <-- named by no test'}`);
  }
}

console.log('\n' + '='.repeat(96));
console.log(`${total} live screens · ${total - gaps.length} with a behaviour test `
  + `· ${gaps.length} covered only by the generic sweep`);
console.log('Every screen IS loaded and error-checked by 15-portal-ui-screens.spec.js and the'
  + ' UI-02 viewport sweep; the list below is about DEPTH, not absence.');
if (gaps.length) {
  console.log('');
  console.log('No test exercises what these screens actually DO:');
}
