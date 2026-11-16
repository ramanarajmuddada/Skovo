"""
Auth API — register, password login, OTP, /me, refresh, logout.

WHY THIS RUNS AGAINST MYSQL
    This file used to point DATABASE_URL at `sqlite:///:memory:` and seed two
    models — `portal.models.institutions` and `portal.models.roles` — that no
    longer exist; the multi-tenant cut of SKOVO was removed and neither module
    survived it, so every test in the file errored at collection.

    Pointing it back at SQLite would not have worked either. Every auth route is
    now SP-only: register alone calls sp_users_create, sp_auth_identities_create,
    sp_user_profiles_create, sp_readiness_scores_create and sp_sessions_create.
    SQLite has no stored procedures, so the suite would have proved that the
    Flask wiring returns JSON and nothing about the auth flow. Same reasoning
    conftest.py already applies to the Score Engine, applied here.

ISOLATION
    A throwaway email per test, and every row it creates torn down afterwards —
    the `accounts` fixture below. A crashed run leaves rows matching
    'api-test-%@skovo.test', which is the sweep to run by hand.

RESPONSE CONVENTION
    Business outcomes come back HTTP 200 with {bool, status, response} in the
    body — `status` there is the application's code, not the transport's. Only
    genuine HTTP errors (a missing or malformed JWT) carry a real 4xx status
    line. Assertions below follow that split deliberately.
"""
import uuid

import pytest
from sqlalchemy import text

HDR = {"Content-Type": "application/json"}


@pytest.fixture(autouse=True)
def no_outbound_email(monkeypatch):
    """Send nothing, but let the routes believe the send worked.

    `.env` carries live SMTP credentials, so without this the suite would mail
    made-up addresses — and `email_hygiene.py` opens by naming hard bounces as
    the metric Amazon watches most closely, which is the fastest way to lose
    sending access.

    It used to only CLEAR the credentials, which pushed the routes down their
    `dev_otp` branch and let the success assertions pass on a send that never
    happened. `dev_otp` was removed on 2026-09-06 (its guard defaulted to DEV,
    so it failed open), and a cleared credential now correctly produces a 500 —
    so the tests were asserting success against a failure path.

    Stubbing the transport is the honest version: the endpoint's success path is
    exercised, no message leaves the machine, and a genuine send failure still
    surfaces as one because `send_email` itself is untouched.
    """
    monkeypatch.setattr("portal.helpers.email_template.send_email",
                        lambda *a, **k: True, raising=False)
    for module, attr in (
        ("portal.routes.Auth.send_otp", "send_otp_email"),
        ("portal.routes.Auth.send_otp", "send_otp_sms"),
    ):
        try:
            monkeypatch.setattr(f"{module}.{attr}", lambda *a, **k: True)
        except AttributeError:
            pass
    monkeypatch.setenv("SENDGRID_API_KEY", "")


@pytest.fixture
def client(app):
    return app.test_client()


@pytest.fixture
def accounts(db):
    """Hand out unique emails, and delete everything they created afterwards."""
    issued = []

    def _email(tag="user"):
        addr = f"api-test-{tag}-{uuid.uuid4().hex[:12]}@skovo.test"
        issued.append(addr)
        return addr

    yield _email

    if not issued:
        return
    ids = [r[0] for r in db.session.execute(
        text("SELECT id FROM users WHERE email IN :e"), {"e": tuple(issued)}).all()]
    if ids:
        for table in ("sessions", "auth_identities", "user_profiles",
                      "readiness_scores", "score_events"):
            db.session.execute(
                text(f"DELETE FROM {table} WHERE user_id IN :u"), {"u": tuple(ids)})
        db.session.execute(text("DELETE FROM users WHERE id IN :u"), {"u": tuple(ids)})
    db.session.execute(
        text("DELETE FROM otp_requests WHERE target IN :t"), {"t": tuple(issued)})
    db.session.commit()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _register(client, email, password="Test@1234", full_name="Test User"):
    return client.post("/v1/auth/register", json={
        "full_name": full_name, "email": email, "password": password,
    }, headers=HDR)


def _login(client, email, password="Test@1234"):
    return client.post("/v1/auth/login", json={
        "email": email, "password": password,
    }, headers=HDR)


def _auth(token):
    return {**HDR, "Authorization": f"Bearer {token}"}


