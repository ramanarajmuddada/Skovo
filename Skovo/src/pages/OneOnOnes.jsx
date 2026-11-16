/**
 * 1-on-1 sessions — every live 1-on-1 from every achiever, in one list
 * (like Cohorts), so a student never opens profiles one by one.
 *
 * Tabs: All · Today · This week · Offers. Filters: search, domain, length,
 * price, sort (soonest / price / rating). 20 at a time with "Show more".
 * Book opens the same booking window as the profile, on that 1-on-1.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Star, CalendarCheck, Sparkles, Loader2, UserRound } from 'lucide-react';
import { api } from '../services/api';
import { PageHeader, SearchBar, StudentPage, FormSelect } from '../components/ui/index.jsx';
import { Tabs } from '../components/admin/v1/AdminV1Kit';
import PriceRange from '../components/ui/PriceRange';
import AvatarImg from '../components/ui/AvatarImg';
import { BookModal } from './FindMentors';

const LENGTHS = Array.from({ length: 12 }, (_, i) => (i + 1) * 15);
const lenLabel = (m) => (m % 60 ? (m > 60 ? `${Math.floor(m / 60)} hr${m >= 120 ? 's' : ''} ${m % 60} min` : `${m} min`) : `${m / 60} hr${m > 60 ? 's' : ''}`);
const rupee = (n) => { const v = Number(n || 0); return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`; };
const nextLabel = (nf) => {
  if (!nf) return '';
  const d = new Date(`${nf.date}T${nf.time}`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(nf.date + 'T00:00:00') - today) / 86400000);
  const day = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
};
const SORTS = [
  { value: 'soonest', label: 'Soonest available' },
  { value: 'price_low', label: 'Price: low to high' },
  { value: 'price_high', label: 'Price: high to low' },
  { value: 'rating', label: 'Top rated' },
];

export default function OneOnOnes() {
  const [tab, setTab] = useState('all');          // all | today | week | offer
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [length, setLength] = useState('');
  const [price, setPrice] = useState(null);
  const [sort, setSort] = useState('soonest');
  const [domains, setDomains] = useState([]);
  const [bounds, setBounds] = useState({ min: 0, max: 0 });
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [booking, setBooking] = useState(null);   // the 1-on-1 being booked

  useEffect(() => {
    api.get('/achievers/browse/filters')
      .then(({ data }) => { if (data.bool) setDomains(data.response?.domains || []); })
      .catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    setLoading(true); setFailed(false);
    api.get('/achiever-availability/browse', {
      page, per_page: 20, sort,
      ...(q && { search: q }), ...(domain && { domain }), ...(length && { length }),
      ...(price?.min != null && { min_price: price.min }), ...(price?.max != null && { max_price: price.max }),
      ...(tab === 'today' && { when: 'today' }), ...(tab === 'week' && { when: 'week' }), ...(tab === 'offer' && { offer: 1 }),
    })
      .then(({ data }) => {
        if (!live) return;
        if (!data.bool) { setFailed(true); return; }
        const r = data.response;
        setItems((cur) => (page === 1 ? r.items : [...cur, ...r.items]));
        setPages(r.pages || 1); setTotal(r.total || 0);
        if (r.price_bounds) setBounds(r.price_bounds);
      })
      .catch(() => live && setFailed(true))
      .finally(() => live && setLoading(false));
    return () => { live = false; };
  }, [page, sort, q, domain, length, price, tab]);

  const reset = (fn) => (v) => { setPage(1); fn(v); };

  return (
    <StudentPage className="space-y-5 sm:space-y-6">
      {booking && (
        <BookModal
          mentor={{ mentor_id: booking.achiever.id, id: booking.achiever.id, full_name: booking.achiever.name,
                    designation: booking.achiever.designation, company: booking.achiever.company,
                    profile_image_url: booking.achiever.photo, is_demo_achiever: !!booking.demo }}
          initialOffering={booking.id}
          onClose={() => setBooking(null)}
          onBooked={() => { setBooking(null); setPage(1); }} />
      )}

      <PageHeader title="1-on-1 sessions" subtitle="Private sessions with achievers. Pick a topic, then a time that suits you." />

      <div className="flex flex-col lg:flex-row gap-2">
        <SearchBar value={search} onChange={setSearch} onSubmit={() => { setPage(1); setQ(search.trim()); }}
                   placeholder="Topic or achiever" className="flex-1" />
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:flex gap-2">
          <div className="lg:w-48">
            <FormSelect value={domain} onChange={reset((v) => setDomain(v || ''))} placeholder="All domains"
                        options={[{ value: '', label: 'All domains' }, ...domains.map((d) => ({ value: d, label: d }))]} />
          </div>
          <div className="lg:w-40">
            <FormSelect value={length} onChange={reset((v) => setLength(v || ''))} placeholder="Any length"
                        options={[{ value: '', label: 'Any length' }, ...LENGTHS.map((m) => ({ value: String(m), label: lenLabel(m) }))]} />
          </div>
          <div className="lg:w-48">
            <FormSelect value={sort} onChange={reset((v) => setSort(v || 'soonest'))} clearable={false} options={SORTS} />
          </div>
        </div>
      </div>
      {bounds.max > bounds.min && (
        <div className="max-w-md"><PriceRange bounds={bounds} value={price} onChange={reset(setPrice)} /></div>
      )}

      <Tabs active={tab} onChange={reset(setTab)} tabs={[
        { key: 'all', label: 'All', icon: UserRound },
        { key: 'today', label: 'Today', icon: Clock },
        { key: 'week', label: 'This week', icon: CalendarCheck },
        { key: 'offer', label: 'Offers', icon: Sparkles },
      ]} />

      {!loading && !failed && <p className="text-xs text-slate-500">{total} session{total === 1 ? '' : 's'}</p>}

      {failed ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center">
          <p className="font-semibold text-slate-800">Could not load 1-on-1 sessions</p>
          <button type="button" onClick={() => setPage(1)} className="mt-3 min-h-11 px-5 rounded-xl text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>Try again</button>
        </div>
      ) : loading && page === 1 ? (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="h-48 rounded-2xl bg-white border border-slate-100 animate-pulse" />)}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center">
          <p className="font-semibold text-slate-800">No 1-on-1 sessions match</p>
          <p className="text-sm text-slate-500 mt-1">Try another tab, domain or price.</p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
          {items.map((o) => {
            const off = !o.demo && o.offer_type && Number(o.final_price) < Number(o.price);
            const a = o.achiever;
            return (
              <div key={o.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 font-bold text-slate-900 break-words">{o.title}</p>
                  <div className="text-right shrink-0">
                    {off && <s className="block text-[11px] text-slate-400">{rupee(o.price)}</s>}
                    <p className="font-black text-slate-900">{Number(o.final_price) > 0 ? rupee(o.final_price) : 'Free'}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">{lenLabel(o.duration_min)}{o.demo ? ' · Free demo' : ''}{off ? ' · Offer' : ''}</p>
                {o.about && <p className="text-sm text-slate-600 mt-2 line-clamp-2">{o.about}</p>}
                <Link to={`/achievers/${a.id}`} className="flex items-center gap-2.5 mt-3 group">
                  {a.photo
                    ? <AvatarImg src={a.photo} alt="" className="w-9 h-9 rounded-xl object-cover shrink-0" />
                    : <span className="w-9 h-9 rounded-xl flex items-center justify-center text-white font-bold shrink-0" style={{ backgroundColor: 'var(--accent)' }}>{a.name?.charAt(0)}</span>}
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 truncate group-hover:underline">{a.name}</span>
                    <span className="block text-xs text-slate-500 truncate">{[a.designation, a.company].filter((x, i, arr) => x && arr.indexOf(x) === i).join(' at ')}</span>
                  </span>
                  {a.rating != null && (
                    <span className="ml-auto shrink-0 text-xs font-semibold text-amber-600 inline-flex items-center gap-0.5">
                      <Star size={11} fill="currentColor" /> {a.rating} ({a.reviews})
                    </span>
                  )}
                </Link>
                <div className="flex items-center gap-2 mt-3 pt-3 border-t border-slate-100 mt-auto">
                  <span className="text-xs text-slate-500 min-w-0">Next free<br /><b className="text-slate-800">{nextLabel(o.next_free)}</b></span>
                  <button type="button" onClick={() => setBooking(o)}
                          className="ml-auto min-h-11 px-5 rounded-xl text-sm font-semibold text-white shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
                    Book
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {page < pages && !failed && items.length > 0 && (
        <div className="flex justify-center">
          <button type="button" disabled={loading} onClick={() => setPage((p) => p + 1)}
                  className="min-h-11 px-6 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 inline-flex items-center gap-2">
            {loading && <Loader2 size={14} className="animate-spin" />} Show more
          </button>
        </div>
      )}
    </StudentPage>
  );
}
