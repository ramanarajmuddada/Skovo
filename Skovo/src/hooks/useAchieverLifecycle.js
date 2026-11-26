import { useEffect, useState, useCallback, useRef } from 'react';
// achieverApi, not api: they read different tokens from localStorage
// (achiever_access_token vs access_token), and this endpoint is behind
// the achiever's. Using the student client sent no usable credential and
// every call came back 401 -- silently, because the hook falls back.
import { achieverApi } from '../services/api';

/**
 * The achiever's state, capabilities and checklist — from the server, once.
 *
 * The portal has five states and eleven screens, and the temptation is to let
 * each screen decide whether it should be locked. That is how a screen ends up
 * enabled in the UI while the API refuses it — or worse, editable in the UI and
 * silently discarded. So there is one source: GET /achiever-application/lifecycle,
 * computed in the database by sp_achiever_capabilities.
 *
 * Guidelines come from the server too, so the wording can change without a
 * frontend deploy.
 */
export function useAchieverLifecycle() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  // Navigating away mid-request would otherwise set state on an unmounted
  // component — harmless in dev, a console error in production, and a real
  // leak when the portal is opened and closed repeatedly.
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
      const { data: res } = await achieverApi.get('/achiever-application/lifecycle');
      if (!alive.current) return;
      if (res?.bool) {
        setData(res.response);
        setError('');
      } else {
        setError(res?.response?.message || 'Could not load your account status.');
      }
    } catch {
      if (alive.current) setError('Could not load your account status.');
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  // set-state-in-effect fires on any effect that can reach setState, which
  // includes fetch-on-mount. The state here is set inside an awaited callback,
  // not synchronously during render, and the `alive` guard above covers the
  // unmount case the rule exists to prevent.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const state = data?.state || 'pending';

  // Floor, not a default. Before the fetch lands -- and if it fails outright --
  // `unlocked` would be [], and since locked screens are hidden rather than
  // greyed out that renders an empty sidebar, which looks like a broken portal.
  // Verification is what a brand-new achiever gets anyway, and it is the one
  // screen every state in SCREENS has in common -- so falling back to it is
  // both safe and correct.
  const unlocked = data?.screens?.unlocked || ['verification'];

  return {
    data,
    loading,
    error,
    reload: load,

    state,
    isPending:   state === 'pending',
    isActive:    state === 'active',
    isSuspended: state === 'suspended',
    isBanned:    state === 'banned',

    can: key => unlocked.includes(key),
    unlocked,

    caps:       data?.capabilities || {},
    checklist:  data?.checklist || [],
    guidelines: data?.guidelines || null,
  };
}
