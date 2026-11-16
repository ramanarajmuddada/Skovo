import React from 'react';
import { Calendar, Clock, IndianRupee, Ticket, Check } from 'lucide-react';
import { Avatar } from '../ui/TableComponents';
import AvatarImg from '../ui/AvatarImg';

// Rupees with paise when there are paise (Rs 2.50), never rounded.
const paise = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 });

// One cohort, as a card.
//
// The browse list was a ten-column table, which put the two things a student
// actually decides on — who is teaching and what it costs — in columns 5 and 9,
// and squeezed the title into a truncated cell. A card leads with the mentor,
// gives the title room to wrap, and puts date/duration/seats/price in a block
// that can be read at a glance.
//
// The whole card is a single <button> rather than a clickable <div> with a
// nested button inside it. Both the card and its call-to-action open the same
// slideover, so a second control would be a second tab stop to the same place —
// and a <button> inside a <button> is invalid markup that browsers recover from
// unpredictably. The CTA is therefore a styled <span>: it looks like the
// affordance the design calls for, and the button around it is what makes the
// whole card keyboard-reachable in one stop.

function Meta({ icon: Icon, children }) {
  return (
    <div className="flex items-center gap-1.5 min-w-0">
      <Icon size={12} className="shrink-0 text-slate-400" />
      <span className="truncate">{children}</span>
    </div>
  );
}

/**
 * How many of this class are still open. An achiever's cap (often 5, 10, …)
 * is set when admin approves them; the card has to show the remaining seats,
 * not just a filled/total fraction a student has to do maths on.
 *
 * Ticks when the cap is small enough to read as seats. A 50-seat class uses a
 * bar — fifty dots are noise.
 */
export function SeatMeter({ filled = 0, total, available, className = '' }) {
  if (!total) {
    return (
      <p className={`text-[11px] font-semibold text-slate-500 ${className}`}>
        {filled} enrolled
      </p>
    );
  }
  const taken = Math.min(Number(total), Number(filled) || 0);
  const left = available == null ? Math.max(0, Number(total) - taken) : Number(available);
  const full = left <= 0;
  const tight = !full && left <= Math.max(1, Math.ceil(Number(total) * 0.2));
  const label = full ? 'Full' : `${left} of ${total} left`;
  const ticks = Number(total) <= 12;

  return (
    <div className={className}>
      <p className={`text-[11px] font-semibold ${
        full ? 'text-slate-400' : tight ? 'text-amber-600' : 'text-slate-500'
      }`}>
        {label}
      </p>
      {ticks ? (
        <div className="mt-1 flex gap-0.5" aria-hidden="true">
          {Array.from({ length: Number(total) }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full ${
                i < taken
                  ? 'bg-slate-300'
                  : tight ? 'bg-amber-400' : ''
              }`}
              style={i >= taken && !tight ? { backgroundColor: 'var(--accent)' } : undefined}
            />
          ))}
        </div>
      ) : (
        <div className="mt-1 h-1.5 rounded-full bg-slate-100 overflow-hidden" aria-hidden="true">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, (taken / Number(total)) * 100)}%`,
              backgroundColor: full ? '#94a3b8' : tight ? '#f59e0b' : 'var(--accent)',
            }}
          />
        </div>
      )}
    </div>
  );
}

/**
 * What the button at the foot of the card should say, and whether it is an
 * action or a statement.
 *
 * These labels are not decoration — they have to match what the slideover will
 * actually let the student do, or the card is a promise the next screen breaks.
 * Enrolment closes the moment a class goes live (the slideover answers a
 * non-enrolled student with "Enrollment closed — session is in progress"), so a
 * live cohort they have not joined must not offer them a seat.
 */
function callToAction(c) {
  if (c.status === 'cancelled')  return { label: 'Cancelled',    quiet: true };
  if (c.isEnrolled) {
    if (c.status === 'live')     return { label: 'Join session', quiet: false };
    if (c.status === 'completed')return { label: 'View details', quiet: true };
    return { label: 'View session', quiet: false };
  }
  if (c.isFull)                  return { label: 'Full',         quiet: true };
  if (c.status === 'live' && !c.lateJoinOpen) return { label: 'In progress',  quiet: true };
  if (c.status === 'completed')  return { label: 'View details', quiet: true };
  return {
    label: Number(c.effectivePrice ?? c.price) ? 'Book seat' : 'Book free seat',
    quiet: false,
  };
}

