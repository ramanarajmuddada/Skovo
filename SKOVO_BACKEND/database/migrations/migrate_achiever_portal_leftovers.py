"""
Achiever Bookings leftovers: coupon codes unique per owner, propose/accept SPs.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_achiever_portal_leftovers.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SQL_FILES = [
    'database/stored_procedures/business/student.sql',
    'database/stored_procedures/business/money_floor.sql',
    'database/stored_procedures/business/admin.sql',
    'database/stored_procedures/achiever_bookings_page.sql',
    'database/stored_procedures/exported/cohorts_courses.sql',
]


def run():
    with app.app_context():
        indexes = {
            r[0] for r in db.session.execute(text(
                "SELECT INDEX_NAME FROM information_schema.STATISTICS "
                " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons'"
            ))
        }
        for name in ('uq_coupons_code', 'code'):
            if name in indexes:
                db.session.execute(text(f'ALTER TABLE `coupons` DROP INDEX `{name}`'))
                db.session.commit()
                print(f'  [ok] dropped coupons.{name}')
                indexes.discard(name)
        if 'uq_coupons_code' not in indexes and 'code' not in indexes:
            print('  [ok] global coupons code unique already gone')

        cols = {
            r[0] for r in db.session.execute(text(
                "SELECT COLUMN_NAME FROM information_schema.COLUMNS "
                " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons'"
            ))
        }
        if 'owner_key' not in cols:
            db.session.execute(text(
                "ALTER TABLE `coupons` ADD COLUMN `owner_key` CHAR(36) "
                "GENERATED ALWAYS AS (IFNULL(`owner_achiever_id`, '')) STORED"
            ))
            db.session.commit()
            print('  [ok] added coupons.owner_key')
        else:
            print('  [ok] coupons.owner_key already present')

        indexes = {
            r[0] for r in db.session.execute(text(
                "SELECT INDEX_NAME FROM information_schema.STATISTICS "
                " WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'coupons'"
            ))
        }
        if 'uq_coupons_owner_key_code' not in indexes:
            db.session.execute(text(
                'ALTER TABLE `coupons` '
                'ADD UNIQUE KEY `uq_coupons_owner_key_code` (`owner_key`, `code`)'
            ))
            db.session.commit()
            print('  [ok] unique (owner_key, code)')
        else:
            print('  [ok] uq_coupons_owner_key_code already present')

        for path in SQL_FILES:
            n = apply_sql_file(path)
            print(f'  [ok] loaded {n} statement(s) from {path}')

        print('Achiever portal leftovers migration complete.')


if __name__ == '__main__':
    run()
