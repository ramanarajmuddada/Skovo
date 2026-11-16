import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { Card, PageHeader, Badge, Toast, EmptyState, SearchBar, FilterPills, StudentPage } from '../components/ui/index.jsx';
import { ShoppingBag, Lock, ExternalLink, Copy, Check, Crown, Ticket } from 'lucide-react';

function DealCard({ deal, onRedeem }) {
  return (
    <Card className="p-0 overflow-hidden flex flex-col hover:shadow-md hover:border-slate-300 transition-all">
      <div className="h-32 bg-slate-100 relative shrink-0">
        {deal.image_url ? (
          <img src={deal.image_url} alt={deal.title} className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <ShoppingBag size={32} />
          </div>
        )}
        {deal.discount_label && (
          <span className="absolute top-3 left-3 px-2.5 py-1 rounded-lg bg-emerald-700 text-white text-xs font-bold shadow-sm">
            {deal.discount_label}
          </span>
        )}
        {deal.is_pro_only && (
          <span className="absolute top-3 right-3 px-2.5 py-1 rounded-lg bg-purple-600 text-white text-[11px] font-bold shadow-sm flex items-center gap-1">
            <Crown size={11} /> PRO
          </span>
        )}
      </div>

      <div className="p-4 flex flex-col gap-2 flex-1">
        {deal.brand && <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{deal.brand}</p>}
        <h3 className="font-bold text-slate-900 leading-snug">{deal.title}</h3>
        {deal.description && <p className="text-sm text-slate-500 line-clamp-2">{deal.description}</p>}

        <div className="flex items-center gap-2 mt-auto pt-3">
          {deal.category && <Badge color="blue" size="xs">{deal.category}</Badge>}
          {deal.ends_at && (
            <span className="text-[11px] text-slate-400">
              Ends {new Date(deal.ends_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
            </span>
          )}
        </div>

        <button
          onClick={() => onRedeem(deal)}
          className={`w-full mt-2 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors ${
            deal.locked
              ? 'bg-purple-50 text-purple-700 border border-purple-200 hover:bg-purple-100'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {deal.locked ? <><Lock size={14} /> Unlock with Pro</> : <>Get deal <ExternalLink size={14} /></>}
        </button>
      </div>
    </Card>
  );
}

function RedeemModal({ deal, result, onClose }) {
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(result.coupon_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 pointer-events-none">
        <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-sm p-5 sm:p-6 pointer-events-auto"
          style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <h2 className="font-bold text-slate-900 text-lg">{deal.title}</h2>
          {deal.brand && <p className="text-sm text-slate-400 mt-0.5">{deal.brand}</p>}

          {result.coupon_code && (
            <div className="mt-5">
              <p className="text-xs font-semibold text-slate-500 mb-1.5">Your coupon code</p>
              <button
                onClick={copy}
                className="w-full flex items-center justify-between px-4 py-3 border-2 border-dashed border-slate-300 rounded-xl hover:border-blue-400 hover:bg-blue-50 transition-colors group"
              >
                <span className="font-mono font-bold text-slate-900 tracking-wider">{result.coupon_code}</span>
                {copied
                  ? <Check size={16} className="text-emerald-600" />
                  : <Copy size={16} className="text-slate-400 group-hover:text-blue-600" />}
              </button>
              <p className="text-[11px] text-slate-400 mt-1.5">Tap to copy, then paste at checkout.</p>
            </div>
          )}

          <a
            href={result.deal_url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="mt-5 w-full min-h-11 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 transition-colors"
          >
            Continue to {deal.brand || 'offer'} <ExternalLink size={14} />
          </a>
          <button onClick={onClose} className="mt-2 w-full min-h-11 py-2.5 text-sm font-medium text-slate-500 hover:text-slate-700 transition-colors">
            Close
          </button>
        </div>
      </div>
    </>
  );
}

export default function Market() {
  const navigate = useNavigate();
  const [deals, setDeals] = useState([]);
  const [categories, setCategories] = useState([]);
  const [category, setCategory] = useState('');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [toastType, setToastType] = useState('success');
  const [redeemed, setRedeemed] = useState(null);
  const [coupons, setCoupons] = useState([]);
  const [copiedCode, setCopiedCode] = useState('');

  // Skovo's own discount codes, shown alongside the brand deals.
  useEffect(() => {
    let current = true;
    api.get('/billing/coupons')
      .then(({ data }) => { if (current && data.bool) setCoupons(data.response.coupons || []); })
      .catch(() => {});
    return () => { current = false; };
  }, []);

  const copyCoupon = (code) => {
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(''), 2000);
  };

  const flash = (msg, type = 'success') => {
    setToast(msg); setToastType(type);
    setTimeout(() => setToast(''), 4000);
  };

  useEffect(() => {
    // Changing the category while a search is in flight can land the replies
    // out of order, leaving the list showing the wrong filter's deals.
    let current = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set('category', category);
    if (query) params.set('search', query);
    api.get(`/market/?${params}`)
      .then(({ data }) => {
        if (!current) return;   // a newer filter/search superseded this one
        if (data.bool) {
          setDeals(data.response.deals || []);
          setCategories(data.response.categories || []);
        }
      })
      .catch(() => { if (current) setDeals([]); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [category, query]);

  const handleRedeem = async (deal) => {
    // Locked deals send you to the upgrade page rather than a doomed request.
    // navigate(), not window.location: this is an in-app route, and a hard
    // reload here throws away the bundle and the session bootstrap to move one
    // screen sideways.
    if (deal.locked) { navigate('/skovo-pro'); return; }
    try {
      const { data } = await api.post(`/market/${deal.id}/redeem`, {});
      if (data.bool) setRedeemed({ deal, result: data.response });
      else flash(data.response?.message || 'This deal is unavailable.', 'error');
    } catch { flash('Could not open this deal.', 'error'); }
  };

  const pills = ['', ...categories.map((c) => c.category)];

  return (
    <StudentPage>
      <Toast message={toast} type={toastType} />
      <PageHeader title="Market" subtitle="Student-only deals on the tools and brands you actually use" />

      {/* Skovo's own discount codes. There is no separate coupons screen —
          a student had no way to discover a code at all and could only type
          one they were handed elsewhere. They live here, next to the deals. */}
      {coupons.length > 0 && (
        <div className="mb-5 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
          <div className="flex items-center gap-2 mb-2.5">
            <Ticket size={16} className="text-emerald-700" />
            <h2 className="text-sm font-bold text-emerald-900">Your discount codes</h2>
            <span className="text-xs text-emerald-700">use at checkout on cohorts &amp; courses</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {coupons.map((c) => (
              <button
                key={c.code}
                onClick={() => copyCoupon(c.code)}
                title="Copy code"
                className="flex items-center gap-2 px-3 py-2 rounded-xl bg-white border border-emerald-200 hover:border-emerald-400 transition-colors text-left"
              >
                <span className="font-mono font-bold text-sm text-slate-900 tracking-wide">{c.code}</span>
                <span className="text-xs font-semibold text-emerald-700">
                  {c.discount_type === 'percent' ? `${c.value}% off` : `₹${c.value} off`}
                </span>
                {copiedCode === c.code
                  ? <Check size={13} className="text-emerald-600" />
                  : <Copy size={13} className="text-slate-300" />}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 mb-5">
        <SearchBar
          value={search}
          onChange={setSearch}
          onSubmit={() => setQuery(search)}
          placeholder="Search deals and brands…"
        />
        {categories.length > 0 && (
          <FilterPills
            options={pills}
            active={category}
            onSelect={setCategory}
            formatLabel={(c) => (c === '' ? 'All' : c)}
          />
        )}
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-72 bg-white rounded-2xl border border-slate-200 animate-pulse" />
          ))}
        </div>
      ) : deals.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No deals right now"
          subtitle="New student offers land here regularly — check back soon"
        />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {deals.map((d) => <DealCard key={d.id} deal={d} onRedeem={handleRedeem} />)}
        </div>
      )}

      {redeemed && (
        <RedeemModal deal={redeemed.deal} result={redeemed.result} onClose={() => setRedeemed(null)} />
      )}
    </StudentPage>
  );
}
