import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Zap, Heart, RotateCcw, Award, Users, Sparkles } from 'lucide-react';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { api } from '../../services/api';
import { useToast, StudentPage } from '../../components/ui/index.jsx';
import QuizPlayer, { QuestionInput, ReviewList } from '../../components/v1/QuizPlayer';

/**
 * Practice hub (feature-updates.md §7): My Mistakes, speed round,
 * achievements, friends' feed.
 * Each tab says so when the admin has not switched it on.
 */
const TABS = [
  { key: 'mistakes', label: 'Mistakes', icon: RotateCcw },
  { key: 'speed', label: 'Speed round', icon: Zap },
  { key: 'achievements', label: 'Badges', icon: Award },
  { key: 'feed', label: 'Friends', icon: Users },
];
/** One empty / off card for every tab, instead of a bare line of text. */
function Note({ icon: Icon = Sparkles, title, body, children }) {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 text-center">
      <span className="mx-auto w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
        <Icon size={20} />
      </span>
      <p className="text-sm font-bold text-slate-900 mt-3">{title}</p>
      {body && <p className="text-sm text-slate-500 mt-1 max-w-md mx-auto">{body}</p>}
      {children}
    </div>
  );
}
const Off = ({ what }) => <Note title={`${what} is not switched on yet`} body="Check back soon." />;

function useLoad(url) {
  const [d, setD] = useState(null);
  const load = useCallback(() => { api.get(url).then(({ data }) => setD(data?.bool ? data.response : { error: true })).catch(() => setD({ error: true })); }, [url]);
  useEffect(() => { load(); }, [load]);
  return [d, load];
}

/* One running speed round. */
function Runner({ run, onDone }) {
  const [result, setResult] = useState(null);
  const toast = useToast();
  const submit = async (answers) => {
    const { data } = await api.post(run.submitUrl, { token: run.token, answers });
    if (data?.bool) setResult(data.response); else { toast.error(data?.response?.message || 'Could not submit.'); onDone(); }
  };
  if (result) {
    const title = `${result.correct}/${result.total} right`;
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-bold">{title}</h2>
        {result.review && <ReviewList questions={result.review} />}
        <button onClick={onDone} className="px-4 py-2 rounded-xl bg-slate-900 text-white text-sm">Back</button>
      </div>
    );
  }
  return <QuizPlayer title={run.title} questions={run.questions} seconds={run.seconds || null} onSubmit={submit} />;
}

function Mistakes() {
  const [d, load] = useLoad('/engagement/mistakes');
  const [ans, setAns] = useState({});
  const [res, setRes] = useState({});
  if (!d) return null;
  if (!d.enabled) return <Off what="My Mistakes" />;
  if (!d.questions.length) return <Note icon={RotateCcw} title="Nothing to retry today" body="Questions you get wrong in quizzes come back here, so you can try them again." />;
  const check = async (q) => {
    const { data } = await api.post(`/engagement/mistakes/${q.id}/answer`, { answer: ans[q.id] });
    if (data?.bool) setRes((p) => ({ ...p, [q.id]: data.response }));
  };
  return (
    <div className="space-y-3">
      {d.questions.map((q) => (
        <div key={q.id} className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <p className="text-sm" lang={q.lang}>{q.text}</p>
          <QuestionInput q={q} value={ans[q.id]} onChange={(v) => setAns((p) => ({ ...p, [q.id]: v }))} disabled={!!res[q.id]} />
          {res[q.id] ? (
            <p className={`text-xs ${res[q.id].correct ? 'text-emerald-700' : 'text-red-700'}`}>
              {res[q.id].correct ? 'Right! ' : `Answer: ${res[q.id].correct_answer}. `}{res[q.id].explanation}
            </p>
          ) : <button onClick={() => check(q)} disabled={!ans[q.id]} className="px-3 py-1.5 rounded-xl bg-blue-600 text-white text-xs disabled:opacity-40">Check</button>}
        </div>
      ))}
      <button onClick={() => { setAns({}); setRes({}); load(); }} className="text-xs text-blue-700">Refresh</button>
    </div>
  );
}

const TIER_TONE = {
  bronze: 'bg-orange-50 text-orange-600', silver: 'bg-slate-100 text-slate-500',
  gold: 'bg-amber-50 text-amber-500', platinum: 'bg-violet-50 text-violet-600',
};

