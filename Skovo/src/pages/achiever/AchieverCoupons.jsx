import React, { useEffect, useState } from 'react';
import { achieverApi } from '../../services/api';
import { Ticket, Plus, Trash2, CheckCircle, X, Info } from 'lucide-react';
import { StatusBadge, EmptyState, TableShell, Th, Td, ConfirmModal, ResponsiveTable, RowCard } from '../../components/ui/TableComponents';
import { Button, ErrorState, useToast } from '../../components/ui/index.jsx';
import { FormSelect } from '../../components/ui/index.jsx';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';
import { useMasters } from '../../hooks/useMasters';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';

const EMPTY = { code: '', discount_type: 'percent', value: '', applies_to: 'cohort', max_uses: '', per_user_limit: '1', valid_until: '' };

function CreateModal({ onClose, onCreated }) {
  const { lists } = useMasters(['coupon_applies_to', 'coupon_discount_type']);
  const [f, setF] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const cls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';

  const save = async () => {
    // The two hand-rolled checks this replaces caught a blank code and a
    // non-positive value, and nothing else. In particular nothing capped a
    // PERCENTAGE at 100: `value: 500` was accepted here, by the route, and by
    // the stored procedure. Checkout clamps with LEAST(discount, amount), so
    // the result was a cohort given away free rather than a negative price —
    // silent either way. See schemas/achiever.js and achiever.md §7.3.
    const parsed = schema.coupon.safeParse(f);
    if (!parsed.success) {
      setErr(Object.values(fieldErrors(parsed))[0]);
      return;
    }
    setSaving(true); setErr('');
    try {
      const body = {
        code: f.code.trim().toUpperCase(), discount_type: f.discount_type, value: Number(f.value),
        applies_to: f.applies_to, max_uses: f.max_uses ? Number(f.max_uses) : null,
        per_user_limit: f.per_user_limit ? Number(f.per_user_limit) : 1,
        valid_until: f.valid_until || null,
      };
      const { data } = await achieverApi.post('/achievers/portal/coupons', body);
      if (data.bool) onCreated();
      else setErr(data.response?.message || 'Could not create coupon.');
    } catch { setErr('Network error. Try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Ticket size={16} /> New Coupon</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div>
          <label className="text-xs font-semibold text-slate-600">Coupon code</label>
          <input value={f.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="e.g. LAUNCH50" className={`${cls} uppercase tracking-wide`} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Discount type</label>
            <FormSelect searchType="coupon_discount_type"
              value={f.discount_type}
              onChange={v => set('discount_type', v)}
              options={lists.coupon_discount_type || []}
              clearable={false} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">{f.discount_type === 'percent' ? 'Value (%)' : 'Value (₹)'}</label>
            {/* max only for a percentage — a flat rupee discount has no
                natural ceiling. The input said min={1} and nothing else, so the
                spinner would happily climb to 500%. */}
            <input type="number" min={1} max={f.discount_type === 'percent' ? 100 : undefined}
              value={f.value} onChange={(e) => set('value', e.target.value)}
              placeholder={f.discount_type === 'percent' ? '50' : '200'} className={cls} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Applies to</label>
            <FormSelect searchType="coupon_applies_to"
              value={f.applies_to}
              onChange={v => set('applies_to', v)}
              options={(lists.coupon_applies_to || []).filter(
                (o) => ['cohort', 'session'].includes(o.value || o.id)
              )}
              clearable={false} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Valid until (optional)</label>
            <input type="date" value={f.valid_until} onChange={(e) => set('valid_until', e.target.value)} className={cls} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-semibold text-slate-600">Total uses (optional)</label>
            <input type="number" min={1} value={f.max_uses} onChange={(e) => set('max_uses', e.target.value)} placeholder="unlimited" className={cls} />
          </div>
          <div>
            <label className="text-xs font-semibold text-slate-600">Per-student limit</label>
            <input type="number" min={1} value={f.per_user_limit} onChange={(e) => set('per_user_limit', e.target.value)} className={cls} />
          </div>
        </div>
        {err && <p className="text-xs text-red-500">{err}</p>}
        <div className="flex gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Cancel</button>
          <button onClick={save} disabled={saving} className="flex-1 py-2 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 disabled:opacity-50">{saving ? 'Creating…' : 'Create coupon'}</button>
        </div>
      </div>
    </div>
  );
}

export default function AchieverCoupons() {
  const [coupons, setCoupons] = useState([]);
  const paged = usePagedRows(coupons);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [failed, setFailed] = useState(false);
  const [confirmOff, setConfirmOff] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  // ToastProvider lives in AchieverLayout and owns the queue and the timers;
  // this screen had its own setToast + setTimeout pair.
  const toast = useToast();

  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/coupons')
      .then(({ data }) => {
        if (!alive) return;
        if (data.bool) { setCoupons(data.response.coupons || []); setFailed(false); }
        else setFailed(true);
      })
      // Swallowed before, so an outage rendered "No coupons yet" - inviting an
      // achiever to re-create codes that already exist and would collide.
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [reloadKey]);

  const load = () => setReloadKey((k) => k + 1);
  const retry = () => { setLoading(true); load(); };

  const deactivate = async (c) => {
    setConfirmOff(null);
    try {
      const { data } = await achieverApi.delete(`/achievers/portal/coupons/${c.id}`);
      // No else before this: a refused deactivation left the coupon live and
      // said nothing, so students could keep redeeming it.
      if (data.bool) { toast.success('Coupon deactivated'); load(); }
      else toast.error(data.response?.message || "Couldn't deactivate that coupon.");
    } catch { toast.error('Connection problem - the coupon is still active.'); }
  };

  return (
    <div className="p-4 sm:p-6">
      {confirmOff && (
        <ConfirmModal
          danger
          message={`Deactivate ${confirmOff.code}?`}
          detail="Students can no longer redeem it at checkout. Anyone who already used it keeps their discount."
          confirmLabel="Deactivate coupon"
          onCancel={() => setConfirmOff(null)}
          onConfirm={() => deactivate(confirmOff)}
        />
      )}

      {/* Stacked below `sm`: this was a fixed justify-between row, so the title
          and the action collided on a phone. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Coupons</h1>
          <p className="text-sm text-slate-500 mt-1">Create discount codes for your cohorts and 1-on-1s. Another achiever can use the same letters — the code only works on your listings.</p>
        </div>
        {/* Shared <Button>, not a hand-rolled one. The achiever portal had a
            dozen primary-button styles — five paddings, two weights, three
            disabled opacities — and only 13 of its 119 buttons had any focus
            style. This one carries btn-accent (so it follows the portal
            theme), the focus ring and the press feedback. */}
        <Button variant="primary" onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus size={16} /> New Coupon
        </Button>
      </div>

      <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-2xl flex gap-3">
        <Info size={16} className="text-purple-500 shrink-0 mt-0.5" />
        <p className="text-xs text-purple-700">Coupons you create apply <strong>only to your own</strong> listings. Two mentors can both have GATE20; checkout on your page uses yours.</p>
      </div>

      {loading ? (
        <div className="space-y-3">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-14 bg-slate-100 rounded-xl animate-pulse" />)}</div>
      ) : failed ? (
        <TableShell>
          <ErrorState
            title="We couldn't load your coupons"
            subtitle="Your codes are safe - this is a connection problem."
            onRetry={retry}
          />
        </TableShell>
      ) : coupons.length === 0 ? (
        <TableShell><div className="py-4"><EmptyState icon={Ticket} message="No coupons yet" sub="Create a discount code for your students" /></div></TableShell>
      ) : (
        <>
          <ResponsiveTable
            cards={paged.rows.map((c) => (
              <RowCard
                key={c.id}
                title={c.code}
                subtitle={`${c.discount_type === 'percent' ? `${c.value}% off` : `₹${c.value} off`} · ${c.applies_to === 'all' ? 'All' : c.applies_to}`}
                badge={<StatusBadge status={c.is_active ? 'active' : 'inactive'} />}
                action={c.is_active ? (
                  <button aria-label="Deactivate" onClick={() => setConfirmOff(c)} title="Deactivate"
                    className="relative p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 shrink-0 before:absolute before:-inset-2 before:content-['']">
                    <Trash2 size={14} />
                  </button>
                ) : undefined}
                fields={[
                  { label: 'Used', value: `${c.used_count}${c.max_uses ? ` / ${c.max_uses}` : ''}` },
                  { label: 'Valid until', value: c.valid_until ? new Date(c.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—' },
                ]}
              />
            ))}
            table={
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr><Th>Code</Th><Th>Discount</Th><Th>Applies to</Th><Th>Used</Th><Th>Valid until</Th><Th>Status</Th><Th></Th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {paged.rows.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <Td><span className="font-bold text-slate-900 tracking-wide">{c.code}</span></Td>
                      <Td>{c.discount_type === 'percent' ? `${c.value}% off` : `₹${c.value} off`}</Td>
                      <Td><span className="capitalize text-slate-600">{c.applies_to === 'all' ? 'All' : c.applies_to}</span></Td>
                      <Td>{c.used_count}{c.max_uses ? ` / ${c.max_uses}` : ''}</Td>
                      <Td>{c.valid_until ? new Date(c.valid_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</Td>
                      <Td><StatusBadge status={c.is_active ? 'active' : 'inactive'} /></Td>
                      <Td right>
                        {c.is_active && (
                          <button aria-label="Deactivate" onClick={() => setConfirmOff(c)} className="relative p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors before:absolute before:-inset-2 before:content-['']" title="Deactivate">
                            <Trash2 size={14} />
                          </button>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            }
          />
          {coupons.length > 0 && (
            <div className="mt-3 bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <Pagination {...paged.bind} />
            </div>
          )}
        </>
      )}

      {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={() => { setShowCreate(false); toast.success('Coupon created'); load(); }} />}
    </div>
  );
}
