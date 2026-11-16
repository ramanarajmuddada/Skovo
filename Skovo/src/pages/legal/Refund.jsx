import useCompany from '../../hooks/useCompany';
import React from 'react';
import { Link } from 'react-router-dom';
import PolicyLayout from './PolicyLayout';
import { val } from '../../config/company';

const UPDATED = '18 October 2026';

export default function Refund() {
  const { company: COMPANY } = useCompany();
  return (
    <PolicyLayout title="Refund & Cancellation Policy" updated={UPDATED}>
      <p>
        This policy explains when and how you can cancel a paid item on {val(COMPANY.brand)} and
        how refunds are handled. It applies to cohorts, one-on-one sessions and
        the SKOVO Pro membership. Payments are processed by our
        partner Cashfree; approved refunds are returned to your original payment
        method.
      </p>

      <h2>1. Cohorts (group sessions)</h2>
      <ul>
        <li><strong>24 hours or more</strong> before the scheduled start — full refund.</li>
        <li><strong>Between 2 and 24 hours</strong> before the start — 50% refund.</li>
        <li><strong>Under 2 hours before, or after the session has started</strong> — no refund, as the Achiever's slot has been committed.</li>
        <li>If the Achiever cancels a cohort, you receive a <strong>full refund</strong>.</li>
      </ul>

      <h2>2. One-on-one sessions</h2>
      <ul>
        <li>Cancel <strong>24 hours or more</strong> before the booked time — full refund.</li>
        <li>Cancel <strong>within 24 hours</strong> — the session may not be refundable, since the Achiever has held the slot for you.</li>
        <li>If the Achiever does not show up or cancels, you receive a <strong>full refund</strong>.</li>
      </ul>

      <h2>3. SKOVO Pro membership</h2>
      <p>
        SKOVO Pro is a subscription. You may cancel at any time to stop future
        renewals; cancellation stops the next renewal and does not refund the
        current period. If a charge was clearly made in error, contact us and we
        will investigate.
      </p>

      <h2>4. Failed and duplicate payments</h2>
      <p>
        If your payment failed but you were charged, or you were charged twice for
        the same item, the amount is refunded in full. Some banks show a
        temporarily "blocked" amount for a failed payment that is released
        automatically within a few working days.
      </p>

      <h2>5. How to request a refund</h2>
      <p>
        Cancel from the relevant screen where a cancel option is available, or
        email <a href={`mailto:${val(COMPANY.supportEmail)}?subject=${encodeURIComponent('SKOVO refund request')}`}>{val(COMPANY.supportEmail)}</a> with your
        registered email and the order reference. Please include the order
        reference shown on your confirmation — it helps us locate the transaction
        quickly.
      </p>

      <h2>6. Processing time</h2>
      <p>
        Approved refunds are initiated to your original payment method promptly.
        Depending on your bank or card issuer, it typically takes{' '}
        <strong>5–7 working days</strong> for the amount to reflect in your account
        after we initiate it.
      </p>

      <h2>7. Refund to SKOVO Wallet</h2>
      <p>
        Every refund goes to your{' '}
        <Link to="/wallet">SKOVO Wallet</Link> instantly, to use for another
        cohort, session or SKOVO Pro. Wallet money is not sent to a bank.
      </p>
      <ul>
        <li><strong>Wallet money</strong> can be used for cohorts, sessions or SKOVO Pro. It is not sent back to a bank.</li>
        <li>When a paid item is refunded, readiness points earned from that payment are taken back.</li>
        <li>To close your account, contact us from Help &amp; support. We will tell you about any money left in your wallet before closing it.</li>
      </ul>

      <h2>8. Chargebacks</h2>
      <p>
        Please contact us before raising a dispute with your bank. While a
        chargeback is open, the related item may be paused; if the dispute is
        decided in your favour, it is treated as a refund.
      </p>

      <h2>9. Contact</h2>
      <p>
        For any refund or cancellation question, email{' '}
        <a href={`mailto:${val(COMPANY.supportEmail)}?subject=${encodeURIComponent('SKOVO refund request')}`}>{val(COMPANY.supportEmail)}</a> or see our{' '}
        <Link to="/contact">Contact</Link> page. Prices for every item are on the{' '}
        <Link to="/pricing">Pricing</Link> page.
      </p>
    </PolicyLayout>
  );
}
