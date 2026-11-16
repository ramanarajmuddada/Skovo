import { useMasters } from '../../hooks/useMasters';
import StatTile from '../../components/admin/StatTile';
import { ActionBtn } from '../../components/ui/TableComponents';
import { Radio as LiveIcon, PauseCircle } from 'lucide-react';
import React, { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Gift, Plus, Trash2, Pencil, Pause, Play } from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { Button, Input, FormSelect } from '../../components/ui/index.jsx';

const WHO = [
  { value: 'student', label: 'A student' },
  { value: 'achiever', label: 'An achiever' },
];
const STUDENT_TRIGGERS = [
  { value: 'signup', label: 'Friend finishes signup' },
  { value: 'cohorts', label: 'Friend attends cohorts' },
  { value: 'pro_purchase', label: 'Friend pays for Pro' },
];
const ACHIEVER_TRIGGERS = [
  { value: 'approved', label: 'Friend is approved and active' },
];
const STUDENT_KINDS = [
  { value: 'none', label: 'Nothing' },
  { value: 'points', label: 'Points' },
  { value: 'pro_days', label: 'Pro days' },
  { value: 'coupon', label: 'Coupon' },
];
const ACHIEVER_KINDS = [
  { value: 'none', label: 'Nothing' },
  { value: 'pay', label: 'Pay' },
  { value: 'seats', label: 'Extra seats' },
];
const APPLIES = [
  { value: 'all', label: 'Any payment' },
  { value: 'pro', label: 'Pro' },
  { value: 'cohort', label: 'A cohort' },
  { value: 'session', label: 'A session' },
];

const empty = {
  referrer_audience: 'student',
  friend_audience: 'student',
  trigger_kind: 'signup',
  cohort_count: '',
  pro_months: '',
  milestone_count: '',
  referrer_pay_amount: '',
  referrer_seats: '',
  friend_pay_amount: '',
  friend_seats: '',
  referrer_kind: 'points',
  referrer_points: '2',
  referrer_pro_days: '',
  referrer_coupon_type: 'percent',
  referrer_coupon_value: '',
  referrer_coupon_applies: 'pro',
  friend_kind: 'points',
  friend_points: '2',
  friend_pro_days: '',
  friend_coupon_type: 'percent',
  friend_coupon_value: '',
  friend_coupon_applies: 'pro',
};

// A saved rule back into form strings, so Edit and Pause resend every field.
const toForm = (rule) => Object.fromEntries(Object.keys(empty).map((key) => [
  key, rule[key] === null || rule[key] === undefined ? empty[key] : String(rule[key]),
]));

const since = (iso) => (iso ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null);

const num = z.string().optional();
const schema = z.object({
  referrer_audience: z.enum(['student', 'achiever']),
  friend_audience: z.enum(['student', 'achiever']),
  trigger_kind: z.enum(['signup', 'cohorts', 'pro_purchase', 'approved']),
  cohort_count: num,
  pro_months: num,
  milestone_count: num,
  referrer_pay_amount: num,
  referrer_seats: num,
  referrer_kind: z.enum(['none', 'points', 'pro_days', 'coupon', 'pay', 'seats']),
  referrer_points: num,
  referrer_pro_days: num,
  referrer_coupon_type: z.string().optional(),
  referrer_coupon_value: num,
  referrer_coupon_applies: z.string().optional(),
  friend_pay_amount: num,
  friend_seats: num,
  friend_kind: z.enum(['none', 'points', 'pro_days', 'coupon', 'pay', 'seats']),
  friend_points: num,
  friend_pro_days: num,
  friend_coupon_type: z.string().optional(),
  friend_coupon_value: num,
  friend_coupon_applies: z.string().optional(),
});

