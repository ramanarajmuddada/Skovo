/**
 * The course / trade catalogue — the list students pick from in onboarding.
 *
 * Until this screen existed the catalogue could only be changed by a migration,
 * which is the wrong shape for a list that moves: NCVT adds and retires ITI
 * trades every year, and a student whose trade is missing has nothing to pick
 * but "Other".
 *
 * ITI is the level with a formal shape behind it, and the columns map onto the
 * table the search already reads:
 *
 *   Stream   → degree_category   Engineering | Non-Engineering
 *   Category → degree            Electrical, Automobile, Hospitality & Food…
 *   Trade    → branch            Electrician, Welder, COPA…
 *
 * Deactivating rather than deleting mirrors the API: a profile stores the course
 * as text, so a removed trade has to keep its row or the student is left
 * describing a course that no longer exists.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { adminApi as api } from '../../services/api';
import { GraduationCap, Plus, Pencil, Search, RotateCcw, Trash2, Loader2 } from 'lucide-react';
import { FormSelect } from '../../components/ui/index.jsx';
import { Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, ConfirmModal, Pagination } from '../../components/ui/TableComponents';
import { usePagedRows } from '../../hooks/usePagedRows';
import StatTile from '../../components/admin/StatTile';
import { Button as KitButton } from '../../components/ui/index.jsx';
import { Eye as EyeIcon, EyeOff, Layers } from 'lucide-react';

const LEVELS = [
  { value: 'iti',          label: 'ITI — trades' },
  { value: 'diploma',      label: 'Polytechnic / Diploma' },
  { value: 'ug',           label: 'Undergraduate' },
  { value: 'pg',           label: 'Postgraduate' },
  { value: 'professional', label: 'Professional courses' },
  { value: 'phd',          label: 'PhD' },
];

// Only ITI has a fixed two-way split; every other level uses its own categories,
// so the field is a free-text datalist below rather than a locked dropdown.
const ITI_STREAMS = ['Engineering', 'Non-Engineering', 'Other'];

const EMPTY = {
  degree_category: 'Engineering', degree: '', branch: '',
  duration_years: '', eligibility: '', sort_order: '', is_active: true,
};

export default function AdminCourseCatalogue() {
  const [level, setLevel] = useState('iti');
  const [rows, setRows] = useState([]);
  const [meta, setMeta] = useState({ total: 0, active: 0, streams: [], categories: [] });
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');
  const [streamFilter, setStreamFilter] = useState('');

  const [modal, setModal] = useState(null);      // 'create' | row | null
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, ok = true) => {
    setToast({ message, ok });
    setTimeout(() => setToast(null), 3000);
  };

  const load = (lv = level) => {
    setLoading(true);
    api.get(`/skovo-platform-panel-admin/course-catalogue?level=${lv}`)
      .then(({ data }) => {
        if (!data.bool) return;
        setRows(data.response.courses || []);
        setMeta({
          total: data.response.total || 0,
          active: data.response.active || 0,
          streams: data.response.streams || [],
          categories: data.response.categories || [],
        });
      })
      .catch(() => showToast('Could not load the catalogue.', false))
      .finally(() => setLoading(false));
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(level); setStreamFilter(''); }, [level]);

  const isIti = level === 'iti';
  const [vis, setVis] = useState('');   // '' | 'on' | 'off', set by the tiles

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(r => {
      if (streamFilter && r.degree_category !== streamFilter) return false;
      if (vis && (vis === 'on') !== !!r.is_active) return false;
      if (!q) return true;
      return [r.branch, r.degree, r.degree_category, r.eligibility]
        .filter(Boolean).some(v => v.toLowerCase().includes(q));
    });
  }, [rows, query, streamFilter, vis]);
  // Hundreds of courses at UG level: one page at a time.
  const paged = usePagedRows(shown);

  const openCreate = () => {
    setForm({ ...EMPTY, degree_category: isIti ? 'Engineering' : (meta.streams[0] || '') });
    setError('');
    setModal('create');
  };

  const openEdit = (r) => {
    setForm({
      degree_category: r.degree_category || '',
      degree: r.degree || '',
      branch: r.branch || '',
      duration_years: r.duration_years ?? '',
      eligibility: r.eligibility || '',
      sort_order: r.sort_order ?? '',
      is_active: r.is_active,
    });
    setError('');
    setModal(r);
  };

  const save = async () => {
    const branch = form.branch.trim();
    const degree = form.degree.trim();
    if (isIti && !branch) { setError('Give the trade a name.'); return; }
    if (!degree) { setError('Give it a category.'); return; }

    setSaving(true); setError('');
    // '' means "not set" for duration — the column is nullable precisely so a
    // trade whose length varies by curriculum can say so.
    const body = {
      degree_category: form.degree_category.trim(),
      degree,
      branch,
      duration_years: form.duration_years === '' ? null : Number(form.duration_years),
      eligibility: form.eligibility.trim() || null,
      sort_order: form.sort_order === '' ? null : Number(form.sort_order),
      is_active: form.is_active,
    };
    try {
      const { data } = modal === 'create'
        ? await api.post('/skovo-platform-panel-admin/course-catalogue', { level, ...body })
        : await api.put(`/skovo-platform-panel-admin/course-catalogue/${modal.id}`, body);
      if (data.bool) {
        setModal(null);
        showToast(data.response?.message || 'Saved.');
        load();
      } else {
        setError(data.response?.message || 'Could not save.');
      }
    } catch { setError('Could not save.'); }
    finally { setSaving(false); }
  };

  const setActive = async (r, next) => {
    try {
      const { data } = next
        ? await api.put(`/skovo-platform-panel-admin/course-catalogue/${r.id}`, { is_active: true })
        : await api.delete(`/skovo-platform-panel-admin/course-catalogue/${r.id}`);
      if (data.bool) { showToast(data.response?.message || 'Updated.'); load(); }
      else showToast(data.response?.message || 'Could not update.', false);
    } catch { showToast('Could not update.', false); }
  };

  const nameOf = (r) => r.branch || r.degree;
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v }));

  return (
    <div className="p-4 sm:p-6">
      {toast && (
        <div className={`fixed top-5 right-5 z-50 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold text-white
          ${toast.ok ? 'bg-emerald-600' : 'bg-red-600'}`}>{toast.message}</div>
      )}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Course &amp; Trade Catalogue</h1>
          <p className="text-sm text-slate-500 mt-0.5">What students pick from in onboarding. New rows show up for them straight away.</p>
        </div>
        <KitButton onClick={openCreate} className="w-full sm:w-auto"><Plus size={16} /> {isIti ? 'Add trade' : 'Add course'}</KitButton>
      </div>

      {/* Counts are for the picked level; the first three filter the list. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label={isIti ? 'Trades' : 'Courses'} value={meta.total} icon={GraduationCap} tone="blue" onClick={() => setVis('')} active={!vis} />
        <StatTile label="Visible" value={meta.active} icon={EyeIcon} tone="emerald" onClick={() => setVis(vis === 'on' ? '' : 'on')} active={vis === 'on'} />
        <StatTile label="Hidden" value={meta.total - meta.active} icon={EyeOff} tone="amber" onClick={() => setVis(vis === 'off' ? '' : 'off')} active={vis === 'off'} />
        <StatTile label="Streams" value={meta.streams.length} icon={Layers} tone="violet" sub="at this level" />
      </div>

      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="w-full sm:w-60">
          <FormSelect label="Level" value={level} onChange={setLevel}
            options={LEVELS} clearable={false} />
        </div>
        {meta.streams.length > 1 && (
          <div className="w-full sm:w-52">
            <FormSelect label="Stream" value={streamFilter} onChange={setStreamFilter}
              options={meta.streams.map(s => ({ value: s, label: s }))}
              placeholder="All streams" />
          </div>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={query} onChange={e => setQuery(e.target.value)}
            placeholder={isIti ? 'Filter trades…' : 'Filter courses…'}
            className="w-full min-h-11 pl-9 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <TableShell>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>{isIti ? 'Trade' : 'Course'}</Th>
              <Th>Stream</Th><Th>Duration</Th><Th>Eligibility</Th>
              <Th>Status</Th><Th>Actions</Th>
            </tr>
          </thead>
          {loading ? (
            <LoadingRows cols={6} rows={6} />
          ) : shown.length === 0 ? (
            <tbody>
              <tr><td colSpan={6}>
                <EmptyState icon={GraduationCap} message="Nothing here yet"
                  sub={query || streamFilter ? 'Nothing matches that filter.' : 'Add the first one.'} />
              </td></tr>
            </tbody>
          ) : (
            <tbody className="divide-y divide-slate-100">
              {paged.rows.map(r => (
                <tr key={r.id} className={`transition-colors ${r.is_active
                  ? 'hover:bg-slate-50'
                  : 'bg-amber-50/60 hover:bg-amber-50 border-l-2 border-l-amber-400'}`}>
                  <Td>
                    <p className="font-semibold text-slate-900 whitespace-normal min-w-32">{nameOf(r)}</p>
                    {r.degree && <p className="text-xs text-slate-400">{r.degree}</p>}
                  </Td>
                  <Td>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      r.degree_category === 'Engineering' ? 'bg-blue-50 text-blue-700'
                        : r.degree_category === 'Non-Engineering' ? 'bg-purple-50 text-purple-700'
                        : 'bg-slate-100 text-slate-600'}`}>
                      {r.degree_category || '—'}
                    </span>
                  </Td>
                  {/* null duration is not missing data — it is a trade whose
                      length depends on the curriculum, and saying so is more
                      honest than printing a number nobody can rely on. */}
                  <Td>{r.duration_years ? `${r.duration_years} yr` : <span className="text-slate-400">per curriculum</span>}</Td>
                  <Td className="cell-wide text-xs text-slate-500"><span className="line-clamp-2 md:max-w-36 xl:max-w-64">{r.eligibility || '—'}</span></Td>
                  <Td>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      r.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.is_active ? 'Visible' : 'Hidden'}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openEdit(r)} />
                      {r.is_active ? (
                        <ActionBtn icon={Trash2} tooltip="Hide from students" color="red"
                          onClick={() => setConfirmDlg({
                            message: `Hide "${nameOf(r)}"?`,
                            detail: 'Students will stop seeing it in onboarding. Anyone who already picked it keeps their profile — you can restore it any time.',
                            confirmLabel: 'Hide', danger: true,
                            onConfirm: () => { setConfirmDlg(null); setActive(r, false); },
                          })} />
                      ) : (
                        <ActionBtn icon={RotateCcw} tooltip="Restore" color="amber"
                          onClick={() => setActive(r, true)} />
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
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-900">
                {modal === 'create'
                  ? (isIti ? 'Add an ITI trade' : 'Add a course')
                  : `Edit ${nameOf(modal)}`}
              </h2>
            </div>

            <div className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                  {isIti ? 'Trade name' : 'Branch / specialisation'}
                  {isIti && <span className="text-red-400"> *</span>}
                </label>
                <input value={form.branch} onChange={e => set('branch')(e.target.value)}
                  placeholder={isIti ? 'e.g. Electrician' : 'e.g. Computer Science'}
                  className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Stream <span className="text-red-400">*</span>
                  </label>
                  {isIti ? (
                    <FormSelect value={form.degree_category} onChange={set('degree_category')}
                      options={ITI_STREAMS.map(s => ({ value: s, label: s }))} clearable={false} />
                  ) : (
                    <input value={form.degree_category} onChange={e => set('degree_category')(e.target.value)}
                      list="cat-streams" placeholder="e.g. Engineering"
                      className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    Category <span className="text-red-400">*</span>
                  </label>
                  {/* A datalist, not a dropdown: reusing an existing category is
                      one keystroke, and a genuinely new one is still typeable. */}
                  <input value={form.degree} onChange={e => set('degree')(e.target.value)}
                    list="cat-categories" placeholder={isIti ? 'e.g. Electrical' : 'e.g. B.Tech'}
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                  <datalist id="cat-categories">
                    {meta.categories.map(c => <option key={c} value={c} />)}
                  </datalist>
                  <datalist id="cat-streams">
                    {meta.streams.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Duration (years)</label>
                  <input type="number" step="0.5" min="0" max="10"
                    value={form.duration_years} onChange={e => set('duration_years')(e.target.value)}
                    placeholder="Leave empty if it varies"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                  <p className="text-[11px] text-slate-400 mt-1">Empty shows as "per curriculum".</p>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Eligibility</label>
                  <input value={form.eligibility} onChange={e => set('eligibility')(e.target.value)}
                    placeholder="e.g. 10th pass"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Sort order</label>
                  <input type="number" value={form.sort_order} onChange={e => set('sort_order')(e.target.value)}
                    placeholder="Optional"
                    className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none" />
                </div>
                <label className="flex items-center gap-2 pb-3 cursor-pointer">
                  <input type="checkbox" checked={form.is_active}
                    onChange={e => set('is_active')(e.target.checked)} className="w-4 h-4" />
                  <span className="text-sm font-medium text-slate-700">Visible to students</span>
                </label>
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>
              )}
            </div>

            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setModal(null)}
                className="px-4 py-2.5 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={save} disabled={saving}
                className="px-4 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60 flex items-center gap-1.5"
                style={{ backgroundColor: 'var(--accent)' }}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving…</> : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDlg && <ConfirmModal {...confirmDlg} onCancel={() => setConfirmDlg(null)} />}
    </div>
  );
}
