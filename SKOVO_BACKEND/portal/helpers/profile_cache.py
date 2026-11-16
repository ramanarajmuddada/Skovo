"""
A very short-lived cache for `sp_profile_get_by_user`.

WHY
    The student Colleges list needs the profile on every request, only to decide
    which banner to show and which degree to filter on. The profile is one of
    three round trips that page makes to RDS in Mumbai, and it is the one whose
    answer almost never changes between two clicks of a paginator.

WHAT IT IS NOT
    Not a general profile cache. `TTL_SECONDS` is deliberately shorter than a
    student's attention span on one screen — long enough to cover a page of
    browsing, too short to be worth reasoning about anywhere a stale profile
    would be a correctness problem. Read the profile directly if you need it to
    be current; use this only where a few seconds of staleness is invisible.

INVALIDATION
    `sp_profile_upsert` is the single write path (Profile/profile.py), and it
    calls `invalidate()`. That is exact within one process. Under gunicorn with
    several workers, the worker that did not serve the write keeps its copy
    until the TTL expires — bounded by TTL_SECONDS, and the only symptom is a
    banner that catches up a few seconds late.

    A Redis-backed cache would close that gap; it is not worth a new dependency
    for a banner. If one appears for another reason, move this behind it.
"""
import threading
import time

TTL_SECONDS = 30

_lock = threading.Lock()
_entries = {}          # user_id -> (expires_at, value)


def get_or_load(user_id, loader):
    """Return the cached profile for `user_id`, calling `loader()` on a miss.

    A cached ``None`` is a real answer — a user with no profile row — and is
    cached like any other, so a profileless student does not re-query on every
    page. Anything `loader` raises propagates and nothing is cached.
    """
    if not user_id:
        return loader()

    now = time.monotonic()
    with _lock:
        hit = _entries.get(user_id)
        if hit and hit[0] > now:
            return hit[1]

    value = loader()

    with _lock:
        # Opportunistic sweep — this dict is only ever as big as the students
        # active in the last TTL_SECONDS, but nothing else would ever drop a
        # user who logged out an hour ago.
        if len(_entries) > 512:
            for k, (exp, _) in list(_entries.items()):
                if exp <= now:
                    _entries.pop(k, None)
        _entries[user_id] = (now + TTL_SECONDS, value)
    return value


def invalidate(user_id=None):
    """Drop one user's entry, or the whole cache when called with no argument."""
    with _lock:
        if user_id is None:
            _entries.clear()
        else:
            _entries.pop(user_id, None)
