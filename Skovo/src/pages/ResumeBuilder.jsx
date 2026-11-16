import React, { useState, useEffect } from 'react';
import { api } from '../services/api';
import { FileText, Plus, Trash2, Save, ChevronDown, ChevronUp, User, Briefcase, GraduationCap, Code2, FolderGit2, Award, Languages, Eye, Pencil, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Th, Td, TableShell, EmptyState, ActionBtn, ConfirmModal } from '../components/ui/TableComponents';

function ResumeDetailModal({ item: a, onClose, onEdit }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Template', value: a.template || '—' },
    { label: 'Updated', value: a.updated_at ? new Date(a.updated_at).toLocaleDateString() : '—' },
  ];
  return (<div className="fixed inset-0 z-50 flex items-center justify-center p-4"><div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} /><div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden"><div className="flex items-center justify-between px-6 py-4 border-b border-slate-100"><h2 className="text-base font-bold text-slate-900">Resume Details</h2><button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button></div><div className="px-6 py-5"><div className="space-y-1">{rows.map(({ label, value }) => (<div key={label} className="flex items-center justify-between py-2 border-b border-slate-50"><span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span><span className="text-sm font-semibold text-slate-800 text-right">{value}</span></div>))}</div></div><div className="px-6 pb-5 flex gap-3">{onEdit && <button onClick={() => { onEdit(a); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}<button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button></div></div></div>);
}

const EMPTY_RESUME = {
  title: 'My Resume', template: 'classic',
  personal_info: { name: '', email: '', phone: '', location: '', linkedin: '', website: '' },
  summary: '',
  education: [], experience: [], skills: [], projects: [], certifications: [], achievements: [], languages: [],
};

const SECTION_ICONS = {
  personal_info: User, summary: FileText, education: GraduationCap,
  experience: Briefcase, skills: Code2, projects: FolderGit2,
  certifications: Award, achievements: Award, languages: Languages,
};

