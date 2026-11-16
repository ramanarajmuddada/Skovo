import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { PageHeader, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Card, Badge, Button } from '../components/ui/index.jsx';
import { Globe, DollarSign, GraduationCap, Award, Clock, X, ExternalLink, TrendingUp } from 'lucide-react';

// PROGRAMS comes from master data (masters.abroad_program).
const PROG_COLOR = { MS: 'blue', MBA: 'purple', PhD: 'emerald', BTech: 'amber', MArch: 'indigo' };

const COUNTRY_FLAG = {
  USA: '🇺🇸', UK: '🇬🇧', Canada: '🇨🇦', Australia: '🇦🇺',
  Germany: '🇩🇪', France: '🇫🇷', Netherlands: '🇳🇱', Singapore: '🇸🇬',
  Ireland: '🇮🇪', 'New Zealand': '🇳🇿', Japan: '🇯🇵', UAE: '🇦🇪',
};

function AbroadCard({ item, onClick }) {
  const flag = COUNTRY_FLAG[item.country] || '🌍';
  return (
    <Card hover className="p-5 flex flex-col gap-3 cursor-pointer" onClick={() => onClick(item)}>
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0 text-2xl">{flag}</div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            <Badge color={PROG_COLOR[item.program_type] || 'slate'} size="xs">{item.program_type}</Badge>
            {item.intake_season && <Badge color="slate" size="xs">{item.intake_season}</Badge>}
            {item.scholarship_available && <Badge color="emerald" size="xs">Scholarship</Badge>}
          </div>
          <p className="font-bold text-slate-900 text-sm leading-snug">{item.country}</p>
          {item.university_name && <p className="text-xs text-slate-400 mt-0.5 truncate">{item.university_name}</p>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {item.tuition_per_year_usd && (
          <div className="bg-slate-50 rounded-xl p-2.5 text-center">
            <p className="text-[11px] text-slate-400 font-medium">Tuition / yr</p>
            <p className="text-sm font-bold text-slate-800">${Number(item.tuition_per_year_usd).toLocaleString()}</p>
          </div>
        )}
        {item.avg_salary_after_ms_usd && (
          <div className="bg-emerald-50 rounded-xl p-2.5 text-center">
            <p className="text-[11px] text-emerald-600 font-medium">Avg Salary</p>
            <p className="text-sm font-bold text-emerald-800">${Number(item.avg_salary_after_ms_usd).toLocaleString()}/yr</p>
          </div>
        )}
      </div>

      {(item.min_gre_score || item.min_ielts_score) && (
        <div className="flex gap-3 text-xs text-slate-500">
          {item.min_gre_score && <span className="flex items-center gap-1"><GraduationCap size={10} /> GRE {item.min_gre_score}+</span>}
          {item.min_ielts_score && <span className="flex items-center gap-1"><GraduationCap size={10} /> IELTS {item.min_ielts_score}+</span>}
          {item.min_toefl_score && <span className="flex items-center gap-1"><GraduationCap size={10} /> TOEFL {item.min_toefl_score}+</span>}
        </div>
      )}

      <div className="mt-auto pt-2 border-t border-slate-100">
        <span className="text-xs font-semibold text-indigo-600">View program details</span>
      </div>
    </Card>
  );
}

function AbroadModal({ item, onClose }) {
  if (!item) return null;
  const flag = COUNTRY_FLAG[item.country] || '🌍';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div className="flex items-start gap-3">
            <span className="text-3xl">{flag}</span>
            <div>
              <div className="flex flex-wrap gap-2 mb-1">
                <Badge color={PROG_COLOR[item.program_type] || 'slate'} size="xs">{item.program_type}</Badge>
                {item.intake_season && <Badge color="slate" size="xs">{item.intake_season}</Badge>}
                {item.scholarship_available && <Badge color="emerald" size="xs">Scholarship Available</Badge>}
              </div>
              <h3 className="text-xl font-bold text-slate-900">{item.country}</h3>
              {item.university_name && <p className="text-sm text-slate-400 mt-0.5">{item.university_name}</p>}
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-3">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* Cost grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {item.tuition_per_year_usd && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 font-semibold">Tuition / Year</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">${Number(item.tuition_per_year_usd).toLocaleString()}</p>
              </div>
            )}
            {item.living_cost_per_year_usd && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                <p className="text-xs text-slate-500 font-semibold">Living Cost / Year</p>
                <p className="text-lg font-bold text-slate-900 mt-0.5">${Number(item.living_cost_per_year_usd).toLocaleString()}</p>
              </div>
            )}
            {item.avg_salary_after_ms_usd && (
              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-600 font-semibold">Avg Salary After</p>
                <p className="text-lg font-bold text-emerald-800 mt-0.5">${Number(item.avg_salary_after_ms_usd).toLocaleString()}/yr</p>
              </div>
            )}
          </div>

          {/* Requirements */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Minimum Requirements</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {item.min_gre_score && <div className="bg-blue-50 rounded-xl p-2.5 text-center"><p className="text-[11px] text-blue-600 font-semibold">GRE</p><p className="text-sm font-bold text-blue-900">{item.min_gre_score}+</p></div>}
              {item.min_ielts_score && <div className="bg-blue-50 rounded-xl p-2.5 text-center"><p className="text-[11px] text-blue-600 font-semibold">IELTS</p><p className="text-sm font-bold text-blue-900">{item.min_ielts_score}+</p></div>}
              {item.min_toefl_score && <div className="bg-blue-50 rounded-xl p-2.5 text-center"><p className="text-[11px] text-blue-600 font-semibold">TOEFL</p><p className="text-sm font-bold text-blue-900">{item.min_toefl_score}+</p></div>}
              {item.min_gpa && <div className="bg-blue-50 rounded-xl p-2.5 text-center"><p className="text-[11px] text-blue-600 font-semibold">Min GPA</p><p className="text-sm font-bold text-blue-900">{item.min_gpa}+</p></div>}
            </div>
          </div>

          {item.duration_years && (
            <p className="text-sm text-slate-600 flex items-center gap-2">
              <Clock size={14} className="text-slate-400" /> Program Duration: <span className="font-semibold">{item.duration_years} years</span>
            </p>
          )}

          {item.scholarship_info && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Scholarship Information</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-emerald-50 border border-emerald-100 rounded-xl p-4">{item.scholarship_info}</p>
            </div>
          )}

          {item.popular_scholarships?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Popular Scholarships</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.popular_scholarships) ? item.popular_scholarships : [item.popular_scholarships]).map((s, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {item.job_opportunities && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Job Opportunities</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{item.job_opportunities}</p>
            </div>
          )}

          {item.pr_opportunities && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">PR / Immigration Pathways</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{item.pr_opportunities}</p>
            </div>
          )}

          {item.visa_guidance && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Visa Guidance</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-blue-50 border border-blue-100 rounded-xl p-4">{item.visa_guidance}</p>
            </div>
          )}

          {item.application_process && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Application Process</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{item.application_process}</p>
            </div>
          )}

          {item.best_for_branches?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Best For Branches</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(item.best_for_branches) ? item.best_for_branches : [item.best_for_branches]).map((b, i) => (
                  <Badge key={i} color="blue" size="sm">{b}</Badge>
                ))}
              </div>
            </div>
          )}

          {item.application_deadline && (
            <p className="text-sm font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              Application Deadline: {new Date(item.application_deadline).toLocaleDateString('en-IN', { dateStyle: 'long' })}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 shrink-0">
          <Button variant="secondary" size="md" onClick={onClose} className="w-full">Close</Button>
        </div>
      </div>
    </div>
  );
}

