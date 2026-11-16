/**
 * Cities, per state — the list every student-facing city dropdown reads.
 *
 * Not part of the Masters screen even though that screen offers a "City" type:
 * master_city is a flat name/label table with no state column, and nothing
 * student-facing reads it. The onboarding and profile dropdowns are served from
 * the `cities` entity table via /auth/cities?state_id=, which is what this page
 * edits — so a city added here shows up for students immediately.
 *
 * Deactivating rather than deleting is deliberate and mirrors the API: student
 * profiles point at these rows, so a removed city has to keep its id.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { adminApi as api, api as publicApi } from '../../services/api';
import { MapPin, Plus, Pencil, Search, X, Check, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { FormSelect } from '../../components/ui/index.jsx';
import { Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, ConfirmModal, Pagination } from '../../components/ui/TableComponents';
import { usePagedRows } from '../../hooks/usePagedRows';
import StatTile from '../../components/admin/StatTile';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { Eye as EyeIcon, EyeOff, Star } from 'lucide-react';

const TIERS = [
  { value: '', label: 'Not set' },
  { value: '1', label: 'Tier 1 — metro' },
  { value: '2', label: 'Tier 2' },
  { value: '3', label: 'Tier 3' },
];

const EMPTY = { name: '', district: '', tier: '', sort_order: '', is_active: true };

export default function AdminCities() {
  const [states, setStates] = useState([]);
  const [stateId, setStateId] = useState('');
  const [cities, setCities] = useState([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [vis, setVis] = useState('');   // '' | 'on' | 'off', set by the tiles

  const [modal, setModal] = useState(null);      // 'create' | city row | null
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, ok = true) => {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3000);
  };

  // States come from the public masters endpoint — the same list onboarding
  // uses, so the two screens can never disagree about which states exist.
  useEffect(() => {
    publicApi.get('/auth/states')
      .then(({ data }) => {
        if (!data.bool) return;
        const list = data.response.states || [];
        setStates(list);
        setStateId(prev => prev || list[0]?.id || '');
      })
      .catch(() => {});
  }, []);

  const load = (sid = stateId) => {
    if (!sid) return;
    setLoading(true);
    api.get(`/skovo-platform-panel-admin/cities?state_id=${encodeURIComponent(sid)}`)
      .then(({ data }) => setCities(data.bool ? (data.response.cities || []) : []))
      .catch(() => setCities([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(stateId); /* eslint-disable-next-line */ }, [stateId]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cities.filter(c => (!vis || (vis === 'on') === !!c.is_active)
      && (!q || `${c.name} ${c.district || ''}`.toLowerCase().includes(q)));
  }, [cities, query, vis]);

  // AP alone is 126 towns — one page at a time, like every other admin list.
  const paged = usePagedRows(shown);
  const activeCount = cities.filter(c => c.is_active).length;
  const stateName = states.find(s => s.id === stateId)?.name || '';

  const openCreate = () => { setForm(EMPTY); setModal('create'); };
  const openEdit = (c) => {
    setForm({
      name: c.name || '',
      district: c.district || '',
      tier: c.tier != null ? String(c.tier) : '',
      sort_order: c.sort_order != null ? String(c.sort_order) : '',
      is_active: c.is_active !== false,
    });
    setModal(c);
  };

  const save = async () => {
    const name = form.name.trim();
    if (!name) { showToast('City name is required', false); return; }
    setSaving(true);
    try {
      const payload = {
        name,
        district: form.district.trim() || null,
        // '' means "not set" — send null rather than 0, which would read as a
        // real tier and sort the city up with the metros.
        tier: form.tier === '' ? null : Number(form.tier),
        sort_order: form.sort_order === '' ? null : Number(form.sort_order),
        is_active: form.is_active,
      };
      const isEdit = modal && modal !== 'create';
      const { data } = isEdit
        ? await api.put(`/skovo-platform-panel-admin/cities/${modal.id}`, payload)
        : await api.post('/skovo-platform-panel-admin/cities', { ...payload, state_id: stateId });

      if (data.bool) {
        showToast(data.response?.message || (isEdit ? 'City updated' : 'City added'));
        setModal(null);
        load();
      } else {
        showToast(data.response?.message || 'Could not save the city', false);
      }
    } catch {
      showToast('Error saving city', false);
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (c, next) => {
    try {
      const { data } = next
        ? await api.put(`/skovo-platform-panel-admin/cities/${c.id}`, { is_active: true })
        : await api.delete(`/skovo-platform-panel-admin/cities/${c.id}`);
      if (data.bool) { showToast(next ? `"${c.name}" restored` : `"${c.name}" removed`); load(); }
      else showToast(data.response?.message || 'Could not update the city', false);
    } catch {
      showToast('Error updating city', false);
    }
  };

  const sf = (k, v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Cities</h1>
          <p className="text-sm text-slate-500 mt-0.5">The city list students pick from in onboarding and on their profile.</p>
        </div>
        <KitButton onClick={openCreate} disabled={!stateId} className="w-full sm:w-auto"><Plus size={16} /> Add city</KitButton>
      </div>

      {/* Counts are for the picked state; the first three filter the list. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label={stateName ? `In ${stateName}` : 'Cities'} value={cities.length} icon={MapPin} tone="blue" onClick={() => { setVis(''); paged.reset(); }} active={!vis} />
        <StatTile label="Visible" value={activeCount} icon={EyeIcon} tone="emerald" onClick={() => { setVis(vis === 'on' ? '' : 'on'); paged.reset(); }} active={vis === 'on'} />
        <StatTile label="Hidden" value={cities.length - activeCount} icon={EyeOff} tone="amber" onClick={() => { setVis(vis === 'off' ? '' : 'off'); paged.reset(); }} active={vis === 'off'} />
        <StatTile label="Tier 1" value={cities.filter(c => Number(c.tier) === 1).length} icon={Star} tone="violet" sub="metro cities" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-full sm:w-72">
          <FormSelect
            label="State" value={stateId} onChange={v => { setStateId(v); paged.reset(); }}
            options={states.map(s => ({ value: s.id, label: s.name }))}
            placeholder="Pick a state" clearable={false}
          />
        </div>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query} onChange={e => { setQuery(e.target.value); paged.reset(); }}
            placeholder="Filter this state's cities…"
            className="w-full min-h-11 pl-9 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      <TableShell>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>City</Th><Th>Tier</Th><Th>Order</Th><Th>Status</Th><Th>Actions</Th>
            </tr>
          </thead>
          {loading ? (
            <LoadingRows cols={5} rows={5} />
          ) : shown.length === 0 ? (
            <tbody>
              <tr><td colSpan={5}>
                <EmptyState icon={MapPin} message="No cities here yet"
                  sub={query ? 'Nothing matches that filter.' : 'Use "Add City" to create the first one.'} />
              </td></tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {paged.rows.map(c => (
                <tr key={c.id} className={`transition-colors ${c.is_active
                  ? 'hover:bg-slate-50'
                  : 'bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400'}`}>
                  <Td>
                    <p className="font-semibold text-slate-900">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.district || 'No district'}</p>
                  </Td>
                  <Td>{c.tier != null ? `Tier ${c.tier}` : '—'}</Td>
                  <Td num>{c.sort_order ?? 0}</Td>
                  <Td>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {c.is_active ? 'Visible' : 'Hidden'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openEdit(c)} />
                      {c.is_active ? (
                        <ActionBtn icon={Trash2} tooltip="Remove from the list" color="red"
                          onClick={() => setConfirmDlg({
                            message: `Remove "${c.name}"?`,
                            detail: 'Students will stop seeing it. Anyone who already picked it keeps their profile — you can restore it any time.',
                            confirmLabel: 'Remove', danger: true,
                            onConfirm: () => { setConfirmDlg(null); setActive(c, false); },
                          })} />
                      ) : (
                        <ActionBtn icon={RotateCcw} tooltip="Restore" color="amber"
                          onClick={() => setActive(c, true)} />
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
        {!loading && shown.length > 0 && <Pagination {...paged.bind} />}
      </TableShell>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {modal === 'create' ? `Add a city to ${stateName}` : `Edit ${modal.name}`}
              </h2>
              <button onClick={() => setModal(null)} className="text-slate-400 hover:text-slate-600">
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-slate-600">City name <span className="text-red-500">*</span></label>
                <input autoFocus value={form.name} onChange={e => sf('name', e.target.value)}
                  placeholder="e.g. Rajahmundry"
                  className="mt-1 w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-600">District <span className="text-slate-400 font-normal">(optional)</span></label>
                <input value={form.district} onChange={e => sf('district', e.target.value)}
                  placeholder="e.g. East Godavari"
                  className="mt-1 w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormSelect label="Tier" value={form.tier} onChange={v => sf('tier', v)}
                  options={TIERS} clearable={false} />
                <div>
                  <label className="text-xs font-semibold text-slate-600">Sort order</label>
                  <input type="number" value={form.sort_order}
                    onChange={e => sf('sort_order', e.target.value.replace(/[^\d-]/g, ''))}
                    placeholder="0"
                    className="mt-1 w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                </div>
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-700 pt-1">
                <input type="checkbox" checked={form.is_active}
                  onChange={e => sf('is_active', e.target.checked)} />
                Visible to students
              </label>
            </div>

            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModal(null)}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-600 border border-slate-200">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                style={{ backgroundColor: 'var(--accent)' }}>
                {saving ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
                {modal === 'create' ? 'Add City' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDlg && <ConfirmModal {...confirmDlg} onCancel={() => setConfirmDlg(null)} />}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-3 rounded-xl text-sm font-semibold text-white shadow-lg ${
          toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
