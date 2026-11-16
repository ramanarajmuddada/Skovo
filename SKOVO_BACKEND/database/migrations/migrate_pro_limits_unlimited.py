"""Allow UNLIMITED on every Pro allowance, and stop the 1-on-1 credits
resetting on the calendar month.

Two changes to `pro_free_limits`:

  * every cap column becomes NULLable, where NULL means unlimited. They were
    INT NOT NULL, so "no cap" could not be stored at all.
  * `monthly_session_credits` becomes `session_credits`. The old name promised
    a monthly grant; sp_pro_session_credits now counts over the subscription
    period the member actually paid for, so an annual plan grants N for the
    year instead of N twelve times.

Safe to run more than once.
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

from sqlalchemy import text
from app import app
from portal.models import db

CAPS = ['free_paid_cohorts', 'saved_colleges', 'communities', 'vault_docs']


def col(name):
    row = db.session.execute(text("""
        SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'pro_free_limits'
           AND COLUMN_NAME = :n
    """), {'n': name}).first()
    return row is not None


def main():
    with app.app_context():
        for c in CAPS:
            db.session.execute(text(f"ALTER TABLE `pro_free_limits` MODIFY `{c}` INT NULL"))
            print(f'  {c}: nullable')

        if col('monthly_session_credits') and not col('session_credits'):
            db.session.execute(text(
                "ALTER TABLE `pro_free_limits` "
                "CHANGE `monthly_session_credits` `session_credits` INT NULL"))
            print('  monthly_session_credits -> session_credits')
        elif col('session_credits'):
            db.session.execute(text("ALTER TABLE `pro_free_limits` MODIFY `session_credits` INT NULL"))
            print('  session_credits: already renamed, nullable')
        else:
            db.session.execute(text(
                "ALTER TABLE `pro_free_limits` ADD COLUMN `session_credits` INT NULL DEFAULT 2"))
            print('  session_credits: added')

        db.session.commit()

        row = db.session.execute(text('SELECT * FROM `pro_free_limits` WHERE id = 1')).mappings().first()
        print('\ncurrent row:', dict(row) if row else '(none)')
        print('\nNow re-apply the procedures:')
        print('  database/stored_procedures/business/pro_free_limits.sql')
        print('  database/stored_procedures/endpoints/subscriptions.sql')


if __name__ == '__main__':
    main()
