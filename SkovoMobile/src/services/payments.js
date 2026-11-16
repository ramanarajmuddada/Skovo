// ── Razorpay checkout (native) ───────────────────────────────────────────────
// react-native-razorpay is a NATIVE module → it works in a dev build / EAS build,
// NOT in plain Expo Go. We lazy-require it so the rest of the app still runs in
// Expo Go; only payment throws a friendly message until you make a dev build:
//     npx expo prebuild && npx expo run:android   (or run:ios)
import { colors } from '../theme';

export function isPaymentsAvailable() {
  try { require('react-native-razorpay'); return true; } catch { return false; }
}

/**
 * Open Razorpay checkout. Resolves with
 *   { razorpay_payment_id, razorpay_order_id, razorpay_signature }
 * Rejects on cancel/failure.
 */
export function payWithRazorpay({ key, order_id, amount, name = 'SKOVO', description = '', prefill = {} }) {
  let RazorpayCheckout;
  try {
    RazorpayCheckout = require('react-native-razorpay').default;
  } catch (e) {
    return Promise.reject(new Error('Payments need a development build (react-native-razorpay is native and not in Expo Go). Run `npx expo prebuild` + a dev build, or pay on the web for now.'));
  }
  return RazorpayCheckout.open({
    key,
    order_id,
    amount,
    currency: 'INR',
    name,
    description,
    prefill,
    theme: { color: colors.primary },
  });
}

/**
 * Generic 2-step paid checkout used by cohorts / courses / sessions.
 * `endpoint` is the same enroll/book endpoint; step-1 (body) creates the order,
 * step-2 confirms with the Razorpay response. `client` is studentApi/achieverApi.
 *
 * `onAbandon(step1Response)` fires when the user dismisses or fails the payment
 * sheet. Session booking uses it to release the held slot — step 1 reserves the
 * slot, so without this a dismissed sheet leaves a ghost session sitting on a
 * time nobody can book.
 *
 * Returns { ok, message, free }.
 */
export async function checkout({ client, endpoint, body = {}, name, description, prefill, onAbandon }) {
  // Step 1 — create order (server applies any coupon and returns the net amount)
  const step1 = await client.post(endpoint, body);
  if (!step1.data.bool) return { ok: false, message: step1.data.response?.message || 'Could not start checkout.' };

  // No Razorpay order → it was free / 100%-off coupon → already enrolled.
  if (!step1.data.response?.razorpay_order_id) return { ok: true, free: true, message: step1.data.response?.message || 'Enrolled.' };

  const { razorpay_key, razorpay_order_id, amount } = step1.data.response;

  // Step 2 — native Razorpay sheet
  let pay;
  try {
    pay = await payWithRazorpay({ key: razorpay_key, order_id: razorpay_order_id, amount, name, description, prefill });
  } catch (e) {
    // Best-effort cleanup; never let a failed release mask the real reason the
    // payment did not go through.
    if (onAbandon) { try { await onAbandon(step1.data.response); } catch { /* ignore */ } }
    return { ok: false, message: e?.message || 'Payment cancelled.' };
  }

  // Step 3 — verify with the backend (same endpoint)
  const verify = await client.post(endpoint, {
    ...body,
    razorpay_order_id: pay.razorpay_order_id,
    razorpay_payment_id: pay.razorpay_payment_id,
    razorpay_signature: pay.razorpay_signature,
  });
  if (!verify.data.bool) return { ok: false, message: verify.data.response?.message || 'Payment verification failed.' };
  return { ok: true, message: verify.data.response?.message || 'Payment successful.' };
}
