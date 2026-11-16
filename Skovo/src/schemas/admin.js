/**
 * Zod schemas for the admin console's forms.
 *
 * WHY THIS EXISTS
 *   The achiever and student portals each had one of these; the admin console
 *   had none. Its login validated with `if (!email || !password)` — which
 *   accepts `abc` as an email address, sends it, and waits for the server to
 *   say "invalid credentials". An admin who fat-fingers their address is told
 *   their password is wrong.
 *
 * SCOPE
 *   Auth only, for now. The rest of the console's forms still validate ad hoc;
 *   this is the file they move into when they do.
 *
 * THIS IS NOT A CONTROL
 *   Same caveat as the achiever schemas: a browser schema is a courtesy, and
 *   every one of these endpoints is reachable with curl. The server checks the
 *   credentials; this only stops a typo costing a round trip and a misleading
 *   error.
 *
 * USAGE
 *   import * as schema from '../../schemas/admin';
 *   import { fieldErrors } from '../../schemas/achiever';
 *   const r = schema.login.safeParse(form);
 *   if (!r.success) { setError(Object.values(fieldErrors(r))[0]); return; }
 */
import { z } from 'zod';

// Mirrors the achiever side: admins.email is VARCHAR(255), and bcrypt truncates
// past 72 bytes so 128 is the stated cap rather than a real ceiling.
export const LIMITS = {
  EMAIL: 255,
  PASSWORD: 128,
};

const required = (label, max) =>
  z.string()
    .trim()
    .min(1, `${label} is required.`)
    .max(max, `${label} must be ${max} characters or fewer.`);

/* ─── Auth ────────────────────────────────────────────────────────────────── */

export const login = z.object({
  email: required('Email', LIMITS.EMAIL).pipe(z.string().email('Enter a valid email address.')),
  // Deliberately only "not empty". A minimum length here would reject a correct
  // password that predates whatever rule we invent, and lock an admin out of
  // their own console over a client-side guess about the server's rules.
  password: z.string().min(1, 'Password is required.'),
});

export const forgotPassword = z.object({
  email: required('Email', LIMITS.EMAIL).pipe(z.string().email('Enter a valid email address.')),
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
