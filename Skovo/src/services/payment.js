/**
 * Cashfree checkout, in one place.
 *
 * The three paid flows — 1-on-1 sessions, cohorts, courses — each had their own
 * copy of the gateway dance: load the SDK, build the options object, open it,
 * handle dismissal. Three copies meant three chances to get the abandon path
 * subtly different, and the abandon path is the one that decides whether a
 * held seat comes back.
 *
 * The server is the source of truth for whether a payment succeeded. Nothing
 * here reports success — it reports that the widget closed, and the caller then
 * asks the backend what actually happened. A browser callback can be closed,
 * replayed, or fabricated; the webhook cannot.
 */

const SDK_URL = 'https://sdk.cashfree.com/js/v3/cashfree.js';

let sdkPromise = null;

/** Load the Cashfree SDK once, no matter how many flows ask for it. */
export function loadCashfree() {
  if (window.Cashfree) return Promise.resolve(true);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise(resolve => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.onload = () => resolve(Boolean(window.Cashfree));
    s.onerror = () => { sdkPromise = null; resolve(false); };
    document.body.appendChild(s);
  });
  return sdkPromise;
}

/** The signed-in user, or an empty object. localStorage can hold junk. */
export function currentUser() {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
}

/**
 * Cashfree requires customer_phone to create an order, and SKOVO accounts can
 * be created with an email alone — every existing account has phone unset. So
 * checkout collects it rather than assuming the profile has one.
 *
 * Indian mobile numbers: 10 digits starting 6-9. Anything else is rejected here
 * rather than at the gateway, where the error is opaque.
 */
export function normalisePhone(input) {
  const digits = String(input || '').replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91')
    ? digits.slice(2)
    : digits;
  return /^[6-9]\d{9}$/.test(local) ? local : null;
}

export function needsPhone(user = currentUser()) {
  return !normalisePhone(user.phone);
}

/**
 * Open Cashfree checkout for a payment session opened by the server.
 *
 * Resolves when the widget closes — for any reason. It never resolves "paid":
 * the caller polls the backend, which only trusts the webhook.
 *
 * `mode` must match the credentials the server used, or the session id will not
 * be found. It comes from the server for that reason, never from a build flag.
 */
export async function openCheckout({ paymentSessionId, mode, redirectTarget = '_modal' }) {
  const ok = await loadCashfree();
  if (!ok) throw new Error('Could not load the payment gateway. Check your connection and retry.');
  if (!paymentSessionId) throw new Error('No payment session was returned by the server.');

  const cashfree = window.Cashfree({ mode: mode === 'production' ? 'production' : 'sandbox' });

  // The SDK resolves on close, error, and success alike. Treat all three the
  // same: the widget is done, now go ask the server.
  const result = await cashfree.checkout({
    paymentSessionId,
    redirectTarget,
  });

  return {
    closed: true,
    error: result?.error || null,
  };
}

/**
 * Ask the server what happened, with a short bounded retry.
 *
 * The webhook and the browser race: the student is usually back before Cashfree
 * has called us. Rather than show a wrong answer, poll briefly. If it is still
 * unresolved after this, the honest message is "we are confirming" — never
 * "failed", because the money may well have left their account.
 */
export async function confirmOrder(api, orderId, { attempts = 6, delayMs = 1500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    try {
      const { data } = await api.get(`/payments/orders/${orderId}`);
      const status = data?.response?.status;
      if (status === 'paid' || status === 'settled') return { paid: true, status };
      if (status === 'failed' || status === 'expired') return { paid: false, status };
    } catch {
      // Network blip mid-poll is not an answer — keep trying.
    }
    if (i < attempts - 1) await new Promise(r => setTimeout(r, delayMs));
  }
  return { paid: false, status: 'pending', pending: true };
}
