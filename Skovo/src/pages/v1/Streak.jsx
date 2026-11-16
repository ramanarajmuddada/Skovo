import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Flame, Zap, Snowflake, UserPlus, Users, Trophy, X, Share2, Copy, QrCode, MessageCircle } from 'lucide-react';
import { api } from '../../services/api';
import { useToast, StudentPage, Modal } from '../../components/ui/index.jsx';
import { ConfirmModal } from '../../components/ui/TableComponents';
import { Navigate } from 'react-router-dom';
import { useReadinessV21 } from '../../components/v1/readinessV21Hooks';

// Keys are what streak_days.kind actually stores. The map used kept / frozen /
// restored, which never matched 'action' / 'freeze', so every day drew grey.
const KIND = {
  action:  { cls: 'bg-orange-500', label: 'Kept' },
  freeze:  { cls: 'bg-sky-400',    label: 'Freeze' },
  exam:    { cls: 'bg-violet-500', label: 'Exam break' },
  restore: { cls: 'bg-orange-300', label: 'Restored' },   // history only — restore was removed
  missed:  { cls: 'bg-slate-200',  label: 'Missed' },
};
const LEGEND = ['action', 'freeze', 'exam', 'missed'];
const fmtDay = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/* Share an invite: WhatsApp, any app (phone share sheet), copy the link, or a
   QR for a friend sitting next to you. The link opens the Streak page with the
   code filled in, so nobody types it. */
function SharePanel({ invite, onClose }) {
  const toast = useToast();
  const [qr, setQr] = useState(false);
  if (!invite) return null;
  const link = `${window.location.origin}/streak?${invite.kind}=${invite.code}`;
  const text = invite.kind === 'group'
    ? `👥 Join my study group "${invite.name}" on Skovo — we keep a streak together. Tap: ${link}  (code ${invite.code})`
    : `🔥 Start a study streak with me on Skovo! Tap: ${link}  (code ${invite.code})`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); toast.success('Link copied'); }
    catch { toast.error('Could not copy — share the code instead.'); }
  };
  return (
    <Modal isOpen onClose={onClose} title={invite.kind === 'group' ? 'Invite to your group' : 'Invite a buddy'} size="sm">
      <p className="text-sm text-slate-600">Code <strong className="font-mono tracking-wider">{invite.code}</strong></p>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"
           className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl bg-emerald-600 text-white text-sm font-semibold">
          <MessageCircle size={15} /> WhatsApp
        </a>
        {typeof navigator !== 'undefined' && navigator.share ? (
          <button type="button" onClick={() => navigator.share({ title: 'Skovo streak', text, url: link }).catch(() => {})}
                  className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border text-sm font-semibold">
            <Share2 size={15} /> Share
          </button>
        ) : (
          <button type="button" onClick={copy}
                  className="inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border text-sm font-semibold">
            <Copy size={15} /> Copy link
          </button>
        )}
        <button type="button" onClick={() => setQr((v) => !v)}
                className="col-span-2 inline-flex items-center justify-center gap-1.5 min-h-11 rounded-xl border text-sm font-semibold">
          <QrCode size={15} /> {qr ? 'Hide QR code' : 'Show QR code'}
        </button>
      </div>
      {qr && (
        <div className="mt-3 flex flex-col items-center gap-2">
          {/* White box so the code scans on a dark theme too. */}
          <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={link} size={180} /></div>
          <p className="text-xs text-slate-500 text-center">Your friend scans this with their phone camera.</p>
        </div>
      )}
    </Modal>
  );
}

/** Streak page (feature-updates.md §6): two counters, calendar, freezes,
 *  daily goal and buddy streaks. */
