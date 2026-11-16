import React, { useEffect, useRef, useState } from 'react';
import { api, invalidateGetCache } from '../services/api';
import CohortDetailsSlideover from '../components/cohorts/CohortDetailsSlideover';
import CohortCard from '../components/cohorts/CohortCard';
import { normalizeCohort } from '../components/cohorts/normalizeCohort';
import { Users, Radio, CalendarClock, CheckCircle2, Sparkles, LayoutGrid } from 'lucide-react';
import { Tabs } from '../components/admin/v1/AdminV1Kit';
import { EmptyState, LoadError } from '../components/ui/TableComponents';
import { PageHeader, SearchBar, StudentPage, DateRange } from '../components/ui/index.jsx';
import ProUpgradeBanner from '../components/ProUpgradeBanner.jsx';
import PathNudge from '../components/profile/PathNudge';

// Status no longer comes from master data on this screen. It used to render the
// cohort_status list as filter chips; the page now renders one section per
// status instead, which is the same information as a layout rather than as a
// control, so there is nothing left to pick from. The values are still the
// server's — see effective_cohort_status in the backend, which derives them
// from session_date on every request rather than trusting the scheduler.

// How many rows one request asks for. Deliberately much larger than the old
// per-page of 20: the page groups cohorts into sections, and a paginator that
// cuts across those groups strands half the upcoming classes on page 2 with
// nothing on screen to say that is what happened. Anything past this is reached
// with "Load more", which appends rather than replaces.
const PAGE_SIZE = 60;

// Live first, then what is coming, then what is over. Cancelled sits last and
// only appears when it has something in it — a permanently empty "Cancelled"
// heading is noise on a screen whose job is to get someone into a class.
const SECTIONS = [
  { status: 'live',      title: 'Live now',  icon: Radio,
    blurb: 'Happening right now — join before it ends' },
  { status: 'upcoming',  title: 'Upcoming',  icon: CalendarClock,
    blurb: 'Book a seat while there are still some left' },
  { status: 'completed', title: 'Completed', icon: CheckCircle2,
    blurb: 'Past sessions — certificates and feedback live here' },
  { status: 'cancelled', title: 'Cancelled', icon: Users,
    blurb: 'Called off by the mentor' },
];

