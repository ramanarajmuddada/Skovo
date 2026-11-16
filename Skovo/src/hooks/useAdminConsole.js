import { useEffect, useState, useCallback, useRef } from 'react';
import { adminApi } from '../services/api';

/**
 * Whether this admin is allowed to operate, and what to tell them if not.
 *
 * Fetched once in AdminLayout and passed down. A pending admin can sign in and
 * reach this endpoint and nothing else — the layout renders a holding screen
 * from `guidelines` instead of the console.
 *
 * Blocking the login outright was the alternative, and it is worse: someone who
 * has just registered would have no way to tell whether the request was even
 * received, and would email you to ask.
 */
export function useAdminConsole() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  const alive = useRef(true);
  // Re-armed on every mount, not just cleared on unmount. StrictMode mounts,
  // unmounts and remounts in development: a cleanup that only sets this false
  // leaves it false forever after that first unmount, so every later setState
  // is skipped and `loading` never clears — the console renders blank.
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(async () => {
    try {
      const { data: res } = await adminApi.get('/skovo-platform-panel-admin/console');
      if (!alive.current) return;
      if (res?.bool) { setData(res.response); setError(''); return true; }
      setError(res?.response?.message || 'Could not load your account status.');
      return false;
    } catch {
      if (alive.current) setError('Could not load your account status.');
      return false;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  return {
    data,
    loading,
    error,
    reload: load,
    // True when the call did not answer at all. Distinct from 'pending',
    // which is a claim ABOUT the account -- and claiming it on no evidence is
    // how an expired token came to read as "awaiting approval".
    unknown: !loading && !data,
    state: data?.state || 'pending',
    // Default to false while loading. Rendering the console and then removing
    // it reads as a bug; a brief hold reads as loading.
    canOperate: Boolean(data?.can_operate),
    isPending: data?.state === 'pending',
    isSuspended: data?.state === 'suspended',
    guidelines: data?.guidelines || null,
    reason: data?.state_reason || null,
  };
}