function LegacyStreak() {
  const toast = useToast();
  const [s, setS] = useState(null);
  const [goal, setGoal] = useState(null);
  const [buddies, setBuddies] = useState({ buddies: [], max: 0 });
  const [code, setCode] = useState('');
  const [endBuddy, setEndBuddy] = useState(null);   // buddy row waiting on "End?"
  const [grp, setGrp] = useState({ enabled: false, groups: [], min: 3, max: 5, per_student: 1 });
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [leaveGroup, setLeaveGroup] = useState(null);
  const [board, setBoard] = useState({ enabled: false, pairs: [], groups: [] });
  const [share, setShare] = useState(null);          // { kind, code, name } — the share panel
  // An invite link (/streak?buddy=CODE or ?group=CODE) asks to join on arrival.
  const [params, setParams] = useSearchParams();
  const [linkJoin, setLinkJoin] = useState(() => {
    const b = params.get('buddy'); const g = params.get('group');
    return b ? { kind: 'buddy', code: b } : g ? { kind: 'group', code: g } : null;
  });
  const clearLink = () => {
    setLinkJoin(null);
    setParams((prev) => { const n = new URLSearchParams(prev); n.delete('buddy'); n.delete('group'); return n; }, { replace: true });
  };
  const nudge = (userId) => call(() => api.post('/gamification/streak/nudge', { user_id: userId }), 'Nudge sent 👋');

  const load = useCallback(() => {
    api.get('/gamification/streak').then(({ data }) => data?.bool && setS(data.response)).catch(() => {});
    api.get('/engagement/today').then(({ data }) => data?.bool && setGoal(data.response.goal)).catch(() => {});
    api.get('/gamification/streak/buddies').then(({ data }) => data?.bool && setBuddies(data.response)).catch(() => {});
    api.get('/gamification/streak/groups').then(({ data }) => data?.bool && setGrp(data.response)).catch(() => {});
    api.get('/gamification/streak/social-leaderboard').then(({ data }) => data?.bool && setBoard(data.response)).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async (fn, ok) => {
    try {
      const { data } = await fn();
      if (data?.bool) { if (ok) toast.success(data.response?.message || ok); load(); return data.response; }
      toast.error(data?.response?.message || 'Could not do that.');
    } catch { toast.error('Could not do that.'); }
    return null;
  };

  if (!s) return <StudentPage><p className="text-sm text-slate-400">Loading…</p></StudentPage>;
  if (!s.enabled) return <StudentPage><p className="text-sm text-slate-500">Streaks are not switched on yet.</p></StudentPage>;

  return (
    <StudentPage>
      <SharePanel invite={share} onClose={() => setShare(null)} />
      {linkJoin && (
        <ConfirmModal
          message={linkJoin.kind === 'group' ? 'Join this study group?' : 'Start a buddy streak?'}
          detail={`Invite code ${linkJoin.code}. ${linkJoin.kind === 'group'
            ? 'The group streak grows on days every member does one task.'
            : 'Your shared streak grows on days you both do one task.'}`}
          confirmLabel="Join"
          onConfirm={() => {
            const j = linkJoin; clearLink();
            call(() => (j.kind === 'group'
              ? api.post('/gamification/streak/groups/join', { code: j.code })
              : api.post('/gamification/streak/buddies/accept', { code: j.code })), 'Joined');
          }}
          onCancel={clearLink}
        />
      )}
      {leaveGroup && (
        <ConfirmModal
          danger
          message={`Leave "${leaveGroup.name}"?`}
          detail="The group carries on without you. Your own streak is not affected."
          confirmLabel="Leave"
          onConfirm={() => { const g = leaveGroup; setLeaveGroup(null); call(() => api.delete(`/gamification/streak/groups/${g.id}`), 'Left'); }}
          onCancel={() => setLeaveGroup(null)}
        />
      )}
      {endBuddy && (
        <ConfirmModal
          danger
          message={endBuddy.status === 'pending' ? 'Cancel this invite?' : `End your buddy streak with ${endBuddy.buddy_name}?`}
          detail={endBuddy.status === 'pending' ? undefined : `Your shared ${endBuddy.current}-day streak ends. Your own streak is not affected.`}
          confirmLabel={endBuddy.status === 'pending' ? 'Cancel invite' : 'End'}
          onConfirm={() => { const b = endBuddy; setEndBuddy(null); call(() => api.delete(`/gamification/streak/buddies/${b.id}`), 'Ended'); }}
          onCancel={() => setEndBuddy(null)}
        />
      )}
      <div className="space-y-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Streak</h1>
          <p className="text-sm text-slate-500 mt-0.5">Do one task, lesson or quiz a day to keep it going.</p>
        </div>
        {/* Three matching tiles; freezes moved in from a loose chip that
            rendered bright white in dark mode. */}
        <div className={`grid gap-3 ${s.freezes_on ? 'grid-cols-2 lg:grid-cols-3' : 'grid-cols-2'}`}>
          <div className="bg-gradient-to-br from-orange-500 to-red-500 text-white rounded-2xl p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-wide opacity-90">Lifetime</p>
              <Flame size={18} />
            </div>
            <p className="text-3xl font-black mt-1">{s.lifetime_current}</p>
            <p className="text-xs opacity-90">days · best {s.lifetime_best}</p>
          </div>
          <div className="bg-white border border-slate-200 rounded-2xl p-4">
            <div className="flex items-center justify-between text-slate-500">
              <p className="text-[11px] font-semibold uppercase tracking-wide">This stage</p>
              <Zap size={16} className="text-violet-500" />
            </div>
            <p className="text-3xl font-black text-slate-900 mt-1">{s.stage_current}</p>
            <p className="text-xs text-slate-500">days · best {s.stage_best}</p>
          </div>
          {s.freezes_on && (
            <div className="bg-white border border-slate-200 rounded-2xl p-4 col-span-2 lg:col-span-1">
              <div className="flex items-center justify-between text-slate-500">
                <p className="text-[11px] font-semibold uppercase tracking-wide">Freezes</p>
                <Snowflake size={16} className="text-sky-500" />
              </div>
              <p className="text-3xl font-black text-slate-900 mt-1">{s.freezes_held}<span className="text-base text-slate-400">/{s.freeze_cap}</span></p>
              <p className="text-xs text-slate-500">save a missed day</p>
            </div>
          )}
        </div>

        {/* Exam windows protect the streak on their own — say so, or a student
            studying offline for boards worries about losing it. */}
        {s.exam_window && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-sm font-bold text-violet-900">
              📚 {s.exam_window.label} · {fmtDay(s.exam_window.start)} – {fmtDay(s.exam_window.end)}
            </p>
            <p className="mt-1 text-xs text-violet-800">
              {s.lifetime_current > 0
                ? `Your 🔥 ${s.lifetime_current}-day streak is safe during your exams — no freeze needed. Open Skovo and it still grows; skip a day and it simply holds.`
                : 'Your streak cannot break during your exams. Do one task any day to start it.'}
            </p>
          </div>
        )}
        {!s.exam_window && s.exam_upcoming && (
          <div className="rounded-2xl border border-violet-200 bg-violet-50 p-4">
            <p className="text-sm font-semibold text-violet-900">
              📅 {s.exam_upcoming.label} starts {fmtDay(s.exam_upcoming.start)} — your streak will be protected until {fmtDay(s.exam_upcoming.end)}.
            </p>
          </div>
        )}

        <p className="text-sm text-slate-600">
          {s.kept_today ? 'You kept your streak today ✓' : 'Finish one task, lesson or quiz today to keep your streak.'}
          {s.next_milestone && ` Next milestone: ${s.next_milestone} days.`}
        </p>


        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <h3 className="text-sm font-bold mb-3">Last days</h3>
          {!s.calendar?.length && <p className="text-xs text-slate-400 mb-1">No activity yet — your days fill in here as you keep the streak.</p>}
          <div className="grid grid-cols-7 gap-1.5">
            {s.calendar.map((c) => (
              <div key={c.day} title={`${c.day} · ${c.kind}${c.actions ? ` · ${c.actions} action(s)` : ''}`}
                   className={`aspect-square rounded-lg ${(KIND[c.kind] || KIND.missed).cls}`} />
            ))}
          </div>
          <div className="flex flex-wrap gap-3 mt-3 text-[11px] text-slate-500">
            {LEGEND.filter((k) => k !== 'freeze' || s.freezes_on).map((k) => (
              <span key={k} className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded ${KIND[k].cls}`} />{KIND[k].label}</span>
            ))}
          </div>
        </div>

        {goal && goal.enabled && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
            <h3 className="text-sm font-bold">Daily goal</h3>
            {/* One even row: as wrapped chips the last level sat alone on a phone. */}
            <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
              {goal.levels.map((l) => {
                const on = goal.goal?.level_key === l.level_key;
                return (
                  <button key={l.level_key} onClick={() => call(() => api.put('/engagement/goal', { level_key: l.level_key }), 'Goal saved')}
                          className={`min-h-12 px-2 sm:px-4 rounded-xl border text-center ${on ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-700'}`}
                          style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
                    <span className="block text-sm font-semibold">{l.label}</span>
                    <span className={`block text-[11px] ${on ? 'text-white/80' : 'text-slate-500'}`}>{l.tasks_per_day} a day</span>
                  </button>
                );
              })}
            </div>
            {goal.goal && <p className="text-xs text-slate-500">Today {goal.done_today}/{goal.goal.tasks_per_day} · met {goal.met_days_this_week} day(s) this week</p>}
          </div>
        )}

        {buddies.max > 0 && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold">Buddy streaks <span className="text-xs font-normal text-slate-500">(up to {buddies.max})</span></h3>
            {buddies.buddies.map((b) => (
              <div key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Flame size={16} className="text-orange-500 shrink-0" />
                <span className="flex-1 min-w-0 break-words">
                  {b.status === 'pending'
                    ? `Waiting for your friend · code ${b.invite_code || ''}`
                    : <>{b.buddy_name}: {b.current} days <span className="text-slate-400">(best {b.best})</span>
                        {' · '}{b.buddy_done_today ? '✅ done today' : '⏳ not yet'}</>}
                </span>
                {b.status === 'pending' && b.invite_code && (
                  <button onClick={() => setShare({ kind: 'buddy', code: b.invite_code })}
                          className="inline-flex items-center gap-1 px-2.5 min-h-11 rounded-lg border text-xs font-semibold"><Share2 size={13} /> Share</button>
                )}
                {b.status === 'active' && !b.buddy_done_today && (
                  b.nudged_today
                    ? <span className="text-xs text-slate-400">Nudged 👋</span>
                    : <button onClick={() => nudge(b.buddy_id)}
                              className="px-2.5 min-h-11 rounded-lg bg-amber-50 text-amber-700 text-xs font-semibold">👋 Nudge</button>
                )}
                <button onClick={() => setEndBuddy(b)} aria-label="End buddy streak" className="text-slate-400 min-h-11 min-w-11 flex items-center justify-center"><X size={15} /></button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <button onClick={async () => { const r = await call(() => api.post('/gamification/streak/buddies/invite')); if (r) setShare({ kind: 'buddy', code: r.invite_code }); }}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-xl bg-slate-900 text-white text-sm"><UserPlus size={14} /> Invite a friend</button>
              <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Friend's code" className="px-3 py-2 border rounded-xl text-sm w-36" />
              <button onClick={() => code && call(() => api.post('/gamification/streak/buddies/accept', { code }), 'Started').then(() => setCode(''))}
                      className="px-3 py-2 rounded-xl border text-sm">Join</button>
            </div>
          </div>
        )}

        {/* ── Group streak: 3–5 classmates, grows when every member acts ── */}
        {grp.enabled && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5">
              <Users size={15} /> Group streak
              <span className="text-xs font-normal text-slate-500">({grp.min}–{grp.max} classmates)</span>
            </h3>
            {grp.groups.map((g) => {
              const done = g.members.filter((m) => m.done_today).length;
              return (
                <div key={g.id} className="rounded-xl border border-slate-100 p-3 space-y-2">
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-bold text-slate-900 break-words">👥 {g.name}</p>
                      <p className="text-xs text-slate-500">
                        {g.status === 'forming'
                          ? `Waiting for ${Math.max(0, grp.min - g.members.length)} more to start · share code ${g.invite_code}`
                          : `${g.current} days · best ${g.best} · ${done}/${g.members.length} done today · code ${g.invite_code}`}
                      </p>
                    </div>
                    <button onClick={() => setShare({ kind: 'group', code: g.invite_code, name: g.name })}
                            aria-label={`Share ${g.name}`}
                            className="text-slate-500 min-h-11 min-w-11 flex items-center justify-center"><Share2 size={15} /></button>
                    <button onClick={() => setLeaveGroup(g)} aria-label={`Leave ${g.name}`}
                            className="text-slate-400 min-h-11 min-w-11 flex items-center justify-center"><X size={15} /></button>
                  </div>
                  <ul className="flex flex-wrap gap-1.5">
                    {g.members.map((m) => (
                      <li key={m.user_id} className="flex items-center gap-1">
                        <span className={`text-xs px-2 py-1 rounded-lg ${m.done_today ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                          {m.done_today ? '✅' : '⏳'} {m.is_me ? 'You' : m.name}
                        </span>
                        {!m.is_me && !m.done_today && g.status === 'active' && (
                          m.nudged_today
                            ? <span className="text-[11px] text-slate-400">👋</span>
                            : <button onClick={() => nudge(m.user_id)} aria-label={`Nudge ${m.name}`}
                                      className="text-[11px] px-1.5 min-h-8 rounded-md bg-amber-50 text-amber-700 font-semibold">👋</button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            {grp.groups.length < grp.per_student && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-2">
                  <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name, e.g. SSC Warriors"
                         aria-label="Group name" className="flex-1 min-w-0 px-3 py-2 border rounded-xl text-sm" />
                  <button onClick={async () => {
                            const r = await call(() => api.post('/gamification/streak/groups', { name: groupName }));
                            if (r) { setShare({ kind: 'group', code: r.invite_code, name: groupName }); setGroupName(''); }
                          }}
                          className="px-3 py-2 rounded-xl bg-slate-900 text-white text-sm">Create</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <input value={groupCode} onChange={(e) => setGroupCode(e.target.value)} placeholder="Group code"
                         aria-label="Group code" className="flex-1 min-w-0 px-3 py-2 border rounded-xl text-sm" />
                  <button onClick={() => groupCode && call(() => api.post('/gamification/streak/groups/join', { code: groupCode }), 'Joined').then(() => setGroupCode(''))}
                          className="px-3 py-2 rounded-xl border text-sm">Join</button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Leaderboard: own class only ── */}
        {board.enabled && (board.pairs.length > 0 || board.groups.length > 0) && (
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
            <h3 className="text-sm font-bold flex items-center gap-1.5"><Trophy size={15} /> Top streaks in your class</h3>
            {[['🤝 Buddies', board.pairs], ['👥 Groups', board.groups]].map(([title, rows]) => rows.length > 0 && (
              <div key={title}>
                <p className="text-xs font-semibold text-slate-500 mb-1">{title}</p>
                <ol className="space-y-1">
                  {rows.map((r, i) => (
                    <li key={r.id} className={`flex items-center gap-2 text-sm rounded-lg px-2 py-1 ${r.mine ? 'bg-orange-50 font-semibold' : ''}`}>
                      <span className="w-5 text-slate-400 tabular-nums">{i + 1}.</span>
                      <span className="flex-1 min-w-0 break-words">{r.name}{r.mine ? ' (you)' : ''}</span>
                      <span className="tabular-nums">{r.current} days</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </div>
    </StudentPage>
  );
}


/** v2.1: the one day streak lives on My Readiness; buddies, groups and freezes are retired. */
export default function Streak() {
  const v21 = useReadinessV21();
  if (v21 === null) return null;
  return v21 ? <Navigate to="/my-score" replace /> : <LegacyStreak />;
}
