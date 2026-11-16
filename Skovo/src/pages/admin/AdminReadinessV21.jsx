import React, { useCallback, useEffect, useState } from 'react';
import {
  Gauge, ClipboardCheck, ListChecks, Flame, Layers, Settings2, History, CheckCircle2, XCircle, Users, Clock,
} from 'lucide-react';
import StatTile from '../../components/admin/StatTile';
import { adminApi } from '../../services/api';
import { Modal, useToast } from '../../components/ui/index.jsx';
import FormSelect from '../../components/ui/FormSelect';
import { SettingsCard, CrudTable, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';

const A = '/skovo-platform-panel-admin';
const msgOf = (data, fb) => data?.response?.message || fb;

const CARDS = [
  { value: 'class10', label: 'Class 10' }, { value: 'inter', label: 'Intermediate' },
  { value: 'degree_foundation', label: 'Degree Foundation' }, { value: 'degree_readiness', label: 'Degree Readiness' },
  { value: 'skill', label: 'Skill Card' },
];
const PILLARS = [{ value: 'clarity', label: 'Clarity' }, { value: 'skill', label: 'Skill' }, { value: 'proof', label: 'Proof' }];
const LIMITS = [
  { value: 'per_card', label: 'Per card' }, { value: 'per_month', label: 'Per card month' }, { value: 'each', label: 'Each time (no limit)' },
];
const SP_LIMITS = [
  { value: 'daily', label: 'Per day' }, { value: 'weekly', label: 'Per week' }, { value: 'monthly', label: 'Per month' },
  { value: 'total', label: 'In total' }, { value: 'each', label: 'Each time' },
];
const CHECKERS = [
  { value: 'app', label: 'App' }, { value: 'achiever', label: 'Achiever' }, { value: 'ops', label: 'Verification desk' },
  { value: 'employer', label: 'Employer' }, { value: 'bhaai', label: 'BhaAI' },
];
const REASON = { key: 'reason', label: 'Reason for this change', type: 'text', required: true, hint: 'Saved in the change log. Points already earned never drop.' };
const WHEN = { key: 'effective_from', label: 'Effective from (blank = now)', type: 'date' };

const TABS = [
  { key: 'overview', label: 'Overview', icon: Gauge },
  { key: 'queue', label: 'Verification', icon: ClipboardCheck },
  { key: 'readiness', label: 'Readiness rules', icon: ListChecks },
  { key: 'sp', label: 'Streak Points', icon: Flame },
  { key: 'buckets', label: 'Buckets & bands', icon: Layers },
  { key: 'settings', label: 'Settings', icon: Settings2 },
  { key: 'log', label: 'Change log', icon: History },
];

/** Readiness Score Playbook v2.1: readiness (checked proof) and Streak Points (habit) — two separate books. */
export default function AdminReadinessV21() {
  const [tab, setTab] = useState('overview');
  return (
    <PageShell title="Readiness & Streak Points"
               subtitle="Readiness grows only from checked work, per Journey Card (70 earned + 30 completion). Streak Points reward daily use and never become readiness.">
      <Tabs tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'overview' && <Overview />}
      {tab === 'queue' && <Queue />}
      {tab === 'readiness' && <ReadinessRules />}
      {tab === 'sp' && <SpRules />}
      {tab === 'buckets' && <BucketsBands />}
      {tab === 'settings' && <Settings />}
      {tab === 'log' && <ChangeLog />}
    </PageShell>
  );
}

