"""
DB Migration — v2 bugfix pass.

Adds the two new columns introduced by the bugfix work and seeds the master
dropdown options the Profile page needs (which were never seeded, leaving the
Education / Stream / Year / Career-interest selects empty).

Run from the SKOVO_BACKEND folder:
    python migrate_v2_bugfixes.py

Safe to re-run: skips columns and master rows that already exist.
"""

import sys
import os
import uuid

sys.path.insert(0, os.path.dirname(__file__))

from sqlalchemy import text
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db

app = InitApp().app()

# ── 1. New columns ────────────────────────────────────────────────────────────
COLUMN_MIGRATIONS = [
    # achiever_sessions: achiever-supplied 1-on-1 join link
    ("achiever_sessions", "meeting_link",
     "ALTER TABLE achiever_sessions ADD COLUMN meeting_link VARCHAR(500) NULL"),
    # achiever_sessions: paid 1-on-1 session payment fields
    ("achiever_sessions", "amount",
     "ALTER TABLE achiever_sessions ADD COLUMN amount DECIMAL(10,2) DEFAULT 0"),
    ("achiever_sessions", "platform_fee",
     "ALTER TABLE achiever_sessions ADD COLUMN platform_fee DECIMAL(10,2) DEFAULT 0"),
    ("achiever_sessions", "achiever_earning",
     "ALTER TABLE achiever_sessions ADD COLUMN achiever_earning DECIMAL(10,2) DEFAULT 0"),
    ("achiever_sessions", "payment_status",
     "ALTER TABLE achiever_sessions ADD COLUMN payment_status VARCHAR(20) DEFAULT 'free'"),
    ("achiever_sessions", "payment_order_id",
     "ALTER TABLE achiever_sessions ADD COLUMN payment_order_id VARCHAR(100) NULL"),
    ("achiever_sessions", "payment_id",
     "ALTER TABLE achiever_sessions ADD COLUMN payment_id VARCHAR(100) NULL"),
    ("achiever_sessions", "reminder_sent",
     "ALTER TABLE achiever_sessions ADD COLUMN reminder_sent TINYINT(1) NOT NULL DEFAULT 0"),
    # achievers: education levels this achiever mentors (multi-select JSON)
    ("achievers", "suitable_for",
     "ALTER TABLE achievers ADD COLUMN suitable_for JSON NULL"),
    # achievers: 1-on-1 session rate + payout details
    ("achievers", "session_rate",
     "ALTER TABLE achievers ADD COLUMN session_rate DECIMAL(10,2) DEFAULT 0"),
    ("achievers", "payout_account_name",
     "ALTER TABLE achievers ADD COLUMN payout_account_name VARCHAR(150) NULL"),
    ("achievers", "payout_account_number",
     "ALTER TABLE achievers ADD COLUMN payout_account_number VARCHAR(50) NULL"),
    ("achievers", "payout_ifsc",
     "ALTER TABLE achievers ADD COLUMN payout_ifsc VARCHAR(20) NULL"),
    ("achievers", "payout_upi",
     "ALTER TABLE achievers ADD COLUMN payout_upi VARCHAR(100) NULL"),
]

# ── 2. Master dropdown options (Profile page) ─────────────────────────────────
# education_level VALUES must match the stream_<level>/year_<level> suffixes the
# Profile page builds: masters[`stream_${education_level}`].
MASTER_SEED = {
    "education_level": [
        ("11th_12th", "Class 11–12 (School)"),
        ("12th",      "Class 12 (Completed)"),
        ("diploma",   "Diploma / ITI / Polytechnic"),
        ("ug",        "Undergraduate (UG)"),
        ("graduated", "Graduated / Postgraduate"),
    ],
    "career_interest": [
        ("technology", "Technology"), ("finance", "Finance"),
        ("management", "Management"), ("design", "Design"),
        ("marketing", "Marketing"), ("healthcare", "Healthcare"),
        ("government", "Government / Civil Services"), ("research", "Research"),
        ("law", "Law"), ("media", "Media & Communication"),
        ("education", "Education"), ("entrepreneurship", "Entrepreneurship"),
    ],
    "stream_11th_12th": [
        ("science_pcm", "Science (PCM)"), ("science_pcb", "Science (PCB)"),
        ("commerce", "Commerce"), ("arts", "Arts / Humanities"),
    ],
    "stream_12th": [
        ("science_pcm", "Science (PCM)"), ("science_pcb", "Science (PCB)"),
        ("commerce", "Commerce"), ("arts", "Arts / Humanities"),
    ],
    "stream_diploma": [
        ("computer", "Computer Engineering"), ("mechanical", "Mechanical"),
        ("electrical", "Electrical"), ("civil", "Civil"),
        ("electronics", "Electronics"), ("other", "Other"),
    ],
    "stream_ug": [
        ("cse", "Computer Science (CSE)"), ("it", "Information Technology"),
        ("ece", "Electronics & Communication (ECE)"), ("eee", "Electrical (EEE)"),
        ("mechanical", "Mechanical"), ("civil", "Civil"),
        ("bcom", "B.Com"), ("bba", "BBA"), ("bsc", "B.Sc"), ("ba", "BA"),
        ("other", "Other"),
    ],
    "stream_graduated": [
        ("engineering", "Engineering"), ("commerce", "Commerce"),
        ("science", "Science"), ("arts", "Arts"), ("management", "Management"),
        ("other", "Other"),
    ],
    "year_11th_12th": [
        ("11th", "Class 11"), ("12th", "Class 12"),
    ],
    "year_diploma": [
        ("1", "1st Year"), ("2", "2nd Year"), ("3", "3rd Year"),
    ],
    "year_ug": [
        ("1", "1st Year"), ("2", "2nd Year"),
        ("3", "3rd Year"), ("4", "4th Year"),
    ],
}


def column_exists(conn, table, column):
    row = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {"t": table, "c": column}).scalar()
    return bool(row)


def run():
    with app.app_context():
        conn = db.session.connection()

        # 1. Columns
        for table, column, ddl in COLUMN_MIGRATIONS:
            if column_exists(conn, table, column):
                print(f"  • {table}.{column} already exists — skipped")
                continue
            conn.execute(text(ddl))
            print(f"  ✓ added {table}.{column}")

        # 2. Masters seed
        added = 0
        for mtype, options in MASTER_SEED.items():
            for sort, (value, label) in enumerate(options):
                # ── SP: sp_master_create — reports 'duplicate' itself, so the
                # pre-SELECT is gone. ────────────────────────────────────────
                res = conn.execute(text("CALL sp_master_create(:t, :id, :v, :l, :s, NULL)"),
                                   {"t": mtype, "id": str(uuid.uuid4()), "v": value,
                                    "l": label, "s": sort}).fetchone()
                if res and res[0] == 'ok':
                    added += 1
        print(f"  ✓ seeded {added} new master option(s)")

        db.session.commit()
        print("Migration complete.")


if __name__ == "__main__":
    run()
