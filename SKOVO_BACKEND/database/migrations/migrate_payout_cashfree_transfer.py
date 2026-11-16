"""Cashfree Payouts: transfer id + UTR on payout_requests.

Admin Pay starts a transfer. The request is paid only when Cashfree reports
SUCCESS with a UTR — never on the click itself.
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401

from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file, add_column

app = InitApp().app()


def run():
    with app.app_context():
        add_column('payout_requests', 'transfer_id', 'VARCHAR(40) NULL')
        add_column('payout_requests', 'cf_transfer_id', 'VARCHAR(80) NULL')
        add_column('payout_requests', 'utr', 'VARCHAR(40) NULL')
        add_column('payout_requests', 'failure_reason', 'VARCHAR(255) NULL')
        idx = db.session.execute(text("""
            SELECT COUNT(*) FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'payout_requests'
               AND INDEX_NAME = 'ix_payout_requests_transfer_id'
        """)).scalar()
        if not idx:
            db.session.execute(text(
                'ALTER TABLE `payout_requests` '
                'ADD KEY `ix_payout_requests_transfer_id` (`transfer_id`)'))
            db.session.commit()

        apply_sql_file('database/stored_procedures/business/admin.sql',
                       only_containing='sp_admin_payout')
        # Full file: a filtered replay can CREATE a procedure whose body
        # mentions another name without the matching DROP.
        apply_sql_file('database/stored_procedures/business/achiever.sql')
        print('  [ok] payout transfer columns + procedures')


if __name__ == '__main__':
    run()
