import React, { useCallback, useEffect, useState } from 'react';
import { Trophy, Flame, Shield, Crown, Users, UserPlus, UserCheck, Award, EyeOff } from 'lucide-react';
import { Tabs } from '../components/admin/v1/AdminV1Kit';
import { api } from '../services/api';
import AvatarImg from '../components/ui/AvatarImg';
import { useToast, StudentPage } from '../components/ui/index.jsx';
import { LeaderboardV21 } from '../components/v1/ReadinessV21';
import { useReadinessV21 } from '../components/v1/readinessV21Hooks';

/**
 * Leaderboard (feature-updates.md §4): same-class boards by school, district,
 * state and India; weekly league; friends; Hall of Fame; Diamond tournament.
 * Students cannot hide — they may set an alias or hide their photo.
 */
const SCOPES = [['school', 'My school'], ['district', 'District'], ['state', 'State'], ['india', 'India']];
const PERIODS = [['week', 'This week'], ['month', 'This month'], ['season', 'Season']];
const TABS = [
  { key: 'board', label: 'Class', icon: Trophy },
  { key: 'league', label: 'League', icon: Shield },
  { key: 'friends', label: 'Friends', icon: Users },
  { key: 'tournament', label: 'Tournament', icon: Crown },
  { key: 'hof', label: 'Hall of Fame', icon: Award },
];

/** One empty / off state for every tab, instead of a bare line of text. */
function Empty({ icon: Icon = Trophy, title, body }) {
  return (
    <div className="py-8 px-4 text-center">
      <span className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
        <Icon size={20} />
      </span>
      <p className="text-sm font-bold text-slate-900 mt-3">{title}</p>
      {body && <p className="text-sm text-slate-500 mt-1 max-w-sm mx-auto">{body}</p>}
    </div>
  );
}

function Row({ r, follow }) {
  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl ${r.is_me ? 'border' : ''}`}
         style={r.is_me ? { background: 'color-mix(in srgb, var(--accent) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--accent) 30%, transparent)' } : undefined}>
      <span className={`w-8 text-center font-black ${r.rank <= 3 ? 'text-amber-500' : 'text-slate-400'}`}>{r.rank}</span>
      <AvatarImg src={r.photo} alt="" className="w-8 h-8 rounded-full object-cover bg-slate-100" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-slate-900 truncate">{r.name}{r.is_me && ' (you)'}</p>
        {(r.institute || r.league) && <p className="text-[11px] text-slate-500 truncate">{[r.institute, r.league].filter(Boolean).join(' · ')}</p>}
      </div>
      {r.stage_streak > 0 && <span className="text-xs text-orange-600 inline-flex items-center gap-0.5"><Flame size={12} />{r.stage_streak}</span>}
      <span className="text-sm font-bold text-slate-900 w-16 text-right">{Math.round(r.points)}</span>
      {follow && !r.is_me && r.user_id && (
        <button onClick={() => follow.toggle(r.user_id)} title={follow.ids.has(r.user_id) ? 'Unfollow' : 'Follow'}
                className={`p-1.5 rounded-lg ${follow.ids.has(r.user_id) ? 'text-blue-600' : 'text-slate-400 hover:text-blue-600'}`}>
          {follow.ids.has(r.user_id) ? <UserCheck size={15} /> : <UserPlus size={15} />}
        </button>
      )}
    </div>
  );
}

function Pills({ items, value, onChange }) {
  return (
    // A segmented control: one track, the chosen option raised on it.
    <div className="flex bg-slate-100 p-1 rounded-xl w-full sm:w-fit">
      {items.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} aria-pressed={value === k}
                className={`flex-1 sm:flex-none px-2 sm:px-3 min-h-10 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${value === k ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>{l}</button>
      ))}
    </div>
  );
}

