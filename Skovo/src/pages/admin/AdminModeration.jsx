import React, { useEffect, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { AlertTriangle, CheckCircle2, Flag } from 'lucide-react';
import { adminApi as api } from '../../services/api';
import { Card, PageHeader, Badge, Toast, EmptyState, Button, FilterPills } from '../../components/ui/index.jsx';
import { ShieldAlert, Check, X, MessageSquareWarning } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/TableComponents';

const FILTERS = ['open', 'actioned', 'dismissed', ''];
const LABEL = { open: 'Open', actioned: 'Actioned', dismissed: 'Dismissed', '': 'All' };

export default function AdminModeration() {
  const [reports, setReports] = useState([]);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [counts, setCounts] = useState({});
  const [status, setStatus] = useState('open');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () => {
    setLoading(true);
    const qs = status ? `?status=${status}` : '';
    api.get(`/skovo-platform-panel-admin/dm-reports${qs}`)
      .then(({ data }) => {
        if (data.bool) { setReports(data.response.reports || []); setCounts(data.response.counts || {}); }
      })
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [status]);

  // A moderation decision is visible to the people involved and is not a
  // silent bookkeeping change, so it gets a prompt naming the outcome.
  const confirmResolve = (r, next) => {
    const acting = next === 'actioned';
    setConfirmDlg({
      message: acting ? 'Action this report?' : 'Dismiss this report?',
      detail: acting
        ? 'Records that you acted on the reported message.'
        : 'Records that no action was needed. The reporter is not told separately.',
      confirmLabel: acting ? 'Action it' : 'Dismiss',
      danger: acting,
      onConfirm: () => resolve(r, next),
    });
  };

  const resolve = async (r, next) => {
    try {
      const { data } = await api.patch(`/skovo-platform-panel-admin/dm-reports/${r.id}`, { status: next });
      if (data.bool) { flash(data.response.message || 'Report updated.'); load(); }
      else flash(data.response?.message || 'Could not update.', 'error');
    } catch { flash('Could not update the report.', 'error'); }
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
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Moderation"
        subtitle="Reported direct messages. Student safety takes priority over everything else."
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatTile label="Open" value={counts.open || 0} icon={AlertTriangle} tone="amber" sub="need a decision" />
        <StatTile label="Resolved" value={counts.closed || 0} icon={CheckCircle2} tone="emerald" sub="actioned or dismissed" />
        <StatTile label="Total" value={counts.total || 0} icon={Flag} tone="blue" sub="ever reported" />
      </div>

      <div className="mb-4">
        <div role="group" aria-label="Filter reports" className="grid grid-cols-4 sm:inline-grid gap-1 p-1 rounded-xl bg-slate-100">
          {FILTERS.map((f) => (
            <button key={f || 'all'} type="button" onClick={() => setStatus(f)} aria-pressed={status === f}
                    className={`min-h-10 px-3 rounded-lg text-xs sm:text-sm font-semibold ${status === f ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {LABEL[f]}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-28 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={ShieldAlert}
          title={status === 'open' ? 'Nothing to review' : 'No reports here'}
          subtitle={status === 'open' ? 'The queue is clear.' : 'Try another filter.'}
        />
      ) : (
        <div className="space-y-3">
          {reports.map((r) => (
            <Card key={r.id} className="p-5">
              <div className="flex items-start gap-3 flex-wrap">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                  <MessageSquareWarning size={17} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-slate-900">
                    <strong>{r.reporter?.name || 'A member'}</strong>
                    <span className="text-slate-400"> reported </span>
                    <strong>{r.reported?.name || 'a member'}</strong>
                  </p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {new Date(r.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <Badge color={r.status === 'open' ? 'amber' : r.status === 'actioned' ? 'red' : 'slate'} size="xs">
                  {r.status}
                </Badge>
              </div>

              {r.reason && (
                <div className="mt-3 text-sm text-slate-700 bg-slate-50 rounded-xl px-4 py-2.5">
                  <span className="text-xs font-semibold text-slate-400 block mb-0.5">Reason given</span>
                  {r.reason}
                </div>
              )}

              {r.message_body && (
                <div className="mt-2 text-sm text-slate-700 border-l-2 border-red-300 bg-red-50/50 rounded-r-xl px-4 py-2.5">
                  <span className="text-xs font-semibold text-red-400 block mb-0.5">Reported message</span>
                  {r.message_body}
                </div>
              )}

              {r.status === 'open' && (
                <div className="flex gap-2 mt-4">
                  <Button size="sm" onClick={() => confirmResolve(r, 'actioned')}>
                    <Check size={14} /> Action taken
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => confirmResolve(r, 'dismissed')}>
                    <X size={14} /> Dismiss
                  </Button>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
