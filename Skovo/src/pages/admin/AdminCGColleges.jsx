import React, { useEffect, useState, useCallback } from 'react';
import { adminApi as api } from '../../services/api';
import { api as publicApi } from '../../services/api';
import {
  GraduationCap, Plus, Pencil, Trash2, Search, X, Check, Eye,
  ChevronDown, ChevronUp, BookOpen, IndianRupee, BarChart2,
  Globe, MapPin, Award, TrendingUp, Users, Filter,
} from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, Pagination, ConfirmModal,
} from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';

const CURRENT_YEAR = new Date().getFullYear();

function Toast({ msg, ok }) {
  if (!msg) return null;
  return (
    <div className={`fixed top-5 right-5 z-100 px-5 py-3 rounded-xl shadow-xl text-sm font-semibold flex items-center gap-2 ${ok ? 'bg-emerald-600' : 'bg-red-600'} text-white`}>
      {ok ? <Check size={15} /> : <X size={15} />} {msg}
    </div>
  );
}

const emptyCollege = {
  name: '', type: '', location_city: '', location_state: '',
  nirf_ranking: '', naac_grade: '', annual_fees_min: '', annual_fees_max: '',
  placement_rate: '', avg_package: '', highest_package: '', website_url: '',
  about: '', hostel_fee: '', established_year: '', total_students: '',
  facilities: '', top_recruiters: '', achievements: '',
};

const emptyCourse = { course_name: '', degree_type: '', branch_code: '', duration_years: 4, total_seats: '', annual_fee: '' };
const emptyPlacement = { year: CURRENT_YEAR, placement_rate: '', avg_package: '', highest_package: '', median_package: '', total_students: '', placed_students: '', top_recruiters: '' };

const emptyCutoff = {
  branch_code: '', branch_name: '',
  exam_type: '', year: CURRENT_YEAR,
  category: '', gender: '',
  opening_rank: '', closing_rank: '', total_seats: '',
};

