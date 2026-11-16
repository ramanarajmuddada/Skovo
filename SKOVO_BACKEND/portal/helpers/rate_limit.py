"""
Shared rate limiter (flask-limiter).

In-memory storage locally; point RATELIMIT_STORAGE_URI at Redis in production
so limits are shared across gunicorn workers. Import `limiter` and decorate the
sensitive endpoints (login, register, OTP) with `@limiter.limit("...")`.

Fail-open by design: if the limiter backend is unavailable, requests are allowed
rather than blocked — availability over strictness for a young product.
"""
import os
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI', 'memory://')

limiter = Limiter(
    key_func=get_remote_address,
    storage_uri=_STORAGE_URI,
    # No global default — we opt specific sensitive routes in, so normal API
    # traffic (already JWT-gated) isn't throttled.
    default_limits=[],
    swallow_errors=True,  # fail-open if the storage backend hiccups
)