export default function CGAbroad() {
  const { lists } = useMasters(['abroad_program']);
  const PROGRAMS = ['all', ...(lists.abroad_program || []).map(o => o.value)];
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [program, setProgram] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = (params = {}) => {
    setLoading(true);
    api.get('/cg/abroad', { page: params.page || 1, per_page: 12, ...params })
      .then(({ data }) => {
        if (data.bool) {
          setItems(data.response.programs || []);
          setPages(data.pagination?.pages || 1);
        } else setItems([]);
      })
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ page, program_type: program !== 'all' ? program : undefined, search: search || undefined });
  }, [page, program]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, program_type: program !== 'all' ? program : undefined, search: search || undefined });
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Study Abroad"
        subtitle="MS, MBA and PhD programs across USA, UK, Canada, Germany and more — costs, requirements & scholarships"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search by country or university…" className="flex-1" />
        <FilterPills
          options={PROGRAMS}
          active={program}
          onSelect={(p) => { setProgram(p); setPage(1); }}
          formatLabel={(p) => p === 'all' ? 'All Programs' : p}
        />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <EmptyState icon={Globe} title="No programs found" subtitle="Try a different search or program filter" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((a) => <AbroadCard key={a.id} item={a} onClick={setSelected} />)}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
      {selected && <AbroadModal item={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
