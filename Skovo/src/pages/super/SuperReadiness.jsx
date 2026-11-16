import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { superApi } from '../../services/api';
import { BarChart2, Search, CheckCircle, XCircle, Check, X, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination,
  Avatar, ActionBtn, StatusBadge, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

const LEVEL_META = {
  Explorer: { color: 'bg-slate-100 text-slate-600 border-slate-200' },
  Pioneer:  { color: 'bg-blue-50 text-blue-700 border-blue-200' },
  Achiever: { color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
};

function ScoreBar({ score }) {
  const pct = Math.min(100, Math.max(0, score));
  const bar = score >= 65 ? 'bg-emerald-500' : score >= 30 ? 'bg-blue-500' : 'bg-slate-400';
  return (
    <div className="flex items-center gap-2.5 min-w-32">
      <div className="flex-1 h-1.5 rounded-full bg-slate-100">
        <div className={`h-1.5 rounded-full ${bar} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-sm font-bold text-slate-700 w-8 text-right">{score}</span>
    </div>
  );
}

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-xl flex items-center gap-2 ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {ok ? <Check size={16} /> : <X size={16} />} {msg}
    </div>
  );
}

/**
 * The score-override form that lived here is gone on purpose.
 *
 * A readiness score is a student's record. Changing it by hand is operational
 * work that belongs to an admin, under that admin's name — and deleting one
 * destroys the history you would want if the score were ever disputed. The
 * super admin reads this list to see where the platform stands; the detail
 * view below still shows everything behind a score.
 */

function ReadinessDetailModal({ record, onClose }) {
  const lvl = LEVEL_META[record.level] || LEVEL_META.Explorer;
  const rows = [
    { label: 'Email', value: record.user_email },
    { label: 'Score', value: `${record.score} pts` },
    { label: 'Level', value: <span className={`px-2 py-0.5 rounded-full text-xs font-semibold border ${lvl.color}`}>{record.level}</span> },
    { label: 'Cohorts', value: record.cohorts_completed },
    { label: 'Tasks', value: record.tasks_completed },
    { label: 'Assessment', value: record.assessment_completed ? '✅ Done' : '❌ Pending' },
    { label: 'Institution', value: record.institution ? record.institution.name : 'Platform-wide' },
    { label: 'Last Updated', value: record.updated_at ? new Date(record.updated_at).toLocaleDateString('en-IN', { dateStyle: 'long' }) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Readiness Record</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-4 space-y-4">
          <p className="text-lg font-black text-slate-900">{record.user_name}</p>
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

export default function SuperReadiness() {
  const { lists } = useMasters(['readiness_level']);
  const navigate = useNavigate();
  const [records, setRecords]       = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage]       = useState(20);
  const [search, setSearch]         = useState('');
  const [levelFilter, setLevel]     = useState('');
  const [loading, setLoading]       = useState(true);
  const [toast, setToast]           = useState(null);
  const [selected, setSelected]     = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };

  const load = useCallback((page = 1, q = search, level = levelFilter, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q)     params.search = q;
    if (level) params.level  = level;
    superApi.get('/skovo-platform-owner/readiness', params)
      .then(({ data, status }) => {
        if (status === 401) { navigate('/skovo-platform-owner/login'); return; }
        if (data.bool) { setRecords(data.response.readiness); setPagination(data.pagination); }
      })
      .catch(() => showToast('Could not load readiness records.', false))
      .finally(() => setLoading(false));
  }, [search, levelFilter, perPage]);

  useEffect(() => { load(1); }, []);

  const handleSearch = (e) => { e.preventDefault(); load(1, search, levelFilter); };


  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {confirmDlg && (
        <ConfirmModal message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)} />
      )}
      {selected && <ReadinessDetailModal record={selected} onClose={() => setSelected(null)} />}

      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Readiness Scores</h1>
          <p className="text-sm text-slate-500 mt-1">{pagination.total} students ranked by score</p>
        </div>
        <div className="hidden lg:flex items-center gap-4 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-400 inline-block" /> Explorer (0-29)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Pioneer (30-64)</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Achiever (65-100)</span>
        </div>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 mb-5">
        <div className="relative flex-1 min-w-50 max-w-sm">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search student name or email…"
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          />
        </div>
        <FormSelect searchType="readiness_level"
          className="sm:w-48 shrink-0"
          value={levelFilter}
          onChange={v => { setLevel(v); load(1, search, v); }}
          options={lists.readiness_level || []}
          placeholder="All Levels" />
        <button type="submit" className="px-4 py-2.5 bg-violet-600 text-white text-sm font-semibold rounded-xl hover:bg-violet-700">Search</button>
      </form>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Rank</Th><Th>Student</Th><Th>Email</Th><Th>Score</Th><Th>Level</Th><Th>Cohorts</Th><Th>Tasks</Th><Th>Assessment</Th><Th>Institution</Th><Th>Updated</Th><Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={11} rows={8} />
            </table>
          </div>
        ) : records.length === 0 ? (
          <EmptyState icon={BarChart2} message="No readiness data yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>Rank</Th>
                  <Th>Student</Th>
                  <Th>Email</Th>
                  <Th>Score</Th>
                  <Th>Level</Th>
                  <Th>Cohorts</Th>
                  <Th>Tasks</Th>
                  <Th>Assessment</Th>
                  <Th>Institution</Th>
                  <Th>Updated</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {records.map((r, idx) => {
                  const lvl  = LEVEL_META[r.level] || LEVEL_META.Explorer;
                  const rank = (pagination.page - 1) * perPage + idx + 1;
                  return (
                    <tr key={r.id} onClick={() => setSelected(r)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td>
                        <span className="text-sm font-bold w-10 inline-block">
                          {rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : <span className="text-slate-300">{rank}</span>}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-3">
                          <Avatar name={r.user_name} />
                          <span className="font-semibold text-slate-900">{r.user_name}</span>
                        </div>
                      </Td>
                      <Td><span className="text-xs text-slate-500">{r.user_email}</span></Td>
                      <Td><ScoreBar score={r.score} /></Td>
                      <Td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${lvl.color}`}>{r.level}</span>
                      </Td>
                      <Td><span className="text-sm font-semibold text-slate-700 text-center">{r.cohorts_completed}</span></Td>
                      <Td><span className="text-sm font-semibold text-slate-700 text-center">{r.tasks_completed}</span></Td>
                      <Td>
                        {r.assessment_completed
                          ? <CheckCircle size={16} className="text-emerald-500 mx-auto" />
                          : <XCircle size={16} className="text-slate-300 mx-auto" />
                        }
                      </Td>
                      <Td>
                        {r.institution
                          ? <div><p className="text-xs font-semibold text-slate-900">{r.institution.name}</p><p className="text-[11px] text-slate-400">{r.institution.subdomain}.skovo.in</p></div>
                          : <span className="text-xs text-slate-400">--</span>}
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {r.updated_at ? new Date(r.updated_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '--'}
                        </span>
                      </Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={ev => ev.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => setSelected(r)} />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
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
          onPerPage={pp => { setPerPage(pp); load(1, search, levelFilter, pp); }}
        />
      </TableShell>
    </div>
  );
}
