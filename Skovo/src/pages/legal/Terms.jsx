import useCompany from '../../hooks/useCompany';
import React from 'react';
import { Link } from 'react-router-dom';
import PolicyLayout, { Field } from './PolicyLayout';
import { val } from '../../config/company';

const UPDATED = '18 October 2026';

export default function Terms() {
  const { company: COMPANY } = useCompany();
  return (
    <PolicyLayout title="Terms & Conditions" updated={UPDATED}>
      <p>
        These Terms &amp; Conditions ("Terms") govern your access to and use of the{' '}
        {val(COMPANY.brand)} platform, websites (<Field field={COMPANY.domains && { value: val(COMPANY.domains).join(', '), PLACEHOLDER: false }} />),
        mobile applications and related services (together, the "Platform"),
        operated by <Field field={COMPANY.legalName} /> ("{val(COMPANY.brand)}", "we", "us"). By creating an
        account or using the Platform you agree to these Terms. If you do not
        agree, please do not use the Platform.
      </p>

      <h2>1. Who can use SKOVO</h2>
      <p>
        The Platform is intended for students, working professionals and the
        subject-matter experts we call "Achievers". You must provide accurate
        information when you register and keep it up to date. You are responsible
        for activity under your account and for keeping your credentials secure.
      </p>

      <h2>2. Accounts and roles</h2>
      <p>
        SKOVO operates separate account types — Student, Achiever, Admin and
        Owner. A single email address may hold only one account across the
        Platform. You may not impersonate another person or misrepresent your
        affiliation. We may suspend or close an account that breaches these Terms.
      </p>

      <h2>3. Cohorts, sessions and content</h2>
      <p>
        Achievers create cohorts, one-on-one sessions, tasks and learning
        material. SKOVO provides the Platform that connects students with
        Achievers; the educational content, guidance and outcomes are the
        Achiever's, not ours. We do not guarantee any specific result, admission,
        score, job or outcome from using the Platform.
      </p>
      <p>
        You may access content only for your own learning. You may not copy,
        record, redistribute or resell a session, cohort or any material without
        the owner's written permission.
      </p>

      <h2>4. Payments</h2>
      <p>
        Paid cohorts, sessions and the SKOVO Pro membership are billed
        through our payment partner, Cashfree Payments. Prices are shown before
        you pay and are listed on our <Link to="/pricing">Pricing</Link> page.
        Taxes apply where required by law. By paying, you authorise us and our
        payment partner to charge the amount shown for the item you selected.
      </p>
      <p>
        SKOVO operates on an aggregator model: you pay SKOVO, and SKOVO settles
        the Achiever's share separately after deducting the platform commission
        disclosed at the time of the transaction. Refunds and cancellations are
        governed by our <Link to="/refund">Refund &amp; Cancellation Policy</Link>.
      </p>

      <h2>5. Readiness score, streaks and leaderboards</h2>
      <ul>
        <li>Readiness points are awarded only by rules set by SKOVO. Achievers and students cannot set or buy points.</li>
        <li>Leaderboards show students of the same class. Your name and photo may appear; you can use an alias or hide your photo, but you cannot hide from the board. Phone numbers are never shown.</li>
        <li>Streaks, freezes, restores and badges are features we may change or reset. Points gained by cheating or abuse may be removed.</li>
        <li>Community chat hides phone numbers and may refuse links. Reported messages are reviewed by the community owner and SKOVO.</li>
      </ul>

      <h2>6. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>break any law, or infringe anyone's intellectual-property or privacy rights;</li>
        <li>upload malware, attempt to breach security, or probe the Platform without authorisation;</li>
        <li>harass, abuse or endanger any other user, including Achievers and students;</li>
        <li>scrape, resell or misuse content, or use the Platform to send spam;</li>
        <li>submit false verification documents or misrepresent your identity or achievements.</li>
      </ul>

      <h2>7. Achiever verification</h2>
      <p>
        Achievers undergo a verification process, including document checks and
        demonstration sessions, before they can charge for their services.
        Verification reduces risk but is not a warranty; you should use your own
        judgement when engaging an Achiever.
      </p>

      <h2>8. Intellectual property</h2>
      <p>
        The Platform, its design, logos and software are owned by {val(COMPANY.brand)} and
        protected by law. Content you upload remains yours, but you grant us a
        limited licence to host and display it so the Platform can function.
      </p>

      <h2>9. Disclaimers and limitation of liability</h2>
      <p>
        The Platform is provided "as is". To the maximum extent permitted by law,
        we disclaim implied warranties and are not liable for indirect or
        consequential loss. Nothing in these Terms limits liability that cannot
        be limited under applicable law. Our total liability for any claim
        relating to a paid item is limited to the amount you paid for that item.
      </p>

      <h2>10. Suspension and termination</h2>
      <p>
        We may suspend or terminate access if you breach these Terms or use the
        Platform in a way that harms other users or us. You may stop using the
        Platform at any time.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be
        notified on the Platform. Continued use after a change means you accept
        the updated Terms.
      </p>

      <h2>12. Governing law</h2>
      <p>
        These Terms are governed by the laws of India. Disputes are subject to
        the exclusive jurisdiction of the <Field field={COMPANY.jurisdiction} />.
      </p>

      <h2>13. Contact</h2>
      <p>
        Questions about these Terms? Reach us at{' '}
        <a href={`mailto:${val(COMPANY.supportEmail)}?subject=${encodeURIComponent('SKOVO support request')}`}>{val(COMPANY.supportEmail)}</a> or via our{' '}
        <Link to="/contact">Contact</Link> page.
      </p>
    </PolicyLayout>
  );
}
