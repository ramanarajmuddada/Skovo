// What a 1-on-1 card should say right now. "Live" used to mean merely
// "published", so a Friday session read as Live on a Thursday morning.
// Hours are entered in Indian time, so "now" is worked out in IST whatever the
// device's own clock zone is. day_of_week and offering.days count Monday as 0.

const IST_MS = 330 * 60000;
const mins = (t) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + m; };

export function offeringStatus(o, ranges, now = new Date()) {
  if (o.expired) return { kind: 'ended' };
  if (o.status === 'paused') return { kind: 'paused' };
  if (!ranges) return { kind: 'published' };        // hours still loading

  const ist = new Date(now.getTime() + IST_MS);
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();

  for (let i = 0; i < 28; i += 1) {
    const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + i));
    const iso = d.toISOString().slice(0, 10);
    const dow = (d.getUTCDay() + 6) % 7;
    if (o.days?.length && !o.days.includes(dow)) continue;
    if (o.available_from && iso < o.available_from) continue;
    if (o.available_to && iso > o.available_to) break;

    // Only hours long enough to fit one session count.
    const open = ranges
      .filter((r) => r.day_of_week === dow && mins(r.end_time) - mins(r.start_time) >= o.duration_min)
      .map((r) => [mins(r.start_time), mins(r.end_time)])
      .sort((a, b) => a[0] - b[0])
      .filter(([, end]) => i > 0 || end > nowMin);
    if (!open.length) continue;

    const [start] = open[0];
    if (i === 0 && start <= nowMin) return { kind: 'live' };
    return { kind: 'upcoming', date: iso, startMin: start, today: i === 0 };
  }
  return { kind: 'nohours' };
}
