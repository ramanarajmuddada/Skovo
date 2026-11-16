"""Refuse a junk upload at the door, so nobody has to review one later.

WHY
    Points for uploading a marksheet invite a blank page named marksheet.pdf.
    The usual answer is a review queue, and at 10,000 students a review queue is
    42 hours of somebody's week -- so the check has to happen without a human.

    A machine cannot tell whether a PDF is really this student's marksheet. It
    can tell, for free and instantly, that a file is 3 KB, or a .txt renamed,
    or byte-identical to one another student already uploaded. That catches the
    lazy majority; the rest is handled by keeping the points small enough that
    faking one is not worth the effort.

WHAT IS CHECKED
    size      between doc_min_bytes and doc_max_bytes
    type      in doc_allowed_types
    duplicate file_hash already held by this student, or by another student

    All three are settings on readiness_rules, not constants, so the thresholds
    move without a deploy. Setting doc_min_bytes to 0 turns that check off.

WHAT THIS IS NOT
    file_size, file_type and file_hash arrive from the browser, which can lie.
    This is an integrity check, not a security boundary -- it catches mistakes
    and casual gaming, not a determined attacker. The defence against a
    determined attacker is that a document is worth 2 points out of 100.

    A student who supplies no hash is not blocked. Older clients and direct API
    callers must keep working; they simply skip the duplicate check.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_docvault_integrity.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

SETTINGS = [
    ('doc_min_bytes',     "INT NOT NULL DEFAULT 20480"),        # 20 KB
    ('doc_max_bytes',     "INT NOT NULL DEFAULT 10485760"),     # 10 MB
    ('doc_allowed_types', "VARCHAR(255) NOT NULL DEFAULT 'pdf,jpg,jpeg,png'"),
]

CHECK = """
CREATE PROCEDURE `sp_docvault_check`(
    IN p_user CHAR(36),
    IN p_size INT,
    IN p_type VARCHAR(50),
    IN p_hash CHAR(64)
)
BEGIN
  DECLARE v_min INT DEFAULT 0;
  DECLARE v_max INT DEFAULT 0;
  DECLARE v_types VARCHAR(255) DEFAULT '';
  DECLARE v_ext VARCHAR(20) DEFAULT '';
  DECLARE v_dupe_self INT DEFAULT 0;
  DECLARE v_dupe_other INT DEFAULT 0;

  SELECT IFNULL(doc_min_bytes, 0), IFNULL(doc_max_bytes, 0),
         IFNULL(doc_allowed_types, '')
    INTO v_min, v_max, v_types
    FROM readiness_rules ORDER BY created_at ASC LIMIT 1;

  -- 'image/png' and 'PNG' and 'png' all have to mean png. Take whatever sits
  -- after the last slash or dot, lowercased.
  SET v_ext = LOWER(SUBSTRING_INDEX(SUBSTRING_INDEX(IFNULL(p_type, ''), '/', -1), '.', -1));

  IF p_hash IS NOT NULL AND p_hash <> '' THEN
    SELECT COUNT(*) INTO v_dupe_self FROM document_vault
     WHERE user_id = p_user AND file_hash = p_hash AND is_active = 1;
    SELECT COUNT(*) INTO v_dupe_other FROM document_vault
     WHERE user_id <> p_user AND file_hash = p_hash AND is_active = 1;
  END IF;

  -- Order matters: the most specific, most useful message wins. "You already
  -- uploaded this" is more helpful than "too small" for a file that is both.
  SELECT CASE
    WHEN v_dupe_self > 0  THEN 'duplicate_self'
    WHEN v_dupe_other > 0 THEN 'duplicate_other'
    WHEN v_min > 0 AND IFNULL(p_size, 0) > 0 AND p_size < v_min THEN 'too_small'
    WHEN v_max > 0 AND IFNULL(p_size, 0) > v_max               THEN 'too_large'
    WHEN v_types <> '' AND v_ext <> ''
         AND NOT FIND_IN_SET(v_ext, v_types)                    THEN 'bad_type'
    ELSE 'ok'
  END AS result,
  v_min AS min_bytes, v_max AS max_bytes, v_types AS allowed_types;
END
"""

SET_HASH = """
CREATE PROCEDURE `sp_docvault_set_hash`(IN p_id CHAR(36), IN p_hash CHAR(64))
BEGIN
  -- Separate from sp_docvault_create rather than a new parameter on it:
  -- widening a procedure's signature on a shared database breaks every caller
  -- running the older code until they all deploy together.
  UPDATE document_vault SET file_hash = p_hash WHERE id = p_id;
END
"""


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def main():
    with app.app_context():
        if not has_column('document_vault', 'file_hash'):
            db.session.execute(text(
                "ALTER TABLE `document_vault` ADD COLUMN `file_hash` CHAR(64) NULL"))
            print("  document_vault.file_hash added")
        else:
            print("  document_vault.file_hash already there")

        idx = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.STATISTICS "
            "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'document_vault' "
            "AND INDEX_NAME = 'idx_docvault_hash'")).scalar()
        if not idx:
            db.session.execute(text(
                "ALTER TABLE `document_vault` ADD INDEX `idx_docvault_hash` (`file_hash`)"))
            print("  idx_docvault_hash added")

        for col, ddl in SETTINGS:
            if has_column('readiness_rules', col):
                print(f"  readiness_rules.{col} already there")
                continue
            db.session.execute(text(f"ALTER TABLE `readiness_rules` ADD COLUMN `{col}` {ddl}"))
            print(f"  readiness_rules.{col} added")
        db.session.commit()

        for name, body in (('sp_docvault_check', CHECK), ('sp_docvault_set_hash', SET_HASH)):
            db.session.execute(text(f"DROP PROCEDURE IF EXISTS `{name}`"))
            db.session.execute(text(body.strip()))
            print(f"  created {name}")
        db.session.commit()

        user = db.session.execute(text(
            "SELECT id FROM users WHERE deleted_at IS NULL LIMIT 1")).scalar()
        if user:
            probes = [
                ("a normal 400 KB pdf", 400000, 'application/pdf', None,      'ok'),
                ("a 3 KB blank page",     3000, 'application/pdf', None,      'too_small'),
                ("a 40 MB scan",      40000000, 'application/pdf', None,      'too_large'),
                ("a .txt renamed",      400000, 'text/plain',      None,      'bad_type'),
                ("PNG in caps",         400000, 'PNG',             None,      'ok'),
                ("no metadata at all",    None, None,              None,      'ok'),
            ]
            print("\n  check                     expected      got")
            bad = 0
            for label, size, ftype, fhash, want in probes:
                row = db.session.execute(text(
                    "CALL sp_docvault_check(:u, :s, :t, :h)"),
                    {'u': user, 's': size, 't': ftype, 'h': fhash}).mappings().first()
                got = (row or {}).get('result')
                flag = ' ' if got == want else '   <-- MISMATCH'
                bad += 0 if got == want else 1
                print(f"  {label:<25} {want:<13} {got}{flag}")
            print(f"\n  probe failures: {bad}")
        print("Done.")


if __name__ == '__main__':
    main()
