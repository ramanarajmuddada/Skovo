"""
Migration: remaining v1 gaps.

  * DM report moderation queue (§4.3 "report/flag system", student safety)
  * Market deal commission_rate + featured flag + sponsored window (§4.4)
  * Community Pro extras: pinned posts, verified-achiever communities (§4.3)
  * Document Vault public profile link (§4.6 Pro) + the four spec folders

Idempotent. Run from SKOVO_BACKEND:  python migrate_v1_remaining.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from sqlalchemy import text

app = InitApp().app()

STMTS = [
    # ══ Market: the deal fields §4.4 lists that we were missing ═══════════
    ("alter", "ALTER TABLE market_deals ADD COLUMN commission_rate DECIMAL(5,2) NULL"),
    ("alter", "ALTER TABLE market_deals ADD COLUMN is_featured TINYINT(1) NOT NULL DEFAULT 0"),
    ("alter", "ALTER TABLE market_deals ADD COLUMN featured_until DATETIME NULL"),

    # ══ Communities: Pro extras ═══════════════════════════════════════════
    ("alter", "ALTER TABLE group_posts ADD COLUMN is_pinned TINYINT(1) NOT NULL DEFAULT 0"),
    ("alter", "ALTER TABLE `groups` ADD COLUMN kind VARCHAR(24) NOT NULL DEFAULT 'public'"),

    # ══ Vault: shareable public profile (§4.6 Pro) ════════════════════════
    ("alter", "ALTER TABLE document_vault ADD COLUMN is_public TINYINT(1) NOT NULL DEFAULT 0"),
    ("table", """
    CREATE TABLE IF NOT EXISTS public_profiles (
      user_id CHAR(36) PRIMARY KEY,
      slug VARCHAR(64) NOT NULL UNIQUE,
      headline VARCHAR(160) NULL,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
    """),

    # ══ DM moderation queue ═══════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_reports_list"),
    ("sp", """
    CREATE PROCEDURE sp_dm_reports_list(IN p_status VARCHAR(20), IN p_limit INT, IN p_offset INT)
    BEGIN
      SELECT r.id, r.reporter_id, r.reported_user_id, r.message_id, r.reason,
             r.status, r.created_at,
             ru.full_name AS reporter_name, tu.full_name AS reported_name,
             (SELECT m.body FROM direct_messages m WHERE m.id = r.message_id) AS message_body
        FROM dm_reports r
        LEFT JOIN users ru ON ru.id = r.reporter_id
        LEFT JOIN users tu ON tu.id = r.reported_user_id
       WHERE (p_status IS NULL OR p_status = '' OR r.status = p_status)
       ORDER BY (r.status = 'open') DESC, r.created_at DESC
       LIMIT p_limit OFFSET p_offset;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_report_resolve"),
    ("sp", """
    CREATE PROCEDURE sp_dm_report_resolve(IN p_id CHAR(36), IN p_status VARCHAR(20))
    BEGIN
      UPDATE dm_reports SET status = p_status WHERE id = p_id;
      SELECT ROW_COUNT() AS updated;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_dm_reports_counts"),
    ("sp", """
    CREATE PROCEDURE sp_dm_reports_counts()
    BEGIN
      SELECT
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_count,
        SUM(CASE WHEN status <> 'open' THEN 1 ELSE 0 END) AS closed_count,
        COUNT(*) AS total
      FROM dm_reports;
    END
    """),

    # ══ Community: pin a post (Pro, own posts only) ═══════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_assemble_post_pin_toggle"),
    ("sp", """
    CREATE PROCEDURE sp_assemble_post_pin_toggle(IN p_post CHAR(36), IN p_user CHAR(36))
    BEGIN
      DECLARE v_owner CHAR(36); DECLARE v_pinned TINYINT DEFAULT 0;
      SELECT user_id, is_pinned INTO v_owner, v_pinned FROM group_posts WHERE id = p_post;
      IF v_owner IS NULL THEN
        SELECT 'notfound' AS result, 0 AS is_pinned;
      ELSEIF v_owner <> p_user THEN
        SELECT 'not_owner' AS result, v_pinned AS is_pinned;
      ELSE
        UPDATE group_posts SET is_pinned = IF(v_pinned = 1, 0, 1) WHERE id = p_post;
        SELECT IF(v_pinned = 1, 'unpinned', 'pinned') AS result,
               IF(v_pinned = 1, 0, 1) AS is_pinned;
      END IF;
    END
    """),

    # ══ Public profile ════════════════════════════════════════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_public_profile_upsert"),
    ("sp", """
    CREATE PROCEDURE sp_public_profile_upsert(IN p_user CHAR(36), IN p_slug VARCHAR(64),
                                              IN p_headline VARCHAR(160), IN p_enabled TINYINT)
    BEGIN
      INSERT INTO public_profiles (user_id, slug, headline, is_enabled)
      VALUES (p_user, p_slug, p_headline, p_enabled)
      ON DUPLICATE KEY UPDATE slug = VALUES(slug), headline = VALUES(headline),
                              is_enabled = VALUES(is_enabled);
      SELECT * FROM public_profiles WHERE user_id = p_user;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_public_profile_get"),
    ("sp", """
    CREATE PROCEDURE sp_public_profile_get(IN p_user CHAR(36))
    BEGIN
      SELECT * FROM public_profiles WHERE user_id = p_user;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_public_profile_by_slug"),
    ("sp", """
    CREATE PROCEDURE sp_public_profile_by_slug(IN p_slug VARCHAR(64))
    BEGIN
      SELECT p.slug, p.headline, u.full_name, u.avatar_url, u.id AS user_id,
             IFNULL(rs.score, 0) AS score, rs.level
        FROM public_profiles p
        JOIN users u ON u.id = p.user_id
        LEFT JOIN readiness_scores rs ON rs.user_id = p.user_id
       WHERE p.slug = p_slug AND p.is_enabled = 1 AND u.status = 'active';
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_public_profile_documents"),
    ("sp", """
    CREATE PROCEDURE sp_public_profile_documents(IN p_user CHAR(36))
    BEGIN
      SELECT id, name, category, file_url, created_at
        FROM document_vault
       WHERE user_id = p_user AND is_public = 1
       ORDER BY created_at DESC;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_docvault_set_public"),
    ("sp", """
    CREATE PROCEDURE sp_docvault_set_public(IN p_id CHAR(36), IN p_user CHAR(36), IN p_public TINYINT)
    BEGIN
      UPDATE document_vault SET is_public = p_public
       WHERE id = p_id AND user_id = p_user;
      SELECT ROW_COUNT() AS updated;
    END
    """),

    # ══ Market admin: rewrite CRUD to carry the new fields ════════════════
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_create"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_create(
        IN p_id CHAR(36), IN p_title VARCHAR(200), IN p_brand VARCHAR(120), IN p_description TEXT,
        IN p_category VARCHAR(60), IN p_image_url TEXT, IN p_deal_url TEXT,
        IN p_coupon_code VARCHAR(60), IN p_discount_label VARCHAR(60), IN p_is_pro_only TINYINT,
        IN p_starts_at DATETIME, IN p_ends_at DATETIME, IN p_is_active TINYINT, IN p_sort_order INT,
        IN p_commission_rate DECIMAL(5,2), IN p_is_featured TINYINT, IN p_featured_until DATETIME)
    BEGIN
      INSERT INTO market_deals (id, title, brand, description, category, image_url, deal_url,
                                coupon_code, discount_label, is_pro_only, starts_at, ends_at,
                                is_active, sort_order, commission_rate, is_featured, featured_until)
      VALUES (p_id, p_title, p_brand, p_description, p_category, p_image_url, p_deal_url,
              p_coupon_code, p_discount_label, p_is_pro_only, p_starts_at, p_ends_at,
              p_is_active, p_sort_order, p_commission_rate, p_is_featured, p_featured_until);
      SELECT * FROM market_deals WHERE id = p_id;
    END
    """),
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_update"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_update(
        IN p_id CHAR(36), IN p_title VARCHAR(200), IN p_brand VARCHAR(120), IN p_description TEXT,
        IN p_category VARCHAR(60), IN p_image_url TEXT, IN p_deal_url TEXT,
        IN p_coupon_code VARCHAR(60), IN p_discount_label VARCHAR(60), IN p_is_pro_only TINYINT,
        IN p_starts_at DATETIME, IN p_ends_at DATETIME, IN p_is_active TINYINT, IN p_sort_order INT,
        IN p_commission_rate DECIMAL(5,2), IN p_is_featured TINYINT, IN p_featured_until DATETIME)
    BEGIN
      UPDATE market_deals SET
        title = COALESCE(p_title, title), brand = p_brand, description = p_description,
        category = p_category, image_url = p_image_url,
        deal_url = COALESCE(p_deal_url, deal_url), coupon_code = p_coupon_code,
        discount_label = p_discount_label, is_pro_only = COALESCE(p_is_pro_only, is_pro_only),
        starts_at = p_starts_at, ends_at = p_ends_at,
        is_active = COALESCE(p_is_active, is_active),
        sort_order = COALESCE(p_sort_order, sort_order),
        commission_rate = p_commission_rate,
        is_featured = COALESCE(p_is_featured, is_featured),
        featured_until = p_featured_until
      WHERE id = p_id;
      SELECT * FROM market_deals WHERE id = p_id;
    END
    """),
    # Featured deals surface first while their sponsorship window is live.
    ("sp", "DROP PROCEDURE IF EXISTS sp_market_deals_list_public"),
    ("sp", """
    CREATE PROCEDURE sp_market_deals_list_public(
        IN p_category VARCHAR(60), IN p_search VARCHAR(120), IN p_limit INT, IN p_offset INT)
    BEGIN
      SELECT *,
             (is_featured = 1 AND (featured_until IS NULL OR featured_until >= UTC_TIMESTAMP())) AS featured_live
        FROM market_deals
       WHERE is_active = 1
         AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP())
         AND (ends_at   IS NULL OR ends_at   >= UTC_TIMESTAMP())
         AND (p_category IS NULL OR p_category = '' OR category = p_category)
         AND (p_search IS NULL OR p_search = ''
              OR title LIKE CONCAT('%', p_search, '%')
              OR brand LIKE CONCAT('%', p_search, '%'))
       ORDER BY featured_live DESC, sort_order DESC, created_at DESC, id DESC
       LIMIT p_limit OFFSET p_offset;
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
                if kind == "alter" and "Duplicate column" in str(e):
                    pass
                else:
                    raise
        print("v1 remaining migration complete.")


if __name__ == "__main__":
    main()
