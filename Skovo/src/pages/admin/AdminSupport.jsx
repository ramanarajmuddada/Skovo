import React, { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { LifeBuoy, Plus, Pencil, Trash2, Search, CheckCircle, X, SlidersHorizontal, Contact, Building2 } from 'lucide-react';
import CompanyDetails from '../../components/admin/CompanyDetails';
import { adminApi as api } from '../../services/api';
import SupportChatPanel from '../../components/support/IssueChat';
import { Button, Input, FormSelect, DateRange, defaultRange } from '../../components/ui/index.jsx';
import { ConfirmModal } from '../../components/ui/TableComponents';

// "9 Nov, 12:30 pm" in IST; "—" when an old issue has no date.
const when = (iso) => (iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  : '—');
import { useMasters } from '../../hooks/useMasters';

// Fallback only -- live list is the `support_audience` master.
const AUDIENCE_FALLBACK = [
  { value: 'student', label: 'Student' },
  { value: 'achiever', label: 'Achiever' },
  { value: 'public', label: 'Public' },
];
// Fallback only -- live list is the `support_channel` master.
const CHANNEL_FALLBACK = [
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
];
// Fallback only. The live list is the `support_category` master, read through
// useMasters below -- this copy existed in Python AND here, so adding a
// category meant deploying both and forgetting one meant the server accepted a
// value this filter would never offer. Kept so the screen still works if the
// masters call fails.
const CATEGORY_FALLBACK = [
  { value: 'payments', label: 'Payments' },
  { value: 'account', label: 'Account' },
  { value: 'documents', label: 'Documents' },
  { value: 'payouts', label: 'Payouts' },
  { value: 'other', label: 'Other' },
];
const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
];
const STATUS_TABS = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'solved', label: 'Solved' },
  { value: '', label: 'All' },
];
// Fallback only -- live list is the `support_portal` master.
const PORTAL_FALLBACK = [
  { value: 'student', label: 'Student' },
  { value: 'achiever', label: 'Achiever' },
];

const STATUS_PILL = {
  open: 'bg-amber-50 text-amber-700 border-amber-200',
  in_progress: 'bg-blue-50 text-blue-700 border-blue-200',
  solved: 'bg-emerald-50 text-emerald-700 border-emerald-200',
};

function emptyContact() {
  return {
    audience: 'student',
    channel: 'email',
    value: '',
    label: '',
    hours: '',
    sort_order: 0,
    is_active: true,
  };
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-50 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <CheckCircle size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

function Pill({ status }) {
  const cls = STATUS_PILL[status] || STATUS_PILL.open;
  const label = status === 'in_progress' ? 'In progress' : (status || 'open').replace('_', ' ');
  return <span className={`inline-flex px-2 py-0.5 rounded-lg text-[11px] font-bold uppercase tracking-wide border ${cls}`}>{label}</span>;
}

export default function AdminSupport() {
  // ?tab=issues is how a notification opens the Issues tab directly.
  const location = useLocation();
  const wanted = new URLSearchParams(location.search).get('tab') === 'issues' ? 'issues' : null;
  const [tab, setTab] = useState(wanted || 'contacts');
  useEffect(() => { if (wanted) setTab(wanted); }, [wanted, location.key]);
  const [toast, setToast] = useState({ msg: '', ok: true });
  const flash = useCallback((msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast({ msg: '', ok: true }), 3500);
  }, []);

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-5">
      <Toast msg={toast.msg} ok={toast.ok} />
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <LifeBuoy size={20} style={{ color: 'var(--accent)' }} />
            <h1 className="text-2xl font-black text-slate-900">Support</h1>
          </div>
          <p className="text-sm text-slate-500 mt-1">
            Contacts students, achievers and the public page see, issues they raise in the app, and the company details on the legal pages.
          </p>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={[
          { key: 'contacts', label: 'Contacts', icon: Contact },
          { key: 'issues', label: 'Issues', icon: LifeBuoy },
          { key: 'company', label: 'Company', icon: Building2 },
        ]} />
      </div>
      {tab === 'contacts' ? <ContactsTab flash={flash} /> : tab === 'company' ? <CompanyDetails /> : <IssuesTab flash={flash} />}
    </div>
  );
}

