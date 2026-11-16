import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import { useMasters } from '../hooks/useMasters';
import { Card, PageHeader, Button, Input, FormSelect, StudentPage } from '../components/ui/index.jsx';
import CollegeTabs from '../components/colleges/CollegeTabs';
import { Target, MapPin, TrendingUp, ShieldCheck, Crosshair, Rocket, Info, AlertTriangle } from 'lucide-react';
import { fieldErrors, collegePredict } from '../schemas/student';

// Reservation categories come from masters. They used to read OC/BC here while
// the cutoff and scholarship logic stores general/obc — two spellings of the
// same fact, which is how a student gets shown the wrong cutoff.

// Safe / Target / Reach — the language a counsellor uses, so the list reads as
// advice rather than a raw table.
const BUCKETS = {
  safe:   { label: 'Safe',   blurb: 'Comfortably within last year\'s cutoff', icon: ShieldCheck, tone: 'emerald' },
  target: { label: 'Target', blurb: 'You make it, but it is close',           icon: Crosshair,   tone: 'blue' },
  reach:  { label: 'Reach',  blurb: 'Just outside — worth a shot',            icon: Rocket,      tone: 'amber' },
};

const TONE = {
  emerald: { chip: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'text-emerald-600' },
  blue:    { chip: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'text-blue-600' },
  amber:   { chip: 'bg-amber-50 text-amber-700 border-amber-200',       dot: 'text-amber-600' },
};

function CollegeRow({ c, tone }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-slate-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-slate-900 text-sm truncate">{c.college_name}</p>
        <p className="text-xs text-slate-500 truncate">{c.branch_name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          {(c.city || c.state) && (
            <span className="text-[11px] text-slate-400 flex items-center gap-0.5">
              <MapPin size={10} /> {[c.city, c.state].filter(Boolean).join(', ')}
            </span>
          )}
          {c.college_type && (
            <span className="text-[11px] text-slate-400 capitalize">· {c.college_type}</span>
          )}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[10px] text-slate-400 uppercase tracking-wide">Closing rank</p>
        <p className={`text-sm font-bold ${TONE[tone].dot}`}>{Number(c.closing_rank).toLocaleString('en-IN')}</p>
        <p className="text-[11px] text-slate-400">{c.category}</p>
      </div>
    </div>
  );
}

function Bucket({ kind, colleges, titleOverride }) {
  const b = BUCKETS[kind];
  if (!colleges.length) return null;
  const Icon = b.icon;
  return (
    <Card className="p-0 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-3 border-b ${TONE[b.tone].chip}`}>
        <Icon size={16} className={TONE[b.tone].dot} />
        <span className="font-bold text-sm">{titleOverride || b.label}</span>
        {!titleOverride && <span className="text-xs opacity-80">· {b.blurb}</span>}
        <span className="ml-auto text-xs font-bold">{colleges.length}</span>
      </div>
      <div>{colleges.map((c, i) => <CollegeRow key={i} c={c} tone={b.tone} />)}</div>
    </Card>
  );
}

