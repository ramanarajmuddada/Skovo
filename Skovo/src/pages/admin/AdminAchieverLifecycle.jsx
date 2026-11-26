import React, { useEffect, useState, useCallback, useMemo } from 'react';
import DateTimePicker from '../../components/ui/DateTimePicker';
import {
  ShieldCheck, Clock, AlertTriangle, Ban, CheckCircle2,
  Search, FileText, User, Eye, ExternalLink, RotateCcw,
} from 'lucide-react';
import { adminApi as api } from '../../services/api';
import {
  Card, Button, PageHeader, SectionTitle, StatCard, Modal, Textarea,
  Skeleton, EmptyState, useToast,
} from '../../components/ui/index.jsx';
import FormSelect from '../../components/ui/FormSelect';
import { ErrorState } from '../../components/ui/Overlays.jsx';
import AvatarImg from '../../components/ui/AvatarImg';
import { useMasters } from '../../hooks/useMasters';
import {
  Th, Td, ResponsiveTable, RowCard, StatusBadge, TableShell, Pagination, Avatar,
} from '../../components/ui/TableComponents.jsx';

// Mirrors MIN_COHORT_SEATS / MAX_COHORT_SEATS in admin_achiever_lifecycle.py.
// The server is the authority; these only stop a pointless round trip.
const MIN_SEATS = 1;
const MAX_SEATS = 1000;

// Who can be suspended or banned.
//
// NOT 'pending': there is nothing to suspend about an applicant who has never
// taught, and rejecting one of their documents is the correct answer - it is
// the action that actually gives them something to fix. It sits in the
// pending block -- and until the lift job was fixed, suspending a pending
// applicant promoted them to `active` the night it expired.
//
// NOT 'banned': the state machine refuses to leave 'banned'
// (BANNED_IS_TERMINAL), so both buttons would only ever produce an error.
const PUNISHABLE_STATES = ['active', 'suspended'];

