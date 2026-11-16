import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import {
  CheckCircle, ChevronRight, ChevronLeft, Zap, Briefcase,
  Target, Users, Trophy, ArrowRight, RotateCcw,
} from 'lucide-react';

// Skills, career goals and the step 2 / step 4 questions all come from
// GET /readiness/assessment/options, which picks the set that matches the
// student's education stage. They used to be hardcoded here — one college-shaped
// list shown to everyone, so a 10th-class student was asked to claim Django and
// choose between Investment Banking and UI/UX Design. Since the assessment is
// worth 65 of the ~100 points and Opportunities unlocks at 60, that did not just
// read oddly: it put the gate out of reach for school students.
//
// These remain only as the fallback for a failed fetch, so the page still works
// offline rather than rendering an empty step.
const FALLBACK_SKILLS = ['Communication', 'Teamwork', 'Problem Solving', 'Time Management',
                         'Public Speaking', 'MS Office', 'Research', 'Leadership'];
const FALLBACK_GOALS = ['Higher studies', 'Government job', 'Private job',
                        'Start my own business', 'Not decided yet', 'Other'];

const STEPS_CONFIG = [
  {
    number: 1,
    title: 'Your Skills',
    subtitle: 'Select all skills you have — earn 2 pts per skill (max 20 pts)',
    icon: Zap,
    color: 'text-blue-600 bg-blue-50 border-blue-200',
    activeColor: 'bg-blue-600',
    maxPts: 20,
  },
  {
    number: 2,
    title: 'Your Experience',
    subtitle: 'Tell us about your internships and projects (max 25 pts)',
    icon: Briefcase,
    color: 'text-purple-600 bg-purple-50 border-purple-200',
    activeColor: 'bg-purple-600',
    maxPts: 25,
  },
  {
    number: 3,
    title: 'Career Goal',
    subtitle: 'Set your career direction — earns 20 pts when filled',
    icon: Target,
    color: 'text-emerald-600 bg-emerald-50 border-emerald-200',
    activeColor: 'bg-emerald-600',
    maxPts: 20,
  },
  {
    number: 4,
    title: 'Engagement',
    subtitle: 'Your involvement in groups and cohorts (max 10 pts)',
    icon: Users,
    color: 'text-amber-600 bg-amber-50 border-amber-200',
    activeColor: 'bg-amber-600',
    maxPts: 10,
  },
];

