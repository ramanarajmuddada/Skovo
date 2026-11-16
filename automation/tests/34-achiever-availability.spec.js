// Availability — weekly recurring hours and one-time dated slots.
//
// Phase 4 of the Achiever V1 redesign. Runs against the existing availability
// APIs; no backend or schema changed.
//
// The assertions worth keeping are the overlap ones. Neither POST endpoint
// checks for a clash, so the guard tested here is the only thing standing
// between an achiever and the same hour being offered to two students.
const { test, expect, request } = require('@playwright/test');
const { U, portalLogin, cachedTokens } = require('../utils/api');

let api, token;

test.beforeAll(async () => {
  const r = await portalLogin('achiever');
  token = r.token || cachedTokens().achiever;
  api = await request.newContext({
    extraHTTPHeaders: token ? { Authorization: `Bearer ${token}` } : {},
  });
  expect(token, 'seeded achiever should log in').toBeTruthy();
});
test.afterAll(async () => { await api?.dispose(); });

/** Guarantee a weekly recurring range exists, and return true.
 *
 *  These UI tests used to `test.skip()` when the fixture happened to be
 *  missing, which meant the confirm-before-delete guard — the whole point of
 *  the test — went unexercised on most runs. Seed it instead. */
async function ensureWeeklyRange() {
  const r = await resp(await api.get(U('/achiever-availability/my-availability')));
  if ((r.availability || []).length) return;
  await api.post(U('/achiever-availability/my-availability'),
    { data: { day_of_week: 3, start_time: '09:00', end_time: '10:00' } });
}

/** Guarantee at least one slot is booked, so the locked-slot UI can be tested.
 *  Booking is what flips a slot to `booked` (sp_achiever_slots_lock_available). */
/** A slot in the `booked` state, if one can be produced at all.
 *
 *  Returns false rather than throwing, and the caller skips with the reason.
 *  That is an honest skip, not a hidden failure: on this environment a booked
 *  slot cannot be manufactured, and pretending otherwise would mean asserting
 *  the locked state against a slot that is merely available.
 *
 *  WHY IT USUALLY CANNOT
 *    The seeded achiever's `session_rate` is 500, so booking opens a Cashfree
 *    order instead of confirming a session — and Cashfree cannot complete an
 *    order on this account ("transactions are not enabled", CLAUDE.md §4). The
 *    slot therefore stays `available`.
 *
 *    Zeroing the rate for the duration looks like the obvious way round and
 *    does not work: `session_rate` is listed in `_ACHIEVER_FIELDS` but is NOT
 *    declared in the admin achiever `update_parser`, so reqparse drops it, the
 *    endpoint answers "Achiever updated." and the stored value never moves.
 *    With the 1-on-1 rate also removed from the achiever's own profile form on
 *    2026-08-30, nothing in the product can set it — flagged in the change log,
 *    because whether rates should be editable is a product decision.
 *
 *  So: if an already-booked slot exists (someone completed a payment, or the
 *  rate is 0 in this environment), use it. Otherwise say why and skip.
 */
async function ensureBookedSlot() {
  const cur = await resp(await api.get(U('/achiever-availability/my-slots')));
  if ((cur.slots || []).some((x) => x.status === 'booked')) return true;

  const student = await request.newContext({
    extraHTTPHeaders: { Authorization: `Bearer ${cachedTokens().studentPro}` },
  });
  try {
    const dir = await resp(await student.get(U('/achievers/?per_page=50')));
    const me = (dir.mentors || []).find((m) => /E2E Achiever/i.test(m.full_name || ''));
    if (!me) return false;

    // Only worth attempting when the achiever is free. A paid rate opens an
    // order, and an order is not a booking.
    if (Number(me.session_rate || 0) > 0) return false;

    const date = new Date(Date.now() + 12 * 864e5).toISOString().slice(0, 10);
    const made = await resp(await api.post(U('/achiever-availability/my-slots'),
      { data: { slot_date: date, start_time: '16:00:00', end_time: '17:00:00' } }));
    if (!made.id) return false;

    await student.post(U(`/achievers/${me.mentor_id}/book`),
      { data: { slot_id: made.id, topic: 'E2E booked-slot fixture', phone: '9876543210' } });

    const after = await resp(await api.get(U('/achiever-availability/my-slots')));
    return (after.slots || []).some((x) => x.id === made.id && x.status === 'booked');
  } finally {
    await student.dispose();
  }
}

const resp = async (res) => (await res.json().catch(() => ({}))).response || {};
const asAchiever = async (page) => {
  await page.addInitScript((t) => localStorage.setItem('achiever_access_token', t), token);
};
const goto = async (page) => {
  await page.goto('/skovo-achiever-portal/availability', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);
};

// "Specific Slots" is both a tab and an inline link in the weekly help banner,
// so match on the tab strip's `aria-pressed` rather than the words alone.
const tab = (page, label) =>
  page.locator('button[aria-pressed]').filter({ hasText: label });