export default function CollegePredictor() {
  const { lists } = useMasters(['category']);
  const [exams, setExams] = useState([]);
  const [exam, setExam] = useState('');
  const [rank, setRank] = useState('');
  // 'general', not 'OC' — the value has to be the one the cutoff rows and the
  // scholarship logic store, or the prediction filters on a category that
  // matches nothing.
  const [category, setCategory] = useState('general');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [errs, setErrs] = useState({});

  useEffect(() => {
    let on = true;
    Promise.all([
      api.get('/colleges/predict/exams').catch(() => ({ data: {} })),
      api.get('/profile/goals').catch(() => ({ data: {} })),
    ]).then(([ex, g]) => {
      if (!on) return;
      const list = ex.data?.response?.exams || [];
      setExams(list);
      const wanted = g.data?.response?.goals?.target_exams || [];
      const hit = list.find(e => wanted.includes(e.exam));
      if (hit) setExam(hit.exam);
      else if (list.length) setExam(list[0].exam);
      const cat = g.data?.response?.goals?.reservation_category;
      if (cat) setCategory(cat);
    });
    return () => { on = false; };
  }, []);

  const predict = async (e) => {
    e?.preventDefault?.();
    const parsed = collegePredict.safeParse({ exam, rank, category });
    if (!parsed.success) {
      setErrs(fieldErrors(parsed));
      setError('');
      return;
    }
    setErrs({});
    setLoading(true); setError(''); setResult(null);
    try {
      api.put('/profile/goals', { reservation_category: parsed.data.category }).catch(() => {});
      const { data } = await api.post('/colleges/predict', {
        exam: parsed.data.exam, rank: Number(parsed.data.rank), category: parsed.data.category,
      });
      if (data.bool) setResult(data.response);
      else setError(data.response?.message || 'Could not run the prediction.');
    } catch { setError('Could not run the prediction. Try again.'); }
    finally { setLoading(false); }
  };

  return (
    <StudentPage narrow className="space-y-5 sm:space-y-6">
      <PageHeader title="College Predictor"
        subtitle="See which colleges your rank can get you into" />

      <CollegeTabs active="predictor" />

      <Card className="p-5">
        <form onSubmit={predict} noValidate className="grid sm:grid-cols-4 gap-3 items-end">
          <FormSelect
            className="sm:col-span-2"
            label="Exam" required
            value={exam}
            onChange={(v) => { setExam(v); setErrs((e) => ({ ...e, exam: undefined })); }}
            options={exams.map((x) => ({ value: x.exam, label: `${x.exam} (${x.colleges} colleges)` }))}
            placeholder={exams.length ? 'Enter exam' : 'No exams available yet'}
            disabled={exams.length === 0}
            error={errs.exam}
          />
          <Input label="Your rank" required type="text" inputMode="numeric" value={rank}
            onChange={(e) => { setRank(e.target.value.replace(/\D/g, '')); setErrs((er) => ({ ...er, rank: undefined })); }}
            placeholder="Enter your rank"
            error={errs.rank} />
          <FormSelect searchType="category"
            label="Category" required
            value={category}
            onChange={(v) => { setCategory(v); setErrs((e) => ({ ...e, category: undefined })); }}
            options={lists.category || []}
            placeholder="Enter category"
            clearable={false}
            error={errs.category}
          />
          <div className="sm:col-span-4">
            <Button type="submit" disabled={loading} className="w-full sm:w-auto">
              <Target size={15} /> {loading ? 'Predicting…' : 'Predict my colleges'}
            </Button>
          </div>
        </form>
        {error && <p className="text-sm text-red-600 mt-3">{error}</p>}
      </Card>

      {result && (
        <div className="space-y-4">
          {/* How confident the answer is allowed to look depends on how much
              cutoff data sits behind it. Anywhere else thin data just looks
              empty; here it would tell a student something specific and wrong
              about their future, so a low-coverage result says so loudly and
              never renders the tidy Safe/Target/Reach split. */}
          {result.confidence === 'low' ? (
            <div className="flex items-start gap-2.5 text-xs rounded-xl px-4 py-3 border border-amber-200 bg-amber-50 text-amber-900">
              <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold mb-0.5">Early data — treat this as a rough indication only</p>
                <p className="leading-relaxed">{result.message}</p>
                <p className="mt-1 opacity-80">
                  We hold {result.coverage?.rows} record{result.coverage?.rows === 1 ? '' : 's'} across{' '}
                  {result.coverage?.colleges} college{result.coverage?.colleges === 1 ? '' : 's'}
                  {result.coverage?.latest_year ? ` (${result.coverage.latest_year})` : ''}. Always confirm
                  on the official counselling website before deciding anything.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-xs text-slate-500 bg-slate-50 rounded-xl px-4 py-3">
              <Info size={14} className="text-slate-400 shrink-0 mt-0.5" />
              <span>{result.message}{result.based_on_year ? ` Based on ${result.based_on_year} cutoffs.` : ''}</span>
            </div>
          )}

          {result.total === 0 ? (
            <Card className="p-10 text-center">
              <TrendingUp size={28} className="text-slate-300 mx-auto mb-2" />
              <p className="text-sm font-semibold text-slate-700">No matches for that rank yet</p>
              <p className="text-xs text-slate-400 mt-1">
                Try a different category, or check back once more cutoff data is added.
              </p>
            </Card>
          ) : result.confidence === 'low' ? (
            /* Same colleges, but as a flat "possible matches" list — three
               confident buckets off a handful of rows would be false precision. */
            <Bucket kind="target" colleges={[...result.safe, ...result.target, ...result.reach]}
                    titleOverride="Possible matches" />
          ) : (
            <>
              <Bucket kind="safe"   colleges={result.safe} />
              <Bucket kind="target" colleges={result.target} />
              <Bucket kind="reach"  colleges={result.reach} />
            </>
          )}
        </div>
      )}
    </StudentPage>
  );
}
