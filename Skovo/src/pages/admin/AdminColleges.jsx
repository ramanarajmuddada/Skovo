import React, { useEffect, useState, useCallback, useRef } from 'react';
import { z } from 'zod';
import { adminApi as api } from '../../services/api';
import { api as publicApi } from '../../services/api';
import { GraduationCap, Pencil, Trash2, Plus, X, Eye, Globe, Copy, Check, ChevronDown, Type, MapPin, Hash, IndianRupee, AlignLeft, Link2, AlertCircle, Phone, Award, Users } from 'lucide-react';
import { FormSelect, Button as KitButton } from '../../components/ui/index.jsx';
import { Search as SearchIcon, MapPin as PinIcon } from 'lucide-react';
import { useMasters } from '../../hooks/useMasters';
import {
  Th, Td, ActionBtn, ConfirmModal,
  TableShell, LoadingRows, EmptyState, Pagination,
} from '../../components/ui/TableComponents';

const collegeSchema = z.object({
  name:                    z.string().min(3, 'College name must be at least 3 characters'),
  type:                    z.string().min(1, 'College type is required'),
  location_state:          z.string().min(2, 'State is required'),
  location_city:           z.string().min(2, 'City is required'),
  accreditation:           z.string().min(2, 'Accreditation is required'),
  annual_fees_min:         z.coerce.number().min(1, 'Minimum annual fees required'),
  contact_info:            z.string().min(5, 'Contact info is required'),
  entrance_exams_accepted: z.string().min(2, 'At least one entrance exam required'),
  admission_process:       z.string().min(10, 'Admission process description required'),
  about:                   z.string().min(20, 'About must be at least 20 characters'),
});

const TYPE_COLOR = { government: 'bg-blue-100 text-blue-700', private: 'bg-purple-100 text-purple-700', deemed: 'bg-amber-100 text-amber-700', autonomous: 'bg-emerald-100 text-emerald-700' };
const EMPTY = { name: '', type: 'private', location_city: '', location_state: '', established_year: '', accreditation: '', naac_grade: '', nirf_ranking: '', annual_fees_min: '', annual_fees_max: '', hostel_fee: '', placement_rate: '', avg_package: '', highest_package: '', website_url: '', contact_info: '', admission_process: '', entrance_exams_accepted: '', facilities: '', top_recruiters: '', about: '', logo_url: '', banner_url: '', institution_subdomain: '', is_active: true };

function Toast({ msg, ok }) {
  if (!msg) return null;
  return <div className={`fixed bottom-6 right-6 z-100 px-5 py-3 rounded-xl text-sm font-semibold shadow-lg ${ok ? 'bg-emerald-600 text-white' : 'bg-red-600 text-white'}`}>{msg}</div>;
}


