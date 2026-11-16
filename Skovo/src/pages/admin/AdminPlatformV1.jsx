import { useMasters } from '../../hooks/useMasters';
import { Search as SearchIcon } from 'lucide-react';
import { ChartColumn, ClipboardList, HelpCircle } from 'lucide-react';
import LandingFaqs from '../../components/admin/LandingFaqs';
import React, { useEffect, useState } from 'react';
import { adminApi } from '../../services/api';
import { useToast, Button } from '../../components/ui/index.jsx';
import { SettingsCard, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';

const A = '/skovo-platform-panel-admin';

/* Which cohort quizzes students may download and take offline (§7 item 14). */


/** Platform settings for V1 (feature-updates.md §16): school list, rank data, task rules. */
export default function AdminPlatformV1() {
  const { lists: latePolicy } = useMasters(['task_late_policy']);
  const toast = useToast();
  const [tab, setTab] = useState('rank');
  const [ps, setPs] = useState(null);
  const loadPs = () => adminApi.get(`${A}/platform-settings`).then(({ data }) => data?.bool && setPs(data.response));
  useEffect(() => { if (tab === 'rank') loadPs(); }, [tab]);

  return (
    <PageShell title="Platform settings" subtitle="Yearly rank-data review, task rules and the homepage FAQs.">
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'rank', label: 'Rank data', icon: ChartColumn }, { key: 'tasks', label: 'Tasks & quizzes', icon: ClipboardList }, { key: 'faqs', label: 'Landing FAQs', icon: HelpCircle }]} />
      {tab === 'faqs' && <LandingFaqs />}
      {tab === 'rank' && ps && (
        <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3">
          <p className="text-sm text-slate-600">Each year after results, update AP / TS EAPCET, ECET, ICET and POLYCET rank data used by the college predictor. An admin alert stays open from the due date until you mark it reviewed.</p>
          <p className="text-sm">Last reviewed: <b>{ps.rank_data_reviewed_on || 'never'}</b></p>
          {/* Stacks on phones: three controls in one 320px row wrapped the buttons into tall blocks. */}
          <label className="block text-xs font-semibold text-slate-600" htmlFor="rankdue">Due date (MM-DD)</label>
          <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
            <input defaultValue={ps.rank_data_due} id="rankdue" className="min-h-11 px-3 border border-slate-200 rounded-xl text-sm w-full sm:w-28" />
            <button className="min-h-11 px-4 rounded-xl border border-slate-200 text-sm font-semibold" onClick={async () => {
              const v = document.getElementById('rankdue').value;
              const { data } = await adminApi.put(`${A}/platform-settings`, { rank_data_due: v });
              if (data?.bool) { toast.success('Saved.'); setPs(data.response); } else toast.error(data?.response?.message || 'Failed.');
            }}>Save due date</button>
            <button className="min-h-11 px-4 rounded-xl bg-emerald-600 text-white text-sm font-semibold" onClick={async () => {
              const { data } = await adminApi.put(`${A}/platform-settings`, { mark_rank_data_reviewed: true });
              if (data?.bool) { toast.success('Marked reviewed.'); setPs(data.response); }
            }}>Mark reviewed today</button>
          </div>
        </div>
      )}
      {tab === 'tasks' && (
        <SettingsCard title="Tasks & quizzes" endpoint={`${A}/task-settings`}
          description="Rules for every quiz an achiever gives. When a student passes a quiz, readiness points are added automatically (set in Readiness & SP)."
          fields={[
            { key: 'late_policy', label: 'Late submissions', type: 'select', options: (latePolicy.task_late_policy || []).map((o) => ({ value: o.value, label: o.label })) },
            { key: 'appeal_days', label: 'Students can appeal within (days)', type: 'int', min: 0, max: 90 },
          ]} />
      )}
    </PageShell>
  );
}