/* ── Custom Styled Dropdown ──────────────────────────────────────────────── */
/* Was an eleventh private copy of the searchable dropdown. */
const StyledSelect = FormSelect;
/* â€â€ College Form Modal â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€ */
function CollegeModal({ college, onClose, onSaved, masters, opts }) {
  const editing = !!college?.id;
  const [tab, setTab] = useState('info');
  const [savedId, setSavedId] = useState(college?.id || null);
  const [collegeSaved, setCollegeSaved] = useState(editing);
  const [form, setForm] = useState(editing ? {
    ...college,
    // nullable text fields
    type:            college.type            ?? '',
    location_city:   college.location_city   ?? '',
    location_state:  college.location_state  ?? '',
    naac_grade:      college.naac_grade      ?? '',
    website_url:     college.website_url     ?? '',
    about:           college.about           ?? '',
    // nullable numeric fields
    nirf_ranking:    college.nirf_ranking    ?? '',
    hostel_fee:      college.hostel_fee      ?? '',
    established_year:college.established_year?? '',
    total_students:  college.total_students  ?? '',
    placement_rate:  college.placement_rate  ?? '',
    avg_package:     college.avg_package     ?? '',
    highest_package: college.highest_package ?? '',
    annual_fees_min: college.annual_fees_min ?? '',
    annual_fees_max: college.annual_fees_max ?? '',
    // array fields
    facilities:     Array.isArray(college.facilities)     ? college.facilities.join(', ')     : (college.facilities     || ''),
    top_recruiters: Array.isArray(college.top_recruiters) ? college.top_recruiters.join(', ') : (college.top_recruiters || ''),
    achievements:   Array.isArray(college.achievements)   ? college.achievements.join(', ')   : (college.achievements   || ''),
  } : { ...emptyCollege });
  const [cutoffs,   setCutoffs]   = useState([]);
  const [courses,   setCourses]   = useState([]);
  const [placements,setPlacements]= useState([]);
  const [newCutoff,    setNewCutoff]    = useState({ ...emptyCutoff });
  const [newCourse,    setNewCourse]    = useState({ ...emptyCourse });
  const [newPlacement, setNewPlacement] = useState({ ...emptyPlacement });
  const [editingCutoff,    setEditingCutoff]    = useState(null);
  const [editingCourse,    setEditingCourse]    = useState(null);
  const [editingPlacement, setEditingPlacement] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');

  useEffect(() => {
    if (editing) {
      api.get(`/skovo-platform-panel-admin/cg/colleges/${college.id}`)
        .then(({ data }) => {
          if (data.bool) {
            setCutoffs(data.response.college.cutoffs || []);
            setCourses(data.response.college.courses || []);
            setPlacements(data.response.college.placements || []);
          }
        })
        .catch(() => {});
    }
  }, [editing, college?.id]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const toArr = s => s ? s.split(',').map(x => x.trim()).filter(Boolean) : [];

  const handleSaveCollege = async () => {
    if (!form.name.trim())          { setError('College name is required.');  return; }
    if (!form.type)                 { setError('College type is required.');   return; }
    if (!form.location_city)         { setError('City is required.');           return; }
    if (!form.location_state)       { setError('State is required.');          return; }
    if (!form.annual_fees_min)      { setError('Annual fees (min) is required.'); return; }
    if (!form.annual_fees_max)      { setError('Annual fees (max) is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      ...form,
      facilities:     toArr(form.facilities),
      top_recruiters: toArr(form.top_recruiters),
      achievements:   toArr(form.achievements),
    };
    try {
      let res;
      if (savedId) {
        res = await api.put(`/skovo-platform-panel-admin/cg/colleges/${savedId}`, payload);
      } else {
        res = await api.post('/skovo-platform-panel-admin/cg/colleges', payload);
      }
      if (res.data.bool) {
        const saved = res.data.response.college;
        setSavedId(saved.id);
        setCollegeSaved(true);
        onSaved(saved);
        if (!editing) setTab('branches');
      } else setError(res.data.response?.message || 'Failed to save.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleAddCourse = async () => {
    if (!newCourse.course_name) { setError('Course name is required.'); return; }
    setSaving(true); setError('');
    try {
      const { data } = await api.post(`/skovo-platform-panel-admin/cg/colleges/${savedId}/courses`, newCourse);
      if (data.bool) { setCourses(c => [...c, ...data.response.courses]); setNewCourse({ ...emptyCourse }); }
      else setError(data.response?.message || 'Failed.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleSaveCourse = async () => {
    setSaving(true); setError('');
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/cg/courses/${editingCourse.id}`, editingCourse);
      if (data.bool) { setCourses(c => c.map(x => x.id === editingCourse.id ? data.response.course : x)); setEditingCourse(null); }
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleDeleteCourse = async (id) => {
    if (!window.confirm('Delete this branch?')) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/courses/${id}`);
      if (data.bool) setCourses(c => c.filter(x => x.id !== id));
    } catch {}
  };

  const handleAddPlacement = async () => {
    if (!newPlacement.year) { setError('Year is required.'); return; }
    setSaving(true); setError('');
    const payload = {
      ...newPlacement,
      top_recruiters: newPlacement.top_recruiters ? newPlacement.top_recruiters.split(',').map(s => s.trim()).filter(Boolean) : [],
    };
    try {
      const { data } = await api.post(`/skovo-platform-panel-admin/cg/colleges/${savedId}/placements`, payload);
      if (data.bool) { setPlacements(p => [data.response.placement, ...p]); setNewPlacement({ ...emptyPlacement }); }
      else setError(data.response?.message || 'Failed.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleDeletePlacement = async (id) => {
    if (!window.confirm('Delete this placement record?')) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/placements/${id}`);
      if (data.bool) setPlacements(p => p.filter(x => x.id !== id));
    } catch {}
  };

  const handleAddCutoff = async () => {
    if (!newCutoff.closing_rank) { setError('Closing rank is required.'); return; }
    setSaving(true); setError('');
    try {
      if (!savedId) { setError('Save college info first.'); setSaving(false); return; }
      const { data } = await api.post(`/skovo-platform-panel-admin/cg/colleges/${savedId}/cutoffs`, newCutoff);
      if (data.bool) {
        setCutoffs(c => [...c, ...data.response.cutoffs]);
        setNewCutoff({ ...emptyCutoff });
      } else setError(data.response?.message || 'Failed to add cutoff.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleSaveCutoff = async () => {
    setSaving(true); setError('');
    try {
      const { data } = await api.put(`/skovo-platform-panel-admin/cg/cutoffs/${editingCutoff.id}`, editingCutoff);
      if (data.bool) {
        setCutoffs(c => c.map(x => x.id === editingCutoff.id ? data.response.cutoff : x));
        setEditingCutoff(null);
      } else setError(data.response?.message || 'Failed to update.');
    } catch { setError('Connection error.'); }
    finally { setSaving(false); }
  };

  const handleDeleteCutoff = async (id) => {
    if (!window.confirm('Delete this cutoff row?')) return;
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/cutoffs/${id}`);
      if (data.bool) setCutoffs(c => c.filter(x => x.id !== id));
    } catch {}
  };

  const inputCls = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-violet-400 placeholder:text-slate-500';
  const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';
  const Req = () => <span style={{ color: 'var(--accent)' }} className="ml-0.5">*</span>;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <GraduationCap size={18} style={{ color: 'var(--accent)' }} />
            <h2 className="font-bold text-slate-900">{editing ? 'Edit College' : 'Add College'}</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 shrink-0 px-6 overflow-x-auto">
          {[
            ['info',      'College Info',              true],
            ['branches',  `Branches (${courses.length})`,   collegeSaved],
            ['placements',`Placements (${placements.length})`, collegeSaved],
            ['cutoffs',   `Cutoffs (${cutoffs.length})`,    collegeSaved],
          ].map(([k, label, enabled]) => (
            <button key={k} onClick={() => enabled && setTab(k)}
              disabled={!enabled}
              title={!enabled ? 'Save college info first' : undefined}
              className={`py-3 px-4 text-sm font-semibold border-b-2 whitespace-nowrap transition-colors ${tab === k ? 'border-violet-500 text-violet-600' : 'border-transparent text-slate-500 hover:text-slate-700'} ${!enabled ? 'opacity-40 cursor-not-allowed' : ''}`}>
              {label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 scroll-accent">
          {error && <div className="mb-4 text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</div>}

          {/* â€â€ Tab: College Info â€â€ */}
          {tab === 'info' && (
            <div className="space-y-4">

              {/* Required hint */}
              <p className="text-xs text-slate-400">Fields marked <span style={{ color: 'var(--accent)' }}>*</span> are required</p>

              {/* College Name */}
              <div>
                <label className={labelCls}>College Name <Req /></label>
                <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. JNTU Kakinada" />
              </div>

              {/* Type + State */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>College Type <Req /></label>
                  <StyledSelect
                    value={form.type}
                    onChange={v => set('type', v)}
                    placeholder="e.g. Government"
                    options={opts('college_type')}
                  />
                </div>
                <div>
                  <label className={labelCls}>State <Req /></label>
                  <StyledSelect
                    value={form.location_state}
                    onChange={v => { set('location_state', v); set('location_city', ''); }}
                    placeholder="e.g. Telangana"
                    options={opts('indian_state')}
                    required
                  />
                </div>
              </div>

              {/* City + Established Year */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>City <Req /></label>
                  {form.location_state === 'andhra_pradesh' ? (
                    <StyledSelect
                      value={form.location_city}
                      onChange={v => set('location_city', v)}
                      placeholder="e.g. Hyderabad"
                      options={opts('city')}
                      required
                    />
                  ) : (
                    <input
                      className={inputCls}
                      value={form.location_city}
                      onChange={e => set('location_city', e.target.value)}
                      placeholder="e.g. Kakinada"
                    />
                  )}
                </div>
                <div>
                  <label className={labelCls}>Established Year</label>
                  <input className={inputCls} type="number" value={form.established_year} onChange={e => set('established_year', e.target.value)} placeholder="e.g. 1998" />
                </div>
              </div>

              {/* NAAC + NIRF */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>NAAC Grade</label>
                  <input className={inputCls} value={form.naac_grade} onChange={e => set('naac_grade', e.target.value)} placeholder="e.g. A++ / A+ / A / B++" />
                </div>
                <div>
                  <label className={labelCls}>NIRF Ranking</label>
                  <input className={inputCls} type="number" value={form.nirf_ranking} onChange={e => set('nirf_ranking', e.target.value)} placeholder="e.g. 45" />
                </div>
              </div>

              {/* Fees */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Annual Fees Min (₹) <Req /></label>
                  <input className={inputCls} type="number" value={form.annual_fees_min} onChange={e => set('annual_fees_min', e.target.value)} placeholder="50000" />
                </div>
                <div>
                  <label className={labelCls}>Annual Fees Max (₹) <Req /></label>
                  <input className={inputCls} type="number" value={form.annual_fees_max} onChange={e => set('annual_fees_max', e.target.value)} placeholder="200000" />
                </div>
              </div>

              {/* Hostel + Total Students */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Annual Hostel Fee (₹)</label>
                  <input className={inputCls} type="number" value={form.hostel_fee} onChange={e => set('hostel_fee', e.target.value)} placeholder="60000" />
                </div>
                <div>
                  <label className={labelCls}>Total Students</label>
                  <input className={inputCls} type="number" value={form.total_students} onChange={e => set('total_students', e.target.value)} placeholder="5000" />
                </div>
              </div>

              {/* Placements summary */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Placement Rate (%)</label>
                  <input className={inputCls} type="number" value={form.placement_rate} onChange={e => set('placement_rate', e.target.value)} placeholder="85" />
                </div>
                <div>
                  <label className={labelCls}>Avg Package (LPA)</label>
                  <input className={inputCls} type="number" value={form.avg_package} onChange={e => set('avg_package', e.target.value)} placeholder="6.5" />
                </div>
                <div>
                  <label className={labelCls}>Highest Package (LPA)</label>
                  <input className={inputCls} type="number" value={form.highest_package} onChange={e => set('highest_package', e.target.value)} placeholder="24" />
                </div>
              </div>

              {/* Website */}
              <div>
                <label className={labelCls}>Website URL</label>
                <input className={inputCls} value={form.website_url} onChange={e => set('website_url', e.target.value)} placeholder="https://jntuk.edu.in" />
              </div>

              {/* About */}
              <div>
                <label className={labelCls}>About the College</label>
                <textarea className={inputCls} rows={3} value={form.about} onChange={e => set('about', e.target.value)} placeholder="Brief description about the college, its history and strengths…"/>
              </div>

              {/* Facilities + Top Recruiters + Achievements */}
              <div className="pt-2 border-t border-slate-100 space-y-3">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--accent)' }}>Additional Details</p>
                <div>
                  <label className={labelCls}>Facilities <span className="text-slate-400 font-normal">(comma separated)</span></label>
                  <input className={inputCls} value={form.facilities} onChange={e => set('facilities', e.target.value)} placeholder="Hostel, Library, Labs, Sports Ground, WiFi, Canteen, Auditorium" />
                </div>
                <div>
                  <label className={labelCls}>Top Recruiters <span className="text-slate-400 font-normal">(comma separated)</span></label>
                  <input className={inputCls} value={form.top_recruiters} onChange={e => set('top_recruiters', e.target.value)} placeholder="TCS, Infosys, Wipro, Google, Microsoft, Amazon" />
                </div>
                <div>
                  <label className={labelCls}>Achievements & Awards <span className="text-slate-400 font-normal">(comma separated)</span></label>
                  <input className={inputCls} value={form.achievements} onChange={e => set('achievements', e.target.value)} placeholder="NAAC A+, NBA Accredited, NIRF Top 50, ISO 9001" />
                </div>
              </div>
            </div>
          )}

          {/* â€â€ Tab: Branches â€â€ */}
          {tab === 'branches' && (
            <div className="space-y-5">
              {!collegeSaved && <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">Save college info first, then add branches.</div>}
              {collegeSaved && (
                <>
                  {(() => {
                    // Build degree→branch map from masters (no hardcoding)
                    const degreeBranchMap = {};
                    (masters['degree_branch'] || []).forEach(({ value: v }) => {
                      const [deg, branch] = v.split(':');
                      if (!degreeBranchMap[deg]) degreeBranchMap[deg] = [];
                      if (branch) degreeBranchMap[deg].push(branch);
                    });
                    const availableBranches = newCourse.degree_type
                      ? (degreeBranchMap[newCourse.degree_type] || [])
                      : [];
                    const isSingle = newCourse.degree_type && availableBranches.length === 0;

                    return (
                      <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                        <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Add Branch / Course</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">

                          {/* 1. Degree Type — StyledSelect with search */}
                          <div>
                            <label className={labelCls}>Degree Type *</label>
                            <StyledSelect
                              value={newCourse.degree_type}
                              placeholder="e.g. B.Tech"
                              options={opts('degree_type')}
                              onChange={dt => {
                                const dtLabel = opts('degree_type').find(o => o.value === dt)?.label || '';
                                const branches = degreeBranchMap[dt] || [];
                                const single = branches.length === 0;
                                setNewCourse(c => ({
                                  ...c,
                                  degree_type: dt,
                                  branch_code: single ? dt : '',
                                  course_name: single ? dtLabel : '',
                                }));
                              }}
                            />
                          </div>

                          {/* 2. Branch — StyledSelect with search, filtered from DB */}
                          <div>
                            <label className={labelCls}>Branch / Stream</label>
                            {isSingle ? (
                              <input className={`${inputCls} bg-slate-100 text-slate-400 cursor-not-allowed`}
                                value={opts('degree_type').find(o => o.value === newCourse.degree_type)?.label || ''}
                                readOnly />
                            ) : (
                              <StyledSelect
                                value={newCourse.branch_code}
                                placeholder={newCourse.degree_type ? 'Search branch...' : 'Select degree first'}
                                options={availableBranches.map(code => {
                                  const o = opts('branch_code').find(x => x.value === code);
                                  return o ? { value: o.value, label: `${o.value} — ${o.label}` } : null;
                                }).filter(Boolean)}
                                onChange={code => {
                                  const branchLabel = opts('branch_code').find(o => o.value === code)?.label || '';
                                  const dtLabel = opts('degree_type').find(o => o.value === newCourse.degree_type)?.label || '';
                                  setNewCourse(c => ({ ...c, branch_code: code, course_name: code ? `${dtLabel} - ${branchLabel}` : '' }));
                                }}
                              />
                            )}
                          </div>

                          {/* 3. Branch Name — auto-filled, editable */}
                          <div>
                            <label className={labelCls}>Branch Name *</label>
                            <input className={inputCls} value={newCourse.course_name}
                              onChange={e => setNewCourse(c => ({ ...c, course_name: e.target.value }))}
                              placeholder="Auto-filled, can edit" />
                          </div>

                          <div><label className={labelCls}>Duration (years)</label><input type="number" className={inputCls} value={newCourse.duration_years} onChange={e => setNewCourse(c => ({...c, duration_years: +e.target.value}))}/></div>
                          <div><label className={labelCls}>Total Seats</label><input type="number" className={inputCls} value={newCourse.total_seats} onChange={e => setNewCourse(c => ({...c, total_seats: +e.target.value}))} placeholder="60"/></div>
                          <div><label className={labelCls}>Annual Fee (₹)</label><input type="number" className={inputCls} value={newCourse.annual_fee} onChange={e => setNewCourse(c => ({...c, annual_fee: e.target.value}))} placeholder="120000"/></div>
                        </div>
                        <button onClick={handleAddCourse} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}><Plus size={14}/> Add Branch</button>
                      </div>
                    );
                  })()}

                  {courses.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>{['Branch','Code','Type','Duration','Seats','Annual Fee',''].map(h=><th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                          {courses.map(c => (
                            <tr key={c.id} className="hover:bg-slate-50">
                              {editingCourse?.id === c.id ? (
                                <>
                                  <td className="px-3 py-2"><input className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-32" value={editingCourse.course_name} onChange={e => setEditingCourse(x=>({...x,course_name:e.target.value}))}/></td>
                                  <td className="px-3 py-2"><FormSelect searchType="branch_code"
  value={editingCourse.branch_code}
  onChange={v => setEditingCourse(x=>({...x,branch_code:v}))}
  options={opts('branch_code').map(b => ({ value: b.value, label: b.value }))}
  clearable={false} /></td>
                                  <td className="px-3 py-2"><FormSelect searchType="degree_type" value={editingCourse.degree_type} onChange={v=>setEditingCourse(x=>({...x,degree_type:v}))} options={opts('degree_type')} clearable={false} /></td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-14" value={editingCourse.duration_years} onChange={e=>setEditingCourse(x=>({...x,duration_years:+e.target.value}))}/></td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-16" value={editingCourse.total_seats} onChange={e=>setEditingCourse(x=>({...x,total_seats:+e.target.value}))}/></td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-24" value={editingCourse.annual_fee} onChange={e=>setEditingCourse(x=>({...x,annual_fee:e.target.value}))}/></td>
                                  <td className="px-3 py-2"><div className="flex gap-1"><button onClick={handleSaveCourse} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={13}/></button><button onClick={()=>setEditingCourse(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X size={13}/></button></div></td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-2.5 font-medium text-slate-900 text-xs">{c.course_name}</td>
                                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-full">{c.branch_code}</span></td>
                                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.degree_type}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-500">{c.duration_years} yrs</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-700 font-semibold">{c.total_seats || '"'}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-700">{c.annual_fee ? `₹${Number(c.annual_fee).toLocaleString('en-IN')}` :  '—'}</td>
                                  <td className="px-3 py-2.5"><div className="flex gap-1"><button onClick={()=>setEditingCourse({...c})} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil size={13}/></button><button onClick={()=>handleDeleteCourse(c.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13}/></button></div></td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="text-center py-8 text-slate-400 text-sm">No branches added yet.</div>}
                </>
              )}
            </div>
          )}

          {/* â€â€ Tab: Placements â€â€ */}
          {tab === 'placements' && (
            <div className="space-y-5">
              {!collegeSaved && <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">Save college info first, then add placement data.</div>}
              {collegeSaved && (
                <>
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Add Year-wise Placement Data</p>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div><label className={labelCls}>Year *</label><input type="number" className={inputCls} value={newPlacement.year} onChange={e=>setNewPlacement(p=>({...p,year:+e.target.value}))}/></div>
                      <div><label className={labelCls}>Placement Rate (%)</label><input type="number" className={inputCls} value={newPlacement.placement_rate} onChange={e=>setNewPlacement(p=>({...p,placement_rate:e.target.value}))} placeholder="85"/></div>
                      <div><label className={labelCls}>Total Students</label><input type="number" className={inputCls} value={newPlacement.total_students} onChange={e=>setNewPlacement(p=>({...p,total_students:e.target.value}))}/></div>
                      <div><label className={labelCls}>Students Placed</label><input type="number" className={inputCls} value={newPlacement.placed_students} onChange={e=>setNewPlacement(p=>({...p,placed_students:e.target.value}))}/></div>
                      <div><label className={labelCls}>Avg Package (LPA)</label><input type="number" className={inputCls} value={newPlacement.avg_package} onChange={e=>setNewPlacement(p=>({...p,avg_package:e.target.value}))} placeholder="6.5"/></div>
                      <div><label className={labelCls}>Median Package (LPA)</label><input type="number" className={inputCls} value={newPlacement.median_package} onChange={e=>setNewPlacement(p=>({...p,median_package:e.target.value}))}/></div>
                      <div><label className={labelCls}>Highest Package (LPA)</label><input type="number" className={inputCls} value={newPlacement.highest_package} onChange={e=>setNewPlacement(p=>({...p,highest_package:e.target.value}))} placeholder="24"/></div>
                      <div className="col-span-2 sm:col-span-1"><label className={labelCls}>Top Recruiters (comma separated)</label><input className={inputCls} value={newPlacement.top_recruiters} onChange={e=>setNewPlacement(p=>({...p,top_recruiters:e.target.value}))} placeholder="TCS, Wipro, Google"/></div>
                    </div>
                    <button onClick={handleAddPlacement} disabled={saving} className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50" style={{backgroundColor:'var(--accent)'}}><Plus size={14}/> Add Year</button>
                  </div>

                  {placements.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>{['Year','Rate','Total','Placed','Avg Pkg','Median','Highest','Top Recruiters',''].map(h=><th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>)}</tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                          {placements.map(p=>(
                            <tr key={p.id} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 font-bold text-slate-800 text-xs">{p.year}</td>
                              <td className="px-3 py-2.5 text-xs text-emerald-700 font-semibold">{p.placement_rate ? `${p.placement_rate}%` :  '—'}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-600">{p.total_students || '"'}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-600">{p.placed_students || '"'}</td>
                              <td className="px-3 py-2.5 text-xs font-semibold text-slate-800">{p.avg_package ? `${p.avg_package} LPA` :  '—'}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-600">{p.median_package ? `${p.median_package} LPA` :  '—'}</td>
                              <td className="px-3 py-2.5 text-xs font-semibold text-blue-700">{p.highest_package ? `${p.highest_package} LPA` :  '—'}</td>
                              <td className="px-3 py-2.5 text-xs text-slate-500 max-w-36 truncate">{Array.isArray(p.top_recruiters) ? p.top_recruiters.join(', ') :  '—'}</td>
                              <td className="px-3 py-2.5"><button onClick={()=>handleDeletePlacement(p.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13}/></button></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : <div className="text-center py-8 text-slate-400 text-sm">No placement records yet.</div>}
                </>
              )}
            </div>
          )}

          {/* â€â€ Tab: Cutoffs â€â€ */}
          {tab === 'cutoffs' && (
            <div className="space-y-5">
              {!collegeSaved && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
                  Save the college info first, then come back to add cutoffs.
                </div>
              )}

              {collegeSaved && (
                <>
                  {/* Add new cutoff row */}
                  <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                    <p className="text-xs font-bold text-slate-600 uppercase tracking-wide">Add Cutoff Row</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      <div>
                        <label className={labelCls}>Branch</label>
                        <StyledSelect
                          value={newCutoff.branch_code}
                          placeholder="Search branch…"
                          options={opts('branch_code').map(b => ({ value: b.value, label: `${b.value} — ${b.label}` }))}
                          onChange={v => {
                            const b = opts('branch_code').find(x => x.value === v);
                            setNewCutoff(c => ({ ...c, branch_code: v, branch_name: b?.label || '' }));
                          }}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Exam Type</label>
                        <StyledSelect
                          value={newCutoff.exam_type}
                          placeholder="e.g. JEE Main"
                          options={opts('exam_type')}
                          onChange={v => setNewCutoff(c => ({ ...c, exam_type: v }))}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Year</label>
                        <input className={inputCls} type="number" value={newCutoff.year} onChange={e => setNewCutoff(c => ({ ...c, year: +e.target.value }))} />
                      </div>
                      <div>
                        <label className={labelCls}>Category</label>
                        <StyledSelect
                          value={newCutoff.category}
                          placeholder="e.g. Engineering"
                          options={opts('reservation_category')}
                          onChange={v => setNewCutoff(c => ({ ...c, category: v }))}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Gender</label>
                        <StyledSelect
                          value={newCutoff.gender}
                          placeholder="e.g. Female"
                          options={opts('gender')}
                          onChange={v => setNewCutoff(c => ({ ...c, gender: v }))}
                        />
                      </div>
                      <div>
                        <label className={labelCls}>Total Seats</label>
                        <input className={inputCls} type="number" value={newCutoff.total_seats} onChange={e => setNewCutoff(c => ({ ...c, total_seats: +e.target.value }))} placeholder="60" />
                      </div>
                      <div>
                        <label className={labelCls}>Opening Rank</label>
                        <input className={inputCls} type="number" value={newCutoff.opening_rank} onChange={e => setNewCutoff(c => ({ ...c, opening_rank: +e.target.value }))} placeholder="1000" />
                      </div>
                      <div>
                        <label className={labelCls}>Closing Rank *</label>
                        <input className={inputCls} type="number" value={newCutoff.closing_rank} onChange={e => setNewCutoff(c => ({ ...c, closing_rank: +e.target.value }))} placeholder="8500" />
                      </div>
                    </div>
                    <button onClick={handleAddCutoff} disabled={saving}
                      className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
                      style={{ backgroundColor: 'var(--accent)' }}>
                      <Plus size={14} /> Add Row
                    </button>
                  </div>

                  {/* Existing cutoffs table */}
                  {cutoffs.length > 0 ? (
                    <div className="overflow-x-auto rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                          <tr>
                            {['Branch', 'Exam', 'Year', 'Category', 'Gender', 'Opening', 'Closing', 'Seats', ''].map(h => (
                              <th key={h} className="px-3 py-2.5 text-left text-xs font-semibold text-slate-500">{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                          {cutoffs.map(ct => (
                            <tr key={ct.id} className="hover:bg-slate-50">
                              {editingCutoff?.id === ct.id ? (
                                <>
                                  <td className="px-3 py-2">
                                    <FormSelect searchType="branch_code"
                                      value={editingCutoff.branch_code}
                                      onChange={v => { const b = opts('branch_code').find(x => x.value === v); setEditingCutoff(c => ({ ...c, branch_code: v, branch_name: b?.label || '' })); }}
                                      options={opts('branch_code').map(b => ({ value: b.value, label: `${b.value} — ${b.label}` }))}
                                      clearable={false} />
                                  </td>
                                  <td className="px-3 py-2">
                                    <FormSelect searchType="exam_type"
                                      value={editingCutoff.exam_type}
                                      onChange={v => setEditingCutoff(c => ({ ...c, exam_type: v }))}
                                      options={opts('exam_type')} clearable={false} />
                                  </td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-16" value={editingCutoff.year} onChange={e => setEditingCutoff(c => ({ ...c, year: +e.target.value }))} /></td>
                                  <td className="px-3 py-2">
                                    <FormSelect searchType="reservation_category" value={editingCutoff.category}
                                      onChange={v => setEditingCutoff(c => ({ ...c, category: v }))}
                                      options={opts('reservation_category')} clearable={false} />
                                  </td>
                                  <td className="px-3 py-2">
                                    <FormSelect searchType="gender" value={editingCutoff.gender}
                                      onChange={v => setEditingCutoff(c => ({ ...c, gender: v }))}
                                      options={opts('gender')} clearable={false} />
                                  </td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-20" value={editingCutoff.opening_rank} onChange={e => setEditingCutoff(c => ({ ...c, opening_rank: +e.target.value }))} /></td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-20" value={editingCutoff.closing_rank} onChange={e => setEditingCutoff(c => ({ ...c, closing_rank: +e.target.value }))} /></td>
                                  <td className="px-3 py-2"><input type="number" className="border border-slate-200 rounded-lg px-2 py-1 text-xs w-16" value={editingCutoff.total_seats} onChange={e => setEditingCutoff(c => ({ ...c, total_seats: +e.target.value }))} /></td>
                                  <td className="px-3 py-2">
                                    <div className="flex items-center gap-1">
                                      <button onClick={handleSaveCutoff} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"><Check size={13} /></button>
                                      <button onClick={() => setEditingCutoff(null)} className="p-1 text-slate-400 hover:bg-slate-100 rounded"><X size={13} /></button>
                                    </div>
                                  </td>
                                </>
                              ) : (
                                <>
                                  <td className="px-3 py-2.5 font-medium text-slate-800 text-xs">{ct.branch_code}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-600">{ct.exam_type}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-600">{ct.year}</td>
                                  <td className="px-3 py-2.5"><span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">{ct.category}</span></td>
                                  <td className="px-3 py-2.5 text-xs text-slate-500">{ct.gender}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-600">{ct.opening_rank?.toLocaleString('en-IN') || '"'}</td>
                                  <td className="px-3 py-2.5 text-xs font-semibold text-slate-800">{ct.closing_rank?.toLocaleString('en-IN') || '"'}</td>
                                  <td className="px-3 py-2.5 text-xs text-slate-500">{ct.total_seats || '"'}</td>
                                  <td className="px-3 py-2.5">
                                    <div className="flex items-center gap-1">
                                      <button onClick={() => setEditingCutoff({ ...ct })} className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"><Pencil size={13} /></button>
                                      <button onClick={() => handleDeleteCutoff(ct.id)} className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"><Trash2 size={13} /></button>
                                    </div>
                                  </td>
                                </>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-center py-8 text-slate-400 text-sm">No cutoffs added yet. Add the first one above.</div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer " always visible */}
        {(() => {
          const TABS = ['info', 'branches', 'placements', 'cutoffs'];
          const idx  = TABS.indexOf(tab);
          const isFirst = idx === 0;
          const isLast  = idx === TABS.length - 1;
          return (
            <div className="px-6 py-4 border-t border-slate-100 flex items-center justify-between shrink-0">
              {/* Left: step indicator */}
              <div className="flex items-center gap-1.5">
                {TABS.map((t, i) => (
                  <div key={t} className={`h-1.5 rounded-full transition-all duration-300
                    ${t === tab ? 'w-6' : 'w-1.5'}
                    ${i <= idx ? 'opacity-100' : 'opacity-25'}`}
                    style={{ backgroundColor: 'var(--accent)' }} />
                ))}
              </div>

              {/* Right: buttons */}
              <div className="flex items-center gap-2">
                {/* Cancel / Close */}
                <button onClick={onClose}
                  className="px-4 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
                  {isLast ? 'Close' : 'Cancel'}
                </button>

                {/* Previous */}
                {!isFirst && (
                  <button onClick={() => setTab(TABS[idx - 1])}
                    className="px-4 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50 flex items-center gap-1.5 transition-colors">
                    <ChevronDown size={14} className="rotate-90" /> Prev
                  </button>
                )}

                {/* Save (info tab) / Next / Done */}
                {tab === 'info' ? (
                  <button onClick={handleSaveCollege} disabled={saving}
                    className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 flex items-center gap-1.5 transition-colors"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {saving ? 'Saving…' : collegeSaved ? (editing ? '✓ Update' : '✓ Saved → Next') : (editing ? 'Update College' : 'Save College')}
                    {!saving && !collegeSaved && <ChevronDown size={14} className="-rotate-90" />}
                  </button>
                ) : isLast ? (
                  <button onClick={onClose}
                    className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl flex items-center gap-1.5"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    <Check size={14} /> Done
                  </button>
                ) : (
                  <button onClick={() => collegeSaved && setTab(TABS[idx + 1])}
                    disabled={!collegeSaved}
                    className="px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-40 flex items-center gap-1.5 transition-colors"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    Next <ChevronDown size={14} className="-rotate-90" />
                  </button>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

/* ── College Predictor Modal ──────────────────────────────────────────────── */
function PredictorModal({ onClose }) {
  const [dropdowns, setDropdowns] = useState({ reservation_category: [], exam_type: [], branch_code: [] });
  const [form, setForm] = useState({ rank: '', category: 'OC', exam_type: 'EAMCET', year: CURRENT_YEAR, branch_code: '' });
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  // Fetch dropdown options fresh every time the predictor opens
  useEffect(() => {
    api.get('/auth/masters', { types: 'reservation_category,exam_type,branch_code' })
      .then(({ data }) => {
        if (data.bool && data.response.grouped) {
          setDropdowns({
            reservation_category: data.response.grouped.reservation_category || [],
            exam_type:            data.response.grouped.exam_type            || [],
            branch_code:          data.response.grouped.branch_code          || [],
          });
        }
      })
      .catch(() => {});
  }, []);

  const handlePredict = async () => {
    if (!form.rank) return;
    setLoading(true);
    try {
      const params = { rank: form.rank, category: form.category, exam_type: form.exam_type, year: form.year };
      if (form.branch_code) params.branch_code = form.branch_code;
      const { data } = await api.get('/skovo-platform-panel-admin/cg/predict', params);
      if (data.bool) setResults(data.response.results);
      setSearched(true);
    } catch {}
    finally { setLoading(false); }
  };

  const inputCls = 'w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-2">
            <BarChart2 size={18} style={{ color: 'var(--accent)' }} />
            <h2 className="font-bold text-slate-900">College Predictor</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-4 overflow-y-auto flex-1">
          {/* Inputs */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Rank *</label>
              <input type="number" className={inputCls} placeholder="e.g. 5000" value={form.rank} onChange={e => setForm(f => ({ ...f, rank: e.target.value }))} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <FormSelect searchType="reservation_category"
                value={form.category}
                onChange={v => setForm(f => ({ ...f, category: v }))}
                options={dropdowns.reservation_category.map(o => ({ value: o.value, label: o.label }))}
                clearable={false} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Exam</label>
              <FormSelect searchType="exam_type"
                value={form.exam_type}
                onChange={v => setForm(f => ({ ...f, exam_type: v }))}
                options={dropdowns.exam_type.map(o => ({ value: o.value, label: o.label }))}
                clearable={false} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Branch (opt)</label>
              <FormSelect searchType="branch_code"
                value={form.branch_code}
                onChange={v => setForm(f => ({ ...f, branch_code: v }))}
                options={dropdowns.branch_code.map(o => ({ value: o.value, label: o.label }))}
                placeholder="All Branches" />
            </div>
          </div>

          <button onClick={handlePredict} disabled={loading || !form.rank}
            className="w-full py-3 text-sm font-semibold text-white rounded-xl disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}>
            {loading ? 'Predicting…' : 'Predict Colleges'}
          </button>

          {/* Results */}
          {searched && (
            results.length === 0 ? (
              <div className="text-center py-8 text-slate-400 text-sm">No colleges found for rank {form.rank} in {form.category} category.</div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500">{results.length} college-branch combinations found</p>
                {results.map((r, i) => (
                  <div key={i} className="p-4 rounded-xl border border-slate-200 hover:border-violet-200 hover:bg-violet-50/30 transition-colors">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900 text-sm">{r.college_name}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{r.branch_name || r.branch_code} · {r.exam_type} · {r.category} · {r.year}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-xs font-semibold text-emerald-600">Closing: {r.closing_rank?.toLocaleString('en-IN')}</p>
                        <p className="text-xs text-slate-400">Opening: {r.opening_rank?.toLocaleString('en-IN') || '"'}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-xs">
                      {r.annual_fees_min && <span className="px-2 py-0.5 bg-slate-100 rounded-full">₹{(r.annual_fees_min/100000).toFixed(1)}L–{(r.annual_fees_max/100000).toFixed(1)}L/yr</span>}
                      {r.placement_rate  && <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 rounded-full">{r.placement_rate}% placed</span>}
                      {r.avg_package     && <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded-full">Avg {r.avg_package} LPA</span>}
                      {r.naac_grade      && <span className="px-2 py-0.5 bg-amber-50 text-amber-700 rounded-full">NAAC {r.naac_grade}</span>}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/* ── College Detail (read) Modal ──────────────────────────────────────────── */
function CGCollegeDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const fmtL = (n) => n != null && n !== '' ? `₹${(n / 100000).toFixed(1)}L` : '—';
  const fees = a.annual_fees_min ? `${fmtL(a.annual_fees_min)} – ${fmtL(a.annual_fees_max)}` : '—';
  const rows = [
    { label: 'Name', value: a.name || '—' },
    { label: 'Type', value: a.type || '—' },
    { label: 'Location', value: [a.location_city, a.location_state].filter(Boolean).join(', ') || '—' },
    { label: 'Fees / Yr', value: fees },
    { label: 'Placement', value: a.placement_rate ? `${a.placement_rate}%` : '—' },
    { label: 'Avg Pkg', value: a.avg_package ? `${a.avg_package} LPA` : '—' },
    { label: 'NAAC', value: a.naac_grade || '—' },
    { label: 'NIRF', value: a.nirf_ranking ? `#${a.nirf_ranking}` : '—' },
    { label: 'Cutoffs', value: `${a.cutoff_count ?? 0} rows` },
    { label: 'Website', value: a.website_url || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">College Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">{rows.map(({ label, value }) => (
            <div key={label} className="flex items-start justify-between py-2 border-b border-slate-50 gap-4">
              <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
              <span className="text-sm font-semibold text-slate-800 text-right break-words">{value}</span>
            </div>
          ))}</div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

/* â€â€ Main Page â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€â€ */
export default function AdminCGColleges() {
  const [masters, setMasters] = useState({});
  const opts    = (type) => masters[type] || [];
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [page, setPage]         = useState(1);
  const [pages, setPages]       = useState(1);
  const [total, setTotal]       = useState(0);
  const [search, setSearch]     = useState('');
  const [typeFilter, setType]   = useState('');
  const [modal, setModal]       = useState(null);   // null | 'add' | college-object
  const [predictor, setPredictor] = useState(false);
  const [toast, setToast]       = useState({ msg: '', ok: true });
  const [deleting, setDeleting] = useState(null);
  const [view, setView]         = useState(null);
  const [confirm, setConfirm]   = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast({ msg: '', ok: true }), 3000); };

  const load = useCallback(async (p = 1) => {
    setLoading(true);
    try {
      const params = { page: p, per_page: 20 };
      if (search) params.search = search;
      if (typeFilter) params.type = typeFilter;
      const { data } = await api.get('/skovo-platform-panel-admin/cg/colleges', params);
      if (data.bool) {
        setColleges(data.response.colleges);
        setPage(data.pagination.page);
        setPages(data.pagination.pages);
        setTotal(data.pagination.total);
      }
    } catch {}
    finally { setLoading(false); }
  }, [search, typeFilter]);

  useEffect(() => {
    load(1);
    publicApi.get('/auth/masters', {
      types: 'college_type,indian_state,city,degree_type,branch_code,degree_branch,exam_type,reservation_category,gender'
    }).then(({ data }) => { if (data.bool && data.response.grouped) setMasters(data.response.grouped); })
      .catch(() => {});
  }, [load]);

  const handleDelete = async (c) => {
    setDeleting(c.id);
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/cg/colleges/${c.id}`);
      if (data.bool) { showToast('College deleted.'); load(1); }
      else showToast(data.response?.message || 'Failed.', false);
    } catch { showToast('Connection error.', false); }
    finally { setDeleting(null); }
  };

  const handleSaved = (college) => {
    showToast(college ? 'College saved!' : 'Saved!');
    // In edit mode, refresh the modal prop with the latest saved data.
    // In add mode keep modal='add' so the header stays "Add College" and
    // editing stays false — the wizard uses collegeSaved/savedId instead.
    if (modal !== 'add') setModal(college);
    load(1);
  };

  const fmt = (n) => n != null ? `₹${(n / 100000).toFixed(1)}L` :  '—';

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast.msg} ok={toast.ok} />

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">CG Colleges</h1>
          <p className="text-sm text-slate-500 mt-1">Manage colleges & EAMCET cutoffs for career guidance</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={() => setPredictor(true)}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border border-slate-200 bg-white rounded-xl hover:bg-slate-50">
            <BarChart2 size={15} style={{ color: 'var(--accent)' }} /> Predictor
          </button>
          <button onClick={() => setModal('add')}
            className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white rounded-xl"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Plus size={15} /> Add College
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Colleges', value: total, icon: GraduationCap, color: 'bg-violet-50 text-violet-600' },
          { label: 'With Cutoffs',   value: colleges.filter(c => c.cutoff_count > 0).length, icon: BookOpen, color: 'bg-blue-50 text-blue-600' },
          { label: 'Govt Colleges',  value: colleges.filter(c => c.type === 'government').length, icon: Award, color: 'bg-emerald-50 text-emerald-600' },
          { label: 'Private',        value: colleges.filter(c => c.type === 'private').length, icon: TrendingUp, color: 'bg-amber-50 text-amber-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-3">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}><Icon size={18} /></div>
            <div>
              <p className="text-xl font-black text-slate-900">{value}</p>
              <p className="text-xs text-slate-500 font-medium">{label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Filters */}
      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none"
          placeholder="Search colleges by name…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load(1)}
        />
      </div>

      {/* Type filter pills */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[{ value: '', label: 'All' }, ...opts('college_type')].map(({ value: val, label }) => (
          <button
            key={val}
            onClick={() => { setType(val); }}
            className="px-3.5 py-1.5 rounded-xl text-xs font-semibold border transition-all"
            style={typeFilter === val
              ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }
              : { backgroundColor: 'transparent', borderColor: '#e2e8f0', color: '#64748b' }
            }
            onMouseEnter={e => { if (typeFilter !== val) e.currentTarget.style.borderColor = 'var(--accent)'; }}
            onMouseLeave={e => { if (typeFilter !== val) e.currentTarget.style.borderColor = '#e2e8f0'; }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <TableShell>
        {loading ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <Th>S.No</Th>
                  <Th>College</Th>
                  <Th>Type</Th>
                  <Th>Location</Th>
                  <Th>Fees / Yr</Th>
                  <Th>Placement</Th>
                  <Th>Avg Pkg</Th>
                  <Th>Naac</Th>
                  <Th>Cutoffs</Th>
                  <Th>Actions</Th>
                </tr>
              </thead>
              <LoadingRows cols={10} rows={5} />
            </table>
          </div>
        ) : colleges.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            message="No colleges yet"
            sub='Click "Add College" to get started'
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <Th>S.No</Th>
                    <Th>College</Th>
                    <Th>Type</Th>
                    <Th>Location</Th>
                    <Th>Fees / Yr</Th>
                    <Th>Placement</Th>
                    <Th>Avg Pkg</Th>
                    <Th>Naac</Th>
                    <Th>Cutoffs</Th>
                    <Th>Actions</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {colleges.map((c, idx) => (
                    <tr key={c.id} onClick={() => setView(c)} className="hover:bg-slate-50/60 transition-colors cursor-pointer">
                      <Td className="text-xs text-slate-400 w-10">{(page - 1) * 20 + idx + 1}</Td>
                      <Td>
                        <p className="font-semibold text-slate-900 max-w-52 truncate">{c.name}</p>
                        {c.website_url && <a onClick={e => e.stopPropagation()} href={/^https?:\/\//i.test(c.website_url) ? c.website_url : `https://${c.website_url}`} target="_blank" rel="noreferrer" className="text-xs text-violet-500 hover:underline flex items-center gap-1 mt-0.5"><Globe size={10} /> Website</a>}
                      </Td>
                      <Td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${
                          c.type === 'government' ? 'bg-emerald-50 text-emerald-700' :
                          c.type === 'private'    ? 'bg-blue-50 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>{c.type}</span>
                      </Td>
                      <Td className="text-xs text-slate-600">
                        <div className="flex items-center gap-1"><MapPin size={11} className="text-slate-400" />{c.location_city}{c.location_state ? `, ${c.location_state}` : ''}</div>
                      </Td>
                      <Td className="text-xs text-slate-700">
                        {c.annual_fees_min ? `${fmt(c.annual_fees_min)} – ${fmt(c.annual_fees_max)}` : '—'}
                      </Td>
                      <Td className="text-xs text-slate-700">{c.placement_rate ? `${c.placement_rate}%` : '—'}</Td>
                      <Td className="text-xs font-semibold text-slate-800">{c.avg_package ? `${c.avg_package} LPA` : '—'}</Td>
                      <Td>
                        {c.naac_grade ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">{c.naac_grade}</span>
                        ) : '—'}
                      </Td>
                      <Td>
                        <span className={`px-2.5 py-1 rounded-full text-xs font-semibold ${c.cutoff_count > 0 ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-500'}`}>
                          {c.cutoff_count} rows
                        </span>
                      </Td>
                      <Td onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <ActionBtn icon={Eye} tooltip="View details" onClick={() => setView(c)} color="indigo" />
                          <ActionBtn icon={Pencil} tooltip="Edit college" onClick={() => setModal(c)} color="blue" />
                          <ActionBtn icon={Trash2} tooltip="Delete college" onClick={() => setConfirm(c)} disabled={deleting === c.id} loading={deleting === c.id} color="red" />
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-slate-100">
              {colleges.map(c => (
                <div key={c.id} onClick={() => setView(c)} className="p-4 cursor-pointer">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-slate-900 truncate">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{c.location_city}, {c.location_state}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${c.type === 'government' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{c.type}</span>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                    <div><span className="text-slate-400">Fees: </span><span className="text-slate-700">{c.annual_fees_min ? fmt(c.annual_fees_min) : '—'}</span></div>
                    <div><span className="text-slate-400">Placed: </span><span className="text-slate-700">{c.placement_rate ? `${c.placement_rate}%` : '—'}</span></div>
                    <div><span className="text-slate-400">Cutoffs: </span><span className="font-semibold text-violet-600">{c.cutoff_count}</span></div>
                  </div>
                  <div className="mt-3 flex gap-2" onClick={e => e.stopPropagation()}>
                    <button onClick={() => setModal(c)} className="flex-1 py-1.5 text-xs font-semibold border border-slate-200 rounded-lg hover:bg-slate-50">Edit</button>
                    <button onClick={() => setConfirm(c)} className="flex-1 py-1.5 text-xs font-semibold text-red-600 border border-red-200 rounded-lg hover:bg-red-50">Delete</button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            <Pagination
              page={page}
              pages={pages}
              total={total}
              perPage={20}
              onPage={(p) => load(p)}
            />
          </>
        )}
      </TableShell>

      {/* Modals */}
      {(modal === 'add' || (modal && modal.id)) && (
        <CollegeModal
          college={modal === 'add' ? null : modal}
          onClose={() => { setModal(null); load(1); }}
          onSaved={handleSaved}
          masters={masters} opts={opts}
        />
      )}
      {predictor && <PredictorModal onClose={() => setPredictor(false)} />}
      {view && <CGCollegeDetailModal item={view} onClose={() => setView(null)} onEdit={(c) => setModal(c)} />}
      {confirm && (
        <ConfirmModal
          message={`Delete "${confirm.name}"?`}
          detail="This college and all its cutoffs will be removed. This cannot be undone."
          danger
          confirmLabel="Delete"
          onConfirm={() => { handleDelete(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