function Overview() {
  const [d, setD] = useState(null);
  useEffect(() => {
    adminApi.get(`${A}/v21/overview`).then(({ data }) => data?.bool && setD(data.response)).catch(() => {});
  }, []);
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  const pending = (d.queue || []).reduce((n, q) => n + Number(q.n || 0), 0);
  const overdue = (d.queue || []).reduce((n, q) => n + Number(q.overdue || 0), 0);
  return (
    <div className="space-y-4">
      {!d.enabled && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3.5 text-sm text-amber-800">
          The new engine is <b>off</b>. Students still see the old score. Switch it on in <b>Settings → Readiness</b> once the rules are ready.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile label="Waiting for a check" value={pending} icon={ClipboardCheck} tone="blue" />
        <StatTile label="Over 36 hours" value={overdue} icon={Clock} tone={overdue ? 'amber' : 'emerald'} />
        <StatTile label="Students on cards" value={Object.values(d.by_card || {}).reduce((n, b) => n + b.students, 0)} icon={Users} tone="violet" />
        <StatTile label="Unlocked (60+)" value={Object.values(d.by_card || {}).reduce((n, b) => n + b.unlocked, 0)} icon={CheckCircle2} tone="emerald" />
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 text-sm font-bold text-slate-800">Scores by card</div>
        <div className="divide-y divide-slate-100">
          {CARDS.map((c) => {
            const b = (d.by_card || {})[c.value] || { students: 0, unlocked: 0, avg_earned: 0 };
            return (
              <div key={c.value} className="px-4 py-3 grid grid-cols-3 gap-2 text-sm">
                <span className="font-semibold text-slate-700">{c.label}</span>
                <span className="text-slate-500">{b.students} students · {b.unlocked} unlocked</span>
                <span className="text-right text-slate-700">avg {b.avg_earned} / 70</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Queue() {
  const toast = useToast();
  const [route, setRoute] = useState('');
  const [rows, setRows] = useState(null);
  const [bands, setBands] = useState([]);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState({});
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    adminApi.get(`${A}/v21/verifications?status=pending${route ? `&route=${route}` : ''}`).then(({ data }) => {
      if (data?.bool) { setRows(data.response.requests || []); setBands(data.response.bands || []); }
    }).catch(() => toast.error('Could not load the queue.'));
  }, [route, toast]);
  useEffect(() => { load(); }, [load]);

  const decide = async (decision) => {
    setSaving(true);
    try {
      const { data } = await adminApi.post(`${A}/v21/verifications/${open.id}/decision`, { ...form, decision });
      if (data?.bool) { toast.success(msgOf(data, 'Saved.')); setOpen(null); load(); }
      else toast.error(msgOf(data, 'Could not save.'));
    } catch { toast.error('Could not save.'); }
    setSaving(false);
  };

  const label = (r) => (r.kind === 'result' ? 'Result card' : r.kind === 'offer' ? 'Job offer' : r.action_label);
  return (
    <div className="space-y-3">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
        <div className="sm:w-64">
          <FormSelect value={route} onChange={(v) => setRoute(v || '')} placeholder="Everyone's queue"
                      options={[{ value: 'desk', label: 'Verification desk' }, { value: 'achiever', label: 'Achievers' }, { value: 'employer', label: 'Employers' }]} />
        </div>
        <p className="text-xs text-slate-500">Oldest first. Decide within 48 hours; points are added only on approval.</p>
      </div>
      {!rows ? <p className="text-sm text-slate-400">Loading…</p> : !rows.length ? (
        <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">Nothing waiting. 🎉</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="p-3.5 flex flex-col sm:flex-row sm:items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-slate-800 truncate">{r.student_name} · {label(r)}</p>
                <p className="text-xs text-slate-500">
                  {(CARDS.find((c) => c.value === r.card_type) || {}).label || '—'}
                  {r.pillar ? ` · ${r.pillar} +${r.action_points}` : ''} · {r.route_to} ·{' '}
                  <span className={Number(r.age_hours) >= 36 ? 'text-amber-600 font-semibold' : ''}>{r.age_hours} h</span>
                </p>
              </div>
              <div className="flex gap-2">
                {r.evidence_url && (
                  <a href={r.evidence_url} target="_blank" rel="noreferrer"
                     className="px-3 min-h-11 inline-flex items-center rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">Open proof</a>
                )}
                <button type="button" onClick={() => { setOpen(r); setForm({ band: r.auto_check?.suggested_band || '' }); }}
                        className="px-3 min-h-11 rounded-lg text-xs font-semibold bg-violet-600 text-white">Review</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal isOpen={!!open} onClose={() => setOpen(null)} title={open ? `Review — ${label(open)}` : ''}
             footer={(
               <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end w-full">
                 <button type="button" disabled={saving} onClick={() => decide('reject')}
                         className="min-h-11 px-4 rounded-xl text-sm font-semibold bg-red-50 text-red-700 inline-flex items-center justify-center gap-1.5">
                   <XCircle size={16} /> Reject
                 </button>
                 <button type="button" disabled={saving} onClick={() => decide('approve')}
                         className="min-h-11 px-4 rounded-xl text-sm font-semibold bg-emerald-600 text-white inline-flex items-center justify-center gap-1.5">
                   <CheckCircle2 size={16} /> Approve
                 </button>
               </div>
             )}>
        {open && (
          <div className="space-y-3 text-sm">
            <p className="text-slate-600"><b>{open.student_name}</b>{open.note ? ` — “${open.note}”` : ''}</p>
            {open.kind === 'result' && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Result band {open.auto_check?.raw_grade ? `(read: ${open.auto_check.raw_grade})` : ''}</span>
                <FormSelect value={form.band || ''} onChange={(v) => setForm({ ...form, band: v })} placeholder="Choose the band"
                            options={bands.map((b) => ({ value: b.band, label: `${b.label} — ${b.is_pending ? 'pending' : `${b.points} pts`}` }))} />
              </label>
            )}
            {open.route_to === 'achiever' && open.kind === 'evidence' && (
              <label className="block">
                <span className="text-xs font-semibold text-slate-600">Mark out of 10 (correctness 4 · depth 4 · clarity 2; 5+ passes)</span>
                <input type="number" min={0} max={10} value={form.mark ?? ''} onChange={(e) => setForm({ ...form, mark: e.target.value })}
                       className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Mark out of 10" />
              </label>
            )}
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Feedback the student sees (one line)</span>
              <input value={form.feedback || ''} onChange={(e) => setForm({ ...form, feedback: e.target.value })}
                     className="mt-1 w-full min-h-11 rounded-xl border border-slate-200 px-3" aria-label="Feedback" />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-slate-600">Reject reason</span>
              <FormSelect value={form.reason || ''} onChange={(v) => setForm({ ...form, reason: v })} placeholder="Only when rejecting"
                          options={['Name does not match', 'Edited or fake document', 'No issuer or date', 'Duplicate', 'Copied work',
                                    'Broken link', 'Personal email only', 'Unreadable', 'Below the pass mark']
                                    .map((x) => ({ value: x, label: x }))} />
            </label>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ReadinessRules() {
  const [card, setCard] = useState('');
  return (
    <div className="space-y-3">
      <div className="sm:w-64">
        <FormSelect value={card} onChange={(v) => setCard(v || '')} options={CARDS} placeholder="All cards" />
      </div>
      <CrudTable
        key={card} title="Readiness points list" listKey="actions" idKey="action_key"
        description="Checked work only. No action above +5; employer results up to +8. A full bucket adds nothing more."
        listEndpoint={`${A}/v21/actions${card ? `?card=${card}` : ''}`}
        createEndpoint={`${A}/v21/actions`}
        updateEndpoint={(id) => `${A}/v21/actions/${id}`}
        newDefaults={{ is_active: true, limit_type: 'per_card', checked_by: 'achiever', pillar: 'skill', points: 2 }}
        columns={[
          { key: 'label', label: 'Action' }, { key: 'cards_label', label: 'Cards' }, { key: 'pillar', label: 'Pillar' },
          { key: 'points', label: 'Points' }, { key: 'limit_type', label: 'Limit' }, { key: 'limit_value', label: 'Max' },
          { key: 'checked_by', label: 'Checked by' }, { key: 'is_active', label: 'On', bool: true },
        ]}
        fields={[
          { key: 'label', label: 'Action name', type: 'text', required: true },
          { key: 'evidence', label: 'Evidence needed', type: 'text' },
          { key: 'card_types', label: 'Counts on these cards', type: 'multiselect', options: CARDS },
          { key: 'pillar', label: 'Pillar', type: 'select', options: PILLARS },
          { key: 'points', label: 'Points', type: 'int', min: 1, max: 8 },
          { key: 'bonus_points', label: 'Bonus points (blank = none)', type: 'int', min: 1, max: 8, hint: 'e.g. cohort task: +3 instead of +2 when marked 7/10 or above.' },
          { key: 'bonus_min_mark', label: 'Bonus from mark', type: 'int', min: 0, max: 10 },
          { key: 'limit_type', label: 'Limit', type: 'select', options: LIMITS },
          { key: 'limit_value', label: 'How many times', type: 'int', min: 1 },
          { key: 'checked_by', label: 'Checked by', type: 'select', options: CHECKERS },
          { key: 'is_employer', label: 'Employer result (up to +8)', type: 'bool' },
          { key: 'is_active', label: 'On', type: 'bool' },
          REASON, WHEN,
        ]}
      />
    </div>
  );
}

function SpRules() {
  return (
    <CrudTable
      title="Streak Points list" listKey="actions" idKey="sp_action" canCreate={false}
      description="Everyday activity. Adds to lifetime SP (never resets) and weekly SP (resets Monday). Never becomes readiness."
      listEndpoint={`${A}/v21/sp-actions`}
      updateEndpoint={(id) => `${A}/v21/sp-actions/${id}`}
      columns={[
        { key: 'label', label: 'Activity' }, { key: 'points', label: 'SP' }, { key: 'limit_type', label: 'Limit' },
        { key: 'limit_value', label: 'Max' }, { key: 'multiplier_applies', label: 'Streak boost', bool: true },
        { key: 'is_active', label: 'On', bool: true },
      ]}
      fields={[
        { key: 'label', label: 'Activity', type: 'text', required: true },
        { key: 'points', label: 'SP', type: 'int', min: 0 },
        { key: 'limit_type', label: 'Limit', type: 'select', options: SP_LIMITS },
        { key: 'limit_value', label: 'How many times', type: 'int', min: 1 },
        { key: 'multiplier_applies', label: 'Streak multiplier applies', type: 'bool' },
        { key: 'is_active', label: 'On', type: 'bool' },
        REASON, WHEN,
      ]}
    />
  );
}

function BucketsBands() {
  return (
    <div className="space-y-4">
      <CrudTable
        title="Pillar buckets" listKey="buckets" idKey="card_type" canCreate={false}
        description="Clarity + Skill + Proof must add up to the earned maximum (70)."
        listEndpoint={`${A}/v21/buckets`} updateEndpoint={(id) => `${A}/v21/buckets/${id}`}
        columns={[{ key: 'label', label: 'Card' }, { key: 'clarity', label: 'Clarity' }, { key: 'skill', label: 'Skill' },
                  { key: 'proof', label: 'Proof' }, { key: 'total', label: 'Total' }]}
        fields={[{ key: 'clarity', label: 'Clarity', type: 'int', min: 0 }, { key: 'skill', label: 'Skill', type: 'int', min: 0 },
                 { key: 'proof', label: 'Proof', type: 'int', min: 0 }, REASON, WHEN]}
      />
      <CrudTable
        title="Completion bands" listKey="bands" idKey="band" canCreate={false}
        description="The last 30. Earned 65+ moves the band up one. A fail is pending — never a penalty."
        listEndpoint={`${A}/v21/bands`} updateEndpoint={(id) => `${A}/v21/bands/${id}`}
        columns={[{ key: 'label', label: 'Band' }, { key: 'university_grades', label: 'Grades' },
                  { key: 'min_percent', label: 'From %' }, { key: 'points', label: 'Points' }]}
        fields={[{ key: 'label', label: 'Band name', type: 'text' }, { key: 'university_grades', label: 'University grades (comma list)', type: 'text' },
                 { key: 'min_percent', label: 'Board % from', type: 'number' }, { key: 'points', label: 'Points', type: 'int', min: 0, max: 30 },
                 REASON, WHEN]}
      />
      <CrudTable
        title="Grade conversion" listKey="grades"
        description="Board or university grade → band, for results the desk checks."
        listEndpoint={`${A}/v21/grades`} createEndpoint={`${A}/v21/grades`} deleteEndpoint={(id) => `${A}/v21/grades/${id}`}
        columns={[{ key: 'board_or_university', label: 'Board / university' }, { key: 'raw_grade', label: 'Grade' }, { key: 'band', label: 'Band' }]}
        fields={[{ key: 'board_or_university', label: 'Board or university', type: 'text', required: true },
                 { key: 'raw_grade', label: 'Grade as printed', type: 'text', required: true },
                 { key: 'band', label: 'Band', type: 'select', options: [
                   { value: 'top', label: 'Top' }, { value: 'strong', label: 'Strong' }, { value: 'good', label: 'Good' },
                   { value: 'pass', label: 'Pass' }, { value: 'not_yet', label: 'Not yet (pending)' }] }]}
      />
    </div>
  );
}

function Settings() {
  return (
    <div className="space-y-4">
      <SettingsCard
        title="Readiness" endpoint={`${A}/v21/settings/readiness`}
        description="Every change applies forward only and is kept in the change log."
        fields={[
          { key: 'v21_enabled', label: 'New readiness engine on', type: 'bool', hint: 'Off = students see the old score.' },
          { key: 'monthly_cap', label: 'Monthly limit (points a card month)', type: 'int', min: 0 },
          { key: 'cap_months', label: 'Months the limit applies', type: 'int', min: 0 },
          { key: 'unlock_score', label: 'Opportunities unlock at', type: 'int', min: 0, max: 100 },
          { key: 'premium_score', label: 'Skovo Ready / premium at', type: 'int', min: 0, max: 100 },
          { key: 'earned_max', label: 'Earned maximum', type: 'int', min: 0, max: 100 },
          { key: 'completion_max', label: 'Completion maximum', type: 'int', min: 0, max: 100 },
          { key: 'boost_threshold', label: 'Completion boost from earned', type: 'int', min: 0, max: 100 },
          { key: 'boost_bands', label: 'Boost: bands up', type: 'int', min: 0, max: 4 },
          { key: 'max_action_points', label: 'Max points for one action', type: 'int', min: 1 },
          { key: 'max_employer_points', label: 'Max points for an employer result', type: 'int', min: 1 },
          { key: 'pass_mark', label: 'Achiever pass mark (of 10)', type: 'int', min: 0, max: 10 },
          { key: 'active_ready_days', label: 'Active Ready window (days)', type: 'int', min: 1 },
          { key: 'verify_hours', label: 'Decide evidence within (hours)', type: 'int', min: 1 },
          { key: 'escalate_hours', label: 'Escalate after (hours)', type: 'int', min: 1 },
          { key: 'correction_approval_over', label: 'Corrections over N points need approval', type: 'int', min: 0 },
          { key: 'skill_card_months', label: 'Skill Card length (months)', type: 'int', min: 1 },
          { key: 'promotion_on', label: 'Yearly promotion date (MM-DD)', type: 'text' },
          { key: 'ai_weight', label: 'Weight for AI-checked work (0–1)', type: 'number' },
          REASON, WHEN,
        ]}
      />
      <SettingsCard
        title="Day streak & Streak Points" endpoint={`${A}/v21/settings/streak`}
        description="Lifetime SP never resets. Weekly SP resets on the reset day. A broken streak only loses the multiplier."
        fields={[
          { key: 'streak_seconds', label: 'Seconds in the app for a streak day', type: 'int', min: 1 },
          { key: 'monthly_saves', label: 'Automatic saves a month', type: 'int', min: 0 },
          { key: 'pause_tokens_year', label: 'Pause tokens a year', type: 'int', min: 0 },
          { key: 'pause_days', label: 'Days per pause token', type: 'int', min: 1 },
          { key: 'exam_days_around', label: 'Exam pause: days around an exam', type: 'int', min: 0 },
          { key: 'quiet_from', label: 'No reminders from (hour)', type: 'int', min: 0, max: 23 },
          { key: 'quiet_to', label: 'No reminders until (hour)', type: 'int', min: 0, max: 23 },
          { key: 'weekly_reset_dow', label: 'Weekly reset day (1 = Monday)', type: 'int', min: 1, max: 7 },
          { key: 'board_top_n', label: 'Leaderboard shows top', type: 'int', min: 3, max: 100 },
          { key: 'multiplier_on_bonus', label: 'Multiplier also on milestone bonuses', type: 'bool' },
          { key: 'multiplier_steps', label: 'Multiplier steps', type: 'json', hint: '[{"from":0,"x":1},{"from":7,"x":1.2},{"from":30,"x":1.5},{"from":100,"x":2}]' },
          { key: 'levels', label: 'SP levels', type: 'json', hint: '[{"name":"Bronze","sp":1000}, …]' },
          { key: 'milestones', label: 'Streak milestones (days → SP activity)', type: 'json' },
          { key: 'reminder_hours', label: 'Reminder hours', type: 'json', hint: '[19, 21]' },
          { key: 'exam_pause_cards', label: 'Cards with exam pause', type: 'json', hint: '["class10","inter"]' },
          REASON, WHEN,
        ]}
      />
    </div>
  );
}

function ChangeLog() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const load = useCallback(() => {
    adminApi.get(`${A}/v21/config-log`).then(({ data }) => data?.bool && setRows(data.response.changes || [])).catch(() => {});
  }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (r, path, body) => {
    try {
      const { data } = await adminApi.post(`${A}/v21/config-log/${r.id}/${path}`, body || {});
      if (data?.bool) { toast.success(msgOf(data, 'Saved.')); load(); } else toast.error(msgOf(data, 'Could not save.'));
    } catch { toast.error('Could not save.'); }
  };
  const tone = { applied: 'bg-emerald-50 text-emerald-700', approved: 'bg-blue-50 text-blue-700', pending: 'bg-amber-50 text-amber-700',
                 rolled_back: 'bg-slate-100 text-slate-500', rejected: 'bg-red-50 text-red-700' };
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  if (!rows.length) return <div className="bg-white border border-slate-200 rounded-2xl p-6 text-center text-sm text-slate-500">No changes yet.</div>;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl divide-y divide-slate-100">
      {rows.map((r) => (
        <div key={r.id} className="p-3.5 flex flex-col sm:flex-row sm:items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-slate-800">
              {r.area.replace(/_/g, ' ')}{r.item_key ? ` · ${r.item_key}` : ''}
              <span className={`ml-2 text-[11px] px-2 py-0.5 rounded-full ${tone[r.status] || ''}`}>{r.status.replace('_', ' ')}</span>
            </p>
            <p className="text-xs text-slate-500 mt-0.5">“{r.reason}” · {r.created_by_name || 'admin'} · {String(r.created_at).slice(0, 16).replace('T', ' ')}
              {r.status === 'approved' ? ` · from ${String(r.effective_from).slice(0, 10)}` : ''}</p>
            <p className="text-xs text-slate-600 mt-1 break-all">{JSON.stringify(r.old_value)} → {JSON.stringify(r.new_value)}</p>
          </div>
          <div className="flex gap-2">
            {r.status === 'pending' && (
              <>
                <button type="button" onClick={() => act(r, 'approve')} className="px-3 min-h-11 rounded-lg text-xs font-semibold bg-emerald-600 text-white">Approve</button>
                <button type="button" onClick={() => act(r, 'approve', { decision: 'reject' })} className="px-3 min-h-11 rounded-lg text-xs font-semibold bg-red-50 text-red-700">Reject</button>
              </>
            )}
            {['applied', 'approved'].includes(r.status) && r.old_value !== null && (
              <button type="button" onClick={() => act(r, 'rollback')} className="px-3 min-h-11 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600">Roll back</button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
