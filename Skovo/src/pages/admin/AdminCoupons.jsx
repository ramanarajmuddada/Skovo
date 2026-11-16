import React, { useEffect, useState, useCallback } from 'react';
import DateTimePicker from '../../components/ui/DateTimePicker';
import { adminApi as api } from '../../services/api';
import { Ticket, Plus, Pencil, Power, X, Search, CheckCircle2, PauseCircle, Repeat } from 'lucide-react';
import StatTile from '../../components/admin/StatTile';
import { Button } from '../../components/ui/index.jsx';
import { StatusBadge, ActionBtn } from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { Pagination, ConfirmModal } from '../../components/ui/TableComponents';
import { usePagedRows } from '../../hooks/usePagedRows';
import { useMasters } from '../../hooks/useMasters';
import { toDateTimeLocal } from '../../utils/datetime';

const EMPTY = {
  code: '', discount_type: 'percent', value: '', max_discount: '', min_amount: '',
  applies_to: 'all', max_uses: '', per_user_limit: 1, valid_from: '', valid_until: '', is_active: true,
};

function Modal({ form, setForm, onClose, onSave, saving, isEdit }) {
  const { lists } = useMasters(['coupon_applies_to', 'coupon_discount_type']);
  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const inp = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-300';
  const lbl = 'block text-xs font-semibold text-slate-600 mb-1';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative bg-white rounded-2xl w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Coupon' : 'New Coupon'}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className={lbl}>Code *</label>
            <input className={`${inp} font-mono uppercase`} value={form.code} disabled={isEdit}
              onChange={e => sf('code', e.target.value.toUpperCase())} placeholder="WELCOME20" />
          </div>
          <div>
            <label className={lbl}>Discount Type</label>
            <FormSelect searchType="coupon_discount_type"
              value={form.discount_type}
              onChange={v => sf('discount_type', v)}
              options={lists.coupon_discount_type || []}
              clearable={false} />
          </div>
          <div>
            <label className={lbl}>Value {form.discount_type === 'percent' ? '(%)' : '(₹)'}</label>
            <input type="number" className={inp} value={form.value} onChange={e => sf('value', e.target.value)} />
          </div>
          {form.discount_type === 'percent' && (
            <div>
              <label className={lbl}>Max Discount (₹)</label>
              <input type="number" className={inp} value={form.max_discount} onChange={e => sf('max_discount', e.target.value)} placeholder="optional cap" />
            </div>
          )}
          <div>
            <label className={lbl}>Min Order (₹)</label>
            <input type="number" className={inp} value={form.min_amount} onChange={e => sf('min_amount', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Applies To</label>
            <FormSelect searchType="coupon_applies_to"
              value={form.applies_to}
              onChange={v => sf('applies_to', v)}
              options={lists.coupon_applies_to || []}
              clearable={false} />
          </div>
          <div>
            <label className={lbl}>Max Total Uses</label>
            <input type="number" className={inp} value={form.max_uses} onChange={e => sf('max_uses', e.target.value)} placeholder="unlimited" />
          </div>
          <div>
            <label className={lbl}>Per-User Limit</label>
            <input type="number" className={inp} value={form.per_user_limit} onChange={e => sf('per_user_limit', e.target.value)} />
          </div>
          <div>
            <label className={lbl}>Valid From</label>
            <DateTimePicker value={form.valid_from} onChange={(v) => sf('valid_from', v)} placeholder="From now" future />
          </div>
          <div>
            <label className={lbl}>Valid Until</label>
            <DateTimePicker value={form.valid_until} onChange={(v) => sf('valid_until', v)} placeholder="No end date"
                            future min={form.valid_from || undefined} defaultTime={{ h: 23, mi: 59 }} />
          </div>
        </div>
        <div className="flex gap-3 mt-5">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={onSave} disabled={saving} className="flex-1 py-2 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create Coupon')}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminCoupons() {
  const { lists: couponLists } = useMasters(['coupon_applies_to']);
  const appliesLabel = (v) => (couponLists.coupon_applies_to || []).find((o) => o.value === v)?.label
    || (v ? String(v).replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '—');
  const [coupons, setCoupons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);   // 'create' | coupon object | null
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [toast, setToast] = useState('');

  const [show, setShow] = useState('');       // '' | 'active' | 'off'
  const [q, setQ] = useState('');
  const shown = coupons.filter((c) => (!show || (show === 'active' ? c.is_active : !c.is_active))
    && (!q.trim() || (c.code || '').toLowerCase().includes(q.trim().toLowerCase())));
  const paged = usePagedRows(shown);
  const pick = (k) => setShow(show === k ? '' : k);

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 2500); };
  const load = useCallback(() => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/coupons')
      .then(({ data }) => { if (data.bool) setCoupons(data.response.coupons || []); })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setForm(EMPTY); setModal('create'); };
  const openEdit = (c) => {
    setForm({
      code: c.code, discount_type: c.discount_type, value: c.value ?? '',
      max_discount: c.max_discount ?? '', min_amount: c.min_amount ?? '',
      applies_to: c.applies_to, max_uses: c.max_uses ?? '', per_user_limit: c.per_user_limit ?? 1,
      valid_from: toDateTimeLocal(c.valid_from),
      valid_until: toDateTimeLocal(c.valid_until),
      is_active: c.is_active,
    });
    setModal(c);
  };

  const save = async () => {
    if (!form.code.trim()) return showToast('Code is required');
    setSaving(true);
    try {
      const body = {
        ...form,
        value: Number(form.value) || 0,
        max_discount: form.max_discount === '' ? null : Number(form.max_discount),
        min_amount: Number(form.min_amount) || 0,
        max_uses: form.max_uses === '' ? null : Number(form.max_uses),
        per_user_limit: Number(form.per_user_limit) || 1,
      };
      const isEdit = modal && modal !== 'create';
      const { data } = isEdit
        ? await api.put(`/skovo-platform-panel-admin/coupons/${modal.id}`, body)
        : await api.post('/skovo-platform-panel-admin/coupons', body);
      if (data.bool) { showToast(isEdit ? 'Updated' : 'Created'); setModal(null); load(); }
      else showToast(data.response?.message || 'Failed');
    } catch { showToast('Error'); } finally { setSaving(false); }
  };

  // Disabling sends DELETE, so this is not the reversible-looking toggle the
  // power icon suggests — a student mid-checkout with this code loses it. Ask
  // first, and name the code so the wrong row is obvious before it is hit.
  const confirmToggle = (c) => {
    const disabling = c.is_active;
    setConfirmDlg({
      message: `${disabling ? 'Disable' : 'Enable'} coupon "${c.code}"?`,
      detail: disabling
        ? 'Students can no longer apply this code at checkout. You can enable it again later.'
        : 'Students will be able to apply this code at checkout again.',
      confirmLabel: disabling ? 'Disable' : 'Enable',
      danger: disabling,
      onConfirm: () => toggle(c),
    });
  };

  const toggle = async (c) => {
    try {
      const { data } = c.is_active
        ? await api.delete(`/skovo-platform-panel-admin/coupons/${c.id}`)
        : await api.put(`/skovo-platform-panel-admin/coupons/${c.id}`, { is_active: true });
      if (data.bool) { showToast(c.is_active ? 'Disabled' : 'Enabled'); load(); }
    } catch { showToast('Error'); }
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
      {toast && <div className="fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold bg-slate-900 text-white">{toast}</div>}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Coupons</h1>
          <p className="text-sm text-slate-500 mt-0.5">Discount codes for cohorts and 1-on-1 sessions</p>
        </div>
        <Button onClick={openCreate} className="w-full sm:w-auto"><Plus size={16} /> New coupon</Button>
      </div>

      {/* Tiles double as the filter; "Times used" is a total, not a filter. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="All coupons" value={coupons.length} icon={Ticket} tone="blue" onClick={() => pick('')} active={!show} />
        <StatTile label="Active" value={coupons.filter((c) => c.is_active).length} icon={CheckCircle2} tone="emerald" onClick={() => pick('active')} active={show === 'active'} />
        <StatTile label="Disabled" value={coupons.filter((c) => !c.is_active).length} icon={PauseCircle} tone="amber" onClick={() => pick('off')} active={show === 'off'} />
        <StatTile label="Times used" value={coupons.reduce((a, c) => a + Number(c.used_count || 0), 0)} icon={Repeat} tone="violet" />
      </div>

      <div className="relative mb-4">
        <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search coupon codes"
               placeholder="Search code…"
               className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {/* Phones: one card per coupon -- the six-column table only fitted by
            scrolling sideways, and its 26px icons were too small to tap. */}
        <div className="md:hidden divide-y divide-slate-100">
          {loading ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-400">{coupons.length ? 'No coupons match.' : 'No coupons yet. Create one to get started.'}</p>
          ) : paged.rows.map((c) => (
            <div key={c.id} className={`p-4 ${!c.is_active ? 'opacity-50' : ''}`}>
              <div className="flex items-start gap-2">
                <p className="flex-1 min-w-0 pt-2 font-mono font-bold text-slate-800 break-all">{c.code}</p>
                <div className="flex shrink-0 -mr-1">
                  <button onClick={() => openEdit(c)} aria-label={`Edit ${c.code}`} className="p-2.5 text-slate-400 hover:text-blue-600"><Pencil size={16} /></button>
                  <button onClick={() => confirmToggle(c)} aria-label={c.is_active ? 'Disable' : 'Enable'} className="p-2.5 text-slate-400 hover:text-amber-600"><Power size={16} /></button>
                </div>
              </div>
              <p className="text-xs text-slate-500 break-words">
                {c.discount_type === 'percent' ? `${c.value}%` : `₹${c.value}`}{c.max_discount ? ` (max ₹${c.max_discount})` : ''}
                {' · '}{appliesLabel(c.applies_to)}{' · used '}{c.used_count || 0}{c.max_uses ? ` / ${c.max_uses}` : ''}
              </p>
              <div className="mt-2"><StatusBadge status={c.is_active ? 'active' : 'disabled'} /></div>
            </div>
          ))}
        </div>
        <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              {['Code', 'Discount', 'Applies to', 'Used', 'Status', 'Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-500">{h}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 mo-stagger-fade">
            {loading ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Loading…</td></tr>
            ) : shown.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">{coupons.length ? 'No coupons match.' : 'No coupons yet. Create one to get started.'}</td></tr>
            ) : paged.rows.map(c => (
              <tr key={c.id} className={`hover:bg-slate-50 ${!c.is_active ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-mono font-bold text-slate-800">{c.code}</td>
                <td className="px-4 py-3 text-slate-600">{c.discount_type === 'percent' ? `${c.value}%` : `₹${c.value}`}{c.max_discount ? ` (max ₹${c.max_discount})` : ''}</td>
                <td className="px-4 py-3 text-slate-500">{appliesLabel(c.applies_to)}</td>
                <td className="px-4 py-3 text-slate-500">{c.used_count || 0}{c.max_uses ? ` / ${c.max_uses}` : ''}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.is_active ? 'active' : 'disabled'} />
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openEdit(c)} />
                    <ActionBtn icon={Power} tooltip={c.is_active ? 'Disable' : 'Enable'} color="amber" onClick={() => confirmToggle(c)} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        {!loading && shown.length > 0 && <Pagination {...paged.bind} />}
      </div>

      {modal && <Modal form={form} setForm={setForm} onClose={() => setModal(null)} onSave={save} saving={saving} isEdit={modal !== 'create'} />}
    </div>
  );
}
