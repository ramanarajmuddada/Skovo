// The admin screen a notification is about.
const BASE = '/skovo-platform-panel-admin';
const ROUTES = {
  achiever_application: `${BASE}/achiever-review`,
  achiever_document:    `${BASE}/achiever-review`,
  payout_request:       `${BASE}/payments?tab=payouts`,
  support_issue:        `${BASE}/support?tab=issues`,
};

export const adminRouteFor = (n) => ROUTES[n?.reference_type] || null;

// The header bell and the Notifications page tell each other when read state or
// the list changes, so the badge never disagrees with the page.
export const NOTIFS_READ = 'skovo-admin-notifs-read';
export const NOTIFS_NEW = 'skovo-admin-notifs-new';
