import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
  BookOpen, Award, Shield, Globe, Tag, ArrowRight, Compass,
  Sparkles, GraduationCap, FileText, X, Eye,
} from 'lucide-react';
import { Card } from '../components/ui/index.jsx';
import { api } from '../services/api';

const SECTIONS = [
  {
    id: 'entrance-exams',
    to: '/career-guidance/entrance-exams',
    icon: BookOpen,
    color: 'blue',
    title: 'Entrance Exams',
    desc: 'JEE, EAMCET, GATE, NEET, ECET and more — eligibility, syllabus, registration dates & preparation tips.',
    badge: 'Engineering · Medical · Management',
  },
  {
    id: 'scholarships',
    to: '/career-guidance/scholarships',
    icon: Award,
    color: 'emerald',
    title: 'Scholarships',
    desc: 'Central & state scholarships, fee reimbursements, and financial aid schemes you may qualify for.',
    badge: 'SC · ST · OBC · EWS · Merit',
  },
  {
    id: 'govt-exams',
    to: '/career-guidance/govt-exams',
    icon: Shield,
    color: 'purple',
    title: 'Govt Exams',
    desc: 'UPSC, SSC, Banking, Railways, Group exams — roadmaps, syllabus, salary info and timelines.',
    badge: 'UPSC · SSC · Banking · Railway',
  },
  {
    id: 'abroad',
    to: '/career-guidance/abroad',
    icon: Globe,
    color: 'indigo',
    title: 'Study Abroad',
    desc: 'MS, MBA and PhD programs across USA, UK, Canada, Australia — cost, requirements, scholarships.',
    badge: 'USA · UK · Canada · Germany',
  },
  {
    id: 'branches',
    to: '/career-guidance/branches',
    icon: Tag,
    color: 'amber',
    title: 'Career Branches',
    desc: 'Explore engineering and career branches — salary, demand level, AI impact, top companies and roles.',
    badge: 'CSE · ECE · ME · Civil · EEE',
  },
];

const COLOR_MAP = {
  blue:    { bg: 'bg-blue-50',    icon: 'text-blue-600',    border: 'border-blue-100',    ring: 'ring-blue-400' },
  emerald: { bg: 'bg-emerald-50', icon: 'text-emerald-600', border: 'border-emerald-100', ring: 'ring-emerald-400' },
  purple:  { bg: 'bg-purple-50',  icon: 'text-purple-600',  border: 'border-purple-100',  ring: 'ring-purple-400' },
  indigo:  { bg: 'bg-indigo-50',  icon: 'text-indigo-600',  border: 'border-indigo-100',  ring: 'ring-indigo-400' },
  amber:   { bg: 'bg-amber-50',   icon: 'text-amber-600',   border: 'border-amber-100',   ring: 'ring-amber-400' },
};

