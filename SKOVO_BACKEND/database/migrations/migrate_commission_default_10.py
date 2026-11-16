"""
Set the platform commission default to 10%.

The rule is not edited in place. The 30% rule is closed off with an
effective_to and a new 10% rule opens — so any order priced under the old rate
can still be explained by the rule that was live when it was placed. That
matters more than it looks: "why did this achiever get 70%" is a question with
a real answer only if the rule survives.

Idempotent: does nothing if the live global rule is already 10%.
"""
import _bootstrap  # noqa: F401

from sqlalchemy import text
from portal import InitApp
from portal.models import db

app = InitApp().app()
NEW_RATE = 0.1000


def main():
    with app.app_context():
        current = db.session.execute(text(
            "SELECT id, rate FROM commission_rules "
            " WHERE is_active = 1 AND scope = 'global' AND kind IS NULL "
            "   AND effective_from <= UTC_TIMESTAMP() "
            "   AND (effective_to IS NULL OR effective_to > UTC_TIMESTAMP()) "
            " ORDER BY effective_from DESC LIMIT 1")).mappings().first()

        if current and abs(float(current['rate']) - NEW_RATE) < 1e-9:
            print(f"  global rule is already {NEW_RATE*100:g}% — nothing to do")
            return

        if current:
            db.session.execute(text(
                "UPDATE commission_rules SET effective_to = UTC_TIMESTAMP() WHERE id = :i"),
                {'i': current['id']})
            print(f"  closed the {float(current['rate'])*100:g}% rule")

        db.session.execute(text(
            "INSERT INTO commission_rules "
            "  (id, scope, scope_id, kind, rate, effective_from, effective_to, is_active, note, created_at) "
            "VALUES (UUID(), 'global', NULL, NULL, :r, UTC_TIMESTAMP(), NULL, 1, "
            "        'Platform default set to 10%', UTC_TIMESTAMP())"), {'r': NEW_RATE})
        db.session.commit()
        print(f"  opened a new global rule at {NEW_RATE*100:g}%")

        row = db.session.execute(text(
            "CALL sp_commission_rate_resolve(:a, :k)"),
            {'a': '00000000-0000-0000-0000-000000000000', 'k': 'session'}).mappings().first()
        print(f"  resolver now returns {float(row['rate'])*100:g}%")


if __name__ == '__main__':
    main()
