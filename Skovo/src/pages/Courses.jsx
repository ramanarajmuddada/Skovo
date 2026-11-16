import React, { useEffect, useState, useCallback } from 'react';
import {
  BookOpen, Search, IndianRupee, Clock, Users, Lock, Play,
  FileText, Radio, Link as LinkIcon, CheckCircle2, X, Loader2,
  GraduationCap, Filter, Award, Circle, Printer, Eye,
} from 'lucide-react';
import { api } from '../services/api';
import { openCheckout, confirmOrder, needsPhone } from '../services/payment';
import { Th, Td, TableShell, LoadingRows, EmptyState, ActionBtn, Avatar, Pagination } from '../components/ui/TableComponents';
import { useMasters } from '../hooks/useMasters';

const LEVEL_BADGE = {
  beginner:     { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: '#10b981' },
  intermediate: { cls: 'bg-amber-50 text-amber-700 border-amber-200',   dot: '#f59e0b' },
  advanced:     { cls: 'bg-red-50 text-red-700 border-red-200',          dot: '#ef4444' },
};
const MODULE_ICON  = { video: Play, text: FileText, live_session: Radio, resource: LinkIcon };
const MODULE_LABEL = { video: 'Video', text: 'Article', live_session: 'Live', resource: 'Resource' };

const CARD_GRADIENTS = [
  'linear-gradient(135deg,#1e3a5f,#0d9488)',
  'linear-gradient(135deg,#3730a3,#7c3aed)',
  'linear-gradient(135deg,#92400e,#d97706)',
  'linear-gradient(135deg,#164e63,#0891b2)',
  'linear-gradient(135deg,#1e1b4b,#4f46e5)',
  'linear-gradient(135deg,#14532d,#16a34a)',
];
const cardGradient = (id) => CARD_GRADIENTS[(id?.charCodeAt(0) || 0) % CARD_GRADIENTS.length];

function Spin() {
  return <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--accent)', borderTopColor: 'transparent' }} />;
}


