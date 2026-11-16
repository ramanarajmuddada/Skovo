import React, { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, Search, IndianRupee, Users, Eye, EyeOff,
  Loader2, ChevronRight, ChevronLeft, Wallet, TrendingUp,
  ToggleLeft, ToggleRight, GraduationCap, Clock, Tag,
} from 'lucide-react';
import { adminApi } from '../../services/api';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';
import { ConfirmModal } from '../../components/ui/TableComponents';

const STATUS_BADGE = {
  published: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  draft:     'bg-amber-50 text-amber-600 border-amber-200',
  archived:  'bg-red-50 text-red-500 border-red-200',
};
const LEVEL_BADGE = {
  beginner:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-amber-50 text-amber-700 border-amber-200',
  advanced:     'bg-red-50 text-red-700 border-red-200',
};
const STATUS_ICON = {
  published: '🟢',
  draft:     '🟡',
  archived:  '🔴',
};

function Tooltip({ text, children }) {
  return (
    <span className="relative group inline-flex">
      {children}
      <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50
        whitespace-nowrap rounded-lg bg-slate-800 text-white text-[11px] font-medium px-2.5 py-1
        hidden group-hover:block shadow-lg">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-slate-800" />
      </span>
    </span>
  );
}

export default function AdminCourses() {
  const { lists } = useMasters(['course_status']);
  const [courses,  setCourses]  = useState([]);
  const [total,    setTotal]    = useState(0);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [status,   setStatus]   = useState('');
  const [page,     setPage]     = useState(1);
  const [toggling, setToggling] = useState(null);
  const [confirmDlg, setConfirmDlg] = useState(null);
  const PER_PAGE = 20;

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page, per_page: PER_PAGE });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    adminApi.get(`/skovo-platform-panel-admin/courses?${params}`)
      .then(({ data }) => {
        if (data.bool) { setCourses(data.response.courses || []); setTotal(data.response.total || 0); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [page, search, status]);

  useEffect(() => { load(); }, [load]);

  // Publishing or hiding a course changes what every student sees. The row is
  // one of many and the control is a small icon, so name the course before
  // acting on it.
  const confirmToggle = (c) => {
    const hiding = c.is_active;
    setConfirmDlg({
      message: `${hiding ? 'Hide' : 'Publish'} "${c.title}"?`,
      detail: hiding
        ? 'Students will no longer see this course. Anyone already enrolled keeps their access.'
        : 'This course becomes visible to students immediately.',
      confirmLabel: hiding ? 'Hide course' : 'Publish',
      danger: hiding,
      onConfirm: () => toggleStatus(c.id),
    });
  };

  const toggleStatus = async (id) => {
    setToggling(id);
    try {
      const { data } = await adminApi.post(`/skovo-platform-panel-admin/courses/${id}/toggle-status`);
      if (data.bool) {
        setCourses(prev => prev.map(c => c.id === id ? { ...c, is_active: data.response.is_active, status: data.response.status } : c));
      }
    } catch {} finally { setToggling(null); }
  };

  const pages = Math.ceil(total / PER_PAGE);

  const totalRevenue  = courses.reduce((s, c) => s + (c.total_revenue || 0), 0);
  const platformRev   = courses.reduce((s, c) => s + (c.platform_revenue || 0), 0);
  const totalEnrolled = courses.reduce((s, c) => s + (c.enrolled_count || 0), 0);

  const STATS = [
    {
      label: 'Total Courses',
      value: total,
      icon: BookOpen,
      color: 'bg-blue-50 text-blue-600',
      tooltip: 'All courses created by achievers on the platform',
    },
    {
      label: 'Total Enrollments',
      value: totalEnrolled,
      icon: Users,
      color: 'bg-emerald-50 text-emerald-600',
      tooltip: 'Students who paid or got free access to courses',
    },
    {
      label: 'Total Revenue',
      value: `₹${Math.round(totalRevenue).toLocaleString('en-IN')}`,
      icon: TrendingUp,
      color: 'bg-amber-50 text-amber-600',
      tooltip: 'Total amount collected from all course enrollments',
    },
    {
      label: 'Platform Earnings',
      value: `₹${Math.round(platformRev).toLocaleString('en-IN')}`,
      icon: Wallet,
      color: 'bg-violet-50 text-violet-600',
      tooltip: "SKOVO's share of course revenue. The rate is set per achiever.",
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-6">
      {confirmDlg && (
        <ConfirmModal
          message={confirmDlg.message} detail={confirmDlg.detail}
          confirmLabel={confirmDlg.confirmLabel} danger={confirmDlg.danger}
          onConfirm={() => { confirmDlg.onConfirm(); setConfirmDlg(null); }}
          onCancel={() => setConfirmDlg(null)}
        />
      )}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Achiever Courses</h1>
          <p className="text-sm text-slate-400 mt-0.5">All courses launched by achievers across the platform</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {STATS.map(({ label, value, icon: Icon, color, tooltip }) => (
          <Tooltip key={label} text={tooltip}>
            <div className="bg-white rounded-2xl border border-slate-200 p-4 w-full cursor-default hover:shadow-sm transition-shadow">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${color}`}>
                <Icon size={15} />
              </div>
              <p className="text-xl font-black text-slate-900">{value}</p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          </Tooltip>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white outline-none focus:ring-2 focus:ring-indigo-300"
            placeholder="Search by title or category…" />
        </div>
        <FormSelect searchType="course_status"
          className="sm:w-48 shrink-0"
          value={status}
          onChange={v => { setStatus(v); setPage(1); }}
          options={lists.course_status || []}
          placeholder="All Status" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <div className="w-6 h-6 border-2 border-t-transparent border-indigo-500 rounded-full animate-spin" />
          </div>
        ) : courses.length === 0 ? (
          <div className="flex flex-col items-center py-16 text-slate-400">
            <BookOpen size={28} className="mb-2 text-slate-300" />
            <p className="font-semibold text-slate-600">No courses found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50 text-xs text-slate-500 uppercase tracking-wider">
                  <th className="text-left px-5 py-3 font-semibold">
                    <Tooltip text="Course title, category and difficulty level">
                      <span className="cursor-default">Course</span>
                    </Tooltip>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold">
                    <Tooltip text="The achiever (mentor) who created this course">
                      <span className="cursor-default">Achiever</span>
                    </Tooltip>
                  </th>
                  <th className="text-left px-4 py-3 font-semibold">
                    <Tooltip text="Published = visible to students · Draft = not yet live · Archived = hidden">
                      <span className="cursor-default">Status</span>
                    </Tooltip>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">
                    <Tooltip text="Enrollment price in INR. 'Free' means ₹0">
                      <span className="cursor-default">Price</span>
                    </Tooltip>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">
                    <Tooltip text="Number of students who paid or got free access">
                      <span className="cursor-default">Enrolled</span>
                    </Tooltip>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">
                    <Tooltip text="Total revenue collected from enrollments (100%)">
                      <span className="cursor-default">Revenue</span>
                    </Tooltip>
                  </th>
                  <th className="text-right px-4 py-3 font-semibold">
                    <Tooltip text="SKOVO's earnings. The commission rate is set per achiever.">
                      <span className="cursor-default">Platform</span>
                    </Tooltip>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold">
                    <Tooltip text="Actions you can take on this course">
                      <span className="cursor-default">Actions</span>
                    </Tooltip>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {courses.map(c => (
                  <tr key={c.id} className={`hover:bg-slate-50 transition-colors ${!c.is_active ? 'opacity-60' : ''}`}>
                    <td className="px-5 py-3">
                      <p className="font-semibold text-slate-900 max-w-xs truncate">{c.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {c.category && (
                          <span className="flex items-center gap-1 text-xs text-slate-400">
                            <Tag size={10} />{c.category}
                          </span>
                        )}
                        {c.level && (
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold capitalize ${LEVEL_BADGE[c.level] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                            {c.level}
                          </span>
                        )}
                        {c.duration_weeks && (
                          <span className="flex items-center gap-1 text-[10px] text-slate-400">
                            <Clock size={10} />{c.duration_weeks}w
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-400 to-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {c.achiever?.full_name?.[0]?.toUpperCase() || '?'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-slate-700 truncate max-w-[110px]">{c.achiever?.full_name}</p>
                          <p className="text-xs text-slate-400 truncate max-w-[110px]">{c.achiever?.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1 rounded-full border font-semibold capitalize ${STATUS_BADGE[c.status] || 'bg-slate-100 text-slate-500 border-slate-200'}`}>
                        <span className="text-[8px]">{STATUS_ICON[c.status] || '⚪'}</span>
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-slate-900">
                        {!Number(c.price) ? <span className="text-emerald-600 font-bold">Free</span> : `₹${Number(c.price).toLocaleString('en-IN')}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold text-slate-900">{c.enrolled_count}</span>
                    </td>
                    <td className="px-4 py-3 text-right text-emerald-700 font-semibold">
                      ₹{Number(c.total_revenue || 0).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right text-violet-700 font-semibold">
                      ₹{c.platform_revenue.toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        <Tooltip text={c.is_active ? 'Course is visible to students — click to hide' : 'Course is hidden — click to make visible'}>
                          <button
                            onClick={() => confirmToggle(c)}
                            disabled={toggling === c.id}
                            className={`p-1.5 rounded-lg transition-colors disabled:opacity-40 ${
                              c.is_active
                                ? 'text-emerald-500 hover:text-red-600 hover:bg-red-50'
                                : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                            }`}>
                            {toggling === c.id
                              ? <Loader2 size={15} className="animate-spin" />
                              : c.is_active
                                ? <ToggleRight size={18} />
                                : <ToggleLeft size={18} />
                            }
                          </button>
                        </Tooltip>
                        <Tooltip text={c.is_active ? 'Visible to students' : 'Hidden from students'}>
                          <span className={`p-1.5 rounded-lg ${c.is_active ? 'text-emerald-400' : 'text-slate-300'}`}>
                            {c.is_active ? <Eye size={15} /> : <EyeOff size={15} />}
                          </span>
                        </Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-slate-100 bg-slate-50 text-xs text-slate-500">
            <span>{total} total courses</span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition-colors">
                <ChevronLeft size={14} />
              </button>
              <span className="px-2 font-semibold">{page} / {pages}</span>
              <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
                className="p-1.5 rounded-lg hover:bg-slate-200 disabled:opacity-40 transition-colors">
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
