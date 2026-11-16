"""Per-achiever commission procedures. Idempotent; procedures only."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
PROCS = ('sp_commission_rate_resolve', 'sp_commission_for_achiever',
         'sp_commission_set_for_achiever', 'sp_commission_clear_for_achiever')


def main():
    with app.app_context():
        n = apply_sql_file('database/stored_procedures/business/commission_rules.sql')
        print(f"  loaded {n} statement(s)")
        for p in PROCS:
            got = db.session.execute(text(
                "SELECT COUNT(*) FROM information_schema.ROUTINES WHERE "
                "ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n"), {'n': p}).scalar()
            print(f"  {p:<34} {'OK' if got else 'MISSING'}")
        row = db.session.execute(text("CALL sp_commission_rate_resolve(:a, :k)"),
                                 {'a': '00000000-0000-0000-0000-000000000000',
                                  'k': 'session'}).mappings().first()
        print(f"  resolve falls back to global -> {dict(row)}")


if __name__ == '__main__':
    main()
