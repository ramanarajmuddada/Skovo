/**
 * Shared building blocks for the Version 1 admin screens (feature-updates.md).
 *
 *   <SettingsCard>  loads a settings object, edits it with a field list, saves it
 *   <CrudTable>     lists rows from an endpoint, adds / edits / deletes them
 *
 * Both are driven by a `fields` list, so each admin screen is configuration:
 *   { key, label, type: 'bool' | 'int' | 'number' | 'text' | 'textarea' | 'select' | 'date' | 'json',
 *     options: [{value, label}], hint, min, max, required, readOnlyOnEdit }
 *
 * Every switch in V1 starts OFF and every reward at 0 — these components only
 * ever show what the server holds, never a default of their own.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { adminApi } from '../../../services/api';
import { Modal, useToast } from '../../ui/index.jsx';
import { Save, Plus, Pencil, Trash2, RefreshCw, Settings2, ChevronDown } from 'lucide-react';
import { Pagination, ConfirmModal } from '../../ui/TableComponents';
import FormSelect from '../../ui/FormSelect';
import FormMultiSelect from '../../ui/FormMultiSelect';

const inputCls = 'w-full px-3 py-2 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500';

function msgOf(data, fallback) {
  return data?.response?.message || fallback;
}

export function FieldInput({ field, value, onChange, disabled }) {
  const { type = 'text', options = [], min, max } = field;
  if (type === 'bool') {
    return (
      <button type="button" disabled={disabled} onClick={() => onChange(!value)}
              className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition ${value ? 'bg-emerald-500' : 'bg-slate-300'} ${disabled ? 'opacity-50' : ''}`}
              aria-pressed={!!value} aria-label={field.label}>
        <span className={`inline-block h-5 w-5 transform rounded-full shadow transition ${value ? 'translate-x-5' : 'translate-x-0.5'}`}
              style={{ backgroundColor: '#fff' }} />
      </button>
    );
  }
  // Searchable everywhere (FormSelect / FormMultiSelect), options from a master.
  if (type === 'select') {
    return (
      <FormSelect value={value ?? ''} disabled={disabled} options={options}
                  placeholder={field.placeholder || 'Any'} onChange={(v) => onChange(v || '')} />
    );
  }
  // Stored as a comma list (what the segment_* columns hold); edited as chips.
  if (type === 'multiselect') {
    const picked = String(value ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    return (
      <FormMultiSelect values={picked} disabled={disabled} options={options}
                       placeholder={field.placeholder || 'Any'} onChange={(v) => onChange(v.join(','))} />
    );
  }
  if (type === 'textarea' || type === 'json') {
    const shown = type === 'json' && value && typeof value !== 'string' ? JSON.stringify(value, null, 2) : (value ?? '');
    return <textarea className={`${inputCls} font-mono`} rows={type === 'json' ? 5 : 3} value={shown} disabled={disabled}
                     aria-label={field.label}
                     onChange={(e) => onChange(e.target.value)} />;
  }
  return (
    // Named for screen readers: every settings box here announced as just
    // "edit text" / "spin button", with nothing to say which setting it was.
    <input className={inputCls} disabled={disabled} aria-label={field.label}
           type={type === 'int' || type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
           step={type === 'number' ? 'any' : undefined} min={min} max={max}
           value={value ?? ''} onChange={(e) => onChange(e.target.value)} />
  );
}

function coerce(field, v) {
  if (v === '' || v === undefined) return field.type === 'bool' ? false : null;
  if (field.type === 'int') return parseInt(v, 10);
  if (field.type === 'number') return parseFloat(v);
  if (field.type === 'json' && typeof v === 'string') {
    try { return JSON.parse(v); } catch { return v; }
  }
  return v;
}

/* ── SettingsCard ─────────────────────────────────────────────────────────── */

/** Current value of a setting as a short chip ("On", "12", "—"). */
function settingText(f, v) {
  if (f.type === 'bool') return v ? 'On' : 'Off';
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length ? `${v.length} picked` : '—';
  return String(v);
}