// What <input type="datetime-local"> wants for `min`/`value`: YYYY-MM-DDTHH:mm
// in LOCAL time, with no zone on the end.
//
// toISOString() returns UTC, and feeding that to `min` shifts the floor by the
// whole UTC offset. In India that is -5:30, so a dialog opened at 21:28 IST
// published a floor of 16:58 and the picker cheerfully offered 21:28 - a time
// that had already passed. The submit guard caught it, but only after the
// admin had picked a date and wondered why the button stayed dead.
const toLocalInputValue = (ms) => {
  const d = new Date(ms);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
         `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/**
 * The admin's view of achievers: read the documents, accept or send them back,
 * then approve. Approval verifies the account and opens paid cohorts at once.
 */

const STATE_TONE = {
  pending:   'warning',
  active:    'success',
  suspended: 'warning',
  banned:    'danger',
};

// How a state is written into a sentence, as opposed to onto a badge:
// "They go back to active" reads; a badge-style "ACTIVE" does not.
const STATE_LABELS = {
  pending:   'the review queue as pending',
  active:    'active',
  suspended: 'the suspension that was in place',
};


function docsReady(r) {
  return (r.documents_pending || 0) === 0 && (r.documents_missing_required || 0) === 0;
}

/* Submitted, every required document accepted: only the approval is left. */
function readyToDecide(r) {
  return r.state === 'pending' && !!r.applied_at && docsReady(r);
}

/* The three document counts on a queue row, as phrases an admin can act on.
 *
 * `documents_missing_required` is the count of required types with no ACCEPTED
 * document -- so a type whose file is uploaded and waiting for review still
 * counts. Rendering that number as "required missing" told the admin nothing
 * had been sent when three files were sitting there for them, and the desktop
 * table printed "3 to review" and "3 required missing" side by side: the same
 * three files, counted twice, in two different alert colours.
 *
 * Subtracting the pending count is the closest the queue payload allows; it is
 * clamped at zero because a pending OPTIONAL document would push it negative.
 */
function docCounts(r) {
  const accepted = r.documents_accepted || 0;
  const pending = r.documents_pending || 0;
  const notAccepted = r.documents_missing_required || 0;
  return { accepted, pending, notUploaded: Math.max(0, notAccepted - pending) };
}

/* The filter dropdown lives in master data -- `master_achiever_queue_filter`,
 * registered in `master_registry`, so Admin > Masters edits the labels and the
 * order like every other dropdown. This array is the fallback useMasters uses
 * when the server sends nothing, so a half-seeded environment degrades to the
 * list the code has always had rather than an empty filter.
 *
 * Each `value` is a scope the queue query implements; a brand new value needs
 * backend work before it filters anything.
 */
const QUEUE_FILTERS = [
  { value: 'all',       label: 'In the queue' },
  { value: 'everyone',  label: 'Including decided' },
  { value: 'pending',   label: 'Documents to review' },
  { value: 'decision',  label: 'Ready to decide' },
];
const QUEUE_SCOPES = new Set(QUEUE_FILTERS.map(f => f.value));

const DOC_TONE = {
  accepted: 'emerald', approved: 'emerald',
  rejected: 'red', pending: 'amber',
};

function IdentityClaims({ achiever, name }) {
  return (
    <>
      <div className="flex items-start gap-3">
        {achiever.profile_image_url ? (
          <AvatarImg
            src={achiever.profile_image_url}
            alt=""
            className="w-16 h-16 rounded-2xl object-cover border border-slate-200 shrink-0"
          />
        ) : <Avatar name={achiever.full_name} size="lg" />}
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 truncate">{name}</p>
          <p className="text-xs text-slate-400 mt-0.5">What the documents are checked against</p>
        </div>
      </div>
      <dl className="space-y-3">
        {[
          // Typed by the achiever; match these with the ID document.
          ['Date of birth', achiever.date_of_birth
            ? `${new Date(achiever.date_of_birth).toLocaleDateString('en-IN',
                { day: 'numeric', month: 'short', year: 'numeric' })} · ${Math.floor((Date.now() - new Date(achiever.date_of_birth)) / 31557600000)} yrs`
            : null],
          ['Gender', achiever.gender],
          ['Designation', achiever.designation],
          ['Company', achiever.company],
          ['Phone', achiever.phone],
          ['Registered', achiever.registered_at
            ? new Date(achiever.registered_at).toLocaleDateString('en-IN',
                { day: 'numeric', month: 'short', year: 'numeric' })
            : null],
        ].map(([label, value]) => (
          <div key={label}>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{label}</dt>
            <dd className={`text-sm mt-0.5 break-words ${
              value ? 'text-slate-800' : 'text-slate-300 italic'}`}>
              {value || 'Not given'}
            </dd>
          </div>
        ))}
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">LinkedIn</dt>
          <dd className="text-sm mt-0.5 break-all">
            {achiever.linkedin_url ? (
              <a href={achiever.linkedin_url} target="_blank" rel="noreferrer"
                 className="text-blue-600 hover:underline inline-flex items-center gap-1 min-h-11">
                Open profile
                <ExternalLink size={12} className="shrink-0" />
              </a>
            ) : <span className="text-slate-300 italic">Not given</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Bio</dt>
          <dd className={`text-sm mt-0.5 leading-relaxed ${
            achiever.bio ? 'text-slate-800' : 'text-slate-300 italic'}`}>
            {achiever.bio || 'Not given'}
          </dd>
        </div>
      </dl>
    </>
  );
}

/**
 * One uploaded document, with the decision on it.
 *
 * The file opens in a new tab rather than inline: these are identity documents
 * on a private S3 bucket reached through a short-lived presigned redirect, and
 * an <img> that silently 403s after the link expires reads as a broken upload.
 */
function DocRow({ doc, label, onDecide, busy }) {
  const decided = ['accepted', 'approved', 'rejected'].includes(doc.status);
  return (
    <div className="rounded-xl border border-slate-200 p-3">
        <div className="flex items-start gap-3">
        <FileText size={16} className="text-slate-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-slate-800">
            {/* The master's name ("Government ID (Aadhaar / PAN / Passport)"),
                the same words the warning above uses -- not the raw key. */}
            {label || (doc.doc_type || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())}
          </p>
          {doc.claim && <p className="text-xs text-slate-500 mt-0.5">{doc.claim}</p>}
          {doc.original_name && (
            <p className="text-xs text-slate-400 truncate">{doc.original_name}</p>
          )}
          {doc.review_note && (
            <p className="text-xs text-slate-500 italic mt-1">Note: {doc.review_note}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 mt-2">
            <StatusBadge status={doc.status || 'pending'} tone={DOC_TONE[doc.status] || 'amber'} />
            {doc.file_url && (
              <a href={doc.file_url} target="_blank" rel="noreferrer"
                 className="inline-flex items-center gap-1 px-2 text-xs font-semibold text-blue-600 min-h-11"
                 aria-label="Open document">
                <Eye size={15} /> Open
              </a>
            )}
          </div>
        </div>
      </div>

      {!decided && (
        <div className="flex flex-col sm:flex-row gap-2 mt-3">
          <Button size="sm" variant="primary" disabled={busy}
                  className="w-full sm:w-auto min-h-11 sm:min-h-0"
                  onClick={() => onDecide(doc, 'accepted')}>Accept</Button>
          <Button size="sm" variant="secondary" disabled={busy}
                  className="w-full sm:w-auto min-h-11 sm:min-h-0"
                  onClick={() => onDecide(doc, 'rejected')}>Send back</Button>
        </div>
      )}
    </div>
  );
}

export default function AdminAchieverLifecycle() {
  const toast = useToast();

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed]   = useState(false);

  // 'everyone', not 'all'. The queue used to open on pending and later states, so
  // an achiever who had been approved - exactly the one whose reviews you go
  // looking at months later - was invisible until you knew to change a filter
  // you had no reason to touch.
  const [filter, setFilter]   = useState('everyone');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [perPage, setPerPage] = useState(20);

  const [selected, setSelected] = useState(null);   // achiever row
  const [dossier, setDossier] = useState(null);   // documents + what blocks approval
  // The document being rejected, and why. Rejecting without a reason left
  // the achiever looking at a refused document and no idea what to fix.
  const [rejectDoc, setRejectDoc] = useState(null);
  // Asking for a document that is not there yet -- the third lever beside
  // Accept and Reject, both of which need one to already exist.
  const [askOpen, setAskOpen] = useState(false);
  const [askType, setAskType] = useState('');
  const [askNote, setAskNote] = useState('');
  const [rejectNote, setRejectNote] = useState('');
  const [approveTarget, setApproveTarget] = useState(null);
  // Seats granted per cohort at approval. Kept as a string so the field can be
  // genuinely empty rather than showing a 0 the admin did not choose.
  // A datetime, not one of four fixed periods. The backend has always
  // accepted an explicit `until` - 'period must be one of 1m, 4m, 6m,
  // indefinite - or pass an explicit until date' - and the UI simply never
  // sent one, so an admin could suspend for 1, 4 or 6 months and nothing in
  // between. The preset list was also duplicated: SUSPENSION_OPTIONS here and
  // SUSPENSION_PRESETS in admin_achiever_lifecycle.py, two constants that had
  // to agree and nothing enforcing it.
  const [until, setUntil] = useState('');
  // Indefinite is still reachable - it is a real choice, not the absence of
  // one, and it is the only path that does NOT lift itself.
  const [indefinite, setIndefinite] = useState(false);
  // Captured when the dialog opens, not read during render: Date.now() in a
  // render pass is impure, so the same `until` could format as two different
  // durations depending on when React happened to re-render.
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [approveSeats, setApproveSeats] = useState('');
  // 'limited' | 'unlimited' | '' (undecided). Unlimited has to be a CHOICE,
  // not an empty box: the field was mandatory while unlimited meant 'no
  // number', so there was literally no way to approve someone with uncapped
  // cohorts. An empty box now means 'not answered yet' everywhere, always.
  const [approveMode, setApproveMode] = useState('');

  // What the admin actually needs to see: not the ISO string they picked, but
  // how long it is. Shown live under the field so a date and a duration can
  // never disagree - they are the same value read two ways.
  const suspensionLength = useMemo(() => {
    if (indefinite) return 'No automatic reinstatement — you lift this by hand.';
    if (!until) return '';
    const end = new Date(until);
    if (Number.isNaN(end.getTime())) return '';
    const ms = end.getTime() - openedAt;
    if (ms <= 0) return 'That is in the past — pick a date after today.';
    const parts = [];
    // Under a day this used to round to "0 days", which read as a suspension
    // that does nothing. A short suspension is a real thing to want - not
    // least while testing the lift job - so it gets counted in its own units.
    if (ms < 86400000) {
      const mins = Math.max(1, Math.round(ms / 60000));
      const hours = Math.floor(mins / 60);
      const restMins = mins % 60;
      if (hours) parts.push(`${hours} hour${hours > 1 ? 's' : ''}`);
      if (restMins || !hours) parts.push(`${restMins} minute${restMins === 1 ? '' : 's'}`);
    } else {
      const days = Math.round(ms / 86400000);
      const months = Math.floor(days / 30);
      const rest = days % 30;
      if (months) parts.push(`${months} month${months > 1 ? 's' : ''}`);
      if (rest || !months) parts.push(`${rest} day${rest === 1 ? '' : 's'}`);
    }
    return `${parts.join(' ')} — reinstated automatically on ` +
      end.toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric',
                                    hour:'numeric', minute:'2-digit' });
  }, [until, indefinite, openedAt]);

  const seatError = useMemo(() => {
    if (approveMode !== 'limited') return '';    // nothing to validate
    if (approveSeats === '') return '';         // not answered yet, not wrong
    const n = Number(approveSeats);
    if (!Number.isInteger(n)) return 'Enter a whole number of seats.';
    if (n < MIN_SEATS || n > MAX_SEATS) return `Seats must be between ${MIN_SEATS} and ${MAX_SEATS}.`;
    return '';
  }, [approveSeats, approveMode]);

  // The approve dialog opens on the cap this achiever already has, not on an
  // empty box. It matters after an unban: a ban lift returns them to pending,
  // so approval is asked for a second time, and everything they had - seats,
  // accepted documents - survived that round trip. Making the
  // admin re-type the number is how a cap silently changes.
  //
  // Only a number prefills. NULL in the column means two different things -
  // 'approved with unlimited cohorts' and 'never approved, nobody has decided'
  // - and nothing in the row tells them apart, so it stays undecided and the
  // admin answers. Guessing 'Unlimited' for a first-time applicant would be
  // the worst of the three outcomes.
  //
  // Done here rather than in an effect on `approveTarget`: opening the dialog
  // is an event, and deriving the fields from it in an effect is a second
  // render for no reason.
  const openApprove = (row) => {
    const seats = row?.cohort_seat_allocation;
    if (Number.isFinite(seats) && seats > 0) {
      setApproveMode('limited');
      setApproveSeats(String(seats));
    } else {
      setApproveMode('');
      setApproveSeats('');
    }
    setApproveTarget(row);
  };

  const [modal, setModal]   = useState(null);       // 'reinstate' | 'suspend' | 'ban' | 'unban'
  const [reason, setReason] = useState('');
  const [busy, setBusy]     = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const { data } = await api.get(`/skovo-platform-panel-admin/achiever-lifecycle/queue${filter === 'everyone' ? '?scope=all' : ''}`);
      if (data?.bool) setRows(data.response.items || []);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // set-state-in-effect fires on any effect that can reach setState, which
  // includes fetch-on-mount. State here is set inside an awaited callback,
  // not synchronously during render.
  //
  // `load` is rebuilt when `filter` changes -- 'everyone' asks the server for a
  // wider set, not just a different client-side filter -- so this refetches.
  //
  // There was an eslint-disable for that rule on the next line. It became an
  // "unused directive" warning once this component grew, because the rule
  // stopped resolving `load` and no longer reports here at all. Removed rather
  // than left as dead noise; if it starts firing again, the paragraph above is
  // the reason it is safe to suppress.
  useEffect(() => { void load(); }, [load]);

  const loadDossier = async (achieverId) => {
    try {
      const { data } = await api.get(
        `/skovo-platform-panel-admin/achiever-lifecycle/${achieverId}/dossier`);
      if (data?.bool) setDossier(data.response);
    } catch {
      toast?.error?.('Could not load the documents.');
    }
  };

  const openAchiever = (row) => {
    setSelected(row);
    setDossier(null);
    // Documents matter most while pending — approval is refused until every
    // required one is accepted — but they stay readable at any state.
    void loadDossier(row.achiever_id);
  };

  // Accepting needs no explanation; rejecting always does, so it goes through
  // the prompt rather than straight to the API.
  const requestDocument = async () => {
    if (!askType || !askNote.trim()) return;
    setBusy(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/achiever-lifecycle/${selected.achiever_id}/document-requests`,
        { doc_type: askType, note: askNote.trim() });
      if (data?.bool) {
        toast?.success?.(data.response.message);
        setAskOpen(false); setAskType(''); setAskNote('');
        await loadDossier(selected.achiever_id);
      } else {
        toast?.error?.(data?.response?.message || 'Could not send that request.');
      }
    } catch {
      toast?.error?.('Could not send that request.');
    } finally { setBusy(false); }
  };

  const withdrawRequest = async (req) => {
    setBusy(true);
    try {
      const { data } = await api.delete(
        `/skovo-platform-panel-admin/achiever-lifecycle/${selected.achiever_id}/document-requests/${req.id}`);
      if (data?.bool) {
        toast?.success?.('Request withdrawn.');
        await loadDossier(selected.achiever_id);
      } else {
        toast?.error?.(data?.response?.message || 'Could not withdraw it.');
      }
    } catch {
      toast?.error?.('Could not withdraw it.');
    } finally { setBusy(false); }
  };

  const decideDoc = async (doc, status, note) => {
    if (status === 'rejected' && !note) { setRejectDoc(doc); setRejectNote(''); return; }
    setBusy(true);
    try {
      const { data } = await api.patch(
        `/skovo-platform-panel-admin/achiever-trust/documents/${doc.id}`,
        note ? { status, note } : { status });
      if (data?.bool) {
        toast?.success?.(status === 'accepted' ? 'Document accepted.' : 'Document sent back.');
        setRejectDoc(null); setRejectNote('');
        await loadDossier(selected.achiever_id);
        load();          // documents_pending on the queue row moves too
      } else {
        toast?.error?.(data?.response?.message || 'Could not record that.');
      }
    } catch {
      toast?.error?.('Could not record that.');
    } finally {
      setBusy(false);
    }
  };

  // Ours is a manual check, so whoever ran it records what came back. Without
  // The BGV handlers (`startBgv` / `closeBgv`) were removed with the box on
  // 10 Sep 2026 — they became unreachable and ESLint flagged them. Nothing
  // server-side changed: POST and PATCH
  // /skovo-platform-panel-admin/achiever-trust/<id>/bgv still exist, and
  // `bgv_status` is still stored and still read by the public profile. To
  // bring the control back, restore this block and the panel in the dossier.

  const act = async (kind) => {
    if (!selected) return;
    if (!reason.trim()) { toast?.error?.('A reason is required.'); return; }
    setBusy(true);
    const id = selected.achiever_id;
    const base = `/skovo-platform-panel-admin/achiever-lifecycle/${id}`;
    try {
      let res;
      if (kind === 'suspend') {
        // `until` is an ISO datetime the server parses directly; the
        // 'indefinite' preset is the one case with no end date.
        res = await api.post(`${base}/suspend`, indefinite
          ? { period: 'indefinite', reason: reason.trim() }
          : { until: new Date(until).toISOString(), reason: reason.trim() });
      } else if (kind === 'reinstate') {
        res = await api.post(`${base}/reinstate`, { reason: reason.trim() });
      } else if (kind === 'ban') {
        res = await api.post(`${base}/ban`, { reason: reason.trim() });
      } else if (kind === 'unban') {
        // Its own endpoint, not a state change: sp_achiever_set_state refuses
        // to leave 'banned' on purpose, so lifting one is asked for by name.
        res = await api.post(`${base}/unban`, { reason: reason.trim() });
      }
      if (res?.data?.bool) {
        toast?.success?.(res.data.response.message || 'Done.');
        setModal(null); setReason(''); setUntil(''); setIndefinite(false);
        setSelected(null);
        void load();
      } else {
        toast?.error?.(res?.data?.response?.message || 'That did not work.');
      }
    } catch {
      toast?.error?.('Connection error.');
    } finally {
      setBusy(false);
    }
  };

  const markActive = (row) => {
    const patched = { ...row, state: 'active' };
    setRows(prev => prev.map(r => r.achiever_id === row.achiever_id ? { ...r, ...patched } : r));
    setSelected(cur => (cur?.achiever_id === row.achiever_id ? { ...cur, ...patched } : cur));
    return patched;
  };

  const approveApplication = async (row, seats) => {
    if (!row) return;
    setBusy(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/achiever-lifecycle/${row.achiever_id}/approve-application`,
        { cohort_seats: seats });   // null = unlimited, a number = the cap
      if (data?.bool) {
        toast?.success?.(data.response.message);
        markActive(row);
        // Documents-to-review hides anyone who is no longer pending, which
        // looked like the approve never happened. Show the queue instead.
        if (filter === 'pending' || filter === 'decision') setFilter('all');
        if (selected?.achiever_id === row.achiever_id) await loadDossier(row.achiever_id);
        await load();
      } else {
        const msg = data?.response?.message || 'Could not approve.';
        // First click already moved them; a stale list still offered Approve
        // and the second click read as a failure.
        if (/not awaiting|NOT_PENDING/i.test(msg)) {
          toast?.success?.('Already approved.');
          markActive(row);
          if (filter === 'pending') setFilter('all');
          await load();
        } else {
          toast?.error?.(msg);
          openAchiever(row);
        }
      }
    } catch {
      toast?.error?.('Connection error.');
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter(r => {
      if (filter === 'decision' && !readyToDecide(r)) return false;
      if (filter === 'everyone') { /* no state filter -- show them all */ }
      if (filter === 'pending' && r.state !== 'pending') return false;
      if (!q) return true;
      return [r.full_name, r.email, r.company, r.designation]
        .some(v => (v || '').toLowerCase().includes(q));
    });
  }, [rows, filter, search]);

  // Labels and order come from master data; the hardcoded list is the fallback.
  const { lists: masterLists } = useMasters(['achiever_queue_filter'],
                                            { achiever_queue_filter: QUEUE_FILTERS });
  // A row whose value the queue does not implement would render a filter that
  // silently returns nothing, so unknown values are dropped rather than shown.
  const queueFilters = useMemo(() => {
    const rows = masterLists.achiever_queue_filter || QUEUE_FILTERS;
    const usable = rows.filter(o => QUEUE_SCOPES.has(o.value));
    return usable.length ? usable : QUEUE_FILTERS;
  }, [masterLists]);

  const counts = useMemo(() => ({
    total: rows.length,
    // "Waiting on you" is every row this admin owes an action on: documents
    // sitting unread, or an application ready to approve.
    waiting: rows.filter(r => readyToDecide(r) || (r.documents_pending || 0) > 0).length,
    pending: rows.filter(r => r.state === 'pending').length,
    verified: rows.filter(r => r.state === 'active').length,
  }), [rows]);

  // This list rendered every row it had. That is survivable while the queue is
  // two people and not once it is two hundred, and it was the one list in the
  // admin portal without the pager every other one has.
  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  const pageSafe = Math.min(page, totalPages);
  const paged = useMemo(
    () => filtered.slice((pageSafe - 1) * perPage, pageSafe * perPage),
    [filtered, pageSafe, perPage],
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-20" />
        <Skeleton className="h-64" />
      </div>
    );
  }
  if (failed) return <ErrorState onRetry={load} />;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <PageHeader
        title="Achiever review"
        subtitle="Read documents, accept or send them back, then approve. The only yes is Approve application."
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Clock}       label="Waiting on you"  value={counts.waiting} />
        <StatCard icon={FileText}    label="Applications"    value={counts.pending} />
        <StatCard icon={ShieldCheck} label="Verified"        value={counts.verified} />
        {/* `counts.total` is rows.length -- whatever the current filter fetched.
            Under "Including decided" that is everyone, decided achievers
            included, so a banned or active achiever was being counted as "in
            queue" while the three cards beside it correctly read 0. The number
            was right; the word was not. */}
        <StatCard icon={User}
                  label={filter === 'everyone' ? 'Total shown' : 'Total in queue'}
                  value={counts.total} />
      </div>

      <Card className="p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="md:col-span-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                id="achiever-queue-search"
                name="achiever_queue_search"
                type="search"
                aria-label="Search achievers by name, email, company or role"
                value={search}
                // Back to page 1 on every narrowing, or a search run from page
                // 3 lands on an empty page of its own results.
                onChange={e => { setSearch(e.target.value); setPage(1); }}
                placeholder="Name, email or role…"
                className="w-full min-h-11 border border-slate-200 rounded-xl pl-9 pr-3 py-2.5 text-sm
                           focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          </div>
          {/* FormSelect is searchable by default — the founder call in
              CONVENTIONS.md, so every dropdown behaves the same way. */}
          <FormSelect
            value={filter}
            onChange={v => { setFilter(v); setPage(1); }}
            options={queueFilters}
            placeholder="Filter"
          />
        </div>
      </Card>

      {!filtered.length ? (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing waiting"
          subtitle={search || filter !== 'all'
            ? 'No one matches this filter.'
            : 'Every achiever has been reviewed.'}
        />
      ) : (
        <ResponsiveTable
          breakpoint="lg"
          table={
            <table className="w-full">
              <thead>
                <tr>
                  <Th>Achiever</Th>
                  <Th>State</Th>
                  <Th>Documents</Th>
                  <Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {paged.map(r => (
                  <tr key={r.achiever_id} className="hover:bg-slate-50">
                    <Td>
                      <button onClick={() => openAchiever(r)}
                              className="flex items-center gap-2.5 text-left">
                        {/* Initials when there is no photo, as on Achievers. */}
                        {r.profile_image_url
                          ? <AvatarImg src={r.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                          : <Avatar name={r.full_name} size="md" />}
                        <span className="min-w-0">
                          <p className="font-semibold text-slate-900">{r.full_name}</p>
                          <p className="text-xs text-slate-500">{r.email}</p>
                          {(r.designation || r.company) && (
                            <p className="text-xs text-slate-400 mt-0.5">
                              {[r.designation, r.company].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </span>
                      </button>
                    </Td>
                    <Td><StatusBadge status={r.state} tone={STATE_TONE[r.state]} /></Td>
                    <Td>
                      <span className="text-sm text-slate-700">{docCounts(r).accepted} accepted</span>
                      {docCounts(r).pending > 0 && (
                        <span className="ml-2 text-xs text-amber-600">
                          {docCounts(r).pending} to review
                        </span>
                      )}
                      {docCounts(r).notUploaded > 0 && (
                        <span className="ml-2 text-xs text-red-600">
                          {docCounts(r).notUploaded} not uploaded
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {/* Approval is refused until every required document has
                          been accepted, so offering it from the list produced a
                          409 and no way to act on it. When there is still
                          something to read, the button opens the dossier -- which
                          is where accepting happens -- and only becomes Approve
                          once nothing is outstanding. */}
                      {r.state === 'pending' ? (
                        !r.applied_at ? (
                          <span className="inline-flex items-center min-h-11 px-3 rounded-lg text-xs font-semibold bg-slate-100 text-slate-500">
                            Not submitted yet
                          </span>
                        ) : !docsReady(r) ? (
                          <Button size="sm" variant="primary"
                                  onClick={() => openAchiever(r)}>
                            Review documents
                          </Button>
                        ) : (
                          <Button size="sm" variant="primary" disabled={busy} className="min-h-11"
                                  onClick={() => openApprove(r)}>
                            Approve application
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="secondary"
                                onClick={() => openAchiever(r)}>
                          View
                        </Button>
                      )}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
          cards={paged.map(r => (
            <RowCard
              key={r.achiever_id}
              onClick={() => openAchiever(r)}
              avatar={r.profile_image_url
                ? <AvatarImg src={r.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover" />
                : <Avatar name={r.full_name} size="md" />}
              title={r.full_name}
              subtitle={r.email}
              badge={<StatusBadge status={r.state} tone={STATE_TONE[r.state]} />}
              action={r.state === 'pending' && docsReady(r) ? (
                <Button size="sm" variant="primary" disabled={busy} className="min-h-11"
                        onClick={(e) => { e.stopPropagation(); openApprove(r); }}>
                  Approve
                </Button>
              ) : (
                <span className="text-xs font-semibold text-blue-600 shrink-0 py-3">Open</span>
              )}
              fields={[
                { label: 'Documents', value: (() => {
                    const { accepted, pending, notUploaded } = docCounts(r);
                    return [
                      `${accepted} accepted`,
                      pending ? `${pending} to review` : null,
                      notUploaded ? `${notUploaded} not uploaded` : null,
                    ].filter(Boolean).join(' · ');
                  })() },
              ]}
            />
          ))}
        />
      )}

      {filtered.length > 0 && (
        <TableShell>
          <Pagination
            page={pageSafe}
            pages={totalPages}
            total={filtered.length}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
          />
        </TableShell>
      )}

      {/* ── Approve ──────────────────────────────────────────────────────── */}
      {approveTarget && (
        <Modal isOpen nested={!!selected} onClose={() => setApproveTarget(null)}
               title={`Approve ${approveTarget.full_name}`}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              This verifies their account. They can create paid cohorts straight away.
            </p>

            {/* Only shown on a second pass through the queue - after an unban,
                where they arrive with everything they already had. Saying so
                stops the dialog reading as if the account were starting over. */}
            {Number.isFinite(approveTarget.cohort_seat_allocation) && (
              <p className="text-xs text-slate-500 leading-relaxed bg-slate-50 rounded-lg px-3 py-2">
                They keep what they already had — their accepted documents are
                untouched. The cap below is the one on their account now.
              </p>
            )}

            <div>
              <p className="block text-sm font-semibold text-slate-700 mb-2">
                How many students per cohort? <span className="text-red-500">*</span>
              </p>
              <div className="space-y-2">
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <input type="radio" name="approve-seat-mode" value="limited"
                         checked={approveMode === 'limited'}
                         onChange={() => setApproveMode('limited')}
                         className="w-4 h-4" />
                  <span>Limited to</span>
                  <input
                    id="approve-seats" type="number" min={MIN_SEATS} max={MAX_SEATS} step="1"
                    value={approveSeats}
                    onChange={e => { setApproveSeats(e.target.value); setApproveMode('limited'); }}
                    placeholder="e.g. 5"
                    className="w-24 border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm
                               focus:outline-none focus:ring-2 focus:ring-blue-300" />
                  <span>students</span>
                </label>
                <label className="flex items-center gap-2.5 text-sm text-slate-700 cursor-pointer">
                  <input type="radio" name="approve-seat-mode" value="unlimited"
                         checked={approveMode === 'unlimited'}
                         onChange={() => { setApproveMode('unlimited'); setApproveSeats(''); }}
                         className="w-4 h-4" />
                  <span>Unlimited</span>
                </label>
              </div>
              {seatError ? (
                <p className="text-xs text-red-600 mt-2">{seatError}</p>
              ) : (
                <p className="text-xs text-slate-400 mt-2">
                  {approveMode === 'unlimited'
                    ? 'Their cohorts will accept any number of students.'
                    : 'Every cohort they create is capped at this many. You can change it later on the Achievers screen.'}
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="ghost" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                      onClick={() => setApproveTarget(null)}>Cancel</Button>
              <Button variant="primary" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                      disabled={busy || !!seatError || approveMode === ''
                        || (approveMode === 'limited' && approveSeats === '')}
                      onClick={() => {
                        const target = approveTarget;
                        const seats = approveMode === 'unlimited' ? null : Number(approveSeats);
                        setApproveTarget(null);
                        setApproveSeats(''); setApproveMode('');
                        void approveApplication(target, seats);
                      }}>
                {busy ? 'Working…' : 'Approve application'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {/* Why, not just no. The achiever sees this text on their own screen, so
          it is the whole of what they have to go on when re-uploading. */}
      {/* Asking for something specific, by type, so the achiever gets a real
          upload slot rather than a message to interpret. */}
      {askOpen && selected && (
        <Modal isOpen nested onClose={() => setAskOpen(false)}
               title={`Ask ${selected.full_name} for a document`} size="md"
               footer={
                 <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                   <Button variant="secondary" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                           onClick={() => setAskOpen(false)}>Cancel</Button>
                   <Button variant="primary" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                           disabled={!askType || !askNote.trim() || busy}
                           onClick={requestDocument}>
                     Send request
                   </Button>
                 </div>
               }>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              They get a new upload slot for exactly this type, with your note
              beside it. Nothing else about their application changes.
            </p>

            <div>
              {/* FormSelect, not a bare <select>. Every other dropdown on this screen
                  uses it; this one rendered in OS chrome, so it ignored dark mode
                  entirely and showed a white list on a dark dialog. It also gets the
                  44px trigger and options, and the search box, for free. */}
              <FormSelect
                label="Which document"
                value={askType}
                onChange={setAskType}
                placeholder="Choose a document type…"
                options={(dossier?.doc_types || []).map(t => ({ value: t.value, label: t.label }))}
              />
              {/* Already on file, so asking again is usually a mistake -- but not
                  always: a rejected one has to be asked for again. Said plainly
                  rather than blocking the choice. */}
              {askType && (dossier?.documents || []).some(d => d.doc_type === askType) && (
                <p className="text-xs text-amber-700 mt-1.5">
                  They have already sent one of these. What they send now is added
                  beside it — the one you accepted stays as it is — so say in the
                  note which one you want them to look at.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="ask-note" className="block text-xs font-semibold text-slate-600 mb-1">
                What do you need, and why <span className="text-red-500">*</span>
              </label>
              {/* The example moved out of the placeholder. At 97 characters it was
                  three clipped lines inside a 3-row box on a phone, so the one
                  thing it was there to demonstrate -- naming the claim you are
                  checking against -- was the part that got cut off. */}
              <Textarea id="ask-note" name="ask_note" rows={4} value={askNote}
                onChange={(e) => setAskNote(e.target.value)}
                placeholder="Say what you need and why" />
            </div>
          </div>
        </Modal>
      )}

      {rejectDoc && (
        <Modal isOpen nested onClose={() => { setRejectDoc(null); setRejectNote(''); }}
               title="Send this document back" size="md"
               footer={
                 <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                   <Button variant="secondary" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                           onClick={() => { setRejectDoc(null); setRejectNote(''); }}>
                     Cancel
                   </Button>
                   <Button variant="danger" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                           disabled={!rejectNote.trim() || busy}
                           onClick={() => decideDoc(rejectDoc, 'rejected', rejectNote.trim())}>
                     Send back
                   </Button>
                 </div>
               }>
          <div className="space-y-4">
            <p className="text-sm text-slate-600 leading-relaxed">
              They see this on their verification screen and upload a replacement.
              Their other documents are not affected.
            </p>
            <div>
              {/* The rule belongs on the label. As grey text under an empty box it
                  sat where an error message goes, so it read as a validation
                  failure before anything had been typed -- and it disappeared the
                  moment you typed, which is when a hint is least useful.

                  The 89-character example came out of the placeholder: in a 3-row
                  box at 320px it filled the field, and the sentence above already
                  says what to write. */}
              <label htmlFor="reject-note" className="block text-xs font-semibold text-slate-600 mb-1">
                What was wrong with it <span className="text-red-500">*</span>
              </label>
              <Textarea
                id="reject-note"
                name="reject_note"
                rows={4}
                value={rejectNote}
                onChange={(e) => setRejectNote(e.target.value)}
                placeholder="e.g. the photo is too blurry to read"
              />
            </div>
          </div>
        </Modal>
      )}

      {selected && (
        <Modal isOpen onClose={() => { setSelected(null); setDossier(null); }}
               title="Case file" size="xl">
          <div className="space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900 break-words">{selected.full_name}</h2>
                <p className="text-sm text-slate-500 mt-0.5 break-all">{selected.email}</p>
                {(selected.designation || selected.company) && (
                  <p className="text-sm text-slate-500">
                    {[selected.designation, selected.company].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <StatusBadge status={selected.state} tone={STATE_TONE[selected.state]} />
            </div>

            {/* Seats per cohort used to be editable here. It moved to
                Achievers > Manage: this screen decides applications, and once
                an achiever is approved they leave its queue, so changing a cap
                weeks later meant reopening a review case for someone there was
                nothing left to review about.

                It was also showing the wrong number. The panel read
                `selected.cohort_seat_allocation`, and `selected` comes from the
                queue payload, which does not carry that field -- so it said
                "Currently unlimited" to an admin looking at an achiever capped
                at 1. Approval still sets the number. */}

            {/* Documents first on a phone — that is the job. Profile claims
                sit under a fold, and from lg up they sit in a side column
                because reviewing evidence without the claims is not reviewing. */}
            {dossier?.achiever && (
              <div className="grid lg:grid-cols-[minmax(0,18rem)_1fr] gap-5">
                <div className="min-w-0 space-y-4 lg:col-start-2">

            {/* Documents and background check. Approval is refused until every
                required document is accepted, so this has to sit above the
                Approve button — and say which ones are outstanding rather than
                leaving a greyed-out button to explain itself. */}
            {dossier && (
              <>
                <SectionTitle>Documents</SectionTitle>

                {/* What has been asked for by hand, and whether it has arrived.
                    Above the file list because it is the reviewer's own
                    outstanding question. */}
                {(dossier.document_requests || []).length > 0 && (
                  <div className="space-y-2">
                    {dossier.document_requests.map(r => (
                      <div key={r.id} className={`rounded-xl border p-3 ${
                        r.fulfilled ? 'border-emerald-200 bg-emerald-50/60' : 'border-blue-200 bg-blue-50/60'}`}>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-slate-900">
                              {r.fulfilled ? 'Received: ' : 'Asked for: '}{r.label}
                            </p>
                            {r.note && (
                              <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{r.note}</p>
                            )}
                          </div>
                          {!r.fulfilled && (
                            <button type="button" onClick={() => withdrawRequest(r)} disabled={busy}
                              className="py-3 text-xs font-semibold text-slate-500 hover:text-red-600 shrink-0">
                              Withdraw
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {dossier.missing_required.length > 0 && (
                  <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                    {(() => {
                      // "Outstanding" read as missing when they were uploaded and only
                      // waiting for this admin to accept them -- say which it is.
                      const n = dossier.missing_required.length;
                      const waiting = dossier.missing_required.filter(m => (dossier.documents || [])
                        .some(d => d.doc_type === m.value && !['rejected'].includes(d.status))).length;
                      const notUploaded = n - waiting;
                      const plural = (k) => (k === 1 ? '' : 's');
                      return (
                        <p className="text-sm font-semibold text-amber-900">
                          {notUploaded === 0
                            ? `Accept the ${n} required document${plural(n)} below before approving`
                            : `Cannot approve yet — ${notUploaded} required document${plural(notUploaded)} not uploaded`
                              + (waiting ? `, ${waiting} waiting for you to accept` : '')}
                        </p>
                      );
                    })()}
                    <p className="text-xs text-amber-800 mt-0.5">
                      {dossier.missing_required.map(m => m.label || m.value).join(', ')}
                    </p>
                  </div>
                )}

                {dossier.documents.length ? (
                  <div className="space-y-2">
                    {dossier.documents.map(d => (
                      <DocRow key={d.id} doc={d} onDecide={decideDoc} busy={busy}
                              label={(dossier.doc_types || []).find(t => t.value === d.doc_type)?.label} />
                    ))}
                  </div>
                ) : (
                  <EmptyState icon={FileText} title="Nothing uploaded yet"
                              subtitle="This achiever has not submitted any documents." />
                )}

                {/* Below the list, not above it: asking for something else is a
                    decision you reach by reading what is already there. At the
                    top it sat between the admin and the documents they opened
                    the case file to read. */}
                <div className="flex">
                  <Button size="sm" variant="secondary"
                          className="w-full sm:w-auto min-h-11 sm:min-h-0"
                          onClick={() => setAskOpen(true)}>
                    Ask for a document
                  </Button>
                </div>

                {/* Background-check box removed on request (10 Sep 2026).
                    It was status-only and said so — "this does not approve the
                    person" — so it occupied the most prominent row of the
                    dossier while changing nothing about the decision the admin
                    is actually there to make.

                    Nothing server-side changed. POST and PATCH
                    /skovo-platform-panel-admin/achiever-trust/<id>/bgv still
                    exist, `bgv_status` is still stored, and the public profile
                    still shows "Background check cleared" from it — so any
                    check already recorded is intact and still visible to
                    students.

                    The `startBgv` / `closeBgv` handlers went with the box:
                    unreachable code that ESLint fails on. Restoring the
                    control means restoring both this panel and those two
                    handlers, which is why the removed code is described where
                    they used to live rather than only here. */}

                {selected.state === 'pending' && dossier.submitted === false && (
                  <div className="rounded-xl bg-slate-50 border border-slate-200 p-3">
                    <p className="text-sm font-semibold text-slate-800">Not submitted yet</p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      The achiever is still filling the application. You can approve it once they click Submit for review.
                    </p>
                  </div>
                )}
                {selected.state === 'pending' && (
                  <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2 border-t border-slate-100">
                    <Button
                      variant="primary"
                      className="w-full sm:w-auto min-h-11"
                      disabled={!dossier.can_approve || busy}
                      onClick={() => openApprove(selected)}
                    >
                      Approve application
                    </Button>
                    {/* The panel-level "Send back" was removed.
                    
                        Its only effect was to move the account back to pending. It left
                        every document Accepted and application_status submitted, so the achiever landed on "With the admin team -
                        Pending review" at 75% with no upload box, no button and no sight of
                        the reason. Nothing they could do; only an admin approving them again
                        moved it on.
                    
                        Rejecting a DOCUMENT is the working version and is still here: it
                        flips that document to rejected and the achiever immediately gets an
                        upload box for exactly that file with the reason on it. Two buttons
                        reading "Send back" on one screen, one of which dead-ends, is worse
                        than one that works. */}
                  </div>
                )}
              </>
            )}
                </div>
                <details className="rounded-2xl border border-slate-200 p-4 h-fit lg:hidden">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">
                    Profile claims
                  </summary>
                  <div className="mt-4 space-y-4">
                    <IdentityClaims achiever={dossier.achiever} name={selected.full_name} />
                  </div>
                </details>
                <div className="hidden lg:block rounded-2xl border border-slate-200 p-4 space-y-4 h-fit lg:col-start-1 lg:row-start-1">
                  <IdentityClaims achiever={dossier.achiever} name={selected.full_name} />
                </div>
              </div>
            )}
            {/* The /reinstate endpoint has always existed and nothing called it, so a
                suspension could be applied from this screen but never lifted from it.
                An indefinite one was therefore permanent in practice - the only thing
                that undid a suspension was a dated one expiring by itself. */}
            {selected.state === 'suspended' && (
              <div className="pt-2 border-t border-slate-100 space-y-2">
                {/* Which kind of suspension this is, said plainly. Both kinds
                    used to render as the single word "Suspended", so the one
                    that lifts itself overnight and the one that waits for an
                    admin forever were indistinguishable on this screen. The
                    reason is read from the dossier, not the queue row: the row
                    never carried state_reason, so this line never appeared. */}
                <div className="rounded-xl bg-amber-50 border border-amber-200 p-3">
                  <p className="text-xs font-semibold text-amber-900">
                    {dossier?.achiever?.suspended_until
                      ? `Lifts automatically on ${new Date(dossier.achiever.suspended_until)
                          .toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric',
                                                     hour:'numeric', minute:'2-digit' })}`
                      : 'No end date — this stays until an admin lifts it.'}
                  </p>
                  {(dossier?.achiever?.state_reason || selected.state_reason) && (
                    <p className="text-xs text-amber-800 mt-1 leading-relaxed">
                      {dossier?.achiever?.state_reason || selected.state_reason}
                    </p>
                  )}
                </div>
                <Button variant="primary" className="w-full sm:w-auto min-h-11"
                        onClick={() => { setModal('reinstate'); setReason(''); }}>
                  Lift suspension
                </Button>
              </div>
            )}
            
            {PUNISHABLE_STATES.includes(selected.state) && (
              <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2 border-t border-slate-100">
                <Button variant="outline" className="w-full sm:w-auto min-h-11"
                        onClick={() => { setModal('suspend'); setReason(''); setOpenedAt(Date.now()); }}>
                  <AlertTriangle size={14} className="mr-1.5" /> Suspend
                </Button>
                <Button variant="danger" className="w-full sm:w-auto min-h-11"
                        onClick={() => { setModal('ban'); setReason(''); }}>
                  <Ban size={14} className="mr-1.5" /> Ban permanently
                </Button>
              </div>
            )}

            {/* A banned achiever had no controls at all: the state machine
                refuses to leave 'banned', so Suspend and Ban would only ever
                error, and the case file ended with nothing to press. That left
                a ban placed by mistake with no route back through the product
                -- the only fix was editing the database by hand. */}
            {selected.state === 'banned' && (
              <div className="flex flex-col sm:flex-row flex-wrap gap-2 pt-2 border-t border-slate-100">
                <Button variant="outline" className="w-full sm:w-auto min-h-11"
                        onClick={() => { setModal('unban'); setReason(''); }}>
                  <RotateCcw size={14} className="mr-1.5" /> Lift the ban
                </Button>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* ── Decision modals ──────────────────────────────────────────────── */}
      {modal && (
        <Modal isOpen nested={!!selected} onClose={() => setModal(null)} title={{
          reinstate: 'Lift this suspension',
          suspend: 'Suspend this achiever',
          ban:     'Ban permanently',
          unban:   'Lift this ban',
        }[modal]}>
          <div className="space-y-4">
            {modal === 'suspend' && (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">
                  Suspend until
                </label>
                {/* `min` is the same instant the submit guard compares against,
                    so the picker and the button can never disagree about what
                    counts as the past. */}
                <DateTimePicker value={until} onChange={setUntil} disabled={indefinite}
                                min={toLocalInputValue(openedAt)} placeholder="Suspend until…" />
                {/* The same value read as a duration. An admin thinks in "a month",
                    the scheduler needs a timestamp; showing both from one field means
                    they can never contradict each other. */}
                {suspensionLength && (
                  <p className="text-xs mt-1.5 font-medium"
                     style={{ color: suspensionLength.startsWith('That is in the past')
                       ? '#dc2626' : 'var(--accent)' }}>
                    {suspensionLength}
                  </p>
                )}
                <label className="flex items-center gap-2.5 mt-3 text-sm text-slate-700 cursor-pointer min-h-11">
                  <input type="checkbox" className="w-4 h-4"
                         checked={indefinite}
                         onChange={e => { setIndefinite(e.target.checked); if (e.target.checked) setUntil(''); }} />
                  Indefinite — no automatic reinstatement
                </label>
              </div>
            )}

            {modal === 'unban' && (
              <div className="rounded-xl bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900">
                {/* The state is named, not described. "They go back to where
                    they were" makes an admin perform the action to find out
                    what it does; the server already knows, so it says. */}
                <p className="font-semibold">
                  {dossier?.achiever?.pre_ban_state
                    ? `They go back to ${STATE_LABELS[dossier.achiever.pre_ban_state]
                        || dossier.achiever.pre_ban_state}, where the ban found them.`
                    : 'They go back into the review queue as pending.'}
                </p>
                <p className="mt-1">
                  Lifting a ban is a reversal, so it returns them to the place
                  they held before it — their documents and seat cap come back
                  with them, untouched.
                  {!dossier?.achiever?.pre_ban_state &&
                    ' Nothing was recorded about where this account stood before the ban, so it goes to review.'}
                </p>
              </div>
            )}

            {modal === 'ban' && (
              <div className="rounded-xl bg-red-50 border border-red-200 p-3 text-sm text-red-800">
                <p className="font-semibold">This cannot be undone here.</p>
                <p className="mt-1">
                  Existing bookings are cancelled and those students refunded.
                  Money the achiever has already earned stays claimable — it is
                  owed for work already delivered.
                </p>
              </div>
            )}

            <div>
              <label className="block text-sm font-semibold text-slate-700 mb-1">
                Reason <span className="text-red-500">*</span>
              </label>
              <Textarea
                rows={3} value={reason}
                onChange={e => setReason(e.target.value)}
                placeholder="The achiever sees this. Say what happened and what they can do."
              />
              <p className="text-xs text-slate-400 mt-1">
                Recorded against the account permanently.
              </p>
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
              <Button variant="ghost" className="w-full sm:w-auto min-h-11 sm:min-h-0"
                      onClick={() => setModal(null)}>Cancel</Button>
              <Button
                variant={modal === 'ban' ? 'danger' : 'primary'}
                className="w-full sm:w-auto min-h-11 sm:min-h-0"
                disabled={busy || !reason.trim()
                  // A suspension needs an end date or an explicit indefinite. Without
                  // this the dialog would post an empty `until` and the server would
                  // answer 400 after the admin had already written a reason.
                  || (modal === 'suspend' && !indefinite
                      && (!until || new Date(until).getTime() <= openedAt))}
                onClick={() => act(modal)}
              >
                {busy ? 'Working…' : {
                  reinstate: 'Reinstate',
                  suspend: 'Suspend', ban: 'Ban', unban: 'Lift the ban',
                }[modal]}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}