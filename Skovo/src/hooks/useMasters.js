import { useEffect, useState, useMemo } from 'react';
import { api } from '../services/api';

/**
 * Option lists, from the database.
 *
 * Every dropdown in SKOVO reads its choices from master data rather than a
 * const array in the component. The reason is not tidiness: these values get
 * stored on profiles and compared with exact string equality by the cohort and
 * course targeting engine. Two copies of a list drift, and when they do the
 * failure is silent — a cohort targeted at "PCB" simply never reaches a student
 * whose profile says "science_pcb", and nothing errors.
 *
 * Usage:
 *   const { lists, loading } = useMasters(['college_type', 'opportunity_type']);
 *   lists.college_type  // [{ value, label }]
 *
 * `fallback` keeps a screen usable if the fetch fails — pass the old hardcoded
 * array where an empty dropdown would strand the user.
 *
 * ── Why the cache is keyed by TYPE, not by call ──────────────────────────────
 *
 * It used to be keyed on the joined type list, so `['a','b']` and `['b']` were
 * two unrelated cache entries and two requests, even though the second is a
 * subset of the first. A screen with three components each asking for their own
 * lists therefore paid three round trips for reference data that changes about
 * once a week — which is what UI05-004 caught on Colleges.
 *
 * Now each type is cached on its own and every ask inside one tick is collected
 * into a single `?types=a,b,c` request. A component that wants a list another
 * component already fetched costs nothing at all, and the common case of a page
 * mounting several dropdown-bearing children is one request rather than one per
 * child. StrictMode's double-invoke collapses into the same batch for free.
 */

// Ten minutes. Long enough that navigating around the portal never re-fetches a
// dropdown, short enough that an admin who edits master data sees it take
// effect without telling anyone to reload.
const MASTERS_TTL = 600000;

// type -> { at: epochMs, list: [{value,label}] }
const cache = new Map();
// type -> Promise resolving once the in-flight batch carrying it has landed.
const inflight = new Map();

let pending = new Set();
let scheduled = null;

const fresh = (type) => {
  const hit = cache.get(type);
  return hit && (Date.now() - hit.at) < MASTERS_TTL ? hit.list : null;
};

/** Fire one request for everything asked for since the last tick. */
function flush() {
  scheduled = null;
  const types = [...pending];
  pending = new Set();
  if (!types.length) return;

  const request = api.get(`/auth/masters?types=${types.join(',')}`)
    .then(({ data }) => {
      const grouped = (data && data.bool && data.response?.grouped) || {};
      const at = Date.now();
      // Cache every type the batch asked for, including ones the server had
      // nothing for. Without that an absent type is re-requested by every
      // consumer for ever, and `public_masters.py` walks the whole registry on
      // a bare call — one missing table 500s the entire response.
      for (const t of types) cache.set(t, { at, list: grouped[t] || [] });
    })
    .catch(() => {
      // Do NOT cache a failure: a dropped connection must not blank a dropdown
      // for the next ten minutes. The caller falls back to its own list.
    })
    .finally(() => { for (const t of types) inflight.delete(t); });

  for (const t of types) inflight.set(t, request);
}

/** Resolve these types, batching with anything else asked for this tick. */
function want(types) {
  const waits = [];
  for (const t of types) {
    if (fresh(t)) continue;
    const already = inflight.get(t);
    if (already) { waits.push(already); continue; }
    pending.add(t);
  }
  if (pending.size && !scheduled) {
    // A microtask, not a timer: every component mounting in the same commit
    // lands in one batch, and nothing waits on a timer that a test would have
    // to sleep through.
    scheduled = Promise.resolve().then(flush);
  }
  // The batch promise is only registered inside flush(), so wait on the
  // scheduler first and then on whatever it produced.
  return Promise.resolve(scheduled)
    .then(() => Promise.all([...waits, ...types.map((t) => inflight.get(t)).filter(Boolean)]))
    .then(() => Object.fromEntries(
      types.map((t) => [t, cache.get(t)?.list || null]).filter(([, v]) => v)));
}

export const MASTER_TYPE = '__masterType';

export function useMasters(types, fallback = {}) {
  const key = Array.isArray(types) ? types.join(',') : String(types || '');
  const list = key ? key.split(',') : [];

  // Seed from the cache synchronously so a warm screen paints its dropdowns on
  // the first frame instead of flashing empty and then filling in.
  const [lists, setLists] = useState(() => {
    const warm = {};
    for (const t of list) { const v = fresh(t); if (v) warm[t] = v; }
    return { ...fallback, ...warm };
  });
  const [loading, setLoading] = useState(() => list.some((t) => !fresh(t)));

  useEffect(() => {
    if (!key) return undefined;
    let alive = true;
    want(key.split(','))
      .then((grouped) => {
        if (!alive) return;
        // Keep the fallback for any type the server had nothing for, so a
        // half-seeded environment degrades to the old list instead of a blank.
        setLists((prev) => ({ ...prev, ...grouped }));
      })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [key]);

  // Tag each list with the master type it came from, invisibly. FormSelect
  // reads it and searches the DATABASE instead of filtering in memory, so a
  // dropdown fed from masters gets server-side search with no change at the
  // call site. Non-enumerable so it never shows up in a spread, a JSON encode
  // or a key list.
  const tagged = useMemo(() => {
    const out = {};
    for (const [type, arr] of Object.entries(lists)) {
      if (Array.isArray(arr) && !Object.prototype.hasOwnProperty.call(arr, MASTER_TYPE)) {
        Object.defineProperty(arr, MASTER_TYPE, { value: type, enumerable: false });
      }
      out[type] = arr;
    }
    return out;
  }, [lists]);

  return { lists: tagged, loading };
}

/**
 * Prepend an "All …" row while keeping the master tag.
 *
 * `[{value:'',label:'All'}, ...list]` is the usual way to build a filter's
 * options, and a spread drops the tag with it -- the dropdown silently falls
 * back to client-side filtering. This keeps it.
 */
export function withAll(list, label = 'All') {
  const arr = [{ value: '', label }, ...(list || [])];
  const type = list && list[MASTER_TYPE];
  if (type) Object.defineProperty(arr, MASTER_TYPE, { value: type, enumerable: false });
  return arr;
}

/** Drop the cache — for an admin screen that has just edited master data. */
export function invalidateMasters(types) {
  if (!types) { cache.clear(); return; }
  for (const t of [].concat(types)) cache.delete(t);
}

/** `[{value,label}]` → the plain values, for filter chips that store a string. */
export const values = (list) => (list || []).map(o => o.value);

/** Look up one label without caring whether the list has loaded yet. */
export const labelOf = (list, value, fallbackLabel) =>
  (list || []).find(o => o.value === value)?.label || fallbackLabel || value;
