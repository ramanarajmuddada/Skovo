import React, { useEffect, useState } from 'react';
import { superApi } from '../../services/api';

const rupee = (v) => `₹${Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function Box({ title, children }) {
  return <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2"><h3 className="text-sm font-bold text-slate-800">{title}</h3>{children}</div>;
}

function Rows({ rows, cols }) {
  if (!rows?.length) return <p className="text-xs text-slate-400">Nothing yet.</p>;
  return (
    <table className="w-full text-xs">
      <thead><tr className="text-left text-slate-500">{cols.map((c) => <th key={c} className="py-1 pr-2">{c}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="border-t border-slate-50">{cols.map((c) => <td key={c} className="py-1 pr-2">{String(r[c] ?? '—')}</td>)}</tr>)}</tbody>
    </table>
  );
}

/** Super admin view of the Version 1 features (feature-updates.md §16 item 4). */
export default function SuperV1Overview() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    superApi.get('/skovo-platform-owner/v1-overview')
      .then(({ data }) => (data?.bool ? setD(data.response) : setErr(data?.response?.message || 'Could not load.')))
      .catch(() => setErr('Could not load.'));
  }, []);
  if (err) return <p className="text-sm text-red-600">{err}</p>;
  if (!d) return <p className="text-sm text-slate-400">Loading…</p>;
  return (
    <div className="space-y-4 max-w-6xl">
      <h1 className="text-xl font-bold text-slate-900">Version 1 overview</h1>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Wallet refund money (owed)', rupee(d.wallet_liability.refund_money)], ['Unexpired bonus credit', rupee(d.wallet_liability.bonus_credit)],
          ['Open chargebacks', d.chargebacks_open], ['Active streaks', d.streak_health.active ?? 0]].map(([l, v]) => (
          <div key={l} className="bg-white border border-slate-200 rounded-2xl p-3"><p className="text-xs text-slate-500">{l}</p><p className="text-lg font-bold">{v}</p></div>
        ))}
      </div>
      <Box title="Features switched on">
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries({ ...d.features, ...d.features.engagement }).filter(([k]) => k !== 'engagement').map(([k, v]) => (
            <span key={k} className={`px-2 py-1 rounded-lg ${v ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{k.replace('_enabled', '')}: {v ? 'on' : 'off'}</span>
          ))}
        </div>
      </Box>
      <div className="grid md:grid-cols-2 gap-4">
        <Box title="Refunds, last 30 days"><Rows rows={d.refunds_30d} cols={['destination', 'case_key', 'n', 'amount']} /></Box>
        <Box title="Open alerts"><Rows rows={d.open_alerts} cols={['kind', 'n']} /></Box>
        <Box title="Score spread per stage"><Rows rows={d.score_spread} cols={['stage_group', 'students', 'avg_score', 'at_ceiling', 'at_zero']} /></Box>
        <Box title="League health (latest week)"><Rows rows={d.league_health} cols={['stage_group', 'tier', 'members', 'groups']} /></Box>
        <Box title="Streak health"><Rows rows={[d.streak_health]} cols={['active', 'at_7', 'at_30', 'at_100']} /></Box>
      </div>
    </div>
  );
}
