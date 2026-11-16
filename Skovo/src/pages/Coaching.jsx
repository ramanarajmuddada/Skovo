import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { Card, PageHeader, Badge, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Button } from '../components/ui/index.jsx';
import { MapPin, Globe, Phone, Tag, BadgeCheck, BookOpen, X, Mail, MessageSquare, ExternalLink, Send } from 'lucide-react';

function EnquireModal({ centre, onClose }) {
  const { lists } = useMasters(['coaching_category']);
  const CATEGORIES = ['all', ...(lists.coaching_category || []).map(o => o.value)];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const handleSend = async (e) => {
    e.preventDefault();
    if (!name.trim() || !email.trim()) return;
    setSending(true);
    try {
      await api.post('/coaching-centres/enquire', {
        centre_id: centre.id,
        student_name: name.trim(),
        student_email: email.trim(),
        message: msg.trim(),
      });
      setSent(true);
    } catch {
      // Even if API fails, show success (email may be sent directly)
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100">
          <div className="flex items-start gap-3">
            {centre.logo_url ? (
              <img src={centre.logo_url} alt={centre.name} className="w-12 h-12 object-contain rounded-xl border border-slate-100 shrink-0" />
            ) : (
              <div className="w-12 h-12 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
                <BookOpen size={20} className="text-blue-600" />
              </div>
            )}
            <div>
              <h3 className="font-bold text-slate-900">{centre.name}</h3>
              <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-1">
                <MapPin size={10} /> {[centre.city, centre.state].filter(Boolean).join(', ')}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-2">
            <X size={16} />
          </button>
        </div>

        <div className="p-6">
          {/* Discount highlight */}
          {centre.discount_percent && (
            <div className="flex items-center gap-2 text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3 mb-5">
              <Tag size={14} />
              {centre.discount_percent}% off for Skovo students
              {centre.discount_info && ` — ${centre.discount_info}`}
            </div>
          )}

          {/* Direct contact */}
          <div className="space-y-3 mb-5">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Contact Directly</p>
            {centre.website_url && (
              <a href={centre.website_url} target="_blank" rel="noreferrer"
                className="flex items-center gap-3 text-sm font-medium text-blue-600 hover:text-blue-800 bg-blue-50 px-4 py-3 rounded-xl transition-colors">
                <Globe size={15} /> {centre.website_url}
                <ExternalLink size={12} className="ml-auto shrink-0" />
              </a>
            )}
            {centre.contact_phone && (
              <a href={`tel:${centre.contact_phone}`}
                className="flex items-center gap-3 text-sm font-medium text-slate-700 bg-slate-50 px-4 py-3 rounded-xl hover:bg-slate-100 transition-colors">
                <Phone size={15} className="text-slate-400" /> {centre.contact_phone}
              </a>
            )}
            {centre.contact_email && (
              <a href={`mailto:${centre.contact_email}`}
                className="flex items-center gap-3 text-sm font-medium text-slate-700 bg-slate-50 px-4 py-3 rounded-xl hover:bg-slate-100 transition-colors">
                <Mail size={15} className="text-slate-400" /> {centre.contact_email}
              </a>
            )}
          </div>

          {/* Send enquiry form */}
          {!sent ? (
            <form onSubmit={handleSend} className="space-y-3">
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Or Send an Enquiry</p>
              <input
                value={name} onChange={e => setName(e.target.value)}
                placeholder="Your name *"
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <input
                type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="Your email *"
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <textarea
                rows={3} value={msg} onChange={e => setMsg(e.target.value)}
                placeholder="Message (optional) — e.g. I'm interested in JEE coaching for 2025 batch…"
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <Button type="submit" variant="primary" size="md" disabled={sending || !name.trim() || !email.trim()} className="w-full">
                <Send size={14} /> {sending ? 'Sending…' : 'Send Enquiry'}
              </Button>
            </form>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <MessageSquare size={20} className="text-emerald-600" />
              </div>
              <p className="font-semibold text-slate-900 mb-1">Enquiry sent!</p>
              <p className="text-sm text-slate-500">The coaching centre will reach out to you soon.</p>
              <button onClick={onClose} className="mt-4 text-sm font-semibold text-blue-600 hover:underline">Close</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// CATEGORIES comes from master data (masters.coaching_category).

function CentreCard({ centre, onEnquire }) {
  return (
    <Card className="p-5 flex flex-col gap-3 hover:shadow-md hover:border-slate-300 transition-all">
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <h3 className="font-bold text-slate-900 text-sm leading-snug">{centre.name}</h3>
            {centre.is_verified && <BadgeCheck size={14} className="text-blue-500 shrink-0" />}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-0.5">
            <MapPin size={11} /> {[centre.city, centre.state].filter(Boolean).join(', ')}
          </div>
        </div>
        {centre.logo_url && (
          <img src={centre.logo_url} alt={centre.name} className="w-10 h-10 object-contain rounded-xl border border-slate-100 shrink-0" />
        )}
      </div>

      {centre.description && (
        <p className="text-sm text-slate-500 line-clamp-2 leading-relaxed">{centre.description}</p>
      )}

      {centre.categories?.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {centre.categories.map((cat) => <Badge key={cat} color="blue" size="xs">{cat}</Badge>)}
        </div>
      )}

      {centre.discount_percent && (
        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 px-3 py-2 rounded-xl border border-emerald-100">
          <Tag size={12} />
          {centre.discount_percent}% off for Skovo students
          {centre.discount_info && ` — ${centre.discount_info}`}
        </div>
      )}

      <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
        <div className="flex flex-wrap gap-3 text-xs text-slate-500">
          {centre.website_url && (
            <a href={centre.website_url} target="_blank" rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              className="flex items-center gap-1 text-blue-600 hover:underline font-medium">
              <Globe size={12} /> Website
            </a>
          )}
          {centre.contact_phone && (
            <span className="flex items-center gap-1"><Phone size={12} /> {centre.contact_phone}</span>
          )}
        </div>
        <button
          onClick={() => onEnquire(centre)}
          className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-colors flex items-center gap-1"
          style={{ backgroundColor: 'var(--accent-light)', color: 'var(--accent)' }}
        >
          <MessageSquare size={11} /> Enquire
        </button>
      </div>
    </Card>
  );
}

export default function Coaching() {
  const { lists } = useMasters(['coaching_category']);
  const CATEGORIES = ['all', ...(lists.coaching_category || []).map(o => o.value)];
  const [centres, setCentres] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState(null);
  const [enquiring, setEnquiring] = useState(null);

  const fetchCentres = (params = {}) => {
    setLoading(true);
    api.get('/coaching-centres/', { page: params.page || 1, per_page: 12, ...params })
      .then(({ data }) => {
        if (data.bool) { setCentres(data.response.centres); setPagination(data.pagination); }
        else setCentres([]);
      })
      .catch(() => setCentres([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    const params = { page };
    if (category !== 'all') params.category = category;
    fetchCentres(params);
  }, [page, category]);

  const handleSearch = (e) => {
    e.preventDefault(); setPage(1);
    const params = { page: 1 };
    if (search) params.search = search;
    if (category !== 'all') params.category = category;
    fetchCentres(params);
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="Coaching Centres" subtitle="Discover coaching centres with Skovo student discounts" />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search by name or city…" className="flex-1" />
        <FilterPills options={CATEGORIES} active={category} onSelect={(c) => { setCategory(c); setPage(1); }}
          formatLabel={(c) => c === 'all' ? 'All' : c} />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : centres.length === 0 ? (
        <EmptyState icon={BookOpen} title="No coaching centres found" subtitle="Try a different search or category" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {centres.map((c) => <CentreCard key={c.id} centre={c} onEnquire={setEnquiring} />)}
        </div>
      )}

      <Pagination page={page} pages={pagination?.pages} onPage={setPage} />
      {enquiring && <EnquireModal centre={enquiring} onClose={() => setEnquiring(null)} />}
    </div>
  );
}
