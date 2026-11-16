"""Repoint BGV start onto the lifecycle state. Procedures only."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()


def main():
    with app.app_context():
        n = apply_sql_file('database/stored_procedures/business/achiever_bgv_state.sql')
        print(f"  loaded {n} statement(s)")
        row = db.session.execute(text("CALL sp_achiever_bgv_start(:a, :r, :x)"),
                                 {'a': '00000000-0000-0000-0000-000000000000',
                                  'r': 'smoke', 'x': None}).mappings().first()
        print(f"  smoke test (fake id) -> {dict(row)}")


if __name__ == '__main__':
    main()