// ══════════════════════════════════════════════════════════════════════════
test.describe('availability API', () => {
  test('weekly availability returns day, start and end', async () => {
    const r = await resp(await api.get(U('/achiever-availability/my-availability')));
    expect(Array.isArray(r.availability)).toBe(true);
    if (!r.availability.length) return;
    for (const k of ['id', 'day_of_week', 'start_time', 'end_time']) {
      expect(r.availability[0]).toHaveProperty(k);
    }
  });

  test('slots return their status so booked ones can be locked', async () => {
    const r = await resp(await api.get(U('/achiever-availability/my-slots')));
    expect(Array.isArray(r.slots)).toBe(true);
    if (!r.slots.length) return;
    for (const k of ['id', 'slot_date', 'start_time', 'end_time', 'status']) {
      expect(r.slots[0]).toHaveProperty(k);
    }
  });

  test('a student token cannot manage achiever availability', async () => {
    const student = await request.newContext({
      extraHTTPHeaders: { Authorization: `Bearer ${cachedTokens().studentPro}` },
    });
    const r = await resp(await student.get(U('/achiever-availability/my-availability')));
    expect(r.message).toMatch(/Achiever access only/i);
    await student.dispose();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('weekly schedule', () => {
  test('renders all seven days with no runtime errors', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page);

    for (const d of ['Monday', 'Wednesday', 'Sunday']) {
      await expect(page.getByText(d, { exact: true })).toBeVisible();
    }
    // Editing is delete-and-re-add because there is no PUT; the screen must
    // say so rather than leave the achiever hunting for an edit control.
    await expect(page.getByText(/remove it and add the new one/i)).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('an overlapping weekly range is refused before it reaches the server', async ({ page }) => {
    await asAchiever(page);
    await goto(page);

    // Add 09:00–17:00 to a day, then try 10:00–12:00 on the same day.
    const existing = await resp(await api.get(U('/achiever-availability/my-availability')));
    const busyDay = existing.availability?.[0]?.day_of_week;
    test.skip(busyDay === undefined, 'no existing weekly range to clash with');

    const dayName = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'][busyDay];
    await page.getByRole('button', { name: new RegExp(`Add time to ${dayName}`, 'i') }).click();

    const row = existing.availability.find((a) => a.day_of_week === busyDay);
    const inputs = page.locator('input[type="time"]');
    await inputs.first().fill(row.start_time.slice(0, 5));
    await inputs.nth(1).fill(row.end_time.slice(0, 5));
    await page.getByRole('button', { name: /^Save$/i }).click();

    await expect(page.getByText(/Overlaps your existing/i)).toBeVisible();
  });

  test('end time must be after start', async ({ page }) => {
    await asAchiever(page);
    await goto(page);
    await page.getByRole('button', { name: /Add time to Monday/i }).click();
    const inputs = page.locator('input[type="time"]');
    await inputs.first().fill('15:00');
    await inputs.nth(1).fill('09:00');
    await page.getByRole('button', { name: /^Save$/i }).click();
    await expect(page.getByText(/End time must be after start/i)).toBeVisible();
  });

  test('removing a recurring range asks first', async ({ page }) => {
    await ensureWeeklyRange();
    await asAchiever(page);
    await goto(page);
    // Wait for the range to render rather than sampling after a fixed delay —
    // the old fixed 1200ms made this skip whenever the fetch was slower.
    const remove = page.getByRole('button', { name: /^Remove .* to .*/i }).first();
    await expect(remove, 'the seeded weekly range should render a Remove control')
      .toBeVisible({ timeout: 20_000 });
    await remove.click();
    // A recurring window applies to every week — deleting it silently was the
    // old behaviour.
    await expect(page.getByText(/applies to every week/i)).toBeVisible();
    await page.getByRole('button', { name: /Cancel/i }).first().click();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('specific slots', () => {
  test('the tab renders and validates its own times', async ({ page }) => {
    await asAchiever(page);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await goto(page);

    await tab(page, 'Specific Slots').click();
    await expect(page.getByText(/Add a Specific Slot/i)).toBeVisible();

    await page.getByRole('button', { name: /Add Slot/i }).click();
    await expect(page.getByText(/Please select a date/i)).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('a booked slot is locked rather than deletable', async ({ page }) => {
    // An honest skip, not a soft pass. See ensureBookedSlot: a booked slot
    // cannot be manufactured while the seeded achiever charges for sessions and
    // the gateway cannot take a payment, and asserting the locked state against
    // an *available* slot would be asserting nothing.
    test.skip(!(await ensureBookedSlot()),
      'no booked slot exists — the seeded achiever charges, and Cashfree cannot '
      + 'complete an order on this account');

    await asAchiever(page);
    await goto(page);
    await tab(page, 'Specific Slots').click();
    // The slot belongs to a student now — it says Booked instead of offering
    // a delete control.
    await expect(page.getByText('Booked', { exact: true }).first()).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════════════════
test.describe('responsive', () => {
  const SIZES = [
    ['mobile 390', 390, 844], ['tablet 820', 820, 1180],
    ['laptop 1440', 1440, 900], ['ultra 2560', 2560, 1440],
  ];

  for (const [name, w, h] of SIZES) {
    test(`Availability @ ${name}`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await asAchiever(page);
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));

      await goto(page);
      await expect(page.getByRole('heading', { name: /Availability/i, level: 1 })).toBeVisible();

      expect(errors).toEqual([]);
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
    });
  }

  test('both tabs fit a 360px viewport', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await asAchiever(page);
    await goto(page);
    await tab(page, 'Specific Slots').click();
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
