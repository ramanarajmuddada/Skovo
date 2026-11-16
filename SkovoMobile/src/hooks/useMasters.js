import { useEffect, useState } from 'react';
import { studentApi } from '../services/api';

/**
 * Option lists, from the database — the mobile twin of the web hook.
 *
 * Same reason it exists there: these values are stored on profiles and compared
 * with exact string equality by the targeting engine. A second copy of a list
 * drifts from the first, and when it does nothing errors — the content simply
 * stops reaching the students it was meant for.
 *
 *   const { lists } = useMasters(['cohort_status']);
 *   lists.cohort_status  // [{ value, label }]
 */
export function useMasters(types, fallback = {}) {
  const key = Array.isArray(types) ? types.join(',') : String(types || '');
  const [lists, setLists] = useState(fallback);
  const [loading, setLoading] = useState(Boolean(key));

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    studentApi.get('/auth/masters', { types: key })
      .then(({ data }) => {
        if (!alive || !data.bool) return;
        // Keep the fallback for anything the server had nothing for, so a
        // half-seeded environment degrades to the old list, not a blank screen.
        setLists(prev => ({ ...prev, ...(data.response?.grouped || {}) }));
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key]);

  return { lists, loading };
}

export const values = (list) => (list || []).map(o => o.value);

export const labelOf = (list, value, fallbackLabel) =>
  (list || []).find(o => o.value === value)?.label || fallbackLabel || value;

export default useMasters;
