import React, { useEffect, useState, useCallback } from 'react';
import DateTimePicker from '../../components/ui/DateTimePicker';
import {
  BookOpen, Plus, IndianRupee, Users, Clock, Pencil, Trash2,
  X, Loader2, ChevronRight, Video, FileText, Radio, Link as LinkIcon,
  Eye, EyeOff, GripVertical, CheckCircle2, AlertCircle, AlertTriangle, ChevronUp, ChevronDown, Tag,
  Search,
} from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import { achieverApi } from '../../services/api';
import useAudienceOptions from '../../hooks/useAudienceOptions';
import { StatusBadge, EmptyState, TableShell, ConfirmModal } from '../../components/ui/TableComponents';
import { Button, ErrorState, useToast } from '../../components/ui/index.jsx';
import * as schema from '../../schemas/achiever';
import { fieldErrors } from '../../schemas/achiever';
import MultiChip from '../../components/ui/MultiChip';
import AudiencePicker from '../../components/ui/AudiencePicker';
import { FormSelect } from '../../components/ui/index.jsx';
import { usePagedRows } from '../../hooks/usePagedRows';
import { Pagination } from '../../components/ui/TableComponents';
import { useMasters } from '../../hooks/useMasters';
import { toDateTimeLocal } from '../../utils/datetime';

const LEVEL_BADGE = {
  beginner:     'bg-emerald-50 text-emerald-700 border-emerald-200',
  intermediate: 'bg-amber-50 text-amber-700 border-amber-200',
  advanced:     'bg-red-50 text-red-700 border-red-200',
};
const MODULE_TYPE_ICON = { video: Video, text: FileText, live_session: Radio, resource: LinkIcon };
// Labels come from the `course_content_type` master — the icon map stays local
// because an icon is a UI choice, not data an admin should have to maintain.

// ── Spinner ──────────────────────────────────────────────────────────────────
function Spin() {
  return (
    <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin"
      style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />
  );
}

