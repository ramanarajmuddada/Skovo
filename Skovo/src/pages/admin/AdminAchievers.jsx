import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';
import { Link } from 'react-router-dom';
import { adminApi as api } from '../../services/api';
import { FormSelect, Textarea, Input } from '../../components/ui/index.jsx';
import { DemoTargetField } from '../../components/admin/AchieverControls';
import { Star, Pencil, X, ChevronDown, Check, Type, Building2, Briefcase, AlignLeft, Link2, Tag, AlertCircle, Layers, Mail, Lock, Phone, UserCheck, Eye, IndianRupee, User, FileText, Video, Landmark, Settings2, History, BookOpen } from 'lucide-react';
import {
  Th, Td, Avatar, ActionBtn,
  TableShell, LoadingRows, EmptyState, Pagination,
  ResponsiveTable, RowCard, StatusBadge,
} from '../../components/ui/TableComponents';

// Mirrors STATE_TONE in AdminAchieverLifecycle — the same state should not be
// two different colours on two admin screens.
import StatTile from '../../components/admin/StatTile';
import { Search as SearchIcon, Users as UsersIcon, Hourglass, ShieldCheck as ShieldIcon, BadgeCheck } from 'lucide-react';

const STATE_TONE = {
  active: 'green', probation: 'blue', suspended: 'amber',
  banned: 'red', rejected: 'red', pending: 'amber',
};
import AvatarImg from '../../components/ui/AvatarImg';
import AchieverCohortsPanel from '../../components/admin/AchieverCohortsPanel';
import AchieverManageTab from '../../components/admin/AchieverManageTab';

/**
 * What SKOVO keeps from this achiever's sales.
 *
 * The rate is data, not a constant: commission_rules holds a platform default
 * and, optionally, a rule naming one achiever that beats it. So a negotiated
 * rate is a row, not a deploy.
 *
 * It shows where the number came from as well as what it is — "30%" alone does
 * not tell you whether changing the platform default would move this person.
 */
