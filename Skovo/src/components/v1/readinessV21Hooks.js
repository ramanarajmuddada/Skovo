import { useEffect, useState } from 'react';
import { api } from '../../services/api';

/** True once the admin has switched the v2.1 engine on (null while loading). */
export function useReadinessV21() {
  const [on, setOn] = useState(null);
  useEffect(() => {
    api.get('/readiness/v21/score/current').then(({ data }) => setOn(!!(data?.bool && data.response?.enabled)))
      .catch(() => setOn(false));
  }, []);
  return on;
}

/** Counts a streak day after 30 s in the app, once per calendar day (IST). */
export function useStreakPing() {
  useEffect(() => {
    let today = '';
    try { today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()); } catch { /* old browser */ }
    let last = '';
    try { last = localStorage.getItem('skovo_streak_day') || ''; } catch { /* storage blocked */ }
    if (today && last === today) return undefined;
    const t = setTimeout(() => {
      api.post('/readiness/v21/streak/open', { seconds: 30 }).then(({ data }) => {
        if (data?.bool && data.response?.result !== 'off') {
          try { localStorage.setItem('skovo_streak_day', today); } catch { /* storage blocked */ }
        }
      }).catch(() => {});
    }, 30000);
    return () => clearTimeout(t);
  }, []);
}
