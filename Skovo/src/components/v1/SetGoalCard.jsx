import React, { useEffect, useState } from 'react';
import { Target, Check } from 'lucide-react';
import { api } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Button, useToast } from '../ui/index.jsx';
import { targetExamRows } from '../../config/educationPathways';

/**
 * "Set your goal" — the student's first Dashboard task after sign-up.
 *
 * Sign-up asks only what is needed to start; the goal comes here, one tap, as
 * the first piece of real progress. 10th picks what comes after 10th (an Inter
 * group, Polytechnic, ITI or "Not sure yet"); other stages pick from the goal
 * lists admin edits in Masters. Engineering / Medicine / etc. also offer the
 * exams for that stage. The card is gone once a goal is saved; My Profile keeps
 * the goal editable.
 */
const SCHOOL = ['school_10th', 'school_11th', 'school_12th'];
const EXAM_STAGES = ['govt_exam', 'entrance_exam', 'dropper'];
const COLLEGE_GOAL = ['ug', 'pg', 'phd', 'professional_course', 'working'];
const PLAN_10 = [
  { value: 'plan:polytechnic', label: 'Polytechnic Diploma', goal: 'Polytechnic Diploma' },
  { value: 'plan:iti', label: 'ITI', goal: 'ITI' },
  { value: 'plan:not_sure', label: 'Not sure yet', goal: 'Not decided yet' },
];

function Chip({ label, active, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`px-3 min-h-11 text-sm font-semibold rounded-xl border transition-all ${
        active ? 'chip-active' : 'border-slate-200 text-slate-600 hover:border-slate-300 bg-white'}`}>
      {active && <Check size={12} className="inline mr-1" />}{label}
    </button>
  );
}

export default function SetGoalCard() {
  const toast = useToast();
  // Re-check when sign-up finishes: the card mounts behind the setup window,
  // before the stage exists.
  const { user } = useAuth();
  const stageKey = user?.education_level || '';
  const [state, setState] = useState(null);   // { stage, board, options, exams } or 'hidden'
  const [pick, setPick] = useState('');
  const [exams, setExams] = useState([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [{ data: pr }, { data: gr }] = await Promise.all([api.get('/profile/'), api.get('/profile/goals')]);
        const p = pr?.response?.profile || {};
        const goals = gr?.response?.goals || {};
        const stage = p.education_category || '';
        const hasGoal = (goals.target_courses || []).length > 0
          || (stage === 'school_10th' && p.stream)
          || EXAM_STAGES.includes(stage) || !stage;
        if (hasGoal) { if (alive) setState('hidden'); return; }

        const types = 'career_goal_school,career_goal_college,entrance_exam,govt_exam';
        const { data: mr } = await api.get(`/auth/masters?types=${types}`);
        const m = mr?.response?.grouped || {};
        let options;
        if (stage === 'school_10th') {
          const { data: sr } = p.board
            ? await api.get(`/auth/streams?board_code=${encodeURIComponent(p.board)}`) : { data: {} };
          options = [
            ...((sr?.response?.streams) || []).map(s => ({ value: s.canonical, label: `Inter ${s.short_label}`, stream: true })),
            ...PLAN_10,
          ];
        } else {
          options = (COLLEGE_GOAL.includes(stage) ? m.career_goal_college : m.career_goal_school) || [];
        }
        const examRows = COLLEGE_GOAL.includes(stage) ? []
          : targetExamRows(stage, { national: m.entrance_exam, govt: m.govt_exam }).slice(0, 10);
        if (alive) setState({ stage, options, examRows });
      } catch {
        if (alive) setState('hidden');
      }
    })();
    return () => { alive = false; };
  }, [stageKey]);

  if (!state || state === 'hidden') return null;

  const chosen = state.options.find(o => o.value === pick);
  const notSure = pick === 'plan:not_sure' || /not decided|not sure/i.test(chosen?.label || '');
  const showExams = Boolean(pick) && !notSure && state.examRows.length > 0;

  const save = async () => {
    if (!chosen) return;
    setBusy(true);
    try {
      if (chosen.stream) {
        const { data } = await api.patch('/profile/', { stream: chosen.value });
        if (!data.bool) throw new Error(data.response?.message);
      } else {
        const goal = chosen.goal || chosen.label;
        const { data } = await api.put('/profile/goals', {
          target_courses: [goal],
          ...(showExams ? { target_exams: exams } : {}),
        });
        if (!data.bool) throw new Error(data.response?.message);
      }
      if (chosen.stream && showExams && exams.length) {
        await api.put('/profile/goals', { target_exams: exams }).catch(() => {});
      }
      toast.success(notSure ? 'Saved. We will help you decide.' : 'Goal set!');
      setState('hidden');
    } catch (e) {
      toast.error(e?.message || 'Could not save your goal.');
    } finally { setBusy(false); }
  };

  const toggleExam = (v) => setExams(cur => (cur.includes(v) ? cur.filter(x => x !== v)
    : cur.length >= 3 ? cur : [...cur, v]));

  return (
    <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
             style={{ backgroundColor: 'color-mix(in srgb, var(--accent) 14%, transparent)', color: 'var(--accent)' }}>
          <Target size={18} />
        </div>
        <div className="min-w-0">
          <p className="font-bold text-slate-900">Set your goal</p>
          <p className="text-sm text-slate-500">
            {state.stage === 'school_10th' ? 'What do you want to do after 10th?'
              : COLLEGE_GOAL.includes(state.stage) ? 'What do you want to become?' : 'What do you want to do next?'}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {state.options.map(o => (
          <Chip key={o.value} label={o.label} active={pick === o.value}
                onClick={() => { setPick(o.value); setExams([]); }} />
        ))}
      </div>

      {showExams && (
        <div>
          <p className="text-xs font-semibold text-slate-600 mb-2">Which exams? <span className="font-normal text-slate-400">· optional, up to 3</span></p>
          <div className="flex flex-wrap gap-2">
            {state.examRows.map(r => (
              <Chip key={r.value} label={r.label} active={exams.includes(r.value)} onClick={() => toggleExam(r.value)} />
            ))}
          </div>
        </div>
      )}

      {notSure && (
        <p className="text-sm rounded-xl px-3 py-2.5 bg-slate-50 text-slate-600 border border-slate-200">
          No problem. We will help you decide. You can change your goal any time on My Profile.
        </p>
      )}

      <Button className="w-full sm:w-auto" onClick={save} disabled={!pick || busy}>
        {busy ? 'Saving…' : 'Save my goal'}
      </Button>
    </div>
  );
}
