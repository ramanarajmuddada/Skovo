import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { PageHeader, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Card, Badge, Button } from '../components/ui/index.jsx';
import { Shield, Clock, IndianRupee, Users, TrendingUp, X, ExternalLink, Globe } from 'lucide-react';

// CATEGORIES comes from master data (masters.govt_exam_category).
const CAT_COLOR = {
  upsc: 'red', ssc: 'orange', banking: 'emerald', railway: 'blue',
  state: 'purple', police: 'slate', teaching: 'amber',
};
const COMP_COLOR = { very_high: 'red', high: 'orange', medium: 'amber', low: 'emerald' };

function GovtExamCard({ item, onClick }) {
  return (
    <Card hover className="p-5 flex flex-col gap-3 cursor-pointer" onClick={() => onClick(item)}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
          <Shield size={18} className="text-purple-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            <Badge color={CAT_COLOR[item.exam_category] || 'slate'} size="xs">{item.exam_category}</Badge>
            {item.competition_level && (
              <Badge color={COMP_COLOR[item.competition_level] || 'slate'} size="xs">
                {item.competition_level?.replace('_', ' ')} competition
              </Badge>
            )}
          </div>
          <p className="font-bold text-slate-900 text-sm leading-snug">{item.name}</p>
          {item.conducting_body && <p className="text-xs text-slate-400 mt-0.5">{item.conducting_body}</p>}
        </div>
      </div>

      {(item.salary_min || item.salary_max) && (
        <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-700">
          <IndianRupee size={13} />
          {item.salary_min && item.salary_max
            ? `₹${Number(item.salary_min).toLocaleString('en-IN')} – ₹${Number(item.salary_max).toLocaleString('en-IN')} / mo`
            : `₹${Number(item.salary_min || item.salary_max).toLocaleString('en-IN')} / mo`}
        </div>
      )}

      {(item.eligible_age_min || item.eligible_age_max) && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Users size={11} className="text-slate-400" />
          Age: {item.eligible_age_min}–{item.eligible_age_max} years
        </p>
      )}

      {item.preparation_timeline_months && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Clock size={11} className="text-slate-400" /> Prep time: ~{item.preparation_timeline_months} months
        </p>
      )}

      {item.for_state && item.for_state !== 'All India' && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <Globe size={11} /> {item.for_state}
        </p>
      )}

      <div className="mt-auto pt-2 border-t border-slate-100">
        <span className="text-xs font-semibold text-purple-600">View roadmap & details</span>
      </div>
    </Card>
  );
}

function GovtExamModal({ item, onClose }) {
  if (!item) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge color={CAT_COLOR[item.exam_category] || 'slate'} size="xs">{item.exam_category}</Badge>
              {item.competition_level && <Badge color={COMP_COLOR[item.competition_level] || 'slate'} size="xs">{item.competition_level?.replace('_', ' ')} competition</Badge>}
            </div>
            <h3 className="text-xl font-bold text-slate-900">{item.name}</h3>
            <p className="text-sm text-slate-400 mt-0.5">{item.conducting_body} {item.for_state ? `· ${item.for_state}` : ''}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-3">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Key stats */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {item.salary_min && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-600 font-semibold">Salary</p>
                <p className="text-sm font-bold text-emerald-800 mt-0.5">
                  ₹{Number(item.salary_min).toLocaleString('en-IN')}<br/>
                  <span className="text-xs font-normal">per month</span>
                </p>
              </div>
            )}
            {item.eligible_age_min && (
              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 text-center">
                <p className="text-xs text-blue-600 font-semibold">Age Limit</p>
                <p className="text-sm font-bold text-blue-800 mt-0.5">{item.eligible_age_min}–{item.eligible_age_max} yrs</p>
              </div>
            )}
            {item.preparation_timeline_months && (
              <div className="bg-purple-50 border border-purple-100 rounded-xl p-3 text-center">
                <p className="text-xs text-purple-600 font-semibold">Prep Time</p>
                <p className="text-sm font-bold text-purple-800 mt-0.5">{item.preparation_timeline_months} months</p>
              </div>
            )}
          </div>

          {item.age_relaxation_info && (
            <div className="text-sm text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <span className="font-semibold">Age Relaxation: </span>{item.age_relaxation_info}
            </div>
          )}

          {item.job_benefits && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Job Benefits</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-emerald-50 border border-emerald-100 rounded-xl p-4">{item.job_benefits}</p>
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

          {item.syllabus?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Syllabus Topics</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.syllabus) ? item.syllabus : [item.syllabus]).map((s, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {item.roadmap && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Preparation Roadmap</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{item.roadmap}</p>
            </div>
          )}

          {item.recommended_books?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Recommended Books</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.recommended_books) ? item.recommended_books : [item.recommended_books]).map((b, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{b}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex gap-3">
          <Button variant="secondary" size="md" onClick={onClose} className="flex-1">Close</Button>
          {item.official_website && (
            <a href={item.official_website} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="primary" size="md" className="w-full">
                <ExternalLink size={14} /> Official Site
              </Button>
            </a>
          )}
          {item.notification_url && (
            <a href={item.notification_url} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="secondary" size="md" className="w-full">
                <ExternalLink size={14} /> Notification
              </Button>
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CGGovtExams() {
  const { lists } = useMasters(['govt_exam_category']);
  const CATEGORIES = ['all', ...(lists.govt_exam_category || []).map(o => o.value)];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = (params = {}) => {
    setLoading(true);
    api.get('/cg/govt-exams', { page: params.page || 1, per_page: 12, ...params })
      .then(({ data }) => {
        if (data.bool) {
          setItems(data.response.exams || []);
          setPages(data.pagination?.pages || 1);
        } else setItems([]);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ page, exam_category: category !== 'all' ? category : undefined, search: search || undefined });
  }, [page, category]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, exam_category: category !== 'all' ? category : undefined, search: search || undefined });
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Government Exams"
        subtitle="UPSC, SSC, Banking, Railway, State Groups — roadmaps, salary info and preparation guides"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search govt exams…" className="flex-1" />
        <FilterPills
          options={CATEGORIES}
          active={category}
          onSelect={(c) => { setCategory(c); setPage(1); }}
          formatLabel={(c) => c === 'all' ? 'All' : c.toUpperCase()}
        />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Shield} title="No govt exams found" subtitle="Try a different search or filter" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((g) => <GovtExamCard key={g.id} item={g} onClick={setSelected} />)}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
      {selected && <GovtExamModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
