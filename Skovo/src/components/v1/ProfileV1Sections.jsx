/**
 * Profile additions (feature-updates.md §2, §16): career timeline across
 * stages, download my data, delete my account.
 */
import React, { useEffect, useState } from 'react';
import { GraduationCap, Download, Trash2, Share2 } from 'lucide-react';
import { api } from '../../services/api';
// v1: only used by the hidden Delete my account.
// import { useAuth } from '../../context/AuthContext';
import { useToast, Modal } from '../ui/index.jsx';

function recapText(s) {
  const r = s.best_rank || {};
  const bits = [`My ${s.stage_label} on SKOVO 🎓`, `Readiness score ${s.final_score ?? 0}${s.final_level ? ` (${s.final_level})` : ''}`];
  if (s.stage_best_streak) bits.push(`Best streak ${s.stage_best_streak} days 🔥`);
  if (r.league_best_tier) bits.push(`${r.league_best_tier} league${r.league_best_rank ? `, best rank #${r.league_best_rank}` : ''}`);
  (r.hall_of_fame || []).slice(0, 1).forEach((h) => bits.push(`Hall of Fame #${h.rank} (${h.scope})`));
  if (s.tasks_completed) bits.push(`${s.tasks_completed} tasks · ${s.cohorts_completed || 0} cohorts`);
  return bits.join('\n');
}

/* Season recap card for a closed stage (§10) — shareable. */
function RecapCard({ s, onClose }) {
  const toast = useToast();
  const r = s.best_rank || {};
  const badges = Array.isArray(s.badges) ? s.badges : [];
  const share = async () => {
    const text = recapText(s);
    try {
      if (navigator.share) await navigator.share({ title: 'My SKOVO recap', text });
      else { await navigator.clipboard.writeText(text); toast.success('Copied — paste it anywhere.'); }
    } catch { /* closed the share sheet */ }
  };
  const stat = (label, value) => (
    <div className="bg-white/15 rounded-xl p-3"><p className="text-[11px] opacity-80">{label}</p><p className="text-lg font-black">{value}</p></div>
  );
  return (
    <Modal isOpen onClose={onClose} title="Season recap" size="sm">
      <div className="rounded-3xl p-5 text-white space-y-4" style={{ background: 'linear-gradient(135deg,#4f46e5 0%,#7c3aed 60%,#db2777 100%)' }}>
        <div>
          <p className="text-xs opacity-80">SKOVO · {s.started_at?.slice(0, 4)}{s.ended_at ? `–${s.ended_at.slice(0, 4)}` : ''}</p>
          <p className="text-2xl font-black">{s.stage_label}</p>
        </div>
        <div className="grid grid-cols-2 gap-2">
          {stat('Readiness score', `${s.final_score ?? 0}${s.final_level ? ` · ${s.final_level}` : ''}`)}
          {stat('Best streak', `${s.stage_best_streak || 0} 🔥`)}
          {stat('Best league', r.league_best_tier ? `${r.league_best_tier}${r.league_best_rank ? ` #${r.league_best_rank}` : ''}` : '—')}
          {stat('Tasks · cohorts', `${s.tasks_completed || 0} · ${s.cohorts_completed || 0}`)}
        </div>
        {(r.hall_of_fame || []).length > 0 && <p className="text-sm">🏆 Hall of Fame: {r.hall_of_fame.map((h) => `#${h.rank} ${h.scope}`).join(', ')}</p>}
        {badges.length > 0 && <p className="text-xs opacity-90">Earned: {badges.slice(0, 8).join(' · ')}</p>}
      </div>
      <button onClick={share} className="mt-4 w-full inline-flex justify-center items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-semibold"><Share2 size={15} /> Share my recap</button>
    </Modal>
  );
}

export function CareerTimeline() {
  const [d, setD] = useState(null);
  const [recap, setRecap] = useState(null);
  useEffect(() => { api.get('/profile/stages').then(({ data }) => data?.bool && setD(data.response)).catch(() => {}); }, []);
  if (!d || !d.timeline?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4">
      <h3 className="text-sm font-bold text-slate-900 mb-3">My journey</h3>
      <ol className="relative border-l-2 border-slate-100 ml-2 space-y-4">
        {d.timeline.map((s) => (
          <li key={s.id} className="ml-4">
            <span className={`absolute -left-[9px] w-4 h-4 rounded-full ${s.status === 'active' ? 'bg-blue-600' : 'bg-slate-300'}`} />
            <p className="text-sm font-semibold text-slate-900 inline-flex items-center gap-1"><GraduationCap size={14} /> {s.stage_label}{s.sub_year ? ` · year ${s.sub_year}` : ''}</p>
            <p className="text-xs text-slate-500">{[s.board, s.degree_type, s.branch, s.institute].filter(Boolean).join(' · ')}</p>
            <p className="text-[11px] text-slate-400">{s.started_at?.slice(0, 10)}{s.ended_at ? ` → ${s.ended_at.slice(0, 10)}` : ' → now'}</p>
            {s.status !== 'active' && (
              <p className="text-xs text-slate-600 mt-1">
                {s.final_score !== null && s.final_score !== undefined && `Score ${s.final_score}`}{s.final_level && ` (${s.final_level})`}
                {s.tasks_completed ? ` · ${s.tasks_completed} tasks` : ''}{s.cohorts_completed ? ` · ${s.cohorts_completed} cohorts` : ''}
                {s.stage_best_streak ? ` · best streak ${s.stage_best_streak}` : ''}
              </p>
            )}
            {s.status !== 'active' && <button onClick={() => setRecap(s)} className="mt-1 text-xs font-semibold text-violet-700">View recap card →</button>}
          </li>
        ))}
      </ol>
      {recap && <RecapCard s={recap} onClose={() => setRecap(null)} />}
    </div>
  );
}

export function DataRights() {
  const toast = useToast();
  // v1: "Delete my account" is hidden -- students sign out instead, and a
  // real deletion request goes through Help & support. Kept below, commented.
  /*
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState('');
  const [needWallet, setNeedWallet] = useState('');
  */

  const download = async () => {
    const { data } = await api.get('/profile/my-data');
    if (!data?.bool) { toast.error('Could not prepare your data.'); return; }
    const url = URL.createObjectURL(new Blob([JSON.stringify(data.response, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'skovo-my-data.json'; a.click();
    URL.revokeObjectURL(url);
  };

  /*
  const del = async (forfeit) => {
    const { data } = await api.post('/profile/delete-account', { confirm, forfeit_wallet: !!forfeit });
    if (data?.bool) { toast.success(data.response.message); logout(); return; }
    if (data?.response?.needs_wallet_decision) { setNeedWallet(data.response.message); return; }
    toast.error(data?.response?.message || 'Could not delete.');
  };
  */

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 mt-4 space-y-3">
      <h3 className="text-sm font-bold text-slate-900">My data</h3>
      <div className="flex flex-wrap gap-2">
        <button onClick={download} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border text-sm"><Download size={14} /> Download my data</button>
        {/* v1: hidden.
        <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-red-200 text-red-700 text-sm"><Trash2 size={14} /> Delete my account</button>
        */}
      </div>
      {/* v1: hidden.
      {open && (
        <div className="bg-red-50 rounded-xl p-3 space-y-2 text-sm">
          <p className="text-red-800">This removes your profile, scores and streaks. Payment records are kept as the law requires. Type <b>DELETE</b> to confirm.</p>
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="px-3 py-2 border rounded-xl text-sm" />
          {needWallet ? (
            <div className="space-y-2">
              <p className="text-red-800">{needWallet}</p>
              <button onClick={() => del(true)} className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs">Give up my wallet balance and delete</button>
            </div>
          ) : <button onClick={() => del(false)} disabled={confirm !== 'DELETE'} className="px-3 py-2 rounded-xl bg-red-600 text-white text-xs disabled:opacity-40">Delete forever</button>}
        </div>
      )}
      */}
    </div>
  );
}
