/* One cohort from the API, in the shape the cohort card and the details panel
   read (date, fullDate, duration, mentor, seats...). Shared by Cohorts and the
   achiever profile so both open the same panel the same way. */
export function normalizeCohort(c) {
  const date = c.session_date ? new Date(c.session_date) : null;
  return {
    id: c.id, title: c.title,
    domain: c.domain?.name || c.domain || 'General',
    status: c.status || 'upcoming',
    lateJoinOpen: !!c.late_join_open,
    mentor: c.achiever?.full_name || c.mentor || 'Expert Mentor',
    mentorRole: c.achiever
      ? [c.achiever.designation, c.achiever.company].filter(Boolean)
          .filter((x, i, a) => a.findIndex((y) => y.trim().toLowerCase() === x.trim().toLowerCase()) === i).join(' • ')
      : c.mentorRole || '',
    date: date ? date.toLocaleDateString('en-IN', { month: 'short', day: 'numeric' }) : c.date,
    // Date *and* clock time, for the card. A cohort is one live session at a
    // specific hour, so the day on its own was never enough to decide whether
    // you can attend — and the day on its own is all the table ever showed.
    dateTime: date
      ? date.toLocaleString('en-IN', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : null,
    // A cohort with no total_seats is uncapped, not full: show what it has
    // drawn rather than a ceiling that does not exist.
    totalSeats: c.total_seats || 0,
    filledSeats: c.filled_seats ?? 0,
    availableSeats: c.available_seats,
    isFull: Boolean(c.total_seats) && c.available_seats === 0,
    mentorAvatar: c.achiever?.avatar_url || c.achiever?.profile_image_url || '',
    seats: c.total_seats
      ? (c.available_seats == null
          ? `${c.filled_seats ?? 0}/${c.total_seats}`
          : `${c.available_seats} left`)
      : `${c.filled_seats ?? 0} enrolled`,
    // The same fact worded for a card, which — unlike the slideover's detail
    // grid — has no "Seats" label sitting next to it to supply the noun.
    seatsLabel: c.total_seats
      ? (c.available_seats === 0
          ? `${c.total_seats} seats · full`
          : `${c.available_seats} of ${c.total_seats} seats left`)
      : `${c.filled_seats ?? 0} enrolled`,
    isEnrolled: Boolean(c.is_enrolled),
    price: c.price ?? 0, effectivePrice: c.effective_price ?? c.price ?? 0, offerLabel: c.offer_label || null,
    offerLeft: c.offer_left ?? null, offerEndsAt: c.offer_ends_at || null, offerNextPrice: c.offer_next_price ?? null, about: c.about,
    learnings: c.what_you_learn || c.learnings || [],
    duration: c.duration_minutes ? `${c.duration_minutes} min` : '90 min',
    fullDate: date ? date.toLocaleDateString('en-IN', { dateStyle: 'long' }) : c.fullDate,
  };
}