// ── Certificate Modal ─────────────────────────────────────────────────────────
function CertificateModal({ cert, onClose }) {
  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-700">Certificate of Completion</span>
          <div className="flex items-center gap-2">
            <button onClick={() => window.print()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              <Printer size={13} /> Print / Save PDF
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
              <X size={17} />
            </button>
          </div>
        </div>

        <div id="certificate-print" className="p-8" style={{ background: 'linear-gradient(135deg,#f0fdf4 0%,#ecfdf5 50%,#f0f9ff 100%)' }}>
          <div className="border-4 rounded-2xl p-8 text-center relative" style={{ borderColor: 'var(--accent)' }}>
            <div className="absolute top-3 left-3 w-6 h-6 rounded-full" style={{ backgroundColor: 'var(--accent)', opacity: 0.3 }} />
            <div className="absolute top-3 right-3 w-6 h-6 rounded-full" style={{ backgroundColor: 'var(--accent)', opacity: 0.3 }} />
            <div className="absolute bottom-3 left-3 w-6 h-6 rounded-full" style={{ backgroundColor: 'var(--accent)', opacity: 0.3 }} />
            <div className="absolute bottom-3 right-3 w-6 h-6 rounded-full" style={{ backgroundColor: 'var(--accent)', opacity: 0.3 }} />

            <div className="flex items-center justify-center gap-2 mb-4">
              <div className="w-9 h-9 rounded-xl shadow overflow-hidden shrink-0"><img src="/skovo-logo-blue.jpg" alt="Skovo" className="w-full h-full object-cover" /></div>
              <span className="font-black text-xl text-slate-800 tracking-tight">SKOVO</span>
            </div>

            <Award size={36} className="mx-auto mb-3" style={{ color: 'var(--accent)' }} />
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400 mb-3">Certificate of Completion</p>
            <p className="text-sm text-slate-500 mb-1">This certifies that</p>
            <h2 className="text-3xl font-black text-slate-900 mb-1">{cert.student_name}</h2>
            <p className="text-sm text-slate-500 mb-4">has successfully completed</p>

            <div className="inline-block px-6 py-2 rounded-xl mb-4" style={{ backgroundColor: 'var(--accent)', opacity: 0.9 }}>
              <h3 className="text-lg font-black text-white">{cert.course_title}</h3>
            </div>

            <div className="flex items-center justify-center gap-4 mb-5 text-xs text-slate-500">
              <span className="flex items-center gap-1"><Clock size={11} />{cert.duration_weeks} weeks</span>
              <span className="capitalize px-2 py-0.5 rounded-full border text-[10px] font-semibold" style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}>
                {cert.course_level}
              </span>
            </div>

            <div className="border-t border-slate-200 pt-4">
              <p className="text-xs text-slate-400 mb-0.5">Instructed by</p>
              <p className="font-bold text-slate-700">{cert.achiever_name}</p>
              {(cert.achiever_designation || cert.achiever_company) && (
                <p className="text-xs text-slate-400">
                  {cert.achiever_designation}{cert.achiever_designation && cert.achiever_company ? ' @ ' : ''}{cert.achiever_company}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between mt-5 pt-3 border-t border-slate-200 text-[10px] text-slate-400">
              <span>Issued: {cert.completion_date}</span>
              <span className="font-mono">{cert.certificate_number}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Course Detail Modal ───────────────────────────────────────────────────────
function CourseDetailModal({ course, onClose, onEnrolled }) {
  const [enrolling,   setEnrolling]   = useState(false);
  const [coupon,      setCoupon]      = useState('');
  const [couponInfo,  setCouponInfo]  = useState(null);
  const [phone,       setPhone]       = useState('');
  // Cashfree needs a mobile number and a SKOVO account may not carry one.
  const [needPhone,   setNeedPhone]   = useState(() => needsPhone());
  const [error,       setError]       = useState('');
  const [modules,     setModules]     = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [progress,    setProgress]    = useState(null);
  const [certLoading, setCertLoading] = useState(false);
  const [cert,        setCert]        = useState(null);

  const isEnrolled = course.is_enrolled;

  useEffect(() => {
    api.get(`/courses/${course.id}`)
      .then(({ data }) => { if (data.bool) setModules(data.response.modules || []); })
      .catch(() => {})
      .finally(() => setLoading(false));

    if (isEnrolled) {
      api.get(`/courses/${course.id}/progress`)
        .then(({ data }) => { if (data.bool) setProgress(data.response); })
        .catch(() => {});
    }
  }, [course.id, isEnrolled]);

  const markComplete = async (moduleId) => {
    if (!isEnrolled) return;
    if (progress?.completed_ids?.includes(moduleId)) return;
    try {
      const { data } = await api.post(`/courses/${course.id}/progress`, { module_id: moduleId });
      if (data.bool) setProgress(data.response);
    } catch {}
  };

  const unmarkComplete = async (moduleId) => {
    if (!isEnrolled) return;
    try {
      const { data } = await api.delete(`/courses/${course.id}/progress`, { data: { module_id: moduleId } });
      if (data.bool) setProgress(data.response);
    } catch {}
  };

  const getCertificate = async () => {
    setCertLoading(true);
    try {
      const { data } = await api.get(`/courses/${course.id}/certificate`);
      if (data.bool) setCert(data.response);
      else setError(data.response?.message || 'Could not get certificate.');
    } catch {
      setError('Failed to load certificate.');
    } finally {
      setCertLoading(false);
    }
  };

  const applyCoupon = async () => {
    if (!coupon.trim()) return;
    setCouponInfo(null);
    try {
      const { data } = await api.post('/billing/coupons/validate', {
        code: coupon.trim(), amount: course.effective_price ?? course.price, context_type: 'course',
        context_id: course.id,
      });
      if (data.bool) setCouponInfo({ discount: data.response.discount, final: data.response.final_amount });
      else setCouponInfo({ error: data.response?.message || 'Invalid coupon.' });
    } catch { setCouponInfo({ error: 'Could not validate coupon.' }); }
  };

  const handleEnroll = async () => {
    setEnrolling(true); setError('');
    const couponBody = coupon.trim() ? { coupon_code: coupon.trim() } : {};
    try {
      if (course.price === 0) {
        const { data } = await api.post(`/courses/${course.id}/enroll`);
        if (data.bool) { onEnrolled(course.id); onClose(); }
        else setError(data.response?.message || 'Could not enroll.');
        setEnrolling(false);
        return;
      }

      // Open the order server-side, pay, then ask the server what happened.
      // The webhook is what confirms enrolment — the browser only reports that
      // the widget closed.
      const body = { ...couponBody };
      if (phone) body.phone = phone;

      const { data: opened } = await api.post(`/courses/${course.id}/enroll`, body);
      if (!opened.bool) {
        if (opened.response?.need_phone) {
          setNeedPhone(true);
          setError('Please add a mobile number to continue.');
        } else {
          setError(opened.response?.message || 'Could not start checkout.');
        }
        setEnrolling(false);
        return;
      }

      // A 100%-off coupon enrols outright — nothing to pay for.
      if (!opened.response?.payment_session_id) { onEnrolled(course.id); onClose(); setEnrolling(false); return; }

      const { order_id, payment_session_id, mode } = opened.response;

      try {
        await openCheckout({ paymentSessionId: payment_session_id, mode });
      } catch (e) {
        setError(e.message || 'Could not open the payment window.');
        setEnrolling(false);
        return;
      }

      const outcome = await confirmOrder(api, order_id);
      if (outcome.paid) { onEnrolled(course.id); onClose(); }
      else if (outcome.pending) setError('Payment is still being confirmed. Refresh in a moment.');
      else setError('Payment was not completed.');
      setEnrolling(false);
    } catch { setError('Something went wrong.'); setEnrolling(false); }
  };

  const completedIds = new Set(progress?.completed_ids || []);
  const percent      = progress?.percent || 0;
  const isComplete   = isEnrolled && progress && percent === 100;

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.55)' }}>
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
          {/* Header thumbnail */}
          <div className="relative rounded-t-2xl overflow-hidden shrink-0" style={{ height: 120 }}>
            {course.thumbnail_url ? (
              <img src={course.thumbnail_url} alt={course.title} className="w-full h-full object-cover"
                onError={e => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }} />
            ) : null}
            <div className="w-full h-full absolute inset-0 flex items-center justify-center"
              style={{ background: cardGradient(course.id), display: course.thumbnail_url ? 'none' : 'flex' }}>
              <BookOpen size={40} className="text-white opacity-70" />
            </div>
            <div className="absolute inset-0" style={{ background: 'linear-gradient(to top,rgba(0,0,0,0.6) 0%,transparent 60%)' }} />
            <button onClick={onClose} className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/40 flex items-center justify-center text-white hover:bg-black/60 transition-colors">
              <X size={14} />
            </button>
            <div className="absolute bottom-3 left-4 right-4">
              <h2 className="font-black text-white text-base leading-snug line-clamp-1">{course.title}</h2>
              {course.achiever && (
                <p className="text-white/80 text-xs mt-0.5">{course.achiever.full_name}{course.achiever.company ? ` · ${course.achiever.company}` : ''}</p>
              )}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {/* Meta */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="flex items-center gap-1 text-xs text-slate-500"><Clock size={11} />{course.duration_weeks}w</span>
              {course.level && (
                <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${(LEVEL_BADGE[course.level] || LEVEL_BADGE.beginner).cls}`}>
                  {course.level}
                </span>
              )}
              <span className="flex items-center gap-1 text-xs text-slate-500"><Users size={11} />{course.enrolled_count} students</span>
              <span className="font-bold text-base ml-auto" style={{ color: 'var(--accent)' }}>
                {course.price === 0 ? 'Free' : course.effective_price != null && course.effective_price < course.price
                  ? <span className="flex items-center gap-0.5"><span className="line-through text-slate-400 font-normal mr-1">₹{Number(course.price).toLocaleString()}</span><IndianRupee size={13} />{Number(course.effective_price).toLocaleString()}</span>
                  : <span className="flex items-center gap-0.5"><IndianRupee size={13} />{Number(course.price).toLocaleString()}</span>}
              </span>
            </div>

            {/* Progress bar (enrolled only) */}
            {isEnrolled && progress && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-700">{percent === 100 ? '✅ Course Complete!' : `Progress: ${progress.completed_modules}/${progress.total_modules} modules`}</span>
                  <span className="font-bold" style={{ color: 'var(--accent)' }}>{percent}%</span>
                </div>
                <div className="w-full bg-slate-100 rounded-full h-2">
                  <div className="h-2 rounded-full transition-all duration-500" style={{ width: `${percent}%`, backgroundColor: 'var(--accent)' }} />
                </div>
              </div>
            )}

            {course.description && <p className="text-sm text-slate-600 leading-relaxed">{course.description}</p>}

            {course.what_you_learn?.length > 0 && (
              <div>
                <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">What You&apos;ll Learn</h3>
                <ul className="space-y-1.5">
                  {course.what_you_learn.map((item, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                      <CheckCircle2 size={14} className="text-emerald-500 mt-0.5 shrink-0" />
                      {item}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div>
              <h3 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Course Content</h3>
              {loading ? (
                <div className="flex justify-center py-4"><Spin /></div>
              ) : !modules?.length ? (
                <p className="text-xs text-slate-400">No modules yet.</p>
              ) : (
                <div className="space-y-1.5">
                  {modules.map((m, i) => {
                    const Icon       = MODULE_ICON[m.content_type] || Play;
                    const accessible = m.is_free_preview || isEnrolled;
                    const isDone     = completedIds.has(m.id);

                    const openContent = () => {
                      if (!accessible) return;
                      // Live sessions only open within their window (backend gates the link).
                      if (m.content_type === 'live_session' && m.can_join === false) {
                        alert('This live session is not open yet. The Join link unlocks ~15 minutes before it starts.');
                        return;
                      }
                      const url = m.video_url || m.live_session_url || m.content_text;
                      if (m.content_type === 'text' && m.content_text) {
                        alert(m.content_text);
                      } else if (url) {
                        window.open(url, '_blank', 'noopener,noreferrer');
                      } else if (m.content_type === 'live_session') {
                        // No room is auto-generated; the achiever adds the link.
                        alert('No join link has been added for this session yet. Check back shortly before it starts.');
                      }
                    };

                    return (
                      <div key={m.id}
                        className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all
                          ${accessible ? '' : 'opacity-60'}
                          ${isDone ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white'}`}>
                        <button onClick={openContent} title="Open content"
                          className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-opacity
                            ${accessible ? 'cursor-pointer hover:opacity-80' : 'cursor-default'}
                            ${isDone ? 'bg-emerald-100 text-emerald-600' : m.content_type === 'live_session' ? 'bg-red-50 text-red-500' : 'bg-blue-50 text-blue-500'}`}>
                          {isDone ? <CheckCircle2 size={13} /> : <Icon size={12} />}
                        </button>
                        <div className="flex-1 min-w-0 cursor-pointer" onClick={openContent}>
                          <p className={`text-xs font-semibold truncate ${isDone ? 'text-emerald-700 line-through' : 'text-slate-900'}`}>
                            {i + 1}. {m.title}
                          </p>
                          <p className="text-[10px] text-slate-400">{MODULE_LABEL[m.content_type]}{isDone ? ' · Completed' : accessible ? ' · Click to open' : ''}</p>
                        </div>
                        {!accessible ? (
                          <Lock size={12} className="text-slate-400 shrink-0" />
                        ) : m.is_free_preview && !isEnrolled ? (
                          <span className="text-[10px] px-1.5 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded-full font-semibold">Preview</span>
                        ) : isEnrolled && !isDone ? (
                          <button onClick={() => markComplete(m.id)} title="Mark as complete"
                            className="shrink-0 hover:text-emerald-500 transition-colors text-slate-300">
                            <Circle size={17} />
                          </button>
                        ) : isEnrolled && isDone ? (
                          <button onClick={() => unmarkComplete(m.id)} title="Unmark — I haven't finished this yet"
                            className="shrink-0 text-emerald-500 hover:text-slate-300 transition-colors">
                            <CheckCircle2 size={17} />
                          </button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
              {isEnrolled && modules?.length > 0 && (
                <p className="text-[10px] text-slate-400 mt-2 text-center">Click title to open · click ○ to mark complete · click ✓ to unmark</p>
              )}
            </div>

            {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          </div>

          <div className="px-5 py-4 border-t border-slate-100 shrink-0">
            {isEnrolled ? (
              isComplete ? (
                <button onClick={getCertificate} disabled={certLoading}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-white rounded-xl disabled:opacity-60 transition-all hover:opacity-90"
                  style={{ background: 'linear-gradient(135deg,#059669,#0d9488)' }}>
                  {certLoading ? <Loader2 size={16} className="animate-spin" /> : <Award size={16} />}
                  Get Your Certificate
                </button>
              ) : (
                <div className="flex items-center justify-center gap-2 py-2 text-emerald-700 font-semibold text-sm">
                  <CheckCircle2 size={16} /> Enrolled — complete all modules to get certificate
                </div>
              )
            ) : (
              <div className="space-y-2">
                {course.price > 0 && (
                  <div>
                    <div className="flex gap-2">
                      <input value={coupon} onChange={e => setCoupon(e.target.value.toUpperCase())}
                        placeholder="Coupon code"
                        className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300" />
                      <button type="button" onClick={applyCoupon}
                        className="px-3 py-2 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Apply</button>
                    </div>
                    {couponInfo?.discount != null && <p className="text-xs text-emerald-600 mt-1">−₹{couponInfo.discount} applied · you pay ₹{couponInfo.final}</p>}
                    {couponInfo?.error && <p className="text-xs text-red-500 mt-1">{couponInfo.error}</p>}
                  </div>
                )}
                {course.price > 0 && needPhone && (
                  <div className="mb-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1">
                      Mobile number <span className="text-red-500">*</span>
                    </label>
                    <input
                      value={phone}
                      onChange={e => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                      inputMode="numeric"
                      autoComplete="tel"
                      placeholder="10-digit mobile number"
                      className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"
                    />
                    <p className="text-xs text-slate-400 mt-1">Required by the payment provider for your receipt.</p>
                  </div>
                )}
                <button onClick={handleEnroll} disabled={enrolling}
                  className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-white rounded-xl disabled:opacity-60 transition-all hover:opacity-90"
                  style={{ backgroundColor: 'var(--accent)' }}>
                  {enrolling ? <Loader2 size={16} className="animate-spin" /> : <GraduationCap size={16} />}
                  {course.price === 0 ? 'Enroll for Free'
                    : couponInfo?.final != null ? `Enroll — ₹${Number(couponInfo.final).toLocaleString()}`
                    : `Enroll — ₹${Number(course.effective_price ?? course.price).toLocaleString()}`}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {cert && <CertificateModal cert={cert} onClose={() => setCert(null)} />}
    </>
  );
}

// ── My Courses tab ────────────────────────────────────────────────────────────
function MyCourses() {
  const [courses,     setCourses]     = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [selected,    setSelected]    = useState(null);
  const [progressMap, setProgressMap] = useState({});
  const [page,        setPage]        = useState(1);
  const [perPage,     setPerPage]     = useState(10);

  useEffect(() => {
    api.get('/courses/my')
      .then(({ data }) => {
        if (data.bool) {
          const list = data.response.courses || [];
          setCourses(list);
          list.forEach(c => {
            api.get(`/courses/${c.id}/progress`)
              .then(({ data: pd }) => {
                if (pd.bool) setProgressMap(prev => ({ ...prev, [c.id]: pd.response.percent }));
              }).catch(() => {});
          });
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const total = courses.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const pageItems = courses.slice((page - 1) * perPage, page * perPage);

  return (
    <>
      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Course</Th>
                <Th>Instructor</Th>
                <Th>Progress</Th>
                <Th>Level</Th>
                <Th right>Price</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={7} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pageItems.map((c, idx) => {
                  const pct    = progressMap[c.id] ?? null;
                  const badge  = LEVEL_BADGE[c.level] || LEVEL_BADGE.beginner;
                  return (
                    <tr key={c.id} onClick={() => setSelected(c)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View course details" color="indigo"
                            onClick={() => setSelected(c)} />
                        </div>
                      </Td>
                      <Td>
                        <span className="font-semibold text-slate-900 max-w-xs truncate block">{c.title}</span>
                        {c.category && <span className="text-[10px] text-slate-400">{c.category}</span>}
                      </Td>
                      <Td>
                        {c.achiever && (
                          <div className="flex items-center gap-2">
                            <Avatar name={c.achiever.full_name} size="sm" />
                            <span className="text-xs text-slate-600 truncate max-w-28">{c.achiever.full_name}</span>
                          </div>
                        )}
                      </Td>
                      <Td>
                        {pct !== null ? (
                          <div className="flex items-center gap-2 min-w-24">
                            <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#10b981' : 'var(--accent)' }} />
                            </div>
                            <span className={`text-[10px] font-bold shrink-0 ${pct === 100 ? 'text-emerald-600' : 'text-slate-500'}`}>{pct}%</span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </Td>
                      <Td>
                        {c.level && (
                          <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${badge.cls}`}>
                            {c.level}
                          </span>
                        )}
                      </Td>
                      <Td right>
                        <span className="font-semibold" style={{ color: 'var(--accent)' }}>
                          {c.price === 0 ? 'Free' : c.effective_price != null && c.effective_price < c.price
                            ? <><span className="line-through text-slate-400 font-normal mr-1">₹{Number(c.price).toLocaleString()}</span>₹{Number(c.effective_price).toLocaleString()}</>
                            : `₹${Number(c.price).toLocaleString()}`}
                        </span>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            )}
          </table>
        </div>
        {!loading && total === 0 && (
          <EmptyState icon={BookOpen} message="No enrolled courses yet" sub="Browse courses and enroll to start learning" />
        )}
        {!loading && total > 0 && (
          <Pagination page={page} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
        )}
      </TableShell>

      {selected && (
        <CourseDetailModal
          course={{ ...selected, is_enrolled: true }}
          onClose={() => setSelected(null)}
          onEnrolled={() => {}} />
      )}
    </>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Courses() {
  const { lists } = useMasters(['difficulty_level']);
  const [tab,      setTab]      = useState('browse');
  const [courses,  setCourses]  = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [search,   setSearch]   = useState('');
  const [level,    setLevel]    = useState('all');
  const [selected, setSelected] = useState(null);
  const [enrolled, setEnrolled] = useState(new Set());
  const [page,     setPage]     = useState(1);
  const [perPage,  setPerPage]  = useState(10);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/courses/')
      .then(({ data }) => {
        if (data.bool) {
          const list = data.response.courses || [];
          setCourses(list);
          setEnrolled(new Set(list.filter(c => c.is_enrolled).map(c => c.id)));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = courses.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.title.toLowerCase().includes(q) || (c.category || '').toLowerCase().includes(q) || (c.achiever?.full_name || '').toLowerCase().includes(q);
    const matchLevel  = level === 'all' || c.level === level;
    return matchSearch && matchLevel;
  });

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pages);
  const pageItems = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  const handleEnrolled = (id) => {
    setEnrolled(prev => new Set([...prev, id]));
    setCourses(prev => prev.map(c => c.id === id ? { ...c, is_enrolled: true, enrolled_count: (c.enrolled_count || 0) + 1 } : c));
  };

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-black text-slate-900">Courses</h1>
        <p className="text-sm text-slate-400 mt-0.5">Learn from achievers with structured programs</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {[{ id: 'browse', label: 'Browse Courses' }, { id: 'my', label: 'My Courses' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`px-5 py-2 rounded-lg text-sm font-semibold transition-all ${tab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'my' ? (
        <MyCourses />
      ) : (
        <>
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-xl bg-white outline-none"
                placeholder="Search courses, instructors…" />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter size={13} className="text-slate-400" />
              {['all', ...(lists.difficulty_level || []).map(o => o.value)].map(v => (
                <button key={v} onClick={() => setLevel(v)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all capitalize ${level === v ? 'text-white border-transparent' : 'text-slate-600 border-slate-200 bg-white hover:bg-slate-50'}`}
                  style={level === v ? { backgroundColor: 'var(--accent)', borderColor: 'var(--accent)' } : {}}>
                  {v === 'all' ? 'All Levels' : v}
                </button>
              ))}
            </div>
          </div>

          {/* Browse table */}
          <TableShell>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>S.No</Th>
                    <Th>Actions</Th>
                    <Th>Title</Th>
                    <Th>Instructor</Th>
                    <Th>Level</Th>
                    <Th>Duration</Th>
                    <Th right>Students</Th>
                    <Th right>Price</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                {loading ? <LoadingRows cols={9} rows={6} /> : (
                  <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                    {pageItems.map((c, idx) => {
                      const badge       = LEVEL_BADGE[c.level] || LEVEL_BADGE.beginner;
                      const isEnrolledC = enrolled.has(c.id);
                      return (
                        <tr key={c.id} onClick={() => setSelected(c)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                          <Td><span className="text-xs text-slate-400">{(safePage - 1) * perPage + idx + 1}</span></Td>
                          <Td>
                            <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                              <ActionBtn icon={Eye} tooltip="View course" color="indigo"
                                onClick={() => setSelected(c)} />
                              {!isEnrolledC && (
                                <ActionBtn icon={GraduationCap} tooltip="Enroll" color="green"
                                  onClick={() => setSelected(c)} />
                              )}
                            </div>
                          </Td>
                          <Td>
                            <span className="font-semibold text-slate-900 max-w-xs truncate block">{c.title}</span>
                            {c.category && <span className="text-[10px] text-slate-400">{c.category}</span>}
                          </Td>
                          <Td>
                            {c.achiever && (
                              <div className="flex items-center gap-2">
                                <Avatar name={c.achiever.full_name} size="sm" />
                                <span className="text-xs text-slate-600 truncate max-w-28">{c.achiever.full_name}</span>
                              </div>
                            )}
                          </Td>
                          <Td>
                            {c.level && (
                              <span className={`px-2 py-0.5 rounded-full border text-[10px] font-semibold capitalize ${badge.cls}`}>
                                {c.level}
                              </span>
                            )}
                          </Td>
                          <Td>
                            <span className="text-xs text-slate-500 flex items-center gap-1">
                              <Clock size={11} />{c.duration_weeks}w
                            </span>
                          </Td>
                          <Td right>
                            <span className="text-xs font-semibold text-slate-700 flex items-center justify-end gap-1">
                              <Users size={11} className="text-slate-400" />{c.enrolled_count}
                            </span>
                          </Td>
                          <Td right>
                            <span className="font-bold" style={{ color: 'var(--accent)' }}>
                              {c.price === 0 ? 'Free' : c.effective_price != null && c.effective_price < c.price
                            ? <><span className="line-through text-slate-400 font-normal mr-1">₹{Number(c.price).toLocaleString()}</span>₹{Number(c.effective_price).toLocaleString()}</>
                            : `₹${Number(c.price).toLocaleString()}`}
                            </span>
                          </Td>
                          <Td>
                            {isEnrolledC ? (
                              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full flex items-center gap-1 w-fit">
                                <CheckCircle2 size={10} /> Enrolled
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400">—</span>
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                )}
              </table>
            </div>
            {!loading && total === 0 && (
              <EmptyState icon={BookOpen}
                message={search || level !== 'all' ? 'No courses match your filter' : 'No courses available yet'}
                sub={search || level !== 'all' ? 'Try clearing the search or filter' : 'Check back soon for new courses'} />
            )}
            {!loading && total > 0 && (
              <Pagination page={safePage} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
            )}
          </TableShell>
        </>
      )}

      {selected && (
        <CourseDetailModal
          course={{ ...selected, is_enrolled: enrolled.has(selected.id) }}
          onClose={() => setSelected(null)}
          onEnrolled={handleEnrolled} />
      )}
    </div>
  );
}
