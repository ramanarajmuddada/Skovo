"""
Adds the guidelines acknowledgement to the achiever agreement master.

The verification screen is a wizard now: guidelines, then agreements, then
documents, then a review of the details before submitting. Step one ends with
the achiever confirming they have read the guidelines, and that confirmation
needs somewhere to live.

It goes in the same append-only ledger as the other three rather than in the
browser, for the reason the ledger exists: the guidelines are where the demo
sessions and the platform's share are explained, so "they were told" is worth
being able to show later, with a policy version and a timestamp against it.

sort_order 5 puts it above the existing three, matching the order of the wizard.

Idempotent: re-running changes nothing.
"""
import uuid

import _bootstrap  # noqa: F401

from sqlalchemy import text
from portal import InitApp
from portal.models import db

app = InitApp().app()

VALUE = 'guidelines'
LABEL = 'I have read the SKOVO achiever guidelines'


def main():
    with app.app_context():
        existing = db.session.execute(
            text("SELECT id, is_required, is_active, sort_order "
                 "FROM master_achiever_agreement WHERE value = :v"),
            {'v': VALUE},
        ).fetchone()

        if existing:
            print(f"already present (id={existing[0]}, required={existing[1]}, "
                  f"active={existing[2]}, sort={existing[3]}) - nothing to do")
            return

        db.session.execute(
            text("""INSERT INTO master_achiever_agreement
                        (id, value, label, sort_order, is_active, version, is_required)
                    VALUES (:id, :v, :l, 5, 1, 'v1', 1)"""),
            {'id': str(uuid.uuid4()), 'v': VALUE, 'l': LABEL},
        )
        db.session.commit()
        print(f"added agreement type '{VALUE}'")

        rows = db.session.execute(
            text("SELECT value, label, sort_order, is_required "
                 "FROM master_achiever_agreement WHERE is_active = 1 ORDER BY sort_order")
        ).fetchall()
        print("\nagreement types now:")
        for r in rows:
            print(f"  {r[2]:>3}  {r[0]:<22} required={r[3]}  {r[1]}")


if __name__ == '__main__':
    main()
