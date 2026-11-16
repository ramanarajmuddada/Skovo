import React, { useEffect, useState } from 'react';
import { Tag, Calendar, Users, Zap, CheckCircle2, Clock } from 'lucide-react';
import { achieverApi } from '../../services/api';
import { ConfirmModal } from '../../components/ui/TableComponents';
import { ErrorState, useToast } from '../../components/ui/index.jsx';
import StatTile from '../../components/admin/StatTile';
import { Tabs } from '../../components/admin/v1/AdminV1Kit';

const rupee = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: Number(n || 0) % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const when = (s) => (s ? new Date(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : null);

const STATE = {
  active:  { label: 'Active',   cls: 'bg-emerald-100 text-emerald-700' },
  used_up: { label: 'Used up',  cls: 'bg-amber-100 text-amber-700' },
  ended:   { label: 'Ended',    cls: 'bg-slate-100 text-slate-600' },
  stopped: { label: 'Stopped',  cls: 'bg-slate-100 text-slate-600' },
};

const TABS = [
  { key: 'active', label: 'Active', icon: Zap },
  { key: 'past',   label: 'Past',   icon: Clock },
];

// "Students 1-3", "Student 4", "Students 10+".
function slabRows(o) {
  let from = 1;
  return (o.slabs || []).map((t, i) => {
    const label = t.seats == null ? `Students ${from}+`
      : (t.seats === 1 ? `Student ${from}` : `Students ${from}–${from + t.seats - 1}`);
    if (t.seats) from += t.seats;
    return { ...t, label, now: o.state === 'active' && o.slab === i + 1 };
  });
}

function OfferCard({ o, onStop }) {
  const st = STATE[o.state] || STATE.ended;
  const slabs = slabRows(o);
  const pct = o.seats ? Math.min(100, Math.round((o.used / o.seats) * 100)) : null;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-bold text-slate-900 min-w-0 break-words">{o.title}</p>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${st.cls}`}>{st.label}</span>
      </div>
      {o.session_date && (
        <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1"><Calendar size={12} /> Class {when(o.session_date)}</p>
      )}

      {/* What a student pays right now. */}
      <div className="mt-3 flex items-baseline gap-2 flex-wrap">
        {o.offer_price != null ? (
          <>
            <span className="text-2xl font-black text-slate-900">{rupee(o.offer_price)}</span>
            <span className="text-sm text-slate-400 line-through">{rupee(o.price)}</span>
            {o.label && <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 rounded-full px-2 py-0.5">{o.label}</span>}
          </>
        ) : (
          <>
            <span className="text-2xl font-black text-slate-900">{rupee(o.price)}</span>
            <span className="text-xs text-slate-500">full price</span>
          </>
        )}
      </div>

      {/* Offer places used, as a bar when there is a limit. */}
      <div className="mt-3">
        <div className="flex justify-between text-xs text-slate-600">
          <span className="inline-flex items-center gap-1"><Users size={12} /> Offer places used</span>
          <span className="font-semibold">
            {o.seats != null ? `${o.used} / ${o.seats}` : o.used}
            {/* Taken then refunded: the offer was still used (it does not come back). */}
            {o.used_refunded > 0 && <span className="font-normal text-slate-400"> ({o.used_refunded} refunded)</span>}
          </span>
        </div>
        {pct != null && (
          <div className="mt-1.5 h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      {slabs.length > 1 && (
        <div className="mt-3 rounded-xl border border-slate-100 divide-y divide-slate-100">
          {slabs.map((t, i) => (
            <div key={i} className={`flex justify-between gap-2 text-xs px-3 py-2 ${t.now ? 'bg-emerald-50 text-emerald-800 font-semibold' : 'text-slate-600'}`}>
              <span>{t.label}{t.now ? ' · now' : ''}</span>
              <span>{rupee(t.price)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto pt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-slate-400">{o.ends_at ? `Offer ends ${when(o.ends_at)}` : 'Runs until the class starts'}</span>
        {o.state === 'active' && (
          <button type="button" onClick={() => onStop(o)}
                  className="min-h-9 px-3 rounded-xl text-xs font-semibold border border-red-500/30 text-red-600 hover:bg-red-500/10 shrink-0">
            Stop offer
          </button>
        )}
      </div>
    </div>
  );
}

/** Achiever > Offers. Read-only list of every cohort offer. Offers are set in
    Create / Edit cohort (Price & offer); here the achiever sees how each is
    doing and can stop one. v1 has no coupon codes. */
export default function AchieverOffers() {
  const toast = useToast();
  const [rows, setRows] = useState(null);
  const [failed, setFailed] = useState(false);
  const [stopping, setStopping] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState('active');

  useEffect(() => {
    let alive = true;
    achieverApi.get('/achievers/portal/offers')
      .then(({ data }) => { if (alive) { setRows(data?.bool ? data.response.offers : []); setFailed(!data?.bool); } })
      .catch(() => { if (alive) { setRows([]); setFailed(true); } });
    return () => { alive = false; };
  }, [reloadKey]);

  const stop = async (o) => {
    try {
      const { data } = await achieverApi.put(`/achievers/portal/cohorts/${o.cohort_id}/offer`, {});
      if (data?.bool) { toast.success('Offer stopped. Students who already paid keep their price.'); setReloadKey((k) => k + 1); }
      else toast.error(data?.response?.message || 'Could not stop the offer.');
    } catch { toast.error('Network error. Please try again.'); }
  };

  const all = rows || [];
  const active = all.filter((o) => o.state === 'active');
  const past = all.filter((o) => o.state !== 'active');
  const shown = tab === 'active' ? active : past;
  const sold = all.reduce((n, o) => n + (o.used || 0), 0);

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Tag size={20} style={{ color: 'var(--accent)' }} />
          <h1 className="text-2xl font-black text-slate-900">Offers</h1>
        </div>
        <p className="text-sm text-slate-500">
          Every student sees your offer on the cohort. To add or change one, open the cohort and use Edit (Price &amp; offer).
        </p>
      </div>

      {rows !== null && !failed && (
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <StatTile label="Active" value={active.length} icon={Zap} tone="emerald" />
          <StatTile label="Past" value={past.length} icon={Clock} tone="violet" />
          <StatTile label="Sold" value={sold} icon={CheckCircle2} tone="blue" />
        </div>
      )}

      <Tabs active={tab} onChange={setTab}
            tabs={TABS.map((t) => ({ ...t, label: `${t.label}${rows ? ` (${(t.key === 'active' ? active : past).length})` : ''}` }))} />

      {rows === null ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">{[0, 1, 2].map((i) => <div key={i} className="h-48 rounded-2xl bg-slate-100 animate-pulse" />)}</div>
      ) : failed ? (
        <ErrorState title="We couldn't load your offers" subtitle="This is a connection problem." onRetry={() => setReloadKey((k) => k + 1)} />
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200 py-14 text-center px-4">
          <Tag size={32} className="mx-auto mb-3 text-slate-300" />
          <p className="font-semibold text-slate-600">{tab === 'active' ? 'No offer running' : 'No past offers'}</p>
          <p className="text-sm text-slate-400 mt-1">Add an offer to a paid cohort in Create or Edit cohort.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3 items-stretch">
          {shown.map((o) => <OfferCard key={o.cohort_id} o={o} onStop={setStopping} />)}
        </div>
      )}

      {stopping && (
        <ConfirmModal
          message={`Stop the offer on "${stopping.title}"?`}
          detail="New students pay the full price. Students who already paid keep their price."
          confirmLabel="Stop offer" danger
          onConfirm={() => { const o = stopping; setStopping(null); stop(o); }}
          onCancel={() => setStopping(null)} />
      )}
    </div>
  );
}
