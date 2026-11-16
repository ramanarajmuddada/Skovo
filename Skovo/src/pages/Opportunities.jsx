import React, { useEffect, useRef, useState } from 'react';
import { api, invalidateGetCache } from '../services/api';
import { useMasters } from '../hooks/useMasters';
import { Card, Toast, Modal, Input, Textarea, Button, FormSelect, Skeleton, PageHeader, SearchBar, StudentPage } from '../components/ui/index.jsx';
import { Link } from 'react-router-dom';
import PathNudge from '../components/profile/PathNudge';
import { TakeProLink } from '../components/ProUpgradeBanner.jsx';
import { fieldErrors, opportunityApply } from '../schemas/student';
import { MapPin, Lock, Briefcase, Target, TrendingUp, Sparkles, Crown, Bookmark, BookmarkCheck, Eye, Send, X, Info, CheckCircle2 } from 'lucide-react';

/* ── Score-gated lock screen (v1 §4.5) ─────────────────────────────────────
   Below the floor the hub shows nothing but the path to unlocking it. */
function HubLocked({ gate }) {
  const pct = Math.min(100, Math.round((gate.your_score / gate.required_score) * 100));
  return (
    <Card className="p-5 sm:p-10 text-center max-w-xl mx-auto">
      <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
        <Lock size={24} />
      </div>
      <h2 className="text-xl font-bold text-slate-900 mt-5">The Opportunity Hub is locked</h2>
      <p className="text-sm text-slate-500 mt-2 leading-relaxed">
        Internships, part-time roles and fresher jobs open up at a readiness score
        of <strong className="text-slate-700">{gate.required_score}</strong>. You are{' '}
        <strong className="text-slate-700">{gate.points_away} point{gate.points_away === 1 ? '' : 's'}</strong> away.
      </p>

      <div className="mt-6">
        <div className="flex items-center justify-between text-xs font-semibold text-slate-500 mb-1.5">
          <span>Your score: {gate.your_score}</span>
          <span className="flex items-center gap-1"><Target size={12} /> {gate.required_score}</span>
        </div>
        <div className="h-2.5 rounded-full bg-slate-100 overflow-hidden">
          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, backgroundColor: 'var(--accent)' }} />
        </div>
      </div>

      <div className="mt-7 text-left bg-slate-50 rounded-2xl p-4 sm:p-5">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <TrendingUp size={15} className="text-emerald-600" /> Quickest ways to get there
        </p>
        <ul className="mt-3 space-y-2">
          {[['Finish the readiness assessment'], ['Attend a cohort and submit its task', '+10'],
            ['Fill all four Document Vault folders', '+5'], ['Post in the communities you have joined']].map(([t, pts]) => (
            <li key={t} className="flex items-center gap-2.5 text-sm text-slate-600">
              <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
              <span className="flex-1 min-w-0">{t}</span>
              {pts && <span className="shrink-0 px-1.5 py-0.5 rounded-md bg-emerald-50 text-emerald-700 text-[11px] font-bold">{pts}</span>}
            </li>
          ))}
        </ul>
      </div>

      {/* One button, not two. "Raise my score" used to go to the Assessment,
          which is v1-hidden; pointing both at /my-score would just be the same
          destination twice. */}
      <div className="flex gap-2 mt-6">
        <Link to="/my-score"
          className="flex-1 min-h-11 inline-flex items-center justify-center py-2.5 text-white rounded-xl text-sm font-semibold transition-opacity hover:opacity-90 text-center"
          style={{ backgroundColor: 'var(--accent)' }}>
          See how to raise my score
        </Link>
      </div>
    </Card>
  );
}
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn, ResponsiveTable, RowCard, LoadError } from '../components/ui/TableComponents';

// Opportunity types come from masters; 'all' is a UI filter, not a stored value.

// Same 60s window Colleges uses. Long enough that leaving the hub and coming
// straight back paints instantly; short enough that a new posting shows up.
const LIST_TTL = 60000;
const SEARCH_DEBOUNCE_MS = 400;

