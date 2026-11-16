import React, { useEffect, useState } from 'react';
import { ToggleRight, Target, Zap, Medal, Trophy, MessageSquare, Timer } from 'lucide-react';
import { useMasters } from '../../hooks/useMasters';
import { adminApi } from '../../services/api';
import { SettingsCard, CrudTable, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';
import QuestionEditor from '../../components/QuestionEditor';
import FormSelect from '../../components/ui/FormSelect';

const A = '/skovo-platform-panel-admin';
const E = `${A}/engagement`;
// Every dropdown reads a master or a live list -- see useEngagementOptions below.
const ON = { key: 'is_active', label: 'On', type: 'bool' };

/** Daily engagement content (feature-updates.md §7). Set up once; the system runs it daily. */
const A_ = '/skovo-platform-panel-admin';
const pick = (rows) => (rows || []).map((o) => ({ value: o.value, label: o.label }));

/* Options for every engagement dropdown: streak actions (the same keys the
   engagement code uses), stage groups and small masters. */
function useEngagementOptions() {
  const { lists } = useMasters(['quest_count_kind', 'achievement_metric',
                                'question_difficulty']);
  const [actions, setActions] = useState([]);
  const [stages, setStages] = useState([]);
  useEffect(() => {
    adminApi.get(`${A_}/streaks/actions`).then(({ data }) => {
      if (data?.bool) setActions((data.response.actions || data.response.items || [])
        .map((a) => ({ value: a.action_key, label: a.label || a.action_key })));
    }).catch(() => {});
    adminApi.get(`${A_}/stages/groups`).then(({ data }) => data?.bool && setStages(data.response.groups || [])).catch(() => {});
  }, []);
  return {
    ACTIONS: actions, STAGES: stages,
    COUNT_KINDS: pick(lists.quest_count_kind),
    METRICS: pick(lists.achievement_metric), DIFFICULTY: pick(lists.question_difficulty),
  };
}

const MEDAL = { bronze: '🥉', silver: '🥈', gold: '🥇' };
/* [{tier:'bronze',target:10}, …] → "🥉 10 · 🥈 50 · 🥇 200" */
function tierText(raw) {
  let t = raw;
  try { if (typeof t === 'string') t = JSON.parse(t); } catch { return '—'; }
  return Array.isArray(t) && t.length ? t.map((x) => `${MEDAL[x.tier] || x.tier} ${x.target}`).join(' · ') : '—';
}

/* Speed practice questions, one list per class plus "All classes". A round
   mixes the All list with the student's own class. */
function SpeedQuestions({ stages }) {
  const [group, setGroup] = useState('all');
  const options = [{ value: 'all', label: 'All classes' }, ...stages];
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
      <div>
        <h3 className="text-sm font-bold text-slate-900">Speed practice questions</h3>
        <p className="text-xs text-slate-500">A round mixes "All classes" with the student's own class. Only MCQ, true/false and number questions are used.</p>
      </div>
      <FormSelect label="Class" value={group} onChange={(v) => setGroup(v || 'all')} options={options} clearable={false} />
      <QuestionEditor key={group} client={adminApi} base={`${E}/question-sets/speed-${group}/questions`}
                      types={['mcq', 'true_false', 'numeric']} showMarks={false} />
    </div>
  );
}

