import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { PageHeader, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Card, Badge } from '../components/ui/index.jsx';
import { Tag, IndianRupee, TrendingUp, Code, Globe, Building2, ChevronDown, ChevronUp, Brain, Star } from 'lucide-react';

// CATEGORIES comes from master data (masters.branch_category).
const DEMAND_COLOR = { very_high: 'emerald', high: 'blue', medium: 'amber', low: 'slate' };
const AI_COLOR = { high: 'red', medium: 'amber', low: 'emerald' };
const DIFF_COLOR = { hard: 'red', medium: 'amber', easy: 'emerald' };
const WLB_COLOR = { excellent: 'emerald', good: 'blue', average: 'amber', poor: 'red' };

function SalaryBar({ label, min, max }) {
  if (!min && !max) return null;
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-slate-400 font-medium w-20">{label}</span>
      <span className="font-semibold text-slate-700">₹{min}L – ₹{max}L</span>
    </div>
  );
}

function BranchCard({ branch }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <Card className="overflow-hidden">
      <div
        className="p-5 cursor-pointer hover:bg-slate-50 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex items-start gap-3 mb-3">
          <div className="w-11 h-11 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
            <Tag size={18} className="text-amber-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-black text-slate-400 tracking-widest uppercase">{branch.code}</span>
              <Badge color={DEMAND_COLOR[branch.demand_level] || 'slate'} size="xs">{branch.demand_level?.replace('_', ' ')} demand</Badge>
            </div>
            <p className="font-bold text-slate-900 text-base leading-snug">{branch.name}</p>
          </div>
          {expanded ? <ChevronUp size={16} className="text-slate-400 shrink-0 mt-1" /> : <ChevronDown size={16} className="text-slate-400 shrink-0 mt-1" />}
        </div>

        <div className="flex flex-wrap gap-2 mb-3">
          {branch.ai_impact && <Badge color={AI_COLOR[branch.ai_impact] || 'slate'} size="xs"><Brain size={9} /> AI: {branch.ai_impact}</Badge>}
          {branch.difficulty_level && <Badge color={DIFF_COLOR[branch.difficulty_level] || 'slate'} size="xs">{branch.difficulty_level}</Badge>}
          {branch.work_life_balance && <Badge color={WLB_COLOR[branch.work_life_balance] || 'slate'} size="xs">WLB: {branch.work_life_balance}</Badge>}
          {branch.coding_required && <Badge color="blue" size="xs"><Code size={9} /> Coding</Badge>}
          {branch.abroad_opportunities && <Badge color="indigo" size="xs"><Globe size={9} /> Abroad</Badge>}
          {branch.govt_opportunities && <Badge color="purple" size="xs"><Building2 size={9} /> Govt</Badge>}
        </div>

        {branch.salary_fresher_min && (
          <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700">
            <IndianRupee size={13} />
            Fresher: ₹{branch.salary_fresher_min}L – ₹{branch.salary_fresher_max}L / year
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-5 pb-5 border-t border-slate-100 space-y-4 pt-4">
          {branch.description && (
            <p className="text-sm text-slate-600 leading-relaxed">{branch.description}</p>
          )}

          {branch.future_scope && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Future Scope</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-blue-50 border border-blue-100 rounded-xl p-3">{branch.future_scope}</p>
            </div>
          )}

          {(branch.salary_fresher_min || branch.salary_5yr_min || branch.salary_10yr_min) && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <IndianRupee size={11} /> Salary Growth (LPA)
              </p>
              <div className="space-y-1.5">
                <SalaryBar label="Fresher" min={branch.salary_fresher_min} max={branch.salary_fresher_max} />
                <SalaryBar label="5 Years" min={branch.salary_5yr_min} max={branch.salary_5yr_max} />
                <SalaryBar label="10 Years" min={branch.salary_10yr_min} max={branch.salary_10yr_max} />
              </div>
            </div>
          )}

          {branch.skills_required?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Key Skills</p>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(branch.skills_required) ? branch.skills_required : [branch.skills_required]).map((s, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-2.5 py-1 rounded-lg font-medium">{s}</span>
                ))}
              </div>
            </div>
          )}

          {branch.top_companies?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Top Companies</p>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(branch.top_companies) ? branch.top_companies : [branch.top_companies]).map((c, i) => (
                  <span key={i} className="text-xs bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg font-semibold">{c}</span>
                ))}
              </div>
            </div>
          )}

          {branch.related_roles?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Job Roles</p>
              <div className="flex flex-wrap gap-1.5">
                {(Array.isArray(branch.related_roles) ? branch.related_roles : [branch.related_roles]).map((r, i) => (
                  <span key={i} className="text-xs bg-emerald-50 text-emerald-700 px-2.5 py-1 rounded-lg font-medium">{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

export default function CGBranches() {
  const { lists } = useMasters(['branch_category']);
  const CATEGORIES = ['all', ...(lists.branch_category || []).map(o => o.value)];
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);

  const load = (params = {}) => {
    setLoading(true);
    api.get('/cg/branches', { page: params.page || 1, per_page: 15, ...params })
      .then(({ data }) => {
        if (data.bool) {
          setBranches(data.response.branches || []);
          setPages(data.pagination?.pages || 1);
        } else setBranches([]);
      })
      .catch(() => setBranches([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ page, category: category !== 'all' ? category : undefined, search: search || undefined });
  }, [page, category]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, category: category !== 'all' ? category : undefined, search: search || undefined });
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Career Branches"
        subtitle="Explore branches by demand, salary, AI impact, top companies and career roles — click any card to expand"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search branches…" className="flex-1" />
        <FilterPills
          options={CATEGORIES}
          active={category}
          onSelect={(c) => { setCategory(c); setPage(1); }}
          formatLabel={(c) => c === 'all' ? 'All' : c.charAt(0).toUpperCase() + c.slice(1)}
        />
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 bg-white border border-slate-200 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : branches.length === 0 ? (
        <EmptyState icon={Tag} title="No branches found" subtitle="Try a different search or category" />
      ) : (
        <div className="space-y-3">
          {branches.map((b) => <BranchCard key={b.id} branch={b} />)}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
    </div>
  );
}
