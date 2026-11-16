"""
Migration: give `users` the unique email/phone keys the auth code already assumes.

THE BUG
    portal/routes/Auth/register.py wraps sp_users_create in a try/except and
    documents its duplicate handling like this:

        # uq_users_email_active (a generated column, unique only while
        # deleted_at IS NULL) enforces the duplicate check via IntegrityError

    Neither `uq_users_email_active` nor `uq_users_phone_active` exists. `users`
    carries exactly one index — PRIMARY KEY (id). So the IntegrityError branch
    is unreachable and POST /auth/register happily creates a second account on
    an email that already has one, returning 200 and a fresh pair of tokens.

    portal/helpers/identity.py does not close this. Read its docstring: it
    checks *cross-role* collisions only (student vs achiever) and says so —
    "a duplicate *within* the same table is left to that table's UNIQUE key".
    `achievers`, `admins` and `super_admins` each have one. `users`, the table
    every student lives in, is the one that does not.

    The consequence is not cosmetic. Password login and OTP verify both resolve
    an account by scanning for the address; with two rows carrying it, which
    account a returning student lands in is decided by row order. Their score,
    bookings and Pro plan are on the other one.

EVIDENCE IN THE DATA
    Six pairs of accounts share a WhatsApp number, all named "E2E WA First" /
    "E2E WA Second" from an end-to-end run on 21 Aug 2026. That run was
    exercising register.py's phone-collision fallback — "the number is optional;
    the account is the point. Keep the signup and drop the number" — which never
    fired, because nothing raised.

WHAT THIS DOES
    Adds the two generated columns and their unique keys, named exactly what the
    route already greps for in the IntegrityError text.

    Uniqueness is scoped to live rows: the generated value is NULL once
    deleted_at is set, and MySQL permits many NULLs in a unique index, so a
    soft-deleted account releases its address instead of blocking it forever.
    LOWER() folds case, closing Foo@x.com vs foo@x.com as well.

DUPLICATES ALREADY IN THE TABLE
    Phone: resolved by the product's own rule — keep the oldest account, blank
    the number on the newer ones. The account survives; the optional field does
    not. Every row changed is printed.

    Email: NOT resolved here. Two accounts on one address means two score
    ledgers, two booking histories and possibly two subscriptions, and choosing
    which survives is a founder call, not a migration's. If any exist this
    script reports them and adds the phone key only, leaving the email key for
    a second run once they are merged.

Idempotent. Run from SKOVO_BACKEND:
    python database/migrations/migrate_users_unique_identity.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()


def _has_column(name):
    return bool(db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = :c
    """), {'c': name}).scalar())


def _has_index(name):
    return bool(db.session.execute(text("""
        SELECT COUNT(*) FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND INDEX_NAME = :i
    """), {'i': name}).scalar())


def _blank_duplicate_phones():
    """Keep the oldest account on each number; clear it on the rest."""
    dupes = db.session.execute(text("""
        SELECT phone, COUNT(*) AS n FROM users
         WHERE deleted_at IS NULL AND phone IS NOT NULL AND phone <> ''
         GROUP BY phone HAVING n > 1
    """)).mappings().all()
    if not dupes:
        return 0

    cleared = 0
    for row in dupes:
        keep = db.session.execute(text("""
            SELECT id FROM users
             WHERE deleted_at IS NULL AND phone = :p
             ORDER BY created_at ASC, id ASC LIMIT 1
        """), {'p': row['phone']}).scalar()
        losers = db.session.execute(text("""
            SELECT id, email, full_name FROM users
             WHERE deleted_at IS NULL AND phone = :p AND id <> :k
        """), {'p': row['phone'], 'k': keep}).mappings().all()
        for u in losers:
            print(f"    phone {row['phone']} cleared on {u['id']} "
                  f"({u['full_name']} / {u['email']}) — kept {keep}")
            cleared += 1
        db.session.execute(text("""
            UPDATE users SET phone = NULL
             WHERE deleted_at IS NULL AND phone = :p AND id <> :k
        """), {'p': row['phone'], 'k': keep})
    db.session.commit()
    return cleared


def _duplicate_emails():
    return db.session.execute(text("""
        SELECT LOWER(TRIM(email)) AS email, COUNT(*) AS n FROM users
         WHERE deleted_at IS NULL AND email IS NOT NULL AND email <> ''
         GROUP BY LOWER(TRIM(email)) HAVING n > 1
    """)).mappings().all()


def main():
    with app.app_context():
        print('== users: unique identity keys ==')

        cleared = _blank_duplicate_phones()
        print(f'  duplicate phone numbers cleared: {cleared}')

        # ── phone ────────────────────────────────────────────────────────────
        if not _has_column('phone_active'):
            db.session.execute(text("""
                ALTER TABLE users ADD COLUMN phone_active VARCHAR(20)
                  GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL AND phone IS NOT NULL AND phone <> '',
                       phone, NULL)) STORED
            """))
            db.session.commit()
            print('  + column users.phone_active')
        if not _has_index('uq_users_phone_active'):
            db.session.execute(text(
                'ALTER TABLE users ADD UNIQUE KEY uq_users_phone_active (phone_active)'))
            db.session.commit()
            print('  + unique key uq_users_phone_active')

        # ── email ────────────────────────────────────────────────────────────
        dupes = _duplicate_emails()
        if dupes:
            print(f'\n  {len(dupes)} email address(es) held by more than one live account:')
            for d in dupes:
                print(f"    {d['email']}  x{d['n']}")
            print('  uq_users_email_active NOT added. Merge these accounts first —\n'
                  '  each one may carry its own score ledger, bookings and plan — then\n'
                  '  re-run this migration.')
            return

        if not _has_column('email_active'):
            db.session.execute(text("""
                ALTER TABLE users ADD COLUMN email_active VARCHAR(320)
                  GENERATED ALWAYS AS (
                    IF(deleted_at IS NULL AND email IS NOT NULL AND email <> '',
                       LOWER(TRIM(email)), NULL)) STORED
            """))
            db.session.commit()
            print('  + column users.email_active')
        if not _has_index('uq_users_email_active'):
            db.session.execute(text(
                'ALTER TABLE users ADD UNIQUE KEY uq_users_email_active (email_active)'))
            db.session.commit()
            print('  + unique key uq_users_email_active')

        keys = db.session.execute(text("""
            SELECT INDEX_NAME FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'
               AND NON_UNIQUE = 0 GROUP BY INDEX_NAME ORDER BY INDEX_NAME
        """)).scalars().all()
        print(f"\n  users unique keys now: {', '.join(keys)}")


if __name__ == '__main__':
    main()
