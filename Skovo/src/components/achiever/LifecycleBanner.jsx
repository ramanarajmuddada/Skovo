import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Clock, XCircle, AlertTriangle, Ban, Sparkles, LifeBuoy } from 'lucide-react';

/**
 * What the achiever should do next, said once at the top of the dashboard.
 *
 * An account under review looks identical to an account that was ignored. That
 * silence is the single biggest reason applicants give up, so the state is
 * always visible with the reason and the next action attached.
 *
 * All copy comes from the server (`guidelines`) rather than living here — the
 * wording changes far more often than the layout, and it should not need a
 * frontend deploy.
 */

const TONE = {
  pending:   { bg: 'bg-blue-50',    border: 'border-blue-200',    text: 'text-blue-900',    Icon: Clock },
  probation: { bg: 'bg-amber-50',   border: 'border-amber-200',   text: 'text-amber-900',   Icon: Sparkles },
  active:    { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-900', Icon: CheckCircle2 },
  suspended: { bg: 'bg-orange-50',  border: 'border-orange-200',  text: 'text-orange-900',  Icon: AlertTriangle },
  banned:    { bg: 'bg-red-50',     border: 'border-red-200',     text: 'text-red-900',     Icon: Ban },
};

function ChecklistRow({ item }) {
  // Three states, not two: "uploaded and waiting" is not the same as "not done",
  // and telling someone to upload a document they already sent is how support
  // tickets start.
  const Icon = item.done ? CheckCircle2 : item.rejected ? XCircle : item.pending_review ? Clock : Circle;
  const tone = item.done ? 'text-emerald-600'
             : item.rejected ? 'text-red-600'
             : item.pending_review ? 'text-amber-600'
             : 'text-slate-300';

  return (
    <li className="flex items-start gap-3 py-2">
      <Icon size={18} className={`${tone} shrink-0 mt-0.5`} />
      <div className="min-w-0">
        <p className={`text-sm ${item.done ? 'text-slate-500 line-through' : 'text-slate-800 font-medium'}`}>
          {item.label}
        </p>
        {item.rejected && (
          <p className="text-xs text-red-600 mt-0.5">Rejected — please upload it again.</p>
        )}
        {!item.done && !item.rejected && item.pending_review && (
          <p className="text-xs text-amber-600 mt-0.5">Uploaded — waiting for review.</p>
        )}
        {!item.done && !item.pending_review && item.hint && (
          <p className="text-xs text-slate-400 mt-0.5">{item.hint}</p>
        )}
      </div>
    </li>
  );
}

export default function LifecycleBanner({ lifecycle }) {
  const { state, guidelines, checklist, demo, data } = lifecycle;
  if (!guidelines) return null;

  const tone = TONE[state] || TONE.pending;
  const { Icon } = tone;
  const done = checklist.filter(i => i.done).length;

  return (
    <div className={`rounded-2xl border ${tone.border} ${tone.bg} p-4 sm:p-5 mb-5`}>
      <div className="flex items-start gap-3">
        <span className="hidden sm:flex shrink-0 w-9 h-9 rounded-xl bg-white/70 items-center justify-center">
          <Icon size={18} className={tone.text} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={`font-bold leading-snug ${tone.text}`}>{guidelines.title}</h2>
          <p className="text-sm text-slate-600 mt-0.5">{guidelines.summary}</p>

          {/* Why they are suspended, in the admin's own words. A suspension
              with no stated reason is the one people escalate. */}
          {data?.state_reason && (state === 'suspended' || state === 'banned') && (
            <div className="mt-3 rounded-xl bg-white/70 border border-white p-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Reason</p>
              <p className="text-sm text-slate-800 mt-1">{data.state_reason}</p>
              {data.suspended_until && (
                <p className="text-xs text-slate-500 mt-2">
                  {/* With the time, not just the date. A suspension is often
                      hours rather than days, and "reopens automatically on 22
                      September" on the evening of the 22nd tells the achiever
                      nothing -- it reads as today, with no way to know whether
                      that means in ten minutes or at midnight. The admin's
                      History already shows the hour; this is the same fact
                      told to the person it actually constrains. */}
                  Your account reopens automatically on{' '}
                  {new Date(data.suspended_until).toLocaleString('en-IN', {
                    day: 'numeric', month: 'long', year: 'numeric',
                    hour: 'numeric', minute: '2-digit',
                  })}.
                </p>
              )}
              {state === 'suspended' && !data.suspended_until && (
                <p className="text-xs text-slate-500 mt-2">
                  No end date has been set. Contact support to discuss it.
                </p>
              )}
            </div>
          )}

          {/* Probation progress — the person's target, not a hardcoded 3. */}
          {state === 'probation' && demo && (
            <div className="mt-3">
              <div className="h-2 rounded-full bg-amber-200 overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all"
                  style={{
                    width: `${demo.required > 0
                      ? Math.min(100, (demo.completed / demo.required) * 100)
                      : 0}%`,
                  }}
                />
              </div>
              <p className="text-sm text-amber-900 font-medium mt-2">
                {demo.completed} of {demo.required} demo {demo.required === 1 ? 'session' : 'sessions'} complete
                {demo.remaining > 0 && ` · ${demo.remaining} to go`}
              </p>
              {/* Labelled, like the suspended and banned version above it.
                  Unlabelled it was a boxed sentence floating between the
                  progress bar and the numbered steps -- the achiever could see
                  somebody had written to them but not what about. */}
              {data?.state_reason && !/^Application approved/i.test(data.state_reason) && (
                <div className="mt-2 bg-white/70 border border-white rounded-xl p-3">
                  <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                    Note from SKOVO
                  </p>
                  <p className="text-sm text-amber-800 mt-1 leading-relaxed">
                    {data.state_reason}
                  </p>
                </div>
              )}
              {demo.remaining === 0 && (
                <p className="text-sm text-amber-800 mt-1">
                  {demo.required === 1 ? 'Done.' : `All ${demo.required} are done.`} We are reviewing now and will be in touch.
                </p>
              )}
            </div>
          )}

          {/* Steps as a numbered grid: one row on wide screens instead of a
              tall list that pushed the dashboard below the fold. */}
          {/* As many columns as there are steps (4 tips filled 4 of 5 columns
              and left a blank gap on the right). Static classes for Tailwind. */}
          <ol className={`mt-3 grid sm:grid-cols-2 gap-2 ${
            ['', 'xl:grid-cols-1', 'xl:grid-cols-2', 'xl:grid-cols-3', 'xl:grid-cols-4', 'xl:grid-cols-5'][Math.min(guidelines.steps.length, 5)] || 'xl:grid-cols-5'}`}>
            {guidelines.steps.map((s, i) => (
              <li key={i} className="flex gap-2 items-start rounded-xl bg-white/60 px-2.5 py-2 text-xs sm:text-[13px] leading-snug text-slate-700">
                <span className={`shrink-0 w-5 h-5 rounded-full bg-white flex items-center justify-center text-[11px] font-bold ${tone.text}`}>{i + 1}</span>
                <span className="min-w-0">{s}</span>
              </li>
            ))}
          </ol>

          {/* The states whose steps say "contact support", given something to
              press. The sentence has been in this banner all along with no way
              to act on it -- and a suspended or closed account is the case
              where being told to get in touch, and then not being able to, is
              worst. Same /contact page the profile menu now points at. */}
          {(state === 'suspended' || state === 'banned') && (
            <Link to="/contact"
              className="inline-flex items-center gap-2 mt-4 min-h-11 px-3.5 rounded-xl text-sm
                         font-semibold bg-white/80 border border-white text-slate-700
                         hover:bg-white transition-colors">
              <LifeBuoy size={15} />
              Contact support
            </Link>
          )}

          {guidelines.note && (
            <p className="text-xs text-slate-500 mt-3 italic">{guidelines.note}</p>
          )}

          {/* The checklist only exists while there is something to complete. */}
          {checklist.length > 0 && (
            <div className="mt-5 rounded-xl bg-white border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-1">
                <p className="text-sm font-bold text-slate-800">Your application</p>
                <p className="text-xs text-slate-500">{done} of {checklist.length} complete</p>
              </div>
              <ul className="divide-y divide-slate-100">
                {checklist.map(item => <ChecklistRow key={item.key} item={item} />)}
              </ul>
              <Link to="/skovo-achiever-portal/application"
                    className="mt-3 inline-flex items-center justify-center w-full py-2.5 rounded-xl
                               text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 transition-colors">
                {done === checklist.length ? 'Submit for review' : 'Continue your application'}
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
