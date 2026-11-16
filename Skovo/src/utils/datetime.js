/**
 * Datetime helpers for `<input type="datetime-local">`.
 *
 * The API sends UTC with a trailing `Z`. A datetime-local input speaks local
 * wall-clock time with no zone at all. The two are not interchangeable, and the
 * shortcut that looks like it works — `value.slice(0, 16)` — drops the `Z` and
 * hands UTC to the input as though it were local.
 *
 * That produced a cohort whose card read "9:15 pm" while its own edit form read
 * "15:45". The display mismatch is the visible half; the damaging half is that
 * opening the form and saving without touching the field posted 15:45 as local
 * time, the server read it as IST, and the session moved 5.5 hours earlier —
 * again on every save, compounding each time.
 *
 * Only the inbound direction needs converting. The input already yields local
 * time, which is what the server expects to receive.
 */

/** UTC ISO string → the `YYYY-MM-DDTHH:mm` a datetime-local input expects. */
export function toDateTimeLocal(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
       + `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** UTC ISO string → the `YYYY-MM-DD` a plain date input expects. */
export function toDateInput(iso) {
  const s = toDateTimeLocal(iso);
  return s ? s.slice(0, 10) : '';
}


/** "5 min ago", "3 h ago", "2 days ago", then a date. null -> "never". */
export function ago(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return mins <= 1 ? 'just now' : `${mins} min ago`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} day${d === 1 ? '' : 's'} ago`;
  return new Date(iso).toLocaleDateString('en-IN', { dateStyle: 'medium' });
}
