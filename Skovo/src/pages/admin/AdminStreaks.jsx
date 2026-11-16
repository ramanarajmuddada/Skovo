import React, { useEffect, useState } from 'react';
import StatTile from '../../components/admin/StatTile';
import { Flame, CalendarDays, Trophy } from 'lucide-react';
import { adminApi } from '../../services/api';
import { SettingsCard, CrudTable, PageShell } from '../../components/admin/v1/AdminV1Kit';

const A = '/skovo-platform-panel-admin';

/** Career streaks (feature-updates.md §3): 🔥 lifetime + ⚡ stage, admin rules. */
export default function AdminStreaks() {
  const [overview, setOverview] = useState(null);
  // Every picker reads a master: stages from master_stage_group, states and
  // branches from the state master and the course catalogue.
  const [stages, setStages] = useState([]);
  const [targets, setTargets] = useState({ states: [], branches: [] });
  useEffect(() => {
    adminApi.get(`${A}/streaks/overview`).then(({ data }) => data?.bool && setOverview(data.response)).catch(() => {});
    adminApi.get(`${A}/stages/groups`).then(({ data }) => data?.bool && setStages(data.response.groups || [])).catch(() => {});
    adminApi.get(`${A}/score-rules/task-targets`).then(({ data }) => {
      if (!data?.bool) return;
      const seen = new Set();
      setTargets({
        states: data.response.states || [],
        branches: (data.response.branches || []).filter((b) => !seen.has(b.value) && seen.add(b.value)),
      });
    }).catch(() => {});
  }, []);

  return (
    <PageShell title="Career streaks" subtitle="🔥 Lifetime streak never resets; ⚡ stage streak resets when a student moves up and ranks the leaderboard. Login alone never counts.">
      {overview && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[['Active streaks', overview.active_streaks, Flame, 'amber'], ['7+ days', overview.at_7, CalendarDays, 'blue'],
            ['30+ days', overview.at_30, CalendarDays, 'violet'], ['100+ days', overview.at_100, Trophy, 'emerald'],
            ['Longest ever', overview.longest_ever, Trophy, 'amber']].map(([l, v, icon, tone]) => (
            <div key={l} className="last:col-span-2 md:last:col-span-1">
              <StatTile label={l} value={v ?? 0} icon={icon} tone={tone} sub={l === 'Longest ever' ? 'days' : undefined} />
            </div>
          ))}
        </div>
      )}
      <SettingsCard
        title="Streak settings" endpoint={`${A}/streaks/settings`} compact
        description="Streaks are off until you switch them on and turn on at least one action below."
        fields={[
          { key: 'enabled', short: 'Streaks', label: 'Streaks on', type: 'bool' },
          { key: 'freeze_every_days', short: 'Freeze every', label: 'Earn a freeze every N days', type: 'int', min: 0, hint: '0 = freezes off: none earned or used, and students never see them. Miss a day and the streak resets.' },
          { key: 'freeze_max', short: 'Free max', label: 'Freezes a free student can hold', type: 'int', min: 0 },
          { key: 'freeze_max_pro', short: 'Pro max', label: 'Freezes a Pro student can hold', type: 'int', min: 0 },
          { key: 'risk_reminder_hour', short: 'Reminder hr', label: 'Streak-at-risk reminder hour (IST, 0–23)', type: 'int', min: 0, max: 23 },
        ]}
      />
      <SettingsCard
        title="Buddy & group streaks" endpoint={`${A}/streaks/settings`} compact
        description="Buddy = 2 students, group = a small study group. Both grow only on days every member does one task; no freezes, and an exam window holds them. Points: Score Engine (7 / 30-day buddy and group). Badges: Daily Engagement → Achievements (Duo, Squad)."
        fields={[
          { key: 'buddy_max', short: 'Buddies', label: 'Buddy streaks per student', type: 'int', min: 0, hint: '0 = buddy streaks off.' },
          { key: 'buddy_same_class', short: 'Same class', label: 'Same class only', type: 'bool', hint: 'Buddies and groups only with students in the same class. Moving up a class ends them, best kept.' },
          { key: 'invite_expiry_days', short: 'Invite expiry', label: 'Unused buddy invites expire after (days)', type: 'int', min: 0, hint: '0 = never.' },
          { key: 'group_enabled', short: 'Groups', label: 'Group streaks on', type: 'bool' },
          { key: 'group_min', short: 'Min', label: 'Smallest group (members)', type: 'int', min: 2, max: 10, hint: 'The group streak starts once this many have joined.' },
          { key: 'group_max', short: 'Max', label: 'Largest group (members)', type: 'int', min: 2, max: 10 },
          { key: 'group_per_student', short: 'Per student', label: 'Groups per student', type: 'int', min: 0 },
          { key: 'social_leaderboard', short: 'Leaderboard', label: 'Buddy & group leaderboard', type: 'bool', hint: 'Top pairs and groups, shown to students in their own class only.' },
        ]}
      />
      <CrudTable
        title="Actions that keep a streak alive" listKey="actions" idKey="action_key" canCreate={false}
        description="All start Off. Milestone points (7 / 30 / 100 / 365 days, buddy 7) are score rules streak_7 … buddy_streak_7 in Score Engine."
        listEndpoint={`${A}/streaks/actions`}
        updateEndpoint={(id) => `${A}/streaks/actions/${id}`}
        deleteEndpoint={(id) => `${A}/streaks/actions/${id}`}
        // One tap On/Off — it sat behind Edit as "Counts for the streak".
        extraActions={(r, reload) => (
          <button type="button"
            onClick={async () => {
              const { data } = await adminApi.put(`${A}/streaks/actions/${r.action_key}`, { counts: !r.counts });
              if (data?.bool) reload();
            }}
            aria-label={`${r.counts ? 'Switch off' : 'Switch on'} ${r.label}`}
            className={`px-3 py-2.5 min-h-11 text-xs font-semibold rounded-lg mr-1 ${
              r.counts ? 'text-emerald-700 bg-emerald-50' : 'text-slate-500 bg-slate-100'}`}>
            {r.counts ? 'On' : 'Off'}
          </button>
        )}
        columns={[
          { key: 'label', label: 'Action' },
          { key: 'counts', label: 'Counts', bool: true },
          { key: 'min_per_day', label: 'Min per day' },
          { key: 'segment_stage', label: 'Only stage' },
          { key: 'segment_branch', label: 'Only branch' },
          { key: 'segment_state', label: 'Only state' },
        ]}
        fields={[
          { key: 'counts', label: 'Counts for the streak', type: 'bool' },
          { key: 'min_per_day', label: 'Minimum per day', type: 'int', min: 1, max: 50 },
          { key: 'segment_stage', label: 'Only this stage (blank = everyone)', type: 'select', options: stages, placeholder: 'Everyone' },
          { key: 'segment_branch', label: 'Only these branches (blank = all)', type: 'multiselect', options: targets.branches, placeholder: 'All branches' },
          { key: 'segment_state', label: 'Only these states (blank = all)', type: 'multiselect', options: targets.states, placeholder: 'All states' },
        ]}
      />
      <CrudTable
        title="Exam windows" listKey="windows"
        description="During these dates streaks never break and no freeze is used (board exams, EAPCET, NEET, semester exams)."
        listEndpoint={`${A}/streaks/exam-windows`}
        updateEndpoint={(id) => `${A}/streaks/exam-windows/${id}`}
        deleteEndpoint={(id) => `${A}/streaks/exam-windows/${id}`}
        newDefaults={{ is_active: true }}
        columns={[
          { key: 'label', label: 'Name' }, { key: 'stage_group', label: 'Stage' }, { key: 'state', label: 'State' },
          { key: 'start_date', label: 'From' }, { key: 'end_date', label: 'To' }, { key: 'is_active', label: 'On', bool: true },
        ]}
        fields={[
          { key: 'label', label: 'Name', type: 'text', required: true, hint: 'e.g. AP SSC exams 2027' },
          { key: 'stage_group', label: 'Stage (blank = everyone)', type: 'select', options: stages, placeholder: 'Everyone' },
          { key: 'state', label: 'State (blank = all)', type: 'select', options: targets.states, placeholder: 'All states' },
          { key: 'start_date', label: 'Start date', type: 'date', required: true },
          { key: 'end_date', label: 'End date', type: 'date', required: true },
          { key: 'is_active', label: 'On', type: 'bool' },
        ]}
      />
    </PageShell>
  );
}
