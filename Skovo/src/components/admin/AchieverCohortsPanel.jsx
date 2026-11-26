import React, { useEffect, useState } from 'react';
import ClassTimeline from './ClassTimeline';
import { ArrowLeft, Users, IndianRupee, Star } from 'lucide-react';
import { adminApi } from '../../services/api';

const A = '/skovo-platform-panel-admin';
const rupee = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');

/** One achiever's cohorts, and one cohort's students, payments and reviews.
    Used by the Cohorts and Reviews tabs on Admin > Achievers.
    filter: 'all' | 'reviewed'. */
export default function AchieverCohortsPanel({ achieverId, filter = 'all', startTab = 'students' }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);

  useEffect(() => {
    adminApi.get(`${A}/achievers/${achieverId}/cohorts`)
      .then(({ data }) => setRows(data?.bool ? data.response.cohorts : []))
      .catch(() => setRows([]));
  }, [achieverId]);

  if (open) return <CohortDetail achieverId={achieverId} cohort={open} startTab={startTab} onBack={() => setOpen(null)} />;
  if (!rows) return <p className="text-sm text-slate-400">Loading…</p>;
  const list = rows.filter((c) => (filter === 'reviewed' ? c.reviews > 0 : true));
  if (!list.length) {
    return <p className="text-sm text-slate-500 py-4 text-center">{filter === 'reviewed' ? 'No reviews yet.' : 'No cohorts yet.'}</p>;
  }
  return (
    <div className="space-y-2">
      {list.map((c) => (
        <button key={c.id} type="button" onClick={() => setOpen(c)}
                className="w-full text-left border border-slate-200 rounded-xl p-3 hover:bg-slate-50">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-bold text-slate-800 min-w-0">{c.title}</p>
            {c.missed
              ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-50 text-red-600 shrink-0">Missed</span>
              : <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 shrink-0 capitalize">{c.status}</span>}
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {when(c.session_date)} · {c.joined}/{c.total_seats ?? '∞'} joined · {c.attended} attended
            · {c.is_free ? 'Free' : `${rupee(c.price)} · collected ${rupee(c.collected)}`}
            {c.reviews ? ` · ${c.avg_rating} ★ (${c.reviews})` : ''}
          </p>
        </button>
      ))}
    </div>
  );
}