function Privacy() {
  const toast = useToast();
  const [p, setP] = useState(null);
  useEffect(() => { api.get('/gamification/board/profile').then(({ data }) => data?.bool && setP(data.response)).catch(() => {}); }, []);
  if (!p) return null;
  const save = async (body) => {
    const { data } = await api.put('/gamification/board/profile', body);
    if (data?.bool) { setP(data.response); toast.success('Saved.'); } else toast.error(data?.response?.message || 'Could not save.');
  };
  return (
    <details className="bg-white border border-slate-200 rounded-2xl p-4 text-sm">
      <summary className="font-semibold text-slate-900 cursor-pointer min-h-6 inline-flex items-center gap-2"><EyeOff size={15} className="text-slate-400" /> How I appear</summary>
      <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
        <input defaultValue={p.alias || ''} id="lb-alias" placeholder="Alias (optional)" className="flex-1 min-w-0 min-h-11 px-3 border border-slate-200 rounded-xl text-sm" />
        <button onClick={() => save({ alias: document.getElementById('lb-alias').value })}
                className="min-h-11 px-4 rounded-xl text-white text-sm font-semibold" style={{ backgroundColor: 'var(--accent)' }}>Save alias</button>
      </div>
      <label className="mt-3 inline-flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={p.hide_photo} onChange={(e) => save({ hide_photo: e.target.checked })} /> Hide my photo</label>
      <p className="text-[11px] text-slate-500 mt-2">Your phone number is never shown. Everyone in your class appears on the board.</p>
    </details>
  );
}

// Follow from the board (§7 item 7): followed classmates fill the Friends tab,
// friends' feed. The server refuses while Friends is off.
function useFollow() {
  const toast = useToast();
  const [ids, setIds] = useState(new Set());
  useEffect(() => {
    api.get('/engagement/following').then(({ data }) => data?.bool && setIds(new Set(data.response.following.map((f) => f.user_id)))).catch(() => {});
  }, []);
  const toggle = async (uid) => {
    const on = !ids.has(uid);
    const { data } = on ? await api.post(`/engagement/follow/${uid}`, {}) : await api.delete(`/engagement/follow/${uid}`);
    if (!data?.bool) { toast.error(data?.response?.message || 'Could not do that.'); return; }
    setIds((p) => { const n = new Set(p); if (on) n.add(uid); else n.delete(uid); return n; });
  };
  return { ids, toggle };
}

