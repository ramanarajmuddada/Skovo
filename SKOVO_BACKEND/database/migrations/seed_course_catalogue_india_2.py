"""All-India coverage, pass 2: ITI trades, integrated degrees, missing branch sets.

WHY A SECOND PASS
    Pass 1 (seed_course_catalogue_india.py) took the table from 265 rows to 562
    and closed the degree-level gaps -- D.Pharm, B.Voc, allied health, MD/MS/MDS
    specialities, the polytechnic branch list, B.E. drawn level with B.Tech.

    Three gaps survived it:

      ITI            ~34 live trades against the ~130 NCVT actually certifies.
                     This is the single biggest hole in the table, and it is the
                     one that matters most: an ITI student whose trade is missing
                     has nothing to pick but "Other", and "Other" cannot be
                     targeted, counted, or scored against.

      Integrated     India runs five-year integrated programmes at scale --
                     B.Tech+M.Tech, BS-MS, IPM, ITEP, integrated M.Sc and LLM --
                     and the table had none of them at any level.

      Branch sets    Several degrees were present but undivided when they are
                     not taught that way: M.Sc Agriculture, M.V.Sc, M.Arch, MSW,
                     M.Ed, B.Ed, B.Sc Nursing, GNM.

    The legacy `degree = 'ITI'` group (16 rows, all is_active = 0) is left alone.
    It is superseded by the per-group trades, and switching it back on would show
    every trade twice.

Same rules as pass 1: adds only, never edits, explicit existence check because
UNIQUE (level, degree, branch) does not constrain a NULL branch.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/seed_course_catalogue_india_2.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

DASH = '—'

# ── ITI: the NCVT trade list, by the groups the table already uses ──────────
# level 'iti', degree = group, branch = trade.
ITI_ENGINEERING = {
    'Mechanical': [
        'Welder (Gas & Electric)', 'Welder (Structural)', 'Fabrication (Fitting & Welding)',
        'Machinist (Grinder)', 'Mechanic Machine Tool Maintenance',
        'Pump Operator cum Mechanic', 'Marine Fitter', 'Mechanic Agricultural Machinery',
        'Advanced Machine Tool Operation', 'Mechanic Mechatronics',
        'Forger & Heat Treater', 'Pattern Maker', 'Moulder',
    ],
    'Automobile': [
        'Mechanic Auto Body Repair', 'Mechanic Auto Body Painting',
        'Mechanic Two & Three Wheeler', 'Mechanic Auto Electrical & Electronics',
        'Mechanic Agricultural Machinery', 'Driver cum Mechanic',
    ],
    'Electrical': [
        'Lineman', 'Electroplater', 'Mechanic Electric Vehicle',
        'Solar Technician (Electrical)', 'Winder (Armature)',
    ],
    'Electronics': [
        'Mechanic Consumer Electronics', 'Mechanic Industrial Electronics',
        'Technician Power Electronics Systems', 'Mechanic Medical Electronics',
        'Technician Mechatronics',
    ],
    'Civil & Construction': [
        'Mason (Building Constructor)', 'Surveyor', 'Building Maintenance',
        'Marble Mosaic & Tile Layer', 'Bar Bender & Steel Fixer',
    ],
    'Drafting & Design': ['Architectural Draughtsman'],
    'Refrigeration & Air Conditioning': [
        'Technician Refrigeration & Air Conditioning',
    ],
    'Information Technology': [
        'Information Technology & Electronics System Maintenance',
        'Computer Hardware & Network Maintenance', 'Network Technician',
    ],
    'Chemical & Process': [
        'Attendant Operator (Chemical Plant)', 'Laboratory Assistant (Chemical Plant)',
        'Instrument Mechanic (Chemical Plant)',
    ],
}

ITI_NON_ENGINEERING = {
    'Computer & Office': [
        'Stenographer & Secretarial Assistant (Hindi)', 'Data Entry Operator',
        'Secretarial Practice', 'Office Assistant cum Computer Operator',
    ],
    'Hospitality & Food': [
        'Food & Beverage Service Assistant', 'Housekeeper',
        'Catering & Hospitality Assistant', 'Craftsman Food Production (Vegetarian)',
    ],
    'Fashion & Apparel': [
        'Surface Ornamentation Techniques (Embroidery)', 'Dress Making',
        'Textile Wet Processing Technician',
    ],
    'Beauty & Wellness': ['Hair & Skin Care', 'Spa Therapy'],
    'Creative & Design': [
        'Multimedia Animation & Special Effects', 'Graphic Designer',
        'Litho Offset Machine Minder', 'Desktop Publishing Operator (Advanced)',
    ],
    'Safety & Health': [
        'Health Safety & Environment', 'Physiotherapy Technician',
        'Dental Laboratory Equipment Technician', 'Old Age Care Assistant',
    ],
    'Agriculture': ['Horticulture', 'Agro Processing', 'Gardener', 'Floriculture'],
    'Business & Services': [
        'Insurance Agent', 'Marketing Executive', 'Human Resource Executive',
        'Library & Information Science', 'Preparatory School Management Assistant',
    ],
}

# ── Extra branches for degrees already present but taught with streams ──────
MORE_BRANCHES = {
    ('pg', 'M.Sc Agriculture'): [
        'Agronomy', 'Horticulture', 'Soil Science', 'Plant Pathology',
        'Entomology', 'Genetics & Plant Breeding', 'Agricultural Economics',
        'Agricultural Extension', 'Seed Science & Technology',
    ],
    ('pg', 'M.V.Sc'): [
        'Veterinary Medicine', 'Veterinary Surgery', 'Veterinary Pathology',
        'Veterinary Microbiology', 'Animal Nutrition', 'Animal Genetics & Breeding',
    ],
    ('pg', 'M.Arch'): [
        'Urban Design', 'Landscape Architecture', 'Architectural Conservation',
        'Urban & Regional Planning',
    ],
    ('pg', 'MSW (Social Work)'): [
        'Medical & Psychiatric Social Work', 'Community Development',
        'Human Resource Management', 'Family & Child Welfare',
        'Criminology & Correctional Administration',
    ],
    ('pg', 'M.Ed'): ['Special Education', 'Educational Technology', 'Guidance & Counselling'],
    ('ug', 'B.Ed'): ['Special Education', 'Science', 'Mathematics', 'Social Science', 'Languages'],
    ('ug', 'B.Sc Nursing'): ['General', 'Post Basic'],
    ('ug', 'B.Arch'): ['General', 'Interior Architecture'],
    ('ug', 'BHM'): ['Hotel Management', 'Culinary Arts', 'Hospitality & Tourism'],
    ('ug', 'BFA (Fine Arts)'): [
        'Painting', 'Sculpture', 'Applied Arts', 'Printmaking', 'Photography',
    ],
    ('ug', 'B.Pharmacy'): ['General', 'Pharmaceutical Technology'],
    ('phd', 'PhD'): [
        'Veterinary Science', 'Design', 'Hotel Management', 'Economics',
        'Mass Communication', 'Physical Education', 'Agriculture Engineering',
    ],
    ('professional', 'CPA'): ['US CPA'],
}

# ── Degrees still absent: integrated programmes and a few singles ───────────
NEW_DEGREES = [
    # Five-year integrated programmes, widely run by IITs, IISERs, NITs, IIMs, NLUs
    ('ug', 'Engineering', 'B.Tech + M.Tech (Integrated)', [
        'Computer Science (CSE)', 'Electronics & Communication (ECE)',
        'Mechanical', 'Civil', 'Electrical', 'Chemical', 'Other',
    ], 5.0, '12th with PCM'),
    ('ug', 'Science', 'BS-MS (Integrated)', [
        'Physics', 'Chemistry', 'Mathematics', 'Biology', 'Earth Sciences', 'Other',
    ], 5.0, '12th with Science'),
    ('ug', 'Science', 'M.Sc (Integrated)', [
        'Physics', 'Chemistry', 'Mathematics', 'Computer Science',
        'Biotechnology', 'Other',
    ], 5.0, '12th with Science'),
    ('ug', 'Management', 'IPM (Integrated BBA + MBA)', [None], 5.0, '12th any stream'),
    ('ug', 'Education', 'ITEP (Integrated B.Ed)', [None], 4.0, '12th any stream'),
    ('ug', 'Arts & Humanities', 'MA (Integrated)', [
        'Economics', 'English', 'Psychology', 'Development Studies', 'Other',
    ], 5.0, None),

    # Remaining singles
    ('ug', 'Science', 'B.Stat', [None], 3.0, '12th with Mathematics'),
    ('ug', 'Science', 'B.Math', [None], 3.0, '12th with Mathematics'),
    ('ug', 'Medical', 'B.Sc Yoga & Naturopathy', [None], 3.0, None),
    ('ug', 'Nursing & Allied Health', 'B.Sc Physician Assistant', [None], 3.0, None),
    ('ug', 'Law', 'B.Sc LLB', [None], 5.0, '12th with Science'),
    ('ug', 'Agriculture', 'B.Sc Sericulture', [None], 4.0, None),
    ('ug', 'Agriculture', 'B.Tech Biotechnology (Agri)', [None], 4.0, None),
    ('pg', 'Science', 'M.Sc Data Analytics', [None], 2.0, None),
    ('pg', 'Law', 'LLM (Integrated)', [None], 1.0, 'LLB'),
    ('pg', 'Computer Applications', 'MCA (Lateral)', [None], 2.0, 'BCA / B.Sc IT'),

    # Diploma additions
    ('diploma', 'Polytechnic', 'Diploma (Lateral Entry)', [
        'Civil', 'Mechanical', 'Electrical', 'Computer Science',
        'Electronics & Communication', 'Other',
    ], 2.0, 'ITI / 12th'),
    ('diploma', 'Nursing & Allied Health', 'Diploma in Operation Theatre Technology', [None], 2.0, None),
    ('diploma', 'Nursing & Allied Health', 'Diploma in Radiology Technology', [None], 2.0, None),
    ('diploma', 'Other', 'Diploma in Digital Marketing', [None], 1.0, None),
    ('diploma', 'Other', 'Diploma in Animation & VFX', [None], 1.0, None),
    ('diploma', 'Other', 'Diploma in Yoga', [None], 1.0, None),
    ('diploma', 'Mass Communication & Journalism', 'Diploma in Journalism', [None], 1.0, None),
]

DEGREE_YEARS = {
    'M.Sc Agriculture': 2.0, 'M.V.Sc': 2.0, 'M.Arch': 2.0,
    'MSW (Social Work)': 2.0, 'M.Ed': 2.0, 'B.Ed': 2.0,
    'B.Sc Nursing': 4.0, 'B.Arch': 5.0, 'BHM': 4.0,
    'BFA (Fine Arts)': 4.0, 'B.Pharmacy': 4.0, 'PhD': 4.0, 'CPA': 1.0,
}

ALIASES = {
    'B.Tech + M.Tech (Integrated)': 'dual degree integrated btech mtech five year',
    'BS-MS (Integrated)': 'bs ms iiser integrated five year dual',
    'M.Sc (Integrated)': 'integrated msc five year',
    'IPM (Integrated BBA + MBA)': 'ipm iim indore rohtak integrated management five year',
    'ITEP (Integrated B.Ed)': 'itep integrated teacher education four year bed',
    'MA (Integrated)': 'integrated ma five year',
    'Diploma (Lateral Entry)': 'lateral entry polytechnic diploma second year',
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
        rows = db.session.execute(text(
            "SELECT level, degree, MAX(sort_order) AS mx, MAX(degree_category) AS cat "
            "FROM course_catalogue GROUP BY level, degree")).mappings().all()
        tail = {(r['level'], r['degree']): (r['mx'] or 0) for r in rows}
        cat_of = {(r['level'], r['degree']): r['cat'] for r in rows}

        base = db.session.execute(text(
            "SELECT IFNULL(MAX(sort_order), 0) FROM course_catalogue")).scalar() or 0
        base = ((base // 100) + 1) * 100

        planned = []

        # ITI trades. A group that does not exist yet is created here.
        for cat, groups in (('Engineering', ITI_ENGINEERING),
                            ('Non-Engineering', ITI_NON_ENGINEERING)):
            for group, trades in groups.items():
                n = tail.get(('iti', group))
                if n is None:
                    base += 10
                    n = base
                for t in trades:
                    n += 1
                    planned.append(('iti', cat_of.get(('iti', group), cat), group, t,
                                    2.0, '10th pass', n))

        for (level, degree), branches in MORE_BRANCHES.items():
            cat = cat_of.get((level, degree))
            if not cat:
                print(f"  skip {level}/{degree}: degree not in table")
                continue
            n = tail.get((level, degree), 0)
            for b in branches:
                n += 10
                planned.append((level, cat, degree, b, DEGREE_YEARS.get(degree), None, n))

        for level, cat, degree, branches, yrs, elig in NEW_DEGREES:
            for b in branches:
                base += 10
                planned.append((level, cat, degree, b, yrs, elig, base))

        added = skipped = 0
        for level, cat, degree, branch, yrs, elig, order in planned:
            exists = db.session.execute(text(
                "SELECT 1 FROM course_catalogue "
                " WHERE level = :lv AND degree = :deg "
                "   AND ((branch IS NULL AND :br IS NULL) OR branch = :br) LIMIT 1"
            ), {'lv': level, 'deg': degree, 'br': branch}).first()
            if exists:
                skipped += 1
                continue
            disp = (f"ITI {DASH} {branch}" if level == 'iti'
                    else (f"{degree} {DASH} {branch}" if branch else degree))
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
        for r in db.session.execute(text(
            "SELECT level, COUNT(*) n, COUNT(DISTINCT degree) d, COUNT(DISTINCT branch) b "
            "FROM course_catalogue GROUP BY level ORDER BY n DESC")).mappings().all():
            print(f"    {r['level']:<14} rows={r['n']:<5} degrees={r['d']:<4} branches={r['b']}")
        tot = db.session.execute(text(
            "SELECT COUNT(*) n, COUNT(DISTINCT degree) d, COUNT(DISTINCT branch) b "
            "FROM course_catalogue")).mappings().first()
        print(f"  TOTAL rows={tot['n']} degrees={tot['d']} branches={tot['b']}")
        dup = db.session.execute(text(
            "SELECT COUNT(*) FROM (SELECT level, degree, IFNULL(branch,'~') b "
            "FROM course_catalogue GROUP BY level, degree, IFNULL(branch,'~') "
            "HAVING COUNT(*) > 1) t")).scalar()
        print(f"  duplicate rows: {dup}")
        print("Done.")


if __name__ == '__main__':
    main()
