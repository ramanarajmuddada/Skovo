import React, { useEffect, useState } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { PageHeader, SearchBar, FilterPills, Pagination, SkeletonCard, EmptyState, Card, Badge, Button, Modal } from '../components/ui/index.jsx';
import { BookOpen, Globe, Calendar, FileText, X, ExternalLink, MapPin, Users } from 'lucide-react';

// TYPES comes from master data (masters.entrance_exam_scope).

const TYPE_COLOR = { state: 'blue', national: 'purple', university: 'amber' };
const STREAM_COLOR = { engineering: 'blue', medical: 'emerald', management: 'indigo', law: 'amber', science: 'purple' };

function ExamCard({ exam, onClick }) {
  return (
    <Card hover className="p-5 flex flex-col gap-3 cursor-pointer" onClick={() => onClick(exam)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <Badge color={TYPE_COLOR[exam.exam_type] || 'slate'} size="xs">{exam.exam_type}</Badge>
            {exam.for_stream && <Badge color={STREAM_COLOR[exam.for_stream] || 'slate'} size="xs">{exam.for_stream}</Badge>}
            {exam.exam_mode && <Badge color="slate" size="xs">{exam.exam_mode}</Badge>}
          </div>
          <p className="font-bold text-slate-900 text-base leading-snug">{exam.exam_name}</p>
          <p className="text-xs font-semibold text-slate-400 mt-0.5">{exam.exam_code}</p>
        </div>
        <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center shrink-0">
          <BookOpen size={18} className="text-blue-600" />
        </div>
      </div>

      {exam.conducting_authority && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Users size={11} className="text-slate-400" /> {exam.conducting_authority}
        </p>
      )}

      {exam.exam_period && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <Calendar size={11} className="text-slate-400" /> Exam period: {exam.exam_period}
        </p>
      )}

      {exam.registration_period && (
        <p className="text-xs text-slate-500 flex items-center gap-1.5">
          <FileText size={11} className="text-slate-400" /> Registration: {exam.registration_period}
        </p>
      )}

      {exam.useful_for_states?.length > 0 && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <MapPin size={11} /> {Array.isArray(exam.useful_for_states) ? exam.useful_for_states.slice(0, 3).join(', ') : exam.useful_for_states}
          {exam.useful_for_states.length > 3 && ` +${exam.useful_for_states.length - 3} more`}
        </p>
      )}

      <div className="mt-auto pt-2 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs font-semibold text-blue-600">View details</span>
        {exam.official_url && (
          <a href={exam.official_url} target="_blank" rel="noreferrer"
            onClick={e => e.stopPropagation()}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-blue-600 transition-colors">
            Official site <ExternalLink size={10} />
          </a>
        )}
      </div>
    </Card>
  );
}

