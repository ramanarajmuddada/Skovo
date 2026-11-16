import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { Building2, Search, Plus, Pencil, Ban, RotateCcw, X, Globe, Copy, Check, ExternalLink, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, StatusBadge, ActionBtn, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

const PLAN_BADGE = {
  pro:   'bg-violet-100 text-violet-700 border border-violet-200',
  basic: 'bg-blue-100 text-blue-700 border border-blue-200',
  trial: 'bg-slate-100 text-slate-600 border border-slate-200',
};

const BLANK = { name: '', subdomain: '', contact_email: '', contact_phone: '', address: '', plan: 'trial', logo_url: '' };

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={copy} className="p-1 text-slate-400 hover:text-violet-600 transition-colors" title="Copy">
      {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
    </button>
  );
}

function Modal({ inst, onClose, onSave, saving, error }) {
  const { lists } = useMasters(['institution_plan', 'institution_status']);
  const isEdit = !!inst?.id;
  const [form, setForm] = useState(isEdit ? {
    name: inst.name || '', contact_email: inst.contact_email || '',
    contact_phone: inst.contact_phone || '', address: inst.address || '',
    plan: inst.plan || 'trial', logo_url: inst.logo_url || '', status: inst.status || 'active',
  } : { ...BLANK });

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const field = (label, k, type = 'text', placeholder = '', full = false) => (
    <div className={full ? 'col-span-2' : ''}>
      <label className="block text-xs font-semibold text-slate-600 mb-1.5">{label}</label>
      <input type={type} value={form[k] || ''} onChange={e => set(k, e.target.value)} placeholder={placeholder}
        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 transition-all" />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div>
            <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Institution' : 'New Institution'}</h2>
            {isEdit && <p className="text-xs text-slate-400 mt-0.5">{inst.subdomain}.skovo.in</p>}
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {field('Institution Name *', 'name', 'text', 'e.g. GITAM University', true)}
          {!isEdit && field('Subdomain *', 'subdomain', 'text', 'e.g. gitam')}
          {field('Contact Email', 'contact_email', 'email', 'admin@gitam.edu')}
          {field('Contact Phone', 'contact_phone', 'tel', '+91 98765 43210')}
          {field('Logo URL', 'logo_url', 'url', 'https://...', true)}
          {field('Address', 'address', 'text', 'City, State', true)}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1.5">Plan</label>
            <FormSelect searchType="institution_plan"
              value={form.plan}
              onChange={v => set('plan', v)}
              options={lists.institution_plan || []}
              clearable={false}
              className="w-full" />
          </div>
          {isEdit && (
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1.5">Status</label>
              <FormSelect searchType="institution_status"
                value={form.status}
                onChange={v => set('status', v)}
                options={lists.institution_status || []}
                clearable={false}
                className="w-full" />
            </div>
          )}
          {error && (
            <div className="col-span-2 px-4 py-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600">{error}</div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSave(form)} disabled={saving}
            className="px-5 py-2.5 text-sm font-semibold bg-violet-600 text-white rounded-xl hover:bg-violet-700 disabled:opacity-50">
            {saving ? 'Saving...' : isEdit ? 'Update' : 'Create Institution'}
          </button>
        </div>
      </div>
    </div>
  );
}

function InstDetailModal({ inst, onClose }) {
  const rows = [
    { label: 'Subdomain', value: inst.subdomain ? `${inst.subdomain}.skovo.in` : '—' },
    { label: 'Contact Email', value: inst.contact_email },
    { label: 'Status', value: <StatusBadge status={inst.status || 'active'} /> },
    { label: 'Users', value: inst.total_users },
    { label: 'Cohorts', value: inst.total_cohorts },
    { label: 'Created', value: inst.created_at ? new Date(inst.created_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Institution Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-lg font-black text-slate-900">{inst.name}</p>
          <div className="space-y-2">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-start justify-between gap-4 py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium shrink-0 w-28">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function SuperInstitutions() {
  const navigate = useNavigate();
  const [list, setList]             = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [loading, setLoading]       = useState(true);
  const [modal, setModal]           = useState(null);   // null | 'create' | inst object
  const [saving, setSaving]         = useState(false);
  const [modalError, setModalError] = useState('');
  const [toast, setToast]           = useState(null);
  const [viewInst, setViewInst]     = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q) params.search = q;
    superApi.get('/skovo-platform-owner/institutions', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setList(data.response.institutions); setPagination(data.pagination); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search); };

  const handleSave = async (form) => {
    setSaving(true); setModalError('');
    try {
      const isEdit = modal?.id;
      const res = isEdit
        ? await superApi.patch(`/skovo-platform-owner/institutions/${modal.id}`, form)
        : await superApi.post('/skovo-platform-owner/institutions', form);
      if (!res.data.bool) { setModalError(res.data.response?.message || 'Something went wrong.'); return; }
      showToast(isEdit ? 'Institution updated!' : 'Institution created!');
      setModal(null);
      load(pagination.page);
    } catch { setModalError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleSuspend = (inst) => {
    setConfirmDlg({
      message: `Suspend "${inst.name}"?`,
      detail: 'All users of this institution will lose access until it is reactivated.',
      confirmLabel: 'Suspend',
      danger: true,
      onConfirm: async () => {
        const { data } = await superApi.delete(`/skovo-platform-owner/institutions/${inst.id}`);
        if (data.bool) { showToast('Institution suspended'); load(pagination.page); }
        else showToast('Failed', false);
      },
    });
  };

  const handleActivate = async (inst) => {
    const { data } = await superApi.patch(`/skovo-platform-owner/institutions/${inst.id}`, { status: 'active' });
    if (data.bool) { showToast('Institution activated'); load(pagination.page); }
    else showToast('Failed', false);
  };

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {viewInst && <InstDetailModal inst={viewInst} onClose={() => setViewInst(null)} />}

      {modal !== null && (
        <Modal
          inst={modal === 'create' ? null : modal}
          onClose={() => { setModal(null); setModalError(''); }}
          onSave={handleSave}
          saving={saving}
          error={modalError}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Institutions</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} institutions on the platform</p>
        </div>
        <button onClick={() => { setModal('create'); setModalError(''); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-xl shadow-lg shadow-violet-200 transition-all">
          <Plus size={16} /> New Institution
        </button>
      </div>

      {/* Search */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-5">
        <div className="relative flex-1 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by name or subdomain…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white" />
        </div>
        <button type="submit" className="px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700">Search</button>
      </form>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th><Th>Institution</Th><Th>Subdomain</Th><Th>Plan</Th><Th>Status</Th><Th>Users</Th><Th>Created</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={8} rows={6} />
            </table>
          </div>
        ) : list.length === 0 ? (
          <EmptyState icon={Building2} message={search ? 'No results found' : 'No institutions yet'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Institution</Th>
                  <Th>Subdomain</Th>
                  <Th>Plan</Th>
                  <Th>Status</Th>
                  <Th>Users</Th>
                  <Th>Created</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {list.map((inst, idx) => (
                  <tr key={inst.id} className="hover:bg-slate-50 transition-colors group">
                    <Td><span className="text-xs text-slate-400 font-medium">{(pagination.page - 1) * perPage + idx + 1}</span></Td>

                    {/* Name */}
                    <Td>
                      <div className="flex items-center gap-3">
                        <Avatar name={inst.name} size="md" />
                        <div>
                          <p className="font-semibold text-slate-900">{inst.name}</p>
                          <p className="text-xs text-slate-400">{inst.contact_email || '--'}</p>
                        </div>
                      </div>
                    </Td>

                    {/* Subdomain */}
                    <Td>
                      <div className="flex items-center gap-1">
                        <Globe size={12} className="text-slate-400 shrink-0" />
                        <span className="text-xs text-slate-600 font-mono">{inst.subdomain}.skovo.in</span>
                        <CopyBtn text={`https://${inst.subdomain}.skovo.in`} />
                        <a href={`https://${inst.subdomain}.skovo.in`} target="_blank" rel="noreferrer"
                          className="p-1 text-slate-300 hover:text-violet-500 transition-colors">
                          <ExternalLink size={11} />
                        </a>
                      </div>
                    </Td>

                    {/* Plan */}
                    <Td>
                      <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${PLAN_BADGE[inst.plan] || PLAN_BADGE.trial}`}>
                        {(inst.plan || 'trial').charAt(0).toUpperCase() + (inst.plan || 'trial').slice(1)}
                      </span>
                    </Td>

                    {/* Status */}
                    <Td><StatusBadge status={inst.status || 'active'} /></Td>

                    {/* Users */}
                    <Td>
                      <p className="font-semibold text-slate-900">{inst.total_users}</p>
                      <p className="text-xs text-slate-400">{inst.total_cohorts} cohorts</p>
                    </Td>

                    {/* Created */}
                    <Td>
                      <span className="text-xs text-slate-400 whitespace-nowrap">
                        {inst.created_at ? new Date(inst.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                      </span>
                    </Td>

                    {/* Actions */}
                    <Td>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setViewInst(inst)} />
                        <ActionBtn
                          icon={Pencil}
                          tooltip="Edit institution"
                          onClick={() => { setModal(inst); setModalError(''); }}
                          color="blue"
                        />
                        {inst.status !== 'suspended' ? (
                          <ActionBtn
                            icon={Ban}
                            tooltip="Suspend institution"
                            onClick={() => handleSuspend(inst)}
                            color="red"
                          />
                        ) : (
                          <ActionBtn
                            icon={RotateCcw}
                            tooltip="Activate institution"
                            onClick={() => handleActivate(inst)}
                            color="green"
                          />
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          perPage={perPage}
          onPage={p => load(p)}
          onPerPage={pp => { setPerPage(pp); load(1, search, pp); }}
        />
      </TableShell>
    </div>
  );
}
