import React, { useEffect, useState } from 'react';
import { useMasters } from '../../hooks/useMasters';
import { adminApi as api } from '../../services/api';
import { Badge } from '../../components/ui/index.jsx';
import { X, Crown, Download, Mail, Phone, FileText, Check } from 'lucide-react';
import { ConfirmModal } from '../../components/ui/TableComponents';

// STAGES comes from master data (masters.applicant_stage) — see hooks/useMasters.
const STAGE_LABEL = { applied: 'Applied', interviewing: 'Shortlisted', offered: 'Offered', rejected: 'Rejected' };
const STAGE_COLOR = { applied: 'blue', interviewing: 'amber', offered: 'emerald', rejected: 'red' };

/** Slide-over showing every applicant to one opportunity, Pro-first,
 *  with stage controls and a structured export for handing to an employer. */
export default function ApplicantPipeline({ opportunity, onClose }) {
  const { lists } = useMasters(['applicant_stage']);
  const STAGES = (lists.applicant_stage || []).map(o => o.value);

  const [apps, setApps] = useState([]);
  const [stages, setStages] = useState({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const [exported, setExported] = useState(null);

  const load = () =>
    api.get(`/skovo-platform-panel-admin/opportunities/${opportunity.id}/applications`)
      .then(({ data }) => {
        if (data.bool) { setApps(data.response.applications || []); setStages(data.response.stages || {}); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

  useEffect(() => { load(); }, [opportunity.id]);

  // Moving someone through the pipeline is a decision about a real applicant,
  // and the buttons sit close together. Name the person and the destination.
  const confirmStatus = (app, status) => {
    setConfirmDlg({
      message: `Move ${app.full_name || 'this applicant'} to "${status}"?`,
      detail: 'The applicant sees this change on their side.',
      confirmLabel: 'Move',
      onConfirm: () => setStatus(app, status),
    });
  };

  const setStatus = async (app, status) => {
    setBusyId(app.id);
    try {
      const { data } = await api.patch(`/applications/${app.id}/status`, { status });
      if (data.bool) load();
    } catch { /* leave the row as-is */ } finally { setBusyId(null); }
  };

  const doExport = async (app) => {
    try {
      const { data } = await api.get(`/skovo-platform-panel-admin/applications/${app.id}/export`);
      if (data.bool) setExported(data.response.export);
    } catch { /* ignore */ }
  };

  const downloadJson = () => {
    const blob = new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `applicant-${(exported.applicant?.name || 'export').replace(/\s+/g, '-')}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 w-full max-w-lg bg-white z-50 flex flex-col shadow-2xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="min-w-0">
            <h2 className="font-bold text-slate-900 truncate">Applicants</h2>
            <p className="text-xs text-slate-400 truncate">{opportunity.title} · {opportunity.company}</p>
          </div>
          <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Pipeline counts */}
        <div className="flex gap-2 px-5 py-3 border-b border-slate-100 overflow-x-auto">
          {STAGES.map((st) => (
            <div key={st} className="shrink-0 text-center px-3 py-1.5 rounded-xl bg-slate-50">
              <p className="text-lg font-bold text-slate-900 leading-none">{stages[st] || 0}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{STAGE_LABEL[st]}</p>
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-28 bg-slate-50 rounded-2xl animate-pulse" />)
          ) : apps.length === 0 ? (
            <p className="text-center text-slate-400 py-16 text-sm">No applications yet.</p>
          ) : (
            apps.map((ap) => (
              <div key={ap.id} className="border border-slate-200 rounded-2xl p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-slate-900 truncate">{ap.name}</p>
                      {ap.is_pro && (
                        <Badge color="purple" size="xs"><Crown size={9} className="inline mr-0.5" />PRO</Badge>
                      )}
                      <Badge color={STAGE_COLOR[ap.status] || 'slate'} size="xs">
                        {STAGE_LABEL[ap.status] || ap.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                      {ap.email && <p className="flex items-center gap-1.5 truncate"><Mail size={10} />{ap.email}</p>}
                      {ap.phone && <p className="flex items-center gap-1.5"><Phone size={10} />{ap.phone}</p>}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">Score</p>
                    <p className="font-bold text-slate-900">{ap.readiness_score}</p>
                  </div>
                </div>

                {ap.cover_note && (
                  <p className="text-xs text-slate-600 mt-2 bg-slate-50 rounded-lg px-3 py-2 line-clamp-3">{ap.cover_note}</p>
                )}

                <div className="flex items-center gap-1.5 mt-3 flex-wrap">
                  {STAGES.filter((st) => st !== ap.status).map((st) => (
                    <button
                      key={st}
                      onClick={() => confirmStatus(ap, st)}
                      disabled={busyId === ap.id}
                      className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                      → {STAGE_LABEL[st]}
                    </button>
                  ))}
                  <button
                    onClick={() => doExport(ap)}
                    className="ml-auto px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-600 hover:bg-blue-50 flex items-center gap-1 transition-colors"
                  >
                    <Download size={12} /> Export
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Export preview */}
        {exported && (
          <div className="border-t border-slate-100 p-5 max-h-72 overflow-y-auto bg-slate-50">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-bold text-slate-900">Applicant packet</p>
              <div className="flex gap-2">
                <button onClick={downloadJson} className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  <Download size={12} /> Download JSON
                </button>
                <button onClick={() => setExported(null)} className="text-xs text-slate-400 hover:text-slate-600">Close</button>
              </div>
            </div>
            <p className="text-sm font-semibold text-slate-800">{exported.applicant?.name}</p>
            <p className="text-xs text-slate-500">
              {[exported.applicant?.stream, exported.applicant?.city].filter(Boolean).join(' · ')}
              {' · '}Score {exported.applicant?.readiness_score} ({exported.applicant?.readiness_level})
            </p>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wide mt-3 mb-1">
              Shared documents ({exported.documents?.length || 0})
            </p>
            {(exported.documents || []).length === 0 ? (
              <p className="text-xs text-slate-400">This applicant has not shared any documents.</p>
            ) : (
              exported.documents.map((d, i) => (
                <a key={i} href={d.file_url} target="_blank" rel="noopener noreferrer"
                   className="flex items-center gap-2 text-sm text-blue-600 hover:underline py-1">
                  <FileText size={13} /> {d.name} <span className="text-xs text-slate-400">({d.category})</span>
                </a>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}
