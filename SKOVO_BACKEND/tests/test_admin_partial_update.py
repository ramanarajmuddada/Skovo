"""A partial PUT must not erase the fields it did not mention.

THE BUG
    Every admin editor here builds a FULL-REPLACE argument list for its
    `sp_*_update` procedure, falling back to the stored row for anything the
    caller did not supply. The fallback never fired, because
    `reqparse.parse_args()` returns EVERY declared argument — filling omitted
    ones with None — so `field in args` was always true and None was written.

    On `/skovo-platform-panel-admin/cohorts/<id>`, sending only `session_date`
    set `achiever_id` to NULL. The cohort was silently orphaned from the person
    teaching it: they lost the roster, the check-in code and the ability to
    cancel it, while the students' enrolments still pointed at it and nothing
    errored. `meeting_link`, `about`, `total_seats` and the whole targeting
    block went the same way. `title` was guarded by hand at the call site, which
    is probably how somebody hit half of this and patched the symptom.

WHAT THIS PINS
    Two things, and the second is the one that decays quietly:

      1. A field the caller omitted keeps its stored value.
      2. A field the caller explicitly sends as `null` is still cleared —
         "omitted" and "null" are different instructions, and the naive fix
         (drop every None) collapses them the other way. `admin_achievers.py`
         already takes that shortcut; it is safe from the wipe but cannot clear
         a field, which is a trade-off worth knowing rather than copying.

    The source check below covers all four editors at once. It is deliberately
    a source assertion rather than four HTTP round trips: the failure mode is
    someone adding a fifth editor with the same shape, and that is visible in
    the source before any request is made.
"""
import pathlib
import re

import pytest

REPO = pathlib.Path(__file__).resolve().parents[2]
ADMIN_ROUTES = REPO / 'SKOVO_BACKEND' / 'portal' / 'routes' / 'Admin'

# Editors whose update procedure is a full replace, so an unsupplied field has
# to fall back to the stored row rather than to None.
FULL_REPLACE = [
    'admin_cohorts.py',
    'admin_colleges.py',
    'admin_coaching.py',
    'admin_opportunities.py',
]


def _put_body(path):
    """The source of the `def put(` handler in this module."""
    src = path.read_text(encoding='utf-8', errors='ignore')
    i = src.find('def put(')
    assert i != -1, f'{path.name} has no PUT handler'
    return src[i:i + 3000]


@pytest.mark.parametrize('filename', FULL_REPLACE)
def test_partial_put_does_not_pass_raw_parse_args(filename):
    """The update call must go through `supplied(...)`, not raw `args`.

    Passing `args` straight into a full-replace builder is the bug: reqparse has
    already filled every omitted field with None, so the builder's
    `existing.get(field)` fallback is unreachable.
    """
    path = ADMIN_ROUTES / filename
    body = _put_body(path)

    calls = re.findall(r'sp_args\s*=\s*[\w.]*_?\w*sp_args\(|sp_args\s*=\s*\(?_build_args\(', body)
    assert calls, f'{filename}: could not find the update argument builder in PUT'

    # The builder's `d` argument — the dict of caller-supplied fields.
    passes_raw = re.search(r'_(?:sp_args|build_args)\([^)]*?,\s*args\s*,', body)
    assert not passes_raw, (
        f'{filename}: its PUT passes raw `args` into a full-replace builder. '
        'reqparse fills every omitted argument with None, so every field the '
        'admin did not resend is written as NULL — this is how editing a '
        "cohort's date wiped its achiever_id. Wrap it: supplied(args).")

    assert 'supplied(' in body, (
        f'{filename}: PUT does not use helpers/partial_update.supplied(), so it '
        'cannot tell an omitted field from an explicit null.')


def test_supplied_keeps_explicit_nulls():
    """`supplied` must keep a key the caller sent as null.

    Dropping every None is the tempting one-liner and it is wrong in the other
    direction: it makes a field impossible to clear. The distinction is the
    whole reason this reads the raw body instead of filtering on value.
    """
    from flask import Flask

    from portal.helpers.partial_update import supplied

    app = Flask(__name__)
    parsed = {'title': 'kept', 'about': None, 'meeting_link': None}

    with app.test_request_context(json={'title': 'kept', 'about': None}):
        out = supplied(parsed)

    assert out == {'title': 'kept', 'about': None}, out
    assert 'about' in out, 'an explicitly-null field must survive, so it can be cleared'
    assert 'meeting_link' not in out, 'a field the caller never mentioned must not be written'


def test_supplied_handles_a_body_that_is_not_json():
    """A malformed or absent body must yield "nothing supplied", not an error.

    `silent=True` matters: without it this raises on a PUT with no body, and the
    admin sees a 500 where the honest answer is "you changed nothing".
    """
    from flask import Flask

    from portal.helpers.partial_update import supplied

    app = Flask(__name__)
    with app.test_request_context(data='not json', content_type='text/plain'):
        assert supplied({'title': None, 'about': None}) == {}
