import React, { useState, useEffect, useRef } from 'react';
import { api } from '../services/api';
import { ClipboardList, PlayCircle, Clock, Trophy, Eye, X } from 'lucide-react';
import { Th, Td, TableShell, EmptyState, StatusBadge, ActionBtn, Pagination } from '../components/ui/TableComponents';

const DIFF_COLOR = { easy: 'green', medium: 'yellow', hard: 'red' };
const DIFF_BADGE = { easy: 'paid', medium: 'pending', hard: 'cancelled' };

// ── Mock Test Detail Modal ────────────────────────────────────────────────────
function MockTestDetailModal({ item: a, onClose }) {
  if (!a) return null;
  const rows = [
    { label: 'Title', value: a.title || '—' },
    { label: 'Exam Type', value: a.exam_type || '—' },
    { label: 'Difficulty', value: (a.difficulty || 'medium') },
    { label: 'Duration', value: `${a.duration_minutes} min` },
    { label: 'Total Marks', value: a.total_marks },
    { label: 'Attempts', value: a.attempts_count ?? 0 },
    { label: 'Best Score', value: a.attempts_count > 0 ? `${a.best_score}%` : '—' },
    { label: 'Description', value: a.description || '—' },
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

export default function MockTests() {
  const [tests, setTests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTest, setActiveTest] = useState(null);
  const [attempt, setAttempt] = useState(null);
  const [answers, setAnswers] = useState({});
  const [result, setResult] = useState(null);
  const [myAttempts, setMyAttempts] = useState([]);
  const [tab, setTab] = useState('browse');
  const [timeLeft, setTimeLeft] = useState(null);
  const [view, setView] = useState(null);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);
  const timerRef = useRef(null);

  useEffect(() => {
    loadTests();
    loadAttempts();
  }, []);

  useEffect(() => {
    if (timeLeft === null) return;
    if (timeLeft <= 0) { submitTest(); return; }
    timerRef.current = setTimeout(() => setTimeLeft(t => t - 1), 1000);
    return () => clearTimeout(timerRef.current);
  }, [timeLeft]);

  const loadTests = async () => {
    try {
      const { data } = await api.get('/mock-tests/');
      if (data.bool) setTests(data.response.tests || []);
    } catch {}
    setLoading(false);
  };

  const loadAttempts = async () => {
    try {
      const { data } = await api.get('/mock-tests/my-attempts');
      if (data.bool) setMyAttempts(data.response.attempts || []);
    } catch {}
  };

  const startTest = async (test) => {
    try {
      const { data } = await api.post(`/mock-tests/${test.id}/start`);
      if (data.bool) {
        setActiveTest({ ...test, questions: data.response.questions });
        setAttempt(data.response);
        setAnswers({});
        setResult(null);
        setTimeLeft((data.response.duration_minutes || 60) * 60);
        setTab('taking');
      }
    } catch (e) { alert('Failed to start test.'); }
  };

  const submitTest = async () => {
    clearTimeout(timerRef.current);
    setTimeLeft(null);
    try {
      const { data } = await api.post(`/mock-tests/attempts/${attempt.attempt_id}/submit`, { answers });
      if (data.bool) {
        setResult(data.response);
        setTab('result');
        loadAttempts();
      }
    } catch { alert('Submit failed.'); }
  };

  const fmtTime = (s) => {
    const m = Math.floor(s / 60), sec = s % 60;
    return `${m}:${sec.toString().padStart(2, '0')}`;
  };

  if (loading) return <div className="p-8 text-slate-500">Loading mock tests…</div>;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-purple-500 flex items-center justify-center">
          <ClipboardList size={20} className="text-white" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900">Mock Tests</h1>
          <p className="text-sm text-slate-500">Practice for your exams with timed tests</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-200">
        {[['browse', 'Browse Tests'], ['history', 'My Attempts']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${tab === k ? 'border-purple-500 text-purple-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {l}
          </button>
        ))}
      </div>

      {/* Browse Tests */}
      {tab === 'browse' && (() => {
        const total = tests.length;
        const pages = Math.max(1, Math.ceil(total / perPage));
        const pageItems = tests.slice((page - 1) * perPage, page * perPage);
        return (
          <TableShell>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <Th>S.No</Th>
                    <Th>Actions</Th>
                    <Th>Test</Th>
                    <Th>Exam Type</Th>
                    <Th>Difficulty</Th>
                    <Th right>Duration</Th>
                    <Th right>Marks</Th>
                    <Th right>Best Score</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                  {pageItems.map((t, idx) => (
                    <tr key={t.id} onClick={() => setView(t)} className="hover:bg-slate-50 transition-colors cursor-pointer">
                      <Td><span className="text-xs text-slate-400">{(page - 1) * perPage + idx + 1}</span></Td>
                      <Td>
                        <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                          <ActionBtn icon={Eye} tooltip="View details" color="indigo"
                            onClick={() => setView(t)} />
                          <ActionBtn icon={PlayCircle} tooltip={t.attempts_count > 0 ? 'Retake Test' : 'Start Test'} color="violet"
                            onClick={() => startTest(t)} />
                        </div>
                      </Td>
                      <Td>
                        <span className="font-semibold text-slate-900 max-w-xs truncate block">{t.title}</span>
                        {t.description && <span className="text-[10px] text-slate-400 truncate max-w-xs block">{t.description}</span>}
                      </Td>
                      <Td><span className="text-xs text-slate-500">{t.exam_type || '—'}</span></Td>
                      <Td><StatusBadge status={DIFF_BADGE[t.difficulty] || 'pending'} label={(t.difficulty || 'medium')} /></Td>
                      <Td right><span className="text-xs text-slate-600 inline-flex items-center gap-1"><Clock size={11} className="text-slate-400" />{t.duration_minutes} min</span></Td>
                      <Td right><span className="text-xs font-semibold text-slate-700">{t.total_marks}</span></Td>
                      <Td right>
                        {t.attempts_count > 0
                          ? <span className="text-xs font-bold text-emerald-600 inline-flex items-center gap-1"><Trophy size={11} />{t.best_score}%</span>
                          : <span className="text-xs text-slate-400">—</span>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {total === 0 && (
              <EmptyState icon={ClipboardList} message="No mock tests available yet" sub="Check back soon for new tests" />
            )}
            {total > 0 && (
              <Pagination page={page} pages={pages} total={total} perPage={perPage} onPage={setPage} onPerPage={setPerPage} />
            )}
          </TableShell>
        );
      })()}

      {/* Taking Test */}
      {tab === 'taking' && activeTest && (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 bg-purple-50 border-b border-purple-100">
            <div>
              <h2 className="font-bold text-slate-900">{activeTest.title}</h2>
              <p className="text-sm text-slate-500">{activeTest.questions?.length} questions · {activeTest.total_marks} marks</p>
            </div>
            <div className="flex items-center gap-4">
              {timeLeft !== null && (
                <span className={`text-lg font-mono font-bold ${timeLeft < 300 ? 'text-red-500' : 'text-slate-700'}`}>
                  <Clock size={16} className="inline mr-1" />{fmtTime(timeLeft)}
                </span>
              )}
              <button onClick={submitTest} className="px-4 py-2 bg-purple-500 text-white rounded-xl text-sm font-medium hover:bg-purple-600 transition-colors">
                Submit
              </button>
            </div>
          </div>
          {/* Questions */}
          <div className="p-6 space-y-6">
            {(activeTest.questions || []).map((q, qi) => (
              <div key={q.id} className="border border-slate-200 rounded-xl p-4">
                <p className="font-medium text-slate-900 mb-3">
                  <span className="text-purple-500 mr-2">Q{qi + 1}.</span>{q.question_text}
                </p>
                {q.question_type === 'mcq' && q.options && (
                  <div className="space-y-2">
                    {(Array.isArray(q.options) ? q.options : Object.entries(q.options).map(([k, v]) => ({ key: k, value: v }))).map((opt, oi) => {
                      const optKey = typeof opt === 'object' ? (opt.key || String.fromCharCode(65 + oi)) : String.fromCharCode(65 + oi);
                      const optVal = typeof opt === 'object' ? (opt.value || opt) : opt;
                      const selected = answers[q.id] === optKey;
                      return (
                        <label key={oi} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${selected ? 'bg-purple-50 border-purple-300' : 'border-slate-200 hover:border-slate-300'}`}>
                          <input type="radio" name={q.id} checked={selected} onChange={() => setAnswers(prev => ({ ...prev, [q.id]: optKey }))} className="accent-purple-500" />
                          <span className="text-sm text-slate-700"><span className="font-semibold mr-2">{optKey}.</span>{String(optVal)}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {q.question_type === 'text' && (
                  <textarea className="w-full border border-slate-200 rounded-xl p-3 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-300" rows={3}
                    placeholder="Your answer…" value={answers[q.id] || ''}
                    onChange={e => setAnswers(prev => ({ ...prev, [q.id]: e.target.value }))} />
                )}
                {q.question_type === 'true_false' && (
                  <div className="space-y-2">
                    {[{ key: 'true', label: 'True' }, { key: 'false', label: 'False' }].map((opt) => {
                      const selected = answers[q.id] === opt.key;
                      return (
                        <label key={opt.key} className={`flex items-center gap-3 p-3 rounded-xl cursor-pointer border transition-colors ${selected ? 'bg-purple-50 border-purple-300' : 'border-slate-200 hover:border-slate-300'}`}>
                          <input type="radio" name={q.id} checked={selected} onChange={() => setAnswers(prev => ({ ...prev, [q.id]: opt.key }))} className="accent-purple-500" />
                          <span className="text-sm text-slate-700">{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="px-6 pb-6">
            <button onClick={submitTest} className="w-full py-3 bg-purple-500 text-white rounded-xl font-semibold hover:bg-purple-600 transition-colors">
              Submit Test
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {tab === 'result' && result && (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-4">
          <div className={`w-20 h-20 rounded-full mx-auto flex items-center justify-center text-3xl font-black ${result.passed ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-500'}`}>
            {result.passed ? '🎉' : '😓'}
          </div>
          <h2 className="text-2xl font-bold text-slate-900">{result.passed ? 'You Passed!' : 'Keep Practicing!'}</h2>
          <div className="flex items-center justify-center gap-8">
            <div><p className="text-3xl font-black text-purple-600">{result.percentage}%</p><p className="text-sm text-slate-500">Score</p></div>
            <div><p className="text-3xl font-black text-slate-900">{result.score}/{result.total_marks}</p><p className="text-sm text-slate-500">Marks</p></div>
          </div>
          <button onClick={() => { setTab('browse'); setActiveTest(null); setResult(null); }}
            className="px-6 py-2 bg-purple-500 text-white rounded-xl font-medium hover:bg-purple-600 transition-colors">
            Back to Tests
          </button>
        </div>
      )}

      {/* History */}
      {tab === 'history' && (
        <TableShell>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <Th>S.No</Th>
                  <Th>Test</Th>
                  <Th>Exam Type</Th>
                  <Th>Completed</Th>
                  <Th right>Score</Th>
                  <Th right>Percentage</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 mo-stagger-fade">
                {myAttempts.map((a, idx) => (
                  <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                    <Td><span className="text-xs text-slate-400">{idx + 1}</span></Td>
                    <Td><span className="font-semibold text-slate-900">{a.test_title}</span></Td>
                    <Td><span className="text-xs text-slate-500">{a.exam_type || '—'}</span></Td>
                    <Td>
                      <span className="text-xs text-slate-500">
                        {a.completed_at ? new Date(a.completed_at).toLocaleDateString('en-IN', { dateStyle: 'medium' }) : 'In progress'}
                      </span>
                    </Td>
                    <Td right>
                      <span className="font-semibold text-slate-900">{a.score}/{a.total_marks}</span>
                    </Td>
                    <Td right>
                      <span className={`font-bold text-lg ${(a.percentage ?? 0) >= 60 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {a.percentage ?? '—'}%
                      </span>
                    </Td>
                    <Td>
                      <StatusBadge status={a.passed ? 'completed' : 'cancelled'} label={a.passed ? 'Passed' : 'Failed'} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {myAttempts.length === 0 && (
            <EmptyState icon={ClipboardList} message="No attempts yet" sub="Start a test to see your history" />
          )}
        </TableShell>
      )}

      {view && <MockTestDetailModal item={view} onClose={() => setView(null)} />}
    </div>
  );
}
