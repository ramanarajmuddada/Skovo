import React, { useEffect, useState } from 'react';
import { Building2, Mail, Phone, MapPin, Receipt, ShieldCheck, Scale, Clock, Save } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useToast, Button, Input, Textarea } from '../ui/index.jsx';

const A = '/skovo-platform-panel-admin';

// What each field is, and where students see it.
const GROUPS = [
  { title: 'Company', fields: [
    { key: 'legal_name', label: 'Registered company name', icon: Building2, placeholder: 'e.g. Skovo Educations Pvt. Ltd.', where: 'Terms, Privacy, Contact' },
    { key: 'gstin', label: 'GSTIN', icon: Receipt, placeholder: 'e.g. 37ABCDE1234F1Z5', where: 'Contact' },
    { key: 'registered_address', label: 'Registered address', icon: MapPin, placeholder: 'Building, street, city, state, PIN', where: 'Contact', area: true },
    { key: 'jurisdiction', label: 'Jurisdiction', icon: Scale, placeholder: 'e.g. Courts at Visakhapatnam, India', where: 'Terms' },
  ] },
  { title: 'Support', fields: [
    { key: 'support_email', label: 'Support email', icon: Mail, placeholder: 'support@skovoai.com', where: 'Contact, legal pages' },
    { key: 'phone', label: 'Phone', icon: Phone, placeholder: '+91 98765 43210', where: 'Contact' },
    { key: 'support_hours', label: 'Support hours', icon: Clock, placeholder: 'Monday–Saturday, 10:00–18:00 IST', where: 'Contact' },
  ] },
  { title: 'Grievance Officer', fields: [
    { key: 'grievance_officer', label: 'Grievance Officer name', icon: ShieldCheck, placeholder: 'Full name', where: 'Contact, Privacy' },
    { key: 'grievance_email', label: 'Grievance email', icon: Mail, placeholder: 'grievance@skovoai.com', where: 'Contact, Privacy' },
  ] },
];

/** Admin › Support › Company — the details on the legal and contact pages. */
export default function CompanyDetails() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saved, setSaved] = useState(null);
  const [errs, setErrs] = useState({});
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [tries, setTries] = useState(0);

  useEffect(() => {
    adminApi.get(`${A}/company-details`)
      .then(({ data }) => { if (data?.bool) { setForm(data.response); setSaved(data.response); setFailed(false); } else setFailed(true); })
      .catch(() => setFailed(true));
  }, [tries]);  // eslint-disable-line react-hooks/exhaustive-deps

  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrs((x) => ({ ...x, [k]: undefined })); };
  const dirty = form && saved && GROUPS.some((g) => g.fields.some(({ key }) => (form[key] || '') !== (saved[key] || '')));
  const missing = form ? GROUPS.flatMap((g) => g.fields).filter(({ key }) => !form[key]?.trim()).length : 0;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await adminApi.put(`${A}/company-details`, form);
      if (data?.bool) { setForm(data.response); setSaved(data.response); toast.success(data.response.message); }
      else { setErrs(data?.response?.errors || {}); toast.error(data?.response?.message || 'Could not save.'); }
    } finally { setSaving(false); }
  };

  if (!form && failed) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <p className="font-semibold text-slate-800">Could not load company details</p>
        <p className="text-sm text-slate-500 mt-1">This is a connection problem. Nothing is lost.</p>
        <button type="button" onClick={() => { setFailed(false); setTries((n) => n + 1); }}
                className="mt-3 min-h-11 px-5 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
          Try again
        </button>
      </div>
    );
  }
  if (!form) {
    return <div className="space-y-3">{[0, 1, 2].map((i) => <div key={i} className="h-32 rounded-2xl bg-white border border-slate-100 animate-pulse" />)}</div>;
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="bg-white border border-slate-200 rounded-2xl p-4 text-sm text-slate-600">
        These details appear on the Contact, Terms, Privacy and Refund pages and the site footer.
        {' '}{missing > 0
          ? <>Empty fields show as <b className="font-semibold">To confirm</b> there — {missing} still empty.</>
          : <>All fields are filled.</>}
      </div>

      {GROUPS.map(({ title, fields }) => (
        <section key={title} className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
          <h3 className="text-sm font-bold text-slate-900 mb-4">{title}</h3>
          <div className="grid sm:grid-cols-2 gap-4">
            {fields.map(({ key, label, icon: Icon, placeholder, where, area }) => (
              <div key={key} className={area ? 'sm:col-span-2' : ''}>
                {area ? (
                  <Textarea label={label} rows={2} value={form[key] || ''} onChange={set(key)} placeholder={placeholder}
                            error={errs[key]} hint={`Shown on: ${where}`} />
                ) : (
                  <Input label={label} value={form[key] || ''} onChange={set(key)} placeholder={placeholder}
                         icon={<Icon size={15} />} error={errs[key]} hint={`Shown on: ${where}`} />
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <div className="sticky bottom-3 flex justify-end">
        <Button type="submit" disabled={!dirty || saving} className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5">
          <Save size={15} /> {saving ? 'Saving…' : 'Save company details'}
        </Button>
      </div>
    </form>
  );
}
