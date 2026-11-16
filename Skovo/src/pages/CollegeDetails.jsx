import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, invalidateGetCache } from '../services/api';
import { Card, Badge, Button, StudentPage, Textarea } from '../components/ui/index.jsx';
import { LoadError } from '../components/ui/TableComponents';
import ProUpgradeBanner, { TakeProLink } from '../components/ProUpgradeBanner.jsx';
import { fieldErrors, collegeReview } from '../schemas/student';
import { MapPin, Trophy, Briefcase, IndianRupee, Globe, ArrowLeft, BookOpen, Star, BadgeCheck, Plus, X, Loader2, Award, Lock, ExternalLink, Crown, Bookmark, BookmarkCheck, Building2 } from 'lucide-react';

const TYPE_COLOR = {
  government: 'emerald',
  private: 'blue',
  deemed: 'purple',
  autonomous: 'orange',
};

/* ── Scholarships ─────────────────────────────────────────────────────────
   A college page that lists fees but not the money available to pay them is
   half a decision. The backend matches `cg_scholarships` to this college's
   state and the student's reservation category; Skovo Pro sees every match,
   free members see the first two and a count of the rest — a locked section
   with real numbers behind it, not an empty one. */

const MODE_LABEL = {
  merit: 'Merit', need_based: 'Need-based', merit_cum_need: 'Merit + need',
  sports: 'Sports', disability: 'Disability',
};

const inr = (n) => {
  const v = Number(n || 0);
  if (!v) return null;
  if (v >= 100000) return `₹${(v / 100000).toFixed(v % 100000 ? 1 : 0)}L`;
  return `₹${v.toLocaleString('en-IN')}`;
};

