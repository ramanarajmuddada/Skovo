import React, { useState, useEffect } from 'react';
import { adminApi } from '../../services/api';
import { ClipboardList, Plus, Edit2, Trash2, ChevronDown, ChevronUp, Eye, ToggleLeft, ToggleRight, X } from 'lucide-react';
import { Th, Td, TableShell, LoadingRows, EmptyState, Pagination, StatusBadge, ActionBtn, ConfirmModal } from '../../components/ui/TableComponents';
import { FormSelect } from '../../components/ui/index.jsx';
import { useMasters } from '../../hooks/useMasters';

function MockTestDetailModal({ item: t, onClose, onEdit }) {
  if (!t) return null;
  const rows = [
    { label: 'Title', value: t.title || '—' },
    { label: 'Exam Type', value: t.exam_type || '—' },
    { label: 'Duration', value: `${t.duration_minutes} min` },
    { label: 'Total Marks', value: t.total_marks },
    { label: 'Pass Marks', value: t.pass_marks },
    { label: 'Difficulty', value: t.difficulty },
    { label: 'Status', value: t.is_active ? 'Active' : 'Inactive' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">Mock Test Details</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"><X size={18} /></button>
        </div>
        <div className="px-6 py-5">
          {t.description && <p className="text-sm text-slate-600 mb-4">{t.description}</p>}
          <div className="space-y-1">
            {rows.map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-slate-50">
                <span className="text-xs text-slate-400 font-medium w-28 shrink-0">{label}</span>
                <span className="text-sm font-semibold text-slate-800 text-right capitalize">{value}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          {onEdit && <button onClick={() => { onEdit(t); onClose(); }} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 text-blue-600 hover:bg-blue-100 transition-colors">Edit</button>}
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors">Close</button>
        </div>
      </div>
    </div>
  );
}

const EMPTY_TEST = { title: '', exam_type: '', description: '', duration_minutes: 60, total_marks: 100, pass_marks: 40, difficulty: 'medium', is_active: true };
const EMPTY_Q = { question_text: '', question_type: 'mcq', options: [{ key: 'A', value: '' }, { key: 'B', value: '' }, { key: 'C', value: '' }, { key: 'D', value: '' }], correct_answer: '', explanation: '', marks: 1 };

export default function AdminMockTests() {
  const { lists } = useMasters(['question_difficulty', 'question_type']);
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState(EMPTY_TEST);
  const [editId, setEditId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [expandedTest, setExpandedTest] = useState(null);
  const [questions, setQuestions] = useState([]);
  const [qModal, setQModal] = useState(false);
  const [qForm, setQForm] = useState(EMPTY_Q);
  const [editQId, setEditQId] = useState(null);
  const [view, setView] = useState(null);
  const [confirm, setConfirm] = useState(null);

  useEffect(() => { load(); }, []);

  const load = async () => {
    setLoading(true);
    try {
      const { data } = await adminApi.get('/skovo-platform-panel-admin/mock-tests');
      if (data.bool) {
        setTests(data.response.tests || []);
        setTotal((data.response.tests || []).length);
      }
    } catch {}
    setLoading(false);
  };

  const openAdd = () => { setForm(EMPTY_TEST); setEditId(null); setModal(true); };
  const openEdit = (t) => {
    setForm({ title: t.title, exam_type: t.exam_type || '', description: t.description || '',
      duration_minutes: t.duration_minutes, total_marks: t.total_marks, pass_marks: t.pass_marks,
      difficulty: t.difficulty, is_active: t.is_active });
    setEditId(t.id); setModal(true);
  };

  const save = async () => {
    if (!form.title.trim()) return alert('Title required.');
    setSaving(true);
    try {
      const { data } = editId
        ? await adminApi.put(`/skovo-platform-panel-admin/mock-tests/${editId}`, form)
        : await adminApi.post('/skovo-platform-panel-admin/mock-tests', form);
      if (data.bool) { setModal(false); load(); }
    } catch {}
    setSaving(false);
  };

  const remove = async (t) => {
    try { await adminApi.delete(`/skovo-platform-panel-admin/mock-tests/${t.id}`); load(); } catch {}
  };

  const toggleActive = async (t) => {
    try {
      const { data } = await adminApi.patch(`/skovo-platform-panel-admin/mock-tests/${t.id}`, { is_active: !t.is_active });
      if (data.bool) setTests(prev => prev.map(x => x.id === t.id ? { ...x, is_active: !t.is_active } : x));
    } catch {}
  };

  const loadQuestions = async (testId) => {
    setExpandedTest(testId === expandedTest ? null : testId);
    if (testId === expandedTest) return;
    try {
      const { data } = await adminApi.get(`/skovo-platform-panel-admin/mock-tests/${testId}/questions`);
      if (data.bool) setQuestions(data.response.questions || []);
    } catch {}
  };

  const openAddQ = () => { setQForm(EMPTY_Q); setEditQId(null); setQModal(true); };
  const openEditQ = (q) => {
    setQForm({ question_text: q.question_text, question_type: q.question_type,
      options: q.options || [{ key: 'A', value: '' }, { key: 'B', value: '' }, { key: 'C', value: '' }, { key: 'D', value: '' }],
      correct_answer: q.correct_answer || '', explanation: q.explanation || '', marks: q.marks });
    setEditQId(q.id); setQModal(true);
  };

  const saveQ = async () => {
    if (!qForm.question_text.trim()) return alert('Question text required.');
    try {
      const payload = { ...qForm };
      const { data } = editQId
        ? await adminApi.put(`/skovo-platform-panel-admin/mock-tests/${expandedTest}/questions/${editQId}`, payload)
        : await adminApi.post(`/skovo-platform-panel-admin/mock-tests/${expandedTest}/questions`, payload);
      if (data.bool) {
        setQModal(false);
        const { data: qData } = await adminApi.get(`/skovo-platform-panel-admin/mock-tests/${expandedTest}/questions`);
        if (qData.bool) setQuestions(qData.response.questions || []);
      }
    } catch {}
  };

  const removeQ = async (qId) => {
    if (!window.confirm('Delete question?')) return;
    try {
      await adminApi.delete(`/skovo-platform-panel-admin/mock-tests/${expandedTest}/questions/${qId}`);
      setQuestions(prev => prev.filter(q => q.id !== qId));
    } catch {}
  };

  // Client-side pagination since API returns all tests at once
  const pages = Math.max(1, Math.ceil(tests.length / perPage));
  const pagedTests = tests.slice((page - 1) * perPage, page * perPage);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ClipboardList size={22} className="text-purple-500" />
          <h1 className="text-xl font-bold text-slate-900">Mock Tests</h1>
        </div>
        <button onClick={openAdd} className="flex items-center gap-2 px-4 py-2 bg-purple-500 text-white rounded-xl text-sm font-medium hover:bg-purple-600 transition-colors">
          <Plus size={16} />New Test
        </button>
      </div>

      <TableShell>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <Th>S.No</Th>
                <Th>Actions</Th>
                <Th>Title</Th>
                <Th>Exam Type</Th>
                <Th>Duration</Th>
                <Th>Marks</Th>
                <Th>Difficulty</Th>
                <Th>Status</Th>
                <Th>Questions</Th>
              </tr>
            </thead>
            {loading ? <LoadingRows cols={9} rows={5} /> : (
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {pagedTests.map((t, idx) => (
                  <React.Fragment key={t.id}>
                    <tr onClick={() => setView(t)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View" color="indigo" onClick={() => setView(t)} />
                          <ActionBtn icon={Edit2} tooltip="Edit" color="blue" onClick={() => openEdit(t)} />
                          <ActionBtn
                            icon={expandedTest === t.id ? ChevronUp : ClipboardList}
                            tooltip="View questions"
                            color="violet"
                            onClick={() => loadQuestions(t.id)}
                          />
                          <ActionBtn
                            icon={t.is_active ? ToggleRight : ToggleLeft}
                            tooltip={t.is_active ? 'Disable' : 'Enable'}
                            color={t.is_active ? 'green' : 'amber'}
                            onClick={() => toggleActive(t)}
                          />
                          <ActionBtn icon={Trash2} tooltip="Delete" color="red" onClick={() => setConfirm(t)} />
                        </div>
                      </Td>
                      <Td>
                        <p className="font-semibold text-slate-900">{t.title}</p>
                        {t.description && <p className="text-xs text-slate-400 mt-0.5 max-w-xs truncate">{t.description}</p>}
                      </Td>
                      <Td>
                        {t.exam_type ? (
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">{t.exam_type}</span>
                        ) : <span className="text-slate-400">—</span>}
                      </Td>
                      <Td><span className="text-xs text-slate-600">{t.duration_minutes} min</span></Td>
                      <Td>
                        <span className="text-xs text-slate-600">{t.total_marks} total</span>
                        <span className="text-xs text-slate-400 ml-1">/ {t.pass_marks} pass</span>
                      </Td>
                      <Td>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${
                          t.difficulty === 'easy' ? 'bg-emerald-50 text-emerald-700' :
                          t.difficulty === 'hard' ? 'bg-red-50 text-red-600' :
                          'bg-amber-50 text-amber-700'
                        }`}>{t.difficulty}</span>
                      </Td>
                      <Td>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${t.is_active ? 'bg-green-100 text-green-600' : 'bg-slate-100 text-slate-500'}`}>
                          {t.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </Td>
                      <Td>
                        <button
                          onClick={(e) => { e.stopPropagation(); loadQuestions(t.id); }}
                          className="flex items-center gap-1 text-xs font-medium text-purple-600 hover:text-purple-800 transition-colors"
                        >
                          {expandedTest === t.id ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          {expandedTest === t.id ? 'Hide' : 'Show'}
                        </button>
                      </Td>
                    </tr>
                    {expandedTest === t.id && (
                      <tr>
                        <td colSpan={9} className="bg-slate-50 px-6 py-4">
                          <div className="space-y-3">
                            <div className="flex items-center justify-between">
                              <p className="text-sm font-medium text-slate-700">{questions.length} Questions</p>
                              <button onClick={openAddQ} className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-50 text-purple-600 rounded-xl hover:bg-purple-100 transition-colors font-medium">
                                <Plus size={12} />Add Question
                              </button>
                            </div>
                            {questions.map((q, qi) => (
                              <div key={q.id} className="flex items-start gap-3 bg-white rounded-xl p-3 border border-slate-200">
                                <span className="text-purple-500 font-bold text-sm shrink-0">Q{qi + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-slate-800">{q.question_text}</p>
                                  <p className="text-xs text-slate-400 mt-0.5">{q.question_type} · {q.marks} mark{q.marks > 1 ? 's' : ''} · Answer: {q.correct_answer}</p>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                  <ActionBtn icon={Edit2} tooltip="Edit question" color="blue" onClick={() => openEditQ(q)} />
                                  <ActionBtn icon={Trash2} tooltip="Delete question" color="red" onClick={() => removeQ(q.id)} />
                                </div>
                              </div>
                            ))}
                            {questions.length === 0 && (
                              <p className="text-xs text-slate-400 text-center py-4">No questions yet. Add your first question.</p>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {tests.length === 0 && !loading && (
          <EmptyState icon={ClipboardList} message="No mock tests yet. Create your first test." />
        )}
        <Pagination
          page={page}
          pages={pages}
          total={total}
          perPage={perPage}
          onPage={(p) => setPage(p)}
          onPerPage={(pp) => { setPerPage(pp); setPage(1); }}
        />
      </TableShell>

      {/* Test Modal */}
      {modal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editId ? 'Edit Test' : 'Create Test'}</h2>
            <div className="space-y-3">
              <input placeholder="Test Title *" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input placeholder="Exam Type (JEE, NEET…)" value={form.exam_type} onChange={e => setForm(f => ({ ...f, exam_type: e.target.value }))}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
                <FormSelect searchType="question_difficulty"
                  value={form.difficulty}
                  onChange={v => setForm(f => ({ ...f, difficulty: v }))}
                  options={lists.question_difficulty || []}
                  clearable={false} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div><label className="text-xs text-slate-500 mb-1 block">Duration (min)</label>
                  <input type="number" value={form.duration_minutes} onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) || 60 }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" /></div>
                <div><label className="text-xs text-slate-500 mb-1 block">Total Marks</label>
                  <input type="number" value={form.total_marks} onChange={e => setForm(f => ({ ...f, total_marks: parseInt(e.target.value) || 100 }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" /></div>
                <div><label className="text-xs text-slate-500 mb-1 block">Pass Marks</label>
                  <input type="number" value={form.pass_marks} onChange={e => setForm(f => ({ ...f, pass_marks: parseInt(e.target.value) || 40 }))}
                    className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" /></div>
              </div>
              <textarea placeholder="Description" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300" />
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.is_active} onChange={e => setForm(f => ({ ...f, is_active: e.target.checked }))} className="accent-purple-500" />
                Active (visible to students)
              </label>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={save} disabled={saving} className="flex-1 py-2 bg-purple-500 text-white rounded-xl text-sm font-medium hover:bg-purple-600 transition-colors disabled:opacity-50">
                {saving ? 'Saving…' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Question Modal */}
      {qModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={() => setQModal(false)}>
          <div className="bg-white rounded-2xl w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <h2 className="font-bold text-slate-900">{editQId ? 'Edit Question' : 'Add Question'}</h2>
            <div className="space-y-3">
              <textarea placeholder="Question Text *" value={qForm.question_text} onChange={e => setQForm(f => ({ ...f, question_text: e.target.value }))} rows={3}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <FormSelect searchType="question_type"
                  value={qForm.question_type}
                  onChange={v => setQForm(f => ({ ...f, question_type: v }))}
                  options={lists.question_type || []}
                  clearable={false} />
                <input placeholder="Marks" type="number" value={qForm.marks} onChange={e => setQForm(f => ({ ...f, marks: parseInt(e.target.value) || 1 }))}
                  className="border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
              </div>
              {qForm.question_type === 'mcq' && (
                <div className="space-y-2">
                  <p className="text-xs text-slate-500 font-medium">Options</p>
                  {(qForm.options || []).map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs font-bold text-slate-500 w-5">{opt.key}</span>
                      <input placeholder={`Option ${opt.key}`} value={opt.value} onChange={e => {
                        const opts = [...qForm.options]; opts[i] = { ...opts[i], value: e.target.value };
                        setQForm(f => ({ ...f, options: opts }));
                      }} className="flex-1 border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
                    </div>
                  ))}
                </div>
              )}
              <input placeholder="Correct Answer (e.g. A or the answer text)" value={qForm.correct_answer} onChange={e => setQForm(f => ({ ...f, correct_answer: e.target.value }))}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300" />
              <textarea placeholder="Explanation (optional)" value={qForm.explanation} onChange={e => setQForm(f => ({ ...f, explanation: e.target.value }))} rows={2}
                className="w-full border border-slate-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300" />
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setQModal(false)} className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
              <button onClick={saveQ} className="flex-1 py-2 bg-purple-500 text-white rounded-xl text-sm font-medium hover:bg-purple-600 transition-colors">
                {editQId ? 'Update' : 'Add Question'}
              </button>
            </div>
          </div>
        </div>
      )}

      {view && <MockTestDetailModal item={view} onClose={() => setView(null)} onEdit={openEdit} />}

      {confirm && (
        <ConfirmModal
          message="Delete this test?"
          detail={confirm.title}
          danger
          confirmLabel="Delete"
          onConfirm={() => { remove(confirm); setConfirm(null); }}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
