import useCompany from '../../hooks/useCompany';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail, Phone, MapPin, Clock, ShieldQuestion } from 'lucide-react';
import PolicyLayout, { Field } from './PolicyLayout';
import { val } from '../../config/company';
import { api } from '../../services/api';

const UPDATED = '23 September 2026';

function Row({ icon: Icon, label, children }) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-500">
        <Icon size={17} />
      </div>
      <div className="min-w-0 break-words">
        <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</p>
        <div className="mt-0.5 text-slate-800">{children}</div>
      </div>
    </div>
  );
}

export default function Contact() {
  const { company: COMPANY } = useCompany();
  const legalEmail = val(COMPANY.supportEmail);
  const [extra, setExtra] = useState([]);

  useEffect(() => {
    let alive = true;
    api.get('/support/public-contacts')
      .then(({ data }) => {
        if (!alive || !data?.bool) return;
        const rows = data.response?.contacts || [];
        const legal = (legalEmail || '').toLowerCase();
        setExtra(rows.filter((c) => (c.value || '').toLowerCase() !== legal));
      })
      .catch(() => {});
    return () => { alive = false; };
  }, [legalEmail]);

  return (
    <PolicyLayout title="Contact Us" updated={UPDATED}>
      <p>
        We are here to help with anything about your account, a cohort or session,
        a payment, or a privacy request. The fastest way to reach us is by email —
        please write from your registered email address and include an order
        reference where relevant.
      </p>

      <div className="not-prose mt-6 grid gap-5 sm:gap-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 sm:grid-cols-2">
        <Row icon={Mail} label="Email">
          <a
            className="underline underline-offset-2"
            style={{ color: 'var(--accent)' }}
            href={`mailto:${legalEmail}`}
          >
            {legalEmail}
          </a>
        </Row>
        {extra.filter((c) => c.channel === 'email').map((c) => (
          <Row key={c.id} icon={Mail} label={c.label || 'Email'}>
            <a className="underline underline-offset-2" href={`mailto:${c.value}`}>
              {c.value}
            </a>
            {c.hours ? <p className="text-xs text-slate-400 mt-1">{c.hours}</p> : null}
          </Row>
        ))}
        <Row icon={Phone} label="Phone">
          <Field field={COMPANY.phone} />
        </Row>
        {extra.filter((c) => c.channel === 'phone').map((c) => (
          <Row key={c.id} icon={Phone} label={c.label || 'Phone'}>
            <a className="underline underline-offset-2" href={`tel:${String(c.value).replace(/[^\d+]/g, '')}`}>
              {c.value}
            </a>
            {c.hours ? <p className="text-xs text-slate-400 mt-1">{c.hours}</p> : null}
          </Row>
        ))}
        <Row icon={MapPin} label="Registered address">
          <Field field={COMPANY.registeredAddress} />
        </Row>
        <Row icon={Clock} label="Support hours">
          <Field field={COMPANY.supportHours} />
        </Row>
        <Row icon={ShieldQuestion} label="Grievance Officer">
          <div>
            <Field field={COMPANY.grievanceOfficer} />
            <div className="mt-0.5">
              <a
                className="underline underline-offset-2"
                style={{ color: 'var(--accent)' }}
                href={`mailto:${val(COMPANY.grievanceEmail)}`}
              >
                {val(COMPANY.grievanceEmail)}
              </a>
            </div>
          </div>
        </Row>
      </div>

      <h2>Business details</h2>
      <p>
        {val(COMPANY.brand)} is operated by <Field field={COMPANY.legalName} />. GSTIN:{' '}
        <Field field={COMPANY.gstin} />.
      </p>

      <h2>Response time</h2>
      <p>
        We aim to acknowledge every message within one working day. Payment and
        refund queries are prioritised — see our{' '}
        <Link to="/refund">Refund &amp; Cancellation Policy</Link> for timelines.
      </p>

      <h2>Other policies</h2>
      <p>
        <Link to="/terms">Terms &amp; Conditions</Link> ·{' '}
        <Link to="/privacy">Privacy Policy</Link> ·{' '}
        <Link to="/pricing">Pricing</Link>
      </p>
    </PolicyLayout>
  );
}