def _tokens(client, email, password="Test@1234"):
    """Register then log in; returns (access_token, refresh_token)."""
    _register(client, email, password)
    d = _login(client, email, password).get_json()
    return d["access_token"], d["refresh_token"]


def _send_otp(client, email):
    return client.post("/v1/auth/otp/send", json={"email": email}, headers=HDR)


# ── POST /v1/auth/otp/send ────────────────────────────────────────────────────

class TestSendOTP:
    def test_email_otp_ok(self, client, accounts):
        d = _send_otp(client, accounts("otp-ok")).get_json()
        assert d["bool"] is True
        assert d["status"] == 200

    def test_missing_phone_and_email(self, client):
        r = client.post("/v1/auth/otp/send", json={}, headers=HDR)
        assert r.get_json()["bool"] is False

    def test_invalid_email_format(self, client):
        r = client.post("/v1/auth/otp/send", json={"email": "not-an-email"}, headers=HDR)
        assert r.get_json()["bool"] is False

    def test_resend_cooldown_blocks_the_second_request(self, client, accounts):
        """60s cooldown per target — the first thing a resend button hits."""
        email = accounts("cooldown")
        assert _send_otp(client, email).get_json()["bool"] is True

        d = _send_otp(client, email).get_json()
        assert d["bool"] is False
        assert d["status"] == 429
        assert 0 < d["retry_after"] <= 60

    def test_five_per_ten_minutes_is_the_hard_cap(self, client, accounts, db):
        """The cap above the cooldown.

        It cannot be reached through the endpoint in real time — the 60s
        cooldown fires on request two — so the five prior requests are written
        directly, backdated past the cooldown but inside the 10-minute window.
        Moving the data rather than the clock, the same way the Score Engine
        suite ages `last_event_at`.
        """
        email = accounts("cap")
        for minutes in (9, 7, 5, 3, 2):
            db.session.execute(text("""
                INSERT INTO otp_requests
                    (id, channel, target, otp_hash, purpose, attempt_count,
                     expires_at, created_at, updated_at)
                VALUES (:i, 'email', :t, 'x', 'auth', 0,
                        DATE_ADD(NOW(), INTERVAL 10 MINUTE),
                        DATE_SUB(NOW(), INTERVAL :m MINUTE),
                        DATE_SUB(NOW(), INTERVAL :m MINUTE))
            """), {"i": str(uuid.uuid4()), "t": email, "m": minutes})
        db.session.commit()

        d = _send_otp(client, email).get_json()
        assert d["bool"] is False
        assert d["status"] == 429
        # The cap, not the cooldown — the newest prior request is 2 minutes old.
        assert "10 minutes" in d["response"]["message"]


# ── POST /v1/auth/otp/verify ──────────────────────────────────────────────────

class TestVerifyOTP:
    def _otp_for(self, client, email):
        """A usable OTP for this address, seeded directly.

        It used to come back in the API response as `dev_otp`, removed on
        2026-09-06 — that guard defaulted to DEV, so it failed open and anyone
        who could post an email address could read the code out of the JSON.

        The code cannot simply be read back either: `otp_requests` stores
        `otp_hash`, a SHA-256 of the code, and never the code itself. That is
        the right design and it is why this SEEDS a row with a known value
        instead — the same thing `seed_otp` does in the newer suites. It also
        means no mail is sent, which matters: `email_hygiene.py` opens by naming
        hard bounces as the metric Amazon watches most closely.
        """
        import hashlib
        import uuid as _uuid

        from sqlalchemy import text

        from portal.models import db

        code = "424242"
        db.session.execute(text("""
            INSERT INTO otp_requests (id, channel, target, otp_hash, purpose,
                                      attempt_count, expires_at, created_at, updated_at)
            VALUES (:i, 'email', :t, :h, 'auth', 0,
                    DATE_ADD(UTC_TIMESTAMP(), INTERVAL 10 MINUTE),
                    UTC_TIMESTAMP(), UTC_TIMESTAMP())
        """), {"i": str(_uuid.uuid4()), "t": email.lower(),
               "h": hashlib.sha256(code.encode()).hexdigest()})
        db.session.commit()
        return code

    def test_registers_new_user(self, client, accounts):
        email = accounts("otp-new")
        otp = self._otp_for(client, email)
        assert otp is not None

        d = client.post("/v1/auth/otp/verify", json={
            "email": email, "otp": otp, "full_name": "OTP User",
        }, headers=HDR).get_json()
        assert d["bool"] is True
        assert d["response"]["is_new_user"] is True
        assert "access_token" in d

    def test_logs_in_existing_user(self, client, accounts):
        email = accounts("otp-existing")
        _register(client, email)
        otp = self._otp_for(client, email)

        d = client.post("/v1/auth/otp/verify", json={
            "email": email, "otp": otp,
        }, headers=HDR).get_json()
        assert d["bool"] is True
        assert d["response"]["is_new_user"] is False

    def test_wrong_otp_rejected(self, client, accounts):
        email = accounts("otp-wrong")
        self._otp_for(client, email)
        d = client.post("/v1/auth/otp/verify", json={
            "email": email, "otp": "000000",
        }, headers=HDR).get_json()
        assert d["bool"] is False

    def test_no_active_otp(self, client, accounts):
        d = client.post("/v1/auth/otp/verify", json={
            "email": accounts("otp-none"), "otp": "123456",
        }, headers=HDR).get_json()
        assert d["bool"] is False

    def test_missing_channel(self, client):
        r = client.post("/v1/auth/otp/verify", json={"otp": "123456"}, headers=HDR)
        assert r.get_json()["bool"] is False