function ContactsTab({ flash }) {
  const { lists } = useMasters(['support_audience', 'support_channel'], {
    support_audience: AUDIENCE_FALLBACK,
    support_channel: CHANNEL_FALLBACK,
  });
  const audienceOptions = lists.support_audience?.length ? lists.support_audience : AUDIENCE_FALLBACK;
  const channelOptions = lists.support_channel?.length ? lists.support_channel : CHANNEL_FALLBACK;
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [audience, setAudience] = useState('');
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyContact());
  const [saving, setSaving] = useState(false);
  const [remove, setRemove] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/support/contacts', audience ? { audience } : undefined)
      .then(({ data }) => {
        if (data.bool) setRows(data.response?.contacts || []);
        else { setRows([]); flash(data.response?.message || 'Could not load contacts.', false); }
      })
      .catch(() => { setRows([]); flash('Could not load contacts.', false); })
      .finally(() => setLoading(false));
  }, [audience, flash]);

  useEffect(() => { load(); }, [load]);

  const openNew = () => { setForm(emptyContact()); setEditing('new'); };
  const openEdit = (row) => { setForm({ ...row, hours: row.hours || '' }); setEditing(row.id); };
  const set = (k, v) => setForm((s) => ({ ...s, [k]: v }));

  const save = async () => {
    setSaving(true);
    try {
      const body = {
        audience: form.audience,
        channel: form.channel,
        value: form.value,
        label: form.label,
        hours: form.hours,
        sort_order: Number(form.sort_order) || 0,
        is_active: !!form.is_active,
      };
      const { data } = editing === 'new'
        ? await api.post('/skovo-platform-panel-admin/support/contacts', body)
        : await api.put(`/skovo-platform-panel-admin/support/contacts/${editing}`, body);
      if (data.bool) {
        flash(editing === 'new' ? 'Contact added.' : 'Contact updated.');
        setEditing(null);
        load();
      } else flash(data.response?.message || 'Could not save.', false);
    } catch {
      flash('Could not save.', false);
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!remove) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/support/contacts/${remove.id}`);
      if (data.bool) { flash('Contact removed.'); load(); }
      else flash(data.response?.message || 'Could not remove.', false);
    } catch {
      flash('Could not remove.', false);
    } finally {
      setRemove(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <div className="w-full sm:max-w-xs">
        <FormSelect
          value={audience}
          onChange={setAudience}
          searchType="support_audience" options={[{ value: '', label: 'All audiences' }, ...audienceOptions]}
        />
        </div>
        <Button type="button" onClick={openNew} className="min-h-11 w-full sm:w-auto shrink-0 whitespace-nowrap">
          <Plus size={15} /> Add contact
        </Button>
      </div>

      {editing && (
        <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
          <p className="font-bold text-slate-900">{editing === 'new' ? 'New contact' : 'Edit contact'}</p>
          <div className="grid sm:grid-cols-2 gap-3">
            <FormSelect label="Who sees it" value={form.audience} onChange={(v) => set('audience', v)} searchType="support_audience" options={audienceOptions} />
            <FormSelect label="Channel" value={form.channel} onChange={(v) => set('channel', v)} searchType="support_channel" options={channelOptions} />
            <Input label={form.channel === 'phone' ? 'Phone' : 'Email'} required value={form.value} onChange={(e) => set('value', e.target.value)} />
            <Input label="Label" required value={form.label} onChange={(e) => set('label', e.target.value)} placeholder="Payments, Account…" />
            <Input label="Hours" value={form.hours} onChange={(e) => set('hours', e.target.value)} placeholder="Mon–Sat, 10:00–18:00 IST" />
            <Input label="Sort order" type="number" value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm font-semibold text-slate-600 min-h-11">
            <input type="checkbox" checked={!!form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
            On
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button type="button" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading contacts…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No contacts yet. Add an email or phone.</div>
        ) : (
          <>
          {/* Below md this is a card list, not a scrolling table. Seven columns
              in 286px gave Value a single character of width, so an email
              stacked one letter per line and blew the row height out to a
              screenful. The table survives from md up, where it fits. */}
          <ul className="md:hidden divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id} className="p-4">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-slate-900 text-sm">{r.label}</p>
                    <p className="text-xs text-slate-500 capitalize">
                      {r.audience} · {r.channel} · {r.is_active ? 'On' : 'Off'}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <button type="button" aria-label={`Edit ${r.label}`} onClick={() => openEdit(r)}
                      className="p-2 min-h-11 min-w-11 rounded-lg hover:bg-slate-50 text-slate-500">
                      <Pencil size={14} />
                    </button>
                    <button type="button" aria-label={`Delete ${r.label}`} onClick={() => setRemove(r)}
                      className="p-2 min-h-11 min-w-11 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
                {/* break-words, not break-all: an address breaks at sensible
                    points instead of mid-word. */}
                <p className="mt-2 text-sm text-slate-700 break-words">{r.value}</p>
                {r.hours && <p className="mt-1 text-xs text-slate-500">{r.hours}</p>}
              </li>
            ))}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3">Audience</th>
                  <th className="px-4 py-3">Label</th>
                  <th className="px-4 py-3">Channel</th>
                  <th className="px-4 py-3">Value</th>
                  <th className="px-4 py-3">Hours</th>
                  <th className="px-4 py-3">On</th>
                  <th className="px-4 py-3 w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0">
                    <td className="px-4 py-3 capitalize text-slate-700">{r.audience}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{r.label}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.channel}</td>
                    <td className="px-4 py-3 text-slate-700 break-all">{r.value}</td>
                    <td className="px-4 py-3 text-slate-500">{r.hours || '—'}</td>
                    <td className="px-4 py-3">{r.is_active ? 'Yes' : 'Off'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 justify-end">
                        <button type="button" aria-label={`Edit ${r.label}`} onClick={() => openEdit(r)} className="p-2 min-h-11 min-w-11 rounded-lg hover:bg-slate-50 text-slate-500">
                          <Pencil size={14} />
                        </button>
                        <button type="button" aria-label={`Delete ${r.label}`} onClick={() => setRemove(r)} className="p-2 min-h-11 min-w-11 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-600">
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>
      {remove && (
        <ConfirmModal
          message="Remove this contact?"
          detail={`${remove.label} will disappear from that portal.`}
          confirmLabel="Remove"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setRemove(null)}
        />
      )}
    </div>
  );
}

function IssuesTab({ flash }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [portal, setPortal] = useState('');
  // Defaults to 'open'. A support queue is worked by status, and landing on
  // "all" put solved tickets in the way of the ones still waiting.
  const [status, setStatus] = useState('open');
  const [counts, setCounts] = useState({});
  const [rangeCounts, setRangeCounts] = useState({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  // One batched call for both vocabularies this tab needs.
  const { lists } = useMasters(['support_category', 'support_portal'], {
    support_category: CATEGORY_FALLBACK,
    support_portal: PORTAL_FALLBACK,
  });
  const categoryOptions = [
    { value: '', label: 'All categories' },
    ...(lists.support_category?.length ? lists.support_category : CATEGORY_FALLBACK),
  ];
  const portalOptions = [
    { value: '', label: 'All portals' },
    ...(lists.support_portal?.length ? lists.support_portal : PORTAL_FALLBACK),
  ];
  const [category, setCategory] = useState('');
  // Date raised: only Solved / All look back (last 7 days by default);
  // Open and In progress show every waiting issue, however old.
  const [range, setRange] = useState(defaultRange);
  const looksBack = status === 'solved' || status === '';
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [chatIssue, setChatIssue] = useState(null);
  // A reply updates that issue in place (an open issue moves to In progress).
  const afterReply = () => {
    const id = chatIssue?.id;
    const patch = (i) => (i.id === id ? { ...i, messages: (i.messages || 0) + 1, last_from: 'admin',
      status: i.status === 'open' ? 'in_progress' : i.status } : i);
    setRows((list) => list.map(patch));
    setOpen((o) => (o ? patch(o) : o));
    setChatIssue((c) => (c ? patch(c) : c));
  };

  const load = useCallback(() => {
    setLoading(true);
    const params = { page, per_page: 20 };
    if (portal) params.portal = portal;
    if (status) params.status = status;
    if (category) params.category = category;
    if (q.trim()) params.q = q.trim();
    // Solved / All counts always use the date range (their tabs look back).
    if (range.from) params.count_from = range.from;
    if (range.to) params.count_to = range.to;
    if (looksBack && range.from) params.date_from = range.from;
    if (looksBack && range.to) params.date_to = range.to;
    api.get('/skovo-platform-panel-admin/support/issues', params)
      .then(({ data }) => {
        if (data.bool) {
          setRows(data.response?.issues || []);
          setPages(data.response?.pages || 1);
          setTotal(data.response?.total || 0);
          setCounts(data.response?.status_counts || {});
          setRangeCounts(data.response?.range_counts || {});
        } else {
          setRows([]);
          flash(data.response?.message || 'Could not load issues.', false);
        }
      })
      .catch(() => { setRows([]); flash('Could not load issues.', false); })
      .finally(() => setLoading(false));
  }, [page, portal, status, category, q, flash, looksBack, range.from, range.to]);

  useEffect(() => { load(); }, [load]);

  const setStatusOf = async (issue, next) => {
    setBusy(true);
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/support/issues/${issue.id}/status`, { status: next });
      if (data.bool) {
        flash(next === 'solved' ? 'Marked solved. They will see a notification.' : 'Status updated.');
        load();
        if (open?.id === issue.id) setOpen(data.response.issue);
      } else flash(data.response?.message || 'Could not update.', false);
    } catch {
      flash('Could not update.', false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <SupportChatPanel issue={chatIssue} api={api} base="/skovo-platform-panel-admin/support/issues" role="admin"
                        onClose={() => setChatIssue(null)} onSent={afterReply} />
      {/* Status is the workflow, not a filter: a queue is worked Open -> In
          progress -> Solved, so it gets a segmented control with live counts
          rather than a dropdown defaulting to "all". Portal and category are
          real filters, used occasionally, so they fold behind one button and
          stop costing permanent height -- three stacked selects took 202px of
          a 586px phone before a single issue appeared. */}
      <div className="grid grid-cols-2 sm:flex gap-1 p-1 rounded-xl bg-slate-100" role="tablist" aria-label="Issue status">
        {STATUS_TABS.map((t) => {
          const on = status === t.value;
          // `total` is the count for whatever tab is CURRENTLY selected, so
          // using it for "All" made All read 7 while Open also read 7. Sum the
          // per-status counts instead -- they ignore the status filter, so they
          // stay correct whichever tab is active.
          const allCount = Object.values(counts).reduce(
            (a, b) => (typeof b === 'number' && typeof a === 'number' ? a + b : null), 0);
          // Solved / All follow the date range; Open / In progress are all-time.
          const n = t.value === 'solved' ? (rangeCounts.solved ?? counts.solved)
            : !t.value ? (rangeCounts.all ?? allCount) : counts[t.value];
          return (
            <button
              key={t.value || 'all'} type="button" role="tab" aria-selected={on}
              onClick={() => { setStatus(t.value); setPage(1); }}
              className={`flex-1 min-w-max min-h-11 px-3 rounded-lg text-sm font-semibold whitespace-nowrap transition-colors ${
                on ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.label}
              {typeof n === 'number' && (
                <span className={`ml-1.5 text-xs ${on ? 'text-slate-500' : 'text-slate-400'}`}>{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <div className="flex-1 min-w-0">
          <Input
            icon={<Search size={14} />}
            value={q}
            onChange={(e) => { setQ(e.target.value); setPage(1); }}
            placeholder="Search issues"
          />
        </div>
        {looksBack && (
          <DateRange value={range} anyLabel="Any date" className="hidden sm:block w-56 shrink-0"
                     onChange={(r) => { setRange(r || { from: '', to: '' }); setPage(1); }} />
        )}
        <button type="button" onClick={() => setFiltersOpen((v) => !v)}
          aria-expanded={filtersOpen}
          className="shrink-0 min-h-11 px-3 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 flex items-center gap-1.5">
          <SlidersHorizontal size={14} />
          Filters
          {(portal ? 1 : 0) + (category ? 1 : 0) > 0 && (
            <span className="ml-0.5 px-1.5 rounded-full bg-violet-600 text-white text-[11px] font-bold">
              {(portal ? 1 : 0) + (category ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {filtersOpen && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <FormSelect value={portal} onChange={(v) => { setPortal(v); setPage(1); }} searchType="support_portal" options={portalOptions} />
          <FormSelect value={category} onChange={(v) => { setCategory(v); setPage(1); }} searchType="support_category" options={categoryOptions} />
          {looksBack && (
            <DateRange value={range} anyLabel="Any date" className="sm:hidden"
                       onChange={(r) => { setRange(r || { from: '', to: '' }); setPage(1); }} />
          )}
        </div>
      )}

      <p className="text-xs text-slate-400">{total} issue{total === 1 ? '' : 's'}</p>

      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-sm text-slate-400">Loading issues…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No issues match these filters. Solved rows stay searchable.</div>
        ) : (
          <>
          {/* Same treatment as Contacts. Six columns in 286px left the From
              column about four characters wide, so an address rendered as a
              vertical strip and one row filled the screen. */}
          <ul className="md:hidden divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r)}
                  className="w-full text-left p-4 active:bg-slate-50">
                  <div className="flex items-start gap-2">
                    <p className="min-w-0 flex-1 font-semibold text-slate-900 text-sm break-words">{r.subject}</p>
                    <span className="shrink-0"><Pill status={r.status} /></span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    <span className="capitalize">{r.portal} · {r.category}</span> · {when(r.created_at)}
                    {r.attachments?.length > 0 && <span className="ml-1.5 font-semibold" style={{ color: 'var(--accent)' }}>📎 {r.attachments.length}</span>}
                    {r.messages > 0 && <span className="ml-1.5 text-slate-500">💬 {r.messages}</span>}
                    {r.reopened && <span className="ml-1.5 text-[11px] font-bold text-orange-600">Reopened</span>}
                    {r.closed && <span className="ml-1.5 text-[11px] font-bold text-slate-400">Closed</span>}
                    {r.confirmed && <span className="ml-1.5 text-[11px] font-bold text-emerald-600">Confirmed</span>}
                    {r.last_from === 'user' && r.messages > 0 && r.status !== 'solved' && (
                      <span className="ml-1.5 text-[11px] font-bold text-amber-600">New message</span>
                    )}
                  </p>
                  {r.reference_label && <p className="mt-1 text-xs text-slate-400 break-words">{r.reference_label}</p>}
                  <p className="mt-1 text-xs text-slate-500 break-words">{r.contact_email || '—'}</p>
                </button>
              </li>
            ))}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="px-4 py-3">Subject</th>
                  <th className="px-4 py-3">Portal</th>
                  <th className="px-4 py-3">Category</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">From</th>
                  <th className="px-4 py-3">Date</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.id}
                    className="border-b border-slate-50 last:border-0 cursor-pointer hover:bg-slate-50"
                    onClick={() => setOpen(r)}
                  >
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-900">
                        {r.subject}
                        {r.attachments?.length > 0 && (
                          <span className="ml-2 align-middle text-[11px] font-semibold px-1.5 py-0.5 rounded-md border border-slate-200"
                                style={{ color: 'var(--accent)' }} title="Proof attached">📎 {r.attachments.length}</span>
                        )}
                      </p>
                      {r.reference_label && <p className="text-xs text-slate-400 mt-0.5">{r.reference_label}</p>}
                      {(r.reopened || r.closed || r.confirmed) && (
                        <p className="text-[11px] font-bold mt-0.5">
                          {r.reopened && <span className="text-orange-600 mr-2">Reopened {r.reopen_count}×</span>}
                          {r.closed && <span className="text-slate-400 mr-2">Closed</span>}
                          {r.confirmed && <span className="text-emerald-600">Confirmed by user</span>}
                        </p>
                      )}
                      {r.messages > 0 && (
                        <p className="text-xs text-slate-500 mt-0.5">💬 {r.messages} message{r.messages === 1 ? '' : 's'}
                          {r.last_from === 'user' && r.status !== 'solved' && <span className="ml-1.5 font-bold text-amber-600">New message</span>}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.portal}</td>
                    <td className="px-4 py-3 capitalize text-slate-600">{r.category}</td>
                    <td className="px-4 py-3"><Pill status={r.status} /></td>
                    <td className="px-4 py-3 text-slate-500 break-all">{r.contact_email || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">{when(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </>
        )}
      </div>

      {pages > 1 && (
        <div className="flex gap-2 justify-center">
          <Button variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
          <span className="text-sm text-slate-500 self-center">Page {page} of {pages}</span>
          <Button variant="secondary" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-black/40 p-0 sm:p-6" onClick={() => setOpen(null)}>
          <div
            className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-slate-900">{open.subject}</p>
                <p className="text-xs text-slate-400 mt-1 capitalize">{open.portal} · {open.category} · {open.source}</p>
              </div>
              <Pill status={open.status} />
            </div>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{open.body}</p>
            <p className="text-xs text-slate-400">
              From {open.contact_email || '—'}
              {open.reference_type && !open.reference_label ? ` · ${open.reference_type} ${open.reference_id || ''}` : ''}
            </p>
            {/* Which payment / payout, the UTR they gave, and their proof files. */}
            {(open.reference_label || open.txn_ref || open.attachments?.length > 0) && (
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 space-y-1.5 text-xs">
                {open.reference_label && <p className="font-semibold text-slate-700">{open.reference_label}</p>}
                {open.txn_ref && <p className="text-slate-600">UTR / transaction ID: <b>{open.txn_ref}</b></p>}
                {open.attachments?.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {open.attachments.map((f, k) => (
                      <a key={k} href={f.url} target="_blank" rel="noopener noreferrer"
                         className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white font-semibold"
                         style={{ color: 'var(--accent)' }}>📎 {f.name || `Proof ${k + 1}`}</a>
                    ))}
                  </div>
                )}
              </div>
            )}
            {/* Chat with the person in a side panel: each reply is a notification + email to them. */}
            <button type="button" onClick={() => setChatIssue(open)}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-11 px-4 rounded-xl text-sm font-semibold text-white"
                    style={{ backgroundColor: 'var(--accent)' }}>
              💬 {open.messages ? `Open chat (${open.messages})` : 'Reply in chat'}
              {open.last_from === 'user' && open.messages > 0 && open.status !== 'solved' && (
                <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-white/25">New message</span>
              )}
            </button>
            <div className="flex flex-col sm:flex-row gap-2">
              {open.status === 'open' && (
                <Button type="button" variant="secondary" disabled={busy} onClick={() => setStatusOf(open, 'in_progress')}>In progress</Button>
              )}
              {open.status !== 'solved' && (
                <Button type="button" disabled={busy} onClick={() => setStatusOf(open, 'solved')}>Mark solved</Button>
              )}
              {open.status === 'solved' && (
                <p className="text-xs text-slate-500 self-center">
                  {open.closed ? 'Closed (7 days after solved).' : 'Solved. Only the person can reopen it; ask them in the chat if needed.'}
                  {open.confirmed && ' Confirmed by user.'}
                </p>
              )}
              <Button type="button" variant="ghost" onClick={() => setOpen(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