function SideFields({ prefix, form, set, who }) {
  const { lists: discountTypes } = useMasters(['coupon_discount_type']);
  const kind = form[`${prefix}_kind`];
  const options = who === 'achiever' ? ACHIEVER_KINDS : STUDENT_KINDS;
  return (
    <div className="space-y-3 rounded-xl border border-slate-200 p-4">
      <FormSelect
        label={prefix === 'referrer' ? 'Who invited them' : 'The friend'}
        value={options.some((o) => o.value === kind) ? kind : 'none'}
        onChange={(v) => set(`${prefix}_kind`, v)}
        options={options}
        clearable={false}
      />
      {kind === 'points' && (
        <Input label="Points" hint="1 to 10. Points add to the Readiness score." inputMode="numeric" value={form[`${prefix}_points`]}
          onChange={(e) => set(`${prefix}_points`, e.target.value.replace(/\D/g, ''))} />
      )}
      {kind === 'pro_days' && (
        <Input label="Pro days" inputMode="numeric" value={form[`${prefix}_pro_days`]}
          onChange={(e) => set(`${prefix}_pro_days`, e.target.value.replace(/\D/g, ''))} />
      )}
      {kind === 'pay' && (
        <Input label="Rupees added to earnings" inputMode="numeric" value={form[`${prefix}_pay_amount`]}
          onChange={(e) => set(`${prefix}_pay_amount`, e.target.value.replace(/\D/g, ''))} />
      )}
      {kind === 'seats' && (
        <Input label="Extra seats per cohort" inputMode="numeric" value={form[`${prefix}_seats`]}
          onChange={(e) => set(`${prefix}_seats`, e.target.value.replace(/\D/g, ''))} />
      )}
      {kind === 'coupon' && (
        <div className="grid grid-cols-3 gap-2">
          <FormSelect label="Type" value={form[`${prefix}_coupon_type`]} clearable={false}
            onChange={(v) => set(`${prefix}_coupon_type`, v)}
            options={(discountTypes.coupon_discount_type || []).map((o) => ({ value: o.value, label: o.label }))} />
          <Input label="Value" inputMode="numeric" value={form[`${prefix}_coupon_value`]}
            onChange={(e) => set(`${prefix}_coupon_value`, e.target.value.replace(/\D/g, ''))} />
          <FormSelect label="Use on" value={form[`${prefix}_coupon_applies`]} clearable={false}
            onChange={(v) => set(`${prefix}_coupon_applies`, v)} options={APPLIES} />
        </div>
      )}
    </div>
  );
}