function StepBar({ current, completed }) {
  return (
    <div className="flex items-center gap-2 mb-8">
      {STEPS_CONFIG.map((s, idx) => {
        const done = completed.includes(s.number);
        const active = current === s.number;
        return (
          <React.Fragment key={s.number}>
            <div className="flex items-center gap-2 flex-1">
              <div
                className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 transition-all ${
                  done
                    ? 'bg-emerald-500 text-white'
                    : active
                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-200'
                    : 'bg-slate-100 text-slate-400'
                }`}
              >
                {done ? <CheckCircle size={16} /> : s.number}
              </div>
              <span className={`text-xs font-medium hidden sm:block ${active ? 'text-slate-900' : done ? 'text-emerald-600' : 'text-slate-400'}`}>
                {s.title}
              </span>
            </div>
            {idx < 3 && (
              <div className={`h-0.5 w-8 shrink-0 transition-all ${done ? 'bg-emerald-400' : 'bg-slate-200'}`} />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function Step1({ data, onChange, options }) {
  const selected = data.skills || [];
  const [custom, setCustom] = useState('');
  const skills = (options?.skills || []).map(s => s.label);
  const list = skills.length ? skills : FALLBACK_SKILLS;

  const toggle = (skill) => {
    const next = selected.includes(skill)
      ? selected.filter((s) => s !== skill)
      : [...selected, skill];
    onChange({ ...data, skills: next });
  };

  const addCustom = () => {
    const s = custom.trim();
    if (s && !selected.includes(s)) {
      onChange({ ...data, skills: [...selected, s] });
      setCustom('');
    }
  };

  const pts = Math.min(selected.length * 2, 20);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-500">
          <span className="font-semibold text-slate-900">{selected.length}</span> skills selected
        </p>
        <span className="text-sm font-bold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
          {pts} / 20 pts
        </span>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        {list.map((skill) => {
          const sel = selected.includes(skill);
          return (
            <button
              key={skill}
              onClick={() => toggle(skill)}
              className={`px-3 py-1.5 rounded-xl text-sm font-medium border transition-all ${
                sel
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {skill}
            </button>
          );
        })}
      </div>

      <div className="flex gap-2">
        <input
          type="text"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCustom()}
          placeholder="Add another skill…"
          className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50"
        />
        <button
          onClick={addCustom}
          className="px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700"
        >
          Add
        </button>
      </div>

      {selected.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {/* Skills the student typed in themselves — anything not offered
              by their stage's list. */}
          {selected.filter((s) => !list.includes(s)).map((s) => (
            <span
              key={s}
              onClick={() => toggle(s)}
              className="px-2.5 py-1 bg-blue-600 text-white text-xs font-medium rounded-lg cursor-pointer"
            >
              {s} ×
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Step2({ data, onChange, options }) {
  const internship = data.has_internship ?? false;
  const projects = parseInt(data.projects_count || 0);
  // Same two fields for every student — only the wording changes with stage, so
  // scoring never has to care which version they were shown.
  const qBool = (options?.step2 || []).find(q => q.kind === 'bool');
  const qCount = (options?.step2 || []).find(q => q.kind === 'count');

  const pts = Math.min((internship ? 10 : 0) + Math.min(projects * 5, 15), 25);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <span className="text-sm font-bold text-purple-600 bg-purple-50 px-3 py-1 rounded-full">
          {pts} / 25 pts
        </span>
      </div>

      {/* Internship */}
      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
        <h4 className="font-semibold text-slate-900 mb-1">{qBool?.label || 'Internship Experience'}</h4>
        <p className="text-xs text-slate-500 mb-4">+10 pts</p>
        <div className="flex gap-3">
          {[
            { label: 'Yes', value: true },
            { label: 'No, not yet', value: false },
          ].map(({ label, value }) => (
            <button
              key={String(value)}
              onClick={() => onChange({ ...data, has_internship: value })}
              className={`flex-1 py-3 px-4 rounded-xl border text-sm font-medium transition-all ${
                internship === value
                  ? 'bg-purple-600 text-white border-purple-600 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Projects */}
      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
        <h4 className="font-semibold text-slate-900 mb-1">{qCount?.label || 'Personal / Academic Projects'}</h4>
        <p className="text-xs text-slate-500 mb-4">+5 pts each, max 3 (15 pts)</p>
        <div className="flex gap-2">
          {[0, 1, 2, 3, '4+'].map((n) => {
            const val = n === '4+' ? 4 : n;   // distinct value so '3' and '4+' don't both highlight; points cap server-side
            return (
              <button
                key={n}
                onClick={() => onChange({ ...data, projects_count: val })}
                className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${
                  projects === val
                    ? 'bg-purple-600 text-white border-purple-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-purple-300'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Step3({ data, onChange, options }) {
  const goal = data.career_goal || '';
  const customGoal = data.custom_goal || '';
  const showCustom = goal === 'Other';
  const goals = (options?.career_goals || []).map(g => g.label);
  const list = goals.length ? goals : FALLBACK_GOALS;
  const pts = (goal && (goal !== 'Other' || customGoal.trim())) ? 20 : 0;

  const selectGoal = (g) => {
    onChange({ ...data, career_goal: g, custom_goal: g !== 'Other' ? '' : customGoal });
  };

  return (
    <div>
      <div className="flex justify-end mb-4">
        <span className="text-sm font-bold text-emerald-600 bg-emerald-50 px-3 py-1 rounded-full">
          {pts} / 20 pts
        </span>
      </div>

      <div className="space-y-2 mb-4">
        {list.map((g) => (
          <button
            key={g}
            onClick={() => selectGoal(g)}
            className={`w-full text-left px-4 py-3.5 rounded-xl border text-sm font-medium transition-all flex items-center justify-between ${
              goal === g
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50'
            }`}
          >
            <span>{g}</span>
            {goal === g && <CheckCircle size={16} />}
          </button>
        ))}
      </div>

      {showCustom && (
        <textarea
          value={customGoal}
          onChange={(e) => onChange({ ...data, career_goal: 'Other', custom_goal: e.target.value })}
          placeholder="Describe your career goal…"
          rows={3}
          className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-slate-50 resize-none"
        />
      )}
    </div>
  );
}

function Step4({ data, onChange, options }) {
  const inGroups = data.in_groups ?? false;
  const cohortsAttended = parseInt(data.cohorts_attended || 0);
  const pts = (inGroups ? 5 : 0) + (cohortsAttended > 0 ? 5 : 0);
  const qBool = (options?.step4 || []).find(q => q.kind === 'bool');

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <span className="text-sm font-bold text-amber-600 bg-amber-50 px-3 py-1 rounded-full">
          {pts} / 10 pts
        </span>
      </div>

      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
        <h4 className="font-semibold text-slate-900 mb-1">{qBool?.label || 'Community Groups'}</h4>
        <p className="text-xs text-slate-500 mb-4">+5 pts</p>
        <div className="flex gap-3">
          {[
            { label: 'Yes', value: true },
            { label: 'Not yet', value: false },
          ].map(({ label, value }) => (
            <button
              key={String(value)}
              onClick={() => onChange({ ...data, in_groups: value })}
              className={`flex-1 py-3 rounded-xl border text-sm font-medium transition-all ${
                inGroups === value
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-slate-50 rounded-2xl p-5 border border-slate-200">
        <h4 className="font-semibold text-slate-900 mb-1">Cohorts Attended</h4>
        <p className="text-xs text-slate-500 mb-4">+5 pts if you have attended at least one cohort session</p>
        <div className="flex gap-2">
          {[0, 1, 2, 3, '4+'].map((n) => {
            const val = n === '4+' ? 4 : n;
            return (
              <button
                key={n}
                onClick={() => onChange({ ...data, cohorts_attended: val })}
                className={`flex-1 py-3 rounded-xl border text-sm font-bold transition-all ${
                  cohortsAttended === val
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                }`}
              >
                {n}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function ScoreResult({ score, level, stepsCompleted, onRetake, onContinue }) {
  const levelConfig = {
    Explorer: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', emoji: '🌱' },
    Pioneer:  { color: 'text-blue-600',  bg: 'bg-blue-50',  border: 'border-blue-200',  emoji: '🚀' },
    Achiever: { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', emoji: '🏆' },
  }[level] || { color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', emoji: '⭐' };

  const unlocked = score >= 65;

  return (
    <div className="text-center">
      <div className="text-5xl mb-4">{levelConfig.emoji}</div>
      <h2 className="text-2xl font-bold text-slate-900 mb-1">Assessment Complete!</h2>
      <p className="text-slate-500 text-sm mb-8">
        You've completed {stepsCompleted} of 4 steps
      </p>

      {/* Score ring */}
      <div className="flex justify-center mb-6">
        <div className="relative w-36 h-36">
          <svg className="-rotate-90" width="144" height="144">
            <circle cx="72" cy="72" r="60" stroke="#e2e8f0" strokeWidth="10" fill="none" />
            <circle
              cx="72" cy="72" r="60"
              stroke={unlocked ? '#10b981' : '#2563eb'}
              strokeWidth="10" fill="none"
              strokeDasharray={`${2 * Math.PI * 60}`}
              strokeDashoffset={`${2 * Math.PI * 60 * (1 - score / 100)}`}
              strokeLinecap="round"
              className="transition-all duration-1000"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-black text-slate-900">{score}</span>
            <span className="text-xs text-slate-500">/ 100</span>
          </div>
        </div>
      </div>

      <span className={`inline-block text-sm font-bold uppercase tracking-wider px-4 py-1.5 rounded-full border mb-6 ${levelConfig.color} ${levelConfig.bg} ${levelConfig.border}`}>
        {level}
      </span>

      {unlocked ? (
        <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-4 mb-6">
          <p className="text-emerald-700 font-semibold text-sm">🎉 Opportunity Hub Unlocked!</p>
          <p className="text-emerald-600 text-xs mt-1">You can now apply to all opportunities</p>
        </div>
      ) : (
        <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4 mb-6">
          <p className="text-blue-700 font-semibold text-sm">
            {Math.max(0, 60 - score)} more pts to unlock Opportunity Hub
          </p>
          <p className="text-blue-600 text-xs mt-1">
            Join cohorts (+5 pts each) and complete all 4 assessment steps
          </p>
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={onRetake}
          className="flex-1 flex items-center justify-center gap-2 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <RotateCcw size={15} /> Retake
        </button>
        <button
          onClick={onContinue}
          className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-xl"
        >
          Go to Dashboard <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

export default function ReadinessAssessment() {
  const navigate = useNavigate();

  const [currentStep, setCurrentStep] = useState(1);
  const [stepData, setStepData] = useState({ 1: {}, 2: {}, 3: {}, 4: {} });
  const [completed, setCompleted] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [loadingProgress, setLoadingProgress] = useState(true);
  // The lists this particular student should see — the server picks the set
  // from their education stage, so a 10th-class student is never asked to claim
  // Django or pick between Investment Banking and UI/UX Design.
  const [options, setOptions] = useState(null);

  useEffect(() => {
    api.get('/readiness/assessment/options')
      .then(({ data }) => { if (data.bool) setOptions(data.response); })
      .catch(() => { /* the fallback lists keep the page usable */ });
  }, []);

  useEffect(() => {
    api.get('/readiness/assessment')
      .then(({ data }) => {
        if (data.bool && data.response) {
          const r = data.response;
          const done = Object.entries(r.steps || {})
            .filter(([, v]) => v.is_complete)
            .map(([k]) => parseInt(k));
          setCompleted(done);
          const preloaded = {};
          Object.entries(r.steps || {}).forEach(([k, v]) => {
            preloaded[parseInt(k)] = v.step_data || {};
          });
          setStepData((prev) => ({ ...prev, ...preloaded }));
          if (done.length === 4) {
            setResult({
              score: r.current_score,
              level: r.level,
              stepsCompleted: 4,
            });
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingProgress(false));
  }, []);

  const handleSaveStep = async () => {
    const data = stepData[currentStep];
    setError('');
    setSaving(true);

    let payload = { step: currentStep, step_data: data };

    if (currentStep === 3 && data.career_goal === 'Other') {
      payload.step_data = { ...data, career_goal: data.custom_goal || 'Other' };
    }

    try {
      const { data: res } = await api.post('/readiness/assessment', payload);
      if (res.bool) {
        const newCompleted = completed.includes(currentStep)
          ? completed
          : [...completed, currentStep];
        setCompleted(newCompleted);

        if (currentStep === 4 || newCompleted.length === 4) {
          setResult({
            score: res.response.current_score,
            level: res.response.level,
            stepsCompleted: res.response.steps_completed,
          });
        } else {
          setCurrentStep((s) => s + 1);
        }
      } else {
        setError(res.response?.message || 'Failed to save. Try again.');
      }
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const isStepValid = () => {
    const d = stepData[currentStep];
    if (currentStep === 1) return (d.skills || []).length > 0;
    if (currentStep === 2) return d.has_internship !== undefined && d.projects_count !== undefined;
    if (currentStep === 3) {
      if (!d.career_goal) return false;
      if (d.career_goal === 'Other') return (d.custom_goal || '').trim().length > 0;
      return true;
    }
    if (currentStep === 4) return d.in_groups !== undefined && d.cohorts_attended !== undefined;
    return false;
  };

  const cfg = STEPS_CONFIG[currentStep - 1];

  if (loadingProgress) {
    return (
      <div className="p-4 sm:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-slate-100 rounded w-1/2" />
          <div className="h-64 bg-slate-100 rounded-2xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Readiness Assessment</h1>
        <p className="text-slate-500 text-sm mt-1">
          Complete all 4 steps to earn <span className="font-semibold text-slate-700">65+ pts</span> and unlock opportunities
        </p>
      </div>

      {result ? (
        <div className="bg-white rounded-2xl border border-slate-200 p-8 shadow-sm">
          <ScoreResult
            {...result}
            onRetake={() => { setResult(null); setCurrentStep(1); setCompleted([]); }}
            onContinue={() => navigate('/career-path')}
          />
        </div>
      ) : (
        <>
          <StepBar current={currentStep} completed={completed} />

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Step header */}
            <div className={`p-5 border-b border-slate-100 flex items-center gap-4`}>
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${cfg.color}`}>
                <cfg.icon size={20} />
              </div>
              <div>
                <h2 className="font-bold text-slate-900">
                  Step {cfg.number}: {cfg.title}
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">{cfg.subtitle}</p>
              </div>
              {completed.includes(currentStep) && (
                <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 font-medium bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                  <CheckCircle size={12} /> Done
                </span>
              )}
            </div>

            {/* Step content */}
            <div className="p-6">
              {error && (
                <p className="mb-4 text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>
              )}

              {currentStep === 1 && (
                <Step1
                  data={stepData[1]}
                  onChange={(d) => setStepData((prev) => ({ ...prev, 1: d }))}
                  options={options}
                />
              )}
              {currentStep === 2 && (
                <Step2
                  data={stepData[2]}
                  onChange={(d) => setStepData((prev) => ({ ...prev, 2: d }))}
                  options={options}
                />
              )}
              {currentStep === 3 && (
                <Step3
                  data={stepData[3]}
                  onChange={(d) => setStepData((prev) => ({ ...prev, 3: d }))}
                  options={options}
                />
              )}
              {currentStep === 4 && (
                <Step4
                  data={stepData[4]}
                  onChange={(d) => setStepData((prev) => ({ ...prev, 4: d }))}
                  options={options}
                />
              )}
            </div>

            {/* Nav buttons */}
            <div className="px-6 pb-6 flex gap-3">
              {currentStep > 1 && (
                <button
                  onClick={() => setCurrentStep((s) => s - 1)}
                  className="flex items-center gap-2 px-5 py-3 border border-slate-200 rounded-xl text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  <ChevronLeft size={16} /> Back
                </button>
              )}
              <button
                onClick={handleSaveStep}
                disabled={saving || !isStepValid()}
                className="flex-1 flex items-center justify-center gap-2 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {saving ? 'Saving…' : currentStep === 4 ? (
                  <><Trophy size={16} /> Complete Assessment</>
                ) : (
                  <>Next Step <ChevronRight size={16} /></>
                )}
              </button>
            </div>
          </div>

          {/* Skip for now */}
          <p className="text-center mt-4 text-xs text-slate-400">
            Already done this?{' '}
            <button onClick={() => navigate('/career-path')} className="text-blue-500 hover:underline">
              Back to Dashboard
            </button>
          </p>
        </>
      )}
    </div>
  );
}
