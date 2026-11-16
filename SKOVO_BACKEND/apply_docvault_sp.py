"""One-off: reload database/stored_procedures/endpoints/document_vault.sql.

Adds sp_docvault_update_file and re-creates the four existing docvault
procedures from their current bodies (every file drops before it creates, so
this is idempotent). Uses the same loader apply_all.py uses.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from portal import InitApp

app = InitApp().app()
with app.app_context():
    from portal.helpers.sql_file import apply_sql_file
    from portal.models import db
    from sqlalchemy import text

    path = os.path.join('database', 'stored_procedures', 'endpoints', 'document_vault.sql')
    n = apply_sql_file(path)
    db.session.commit()
    print(f'applied {n} statement(s) from {path}')

    rows = db.session.execute(text(
        "SELECT routine_name FROM information_schema.routines "
        "WHERE routine_schema = DATABASE() AND routine_name LIKE 'sp_docvault%' "
        "ORDER BY routine_name")).fetchall()
    print('procedures now present:', [r[0] for r in rows])
