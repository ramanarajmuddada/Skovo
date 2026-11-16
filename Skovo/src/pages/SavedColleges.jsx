import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../services/api';
import { Card, PageHeader, Badge, Toast, EmptyState, Button, StudentPage } from '../components/ui/index.jsx';
import CollegeTabs from '../components/colleges/CollegeTabs';
import ProUpgradeBanner from '../components/ProUpgradeBanner.jsx';
import { LoadError } from '../components/ui/TableComponents';
import { GraduationCap, Trash2, Columns3, MapPin, ExternalLink } from 'lucide-react';

function CompareTable({ colleges }) {
  const ROWS = [
    ['Location',    (c) => [c.city, c.state].filter(Boolean).join(', ') || '—'],
    ['Type',        (c) => c.college_type || c.type || '—'],
    ['Established', (c) => c.established_year || '—'],
    ['Fee range',   (c) => (c.fee_min || c.fee_max)
                            ? `₹${(c.fee_min || 0).toLocaleString('en-IN')} – ₹${(c.fee_max || 0).toLocaleString('en-IN')}`
                            : '—'],
    ['NIRF rank',   (c) => c.nirf_rank || '—'],
    ['Website',     (c) => c.website
                            ? <a href={c.website} target="_blank" rel="noopener noreferrer"
                                 className="text-blue-600 hover:underline inline-flex items-center gap-1">
                                Visit <ExternalLink size={11} />
                              </a>
                            : '—'],
  ];

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <table className="w-full text-sm border-separate border-spacing-0 min-w-[600px]">
        <thead>
          <tr>
            <th className="text-left text-xs font-bold text-slate-400 uppercase tracking-wide p-3 sticky left-0"
                style={{ background: 'var(--card, #fff)' }}>
              Compare
            </th>
            {colleges.map((c) => (
              <th key={c.id} className="text-left p-3 align-bottom min-w-40">
                <span className="font-bold text-slate-900 block leading-snug">{c.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map(([label, get], i) => (
            <tr key={label} className={i % 2 ? 'bg-slate-50/60' : ''}>
              <td className="p-3 text-xs font-semibold text-slate-500 sticky left-0"
                  style={{ background: 'var(--card, #fff)' }}>{label}</td>
              {colleges.map((c) => (
                <td key={c.id} className="p-3 text-slate-700">{get(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SavedColleges() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  // A failed load used to be indistinguishable from a loaded-but-empty one, and
  // that was not merely confusing — see the banner below.
  const [loadError, setLoadError] = useState('');
  const [compare, setCompare] = useState(false);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  const load = () => {
    setLoadError('');
    return api.get('/colleges/saved')
      .then(({ data: d }) => {
        if (d.bool) setData(d.response);
        else setLoadError(d.response?.message || 'The server refused the request.');
      })
      .catch((err) => setLoadError(
        err?.response?.data?.response?.message
        || 'Could not load your saved colleges. Check your connection and try again.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const unsave = async (c) => {
    try {
      const { data: d } = await api.delete(`/colleges/${c.id}/save`);
      if (d.bool) { flash(`Removed ${c.name}.`); load(); }
    } catch { flash('Could not remove that college.', 'error'); }
  };

  if (loading) {
    return (
      <StudentPage className="space-y-5 sm:space-y-6">
        <PageHeader title="Saved Colleges" subtitle="Your comparison list" />
        <CollegeTabs active="saved" />
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-40 bg-white rounded-2xl border border-slate-100 animate-pulse" />
          ))}
        </div>
      </StudentPage>
    );
  }

  // A failed fetch left `loading` false and `data` null — and the allowance
  // banner below reads `data.remaining` directly, so the whole screen threw
  // "Cannot read properties of null" and rendered white. The `.catch(() => {})`
  // that swallowed the error is what made an unreachable state reachable.
  if (loadError) {
    return (
      <StudentPage className="space-y-5 sm:space-y-6">
        <PageHeader title="Saved Colleges" subtitle="Your comparison list" />
        <CollegeTabs active="saved" />
        <LoadError what="your saved colleges" message={loadError} onRetry={() => {
          setLoading(true); load();
        }} />
      </StudentPage>
    );
  }

  const colleges = data?.colleges || [];
  const isPro = !!data?.is_pro;
  const compareLimit = data?.compare_limit || 3;

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type={toastType} />
      <PageHeader
        title="Saved Colleges"
        subtitle="Your comparison list"
        action={colleges.length > 1 && (
          <Button variant="secondary" onClick={() => setCompare((v) => !v)}>
            <Columns3 size={15} /> {compare ? 'Back to list' : 'Compare'}
          </Button>
        )}
      />

      <CollegeTabs active="saved" />

      {/* Allowance banner — free keeps 3, Pro is unlimited. */}
      {!isPro && (
        <div className="mb-4">
          <ProUpgradeBanner
            used={data?.total ?? 0}
            limit={data?.limit}
            noun={data?.limit === 1 ? 'college' : 'colleges'}
            extra="Skovo Pro saves unlimited colleges and unlocks scholarship matches."
          />
        </div>
      )}

      {colleges.length === 0 ? (
        <EmptyState
          icon={GraduationCap}
          title="No saved colleges yet"
          subtitle="Browse colleges and tap save to start building your comparison list"
          action={<Link to="/colleges"><Button>Browse colleges</Button></Link>}
        />
      ) : compare ? (
        <Card className="p-4">
          <CompareTable colleges={colleges.slice(0, compareLimit)} />
          {colleges.length > compareLimit && (
            <p className="text-xs text-slate-400 mt-3">
              Showing the first {compareLimit}. {!isPro && 'Skovo Pro compares up to 10 at a time.'}
            </p>
          )}
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {colleges.map((c) => (
            <Card key={c.id} className="p-5 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <h3 className="font-bold text-slate-900 leading-snug flex-1 min-w-0">{c.name}</h3>
                <button
                  onClick={() => unsave(c)}
                  title="Remove from list"
                  className="min-h-11 min-w-11 inline-flex items-center justify-center text-slate-300 hover:text-red-600 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                >
                  <Trash2 size={15} />
                </button>
              </div>

              {(c.city || c.state) && (
                <p className="text-xs text-slate-500 flex items-center gap-1">
                  <MapPin size={11} />{[c.city, c.state].filter(Boolean).join(', ')}
                </p>
              )}

              <div className="flex items-center gap-2 flex-wrap mt-1">
                {c.college_type && <Badge color="blue" size="xs">{c.college_type}</Badge>}
                {c.nirf_rank && <Badge color="emerald" size="xs">NIRF #{c.nirf_rank}</Badge>}
              </div>

              <Link to={`/colleges/${c.id}`}
                 className="mt-auto pt-3 min-h-11 inline-flex items-center text-sm font-semibold"
                 style={{ color: 'var(--accent)' }}>
                View details →
              </Link>
            </Card>
          ))}
        </div>
      )}
    </StudentPage>
  );
}