// ── Enrollments Modal ────────────────────────────────────────────────────────
function EnrollmentsModal({ course, onClose }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    achieverApi.get(`/courses/portal/${course.id}/enrollments`)
      .then(({ data: d }) => { if (d.bool) { setData(d.response); setFailed(false); } else setFailed(true); })
      // Swallowed before, so a failed request showed "No enrollments yet" -
      // telling an achiever with paying students that nobody had signed up.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [course.id]);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] sm:max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900">Enrolled Students</h2>
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{course.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-12"><Spin /></div>
          ) : failed ? (
            <ErrorState title="We couldn't load the enrolments"
                        subtitle="Nothing is lost - this is a connection problem."
                        onRetry={load} compact />
          ) : !data || data.total === 0 ? (
            <EmptyState icon={Users} message="No enrollments yet" />
          ) : (
            <>
              <div className="px-6 py-3 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500">{data.total} students enrolled</span>
                <span className="text-xs font-semibold text-emerald-700">Your share: ₹{data.total_earning.toFixed(0)}</span>
              </div>
              {data.enrollments.map((e, i) => (
                <div key={e.enrollment_id} className={`flex items-center gap-3 px-6 py-3.5 ${i < data.enrollments.length - 1 ? 'border-b border-slate-100' : ''}`}>
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-sm font-bold text-white"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {(e.full_name || '?')[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 truncate">{e.full_name}</p>
                    <p className="text-xs text-slate-400 truncate">{e.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs font-semibold text-emerald-700">₹{e.achiever_earning.toFixed(0)}</p>
                    <p className="text-xs text-slate-400">your share</p>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Module Form ───────────────────────────────────────────────────────────────
function ModuleForm({ courseId, module, onSaved, onCancel }) {
  const { lists } = useMasters(['course_content_type']);
  const isEdit = !!module;
  const [form, setForm] = useState({
    title: module?.title || '',
    description: module?.description || '',
    content_type: module?.content_type || 'video',
    video_url: module?.video_url || '',
    content_text: module?.content_text || '',
    // UTC from the API -> local for the input; slicing the ISO string dropped
    // the Z and shifted the session on every save.
    live_session_date: toDateTimeLocal(module?.live_session_date),
    live_session_duration_minutes: module?.live_session_duration || 60,
    is_free_preview: module?.is_free_preview || false,
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const save = async () => {
    // Module form. `achiever_courses.py` imports no field limits at all, so
    // nothing capped these server-side either — see achiever.md §7.3.
    const parsed = schema.courseModule.safeParse(form);
    if (!parsed.success) { setError(Object.values(fieldErrors(parsed))[0]); return; }
    setSaving(true); setError('');
    try {
      const payload = { ...form };
      if (payload.live_session_date) payload.live_session_date = new Date(payload.live_session_date).toISOString();
      const { data } = isEdit
        ? await achieverApi.put(`/courses/portal/${courseId}/modules/${module.id}`, payload)
        : await achieverApi.post(`/courses/portal/${courseId}/modules`, payload);
      if (data.bool) { onSaved(data.response.module); }
      else setError(data.response?.message || 'Failed to save module.');
    } catch { setError('Network error. Please try again.'); }
    finally { setSaving(false); }
  };

  const TypeIcon = MODULE_TYPE_ICON[form.content_type] || Video;

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-4">
      <h3 className="font-bold text-slate-900 text-sm">{isEdit ? 'Edit Module' : 'Add Module'}</h3>

      {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Module Title *</label>
          <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
            placeholder="e.g. Introduction to Java" />
        </div>

        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Content Type</label>
          <div className="flex gap-2 flex-wrap">
            {(lists.course_content_type || []).map(({ value: val, label }) => {
              const Icon = MODULE_TYPE_ICON[val] || Video;
              return (
                <button key={val} onClick={() => setForm(p => ({ ...p, content_type: val }))}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${form.content_type === val ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-50'}`}
                  style={form.content_type === val ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' } : {}}>
                  <Icon size={12} />{label}
                </button>
              );
            })}
          </div>
        </div>

        {form.content_type === 'video' && (
          <div className="col-span-2">
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Video URL (YouTube / Drive)</label>
            <input value={form.video_url} onChange={e => setForm(p => ({ ...p, video_url: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
              placeholder="https://youtube.com/…" />
          </div>
        )}

        {form.content_type === 'text' && (
          <div className="col-span-2">
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Content / Article</label>
            <textarea value={form.content_text} onChange={e => setForm(p => ({ ...p, content_text: e.target.value }))}
              rows={4} className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none"
              placeholder="Write lesson content…" />
          </div>
        )}

        {form.content_type === 'resource' && (
          <div className="col-span-2">
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Resource URL</label>
            <input value={form.video_url} onChange={e => setForm(p => ({ ...p, video_url: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
              placeholder="https://docs.example.com/…" />
          </div>
        )}

        {form.content_type === 'live_session' && (
          <>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Session Date & Time</label>
              <DateTimePicker value={form.live_session_date} onChange={(v) => setForm(p => ({ ...p, live_session_date: v }))} future />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Duration (minutes)</label>
              <input type="number" value={form.live_session_duration_minutes}
                onChange={e => setForm(p => ({ ...p, live_session_duration_minutes: parseInt(e.target.value) || 60 }))}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none" />
            </div>
          </>
        )}

        <div className="col-span-2">
          <label className="text-xs font-semibold text-slate-600 mb-1 block">Description (optional)</label>
          <input value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
            className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
            placeholder="Short description of this module" />
        </div>

        <div className="col-span-2 flex items-center gap-2">
          <input type="checkbox" id="free_preview" checked={form.is_free_preview}
            onChange={e => setForm(p => ({ ...p, is_free_preview: e.target.checked }))}
            className="rounded" />
          <label htmlFor="free_preview" className="text-xs text-slate-600">Mark as free preview (visible before enrollment)</label>
        </div>
      </div>

      <div className="flex gap-2 justify-end pt-1">
        <button onClick={onCancel} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
          Cancel
        </button>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-60"
          style={{ backgroundColor: 'var(--accent)' }}>
          {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {isEdit ? 'Update Module' : 'Add Module'}
        </button>
      </div>
    </div>
  );
}

// ── Audience targeting constants ──────────────────────────────────────────────



// ── Course Form Modal ─────────────────────────────────────────────────────────
// 10% not 10.0%, but 12.5% keeps its half.
const pctLabel = (ratio) => {
  const pct = ratio * 100;
  return `${Number(pct.toFixed(2)) % 1 === 0 ? pct.toFixed(0) : pct.toFixed(1)}%`;
};

function CourseModal({ course, onClose, onSaved, commissionRate }) {
  const { lists } = useMasters(['difficulty_level']);
  const isEdit = !!course;
  const [form, setForm] = useState({
    title:           course?.title || '',
    description:     course?.description || '',
    thumbnail_url:   course?.thumbnail_url || '',
    price:           course?.price ?? 0,
    duration_weeks:  course?.duration_weeks ?? 4,
    level:           course?.level || 'beginner',
    category:        course?.category || '',
    what_you_learn:  (course?.what_you_learn || []).join('\n'),
    requirements:    (course?.requirements || []).join('\n'),
    target_categories:   course?.target_categories   || [],
    target_streams:      course?.target_streams       || [],
    target_degree_cats:  course?.target_degree_cats   || [],
    target_exam_targets: course?.target_exam_targets  || [],
    target_prof_courses: course?.target_prof_courses  || [],
    target_years:        course?.target_years         || [],
    target_degrees:      course?.target_degrees       || [],
    target_branches:     course?.target_branches      || [],
  });
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  const save = async () => {
    // Course form. Adds the price floor and the level/category ceilings the
    // one-line title check never covered.
    const parsed = schema.course.safeParse(form);
    if (!parsed.success) { setError(Object.values(fieldErrors(parsed))[0]); return; }
    setSaving(true); setError('');
    try {
      const payload = {
        ...form,
        price:           parseInt(form.price) || 0,
        duration_weeks:  parseInt(form.duration_weeks) || 4,
        what_you_learn:      form.what_you_learn.split('\n').map(s => s.trim()).filter(Boolean),
        requirements:        form.requirements.split('\n').map(s => s.trim()).filter(Boolean),
        target_categories:   form.target_categories,
        target_streams:      form.target_streams,
        target_degree_cats:  form.target_degree_cats,
        target_exam_targets: form.target_exam_targets,
        target_prof_courses: form.target_prof_courses,
        target_years:        form.target_years,
        target_degrees:      form.target_degrees,
        target_branches:     form.target_branches,
      };
      const { data } = isEdit
        ? await achieverApi.put(`/courses/portal/${course.id}`, payload)
        : await achieverApi.post('/courses/portal/', payload);
      if (data.bool) { onSaved(data.response.course_id); }
      else setError(data.response?.message || 'Failed to save.');
    } catch { setError('Network error. Please try again.'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">{isEdit ? 'Edit Course' : 'Create New Course'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Course Title *</label>
            <input value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
              placeholder="e.g. Java Full Stack Bootcamp" />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Description</label>
            <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              rows={3} className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none"
              placeholder="What is this course about?" />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Price (₹)</label>
              <input type="number" value={form.price} onChange={e => setForm(p => ({ ...p, price: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
                placeholder="0 for free" min="0" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Duration (weeks)</label>
              <input type="number" value={form.duration_weeks} onChange={e => setForm(p => ({ ...p, duration_weeks: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
                min="1" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Level</label>
              <FormSelect searchType="difficulty_level"
                value={form.level}
                onChange={v => setForm(p => ({ ...p, level: v }))}
                options={lists.difficulty_level || []}
                clearable={false}
                className="w-full" />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-600 mb-1 block">Category</label>
              <input value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}
                className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
                placeholder="e.g. Java Full Stack" />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Thumbnail URL (optional)</label>
            <input value={form.thumbnail_url} onChange={e => setForm(p => ({ ...p, thumbnail_url: e.target.value }))}
              className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none"
              placeholder="https://youtu.be/…" />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">What Students Will Learn (one per line)</label>
            <textarea value={form.what_you_learn} onChange={e => setForm(p => ({ ...p, what_you_learn: e.target.value }))}
              rows={3} className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none"
              placeholder={"Build REST APIs with Spring Boot\nConnect React frontend to backend\nDeploy to AWS"} />
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-600 mb-1 block">Prerequisites / Requirements (one per line)</label>
            <textarea value={form.requirements} onChange={e => setForm(p => ({ ...p, requirements: e.target.value }))}
              rows={2} className="w-full text-sm border border-slate-200 rounded-xl px-3 py-2 outline-none resize-none"
              placeholder={"Basic Java knowledge\nHTML/CSS basics"} />
          </div>

          <AudiencePicker form={form} noun="course"
            onChange={(k, v) => setForm(p => ({ ...p, [k]: v }))} />

            {/* The rate comes from the API. It was 30/70 typed in here, which
                was wrong the moment the platform default moved and was never
                right for an achiever on a negotiated rate. Hidden while it
                loads rather than showing a guessed split. */}
            {parseInt(form.price) > 0 && commissionRate != null && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-xs text-amber-700">
                Platform fee: {pctLabel(commissionRate)} (₹{Math.round(parseInt(form.price) * commissionRate)}) &nbsp;|&nbsp;
                Your earning: {pctLabel(1 - commissionRate)} (₹{parseInt(form.price) - Math.round(parseInt(form.price) * commissionRate)}) per enrollment
              </div>
            )}
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-semibold text-white rounded-xl transition-all disabled:opacity-60"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
            {isEdit ? 'Save Changes' : 'Create Course'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Course Modules Panel ──────────────────────────────────────────────────────
function CourseModulesPanel({ course, onClose }) {
  // Same master the editor above uses, so the label a module is created with is
  // the label it is listed under.
  const { lists } = useMasters(['course_content_type']);
  const typeLabel = (v) =>
    (lists.course_content_type || []).find(o => o.value === v)?.label || v;
  const [modules,     setModules]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showForm,    setShowForm]    = useState(false);
  const [editModule,  setEditModule]  = useState(null);
  const [deleting,    setDeleting]    = useState(null);
  const [failed,      setFailed]      = useState(false);
  const [confirmDel,  setConfirmDel]  = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    achieverApi.get(`/courses/portal/${course.id}/modules`)
      .then(({ data }) => {
        if (data.bool) { setModules(data.response.modules || []); setFailed(false); }
        else setFailed(true);
      })
      // Swallowed before: a failed load showed an empty module list, which
      // reads as "this course has no content" on a course that does.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [course.id]);

  useEffect(() => { load(); }, [load]);

  const handleSaved = () => { setShowForm(false); setEditModule(null); load(); };

  const deleteModule = async (mid) => {
    setConfirmDel(null);
    setDeleting(mid);
    try {
      // The response was never read, so a rejected delete still removed the
      // module from the list until the panel was reopened.
      const { data } = await achieverApi.delete(`/courses/portal/${course.id}/modules/${mid}`);
      if (data.bool) {
        setModules(p => p.filter(m => m.id !== mid));
        toast.success('Module removed');
      } else {
        toast.error(data.response?.message || "Couldn't remove that module.");
      }
    } catch {
      toast.error('Connection problem - the module was not removed.');
    } finally { setDeleting(null); }
  };

  const [reordering, setReordering] = useState(false);
  const moveModule = async (index, dir) => {
    const target = index + dir;
    if (target < 0 || target >= modules.length || reordering) return;
    setReordering(true);
    const a = modules[index], b = modules[target];
    const aOrder = a.order_index ?? index;
    const bOrder = b.order_index ?? target;
    try {
      // Two writes, no transaction. If the second fails the pair is left
      // sharing one order_index, so put the first back before giving up -
      // silently swallowing this left the list in a state the achiever could
      // see but not explain.
      await achieverApi.put(`/courses/portal/${course.id}/modules/${a.id}`, { order_index: bOrder });
      try {
        await achieverApi.put(`/courses/portal/${course.id}/modules/${b.id}`, { order_index: aOrder });
      } catch (inner) {
        await achieverApi.put(`/courses/portal/${course.id}/modules/${a.id}`, { order_index: aOrder })
          .catch(() => {});          // best effort - `load()` below shows the truth either way
        throw inner;
      }
      load();
    } catch {
      toast.error("Couldn't reorder the modules.");
      load();                        // re-read rather than trust local state
    } finally { setReordering(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,0.45)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] sm:max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <div>
            <h2 className="font-bold text-slate-900">Course Modules</h2>
            <p className="text-xs text-slate-400 mt-0.5 line-clamp-1">{course.title}</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <X size={18} />
          </button>
        </div>

        {confirmDel && (
          <ConfirmModal
            danger
            message={`Remove "${confirmDel.title}"?`}
            detail="Students lose access to this module immediately. Adding it back means re-entering its content."
            confirmLabel="Remove module"
            onCancel={() => setConfirmDel(null)}
            onConfirm={() => deleteModule(confirmDel.id)}
          />
        )}

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-3">
          {loading ? (
            <div className="flex justify-center py-8"><Spin /></div>
          ) : failed ? (
            <ErrorState title="We couldn't load the modules"
                        subtitle="Your course content is safe - this is a connection problem."
                        onRetry={load} compact />
          ) : (
            <>
              {modules.map((m, mi) => {
                const Icon = MODULE_TYPE_ICON[m.content_type] || Video;
                return (
                  <div key={m.id} className="flex items-start gap-3 bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <div className="flex flex-col shrink-0 mt-0.5">
                      <button aria-label="Move up" onClick={() => moveModule(mi, -1)} disabled={mi === 0 || reordering}
                        title="Move up"
                        className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-default transition-colors">
                        <ChevronUp size={14} />
                      </button>
                      <button aria-label="Move down" onClick={() => moveModule(mi, 1)} disabled={mi === modules.length - 1 || reordering}
                        title="Move down"
                        className="text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-default transition-colors">
                        <ChevronDown size={14} />
                      </button>
                    </div>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.content_type === 'live_session' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'}`}>
                      <Icon size={14} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-slate-900 truncate">{m.title}</p>
                        {m.is_free_preview && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full font-semibold">FREE</span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">{typeLabel(m.content_type)}{m.content_type === 'live_session' && m.live_session_date ? ` · ${new Date(m.live_session_date).toLocaleDateString()}` : ''}</p>
                      {m.live_session_url && (
                        <a href={m.live_session_url} target="_blank" rel="noreferrer"
                          className="text-xs text-blue-600 underline mt-0.5 block truncate">{m.live_session_url}</a>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => { setEditModule(m); setShowForm(true); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200 transition-colors">
                        <Pencil size={13} />
                      </button>
                      <button onClick={() => setConfirmDel(m)} disabled={deleting === m.id}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                        {deleting === m.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                      </button>
                    </div>
                  </div>
                );
              })}

              {!loading && modules.length < (course.duration_weeks || 0) && (
                <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                  <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                  <p className="text-xs text-amber-700 font-medium">
                    This course is <strong>{course.duration_weeks} weeks</strong> long but only has <strong>{modules.length}</strong> module{modules.length !== 1 ? 's' : ''}.
                    Consider adding more content to match the advertised duration. Students earn their certificate once they complete every published module.
                  </p>
                </div>
              )}

              {!showForm && (
                <button onClick={() => { setEditModule(null); setShowForm(true); }}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-400 hover:border-accent hover:text-accent transition-all text-sm font-medium">
                  <Plus size={16} /> Add Module
                </button>
              )}

              {showForm && (
                <ModuleForm courseId={course.id} module={editModule}
                  onSaved={handleSaved} onCancel={() => { setShowForm(false); setEditModule(null); }} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

const CARD_GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#0d9488)',
  'linear-gradient(135deg,#3730a3,#7c3aed)',
  'linear-gradient(135deg,#92400e,#d97706)',
  'linear-gradient(135deg,#164e63,#0891b2)',
  'linear-gradient(135deg,#1e1b4b,#4f46e5)',
  'linear-gradient(135deg,#14532d,#16a34a)',
];
const cardGradient = (id) => CARD_GRADIENTS[(id?.charCodeAt(0) || 0) % CARD_GRADIENTS.length];

// ── Course Card ───────────────────────────────────────────────────────────────
function CourseOfferModal({ course, onClose, onSaved }) {
  const [f, setF] = useState({
    offer_percent: course.offer_percent ?? '',
    offer_price: course.offer_price ?? '',
    offer_label: course.offer_label ?? '',
    offer_starts_at: (course.offer_starts_at || '').slice(0, 10),
    offer_ends_at: (course.offer_ends_at || '').slice(0, 10),
  });
  const [saving, setSaving] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const base = Number(course.price) || 0;
  const eff = f.offer_price !== '' && f.offer_price != null ? Math.round(Number(f.offer_price))
    : (f.offer_percent !== '' && Number(f.offer_percent) > 0 ? Math.round(base * (100 - Number(f.offer_percent)) / 100) : base);
  const save = async (clear = false) => {
    setSaving(true);
    try {
      const body = clear ? {} : {
        offer_percent: f.offer_percent === '' ? null : Number(f.offer_percent),
        offer_price: f.offer_price === '' ? null : Number(f.offer_price),
        offer_label: f.offer_label || null,
        offer_starts_at: f.offer_starts_at || null,
        offer_ends_at: f.offer_ends_at || null,
      };
      const { data } = await achieverApi.put(`/courses/portal/${course.id}/offer`, body);
      if (data.bool) onSaved();
    } finally { setSaving(false); }
  };
  const cls = 'w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-400';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-bold text-slate-900 flex items-center gap-2"><Tag size={16} /> Offer — {course.title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-slate-600">% off</label>
            <input type="number" min={0} max={100} value={f.offer_percent} onChange={(e) => set('offer_percent', e.target.value)} placeholder="e.g. 40" className={cls} /></div>
          <div><label className="text-xs font-semibold text-slate-600">…or fixed price (₹)</label>
            <input type="number" min={0} value={f.offer_price} onChange={(e) => set('offer_price', e.target.value)} placeholder="e.g. 149" className={cls} /></div>
        </div>
        <div><label className="text-xs font-semibold text-slate-600">Offer label</label>
          <input value={f.offer_label} onChange={(e) => set('offer_label', e.target.value)} placeholder="e.g. Launch offer" className={cls} /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs font-semibold text-slate-600">Starts (optional)</label>
            <input type="date" value={f.offer_starts_at} onChange={(e) => set('offer_starts_at', e.target.value)} className={cls} /></div>
          <div><label className="text-xs font-semibold text-slate-600">Ends (optional)</label>
            <input type="date" value={f.offer_ends_at} onChange={(e) => set('offer_ends_at', e.target.value)} className={cls} /></div>
        </div>
        <div className="text-sm bg-slate-50 rounded-xl px-3 py-2">
          Students pay: {eff < base && <span className="line-through text-slate-400 mr-1">₹{base.toLocaleString('en-IN')}</span>}
          <span className="font-black text-slate-900">₹{eff.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex gap-2 pt-1">
          <button onClick={() => save(true)} disabled={saving} className="px-4 py-2 text-sm font-semibold text-slate-600 hover:bg-slate-100 rounded-xl">Clear offer</button>
          <button onClick={() => save(false)} disabled={saving} className="flex-1 py-2 bg-purple-600 text-white text-sm font-bold rounded-xl hover:bg-purple-700 disabled:opacity-50">{saving ? 'Saving…' : 'Save offer'}</button>
        </div>
      </div>
    </div>
  );
}

function CourseCard({ course, onEdit, onModules, onEnrollments, onTogglePublish, onDelete, onOffer }) {
  const [toggling,  setToggling]  = useState(false);
  const [imgFailed, setImgFailed] = useState(false);

  const toggle = async () => {
    setToggling(true);
    await onTogglePublish(course.id);
    setToggling(false);
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden hover:shadow-md transition-shadow">
      <div className="relative" style={{ height: 140 }}>
        {course.thumbnail_url && !imgFailed ? (
          <img src={course.thumbnail_url} alt={course.title}
            onError={() => setImgFailed(true)}
            className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center"
            style={{ background: cardGradient(course.id) }}>
            <BookOpen size={40} className="text-white opacity-70" />
          </div>
        )}
        <div className="absolute top-2.5 right-2.5">
          <StatusBadge status={course.status} />
        </div>
      </div>
      <div className="p-5 space-y-3">
        <h3 className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{course.title}</h3>

        {course.category && (
          <p className="text-xs text-slate-400">{course.category}</p>
        )}

        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="flex items-center gap-1"><Clock size={11} />{course.duration_weeks}w</span>
          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${LEVEL_BADGE[course.level]}`}>{course.level}</span>
          <span className="flex items-center gap-1 ml-auto font-semibold text-slate-700">
            {!Number(course.price) ? 'Free'
              : course.effective_price != null && course.effective_price < course.price
                ? <><span className="line-through text-slate-400 font-normal">₹{Number(course.price).toLocaleString()}</span><IndianRupee size={11} />{Number(course.effective_price).toLocaleString()}</>
                : <><IndianRupee size={11} />{Number(course.price).toLocaleString()}</>}
          </span>
        </div>

        <div className="flex items-center gap-1 pt-1">
          <button onClick={() => onEnrollments(course)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
            <Users size={12} />{course.enrolled_count || 0}
          </button>
          <button onClick={() => onModules(course)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 bg-slate-50 border border-slate-200 rounded-lg hover:bg-slate-100 transition-colors">
            <BookOpen size={12} />Modules
          </button>
          <button onClick={() => onOffer(course)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-600 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100 transition-colors">
            <Tag size={12} />Offer
          </button>
          <button onClick={() => onEdit(course)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors ml-auto">
            <Pencil size={13} />
          </button>
          <button aria-label={course.status === 'published' ? 'Unpublish' : 'Publish'} onClick={toggle} disabled={toggling}
            className={`p-1.5 rounded-lg transition-colors ${toggling ? 'opacity-50' : 'hover:bg-slate-100'}`}
            title={course.status === 'published' ? 'Unpublish' : 'Publish'}>
            {toggling ? <Loader2 size={13} className="animate-spin text-slate-400" /> :
              course.status === 'published' ? <EyeOff size={13} className="text-slate-500" /> :
                <Eye size={13} className="text-emerald-600" />}
          </button>
          <button aria-label="Archive course" onClick={() => onDelete(course)} title="Archive course"
            className="relative p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors before:absolute before:-inset-2 before:content-['']">
            <Trash2 size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
const COURSE_STATUS_OPTIONS = [
  { value: 'all',       label: 'All courses' },
  { value: 'published', label: 'Published' },
  { value: 'draft',     label: 'Draft' },
];

export default function AchieverCourses() {
  // The real rate, fetched once by the layout — never a literal here.
  const { commissionRate } = useOutletContext() || {};
  const [courses,      setCourses]      = useState([]);
  const [loading,      setLoading]      = useState(true);
  const [failed,       setFailed]       = useState(false);
  const [q,            setQ]            = useState('');
  const [status,       setStatus]       = useState('all');
  const [earned,       setEarned]       = useState(null);
  const [showCreate,   setShowCreate]   = useState(false);
  const [editCourse,   setEditCourse]   = useState(null);
  const [modulesCourse, setModulesCourse] = useState(null);
  const [enrollCourse, setEnrollCourse] = useState(null);
  const [offerCourse, setOfferCourse] = useState(null);
  const [confirmArchive, setConfirmArchive] = useState(null);
  const toast = useToast();

  const load = useCallback(() => {
    setLoading(true);
    achieverApi.get('/courses/portal/')
      .then(({ data }) => {
        if (data.bool) { setCourses(data.response.courses || []); setFailed(false); }
        else setFailed(true);
      })
      // `.catch(() => {})` used to leave the list empty, so an outage rendered
      // as "No courses yet" next to a button inviting you to create your first.
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  // The earnings tile used to read `enrolled_count * price * 0.70` — a number
  // computed in the browser from a list price and a hardcoded fee, which
  // ignored free seats, discounted `effective_price`, coupons and refunds. It
  // also contradicted the "Your share" figure the enrolments modal on this same
  // screen already showed. This is the real one: the platform's own sum of
  // `course_enrollments.achiever_earning`, from the endpoint the Bookings
  // screen reads. Null until it answers — an absent number is not zero.
  useEffect(() => {
    achieverApi.get('/courses/portal/purchases')
      .then(({ data }) => { if (data.bool) setEarned(data.response.total_earning ?? null); })
      .catch(() => setEarned(null));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleTogglePublish = async (courseId) => {
    // No else and no catch before this: a failed publish left the eye icon
    // springing back with nothing said, and the achiever had no way to know
    // whether their course was live.
    try {
      const { data } = await achieverApi.post(`/courses/portal/${courseId}/publish`);
      if (data.bool) {
        setCourses(prev => prev.map(c => c.id === courseId ? { ...c, status: data.response.status } : c));
        toast.success(data.response.status === 'published' ? 'Course published' : 'Course moved to draft');
      } else {
        toast.error(data.response?.message || "Couldn't change the course status.");
      }
    } catch {
      toast.error('Connection problem — nothing was changed.');
    }
  };

  const handleDelete = async (courseId) => {
    setConfirmArchive(null);
    // The old version never read the response, so a failed archive still made
    // the card vanish until the next reload.
    try {
      const { data } = await achieverApi.delete(`/courses/portal/${courseId}`);
      if (data.bool) {
        setCourses(prev => prev.filter(c => c.id !== courseId));
        toast.success('Course archived');
      } else {
        toast.error(data.response?.message || "Couldn't archive that course.");
      }
    } catch {
      toast.error('Connection problem — the course was not archived.');
    }
  };

  const handleSaved = () => {
    setShowCreate(false);
    setEditCourse(null);
    load();
  };

  const published = courses.filter(c => c.status === 'published').length;

  const term = q.trim().toLowerCase();
  const visible = courses.filter(c => {
    if (status !== 'all' && c.status !== status) return false;
    if (!term) return true;
    return [c.title, c.category, c.level].some(v => (v || '').toLowerCase().includes(term));
  });
  const paged = usePagedRows(visible);

  return (
    <div className="space-y-6">
      {/* Header. Stacked below `sm` — the title and the action were a fixed
          justify-between row, so they collided on a phone. */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-slate-900">My Courses</h1>
          <p className="text-sm text-slate-400 mt-0.5">Launch your own multi-week learning programs</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)} className="shrink-0">
          <Plus size={16} /> New Course
        </Button>
      </div>

      {/* Stats */}
      {courses.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {[
            { label: 'Total Courses', value: courses.length, icon: BookOpen, color: 'text-blue-600 bg-blue-50' },
            { label: 'Published',     value: published,      icon: Eye,      color: 'text-emerald-600 bg-emerald-50' },
            {
              label: 'Course earnings',
              // Real money, from course_enrollments.achiever_earning. Dashes
              // until the endpoint answers rather than asserting ₹0.
              value: earned === null ? null : `₹${Math.round(earned).toLocaleString('en-IN')}`,
              icon: IndianRupee, color: 'text-amber-600 bg-amber-50',
            },
          ].map(({ label, value, icon: Icon, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-slate-200 p-4">
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${color}`}>
                <Icon size={15} />
              </div>
              <p className={`text-xl font-black ${value === null ? 'text-slate-300' : 'text-slate-900'}`}>
                {value === null ? '—' : value}
              </p>
              <p className="text-xs text-slate-400">{label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + status. There was no way to find one course among twenty,
          and no way to see only the drafts. */}
      {courses.length > 0 && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-3">
          <div className="relative w-full sm:flex-1 sm:min-w-56">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            <input value={q} onChange={(e) => setQ(e.target.value)}
                   placeholder="Search by title, category or level…"
                   className="w-full text-sm bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-2.5
                              focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500" />
          </div>
          <div className="w-full sm:w-44 sm:shrink-0">
            <FormSelect value={status} onChange={setStatus}
                        options={COURSE_STATUS_OPTIONS} clearable={false} />
          </div>
        </div>
      )}

      {/* Course Grid */}
      {loading ? (
        /* Loading skeleton — card grid placeholders */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-slate-200 overflow-hidden animate-pulse">
              <div className="h-36 bg-slate-100" />
              <div className="p-5 space-y-3">
                <div className="h-4 bg-slate-100 rounded w-3/4" />
                <div className="h-3 bg-slate-100 rounded w-1/2" />
                <div className="flex gap-2">
                  <div className="h-6 bg-slate-100 rounded-full w-16" />
                  <div className="h-6 bg-slate-100 rounded-full w-20" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : failed ? (
        /* An outage is not an empty shelf. "No courses yet" beside a Create
           First Course button is the opposite of what actually happened. */
        <TableShell>
          <ErrorState
            title="We couldn't load your courses"
            subtitle="Your courses are safe — this is a connection problem."
            onRetry={load}
          />
        </TableShell>
      ) : courses.length === 0 ? (
        <TableShell>
          <div className="py-4">
            <EmptyState
              icon={BookOpen}
              message="No courses yet"
              sub="Launch your first course and start earning"
            />
            <div className="flex justify-center pb-6">
              <button onClick={() => setShowCreate(true)}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl"
                style={{ backgroundColor: 'var(--accent)' }}>
                <Plus size={16} /> Create First Course
              </button>
            </div>
          </div>
        </TableShell>
      ) : visible.length === 0 ? (
        /* Filtered to nothing. Offer a way back, not an invitation to create
           another course they may already have. */
        <TableShell>
          <div className="py-4">
            <EmptyState icon={Search} message="No courses match these filters"
                        sub="Try a different search, or clear the filters." />
            <div className="flex justify-center pb-6">
              <button onClick={() => { setQ(''); setStatus('all'); }}
                className="px-5 py-2.5 text-sm font-semibold rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50">
                Clear filters
              </button>
            </div>
          </div>
        </TableShell>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-4">
          {paged.rows.map(c => (
            <CourseCard key={c.id} course={c}
              onEdit={setEditCourse}
              onModules={setModulesCourse}
              onEnrollments={setEnrollCourse}
              onTogglePublish={handleTogglePublish}
              onOffer={setOfferCourse}
              onDelete={setConfirmArchive} />
          ))}
        </div>
      )}
      {visible.length > 0 && !failed && (
        <div className="mt-4 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <Pagination {...paged.bind} />
        </div>
      )}

      {/* Archiving is not reversible from this screen, and enrolled students
          keep their access - a browser confirm() said none of that. */}
      {confirmArchive && (
        <ConfirmModal
          danger
          message={`Archive "${confirmArchive.title}"?`}
          detail="It stops appearing to new students. Anyone already enrolled keeps their access. You cannot undo this here."
          confirmLabel="Archive course"
          onCancel={() => setConfirmArchive(null)}
          onConfirm={() => handleDelete(confirmArchive.id)}
        />
      )}

      {/* Modals */}
      {(showCreate || editCourse) && (
        <CourseModal course={editCourse} onClose={() => { setShowCreate(false); setEditCourse(null); }}
                     onSaved={handleSaved} commissionRate={commissionRate} />
      )}
      {modulesCourse && <CourseModulesPanel course={modulesCourse} onClose={() => setModulesCourse(null)} />}
      {enrollCourse  && <EnrollmentsModal  course={enrollCourse}  onClose={() => setEnrollCourse(null)} />}
      {offerCourse   && <CourseOfferModal course={offerCourse} onClose={() => setOfferCourse(null)} onSaved={() => { setOfferCourse(null); load(); }} />}
    </div>
  );
}