function CommissionPanel({ achieverId, onToast }) {
  const [data, setData]   = useState(null);
  const [edit, setEdit]   = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy]   = useState(false);

  const load = useCallback(async () => {
    try {
      const { data: res } = await api.get(
        `/skovo-platform-panel-admin/achievers/${achieverId}/commission`);
      if (res?.bool) setData(res.response);
    } catch { /* the panel simply stays empty */ }
  }, [achieverId]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const save = async () => {
    const pct = Number(value);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      onToast('Enter a percentage between 0 and 100.'); return;
    }
    setBusy(true);
    try {
      const { data: res } = await api.put(
        `/skovo-platform-panel-admin/achievers/${achieverId}/commission`, { percent: pct });
      if (res?.bool) { onToast(res.response.message); setEdit(false); await load(); }
      else onToast(res?.response?.message || 'Could not save that.');
    } catch { onToast('Could not save that.'); }
    finally { setBusy(false); }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const { data: res } = await api.delete(
        `/skovo-platform-panel-admin/achievers/${achieverId}/commission`);
      if (res?.bool) { onToast(res.response.message); setEdit(false); await load(); }
    } catch { onToast('Could not reset that.'); }
    finally { setBusy(false); }
  };

  if (!data) return null;

  const pct = (data.effective_rate * 100).toFixed(pctDecimals(data.effective_rate));
  const own = data.source === 'achiever';

  return (
    <div className="rounded-xl border border-slate-200 p-3 mt-3">
      <div className="flex items-center gap-3">
        <IndianRupee size={15} className="text-slate-400 shrink-0" />
        {/* The absence leads when there is no rule for this achiever.
            A bold "10%" under the heading "Platform commission", with
            "platform default" in small grey beneath it, reads as a rate
            somebody set for this person — the first question it drew was
            "I never gave any commission, why is it showing?". Nothing about
            the number was wrong; the sentence around it was. */}
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-600">Commission</p>
          {own ? (
            <>
              <p className="text-sm text-slate-800">
                <span className="font-bold tabular-nums">{pct}%</span>{' '}
                <span className="text-xs text-slate-400">set for this achiever</span>
              </p>
              {/* Says the other half too. "10%" alone is read as the achiever's
                  share about as often as the platform's. */}
              <p className="text-xs text-slate-400 mt-0.5">
                SKOVO keeps {pct}% &middot; the achiever keeps {100 - Number(pct || 0)}%
              </p>
            </>
          ) : (
            <>
              {/* The platform default is not quoted here any more.
                  
                  It used to read "The platform default applies — 10% to SKOVO,
                  90% to the achiever", which put a specific number against a
                  person nobody had agreed a number with. Commission on this
                  platform is settled per achiever, at approval out of probation,
                  so a default shown against an unapproved achiever is a figure
                  that will not be the one they end up on. */}
              <p className="text-sm font-semibold text-slate-800">No rate set yet</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Their share is agreed when they are approved out of probation.
                You can set it here at any time.
              </p>
            </>
          )}
        </div>
        {/* The edit box opens empty when they have no rate of their own.
            Prefilling the global default would put a number in it that nobody
            chose, one Save away from becoming a rule saying they did. */}
        {!edit && (
          <button type="button" onClick={() => { setValue(own ? pct : ''); setEdit(true); }}
            className="relative text-xs font-semibold text-blue-600 hover:text-blue-700 shrink-0
                       before:absolute before:content-[''] before:-inset-3.5 before:rounded-lg">
            {own ? 'Change' : 'Set a rate'}
          </button>
        )}
      </div>

      {edit && (
        <div className="mt-3 space-y-2">
          <div className="flex items-center gap-2">
            <input
              type="number" min="0" max="100" step="0.5" value={value}
              onChange={e => setValue(e.target.value)} aria-label="Commission percent"
              className="w-24 border border-slate-200 rounded-lg px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-2 focus:ring-blue-300"
            />
            <span className="text-sm text-slate-500">
              % to SKOVO from every paid session and cohort
              {value !== '' && Number(value) >= 0 && Number(value) <= 100
                ? ` — achiever keeps ${100 - Number(value)}%`
                : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={save} disabled={busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50">
              {busy ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => setEdit(false)}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200">
              Cancel
            </button>
            {own && (
              <button type="button" onClick={reset} disabled={busy}
                className="px-3 py-1.5 rounded-lg py-3 text-xs font-semibold text-slate-500 hover:text-red-600 ml-auto">
                Use platform default ({(data.global_rate * 100).toFixed(pctDecimals(data.global_rate))}%)
              </button>
            )}
          </div>
          <p className="text-xs text-slate-400">
            Applies to orders placed from now on. Existing orders keep the rate they were priced at.
          </p>
        </div>
      )}
    </div>
  );
}

// 30% not 30.00%, but 12.5% keeps its half.
const pctDecimals = (ratio) => (Number((ratio * 100).toFixed(2)) % 1 === 0 ? 0 : 1);

/**
 * Everything known about one achiever, in one request set.
 *
 * The record was split in two and half of it went dark on approval: Achiever
 * Review owned documents, demos and student reviews and only rendered them
 * while the achiever was in probation, while this screen showed seven contact
 * fields and nothing about the review that produced the approval.
 *
 * Read-only, deliberately. Every action — approve, suspend, ban, request a
 * document, set the demo target — stays on Achiever Review, which is the screen
 * that owns the decisions. This one reads the record.
 */
function useAchieverRecord(achieverId) {
  const [dossier, setDossier] = useState(null);
  const [demos, setDemos]     = useState(null);
  const [reviews, setReviews] = useState(null);
  const [status, setStatus]   = useState('loading');
  const [nonce, setNonce]     = useState(0);

  useEffect(() => {
    let alive = true;
    // The modal is mounted at all times with achiever={null} so it can animate,
    // which meant every visit to this screen fetched
    // .../achiever-lifecycle/undefined/dossier before anyone had clicked a row.
    // It came back 200 -- the id is a path segment, not a lookup the server
    // validates -- so nothing ever failed loudly; it was two wasted round trips
    // per load and a `status` of 'ready' for a record that does not exist.
    if (!achieverId) return;
    (async () => {
      try {
        const base = `/skovo-platform-panel-admin/achiever-lifecycle/${achieverId}`;
        const { data: d } = await api.get(`${base}/dossier`);
        if (!alive) return;
        if (!d?.bool) { setStatus('error'); return; }
        setDossier(d.response);
        setStatus('ready');

        // Only where there is something to fetch: a rejected or banned
        // achiever never ran a demo.
        const st = d.response?.achiever?.state;
        if (['probation', 'active', 'suspended'].includes(st)) {
          api.get(`${base}/probation`)
            .then(({ data: p }) => { if (alive && p?.bool) setDemos(p.response); })
            .catch(() => {});
        }
        // Not under the admin prefix: student reviews live at /achiever-reviews/<id>,
        // the same route the student portal posts them to. adminRequest only swaps
        // the token, so an admin JWT reaches it fine.
        api.get(`/achiever-reviews/${achieverId}`)
          .then(({ data: r }) => { if (alive && r?.bool) setReviews(r.response); })
          .catch(() => {});
      } catch {
        if (alive) setStatus('error');
      }
    })();
    return () => { alive = false; };
    // `nonce` re-runs this after an action on the Manage tab, so the other
    // tabs re-read rather than showing the state the achiever was in before
    // you changed it.
  }, [achieverId, nonce]);

  // With no achiever the values are derived, not stored: setting state from
  // the effect to clear them is a cascading render the linter rejects, and the
  // last achiever's dossier would otherwise still be sitting here, ready to
  // flash for one frame the next time a row is clicked.
  return {
    dossier: achieverId ? dossier : null,
    demos:   achieverId ? demos   : null,
    reviews: achieverId ? reviews : null,
    status:  achieverId ? status  : 'loading',
    reload:  () => setNonce(n => n + 1),
  };
}

/**
 * Asking this achiever for a document that is not on the standard list.
 *
 * The same control Achiever Review has, on the screen where you are already
 * looking at what they sent. Before this, noticing a missing employment proof
 * here meant leaving, finding the person again in the review queue, and asking
 * from there -- for a request that posts to the identical endpoint.
 *
 * Outstanding requests are listed above the form because asking twice for the
 * same thing is the obvious mistake, and the server refuses it with
 * 'already_requested' rather than silently duplicating.
 */
function AskForDocument({ achieverId, dossier, onToast, onDone }) {
  const [type, setType] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const types = dossier?.doc_types || [];
  const open = (dossier?.document_requests || []).filter(r => !r.fulfilled);

  const send = async () => {
    if (!type) { onToast?.('Pick which document you need.', false); return; }
    if (!note.trim()) { onToast?.('Say what you need and why.', false); return; }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/achiever-lifecycle/${achieverId}/document-requests`,
        { doc_type: type, note: note.trim() });
      if (data?.bool) {
        onToast?.(data.response?.message || 'Requested.');
        setType(''); setNote('');
        onDone?.();
      } else {
        onToast?.(data?.response?.message || 'Could not send that request.', false);
      }
    } catch {
      onToast?.('Connection problem — nothing was sent.', false);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5 mt-1">
      <div>
        <p className="text-xs font-semibold text-slate-600">Ask for a document</p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          For anything not on the standard list. They are emailed and it appears
          on their verification screen.
        </p>
      </div>

      {open.length > 0 && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 p-2">
          <p className="text-[11px] font-semibold text-amber-900">Already waiting on</p>
          <ul className="mt-0.5 space-y-0.5">
            {open.map(r => (
              <li key={r.id} className="text-[11px] text-amber-800 break-words">
                {r.label || r.doc_type}{r.note ? ` — ${r.note}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* FormSelect, not a bare <select>. A native select renders the OS
          dropdown -- a white panel in system styling that ignores the app's
          theme entirely, which on a dark screen looks like a different program
          opening on top of this one.
          
          No searchAfter. It was set to 8, and there are exactly 8 document
          types, so the search box never appeared -- while the same dropdown on
          Achiever Review, which passes nothing, had one. Searchable by default
          is the founder call in CONVENTIONS.md; a threshold here made this the
          one dropdown in the console that behaved differently.
          
          The options are master data (master_achiever_doc_type via
          master_registry), so a new type added in Admin > Masters shows up here
          and on Achiever Review with no code change. */}
      <FormSelect
        id="ask-doc-type"
        label="Which document"
        value={type}
        onChange={setType}
        options={types.map(t => ({ value: t.value, label: t.label || t.value }))}
        placeholder="Choose one…"
        disabled={busy}
      />

      <Textarea
        id="ask-doc-note"
        label="What you need, and why"
        rows={3}
        value={note}
        disabled={busy}
        onChange={e => setNote(e.target.value)}
        placeholder="They read this, so name the claim you are checking."
      />

      <button type="button" onClick={send} disabled={busy}
              className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-blue-50 text-blue-600
                         hover:bg-blue-100 transition-colors disabled:opacity-50">
        {busy ? 'Sending…' : 'Ask for it'}
      </button>
    </div>
  );
}

