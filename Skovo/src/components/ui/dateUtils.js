/**
 * Date helpers shared by DatePicker and anything that renders a stored date.
 *
 * Separate from DatePicker.jsx so that file only exports a component (mixing
 * the two breaks fast refresh). The wire format everywhere is ISO `YYYY-MM-DD`;
 * humans see dd/mm/yyyy.
 */

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
export const DOW = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const pad = (n) => String(n).padStart(2, '0');

/** ISO string -> local Date at midnight, or null if it isn't a real date. */
export function parseIso(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  // Rejects 31/02 and friends, which JS would otherwise roll into March.
  return (dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d) ? dt : null;
}

export const toIso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export const isoToDisplay = (iso) => {
  const d = parseIso(iso);
  return d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : '';
};

export const displayToIso = (txt) => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((txt || '').trim());
  if (!m) return null;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return parseIso(iso) ? iso : null;
};

/** Long form for read-only display: "15 March 2006". */
export const isoToLong = (iso) => {
  const d = parseIso(iso);
  return d ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}` : '';
};

/** Completed years between `iso` and today, or null. */
export function ageFrom(iso) {
  const d = parseIso(iso);
  if (!d) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const before = now.getMonth() < d.getMonth()
    || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate());
  return before ? age - 1 : age;
}

export const todayIso = () => {
  const n = new Date();
  return toIso(n.getFullYear(), n.getMonth(), n.getDate());
};

/** ISO for the same day/month N years back — used for date-of-birth bounds. */
export const yearsAgoIso = (n) => {
  const d = new Date();
  return toIso(d.getFullYear() - n, d.getMonth(), d.getDate());
};
