/**
 * Zod schemas for the achiever portal's forms.
 *
 * WHAT THIS IS FOR
 *   Every achiever form except Register validates with ad-hoc `if (!x) return`
 *   checks, or not at all, so the same field is described differently on every
 *   screen — or silently accepted and rejected later by MySQL as a 500 with an
 *   opaque error id. These schemas give each required field one definition.
 *
 * SCOPE, DELIBERATELY NARROW
 *   **Required fields only.** Optional fields are typed loosely on purpose: a
 *   schema that rejects an empty optional field turns a working form into a
 *   broken one, which is the opposite of the point. Where an optional field has
 *   a real column ceiling it is capped and nothing more.
 *
 *   No flow changes. These describe what the forms already send; they do not
 *   add a field, remove one, or alter what any endpoint is called with.
 *
 * THE LIMITS ARE NOT INVENTED
 *   Every cap below mirrors either a server-side check or a real column, and
 *   the source is named beside it. That matters because the two must agree:
 *   a client that allows more than the server produces a 500 the user cannot
 *   act on, and a client that allows less silently forbids something the
 *   product supports.
 *
 *   Mirrors `SKOVO_BACKEND/portal/helpers/cohort_validation.py`,
 *   `portal/helpers/field_limits.py`, and column widths read from the database
 *   on 7 September 2026.
 *
 * THIS IS NOT A CONTROL
 *   A browser schema is a courtesy — every one of these endpoints is reachable
 *   with `curl`. Where a gap is a money risk rather than a typo risk it needs
 *   the server-side twin as well; those are marked NEEDS SERVER TWIN below and
 *   listed in `achiever.md` §7.3.
 *
 * USAGE
 *   import { coupon } from '../../schemas/achiever';
 *   const r = coupon.safeParse(form);
 *   if (!r.success) { setErrors(fieldErrors(r)); return; }
 */
import { z } from 'zod';

/* ─── Shared building blocks ──────────────────────────────────────────────── */

// Server caps — portal/helpers/field_limits.py
export const LIMITS = {
  EMAIL: 255,          // achievers.email VARCHAR(255)
  PASSWORD: 128,       // bcrypt truncates past 72 bytes; this is the stated cap
  FULL_NAME: 120,
  URL: 1000,
  UPI: 100,            // achievers.payout_upi VARCHAR(100)
  ACCOUNT_NAME: 150,   // achievers.payout_account_name VARCHAR(150)
  ACCOUNT_NUMBER: 50,  // achievers.payout_account_number VARCHAR(50)
  IFSC: 20,            // achievers.payout_ifsc VARCHAR(20)

  // portal/helpers/cohort_validation.py
  COHORT_TITLE: 255,
  COHORT_ABOUT: 5000,
  COHORT_LEVEL: 50,    // cohorts.level VARCHAR(50)
  DURATION: 1440,      // one session, so one day is the ceiling
  SEATS: 100000,

  // Column widths read from the database, not chosen here.
  COUPON_CODE: 40,     // coupons.code VARCHAR(40)
  TASK_TITLE: 255,     // cohort_tasks.title VARCHAR(255)
  COURSE_LEVEL: 30,    // achiever_courses.level VARCHAR(30)
  COURSE_CATEGORY: 100,// achiever_courses.category VARCHAR(100)
  DOMAIN_NAME: 100,    // domains.name VARCHAR(100)
  TEXT_SOFT: 5000,     // TEXT columns hold 65535; 5000 is a rendering ceiling
};

/** A required, trimmed string. Blank and whitespace-only both fail. */
const required = (label, max) =>
  z.string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/** An optional string that is still capped, so it cannot 1406 the column. */
