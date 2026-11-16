"""Repoint booking eligibility onto the lifecycle state. Procedures only."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
SP_FILE = 'database/stored_procedures/business/achiever_booking_eligibility.sql'


def main():
    with app.app_context():
        n = apply_sql_file(SP_FILE)
        print(f"  loaded {n} statement(s)")
        got = db.session.execute(text(
            "SELECT COUNT(*) FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() "
            "AND ROUTINE_NAME = 'sp_achiever_booking_eligibility'")).scalar()
        print(f"  sp_achiever_booking_eligibility {'OK' if got else 'MISSING'}")
        row = db.session.execute(text(
            "CALL sp_achiever_booking_eligibility(:a, :s)"),
            {'a': '00000000-0000-0000-0000-000000000000',
             's': '00000000-0000-0000-0000-000000000000'}).mappings().first()
        print(f"  smoke test -> {dict(row)}")


if __name__ == '__main__':
    main()
