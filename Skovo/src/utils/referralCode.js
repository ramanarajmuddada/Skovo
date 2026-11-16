/**
 * Referral code — keeps the ?ref= from a Refer & Earn link while the friend
 * looks around (Login, back, the landing page) before signing up. Without it
 * the code lived only in the signup URL and any detour dropped it.
 *
 * Students and achievers use separate keys: a student link opened in the
 * same browser must not attach to an achiever application, or the reverse.
 * Cleared once signup finishes.
 */
const KEYS = { student: 'skovo_ref_student', achiever: 'skovo_ref_achiever' };
const CODE = /^SK[VA]-[A-Z0-9-]{8,32}$/;

export function rememberReferralCode(who, fromUrl) {
  const code = (fromUrl || '').trim().toUpperCase();
  if (CODE.test(code)) {
    try { localStorage.setItem(KEYS[who], code); } catch { /* private mode — the URL still has it */ }
    return code;
  }
  try {
    const saved = localStorage.getItem(KEYS[who]) || '';
    return CODE.test(saved) ? saved : '';
  } catch {
    return '';
  }
}

export function clearReferralCode(who) {
  try { localStorage.removeItem(KEYS[who]); } catch { /* nothing to clear */ }
}