/* Personalised content by education level */
const PERSONA = {
  '10th': {
    heading: 'You just finished 10th — pick your stream wisely',
    steps: [
      { icon: Tag,           text: 'Explore Science, Commerce, and Arts branches' },
      { icon: Award,         text: 'Apply for merit-based scholarships now' },
      { icon: BookOpen,      text: 'Know which entrance exams matter for each stream' },
    ],
    highlight: ['branches', 'scholarships', 'entrance-exams'],
    levelLabel: '10th Done',
  },
  '11th_12th': {
    heading: 'You are in 11th / 12th — start entrance prep now',
    steps: [
      { icon: BookOpen,      text: 'Register for JEE, EAMCET, NEET, or CUET early' },
      { icon: Award,         text: 'Apply for Central and State scholarships before deadlines' },
      { icon: Tag,           text: 'Research branches to pick the right career path' },
    ],
    highlight: ['entrance-exams', 'scholarships', 'branches'],
    levelLabel: '11th / 12th',
  },
  '12th': {
    heading: '12th done — act fast on admissions',
    steps: [
      { icon: BookOpen,      text: 'Check JEE / EAMCET / NEET / CUET options right now' },
      { icon: Award,         text: 'Apply for fee reimbursement and state scholarships' },
      { icon: Tag,           text: 'Compare branches and colleges before you finalise' },
    ],
    highlight: ['entrance-exams', 'scholarships', 'branches'],
    levelLabel: '12th Done',
  },
  diploma: {
    heading: 'Diploma holder — lateral entry and govt jobs',
    steps: [
      { icon: GraduationCap, text: 'ECET lets you enter 2nd year B.Tech directly' },
      { icon: Shield,        text: 'Many govt exams are open to diploma holders' },
      { icon: Tag,           text: 'Pick the right specialisation with career branch data' },
    ],
    highlight: ['entrance-exams', 'govt-exams', 'branches'],
    levelLabel: 'Diploma',
  },
  ug: {
    heading: 'Plan your next move while in degree',
    steps: [
      { icon: Tag,           text: 'Explore career branches — salary, demand, AI impact' },
      { icon: BookOpen,      text: 'Start GATE, CAT, or GRE prep in your 3rd year' },
      { icon: Globe,         text: 'Research MS and MBA abroad programs early' },
    ],
    highlight: ['branches', 'entrance-exams', 'abroad'],
    levelLabel: 'Degree Student',
  },
  graduated: {
    heading: 'Graduated — your next chapter starts here',
    steps: [
      { icon: Tag,           text: 'Find high-demand roles with career branch insights' },
      { icon: Globe,         text: 'MS, MBA, or PhD abroad — explore programs and costs' },
      { icon: Shield,        text: 'UPSC, SSC, Banking — government jobs roadmap' },
    ],
    highlight: ['branches', 'abroad', 'govt-exams'],
    levelLabel: 'Graduated',
  },
};

