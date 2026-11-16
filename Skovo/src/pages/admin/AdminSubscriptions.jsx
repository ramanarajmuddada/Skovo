import React, { useEffect, useState } from 'react';
import { adminApi as api } from '../../services/api';
import { Crown, Save, RefreshCw, CheckCircle, X, Info, Plus, Trash2, Pencil, ChevronUp } from 'lucide-react';
import { ConfirmModal, StatusBadge, ActionBtn } from '../../components/ui/TableComponents';
import { Button } from '../../components/ui/index.jsx';
import DatePicker from '../../components/ui/DatePicker';
import ToggleSwitch from '../../components/ui/ToggleSwitch';

// Four free-tier caps and one Pro entitlement. They were one list under a
// heading that described only the first kind, so an admin editing the credit
// count believed they were changing a free allowance.
const FREE_FIELDS = [
  { key: 'free_paid_cohorts', label: 'Free paid cohorts', hint: 'How many priced cohort seats a free student gets, once. 0 = pay or take Pro.' },
  { key: 'saved_colleges', label: 'Saved colleges', hint: 'How many they can hold at once. Scholarships stay Pro-only.' },
  { key: 'communities', label: 'Communities (join + create)', hint: 'One budget for joining and creating. DMs stay Pro-only.' },
  { key: 'vault_docs', label: 'Vault documents', hint: 'How many they can hold at once. Public profile stays Pro-only.' },
];

const PRO_FIELDS = [
  { key: 'session_credits', label: 'Pro 1-on-1 credits', hint: 'Free 1-on-1 sessions a Pro member gets per membership term. Renewing grants a fresh batch.' },
];

/**
 * One allowance: a number, or explicitly Unlimited.
 *
 * The same pair the achiever seat control uses. Unlimited is a radio you
 * choose, never an empty box you leave -- "no cap" and "I have not typed it
 * yet" are different intentions, and a blank field cannot tell them apart.
 * null travels to the server as unlimited.
 */
