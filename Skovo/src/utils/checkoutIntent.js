/**
 * Checkout intent — remembers which Skovo Pro plan a logged-out visitor picked
 * on the landing page's pricing section, so the signup / login detour doesn't
 * lose it.
 *
 * The landing page is public and the subscribe endpoint is JWT-only, so a
 * visitor who taps "Get Skovo Pro" has to create an account first. We stash the
 * plan key here, and the screens that finish authentication (Login, VerifyEmail)
 * send the user to /skovo-pro with that plan preselected and checkout already
 * opening, instead of dropping them on the dashboard to find it themselves.
 */
const KEY = 'skovo_pending_plan';
const VALID = ['monthly', 'quarterly', 'annual'];

export function setPendingPlan(planKey) {
  if (!VALID.includes(planKey)) return;
  try { localStorage.setItem(KEY, planKey); } catch { /* private mode — intent is a nicety */ }
}

export function peekPendingPlan() {
  try {
    const v = localStorage.getItem(KEY);
    return VALID.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function consumePendingPlan() {
  try {
    const v = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    return VALID.includes(v) ? v : null;
  } catch {
    return null;
  }
}

export function clearPendingPlan() {
  try { localStorage.removeItem(KEY); } catch { /* nothing to clear */ }
}

/** Where to land after a successful sign-in / sign-up. */
const RETURN_KEY = 'skovo_return_to';

/** Remember a page (e.g. a shared achiever profile) to come back to after
 *  login / sign-up. Only same-site paths. */
export function setReturnPath(path) {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return;
  try { localStorage.setItem(RETURN_KEY, path); } catch { /* private mode */ }
}

function consumeReturnPath() {
  try {
    const v = localStorage.getItem(RETURN_KEY);
    localStorage.removeItem(RETURN_KEY);
    return v && v.startsWith('/') && !v.startsWith('//') ? v : null;
  } catch {
    return null;
  }
}

export function postAuthPath(fallback = '/career-path') {
  const back = consumeReturnPath();
  if (back) return back;
  // Peek only — first login may still need Profile before checkout. Consuming
  // here would drop the plan when MainLayout redirects an incomplete student.
  const plan = peekPendingPlan();
  return plan ? `/skovo-pro?plan=${plan}&checkout=1` : fallback;
}

export const PLAN_KEYS = VALID;
