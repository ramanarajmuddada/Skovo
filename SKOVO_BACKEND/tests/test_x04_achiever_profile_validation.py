"""
X-04 Field validation — "Achiever profile" (X04-039…062). 24 cases.

Covers LinkedIn URL, Bio, Designation and Company on `PUT /achievers/portal/profile`.

Two behaviours here are deliberate and easy to "fix" into bugs:

  * **LinkedIn is mandatory, and its regex is deliberately loose.** A URL with
    no scheme is valid — CLAUDE.md says in as many words not to tighten it —
    because achievers paste `linkedin.com/in/name` from the address bar far more
    often than they paste the full https form. Refusing that would reject the
    commonest correct answer.

  * **The endpoint validates only the keys it was actually sent.** The avatar
    picker PUTs `{profile_image_url}` alone, so an unconditional LinkedIn check
    would fail a photo save over a field the caller never mentioned. Every test
    below sends one field at a time for exactly that reason.
"""
import uuid

import pytest
from flask_jwt_extended import create_access_token
from sqlalchemy import text

PROFILE = '/v1/achievers/portal/profile'
TEST_PREFIX = 'x04-profile-test-'

UNICODE = 'Café ☕ 日本語 — Ω 🎓'
HTML = '<script>alert("xss")</script><b>bold</b>'
SQLI = "O'Brien; DROP TABLE achievers;--"
NEWLINES = 'First line\nSecond line\n\nFourth line'


@pytest.fixture
def client(app):
    return app.test_client()


def body(resp):
    payload = resp.get_json()
    assert payload is not None, f'no JSON body: {resp.data[:200]}'
    return payload


def refused(d, *, naming=None):
    assert d['status'] == 400, d
    assert d['response'].get('error_id') is None, \
        f'refusal was captured as a server error: {d["response"]}'
    if naming:
        msg = d['response'].get('message', '')
        assert naming.lower() in msg.lower(), f'message does not name {naming!r}: {msg!r}'


def never_a_500(d):
    assert d['status'] in (200, 400), d
    if d['status'] == 400:
        assert d['response'].get('error_id') is None, d['response']


@pytest.fixture
def achiever(app, db):
    aid = str(uuid.uuid4())
    db.session.execute(text("""
        INSERT INTO achievers (id, full_name, email, linkedin_url, state, status,
                               is_active, is_verified, created_at, updated_at)
        VALUES (:i, 'X04 Profile Test', :e, 'https://linkedin.com/in/x04-test',
                'active', 'active', 1, 1, UTC_TIMESTAMP(), UTC_TIMESTAMP())
    """), {'i': aid, 'e': f'{TEST_PREFIX}{aid}@skovo.test'})
    db.session.commit()
    yield aid
    db.session.execute(text('DELETE FROM achievers WHERE id = :i'), {'i': aid})
    db.session.commit()


@pytest.fixture
def auth(app, achiever):
    with app.app_context():
        token = create_access_token(
            identity=str(achiever),
            additional_claims={'role': 'mentor', 'mentor': True,
                               'full_name': 'X04 Profile Test'})
    return {'Authorization': f'Bearer {token}'}


@pytest.fixture
def save(client, auth):
    """PUT one field. Returns (status, body)."""
    def _save(**fields):
        d = body(client.put(PROFILE, json=fields, headers=auth))
        return d['status'], d
    return _save


@pytest.fixture
def stored(db, achiever):
    def _stored(column):
        return db.session.execute(
            text(f'SELECT {column} FROM achievers WHERE id = :i'),
            {'i': achiever}).scalar()
    return _stored


# ── LinkedIn URL ─────────────────────────────────────────────────────────────

@pytest.mark.case('X04-039')
def test_linkedin_empty_is_refused_because_it_is_mandatory(save):
    """The one URL on the profile that is NOT optional. The generic rule for an
    empty URL is "allowed if optional" — LinkedIn is not."""
    refused(save(linkedin_url='')[1], naming='LinkedIn')


@pytest.mark.case('X04-040')
def test_linkedin_without_a_scheme_is_accepted(save, stored):
    """Do not tighten this. `linkedin.com/in/name` is what an achiever copies
    out of the address bar, and refusing it rejects the commonest correct
    answer to make the regex tidier."""
    code, d = save(linkedin_url='linkedin.com/in/some-person')
    assert code == 200, d
    assert 'linkedin.com/in/some-person' in stored('linkedin_url')


@pytest.mark.case('X04-040')
def test_linkedin_with_a_leading_at_sign_is_accepted(save):
    """People paste `@linkedin.com/in/name` from a handle field; the route
    strips the '@' rather than refusing something obviously intended."""
    code, d = save(linkedin_url='@linkedin.com/in/some-person')
    assert code == 200, d


@pytest.mark.case('X04-041')
def test_linkedin_bare_filename_is_refused(save):
    refused(save(linkedin_url='profile.html')[1], naming='LinkedIn')