export function CohortDetail({ achieverId, cohort, startTab = 'students', onBack, hideHeader = false, load, studentAction }) {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState(startTab);
  const [who, setWho] = useState('all');

  useEffect(() => {
    // `load` lets the achiever's own Bookings reuse this view on their endpoint.
    (load ? load(cohort.id) : adminApi.get(`${A}/achievers/${achieverId}/cohorts/${cohort.id}`))
      .then(({ data: d }) => setData(d?.bool ? d.response : { students: [], summary: {} }))
      .catch(() => setData({ students: [], summary: {} }));
  }, [achieverId, cohort.id, load]);

  const tabs = [{ key: 'students', label: 'Students', icon: Users },
    ...(cohort.is_free ? [] : [{ key: 'payments', label: 'Payments', icon: IndianRupee }]),
    { key: 'reviews', label: 'Reviews', icon: Star }];
  const s = data?.summary || {};
  // Overall rating for the class, from the students' own reviews.
  const rated = (data?.students || []).filter((x) => x.rating != null);
  const avg = rated.length ? Math.round((rated.reduce((a, x) => a + Number(x.rating), 0) / rated.length) * 10) / 10 : null;
  // Refunded / cancelled students stay listed (labelled) so admin sees who booked.
  const students = (data?.students || []).filter((x) => ['paid', 'free', 'refunded', 'cancelled'].includes(x.payment_status) || tab === 'payments');
  // Nobody is absent from a class that has not ended: until End session a
  // student without a check-in is "Booked" (upcoming) or "Not checked in" (live).
  const ended = cohort.status === 'completed';
  const missing = cohort.status === 'live' ? 'Not checked in' : 'Booked';
  const shown = tab === 'students' ? students.filter((x) => (who === 'all' ? true : who === 'attended' ? x.attended : !x.attended)) : students;

  return (
    <div className="space-y-3">
      {onBack && (
        <button type="button" onClick={onBack} className="min-h-11 inline-flex items-center gap-1.5 text-sm font-semibold text-violet-700">
          <ArrowLeft size={16} /> All cohorts
        </button>
      )}
      {!hideHeader && (
        <div>
          <p className="text-sm font-bold text-slate-800">{cohort.title}</p>
          <p className="text-xs text-slate-500">{when(cohort.session_date)} · {cohort.status}</p>
        </div>
      )}
      {!data ? <p className="text-sm text-slate-400">Loading…</p> : (
        <>
          <ClassTimeline t={data.timeline} status={cohort.status} />
          <p className="text-xs text-slate-600 rounded-lg bg-slate-50 p-2.5">
            Joined {s.joined} · {ended ? `Attended ${s.attended} · Absent ${s.absent}` : `Checked in ${s.attended}`} · Reviewed {s.reviewed}
            {avg != null && ` · ★ ${avg}`}
            {!cohort.is_free && ` · Collected ${rupee(s.collected)} · Earned ${rupee(s.achiever_share)}`}
          </p>
          <div role="tablist" className={`grid ${tabs.length === 3 ? 'grid-cols-3' : 'grid-cols-2'} gap-1 p-1 rounded-xl bg-slate-100`}>
            {tabs.map((t) => {
              const Icon = t.icon;
              return (
                <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                        className={`min-h-11 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1 ${tab === t.key ? 'bg-white shadow-sm text-violet-700' : 'text-slate-500'}`}>
                  <Icon size={14} /> {t.label}
                </button>
              );
            })}
          </div>

          {tab === 'students' && (
            <>
              <div className="flex gap-1.5">
                {[['all', `All ${students.length}`], ['attended', `${ended ? 'Attended' : 'Checked in'} ${s.attended || 0}`],
                  ['absent', `${ended ? 'Absent' : missing} ${s.absent || 0}`]].map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setWho(k)}
                          className={`min-h-9 px-3 rounded-full text-xs font-semibold ${who === k ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-600'}`}>{l}</button>
                ))}
              </div>
              {shown.length === 0 ? <p className="text-sm text-slate-500">{
                who === 'attended'
                  ? (ended ? 'Nobody attended this class.' : 'No one has checked in yet. Students appear here after entering the code.')
                  : who === 'absent'
                    ? (ended ? 'Nobody was absent.' : 'Everyone booked has checked in.')
                    : 'No students yet.'}</p> : shown.map((x) => (
                <div key={x.user_id} className="border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{x.name}</p>
                      {/* Full email, never cut off: support reads it to find the student. */}
                      {x.email && <p className="text-[11px] text-slate-500 break-all">{x.email}</p>}
                      <p className="text-[11px] text-slate-400">Joined {when(x.joined_at)}</p>
                    </div>
                    <span className={`text-xs font-semibold shrink-0 ${x.attended ? 'text-emerald-600' : ended ? 'text-red-600' : 'text-slate-500'}`}>
                      {['refunded', 'cancelled'].includes(x.payment_status) ? (x.payment_status === 'refunded' ? 'Refunded' : 'Cancelled')
                      : x.attended ? (ended ? 'Attended' : 'Checked in') : (ended ? 'Absent' : missing)}
                    </span>
                  </div>
                  {studentAction && studentAction(x)}
                </div>
              ))}
            </>
          )}

          {tab === 'payments' && (
            <>
              <p className="text-xs text-slate-600">Collected {rupee(s.collected)} · Refunded {rupee(s.refunded)} · Achiever {rupee(s.achiever_share)} · Platform {rupee(s.platform_share)}</p>
              {shown.map((x) => (
                <div key={x.user_id} className="border border-slate-200 rounded-xl p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold text-slate-800 truncate">{x.name}</p>
                    <span className="text-xs font-semibold text-slate-700 shrink-0">{rupee(x.paid)} · {x.payment_status}</span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Price {rupee(x.price)}{x.offer ? ` · Offer −${rupee(x.discount)}`
                      : x.coupon_code ? ` · Coupon ${x.coupon_code} −${rupee(x.discount)}` : ' · Full price'}
                  </p>
                </div>
              ))}
            </>
          )}

          {tab === 'reviews' && (
            avg != null ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 flex items-center gap-3">
                <span className="text-3xl font-black text-slate-900">{avg}</span>
                <div className="min-w-0">
                  <p className="text-amber-500 text-sm leading-none" aria-label={`${avg} out of 5`}>
                    {'★★★★★'.slice(0, Math.round(avg))}<span className="text-slate-300">{'★★★★★'.slice(Math.round(avg))}</span>
                  </p>
                  <p className="text-xs text-slate-600 mt-1">Overall · {rated.length} review{rated.length === 1 ? '' : 's'} out of {s.joined || 0} student{s.joined === 1 ? '' : 's'}</p>
                </div>
              </div>
            ) : <p className="text-sm text-slate-500">No reviews yet.</p>
          )}
          {tab === 'reviews' && students.map((x) => (
            <div key={x.user_id} className="border border-slate-200 rounded-xl p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-slate-800 truncate">{x.name}</p>
                <span className="text-xs text-slate-500 shrink-0">{x.rating != null ? `${x.rating} / 5` : 'No review'}</span>
              </div>
              {x.review_text && <p className="text-xs text-slate-600 mt-1 break-words">{x.review_text}</p>}
            </div>
          ))}
        </>
      )}
    </div>
  );
}
