"""
Migration: the last hardcoded dropdowns become master data.

An audit found 60 hardcoded option arrays across 34 files. Most are harmless
(colour palettes, days of the week); these are the ones that carry meaning —
values that get stored, compared or filtered on.

The dangerous ones were the achiever portal's AUD_* targeting lists, which are
compared with exact string equality against what a student's profile holds:

    student stores          achiever targets        result
    science_pcb             "PCB"                   never matches
    "Mass Communication…"   "Mass Comm"             never matches
    "Computer Science (CSE)" "CSE"                  never matches

Stream targeting in particular was matching *nobody* — the profile moved to
canonical values (science_pcb) while the targeting UI still offered display
labels (PCB). Those two lists now come from the same place they always should
have: streams, course_catalogue and masters.

Seeded here are the flat enums that had no home yet. Anything with children or
attributes already has its own table.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_dropdown_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

# type → [(value, label)]. Value is what gets stored; label is what is shown.
LISTS = {
    'college_type': [
        ('government', 'Government'), ('private', 'Private'),
        ('deemed', 'Deemed'), ('autonomous', 'Autonomous'),
    ],
    'opportunity_type': [
        ('internship', 'Internship'), ('fresher_job', 'Fresher Job'),
        ('part_time', 'Part-time'), ('fellowship', 'Fellowship'),
        ('freelance', 'Freelance'),
    ],
    'document_category': [
        ('id_proof', 'ID Proof'), ('marksheet', 'Marksheet'),
        ('certificate', 'Certificate'), ('resume', 'Resume'),
        ('sop', 'SOP'), ('lor', 'LOR'), ('general', 'General'), ('other', 'Other'),
    ],
    'forum_category': [
        ('general', 'General'), ('exam_prep', 'Exam Prep'), ('college', 'College'),
        ('career', 'Career'), ('scholarship', 'Scholarship'), ('abroad', 'Abroad'),
        ('placement', 'Placement'),
    ],
    'market_category': [
        ('software', 'Software'), ('courses', 'Courses'), ('books', 'Books'),
        ('gadgets', 'Gadgets'), ('food', 'Food'), ('travel', 'Travel'),
        ('finance', 'Finance'), ('other', 'Other'),
    ],
    'community_category': [
        ('general', 'General'), ('engineering', 'Engineering'), ('medical', 'Medical'),
        ('commerce', 'Commerce'), ('arts', 'Arts'), ('exam_prep', 'Exam Prep'),
        ('placement', 'Placement'), ('abroad', 'Abroad'),
    ],
    'resource_type': [
        ('pdf', 'PDF'), ('video', 'Video'), ('article', 'Article'), ('quiz', 'Quiz'),
        ('ebook', 'E-book'), ('notes', 'Notes'), ('other', 'Other'),
    ],
    'cohort_level': [
        ('beginner', 'Beginner'), ('intermediate', 'Intermediate'), ('advanced', 'Advanced'),
    ],
    'cohort_status': [
        ('upcoming', 'Upcoming'), ('live', 'Live'),
        ('completed', 'Completed'), ('cancelled', 'Cancelled'),
    ],
    'applicant_stage': [
        ('applied', 'Applied'), ('interviewing', 'Interviewing'),
        ('offered', 'Offered'), ('rejected', 'Rejected'),
    ],
    'score_cap_type': [
        ('none', 'No cap'), ('once', 'Once ever'), ('lifetime', 'Lifetime'),
        ('daily', 'Per day'), ('weekly', 'Per week'), ('monthly', 'Per month'),
        ('per_item', 'Per item'),
    ],
}

# The College Predictor offered OC/BC/SC/ST/EWS while `category` (the one the
# scholarship and cutoff logic reads) holds general/obc/sc/st/ews. Two spellings
# of the same fact is how a student gets shown the wrong cutoff, so the
# predictor now reads `category` and these labels carry the familiar wording.
CATEGORY_LABELS = [
    ('general', 'General / OC'), ('obc', 'OBC / BC'), ('sc', 'SC'),
    ('st', 'ST'), ('ews', 'EWS'),
]


def upsert(mtype, value, label, order):
    row = db.session.execute(
        text("SELECT `id` FROM `masters` WHERE `type` = :t AND `value` = :v"),
        {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(text(
            "UPDATE `masters` SET `label` = :l, `sort_order` = :s, `is_active` = 1 WHERE `id` = :i"),
            {'l': label, 's': order, 'i': row[0]})
        return 0
    db.session.execute(text("""
        INSERT INTO `masters` (`id`, `type`, `value`, `label`, `sort_order`, `is_active`)
        VALUES (:i, :t, :v, :l, :s, 1)
    """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 's': order})
    return 1


def main():
    with app.app_context():
        added = 0
        for mtype, rows in LISTS.items():
            for i, (value, label) in enumerate(rows):
                added += upsert(mtype, value, label, (i + 1) * 10)
        for i, (value, label) in enumerate(CATEGORY_LABELS):
            added += upsert('category', value, label, (i + 1) * 10)
        db.session.commit()

        types = db.session.execute(text("""
            SELECT COUNT(DISTINCT `type`) FROM `masters` WHERE `is_active` = 1
        """)).scalar()
        rows = db.session.execute(text("""
            SELECT COUNT(1) FROM `masters` WHERE `is_active` = 1
        """)).scalar()
        print(f"rows added: {added}")
        print(f"masters now: {types} active types, {rows} rows")


if __name__ == "__main__":
    main()
