/**
 * Which site is this bundle currently being served as?
 *
 * One build serves two hostnames — the student/achiever site (skovoai.com) and
 * the admin/super-admin site (skovoai.info). Caddy sends both to the same nginx
 * container, so the split has to happen here, at runtime, off the hostname.
 *
 * VITE_ADMIN_HOST is inlined by Vite at BUILD time. Leave it unset and the
 * heuristic below still catches the conventional `admin.` subdomain, so a
 * deploy that forgets the build arg degrades to "student landing everywhere"
 * rather than to a blank page.
 */

const ADMIN_HOST = (import.meta.env.VITE_ADMIN_HOST || '').trim().toLowerCase();
const WEB_HOST   = (import.meta.env.VITE_WEB_HOST   || '').trim().toLowerCase();

function currentHost() {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
}

/** True when the page is being served on the admin / super-admin domain. */
export function isAdminHost() {
  const host = currentHost();
  if (!host) return false;
  if (ADMIN_HOST) return host === ADMIN_HOST || host === `www.${ADMIN_HOST}`;
  return host.startsWith('admin.');
}

/**
 * Absolute URL of the student site, for links that must leave the admin domain.
 * Falls back to a relative '/' when VITE_WEB_HOST is unset — correct on the
 * student domain, and harmless in dev where both portals share localhost.
 */
export function studentSiteUrl(path = '/') {
  return WEB_HOST ? `https://${WEB_HOST}${path}` : path;
}