function LimitField({ field, value, onChange }) {
  const unlimited = value === null || value === undefined;
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2 min-w-0">
      <p className="text-sm font-semibold text-slate-800">{field.label}</p>
      <div className="flex items-center gap-2">
        <div role="radiogroup" aria-label={`${field.label} limit`} className="grid grid-cols-2 gap-1 p-1 rounded-xl bg-slate-100 shrink-0">
          {[['Limited', false], ['Unlimited', true]].map(([l, u]) => (
            <button key={l} type="button" role="radio" aria-checked={unlimited === u}
                    onClick={() => onChange(u ? null : (unlimited ? 0 : value))}
                    className={`min-h-9 px-2.5 rounded-lg text-xs font-semibold ${unlimited === u ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}>
              {l}
            </button>
          ))}
        </div>
        {!unlimited && (
          <input type="number" min={0} value={value} aria-label={`${field.label} limit`}
                 onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
                 className="flex-1 min-w-0 w-full min-h-10 px-2.5 border border-slate-200 rounded-lg text-sm tabular-nums bg-white focus:outline-none focus:ring-2 focus:ring-violet-500" />
        )}
      </div>
      <p className="text-[11px] text-slate-400 leading-snug">{field.hint}</p>
    </div>
  );
}

function LimitsCard({ limits, onSave, saving }) {
  const [f, setF] = useState(limits);
  useEffect(() => { setF(limits); }, [limits]);
  if (!f) return null;
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-bold text-slate-900">Allowances</h2>
          <p className="text-xs text-slate-500 mt-1">
            Free-tier caps apply to every student — when they hit one, the app tells them to take
            Skovo Pro. Unlimited removes the cap and makes that perk free for everyone.
          </p>
        </div>
        <Button onClick={() => onSave(f)} disabled={saving} className="w-full sm:w-auto shrink-0">
          <Save size={15} /> {saving ? 'Saving…' : 'Save limits'}
        </Button>
      </div>
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mb-3">Free tier</p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {FREE_FIELDS.map((field) => (
          <LimitField key={field.key} field={field} value={f[field.key]}
                      onChange={(v) => set(field.key, v)} />
        ))}
      </div>

      {/* Separated on purpose: this one is what a PAYING member receives, not
          a free-tier cap, and it sat in the same grid as the four above. */}
      <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400 mt-6 mb-3">
        Skovo Pro members
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {PRO_FIELDS.map((field) => (
          <LimitField key={field.key} field={field} value={f[field.key]}
                      onChange={(v) => set(field.key, v)} />
        ))}
      </div>
    </div>
  );
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <CheckCircle size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

// Client-side preview of the effective price (mirrors backend _effective_price).
function effective(p) {
  const base = Number(p.price) || 0;
  if (p.offer_price != null && p.offer_price !== '') return Math.round(Number(p.offer_price));
  if (p.offer_percent != null && p.offer_percent !== '' && Number(p.offer_percent) > 0)
    return Math.round(base * (100 - Number(p.offer_percent)) / 100);
  return base;
}

function PlanCard({ plan, onSave, onDelete, saving }) {
  const [f, setF] = useState(plan);
  const [open, setOpen] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const eff = effective(f);
  const discounted = eff < Number(f.price);
  const inp = 'w-full min-h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-violet-500';
  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';

  return (
    <div className={`bg-white rounded-2xl border p-4 sm:p-5 ${open ? 'border-violet-300' : 'border-slate-200'}`}>
      {/* Summary: what students see, at a glance. */}
      <div className="flex items-start gap-3">
        <span className="w-9 h-9 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center shrink-0"><Crown size={17} /></span>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm font-bold text-slate-900 break-words">{f.label || f.key}</p>
            <StatusBadge status={f.is_active ? 'active' : 'off'} label={f.is_active ? 'Live' : 'Off'} />
            {discounted && <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">{f.offer_label || 'Offer'}</span>}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">{f.months} month{f.months > 1 ? 's' : ''} · key {f.key}</p>
        </div>
        <div className="text-right shrink-0">
          {discounted && <p className="text-xs line-through text-slate-400">₹{Number(f.price).toLocaleString('en-IN')}</p>}
          <p className="text-xl font-black text-slate-900 tabular-nums leading-none">₹{eff.toLocaleString('en-IN')}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
                className="flex-1 min-h-10 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 inline-flex items-center justify-center gap-1.5 hover:bg-slate-50">
          {open ? <><ChevronUp size={15} /> Close</> : <><Pencil size={14} /> Edit price & offer</>}
        </button>
        <ActionBtn icon={Trash2} tooltip={`Delete ${f.label}`} color="red" onClick={() => onDelete(plan)} />
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-slate-100 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              {/* The name is editable -- a typo used to be permanent. The length
                  is not: it is the term existing subscribers already bought. */}
              <label className={lbl} htmlFor={`pn-${f.key}`}>Plan name</label>
              <input id={`pn-${f.key}`} value={f.label || ''} onChange={(e) => set('label', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl} htmlFor={`pp-${f.key}`}>Base price (₹)</label>
              <input id={`pp-${f.key}`} type="number" min={1} value={f.price ?? ''} onChange={(e) => set('price', e.target.value)} className={inp} />
            </div>
            <div>
              <label className={lbl} htmlFor={`po-${f.key}`}>Offer % off</label>
              <input id={`po-${f.key}`} type="number" min={0} max={100} value={f.offer_percent ?? ''} onChange={(e) => set('offer_percent', e.target.value)} placeholder="e.g. 50" className={inp} />
            </div>
            <div>
              <label className={lbl} htmlFor={`pf-${f.key}`}>…or fixed offer price (₹)</label>
              <input id={`pf-${f.key}`} type="number" min={0} value={f.offer_price ?? ''} onChange={(e) => set('offer_price', e.target.value)} placeholder="e.g. 999" className={inp} />
            </div>
            <div className="sm:col-span-2">
              <label className={lbl} htmlFor={`pl-${f.key}`}>Offer label (optional)</label>
              <input id={`pl-${f.key}`} value={f.offer_label ?? ''} onChange={(e) => set('offer_label', e.target.value)} placeholder="e.g. Diwali 50% OFF" className={inp} />
            </div>
            <div>
              <span className={lbl}>Offer starts (optional)</span>
              <DatePicker value={(f.offer_starts_at || '').slice(0, 10)} onChange={(v) => set('offer_starts_at', v)}
                          min={new Date().toISOString().slice(0, 10)} />
            </div>
            <div>
              <span className={lbl}>Offer ends (optional)</span>
              <DatePicker value={(f.offer_ends_at || '').slice(0, 10)} onChange={(v) => set('offer_ends_at', v)}
                          min={(f.offer_starts_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)} />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <ToggleSwitch checked={!!f.is_active} onChange={(v) => set('is_active', v)} onLabel="Live for students" offLabel="Off" />
            <Button onClick={() => onSave(f)} disabled={saving} className="w-full sm:w-auto">
              <Save size={15} /> {saving ? 'Saving…' : `Save · students pay ₹${eff.toLocaleString('en-IN')}`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Add a plan.
 *
 * The table was always shaped for more than the three seeded rows — it has a
 * plan_key and a sort_order — but only list and update existed, so the screen
 * read like a plan manager while quietly being a price editor.
 *
 * A new plan is created inactive. Creating one and launching it to every
 * student are different decisions, and collapsing them into a single Save is
 * how a half-priced draft ends up live.
 */
function NewPlanForm({ onCreate, onCancel, busy }) {
  const [f, setF] = useState({ key: '', label: '', months: '', price: '', offer_label: '', offer_percent: '', offer_price: '', offer_starts_at: '', offer_ends_at: '' });
  const set = (k, v) => setF(s => ({ ...s, [k]: v }));

  // The two discount styles are alternatives, not a pair: the student app reads
  // offer_price first, so a plan carrying both silently ignores the percent.
  // Filling one disables the other rather than letting an admin set a discount
  // that never applies.
  const hasPct   = f.offer_percent !== '' && Number(f.offer_percent) > 0;
  const hasFixed = f.offer_price !== '';

  const base    = Number(f.price);
  const preview = !base ? null
    : hasFixed ? Math.round(Number(f.offer_price))
    : hasPct   ? Math.round(base * (100 - Number(f.offer_percent)) / 100)
    : null;
  const offerBad  = preview != null && (preview >= base || preview < 0);
  const windowBad = !!(f.offer_starts_at && f.offer_ends_at && f.offer_ends_at <= f.offer_starts_at);

  const ready = f.key.trim() && f.label.trim() && Number(f.months) >= 1 && f.price !== ''
                && !offerBad && !windowBad;

  return (
    <div className="bg-white rounded-2xl border-2 border-purple-200 p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="font-bold text-slate-900">New plan</p>
        <button type="button" onClick={onCancel}
          className="p-1 rounded-lg text-slate-400 hover:bg-slate-100"><X size={15} /></button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Plan name</label>
          <input value={f.label} onChange={e => set('label', e.target.value)}
            placeholder="e.g. Half-yearly"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Plan key <span className="font-normal text-slate-400">(permanent)</span>
          </label>
          <input value={f.key}
            onChange={e => set('key', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
            placeholder="e.g. half_yearly"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-purple-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">
            Duration in months <span className="font-normal text-slate-400">(cannot change later)</span>
          </label>
          <input type="number" min="1" value={f.months} onChange={e => set('months', e.target.value)}
            placeholder="6"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">Base price (₹)</label>
          <input type="number" min="0" value={f.price} onChange={e => set('price', e.target.value)}
            placeholder="899"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
        </div>
      </div>

      {/* A launch promo is usually the reason a plan is being added at all, so
          it is settable here as well as on the plan's card afterwards. Every
          field is optional; leaving them empty creates a plain plan. */}
      <div className="mt-5 pt-4 border-t border-slate-100">
        <p className="text-xs font-bold text-slate-700 mb-3">
          Launch offer <span className="font-normal text-slate-400">(optional)</span>
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Offer label</label>
            <input value={f.offer_label} onChange={e => set('offer_label', e.target.value)}
              placeholder="e.g. Launch price"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">% off</label>
            <input type="number" min="1" max="100" value={f.offer_percent} disabled={hasFixed}
              onChange={e => set('offer_percent', e.target.value)}
              placeholder="e.g. 40"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">
              …or fixed offer price (₹)
            </label>
            <input type="number" min="0" value={f.offer_price} disabled={hasPct}
              onChange={e => set('offer_price', e.target.value)}
              placeholder="e.g. 499"
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Offer starts</label>
            <input type="date" value={f.offer_starts_at} onChange={e => set('offer_starts_at', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Offer ends</label>
            <input type="date" value={f.offer_ends_at} onChange={e => set('offer_ends_at', e.target.value)}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
          </div>
        </div>

        {/* What the student will actually see, worked out live. The mistake this
            catches is an "offer" that is not below the base price. */}
        {preview != null && (
          <p className={`text-xs mt-3 font-semibold ${offerBad ? 'text-red-600' : 'text-emerald-600'}`}>
            {offerBad
              ? 'The offer must work out lower than the base price.'
              : <>Students will see <span className="line-through text-slate-400">₹{base.toLocaleString('en-IN')}</span> ₹{preview.toLocaleString('en-IN')}</>}
          </p>
        )}
        {windowBad && (
          <p className="text-xs mt-2 font-semibold text-red-600">
            The offer end date must be after the start date.
          </p>
        )}
      </div>

      <div className="flex items-center justify-between mt-4">
        <p className="text-xs text-slate-500 max-w-md">
          Created inactive — tick <strong>Active</strong> when you want students to see it.
        </p>
        <button type="button" disabled={!ready || busy}
          onClick={() => onCreate({
                                     ...f,
                                     months: Number(f.months),
                                     price:  Number(f.price),
                                     // '' means "not set" to the API, not zero.
                                     offer_percent:   hasPct   ? Number(f.offer_percent) : null,
                                     offer_price:     hasFixed ? Number(f.offer_price)   : null,
                                     offer_label:     f.offer_label     || null,
                                     offer_starts_at: f.offer_starts_at || null,
                                     offer_ends_at:   f.offer_ends_at   || null,
                                   },
                                   () => setF({ key: '', label: '', months: '', price: '', offer_label: '', offer_percent: '', offer_price: '', offer_starts_at: '', offer_ends_at: '' }))}
          className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white
                     bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors">
          <Plus size={15} /> {busy ? 'Creating…' : 'Create plan'}
        </button>
      </div>
    </div>
  );
}

export default function AdminSubscriptions() {
  const [plans, setPlans] = useState([]);
  const [limits, setLimits] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savingLimits, setSavingLimits] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [toast, setToast] = useState(null);
  const [addingPlan, setAddingPlan] = useState(false);
  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const createPlan = async (payload, reset) => {
    setSaving(true);
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/subscriptions', payload);
      if (data?.bool) {
        showToast(data.response.message);
        setPlans(data.response.plans || []);
        reset();
        setAddingPlan(false);
      }
      else showToast(data.response?.message || 'Could not create the plan.', false);
    } catch { showToast('Could not create the plan.', false); }
    finally { setSaving(false); }
  };

  // Deleting is refused server-side when anyone is subscribed, so the prompt
  // says what the alternative is rather than letting the refusal be a surprise.
  const confirmDelete = (plan) => {
    setConfirmDlg({
      message: `Delete the "${plan.label}" plan?`,
      detail: 'This only works if no student has ever subscribed to it. If someone has, deactivate it instead.',
      confirmLabel: 'Delete plan',
      danger: true,
      onConfirm: async () => {
        try {
          const { data } = await api.delete(
            `/skovo-platform-panel-admin/subscriptions?key=${encodeURIComponent(plan.key)}`);
          if (data?.bool) { showToast(data.response.message); setPlans(data.response.plans || []); }
          else showToast(data.response?.message || 'Could not delete the plan.', false);
        } catch { showToast('Could not delete the plan.', false); }
      },
    });
  };

  const load = () => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/subscriptions')
      .then(({ data }) => {
        if (data.bool) {
          setPlans(data.response.plans || []);
          if (data.response.limits) setLimits(data.response.limits);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const saveLimits = async (f) => {
    setSavingLimits(true);
    try {
      // null means Unlimited and has to survive as null -- Number(null) is 0,
      // which is the opposite instruction: no allowance at all.
      const body = {};
      [...FREE_FIELDS, ...PRO_FIELDS].forEach(({ key }) => {
        const v = f[key];
        body[key] = (v === null || v === undefined || v === '') ? null : Number(v);
      });
      const { data } = await api.put('/skovo-platform-panel-admin/subscriptions/limits', body);
      if (data.bool) {
        showToast(data.response.message);
        setLimits(data.response.limits || f);
      } else showToast(data.response?.message || 'Could not save limits.', false);
    } catch { showToast('Could not save limits.', false); }
    finally { setSavingLimits(false); }
  };

  // Plan pricing is what students are charged at checkout, so this is a
  // change to money rather than to a setting. Name the plan and the price.
  const confirmSave = (f) => {
    setConfirmDlg({
      message: `Save the "${f.label || f.key}" plan?`,
      detail: `Students will be charged ₹${Number(f.price || 0).toLocaleString('en-IN')} at checkout from now on. Existing subscriptions are not changed.`,
      confirmLabel: 'Save plan',
      onConfirm: () => save(f),
    });
  };

  const save = async (f) => {
    setSaving(true);
    try {
      const body = {
        key: f.key, price: Number(f.price), is_active: !!f.is_active,
        offer_label: f.offer_label || null,
        offer_percent: f.offer_percent === '' || f.offer_percent == null ? null : Number(f.offer_percent),
        offer_price: f.offer_price === '' || f.offer_price == null ? null : Number(f.offer_price),
        offer_starts_at: f.offer_starts_at || null,
        offer_ends_at: f.offer_ends_at || null,
      };
      const { data } = await api.put('/skovo-platform-panel-admin/subscriptions', body);
      if (data.bool) { showToast('Plan saved'); setPlans(data.response.plans || plans); }
      else showToast(data.response?.message || 'Failed to save', false);
    } catch { showToast('Network error. Try again.', false); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-4 sm:p-6">
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      <Toast msg={toast?.msg} ok={toast?.ok} />
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Subscriptions</h1>
          <p className="text-sm text-slate-500 mt-0.5">Skovo Pro plans, offers and free-tier limits — live for every student.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Top-right, where the primary action on every other admin screen
              sits. At the foot of the list it was below the fold on a short
              window, so the one thing this screen could not do looked like the
              one thing it did not have. */}
          <Button onClick={() => setAddingPlan(true)} disabled={addingPlan} className="flex-1 sm:flex-none">
            <Plus size={16} /> Add a plan
          </Button>
          <button onClick={load} disabled={loading} aria-label="Reload"
                  className="min-h-11 min-w-11 flex items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-50">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      <div className="mb-5 p-3.5 bg-violet-50 border border-violet-200 rounded-2xl flex gap-2.5">
        <Info size={16} className="text-violet-600 shrink-0 mt-0.5" />
        <p className="text-xs text-violet-800 leading-relaxed">
          A plan's <strong>base price</strong> is what students pay. For a promo, add a <strong>% off</strong> or a
          <strong> fixed offer price</strong>, optionally between two dates — the app shows the discount automatically.
        </p>
      </div>

      {loading ? (
        <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-56 bg-slate-100 rounded-2xl animate-pulse" />)}</div>
      ) : (
        <div className="space-y-5">
          {limits && (
            <LimitsCard limits={limits} onSave={saveLimits} saving={savingLimits} />
          )}
          {addingPlan && (
            <NewPlanForm
              onCreate={createPlan}
              onCancel={() => setAddingPlan(false)}
              busy={saving}
            />
          )}
          <div className="grid lg:grid-cols-2 gap-3 items-start">
            {plans.map((p) => (
              <PlanCard key={p.key} plan={p} onSave={confirmSave} onDelete={confirmDelete} saving={saving} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