const capped = (label, max) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`).optional().or(z.literal(''));

/**
 * A whole number arriving from an <input type="number">, which yields a STRING.
 * `z.coerce` is wrong here: it turns '' into 0, and blank means "not set" for
 * seats and price, not zero. Blank is handled by the caller's `.optional()`.
 */
const wholeNumber = (label, { min = 0, max = null } = {}) =>
  z.union([z.string(), z.number()])
    .refine(v => v !== '' && v !== null && v !== undefined, `${label} is required.`)
    .refine(v => Number.isInteger(Number(v)), `${label} must be a whole number.`)
    .refine(v => Number(v) >= min,
      min === 0 ? `${label} cannot be negative.` : `${label} must be at least ${min}.`)
    .refine(v => max === null || Number(v) <= max, `${label} must be ${max} or less.`);

/**
 * Same, but blank is allowed and means "not set".
 *
 * `.optional()` on the union, NOT `z.undefined()` inside it. In Zod v4 a
 * `z.undefined()` member does not make the key optional — the key must still be
 * present — so an absent `max_uses` failed with "expected nonoptional, received
 * undefined" and every coupon submit was rejected. Caught by the test below;
 * the schema read correctly and did the opposite.
 */
const optionalWholeNumber = (label, opts) =>
  z.union([z.literal(''), z.null(), wholeNumber(label, opts)]).optional();

/** Turns a failed safeParse into `{ field: 'message' }` for the form to render. */
export function fieldErrors(result) {
  const out = {};
  if (result.success) return out;
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key != null && !(key in out)) out[key] = issue.message;
  }
  return out;
}

/* ─── Auth ────────────────────────────────────────────────────────────────── */

export const login = z.object({
  email: required('Email', LIMITS.EMAIL).pipe(z.string().email('Enter a valid email address.')),
  password: z.string().min(1, 'Password is required.'),
});

export const register = z.object({
  full_name: required('Full name', LIMITS.FULL_NAME).pipe(
    z.string().min(2, 'Full name must be at least 2 characters.')),
  email: required('Email', LIMITS.EMAIL).pipe(z.string().email('Enter a valid email address.')),
  password: z.string()
    .min(6, 'Password must be at least 6 characters.')
    .max(LIMITS.PASSWORD, `Password must be ${LIMITS.PASSWORD} characters or fewer.`),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

// Six digits, because that is what send-otp generates and what the server
// hashes. Trimmed first: a pasted code often carries a trailing space.
export const otp = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

export const resetPassword = z.object({
  email: required('Email', LIMITS.EMAIL).pipe(z.string().email('Enter a valid email address.')),
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
  password: z.string()
    .min(6, 'Password must be at least 6 characters.')
    .max(LIMITS.PASSWORD, `Password must be ${LIMITS.PASSWORD} characters or fewer.`),
  confirmPassword: z.string().min(1, 'Confirm your password.'),
}).refine(d => d.password === d.confirmPassword, {
  message: 'Passwords do not match.',
  path: ['confirmPassword'],
});

/* ─── Profile ─────────────────────────────────────────────────────────────── */

export const profile = z.object({
  full_name: required('Full name', LIMITS.FULL_NAME),
  // Matches AchieverProfile: scheme is optional (LinkedIn's own copy panel
  // shows www.linkedin.com/in/name with no https://) and a company homepage
  // is not a profile. A generic z.string().url() would accept google.com
  // and reject the scheme-less paste the form already allows.
  linkedin_url: required('LinkedIn profile', LIMITS.URL).refine(
    (url) => /^(https?:\/\/)?([a-z]{2,3}\.)?linkedin\.com\/.+/i.test(url.replace(/^@/, '')),
    { message: 'Enter your LinkedIn profile address, e.g. linkedin.com/in/your-name' },
  ),
});

/* ─── Money forms — these are the ones worth doing first ──────────────────── */

/**
 * NEEDS SERVER TWIN — the discount ceiling.
 *
 * `value` has no upper bound anywhere today: the input is `min={1}` with no
 * `max`, the route does `_f(d.get('value')) or 0`, and the SP does
 * `IFNULL(p_value,0)`. Checkout clamps with `LEAST(v_discount, p_amount)`, so a
 * 500% coupon makes the cohort free rather than negative-priced — a giveaway
 * rather than a loss, but still not what anyone typed on purpose.
 *
 * 100 is the ceiling for a percentage because more than "all of it" is not a
 * discount. A flat amount has no natural ceiling, so it only has to be positive.
 */
export const coupon = z.object({
  code: required('Coupon code', LIMITS.COUPON_CODE).pipe(
    z.string().regex(/^[A-Za-z0-9_-]+$/,
      'Coupon code can use letters, numbers, hyphens and underscores only.')),
  discount_type: z.enum(['percent', 'flat'], { message: 'Choose a discount type.' }),
  applies_to: z.enum(['cohort', 'session'], { message: 'Choose cohorts or 1-on-1.' }).optional(),
  value: wholeNumber('Discount value', { min: 1 }),
  max_uses: optionalWholeNumber('Max uses', { min: 1 }),
  per_user_limit: optionalWholeNumber('Per-user limit', { min: 1 }),
  valid_from: z.string().optional().or(z.literal('')),
  valid_until: z.string().optional().or(z.literal('')),
})
  .refine(d => d.discount_type !== 'percent' || Number(d.value) <= 100, {
    message: 'A percentage discount cannot be more than 100%.',
    path: ['value'],
  })
  // A coupon that expires before it starts is never valid for a single moment,
  // and nothing rejects it today.
  .refine(d => !d.valid_from || !d.valid_until || new Date(d.valid_until) > new Date(d.valid_from), {
    message: 'Valid-until must be after valid-from.',
    path: ['valid_until'],
  });

/**
 * Mirrors `validate_cohort_input` exactly. Price 0 is a free cohort and blank
 * also means free, so price is optional with a floor rather than required.
 * Seats blank means uncapped.
 */
export const cohort = z.object({
  title: required('Title', LIMITS.COHORT_TITLE),
  session_date: required('Session date', 40),
  duration_minutes: wholeNumber('Duration', { min: 1, max: LIMITS.DURATION }),
  total_seats: optionalWholeNumber('Total seats', { min: 0, max: LIMITS.SEATS }),
  price: optionalWholeNumber('Price', { min: 0 }),
  about: capped('About', LIMITS.COHORT_ABOUT),
  level: capped('Level', LIMITS.COHORT_LEVEL),
  meeting_link: capped('Meeting link', LIMITS.URL),
  thumbnail_url: capped('Thumbnail URL', LIMITS.URL),
});

/**
 * NEEDS SERVER TWIN — `achiever_courses.py` imports no field limits at all, so
 * title and description have no stated ceiling. `title` is TEXT (65535) so it
 * will not 1406; the cap here is a rendering ceiling, not a column one.
 */
export const course = z.object({
  title: required('Title', 255),
  price: optionalWholeNumber('Price', { min: 0 }),
  duration_weeks: optionalWholeNumber('Duration in weeks', { min: 1, max: 520 }),
  level: capped('Level', LIMITS.COURSE_LEVEL),
  category: capped('Category', LIMITS.COURSE_CATEGORY),
  description: capped('Description', LIMITS.TEXT_SOFT),
  thumbnail_url: capped('Thumbnail URL', LIMITS.URL),
});

export const courseModule = z.object({
  title: required('Module title', 255),
  description: capped('Description', LIMITS.TEXT_SOFT),
});

/**
 * NEEDS SERVER TWIN — IFSC and UPI are length-capped server-side but never
 * format-checked, so a malformed value is accepted and only fails at the bank,
 * after an admin has approved the payout.
 *
 * At least one of bank or UPI must be present: `/achiever-payouts/request`
 * refuses outright without one, so a form that saves neither has only deferred
 * the error to the next screen.
 */
export const payoutDetails = z.object({
  payout_account_name: capped('Account name', LIMITS.ACCOUNT_NAME),
  payout_account_number: z.string().trim()
    .max(LIMITS.ACCOUNT_NUMBER, `Account number must be ${LIMITS.ACCOUNT_NUMBER} characters or fewer.`)
    .regex(/^[0-9]*$/, 'Account number can contain digits only.')
    .optional().or(z.literal('')),
  // A real IFSC is exactly 11 characters: four letters, a literal 0, then six
  // alphanumerics. The column is 20, which is why nothing has complained.
  payout_ifsc: z.string().trim().toUpperCase()
    .regex(/^[A-Z]{4}0[A-Z0-9]{6}$|^$/, 'Enter a valid 11-character IFSC, e.g. HDFC0001234.')
    .optional().or(z.literal('')),
  payout_upi: z.string().trim()
    .max(LIMITS.UPI, `UPI ID must be ${LIMITS.UPI} characters or fewer.`)
    .regex(/^([\w.-]{2,}@[a-zA-Z]{2,})?$/, 'Enter a valid UPI ID, e.g. name@bank.')
    .optional().or(z.literal('')),
})
  .refine(d => {
    const bank = d.payout_account_name && d.payout_account_number && d.payout_ifsc;
    return Boolean(bank || d.payout_upi);
  }, {
    message: 'Add a complete bank account (name, number, IFSC) or a UPI ID.',
    path: ['payout_upi'],
  });

/**
 * The amount only has to be a positive number here. The real ceiling is the
 * available balance, which only the server can know — it recomputes it inside a
 * row-locked transaction so two requests cannot both pass. Duplicating that
 * check in the browser would be a guess that goes stale between render and submit.
 */
export const payoutRequest = z.object({
  amount: z.union([z.string(), z.number()])
    .refine(v => v !== '' && v !== null && v !== undefined, 'Enter an amount.')
    .refine(v => !Number.isNaN(Number(v)), 'Amount must be a number.')
    .refine(v => Number(v) > 0, 'Amount must be greater than zero.')
    // payout_requests.amount is DECIMAL(10,2); past this MySQL raises "Out of
    // range" before the balance check can give a readable refusal.
    .refine(v => Number(v) <= 99999999.99, 'Amount must be 99,999,999.99 or less.'),
});

/* ─── The rest ────────────────────────────────────────────────────────────── */

export const task = z.object({
  cohort_id: required('Cohort', 36),
  title: required('Title', LIMITS.TASK_TITLE),
  description: capped('Description', LIMITS.TEXT_SOFT),
  due_date: z.string().optional().or(z.literal('')),
  score_weight: optionalWholeNumber('Score weight', { min: 0, max: 100 }),
  attachment_url: capped('Attachment URL', LIMITS.URL),
});

/**
 * Mirrors `_validate_time_range` and `_validate_day_of_week`, including the
 * end-after-start rule. The server also checks overlap against existing
 * windows, which the browser cannot do without the full list — that one stays
 * server-side and its message is shown as-is.
 */
const hhmm = (label) => required(label, 8).pipe(
  z.string().regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, `${label} must be HH:MM.`));

/** Dated one-off slots have a date instead of a weekday. Same clock rules. */
export const timeWindow = z.object({
  start_time: hhmm('Start time'),
  end_time: hhmm('End time'),
}).refine(d => d.end_time > d.start_time, {
  message: 'End time must be after start time.',
  path: ['end_time'],
});

export const availability = z.object({
  day_of_week: wholeNumber('Day', { min: 0, max: 6 }),
  start_time: hhmm('Start time'),
  end_time: hhmm('End time'),
}).refine(d => d.end_time > d.start_time, {
  message: 'End time must be after start time.',
  path: ['end_time'],
});

export const domain = z.object({
  name: required('Domain name', LIMITS.DOMAIN_NAME)
    .refine(s => s.length >= 3, { message: 'Use at least 3 characters.' }),
});

export default {
  LIMITS, fieldErrors,
  login, register, otp, resetPassword, profile,
  coupon, cohort, course, courseModule,
  payoutDetails, payoutRequest,
  task, availability, timeWindow, domain,
};