function ViewModal({ college, onClose, onEdit }) {
  const [copied, setCopied] = useState(false);
  const fmt = (v, prefix = '', suffix = '') => v ? `${prefix}${v}${suffix}` : '—';
  const fmtFees = (min, max) => {
    if (!min && !max) return '—';
    if (min && max) return `₹${(min/100000).toFixed(1)}L – ₹${(max/100000).toFixed(1)}L`;
    return min ? `₹${(min/100000).toFixed(1)}L+` : `Up to ₹${(max/100000).toFixed(1)}L`;
  };

  const copySubdomain = () => {
    navigator.clipboard.writeText(`${college.institution_subdomain}.skovo.in`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center">
              <GraduationCap size={20} className="text-slate-500" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 leading-tight">{college.name}</h2>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-md ${TYPE_COLOR[college.type] || 'bg-slate-100 text-slate-600'}`}>{college.type}</span>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Subdomain box */}
          {college.institution_subdomain && (
            <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
              <p className="text-xs font-semibold text-blue-500 uppercase tracking-wide mb-1">Admin Portal URL</p>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-blue-700">{college.institution_subdomain}.skovo.in</span>
                <button onClick={copySubdomain} className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-white border border-blue-200 rounded-lg px-2.5 py-1.5 transition-all">
                  {copied ? <><Check size={12}/> Copied!</> : <><Copy size={12}/> Copy</>}
                </button>
              </div>
              <p className="text-xs text-blue-400 mt-1.5">Share this URL with the college admin to set up their account</p>
            </div>
          )}

          {/* Location & Rankings */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Location</p>
              <p className="text-sm font-semibold text-slate-700">{[college.location_city, college.location_state].filter(Boolean).join(', ') || '—'}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">NIRF Ranking</p>
              <p className="text-sm font-semibold text-slate-700">{college.nirf_ranking ? `#${college.nirf_ranking}` : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">NAAC Grade</p>
              <p className="text-sm font-semibold text-slate-700">{fmt(college.naac_grade)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Placement Rate</p>
              <p className="text-sm font-semibold text-slate-700">{college.placement_rate ? `${college.placement_rate}%` : '—'}</p>
            </div>
          </div>

          {/* Fees */}
          <div className="bg-slate-50 rounded-xl p-3">
            <p className="text-xs text-slate-400 mb-0.5">Annual Fees</p>
            <p className="text-sm font-semibold text-slate-700">{fmtFees(college.annual_fees_min, college.annual_fees_max)}</p>
          </div>

          {/* Packages */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Avg Package</p>
              <p className="text-sm font-semibold text-slate-700">{college.avg_package ? `₹${college.avg_package}L` : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Highest Package</p>
              <p className="text-sm font-semibold text-slate-700">{college.highest_package ? `₹${college.highest_package}L` : '—'}</p>
            </div>
          </div>

          {/* Website */}
          {college.website_url && (
            <a href={college.website_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-2 text-sm text-blue-600 font-semibold hover:underline">
              <Globe size={14}/> {college.website_url}
            </a>
          )}

          {/* Extended details (previously write-only) */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Established</p>
              <p className="text-sm font-semibold text-slate-700">{fmt(college.established_year)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Accreditation</p>
              <p className="text-sm font-semibold text-slate-700">{fmt(college.accreditation)}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Hostel Fee</p>
              <p className="text-sm font-semibold text-slate-700">{college.hostel_fee ? `₹${Number(college.hostel_fee).toLocaleString('en-IN')}` : '—'}</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-xs text-slate-400 mb-0.5">Contact</p>
              <p className="text-sm font-semibold text-slate-700 break-words">{fmt(college.contact_info)}</p>
            </div>
          </div>

          {college.about && (
            <div><p className="text-xs text-slate-400 mb-1">About</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{college.about}</p></div>
          )}
          {college.admission_process && (
            <div><p className="text-xs text-slate-400 mb-1">Admission Process</p><p className="text-sm text-slate-700 whitespace-pre-wrap">{college.admission_process}</p></div>
          )}
          {[['Entrance Exams', college.entrance_exams_accepted], ['Facilities', college.facilities], ['Top Recruiters', college.top_recruiters]].map(([label, arr]) => (
            (arr && arr.length > 0) ? (
              <div key={label}>
                <p className="text-xs text-slate-400 mb-1">{label}</p>
                <div className="flex flex-wrap gap-1.5">
                  {arr.map((x, i) => <span key={i} className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded-lg text-xs">{x}</span>)}
                </div>
              </div>
            ) : null
          ))}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Close</button>
          <button onClick={onEdit} className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700">
            <Pencil size={14}/> Edit
          </button>
        </div>
      </div>
    </div>
  );
}

function EditModal({ title, onClose, onSave, form, setForm, saving, dropdowns }) {
  const { lists } = useMasters(['active_status']);
  const [errors, setErrors] = useState({});
  const sf = (k, v) => { setForm(f => ({ ...f, [k]: v })); setErrors(e => ({ ...e, [k]: undefined })); };

  const handleSave = () => {
    const result = collegeSchema.safeParse(form);
    if (!result.success) { setErrors(result.error.flatten().fieldErrors); return; }
    setErrors({});
    onSave();
  };

  const ic = (f) => errors[f]?.[0]
    ? 'border-red-400 bg-red-50/30 focus:ring-red-100'
    : 'border-slate-200 focus:ring-blue-500';
  const Err = ({ f: field }) => errors[field]?.[0]
    ? <p className="text-xs text-red-500 mt-1 flex items-center gap-1"><AlertCircle size={10}/>{errors[field][0]}</p>
    : null;
  const Lbl = ({ icon: Icon, text, req, note }) => (
    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 mb-1.5">
      <Icon size={12} className="text-slate-400"/>{text}{req && <span className="text-red-500">*</span>}
      {note && <span className="font-normal text-slate-400 ml-1">{note}</span>}
    </label>
  );
  const iconInput = (icon, key, type = 'text', placeholder = '') => {
    const Icon = icon;
    return (
      <div className="relative">
        <Icon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
        <input type={type} value={form[key]} onChange={e => sf(key, e.target.value)} placeholder={placeholder}
          className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic(key)}`} />
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 shrink-0">
          <h2 className="font-bold text-slate-900">{title}</h2>
          <button onClick={onClose} className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Name */}
          <div className="col-span-2">
            <Lbl icon={GraduationCap} text="College Name" req />
            {iconInput(GraduationCap, 'name', 'text', 'e.g. IIT Bombay')}
            <Err f="name" />
          </div>
          {/* Type */}
          <div>
            <Lbl icon={GraduationCap} text="College Type" req />
            <FormSelect searchType="college_type" value={form.type} onChange={v => sf('type', v)} icon={GraduationCap} options={dropdowns.college_type || []} placeholder="e.g. Government" required />
            <Err f="type" />
          </div>
          {/* Status */}
          <div>
            <Lbl icon={Check} text="Status" req />
            <FormSelect searchType="active_status"
              value={form.is_active ? 'active' : 'inactive'}
              onChange={v => sf('is_active', v === 'active')}
              icon={Check}
              options={lists.active_status || []}
              clearable={false} />
          </div>
          {/* State */}
          <div>
            <Lbl icon={MapPin} text="State" req />
            {iconInput(MapPin, 'location_state', 'text', 'e.g. Maharashtra')}
            <Err f="location_state" />
          </div>
          {/* City */}
          <div>
            <Lbl icon={MapPin} text="City" req />
            {iconInput(MapPin, 'location_city', 'text', 'e.g. Mumbai')}
            <Err f="location_city" />
          </div>
          {/* Established Year */}
          <div>
            <Lbl icon={Hash} text="Established Year" />
            {iconInput(Hash, 'established_year', 'number', 'e.g. 1958')}
          </div>
          {/* Accreditation */}
          <div>
            <Lbl icon={Award} text="Accreditation" req />
            {iconInput(Award, 'accreditation', 'text', 'NAAC A++, NBA, NIRF…')}
            <Err f="accreditation" />
          </div>
          {/* NAAC Grade */}
          <div>
            <Lbl icon={Award} text="NAAC Grade" />
            {iconInput(Award, 'naac_grade', 'text', 'e.g. A++, A+, A')}
          </div>
          {/* NIRF */}
          <div>
            <Lbl icon={Hash} text="NIRF Ranking" />
            {iconInput(Hash, 'nirf_ranking', 'number', 'e.g. 1')}
          </div>
          {/* Fees */}
          <div>
            <Lbl icon={IndianRupee} text="Annual Fees Min (₹)" req />
            {iconInput(IndianRupee, 'annual_fees_min', 'number', 'e.g. 100000')}
            <Err f="annual_fees_min" />
          </div>
          <div>
            <Lbl icon={IndianRupee} text="Annual Fees Max (₹)" />
            {iconInput(IndianRupee, 'annual_fees_max', 'number', 'e.g. 200000')}
          </div>
          <div>
            <Lbl icon={IndianRupee} text="Hostel Fee (₹/yr)" />
            {iconInput(IndianRupee, 'hostel_fee', 'number', 'e.g. 80000')}
          </div>
          {/* Placement */}
          <div>
            <Lbl icon={Users} text="Placement Rate (%)" />
            {iconInput(Users, 'placement_rate', 'number', 'e.g. 95')}
          </div>
          <div>
            <Lbl icon={IndianRupee} text="Avg Package (LPA)" />
            {iconInput(IndianRupee, 'avg_package', 'number', 'e.g. 7.2')}
          </div>
          <div>
            <Lbl icon={IndianRupee} text="Highest Package (LPA)" />
            {iconInput(IndianRupee, 'highest_package', 'number', 'e.g. 42')}
          </div>
          {/* Contact */}
          <div className="col-span-2">
            <Lbl icon={Phone} text="Contact Info" req />
            {iconInput(Phone, 'contact_info', 'text', 'admissions@college.ac.in / +91-080-12345678')}
            <Err f="contact_info" />
          </div>
          {/* Website */}
          <div className="col-span-2">
            <Lbl icon={Globe} text="Website URL" />
            {iconInput(Globe, 'website_url', 'url', 'https://college.ac.in')}
          </div>
          {/* Entrance exams */}
          <div className="col-span-2">
            <Lbl icon={Award} text="Entrance Exams Accepted" req note="(comma separated)" />
            <div className="relative">
              <Award size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input value={form.entrance_exams_accepted} onChange={e => sf('entrance_exams_accepted', e.target.value)}
                placeholder="JEE, EAMCET, GATE, KCET, CAT…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none ${ic('entrance_exams_accepted')}`} />
            </div>
            <Err f="entrance_exams_accepted" />
          </div>
          {/* Facilities */}
          <div className="col-span-2">
            <Lbl icon={GraduationCap} text="Facilities" note="(comma separated, optional)" />
            <input value={form.facilities} onChange={e => sf('facilities', e.target.value)}
              placeholder="Hostel, Labs, Sports Complex, WiFi, Library, Canteen…"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {/* Top Recruiters */}
          <div className="col-span-2">
            <Lbl icon={Users} text="Top Recruiters" note="(comma separated, optional)" />
            <input value={form.top_recruiters} onChange={e => sf('top_recruiters', e.target.value)}
              placeholder="TCS, Infosys, Google, Microsoft, Wipro…"
              className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          {/* Admission Process */}
          <div className="col-span-2">
            <Lbl icon={AlignLeft} text="Admission Process" req />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={3} value={form.admission_process} onChange={e => sf('admission_process', e.target.value)}
                placeholder="Step 1: Apply online through the official portal. Step 2: Appear for entrance exam (JEE/EAMCET). Step 3: Counselling and seat allotment…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none resize-none ${ic('admission_process')}`} />
            </div>
            <Err f="admission_process" />
          </div>
          {/* About */}
          <div className="col-span-2">
            <Lbl icon={AlignLeft} text="About College" req />
            <div className="relative">
              <AlignLeft size={14} className="absolute left-3 top-3 text-slate-400 pointer-events-none"/>
              <textarea rows={4} value={form.about} onChange={e => sf('about', e.target.value)}
                placeholder="Brief history, vision, notable achievements, campus highlights…"
                className={`w-full pl-9 pr-4 py-2.5 border rounded-xl text-sm focus:outline-none resize-none ${ic('about')}`} />
            </div>
            <Err f="about" />
          </div>
          {/* Logo */}
          <div className="col-span-2">
            <Lbl icon={Link2} text="College Logo URL" />
            {iconInput(Link2, 'logo_url', 'url', 'https://college.ac.in/logo.png')}
          </div>
          {/* Banner */}
          <div className="col-span-2">
            <Lbl icon={Link2} text="Banner URL" />
            {iconInput(Link2, 'banner_url', 'url', 'https://college.ac.in/banner.jpg')}
          </div>
          {/* Subdomain */}
          <div className="col-span-2">
            <Lbl icon={Globe} text="Institution Subdomain" />
            <div className="relative">
              <Globe size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"/>
              <input type="text" value={form.institution_subdomain}
                onChange={e => sf('institution_subdomain', e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                placeholder="e.g. gitam"
                className="w-full pl-9 pr-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {form.institution_subdomain
                ? <>Admin portal: <span className="font-semibold text-blue-600">{form.institution_subdomain}.skovo.in</span></>
                : 'Give this college a subdomain (e.g. gitam → gitam.skovo.in)'}
            </p>
          </div>
        </div>
        <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3 shrink-0">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-semibold border border-slate-200 rounded-xl hover:bg-slate-50">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="px-5 py-2.5 text-sm font-semibold bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {saving ? 'Saving…' : 'Save College'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminColleges() {
  const [dropdowns, setDropdowns] = useState({ college_type: [] });
  const [colleges, setColleges] = useState([]);
  const [loading, setLoading]  = useState(true);
  const [page, setPage]        = useState(1);
  const [pages, setPages]      = useState(1);
  const [total, setTotal]      = useState(0);
  const [perPage, setPerPage]  = useState(20);
  const [viewCollege, setViewCollege] = useState(null);
  const [modal, setModal]      = useState(null);
  const [form, setForm]        = useState(EMPTY);
  const [saving, setSaving]    = useState(false);
  const [toast, setToast]      = useState(null);
  const [confirm, setConfirm]  = useState(null);

  const showToast = (msg, ok = true) => { setToast({ msg, ok }); setTimeout(() => setToast(null), 3000); };
  // Search rides in a ref so load() keeps its (page, perPage) signature.
  const qRef = useRef('');
  const [query, setQuery] = useState('');
  const load = useCallback((p = 1, pp = 15) => {
    setLoading(true);
    api.get('/skovo-platform-panel-admin/colleges', { page: p, per_page: pp, ...(qRef.current && { search: qRef.current }) })
      .then(({ data }) => {
        if (data.bool) {
          setColleges(data.response.colleges);
          setPages(data.pagination?.pages || 1);
          setTotal(data.pagination?.total || 0);
        }
      })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load(1);
    publicApi.get('/auth/masters', { types: 'college_type' })
      .then(({ data }) => { if (data.bool && data.response.grouped) setDropdowns(prev => ({...prev, ...data.response.grouped})); })
      .catch(() => {});
  }, []);

  const openCreate = () => { setForm(EMPTY); setModal('create'); };
  const openEdit = (c) => {
    setViewCollege(null);
    setForm({ name: c.name||'', type: c.type||'private', location_city: c.location_city||'', location_state: c.location_state||'', established_year: c.established_year||'', accreditation: c.accreditation||'', naac_grade: c.naac_grade||'', nirf_ranking: c.nirf_ranking||'', annual_fees_min: c.annual_fees_min||'', annual_fees_max: c.annual_fees_max||'', hostel_fee: c.hostel_fee||'', placement_rate: c.placement_rate||'', avg_package: c.avg_package||'', highest_package: c.highest_package||'', website_url: c.website_url||'', contact_info: c.contact_info||'', admission_process: c.admission_process||'', entrance_exams_accepted: Array.isArray(c.entrance_exams_accepted)?c.entrance_exams_accepted.join(', '):'', facilities: Array.isArray(c.facilities)?c.facilities.join(', '):'', top_recruiters: Array.isArray(c.top_recruiters)?c.top_recruiters.join(', '):'', about: c.about||'', logo_url: c.logo_url||'', banner_url: c.banner_url||'', institution_subdomain: c.institution_subdomain||'', is_active: c.is_active !== false });
    setModal(c);
  };

  const save = async () => {
    setSaving(true);
    const toArr = (s) => typeof s === 'string' ? s.split(',').map(x => x.trim()).filter(Boolean) : (s || []);
    try {
      const isEdit = modal && modal !== 'create';
      const payload = { ...form, entrance_exams_accepted: toArr(form.entrance_exams_accepted), facilities: toArr(form.facilities), top_recruiters: toArr(form.top_recruiters) };
      const { data } = isEdit ? await api.put(`/skovo-platform-panel-admin/colleges/${modal.id}`, payload) : await api.post('/skovo-platform-panel-admin/colleges', payload);
      if (data.bool) { showToast(isEdit ? 'Updated' : 'Created'); setModal(null); load(page); }
      else showToast(data.response?.message || 'Failed', false);
    } catch { showToast('Error', false); } finally { setSaving(false); }
  };

  const del = async (c) => {
    try {
      const { data } = await api.delete(`/skovo-platform-panel-admin/colleges/${c.id}`);
      if (data.bool) { showToast('Deleted'); load(page); } else showToast('Failed', false);
    } catch { showToast('Error', false); }
  };

  // If institution already has a college, show profile view instead of add-new list
  const myCollege = colleges.length === 1 ? colleges[0] : null;

  if (!loading && myCollege) {
    return (
      <div className="p-4 sm:p-6">
        <Toast msg={toast?.msg} ok={toast?.ok} />
        {modal && <EditModal title="Edit College Profile" onClose={() => setModal(null)} onSave={save} form={form} setForm={setForm} saving={saving} dropdowns={dropdowns} />}

        <div className="mb-6">
          <h1 className="text-2xl font-black text-slate-900">College Profile</h1>
          <p className="text-sm text-slate-500 mt-1">Your institution's college details</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-slate-100 flex items-center justify-center">
                <GraduationCap size={22} className="text-slate-500" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-900">{myCollege.name}</h2>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-lg ${TYPE_COLOR[myCollege.type] || ''}`}>{myCollege.type}</span>
              </div>
            </div>
            <button onClick={() => openEdit(myCollege)} className="flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-xl hover:bg-blue-700">
              <Pencil size={14}/> Edit Profile
            </button>
          </div>

          {/* Details grid */}
          <div className="p-6 grid grid-cols-2 gap-4">
            {[
              ['Location', [myCollege.location_city, myCollege.location_state].filter(Boolean).join(', ') || '—'],
              ['NIRF Ranking', myCollege.nirf_ranking ? `#${myCollege.nirf_ranking}` : '—'],
              ['NAAC Grade', myCollege.naac_grade || '—'],
              ['Placement Rate', myCollege.placement_rate ? `${myCollege.placement_rate}%` : '—'],
              ['Avg Package', myCollege.avg_package ? `₹${myCollege.avg_package}L` : '—'],
              ['Highest Package', myCollege.highest_package ? `₹${myCollege.highest_package}L` : '—'],
              ['Annual Fees (Min)', myCollege.annual_fees_min ? `₹${(myCollege.annual_fees_min/100000).toFixed(1)}L` : '—'],
              ['Annual Fees (Max)', myCollege.annual_fees_max ? `₹${(myCollege.annual_fees_max/100000).toFixed(1)}L` : '—'],
            ].map(([label, val]) => (
              <div key={label} className="bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">{label}</p>
                <p className="text-sm font-semibold text-slate-700">{val}</p>
              </div>
            ))}
            {myCollege.website_url && (
              <div className="col-span-2 bg-slate-50 rounded-xl p-3">
                <p className="text-xs text-slate-400 mb-0.5">Website</p>
                <a href={myCollege.website_url} target="_blank" rel="noreferrer" className="text-sm font-semibold text-blue-600 hover:underline flex items-center gap-1.5">
                  <Globe size={13}/>{myCollege.website_url}
                </a>
              </div>
            )}
            {myCollege.institution_subdomain && (
              <div className="col-span-2 bg-blue-50 border border-blue-100 rounded-xl p-3">
                <p className="text-xs text-blue-500 mb-0.5">Admin Portal Subdomain</p>
                <p className="text-sm font-bold text-blue-700">{myCollege.institution_subdomain}.skovo.in</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <Toast msg={toast?.msg} ok={toast?.ok} />
      {viewCollege && <ViewModal college={viewCollege} onClose={() => setViewCollege(null)} onEdit={() => openEdit(viewCollege)} />}
      {modal && <EditModal title={modal === 'create' ? 'Add College' : 'Edit College'} onClose={() => setModal(null)} onSave={save} form={form} setForm={setForm} saving={saving} dropdowns={dropdowns} />}
      {confirm && <ConfirmModal message={`Delete "${confirm.name}"?`} detail="This cannot be undone." danger confirmLabel="Delete" onConfirm={() => { del(confirm); setConfirm(null); }} onCancel={() => setConfirm(null)} />}

      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="text-2xl font-black text-slate-900">Colleges</h1>
          <p className="text-sm text-slate-500 mt-0.5"><span className="font-semibold text-slate-700">{total}</span> college listings students can browse</p>
        </div>
        <KitButton onClick={openCreate} className="w-full sm:w-auto"><Plus size={16} /> Add college</KitButton>
      </div>

      <div className="relative mb-4">
        <SearchIcon size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
        <input value={query} type="search" aria-label="Search colleges" placeholder="Search colleges…"
               onChange={(e) => {
                 setQuery(e.target.value);
                 clearTimeout(window.__collegeSearchT);
                 window.__collegeSearchT = setTimeout(() => { qRef.current = e.target.value.trim(); setPage(1); load(1, perPage); }, 400);
               }}
               className="w-full min-h-11 pl-10 pr-4 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Phones and tablets: cards, two across from md. */}
      <div className="lg:hidden grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
        {loading ? [0, 1, 2].map((i) => <div key={i} className="h-28 rounded-2xl bg-white border border-slate-100 animate-pulse" />)
          : colleges.length === 0 ? <div className="md:col-span-2"><EmptyState icon={GraduationCap} message={query ? 'No colleges match' : 'No colleges yet'} /></div>
            : colleges.map((c) => (
              <div key={c.id} onClick={() => setViewCollege(c)} className="bg-white rounded-2xl border border-slate-200 p-4 cursor-pointer">
                <div className="flex items-start gap-2">
                  <p className="flex-1 min-w-0 text-sm font-bold text-slate-900 break-words">{c.name}</p>
                  <span className={`shrink-0 text-xs font-semibold px-2 py-0.5 rounded-lg capitalize ${TYPE_COLOR[c.type] || ''}`}>{c.type}</span>
                </div>
                <p className="text-xs text-slate-500 mt-1 inline-flex items-center gap-1"><PinIcon size={11} />{[c.location_city, c.location_state].filter(Boolean).join(', ') || 'No location'}</p>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">
                  {c.nirf_ranking && <span>NIRF #{c.nirf_ranking}</span>}
                  {c.naac_grade && <span>NAAC {c.naac_grade}</span>}
                  {c.avg_package && <span>Avg ₹{c.avg_package}L</span>}
                </div>
                <div className="mt-3 pt-2 border-t border-slate-100 flex gap-1" onClick={(e) => e.stopPropagation()}>
                  <ActionBtn icon={Pencil} tooltip="Edit College" onClick={() => openEdit(c)} color="blue" />
                  <ActionBtn icon={Trash2} tooltip="Delete College" onClick={() => setConfirm(c)} color="red" />
                </div>
              </div>
            ))}
      </div>

      <TableShell>
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <Th>College</Th>
                <Th>Type</Th>
                <Th>NIRF</Th>
                <Th>NAAC</Th>
                <Th>Avg Pkg</Th>
                <Th>Subdomain</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            {loading ? (
              <LoadingRows cols={7} rows={6} />
            ) : colleges.length === 0 ? (
              <tbody>
                <tr>
                  <td colSpan={7}>
                    <EmptyState icon={GraduationCap} message={query ? 'No colleges match' : 'No colleges yet'} />
                  </td>
                </tr>
              </tbody>
            ) : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {colleges.map((c) => (
                  <tr key={c.id} onClick={() => setViewCollege(c)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td>
                      <p className="font-semibold text-slate-900 max-w-72 truncate">{c.name}</p>
                      <p className="text-xs text-slate-400 max-w-72 truncate">{[c.location_city, c.location_state].filter(Boolean).join(', ') || 'No location'}</p>
                    </Td>
                    <Td><span className={`text-xs font-semibold px-2.5 py-1 rounded-lg capitalize ${TYPE_COLOR[c.type]||''}`}>{c.type}</span></Td>
                    <Td className="text-slate-600 text-xs">{c.nirf_ranking ? `#${c.nirf_ranking}` : '—'}</Td>
                    <Td className="text-slate-600 text-xs">{c.naac_grade || '—'}</Td>
                    <Td className="text-slate-600 text-xs">{c.avg_package ? `₹${c.avg_package}L` : '—'}</Td>
                    <Td className="text-xs">
                      {c.institution_subdomain
                        ? <span className="px-2 py-1 bg-blue-50 text-blue-700 font-semibold rounded-lg">{c.institution_subdomain}</span>
                        : <span className="text-slate-300">—</span>}
                    </Td>
                    <Td onClick={e => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <ActionBtn icon={Eye} tooltip="View Details" onClick={() => setViewCollege(c)} color="indigo" />
                        <ActionBtn icon={Pencil} tooltip="Edit College" onClick={() => openEdit(c)} color="blue" />
                        <ActionBtn icon={Trash2} tooltip="Delete College" onClick={() => setConfirm(c)} color="red" />
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        <Pagination
          page={page}
          pages={pages}
          total={total}
          perPage={perPage}
          onPage={(p) => { setPage(p); load(p, perPage); }}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); load(1, pp); }}
        />
      </TableShell>
    </div>
  );
}