export default function ResumeBuilder() {
  const { user } = useAuth();
  const [resumes, setResumes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_RESUME);
  const [saving, setSaving] = useState(false);
  const [expandedSection, setExpandedSection] = useState('personal_info');
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { loadResumes(); }, []);

  useEffect(() => {
    if (editing === 'new' && user) {
      setForm({
        ...EMPTY_RESUME,
        personal_info: { ...EMPTY_RESUME.personal_info, name: user.full_name || '', email: user.email || '', phone: user.phone || '' },
      });
    }
  }, [editing, user]);

  const loadResumes = async () => {
    try {
      const { data } = await api.get('/resumes/');
      if (data.bool) setResumes(data.response.resumes || []);
    } catch {}
    setLoading(false);
  };

  const openResume = async (r) => {
    try {
      const { data } = await api.get(`/resumes/${r.id}`);
      if (data.bool) { setForm(data.response); setEditing(r.id); }
    } catch {}
  };

  const save = async () => {
    setSaving(true);
    try {
      const { data } = editing === 'new'
        ? await api.post('/resumes/', form)
        : await api.put(`/resumes/${editing}`, form);
      if (data.bool) {
        loadResumes();
        if (editing === 'new') setEditing(null);
        else alert('Saved successfully!');
      }
    } catch {}
    setSaving(false);
  };

  const remove = async (id) => {
    try { await api.delete(`/resumes/${id}`); loadResumes(); } catch {}
    setConfirm(null);
  };

  if (loading) return <div className="p-8 text-slate-500">Loading…</div>;

  // Resume list view
  if (!editing) return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500 flex items-center justify-center">
            <FileText size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900">Resume Builder</h1>
            <p className="text-sm text-slate-500">Create and manage professional resumes</p>
          </div>
        </div>
        <button onClick={() => setEditing('new')} className="flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-xl text-sm font-medium hover:bg-rose-600 transition-colors">
          <Plus size={16} />New Resume
        </button>
      </div>
      <TableShell>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <Th>S.No</Th>
              <Th>Actions</Th>
              <Th>Title</Th>
              <Th>Template</Th>
              <Th>Updated</Th>
            </tr>
          </thead>
          <tbody>
            {resumes.length === 0 ? (
              <tr><td colSpan={5}><EmptyState icon={FileText} message="No resumes yet." /></td></tr>
            ) : resumes.map((r, idx) => (
              <tr key={r.id} onClick={() => setView(r)} className="hover:bg-slate-50 transition-colors cursor-pointer border-b border-slate-100">
                <Td>{idx + 1}</Td>
                <Td>
                  <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                    <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(r)} />
                    <ActionBtn icon={Pencil} tooltip="Edit" color="blue" onClick={() => openResume(r)} />
                    <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(r)} />
                  </div>
                </Td>
                <Td><span className="font-medium text-slate-900">{r.title}</span></Td>
                <Td className="text-slate-500 capitalize">{r.template || '—'}</Td>
                <Td className="text-slate-500">{r.updated_at ? new Date(r.updated_at).toLocaleDateString() : '—'}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableShell>

      {view && <ResumeDetailModal item={view} onClose={() => setView(null)} onEdit={openResume} />}
      {confirm && (
        <ConfirmModal
          message="Delete this resume?"
          detail={confirm.title}
          danger
          confirmLabel="Delete"
          onConfirm={() => remove(confirm.id)}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );

  // Resume editor view
  const Section = ({ id, label, children }) => {
    const Icon = SECTION_ICONS[id] || FileText;
    const open = expandedSection === id;
    return (
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <button onClick={() => setExpandedSection(open ? null : id)}
          className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
          <div className="flex items-center gap-2">
            <Icon size={16} className="text-rose-500" />
            <span className="font-medium text-slate-800 text-sm">{label}</span>
          </div>
          {open ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
        </button>
        {open && <div className="px-4 pb-4 border-t border-slate-100">{children}</div>}
      </div>
    );
  };

  const pi = form.personal_info || {};
  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => { setEditing(null); loadResumes(); }} className="p-2 text-slate-400 hover:text-slate-700 transition-colors">←</button>
          <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
            className="text-xl font-bold text-slate-900 border-none outline-none bg-transparent" />
        </div>
        <button onClick={save} disabled={saving} className="flex items-center gap-2 px-4 py-2 bg-rose-500 text-white rounded-xl text-sm font-medium hover:bg-rose-600 transition-colors disabled:opacity-50">
          <Save size={15} />{saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <Section id="personal_info" label="Personal Information">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3">
          {[['name', 'Full Name'], ['email', 'Email'], ['phone', 'Phone'], ['location', 'Location'], ['linkedin', 'LinkedIn URL'], ['website', 'Website/Portfolio']].map(([k, l]) => (
            <input key={k} placeholder={l} value={pi[k] || ''} onChange={e => setForm(f => ({ ...f, personal_info: { ...f.personal_info, [k]: e.target.value } }))}
              className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
          ))}
        </div>
      </Section>

      <Section id="summary" label="Professional Summary">
        <textarea value={form.summary || ''} onChange={e => setForm(f => ({ ...f, summary: e.target.value }))} rows={4} placeholder="Write a brief professional summary…"
          className="w-full mt-3 border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-300" />
      </Section>

      <Section id="education" label="Education">
        <div className="pt-3 space-y-2">
          {(form.education || []).map((e, i) => (
            <div key={i} className="flex items-center gap-2 bg-slate-50 rounded-xl p-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm text-slate-900">{e.institution || 'Institution'}</p>
                <p className="text-xs text-slate-500">{e.degree} {e.field && `· ${e.field}`} {e.year && `· ${e.year}`}</p>
              </div>
              <button onClick={() => setForm(f => ({ ...f, education: f.education.filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
            </div>
          ))}
          <button onClick={() => setForm(f => ({ ...f, education: [...(f.education || []), { institution: '', degree: '', field: '', year: '', gpa: '' }] }))}
            className="flex items-center gap-2 text-sm text-rose-500 hover:text-rose-600 font-medium"><Plus size={14} />Add Education</button>
          {(form.education || []).map((e, i) => (
            <div key={`edit-${i}`} className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[['institution', 'Institution *'], ['degree', 'Degree'], ['field', 'Field of Study'], ['year', 'Year'], ['gpa', 'GPA/Score']].map(([k, l]) => (
                <input key={k} placeholder={l} value={e[k] || ''} onChange={ev => {
                  const edu = [...form.education]; edu[i] = { ...edu[i], [k]: ev.target.value };
                  setForm(f => ({ ...f, education: edu }));
                }} className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300" />
              ))}
            </div>
          ))}
        </div>
      </Section>

      <Section id="skills" label="Skills">
        <div className="pt-3">
          <textarea value={(form.skills || []).join(', ')} onChange={e => setForm(f => ({ ...f, skills: e.target.value.split(',').map(s => s.trim()).filter(Boolean) }))}
            rows={3} placeholder="Enter skills separated by commas: Python, React, SQL…"
            className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-300" />
          <div className="flex flex-wrap gap-2 mt-2">
            {(form.skills || []).map((s, i) => (
              <span key={i} className="px-2 py-1 bg-rose-50 text-rose-600 rounded-full text-xs font-medium">{s}</span>
            ))}
          </div>
        </div>
      </Section>

      {/* Generic repeated-entry sections */}
      {[
        { id: 'experience',     label: 'Work Experience', fields: [['company', 'Company *'], ['role', 'Role/Title'], ['duration', 'Duration (e.g. 2022–2024)'], ['description', 'Description']], titleKey: 'company', subKeys: ['role', 'duration'] },
        { id: 'projects',       label: 'Projects',        fields: [['name', 'Project Name *'], ['link', 'Link/URL'], ['description', 'Description']], titleKey: 'name', subKeys: ['link'] },
        { id: 'certifications', label: 'Certifications',  fields: [['name', 'Certificate *'], ['issuer', 'Issued By'], ['year', 'Year']], titleKey: 'name', subKeys: ['issuer', 'year'] },
      ].map(({ id, label, fields, titleKey, subKeys }) => (
        <Section key={id} id={id} label={label}>
          <div className="pt-3 space-y-2">
            {(form[id] || []).map((row, i) => (
              <div key={i} className="bg-slate-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-sm text-slate-900">{row[titleKey] || label}</p>
                  <button onClick={() => setForm(f => ({ ...f, [id]: f[id].filter((_, j) => j !== i) }))} className="text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {fields.map(([k, l]) => (
                    <input key={k} placeholder={l} value={row[k] || ''} onChange={ev => {
                      const arr = [...(form[id] || [])]; arr[i] = { ...arr[i], [k]: ev.target.value };
                      setForm(f => ({ ...f, [id]: arr }));
                    }} className={`border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-rose-300 ${k === 'description' ? 'col-span-2' : ''}`} />
                  ))}
                </div>
              </div>
            ))}
            <button onClick={() => setForm(f => ({ ...f, [id]: [...(f[id] || []), Object.fromEntries(fields.map(([k]) => [k, ''])) ] }))}
              className="flex items-center gap-2 text-sm text-rose-500 hover:text-rose-600 font-medium"><Plus size={14} />Add {label}</button>
          </div>
        </Section>
      ))}

      {/* Simple comma/line list sections */}
      {[
        { id: 'achievements', label: 'Achievements', placeholder: 'One achievement per line…', sep: '\n', joiner: '\n' },
        { id: 'languages',    label: 'Languages',    placeholder: 'Languages separated by commas: English, Hindi…', sep: ',', joiner: ', ' },
      ].map(({ id, label, placeholder, sep, joiner }) => (
        <Section key={id} id={id} label={label}>
          <div className="pt-3">
            <textarea value={(form[id] || []).join(joiner)} rows={3} placeholder={placeholder}
              onChange={e => setForm(f => ({ ...f, [id]: e.target.value.split(sep).map(s => s.trim()).filter(Boolean) }))}
              className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-rose-300" />
          </div>
        </Section>
      ))}
    </div>
  );
}
