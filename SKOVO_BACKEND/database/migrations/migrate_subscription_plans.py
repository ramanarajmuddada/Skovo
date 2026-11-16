"""
Migration: subscription_plans (admin-managed Skovo Pro pricing + offers).

Creates the subscription_plans table, the read/update stored procedures, and
seeds the three plans (₹199/mo · ₹499/qtr · ₹1,499/yr). Idempotent — safe to
re-run (existing prices/offers are preserved).

Run from SKOVO_BACKEND:
    python migrate_subscription_plans.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    """
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id CHAR(36) PRIMARY KEY,
      plan_key VARCHAR(30) NOT NULL UNIQUE,
      label VARCHAR(60) NOT NULL,
      price INT NOT NULL,
      months INT NOT NULL,
      offer_price INT NULL,
      offer_percent INT NULL,
      offer_label VARCHAR(120) NULL,
      offer_starts_at DATETIME NULL,
      offer_ends_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    """,
    "DROP PROCEDURE IF EXISTS sp_subscription_plans_list",
    """
    CREATE PROCEDURE sp_subscription_plans_list(IN p_active_only TINYINT)
    BEGIN
      SELECT id, plan_key, label, price, months, offer_price, offer_percent, offer_label,
             offer_starts_at, offer_ends_at, is_active, sort_order
        FROM subscription_plans
       WHERE (p_active_only = 0 OR is_active = 1)
       ORDER BY sort_order, months;
    END
    """,
    "DROP PROCEDURE IF EXISTS sp_subscription_plan_update",
    """
    CREATE PROCEDURE sp_subscription_plan_update(
      IN p_key VARCHAR(30), IN p_price INT, IN p_offer_price INT, IN p_offer_percent INT,
      IN p_offer_label VARCHAR(120), IN p_offer_starts DATETIME, IN p_offer_ends DATETIME,
      IN p_is_active TINYINT)
    BEGIN
      UPDATE subscription_plans
         SET price           = COALESCE(p_price, price),
             offer_price     = p_offer_price,
             offer_percent   = p_offer_percent,
             offer_label     = p_offer_label,
             offer_starts_at = p_offer_starts,
             offer_ends_at   = p_offer_ends,
             is_active       = COALESCE(p_is_active, is_active)
       WHERE plan_key = p_key;
      SELECT ROW_COUNT() AS updated;
    END
    """,
]

SEED = [
    ('monthly',   'Monthly',   199,  1,  1),
    ('quarterly', 'Quarterly', 499,  3,  2),
    ('annual',    'Annual',    1499, 12, 3),
]


def main():
    with app.app_context():
        for s in STMTS:
            db.session.execute(text(s))
        for key, label, price, months, sort in SEED:
            db.session.execute(text(
                "INSERT INTO subscription_plans (id, plan_key, label, price, months, sort_order) "
                "VALUES (UUID(), :k, :l, :p, :m, :s) "
                "ON DUPLICATE KEY UPDATE label=VALUES(label)"
            ), {"k": key, "l": label, "p": price, "m": months, "s": sort})
        db.session.commit()
        print("subscription_plans migration complete.")


if __name__ == "__main__":
    main()
