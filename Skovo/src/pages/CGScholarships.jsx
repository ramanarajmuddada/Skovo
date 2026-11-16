import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { PageHeader, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Card, Badge, Button } from '../components/ui/index.jsx';
import { Award, IndianRupee, MapPin, Calendar, ExternalLink, X, Users } from 'lucide-react';

// TYPES comes from master data (masters.scholarship_type).
const TYPE_COLOR = { central: 'purple', state: 'blue', private: 'amber', international: 'emerald' };
const BENEFIT_COLOR = { full_fees: 'emerald', partial_fees: 'blue', stipend: 'amber', equipment: 'purple' };

function ScholarshipCard({ item, onClick }) {
  return (
    <Card hover className="p-5 flex flex-col gap-3 cursor-pointer" onClick={() => onClick(item)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center shrink-0">
          <Award size={18} className="text-emerald-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            <Badge color={TYPE_COLOR[item.scheme_type] || 'slate'} size="xs">{item.scheme_type}</Badge>
            {item.benefit_type && <Badge color={BENEFIT_COLOR[item.benefit_type] || 'slate'} size="xs">{item.benefit_type?.replace('_', ' ')}</Badge>}
          </div>
          <p className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{item.name}</p>
          <p className="text-xs text-slate-500 mt-0.5 truncate">{item.provider}</p>
        </div>
      </div>

      {item.benefit_amount && (
        <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
          <IndianRupee size={13} />
          {Number(item.benefit_amount).toLocaleString('en-IN')} / year
        </div>
      )}

      {item.for_state && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <MapPin size={11} className="text-slate-400" /> {item.for_state}
        </p>
      )}

      {item.income_limit && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <IndianRupee size={11} className="text-slate-400" />
          Family income below ₹{Number(item.income_limit).toLocaleString('en-IN')} / year
        </p>
      )}

      {item.eligible_categories?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(Array.isArray(item.eligible_categories) ? item.eligible_categories : [item.eligible_categories]).slice(0, 4).map((c, i) => (
            <span key={i} className="text-[11px] bg-slate-100 text-slate-600 px-2 py-0.5 rounded-md font-medium">{c}</span>
          ))}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-emerald-600">View details</span>
        {item.application_deadline_info && (
          <span className="text-[11px] text-slate-400 flex items-center gap-1">
            <Calendar size={10} /> {item.application_deadline_info}
          </span>
        )}
      </div>
    </Card>
  );
}

function ScholarshipModal({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge color={TYPE_COLOR[item.scheme_type] || 'slate'} size="xs">{item.scheme_type}</Badge>
              {item.scholarship_mode && <Badge color="slate" size="xs">{item.scholarship_mode}</Badge>}
            </div>
            <h3 className="text-xl font-bold text-slate-900 leading-snug">{item.name}</h3>
            <p className="text-sm text-slate-400 mt-0.5">{item.provider}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-3">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Key info grid */}
          <div className="grid grid-cols-2 gap-3">
            {item.benefit_amount && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3">
                <p className="text-xs text-emerald-600 font-semibold mb-0.5">Benefit Amount</p>
                <p className="text-lg font-bold text-emerald-800">₹{Number(item.benefit_amount).toLocaleString('en-IN')}</p>
                <p className="text-xs text-emerald-600">{item.benefit_type?.replace('_', ' ')}</p>
              </div>
            )}
            {item.income_limit && (
              <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                <p className="text-xs text-amber-600 font-semibold mb-0.5">Income Limit</p>
                <p className="text-sm font-bold text-amber-800">₹{Number(item.income_limit).toLocaleString('en-IN')} / yr</p>
                <p className="text-xs text-amber-600">Annual family income</p>
              </div>
            )}
          </div>

          {item.for_state && (
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <MapPin size={14} className="text-slate-400" /> Applicable for: <span className="font-semibold">{item.for_state}</span>
            </div>
          )}

          {item.eligible_categories?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Eligible Categories</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.eligible_categories) ? item.eligible_categories : [item.eligible_categories]).map((c, i) => (
                  <Badge key={i} color="blue" size="sm">{c}</Badge>
                ))}
              </div>
            </div>
          )}

          {item.eligible_courses?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Eligible Courses</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.eligible_courses) ? item.eligible_courses : [item.eligible_courses]).map((c, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{c}</span>
                ))}
              </div>
            </div>
          )}

          {item.eligible_qualifications?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Qualifications Required</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.eligible_qualifications) ? item.eligible_qualifications : [item.eligible_qualifications]).map((q, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{q}</span>
                ))}
              </div>
            </div>
          )}

          {item.eligibility_criteria && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Eligibility Criteria</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{item.eligibility_criteria}</p>
            </div>
          )}

          {item.required_documents?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Documents Required</p>
              <ul className="space-y-1">
                {(Array.isArray(item.required_documents) ? item.required_documents : [item.required_documents]).map((d, i) => (
                  <li key={i} className="text-sm text-slate-700 flex items-start gap-2">
                    <span className="text-emerald-500 mt-0.5">•</span> {d}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {item.application_deadline_info && (
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <Calendar size={14} /> Deadline: {item.application_deadline_info}
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex gap-3">
          <Button variant="secondary" size="md" onClick={onClose} className="flex-1">Close</Button>
          {item.application_url && (
            <a href={item.application_url} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="primary" size="md" className="w-full">
                <ExternalLink size={14} /> Apply Now
              </Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CGScholarships() {
  const { lists } = useMasters(['scholarship_type']);
  const TYPES = ['all', ...(lists.scholarship_type || []).map(o => o.value)];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = (params = {}) => {
    setLoading(true);
    api.get('/cg/scholarships', { page: params.page || 1, per_page: 12, ...params })
      .then(({ data }) => {
        if (data.bool) {
          setItems(data.response.scholarships || []);
          setPages(data.pagination?.pages || 1);
        } else setItems([]);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ page, scheme_type: type !== 'all' ? type : undefined, search: search || undefined });
  }, [page, type]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, scheme_type: type !== 'all' ? type : undefined, search: search || undefined });
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Scholarships"
        subtitle="Central & state scholarships, fee reimbursements and financial aid schemes for eligible students"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search scholarships…" className="flex-1" />
        <FilterPills
          options={TYPES}
          active={type}
          onSelect={(t) => { setType(t); setPage(1); }}
          formatLabel={(t) => t === 'all' ? 'All' : t.charAt(0).toUpperCase() + t.slice(1)}
        />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Award} title="No scholarships found" subtitle="Try a different search or filter" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((s) => <ScholarshipCard key={s.id} item={s} onClick={setSelected} />)}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
      {selected && <ScholarshipModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
