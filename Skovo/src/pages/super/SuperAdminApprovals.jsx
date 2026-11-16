import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ShieldCheck, Clock, AlertTriangle, Search, CheckCircle2, UserX, Info, Eye,
  Mail, Calendar, History,
} from 'lucide-react';
import { superApi } from '../../services/api';
import {
  Card, Button, PageHeader, StatCard, Modal, Textarea, Skeleton,
  EmptyState, useToast,
} from '../../components/ui/index.jsx';
import FormSelect from '../../components/ui/FormSelect';
import { ErrorState } from '../../components/ui/Overlays.jsx';
import {
  Th, Td, ResponsiveTable, RowCard, StatusBadge,
} from '../../components/ui/TableComponents.jsx';

/**
 * Approve, reject or suspend admin accounts.
 *
 * There is no "create admin" button, and there should never be one. Everyone
 * registers themselves; approval is the only action anyone takes on another
 * person's account. A create button would quietly reintroduce the invitation
 * flow this design deliberately removed.
 *
 * Only a super-admin reaches this screen, and nobody can act on their own
 * account — the server refuses that too.
 */

const STATE_TONE = { pending: 'warning', active: 'success', suspended: 'danger' };

const FILTERS = [
  { value: '',          label: 'All admins' },
  { value: 'pending',   label: 'Awaiting approval' },
  { value: 'active',    label: 'Active' },
  { value: 'suspended', label: 'Suspended' },
];

const ACTIONS = {
  approve: { title: 'Approve this admin',  cta: 'Approve', variant: 'primary',
             hint: 'They get the full admin console immediately.' },
  reject:  { title: 'Send back to pending', cta: 'Send back', variant: 'outline',
             hint: 'They keep the account but lose access until approved.' },
  suspend: { title: 'Suspend this admin',  cta: 'Suspend', variant: 'danger',
             hint: 'They can sign in and see the reason, nothing else.' },
};

const fmtDate = iso => iso
  ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';

const fmtWhen = iso => iso
  ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric',
                                            hour: 'numeric', minute: '2-digit' })
  : '—';

/**
 * Everything known about one admin account, opened from the row.
 *
 * This screen previously showed a name, an email and a date, which is thin
 * grounds for handing someone the platform. What actually changes a decision
 * is the history: an account suspended once before and restored is not the
 * same as one nobody has ever had to act on, and a count alone cannot say
 * which. So the events load with their reasons and the person who wrote them.
 *
 * Loaded on open rather than with the list — most rows are never opened, and
 * the queue should not pay for history nobody reads.
 */