function Section({ meta, cohorts, onOpen }) {
  const Icon = meta.icon;
  return (
    <section>
      <div className="flex items-baseline gap-2">
        <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
          <Icon size={16} className={meta.status === 'live' ? 'text-red-500' : 'text-slate-400'} />
          {meta.title}
        </h2>
        <span className="text-xs font-semibold text-slate-400">{cohorts.length}</span>
      </div>
      {meta.blurb && <p className="mt-0.5 text-xs text-slate-400">{meta.blurb}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {cohorts.map((c) => <CohortCard key={c.id} cohort={c} onOpen={onOpen} />)}
      </div>
    </section>
  );
}

export default function Cohorts() {
  const [cohorts,    setCohorts]    = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [search,     setSearch]     = useState('');
  const [range,      setRange]      = useState({ from: '', to: '' });
  const [selected,   setSelected]   = useState(null);
  const [page,       setPage]       = useState(1);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });
  // The free-cohort allowance rides along with the list precisely so it can be
  // shown here, where it can still change what a student taps — rather than
  // after they have already hit a price on the enrolment panel.
  const [freePerk,   setFreePerk]   = useState(null);
  // A failed request and an empty catalogue are different facts. Without this
  // both rendered "No cohorts found. Try a different search or filter" — advice
  // that cannot work, on a screen that has no way to retry.
  const [loadError, setLoadError] = useState('');
  const [lastParams, setLastParams] = useState({ page: 1 });
  // Tabs narrow the grouped list to one status; 'all' keeps every section.
  const [view, setView] = useState('all');

  // Mount, a search submit and a "Load more" can all be in flight at once.
  // Without this guard a slower earlier reply lands last and replaces the
  // search results — the student then clicks the card they searched for and
  // opens a different cohort entirely. Same defect the Colleges list had.
  const reqSeq = useRef(0);

  // `append` is what separates "Load more" from every other load: page 2 has to
  // extend the sections, not replace them.
  const load = (params = {}, { append = false } = {}) => {
    const seq = ++reqSeq.current;
    setLoading(true);
    setLoadError('');
    setLastParams(params);
    // getCached, not get. Two things come from it, and only one is caching:
    // concurrent identical GETs are collapsed onto a single request, which is
    // what stops a double-mount (React StrictMode in development, and any
    // genuine race in production) from asking the server for the same page
    // twice; and coming back to Cohorts from a detail view repaints from the
    // warm copy instead of showing a skeleton. The TTL is short on purpose —
    // enrolment counts move while a class is filling, so a stale list would be
    // visible in a way a stale dropdown is not.
    api.getCached('/cohorts/', { page: params.page || 1, per_page: PAGE_SIZE, ...params },
      { ttl: 15000 })
      .then(({ data }) => {
        if (seq !== reqSeq.current) return;   // superseded by a newer request
        if (data.bool) {
          const rows = data.response.cohorts.map(normalizeCohort);
          setCohorts((prev) => (append ? [...prev, ...rows] : rows));
          setPagination(data.pagination || { total: 0, pages: 1 });
          setFreePerk(data.response.free_cohort || null);
        } else {
          // A refusal is not an empty list either — show what the server said.
          if (!append) setCohorts([]);
          setLoadError(data.response?.message || 'The server refused the request.');
        }
      })
      .catch((err) => {
        if (seq !== reqSeq.current) return;
        if (!append) setCohorts([]);
        setLoadError(err?.response?.data?.response?.message
          || err?.message
          || 'The request failed. Check your connection and try again.');
      })
      .finally(() => { if (seq === reqSeq.current) setLoading(false); });
  };

  useEffect(() => { load({ page: 1 }); }, []);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, ...(search && { search }), ...(range.from && { date_from: range.from }), ...(range.to && { date_to: range.to }) });
  };

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load({ page: next, ...(search && { search }), ...(range.from && { date_from: range.from }), ...(range.to && { date_to: range.to }) }, { append: true });
  };

  // Grouped here rather than fetched per status: one request already carries
  // every cohort this student is allowed to see, and four status-filtered
  // requests would be four round trips for the same rows.
  const grouped = SECTIONS
    .map((meta) => ({ meta, rows: cohorts.filter((c) => c.status === meta.status) }))
    // Upcoming is the one section that holds its place when empty — see below.
    .filter(({ meta, rows }) => rows.length > 0 || meta.status === 'upcoming')
    .filter(({ meta }) => view === 'all' || meta.status === view);
  const count = (st) => cohorts.filter((c) => c.status === st).length;
  const tabs = [
    // Cancelled classes are not listed for students, so they are not counted either.
    { key: 'all', label: `All · ${cohorts.filter((c) => c.status !== 'cancelled').length}`, icon: LayoutGrid },
    { key: 'live', label: `Live · ${count('live')}`, icon: Radio },
    { key: 'upcoming', label: `Upcoming · ${count('upcoming')}`, icon: CalendarClock },
    { key: 'completed', label: `Done · ${count('completed')}`, icon: CheckCircle2 },
  ];

  const hasMore = page < (pagination?.pages || 1);
  const isEmpty = !loading && !loadError && cohorts.length === 0;

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <PageHeader
        title="Cohorts"
        subtitle="Live expert-led sessions to build your career skills"
      />

      <PathNudge
        need="identity"
        title="Show classes for you"
        blurb="Add your stage, state and city so this list matches what you study. You can still browse every class below."
        onFilled={() => { invalidateGetCache('/cohorts/'); load({ page: 1 }); }}
      />

      <div className="flex flex-col sm:flex-row gap-2">
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={handleSearch}
          placeholder="Search cohorts by name or mentor"
          className="max-w-xl flex-1"
        />
        {/* Class date (IST). Empty = any time. */}
        <DateRange value={range} anyLabel="Any time" className="sm:w-56"
                   onChange={(r) => {
                     const v = r || { from: '', to: '' };
                     setRange(v); setPage(1);
                     load({ page: 1, ...(search && { search }), ...(v.from && { date_from: v.from }), ...(v.to && { date_to: v.to }) });
                   }} />
      </div>

      {freePerk && !freePerk.available && freePerk.allowance != null && (
        <ProUpgradeBanner
          used={freePerk.used}
          limit={freePerk.allowance}
          noun={freePerk.allowance === 1 ? 'paid cohort' : 'paid cohorts'}
          extra="Paid seats are unlimited with Skovo Pro — enrol in one tap, no checkout."
        />
      )}
      {freePerk?.available && (
        <div className="flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm"
             style={{ borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
                      background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
                      color: 'var(--accent-text, #1e293b)' }}>
          <Sparkles size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--accent)' }} />
          <p>
            {freePerk.allowance === 1
              ? 'Your first paid cohort is on us — the fee comes off at checkout.'
              : `${freePerk.used} of ${freePerk.allowance} free paid cohorts used — remaining seats are on us at checkout.`}
          </p>
        </div>
      )}

      {cohorts.length > 0 && <Tabs active={view} onChange={setView} tabs={tabs} />}

      {/* Skeletons only on a first load. A "Load more" already has cards on
          screen, and replacing them with grey bars would lose the reader their
          place in a list they were part-way through. */}
      {loading && cohorts.length === 0 ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-48 rounded-2xl border border-slate-100 bg-white animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-7 mo-stagger-fade">
          {grouped.map(({ meta, rows }) =>
            rows.length === 0 ? (
              // Upcoming keeps its heading when it is empty: "nothing scheduled
              // yet" is the answer a student came to this page for, and a page
              // that silently omits the section reads as still loading.
              <section key={meta.status}>
                <h2 className="flex items-center gap-2 text-base font-black text-slate-900">
                  <CalendarClock size={16} className="text-slate-400" /> {meta.title}
                </h2>
                <p className="mt-3 rounded-2xl border border-dashed border-slate-200 px-4 py-8 text-center text-xs text-slate-400">
                  No sessions scheduled yet — check back soon.
                </p>
              </section>
            ) : (
              <Section key={meta.status} meta={meta} cohorts={rows} onOpen={setSelected} />
            )
          )}
        </div>
      )}

      {!loading && loadError && (
        <LoadError what="cohorts" message={loadError} onRetry={() => load(lastParams)} />
      )}
      {isEmpty && (
        <EmptyState icon={Users} message="No cohorts found"
          sub={search ? 'Try a different search' : 'New sessions are added regularly — check back soon'} />
      )}

      {hasMore && !loadError && (
        <div className="flex justify-center pt-1">
          <button type="button" onClick={loadMore} disabled={loading}
            className="min-h-11 w-full sm:w-auto rounded-xl border border-slate-200 px-5 py-2 text-sm font-semibold text-slate-600
                       transition-colors hover:border-slate-300 disabled:opacity-60">
            {loading ? 'Loading…' : 'Load more cohorts'}
          </button>
        </div>
      )}

      <CohortDetailsSlideover
        cohort={selected}
        isOpen={!!selected}
        freePerk={freePerk}
        onClose={() => setSelected(null)}
        onEnrolled={() => {
          // Drop the cached list first. The student has just changed the very
          // thing this list reports — their enrolment — so serving the copy
          // taken seconds ago would refresh the screen back to "not joined".
          invalidateGetCache('/cohorts/');
          // Back to page 1, replacing rather than appending: every page already
          // on screen is rebuilt from scratch, so the cohort they just joined
          // cannot appear twice — once from the stale copy, once from the new.
          setPage(1);
          load(search ? { page: 1, search } : { page: 1 });
        }}
      />
    </StudentPage>
  );
}