function Achievements() {
  const [d] = useLoad('/engagement/achievements');
  if (!d) return null;
  if (!d.enabled) return <Off what="Achievements" />;
  return (
    <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
      {d.achievements.map((a) => {
        // The medal takes the colour of the best tier earned; grey until then.
        const best = (a.earned || [])[a.earned.length - 1];
        const tone = TIER_TONE[String(best || '').toLowerCase()] || 'bg-slate-100 text-slate-400';
        const pct = a.next ? Math.min(100, (a.value / a.next.target) * 100) : 100;
        return (
          <div key={a.key} className="bg-white border border-slate-200 rounded-2xl p-4 flex items-start gap-3">
            <span className={`shrink-0 w-11 h-11 rounded-xl flex items-center justify-center ${tone}`}><Award size={20} /></span>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-sm font-bold text-slate-900">{a.label}</p>
                {best && <span className="text-[11px] font-semibold capitalize text-slate-500">{best}</span>}
              </div>
              <p className="text-xs text-slate-500">{a.earned.length ? `Earned: ${a.earned.join(', ')}` : 'Not earned yet'}</p>
              {a.next && (
                <>
                  <div className="mt-2 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1">{a.value}/{a.next.target} to <span className="capitalize">{a.next.tier}</span></p>
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Following() {
  const [d, load] = useLoad('/engagement/following');
  if (!d?.following?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-3">
      <p className="text-xs font-bold text-slate-600 mb-2">Following ({d.following.length})</p>
      <div className="flex flex-wrap gap-2">
        {d.following.map((f) => (
          <span key={f.user_id} className="inline-flex items-center gap-1 text-xs bg-slate-100 rounded-full pl-3 pr-1 py-1">
            {f.name}{f.follows_back && ' · follows you'}
            <button onClick={async () => { await api.delete(`/engagement/follow/${f.user_id}`); load(); }} className="px-1.5 text-slate-400 hover:text-red-600" aria-label="Unfollow">×</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function Feed() {
  const [d, load] = useLoad('/engagement/feed');
  if (!d) return null;
  if (d.error) return <Off what="Friends" />;
  if (!d.items.length) return <div className="space-y-3"><Following /><Note icon={Users} title="No friend activity yet" body="Follow classmates from the Leaderboard to see their wins here." /></div>;
  return (
    <div className="space-y-2">
      <Following />
      {d.items.map((f) => (
        <div key={f.id} className="bg-white border border-slate-200 rounded-2xl p-3 flex items-center gap-3 text-sm">
          <span className="flex-1"><b>{f.name}</b> {f.text}</span>
          <button onClick={async () => { await api.post(`/engagement/feed/${f.id}/cheer`); load(); }} disabled={f.cheered}
                  className={`inline-flex items-center gap-1 text-xs ${f.cheered ? 'text-rose-600' : 'text-slate-500'}`}><Heart size={14} fill={f.cheered ? 'currentColor' : 'none'} /> {f.cheers}</button>
        </div>
      ))}
    </div>
  );
}

export default function Practice() {
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'mistakes';
  const [run, setRun] = useState(null);

  const start = async (url, submitUrl, kind, body) => {
    const { data } = await api.post(url, body || {});
    if (data?.bool) setRun({ ...data.response, submitUrl, kind });
    else toast.error(data?.response?.message || 'Could not start.');
  };

  return (
    <StudentPage>
      <div className="space-y-4">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Practice</h1>
          <p className="text-sm text-slate-500 mt-0.5">Retry your mistakes, race the clock, and collect badges.</p>
        </div>
        {run ? <Runner run={run} onDone={() => setRun(null)} /> : (
          <>
            <Tabs active={tab} onChange={(k) => setSp({ tab: k })} tabs={TABS} />
            {tab === 'mistakes' && <Mistakes />}
            {tab === 'speed' && (
              <Note icon={Zap} title="Speed round" body="Answer as many as you can before the timer ends.">
                <button onClick={() => start('/engagement/speed/start', '/engagement/speed/submit', 'speed')}
                        className="mt-4 min-h-11 px-6 rounded-xl text-white text-sm font-semibold"
                        style={{ backgroundColor: 'var(--accent)' }}>Start speed round</button>
              </Note>
            )}
            {tab === 'achievements' && <Achievements />}
            {tab === 'feed' && <Feed />}
          </>
        )}
      </div>
    </StudentPage>
  );
}
