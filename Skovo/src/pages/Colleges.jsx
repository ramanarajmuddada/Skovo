import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, invalidateGetCache } from '../services/api';
import { useMasters } from '../hooks/useMasters';
import { GraduationCap, Info, CheckCircle2, Eye, Bookmark, BookmarkCheck } from 'lucide-react';
import { Th, Td, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn, ResponsiveTable, RowCard, LoadError } from '../components/ui/TableComponents';
import { PageHeader, SearchBar, StudentPage } from '../components/ui/index.jsx';
import CollegeTabs from '../components/colleges/CollegeTabs';
import PathNudge from '../components/profile/PathNudge';
import ProUpgradeBanner, { TakeProLink } from '../components/ProUpgradeBanner.jsx';

// College types come from masters; 'all' is a UI filter, not a stored value.

const BANNER_STYLES = {
  info:    { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-800',    icon: 'text-blue-500' },
  success: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', icon: 'text-emerald-500' },
};

// How long a fetched page of the list stays good enough to paint immediately on
// re-entry. Short on purpose: the catalogue is admin-managed and barely moves,
// but a student who opens a college and comes straight back should not be shown
// a stale list for minutes. Anything served from cache is revalidated anyway.
const LIST_TTL = 60000;

// Long enough that a normal typist sends one request for a word rather than
// one per letter, short enough that the list still feels live.
const SEARCH_DEBOUNCE_MS = 400;

export default function Colleges() {
  const { lists } = useMasters(['college_type']);
  // Carry the master's label, not just its value. The chips used to render the
  // raw value ('government') and lean on CSS `capitalize`, which styles the
  // glyphs but leaves the accessible name lowercase and untranslated - a
  // screen reader announced the storage token, not the label admins wrote.
  const TYPES = [
    { value: 'all', label: 'All Types' },
    ...(lists.college_type || []).map(t => ({ value: t.value, label: t.label || t.value })),
  ];
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [colleges,       setColleges]       = useState([]);
  // No `loading` state — it is derived from loadedKey further down.
  const [search,         setSearch]         = useState('');
  const [type,           setType]           = useState('all');
  const [page,           setPage]           = useState(1);
  const [perPage,        setPerPage]        = useState(20);
  const [pagination,     setPagination]     = useState({ total: 0, pages: 1 });
  const [savedIds,       setSavedIds]       = useState(new Set());
  const [saveQuota,      setSaveQuota]      = useState(null);
  const [saveMsg,        setSaveMsg]        = useState('');
  const [loadError,      setLoadError]      = useState('');

  // Which colleges are already on the comparison list. Cached only to collapse
  // the duplicate call StrictMode's double mount makes — toggleSave drops the
  // entry, so a bookmark the student just changed is never served from here.
  const applySaved = (res) => {
    if (!res) return;
    setSavedIds(new Set((res.colleges || []).map((c) => c.id)));
    setSaveQuota({
      is_pro: !!res.is_pro,
      limit: res.limit ?? null,
      remaining: res.remaining ?? null,
      total: res.total ?? (res.colleges || []).length,
    });
  };

  useEffect(() => {
    api.getCached('/colleges/saved', undefined, { ttl: LIST_TTL })
      .then(({ data }) => { if (data.bool) applySaved(data.response); })
      .catch(() => {});
  }, []);

  // Free plan keeps 3 — the server enforces it, we just surface the reason.
  const toggleSave = async (c, e) => {
    e?.stopPropagation?.();
    const saved = savedIds.has(c.id);
    try {
      if (saved) {
        const { data } = await api.delete(`/colleges/${c.id}/save`);
        if (data.bool) {
          setSavedIds((prev) => { const n = new Set(prev); n.delete(c.id); return n; });
          setSaveQuota((q) => q ? { ...q, total: Math.max(0, (q.total || 1) - 1), remaining: q.limit == null ? null : (q.remaining ?? 0) + 1 } : q);
        }
      } else {
        const { data } = await api.post(`/colleges/${c.id}/save`, {});
        if (data.bool) {
          setSavedIds((prev) => new Set(prev).add(c.id));
          setSaveQuota((q) => q ? { ...q, total: (q.total || 0) + 1, remaining: q.limit == null ? null : Math.max(0, (q.remaining ?? 1) - 1) } : q);
        } else {
          const r = data.response || {};
          setSaveMsg(r.message || 'Could not save that college.');
          if (r.requires_pro && r.upgrade) {
            setSaveQuota((q) => ({
              ...(q || {}),
              is_pro: false,
              limit: r.upgrade.limit ?? q?.limit,
              total: r.upgrade.used ?? q?.total,
              remaining: 0,
            }));
          }
          setTimeout(() => setSaveMsg(''), 5000);
        }
      }
    } catch {
      setSaveMsg('Could not update your saved list.');
      setTimeout(() => setSaveMsg(''), 5000);
    } finally {
      // The saved list has moved — including on a failure, which may have been
      // a partial one. Drop it so the Saved Colleges tab re-reads rather than
      // showing the set as it was before this click.
      invalidateGetCache('/colleges/saved');
    }
  };
  const [studentContext, setStudentContext] = useState(null);
  // Seeded from ?all=1: the Saved / Predictor tabs link back here with that
  // flag, so "Browse All" from those screens lands on the full list, not For You.
  const [showAll,        setShowAll]        = useState(searchParams.get('all') === '1');
  const [isPersonalised, setIsPersonalised] = useState(false);

  // Several fetches can be in flight at once (a filter change racing a search).
  // Without this guard a slow earlier reply lands last and overwrites a newer
  // one — e.g. the unfiltered list wiping out search results.
  const reqSeq = useRef(0);

  const applyList = (data) => {
    if (!data?.bool) {
      setColleges([]);
      setLoadError(data?.response?.message || 'Could not load colleges.');
      return;
    }
    setLoadError('');
    setColleges(data.response.colleges);
    setPagination(data.pagination || { total: 0, pages: 1 });
    setStudentContext(data.response.student_context || null);
    setIsPersonalised(!!data.response.is_personalised);
  };

  // `query` is the search actually sent; `search` is what is in the box. They
  // are separate so that typing does not re-request on every keystroke.
  const [query, setQuery] = useState('');

  // One effect owns the request, and every input it depends on is in the
  // dependency list. There used to be two — one on [type, showAll] that also
  // called setPage(1), and one on [page] — and *both* ran on mount, so opening
  // Colleges fired the same request twice before it had shown anything. React
  // batches the setState calls in a single handler, so `setType` + `setPage(1)`
  // together still produce exactly one fetch.
  const params = useMemo(() => {
    const p = { page, per_page: perPage };
    if (type !== 'all') p.type = type;
    if (query) p.search = query;
    if (showAll) p.show_all = 1;
    return p;
  }, [page, perPage, type, query, showAll]);

  // `loading` is derived, not stored: it is true exactly while the rows on
  // screen belong to a different query than the one being asked for. Setting it
  // from inside the effect instead would be a synchronous setState in an effect
  // body — a cascading render, and what the two effects here used to do.
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  const [loadedKey, setLoadedKey] = useState(null);
  const loading = loadedKey !== paramsKey;
  const [pathTick, setPathTick] = useState(0);

  useEffect(() => {
    const seq = ++reqSeq.current;
    const current = () => seq === reqSeq.current;
    api.getCached('/colleges/', params, {
      ttl: LIST_TTL,
      // Served from cache, then the server disagreed — take the newer list,
      // but only if this request is still the one on screen.
      onStale: ({ data }) => { if (current()) applyList(data); },
    })
      .then(({ data }) => { if (current()) applyList(data); })
      .catch(() => { if (current()) { setColleges([]); setLoadError('Could not load colleges. Check your connection and try again.'); } })
      .finally(() => { if (current()) setLoadedKey(paramsKey); });
  }, [params, paramsKey, pathTick]);

  // Debounced search. The form's onSubmit still works for anyone who hits
  // Enter; this is for everyone who types and waits, which is most people —
  // before, the list simply never moved for them.
  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      // Guard the mount pass and no-op edits: setting the same value would
      // re-render but must not re-request.
      if (next !== query) { setQuery(next); setPage(1); }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);   // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e) => {
    e.preventDefault();
    const next = search.trim();
    if (next !== query) { setQuery(next); setPage(1); }
  };

  const bannerStyle = BANNER_STYLES[studentContext?.banner_type] || BANNER_STYLES.info;

  const listCount = pagination?.total || colleges.length;
  const headerSub = loading
    ? 'Explore colleges with rankings, placements and fees'
    : listCount
      ? `${listCount.toLocaleString('en-IN')} college${listCount === 1 ? '' : 's'}${!showAll && isPersonalised ? ' matched to you' : ''}`
      : 'Explore colleges with rankings, placements and fees';

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <PageHeader title="Colleges" subtitle={headerSub} />

      {/* Always rendered — Saved Colleges and the Predictor are reachable from
          here even for a student with no course preference, who sees no
          For You / Browse All split. */}
      {/* `personalised` stays undefined until the list has come back: this page
          is the only source of that flag, and reporting a not-yet-known `false`
          would erase the remembered value that Saved Colleges and the Predictor
          read to keep their Browse All tab. */}
      <CollegeTabs
        active={!showAll ? 'for-you' : 'all'}
        personalised={studentContext ? true : undefined}
        onBrowseMode={(all) => { setShowAll(all); setPage(1); }}
      />

      {!showAll && (
        <PathNudge
          need="both"
          title="Personalise For You"
          blurb="Education and reservation category drive For You colleges and scholarship matches. Browse All is already open."
          onFilled={() => { invalidateGetCache('/colleges/'); setPathTick(t => t + 1); }}
        />
      )}

      {saveQuota && !saveQuota.is_pro && saveQuota.limit != null && (
        <ProUpgradeBanner
          used={saveQuota.total}
          limit={saveQuota.limit}
          noun={saveQuota.limit === 1 ? 'college' : 'colleges'}
          extra="Skovo Pro saves unlimited colleges and unlocks scholarship matches."
        />
      )}

      {studentContext?.banner && !showAll && (
        <div className={`flex items-start gap-3 ${bannerStyle.bg} border ${bannerStyle.border} ${bannerStyle.text} rounded-xl px-4 py-3 text-sm`}>
          {studentContext.banner_type === 'success'
            ? <CheckCircle2 size={16} className={`mt-0.5 shrink-0 ${bannerStyle.icon}`} />
            : <Info size={16} className={`mt-0.5 shrink-0 ${bannerStyle.icon}`} />}
          <p>{studentContext.banner}</p>
        </div>
      )}

      {/* Free-tier save limit and other save failures surface here. */}
      {saveMsg && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <Info size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="flex-1">
            {saveMsg}{' '}
            <TakeProLink>Take Skovo Pro</TakeProLink>
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={handleSearch}
          placeholder="Search colleges by name"
          className="max-w-xl"
        />
        <div className="flex gap-2 flex-wrap" role="group" aria-label="College type">
          {TYPES.map(({ value, label }) => {
            const on = type === value;
            return (
              <button key={value} type="button" onClick={() => { setType(value); setPage(1); }}
                aria-pressed={on}
                className={`px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border transition-colors ${
                  on ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {!loading && loadError && (
        <LoadError what="colleges" message={loadError} onRetry={() => { setLoadError(''); setLoadedKey(null); setPathTick(t => t + 1); }} />
      )}

      {(loading || colleges.length > 0) && (
      <ResponsiveTable
        cards={
          loading
            ? Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
              ))
            : colleges.map((c) => (
                <RowCard
                  key={c.id}
                  onClick={() => navigate(`/colleges/${c.id}`)}
                  title={c.name}
                  subtitle={[c.location_city, c.location_state].filter(Boolean).join(', ') || undefined}
                  badge={<StatusBadge status={c.type || 'active'} label={c.type || '—'} />}
                  action={
                    <span onClick={e => e.stopPropagation()}>
                      <ActionBtn
                        icon={savedIds.has(c.id) ? BookmarkCheck : Bookmark}
                        tooltip={savedIds.has(c.id) ? 'Remove from saved' : 'Save to compare'}
                        color={savedIds.has(c.id) ? 'indigo' : 'default'}
                        onClick={(e) => toggleSave(c, e)}
                      />
                    </span>
                  }
                  fields={[
                    { label: 'Ranking', value: c.nirf_ranking ? `#${c.nirf_ranking}` : '—' },
                    { label: 'Avg Package', value: c.avg_package ? `₹${c.avg_package}L` : '—' },
                    {
                      label: 'Annual Fee',
                      value: c.annual_fees_min
                        ? `₹${Number(c.annual_fees_min).toLocaleString('en-IN')}${c.annual_fees_max ? ` – ₹${Number(c.annual_fees_max).toLocaleString('en-IN')}` : ''}`
                        : '—',
                    },
                  ]}
                />
              ))
        }
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>College</Th>
                <Th>Type</Th>
                <Th right>Ranking</Th>
                <Th right>Avg Package</Th>
                <Th right>Annual Fee</Th>
                <Th right>Actions</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={7} rows={8} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {colleges.map((c) => (
                  <tr key={c.id} onClick={() => navigate(`/colleges/${c.id}`)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                          <GraduationCap size={14} className="text-blue-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-slate-900 max-w-xs line-clamp-2 leading-snug">{c.name}</p>
                          <p className="text-xs text-slate-400 truncate">{[c.location_city, c.location_state].filter(Boolean).join(', ') || '—'}</p>
                        </div>
                      </div>
                    </Td>
                    <Td><StatusBadge status={c.type || 'active'} label={c.type || '—'} /></Td>
                    <Td right><span className="text-slate-700 font-medium">{c.nirf_ranking ? `#${c.nirf_ranking}` : '—'}</span></Td>
                    <Td right><span className="text-emerald-700 font-medium">{c.avg_package ? `₹${c.avg_package}L` : '—'}</span></Td>
                    <Td right><span className="text-slate-600">{c.annual_fees_min
                      ? `₹${Number(c.annual_fees_min).toLocaleString('en-IN')}${c.annual_fees_max ? ` – ₹${Number(c.annual_fees_max).toLocaleString('en-IN')}` : ''}`
                      : '—'}</span></Td>
                    <Td right>
                      <div className="flex items-center justify-end gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo" onClick={() => navigate(`/colleges/${c.id}`)} />
                        <ActionBtn
                          icon={savedIds.has(c.id) ? BookmarkCheck : Bookmark}
                          tooltip={savedIds.has(c.id) ? 'Remove from saved' : 'Save to compare'}
                          color={savedIds.has(c.id) ? 'indigo' : 'default'}
                          onClick={(e) => toggleSave(c, e)}
                        />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        }
      />
      )}
      {!loading && !loadError && colleges.length === 0 && (
        <EmptyState icon={GraduationCap}
          message={isPersonalised && !showAll ? 'No colleges match your profile yet' : 'No colleges found'}
          sub={isPersonalised && !showAll ? 'Browse All shows every college, not just the ones matched to you' : 'Try adjusting your search or filter'}
          action={isPersonalised && !showAll ? (
            <button type="button" onClick={() => { setShowAll(true); setPage(1); }}
              className="min-h-11 px-4 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}>
              Browse all colleges
            </button>
          ) : null} />
      )}
      {/* Both handlers only move state — the one effect above turns that
          into exactly one request. onPerPage used to also call fetchColleges
          itself, which raced the effect its own setState had just queued. */}
      {(loading || colleges.length > 0) && (
      <div className="mt-3">
        <Pagination
          page={page} pages={pagination?.pages || 1} total={pagination?.total || 0}
          perPage={perPage} onPage={setPage} onPerPage={pp => { setPerPage(pp); setPage(1); }} />
      </div>
      )}
    </StudentPage>
  );
}
