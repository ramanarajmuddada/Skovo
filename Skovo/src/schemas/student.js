/**
 * Zod schemas for student auth forms.
 *
 * Register already validates in SignUp.jsx. Login and verify-email used
 * ad-hoc `if` checks, so the same field failed with different copy (or not
 * at all). One schema per form, field errors on the input.
 */
import { z } from 'zod';

export function fieldErrors(result) {
  const out = {};
  if (result.success) return out;
  for (const issue of result.error.issues) {
    const key = issue.path[0];
    if (key != null && !(key in out)) out[key] = issue.message;
  }
  return out;
}

const EMAIL = 255;

export const login = z.object({
  email: z.string()
    .trim()
    .min(1, 'Enter your email address.')
    .max(EMAIL, `Email must be ${EMAIL} characters or fewer.`)
    .email('Enter a valid email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

// OTP login is email only. Phone was accepted here and the field said "Phone
// or Email", but SMS is not wired up in this deployment -- a number would have
// been taken, validated, and then sent nothing. Email is the one channel that
// actually delivers, so it is the only one offered.
export const otpLogin = z.object({
  identifier: z.string()
    .trim()
    .min(1, 'Enter your email address.')
    .email('Enter a valid email address.'),
});

export const otp = z.object({
  otp: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

const lastTenDigits = (v) => (v || '').replace(/\D/g, '').slice(-10);

// Profile personal fields. Education / goals keep their own stage rules.
export const profilePersonal = z.object({
  full_name: z.string()
    .trim()
    .min(2, 'Full name must be at least 2 characters.'),
  phone: z.string()
    .refine(
      (v) => !(v || '').trim() || /^[6-9]\d{9}$/.test(lastTenDigits(v)),
      'Enter a valid 10-digit mobile number.',
    ),
});

function asHttpUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Task submit: a link, a note, or both. A filled link must be http(s).
export const taskSubmit = z.object({
  evidence_url: z.string(),
  evidence_text: z.string(),
}).superRefine((d, ctx) => {
  const url = (d.evidence_url || '').trim();
  const text = (d.evidence_text || '').trim();
  if (!url && !text) {
    ctx.addIssue({ code: 'custom', path: ['evidence_url'], message: 'Enter a link or a description.' });
    return;
  }
  if (url && !asHttpUrl(url)) {
    ctx.addIssue({ code: 'custom', path: ['evidence_url'], message: 'Enter a valid link (https://…).' });
  }
});

// College predictor: exam + whole-number rank + reservation category.
export const collegePredict = z.object({
  exam: z.string().trim().min(1, 'Pick an exam.'),
  rank: z.string()
    .trim()
    .min(1, 'Enter your rank.')
    .regex(/^\d+$/, 'Enter a whole number.')
    .refine((v) => Number(v) >= 1 && Number(v) <= 9_999_999, 'Enter a valid rank.'),
  category: z.string().trim().min(1, 'Pick your reservation category.'),
});

// College review: overall stars required; the rest is optional copy.
export const collegeReview = z.object({
  rating: z.number().int().min(1, 'Pick an overall rating.').max(5),
  review_text: z.string().max(2000, 'Keep the review to 2000 characters.'),
  pros: z.string().max(500, 'Keep this to 500 characters.'),
  cons: z.string().max(500, 'Keep this to 500 characters.'),
});

// Apply: vault file, link, note, or none. A filled link must be http(s).
export const opportunityApply = z.object({
  resume_link: z.string(),
  cover_note: z.string().max(2000, 'Keep the note to 2000 characters.'),
}).superRefine((d, ctx) => {
  const url = (d.resume_link || '').trim();
  if (url && !asHttpUrl(url)) {
    ctx.addIssue({ code: 'custom', path: ['resume_link'], message: 'Enter a valid link (https://…).' });
  }
});

export const assembleCommunity = z.object({
  name: z.string().trim()
    .min(3, 'Name must be at least 3 characters.')
    .max(80, 'Keep the name to 80 characters.'),
  description: z.string().max(500, 'Keep this to 500 characters.'),
  category: z.string().trim().min(1, 'Pick a category.'),
  join_type: z.string().trim().min(1, 'Pick who can join.'),
  max_members: z.string().refine((v) => {
    const s = (v || '').trim();
    if (!s) return true;
    return /^\d+$/.test(s) && Number(s) >= 2 && Number(s) <= 9999;
  }, 'Enter a limit of 2 or more, or leave empty.'),
});

// BhaAI question. The server enforces the same 500 (bhaai.MAX_QUESTION_CHARS).
export const bhaaiQuestion = z.object({
  message: z.string().trim().min(1, 'Type a question first.').max(500, 'Keep it under 500 characters.'),
});

export const assembleMessage = z.object({
  content: z.string().trim().min(1, 'Enter a message.').max(2000, 'Keep this to 2000 characters.'),
});

function asVaultUrl(v) {
  const s = (v || '').trim();
  if (!s) return false;
  if (s.startsWith('/uploads/')) return true;
  return asHttpUrl(s);
}

export const vaultDocument = z.object({
  name: z.string().trim()
    .min(2, 'Name must be at least 2 characters.')
    .max(80, 'Keep the name to 80 characters.'),
  file_url: z.string().trim()
    .min(1, 'Upload a file or paste a link.')
    .refine(asVaultUrl, 'Enter a valid link (https://…) or upload a file.'),
  file_type: z.string().max(40, 'Keep the type short.'),
  category: z.string().trim().min(1, 'Pick a folder.'),
  tags: z.string().max(200, 'Keep tags to 200 characters.'),
});

export const vaultPublicProfile = z.object({
  slug: z.string().trim()
    .min(3, 'Link name must be at least 3 characters.')
    .max(60, 'Keep the link name to 60 characters.')
    .refine(
      (v) => /^[a-zA-Z0-9]+(?:[- ][a-zA-Z0-9]+)*$/.test(v),
      'Use letters, numbers and hyphens.',
    ),
  headline: z.string().max(140, 'Keep the headline to 140 characters.'),
});

export const supportIssue = z.object({
  // Any value from the support_category master; empty means none picked.
  category: z.string().trim().min(1, 'Pick a category.'),
  subject: z.string().trim()
    .min(3, 'Subject must be at least 3 characters.')
    .max(200, 'Keep the subject to 200 characters.'),
  body: z.string().trim()
    .min(10, 'Describe the problem in at least 10 characters.')
    .max(4000, 'Keep this to 4000 characters.'),
  reference_type: z.string(),
  reference_id: z.string().max(36, 'Reference id is too long.'),
});

export function proCheckout({ requirePhone } = {}) {
  return z.object({
    plan: z.string().trim().min(1, 'Pick a plan.'),
    phone: requirePhone
      ? z.string().refine(
          (v) => /^[6-9]\d{9}$/.test((v || '').replace(/\D/g, '').slice(-10)),
          'Enter a valid 10-digit mobile number.',
        )
      : z.string(),
    coupon: z.string().refine((v) => {
      const s = (v || '').trim();
      if (!s) return true;
      return /^[A-Z0-9_-]{3,32}$/i.test(s);
    }, 'Enter a valid coupon code.'),
  });
}
