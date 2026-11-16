import React, { useEffect, useState, useCallback } from 'react';
import { superApi } from '../../services/api';
import { GraduationCap, Search, IndianRupee, User, BarChart3, Tag, Users, Calendar, Eye } from 'lucide-react';
import {
  Th, Td, TableShell, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn,
} from '../../components/ui/TableComponents';
import { Modal, Button } from '../../components/ui/index.jsx';

const money = n => (Number(n) === 0 ? 'Free' : `₹${Number(n || 0).toLocaleString('en-IN')}`);

/**
 * One course, in full.
 *
 * Read-only by design: courses are authored and corrected in the admin portal,
 * and this console exists to see the platform rather than to edit it. The panel
 * says so plainly, because a detail view with no buttons otherwise reads as
 * something half-built.
 */
function CourseDetail({ course, onClose }) {
  const rows = [
    { Icon: User,       label: 'Achiever',   value: course.achiever_name || 'Unknown' },
    { Icon: BarChart3,  label: 'Level',      value: course.level || '—' },
    { Icon: Tag,        label: 'Price',      value: money(course.price) },
    { Icon: Users,      label: 'Enrolled',   value: `${course.enrolled} student${course.enrolled === 1 ? '' : 's'}` },
    { Icon: IndianRupee, label: 'Revenue',   value: money(course.revenue) },
    { Icon: Calendar,   label: 'Created',
      value: course.created_at
        ? new Date(course.created_at).toLocaleDateString('en-IN',
            { day: 'numeric', month: 'short', year: 'numeric' })
        : '—' },
  ];

  return (
    <Modal isOpen onClose={onClose} title={course.title}>
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <StatusBadge status={course.status || (course.is_active ? 'active' : 'inactive')} />
          {!course.is_active && (
            <span className="text-xs text-slate-500">Students cannot see this course.</span>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 divide-y divide-slate-100">
          {rows.map(r => (
            <div key={r.label} className="flex items-center gap-3 px-3 py-2.5">
              <r.Icon size={14} className="text-slate-400 shrink-0" />
              <span className="text-xs text-slate-500 w-24 shrink-0">{r.label}</span>
              <span className="text-sm text-slate-800 truncate capitalize">{r.value}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-slate-500">
          Courses are created and edited by admins. This console shows them; it does not change them.
        </p>

        <div className="flex justify-end pt-2 border-t border-slate-100">
          <Button variant="secondary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

export default function SuperCourses() {
  const [courses, setCourses] = useState([]);
  const [pagination, setPagination] = useState({ total: 0, pages: 1, page: 1 });
  const [perPage, setPerPage] = useState(20);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  const load = useCallback((page = 1, q = search, pp = perPage) => {
    setLoading(true);
    const params = { page, per_page: pp };
    if (q) params.search = q;
    superApi.get('/skovo-platform-owner/courses', params)
      .then(({ data }) => {
        if (data.bool) {
          setCourses(data.response.courses || []);
          setPagination(data.pagination || { total: 0, pages: 1, page: 1 });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [search, perPage]);

  useEffect(() => { load(1); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const t = setTimeout(() => load(1, search), 400);
    return () => clearTimeout(t);
  }, [search]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalRevenue = courses.reduce((s, c) => s + (c.revenue || 0), 0);

  return (
    <div className="p-4 sm:p-6">
      {selected && <CourseDetail course={selected} onClose={() => setSelected(null)} />}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Courses</h1>
          <p className="text-sm text-slate-500 mt-1">All achiever courses across the platform</p>
        </div>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search courses…"
            className="pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 w-full sm:w-64"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-4">
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <p className="text-xl font-black text-slate-900">{pagination.total}</p>
          <p className="text-xs text-slate-500">Total Courses</p>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <p className="text-xl font-black text-slate-900">{courses.reduce((s, c) => s + (c.enrolled || 0), 0)}</p>
          <p className="text-xs text-slate-500">Enrollments (this page)</p>
        </div>
        <div className="p-4 rounded-2xl border border-slate-200 bg-white">
          <p className="text-xl font-black text-slate-900">₹{totalRevenue.toLocaleString('en-IN')}</p>
          <p className="text-xs text-slate-500">Revenue (this page)</p>
        </div>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>S.No</Th><Th>Course</Th><Th>Achiever</Th><Th>Level</Th><Th>Price</Th>
                <Th>Enrolled</Th><Th>Revenue</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={8} rows={5} />
            ) : courses.length === 0 ? (
              <tbody><tr><td colSpan={9}><EmptyState icon={GraduationCap} message="No courses yet" /></td></tr></tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {courses.map((c, i) => (
                  <tr key={c.id}
                      onClick={() => setSelected(c)}
                      className={`hover:bg-slate-50 transition-colors cursor-pointer ${!c.is_active ? 'opacity-50' : ''}`}>
                    <Td className="text-slate-400 text-xs">{(pagination.page - 1) * perPage + i + 1}</Td>
                    <Td className="font-medium text-slate-900 max-w-xs truncate">{c.title}</Td>
                    <Td className="text-slate-600 text-xs">{c.achiever_name}</Td>
                    <Td className="text-slate-500 text-xs capitalize">{c.level || '—'}</Td>
                    <Td className="text-slate-600 text-xs">{!Number(c.price) ? 'Free' : `₹${Number(c.price).toLocaleString('en-IN')}`}</Td>
                    <Td className="text-slate-600 text-xs">{c.enrolled}</Td>
                    <Td className="text-emerald-600 text-xs font-semibold flex items-center gap-0.5"><IndianRupee size={10} />{c.revenue.toLocaleString('en-IN')}</Td>
                    <Td><StatusBadge status={c.status || (c.is_active ? 'active' : 'inactive')} /></Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <ActionBtn icon={Eye} tooltip="View course" color="indigo"
                                 onClick={() => setSelected(c)} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        <Pagination
          page={pagination.page}
          pages={pagination.pages}
          total={pagination.total}
          perPage={perPage}
          onPage={(p) => load(p)}
          onPerPage={(pp) => { setPerPage(pp); load(1, search, pp); }}
        />
      </TableShell>
    </div>
  );
}