// The directory's own columns. Each answers a question an admin scanning the
// list actually asks, which "Designation / Company / Domain" did not: those say
// what the achiever typed about themselves, not how they are doing.
const fmtDemoProgress = (done, need) => (need ? `${done ?? 0} / ${need}` : '—');
// Only a rate somebody agreed for this achiever. No platform default: a column
// reading "10% (default)" on every row says a decision was made about each of
// them when none was, and it makes the achievers who DO have a negotiated rate
// impossible to spot -- which is the only reason to put the column on a list.
const fmtCommission = (pct) =>
  (pct === null || pct === undefined ? 'Not set' : `${pct}%`);
const fmtJoined = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—'
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

// Absent and deliberate are different answers and must not render the same.
// `seats == null ? 'Unlimited' : seats` treated a field the server had not sent
// as an explicit null, so a missing seat cap displayed as Unlimited — the most
// permissive value there is — for an achiever who actually has 2.
const orDash = (v) => (v === undefined || v === null || v === '' ? '—' : v);
const fmtSeats = (v) => (v === undefined ? '—' : v === null ? 'Unlimited' : String(v));
const fmtDemos = (done, need) =>
  (need === undefined || need === null ? '—' : `${done ?? 0} / ${need}`);
// A date and time an admin can read, for the audit lines. Dates alone are not
// enough on the state trail: a suspension and the lift that followed it an hour
// later both say "21 Sept 2026" and look like one event.
const fmtWhen = (iso) => {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null
    : d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric',
                                  hour: 'numeric', minute: '2-digit' });
};

// Kept for when the background-check controls come back in a later version;
// the field it formats is hidden for now, not removed.
// eslint-disable-next-line no-unused-vars
const fmtBgv = (v) => (!v || v === 'none' ? 'Not started' : v);

function Field({ label, value, wide = false }) {
  return (
    <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <div className="text-sm font-semibold text-slate-800 break-words">{value}</div>
    </div>
  );
}

/**
 * What this achiever accepted, and which version of it.
 *
 * The acceptance ledger records the policy version, the timestamp and the IP for
 * every agreement -- built for the moment somebody disputes what they signed up
 * to -- and no admin screen read a word of it. The achiever could see their own
 * acceptances on their verification screen; the person who would have to answer
 * "did they accept the commission terms, and which version" could not.
 *
 * `stale` is the one that earns the amber: they accepted v1, the policy is now
 * v2, and nobody has asked them to accept the new one.
 */
