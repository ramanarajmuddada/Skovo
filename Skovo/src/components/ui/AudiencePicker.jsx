import React from 'react';
import MultiChip from './MultiChip';
import useAudienceOptions from '../../hooks/useAudienceOptions';

/**
 * Audience targeting — the eight `target_*` fields shared by cohorts and courses.
 *
 * Promoted out of AchieverCohorts.jsx and AchieverCourses.jsx. Those two copies
 * were the same component differing only by the setter's name (`sf` vs
 * `setForm`) and one word of copy ("cohort" / "course") — so `noun` covers the
 * copy and the setter is normalised to one signature.
 *
 * Sub-pickers appear only when the chosen category makes them meaningful: a
 * school cohort has streams, a UG cohort has degrees and years, an entrance-exam
 * cohort has target exams. Showing all eight at once was the thing that made
 * targeting feel unusable.
 *
 * Empty array = no restriction. That is the rule the backend applies, so the
 * notes here say "empty = all" rather than implying a required choice.
 */
export default function AudiencePicker({ form, onChange, noun = 'cohort' }) {
  const { options } = useAudienceOptions();
  const set = (k, v) => onChange(k, v);

  const cats = form.target_categories || [];
  const isAll = cats.length === 0;
  const hasSchool   = cats.some((c) => c.startsWith('school'));
  const hasUG       = cats.includes('ug') || cats.includes('polytechnic');
  const hasPG       = cats.includes('pg');
  const hasEntrance = cats.includes('entrance_exam');
  const hasGovt     = cats.includes('govt_exam');
  const hasProf     = cats.includes('professional_course');

  const toggleCat = (v) =>
    set('target_categories', cats.includes(v) ? cats.filter((x) => x !== v) : [...cats, v]);

  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-bold text-slate-700 uppercase tracking-wide mb-2">
          Who is this {noun} for?
        </p>
        <div className="flex flex-wrap gap-1.5 mb-2">
          <button type="button" onClick={() => set('target_categories', [])}
            className={`px-3 py-1.5 text-xs font-bold rounded-xl border-2 transition-all ${
              isAll ? 'chip-active' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
            Everyone
          </button>
          {options.categories.map((o) => (
            <button key={o.value} type="button" onClick={() => toggleCat(o.value)}
              className={`px-3 py-1.5 text-xs font-bold rounded-xl border-2 transition-all ${
                cats.includes(o.value) ? 'chip-active' : 'border-slate-200 text-slate-500 hover:border-slate-300'}`}>
              {cats.includes(o.value) && '✓ '}{o.label}
            </button>
          ))}
        </div>
        {!isAll && (
          <p className="text-[10px] text-slate-400">
            Only students in the selected categories will see this {noun}.
          </p>
        )}
      </div>

      {(hasSchool || hasEntrance) && !isAll && (
        <MultiChip label="Streams" note="empty = all" options={options.streams}
          selected={form.target_streams || []} onChange={(v) => set('target_streams', v)} />
      )}
      {(hasUG || hasPG) && !isAll && (
        <MultiChip label="Degree Categories" note="empty = all" options={options.degreeCategories}
          selected={form.target_degree_cats || []} onChange={(v) => set('target_degree_cats', v)} />
      )}
      {(hasUG || hasPG) && !isAll && (
        <MultiChip label="Specific Degrees (optional)" note="empty = all" options={options.degrees}
          selected={form.target_degrees || []} onChange={(v) => set('target_degrees', v)} />
      )}
      {(form.target_degrees || []).some((d) => ['B.Tech', 'B.E.', 'M.Tech'].includes(d)) && (
        <MultiChip label="Branches (optional)" note="empty = all" options={options.branches}
          selected={form.target_branches || []} onChange={(v) => set('target_branches', v)} />
      )}
      {(hasUG || hasPG) && !isAll && (
        <MultiChip label="Year of Study (optional)" note="empty = all years" options={options.years}
          selected={form.target_years || []} onChange={(v) => set('target_years', v)} />
      )}
      {hasEntrance && !isAll && (
        <MultiChip label="Target Exams" note="empty = all" options={options.entranceExams}
          selected={form.target_exam_targets || []} onChange={(v) => set('target_exam_targets', v)} />
      )}
      {hasGovt && !isAll && (
        <MultiChip label="Govt Exams" note="empty = all" options={options.govtExams}
          selected={form.target_exam_targets || []} onChange={(v) => set('target_exam_targets', v)} />
      )}
      {hasProf && !isAll && (
        <MultiChip label="Professional Courses" note="empty = all" options={options.profCourses}
          selected={form.target_prof_courses || []} onChange={(v) => set('target_prof_courses', v)} />
      )}
    </div>
  );
}

/**
 * One-line summary of who a targeting payload reaches.
 *
 * The spec asks for a live "who will see this" line. Reading eight JSON arrays
 * to work that out is exactly what an achiever cannot do, and getting it wrong
 * means publishing a cohort nobody can see.
 */
export function audienceSummary(form, options) {
  const cats = form.target_categories || [];
  if (!cats.length) return 'Everyone on SKOVO';

  const labelFor = (list, v) => (list || []).find((o) => o.value === v)?.label || v;
  const parts = [cats.map((c) => labelFor(options?.categories, c)).join(', ')];

  const add = (key, list, prefix) => {
    const vals = form[key] || [];
    if (vals.length) parts.push(`${prefix} ${vals.map((v) => labelFor(list, v)).join(', ')}`);
  };

  add('target_streams', options?.streams, 'in');
  add('target_degree_cats', options?.degreeCategories, 'in');
  add('target_degrees', options?.degrees, 'studying');
  add('target_branches', options?.branches, '·');
  add('target_years', options?.years, 'year');
  add('target_exam_targets', options?.entranceExams, 'targeting');
  add('target_prof_courses', options?.profCourses, 'in');

  return parts.join(' · ');
}
