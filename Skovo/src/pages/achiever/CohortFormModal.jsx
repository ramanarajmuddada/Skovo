import DateTimePicker from '../../components/ui/DateTimePicker';
import React, { useEffect, useRef, useState } from 'react';
import { X, Plus, Loader2, ChevronRight, ChevronDown, Info } from 'lucide-react';
import { achieverApi } from '../../services/api';
import { FormSelect, useToast } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';
import { toDateTimeLocal } from '../../utils/datetime';
import { useMasters } from '../../hooks/useMasters';

const EMPTY = {
  title: '', domain_id: '', level: '', session_date: '', duration_minutes: '',
  price: '', about: '', what_you_learn: [''], meeting_link: '',
  refund_template: 'standard', late_join_minutes: '0',
  offer_type: '', offer_tiers: [{ seats: '', value: '' }], offer_ends_at: '',
};

const MAX_SLABS = 5;

// The server rounds the platform fee to the paisa (5 x 10% = 0.50, earn 4.50).
// Rounding it to whole rupees here showed "you earn 4" for the same seat.
const feeOf = (amount, rate) => Math.round(amount * rate * 100) / 100;
const money = (n) => Number(n).toLocaleString('en-IN', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

// What the student pays with the offer, or null when there is no valid offer.
function offerFinal(price, type, value) {
  const p = parseInt(price, 10); const v = parseInt(value, 10);
  if (!(p > 0) || !(v > 0)) return null;
  // Exact, never rounded: Rs 5 at 50% is Rs 2.50.
  if (type === 'percent') return v <= 90 ? (p * (100 - v)) / 100 : null;
  if (type === 'amount') return v < p ? p - v : null;
  return null;
}

const pctLabel = (ratio) => {
  const pct = ratio * 100;
  return `${Number(pct.toFixed(2)) % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

function lateJoinUntil(sessionDate, minutes) {
  const m = parseInt(minutes, 10);
  if (!sessionDate || !(m > 0)) return '';
  const d = new Date(sessionDate);
  if (Number.isNaN(d.getTime())) return '';
  d.setMinutes(d.getMinutes() + m);
  return d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' });
}

const domainKey = (v) => (v || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function enrolUntilLabel(sessionDate) {
  if (!sessionDate) return '';
  try {
    return new Date(sessionDate).toLocaleString('en-IN', {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch {
    return '';
  }
}

export default function CohortFormModal({
  open, cohort, domains, onDomainsChange, onClose, onSaved, commissionRate, canCharge,
  seatAllocation,
}) {
  const toast = useToast();
  const editing = Boolean(cohort);
  // Once anyone has booked, price and offer are fixed (the server refuses too).
  const priceLocked = editing && Boolean(cohort?.price_locked);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState(0);
  const { lists: levelLists } = useMasters(['cohort_level']);
  // Each step opens at its top (Price first), not where the last one was scrolled.
  const formRef = useRef(null);
  useEffect(() => { formRef.current?.scrollTo?.({ top: 0 }); }, [step]);
  const [addingDomain, setAddingDomain] = useState(false);
  const [newDomain, setNewDomain] = useState('');
  const [showAddDomain, setShowAddDomain] = useState(false);
  const [guide, setGuide] = useState(null);
  const [guideOpen, setGuideOpen] = useState(false);
  // Rules tabs (Class day, Attendance & strikes, Money & refunds) written from
  // admin's live settings, so a change in admin shows here at once.
  const [guideTabs, setGuideTabs] = useState([]);
  const [guideTab, setGuideTab] = useState('how');

  // "How a cohort works" -- admin-editable (Admin > Achiever guidelines).
  useEffect(() => {
    if (!open || guide) return;
    achieverApi.get('/achievers/portal/cohort-guide')
      .then(({ data }) => { if (data?.bool) { setGuide(data.response.guide); setGuideTabs(data.response.tabs || []); } })
      .catch(() => {});
  }, [open, guide]);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      const wyl = cohort.what_you_learn?.length ? cohort.what_you_learn : [''];
      setForm({
        title: cohort.title || '',
        domain_id: cohort.domain_id || '',
        level: cohort.level || '',
        session_date: toDateTimeLocal(cohort.session_date),
        duration_minutes: cohort.duration_minutes != null ? String(cohort.duration_minutes) : '',
        late_join_minutes: String(cohort.late_join_minutes ?? 0),
        price: String(cohort.price ?? ''),
        about: cohort.about || '',
        what_you_learn: wyl,
        meeting_link: cohort.meeting_link || '',
        refund_template: cohort.refund_template || 'standard',
        // Offers are set here only. Rebuilt from what is stored: % off, or a
        // flat offer price shown back as "Rs off".
        ...(() => {
          // Slabs, or an offer saved before slabs existed (one slab).
          const t = cohort.offer_tiers;
          if (t?.tiers?.length) {
            return { offer_type: t.type, offer_tiers: t.tiers.map((x) => ({ seats: x.seats == null ? '' : String(x.seats), value: String(x.value) })) };
          }
          if (Number(cohort.offer_percent) > 0) {
            return { offer_type: 'percent', offer_tiers: [{ seats: cohort.offer_seats == null ? '' : String(cohort.offer_seats), value: String(cohort.offer_percent) }] };
          }
          if (cohort.offer_price != null) {
            return { offer_type: 'amount', offer_tiers: [{ seats: cohort.offer_seats == null ? '' : String(cohort.offer_seats), value: String(Number(cohort.price || 0) - Number(cohort.offer_price)) }] };
          }
          return { offer_type: '', offer_tiers: [{ seats: '', value: '' }] };
        })(),
        offer_ends_at: cohort.offer_ends_at ? toDateTimeLocal(cohort.offer_ends_at) : '',
      });
    } else {
      setForm(EMPTY);
    }
    setStep(0);
    setShowAddDomain(false);
    setNewDomain('');
  }, [open, cohort, editing]);

  if (!open) return null;

  const sf = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setLearn = (i, v) => {
    const arr = [...form.what_you_learn];
    arr[i] = v;
    sf('what_you_learn', arr);
  };
  const addLearn = () => sf('what_you_learn', [...form.what_you_learn, '']);
  const removeLearn = (i) => sf('what_you_learn', form.what_you_learn.filter((_, idx) => idx !== i));

  const stepError = (i) => {
    if (i === 0) {
      const title = schema.cohort.pick({ title: true }).safeParse({ title: form.title });
      if (!title.success) return Object.values(fieldErrors(title))[0] || 'Give your cohort a title.';
      if (!form.domain_id) return 'Pick a domain.';
      if (!form.level) return 'Pick a level.';
      if (!form.about.trim()) return 'Tell students what this class is about.';
      if (!form.what_you_learn.some((s) => s.trim())) return 'Add at least one thing students will learn.';
      if (!form.session_date) return 'Pick when the session runs.';
      if (form.duration_minutes === '' || form.duration_minutes == null) {
        return 'Enter how many minutes this class runs.';
      }
      const dur = schema.cohort.pick({ duration_minutes: true }).safeParse({
        duration_minutes: form.duration_minutes,
      });
      if (!dur.success) return Object.values(fieldErrors(dur))[0];
      if (form.meeting_link.trim()) {
        const link = schema.cohort.pick({ meeting_link: true }).safeParse({
          meeting_link: form.meeting_link,
        });
        if (!link.success) return Object.values(fieldErrors(link))[0];
      }
      const late = form.late_join_minutes === '' ? 0 : parseInt(form.late_join_minutes, 10);
      if (!(late >= 0)) return 'Late joining must be 0 or more minutes.';
      if (late > parseInt(form.duration_minutes, 10)) {
        return `Late joining cannot be longer than the class (${parseInt(form.duration_minutes, 10)} minutes).`;
      }
    }
    if (i === 1) {
      // Mandatory: the achiever decides on purpose. 0 = a free class.
      if (canCharge !== false && String(form.price).trim() === '') return 'Enter a price. Type 0 for a free class.';
      if (form.price !== '' && !(parseInt(form.price, 10) >= 0)) return 'Price must be 0 or more.';
      if (parseInt(form.price, 10) > 0 && canCharge === false) {
        return 'Paid cohorts open once your account is verified.';
      }
      if (form.offer_type) {
        const p = parseInt(form.price, 10);
        if (!(p > 0)) return 'An offer needs a price.';
        let prev = null;
        let counted = 0;
        for (let i = 0; i < form.offer_tiers.length; i += 1) {
          const t = form.offer_tiers[i];
          const v = parseInt(t.value, 10);
          const n = i + 1;
          if (!(v > 0)) return `Slab ${n}: enter how much off.`;
          if (form.offer_type === 'percent' && v > 90) return `Slab ${n}: at most 90% off.`;
          if (form.offer_type === 'amount' && v >= p) return `Slab ${n}: must be less than ₹${p} off.`;
          if (prev != null && v > prev) return `Slab ${n}: later students cannot get a bigger discount than earlier ones.`;
          if (t.seats === '' && n !== form.offer_tiers.length) return `Slab ${n}: enter how many students.`;
          if (t.seats !== '' && !(parseInt(t.seats, 10) >= 1)) return `Slab ${n}: at least 1 student.`;
          if (t.seats !== '') counted += parseInt(t.seats, 10);
          prev = v;
        }
        if (seatAllocation && counted > seatAllocation) {
          return `The slabs add up to ${counted} students, but the class has ${seatAllocation} seats.`;
        }
        if (form.offer_ends_at && form.session_date && form.offer_ends_at > form.session_date) {
          return 'The offer must end before the class starts.';
        }
      }
    }
    return '';
  };

  const flash = (msg) => { if (msg) toast.error(msg); };

  const next = () => {
    const e = stepError(0);
    if (e) { flash(e); return; }
    setStep(1);
  };

  const addDomain = async () => {
    const name = newDomain.trim();
    if (!name) { flash('Enter a domain name.'); return; }
    const parsed = schema.domain.safeParse({ name });
    if (!parsed.success) {
      flash(Object.values(fieldErrors(parsed))[0] || 'Enter a domain name.');
      return;
    }
    const dup = (domains || []).find((d) => domainKey(d.name) === domainKey(name));
    if (dup) {
      toast.info(`"${dup.name}" is already in the list.`);
      sf('domain_id', dup.id);
      setShowAddDomain(false);
      setNewDomain('');
      return;
    }
    setAddingDomain(true);
    try {
      const { data } = await achieverApi.post('/achievers/portal/domains', { name });
      const msg = data.response?.message || `"${name}" added.`;
      if (data.bool) {
        const added = data.response?.domain;
        toast.success(msg);
        if (added?.id) {
          onDomainsChange?.({ id: added.id, name: added.name, parent_id: null, parent_name: null });
          sf('domain_id', added.id);
        }
        setShowAddDomain(false);
        setNewDomain('');
      } else {
        toast.info(msg);
        const existing = data.response?.domain;
        if (existing?.id) {
          sf('domain_id', existing.id);
          setShowAddDomain(false);
          setNewDomain('');
        }
      }
    } catch (err) {
      const payload = err?.response?.data?.response;
      const msg = payload?.message || 'Could not add domain.';
      toast.info(msg);
      if (payload?.domain?.id) {
        sf('domain_id', payload.domain.id);
        setShowAddDomain(false);
        setNewDomain('');
      }
    } finally {
      setAddingDomain(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const bad0 = stepError(0);
    if (bad0) { flash(bad0); setStep(0); return; }
    const bad1 = stepError(1);
    if (bad1) { flash(bad1); setStep(1); return; }

    if (!form.meeting_link.trim()) {
      toast.info('Add a Meet or Teams link or students cannot join.');
    }

    setSaving(true);
    const payload = {
      title: form.title.trim(),
      domain_id: form.domain_id || null,
      level: form.level || null,
      session_date: form.session_date,
      duration_minutes: parseInt(form.duration_minutes, 10),
      late_join_minutes: parseInt(form.late_join_minutes || '0', 10),
      // The admin's allocation, not a number the achiever picked. undefined
      // means the profile call has not answered yet; sending null then would
      // quietly publish an uncapped cohort, so the submit button is disabled
      // until it resolves rather than guessing.
      total_seats: seatAllocation ?? null,
      price: form.price === '' ? 0 : parseInt(form.price, 10),
      about: form.about.trim(),
      what_you_learn: form.what_you_learn.filter((s) => s.trim()),
      meeting_link: form.meeting_link.trim() || null,
      refund_template: 'standard',
      // '' clears the offer (also when the class is free).
      offer_type: parseInt(form.price, 10) > 0 ? form.offer_type : '',
      offer_tiers: form.offer_tiers.map((t) => ({
        seats: t.seats === '' ? null : parseInt(t.seats, 10),
        value: t.value === '' ? null : parseInt(t.value, 10),
      })),
      offer_ends_at: form.offer_ends_at || null,
      target_categories: [],
      target_streams: [],
      target_degree_cats: [],
      target_exam_targets: [],
      target_prof_courses: [],
      target_years: [],
      target_degrees: [],
      target_branches: [],
    };
    try {
      const res = editing
        ? await achieverApi.put(`/achievers/portal/cohorts/${cohort.id}`, payload)
        : await achieverApi.post('/achievers/portal/cohorts', payload);
      if (!res.data.bool) {
        flash(res.data.response?.message || 'Failed to save cohort.');
        return;
      }
      const until = enrolUntilLabel(form.session_date);
      const ok = editing
        ? 'Cohort updated'
        : (until
          ? `Cohort created. Any student can enrol until ${until}.`
          : 'Cohort created. Any student can enrol until the class goes live.');
      onSaved(editing, ok);
    } catch {
      flash('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const inputCls = 'w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-400 transition-shadow';
  const domainLabel = (d) => (d.parent_name ? `${d.parent_name} › ${d.name}` : d.name);
  const chosenDomain = (domains || []).find((d) => d.id === form.domain_id);
  const STEPS = ['Class', 'Price & offer'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}>
      <div role="dialog" aria-modal="true" aria-label={editing ? 'Edit cohort' : 'Create cohort'}
           className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 text-lg">{editing ? 'Edit cohort' : 'Create cohort'}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Step {step + 1} of {STEPS.length} · {STEPS[step]}
            </p>
          </div>
          <button type="button" onClick={onClose}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        <div className="flex gap-1 px-4 sm:px-6 pt-4">
          {STEPS.map((label, i) => (
            <button key={label} type="button" onClick={() => setStep(i)} className="flex-1">
              <span className={`block h-1 rounded-full ${i <= step ? '' : 'bg-slate-100'}`}
                    style={i <= step ? { backgroundColor: 'var(--accent)' } : {}} />
              <span className={`block text-[11px] mt-1.5 font-semibold truncate ${
                i === step ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
            </button>
          ))}
        </div>

        <form ref={formRef} onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {step === 0 && (
            <>
              {guide && (
                <div className="rounded-xl border border-slate-200 bg-slate-50">
                  <button type="button" onClick={() => setGuideOpen((o) => !o)} aria-expanded={guideOpen}
                          className="w-full min-h-11 flex items-center gap-2 px-3.5 py-2.5 text-left">
                    <Info size={15} className="shrink-0" style={{ color: 'var(--accent)' }} />
                    <span className="flex-1 text-sm font-semibold text-slate-800">{guide.title || 'How a cohort works'}</span>
                    <ChevronDown size={16} className={`text-slate-400 transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {guideOpen && (
                    <div className="px-3.5 pb-3.5 space-y-2.5">
                      {guideTabs.length > 0 && (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 rounded-xl bg-white border border-slate-200" role="tablist">
                          {[{ key: 'how', title: 'How it works' }, ...guideTabs].map((t) => (
                            <button key={t.key} type="button" role="tab" aria-selected={guideTab === t.key} onClick={() => setGuideTab(t.key)}
                                    className={`min-h-10 px-2 rounded-lg text-xs font-semibold ${guideTab === t.key ? 'text-white' : 'text-slate-600'}`}
                                    style={guideTab === t.key ? { backgroundColor: 'var(--accent)' } : undefined}>
                              {t.title}
                            </button>
                          ))}
                        </div>
                      )}
                      {guideTab !== 'how' && (
                        <ul className="space-y-2">
                          {(guideTabs.find((t) => t.key === guideTab)?.items || []).map((it, i) => (
                            <li key={i} className="flex gap-2.5 text-xs text-slate-700 leading-relaxed">
                              <span className="w-1.5 h-1.5 mt-1.5 shrink-0 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                              <span>{it}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {guideTab === 'how' && <>
                      {guide.summary && <p className="text-xs text-slate-600">{guide.summary}</p>}
                      <ol className="space-y-2">
                        {(guide.steps || []).map((st, i) => (
                          <li key={i} className="flex gap-2.5 text-xs text-slate-700 leading-relaxed">
                            <span className="w-5 h-5 shrink-0 rounded-full bg-white border border-slate-200 text-[10px] font-bold flex items-center justify-center text-slate-500">{i + 1}</span>
                            <span>{st}</span>
                          </li>
                        ))}
                      </ol>
                      {guide.note && <p className="text-[11px] text-slate-500 italic">{guide.note}</p>}
                      </>}
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Title <span className="text-red-500">*</span>
                </label>
                <input value={form.title} onChange={(e) => sf('title', e.target.value)}
                       placeholder="What will you teach?"
                       className={inputCls} autoFocus />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Domain <span className="text-red-500">*</span>
                </label>
                <FormSelect
                  value={form.domain_id}
                  onChange={(v) => sf('domain_id', v)}
                  options={(domains || []).map((d) => ({
                    value: d.id,
                    label: domainLabel(d),
                  }))}
                  placeholder="Select domain" />
                <p className="text-[11px] text-slate-400 mt-1">
                  A label for the class — it does not hide it from any student.
                </p>
                {!showAddDomain ? (
                  <button type="button" onClick={() => setShowAddDomain(true)}
                          className="mt-2 text-xs font-semibold flex items-center gap-1"
                          style={{ color: 'var(--accent)' }}>
                    <Plus size={13} /> Add domain
                  </button>
                ) : (
                  // Phones: the name gets the full width and the buttons sit under
                  // it -- side by side, the box shrank to "e.g. React Na".
                  <div className="mt-2 flex flex-col sm:flex-row gap-2">
                    <input value={newDomain} onChange={(e) => setNewDomain(e.target.value)}
                           placeholder="New domain, e.g. React Native" autoFocus
                           className={`${inputCls} flex-1 min-w-0`}
                           onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addDomain(); } }} />
                    <div className="grid grid-cols-2 sm:flex gap-2 shrink-0">
                      <button type="button" onClick={() => { setShowAddDomain(false); setNewDomain(''); }}
                              className="min-h-11 px-4 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200 hover:bg-slate-50">
                        Cancel
                      </button>
                      <button type="button" onClick={addDomain} disabled={addingDomain}
                              className="min-h-11 px-4 rounded-xl text-sm font-bold text-white disabled:opacity-50 flex items-center justify-center"
                              style={{ backgroundColor: 'var(--accent)' }}>
                        {addingDomain ? <Loader2 size={14} className="animate-spin" /> : 'Add domain'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  Level <span className="text-red-500">*</span>
                </label>
                <FormSelect value={form.level} onChange={(v) => sf('level', v || '')} placeholder="Select level"
                            options={(levelLists.cohort_level || []).map((o) => ({ value: o.label, label: o.label }))} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">
                  About <span className="text-red-500">*</span>
                </label>
                <textarea value={form.about} onChange={(e) => sf('about', e.target.value)} rows={3}
                          placeholder="Describe what this class is about…"
                          className={`${inputCls} resize-none`} />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">
                  What students will learn <span className="text-red-500">*</span>
                </label>
                <div className="space-y-2">
                  {form.what_you_learn.map((item, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={item} onChange={(e) => setLearn(i, e.target.value)}
                             placeholder={`Learning point ${i + 1}`}
                             className={`${inputCls} flex-1`} />
                      {form.what_you_learn.length > 1 && (
                        <button type="button" onClick={() => removeLearn(i)}
                                className="p-1.5 text-slate-400 hover:text-red-500 shrink-0">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <button type="button" onClick={addLearn}
                        className="mt-2 text-xs font-semibold flex items-center gap-1"
                        style={{ color: 'var(--accent)' }}>
                  <Plus size={13} /> Add point
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    When <span className="text-red-500">*</span>
                  </label>
                  {/* A new class cannot start in the past; an existing one may already have. */}
                  <DateTimePicker value={form.session_date} onChange={(v) => sf('session_date', v)}
                                  min={editing ? undefined : (() => { const n = new Date(); n.setMinutes(n.getMinutes() - n.getTimezoneOffset()); return n.toISOString().slice(0, 16); })()} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Duration (minutes) <span className="text-red-500">*</span>
                  </label>
                  <input type="number" min="1" max="1440" value={form.duration_minutes}
                         onChange={(e) => sf('duration_minutes', e.target.value)}
                         placeholder="e.g. 60"
                         className={inputCls} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">Late joining (minutes)</label>
                  <input type="number" min="0" max={form.duration_minutes || undefined}
                         value={form.late_join_minutes}
                         onChange={(e) => sf('late_join_minutes', e.target.value)}
                         placeholder="0 = closes at the start" className={inputCls} />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {lateJoinUntil(form.session_date, form.late_join_minutes)
                      ? `Leftover seats can be taken until ${lateJoinUntil(form.session_date, form.late_join_minutes)}.`
                      : 'If seats are free, students can still join this many minutes after the start. 0 closes at the start.'}
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1">
                    Seats
                  </label>
                  {/* Read-only on purpose. An achiever does not size their own
                      cohort, the same way they do not set their own rate — an
                      admin grants the number when the application is approved.
                      Shown rather than hidden so the limit is not a surprise
                      at the moment a student is turned away. */}
                  <input type="text" readOnly disabled
                         value={seatAllocation === undefined ? 'Loading…'
                                : seatAllocation === null ? 'Unlimited'
                                : `${seatAllocation} students`}
                         className={`${inputCls} cursor-not-allowed opacity-70`} />
                  <p className="text-[11px] text-slate-400 mt-1">
                    {seatAllocation === undefined ? 'Checking your allocation…'
                      : seatAllocation === null
                        ? 'No cap set by an admin. Ask them if you need one.'
                        : 'Set by an admin. Once full, no one else can join.'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Meeting link</label>
                <input type="url" value={form.meeting_link}
                       onChange={(e) => sf('meeting_link', e.target.value)}
                       placeholder="Meet or Teams link"
                       className={inputCls} />
                <p className="text-[11px] text-slate-400 mt-1">
                  Students join with this link. You can add it later from Edit.
                </p>
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Price (₹) <span className="text-red-500">*</span></label>
                <input type="number" value={canCharge === false ? 0 : form.price}
                       onChange={(e) => sf('price', e.target.value)}
                       min="0" disabled={canCharge === false || priceLocked}
                       placeholder={canCharge === false ? '0' : 'e.g. 499, or 0 for free'}
                       className={`${inputCls} disabled:bg-slate-50 disabled:text-slate-400`} />
                {priceLocked ? (
                  <p className="text-[11px] text-amber-700 mt-1">
                    Students have booked, so the price and offer can't change. To change them, cancel this class
                    (students get 100% back) and create a new one.
                  </p>
                ) : canCharge !== false && (
                  <p className="text-[11px] text-slate-400 mt-1">Type 0 to run this class free.</p>
                )}
              </div>

              {/* v1: every paid cohort uses the platform refund rule (Standard),
                  set by admin. The per-cohort Refund template picker is gone. */}

              {canCharge === false && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-3.5">
                  <p className="text-sm font-semibold text-amber-900">This class runs free</p>
                  <p className="text-xs text-amber-700 mt-1">
                    Paid cohorts open once your account is verified.
                  </p>
                </div>
              )}

              {parseInt(form.price, 10) > 0 && commissionRate != null && (
                <div className="rounded-xl bg-slate-50 p-3.5 text-sm">
                  <div className="flex justify-between text-slate-500">
                    <span>Student pays</span>
                    <span>₹{parseInt(form.price, 10).toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-slate-500 mt-1">
                    <span>SKOVO platform fee ({pctLabel(commissionRate)})</span>
                    <span>−₹{money(feeOf(parseInt(form.price, 10), commissionRate))}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-slate-900 mt-2 pt-2 border-t border-slate-200">
                    <span>You earn per enrolment</span>
                    <span>₹{money(parseInt(form.price, 10) - feeOf(parseInt(form.price, 10), commissionRate))}</span>
                  </div>
                </div>
              )}

              {parseInt(form.price, 10) > 0 && canCharge !== false && (() => {
                const p = parseInt(form.price, 10);
                const setTier = (i, k, v) => sf('offer_tiers', form.offer_tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
                let from = 1;
                const rows = form.offer_tiers.map((t) => {
                  const n = parseInt(t.seats, 10);
                  const label = t.seats === '' ? `Students ${from}+` : (n === 1 ? `Student ${from}` : `Students ${from}–${from + n - 1}`);
                  if (n > 0) from += n;
                  const final = offerFinal(p, form.offer_type, t.value);
                  return { label, final, earn: final != null && commissionRate != null ? final - feeOf(final, commissionRate) : null };
                });
                return (
                  <fieldset disabled={priceLocked} className={`rounded-xl border border-slate-200 p-3.5 space-y-3 min-w-0 ${priceLocked ? 'opacity-60' : ''}`}>
                    <div>
                      <p className="text-sm font-semibold text-slate-800">Offer (optional)</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Every student sees it. Early students can get a bigger discount: add slabs, e.g. first 3 at 50% off, next 3 at 40%.
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-slate-100" role="group" aria-label="Offer type">
                      {[['', 'No offer'], ['percent', '% off'], ['amount', '₹ off']].map(([k, l]) => (
                        <button key={k || 'none'} type="button" onClick={() => sf('offer_type', k)}
                                className={`min-h-10 rounded-lg text-xs font-semibold ${form.offer_type === k ? 'bg-white shadow-sm text-slate-900' : 'text-slate-500'}`}>
                          {l}
                        </button>
                      ))}
                    </div>
                    {form.offer_type && (
                      <>
                        <div className="space-y-2">
                          {form.offer_tiers.map((t, i) => (
                            <div key={i} className="rounded-lg bg-slate-50 p-2.5">
                              <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Slab {i + 1}</p>
                                {form.offer_tiers.length > 1 && (
                                  <button type="button" aria-label={`Remove slab ${i + 1}`}
                                          onClick={() => sf('offer_tiers', form.offer_tiers.filter((_, j) => j !== i))}
                                          className="p-1 text-slate-400 hover:text-red-500"><X size={14} /></button>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                    {i === 0 ? 'First' : 'Next'} how many students
                                  </label>
                                  <input type="number" min="1" value={t.seats} onChange={(e) => setTier(i, 'seats', e.target.value)}
                                         placeholder={i === form.offer_tiers.length - 1 ? 'Blank = all left' : 'e.g. 3'} className={inputCls} />
                                </div>
                                <div>
                                  <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                                    {form.offer_type === 'percent' ? '% off' : '₹ off'} <span className="text-red-500">*</span>
                                  </label>
                                  <input type="number" min="1" value={t.value} onChange={(e) => setTier(i, 'value', e.target.value)}
                                         placeholder={form.offer_type === 'percent' ? 'e.g. 50' : 'e.g. 20'} className={inputCls} />
                                </div>
                              </div>
                            </div>
                          ))}
                          {form.offer_tiers.length < MAX_SLABS && (
                            <button type="button" onClick={() => sf('offer_tiers', [...form.offer_tiers, { seats: '', value: '' }])}
                                    className="text-xs font-semibold flex items-center gap-1" style={{ color: 'var(--accent)' }}>
                              <Plus size={13} /> Add slab
                            </button>
                          )}
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-slate-600 mb-1">Offer ends</label>
                          <DateTimePicker value={form.offer_ends_at} onChange={(v) => sf('offer_ends_at', v)}
                                          future defaultTime={{ h: 23, mi: 59 }} />
                          <p className="text-[11px] text-slate-400 mt-1">Leave empty to run it until the class starts.</p>
                        </div>
                        {rows.some((r) => r.final != null) && (
                          <div className="rounded-lg bg-emerald-50 p-2.5 text-xs text-emerald-800 space-y-1">
                            {rows.map((r, i) => r.final != null && (
                              <div key={i} className="flex justify-between gap-2">
                                <span>{r.label}</span>
                                <span><span className="line-through opacity-60">₹{p.toLocaleString('en-IN')}</span> <b>₹{money(r.final)}</b>
                                  {r.earn != null && <> · you earn ₹{money(r.earn)}</>}</span>
                              </div>
                            ))}
                            {form.offer_tiers[form.offer_tiers.length - 1]?.seats !== '' && (
                              <div className="flex justify-between gap-2 opacity-80"><span>Everyone after</span><span>₹{p.toLocaleString('en-IN')}</span></div>
                            )}
                          </div>
                        )}
                        {editing && (
                          <p className="text-[11px] text-slate-400">Once students book, the price and offer are fixed.</p>
                        )}
                      </>
                    )}
                  </fieldset>
                );
              })()}


              <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 pt-1">Summary</p>
              <dl className="rounded-xl border border-slate-200 divide-y divide-slate-100 -mt-2">
                {[
                  ['Title', form.title || '—'],
                  ['Domain', chosenDomain ? domainLabel(chosenDomain) : 'Not set'],
                  ['When', form.session_date
                    ? new Date(form.session_date).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })
                    : 'Not set'],
                  ['Duration', form.duration_minutes ? `${form.duration_minutes} min` : 'Not set'],
                  ['Seats', seatAllocation == null ? 'Unlimited' : `${seatAllocation} students`],
                  ['Price', parseInt(form.price, 10) > 0
                    ? `₹${parseInt(form.price, 10).toLocaleString('en-IN')}` : 'Free'],
                  ['Level', form.level || '—'],
                  ...(parseInt(form.price, 10) > 0 && form.offer_type && offerFinal(form.price, form.offer_type, form.offer_tiers[0]?.value) != null
                    ? [['Offer', `From ₹${money(offerFinal(form.price, form.offer_type, form.offer_tiers[0].value))}`
                        + (form.offer_tiers.length > 1 ? ` · ${form.offer_tiers.length} slabs` : '')]] : []),
                  ['Meeting link', form.meeting_link.trim() ? 'Added' : 'Not added yet'],
                  ['Who can enrol', lateJoinUntil(form.session_date, form.late_join_minutes)
                    ? `Anyone, until ${lateJoinUntil(form.session_date, form.late_join_minutes)} (${parseInt(form.late_join_minutes, 10)} min late joining)`
                    : 'Anyone, until the class starts'],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 text-sm">
                    <dt className="text-slate-400 shrink-0">{k}</dt>
                    <dd className="text-slate-800 font-medium text-right min-w-0 break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </form>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex items-center gap-3">
          {step > 0 ? (
            <button type="button" onClick={() => setStep(0)}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose}
                    className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">
              Cancel
            </button>
          )}
          <div className="flex-1" />
          {step === 0 ? (
            <button type="button" onClick={next}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white rounded-xl"
                    style={{ backgroundColor: 'var(--accent)' }}>
              Next <ChevronRight size={15} />
            </button>
          ) : (
            /* Creating before the allocation resolves would publish an
               uncapped cohort. Editing is unaffected — an existing cohort
               already carries the seats it was created with. */
            <button type="button" onClick={handleSubmit}
                    disabled={saving || (!editing && seatAllocation === undefined)}
                    className="flex items-center gap-2 px-5 py-2 text-sm font-bold text-white rounded-xl disabled:opacity-50"
                    style={{ backgroundColor: 'var(--accent)' }}>
              {saving
                ? <><Loader2 size={14} className="animate-spin" /> Saving…</>
                : (editing ? 'Save changes' : 'Create cohort')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