function LegacyLeaderboard() {
  const follow = useFollow();
  const [tab, setTab] = useState('board');
  const [scope, setScope] = useState('school');
  const [period, setPeriod] = useState('week');
  const [branch, setBranch] = useState(false);
  const [res, setRes] = useState({ key: '', d: null });
  const key = `${tab}|${scope}|${period}|${branch}`;
  const d = res.key === key ? res.d : null;

  const load = useCallback(() => {
    const k = `${tab}|${scope}|${period}|${branch}`;
    const setD = (v) => setRes({ key: k, d: v });
    const url = { board: '/gamification/board', league: '/gamification/league', friends: '/engagement/friends-board',
                  tournament: '/gamification/tournament', hof: '/gamification/hall-of-fame' }[tab];
    const params = tab === 'board' ? { scope, period, branch: branch ? 1 : 0 } : undefined;
    api.get(url, params).then(({ data }) => setD(data?.bool ? data.response : { error: data?.response?.message || 'Could not load.' }))
      .catch(() => setD({ error: 'Could not load.' }));
  }, [tab, scope, period, branch]);
  useEffect(() => { load(); }, [load]);

  let body = <p className="text-sm text-slate-400">Loading…</p>;
  if (d?.error) body = <p className="text-sm text-red-600 p-2">{d.error}</p>;
  else if (d && d.enabled === false) body = <Empty title="The leaderboard is not switched on yet" body="Check back soon to see how you rank against your class." />;
  else if (d && tab === 'board') {
    body = d.no_stage ? <Empty title="Add your class to join a board" body="Set your class in your profile and you will appear here." /> : (
      <div className="space-y-1">
        {d.rows.length === 0 && <Empty title={`No points yet this ${period}`} body="Points from tasks, cohorts and practice show up here." />}
        {d.rows.map((r) => <Row key={r.user_id} r={r} follow={follow} />)}
        {d.me && !d.rows.some((r) => r.is_me) && <><div className="text-center text-slate-300">⋯</div><Row r={{ ...d.me, is_me: true }} /></>}
      </div>
    );
  } else if (d && tab === 'league') {
    body = d.tier_index === null || d.tier_index === undefined ? <Empty icon={Shield} title="No league yet" body="You join a league after your first points this week." /> : (
      <div className="space-y-3">
        <div className="flex items-center justify-between bg-gradient-to-r from-indigo-600 to-violet-600 text-white rounded-2xl p-4">
          <div><p className="text-xs opacity-80">Your league</p><p className="text-xl font-black">{d.tier}</p></div>
          <p className="text-xs text-right opacity-90">Top {d.promote_count} move up<br />Bottom {d.demote_count} move down</p>
        </div>
        {d.last_result && <p className="text-xs text-slate-500">Last week: rank {d.last_result.rank} — {d.last_result.result}</p>}
        {d.members.map((r, i) => (
          <div key={r.user_id}>
            {i === d.promote_count && <div className="text-[10px] text-emerald-600 font-semibold border-t border-emerald-200 pt-1">▲ promotion zone above</div>}
            <Row r={r} follow={follow} />
            {d.demote_count > 0 && i === d.members.length - d.demote_count - 1 && <div className="text-[10px] text-red-600 font-semibold border-b border-red-200 pb-1">▼ demotion zone below</div>}
          </div>
        ))}
      </div>
    );
  } else if (d && tab === 'friends') {
    body = d.rows.length ? <div className="space-y-1">{d.rows.map((r, i) => <Row key={r.user_id} r={{ ...r, rank: i + 1 }} follow={follow} />)}</div>
      : <Empty icon={Users} title="No friends yet" body="Tap the follow icon next to a classmate on the Class board to see them here." />;
  } else if (d && tab === 'tournament') {
    body = !d.tournament ? <Empty icon={Crown} title="No tournament right now" body="When one starts for your class, the standings show here." /> : (
      <div className="space-y-2">
        <p className="text-sm font-bold">{d.tournament.label} <span className="text-xs font-normal text-slate-500">{d.tournament.starts_on} → {d.tournament.ends_on}</span></p>
        {d.tournament.rows.map((r) => <Row key={r.user_id} r={r} follow={follow} />)}
      </div>
    );
  } else if (d && tab === 'hof') {
    body = d.entries.length ? (
      <div className="space-y-1">{d.entries.map((e, i) => (
        <div key={i} className={`flex gap-3 text-sm px-3 py-2 rounded-xl ${e.is_me ? 'bg-amber-50' : ''}`}>
          <span className="font-black text-amber-500 w-6">#{e.rank}</span><span className="flex-1">{e.name}</span>
          <span className="text-xs text-slate-500">{e.season} · {e.scope} {e.scope_value}</span>
        </div>))}</div>
    ) : <Empty icon={Award} title="Hall of Fame is empty" body="It fills with the top students at the end of each season." />;
  }

  return (
    <StudentPage>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Leaderboard</h1>
          <p className="text-sm text-slate-500 mt-0.5">See where you stand in your class, your league and with friends.</p>
        </div>
        <Tabs active={tab} onChange={setTab} tabs={TABS} />
        {tab === 'board' && d?.enabled !== false && (
          <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
            <Pills items={SCOPES} value={scope} onChange={setScope} />
            <Pills items={PERIODS} value={period} onChange={setPeriod} />
            <label className="inline-flex items-center gap-2 min-h-10 text-sm text-slate-600"><input type="checkbox" checked={branch} onChange={(e) => setBranch(e.target.checked)} /> Only my branch</label>
          </div>
        )}
        <div className="bg-white border border-slate-200 rounded-2xl p-3">{body}</div>
        <Privacy />
      </div>
    </StudentPage>
  );
}


/** Playbook v2.1: once the admin switches the new engine on, this page shows it. */
export default function Leaderboard(props) {
  const v21 = useReadinessV21();
  if (v21 === null) return null;
  return v21 ? <LeaderboardV21 /> : <LegacyLeaderboard {...props} />;
}
