import React, { useEffect, useState } from 'react';
import { adminApi } from '../../services/api';
import { useToast, Modal, Button } from '../../components/ui/index.jsx';
import { SettingsCard, CrudTable, PageShell } from '../../components/admin/v1/AdminV1Kit';
import FormSelect from '../../components/ui/FormSelect';

const A = '/skovo-platform-panel-admin';
/** Stages (feature-updates.md §2): score resets per stage; history kept. */
export default function AdminStages() {
  const toast = useToast();
  const [group, setGroup] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Stage list comes from the backend (stages.GROUP_LABELS), the same dict
  // promotion runs on — no second copy to drift out of sync here.
  const [groups, setGroups] = useState([]);
  useEffect(() => {
    adminApi.get(`${A}/stages/groups`)
      .then(({ data }) => { if (data?.bool) setGroups(data.response.groups || []); })
      .catch(() => {});
  }, []);

  // Undo asks for a reason in the app's own dialog — window.prompt was a bare
  // browser box on desktop and a cramped system sheet on a phone.
  const [undo, setUndo] = useState(null);       // { row, reload }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const rollback = async () => {
    if (!reason.trim() || !undo) return;
    setBusy(true);
    try {
      const { data } = await adminApi.post(`${A}/stages/${undo.row.user_id}/rollback`, { reason: reason.trim() });
      if (data?.bool) { toast.success('Rolled back.'); undo.reload(); setUndo(null); setReason(''); }
      else toast.error(data?.response?.message || 'Could not roll back.');
    } finally { setBusy(false); }
  };

  return (
    <PageShell title="Stages" subtitle="Class 10 → Intermediate → UG. The readiness score starts again at each stage; closed stages stay on the career timeline.">
      <SettingsCard
        title="Promotion settings" endpoint={`${A}/stages/settings`} compact
        description="Everything is off by default."
        fields={[
          { key: 'legacy_boost_percent', label: 'Legacy boost %', short: 'Boost %', type: 'int', min: 0, max: 100, hint: 'Head start from the last stage score (0 = off).' },
          { key: 'legacy_boost_max', label: 'Legacy boost maximum (points)', short: 'Boost max', type: 'int', min: 0, max: 100, hint: 'Both numbers must be above 0 for a boost.' },
          { key: 'auto_promote_enabled', label: 'Auto-promote once a year', short: 'Auto-promote', type: 'bool', hint: 'Class 10 → Inter 1st year, 11th → 12th, UG year +1. Inter 2nd year gets a reminder instead.' },
          { key: 'auto_promote_on', label: 'Auto-promotion date (MM-DD, IST)', short: 'Date', type: 'text', hint: 'e.g. 07-01' },
        ]}
      />
      <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
        <div className="w-full sm:w-56">
          <FormSelect value={group} onChange={(v) => setGroup(v || '')} options={groups}
                      placeholder="All stages" clearable />
        </div>
        <div className="flex gap-2 flex-1 min-w-0">
          <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && setQuery(search)} type="search"
                 placeholder="Search name or email" aria-label="Search students"
                 className="flex-1 min-w-0 sm:flex-none sm:w-64 min-h-11 px-3 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <Button onClick={() => setQuery(search)} className="shrink-0">Search</Button>
        </div>
      </div>
      <CrudTable
        key={`${group}-${query}`}
        title="Students' stages" listKey="stages" canCreate={false}
        serverPaged
        listEndpoint={`${A}/stages?stage_group=${group}&search=${encodeURIComponent(query)}`}
        columns={[
          { key: 'full_name', label: 'Student' },
          { key: 'stage_label', label: 'Stage' },
          { key: 'sub_year', label: 'Year' },
          { key: 'branch', label: 'Branch' },
          { key: 'institute', label: 'School / college' },
          { key: 'status', label: 'Status', render: (r) => <span className="capitalize">{r.status}</span> },
          { key: 'final_score', label: 'Final score' },
          { key: 'started_at', label: 'Started', render: (r) => (r.started_at || '').slice(0, 10) },
        ]}
        fields={[]}
        // Only where there is an earlier stage to go back to — a student still
        // in their first stage has nothing to undo.
        extraActions={(r, reload) => r.can_roll_back && (
          <button onClick={() => { setReason(''); setUndo({ row: r, reload }); }}
                  className="px-2 py-2.5 text-xs font-semibold text-amber-700 mr-1">Undo promotion</button>
        )}
      />
      <Modal isOpen={!!undo} onClose={() => !busy && setUndo(null)} title="Undo promotion" size="sm"
        footer={<>
          <Button variant="secondary" onClick={() => setUndo(null)} disabled={busy}>Cancel</Button>
          <Button onClick={rollback} disabled={busy || !reason.trim()}>{busy ? 'Undoing…' : 'Undo promotion'}</Button>
        </>}>
        <p className="text-sm text-slate-600 mb-3">
          {undo?.row.full_name} goes back to their previous stage, and that stage's score becomes active again.
        </p>
        <label htmlFor="undo-reason" className="block text-sm font-semibold text-slate-700 mb-1.5">
          Reason <span className="text-red-500">*</span>
        </label>
        <textarea id="undo-reason" rows={3} value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Promoted by mistake — still in Class 10"
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500/30" />
      </Modal>
    </PageShell>
  );
}