/* ── One <thead>, shared by the skeleton and the real table ────────────────
   Two copies drift, and when they do the skeleton stops lining up with the
   table it is standing in for — which is the whole point of a skeleton. */
const OppTableHead = () => (
  <thead className="bg-slate-50">
    <tr>
      <Th>S.No</Th>
      <Th>Actions</Th>
      <Th>Title</Th>
      <Th>Company</Th>
      <Th>Type</Th>
      <Th>Location</Th>
      <Th right>Stipend / CTC</Th>
      <Th>Deadline</Th>
      <Th right>Min Score</Th>
    </tr>
  </thead>
);

/* ── First-paint skeleton (v1 §4.5) ────────────────────────────────────────
   Until the first reply lands we do not know whether this student gets the hub
   or the lock screen, what their score is, how many rows there are, or which
   type chips exist. Rendering the unlocked hub from those defaults paints a
   full page that is then torn down and replaced — the flicker. This stands in
   its place: same blocks, same heights, no claims. */
function HubSkeleton() {
  return (
    <>
      {/* For You / All Opportunities */}
      <div className="flex items-center gap-2">
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-11 w-40" />
      </div>

      {/* Search + type chips + Shortlisted */}
      <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
        <Skeleton className="h-11 min-w-48 max-w-sm flex-1" />
        <div className="flex gap-2 flex-wrap">
          {['w-20', 'w-24', 'w-24', 'w-20', 'w-24', 'w-28'].map((w, i) => (
            <Skeleton key={i} className={`h-11 ${w}`} />
          ))}
        </div>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <OppTableHead />
            <LoadingRows cols={9} rows={6} />
          </table>
        </div>
        {/* Not <Pagination>: with no data it reads "No entries", which is an
            answer we do not have yet. */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50">
          <Skeleton className="h-7 w-44" />
          <Skeleton className="h-7 w-28" />
        </div>
      </TableShell>
    </>
  );
}

function ApplyModal({ opp, onClose, onSuccess }) {
  const [resumeLink, setResumeLink] = useState('');
  const [coverNote, setCoverNote]   = useState('');
  const [loading,   setLoading]     = useState(false);
  const [error,     setError]       = useState('');
  const [errs,      setErrs]        = useState({});
  const [docs,      setDocs]        = useState([]);
  const [docId,     setDocId]       = useState('');
  const [needsPro,  setNeedsPro]    = useState(false);

  // One-tap apply — offer the student's saved Document Vault files.
  useEffect(() => {
    api.get('/document-vault/')
      .then(({ data }) => { if (data.bool) setDocs(data.response.documents || []); })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const parsed = opportunityApply.safeParse({ resume_link: resumeLink, cover_note: coverNote });
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setError('');
      return;
    }
    setErrs({});
    setLoading(true); setError(''); setNeedsPro(false);
    try {
      const { data } = await api.post('/applications/', {
        opportunity_id: opp.id,
        document_id: docId || undefined,
        resume_link: parsed.data.resume_link.trim() || undefined,
        cover_note: parsed.data.cover_note.trim() || undefined,
      });
      if (data.bool) onSuccess();
      else {
        setError(data.response?.message || 'Could not submit that application.');
        setNeedsPro(!!data.response?.requires_pro);
      }
    } catch { setError('Could not submit that application. Try again.'); }
    finally { setLoading(false); }
  };

  return (
    <Modal isOpen title={`Apply — ${opp.title}`} onClose={onClose}
      footer={
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 w-full">
          <Button type="button" variant="secondary" size="lg" className="flex-1" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="apply-form" variant="primary" size="lg" className="flex-1" disabled={loading}>
            {loading ? 'Submitting…' : 'Submit Application'}
          </Button>
        </div>
      }>
      <form id="apply-form" onSubmit={handleSubmit} noValidate className="space-y-4">
        <p className="text-sm text-slate-500 -mt-2">{opp.company}</p>
        {docs.length > 0 && (
          <FormSelect
            label="One-tap apply — send a saved document"
            value={docId}
            onChange={setDocId}
            options={docs.map(d => ({
              value: d.id,
              label: `${d.name}${d.category ? ` · ${String(d.category).replace('_', ' ')}` : ''}`,
            }))}
            placeholder="None — paste a link below instead"
            hint="Pick a file from your Document Vault to send as your resume."
          />
        )}
        <Input label="Resume Link (optional)" type="text" inputMode="url"
          value={resumeLink}
          onChange={e => { setResumeLink(e.target.value); setErrs(er => ({ ...er, resume_link: undefined })); }}
          placeholder="Enter resume link"
          error={errs.resume_link} />
        <Textarea label="Cover Note (optional)" value={coverNote}
          onChange={e => { setCoverNote(e.target.value); setErrs(er => ({ ...er, cover_note: undefined })); }}
          rows={3} placeholder="Enter why you are a great fit"
          error={errs.cover_note} />
        {error && (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">
            {error}
            {needsPro && <span className="block mt-2"><TakeProLink>Take Skovo Pro</TakeProLink></span>}
          </div>
        )}
      </form>
    </Modal>
  );
}

function OpportunityDetailModal({ item: a, onClose, onApply, locked }) {
  if (!a) return null;
  const stipend = a.stipend_min
    ? `₹${a.stipend_min}${a.stipend_max ? `–${a.stipend_max}` : ''}/mo`
    : '—';
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Company', value: a.company || '—' },
    { label: 'Type', value: (a.type || '—').replace('_', ' ') },
    { label: 'Location', value: `${a.location || '—'}${a.is_remote ? ' · Remote' : ''}` },
    { label: 'Stipend / CTC', value: stipend },
    { label: 'Deadline', value: a.deadline ? new Date(a.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—' },
    { label: 'Min Score', value: a.min_readiness_score > 0 ? String(a.min_readiness_score) : '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white shadow-2xl w-full max-w-md overflow-hidden
                      max-h-[100dvh] rounded-t-2xl sm:rounded-2xl sm:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Opportunity Details</h2>
          <button onClick={onClose} aria-label="Close" className="min-h-11 min-w-11 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-4 sm:px-6 py-5 overflow-y-auto flex-1">
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right capitalize">{value}</span>
              </div>
            ))}
          </div>
          {a.description && (
            <p className="text-sm text-slate-600 leading-relaxed mt-4 bg-slate-50 rounded-xl p-4">{a.description}</p>
          )}
        </div>
        <div className="px-4 sm:px-6 pb-5 flex flex-col-reverse sm:flex-row gap-2 sm:gap-3"
             style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}>
          {onApply && !locked && (
            <button type="button" onClick={() => { onApply(a); onClose(); }}
              className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold text-white hover:opacity-90 transition-opacity"
              style={{ backgroundColor: 'var(--accent)' }}>Apply</button>
          )}
          {locked && (
            <span className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-amber-50 text-amber-600 text-center flex items-center justify-center">Need {a.min_readiness_score} pts</span>
          )}
          <button onClick={onClose} className="flex-1 min-h-11 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function Opportunities() {
  const { lists, loading: mastersLoading } = useMasters(['opportunity_type']);
  const TYPES = ['all', ...(lists.opportunity_type || []).map(t => t.value)];
  const [opps,          setOpps]          = useState([]);
  const [loading,       setLoading]       = useState(true);
  // `loading` flips on every refetch; `booted` latches once, when the first
  // reply has settled. Only then is it safe to draw score, gate and totals.
  const [booted,        setBooted]        = useState(false);
  const [search,        setSearch]        = useState('');
  const [type,          setType]          = useState('all');
  const [page,          setPage]          = useState(1);
  const [perPage,       setPerPage]       = useState(20);
  const [pagination,    setPagination]    = useState({ total: 0, pages: 1 });
  const [userScore,     setUserScore]     = useState(0);
  const [applyTarget,   setApplyTarget]   = useState(null);
  const [view,          setView]          = useState(null);
  const [toast,         setToast]         = useState('');
  const [studentContext,setStudentContext] = useState(null);
  const [hubGate,      setHubGate]      = useState(null);
  const [savedOnly,    setSavedOnly]    = useState(false);
  // "Personalised Fresh Job Opportunities" is a Skovo Pro perk: the same rows,
  // re-ranked against the student's branch, interests and city. `forYou` is what
  // the student asked for; `forYouState` is what the server allowed — a free
  // member's request comes back available:false so the tab can explain itself
  // rather than quietly showing the ordinary order under a "For You" heading.
  const [forYou,       setForYou]       = useState(false);
  const [forYouState,  setForYouState]  = useState(null);
  const [isPro,        setIsPro]        = useState(false);
  const [loadError,    setLoadError]    = useState('');
  const [query,        setQuery]        = useState('');

  // Optimistic shortlist toggle — the row flips immediately, the server call
  // just persists it.
  const toggleShortlist = async (o, e) => {
    e.stopPropagation();
    const next = !o.is_shortlisted;
    setOpps((prev) => prev.map((x) => x.id === o.id ? { ...x, is_shortlisted: next } : x));
    try {
      if (next) await api.post(`/opportunities/${o.id}/shortlist`, {});
      else await api.delete(`/opportunities/${o.id}/shortlist`);
    } catch {
      setOpps((prev) => prev.map((x) => x.id === o.id ? { ...x, is_shortlisted: !next } : x));
    } finally {
      // `is_shortlisted` ships inside the cached list, so a warm entry would
      // hand back the bookmark as it was before this click. Drop it — including
      // after a failure, which may have been a partial one.
      invalidateGetCache('/opportunities/');
    }
  };

  // Mount, filter changes and a search submit can overlap. Without this guard
  // a slower earlier reply lands last and replaces the search results, so the
  // student opens something other than what they searched for.
  const reqSeq = useRef(0);

  const applyList = (data) => {
    if (!data?.bool) {
      setOpps([]);
      setLoadError(data?.response?.message || 'Could not load opportunities.');
      return;
    }
    setLoadError('');
    setOpps(data.response.opportunities);
    setPagination(data.pagination || { total: 0, pages: 1 });
    setUserScore(data.user_readiness_score || 0);
    setStudentContext(data.response.student_context || null);
    setHubGate(data.response.hub_gate || null);
    setForYouState(data.response.for_you || null);
    setIsPro(!!data.response.is_pro);
  };

  const fetchOpps = (params = {}) => {
    const seq = ++reqSeq.current;
    const current = () => seq === reqSeq.current;
    const query = { page: params.page || 1, per_page: perPage, ...params };
    // A warm cache resolves in a microtask, so coming back to the hub paints
    // the real rows on the first frame — no skeleton over data that never
    // went away. Only a real wait shows one.
    setLoading(!api.hasCached('/opportunities/', query, LIST_TTL));
    api.getCached('/opportunities/', query, {
      ttl: LIST_TTL,
      // Served from cache and the server has since disagreed — take the newer
      // list, but only while this request is still the one on screen.
      onStale: ({ data }) => { if (current()) applyList(data); },
    })
      .then(({ data }) => { if (current()) applyList(data); })
      .catch(() => { if (current()) { setOpps([]); setLoadError('Could not load opportunities. Check your connection and try again.'); } })
      .finally(() => {
        if (!current()) return;    // superseded by a newer request
        setLoading(false);
        setBooted(true);           // settled — success or failure, we now know
      });
  };

  useEffect(() => {
    const t = setTimeout(() => {
      const next = search.trim();
      if (next !== query) { setQuery(next); setPage(1); }
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const p = { page };
    if (type !== 'all') p.type = type;
    if (forYou) p.for_you = 1;
    if (query) p.search = query;
    fetchOpps(p);
  }, [page, type, forYou, query]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSearch = (e) => {
    e.preventDefault();
    const next = search.trim();
    if (next !== query) { setQuery(next); setPage(1); }
    else fetchOpps({ page: 1, ...(type !== 'all' ? { type } : {}), ...(forYou ? { for_you: 1 } : {}), ...(next ? { search: next } : {}) });
  };

  // Nothing below the header may be drawn until both the listing and the type
  // chips are in — otherwise the page answers with placeholders and corrects
  // itself a moment later.
  const ready = booted && !mastersLoading;
  const visible = savedOnly ? opps.filter((o) => o.is_shortlisted) : opps;

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      <Toast message={toast} type="success" />

      <PageHeader
        title="Opportunities"
        subtitle={ready
          ? `Fresher jobs, internships and more · Your score: ${userScore}`
          : 'Fresher jobs, internships and more'}
      />

      {!ready && <HubSkeleton />}

      {ready && loadError && !hubGate?.locked && (
        <LoadError what="opportunities" message={loadError} onRetry={() => {
          setLoadError('');
          fetchOpps({ page, ...(type !== 'all' ? { type } : {}), ...(forYou ? { for_you: 1 } : {}), ...(query ? { search: query } : {}) });
        }} />
      )}

      {/* Below the score floor the hub shows only the path to unlocking it. */}
      {ready && hubGate?.locked && <HubLocked gate={hubGate} />}

      {ready && !hubGate?.locked && studentContext?.banner && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 text-blue-800 rounded-xl px-4 py-3 text-sm">
          <Info size={16} className="mt-0.5 shrink-0 text-blue-500" />
          <p>{studentContext.banner}</p>
        </div>
      )}

      {ready && !hubGate?.locked && (
      <>
      {/* For You / All — a mode, not a filter, so it sits above the filters. */}
      <div className="flex items-center gap-2 overflow-x-auto no-scrollbar -mx-1 px-1" role="group" aria-label="Opportunity feed">
        <button type="button" onClick={() => { setForYou(true); setPage(1); }}
          aria-pressed={forYou}
          className={`px-3.5 py-2 min-h-11 rounded-xl text-sm font-bold border transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0 ${
            forYou ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
          style={forYou ? { backgroundColor: 'var(--accent)' } : undefined}>
          <Sparkles size={13} /> For You
          {forYouState && !forYouState.available && (
            <Lock size={11} className={forYou ? 'text-white/80' : 'text-slate-400'} />
          )}
        </button>
        <button type="button" onClick={() => { setForYou(false); setPage(1); }}
          aria-pressed={!forYou}
          className={`px-3.5 py-2 min-h-11 rounded-xl text-sm font-bold border transition-colors whitespace-nowrap shrink-0 ${
            !forYou ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
          }`}
          style={!forYou ? { backgroundColor: 'var(--accent)' } : undefined}>
          All Opportunities
        </button>
      </div>

      {forYou && (
        <PathNudge
          need="identity"
          title="Match opportunities to you"
          blurb="Add your education so For You can rank roles for your path. All Opportunities stays open either way."
          onFilled={() => { invalidateGetCache('/opportunities/'); fetchOpps({ page: 1, for_you: 1, ...(type !== 'all' ? { type } : {}), ...(query ? { search: query } : {}) }); }}
        />
      )}

      {/* Asked for For You without Pro: the list below is the ordinary one, and
          saying so is the whole point — an unexplained identical list reads as
          a broken tab, not a locked feature. */}
      {forYou && forYouState && !forYouState.available && (
        <div className="rounded-2xl border px-4 py-4 flex items-start gap-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          }}>
          <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}>
            <Sparkles size={15} style={{ color: 'var(--accent)' }} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-slate-900">Personalised Fresh Job Opportunities</p>
            <p className="text-sm text-slate-600 mt-1 leading-relaxed">
              {forYouState.message} You're seeing the standard list, ordered by deadline.
            </p>
            <Link to={forYouState.cta_route || '/skovo-pro'}
              className="inline-flex items-center justify-center gap-1.5 mt-3 min-h-11 px-4 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}>
              <Crown size={14} /> See what Pro includes
            </Link>
          </div>
        </div>
      )}

      {!isPro && (
        <div className="rounded-2xl border px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-3"
          style={{
            borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 8%, transparent)',
          }}>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-slate-800">Browse and shortlist are free. Applying is Skovo Pro.</p>
            <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Same rule for every student — take Pro when you are ready to apply.</p>
          </div>
          <Link to="/skovo-pro"
            className="shrink-0 w-full sm:w-auto min-h-11 px-3.5 py-2 rounded-xl text-white text-xs font-bold inline-flex items-center justify-center gap-1.5"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Crown size={13} /> Take Skovo Pro
          </Link>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={handleSearch}
          placeholder="Search jobs, internships…"
          className="max-w-xl"
        />
        <div className="flex gap-2 flex-wrap" role="group" aria-label="Opportunity type">
          {TYPES.map(t => {
            const on = type === t;
            return (
              <button key={t} type="button" onClick={() => { setType(t); setPage(1); }}
                aria-pressed={on}
                className={`px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border transition-colors capitalize ${
                  on ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'}`}
                style={on ? { backgroundColor: 'var(--accent)' } : undefined}>
                {t === 'all' ? 'All Types' : t.replace('_', ' ')}
              </button>
            );
          })}
          <button
            type="button"
            aria-pressed={savedOnly}
            onClick={() => setSavedOnly((v) => !v)}
            className={`px-3 py-2 min-h-11 rounded-xl text-xs font-semibold border transition-colors flex items-center gap-1.5 ${
              savedOnly ? 'text-white border-transparent' : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
            style={savedOnly ? { backgroundColor: 'var(--accent)' } : undefined}
          >
            <Bookmark size={12} /> Shortlisted
          </button>
        </div>
      </div>

      {(loading || visible.length > 0) && (
      <ResponsiveTable
        cards={
          loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-24 rounded-2xl bg-white border border-slate-100 animate-pulse" />
              ))
            : visible.map((o) => {
                const locked = !o.is_unlocked && o.min_readiness_score > 0;
                return (
                  <RowCard
                    key={o.id}
                    onClick={() => setView(o)}
                    title={o.title}
                    subtitle={o.company}
                    badge={<StatusBadge status={o.type || 'active'} label={(o.type || '').replace('_', ' ')} />}
                    action={
                      <span className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn
                          icon={o.is_shortlisted ? BookmarkCheck : Bookmark}
                          tooltip={o.is_shortlisted ? 'Remove from shortlist' : 'Save to shortlist'}
                          color={o.is_shortlisted ? 'indigo' : 'default'}
                          onClick={(e) => toggleShortlist(o, e || { stopPropagation() {} })}
                        />
                        {locked
                          ? <ActionBtn icon={Lock} tooltip={`Need ${o.min_readiness_score} pts to apply`} color="default" onClick={() => {}} disabled />
                          : <ActionBtn icon={Send} tooltip="Apply now" color="green" onClick={() => setApplyTarget(o)} />}
                      </span>
                    }
                    fields={[
                      { label: 'Location', value: o.location ? `${o.location}${o.is_remote ? ' · Remote' : ''}` : (o.is_remote ? 'Remote' : '—') },
                      { label: 'Stipend', value: o.stipend_min ? `₹${o.stipend_min}${o.stipend_max ? `–${o.stipend_max}` : ''}/mo` : null },
                      { label: 'Deadline', value: o.deadline ? new Date(o.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : null },
                      { label: 'Min Score', value: o.min_readiness_score > 0 ? String(o.min_readiness_score) : null },
                      { label: 'Match', value: (forYouState?.active && o.match_score > 0) ? `${o.match_score}%` : null },
                    ]}
                  />
                );
              })
        }
        table={
          <table className="w-full text-sm">
            <OppTableHead />
            {loading ? <LoadingRows cols={9} rows={6} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {visible.map((o, idx) => {
                  const locked = !o.is_unlocked && o.min_readiness_score > 0;
                  return (
                    <tr key={o.id} onClick={() => setView(o)} className={`hover:bg-slate-50 transition-colors cursor-pointer ${locked ? 'opacity-60' : ''}`}>
                      <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View opportunity details" color="indigo" onClick={() => setView(o)} />
                          {/* Shortlisting is free once the hub is unlocked. */}
                          <ActionBtn
                            icon={o.is_shortlisted ? BookmarkCheck : Bookmark}
                            tooltip={o.is_shortlisted ? 'Remove from shortlist' : 'Save to shortlist'}
                            color={o.is_shortlisted ? 'indigo' : 'default'}
                            onClick={(e) => toggleShortlist(o, e || { stopPropagation() {} })}
                          />
                          {locked
                            ? <ActionBtn icon={Lock} tooltip={`Need ${o.min_readiness_score} pts to apply`} color="default" onClick={() => {}} disabled />
                            : <ActionBtn icon={Send} tooltip="Apply now" color="green" onClick={() => setApplyTarget(o)} />
                          }
                        </div>
                      </Td>
                      <Td>
                        <span className="font-semibold text-slate-900 max-w-xs truncate block">{o.title}</span>
                        {/* Only when the ranking actually ran — an unexplained
                            re-order is worse than no re-order. */}
                        {forYouState?.active && o.match_score > 0 && (
                          <span className="flex items-center gap-1.5 mt-0.5">
                            <span className="text-[10px] font-black uppercase tracking-wide text-purple-700
                                             bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded">
                              {o.match_score}% match
                            </span>
                            {o.is_fresh && (
                              <span className="text-[10px] font-black uppercase tracking-wide text-emerald-700
                                               bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                Fresh
                              </span>
                            )}
                            {o.why?.length > 0 && (
                              <span className="text-[10px] text-slate-400 truncate max-w-[10rem]">{o.why[0]}</span>
                            )}
                          </span>
                        )}
                      </Td>
                      <Td><span className="text-slate-600">{o.company}</span></Td>
                      <Td><StatusBadge status={o.type || 'active'} label={(o.type || '').replace('_', ' ')} /></Td>
                      <Td>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <MapPin size={11} />{o.location}{o.is_remote ? ' · Remote' : ''}
                        </span>
                      </Td>
                      <Td right>
                        <span className="text-emerald-700 font-medium text-xs">
                          {o.stipend_min
                            ? `₹${o.stipend_min}${o.stipend_max ? `–${o.stipend_max}` : ''}/mo`
                            : '—'}
                        </span>
                      </Td>
                      <Td>
                        <span className="text-xs text-slate-500">
                          {o.deadline ? new Date(o.deadline).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : '—'}
                        </span>
                      </Td>
                      <Td right>
                        {o.min_readiness_score > 0
                          ? <span className="text-xs text-amber-600 font-semibold">{o.min_readiness_score}</span>
                          : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        }
      />
      )}
      {!loading && !loadError && visible.length === 0 && (
        <EmptyState icon={Briefcase}
          message={savedOnly ? 'Nothing shortlisted yet' : 'No opportunities found'}
          sub={savedOnly ? 'Tap the bookmark on a role to save it here' : 'Try adjusting your search or filter'}
          action={savedOnly ? (
            <button type="button" onClick={() => setSavedOnly(false)}
              className="min-h-11 px-4 rounded-xl text-sm font-bold text-white"
              style={{ backgroundColor: 'var(--accent)' }}>
              Browse opportunities
            </button>
          ) : null} />
      )}
      {(loading || visible.length > 0) && (
      <div className="mt-3">
        <Pagination
          page={page} pages={pagination?.pages || 1} total={pagination?.total || 0}
          perPage={perPage} onPage={setPage} onPerPage={pp => { setPerPage(pp); setPage(1); }} />
      </div>
      )}
      </>
      )}

      {view && (
        <OpportunityDetailModal
          item={view}
          locked={!view.is_unlocked && view.min_readiness_score > 0}
          onApply={(o) => setApplyTarget(o)}
          onClose={() => setView(null)} />
      )}

      {applyTarget && (
        <ApplyModal opp={applyTarget} onClose={() => setApplyTarget(null)}
          onSuccess={() => {
            setApplyTarget(null);
            setToast('Application submitted!');
            setTimeout(() => setToast(''), 3000);
          }} />
      )}
    </StudentPage>
  );
}
