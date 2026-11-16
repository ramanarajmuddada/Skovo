"""Install sp_admin_state_history. Procedures only; idempotent."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
SP_FILE = 'database/stored_procedures/business/admin_approval.sql'


def main():
    with app.app_context():
        n = apply_sql_file(SP_FILE)
        print(f"  loaded {n} statement(s)")
        got = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = 'sp_admin_state_history'"
        )).scalar()
        print(f"  sp_admin_state_history {'OK' if got else 'MISSING'}")
        a = db.session.execute(text("SELECT id FROM admins LIMIT 1")).scalar()
        if a:
            rows = db.session.execute(text("CALL sp_admin_state_history(:i)"), {'i': a}).fetchall()
            print(f"  ran against a real admin -> {len(rows)} history row(s)")


if __name__ == '__main__':
    main()
