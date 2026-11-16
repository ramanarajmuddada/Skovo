import useCompany from '../../hooks/useCompany';
import React from 'react';
import { Link } from 'react-router-dom';
import PolicyLayout, { Field } from './PolicyLayout';
import { val } from '../../config/company';

const UPDATED = '18 October 2026';

export default function Privacy() {
  const { company: COMPANY } = useCompany();
  return (
    <PolicyLayout title="Privacy Policy" updated={UPDATED}>
      <p>
        This Privacy Policy explains how <Field field={COMPANY.legalName} /> ("{val(COMPANY.brand)}",
        "we", "us") collects, uses and protects your personal data when you use
        the {val(COMPANY.brand)} platform. We are committed to handling your data lawfully,
        including under India's Digital Personal Data Protection Act, 2023.
      </p>

      <h2>1. What we collect</h2>
      <ul>
        <li><strong>Account data</strong> — name, email, phone (where provided), and password (stored only as a hash).</li>
        <li><strong>Profile data</strong> — education stage, course, year, interests and similar details you enter to personalise the Platform.</li>
        <li><strong>Achiever data</strong> — for Achievers, verification documents and professional details.</li>
        <li><strong>Usage data</strong> — cohorts and sessions you join, tasks you submit, and interactions needed to run the service.</li>
        <li><strong>Payment data</strong> — processed by our payment partner, Cashfree. We receive the transaction result and an order reference; we do not store your full card or bank details.</li>
        <li><strong>Technical data</strong> — IP address and request metadata, used for security and to diagnose errors.</li>
      </ul>

      <h2>2. How we use it</h2>
      <ul>
        <li>to create and operate your account and deliver the service you asked for;</li>
        <li>to personalise cohorts, colleges, opportunities and your readiness score;</li>
        <li>to process payments and settle Achiever earnings;</li>
        <li>to send transactional messages — verification codes, booking and payment confirmations, reminders;</li>
        <li>to keep the Platform secure, prevent abuse and comply with law.</li>
      </ul>
      <p>
        We send transactional email through ZeptoMail (Zoho) and, where enabled,
        transactional SMS/WhatsApp. We do not sell your personal data.
      </p>

      <h2>3. Legal basis and consent</h2>
      <p>
        We process your data to provide the service you requested, to meet legal
        obligations, and on the basis of your consent where required. You can
        withdraw consent for optional processing at any time by contacting us;
        withdrawing consent needed to run the service may mean we can no longer
        provide it.
      </p>

      <h2>4. Sharing</h2>
      <p>We share data only as needed to run the Platform:</p>
      <ul>
        <li>with Achievers you engage, limited to what a session or cohort requires;</li>
        <li>with service providers — payment (Cashfree), email (ZeptoMail (Zoho)), cloud hosting and storage (Amazon Web Services) — under contract;</li>
        <li>where required by law or to protect the rights and safety of users.</li>
      </ul>

      <h2>5. Storage and security</h2>
      <p>
        Data is stored on secured cloud infrastructure in India (Amazon Web
        Services, Mumbai region). Passwords are hashed, sensitive fields are
        encrypted, and access is restricted. No system is perfectly secure, but
        we take reasonable technical and organisational measures to protect your
        data.
      </p>

      <h2>6. Retention</h2>
      <p>
        We keep your data for as long as your account is active and as long as we
        need it to provide the service or to meet legal, tax and accounting
        obligations. Where retention is no longer required, we delete or
        anonymise the data.
      </p>

      <h2>7. Your rights</h2>
      <p>Subject to applicable law, you may:</p>
      <ul>
        <li>access the personal data we hold about you and ask us to correct it;</li>
        <li>ask us to delete data we no longer need to keep;</li>
        <li>withdraw consent for optional processing;</li>
        <li>download a copy of your data, or delete your account, from your Profile page;</li>
        <li>use an alias or hide your photo on leaderboards (your phone number is never shown to other users);</li>
        <li>raise a grievance with our Grievance Officer (below).</li>
      </ul>

      <h2>8. Children</h2>
      <p>
        The Platform is intended for users who can lawfully consent to these
        terms. Where a user is a minor under applicable law, processing is done
        in accordance with that law. For students under 18, we ask a parent or
        guardian to confirm consent; the parent receives a link to view the
        child's wallet and to request deletion of the account.
      </p>

      <h2>9. Grievance Officer</h2>
      <p>
        In line with Indian law, you can contact our Grievance Officer:
      </p>
      <ul>
        <li>Name: <Field field={COMPANY.grievanceOfficer} /></li>
        <li>Email: <a href={`mailto:${val(COMPANY.grievanceEmail)}`}>{val(COMPANY.grievanceEmail)}</a></li>
        <li>Address: <Field field={COMPANY.registeredAddress} /></li>
      </ul>

      <h2>10. Changes</h2>
      <p>
        We may update this Policy. Material changes will be notified on the
        Platform. Please review it periodically.
      </p>

      <h2>11. Contact</h2>
      <p>
        For any privacy question, email{' '}
        <a href={`mailto:${val(COMPANY.supportEmail)}?subject=${encodeURIComponent('SKOVO support request')}`}>{val(COMPANY.supportEmail)}</a> or use our{' '}
        <Link to="/contact">Contact</Link> page.
      </p>
    </PolicyLayout>
  );
}
