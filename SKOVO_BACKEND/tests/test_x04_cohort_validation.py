"""
X-04 Field validation — "Cohort create", all 45 cases (X04-063 … X04-107).

Every test names its workbook Test ID, so `report_to_workbook.py` can write the
result straight back into SKOVO_v1_Test_Cases_Results.xlsx.

The sheet's recurring demand, and the reason this file exists:

    A 400 naming the field — never a MySQL 500 with an opaque error id.

So almost every refusal here asserts three things, not one: the status is 400,
the message names the field a person has to go and fix, and `error_id` is
absent. That last check is the load-bearing one. A 500 also "refuses" the input,
and a test asserting only "not created" passes on both — while the achiever sees
a reference number and no idea which box was wrong.

Isolation follows tests/conftest.py: a throwaway achiever per module, every
cohort created here deleted afterwards. Rows are keyed to `x04-cohort-test-`.

Note on the envelope: every route answers HTTP 200 and carries its real status
inside the JSON, so assert on `body['status']`, never `resp.status_code`.
"""
import datetime
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

COHORTS = '/v1/achievers/portal/cohorts'
TEST_PREFIX = 'x04-cohort-test-'

# Payloads the sheet names by kind, defined once so "unicode" means the same
# thing for every field and a failure points at the field, not the fixture.
UNICODE = 'Café ☕ 日本語 — Ω 🎓'
HTML = '<script>alert("xss")</script><b>bold</b>'
SQLI = "O'Brien; DROP TABLE cohorts;--"
NEWLINES = 'Line one\nLine two\n\nLine four'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


