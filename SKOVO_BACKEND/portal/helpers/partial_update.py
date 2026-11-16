"""Tell "the caller omitted this" apart from "the caller set this to null".

`reqparse.parse_args()` returns EVERY declared argument, filling omitted ones
with None. Every admin editor here then builds a full-replace argument list with
`existing.get(field)` as the fallback for anything "not supplied" — and `field in
args` is always true, so the fallback never fires and a partial PUT overwrites
everything the caller did not resend with NULL.

That was not theoretical. On `/skovo-platform-panel-admin/cohorts/<id>`, sending
only `session_date` set `achiever_id` to NULL: the cohort was silently orphaned
from the person teaching it, who then lost its roster, its check-in code and the
ability to cancel it — with no error anywhere, and the students' enrolments
still pointing at it. `meeting_link`, `about`, `total_seats` and the whole
targeting block went the same way.

Keying on the raw JSON body keeps an explicit `null` meaningful: "omitted" and
"null" are different instructions, and reqparse is what collapses them.

    args = update_parser.parse_args()
    sp_args = _build_args(id, title, supplied(args), existing)
"""
from flask import request


def supplied(parsed):
    """The subset of `parsed` whose keys were actually present in the request."""
    raw = request.get_json(silent=True) or {}
    return {k: v for k, v in parsed.items() if k in raw}
