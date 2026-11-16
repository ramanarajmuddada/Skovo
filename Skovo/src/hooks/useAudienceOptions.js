import { useEffect, useState } from 'react';
import { api } from '../services/api';

/**
 * The option lists an achiever picks from when targeting a cohort or a course.
 *
 * These are the highest-stakes dropdowns in the product. The targeting engine
 * compares them to a student's profile with exact string equality
 * (cohorts.py `_matches_audience`), so if the two sides spell a value
 * differently the cohort is simply invisible to the students it was built for —
 * no error, no warning, just an empty room.
 *
 * That had already happened three times over:
 *
 *   student profile holds        targeting offered      matched
 *   science_pcb                  "PCB"                  never
 *   "Mass Communication & …"     "Mass Comm"            never
 *   "Computer Science (CSE)"     "CSE"                  never
 *
 * So every list here is pulled from the same source the student's profile is
 * written from — streams from the streams table, degrees and branches from the
 * course catalogue, exams and years from masters. The two sides cannot drift
 * apart because there is only one side.
 */
const FALLBACK = {
  categories: [], streams: [], degreeCategories: [], degrees: [],
  branches: [], years: [], entranceExams: [], govtExams: [], profCourses: [],
};

const MASTER_TYPES = [
  'onboarding_category', 'entrance_exam', 'govt_exam',
  'year_ug', 'year_pg', 'year_diploma', 'year_iti', 'year_phd', 'year_professional',
].join(',');

const opts = (rows) => (rows || []).map(r => ({ value: r.value, label: r.label }));
const plain = (arr) => (arr || []).map(v => ({ value: v, label: v }));

export function useAudienceOptions() {
  const [options, setOptions] = useState(FALLBACK);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    Promise.all([
      api.get(`/auth/masters?types=${MASTER_TYPES}`).catch(() => ({ data: {} })),
      api.get('/auth/streams/canonical').catch(() => ({ data: {} })),
      api.get('/auth/courses/facets').catch(() => ({ data: {} })),
      api.get('/auth/courses/search?level=professional&limit=100').catch(() => ({ data: {} })),
    ]).then(([m, s, f, prof]) => {
      if (!alive) return;
      const grouped = m.data?.response?.grouped || {};
      const facets = f.data?.response || {};

      // Every year list, de-duplicated — an achiever targets "2nd Year"
      // without caring whether the student is UG, PG or diploma.
      const years = [...new Set(
        ['year_ug', 'year_pg', 'year_diploma', 'year_iti', 'year_phd', 'year_professional']
          .flatMap(t => (grouped[t] || []).map(r => r.value)),
      )];

      const profCourses = [...new Set(
        (prof.data?.response?.courses || []).map(c => c.degree),
      )];

      setOptions({
        categories: (grouped.onboarding_category || []).map(r => ({
          value: r.value, label: String(r.label || '').split('|')[0],
        })),
        // Canonical values — what the profile actually stores.
        streams: (s.data?.response?.streams || []).map(x => ({
          value: x.canonical, label: x.short_label,
        })),
        degreeCategories: plain(facets.degree_categories),
        degrees:          plain(facets.degrees),
        branches:         plain(facets.branches),
        years:            plain(years),
        entranceExams:    opts(grouped.entrance_exam),
        govtExams:        opts(grouped.govt_exam),
        profCourses:      plain(profCourses),
      });
    }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return { options, loading };
}

export default useAudienceOptions;
