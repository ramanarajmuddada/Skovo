"""
Migration: Market module (v1 spec).

Curated student deals — brand offers, tool discounts, affiliate links — listed
for students and managed from the admin portal. Deals can be Pro-only and can
carry an offer window; clicks are logged for attribution.
Idempotent. Run from SKOVO_BACKEND:  python migrate_market.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    ("table", """
    CREATE TABLE IF NOT EXISTS market_deals (
      id CHAR(36) PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      brand VARCHAR(120) NULL,
      description TEXT NULL,
      category VARCHAR(60) NULL,
      image_url TEXT NULL,
      deal_url TEXT NOT NULL,
      coupon_code VARCHAR(60) NULL,
      discount_label VARCHAR(60) NULL,
      is_pro_only TINYINT(1) NOT NULL DEFAULT 0,
      starts_at DATETIME NULL,
      ends_at DATETIME NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      sort_order INT NOT NULL DEFAULT 0,
      click_count INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_market_live (is_active, category, sort_order)
    )
    """),
    ("table", """
    CREATE TABLE IF NOT EXISTS market_deal_clicks (
      id CHAR(36) PRIMARY KEY,
      deal_id CHAR(36) NOT NULL,
      user_id CHAR(36) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_mdc_deal (deal_id, created_at)
    )
    """),

    # sp_market_deals_delete clears clicks itself, but the FK guarantees it for
    # any other deletion path too — clicks must never outlive their deal.
    ("fk", """
    ALTER TABLE market_deal_clicks
      ADD CONSTRAINT fk_mdc_deal FOREIGN KEY (deal_id)
      REFERENCES market_deals(id) ON DELETE CASCADE
    """),

    # ── student-facing ────────────────────────────────────────────────────
    # sp_market_deals_list_public is NOT created here -- migrate_v1_remaining owns it.
    # The copy that used to sit here predates is_featured / featured_until,
    # so re-running this file dropped those parameters and broke every
    # caller until the newer migration was run again. One owner each.
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_categories"),
    ("sp", """
    CREATE PROCEDURE sp_market_categories()
    BEGIN
      SELECT category, COUNT(*) AS total FROM market_deals
       WHERE is_active = 1 AND category IS NOT NULL AND category <> ''
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND (ends_at   IS NULL OR ends_at   >= UTC_TIMESTAMP())
       GROUP BY category ORDER BY total DESC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_get"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_get(IN p_id CHAR(36))
    BEGIN
      SELECT * FROM market_deals WHERE id = p_id;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deal_click"),
    ("sp", """
    CREATE PROCEDURE sp_market_deal_click(IN p_id CHAR(36), IN p_deal CHAR(36), IN p_user CHAR(36))
    BEGIN
      INSERT INTO market_deal_clicks (id, deal_id, user_id) VALUES (p_id, p_deal, p_user);
      UPDATE market_deals SET click_count = click_count + 1 WHERE id = p_deal;
      SELECT deal_url, coupon_code FROM market_deals WHERE id = p_deal;
    END
    """),

    # ── admin ─────────────────────────────────────────────────────────────
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_list_admin"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_list_admin(IN p_limit INT, IN p_offset INT)
    BEGIN
      SELECT d.*,
             (SELECT COUNT(*) FROM market_deal_clicks c WHERE c.deal_id = d.id) AS clicks
        FROM market_deals d
       ORDER BY d.is_active DESC, d.sort_order DESC, d.created_at DESC
       LIMIT p_limit OFFSET p_offset;
    END
    """),
    # sp_market_deals_create is NOT created here -- migrate_v1_remaining owns it.
    # The copy that used to sit here predates commission_rate, is_featured, featured_until,
    # so re-running this file dropped those parameters and broke every
    # caller until the newer migration was run again. One owner each.
    # sp_market_deals_update is NOT created here -- migrate_v1_remaining owns it.
    # The copy that used to sit here predates commission_rate, is_featured, featured_until,
    # so re-running this file dropped those parameters and broke every
    # caller until the newer migration was run again. One owner each.
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_delete"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_delete(IN p_id CHAR(36))
    BEGIN
      DELETE FROM market_deal_clicks WHERE deal_id = p_id;
      DELETE FROM market_deals WHERE id = p_id;
      SELECT ROW_COUNT() AS deleted;
    END
    """),
]


def main():
    with app.app_context():
        for kind, s in STMTS:
            try:
                db.session.execute(text(s)); db.session.commit()
            except Exception as e:
                db.session.rollback()
                msg = str(e)
                if kind == "alter" and "Duplicate column" in msg:
                    pass
                elif kind == "fk" and ("Duplicate" in msg or "already exists" in msg):
                    pass
                else:
                    raise
        print("market migration complete.")


if __name__ == "__main__":
    main()
