// Logs in ONCE per run for every identity and caches the tokens on disk.
//
// Why: /auth/login is rate-limited (50 per hour per IP). Logging in inside each
// spec's beforeAll burned that budget fast and started returning 429. One login
// per identity per run keeps us far under the limit — and makes the suite
// faster.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { request } = require('@playwright/test');

const BACKEND = process.env.SKOVO_BACKEND || 'http://127.0.0.1:5000';
const API = BACKEND + '/v1';
const OUT = path.join(__dirname, '.auth', 'tokens.json');

const tokenFrom = (b) =>
  b.access_token || b.response?.access_token || b.token || b.response?.token;

const IDENTITIES = [
  ['studentPro',  '/auth/login',                            'e2e.pro@skovo-test.local'],
  ['studentFree', '/auth/login',                            'e2e.free@skovo-test.local'],
  ['admin',       '/skovo-platform-panel-admin/login',      'e2e.admin@skovo-test.local'],
  ['super',       '/skovo-platform-owner/login',            'e2e.super@skovo-test.local'],
  ['achiever',    '/achiever/login',                        'e2e.achiever@skovo-test.local'],
];
const PASSWORD = 'E2ePass!234';

// Re-seed first so every run starts from a known fixture state. Several specs
// consume seeded data (the open DM report gets actioned, saved colleges get
// toggled), which made re-runs skip or fail. Set SKOVO_SKIP_SEED=1 to opt out.
const reseed = () => {
  if (process.env.SKOVO_SKIP_SEED === '1') return;
  const py = path.join(__dirname, '..', 'SKOVO_BACKEND', 'venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py)) {
    console.warn('[global-setup] venv python not found — skipping re-seed');
    return;
  }
  try {
    execFileSync(py, ['seed_test_accounts.py'], { cwd: __dirname, stdio: 'pipe' });
    console.log('[global-setup] re-seeded portal accounts');
  } catch (e) {
    console.warn('[global-setup] account re-seed failed (continuing):',
      String(e.stderr || e.message).trim().split(/\r?\n/).slice(-2).join(' '));
  }

  // The DATA those accounts need, not just the accounts.
  //
  // This used to be a manual step, and forgetting it did not fail the run - it
  // produced about twenty honest-looking skips ("no task to open", "no colleges
  // to save", "the free student did not reach the cap"), which read as coverage
  // gaps rather than as a missing seed. The fixtures are load-bearing now: a
  // live cohort with an enrolment and an open task, and five colleges, because
  // the free saved-colleges cap is 3 and the colleges table is empty here.
  try {
    execFileSync(py, ['seed_ui_fixtures.py'], { cwd: __dirname, stdio: 'pipe' });
    console.log('[global-setup] re-seeded UI fixtures');
  } catch (e) {
    // Loud, because the symptom is skips rather than failures and nobody would
    // otherwise connect the two.
    console.warn('[global-setup] UI FIXTURE SEED FAILED - expect ~20 data-starved '
      + 'skips (task modal, college cap, deadline cases):',
      String(e.stderr || e.message).trim().split(/\r?\n/).slice(-2).join(' '));
  }
};

module.exports = async () => {
  reseed();
  const c = await request.newContext();
  const tokens = {};
  const failures = [];

  for (const [key, loginPath, email] of IDENTITIES) {
    const res = await c.post(API + loginPath, {
      data: { email: process.env[`SKOVO_${key.toUpperCase()}_EMAIL`] || email, password: PASSWORD },
    });
    const body = await res.json().catch(() => ({}));
    const token = tokenFrom(body);
    if (token) tokens[key] = token;
    else failures.push(`${key} (HTTP ${res.status()}: ${body.message || body.response?.message || 'no token'})`);
  }

  // A throwaway student for the signup/consent specs.
  const email = `e2e.student.${Date.now()}@skovo-test.local`;
  const reg = await c.post(API + '/auth/register', {
    data: { full_name: 'E2E Student', email, password: PASSWORD },
  });
  const regBody = await reg.json().catch(() => ({}));
  const fresh = tokenFrom(regBody);
  if (fresh) {
    await c.post(API + '/auth/consent/dob', {
      headers: { Authorization: `Bearer ${fresh}` },
      data: { date_of_birth: '2000-01-01' },
    }).catch(() => {});
    tokens.fresh = fresh;
    tokens.freshEmail = email;
  }
  await c.dispose();

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(tokens, null, 2));

  if (failures.length) {
    console.warn('\n[global-setup] Some logins failed:\n  - ' + failures.join('\n  - ') +
      '\n  If these are 429s, the login rate limit (50/hour) is exhausted — restart the' +
      '\n  backend to clear it (limits are stored in memory), or wait for the window.\n' +
      '  If they are 401s, run:  ..\\SKOVO_BACKEND\\venv\\Scripts\\python.exe seed_test_accounts.py\n');
  } else {
    console.log(`[global-setup] cached ${Object.keys(tokens).length} tokens → .auth/tokens.json`);
  }
};
