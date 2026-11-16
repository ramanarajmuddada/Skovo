"""Outbound HTTPS client for third-party APIs (Cashfree, etc).

Local-dev-only workaround: AVG Antivirus's "Web/Mail Shield" re-signs every
outbound TLS connection with its own root CA (silently trusted by browsers
because AVG installs it into the Windows trust store). Python doesn't read
that store, so requests to the payment gateway fail outright unless that root is also
added to REQUESTS_CA_BUNDLE. Even then, Python 3.13's urllib3 enables
ssl.VERIFY_X509_STRICT by default, and AVG's root cert doesn't mark its
BasicConstraints extension critical (a spec violation on AVG's end) — so
strict mode rejects it anyway. Relaxing that one flag only kicks in when
AVG_TLS_WORKAROUND=1 is set (this repo's local .env); production has no AVG
in the path and never sets that var, so it verifies with the normal default.
"""
import os
import ssl
import requests
from requests.adapters import HTTPAdapter


class _RelaxedStrictAdapter(HTTPAdapter):
    def init_poolmanager(self, *args, **kwargs):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
        ctx.verify_flags &= ~getattr(ssl, 'VERIFY_X509_STRICT', 0)
        cafile = os.environ.get('REQUESTS_CA_BUNDLE')
        if cafile:
            ctx.load_verify_locations(cafile=cafile)
        else:
            ctx.load_default_certs()
        kwargs['ssl_context'] = ctx
        super().init_poolmanager(*args, **kwargs)


def http_session() -> requests.Session:
    """A requests.Session for calling external APIs. Identical to plain
    `requests` everywhere except local dev with AVG_TLS_WORKAROUND=1."""
    s = requests.Session()
    if os.environ.get('AVG_TLS_WORKAROUND') == '1':
        s.mount('https://', _RelaxedStrictAdapter())
    return s