function Price({ c }) {
  if (!Number(c.price)) return <span className="font-semibold text-emerald-600">Free</span>;
  // A discounted cohort shows both numbers: the struck-through original is the
  // only thing that makes the offer legible as an offer.
  if (c.effectivePrice != null && c.effectivePrice < c.price) {
    return (
      <span className="font-semibold text-slate-700">
        <span className="mr-1 font-normal text-slate-400 line-through">
          ₹{Number(c.price).toLocaleString('en-IN')}
        </span>
        ₹{paise(c.effectivePrice)}
        <span className="ml-1.5 text-[11px] font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">
          {c.offerLabel || 'Offer'}
          {c.offerLeft != null ? ` · ${c.offerLeft} left` : ''}
          {c.offerLeft != null && c.offerNextPrice != null && c.offerNextPrice > c.effectivePrice
            ? ` · then ₹${paise(c.offerNextPrice)}` : ''}
          {c.offerEndsAt ? ` · ends ${new Date(c.offerEndsAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}` : ''}
        </span>
      </span>
    );
  }
  return <span className="font-semibold text-slate-700">₹{Number(c.price).toLocaleString('en-IN')}</span>;
}

export default function CohortCard({ cohort: c, onOpen }) {
  const cta = callToAction(c);

  return (
    <button
      type="button"
      onClick={() => onOpen(c)}
      className="group flex h-full flex-col rounded-2xl border border-slate-200 bg-white p-4 text-left
                 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 min-h-11"
      style={{ '--tw-ring-color': 'var(--accent)' }}
    >
      {/* Who is teaching, first — the mockup leads on the mentor and so does
          the decision. Falls back to the domain when an achiever carries no
          designation, so the line is never empty. */}
      <div className="flex items-center gap-2">
        {c.mentorAvatar
          ? <AvatarImg src={c.mentorAvatar} alt="" className="w-7 h-7 rounded-full object-cover shrink-0" />
          : <Avatar name={c.mentor} size="sm" />}
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-slate-700">{c.mentor}</p>
          <p className="truncate text-[11px] text-slate-400">{c.mentorRole || c.domain}</p>
        </div>
        {c.isEnrolled && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-emerald-200
                           bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
            <Check size={10} /> Joined
          </span>
        )}
        {c.isFull && !c.isEnrolled && (
          <span className="inline-flex shrink-0 items-center rounded-full border border-slate-200
                           bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
            Full
          </span>
        )}
      </div>

      {/* line-clamp rather than truncate: a cohort title is a sentence, and one
          line of it was rarely enough to tell two classes apart in the table. */}
      <h3 className="mt-3 line-clamp-2 text-sm font-bold leading-snug text-slate-900">{c.title}</h3>

      <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px] text-slate-500">
        <Meta icon={Calendar}>{c.dateTime || c.date || 'Date TBC'}</Meta>
        <Meta icon={Clock}>{c.duration}</Meta>
        <Meta icon={Number(c.price) ? IndianRupee : Ticket}><Price c={c} /></Meta>
      </div>

      <SeatMeter
        filled={c.filledSeats}
        total={c.totalSeats}
        available={c.availableSeats}
        className="mt-3"
      />

      {/* mt-auto pins the CTA to the bottom of the card, so a two-line title and
          a one-line title still line their buttons up across a row. */}
      <div className="mt-auto pt-4">
        <span
          className={`block rounded-xl px-3 py-2.5 min-h-11 flex items-center justify-center text-center text-xs font-bold transition-opacity ${
            cta.quiet
              ? 'bg-slate-100 text-slate-500'
              : 'text-white group-hover:opacity-90'
          }`}
          style={cta.quiet ? undefined : { backgroundColor: 'var(--accent)' }}
        >
          {cta.label}
        </span>
      </div>
    </button>
  );
}