function AdminDetail({ admin, onClose, onAct }) {
  const [events, setEvents] = useState(null);   // null = loading
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    superApi.get(`/skovo-platform-owner/admins/${admin.admin_id}/history`)
      .then(({ data }) => {
        if (!alive) return;
        if (data?.bool) setEvents(data.response.events || []);
        else setFailed(true);
      })
      .catch(() => { if (alive) setFailed(true); })
      .finally(() => { if (alive && !events) setEvents(e => e ?? []); });
    return () => { alive = false; };
  }, [admin.admin_id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const rows = [
    { Icon: Mail,     label: 'Email',       value: admin.email },
    // No Role row. `admin_role` was removed on 2026-08-30 — it was never written
    // to the JWT, so it enforced nothing and the column went with the system.
    // This rendered "admin" for every account, in a dialog whose whole purpose
    // is deciding what somebody may do: a field that always says the same thing
    // reads as a considered answer rather than as an absent one.
    { Icon: Calendar, label: 'Registered',  value: fmtDate(admin.registered_at) },
    ...(admin.decided_at
      ? [{ Icon: History, label: 'Last decision', value: fmtWhen(admin.decided_at) }]
      : []),
  ];

  return (
    <Modal isOpen onClose={onClose} title={admin.full_name}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={admin.state} tone={STATE_TONE[admin.state]} />
          {admin.state_reason && (
            <span className="text-xs text-slate-500 italic">{admin.state_reason}</span>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3 px-3 py-2.5">
              <r.Icon size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 w-28 shrink-0">{r.label}</span>
              <span className="text-sm text-slate-800 truncate">{r.value}</span>
            </div>
          ))}
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Access history
          </p>
          {events === null ? (
            <Skeleton className="h-16 w-full" />
          ) : failed ? (
            <p className="text-sm text-slate-500">Could not load the history.</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-slate-500">
              Nothing yet — this account has never been approved, suspended or restored.
            </p>
          ) : (
            <ul className="space-y-2">
              {events.map(e => (
                <li key={e.id} className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-semibold text-slate-800 capitalize">
                      {e.from_state} &rarr; {e.to_state}
                    </span>
                    <span className="text-xs text-slate-400 ml-auto">{fmtWhen(e.at)}</span>
                  </div>
                  {e.reason && <p className="text-xs text-slate-600 mt-1">{e.reason}</p>}
                  <p className="text-[11px] text-slate-400 mt-1">
                    by {e.actor_name || e.actor_role || 'unknown'}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose}>Close</Button>
          {admin.state === 'pending' && (
            <Button variant="primary" onClick={() => onAct(admin, 'approve')}>Approve</Button>
          )}
          {admin.state === 'active' && (
            <Button variant="outline" onClick={() => onAct(admin, 'suspend')}>Suspend</Button>
          )}
          {admin.state === 'suspended' && (
            <Button variant="primary" onClick={() => onAct(admin, 'approve')}>Restore</Button>
          )}
        </div>
      </div>
    </Modal>
  );
}

export default function SuperAdminApprovals() {
  const toast = useToast();

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  const [filter, setFilter] = useState('pending');
  const [search, setSearch] = useState('');

  const [target, setTarget] = useState(null);   // { admin, action }
  const [detail, setDetail] = useState(null);   // admin being viewed
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data } = await superApi.get('/skovo-platform-owner/admins/queue');
      if (data?.bool) setRows(data.response.items || []); else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const act = async () => {
    if (!target || !reason.trim()) return;
    setBusy(true);
    try {
      const { data } = await superApi.post(
        `/skovo-platform-owner/admins/${target.admin.admin_id}/state`,
        { decision: target.action, reason: reason.trim() });
      if (data?.bool) {
        toast?.success?.(data.response.message);
        // `detail` too, not just the confirm dialog. Approving from inside the
        // detail modal left it open behind, still showing the old state and
        // still offering the button that had just been used.
        setTarget(null); setReason(''); setDetail(null);
        void load();
      } else {
        toast?.error?.(data?.response?.message || 'That did not work.');
      }
    } catch {
      toast?.error?.('Connection error.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter && r.state !== filter) return false;
      if (!q) return true;
      return [r.full_name, r.email].some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  const counts = useMemo(() => ({
    pending: rows.filter(r => r.state === 'pending').length,
    active: rows.filter(r => r.state === 'active').length,
    suspended: rows.filter(r => r.state === 'suspended').length,
  }), [rows]);

  const open = (admin, action) => { setTarget({ admin, action }); setReason(''); };

  if (loading) {
    return <div className="space-y-4"><Skeleton className="h-20" /><Skeleton className="h-64" /></div>;
  }
  if (failed) return <ErrorState onRetry={load} />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Admin access"
        subtitle="Approve, suspend or restore admin accounts. Nobody creates an account for anyone else."
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <StatCard icon={Clock}         label="Awaiting approval" value={counts.pending} />
        <StatCard icon={ShieldCheck}   label="Active"            value={counts.active} />
        <StatCard icon={AlertTriangle} label="Suspended"         value={counts.suspended} />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2 relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email"
              className="w-full border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm
                         focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
          </div>
          <FormSelect value={filter} onChange={setFilter} options={FILTERS} placeholder="Filter" />
        </div>
      </Card>

      {!filtered.length ? (
        <EmptyState
          icon={CheckCircle2}
          title={filter === 'pending' ? 'Nobody waiting' : 'No admins match'}
          subtitle={filter === 'pending'
            ? 'Every admin account has been decided.'
            : 'Try a different filter.'}
        />
      ) : (
        <ResponsiveTable
          table={
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Admin</Th><Th>State</Th><Th>Registered</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.admin_id}
                      onClick={() => setDetail(r)}
                      className="hover:bg-slate-50 cursor-pointer">
                    <Td>
                      <p className="font-semibold text-slate-900">{r.full_name}</p>
                      <p className="text-xs text-slate-500">{r.email}</p>
                      {r.state_reason && (
                        <p className="text-xs text-slate-400 mt-0.5 italic">{r.state_reason}</p>
                      )}
                    </Td>
                    <Td><StatusBadge status={r.state} tone={STATE_TONE[r.state]} /></Td>
                    <Td>
                      <span className="text-sm text-slate-600">
                        {r.registered_at
                          ? new Date(r.registered_at).toLocaleDateString('en-IN',
                              { day: 'numeric', month: 'short', year: 'numeric' })
                          : '—'}
                      </span>
                    </Td>
                    {/* stopPropagation: the row opens the detail view, so a
                        click on Approve must not do both. */}
                    <Td className="text-right" onClick={e => e.stopPropagation()}>
                      <div className="inline-flex gap-2 items-center">
                        <button
                          type="button"
                          onClick={() => setDetail(r)}
                          aria-label={`View ${r.full_name}`}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                        >
                          <Eye size={15} />
                        </button>
                        {r.state === 'pending' && (
                          <Button size="sm" variant="primary" onClick={() => open(r, 'approve')}>
                            Approve
                          </Button>
                        )}
                        {r.state === 'active' && (
                          <Button size="sm" variant="outline" onClick={() => open(r, 'suspend')}>
                            Suspend
                          </Button>
                        )}
                        {r.state === 'suspended' && (
                          <Button size="sm" variant="primary" onClick={() => open(r, 'approve')}>
                            Restore
                          </Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          // RowCard renders title/subtitle/badge/fields/action — it does not
          // render children. Passing children put the whole card body into a
          // prop nothing reads, so on mobile these rows came out blank: no
          // name, no email, no buttons.
          cards={filtered.map(r => (
            <RowCard
              key={r.admin_id}
              onClick={() => setDetail(r)}
              title={r.full_name}
              subtitle={r.email}
              badge={<StatusBadge status={r.state} tone={STATE_TONE[r.state]} />}
              fields={[
                { label: 'Registered', value: fmtDate(r.registered_at) },
                { label: 'Reason', value: r.state_reason },
              ]}
              action={
                <div onClick={e => e.stopPropagation()}>
                  {r.state === 'pending' && (
                    <Button size="sm" variant="primary" onClick={() => open(r, 'approve')}>Approve</Button>
                  )}
                  {r.state === 'active' && (
                    <Button size="sm" variant="outline" onClick={() => open(r, 'suspend')}>Suspend</Button>
                  )}
                  {r.state === 'suspended' && (
                    <Button size="sm" variant="primary" onClick={() => open(r, 'approve')}>Restore</Button>
                  )}
                </div>
              }
            />
          ))}
        />
      )}

      <Card className="p-4 bg-slate-50 border-slate-200">
        <div className="flex gap-3">
          <Info size={16} className="text-slate-400 shrink-0 mt-0.5" />
          <p className="text-sm text-slate-600">
            Admins register themselves at the admin portal and wait here for
            approval. There is no way to create an account on someone&apos;s
            behalf, and you cannot change your own access.
          </p>
        </div>
      </Card>

      {detail && (
        <AdminDetail
          admin={detail}
          onClose={() => setDetail(null)}
          onAct={(a, action) => { setDetail(null); open(a, action); }}
        />
      )}

      {target && (
        <Modal isOpen onClose={() => setTarget(null)} title={ACTIONS[target.action].title}>
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
              <p className="font-semibold text-slate-900">{target.admin.full_name}</p>
              <p className="text-sm text-slate-500">{target.admin.email}</p>
            </div>

            <p className="text-sm text-slate-600">{ACTIONS[target.action].hint}</p>

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <Textarea
                rows={3} value={reason} onChange={e => setReason(e.target.value)}
                placeholder="The admin sees this. Say what happened and what they can do next."
              />
              <p className="text-xs text-slate-400 mt-1">
                Recorded permanently and shown in the audit log.
              </p>
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setTarget(null)}>Cancel</Button>
              <Button variant={ACTIONS[target.action].variant}
                      disabled={busy || !reason.trim()} onClick={act}>
                {busy ? 'Working…' : ACTIONS[target.action].cta}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
