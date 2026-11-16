import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Badge, Toast, EmptyState, Button, StudentPage } from '../components/ui/index.jsx';
import { Briefcase, MapPin, Clock, CheckCircle, XCircle, AlertCircle, X, IndianRupee, Calendar, Tag, ExternalLink, AlignLeft, Eye } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, StatusBadge, ActionBtn, ConfirmModal, ResponsiveTable, RowCard } from '../components/ui/TableComponents';

function AppDetailModal({ app, onClose, onWithdraw, withdrawing }) {
  const cfg = STATUS[app.status] || STATUS.applied;
  const Icon = cfg.icon;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-5 sm:px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <Badge color={cfg.color} size="xs"><Icon size={9} /> {cfg.label}</Badge>
              {app.type && <Badge color="slate" size="xs">{app.type?.replace('_', ' ')}</Badge>}
            </div>
            <h3 className="text-lg font-bold text-slate-900 leading-snug">{app.title}</h3>
            <p className="text-sm text-slate-500 mt-0.5">{app.company}</p>
          </div>
          <button onClick={onClose} aria-label="Close application" className="min-h-11 min-w-11 p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-3">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-3">
            {app.applied_at && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 font-medium mb-0.5">Applied On</p>
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                  <Calendar size={12} className="text-slate-400" />
                  {new Date(app.applied_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </p>
              </div>
            )}
            {app.location && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 font-medium mb-0.5">Location</p>
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                  <MapPin size={12} className="text-slate-400" />
                  {app.location}{app.is_remote ? ' · Remote' : ''}
                </p>
              </div>
            )}
            {(app.stipend_min || app.stipend_max) && (
              <div className="bg-emerald-50 rounded-xl p-3">
                <p className="text-xs text-emerald-600 font-medium mb-0.5">Stipend / Salary</p>
                <p className="text-sm font-bold text-emerald-800 flex items-center gap-1">
                  <IndianRupee size={12} />
                  {app.stipend_min && app.stipend_max
                    ? `₹${app.stipend_min}–₹${app.stipend_max}/mo`
                    : `₹${app.stipend_min || app.stipend_max}/mo`}
                </p>
              </div>
            )}
            {app.duration && (
              <div className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 font-medium mb-0.5">Duration</p>
                <p className="text-sm font-semibold text-slate-800 flex items-center gap-1">
                  <Clock size={12} className="text-slate-400" /> {app.duration}
                </p>
              </div>
            )}
            {app.deadline && (
              <div className="bg-amber-50 rounded-xl p-3">
                <p className="text-xs text-amber-600 font-medium mb-0.5">Deadline</p>
                <p className="text-sm font-semibold text-amber-800 flex items-center gap-1">
                  <Calendar size={12} />
                  {new Date(app.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                </p>
              </div>
            )}
          </div>

          {app.description && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                <AlignLeft size={11} /> Description
              </p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{app.description}</p>
            </div>
          )}

          {app.skills_required?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <Tag size={11} /> Skills Required
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(app.skills_required) ? app.skills_required : [app.skills_required]).map((s, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 border border-blue-100 px-2.5 py-1 rounded-lg font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {app.cover_note && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Your Cover Note</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-blue-50 border border-blue-100 rounded-xl p-4 italic">"{app.cover_note}"</p>
            </div>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 shrink-0 flex flex-col-reverse sm:flex-row gap-3"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          {app.status === 'applied' && (
            <Button variant="danger" size="md" onClick={() => { onWithdraw(app.id); onClose(); }} disabled={withdrawing === app.id} className="flex-1 min-h-11">
              {withdrawing === app.id ? 'Withdrawing…' : 'Withdraw Application'}
            </Button>
          )}
          {app.application_link && (
            <a href={app.application_link} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="secondary" size="md" className="w-full min-h-11">
                <ExternalLink size={14} /> View Job Posting
              </Button>
            </a>
          )}
          <Button variant="secondary" size="md" onClick={onClose} className={`min-h-11 ${app.status !== 'applied' && !app.application_link ? 'flex-1' : ''}`}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

const STATUS = {
  applied:      { label: 'Applied',      color: 'blue',    icon: Clock },
  interviewing: { label: 'Interviewing', color: 'amber',   icon: AlertCircle },
  offered:      { label: 'Offered',      color: 'emerald', icon: CheckCircle },
  rejected:     { label: 'Rejected',     color: 'red',     icon: XCircle },
  withdrawn:    { label: 'Withdrawn',    color: 'slate',   icon: XCircle },
};

function StatPill({ label, value, color }) {
  const colors = {
    slate:   'bg-slate-100  text-slate-700',
    blue:    'bg-blue-50    text-blue-700',
    amber:   'bg-amber-50   text-amber-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    red:     'bg-red-50     text-red-700',
  };
  return (
    <div className={`flex flex-col items-center px-5 py-3 rounded-2xl ${colors[color]}`}>
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs font-medium mt-0.5 capitalize">{label}</span>
    </div>
  );
}

export default function Applications() {
  const [apps,       setApps]       = useState([]);
  const [stats,      setStats]      = useState({});
  const [loading,    setLoading]    = useState(true);
  const [withdrawing,setWithdrawing]= useState(null);
  const [toast,      setToast]      = useState('');
  const [selected,   setSelected]   = useState(null);
  const [confirmWithdraw, setConfirmWithdraw] = useState(null);

  useEffect(() => {
    api.get('/applications/')
      .then(({ data }) => { if (data.bool) { setApps(data.response.applications); setStats(data.response.stats); } })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleWithdraw = async (id) => {
    setWithdrawing(id);
    try {
      const { data } = await api.patch(`/applications/${id}/status`, { status: 'withdrawn' });
      if (data.bool) {
        setApps(prev => prev.map(a => a.id === id ? { ...a, status: 'withdrawn' } : a));
        setToast('Application withdrawn.');
        setTimeout(() => setToast(''), 3000);
      }
    } catch {} finally { setWithdrawing(null); }
  };

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type="info" />
      {selected && (
        <AppDetailModal app={selected} onClose={() => setSelected(null)}
          onWithdraw={(id) => setConfirmWithdraw(id)} withdrawing={withdrawing} />
      )}

      {confirmWithdraw && (
        <ConfirmModal
          message="Withdraw this application?"
          detail="This will mark your application as withdrawn. This cannot be undone."
          confirmLabel="Withdraw"
          danger
          onConfirm={() => { const id = confirmWithdraw; setConfirmWithdraw(null); handleWithdraw(id); }}
          onCancel={() => setConfirmWithdraw(null)}
        />
      )}

      <div>
        <h1 className="text-2xl font-black text-slate-900">My Applications</h1>
        <p className="text-sm text-slate-400 mt-0.5">Track your job and internship pipeline</p>
      </div>

      {!loading && stats.total > 0 && (
        <div className="flex flex-wrap gap-3">
          <StatPill label="Total"        value={stats.total || 0}        color="slate" />
          <StatPill label="Applied"      value={stats.applied || 0}      color="blue" />
          <StatPill label="Interviewing" value={stats.interviewing || 0} color="amber" />
          <StatPill label="Offered"      value={stats.offered || 0}      color="emerald" />
          <StatPill label="Rejected"     value={stats.rejected || 0}     color="red" />
        </div>
      )}

      <ResponsiveTable
        cards={
          loading
            ? Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
              ))
            : apps.map((app) => (
                <RowCard
                  key={app.id}
                  onClick={() => setSelected(app)}
                  title={app.title}
                  subtitle={app.company}
                  badge={<StatusBadge status={app.status} label={STATUS[app.status]?.label || app.status} />}
                  fields={[
                    { label: 'Location', value: app.location ? `${app.location}${app.is_remote ? ' · Remote' : ''}` : (app.is_remote ? 'Remote' : '—') },
                    { label: 'Applied', value: app.applied_at ? new Date(app.applied_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—' },
                  ]}
                  action={app.status === 'applied' ? (
                    <span onClick={e => e.stopPropagation()}>
                      <ActionBtn icon={XCircle} tooltip="Withdraw application" color="red"
                        loading={withdrawing === app.id}
                        onClick={() => setConfirmWithdraw(app.id)} />
                    </span>
                  ) : undefined}
                />
              ))
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Role</Th>
                <Th>Company</Th>
                <Th>Location</Th>
                <Th>Applied On</Th>
                <Th>Status</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={7} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {apps.map((app, idx) => (
                  <tr key={app.id} onClick={() => setSelected(app)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400">{idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View application details" color="indigo" onClick={() => setSelected(app)} />
                        {app.status === 'applied' && (
                          <ActionBtn icon={XCircle} tooltip="Withdraw application" color="red"
                            loading={withdrawing === app.id}
                            onClick={() => setConfirmWithdraw(app.id)} />
                        )}
                      </div>
                    </Td>
                    <Td><span className="font-semibold text-slate-900">{app.title}</span></Td>
                    <Td><span className="text-slate-600">{app.company}</span></Td>
                    <Td>
                      {app.location && (
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin size={11} />{app.location}{app.is_remote ? ' · Remote' : ''}
                        </span>
                      )}
                    </Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {app.applied_at ? new Date(app.applied_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
                      </span>
                    </Td>
                    <Td><StatusBadge status={app.status} label={STATUS[app.status]?.label || app.status} /></Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        }
      />
      {!loading && apps.length === 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl">
          <EmptyState icon={Briefcase} title="No applications yet" subtitle="Roles you apply for show here, with where each one stands."
            action={
              <Link to="/opportunities" className="inline-flex items-center gap-2 min-h-11 px-5 text-white font-semibold rounded-xl text-sm"
                    style={{ backgroundColor: 'var(--accent)' }}>
                <Briefcase size={15} /> Browse opportunities
              </Link>
            } />
        </div>
      )}
    </StudentPage>
  );
}