function AgreementsPanel({ agreements }) {
  const list = agreements || [];
  if (!list.length) return null;
  return (
    <div className="rounded-xl border border-slate-200 p-3 mt-3">
      <p className="text-xs font-semibold text-slate-600 mb-2">Agreements</p>
      <div className="space-y-2">
        {list.map(g => (
          <div key={g.value} className="flex items-start gap-2">
            <span className={`mt-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full shrink-0 ${
              g.accepted ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
              {g.accepted ? 'Accepted' : 'Not yet'}
            </span>
            <div className="min-w-0">
              <p className="text-xs text-slate-700 break-words">{g.label || g.value}</p>
              {g.accepted && (
                <p className="text-[11px] text-slate-400">
                  {fmtWhen(g.accepted_at) || 'date not recorded'}
                  {g.accepted_version ? ` · policy ${g.accepted_version}` : ''}
                </p>
              )}
              {g.stale && (
                <p className="text-[11px] text-amber-600">
                  Policy moved to {g.current_version} since they accepted.
                </p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * One document: its filename, the dates, the reviewer's note, and the link.
 *
 * Shared between the current document and the ones it replaced so a superseded
 * file is presented the same way -- it is evidence, not a footnote.
 */
function DocLine({ d }) {
  return (
    <>
      {d.original_name && (
        <p className="text-xs text-slate-400 break-words mt-0.5">{d.original_name}</p>
      )}
      {/* Uploaded and reviewed are different questions. With two documents of
          one type the upload dates alone cannot say which decision came first. */}
      <p className="text-[11px] text-slate-400 mt-0.5">
        {d.uploaded_at ? `Sent ${fmtWhen(d.uploaded_at)}` : 'Sent — date not recorded'}
        {d.reviewed_at ? ` · ${d.status === 'rejected' ? 'sent back' : 'accepted'} ${fmtWhen(d.reviewed_at)}` : ''}
      </p>
      {d.review_note && (
        <p className="text-xs text-slate-500 break-words mt-1">{d.review_note}</p>
      )}
      {d.file_url && (
        <a href={d.file_url} target="_blank" rel="noreferrer"
           className="inline-flex items-center gap-1.5 mt-2 text-xs font-semibold text-blue-600 hover:text-blue-700">
          <Eye size={13} /> Open document
        </a>
      )}
    </>
  );
}

/**
 * The demo target, on the Demos tab.
 *
 * It lived on Manage, beside seats and suspensions, which meant reading the
 * demo numbers and changing them were two different tabs. Everything about
 * demos now sits together.
 *
 * The same control does two jobs, and the wording says which:
 *
 *   probation  — "Set target". They are already working through demos; this
 *                raises or lowers how many.
 *   active     — "Send back to demos". They finished probation and are earning,
 *                and something in their reviews says they should prove it
 *                again. This drops them back to probation, which removes
 *                `can_charge`, so no NEW paid work can be booked while the
 *                cohorts and sessions students already paid for run out.
 *
 * A reason is required either way and the achiever is told: being put back on
 * unpaid demos without being told why is the version of this that generates a
 * support ticket.
 */
function DemoTargetPanel({ achieverId, record, onToast, onDone }) {
  const state = record?.state;
  const done = record?.demos_done ?? 0;
  const current = record?.demos_required ?? null;
  // Opens on the target they actually have, not an empty box.
  //
  // It started blank with an "e.g. 5" placeholder, which made the field ask a
  // question the screen already knew the answer to -- and the +/- buttons had
  // nothing to count from, so the first press jumped to a number nobody chose.
  // Seeded from the record, so + on a target of 2 gives 3.
  const [target, setTarget] = useState(
    record?.demos_required == null ? '' : String(record.demos_required));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  // Nothing to set for someone who has not been approved yet, and a banned
  // account has no demos to run.
  if (!['probation', 'active', 'suspended'].includes(state)) return null;

  const sendBack = state !== 'probation';

  const save = async () => {
    const n = Number(target);
    if (!Number.isInteger(n) || n < 1) {
      onToast?.('Say how many demos they need — a whole number, at least 1.', false); return;
    }
    if (!reason.trim()) { onToast?.('A reason is required.', false); return; }
    setBusy(true);
    try {
      const { data } = await api.post(
        `/skovo-platform-panel-admin/achiever-lifecycle/${achieverId}/probation`,
        { decision: 'set_demos', demos_required: n, reason: reason.trim() });
      if (data?.bool) {
        onToast?.(data.response?.message || 'Demo target set.');
        // Not cleared: what was just saved IS the current target, and blanking
        // the field would put the placeholder back over a number that is now
        // true.
        setTarget(String(n)); setReason('');
        onDone?.();
      } else {
        onToast?.(data?.response?.message || 'That did not go through.', false);
      }
    } catch {
      onToast?.('Connection problem — nothing was changed.', false);
    } finally { setBusy(false); }
  };

  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5 mt-3">
      <div>
        <p className="text-xs font-semibold text-slate-600">
          {sendBack ? 'Send back to demos' : 'Demo target'}
        </p>
        <p className="text-[11px] text-slate-400 mt-0.5">
          {sendBack
            ? 'They stop taking new paid work until the demos are done. Cohorts and bookings students have already paid for are untouched.'
            : `They have ${done} of ${current ?? '—'} done. This replaces the target, so it can go down as well as up.`}
        </p>
      </div>

      <DemoTargetField value={target} onChange={setTarget}
                       done={done} id="demos-tab-target" disabled={busy} />

      <Input
        id="demos-tab-reason"
        label="Reason"
        required
        value={reason}
        disabled={busy}
        onChange={e => setReason(e.target.value)}
        placeholder="The achiever sees this."
      />

      <button type="button" onClick={save} disabled={busy}
              className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-blue-50 text-blue-600
                         hover:bg-blue-100 transition-colors disabled:opacity-50">
        {busy ? 'Saving…' : (sendBack ? 'Send back to demos' : 'Set target')}
      </button>
    </div>
  );
}

function TabEmpty({ message }) {
  return <p className="text-sm text-slate-400 py-6 text-center">{message}</p>;
}


const DOC_TONE = {
  accepted: 'bg-emerald-50 text-emerald-700',
  approved: 'bg-emerald-50 text-emerald-700',
  pending:  'bg-amber-50 text-amber-700',
  rejected: 'bg-red-50 text-red-600',
};

function AchieverDetailModal({ achiever: a, onClose, onToast, onChanged }) {
  const [tab, setTab] = useState('details');
  const { dossier, demos, reviews, status, reload: reloadRecord } = useAchieverRecord(a?.id);

  // Every action in here changes a number the row behind it is showing.
  // `reload` only re-read the dossier, so setting the demo target to 3 updated
  // the panel and left the card underneath reading "DEMOS 0 / 2" -- and closing
  // the panel showed you the stale figure with nothing left to correct it.
  // Anything that reloads the record now reloads the list too.
  const reload = useCallback(() => { reloadRecord(); onChanged?.(); },
                             [reloadRecord, onChanged]);

  const ach  = dossier?.achiever || {};
  const docs = useMemo(() => dossier?.documents || [], [dossier]);
  const history = useMemo(() => dossier?.state_history || [], [dossier]);

  // Documents grouped by type, newest first inside each group.
  //
  // The flat list interleaved them: a rejected proof of achievement sat between
  // two accepted documents while its replacement was two rows above, so working
  // out which file superseded which meant reading filenames. Grouping puts the
  // current one at the top of its type with everything it replaced beneath it,
  // which is the order the story happened in.
  //
  // Nothing is hidden. A rejected document is the evidence of what was wrong and
  // what was sent instead, and it stays on screen with its reason.
  // Accepting and sending back, from the record you are already looking at.
  //
  // These lived only on Achiever Review, which meant this tab could show you a
  // pending document, let you ask for a different one, and then make you leave
  // to accept the one in front of you. Same endpoint Achiever Review patches;
  // nothing new is possible here, it is possible in one more place.
  const [decidingDoc, setDecidingDoc] = useState(null);   // the doc being sent back
  const [rejectNote, setRejectNote]   = useState('');
  const [docBusy, setDocBusy]         = useState(false);

  const decideDoc = async (doc, nextStatus, note) => {
    setDocBusy(true);
    try {
      const { data } = await api.patch(
        `/skovo-platform-panel-admin/achiever-trust/documents/${doc.id}`,
        note ? { status: nextStatus, note } : { status: nextStatus });
      if (data?.bool) {
        onToast?.(nextStatus === 'accepted' ? 'Document accepted.' : 'Document sent back.');
        setDecidingDoc(null); setRejectNote('');
        reload();
      } else {
        onToast?.(data?.response?.message || 'Could not record that.', false);
      }
    } catch {
      onToast?.('Could not record that.', false);
    } finally { setDocBusy(false); }
  };

  const docGroups = useMemo(() => {
    const by = new Map();
    for (const d of docs) {
      const key = d.doc_type || 'other';
      if (!by.has(key)) by.set(key, { key, label: d.label || key, items: [] });
      by.get(key).items.push(d);
    }
    for (const g of by.values()) {
      g.items.sort((x, y) => new Date(y.uploaded_at || 0) - new Date(x.uploaded_at || 0));
      // The type's standing is its current document's, not the history's: a
      // type whose latest upload was accepted is settled, whatever came before.
      g.current = g.items[0];
      g.superseded = g.items.slice(1);
    }
    // Types still waiting on the achiever float up; there is nothing to do
    // about an accepted one.
    return [...by.values()].sort((a, b) => {
      const rank = (g) => (g.current?.status === 'rejected' ? 0
                         : g.current?.status === 'pending' ? 1 : 2);
      return rank(a) - rank(b);
    });
  }, [docs]);
  const revList = useMemo(() => reviews?.reviews || [], [reviews]);

  if (!a) return null;

  const photo = a.avatar_url || a.profile_image_url || ach.profile_image_url;
  const hasBank = ach.payout_account_number || ach.payout_upi;

  const TABS = [
    { key: 'details',   label: 'Details', icon: User },
    { key: 'documents', label: 'Docs', count: docs.length, icon: FileText },
    { key: 'demos',     label: 'Demos', icon: Video },
    { key: 'cohorts',   label: 'Cohorts', icon: BookOpen },
    { key: 'reviews',   label: 'Reviews', count: revList.length, icon: Star },
    { key: 'bank',      label: 'Bank', icon: Landmark },
    { key: 'manage',    label: 'Manage', icon: Settings2 },
    // The count earns its place on the tab: History (3) and History (24) are
    // different accounts, and you can tell which before opening it.
    { key: 'history',   label: 'History', count: history.length, icon: History },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[92vh] flex flex-col overflow-hidden">

        <div className="flex items-center justify-between gap-2 px-4 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="text-base font-bold text-slate-900">Achiever Details</h2>
          <button onClick={onClose} aria-label="Close"
            className="relative shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors before:absolute before:content-[''] before:-inset-2 before:rounded-lg"><X size={18} /></button>
        </div>

        {/* Identity sits above the tabs: it is who you are looking at, not one
            of the things you can look at. */}
        <div className="flex items-center gap-3 px-4 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          {photo
            ? <AvatarImg src={photo} alt="" className="w-12 h-12 rounded-full object-cover shrink-0" />
            : <Avatar name={a.full_name} size="lg" />}
          <div className="min-w-0 flex-1">
            <p className="font-black text-slate-900 break-words leading-tight">{a.full_name}</p>
            {a.achievement_title && (
              <p className="text-xs text-slate-500 break-words">{a.achievement_title}</p>
            )}
          </div>
          {dossier && <StatusBadge status={ach.state} tone={STATE_TONE[ach.state]} />}
        </div>

        {/* Every tab visible: a 3-across icon grid on a phone. */}
        <div className="px-3 sm:px-4 py-2 border-b border-slate-100 shrink-0">
          <Tabs tabs={TABS} active={tab} onChange={setTab} />
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {status === 'loading' && <div className="h-24 rounded-xl bg-slate-100 animate-pulse" />}
          {status === 'error' && <TabEmpty message="Could not load this achiever's record." />}

          {status === 'ready' && tab === 'details' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                {/* "Type" is gone, for the reason it left the list: it read
                    "Mentor" for every achiever, because all it means is that the
                    account has a portal login. A field whose value never differs
                    between records is a field nobody can act on. */}
                <Field label="Cohort seats" value={fmtSeats(ach.cohort_seat_allocation)} />
                <Field label="Demos" value={fmtDemos(ach.demos_done, ach.demos_required)} />
                {/* Background check is not shown for v2. The admin control that
                    started one and recorded its result was removed deliberately,
                    and SKOVO has not signed a BGV vendor, so this field could
                    only ever read "Not started" -- a status with no route to any
                    other value.

                    Nothing underneath has been touched: bgv_status and its dates
                    are still stored, and POST/PATCH .../achiever-trust/<id>/bgv
                    still work. Restoring this is one line here plus the buttons.
                */}
                {/* The date, not the status word.

                    This read "submitted" for an achiever sitting on probation,
                    because approving an application moves `state` and leaves
                    `application_status` where it was -- so the field argued with
                    the badge at the top of the panel. The date says the same
                    thing and contradicts nothing: they applied, here is when. */}
                <Field label="Applied on"
                  value={fmtWhen(ach.application_submitted_at) || 'Not submitted yet'} />
                <Field label="Joined" value={fmtWhen(ach.registered_at) || '—'} />
                {/* Never is not the same as long ago. An achiever approved weeks
                    back who has never opened the portal needs chasing; one who
                    logged in this morning does not. Nothing recorded either
                    until last_login_at was added. */}
                <Field label="Last login"
                  value={fmtWhen(ach.last_login_at) || 'Never signed in'} />
                {/* "Account" is not shown for v2, for the same reason as the
                    background check above it: nothing in the admin portal writes
                    achievers.status, so it read 'active' for every achiever and
                    always would. Worse than useless -- it sat next to the state
                    badge reading "active" for someone who was banned, because
                    they are different columns saying different things.

                    The column is untouched and the login still requires it, so
                    this is a hidden field, not a removed one. */}
                <Field label="Email" value={orDash(a.email || ach.email)} wide />
                <Field label="Phone" value={orDash(a.phone || ach.phone)} />
                <Field label="Domain" value={orDash(a.domain_name)} />
                <Field label="Designation" value={orDash(a.designation)} />
                <Field label="Company" value={orDash(a.company)} />
                <Field label="Skills" wide
                  value={orDash(Array.isArray(a.skills) ? a.skills.join(', ') : a.skills)} />
                <Field label="LinkedIn" wide value={
                  (a.linkedin_url || ach.linkedin_url)
                    ? <a href={a.linkedin_url || ach.linkedin_url} target="_blank" rel="noreferrer"
                         className="text-blue-600 underline">View profile</a>
                    : '—'} />
                {(a.bio || ach.bio) && (
                  <Field label="Bio" wide
                    value={<span className="font-normal text-slate-700">{a.bio || ach.bio}</span>} />
                )}
                {/* State reason has moved to the History tab.
                    
                    It was the latest of several, from a column overwritten on
                    every change, sitting under a badge it often appeared to
                    contradict -- "Lifting the ban" beside Probation. History
                    shows the same sentence in the sequence that explains it,
                    with the two before it and who wrote each one. */}
              </div>
              <AgreementsPanel agreements={dossier?.agreements} />
              <CommissionPanel achieverId={a.id} onToast={onToast} />
            </div>
          )}

          {status === 'ready' && tab === 'history' && (
            history.length === 0
              ? <TabEmpty message="No state changes recorded yet." />
              : (
                <ol className="space-y-3">
                  {history.map(h => (
                    <li key={h.id} className="border border-slate-200 rounded-xl p-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusBadge status={h.from_state || 'new'}
                                     tone={STATE_TONE[h.from_state] || 'slate'} />
                        <span className="text-slate-400 text-xs">→</span>
                        <StatusBadge status={h.to_state}
                                     tone={STATE_TONE[h.to_state] || 'slate'} />
                      </div>
                      {h.reason && (
                        <p className="text-sm text-slate-700 break-words mt-1.5">{h.reason}</p>
                      )}
                      {/* Who and when on one line. actor_name is null for the
                          overnight lift job, which acts as nobody -- and "the
                          system" is a truer answer there than a blank. */}
                      <p className="text-[11px] text-slate-400 mt-1">
                        {h.actor_name || (h.actor_role === 'system' ? 'the system' : h.actor_role || 'unknown')}
                        {h.at ? ` · ${fmtWhen(h.at)}` : ''}
                      </p>
                      {/* Only a dated suspension has one. Saying so distinguishes
                          it from an indefinite suspension, which is the whole
                          difference between the two. */}
                      {h.to_state === 'suspended' && (
                        <p className="text-[11px] text-amber-600 mt-0.5">
                          {h.suspended_until
                            ? `Until ${fmtWhen(h.suspended_until)}`
                            : 'No end date — lifted by hand'}
                        </p>
                      )}
                    </li>
                  ))}
                </ol>
              )
          )}

          {status === 'ready' && tab === 'documents' && (
            docs.length === 0 ? <TabEmpty message="No documents uploaded." /> : (
              <div className="space-y-3">
                {(dossier.missing_required || []).length > 0 && (
                  <p className="text-xs text-amber-600 font-semibold">
                    Still required: {dossier.missing_required.map(m => m.label).join(', ')}
                  </p>
                )}
                {docGroups.map(g => (
                  <div key={g.key} className="border border-slate-200 rounded-xl p-3">
                    <div className="flex items-start justify-between gap-2">
                      {/* The label master data holds, not the column value. This
                          said "achievement_proof" while Achiever Review said
                          "Proof of achievement" for the same document. */}
                      <p className="text-sm font-semibold text-slate-800 break-words min-w-0">
                        {g.label}
                      </p>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${DOC_TONE[g.current.status] || 'bg-slate-100 text-slate-600'}`}>
                        {g.current.status}
                      </span>
                    </div>
                    <DocLine d={g.current} />
                    {/* Only on the document that is still waiting. An accepted
                        or already rejected one has had its decision; offering
                        the buttons again invites an admin to flip a settled
                        record with no record of why. */}
                    {g.current.status === 'pending' && (
                      <div className="flex flex-wrap gap-2 mt-2.5">
                        <button type="button" disabled={docBusy}
                          onClick={() => decideDoc(g.current, 'accepted')}
                          className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-emerald-50
                                     text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                          Accept
                        </button>
                        <button type="button" disabled={docBusy}
                          onClick={() => { setDecidingDoc(g.current); setRejectNote(''); }}
                          className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-red-50
                                     text-red-600 hover:bg-red-100 disabled:opacity-50">
                          Send back
                        </button>
                      </div>
                    )}
                    {/* The note is required, so it is asked for inline rather
                        than in a dialog stacked on a dialog -- this panel is
                        already an overlay, and a second one over it is the
                        z-index problem that hid every toast on this screen. */}
                    {decidingDoc?.id === g.current.id && (
                      <div className="mt-2.5 space-y-2">
                        <Textarea
                          id={`reject-${g.current.id}`}
                          label="What was wrong with it"
                          rows={3}
                          value={rejectNote}
                          disabled={docBusy}
                          onChange={e => setRejectNote(e.target.value)}
                          placeholder="They read this and upload a replacement."
                        />
                        <div className="flex flex-wrap gap-2">
                          <button type="button"
                            disabled={docBusy || !rejectNote.trim()}
                            onClick={() => decideDoc(g.current, 'rejected', rejectNote.trim())}
                            className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-red-600
                                       text-white hover:bg-red-700 disabled:opacity-50">
                            {docBusy ? 'Sending…' : 'Send it back'}
                          </button>
                          <button type="button" disabled={docBusy}
                            onClick={() => { setDecidingDoc(null); setRejectNote(''); }}
                            className="min-h-11 px-3 rounded-xl text-xs font-semibold bg-slate-100
                                       text-slate-600 hover:bg-slate-200">
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                    {g.superseded.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-slate-100">
                        <p className="text-[11px] font-semibold text-slate-400">
                          Replaced {g.superseded.length === 1 ? 'this' : 'these'}
                        </p>
                        {g.superseded.map(old => (
                          <div key={old.id} className="mt-1.5 opacity-75">
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${DOC_TONE[old.status] || 'bg-slate-100 text-slate-600'}`}>
                              {old.status}
                            </span>
                            <DocLine d={old} />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                <AskForDocument achieverId={a.id} dossier={dossier}
                                onToast={onToast} onDone={reload} />
              </div>
            )
          )}

          {status === 'ready' && tab === 'demos' && (
            <div className="space-y-4">
            {!demos ? (
              <>
                <AchieverCohortsPanel achieverId={a.id} filter="demo" />
                <DemoTargetPanel achieverId={a.id} record={ach}
                                 onToast={onToast} onDone={reload} />
              </>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                  {/* "Required: 0 / 2" read as though nothing was required.
                      The target is the requirement; the fraction is progress. */}
                  <Field label="Required" value={ach.demos_required ?? '—'} />
                  <Field label="Done so far" value={fmtDemos(ach.demos_done, ach.demos_required)} />
                  <Field label="Completed" value={demos.summary.completed} />
                  <Field label="No-shows" value={demos.summary.no_shows} />
                  <Field label="Avg rating" value={orDash(demos.summary.average_rating)} />
                </div>
                {/* Per demo cohort: tap one to see who attended and their reviews. */}
                <AchieverCohortsPanel achieverId={a.id} filter="demo" />
                <DemoTargetPanel achieverId={a.id} record={ach}
                                 onToast={onToast} onDone={reload} />
              </div>
            )}
            </div>
          )}

          {status === 'ready' && tab === 'reviews' && (
            revList.length === 0 ? <TabEmpty message="No student reviews yet." /> : (
              <div className="space-y-3">
                <Field label="Average"
                  value={`${reviews.avg_rating} / 5 · ${reviews.count} review${reviews.count === 1 ? '' : 's'}`} />
                {/* Per cohort: tap one to see its students, who was absent, and every review. */}
                <AchieverCohortsPanel achieverId={a.id} filter="reviewed" startTab="reviews" />
              </div>
            )
          )}

          {status === 'ready' && tab === 'cohorts' && (
            <AchieverCohortsPanel achieverId={a.id} />
          )}

          {status === 'ready' && tab === 'manage' && (
            <AchieverManageTab achiever={a} record={ach} onDone={reload} onToast={onToast} />
          )}

          {status === 'ready' && tab === 'bank' && (
            !hasBank
              ? <TabEmpty message="No payout details yet. The achiever enters these on their Earnings screen." />
              : (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                    <Field label="Account name"   value={orDash(ach.payout_account_name)} wide />
                    <Field label="Account number" value={orDash(ach.payout_account_number)} wide />
                    <Field label="IFSC"           value={orDash(ach.payout_ifsc)} />
                    <Field label="UPI"            value={orDash(ach.payout_upi)} />
                  </div>
                  <p className="text-xs text-slate-400">
                    Read-only. The achiever maintains these on their Earnings screen.
                  </p>
                </div>
              )
          )}
        </div>

        {/* No Edit button. There is no separate edit dialog any more - the
            things an admin may change are on the Manage tab, beside the record
            they are changing. */}
        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="w-full min-h-11 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

// Only what this dialog still asks for. It used to require an achievement
// title, designation, company, a 20-character bio and a skill - none of which
// it shows any more, and none of which Mahesh has, because he registered
// himself and filled in none of them. Validating fields with no input behind
// them meant the form reported five errors the admin had no way to clear and
// refused to save anything at all.
/* The "Edit Achiever" dialog stood here.

   It has gone, along with achieverSchema, EMPTY, openEdit and save. Everything
   an admin may change about an achiever now lives on the Manage tab of the
   detail view, beside the record it is changing, rather than in a second dialog
   reached from a pencil icon. Everything the ACHIEVER owns - their name,
   achievement title, designation, company, domain, skills, avatar, LinkedIn and
   bio - is theirs to maintain on their own Profile and Verification screens and
   is read-only to an admin.

   There was never an "add achiever" path to keep: achievers register
   themselves, and the POST endpoint this form once used no longer exists. */

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>
      {msg}
    </div>
  );
}

export default function AdminAchievers() {
  const [achievers,   setAchievers]   = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [toast,       setToast]       = useState(null);
  const [perPage,     setPerPage]     = useState(20);
  const [page,        setPage]        = useState(1);
  const [viewAchiever, setViewAchiever] = useState(null);
  const [query,        setQuery]        = useState('');

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  const load = useCallback(() => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/achievers')
      .then(({ data }) => { if (data.bool) setAchievers(data.response.achievers); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // The domains list went with the Domain select on the edit form - it was
  // still being fetched and thrown away.
  useEffect(() => {
    load();
  }, []);




  // Searchable, because Achiever Review has a search and this screen did not.
  // The one that lists EVERY achiever is the one that needs it more: the review
  // queue empties as decisions are made, this directory only grows.
  //
  // Client-side, matching the pagination below, which is client-side for the
  // same reason -- the endpoint returns the whole list.
  const [stateF, setStateF] = useState('');
  const stateCount = (st) => achievers.filter(a => a.state === st).length;
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return achievers.filter(a => (!stateF || a.state === stateF) && (!q || [a.full_name, a.email, a.company, a.designation, a.domain_name]
      .some(v => (v || '').toLowerCase().includes(q))));
  }, [achievers, query, stateF]);
  const pickState = (st) => { setStateF(stateF === st ? '' : st); setPage(1); };

  const totalAchievers = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalAchievers / perPage));
  const pagedAchievers = filtered.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      <AchieverDetailModal achiever={viewAchiever} onClose={() => setViewAchiever(null)}
                           onToast={showToast} onChanged={load} />
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Achievers</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            {/* No delete here any more. Removing an achiever set is_active = 0,
                which locked them out of their own portal with a "wrong password"
                message while their documents and history stayed in the database
                -- a lockout dressed as a tidy-up, sitting one tap from every row
                in the directory. Suspend and Ban on the Manage tab do the same
                job reversibly and tell the achiever why. The endpoint is still
                there for a real deletion; nothing in the console calls it. */}
            Directory of listed experts. Documents and Approve application live on{' '}
            <Link to="/skovo-platform-panel-admin/achiever-review" className="text-blue-600 font-semibold hover:underline">
              Achiever Review
            </Link>
            .
          </p>
        </div>
      </div>
      {/* Tiles double as the state filter. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <StatTile label="All achievers" sub="all states" value={achievers.length} icon={UsersIcon} tone="blue" onClick={() => pickState('')} active={!stateF} />
        <StatTile label="Pending" sub="to review" value={stateCount('pending')} icon={Hourglass} tone="amber" onClick={() => pickState('pending')} active={stateF === 'pending'} />
        <StatTile label="Probation" sub="in demos" value={stateCount('probation')} icon={ShieldIcon} tone="violet" onClick={() => pickState('probation')} active={stateF === 'probation'} />
        <StatTile label="Active" sub="listed" value={stateCount('active')} icon={BadgeCheck} tone="emerald" onClick={() => pickState('active')} active={stateF === 'active'} />
      </div>

      <div className="mb-4 relative">
        <SearchIcon size={15} className="absolute left-3.5 top-[22px] -translate-y-1/2 text-slate-400 pointer-events-none" />
        <label htmlFor="achiever-search" className="sr-only">
          Search achievers by name, email, company or role
        </label>
        <input
          id="achiever-search" name="achiever_search" type="search"
          value={query}
          // Page reset lives here rather than in an effect on `query`: typing is
          // the event, and deriving the page from it in an effect is a second
          // render for nothing. Page 3 of an unfiltered list is rarely page 3 of
          // a filtered one, and a search that lands on an empty page reads as
          // "no results".
          onChange={e => { setQuery(e.target.value); setPage(1); }}
          placeholder="Name, email or company…"
          className="w-full min-h-11 border border-slate-200 rounded-xl pl-10 pr-3.5 py-2.5 text-sm bg-white
                     focus:outline-none focus:ring-2 focus:ring-blue-300" />
        {query && (
          <p className="text-xs text-slate-500 mt-1.5">
            {totalAchievers} of {achievers.length} shown.
          </p>
        )}
      </div>
      {/* Eight columns will not fit a phone. Below `md` the same rows render as
          stacked cards instead of a table that has to be swiped sideways to
          read one record. */}
      <ResponsiveTable
        breakpoint="lg"
        table={
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              {/* Four columns went, four arrived.

                  Gone: S.No, which the pagination already states; Domain, empty
                  for most achievers and a profile field rather than a standing
                  one; Type, which read "Mentor" for everyone because it only
                  means "has a portal login"; and the delete action, which is not
                  something a directory should offer beside a row.

                  Arrived: State, Demos, Seats and Rate -- the four things that
                  tell you whether a row needs you. */}
              <tr>
                <Th>Achiever</Th>
                <Th>Role</Th>
                <Th>State</Th>
                <Th>Demos</Th>
                <Th>Seats</Th>
                <Th>Rate</Th>
                <Th>Open</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={7} rows={5} />
            ) : pagedAchievers.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={Star}
                                message={query ? 'No achievers match that search'
                                               : 'No achievers yet'} />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pagedAchievers.map((a) => (
                  <tr key={a.id} onClick={() => setViewAchiever(a)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>
                      <div className="flex items-center gap-2.5 min-w-0 max-w-60">
                        {(a.avatar_url || a.profile_image_url)
                          ? <AvatarImg src={a.avatar_url || a.profile_image_url} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" />
                          : <Avatar name={a.full_name} size="md" />
                        }
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-900 truncate">{a.full_name}</p>
                          {a.email && <p className="text-xs text-slate-500 truncate">{a.email}</p>}
                          <p className="text-[11px] text-slate-400 truncate">Joined {fmtJoined(a.created_at)}</p>
                        </div>
                      </div>
                    </Td>
                    <Td className="text-sm text-slate-900 max-w-44">
                      {a.designation || a.company
                        ? <>
                            <span className="block truncate max-w-44">{a.designation || '—'}</span>
                            {a.company && <span className="block text-xs text-slate-500 truncate max-w-44">{a.company}</span>}
                          </>
                        : '—'}
                    </Td>
                    <Td>
                      {a.state
                        ? <StatusBadge status={a.state} tone={STATE_TONE[a.state]} />
                        : <span className="text-xs text-slate-400">—</span>}
                    </Td>
                    {/* Only meaningful while they are working through demos. An
                        active achiever finished them; a pending one has not been
                        given a target yet. Both read '—' rather than 0 / 0. */}
                    <Td className="text-sm text-slate-900 whitespace-nowrap">
                      {fmtDemoProgress(a.demos_done, a.demos_required)}
                    </Td>
                    <Td className="text-sm text-slate-900 whitespace-nowrap">
                      {fmtSeats(a.cohort_seat_allocation)}
                    </Td>
                    <Td className="whitespace-nowrap">
                      {a.commission_percent === null || a.commission_percent === undefined
                        ? <span className="text-sm text-slate-400">Not set</span>
                        : <span className="text-sm text-slate-900">{fmtCommission(a.commission_percent)}</span>}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" onClick={() => setViewAchiever(a)} color="indigo" />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        }
        cards={
          loading ? (
            <div className="bg-white rounded-2xl border border-slate-200 p-4 space-y-3">
              {[0, 1, 2].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
            </div>
          ) : pagedAchievers.length === 0 ? (
            <div className="bg-white rounded-2xl border border-slate-200">
              <EmptyState icon={Star}
                          message={query ? 'No achievers match that search'
                                         : 'No achievers yet'} />
            </div>
          ) : (
            pagedAchievers.map(a => (
              <RowCard
                key={a.id}
                onClick={() => setViewAchiever(a)}
                // Same source and same fallback as the table's Avatar column.
                avatar={(a.avatar_url || a.profile_image_url)
                  ? <AvatarImg src={a.avatar_url || a.profile_image_url} alt=""
                               className="w-8 h-8 rounded-full object-cover" />
                  : <Avatar name={a.full_name} size="sm" />}
                title={a.full_name}
                subtitle={a.email}
                // The state, not the type. "Mentor" was the same word on every
                // card -- it only means the achiever has a portal login -- so it
                // spent the badge slot saying nothing. This says the one thing
                // that differs between rows.
                badge={a.state
                  ? <StatusBadge status={a.state} tone={STATE_TONE[a.state]} />
                  : null}
                action={null}
                fields={[
                  { label: 'Demos',  value: a.demos_required
                      ? fmtDemoProgress(a.demos_done, a.demos_required) : null },
                  { label: 'Seats',  value: fmtSeats(a.cohort_seat_allocation) },
                  { label: 'Rate',   value: fmtCommission(a.commission_percent) },
                  { label: 'Role',   value: a.designation || a.company },
                  { label: 'Joined', value: fmtJoined(a.created_at) },
                ]}
              />
            ))
          )
        }
      />
      <div className="mt-2.5">
        <TableShell>
          <Pagination
            page={page}
            pages={totalPages}
            total={totalAchievers}
            perPage={perPage}
            onPage={(p) => setPage(p)}
            onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
          />
        </TableShell>
      </div>
    </div>
  );
}
