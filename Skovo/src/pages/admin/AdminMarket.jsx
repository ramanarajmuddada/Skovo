import React, { useEffect, useState } from 'react';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import { Card, PageHeader, Badge, Toast, EmptyState, Button, Input, Textarea, Modal } from '../../components/ui/index.jsx';
import { ConfirmModal, ActionBtn } from '../../components/ui/TableComponents';
import StatTile from '../../components/admin/StatTile';
import { Search, Radio as LiveIcon } from 'lucide-react';
import { ShoppingBag, Plus, Pencil, Trash2, MousePointerClick, Crown } from 'lucide-react';
import { FormSelect } from '../../components/ui/index.jsx';

const BLANK = {
  title: '', brand: '', description: '', category: '', image_url: '', deal_url: '',
  coupon_code: '', discount_label: '', is_pro_only: false,
  starts_at: '', ends_at: '', is_active: true, sort_order: 0,
};

// CATEGORIES comes from master data (masters.market_category) — see hooks/useMasters.

function DealForm({ initial, onSave, onClose, saving }) {
  const { lists } = useMasters(['market_category']);
  const CATEGORIES = (lists.market_category || []).map(o => o.value);

  const [form, setForm] = useState({ ...BLANK, ...initial });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.checked }));

  return (
    <Modal
      isOpen
      size="lg"
      onClose={onClose}
      title={initial?.id ? 'Edit deal' : 'New deal'}
      footer={
        <div className="flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onSave(form)}
            disabled={saving || !form.title.trim() || !form.deal_url.trim()}
          >
            {saving ? 'Saving…' : 'Save deal'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Input label="Title" required value={form.title} onChange={set('title')}
               placeholder="Notion Pro — free for students" />
        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Brand" value={form.brand} onChange={set('brand')} placeholder="Notion" />
          {/* FormSelect hands back the value, not an event, so this cannot use
              the curried `set()` helper the inputs share. */}
          <FormSelect searchType="market_category"
            label="Category"
            value={form.category}
            onChange={(v) => setForm((f) => ({ ...f, category: v }))}
            options={CATEGORIES.map(c => ({ value: c, label: c }))}
            placeholder="e.g. Productivity" />
        </div>

        <Textarea label="Description" rows={3} value={form.description} onChange={set('description')}
                  placeholder="What the student gets, and any eligibility notes." />

        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Deal URL" required value={form.deal_url} onChange={set('deal_url')}
                 placeholder="https://brand.com/students?ref=skovo" />
          <Input label="Image URL" value={form.image_url} onChange={set('image_url')}
                 placeholder="https://…/banner.png" />
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <Input label="Coupon code" value={form.coupon_code} onChange={set('coupon_code')}
                 placeholder="SKOVO50" />
          <Input label="Discount label" value={form.discount_label} onChange={set('discount_label')}
                 placeholder="50% OFF" />
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          <Input label="Live from" type="date" value={(form.starts_at || '').slice(0, 10)} onChange={set('starts_at')}
                 hint="Empty = runs indefinitely" />
          <Input label="Ends on" type="date" value={(form.ends_at || '').slice(0, 10)} onChange={set('ends_at')}
                 hint="Empty = no end date" />
          <Input label="Sort order" type="number" value={form.sort_order} onChange={set('sort_order')}
                 hint="Higher shows first" />
        </div>

        <div className="flex flex-col gap-2.5 pt-2 border-t border-slate-100">
          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={!!form.is_pro_only} onChange={toggle('is_pro_only')}
                   className="w-4 h-4 rounded accent-purple-600" />
            Skovo Pro members only
          </label>
          <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
            <input type="checkbox" checked={!!form.is_active} onChange={toggle('is_active')}
                   className="w-4 h-4 rounded accent-blue-600" />
            Active (visible to students)
          </label>
        </div>
      </div>
    </Modal>
  );
}

export default function AdminMarket() {
  const [deals, setDeals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [show, setShow] = useState('');        // '' | 'live' | 'pro'
  const [q, setQ] = useState('');
  const [del, setDel] = useState(null);
  const shown = deals.filter((d) => (!show || (show === 'live' ? d.is_active : d.is_pro_only))
    && (!q.trim() || [d.title, d.brand, d.category, d.coupon_code].some((v) => (v || '').toLowerCase().includes(q.trim().toLowerCase()))));
  const pick = (k) => setShow(show === k ? '' : k);

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () =>
    api.get('/skovo-platform-panel-admin/market')
      .then(({ data }) => { if (data.bool) setDeals(data.response.deals || []); })
      .catch(() => setDeals([]))
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, []);

  const handleSave = async (form) => {
    setSaving(true);
    try {
      const { data } = form.id
        ? await api.put(`/skovo-platform-panel-admin/market/${form.id}`, form)
        : await api.post('/skovo-platform-panel-admin/market', form);
      if (data.bool) { flash(data.response.message || 'Saved.'); setEditing(null); load(); }
      else flash(data.response?.message || 'Could not save.', 'error');
    } catch { flash('Could not save the deal.', 'error'); } finally { setSaving(false); }
  };

  const handleDelete = async (deal) => {
    setDel(null);
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/market/${deal.id}`);
      if (data.bool) { flash('Deal deleted.'); load(); }
      else flash(data.response?.message || 'Could not delete.', 'error');
    } catch { flash('Could not delete the deal.', 'error'); }
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Market"
        subtitle="Curated student deals — brand offers, tool discounts and affiliate links"
        action={
          <Button onClick={() => setEditing({ ...BLANK })}>
            <Plus size={15} /> New deal
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : (
        <>
          {/* Tiles double as the filter; clicks is a total. */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <StatTile label="All deals" value={deals.length} icon={ShoppingBag} tone="blue" onClick={() => pick('')} active={!show} />
            <StatTile label="Live" value={deals.filter((d) => d.is_active).length} icon={LiveIcon} tone="emerald" onClick={() => pick('live')} active={show === 'live'} />
            <StatTile label="Pro only" value={deals.filter((d) => d.is_pro_only).length} icon={Crown} tone="violet" onClick={() => pick('pro')} active={show === 'pro'} />
            <StatTile label="Total clicks" value={deals.reduce((a, d) => a + Number(d.clicks || 0), 0)} icon={MousePointerClick} tone="amber" />
          </div>
          <div className="relative mb-4">
            <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" aria-label="Search deals" placeholder="Search deals…"
                   className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </>
      )}
      {loading ? null : shown.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title={deals.length ? 'No deals match' : 'No deals yet'}
          subtitle={deals.length ? 'Try another filter or search.' : 'Add your first student offer to fill the Market'}
          action={<Button onClick={() => setEditing({ ...BLANK })}><Plus size={15} /> New deal</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {shown.map((d) => (
            <Card key={d.id} className={`p-4 flex items-start gap-3 ${d.is_active ? '' : 'opacity-60'}`}>
              <div className="w-12 h-12 rounded-xl bg-slate-100 shrink-0 overflow-hidden flex items-center justify-center">
                {d.image_url
                  ? <img src={d.image_url} alt="" className="w-full h-full object-cover" />
                  : <ShoppingBag size={20} className="text-slate-300" />}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900 break-words">{d.title}</h3>
                  {d.discount_label && <Badge color="emerald" size="xs">{d.discount_label}</Badge>}
                  {d.is_pro_only && (
                    <Badge color="purple" size="xs"><Crown size={10} className="inline mr-0.5" />PRO</Badge>
                  )}
                  {!d.is_active && <Badge color="slate" size="xs">Inactive</Badge>}
                </div>
                <p className="text-xs text-slate-400 mt-1 truncate">
                  {[d.brand, d.category, d.coupon_code].filter(Boolean).join(' · ') || d.deal_url}
                </p>
                {d.ends_at && (
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Ends {new Date(d.ends_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                  </p>
                )}
              </div>

              <div className="flex flex-col items-end gap-2 shrink-0">
                <span className="inline-flex items-center gap-1 text-xs text-slate-400 tabular-nums"><MousePointerClick size={13} /> {d.clicks || 0}</span>
                <div className="flex gap-1">
                  <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => setEditing(d)} />
                  <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setDel(d)} />
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {del && (
        <ConfirmModal danger message={`Delete "${del.title}"?`} detail="Its click history goes too." confirmLabel="Delete"
                      onConfirm={() => handleDelete(del)} onCancel={() => setDel(null)} />
      )}
      {editing && (
        <DealForm initial={editing} saving={saving} onSave={handleSave} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}
