// @ts-check
const { defineConfig, devices } = require('@playwright/test');

/**
 * SKOVO E2E config.
 *
 * Two servers must be up: the Flask backend (:5000) and the Vite dev server
 * (:3000). Playwright starts both if they aren't already running, and reuses
 * them if they are — so you can leave your own `run_backend.bat` / `npm run dev`
 * running and just launch the tests.
 *
 * The frontend talks to the backend through Vite's `/v1` proxy, so browser
 * tests use the Vite origin; the API-health suite hits the backend directly.
 */
const BACKEND = 'http://127.0.0.1:5000';
const FRONTEND = 'http://localhost:3000';

module.exports = defineConfig({
  testDir: './tests',
  globalSetup: require.resolve('./global-setup'),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,        // shared test user → run serially for clarity
  workers: 1,
  retries: 0,
  // case-reporter maps test titles carrying a workbook Test ID (X04-003, …)
  // back to SKOVO_v1_Test_Cases.xlsx; report_to_workbook.py merges its output
  // with the pytest equivalent. Untagged tests are unaffected.
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'report' }],
    ['./case-reporter.js', { outputFile: './results/playwright-cases.json' }],
  ],

  use: {
    baseURL: FRONTEND,
    actionTimeout: 10_000,
    navigationTimeout: 20_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // Chromium runs by default (fast). Set PW_ALL_BROWSERS=1 to also run Firefox,
  // WebKit/Safari, and the responsive mobile/tablet viewports.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.PW_ALL_BROWSERS === '1' ? [
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit',  use: { ...devices['Desktop Safari'] } },
      { name: 'mobile',  use: { ...devices['Pixel 5'] } },
      { name: 'tablet',  use: { ...devices['iPad (gen 7)'] } },
    ] : []),
  ],

  // Backend URL is exposed to tests via this env var.
  metadata: { backend: BACKEND },

  // The backend (:5000) and Vite (:3000) are expected to be running already —
  // start them with `run_backend.bat` and `npm run dev`. Auto-start was
  // dropped because the health-probe on these servers proved unreliable; see
  // README. If PW_MANAGE_SERVERS=1 is set, Playwright will try to start them.
  ...(process.env.PW_MANAGE_SERVERS === '1' ? {
    webServer: [
      { command: 'venv\\Scripts\\python.exe app.py', cwd: '../SKOVO_BACKEND',
        url: BACKEND + '/v1', reuseExistingServer: true, timeout: 90_000, ignoreHTTPSErrors: true },
      { command: 'npm run dev', cwd: '../Skovo',
        url: FRONTEND, reuseExistingServer: true, timeout: 120_000 },
    ],
  } : {}),
});
