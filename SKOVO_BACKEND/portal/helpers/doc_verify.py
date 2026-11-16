"""Content verification for uploaded documents — the switch, not the service.

WHAT THIS IS FOR
    The format and duplicate checks in sp_docvault_check answer "is this a
    plausible file". They cannot answer "is this really this student's
    marksheet" -- that needs something to read the page.

    We deliberately do not ship a reader. A marksheet is worth 2 points out of
    100, OCR costs money per upload and adds an outside dependency, and the
    payoff for faking one is 2% of a score. Policing it costs more than the
    damage.

    What we do ship is the seam, so turning it on later is configuration rather
    than a rewrite: one environment variable and one function.

HOW TO SWITCH IT ON
    1. Write a checker with this signature:

           def check(url, category, file_type, size) -> (verdict, detail)

       verdict is 'pass', 'fail' or 'unknown'. 'unknown' means the service could
       not decide -- a timeout, an unreadable scan, a format it does not handle.

    2. Point DOC_VERIFY_BACKEND at it, e.g.
           DOC_VERIFY_BACKEND=portal.helpers.doc_verify_textract:check

    3. Optionally narrow it with DOC_VERIFY_CATEGORIES=marksheet,certificate so
       you only pay for the documents that are worth checking.

WHAT A FAILURE MAY AND MAY NOT DO
    A checker can refuse an upload outright, but only on a confident 'fail'.
    'unknown' never blocks: a student whose scan happens to be hard to read must
    not lose their document because a service was having a bad day. That is the
    whole reason for a three-valued verdict instead of a boolean.

    Nothing here ever silently removes points. An award already given is
    reversed through Adjust, by a person, with a reason.
"""
import importlib
import logging
import os

logger = logging.getLogger("skovo")

PASS, FAIL, UNKNOWN = 'pass', 'fail', 'unknown'


def _backend():
    """Resolve DOC_VERIFY_BACKEND to a callable, or None when unset."""
    spec = (os.environ.get('DOC_VERIFY_BACKEND') or '').strip()
    if not spec:
        return None
    try:
        module_name, _, func_name = spec.partition(':')
        module = importlib.import_module(module_name)
        return getattr(module, func_name or 'check')
    except Exception as e:
        # A misconfigured checker must not stop uploads. Log loudly, verify
        # nothing -- the same posture as having no checker at all.
        logger.error(f"DOC_VERIFY_BACKEND '{spec}' could not be loaded: {e}")
        return None


def _in_scope(category):
    """Which categories are worth paying to read. Empty means all of them."""
    raw = (os.environ.get('DOC_VERIFY_CATEGORIES') or '').strip()
    if not raw:
        return True
    return (category or '').strip().lower() in {
        c.strip().lower() for c in raw.split(',') if c.strip()}


def verify(url, category=None, file_type=None, size=None):
    """Check a document's content. Returns (verdict, detail).

    Answers ('unknown', 'no checker configured') when nothing is wired up, which
    is the shipped default and means "carry on". Never raises: verification is a
    side concern and must not break an upload that is otherwise fine.
    """
    if not _in_scope(category):
        return UNKNOWN, 'category not checked'

    fn = _backend()
    if fn is None:
        return UNKNOWN, 'no checker configured'

    try:
        verdict, detail = fn(url, category, file_type, size)
    except Exception as e:
        logger.error(f"document verification failed (category={category}): {e}")
        return UNKNOWN, 'checker error'

    if verdict not in (PASS, FAIL, UNKNOWN):
        logger.error(f"document checker returned an unknown verdict: {verdict!r}")
        return UNKNOWN, 'bad verdict'
    return verdict, detail


def blocks_upload(verdict):
    """Only a confident 'fail' stops an upload.

    'unknown' must never block. A student with a hard-to-read scan, or an
    upload during a service outage, keeps their document -- the cost of a wrong
    rejection is far higher than the 2 points at stake.
    """
    return verdict == FAIL