// compact: for screens where the list below is the real work. The card
// collapses to one row of current values; Edit opens the full form.
export function SettingsCard({ title, description, endpoint, fields, responseKey = 'settings', onSaved, compact = false }) {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(!compact);

  const load = useCallback(() => {
    adminApi.get(endpoint).then(({ data }) => {
      if (data?.bool) setForm(responseKey ? data.response[responseKey] : data.response);
    }).catch(() => toast.error('Could not load settings.'));
  }, [endpoint, responseKey, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      fields.forEach((f) => { if (form && f.key in form) body[f.key] = coerce(f, form[f.key]); });
      const { data } = await adminApi.put(endpoint, body);
      if (data?.bool) {
        toast.success('Saved.');
        if (responseKey && data.response[responseKey]) setForm(data.response[responseKey]);
        onSaved && onSaved(data.response);
        if (compact) setOpen(false);
      } else toast.error(msgOf(data, 'Could not save.'));
    } catch { toast.error('Could not save.'); }
    setSaving(false);
  };

  if (compact && !open) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          <span className="shrink-0 w-9 h-9 rounded-xl bg-slate-100 flex items-center justify-center text-slate-500"><Settings2 size={17} /></span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-800">{title}</p>
            {!form ? <p className="text-xs text-slate-400 mt-0.5">Loading…</p> : (
              <div className="mt-1 flex flex-wrap gap-1.5">
                {fields.map((f) => (
                  <span key={f.key} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 text-[11px] text-slate-500">
                    {f.short || f.label}
                    <b className={`font-semibold ${f.type === 'bool' && !form[f.key] ? 'text-slate-400' : 'text-slate-800'}`}>{settingText(f, form[f.key])}</b>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
        <button onClick={() => setOpen(true)} disabled={!form}
                className="shrink-0 inline-flex items-center justify-center gap-1.5 min-h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
          <Pencil size={14} /> Edit
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
        </div>
        {compact
          ? <button onClick={() => { load(); setOpen(false); }} className="p-2 -m-2 text-slate-400 hover:text-slate-600" aria-label="Close"><ChevronDown size={18} className="rotate-180" /></button>
          : <button onClick={load} className="p-2 -m-2 text-slate-400 hover:text-slate-600" aria-label="Reload"><RefreshCw size={16} /></button>}
      </div>
      {!form ? <p className="text-sm text-slate-400">Loading…</p> : (
        <div className="grid sm:grid-cols-2 gap-4">
          {fields.map((f) => (
            <div key={f.key} className={f.type === 'bool' ? 'flex items-center justify-between gap-3 sm:col-span-2 border-b border-slate-100 pb-2' : 'space-y-1'}>
              <div>
                <label className="block text-sm font-semibold text-slate-700">{f.label}</label>
                {f.hint && <p className="text-[11px] text-slate-400">{f.hint}</p>}
              </div>
              <FieldInput field={f} value={form[f.key]} onChange={(v) => setForm((p) => ({ ...p, [f.key]: v }))} />
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {compact && (
          <button onClick={() => { load(); setOpen(false); }} disabled={saving}
                  className="min-h-10 px-4 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">Cancel</button>
        )}
        <button onClick={save} disabled={!form || saving}
                className="inline-flex items-center gap-2 min-h-10 px-4 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">
          <Save size={15} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

/* ── CrudTable ────────────────────────────────────────────────────────────── */

export function CrudTable({
  title, description, listEndpoint, listKey = 'items', idKey = 'id', columns, fields,
  serverPaged = false,
  createEndpoint, updateEndpoint, deleteEndpoint, newDefaults = {}, keyField, extraActions, canCreate = true,
}) {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  // serverPaged: the endpoint takes page/per_page and returns `total`, so only
  // one page is ever fetched — the list stays fast however many rows exist.
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [confirmRow, setConfirmRow] = useState(null);   // row waiting on "Delete?"
  const [total, setTotal] = useState(0);
  const url = serverPaged
    ? `${listEndpoint}${listEndpoint.includes('?') ? '&' : '?'}page=${page}&per_page=${perPage}`
    : listEndpoint;
  const [loading, setLoading] = useState(true);
  const [edit, setEdit] = useState(null);       // {row, isNew}
  const [saving, setSaving] = useState(false);

  // `loading` starts true and only ever flips to false here: a reload keeps
  // the old rows on screen until the new ones arrive.
  const load = useCallback(() => {
    adminApi.get(url).then(({ data }) => {
      if (data?.bool) {
        setRows(data.response[listKey] || []);
        if (serverPaged) setTotal(Number(data.response.total) || 0);
      }
    }).catch(() => toast.error('Could not load.')).finally(() => setLoading(false));
  }, [url, serverPaged, listKey, toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true);
    try {
      const body = {};
      fields.forEach((f) => {
        if (edit.row[f.key] !== undefined) body[f.key] = coerce(f, edit.row[f.key]);
      });
      if (edit.isNew && keyField) body[keyField] = edit.row[keyField];
      const { data } = edit.isNew
        ? await adminApi.post(createEndpoint || listEndpoint, body)
        : await adminApi.put(updateEndpoint(edit.row[idKey], edit.row), body);
      if (data?.bool) { toast.success('Saved.'); setEdit(null); load(); }
      else toast.error(msgOf(data, 'Could not save.'));
    } catch { toast.error('Could not save.'); }
    setSaving(false);
  };

  // The app's own dialog, not window.confirm — a bare browser box on desktop
  // and a cramped system sheet on a phone.
  const remove = (row) => setConfirmRow(row);
  const doRemove = async (row) => {
    setConfirmRow(null);
    const { data } = await adminApi.delete(deleteEndpoint(row[idKey], row));
    if (data?.bool) { toast.success('Deleted.'); load(); } else toast.error(msgOf(data, 'Could not delete.'));
  };

  const cellOf = (c, r) => (c.render ? c.render(r) : (typeof r[c.key] === 'boolean' || c.bool)
    ? (r[c.key] ? <span className="text-emerald-600 font-semibold">On</span> : <span className="text-slate-400">Off</span>)
    : String(r[c.key] ?? '—'));

  const formFields = edit?.isNew && keyField ? [{ key: keyField, label: keyField, type: 'text', required: true }, ...fields] : fields;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
      {confirmRow && (
        <ConfirmModal
          danger
          message={`Delete "${confirmRow.label || confirmRow.name || confirmRow.title || 'this'}" permanently?`}
          detail="It is removed from the database and cannot be undone."
          confirmLabel="Delete"
          onConfirm={() => doRemove(confirmRow)}
          onCancel={() => setConfirmRow(null)}
        />
      )}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          {description && <p className="text-xs text-slate-500 mt-1">{description}</p>}
        </div>
        {canCreate && (
          <button onClick={() => setEdit({ row: { ...newDefaults }, isNew: true })}
                  className="inline-flex items-center gap-1.5 px-4 min-h-11 shrink-0 rounded-xl text-white text-xs font-semibold"
                  style={{ backgroundColor: 'var(--accent)' }}>
            <Plus size={14} /> Add
          </button>
        )}
      </div>
      {/* Phones: a wide table only fits by scrolling sideways, so each row
          becomes a card of "label: value" lines with its actions underneath. */}
      <div className="md:hidden space-y-2">
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-400">Nothing yet.</p>
        ) : rows.map((r) => (
          <div key={r[idKey]} className="border border-slate-100 rounded-xl p-3 text-sm">
            {/* First column is the card's title, with edit / delete beside it;
                empty values are left out, so a card is as tall as what it says. */}
            <div className="flex items-start gap-2">
              <p className="flex-1 min-w-0 font-semibold text-slate-900 break-words pt-2">{cellOf(columns[0], r)}</p>
              {(updateEndpoint || deleteEndpoint) && (
                <div className="flex shrink-0 -mr-1">
                  {updateEndpoint && (
                    <button onClick={() => setEdit({ row: { ...r }, isNew: false })} className="p-2.5 text-slate-500 hover:text-blue-600" aria-label="Edit"><Pencil size={16} /></button>
                  )}
                  {deleteEndpoint && (
                    <button onClick={() => remove(r)} className="p-2.5 text-slate-500 hover:text-red-600" aria-label="Delete"><Trash2 size={16} /></button>
                  )}
                </div>
              )}
            </div>
            <dl className="mt-1 space-y-0.5">
              {columns.slice(1).filter((c) => {
                const v = c.render || typeof r[c.key] === 'boolean' || c.bool ? 'x' : r[c.key];
                return v !== null && v !== undefined && v !== '';
              }).map((c) => (
                <div key={c.key} className="flex gap-3">
                  <dt className="w-28 shrink-0 text-xs text-slate-500 pt-0.5">{c.label}</dt>
                  <dd className="flex-1 min-w-0 break-words text-slate-700">{cellOf(c, r)}</dd>
                </div>
              ))}
            </dl>
            {(() => {
              const extra = extraActions && extraActions(r, load);
              return extra ? <div className="flex justify-end mt-1">{extra}</div> : null;
            })()}
          </div>
        ))}
      </div>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              {columns.map((c) => <th key={c.key} className="py-2 pr-3 font-semibold">{c.label}</th>)}
              <th className="py-2 w-24" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={columns.length + 1} className="py-6 text-center text-slate-400">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={columns.length + 1} className="py-6 text-center text-slate-400">Nothing yet.</td></tr>
            ) : rows.map((r) => (
              <tr key={r[idKey]} className="border-b border-slate-50">
                {columns.map((c) => (
                  <td key={c.key} className="py-2 pr-3 text-slate-700">
                    {cellOf(c, r)}
                  </td>
                ))}
                <td className="py-2 text-right whitespace-nowrap">
                  {extraActions && extraActions(r, load)}
                  {updateEndpoint && (
                    <button onClick={() => setEdit({ row: { ...r }, isNew: false })} className="p-1.5 text-slate-500 hover:text-blue-600" aria-label="Edit"><Pencil size={14} /></button>
                  )}
                  {deleteEndpoint && (
                    <button onClick={() => remove(r)} className="p-1.5 text-slate-500 hover:text-red-600" aria-label="Delete"><Trash2 size={14} /></button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {serverPaged && total > 0 && (
        // Bleeds to the card edges so it reads as the card's footer, not a box inside it.
        <div className="-mx-4 sm:-mx-5 -mb-4 sm:-mb-5 overflow-hidden rounded-b-2xl">
          <Pagination page={page} pages={Math.max(1, Math.ceil(total / perPage))} total={total} perPage={perPage}
                      onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} />
        </div>
      )}
      <Modal isOpen={!!edit} onClose={() => setEdit(null)} title={edit?.isNew ? `Add — ${title}` : `Edit — ${title}`}
             footer={<div className="flex justify-end gap-2">
               <button onClick={() => setEdit(null)} className="px-4 py-2 rounded-xl border text-sm">Cancel</button>
               <button onClick={save} disabled={saving} className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button>
             </div>}>
        {edit && (
          <div className="space-y-3">
            {formFields.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="block text-sm font-semibold text-slate-700">{f.label}{f.required && <span className="text-red-500"> *</span>}</label>
                {f.hint && <p className="text-[11px] text-slate-400">{f.hint}</p>}
                <FieldInput field={f} value={edit.row[f.key]} disabled={!edit.isNew && f.readOnlyOnEdit}
                            onChange={(v) => setEdit((p) => ({ ...p, row: { ...p.row, [f.key]: v } }))} />
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}

export function PageShell({ title, subtitle, children }) {
  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div>
        <h1 className="text-2xl font-black text-slate-900">{title}</h1>
        {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

/* Section tabs for every admin screen: an icon over a short label.
   Phones get a grid so every tab is visible at 320px (2 across for 2 or 4
   tabs, else 3); from sm up, one row with the icon beside the label.
   tabs: [{ key, label, icon?, count? }] */
export function Tabs({ tabs, active, onChange, className = '' }) {
  // 7–8 tabs go 4 across so no tab is left alone on the last row.
  const cols = tabs.length === 2 || tabs.length === 4 ? 'grid-cols-2' : tabs.length >= 7 ? 'grid-cols-4' : 'grid-cols-3';
  return (
    <div role="tablist" className={`grid ${cols} sm:flex sm:flex-wrap gap-1 p-1 rounded-2xl bg-slate-100 ${className}`}>
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = active === t.key;
        return (
          <button key={t.key} type="button" role="tab" aria-selected={on} onClick={() => onChange(t.key)}
                  className={`min-h-12 px-2 sm:px-3 rounded-xl flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5
                              text-[11px] sm:text-sm font-semibold text-center leading-tight transition-colors
                              ${on ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500 hover:text-slate-700'}`}>
            {Icon && <Icon size={16} className="shrink-0" />}
            <span>{t.label}{t.count ? ` (${t.count})` : ''}</span>
          </button>
        );
      })}
    </div>
  );
}
