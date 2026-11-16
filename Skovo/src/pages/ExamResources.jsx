import React, { useState, useEffect } from 'react';
import { useMasters } from '../hooks/useMasters';
import { api } from '../services/api';
import { Input, Textarea, FormSelect } from '../components/ui/index.jsx';
import { BookOpen, Download, ExternalLink, Search, Eye, X } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, StatusBadge, ActionBtn, Pagination } from '../components/ui/TableComponents';

// EXAM_TYPES comes from master data (masters.exam_resource_exam).
// RESOURCE_TYPES comes from master data (masters.exam_resource_type).

// ── Resource Detail Modal ─────────────────────────────────────────────────────
function ResourceDetailModal({ item: a, onClose }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Type', value: (a.resource_type || '—').replace('_', ' ') },
    { label: 'Exam', value: a.exam_type || '—' },
    { label: 'Subject', value: a.subject || '—' },
    { label: 'Access', value: a.is_free ? 'Free' : 'Premium' },
    { label: 'Downloads', value: a.downloads ?? 0 },
    { label: 'Description', value: a.description || '—' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Resource Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5">
          <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

export default function ExamResources() {
  const { lists } = useMasters(['exam_resource_exam', 'exam_resource_type']);
  const EXAM_TYPES = [...(lists.exam_resource_exam || []).map(o => o.value)];
  const RESOURCE_TYPES = [...(lists.exam_resource_type || []).map(o => o.value)];
  const [resources,     setResources]     = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [search,        setSearch]        = useState('');
  const [examType,      setExamType]      = useState('all');
  const [resourceType,  setResourceType]  = useState('all');
  const [view,          setView]          = useState(null);
  const [page,          setPage]          = useState(1);
  const [perPage,       setPerPage]       = useState(10);

  useEffect(() => { load(); }, [examType, resourceType]);

  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (examType !== 'all') params.set('exam_type', examType);
      if (resourceType !== 'all') params.set('resource_type', resourceType);
      const { data } = await api.get(`/exam-resources/?${params}`);
      if (data.bool) setResources(data.response.resources || []);
    } catch {}
    setLoading(false);
  };

  const handleDownload = async (r) => {
    try {
      const { data } = await api.post(`/exam-resources/${r.id}/download`);
      if (data.bool) {
        const url = data.response.file_url || data.response.external_url;
        if (url) window.open(url, '_blank');
      }
    } catch {}
  };

  const filtered = resources.filter(r =>
    !search || r.title.toLowerCase().includes(search.toLowerCase()) ||
    (r.subject && r.subject.toLowerCase().includes(search.toLowerCase()))
  );

  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const safePage = Math.min(page, pages);
  const pageItems = filtered.slice((safePage - 1) * perPage, safePage * perPage);

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-teal-500 flex items-center justify-center">
          <BookOpen size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Study Materials</h1>
          <p className="text-sm text-slate-500">Notes, question papers and resources for your exams</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-48">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search resources…" value={search} onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-teal-300" />
        </div>
        <FormSelect searchType="exam_resource_exam"
          className="sm:w-52"
          value={examType} onChange={setExamType} clearable={false}
          options={[{ value: 'all', label: 'All Exams' },
                    ...EXAM_TYPES.map(t => ({ value: t, label: t }))]}
        />
        <FormSelect searchType="exam_resource_type"
          className="sm:w-52"
          value={resourceType} onChange={setResourceType} clearable={false}
          options={[{ value: 'all', label: 'All Types' },
                    ...RESOURCE_TYPES.map(t => ({ value: t, label: t.replace('_', ' ') }))]}
        />
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Title</Th>
                <Th>Type</Th>
                <Th>Exam</Th>
                <Th>Subject</Th>
                <Th>Access</Th>
                <Th right>Downloads</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={8} rows={6} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pageItems.map((r, idx) => (
                  <tr key={r.id} onClick={() => setView(r)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                    <Td><span className="text-xs text-slate-400">{(safePage - 1) * perPage + idx + 1}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                        <ActionBtn icon={Eye} tooltip="View details" color="indigo"
                          onClick={() => setView(r)} />
                        <ActionBtn icon={r.file_url ? Download : ExternalLink} tooltip={r.file_url ? 'Download' : 'Open link'} color="green"
                          onClick={() => handleDownload(r)} />
                      </div>
                    </Td>
                    <Td>
                      <p className="font-semibold text-slate-900 max-w-xs truncate">{r.title}</p>
                      {r.description && <p className="text-xs text-slate-400 truncate max-w-xs">{r.description}</p>}
                    </Td>
                    <Td>
                      <StatusBadge status={r.resource_type || 'active'} label={(r.resource_type || '').replace('_', ' ')} />
                    </Td>
                    <Td><span className="text-xs text-slate-500">{r.exam_type || '—'}</span></Td>
                    <Td><span className="text-xs text-slate-500">{r.subject || '—'}</span></Td>
                    <Td>
                      {r.is_free
                        ? <StatusBadge status="free" label="Free" />
                        : <StatusBadge status="active" label="Premium" />}
                    </Td>
                    <Td right><span className="text-slate-600 font-medium">{r.downloads ?? 0}</span></Td>
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {!loading && total === 0 && (
          <EmptyState icon={BookOpen} message="No resources found" sub="Try different filters or search terms" />
        )}
        {!loading && total > 0 && (
          <Pagination page={safePage} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
        )}
      </TableShell>

      {view && <ResourceDetailModal item={view} onClose={() => setView(null)} />}
    </div>
  );
}
