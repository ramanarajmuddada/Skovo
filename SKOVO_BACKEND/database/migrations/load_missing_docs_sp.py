"""Install sp_achiever_missing_documents."""
import _bootstrap  # noqa: F401
from sqlalchemy import text
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file
app = InitApp().app()
def main():
    with app.app_context():
        n = apply_sql_file('database/stored_procedures/business/achiever_lifecycle.sql')
        print(f"  loaded {n} statement(s)")
        rows = db.session.execute(text("CALL sp_achiever_missing_documents(:a)"),
                                  {'a': '00000000-0000-0000-0000-000000000000'}).fetchall()
        print(f"  smoke test -> {len(rows)} required doc type(s) outstanding for a fake id")
if __name__ == '__main__':
    main()
