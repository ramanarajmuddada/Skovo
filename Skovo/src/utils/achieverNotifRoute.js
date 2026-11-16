// Where tapping an achiever notification goes (bell list + Notifications page).
const BASE = '/skovo-achiever-portal';

const ROUTE_OF = {
  achiever: `${BASE}/application`, application: `${BASE}/application`, document: `${BASE}/application`,
  booking: `${BASE}/bookings`, session: `${BASE}/bookings`, enrollment: `${BASE}/bookings`,
  cohort: `${BASE}/cohorts`,
  payout: `${BASE}/earnings`, earning: `${BASE}/earnings`, refund: `${BASE}/earnings`,
  task: `${BASE}/tasks`, submission: `${BASE}/review-queue`,
  strike: BASE, support_issue: `${BASE}/support`, referral: `${BASE}/referrals`,
};

// Older class and strike notices were all tagged 'achiever' (the application
// screen). Their title says what they are, so route those by title.
export const routeFor = (n) => {
  const t = (n.title || '').toLowerCase();
  if (n.reference_type === 'achiever') {
    if (/strike|paused|suspended/.test(t)) return BASE;
    if (/1-on-1/i.test(n.message || '')) return `${BASE}/bookings`;
    if (/class|start|session|booking/.test(t)) return `${BASE}/cohorts`;
  }
  return ROUTE_OF[n.reference_type];
};
