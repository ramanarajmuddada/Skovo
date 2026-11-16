import React, { useState } from 'react';
import { Flag, Ban } from 'lucide-react';
import { adminApi } from '../../services/api';
import { useToast } from '../../components/ui/index.jsx';
import { CrudTable, PageShell, Tabs } from '../../components/admin/v1/AdminV1Kit';

const A = '/skovo-platform-panel-admin';

/** Community chat safety (feature-updates.md §6): reports and the blocked-word list.
 *  Phone numbers in chat, DMs and mentor chat are always masked automatically. */
export default function AdminCommunitySafety() {
  const toast = useToast();
  const [tab, setTab] = useState('reports');
  const [word, setWord] = useState({ word: '', lang: 'en' });
  const [ver, setVer] = useState(0);

  const resolve = async (r, action, reload) => {
    if (action !== 'dismiss' && !window.confirm(action === 'remove_member' ? 'Delete the message and remove this member from the community?' : 'Delete this message?')) return;
    const { data } = await adminApi.post(`${A}/community-reports/${r.id}/resolve`, { action });
    if (data?.bool) { toast.success('Resolved.'); reload(); } else toast.error(data?.response?.message || 'Failed.');
  };
  const addWord = async () => {
    const { data } = await adminApi.post(`${A}/community-blocked-words`, word);
    if (data?.bool) { toast.success('Added.'); setWord({ word: '', lang: 'en' }); setVer((v) => v + 1); } else toast.error(data?.response?.message || 'Failed.');
  };

  return (
    <PageShell title="Community safety" subtitle="Most members are under 18. Phone numbers are masked everywhere; outside links are blocked unless a community allows them.">
      <Tabs active={tab} onChange={setTab} tabs={[{ key: 'reports', label: 'Reported messages', icon: Flag }, { key: 'words', label: 'Blocked words', icon: Ban }]} />
      {tab === 'reports' && (
        <CrudTable title="Open reports" listKey="reports" canCreate={false} listEndpoint={`${A}/community-reports?status=open`}
          columns={[{ key: 'group_name', label: 'Community' }, { key: 'sender_name', label: 'Sender' }, { key: 'body', label: 'Message' },
                    { key: 'reporter_name', label: 'Reported by' }, { key: 'reason', label: 'Reason' }]}
          fields={[]}
          extraActions={(r, reload) => (
            <>
              <button className="text-xs font-semibold text-slate-600 px-2 py-2.5" onClick={() => resolve(r, 'dismiss', reload)}>Dismiss</button>
              <button className="text-xs font-semibold text-amber-700 px-2 py-2.5" onClick={() => resolve(r, 'delete_message', reload)}>Delete msg</button>
              <button className="text-xs font-semibold text-red-600 px-2 py-2.5" onClick={() => resolve(r, 'remove_member', reload)}>Remove member</button>
            </>
          )} />
      )}
      {tab === 'words' && (
        <>
          <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-wrap gap-2">
            <input value={word.word} onChange={(e) => setWord({ ...word, word: e.target.value })} placeholder="One word"
                   className="w-full sm:w-auto sm:flex-1 min-h-11 px-3 border border-slate-200 rounded-xl text-sm" />
            <button onClick={addWord} className="w-full sm:w-auto min-h-11 px-4 rounded-xl text-white text-sm font-semibold"
                    style={{ backgroundColor: 'var(--accent)' }}>Add</button>
          </div>
          <CrudTable key={ver} title="Blocked words" listKey="words" idKey="word" canCreate={false} listEndpoint={`${A}/community-blocked-words`}
            deleteEndpoint={(w) => `${A}/community-blocked-words/${encodeURIComponent(w)}`}
            columns={[{ key: 'word', label: 'Word' }]}
            fields={[]} />
        </>
      )}
    </PageShell>
  );
}
