"""
Migration: the course lists move out of React and into the database.

UG_DEGREES, UG_BRANCHES, PG_DEGREES, POLY_BRANCHES, ITI_TRADES and
PROF_COURSE_TYPES lived in OnboardingModal.jsx, with near-duplicate copies in
AchieverCohorts.jsx and AchieverCourses.jsx for audience targeting. They had
already drifted — a student's "Mass Comm & Journalism" could never match a
cohort targeted at "Mass Comm", so the cohort was invisible to exactly the
student it was built for.

One row per course here, carrying degree_category / degree / branch together, so
both sides of that comparison read the same table.

Idempotent — upserts on (level, degree, branch). Run from SKOVO_BACKEND:
    python migrate_course_catalogue.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/course_catalogue.sql'

# Aliases students actually type. Keys are matched against degree or branch.
ALIASES = {
    'B.Tech': 'btech b tech bachelor of technology engineering',
    'B.E.': 'be b e bachelor of engineering',
    'MBBS': 'mbbs medical doctor mbbs medicine',
    'BDS': 'bds dental dentist',
    'B.Sc': 'bsc b sc bachelor of science',
    'B.Com': 'bcom b com bachelor of commerce',
    'BBA': 'bba business administration management',
    'BCA': 'bca computer applications',
    'MBA': 'mba masters business administration management pgdm',
    'PGDM': 'pgdm post graduate diploma management mba',
    'M.Tech': 'mtech m tech masters technology',
    'MCA': 'mca computer applications masters',
    'M.Sc': 'msc m sc masters science',
    'B.Pharmacy': 'bpharm b pharm pharmacy',
    'B.Arch': 'barch b arch architecture',
    # Branch aliases — the short forms students type. Without these, "mba hr"
    # finds nothing, because the row only says "Human Resources".
    'Computer Science (CSE)': 'cse cs computer science',
    'Electronics & Communication (ECE)': 'ece electronics communication',
    'Electrical & Electronics (EEE)': 'eee electrical electronics',
    'Information Technology': 'it information technology',
    'AI & Machine Learning': 'ai ml aiml artificial intelligence machine learning',
    'Data Science': 'ds data science analytics',
    'Human Resources': 'hr human resources hrm',
    'Business Analytics': 'ba analytics business analytics',
    'IT & Systems': 'it systems information technology',
    'Logistics & Supply Chain': 'scm supply chain logistics operations',
    'Mechanical': 'mech mechanical',
    'Civil': 'civil',
    'Cyber Security': 'cyber security cybersecurity infosec',
    'UI/UX Design': 'ui ux uiux design',
    'Mechanic (Motor Vehicle)': 'mmv motor vehicle mechanic',
    'Mechanic (Diesel)': 'diesel mechanic',
    'COPA': 'copa computer operator programming assistant',
    'Mathematics': 'maths math mathematics',
    'Biology': 'bio biology',
    'Political Science': 'polsci political science',
    'Business Administration': 'ba business administration',
    'Accounting & Finance': 'accounts accounting finance',
    'Computer Applications': 'ca computer applications',
}

# level, degree_category, degree, [branches] (None = degree has no branch), duration
CATALOGUE = [
    # ── UG ────────────────────────────────────────────────────────────────────
    ('ug', 'Engineering', 'B.Tech', ['Computer Science (CSE)', 'Electronics & Communication (ECE)',
     'Electrical & Electronics (EEE)', 'Mechanical', 'Civil', 'Chemical', 'Information Technology',
     'AI & Machine Learning', 'Data Science', 'Aerospace', 'Automobile', 'Biotechnology',
     'Robotics & Automation', 'Mining', 'Metallurgy', 'Agricultural Engineering', 'Other'], 4),
    ('ug', 'Engineering', 'B.E.', ['Computer Science (CSE)', 'Electronics & Communication (ECE)',
     'Mechanical', 'Civil', 'Electrical', 'Other'], 4),
    ('ug', 'Medical', 'MBBS', None, 5.5),
    ('ug', 'Medical', 'BDS', None, 5),
    ('ug', 'Medical', 'BAMS', None, 5.5),
    ('ug', 'Medical', 'BHMS', None, 5.5),
    ('ug', 'Medical', 'BUMS', None, 5.5),
    ('ug', 'Medical', 'BSMS', None, 5.5),
    ('ug', 'Pharmacy', 'B.Pharmacy', None, 4),
    ('ug', 'Pharmacy', 'Pharm.D', None, 6),
    ('ug', 'Nursing & Allied Health', 'B.Sc Nursing', None, 4),
    ('ug', 'Nursing & Allied Health', 'GNM', None, 3),
    ('ug', 'Nursing & Allied Health', 'BPT (Physiotherapy)', None, 4.5),
    ('ug', 'Nursing & Allied Health', 'B.Sc MLT', None, 3),
    ('ug', 'Science', 'B.Sc', ['Physics', 'Chemistry', 'Mathematics', 'Biology', 'Biotechnology',
     'Microbiology', 'Statistics', 'Computer Science', 'Electronics', 'Zoology', 'Botany',
     'Food Technology', 'Forensic Science', 'Other'], 3),
    ('ug', 'Commerce', 'B.Com', ['General', 'Honours', 'Computer Applications', 'Accounting & Finance',
     'Banking & Insurance', 'Taxation', 'Other'], 3),
    ('ug', 'Commerce', 'BBA', ['General', 'Finance', 'Marketing', 'HR', 'Business Analytics',
     'International Business', 'Other'], 3),
    ('ug', 'Commerce', 'BMS', None, 3),
    ('ug', 'Arts & Humanities', 'BA', ['English', 'History', 'Economics', 'Political Science',
     'Psychology', 'Sociology', 'Public Administration', 'Geography', 'Philosophy', 'Languages',
     'Other'], 3),
    ('ug', 'Arts & Humanities', 'BFA (Fine Arts)', None, 4),
    ('ug', 'Law', 'BA LLB', None, 5),
    ('ug', 'Law', 'BBA LLB', None, 5),
    ('ug', 'Law', 'B.Com LLB', None, 5),
    ('ug', 'Law', 'LLB', None, 3),
    ('ug', 'Computer Applications', 'BCA', ['General', 'Data Science', 'Cyber Security',
     'AI & Machine Learning', 'Cloud Computing', 'Other'], 3),
    ('ug', 'Computer Applications', 'B.Sc IT', None, 3),
    ('ug', 'Architecture', 'B.Arch', None, 5),
    ('ug', 'Architecture', 'B.Planning', None, 4),
    ('ug', 'Design', 'B.Des', ['Fashion Design', 'Product Design', 'Interior Design',
     'Communication Design', 'UI/UX Design', 'Animation', 'Other'], 4),
    ('ug', 'Hotel Management', 'BHM', None, 4),
    ('ug', 'Mass Communication & Journalism', 'BJMC', None, 3),
    ('ug', 'Mass Communication & Journalism', 'BA Journalism', None, 3),
    ('ug', 'Mass Communication & Journalism', 'BMM', None, 3),
    ('ug', 'Agriculture', 'B.Sc Agriculture', None, 4),
    ('ug', 'Agriculture', 'B.Sc Horticulture', None, 4),
    ('ug', 'Agriculture', 'B.Tech Dairy Technology', None, 4),
    ('ug', 'Veterinary', 'B.V.Sc & AH', None, 5.5),
    ('ug', 'Marine & Defence', 'B.E. Marine Engineering', None, 4),
    ('ug', 'Marine & Defence', 'B.Sc Nautical Science', None, 3),
    ('ug', 'Marine & Defence', 'NDA (Army / Navy / Air Force)', None, 3),
    ('ug', 'Education', 'B.Ed', None, 2),
    ('ug', 'Education', 'D.El.Ed', None, 2),
    ('ug', 'Other', 'Other UG Degree', None, 3),

    # ── PG ────────────────────────────────────────────────────────────────────
    ('pg', 'Management', 'MBA', ['Finance', 'Marketing', 'Human Resources', 'Operations',
     'Business Analytics', 'IT & Systems', 'International Business', 'Strategy',
     'Entrepreneurship', 'Healthcare Management', 'Logistics & Supply Chain', 'Rural Management',
     'Other'], 2),
    ('pg', 'Management', 'PGDM', ['Finance', 'Marketing', 'Human Resources', 'Operations',
     'Business Analytics', 'Other'], 2),
    ('pg', 'Management', 'Executive MBA', None, 1.5),
    ('pg', 'Engineering', 'M.Tech', ['Computer Science (CSE)', 'VLSI Design', 'Structural Engineering',
     'Thermal Engineering', 'Power Systems', 'Data Science', 'AI & Machine Learning',
     'Embedded Systems', 'Environmental Engineering', 'Other'], 2),
    ('pg', 'Engineering', 'M.E.', ['Computer Science (CSE)', 'Mechanical', 'Civil', 'Other'], 2),
    ('pg', 'Science', 'M.Sc', ['Physics', 'Chemistry', 'Mathematics', 'Biotechnology',
     'Microbiology', 'Statistics', 'Computer Science', 'Data Science', 'Environmental Science',
     'Other'], 2),
    ('pg', 'Computer Applications', 'MCA', None, 2),
    ('pg', 'Commerce', 'M.Com', None, 2),
    ('pg', 'Arts & Humanities', 'MA', ['English', 'History', 'Economics', 'Political Science',
     'Psychology', 'Sociology', 'Public Administration', 'Journalism', 'Other'], 2),
    ('pg', 'Law', 'LLM', None, 1),
    ('pg', 'Medical', 'MD', None, 3),
    ('pg', 'Medical', 'MS', None, 3),
    ('pg', 'Medical', 'MDS', None, 3),
    ('pg', 'Medical', 'M.Pharmacy', None, 2),
    ('pg', 'Medical', 'MPT (Physiotherapy)', None, 2),
    ('pg', 'Design & Architecture', 'M.Des', None, 2),
    ('pg', 'Design & Architecture', 'M.Arch', None, 2),
    ('pg', 'Education', 'M.Ed', None, 2),
    ('pg', 'Agriculture', 'M.Sc Agriculture', None, 2),
    ('pg', 'Other', 'Other PG Degree', None, 2),

    # ── Diploma / Polytechnic ─────────────────────────────────────────────────
    ('diploma', 'Polytechnic', 'Diploma', ['Civil', 'Mechanical', 'Electrical',
     'Electronics & Communication', 'Computer Science', 'Information Technology', 'Chemical',
     'Automobile', 'Mining', 'Textile', 'Other'], 3),

    # ── ITI ───────────────────────────────────────────────────────────────────
    ('iti', 'ITI', 'ITI', ['Electrician', 'Fitter', 'Welder', 'Mechanic (Diesel)',
     'Mechanic (Motor Vehicle)', 'Plumber', 'Turner', 'COPA', 'Draughtsman (Civil)',
     'Draughtsman (Mechanical)', 'Wireman', 'Painter', 'Carpenter', 'Machinist',
     'Refrigeration & AC', 'Other'], 2),

    # ── Professional courses ──────────────────────────────────────────────────
    ('professional', 'Chartered Accountancy', 'CA', ['Foundation', 'Intermediate', 'Final'], 4),
    ('professional', 'Company Secretary', 'CS', ['Foundation', 'Executive', 'Professional'], 3),
    ('professional', 'Cost & Management Accountancy', 'CMA', ['Foundation', 'Intermediate', 'Final'], 3),
    ('professional', 'Finance', 'CFA', ['Level 1', 'Level 2', 'Level 3'], 3),
    ('professional', 'Finance', 'ACCA', ['Applied Knowledge', 'Applied Skills',
     'Strategic Professional'], 3),
    ('professional', 'Finance', 'CPA', None, 2),

    # ── PhD ───────────────────────────────────────────────────────────────────
    ('phd', 'Research', 'PhD', ['Engineering & Technology', 'Sciences', 'Management',
     'Arts & Humanities', 'Medical', 'Law', 'Education', 'Other'], 4),
]


def _search_text(degree_category, degree, branch):
    """Space-separated words the search matches token-prefixes against.

    Punctuation is stripped and the de-punctuated form appended, so "B.Tech"
    is findable as both "b.tech" and "btech". Brackets go too — otherwise
    "(cse)" never starts a word and "cs" would miss its own row.
    """
    parts = [degree, branch or '', degree_category,
             ALIASES.get(degree, ''), ALIASES.get(branch, '')]
    plain = ' '.join(p for p in parts if p)
    stripped = plain.replace('.', '').replace('&', ' ').replace('(', ' ').replace(')', ' ').replace('/', ' ')
    words = f"{plain} {stripped}".lower().replace('(', ' ').replace(')', ' ')
    return ' '.join(dict.fromkeys(words.split()))[:400]   # de-duped, order kept


def seed():
    # A course with no branch stores '' rather than NULL. MySQL treats NULLs as
    # distinct in a unique key, so NULL-branch rows never matched
    # ON DUPLICATE KEY UPDATE and a second run duplicated every one of them.
    # This clears any such rows left by an earlier run before reseeding.
    db.session.execute(text("DELETE FROM `course_catalogue` WHERE `branch` IS NULL"))
    db.session.commit()

    order = 0
    rows = 0
    for level, category, degree, branches, duration in CATALOGUE:
        for branch in (branches or ['']):
            order += 10
            display = f"{degree} — {branch}" if branch else degree
            db.session.execute(text("""
                INSERT INTO `course_catalogue`
                    (`id`, `level`, `degree_category`, `degree`, `branch`, `display_name`,
                     `search_text`, `duration_years`, `sort_order`, `is_active`)
                VALUES (:i, :lv, :cat, :deg, :br, :disp, :st, :dur, :o, 1)
                ON DUPLICATE KEY UPDATE
                    `degree_category` = :cat, `display_name` = :disp, `search_text` = :st,
                    `duration_years` = :dur, `sort_order` = :o, `is_active` = 1
            """), {'i': str(uuid.uuid4()), 'lv': level, 'cat': category, 'deg': degree,
                   'br': branch, 'disp': display, 'st': _search_text(category, degree, branch),
                   'dur': duration, 'o': order})
            rows += 1
    db.session.commit()
    return rows


def main():
    with app.app_context():
        procs = apply_sql_file(SP_FILE)
        rows = seed()
        counts = db.session.execute(text("""
            SELECT `level`, COUNT(*) AS n FROM `course_catalogue` GROUP BY `level` ORDER BY `level`
        """)).mappings().all()
        print(f"statements run: {procs} | rows upserted: {rows}")
        print("course_catalogue:", {c['level']: c['n'] for c in counts})


if __name__ == "__main__":
    main()