function PersonaCard({ persona }) {
  const { heading, steps, levelLabel } = persona;
  return (
    <div className="rounded-2xl border border-indigo-100 bg-indigo-50 p-5 sm:p-6 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles size={16} className="text-indigo-500" />
        <span className="text-xs font-bold text-indigo-500 uppercase tracking-wide">Recommended for you</span>
        <span className="ml-auto text-[11px] font-semibold text-indigo-400 bg-indigo-100 px-2 py-0.5 rounded-full">
          {levelLabel}
        </span>
      </div>
      <p className="text-sm font-bold text-indigo-900 mb-4">{heading}</p>
      <div className="flex flex-col sm:flex-row gap-3">
        {steps.map(({ icon: Icon, text }, i) => (
          <div key={i} className="flex items-start gap-2.5 flex-1 bg-white/70 rounded-xl p-3">
            <div className="w-7 h-7 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0 mt-0.5">
              <Icon size={13} className="text-indigo-600" />
            </div>
            <p className="text-[12px] text-indigo-800 leading-snug font-medium">{text}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function GuidesSection() {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(null);   // full article being read
  const [reading, setReading] = useState(false);

  useEffect(() => {
    api.get('/cg/content', { per_page: 12 })
      .then(({ data }) => { if (data.bool) setItems(data.response.content || []); })
      .catch(() => {});
  }, []);

  const openArticle = async (id) => {
    setReading(true);
    try {
      const { data } = await api.get(`/cg/content/${id}`);
      if (data.bool) setOpen(data.response);
    } catch {}
    finally { setReading(false); }
  };

  if (items.length === 0) return null;

  return (
    <div className="mt-8">
      <div className="flex items-center gap-2 mb-4">
        <FileText size={16} style={{ color: 'var(--accent)' }} />
        <h2 className="font-bold text-slate-900">Guides & Articles</h2>
        <span className="text-xs text-slate-400">{items.length} published</span>
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map(c => (
          <Card key={c.id} hover className="p-4 cursor-pointer flex flex-col gap-2" onClick={() => openArticle(c.id)}>
            {c.thumbnail_url && (
              <img src={c.thumbnail_url} alt="" className="w-full h-28 object-cover rounded-xl" />
            )}
            <p className="font-bold text-slate-900 text-sm leading-snug line-clamp-2">{c.title}</p>
            {c.summary && <p className="text-xs text-slate-500 line-clamp-3 flex-1">{c.summary}</p>}
            <div className="flex items-center justify-between text-[11px] text-slate-400 mt-1">
              <span>{c.author_name || 'SKOVO Team'}</span>
              <span className="flex items-center gap-1"><Eye size={11} /> {c.view_count}</span>
            </div>
          </Card>
        ))}
      </div>

      {(open || reading) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
          onClick={() => setOpen(null)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-100">
              <h3 className="font-bold text-slate-900 leading-snug">{open?.title || 'Loading…'}</h3>
              <button onClick={() => setOpen(null)} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0">
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {open?.summary && <p className="text-sm font-medium text-slate-600 mb-3">{open.summary}</p>}
              <div className="text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">{open?.body || ''}</div>
            </div>
            <div className="px-6 py-3 border-t border-slate-100 text-xs text-slate-400 flex justify-between">
              <span>{open?.author_name || 'SKOVO Team'}</span>
              <span>{open?.published_at ? new Date(open.published_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : ''}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function CGHub() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const persona = user?.education_level ? PERSONA[user.education_level] : null;

  /* Sort sections so highlighted ones appear first when persona is active */
  const sortedSections = persona
    ? [
        ...SECTIONS.filter(s => persona.highlight.includes(s.id)),
        ...SECTIONS.filter(s => !persona.highlight.includes(s.id)),
      ]
    : SECTIONS;

  return (
    <div className="p-4 sm:p-6">
      {/* Hero */}
      <div className="rounded-2xl bg-slate-900 p-6 sm:p-8 mb-6 text-white flex flex-col sm:flex-row items-start gap-5">
        <div className="w-14 h-14 rounded-2xl flex items-center justify-center shrink-0" style={{ backgroundColor: 'var(--accent)' }}>
          <Compass size={28} className="text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight mb-1">Career Guidance</h1>
          <p className="text-slate-400 text-sm leading-relaxed max-w-2xl">
            Everything you need to plan your career — entrance exams, scholarships, government jobs, study abroad programs,
            and branch-level insights. All in one place, curated for students like you.
          </p>
        </div>
      </div>

      {/* Personalised recommendations */}
      {persona && <PersonaCard persona={persona} />}

      {/* Section grid */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedSections.map(({ id, to, icon: Icon, color, title, desc, badge }) => {
          const c = COLOR_MAP[color];
          const isHighlighted = persona?.highlight.includes(id);
          return (
            <Card
              key={to}
              hover
              className={`p-5 flex flex-col gap-4 cursor-pointer relative ${isHighlighted ? 'ring-2 ' + c.ring : ''}`}
              onClick={() => navigate(to)}
            >
              {isHighlighted && (
                <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-600">
                  For you
                </span>
              )}
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${c.bg}`}>
                  <Icon size={22} className={c.icon} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-slate-900 text-base">{title}</p>
                  <p className={`text-[11px] font-semibold mt-0.5 ${c.icon}`}>{badge}</p>
                </div>
              </div>
              <p className="text-sm text-slate-500 leading-relaxed flex-1">{desc}</p>
              <div className="flex items-center text-sm font-semibold" style={{ color: 'var(--accent)' }}>
                Explore <ArrowRight size={14} className="ml-1" />
              </div>
            </Card>
          );
        })}
      </div>

      {/* Guides & Articles (admin-published cg_content) */}
      <GuidesSection />

      {/* Info strip */}
      <div className="mt-8 bg-blue-50 border border-blue-100 rounded-2xl p-5 text-sm text-blue-700">
        <p className="font-semibold mb-1">How to use Career Guidance</p>
        <p className="text-blue-600 leading-relaxed">
          Browse each section to discover paths that match your interests. Bookmark opportunities you like,
          compare college cutoffs on the Colleges page, and use your readiness score to track your progress toward your goals.
        </p>
      </div>
    </div>
  );
}
