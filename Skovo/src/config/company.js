// Defaults for the business details. The live values come from Admin › Support ›
// Company (GET /public/company, merged in hooks/useCompany.js); these only show
// until Admin fills a field, and stay marked "To confirm" while they do.
//
// The single source of truth for the business details that appear across the
// legal pages, the footer and the contact page.
//
// Cashfree and AWS SES both review these pages before approving the account, so
// the values have to be real and consistent everywhere. They are gathered here
// so there is exactly one place to change when the confirmed details arrive.
//
// TODO(business): every field flagged `PLACEHOLDER: true` still holds a stand-in.
// Replace the value and drop the flag. Anything still flagged renders with a
// visible "confirm" marker on the page, so an unreplaced placeholder cannot ship
// unnoticed into a policy a regulator reads.

const P = (value) => ({ value, PLACEHOLDER: true });
const R = (value) => ({ value, PLACEHOLDER: false });

export const COMPANY = {
  // The product name is real and used in running copy.
  brand: R('SKOVO'),

  // The registered entity that actually contracts with users and Cashfree.
  legalName: P('Skovo (registered entity name to be confirmed)'),

  // support@ is live in the codebase already; the rest are stand-ins.
  supportEmail: R('support@skovoai.com'),
  grievanceEmail: P('grievance@skovoai.com'),
  phone: P('+91 00000 00000'),

  registeredAddress: P('Registered office address, City, State, PIN — to be confirmed'),

  // Only if the entity is GST-registered; leave blank-flagged until confirmed.
  gstin: P('GSTIN — to be confirmed'),

  // Named grievance officer is a DPDP / IT-Rules expectation for a consumer app.
  grievanceOfficer: P('Grievance Officer name — to be confirmed'),

  // Governing law venue for the Terms.
  jurisdiction: P('Courts at [City], India — to be confirmed'),

  // Support hours shown on the Contact page.
  supportHours: P('Monday–Saturday, 10:00–18:00 IST'),

  domains: R(['skovoai.com', 'skovoai.info']),
};

/** True if any field still carries a placeholder — the pages use this to show a
 *  single, honest "these details are being finalised" banner rather than
 *  pretending stand-in text is final. */
export const HAS_PLACEHOLDERS = Object.values(COMPANY).some(
  (f) => f && typeof f === 'object' && f.PLACEHOLDER,
);

/** Read a field's value regardless of whether it is a placeholder wrapper. */
export const val = (field) => (field && typeof field === 'object' && 'value' in field ? field.value : field);

/** True if this specific field is still a placeholder. */
export const isPlaceholder = (field) => Boolean(field && typeof field === 'object' && field.PLACEHOLDER);

// The five policy links Cashfree/SES expect, in the order they appear in the
// footer. Kept here (not in PolicyLayout) so that component file exports only
// components, per the app's react-refresh lint rule.
export const POLICY_LINKS = [
  { to: '/terms', label: 'Terms & Conditions' },
  { to: '/privacy', label: 'Privacy Policy' },
  { to: '/refund', label: 'Refund & Cancellation' },
  { to: '/pricing', label: 'Pricing' },
  { to: '/contact', label: 'Contact Us' },
];