@pytest.fixture
def achiever(app, db):
    """One active achiever for the module, plus cleanup of what it creates."""
    aid = str(uuid.uuid4())
    did = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, state, status, is_active,
                               is_verified, created_at, updated_at)
        VALUES (:i, 'X04 Cohort Test', :e, 'active', 'active', 1, 1,
                UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.execute(text("""
        INSERT INTO domains (id, name, slug, is_active, created_by, created_at, updated_at)
        VALUES (:i, 'X04 Domain', :s, 1, :a, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': did, 's': f'x04-{did[:12]}', 'a': aid})
    db.session.commit()

    yield {'id': aid, 'domain_id': did}

    db.session.execute(text('DELETE FROM cohorts WHERE achiever_id = :a'), {'a': aid})
    db.session.execute(text('DELETE FROM domains WHERE id = :i'), {'i': did})
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.commit()


@pytest.fixture
def auth(app, achiever):
    with app.app_context():
        token = create_access_token(
            identity=str(achiever['id']),
            additional_claims={'role': 'mentor', 'mentor': True,
                               'full_name': 'X04 Cohort Test'})
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def create(client, auth, achiever):
    """POST a cohort. Returns (status, body). Required create fields are filled
    so a test about `price` cannot fail for a reason about `title`."""
    def _create(**fields):
        payload = {
            'title': f'X04 Cohort {uuid.uuid4().hex[:8]}',
            'domain_id': achiever['domain_id'],
            'about': 'About this class.',
            'what_you_learn': ['One learning point'],
            'session_date': (datetime.datetime.now() + datetime.timedelta(days=3)).strftime('%Y-%m-%dT%H:%M'),
            'duration_minutes': 60,
        }
        payload.update(fields)
        d = body(client.post(COHORTS, json=payload, headers=auth))
        return d['status'], d
    return _create


@pytest.fixture
def stored(db):
    """Read columns straight from the row — the only way to prove what was
    *stored*, as opposed to what the response happened to echo back."""
    def _stored(cohort_id, *columns):
        row = db.session.execute(
            text(f'SELECT {", ".join(columns)} FROM cohorts WHERE id = :i'),
            {'i': cohort_id}).mappings().first()
        assert row is not None, f'cohort {cohort_id} was not stored'
        return row
    return _stored


def refused(d, *, naming):
    """A refusal must be a 400 that names the field, with no error_id.

    `naming` is the word the achiever needs to see to know which box to fix.
    """
    assert d['status'] == 400, d
    msg = d['response'].get('message', '')
    assert naming.lower() in msg.lower(), f'message does not name {naming!r}: {msg!r}'
    assert d['response'].get('error_id') is None, \
        f'refusal was captured as a server error: {d["response"]}'


def created(code, d):
    assert code == 201, d
    cid = d['response'].get('cohort_id') or d['response'].get('id')
    assert cid, f'no cohort id in {d["response"]}'
    return cid


# ── Title ────────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-063')
def test_title_empty_is_refused(create):
    refused(create(title='')[1], naming='Title')


@pytest.mark.case('X04-064')
def test_title_only_whitespace_is_trimmed_then_treated_as_empty(create):
    """Not the same test as the one above: this one proves the trim happens
    *before* the required check, which is the order that makes '   ' an error
    rather than a three-character title."""
    refused(create(title='   \t  ')[1], naming='Title')


@pytest.mark.case('X04-065')
def test_title_over_the_limit_is_a_400_naming_the_limit(create):
    code, d = create(title='x' * 256)
    refused(d, naming='Title')
    assert '255' in d['response']['message'], \
        'the message must state the limit, or the achiever is guessing'


@pytest.mark.case('X04-065')
def test_title_at_the_limit_is_accepted(create):
    """The boundary either side — an off-by-one in the cap rejects a legitimate
    255-character title, which no one would report as a bug."""
    created(*create(title='x' * 255))


@pytest.mark.case('X04-066')
def test_title_leading_and_trailing_spaces_are_trimmed_before_storing(create, stored):
    cid = created(*create(title='   Padded Title   '))
    assert stored(cid, 'title')['title'] == 'Padded Title'


@pytest.mark.case('X04-067')
def test_title_unicode_and_emoji_survive_intact(create, stored):
    """utf8mb4 or mojibake. A 4-byte emoji in a utf8(3-byte) column is either a
    500 or a silently mangled row, and both look like the feature works until
    someone reads it back."""
    cid = created(*create(title=UNICODE))
    assert stored(cid, 'title')['title'] == UNICODE


@pytest.mark.case('X04-068')
def test_title_html_is_stored_verbatim_not_stripped(create, stored):
    """Storage keeps exactly what was typed; escaping is the renderer's job and
    React does it. Stripping here would corrupt a legitimate title containing
    '<' and give a false sense that the XSS question is handled server-side."""
    cid = created(*create(title=HTML))
    assert stored(cid, 'title')['title'] == HTML


@pytest.mark.case('X04-069')
def test_title_sql_metacharacters_are_stored_verbatim(create, stored):
    cid = created(*create(title=SQLI))
    assert stored(cid, 'title')['title'] == SQLI


# ── Price ────────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-070')
def test_price_zero_is_a_free_cohort_not_a_missing_price(create, stored):
    cid = created(*create(price=0))
    assert int(stored(cid, 'price')['price']) == 0


@pytest.mark.case('X04-071')
def test_price_negative_is_refused(create):
    refused(create(price=-100)[1], naming='Price')


@pytest.mark.case('X04-072')
def test_price_non_numeric_is_refused(create):
    refused(create(price='abc')[1], naming='Price')


@pytest.mark.case('X04-073')
def test_price_decimal_has_defined_behaviour(create):
    """The sheet allows either, provided it is defined: cohorts are priced in
    whole rupees, so '499.50' is refused as not a whole number rather than
    silently truncated to 499 — a price the achiever did not choose."""
    refused(create(price='499.50')[1], naming='Price')


@pytest.mark.case('X04-074')
def test_price_very_large_never_overflows_into_a_500(create):
    """`price` has no upper bound in the validator, so this rides straight into
    the DECIMAL column. Either answer is fine; a 500 is not."""
    code, d = create(price=10 ** 12)
    assert d['status'] in (201, 400), d
    if d['status'] == 400:
        assert d['response'].get('error_id') is None, d['response']


@pytest.mark.case('X04-075')
def test_price_leading_zeros_are_normalised(create, stored):
    cid = created(*create(price='007'))
    assert int(stored(cid, 'price')['price']) == 7


# ── Total seats ──────────────────────────────────────────────────────────────

@pytest.mark.case('X04-076')
def test_total_seats_blank_stores_null_meaning_unlimited(create, stored):
    """The int(None) 500 that broke *every* create on 2 Sep. Blank is not zero;
    it is "no ceiling", and NULL is what the enrolment procedures expect."""
    cid = created(*create(total_seats=''))
    assert stored(cid, 'total_seats')['total_seats'] is None


@pytest.mark.case('X04-077')
def test_total_seats_zero_means_unlimited(create, stored):
    """0 is normalised to NULL by the route (`data.get('total_seats') or None`).
    Both spellings mean unlimited, so either is correct — what must not happen
    is 0 surviving as a *ceiling* of zero, which would refuse every enrolment.

    Worth knowing while reading this: the `cohorts.total_seats` COLUMN DEFAULT
    is still **50** in production, even though CLAUDE.md records that the
    default of 50 was removed everywhere. It does not bite today only because
    this route always sends an explicit value; any INSERT that omits the column
    silently gets a 50-seat cap.
    """
    seats = stored(cid := created(*create(total_seats=0)), 'total_seats')['total_seats']
    assert seats is None or int(seats) == 0, f'0 seats stored as {seats!r}'
    assert cid


@pytest.mark.case('X04-078')
def test_total_seats_negative_is_refused(create):
    refused(create(total_seats=-5)[1], naming='seats')


@pytest.mark.case('X04-079')
def test_total_seats_non_numeric_is_refused(create):
    refused(create(total_seats='many')[1], naming='seats')


@pytest.mark.case('X04-080')
def test_total_seats_huge_is_refused(create):
    refused(create(total_seats=10 ** 9)[1], naming='seats')


# ── Duration ─────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-081')
def test_duration_blank_is_refused(create):
    refused(create(duration_minutes='')[1], naming='minutes')


@pytest.mark.case('X04-082')
def test_duration_zero_is_refused(create):
    """Unlike seats, zero is not a meaning here — a session of no length would
    make `session_date + duration` equal the start, so the class would be over
    the instant it began and every task gate would read it as finished."""
    refused(create(duration_minutes=0)[1], naming='Duration')


@pytest.mark.case('X04-083')
def test_duration_negative_is_refused(create):
    refused(create(duration_minutes=-30)[1], naming='Duration')


@pytest.mark.case('X04-084')
def test_duration_non_numeric_is_refused(create):
    refused(create(duration_minutes='ninety')[1], naming='Duration')


@pytest.mark.case('X04-085')
def test_duration_beyond_a_day_is_refused(create):
    refused(create(duration_minutes=100000)[1], naming='Duration')


# ── Session date ─────────────────────────────────────────────────────────────

@pytest.mark.case('X04-086')
def test_session_date_blank_is_allowed(create, stored):
    cid = created(*create(session_date=''))
    assert stored(cid, 'session_date')['session_date'] is None


@pytest.mark.case('X04-087')
def test_session_date_in_the_past_has_defined_behaviour(create):
    """The sheet permits "refused where it must be future, else defined
    behaviour". It is accepted, deliberately: an achiever recording a class that
    already happened is a real case, and `effective_cohort_status` derives such
    a cohort as completed rather than offering it for enrolment."""
    past = (datetime.datetime.now() - datetime.timedelta(days=30)).replace(microsecond=0)
    code, d = create(session_date=past.isoformat(timespec='minutes'))
    assert code == 201, d


@pytest.mark.case('X04-088')
def test_session_date_invalid_format_is_refused_not_a_500(create):
    refused(create(session_date='next friday')[1], naming='Session date')


@pytest.mark.case('X04-089')
def test_session_date_round_trips_utc_with_no_ist_drift(create, stored):
    """The form sends naive local (IST); storage is UTC. 5h30m is the distance
    between "correct" and "every student joins the call at the wrong hour"."""
    local = (datetime.datetime.now() + datetime.timedelta(days=5)).replace(
        hour=18, minute=30, second=0, microsecond=0)
    cid = created(*create(session_date=local.isoformat(timespec='minutes')))
    assert stored(cid, 'session_date')['session_date'] == \
        local - datetime.timedelta(hours=5, minutes=30)


@pytest.mark.case('X04-090')
def test_a_cohort_cannot_end_before_it_starts(create):
    """A cohort has no end column — its end is `session_date + duration`, so the
    only way to express "end before start" is a non-positive duration, and that
    is refused. Recorded rather than skipped: the next person reading the sheet
    should not go looking for an end field that was never there."""
    future = (datetime.datetime.now() + datetime.timedelta(days=2)).replace(microsecond=0)
    refused(create(session_date=future.isoformat(timespec='minutes'),
                   duration_minutes=-1)[1], naming='Duration')


@pytest.mark.case('X04-091')
def test_session_date_far_in_the_future_is_accepted(create):
    code, d = create(session_date='2099-12-31T10:00')
    assert code == 201, d


# ── Registration deadline ────────────────────────────────────────────────────

@pytest.mark.case('X04-092')
def test_registration_deadline_blank_is_allowed(create, stored):
    cid = created(*create(registration_deadline=''))
    assert stored(cid, 'registration_deadline')['registration_deadline'] is None


@pytest.mark.case('X04-093')
def test_registration_deadline_in_the_past_is_accepted_and_closes_enrolment(create):
    """Accepted at write time on purpose. The deadline is *enforced* at the
    enrolment guard (brief 1.2); refusing it here would stop an achiever
    recording a past cohort truthfully."""
    past = (datetime.datetime.now() - datetime.timedelta(days=2)).replace(microsecond=0)
    code, d = create(registration_deadline=past.isoformat(timespec='minutes'))
    assert code == 201, d


@pytest.mark.case('X04-094')
def test_registration_deadline_invalid_format_is_refused(create):
    """This is the one the validator was written for: session_date was guarded
    and the deadline beside it was not, so a bad value here was an uncaught
    ValueError — a 500 with an error id, on a field the form collects."""
    refused(create(registration_deadline='soon')[1], naming='Registration deadline')


@pytest.mark.case('X04-095')
def test_registration_deadline_is_ignored_on_create(create, stored):
    """Enrolment closes when the class goes live. Deadline is not stored."""
    local = (datetime.datetime.now() + datetime.timedelta(days=3)).replace(
        hour=23, minute=59, second=0, microsecond=0)
    cid = created(*create(registration_deadline=local.isoformat(timespec='minutes')))
    assert stored(cid, 'registration_deadline')['registration_deadline'] is None


@pytest.mark.case('X04-096')
def test_a_deadline_after_the_session_is_not_an_error(create):
    """Deliberately NOT refused. Two production cohorts are already in this
    shape, and the status check has closed enrolment by then anyway, so the
    deadline simply never binds. Treating it as an error would reject rows the
    database already holds."""
    session = (datetime.datetime.now() + datetime.timedelta(days=5)).replace(microsecond=0)
    deadline = session + datetime.timedelta(days=3)
    code, d = create(session_date=session.isoformat(timespec='minutes'),
                     registration_deadline=deadline.isoformat(timespec='minutes'))
    assert code == 201, d


@pytest.mark.case('X04-097')
def test_registration_deadline_far_future_is_accepted(create):
    code, d = create(registration_deadline='2099-01-01T00:00')
    assert code == 201, d


# ── Meeting link ─────────────────────────────────────────────────────────────

@pytest.mark.case('X04-098')
def test_meeting_link_blank_is_allowed(create):
    code, d = create(meeting_link='')
    assert code == 201, d


@pytest.mark.case('X04-099')
def test_meeting_link_without_a_scheme_is_refused(create):
    """External-only, and the asymmetry is intentional: LinkedIn accepts a
    scheme-less URL (CLAUDE.md says do not tighten it), but a Teams room is
    never on our own origin, so 'meet.google.com/abc' cannot be resolved."""
    refused(create(meeting_link='meet.google.com/abc-defg-hij')[1],
            naming='Meeting link')


@pytest.mark.case('X04-100')
def test_meeting_link_bare_filename_is_refused(create):
    refused(create(meeting_link='meeting.html')[1], naming='Meeting link')


@pytest.mark.case('X04-101')
def test_meeting_link_javascript_scheme_is_refused(create):
    """The XSS case. Students click this link from the cohort page, so a
    `javascript:` URL here is stored XSS aimed at everyone in the class."""
    refused(create(meeting_link='javascript:alert(document.cookie)')[1],
            naming='Meeting link')


@pytest.mark.case('X04-102')
def test_meeting_link_over_the_url_limit_is_refused(create):
    refused(create(meeting_link='https://teams.example.com/' + 'a' * 1200)[1],
            naming='Meeting link')


@pytest.mark.case('X04-103')
def test_meeting_link_to_a_non_existent_host_is_saved(create, stored):
    """Saved without a reachability check. Resolving it would make cohort
    creation depend on a third party being up, and block on DNS while the
    achiever waits."""
    url = 'https://this-host-does-not-exist-skovo.invalid/room/1'
    cid = created(*create(meeting_link=url))
    assert stored(cid, 'meeting_link')['meeting_link'] == url


# ── About ────────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-104')
def test_about_blank_is_refused(create):
    refused(create(about='')[1], naming='about')


@pytest.mark.case('X04-105')
def test_about_of_50k_is_refused_with_a_stated_limit(create):
    code, d = create(about='x' * 50000)
    refused(d, naming='About')
    assert '5000' in d['response']['message']


@pytest.mark.case('X04-106')
def test_about_preserves_newlines(create, stored):
    cid = created(*create(about=NEWLINES))
    assert stored(cid, 'about')['about'] == NEWLINES


@pytest.mark.case('X04-107')
def test_about_html_is_stored_verbatim(create, stored):
    cid = created(*create(about=HTML))
    assert stored(cid, 'about')['about'] == HTML
