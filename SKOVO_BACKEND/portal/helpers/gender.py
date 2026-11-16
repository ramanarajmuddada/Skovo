"""Gender on student and achiever profiles: a master_gender value, or None."""
from sqlalchemy import text

from portal.models import db


def clean_gender(value):
    """'' clears; an unknown value is refused (None, False)."""
    v = (value or '').strip().lower()
    if not v:
        return None, True
    ok = db.session.execute(text(
        "SELECT 1 FROM master_gender WHERE value = :v AND is_active = 1 AND value <> 'all'"),
        {'v': v}).scalar()
    return (v, True) if ok else (None, False)