export default function AdminReferrals() {
  const [rules, setRules] = useState([]);
  const [form, setForm] = useState(empty);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Set while editing: the rule keeps its id, so friends already paid are
  // never paid again (deleting and re-adding would start a new rule).
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.get('/skovo-platform-panel-admin/referral-rules').then(({ data }) => {
      if (data.bool) setRules(data.response?.rules || []);
    }).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setForm((f) => {
    const next = { ...f, [key]: value };
    if (key === 'referrer_audience' && value === 'student') {
      next.friend_audience = 'student';
      if (next.trigger_kind === 'approved') next.trigger_kind = 'signup';
      if (next.referrer_kind === 'pay' || next.referrer_kind === 'seats') next.referrer_kind = 'points';
    }
    if (key === 'friend_audience') {
      next.trigger_kind = value === 'achiever' ? 'approved' : 'signup';
      if (value === 'achiever' && !['none', 'pay', 'seats'].includes(next.friend_kind)) next.friend_kind = 'pay';
      if (value === 'student' && !['none', 'points', 'pro_days', 'coupon'].includes(next.friend_kind)) next.friend_kind = 'points';
    }
    if (key === 'referrer_audience' && value === 'achiever' && !['none', 'pay', 'seats'].includes(next.referrer_kind)) {
      next.referrer_kind = 'pay';
    }
    return next;
  });

  const save = async (e) => {
    e.preventDefault();
    const parsed = schema.safeParse(form);
    if (!parsed.success) { setError('Check the prize fields.'); return; }
    setSaving(true); setError('');
    try {
      const body = editing ? { ...form, id: editing.id, is_active: editing.is_active } : form;
      const { data } = await api.post('/skovo-platform-panel-admin/referral-rules', body);
      if (!data.bool) { setError(data.response?.message || 'Could not save.'); return; }
      setForm(empty);
      setEditing(null);
      load();
    } catch {
      setError('Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (id) => {
    const { data } = await api.delete(`/skovo-platform-panel-admin/referral-rules/${id}`);
    if (data.bool) {
      if (editing?.id === id) { setEditing(null); setForm(empty); }
      load();
    }
  };

  const startEdit = (rule) => {
    setEditing(rule);
    setForm(toForm(rule));
    setError('');
  };

  const cancelEdit = () => {
    setEditing(null);
    setForm(empty);
    setError('');
  };

  const togglePause = async (rule) => {
    setError('');
    try {
      const { data } = await api.post('/skovo-platform-panel-admin/referral-rules',
        { ...toForm(rule), id: rule.id, is_active: !rule.is_active });
      if (!data.bool) { setError(data.response?.message || 'Could not update.'); return; }
      load();
    } catch {
      setError('Could not update.');
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Referrals</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Refer & Earn prizes. An invite alone pays nothing; a reward counts friends who join after it was added —
          so change a reward with Edit, not by removing and re-adding it.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Rewards" value={rules.length} icon={Gift} tone="blue" />
        <StatTile label="Live" value={rules.filter((r) => r.is_active).length} icon={LiveIcon} tone="emerald" />
        <StatTile label="Paused" value={rules.filter((r) => !r.is_active).length} icon={PauseCircle} tone="amber" />
      </div>

      {/* Desktop: the rewards and the form side by side. */}
      <div className="grid lg:grid-cols-[1fr_26rem] gap-4 items-start">
      <div className="space-y-3">
        {rules.map((rule) => (
          <div key={rule.id} className={`flex items-start justify-between gap-3 rounded-2xl border bg-white p-4 ${editing?.id === rule.id ? 'border-slate-400' : 'border-slate-200'}`}>
            <div>
              <p className={`text-sm ${rule.is_active ? 'text-slate-800' : 'text-slate-400'}`}>{rule.summary}</p>
              <p className="text-xs text-slate-400 mt-1">
                {rule.is_active ? 'Live' : 'Paused'}
                {since(rule.created_at) && ` · counts friends who joined from ${since(rule.created_at)}`}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <ActionBtn icon={Pencil} tooltip="Edit reward" color="blue" onClick={() => startEdit(rule)} />
              <ActionBtn icon={rule.is_active ? Pause : Play} tooltip={rule.is_active ? 'Pause reward' : 'Resume reward'} color="amber" onClick={() => togglePause(rule)} />
              <ActionBtn icon={Trash2} tooltip="Remove reward" color="red" onClick={() => remove(rule.id)} />
            </div>
          </div>
        ))}
        {!rules.length && <p className="text-sm text-slate-400">No rewards yet. Add one with the form.</p>}
      </div>

      <form onSubmit={save} noValidate className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 lg:sticky lg:top-4">
        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
          {editing ? <><Pencil size={16} /> Edit reward</> : <><Plus size={16} /> Add a reward</>}
        </h2>
        <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-3">
          <FormSelect label="Who is inviting" value={form.referrer_audience} clearable={false}
            onChange={(v) => set('referrer_audience', v)} options={WHO} />
          <FormSelect label="Who they invite" value={form.friend_audience} clearable={false}
            onChange={(v) => set('friend_audience', v)}
            options={form.referrer_audience === 'achiever' ? WHO : [{ value: 'student', label: 'A student' }]} />
        </div>
        <FormSelect label="When" value={form.trigger_kind} clearable={false}
          onChange={(v) => set('trigger_kind', v)}
          options={form.friend_audience === 'achiever' ? ACHIEVER_TRIGGERS : STUDENT_TRIGGERS} />
        {form.trigger_kind === 'cohorts' && (
          <Input label="Cohorts the friend must attend" inputMode="numeric" value={form.cohort_count}
            onChange={(e) => set('cohort_count', e.target.value.replace(/\D/g, ''))} />
        )}
        {form.trigger_kind === 'pro_purchase' && (
          <Input label="Months of Pro the friend pays for" inputMode="numeric" value={form.pro_months}
            onChange={(e) => set('pro_months', e.target.value.replace(/\D/g, ''))} />
        )}
        <Input label="Or only when the friend count hits (leave empty to pay every friend)" inputMode="numeric"
          value={form.milestone_count} onChange={(e) => set('milestone_count', e.target.value.replace(/\D/g, ''))} />
        <div className="grid sm:grid-cols-2 lg:grid-cols-1 gap-3">
          <SideFields prefix="referrer" form={form} set={set} who={form.referrer_audience} />
          <SideFields prefix="friend" form={form} set={set} who={form.friend_audience} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Save reward'}</Button>
          {editing && <Button type="button" variant="secondary" onClick={cancelEdit}>Cancel</Button>}
        </div>
      </form>
      </div>
    </div>
  );
}
