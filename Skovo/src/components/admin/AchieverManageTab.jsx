import React, { useState } from 'react';
import DateTimePicker from '../../components/ui/DateTimePicker';
import { adminApi as api } from '../../services/api';
import { SeatAllocationField, MIN_SEATS, MAX_SEATS } from './AchieverControls';

/**
 * The achiever's controls, on the achiever's own screen.
 *
 * These lived only on Achiever Review, which meant every routine change —
 * "cap their cohorts at 5", "suspend them for a week" — started by leaving the Achievers directory and
 * finding the person again in a different queue. The endpoints are the same
 * ones Achiever Review calls; nothing new is possible here, it is just possible
 * in the place you were already standing.
 *
 * Every action that changes the achiever's standing takes a reason. An achiever
 * asking "why" six months later deserves an answer, and an unexplained
 * suspension is one the admin cannot defend either — the server refuses without
 * one regardless. The seat cap is the exception: sp_achiever_set_cohort_seats
 * takes no reason column, so asking for one would collect a sentence and throw
 * it away.
 */

const BASE = '/skovo-platform-panel-admin/achiever-lifecycle';

// What each state may have done to it. Mirrors the guards on Achiever Review
// rather than re-deciding them: a pending applicant has no cohorts to cap, and a banned account has nothing to configure until the ban
// is lifted.
//
// Two notes here were stale and have been corrected. One said `seats` was false
// everywhere because POST .../cohort-seats had been removed -- the route is
// live and this tab is the only place that calls it, which the table below has
// always reflected. The other said banned was terminal, which stopped being
// true when unban was added.
const CAN = {
  pending:   { seats: false, suspend: true,  ban: true,  lift: false },
  active:    { seats: true,  suspend: true,  ban: true,  lift: false },
  suspended: { seats: true,  suspend: false, ban: true,  lift: true },
  // `unban` is the way out. Every other control stays off: seats on a
  // banned account are decisions about someone who is not on
  // the platform, and they are all still there the moment the ban lifts.
  banned:    { seats: false, suspend: false, ban: false, lift: false,
               unban: true },
};

