"""All-India coverage for `course_catalogue`.

WHY
    This table is the single source for every "degree" and "branch" dropdown in
    the product -- onboarding, Colleges, Courses, cohort targeting, and the
    "Task for a batch" card on the Score Engine. useAudienceOptions.js pulls
    from it precisely so the targeting side and the student's profile cannot
    spell a value differently; that had already silently hidden content from
    the students it was built for three times over.

    A gap here is therefore not cosmetic. If a student's course is missing they
    pick "Other", and every batch rule written against a real branch misses
    them for good.

    It held 265 rows: 86 degrees, 134 branches. Whole streams of Indian higher
    education were absent -- no D.Pharm, no B.Voc, no MD/MS/MDS specialities,
    no paramedical or allied-health degrees, polytechnic had 11 branches
    against the ~25 AICTE actually runs, and B.E. carried 6 branches while its
    twin B.Tech carried 17.

WHAT THIS DOES
    Adds the missing rows. It never edits an existing one.

    A row already in the table is skipped untouched -- its is_active, sort_order
    and wording are left exactly as they are. Re-running adds nothing.

    That needs an explicit existence check, NOT just INSERT IGNORE. MySQL treats
    NULL as distinct inside a UNIQUE index, so UNIQUE (level, degree, branch)
    does not constrain a degree offered as one undivided course -- branch IS
    NULL collides with nothing, and a second run inserted all 42 of them again.
    This pass also clears any such duplicates, keeping the oldest row.

    sort_order for a new branch continues from the highest already used by that
    same degree, so additions sit after their siblings rather than jumping to
    the top of the list.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/seed_course_catalogue_india.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

DASH = '—'   # the separator every display_name already uses

# ── Extra branches for degrees that are already in the table ────────────────
# (level, degree) -> branches to add. Anything already present is skipped.
MORE_BRANCHES = {
    ('ug', 'B.Tech'): [
        'Metallurgical Engineering', 'Mining Engineering', 'Petroleum Engineering',
        'Production & Industrial', 'Instrumentation & Control', 'Robotics & Automation',
        'Cyber Security', 'Internet of Things (IoT)', 'Textile Engineering',
        'Food Technology', 'Ceramic Engineering', 'Environmental Engineering',
        'Marine Engineering', 'Mechatronics', 'Nanotechnology',
        'Electronics & Instrumentation', 'Information Technology',
        'Computer Science & Business Systems', 'Printing Technology',
        'Plastics & Polymer Engineering', 'Genetic Engineering',
    ],
    ('ug', 'B.E.'): [
        'Aerospace', 'Automobile', 'Biotechnology', 'Chemical',
        'Information Technology', 'Instrumentation & Control', 'Mechatronics',
        'Metallurgical Engineering', 'Mining Engineering', 'Production & Industrial',
        'AI & Machine Learning', 'Data Science', 'Cyber Security',
        'Environmental Engineering', 'Textile Engineering',
    ],
    ('ug', 'B.Sc'): [
        'Zoology', 'Geology', 'Statistics', 'Psychology', 'Economics',
        'Home Science', 'Animation & Multimedia', 'Actuarial Science',
        'Environmental Science', 'Geography', 'Fashion Design',
        'Hotel Management', 'Aviation', 'Data Science', 'Nautical Science',
        'Agriculture', 'Fisheries', 'Forestry',
    ],
    ('ug', 'BA'): [
        'Education', 'Social Work', 'Fine Arts', 'Hindi', 'Sanskrit',
        'Anthropology', 'Archaeology', 'Defence Studies', 'Music',
        'Tourism & Travel', 'Rural Development', 'Home Science',
        'Statistics', 'Mass Communication',
    ],
    ('ug', 'B.Com'): [
        'Corporate Secretaryship', 'Cost & Management Accounting', 'E-Commerce',
        'Marketing', 'International Business', 'Statistics',
        'Financial Markets', 'Professional (ACCA / CA integrated)',
    ],
    ('ug', 'BBA'): [
        'Logistics & Supply Chain', 'Aviation Management', 'Digital Marketing',
        'Entrepreneurship', 'Hospital Management', 'Sports Management',
        'Hotel Management', 'Event Management',
    ],
    ('ug', 'BCA'): [
        'Full Stack Development', 'Mobile Application Development',
        'Animation & Multimedia', 'Information Security', 'Data Analytics',
    ],
    ('ug', 'LLB'): [
        'Corporate Law', 'Criminal Law', 'Constitutional Law',
        'Intellectual Property Law', 'Cyber Law', 'International Law',
    ],
    ('ug', 'B.Des'): [
        'Graphic Design', 'Textile Design', 'Jewellery Design',
        'Game Design', 'Automobile / Transportation Design',
    ],
    ('pg', 'M.Tech'): [
        'VLSI Design', 'Thermal Engineering', 'Manufacturing Engineering',
        'Transportation Engineering', 'Geotechnical Engineering',
        'Cyber Security', 'Robotics & Automation', 'Communication Systems',
        'Construction Management', 'Information Technology',
    ],
    ('pg', 'M.E.'): [
        'Structural Engineering', 'Power Systems', 'Thermal Engineering',
        'VLSI Design', 'Applied Electronics', 'Manufacturing Engineering',
    ],
    ('pg', 'M.Sc'): [
        'Zoology', 'Botany', 'Geology', 'Psychology', 'Electronics',
        'Food Technology', 'Forensic Science', 'Nursing', 'Geography',
        'Actuarial Science', 'Bioinformatics', 'Nanoscience',
    ],
    ('pg', 'MA'): [
        'Education', 'Social Work', 'Hindi', 'Sanskrit', 'Philosophy',
        'Anthropology', 'Fine Arts', 'Defence Studies', 'Mass Communication',
        'Rural Development', 'Linguistics',
    ],
    ('pg', 'MBA'): [
        'Operations', 'Marketing', 'Rural Management', 'Agri Business',
        'Digital Marketing', 'Banking & Financial Services',
        'Hospital & Healthcare', 'Data Science',
    ],
    ('pg', 'MD'): [
        'General Medicine', 'Paediatrics', 'Radiodiagnosis', 'Anaesthesiology',
        'Dermatology', 'Psychiatry', 'Pathology', 'Microbiology',
        'Pharmacology', 'Community Medicine', 'Biochemistry', 'Physiology',
        'Anatomy', 'Respiratory Medicine', 'Emergency Medicine',
    ],
    ('pg', 'MS'): [
        'General Surgery', 'Orthopaedics', 'ENT', 'Ophthalmology',
        'Obstetrics & Gynaecology',
    ],
    ('pg', 'MDS'): [
        'Orthodontics', 'Periodontics', 'Prosthodontics',
        'Oral & Maxillofacial Surgery', 'Conservative Dentistry & Endodontics',
        'Pedodontics', 'Oral Pathology', 'Public Health Dentistry',
    ],
    ('pg', 'LLM'): [
        'Corporate Law', 'Criminal Law', 'Constitutional Law',
        'Intellectual Property Law', 'International Law', 'Cyber Law',
    ],
    ('pg', 'M.Pharmacy'): [
        'Pharmaceutics', 'Pharmacology', 'Pharmaceutical Chemistry',
        'Pharmacy Practice', 'Pharmaceutical Analysis',
    ],
    ('pg', 'M.Com'): [
        'Accounting & Finance', 'Banking & Insurance', 'Taxation',
        'International Business',
    ],
    ('pg', 'MCA'): ['AI & Machine Learning', 'Data Science', 'Cyber Security'],
    ('diploma', 'Diploma'): [
        'Mechatronics', 'Instrumentation & Control', 'Production Engineering',
        'Metallurgy', 'Architecture', 'Interior Design', 'Fashion Technology',
        'Agriculture', 'Hotel Management & Catering', 'Medical Laboratory Technology',
        'Fire & Safety', 'Marine Engineering', 'Petroleum Engineering',
        'Plastics Technology', 'Printing Technology', 'Ceramic Technology',
        'Leather Technology', 'Food Technology', 'Electrical & Electronics',
        'Electronics & Instrumentation', 'Computer Engineering',
        'Civil & Rural Engineering', 'Garment Technology',
    ],
    ('phd', 'PhD'): [
        'Agriculture', 'Commerce', 'Pharmacy', 'Computer Science',
        'Social Sciences', 'Architecture & Planning', 'Nursing',
        'Physical Education', 'Journalism & Mass Communication',
    ],
    ('professional', 'CFA'): [],
}

# ── Degrees the table did not have at all ───────────────────────────────────
# (level, degree_category, degree, branches, duration_years, eligibility)
# branches == [None] means the degree is offered as one undivided course.
NEW_DEGREES = [
    # --- UG: vocational, allied health, social sciences -------------------
    ('ug', 'Other', 'B.Voc', [
        'Software Development', 'Retail Management', 'Healthcare',
        'Automobile Servicing', 'Hospitality & Tourism', 'Beauty & Wellness',
        'Food Processing', 'Renewable Energy', 'Logistics',
    ], 3.0, None),
    ('ug', 'Arts & Humanities', 'BSW (Social Work)', [None], 3.0, None),
    ('ug', 'Arts & Humanities', 'B.Lib.I.Sc', [None], 1.0, None),
    ('ug', 'Arts & Humanities', 'BPA (Performing Arts)', [
        'Music', 'Dance', 'Theatre',
    ], 3.0, None),
    ('ug', 'Education', 'B.P.Ed (Physical Education)', [None], 2.0, None),
    ('ug', 'Education', 'B.El.Ed', [None], 4.0, None),
    ('ug', 'Nursing & Allied Health', 'BASLP (Audiology & Speech)', [None], 4.0, None),
    ('ug', 'Nursing & Allied Health', 'B.Optom (Optometry)', [None], 4.0, None),
    ('ug', 'Nursing & Allied Health', 'BOT (Occupational Therapy)', [None], 4.5, None),
    ('ug', 'Nursing & Allied Health', 'B.Sc Allied Health', [
        'Radiology & Imaging', 'Operation Theatre Technology',
        'Cardiac Care Technology', 'Dialysis Technology',
        'Anaesthesia Technology', 'Respiratory Therapy',
        'Emergency & Trauma Care', 'Optometry', 'Perfusion Technology',
    ], 3.0, None),
    ('ug', 'Medical', 'BNYS (Naturopathy & Yoga)', [None], 5.5, None),
    ('ug', 'Agriculture', 'B.Sc Forestry', [None], 4.0, None),
    ('ug', 'Agriculture', 'B.F.Sc (Fisheries)', [None], 4.0, None),
    ('ug', 'Agriculture', 'B.Tech Agricultural Engineering', [None], 4.0, None),
    ('ug', 'Agriculture', 'B.Tech Food Technology', [None], 4.0, None),
    ('ug', 'Commerce', 'BBM', [None], 3.0, None),
    ('ug', 'Hotel Management', 'BHMCT', [None], 4.0, None),
    ('ug', 'Hotel Management', 'B.Sc Culinary Arts', [None], 3.0, None),
    ('ug', 'Marine & Defence', 'B.Tech Naval Architecture', [None], 4.0, None),

    # --- PG ----------------------------------------------------------------
    ('pg', 'Arts & Humanities', 'MSW (Social Work)', [None], 2.0, None),
    ('pg', 'Arts & Humanities', 'M.Lib.I.Sc', [None], 1.0, None),
    ('pg', 'Arts & Humanities', 'MFA (Fine Arts)', [None], 2.0, None),
    ('pg', 'Arts & Humanities', 'M.Phil', [None], 2.0, None),
    ('pg', 'Mass Communication & Journalism', 'MJMC', [None], 2.0, None),
    ('pg', 'Education', 'M.P.Ed (Physical Education)', [None], 2.0, None),
    ('pg', 'Nursing & Allied Health', 'M.Sc Nursing', [
        'Medical Surgical Nursing', 'Community Health Nursing',
        'Child Health Nursing', 'Psychiatric Nursing',
        'Obstetrics & Gynaecological Nursing',
    ], 2.0, None),
    ('pg', 'Nursing & Allied Health', 'MOT (Occupational Therapy)', [None], 2.0, None),
    ('pg', 'Nursing & Allied Health', 'M.Optom', [None], 2.0, None),
    ('pg', 'Nursing & Allied Health', 'MASLP', [None], 2.0, None),
    ('pg', 'Medical', 'MPH (Public Health)', [None], 2.0, None),
    ('pg', 'Medical', 'DM (Super Speciality)', [
        'Cardiology', 'Neurology', 'Nephrology', 'Gastroenterology',
        'Endocrinology', 'Medical Oncology', 'Neonatology',
    ], 3.0, 'MD / MS'),
    ('pg', 'Medical', 'M.Ch (Super Speciality)', [
        'Cardiothoracic Surgery', 'Neurosurgery', 'Urology',
        'Plastic Surgery', 'Paediatric Surgery', 'Surgical Oncology',
    ], 3.0, 'MD / MS'),
    ('pg', 'Management', 'MHA (Hospital Administration)', [None], 2.0, None),
    ('pg', 'Management', 'MTTM (Tourism & Travel)', [None], 2.0, None),
    ('pg', 'Architecture', 'M.Plan', [None], 2.0, None),
    ('pg', 'Agriculture', 'M.Sc Horticulture', [None], 2.0, None),
    ('pg', 'Agriculture', 'M.Sc Forestry', [None], 2.0, None),
    ('pg', 'Veterinary', 'M.V.Sc', [None], 2.0, None),
    ('pg', 'Computer Applications', 'PGDCA', [None], 1.0, None),
    ('pg', 'Other', 'M.Voc', [None], 2.0, None),

    # --- Diploma ------------------------------------------------------------
    ('diploma', 'Pharmacy', 'D.Pharm', [None], 2.0, '12th with PCB / PCM'),
    ('diploma', 'Nursing & Allied Health', 'ANM', [None], 2.0, None),
    ('diploma', 'Nursing & Allied Health', 'Diploma in Medical Lab Technology', [None], 2.0, None),

    # --- Professional -------------------------------------------------------
    ('professional', 'Finance', 'FRM', ['Part 1', 'Part 2'], 2.0, None),
    ('professional', 'Finance', 'CIMA', [None], 3.0, None),
    ('professional', 'Finance', 'CFP', [None], 1.0, None),
    ('professional', 'Finance', 'Actuarial Science (IAI)', [None], 4.0, None),
]

# Rough course lengths, used when a degree already exists and we are only
# adding branches to it.
DEGREE_YEARS = {
    'B.Tech': 4.0, 'B.E.': 4.0, 'B.Sc': 3.0, 'BA': 3.0, 'B.Com': 3.0,
    'BBA': 3.0, 'BCA': 3.0, 'LLB': 3.0, 'B.Des': 4.0,
    'M.Tech': 2.0, 'M.E.': 2.0, 'M.Sc': 2.0, 'MA': 2.0, 'MBA': 2.0,
    'MD': 3.0, 'MS': 3.0, 'MDS': 3.0, 'LLM': 1.0, 'M.Pharmacy': 2.0,
    'M.Com': 2.0, 'MCA': 2.0, 'Diploma': 3.0, 'PhD': 4.0, 'CFA': 3.0,
}

# Extra words people actually type, so search finds the row.
ALIASES = {
    'B.Tech': 'btech b tech bachelor of technology',
    'B.E.': 'be b e bachelor of engineering',
    'B.Sc': 'bsc b sc bachelor of science',
    'BA': 'ba bachelor of arts',
    'B.Com': 'bcom b com bachelor of commerce',
    'BBA': 'bba bachelor of business administration',
    'BCA': 'bca bachelor of computer applications',
    'M.Tech': 'mtech m tech master of technology',
    'M.Sc': 'msc m sc master of science',
    'MBA': 'mba masters business administration pgdm',
    'MD': 'md doctor of medicine pg medical',
    'MS': 'ms master of surgery pg medical',
    'MDS': 'mds master of dental surgery',
    'Diploma': 'polytechnic diploma',
    'D.Pharm': 'd pharm dpharm diploma pharmacy',
    'D.Pharmacy': 'd pharmacy dpharm diploma pharmacy',
    'B.Voc': 'bvoc b voc bachelor of vocation vocational',
    'MSW (Social Work)': 'msw master of social work',
    'BSW (Social Work)': 'bsw bachelor of social work',
    'ANM': 'anm auxiliary nurse midwife nursing',
    'PhD': 'phd doctorate research doctoral',
}


def search_text(degree, branch, category):
    bits = [degree.lower()]
    if branch:
        bits.append(branch.lower())
    bits.append(category.lower())
    if degree in ALIASES:
        bits.append(ALIASES[degree])
    seen, out = set(), []
    for w in ' '.join(bits).replace('/', ' ').split():
        if w not in seen:
            seen.add(w)
            out.append(w)
    return ' '.join(out)[:400]


def main():
    with app.app_context():
        # Where each degree's numbering currently ends, so new branches follow
        # their siblings instead of landing at the top of the list.
        rows = db.session.execute(text(
            "SELECT level, degree, MAX(sort_order) AS mx, MAX(degree_category) AS cat "
            "FROM course_catalogue GROUP BY level, degree")).mappings().all()
        tail = {(r['level'], r['degree']): (r['mx'] or 0) for r in rows}
        cat_of = {(r['level'], r['degree']): r['cat'] for r in rows}

        base = db.session.execute(text(
            "SELECT IFNULL(MAX(sort_order), 0) FROM course_catalogue")).scalar() or 0
        base = ((base // 100) + 1) * 100      # new degrees start on a clean band

        planned = []

        for (level, degree), branches in MORE_BRANCHES.items():
            cat = cat_of.get((level, degree))
            if not cat:
                print(f"  skip {level}/{degree}: degree not in table")
                continue
            n = tail.get((level, degree), 0)
            for b in branches:
                n += 10
                planned.append((level, cat, degree, b,
                                DEGREE_YEARS.get(degree), None, n))

        for level, cat, degree, branches, yrs, elig in NEW_DEGREES:
            for b in branches:
                base += 10
                planned.append((level, cat, degree, b, yrs, elig, base))

        # Clear duplicates a previous run could have made. UNIQUE (level,
        # degree, branch) does not stop a second copy when branch IS NULL,
        # because NULL is never equal to NULL in an index.
        removed = db.session.execute(text(
            "DELETE c FROM course_catalogue c "
            "JOIN ( SELECT level, degree, MIN(id) AS keep_id "
            "         FROM course_catalogue WHERE branch IS NULL "
            "        GROUP BY level, degree HAVING COUNT(*) > 1 ) d "
            "  ON d.level = c.level AND d.degree = c.degree "
            " WHERE c.branch IS NULL AND c.id <> d.keep_id")).rowcount
        if removed:
            print(f"  removed {removed} duplicate no-branch row(s) from an earlier run")
        db.session.commit()

        added = skipped = 0
        for level, cat, degree, branch, yrs, elig, order in planned:
            # Explicit check, because INSERT IGNORE cannot see a NULL-branch clash.
            exists = db.session.execute(text(
                "SELECT 1 FROM course_catalogue "
                " WHERE level = :lv AND degree = :deg "
                "   AND ((branch IS NULL AND :br IS NULL) OR branch = :br) LIMIT 1"
            ), {'lv': level, 'deg': degree, 'br': branch}).first()
            if exists:
                skipped += 1
                continue
            disp = f"{degree} {DASH} {branch}" if branch else degree
            db.session.execute(text(
                "INSERT INTO course_catalogue "
                "(id, level, degree_category, degree, branch, display_name, search_text,"
                " duration_years, eligibility, sort_order, is_active) "
                "VALUES (UUID(), :lv, :cat, :deg, :br, :disp, :srch, :yrs, :elig, :ord, 1)"
            ), {'lv': level, 'cat': cat, 'deg': degree, 'br': branch, 'disp': disp,
                'srch': search_text(degree, branch, cat), 'yrs': yrs,
                'elig': elig, 'ord': order})
            added += 1
        db.session.commit()

        print(f"  planned {len(planned)} | added {added} | already there {skipped}")
        summary = db.session.execute(text(
            "SELECT level, COUNT(*) n, COUNT(DISTINCT degree) d, COUNT(DISTINCT branch) b "
            "FROM course_catalogue GROUP BY level ORDER BY n DESC")).mappings().all()
        for r in summary:
            print(f"    {r['level']:<14} rows={r['n']:<5} degrees={r['d']:<4} branches={r['b']}")
        tot = db.session.execute(text(
            "SELECT COUNT(*) n, COUNT(DISTINCT degree) d, COUNT(DISTINCT branch) b "
            "FROM course_catalogue")).mappings().first()
        print(f"  TOTAL rows={tot['n']} degrees={tot['d']} branches={tot['b']}")
        print("Done.")


if __name__ == '__main__':
    main()