# ── POST /v1/auth/register ────────────────────────────────────────────────────

class TestRegister:
    def test_success(self, client, accounts):
        email = accounts("reg-ok")
        d = _register(client, email).get_json()
        assert d["bool"] is True
        assert "access_token" in d
        assert d["response"]["email"] == email
        assert d["response"]["role"] == "student"
        assert d["response"]["is_new_user"] is True

    def test_registration_creates_the_rows_every_other_module_reads(self, client, accounts, db):
        """A profile and a readiness row must exist from the first second.

        The score engine, cohort targeting and the opportunity gate all read
        these; a user without them degrades silently rather than erroring.
        """
        email = accounts("reg-rows")
        user_id = _register(client, email).get_json()["response"]["user_id"]

        for table in ("auth_identities", "user_profiles", "readiness_scores"):
            n = db.session.execute(
                text(f"SELECT COUNT(*) FROM {table} WHERE user_id = :u"),
                {"u": user_id}).scalar()
            assert n == 1, f"{table} missing for a freshly registered user"

    def test_duplicate_email_returns_409(self, client, accounts):
        email = accounts("reg-dup")
        _register(client, email)
        d = _register(client, email).get_json()
        assert d["bool"] is False
        assert d["status"] == 409

    def test_short_password_rejected(self, client, accounts):
        d = client.post("/v1/auth/register", json={
            "full_name": "X", "email": accounts("short-pw"), "password": "123",
        }, headers=HDR).get_json()
        assert d["bool"] is False
        assert d["status"] == 400

    def test_missing_full_name(self, client, accounts):
        d = client.post("/v1/auth/register", json={
            "email": accounts("no-name"), "password": "Test@1234",
        }, headers=HDR).get_json()
        assert d["bool"] is False

    def test_missing_email(self, client):
        d = client.post("/v1/auth/register", json={
            "full_name": "X", "password": "Test@1234",
        }, headers=HDR).get_json()
        assert d["bool"] is False


# ── POST /v1/auth/login ───────────────────────────────────────────────────────

class TestPasswordLogin:
    def test_success(self, client, accounts):
        email = accounts("login-ok")
        _register(client, email)
        d = _login(client, email).get_json()
        assert d["bool"] is True
        assert "access_token" in d
        assert "refresh_token" in d
        assert d["response"]["role"] == "student"

    def test_wrong_password_returns_401(self, client, accounts):
        email = accounts("login-bad-pw")
        _register(client, email)
        d = _login(client, email, password="WrongPass!").get_json()
        assert d["bool"] is False
        assert d["status"] == 401

    def test_unknown_email_returns_401(self, client, accounts):
        d = _login(client, accounts("nobody")).get_json()
        assert d["bool"] is False
        assert d["status"] == 401

    def test_missing_password(self, client, accounts):
        d = client.post("/v1/auth/login", json={
            "email": accounts("no-pw"),
        }, headers=HDR).get_json()
        assert d["bool"] is False

    def test_empty_body(self, client):
        d = client.post("/v1/auth/login", json={}, headers=HDR).get_json()
        assert d["bool"] is False