function Section({ title, hint, children }) {
  return (
    <div className="rounded-xl border border-slate-200 p-3 space-y-2.5">
      <div>
        <p className="text-xs font-semibold text-slate-600">{title}</p>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

export default function AchieverManageTab({ achiever, record, onDone, onToast }) {
  const state = record?.state || 'pending';
  const can = CAN[state] || CAN.pending;

  // undefined is not null. A server that has not sent the field yet is not
  // the same as one saying "no cap", and defaulting the radio to Unlimited in
  // that case would have been actively destructive: the control would show
  // Unlimited for an achiever capped at 2, and pressing Update would then make
  // it true. When the value is unknown the section refuses to guess.
  const seatsKnown = record !== undefined && 'cohort_seat_allocation' in (record || {});
  const [seatDraft, setSeatDraft] = useState(
    record?.cohort_seat_allocation == null ? '' : String(record.cohort_seat_allocation));
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [indefinite, setIndefinite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(null);

  const id = achiever?.id;
  const needsReason = () => {
    if (!reason.trim()) { onToast?.('A reason is required.'); return true; }
    return false;
  };

  const run = async (fn, successFallback) => {
    setBusy(true);
    try {
      const { data } = await fn();
      if (data?.bool) {
        onToast?.(data.response?.message || successFallback);
        setReason(''); setConfirming(null);
        onDone?.();
      } else {
        onToast?.(data?.response?.message || 'That did not go through.');
      }
    } catch {
      onToast?.('Connection problem — nothing was changed.');
    } finally {
      setBusy(false);
    }
  };

  const saveSeats = () => {
    const trimmed = String(seatDraft).trim();
    const value = trimmed === '' ? null : Number(trimmed);
    if (value !== null && (!Number.isInteger(value) || value < MIN_SEATS || value > MAX_SEATS)) {
      onToast?.(`Seats must be between ${MIN_SEATS} and ${MAX_SEATS}.`); return;
    }
    void run(() => api.post(`${BASE}/${id}/cohort-seats`, { cohort_seats: value }), 'Seats updated.');
  };


  const doSuspend = () => {
    if (needsReason()) return;
    if (!indefinite && !until) { onToast?.('Pick a date, or choose indefinite.'); return; }
    // `min` stops the picker offering a past date; this stops one typed in or
    // pasted. A suspension that ended before it began is lifted by the next
    // sweep of the scheduler, so it reads as an action that silently did
    // nothing.
    if (!indefinite && new Date(until).getTime() <= Date.now()) {
      onToast?.('That time has already passed — pick a later one.'); return;
    }
    void run(() => api.post(`${BASE}/${id}/suspend`, indefinite
      ? { period: 'indefinite', reason: reason.trim() }
      : { until: new Date(until).toISOString(), reason: reason.trim() }), 'Suspended.');
  };

  const doBan = () => {
    if (needsReason()) return;
    void run(() => api.post(`${BASE}/${id}/ban`, { reason: reason.trim() }), 'Banned.');
  };

  const doUnban = () => {
    if (needsReason()) return;
    void run(() => api.post(`${BASE}/${id}/unban`, { reason: reason.trim() }), 'Ban lifted.');
  };

  const doLift = () => {
    if (needsReason()) return;
    void run(() => api.post(`${BASE}/${id}/reinstate`, { reason: reason.trim() }), 'Suspension lifted.');
  };


  // <input type="datetime-local"> wants YYYY-MM-DDTHH:mm in LOCAL time. This
  // field had no `min` at all, so the picker offered last week as happily as
  // next week, and doSuspend below took whatever came back. (The same control
  // on Achiever Review had a floor built with toISOString(), which is UTC and
  // therefore off by the whole offset -- 5:30 in India. Both are wrong; this is
  // what right looks like.)
  const nowLocal = () => {
    const d = new Date(), pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
           `T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  const btn = 'min-h-11 px-3 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50';

  // No early return for 'banned' any more. It used to replace the entire panel
  // with "Banning is terminal and cannot be undone here" -- which was wrong on
  // both counts once unban existed: it can be undone, and the Achiever Review
  // screen was already doing it. An admin who looked here was told there was no
  // way back while another screen offered the button.
  //
  // The capability map handles it instead: everything off except `unban`.

  return (
    <div className="space-y-3">
      {can.seats && (
        <Section title="Seats per cohort"
                 hint={!seatsKnown
                   ? 'The current cap could not be read, so it cannot be changed from here yet.'
                   : record.cohort_seat_allocation == null
                     ? 'Currently unlimited. Applies to new cohorts only.'
                     : `Currently ${record.cohort_seat_allocation} per cohort. Applies to new cohorts only.`}>
          {seatsKnown ? (
            <>
              <SeatAllocationField idPrefix="manage-seat" value={seatDraft}
                                   onChange={setSeatDraft} disabled={busy} />
              <button type="button" onClick={saveSeats} disabled={busy}
                      className={`${btn} bg-blue-50 text-blue-600 hover:bg-blue-100`}>
                Update seats
              </button>
            </>
          ) : (
            <p className="text-xs text-amber-600">
              Showing Unlimited here would be a guess, and saving that guess would
              remove a cap this achiever may well have.
            </p>
          )}
        </Section>
      )}

      {/* Lifting a suspension early. Restored after I removed it by accident:
          a deletion spanned this section too. Without it a suspended achiever
          could only wait for the date to pass. */}
      {can.lift && (
        <Section title="Suspension" hint={record?.state_reason || 'Currently suspended.'}>
          <button type="button" onClick={doLift} disabled={busy}
                  className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
            Lift suspension
          </button>
        </Section>
      )}

      {can.unban && (
        <Section title="Ban"
                 hint={record?.state_reason || 'This account is closed.'}>
          <p className="text-xs text-slate-500 leading-relaxed">
            Lifting it returns them to where the ban found them — their documents
            and seat cap are untouched.
          </p>
          <button type="button" onClick={doUnban} disabled={busy}
                  className={`${btn} bg-emerald-50 text-emerald-700 hover:bg-emerald-100`}>
            Lift the ban
          </button>
        </Section>
      )}

      {can.suspend && (
        <Section title="Suspend" hint="Stops them taking bookings. Lifts itself on the date you set.">
          <DateTimePicker value={until} onChange={setUntil} disabled={indefinite || busy}
                          min={nowLocal()} placeholder="Suspend until…" />
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer">
            <input type="checkbox" checked={indefinite} disabled={busy}
                   onChange={e => { setIndefinite(e.target.checked); if (e.target.checked) setUntil(''); }}
                   className="w-4 h-4" />
            Indefinite — until an admin lifts it
          </label>
          <button type="button" onClick={doSuspend} disabled={busy}
                  className={`${btn} bg-amber-50 text-amber-700 hover:bg-amber-100`}>
            Suspend
          </button>
        </Section>
      )}

      {can.ban && (
        <Section title="Ban permanently"
                 hint="They stop immediately. A ban can be lifted later, and they
                       return to where they were.">
          {confirming === 'ban' ? (
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={doBan} disabled={busy}
                      className={`${btn} bg-red-600 text-white hover:bg-red-700`}>
                {busy ? 'Working…' : 'Yes, ban permanently'}
              </button>
              <button type="button" onClick={() => setConfirming(null)} disabled={busy}
                      className={`${btn} bg-slate-100 text-slate-600 hover:bg-slate-200`}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" onClick={() => setConfirming('ban')} disabled={busy}
                    className={`${btn} bg-red-50 text-red-600 hover:bg-red-100`}>
              Ban permanently
            </button>
          )}
        </Section>
      )}


      {/* Last, not first. You decide what to change and then say why - asking
          for the reason before showing any of the controls put the sentence
          before the decision it explains. One box for all of it: every action
          sends it and the server refuses without it, so a field per action
          would only mean typing the same sentence four times. */}
      <div className="pt-1 border-t border-slate-100">
        <label htmlFor="manage-reason" className="block text-xs font-semibold text-slate-600 mb-1 mt-2">
          Reason <span className="text-red-500">*</span>
        </label>
        <input
          id="manage-reason" value={reason} onChange={e => setReason(e.target.value)}
          placeholder="Why are you doing this?"
          className="w-full min-w-0 min-h-11 border border-slate-200 rounded-xl px-3 py-2.5 text-sm
                     focus:outline-none focus:ring-2 focus:ring-blue-300" />
        <p className="text-[11px] text-slate-400 mt-1">
          Required for suspending, banning and lifting either — recorded against
          the achiever and shown to them. Seat changes
          do not take one: the procedure behind them records no reason, and a
          field whose value is thrown away is worse than no field.
        </p>
      </div>
    </div>
  );
}