function ScholarshipCard({ s }) {
  const amount = inr(s.benefit_amount);
  return (
    <div className="border border-slate-100 rounded-xl p-4 bg-slate-50">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-slate-900 leading-snug">{s.name}</p>
          {s.provider && <p className="text-xs text-slate-500 mt-0.5">{s.provider}</p>}
        </div>
        {amount && (
          <span className="text-sm font-black text-emerald-700 shrink-0">
            {amount}
            {s.benefit_type === 'stipend' && <span className="text-[10px] font-semibold">/yr</span>}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-2.5">
        {s.scheme_type && <Badge color="slate" size="xs">{s.scheme_type}</Badge>}
        {s.mode && <Badge color="purple" size="xs">{MODE_LABEL[s.mode] || s.mode}</Badge>}
        {s.for_state && <Badge color="blue" size="xs">{s.for_state}</Badge>}
        {s.benefit_type === 'full_fees' && <Badge color="emerald" size="xs">Full fees</Badge>}
      </div>

      {s.income_limit ? (
        <p className="text-xs text-slate-500 mt-2">
          Family income up to <span className="font-semibold text-slate-700">{inr(s.income_limit)}</span>/yr
        </p>
      ) : null}
      {s.eligibility_criteria && (
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed line-clamp-3">{s.eligibility_criteria}</p>
      )}
      {s.application_deadline_info && (
        <p className="text-xs text-amber-700 mt-1.5 font-medium">{s.application_deadline_info}</p>
      )}
      {(s.application_url || s.notification_pdf_url) && (
        <a href={s.application_url || s.notification_pdf_url} target="_blank" rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:underline mt-2.5">
          {s.application_url ? 'Apply' : 'Notification'} <ExternalLink size={11} />
        </a>
      )}
    </div>
  );
}

function Scholarships({ data }) {
  // No matches at all is not a lock — showing an upgrade prompt over an empty
  // set would sell Pro on data that does not exist for this college.
  if (!data || (!data.total && !data.items?.length)) return null;

  return (
    <Card className="p-6 mb-4">
      <div className="flex items-center justify-between gap-3 mb-4">
        <h2 className="font-bold text-slate-900 flex items-center gap-2">
          <Award size={16} className="text-emerald-600" /> Scholarships you may qualify for
        </h2>
        <span className="text-xs text-slate-400">{data.total} matched</span>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {data.items.map((s) => <ScholarshipCard key={s.id} s={s} />)}
      </div>

      {data.locked && (
        <div className="mt-4 rounded-2xl border px-4 py-4"
          style={{
            borderColor: 'color-mix(in srgb, var(--accent) 35%, transparent)',
            background: 'color-mix(in srgb, var(--accent) 10%, transparent)',
          }}>
          <div className="flex items-start gap-3">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'color-mix(in srgb, var(--accent) 18%, transparent)' }}>
              <Lock size={15} style={{ color: 'var(--accent)' }} />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-slate-900">
                {data.hidden} more scholarship{data.hidden === 1 ? '' : 's'} matched to your profile
              </p>
              <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                {data.upgrade?.benefit}
              </p>
              <Link to={data.upgrade?.cta_route || '/skovo-pro'}
                className="inline-flex items-center justify-center gap-1.5 mt-3 min-h-11 px-4 rounded-xl text-sm font-bold text-white"
                style={{ backgroundColor: 'var(--accent)' }}>
                <Crown size={14} /> {data.upgrade?.cta_label || 'See what Pro includes'}
              </Link>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
}

function StatCell({ label, value, icon: Icon }) {
  return (
    <div className="flex flex-col items-center text-center py-2">
      <Icon size={16} className="text-slate-400 mb-1" />
      <p className="font-bold text-slate-900 text-sm">{value}</p>
      <p className="text-xs text-slate-500 mt-0.5">{label}</p>
    </div>
  );
}

function StarRating({ value, max = 5, size = 14 }) {
  return (
    <div className="flex items-center gap-0.5">
      {Array.from({ length: max }).map((_, i) => (
        <Star key={i} size={size} className={i < Math.round(value) ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200 dark:fill-slate-600 dark:text-slate-600'} />
      ))}
    </div>
  );
}

function StarPicker({ value, onChange }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex items-center gap-1">
      {[1,2,3,4,5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(n)}>
          <Star size={22} className={(hovered || value) >= n ? 'fill-amber-400 text-amber-400' : 'fill-slate-200 text-slate-200 dark:fill-slate-600 dark:text-slate-600'} />
        </button>
      ))}
      {value > 0 && <span className="ml-1 text-sm font-semibold text-slate-600">{value}/5</span>}
    </div>
  );
}

const SUB_RATINGS = [
  { key: 'academics_rating',  label: 'Academics' },
  { key: 'placement_rating',  label: 'Placements' },
  { key: 'facilities_rating', label: 'Facilities' },
  { key: 'campus_life_rating',label: 'Campus Life' },
];

function ReviewCard({ review, currentUserId, onDeleted }) {
  const [deleting, setDeleting] = useState(false);
  const isOwn = review.user_id === currentUserId;

  const handleDelete = async () => {
    if (!window.confirm('Delete your review?')) return;
    setDeleting(true);
    try {
      await api.delete(`/college-reviews/${review.college_id}/${review.id}`);
      onDeleted();
    } finally { setDeleting(false); }
  };

  return (
    <div className="p-5 border-b border-slate-100 last:border-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}>
            {review.author_name?.[0]?.toUpperCase() || '?'}
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-semibold text-slate-900">{review.author_name}</p>
              {review.is_verified && (
                <span className="flex items-center gap-0.5 text-xs text-emerald-600 font-semibold">
                  <BadgeCheck size={13} /> Verified
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">{review.created_at ? new Date(review.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <StarRating value={review.rating} size={13} />
          {isOwn && (
            <button onClick={handleDelete} disabled={deleting}
              className="p-1 text-slate-300 hover:text-red-500 transition-colors disabled:opacity-50">
              {deleting ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
            </button>
          )}
        </div>
      </div>

      {review.review_text && (
        <p className="mt-3 text-sm text-slate-600 leading-relaxed">{review.review_text}</p>
      )}

      {(review.pros || review.cons) && (
        <div className="mt-3 grid grid-cols-2 gap-3">
          {review.pros && (
            <div className="px-3 py-2 bg-emerald-50 rounded-xl">
              <p className="text-xs font-bold text-emerald-700 mb-0.5">Pros</p>
              <p className="text-xs text-emerald-600">{review.pros}</p>
            </div>
          )}
          {review.cons && (
            <div className="px-3 py-2 bg-red-50 rounded-xl">
              <p className="text-xs font-bold text-red-600 mb-0.5">Cons</p>
              <p className="text-xs text-red-500">{review.cons}</p>
            </div>
          )}
        </div>
      )}

      {SUB_RATINGS.some(r => review[r.key]) && (
        <div className="mt-3 flex flex-wrap gap-3">
          {SUB_RATINGS.filter(r => review[r.key]).map(r => (
            <div key={r.key} className="flex items-center gap-1.5">
              <span className="text-xs text-slate-500">{r.label}</span>
              <StarRating value={review[r.key]} size={11} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WriteReviewModal({ collegeId, onClose, onSubmitted }) {
  const EMPTY = { rating: 0, academics_rating: 0, placement_rating: 0, facilities_rating: 0, campus_life_rating: 0, review_text: '', pros: '', cons: '' };
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState({});
  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrs(e => ({ ...e, [k]: undefined })); };

  const submit = async (e) => {
    e?.preventDefault?.();
    const parsed = collegeReview.safeParse({
      rating: form.rating,
      review_text: form.review_text || '',
      pros: form.pros || '',
      cons: form.cons || '',
    });
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setError('');
      return;
    }
    setSaving(true); setError(''); setErrs({});
    try {
      const payload = { ...form, rating: parsed.data.rating };
      SUB_RATINGS.forEach(r => { if (!payload[r.key]) delete payload[r.key]; });
      if (!payload.review_text) delete payload.review_text;
      if (!payload.pros) delete payload.pros;
      if (!payload.cons) delete payload.cons;
      const { data } = await api.post(`/college-reviews/${collegeId}`, payload);
      if (data.bool) { onSubmitted(); onClose(); }
      else setError(data.response?.message || 'Could not submit that review.');
    } catch (err) {
      setError(err?.response?.data?.response?.message || 'Could not submit that review.');
    }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <form onSubmit={submit} noValidate
        className="relative bg-white shadow-2xl w-full max-w-lg overflow-hidden flex flex-col
                   h-[100dvh] max-h-[100dvh] rounded-none sm:h-auto sm:max-h-[90vh] sm:rounded-2xl"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900">Write a Review</h2>
          <button type="button" onClick={onClose} aria-label="Close"
            className="min-h-11 min-w-11 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-2">Overall Rating *</label>
            <StarPicker value={form.rating} onChange={v => sf('rating', v)} />
            {errs.rating && <p className="text-xs text-red-600 mt-1.5">{errs.rating}</p>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {SUB_RATINGS.map(r => (
              <div key={r.key}>
                <label className="block text-xs font-semibold text-slate-500 mb-1.5">{r.label}</label>
                <StarPicker value={form[r.key]} onChange={v => sf(r.key, v)} />
              </div>
            ))}
          </div>

          <Textarea label="Your Review" value={form.review_text}
            onChange={e => sf('review_text', e.target.value)} rows={4}
            placeholder="Share your experience at this college…"
            error={errs.review_text} />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Textarea label="Pros" value={form.pros}
              onChange={e => sf('pros', e.target.value)} rows={3}
              placeholder="What's great about it?"
              error={errs.pros} />
            <Textarea label="Cons" value={form.cons}
              onChange={e => sf('cons', e.target.value)} rows={3}
              placeholder="What could be better?"
              error={errs.cons} />
          </div>

          {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 px-4 py-3 rounded-xl">{error}</p>}
        </div>

        <div className="px-4 sm:px-6 py-4 border-t border-slate-100 flex flex-col-reverse sm:flex-row justify-end gap-3 shrink-0"
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
          <button type="button" onClick={onClose}
            className="min-h-11 px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={saving}
            className="min-h-11 flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-semibold text-white rounded-xl disabled:opacity-50 hover:opacity-90 transition-all"
            style={{ backgroundColor: 'var(--accent)' }}>
            {saving ? <><Loader2 size={14} className="animate-spin" /> Submitting…</> : 'Submit Review'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function CollegeDetails() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [college, setCollege] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reviews, setReviews] = useState([]);
  const [avgRating, setAvgRating] = useState(0);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [saveQuota, setSaveQuota] = useState(null);

  const userId = (() => { try { return JSON.parse(atob((localStorage.getItem('access_token') || '').split('.')[1] || 'e30=')).sub; } catch { return null; } })();

  const loadReviews = useCallback(() => {
    api.get(`/college-reviews/${id}`)
      .then(({ data }) => {
        if (data.bool) { setReviews(data.response.reviews || []); setAvgRating(data.response.avg_rating || 0); }
      })
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    setLoading(true); setError('');
    api.get(`/colleges/${id}`)
      .then(({ data }) => {
        if (data.bool) setCollege(data.response);
        else setError(data.response?.message || 'College not found.');
      })
      .catch(() => setError('Could not load this college. Check your connection and try again.'))
      .finally(() => setLoading(false));
    loadReviews();
    api.getCached('/colleges/saved', undefined, { ttl: 60000 })
      .then(({ data }) => {
        if (!data.bool) return;
        const res = data.response || {};
        setSaved((res.colleges || []).some((c) => c.id === id));
        setSaveQuota({
          is_pro: !!res.is_pro,
          limit: res.limit ?? null,
          remaining: res.remaining ?? null,
          total: res.total ?? (res.colleges || []).length,
        });
      })
      .catch(() => {});
  }, [id, loadReviews]);

  const toggleSave = async () => {
    if (saving) return;
    setSaving(true); setSaveMsg('');
    try {
      if (saved) {
        const { data } = await api.delete(`/colleges/${id}/save`);
        if (data.bool) setSaved(false);
      } else {
        const { data } = await api.post(`/colleges/${id}/save`, {});
        if (data.bool) setSaved(true);
        else {
          const r = data.response || {};
          setSaveMsg(r.message || 'Could not save that college.');
          if (r.requires_pro && r.upgrade) {
            setSaveQuota((q) => ({
              ...(q || {}),
              is_pro: false,
              limit: r.upgrade.limit ?? q?.limit,
              total: r.upgrade.used ?? q?.total,
              remaining: 0,
            }));
          }
        }
      }
    } catch {
      setSaveMsg('Could not update your saved list.');
    } finally {
      setSaving(false);
      invalidateGetCache('/colleges/saved');
    }
  };

  if (loading) {
    return (
      <StudentPage className="space-y-4 animate-pulse">
        <div className="h-5 bg-slate-100 rounded w-32" />
        <div className="h-48 bg-slate-100 rounded-2xl" />
        <div className="h-32 bg-slate-100 rounded-2xl" />
      </StudentPage>
    );
  }

  if (error) {
    return (
      <StudentPage>
        <button
          onClick={() => navigate('/colleges')}
          className="flex items-center gap-1.5 min-h-11 text-sm text-slate-500 hover:text-slate-800 mb-4 transition-colors font-medium"
        >
          <ArrowLeft size={15} /> Back to Colleges
        </button>
        <LoadError what="this college" message={error} onRetry={() => {
          setLoading(true); setError('');
          api.get(`/colleges/${id}`)
            .then(({ data }) => {
              if (data.bool) setCollege(data.response);
              else setError(data.response?.message || 'College not found.');
            })
            .catch(() => setError('Could not load this college. Check your connection and try again.'))
            .finally(() => setLoading(false));
        }} />
      </StudentPage>
    );
  }

  return (
    <StudentPage>
      <button
        onClick={() => navigate('/colleges')}
        className="flex items-center gap-1.5 min-h-11 text-sm text-slate-500 hover:text-slate-800 mb-6 transition-colors font-medium"
      >
        <ArrowLeft size={15} /> Back to Colleges
      </button>

      {saveQuota && !saveQuota.is_pro && saveQuota.limit != null && (
        <div className="mb-4">
          <ProUpgradeBanner
            used={saveQuota.total}
            limit={saveQuota.limit}
            noun={saveQuota.limit === 1 ? 'college' : 'colleges'}
            extra="Skovo Pro saves unlimited colleges and unlocks full scholarship matches."
          />
        </div>
      )}
      {saveMsg && (
        <div className="mb-4 flex items-start gap-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl px-4 py-3 text-sm">
          <Lock size={16} className="mt-0.5 shrink-0 text-amber-500" />
          <p className="flex-1">{saveMsg} <TakeProLink>Take Skovo Pro</TakeProLink></p>
        </div>
      )}

      {/* Header card */}
      <Card className="p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <Badge color={TYPE_COLOR[college.type] || 'slate'} size="xs">{college.type}</Badge>
            <h1 className="text-xl font-bold text-slate-900 mt-2 leading-tight">{college.name}</h1>
            <div className="flex items-center gap-1.5 text-sm text-slate-500 mt-1 flex-wrap">
              <MapPin size={13} />
              {[college.location_city, college.location_state].filter(Boolean).join(', ')}
              {college.established_year ? <span>· Est. {college.established_year}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {college.logo_url && (
              <img src={college.logo_url} alt="" className="w-16 h-16 object-contain rounded-2xl border border-slate-100 hidden sm:block" />
            )}
            <Button variant={saved ? 'secondary' : 'primary'} onClick={toggleSave} disabled={saving}>
              {saved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-6 pt-6 border-t border-slate-100">
          <StatCell label="NIRF Ranking" value={college.nirf_ranking ? `#${college.nirf_ranking}` : 'N/A'} icon={Trophy} />
          <StatCell label="Placement Rate" value={college.placement_rate ? `${college.placement_rate}%` : 'N/A'} icon={Briefcase} />
          <StatCell label="Avg Package" value={college.avg_package ? `₹${college.avg_package}L` : 'N/A'} icon={IndianRupee} />
          <StatCell label="NAAC Grade" value={college.naac_grade || 'N/A'} icon={BookOpen} />
        </div>

        <div className="flex flex-wrap gap-4 mt-4 pt-4 border-t border-slate-100 text-sm text-slate-600">
          {(college.annual_fees_min || college.annual_fees_max) && (
            <span>
              <span className="font-semibold text-slate-800">Fees: </span>
              ₹{((college.annual_fees_min || 0) / 1000).toFixed(0)}K – ₹{((college.annual_fees_max || 0) / 1000).toFixed(0)}K / yr
            </span>
          )}
          {college.highest_package && (
            <span>
              <span className="font-semibold text-slate-800">Highest: </span>
              ₹{college.highest_package} LPA
            </span>
          )}
          {college.website_url && (
            <a href={college.website_url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1 font-medium min-h-11"
              style={{ color: 'var(--accent)' }}>
              <Globe size={13} /> Official Website
            </a>
          )}
        </div>
      </Card>

      {college.about && (
        <Card className="p-6 mb-4">
          <h2 className="font-bold text-slate-900 mb-3">About</h2>
          <p className="text-sm text-slate-600 leading-relaxed">{college.about}</p>
        </Card>
      )}

      {(college.facilities?.length > 0 || college.top_recruiters?.length > 0 || college.entrance_exams_accepted?.length > 0) && (
        <Card className="p-6 mb-4">
          {college.facilities?.length > 0 && (
            <div className="mb-4 last:mb-0">
              <h2 className="font-bold text-slate-900 mb-3">Facilities</h2>
              <div className="flex flex-wrap gap-2">
                {college.facilities.map((f) => (
                  <span key={f} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-100">{f}</span>
                ))}
              </div>
            </div>
          )}
          {college.entrance_exams_accepted?.length > 0 && (
            <div className="mb-4 last:mb-0">
              <h2 className="font-bold text-slate-900 mb-3">Entrance exams</h2>
              <div className="flex flex-wrap gap-2">
                {college.entrance_exams_accepted.map((e) => (
                  <span key={e} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-100">{e}</span>
                ))}
              </div>
            </div>
          )}
          {college.top_recruiters?.length > 0 && (
            <div>
              <h2 className="font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Building2 size={15} className="text-slate-400" /> Top recruiters
              </h2>
              <div className="flex flex-wrap gap-2">
                {college.top_recruiters.map((r) => (
                  <span key={r} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-50 text-slate-600 border border-slate-100">{r}</span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Courses */}
      {college.courses?.length > 0 && (
        <Card className="p-6 mb-4">
          <h2 className="font-bold text-slate-900 mb-4">Courses Offered</h2>
          <div className="grid sm:grid-cols-2 gap-3">
            {college.courses.map((c) => (
              <div key={c.id || c.name} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl border border-slate-100">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{c.name || c}</p>
                  {c.duration && <p className="text-xs text-slate-500 mt-0.5">{c.duration} yrs · {c.degree}</p>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Scholarships — the Skovo Pro half of a college profile */}
      <Scholarships data={college.scholarships} />

      {/* Placement trends */}
      {college.placement_insights?.length > 0 && (
        <Card className="p-6 mb-4">
          <h2 className="font-bold text-slate-900 mb-4">Placement Trends</h2>
          {/* Four columns of numbers do not fit 360px, so below `md` each year
              becomes its own block and the table is hidden. Not ResponsiveTable
              here: that wraps its table in TableShell, whose own white card and
              border would nest inside the Card this section already sits in.
              Same rule, local markup — the two branches read the same rows. */}
          <div className="md:hidden space-y-2.5">
            {college.placement_insights.map((pi) => (
              <div key={pi.year} className="rounded-xl border border-slate-100 p-3">
                <p className="font-semibold text-slate-900 text-sm">{pi.year}</p>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 mt-2.5 pt-2.5 border-t border-slate-100">
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Placement %</dt>
                    <dd className="text-sm text-slate-700">{pi.placement_rate ? `${pi.placement_rate}%` : '—'}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Avg Package</dt>
                    <dd className="text-sm text-slate-700">{pi.avg_package ? `₹${pi.avg_package} LPA` : '—'}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-[11px] uppercase tracking-wide text-slate-400">Highest Package</dt>
                    <dd className="text-sm text-slate-700">{pi.highest_package ? `₹${pi.highest_package} LPA` : '—'}</dd>
                  </div>
                </dl>
              </div>
            ))}
          </div>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-3 font-semibold">Year</th>
                  <th className="pb-3 font-semibold">Placement %</th>
                  <th className="pb-3 font-semibold">Avg Package</th>
                  <th className="pb-3 font-semibold">Highest Package</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {college.placement_insights.map((pi) => (
                  <tr key={pi.year} className="hover:bg-slate-50 transition-colors">
                    <td className="py-3 font-semibold text-slate-900">{pi.year}</td>
                    <td className="py-3 text-slate-600">{pi.placement_rate ? `${pi.placement_rate}%` : '—'}</td>
                    <td className="py-3 text-slate-600">{pi.avg_package ? `₹${pi.avg_package} LPA` : '—'}</td>
                    <td className="py-3 text-slate-600">{pi.highest_package ? `₹${pi.highest_package} LPA` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Reviews */}
      {showReviewModal && (
        <WriteReviewModal collegeId={id} onClose={() => setShowReviewModal(false)} onSubmitted={loadReviews} />
      )}
      <Card className="p-6">
        <div className="flex items-start sm:items-center justify-between mb-5 gap-3 flex-col sm:flex-row">
          <div className="flex items-center gap-3">
            <h2 className="font-bold text-slate-900">Student Reviews</h2>
            {reviews.length > 0 && (
              <div className="flex items-center gap-1.5">
                <StarRating value={avgRating} size={14} />
                <span className="text-sm font-bold text-slate-700">{avgRating}</span>
                <span className="text-xs text-slate-400">({reviews.length})</span>
              </div>
            )}
          </div>
          <button type="button" onClick={() => setShowReviewModal(true)}
            className="flex items-center justify-center gap-1.5 min-h-11 px-4 text-sm font-semibold text-white rounded-xl hover:opacity-90 transition-all shrink-0"
            style={{ backgroundColor: 'var(--accent)' }}>
            <Plus size={14} /> Write a Review
          </button>
        </div>

        {reviews.length === 0 ? (
          <div className="py-10 text-center text-slate-400">
            <Star size={32} className="mx-auto mb-3 text-slate-200" />
            <p className="font-semibold">No reviews yet</p>
            <p className="text-sm mt-1">Be the first to share your experience</p>
          </div>
        ) : (
          <div>
            {reviews.map(r => (
              <ReviewCard key={r.id} review={r} currentUserId={userId} onDeleted={loadReviews} />
            ))}
          </div>
        )}
      </Card>
    </StudentPage>
  );
}
