/* Cancellation rule helpers, shared by the student box and the admin tab. */
const hrs = (h) => (h >= 48 && h % 24 === 0 ? `${h / 24} days` : `${h} ${h === 1 ? 'hour' : 'hours'}`);

/** "24 hours or more before" / "2–24 hours before" / "Less than 2 hours before". */
export function ruleLabel(rules, i) {
  const h = rules[i].min_hours;
  if (rules.length === 1) return 'Any time before the class';
  if (i === 0) return `${hrs(h)} or more before`;
  const upper = rules[i - 1].min_hours;
  if (h === 0) return `Less than ${hrs(upper)} before`;
  return `${h}–${hrs(upper)} before`;
}

export const refundOf = (price, pct) => Math.round(Number(price || 0) * Number(pct || 0)) / 100;