# ── GET /v1/auth/me ───────────────────────────────────────────────────────────

class TestMe:
    def test_returns_profile_when_authenticated(self, client, accounts):
        email = accounts("me-ok")
        at, _ = _tokens(client, email)
        d = client.get("/v1/auth/me", headers=_auth(at)).get_json()
        assert d["bool"] is True
        assert d["response"]["email"] == email
        assert "readiness" in d["response"]
        assert "profile" in d["response"]

    def test_401_without_token(self, client):
        assert client.get("/v1/auth/me", headers=HDR).status_code == 401

    def test_invalid_token_rejected(self, client):
        r = client.get("/v1/auth/me",
                       headers={**HDR, "Authorization": "Bearer bad.token.here"})
        assert r.status_code in (401, 422)


# ── POST /v1/auth/token/refresh ───────────────────────────────────────────────

class TestRefreshToken:
    def test_returns_new_access_token(self, client, accounts):
        _, rt = _tokens(client, accounts("refresh-ok"))
        d = client.post("/v1/auth/token/refresh",
                        headers={**HDR, "Authorization": f"Bearer {rt}"}).get_json()
        assert d["bool"] is True
        assert "access_token" in d

    def test_access_token_rejected_as_refresh(self, client, accounts):
        at, _ = _tokens(client, accounts("refresh-wrong"))
        r = client.post("/v1/auth/token/refresh",
                        headers={**HDR, "Authorization": f"Bearer {at}"})
        # flask-jwt-extended rejects the wrong token type at the transport level.
        assert r.status_code in (401, 422)

    def test_no_token_returns_401(self, client):
        assert client.post("/v1/auth/token/refresh", headers=HDR).status_code == 401


# ── POST /v1/auth/logout ──────────────────────────────────────────────────────

class TestLogout:
    def test_logout_success(self, client, accounts):
        at, _ = _tokens(client, accounts("logout-ok"))
        d = client.post("/v1/auth/logout", headers=_auth(at)).get_json()
        assert d["bool"] is True

    def test_no_token_returns_401(self, client):
        assert client.post("/v1/auth/logout", headers=HDR).status_code == 401

    def test_refresh_token_blocked_after_logout(self, client, accounts):
        """Logout revokes the session; the refresh token must stop working.

        The refusal lands at the JWT layer, not in the route — the token is on
        the blocklist, so flask-jwt-extended answers a real 401 and
        refresh_token.py's own session check never runs. Both are guards on the
        same thing; this asserts the one that actually fires.
        """
        at, rt = _tokens(client, accounts("logout-revoke"))
        client.post("/v1/auth/logout", headers=_auth(at))

        r = client.post("/v1/auth/token/refresh",
                        headers={**HDR, "Authorization": f"Bearer {rt}"})
        assert r.status_code == 401

    def test_me_still_works_after_logout_until_access_expires(self, client, accounts):
        """The access token is a stateless JWT — valid until it expires."""
        at, _ = _tokens(client, accounts("logout-me"))
        client.post("/v1/auth/logout", headers=_auth(at))
        assert client.get("/v1/auth/me", headers=_auth(at)).get_json()["bool"] is True


# ── Full auth flow ────────────────────────────────────────────────────────────

class TestFullAuthFlow:
    def test_register_login_me_refresh_logout(self, client, accounts):
        email = accounts("flow")

        assert _register(client, email, full_name="Flow User").get_json()["bool"] is True

        d = _login(client, email).get_json()
        assert d["bool"] is True
        at, rt = d["access_token"], d["refresh_token"]

        assert client.get("/v1/auth/me", headers=_auth(at)).get_json()["response"]["email"] == email

        new_at = client.post("/v1/auth/token/refresh",
                             headers={**HDR, "Authorization": f"Bearer {rt}"}).get_json()["access_token"]
        assert new_at != at
        assert client.get("/v1/auth/me", headers=_auth(new_at)).get_json()["bool"] is True

        assert client.post("/v1/auth/logout", headers=_auth(new_at)).get_json()["bool"] is True

        revoked = client.post("/v1/auth/token/refresh",
                              headers={**HDR, "Authorization": f"Bearer {rt}"})
        assert revoked.status_code == 401