@pytest.mark.case('X04-042')
def test_linkedin_javascript_scheme_is_refused(save):
    """It fails the linkedin.com match, which is what refuses it — but the case
    exists because this field is rendered as an `<a href>` on the public
    profile, so a `javascript:` value that got through would be stored XSS."""
    refused(save(linkedin_url='javascript:alert(document.cookie)')[1], naming='LinkedIn')


@pytest.mark.case('X04-042')
def test_a_non_linkedin_url_is_refused(save):
    refused(save(linkedin_url='https://example.com/in/someone')[1], naming='LinkedIn')


@pytest.mark.case('X04-043')
def test_linkedin_very_long_url_never_500s(save):
    code, d = save(linkedin_url='https://linkedin.com/in/' + 'a' * 3000)
    never_a_500(d)


@pytest.mark.case('X04-044')
def test_linkedin_to_a_profile_that_does_not_exist_is_saved(save, stored):
    """Saved without a reachability check: resolving it would make saving a
    profile depend on LinkedIn being up, and block while it is not."""
    url = 'https://linkedin.com/in/definitely-not-a-real-profile-x04'
    code, d = save(linkedin_url=url)
    assert code == 200, d
    assert stored('linkedin_url') == url


# ── Bio ──────────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-045')
def test_bio_empty_is_allowed(save, stored):
    code, d = save(bio='')
    assert code == 200, d
    assert stored('bio') is None


@pytest.mark.case('X04-046')
def test_bio_of_50k_is_refused_with_a_stated_limit(save):
    code, d = save(bio='x' * 50000)
    refused(d, naming='Bio')
    assert '5000' in d['response']['message']


@pytest.mark.case('X04-047')
def test_bio_preserves_newlines(save, stored):
    code, d = save(bio=NEWLINES)
    assert code == 200, d
    assert stored('bio') == NEWLINES


@pytest.mark.case('X04-048')
def test_bio_html_is_stored_verbatim(save, stored):
    code, d = save(bio=HTML)
    assert code == 200, d
    assert stored('bio') == HTML


# ── Designation ──────────────────────────────────────────────────────────────

@pytest.mark.case('X04-049')
def test_designation_empty_is_allowed(save, stored):
    code, d = save(designation='')
    assert code == 200, d
    assert stored('designation') is None


@pytest.mark.case('X04-050')
def test_designation_only_whitespace_is_treated_as_empty(save, stored):
    code, d = save(designation='    ')
    assert code == 200, d
    assert stored('designation') is None, \
        'whitespace must collapse to NULL, not be stored as blank text'


@pytest.mark.case('X04-051')
def test_designation_over_the_limit_is_a_400_naming_the_field(save):
    code, d = save(designation='x' * 200)
    refused(d, naming='Designation')
    assert '150' in d['response']['message']


@pytest.mark.case('X04-052')
def test_designation_is_trimmed_before_storing(save, stored):
    code, d = save(designation='  Senior Engineer  ')
    assert code == 200, d
    assert stored('designation') == 'Senior Engineer'


@pytest.mark.case('X04-053')
def test_designation_unicode_survives(save, stored):
    code, d = save(designation=UNICODE)
    assert code == 200, d
    assert stored('designation') == UNICODE


@pytest.mark.case('X04-054')
def test_designation_html_is_stored_verbatim(save, stored):
    code, d = save(designation=HTML)
    assert code == 200, d
    assert stored('designation') == HTML


@pytest.mark.case('X04-055')
def test_designation_sql_metacharacters_are_stored_verbatim(save, stored):
    code, d = save(designation=SQLI)
    assert code == 200, d
    assert stored('designation') == SQLI


# ── Company ──────────────────────────────────────────────────────────────────

@pytest.mark.case('X04-056')
def test_company_empty_is_allowed(save, stored):
    code, d = save(company='')
    assert code == 200, d
    assert stored('company') is None


@pytest.mark.case('X04-057')
def test_company_only_whitespace_is_treated_as_empty(save, stored):
    code, d = save(company='   ')
    assert code == 200, d
    assert stored('company') is None


@pytest.mark.case('X04-058')
def test_company_over_the_limit_is_a_400_naming_the_field(save):
    code, d = save(company='x' * 200)
    refused(d, naming='Company')
    assert '150' in d['response']['message']


@pytest.mark.case('X04-059')
def test_company_is_trimmed_before_storing(save, stored):
    code, d = save(company='  Acme Corp  ')
    assert code == 200, d
    assert stored('company') == 'Acme Corp'


@pytest.mark.case('X04-060')
def test_company_unicode_survives(save, stored):
    code, d = save(company=UNICODE)
    assert code == 200, d
    assert stored('company') == UNICODE


@pytest.mark.case('X04-061')
def test_company_html_is_stored_verbatim(save, stored):
    code, d = save(company=HTML)
    assert code == 200, d
    assert stored('company') == HTML


@pytest.mark.case('X04-062')
def test_company_sql_metacharacters_are_stored_verbatim(save, stored):
    """The literal the sheet asks for. It reaching the column unchanged is the
    proof that every write goes through a parameterised stored-procedure call
    and never string interpolation."""
    code, d = save(company=SQLI)
    assert code == 200, d
    assert stored('company') == SQLI