function ExamDetailModal({ exam, onClose }) {
  if (!exam) return null;
  const Row = ({ label, value }) => value ? (
    <div className="flex flex-col gap-0.5">
      <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
      <p className="text-sm text-slate-800">{value}</p>
    </div>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[88vh] flex flex-col overflow-hidden">
        <div className="flex items-start justify-between px-6 py-5 border-b border-slate-100 shrink-0">
          <div>
            <div className="flex flex-wrap gap-2 mb-2">
              <Badge color={TYPE_COLOR[exam.exam_type] || 'slate'} size="xs">{exam.exam_type}</Badge>
              {exam.for_stream && <Badge color={STREAM_COLOR[exam.for_stream] || 'slate'} size="xs">{exam.for_stream}</Badge>}
              {exam.exam_mode && <Badge color="slate" size="xs">{exam.exam_mode}</Badge>}
            </div>
            <h3 className="text-xl font-bold text-slate-900">{exam.exam_name}</h3>
            <p className="text-sm text-slate-400 mt-0.5">{exam.exam_code} · {exam.conducting_authority}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 shrink-0 ml-3">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Row label="Registration Period" value={exam.registration_period} />
            <Row label="Exam Period" value={exam.exam_period} />
          </div>

          {exam.eligibility && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Eligibility</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{exam.eligibility}</p>
            </div>
          )}

          {exam.exam_pattern && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Exam Pattern</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">
                {typeof exam.exam_pattern === 'object' ? JSON.stringify(exam.exam_pattern) : exam.exam_pattern}
              </p>
            </div>
          )}

          {exam.syllabus_highlights && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Syllabus Highlights</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{exam.syllabus_highlights}</p>
            </div>
          )}

          {exam.counseling_info && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Counselling Process</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-slate-50 rounded-xl p-4">{exam.counseling_info}</p>
            </div>
          )}

          {exam.cutoff_notes && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Cutoff Notes</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-amber-50 border border-amber-100 rounded-xl p-4">{exam.cutoff_notes}</p>
            </div>
          )}

          {exam.preparation_tips && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-1.5">Preparation Tips</p>
              <p className="text-sm text-slate-700 leading-relaxed bg-emerald-50 border border-emerald-100 rounded-xl p-4">{exam.preparation_tips}</p>
            </div>
          )}

          {exam.important_books?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Recommended Books</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(exam.important_books) ? exam.important_books : [exam.important_books]).map((b, i) => (
                  <span key={i} className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-lg font-medium">{b}</span>
                ))}
              </div>
            </div>
          )}

          {exam.useful_for_states?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Useful For States</p>
              <div className="flex flex-wrap gap-2">
                {(Array.isArray(exam.useful_for_states) ? exam.useful_for_states : [exam.useful_for_states]).map((s, i) => (
                  <Badge key={i} color="blue" size="sm">{s}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {exam.official_url && (
          <div className="px-6 py-4 border-t border-slate-100 shrink-0 flex gap-3">
            <Button variant="secondary" size="md" onClick={onClose} className="flex-1">Close</Button>
            <a href={exam.official_url} target="_blank" rel="noreferrer" className="flex-1">
              <Button variant="primary" size="md" className="w-full">
                <ExternalLink size={14} /> Official Website
              </Button>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CGEntranceExams() {
  const { lists } = useMasters(['entrance_exam_scope']);
  const TYPES = ['all', ...(lists.entrance_exam_scope || []).map(o => o.value)];
  const [exams, setExams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [selected, setSelected] = useState(null);

  const load = (params = {}) => {
    setLoading(true);
    api.get('/cg/entrance-exams', { page: params.page || 1, per_page: 12, ...params })
      .then(({ data }) => {
        if (data.bool) {
          setExams(data.response.exams || []);
          setPages(data.pagination?.pages || 1);
        } else setExams([]);
      })
      .catch(() => setExams([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load({ page, exam_type: type !== 'all' ? type : undefined, search: search || undefined });
  }, [page, type]);

  const handleSearch = (e) => {
    e.preventDefault();
    setPage(1);
    load({ page: 1, exam_type: type !== 'all' ? type : undefined, search: search || undefined });
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Entrance Exams"
        subtitle="Browse JEE, EAMCET, GATE, NEET, ECET and more — with eligibility, syllabus & preparation tips"
      />

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <SearchBar value={search} onChange={setSearch} onSubmit={handleSearch} placeholder="Search exams…" className="flex-1" />
        <FilterPills
          options={TYPES}
          active={type}
          onSelect={(t) => { setType(t); setPage(1); }}
          formatLabel={(t) => t === 'all' ? 'All Types' : t.charAt(0).toUpperCase() + t.slice(1)}
        />
      </div>

      {loading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : exams.length === 0 ? (
        <EmptyState icon={BookOpen} title="No entrance exams found" subtitle="Try a different search or filter" />
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {exams.map((e) => <ExamCard key={e.id} exam={e} onClick={setSelected} />)}
        </div>
      )}

      <Pagination page={page} pages={pages} onPage={setPage} />
      {selected && <ExamDetailModal exam={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