export default function AdminEngagement() {
  const [tab, setTab] = useState('switches');
  const { ACTIONS, STAGES, COUNT_KINDS, METRICS, DIFFICULTY } = useEngagementOptions();

  return (
    <PageShell title="Daily engagement" subtitle="Everything starts off and every reward at 0. Set it up once — quests rotate, goals reset and reminders send automatically.">
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'switches', label: 'Switches', icon: ToggleRight }, { key: 'goals', label: 'Daily goal', icon: Target }, { key: 'quests', label: 'Quests', icon: Zap },
        { key: 'challenges', label: 'Monthly challenge', icon: Medal },
        { key: 'achievements', label: 'Achievements', icon: Trophy }, { key: 'templates', label: 'Messages', icon: MessageSquare }, { key: 'speed', label: 'Speed questions', icon: Timer },
      ]} />

      {tab === 'switches' && (
        <SettingsCard title="Features" endpoint={`${E}/settings`}
          fields={[
            { key: 'daily_goal_enabled', label: 'Daily goal', type: 'bool' },
            { key: 'quests_enabled', label: 'Daily quests', type: 'bool' },
            { key: 'quests_per_day', label: 'Quests per day', type: 'int', min: 1, max: 5 },
            { key: 'challenge_enabled', label: 'Monthly challenge', type: 'bool' },
            { key: 'mistakes_enabled', label: 'My Mistakes review', type: 'bool' },
            { key: 'mistake_days', label: 'Review again after (days)', type: 'text', hint: 'e.g. 1,3,7' },
            { key: 'speed_enabled', label: 'Speed practice', type: 'bool' },
            { key: 'speed_seconds', label: 'Speed round seconds', type: 'int', min: 20, max: 600 },
            { key: 'speed_questions', label: 'Speed round questions', type: 'int', min: 5, max: 50 },
            { key: 'friends_enabled', label: 'Follow friends + activity feed', type: 'bool' },
            { key: 'achievements_enabled', label: 'Achievements with tiers', type: 'bool' },
            { key: 'perfect_week_enabled', label: 'Perfect week bonus', type: 'bool' },
            { key: 'club_extra_freeze_days', label: 'Streak club: extra freeze slot after N-day best streak (0 = off)', type: 'int', min: 0 },
            { key: 'winback_enabled', label: 'Win-back reminders', type: 'bool' },
            { key: 'winback_days', label: 'Remind after idle days', type: 'text', hint: 'e.g. 3,7,30' },
            { key: 'winback_boost_hours', label: 'Welcome-back double leaderboard points (hours, 0 = off)', type: 'int', min: 0 },
            { key: 'winback_free_freeze', label: 'Welcome-back free streak freeze', type: 'bool' },
            { key: 'offline_enabled', label: 'Offline quiz packs (mobile)', type: 'bool' },
          ]} />
      )}

      {tab === 'goals' && (
        <CrudTable title="Goal levels" idKey="level_key" keyField="level_key" listEndpoint={`${E}/goal-levels`}
          updateEndpoint={(id) => `${E}/goal-levels/${id}`} deleteEndpoint={(id) => `${E}/goal-levels/${id}`}
          columns={[{ key: 'level_key', label: 'Key' }, { key: 'label', label: 'Label' }, { key: 'tasks_per_day', label: 'Tasks / day' }, { key: 'is_active', label: 'On', bool: true }]}
          fields={[{ key: 'label', label: 'Label', type: 'text', required: true }, { key: 'tasks_per_day', label: 'Tasks per day', type: 'int', min: 1, required: true },
                   { key: 'sort_order', label: 'Order', type: 'int' }, ON]} />
      )}

      {tab === 'quests' && (
        <CrudTable title="Quest pool" description="Each night every active student gets a mix of easy, medium and hard quests from here. Readiness points come from the score rule quest_completed."
          listEndpoint={`${E}/quests`} updateEndpoint={(id) => `${E}/quests/${id}`} deleteEndpoint={(id) => `${E}/quests/${id}`}
          newDefaults={{ kind: 'action', target: 1, difficulty: 'easy', is_active: false }}
          columns={[{ key: 'label', label: 'Quest' }, { key: 'action_key', label: 'Action',
                      render: (r) => (r.kind === 'any' ? 'Any task' : ACTIONS.find((a) => a.value === r.action_key)?.label || r.action_key) },
                    { key: 'target', label: 'Target' }, { key: 'min_percent', label: 'Min %' }, { key: 'difficulty', label: 'Level' }, { key: 'is_active', label: 'On', bool: true }]}
          fields={[
            { key: 'label', label: 'Quest text', type: 'text', required: true },
            { key: 'kind', label: 'Counts', type: 'select', options: COUNT_KINDS },
            { key: 'action_key', label: 'Action', type: 'select', options: ACTIONS },
            { key: 'target', label: 'How many times', type: 'int', min: 1, required: true },
            { key: 'min_percent', label: 'Minimum quiz % (blank = any)', type: 'int', min: 0, max: 100 },
            { key: 'difficulty', label: 'Difficulty', type: 'select', options: DIFFICULTY },
            { key: 'segment_stage', label: 'Only for stage (blank = all)', type: 'select', options: STAGES }, ON,
          ]} />
      )}

      {tab === 'challenges' && (
        <CrudTable title="Monthly challenges" idKey="month" keyField="month" listEndpoint={`${E}/challenges`}
          updateEndpoint={(id) => `${E}/challenges/${id}`} deleteEndpoint={(id) => `${E}/challenges/${id}`}
          newDefaults={{ target_quests: 20, is_active: false }}
          columns={[{ key: 'month', label: 'Month' }, { key: 'label', label: 'Challenge' }, { key: 'target_quests', label: 'Quests' }, { key: 'badge_label', label: 'Badge' }, { key: 'is_active', label: 'On', bool: true }]}
          fields={[{ key: 'label', label: 'Challenge text', type: 'text', required: true, hint: 'Month key format: YYYY-MM' },
                   { key: 'target_quests', label: 'Quests to complete', type: 'int', min: 1, required: true },
                   { key: 'badge_label', label: 'Badge name', type: 'text' }, ON]} />
      )}

      {tab === 'achievements' && (
        <CrudTable title="Achievements" idKey="ach_key" keyField="ach_key" listEndpoint={`${E}/achievements`}
          description='Badges students keep forever. Each level unlocks at a count, e.g. Bronze 10, Silver 50, Gold 200. Points: score rule achievement_tier.'
          updateEndpoint={(id) => `${E}/achievements/${id}`} deleteEndpoint={(id) => `${E}/achievements/${id}`}
          columns={[{ key: 'ach_key', label: 'Key' }, { key: 'label', label: 'Name' }, { key: 'metric', label: 'Counts',
                      render: (r) => METRICS.find((m) => m.value === r.metric)?.label || r.metric },
                    { key: 'tiers_json', label: 'Levels', render: (r) => tierText(r.tiers_json) },
                    { key: 'is_active', label: 'On', bool: true }]}
          fields={[{ key: 'label', label: 'Name', type: 'text', required: true },
                   { key: 'metric', label: 'Counts', type: 'select', required: true, options: METRICS },
                   { key: 'tiers_json', label: 'Tiers', type: 'json', required: true },
                   { key: 'sort_order', label: 'Order', type: 'int' }, ON]} />
      )}

      {tab === 'templates' && (
        <CrudTable title="Mascot messages" idKey="tpl_key" keyField="tpl_key" listEndpoint={`${E}/templates`}
          description="Use {name} for the student's first name and {streak} for their streak days."
          updateEndpoint={(id) => `${E}/templates/${id}?lang=en`} deleteEndpoint={(id) => `${E}/templates/${id}?lang=en`}
          newDefaults={{ lang: 'en' }}
          columns={[{ key: 'tpl_key', label: 'Key' }, { key: 'title', label: 'Title' }, { key: 'body', label: 'Message' }]}
          fields={[{ key: 'title', label: 'Title', type: 'text', required: true }, { key: 'body', label: 'Message', type: 'textarea', required: true }]} />
      )}

      {tab === 'speed' && <SpeedQuestions stages={STAGES} />}
    </PageShell>
  );
}
