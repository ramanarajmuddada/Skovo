// Where both portals go after Logout: the public home page.
//
// A browser can hold a student session and an achiever session at the same time.
// Signing out of one used to navigate to "/", which sends a signed-in student
// straight into the app -- and, if that older session had expired, on to the
// student login. The marker below tells the home page this visit is a sign-out,
// so it shows itself. The other portal's session is left alone.
const KEY = 'skovo_signed_out';

export function goHomeAfterSignOut() {
  try { sessionStorage.setItem(KEY, '1'); } catch { /* private mode */ }
  // A full load, so no signed-in screen or cached data survives in memory.
  window.location.replace('/');
}

export function cameFromSignOut() {
  try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; }
}

export function forgetSignOut() {
  try { sessionStorage.removeItem(KEY); } catch { /* private mode */ }
}
