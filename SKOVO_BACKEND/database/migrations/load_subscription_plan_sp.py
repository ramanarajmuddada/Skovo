"""Install the subscription plan create/delete/rename procedures. Idempotent."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
SP_FILE = 'database/stored_procedures/business/subscription_plans.sql'
PROCS = ('sp_subscription_plan_create', 'sp_subscription_plan_delete',
         'sp_subscription_plan_rename')


def main():
    with app.app_context():
        n = apply_sql_file(SP_FILE)
        print(f"  loaded {n} statement(s)")
        for p in PROCS:
            got = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES "
                "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"), {'n': p}).scalar()
            print(f"  {p:<34} {'OK' if got else 'MISSING'}")


if __name__ == '__main__':
    main()
