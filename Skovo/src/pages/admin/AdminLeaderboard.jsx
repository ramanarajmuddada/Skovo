import React, { useState } from 'react';
import { Settings, Star, UserX, CalendarRange } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useToast } from '../../components/ui/index.jsx';
import { SettingsCard, CrudTable, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';
import { useMasters } from '../../hooks/useMasters';

const A = '/skovo-platform-panel-admin';

/** Leaderboard, leagues, Hall of Fame, tournaments (feature-updates.md §4, §7). */
export default function AdminLeaderboard() {
  const toast = useToast();
  const [tab, setTab] = useState('settings');
  const [removeId, setRemoveId] = useState('');
  const [season, setSeason] = useState('');

  const remove = async () => {
    const reason = window.prompt('Reason for removing this student from all leaderboards:');
    if (!reason) return;
    const { data } = await adminApi.post(`${A}/leaderboard/remove/${removeId.trim()}`, { reason });
    if (data?.bool) { toast.success('Removed.'); setRemoveId(''); } else toast.error(data?.response?.message || 'Failed.');
  };
  const closeSeason = async () => {
    if (!season.trim() || !window.confirm(`Write the Hall of Fame for "${season}"? This runs once per season.`)) return;
    const { data } = await adminApi.post(`${A}/leaderboard/close-season`, { season_label: season.trim() });
    if (data?.bool) toast.success(data.response.message); else toast.error(data?.response?.message || 'Failed.');
  };

  const { lists } = useMasters(['name_format', 'league_tier', 'tournament_status']);
  const nameFormats = (lists.name_format || []).map((o) => ({ value: o.value, label: o.label }));
  const tierOptions = [...(lists.league_tier || [])]
    .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    .map((o, i) => ({ value: String(i), label: o.label }));

  // Dropdowns read masters: name format and league tiers (Admin > Masters).
  // A tier is stored as its position, lowest first, so the option value is the index.
  return (
    <PageShell title="Leaderboard" subtitle="Students see only their own class and year. Ranked by leaderboard points in the period — never the readiness score, never payments.">
      <Tabs active={tab} onChange={setTab} tabs={[
        { key: 'settings', label: 'Settings', icon: Settings }, { key: 'points', label: 'Leaderboard points', icon: Star },
        { key: 'removed', label: 'Removed students', icon: UserX }, { key: 'season', label: 'Season & tournaments', icon: CalendarRange },
      ]} />
      {tab === 'settings' && (
        <>
          <SettingsCard title="Leaderboard" endpoint={`${A}/leaderboard/settings`} description="Off by default."
            fields={[
              { key: 'enabled', label: 'Leaderboard on', type: 'bool' },
              { key: 'daily_cap', label: 'Daily leaderboard points cap per student (0 = no cap)', type: 'int', min: 0 },
              { key: 'name_format', label: 'Name shown', type: 'select', options: nameFormats, placeholder: 'Full name' },
              { key: 'photos', label: 'Show photos', type: 'bool', hint: 'Students can still set an alias or turn their own photo off. Phone numbers are never shown.' },
            ]} />
          <SettingsCard title="Weekly leagues" endpoint={`${A}/leaderboard/leagues`} description="Duolingo-style groups. Off by default. Tier names and order: Admin → Masters → League Tier."
            fields={[
              { key: 'enabled', label: 'Leagues on', type: 'bool' },
              { key: 'group_size', label: 'Students per group', type: 'int', min: 5, max: 200 },
              { key: 'promote_count', label: 'Top N move up each week', type: 'int', min: 0 },
              { key: 'demote_count', label: 'Bottom N move down each week', type: 'int', min: 0 },

            ]} />
        </>
      )}
      {tab === 'points' && (
        <CrudTable title="Leaderboard points per score rule" listKey="rules" idKey="event_type" canCreate={false}
          description="0 = does not count on the leaderboard. Payment rules can never be given leaderboard points."
          listEndpoint={`${A}/leaderboard/rule-points`}
          updateEndpoint={(id) => `${A}/leaderboard/rule-points/${id}`}
          columns={[
            { key: 'label', label: 'Rule' }, { key: 'readiness_points', label: 'Readiness pts' },
            { key: 'is_active', label: 'Rule on', bool: true }, { key: 'leaderboard_points', label: 'Leaderboard pts' },
            { key: 'is_payment', label: 'Payment', bool: true },
          ]}
          fields={[{ key: 'leaderboard_points', label: 'Leaderboard points', type: 'number', min: 0, max: 100 }]} />
      )}
      {tab === 'removed' && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-2 items-center">
            <input value={removeId} onChange={(e) => setRemoveId(e.target.value)} placeholder="Student user ID"
                   className="px-3 py-2 border border-slate-200 rounded-xl text-sm flex-1 min-w-[16rem]" />
            <button onClick={remove} disabled={!removeId.trim()} className="px-3 py-2 rounded-xl bg-red-600 text-white text-sm disabled:opacity-50">Remove from leaderboards</button>
          </div>
          <CrudTable title="Removed students" listKey="removed" idKey="user_id" canCreate={false}
            listEndpoint={`${A}/leaderboard/removed`}
            columns={[{ key: 'full_name', label: 'Student' }, { key: 'email', label: 'Email' }, { key: 'reason', label: 'Reason' },
                      { key: 'removed_at', label: 'When', render: (r) => (r.removed_at || '').slice(0, 10) }]}
            fields={[]}
            extraActions={(r, reload) => (
              <button className="text-xs font-semibold text-emerald-700 mr-2" onClick={async () => {
                const { data } = await adminApi.post(`${A}/leaderboard/restore/${r.user_id}`, {});
                if (data?.bool) { toast.success('Restored.'); reload(); }
              }}>Restore</button>
            )} />
        </>
      )}
      {tab === 'season' && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2">
            <h3 className="text-base font-bold text-slate-800">Close the season</h3>
            <p className="text-xs text-slate-500">Writes the top 10 per class for every state, city and all India into the Hall of Fame.</p>
            {/* Stacked on phones: side by side, the button wrapped to four lines. */}
            <div className="flex flex-col sm:flex-row gap-2">
              <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="Season name, e.g. 2026-27"
                     className="flex-1 min-w-0 min-h-11 px-3 border border-slate-200 rounded-xl text-sm" />
              <button onClick={closeSeason}
                      className="min-h-11 px-4 rounded-xl text-white text-sm font-semibold whitespace-nowrap shrink-0"
                      style={{ backgroundColor: 'var(--accent)' }}>Write Hall of Fame</button>
            </div>
          </div>
          <CrudTable title="Diamond tournaments" listEndpoint={`${A}/engagement/tournaments`}
            description="Members of the chosen league tier compete on leaderboard points between the dates. Closing writes the winners per class to the Hall of Fame."
            updateEndpoint={(id) => `${A}/engagement/tournaments/${id}`} deleteEndpoint={(id) => `${A}/engagement/tournaments/${id}`}
            newDefaults={{ status: 'open', tier: 4 }}
            columns={[{ key: 'label', label: 'Name' }, { key: 'tier', label: 'Tier #' }, { key: 'starts_on', label: 'From' },
                      { key: 'ends_on', label: 'To' }, { key: 'status', label: 'Status' }]}
            fields={[
              { key: 'label', label: 'Name', type: 'text', required: true },
              { key: 'tier', label: 'League tier', type: 'select', options: tierOptions, placeholder: 'Pick a tier', required: true },
              { key: 'starts_on', label: 'Starts', type: 'date', required: true },
              { key: 'ends_on', label: 'Ends', type: 'date', required: true },
              { key: 'status', label: 'Status', type: 'select', options: (lists.tournament_status || []).map((o) => ({ value: o.value, label: o.label })) },
            ]}
            extraActions={(r, reload) => r.status === 'open' && (
              <button className="text-xs font-semibold text-blue-700 mr-2" onClick={async () => {
                if (!window.confirm('Close this tournament and write the winners?')) return;
                const { data } = await adminApi.post(`${A}/engagement/tournaments/${r.id}/close`, {});
                if (data?.bool) { toast.success(data.response.message); reload(); } else toast.error(data?.response?.message || 'Failed.');
              }}>Close</button>
            )} />
        </>
      )}
    </PageShell>
  );
}
