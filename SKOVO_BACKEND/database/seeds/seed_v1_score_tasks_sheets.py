"""Score Engine > Tasks from SKOVO-readiness-streak-tasks-v1.xlsx (the 20 stage sheets).

Every row becomes a DRAFT task: admins see it under Score Engine > Tasks, students
never do until it is switched to Active. Points are the sheet's suggestion (a
non-number such as "2 / 3 / 5" -> 0, to be set by hand).

Targeting (migrate_v1_score_task_state + migrate_v1_score_task_targets):
    batch            education category, plus the degree when the sheet is one
                     degree (B.Tech, B.Sc, B.Com, BA) -- course_catalogue labels,
                     which is what onboarding stores on the profile
    state            AP / TS rows -> master_indian_state value; "Both" -> open
    target_degrees   course_catalogue.degree labels, for rows that name several
                     courses ("B.Pharm / Pharm.D / D.Pharm")
    target_branches  course_catalogue.branch labels ("CSE / IT" -> Computer
                     Science (CSE), Information Technology, ...)
    target_streams   streams.canonical, for the Inter sheets (MPC -> science_pcm)
The course catalogue (Admin > Course Catalogue) is the branch master.

Inter rows are created in the Class 11 batch and linked (same_as) into Class 12,
so a student who finishes one in 11th is not paid again in 12th.

Ids come from sheet + row id, so a re-run updates the same tasks and batches.
From SKOVO_BACKEND:
    python database/seeds/seed_v1_score_tasks_sheets.py
"""
import os
import sys
import uuid

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..')))

import openpyxl  # noqa: E402
from sqlalchemy import text  # noqa: E402

from portal import InitApp  # noqa: E402
from portal.models import db  # noqa: E402
from portal.helpers.sp import call_proc_one  # noqa: E402

app = InitApp().app()

XLSX = os.path.join(os.path.dirname(__file__), '..', '..', '..', 'SKOVO-readiness-streak-tasks-v1.xlsx')
NS = uuid.UUID('5c0e7a2e-0000-4000-8000-000000000001')
STATES = {'AP': 'Andhra Pradesh', 'TS': 'Telangana'}

# (education_category, degree) -> batch name. Degree is a course_catalogue label.
BATCHES = {
    ('school_10th', None): None,          # existing "In 10th Class – Any degree"
    ('school_11th', None): 'Inter 1st year (Class 11)',
    ('school_12th', None): 'Inter 2nd year (Class 12)',
    ('dropper', None): 'Droppers (EAPCET / NEET / JEE repeaters)',
    ('polytechnic', None): 'Polytechnic (Diploma)',
    ('iti', None): 'ITI',
    ('ug', 'B.Tech'): 'UG — B.Tech',
    ('ug', 'B.Sc'): 'UG — B.Sc',
    ('ug', 'B.Com'): 'UG — B.Com',
    ('ug', 'BA'): 'UG — B.A',
    ('ug', None): 'UG — Any course',
    ('professional_course', None): 'Professional courses (CA / CS / CMA)',
}
# The first load keyed batches on master_degree_type values, which profiles do
# not store. Those batches are moved to the catalogue label, or emptied.
OLD_DEGREES = {'btech': 'B.Tech', 'bsc': 'B.Sc', 'bcom': 'B.Com', 'ba': 'BA',
               'bpharma': None, 'llb': None, 'mbbs': None}

# ── branch phrases -> course_catalogue labels ─────────────────────────────────
BTECH = {
    'CSE': ['Computer Science (CSE)', 'Computer Science & Business Systems', 'Cyber Security', 'Internet of Things (IoT)'],
    'IT': ['Information Technology'],
    'AIML': ['AI & Machine Learning'], 'DS': ['Data Science'],
    'ECE': ['Electronics & Communication (ECE)', 'Electronics & Instrumentation', 'Instrumentation & Control'],
    'EEE': ['Electrical & Electronics (EEE)'],
    'Mech': ['Mechanical', 'Mechatronics', 'Production & Industrial', 'Robotics & Automation'],
    'Auto': ['Automobile'],
    'Civil': ['Civil', 'Environmental Engineering'],
    'Chem': ['Chemical', 'Petroleum Engineering', 'Plastics & Polymer Engineering'],
    'Biotech': ['Biotechnology', 'Genetic Engineering'],
    'Aero': ['Aerospace'],
}
BTECH['All core'] = BTECH['ECE'] + BTECH['EEE'] + BTECH['Mech'] + BTECH['Civil'] + BTECH['Chem']
DIPLOMA = {
    'CSE': ['Computer Science', 'Computer Engineering'], 'IT': ['Information Technology'],
    'ECE': ['Electronics & Communication', 'Electronics & Instrumentation'],
    'EEE': ['Electrical', 'Electrical & Electronics'],
    'Mech': ['Mechanical', 'Mechatronics', 'Production Engineering'], 'Auto': ['Automobile'],
    'Civil': ['Civil', 'Civil & Rural Engineering'],
}
ITI = {
    'COPA': ['COPA', 'Office Assistant cum Computer Operator'],
    'Draughtsman (Civil / Mech)': ['Draughtsman (Civil)', 'Draughtsman (Mechanical)', 'Architectural Draughtsman'],
    'Electrician': ['Electrician', 'Electrician (Power Distribution)', 'Wireman', 'Lineman'],
    'Electronics Mechanic': ['Electronics Mechanic', 'Mechanic Consumer Electronics', 'Mechanic Industrial Electronics'],
    'Fitter': ['Fitter', 'Marine Fitter', 'Fabrication (Fitting & Welding)'],
    'Mechanic Diesel': ['Mechanic (Diesel)', 'Driver cum Mechanic'],
    'Plumber': ['Plumber'],
    'Turner': ['Turner', 'Machinist', 'Machinist (Grinder)'],
    'Welder': ['Welder', 'Welder (Gas & Electric)', 'Welder (Structural)', 'Advanced Welding (Probe)'],
}
STREAMS = {
    'Inter MPC': ['science_pcm', 'science_pcmb'],
    'Inter BiPC': ['science_pcb', 'science_pcmb'],
    'Inter MEC-CEC': ['commerce_maths', 'commerce'],
    'Inter HEC': ['arts'],
    'Inter Vocational': ['vocational'],
}
MEDICAL = {'MBBS': ['MBBS'], 'BDS': ['BDS'],
           'AYUSH': ['BAMS', 'BHMS', 'BUMS', 'BSMS', 'BNYS (Naturopathy & Yoga)']}
DEGREE_ALL = ['B.Sc', 'BA', 'B.Com', 'BBA', 'BCA']


def split(b):
    return [x.strip() for x in b.replace('(', '/').replace(')', '').split('/') if x.strip()]


def pick(table, b):
    out = []
    for k in split(b):
        out += table.get(k, [])
    return out


def target(sheet, branch):
    """-> ((education_category, batch degree), degrees, branches, streams)"""
    b = (branch or '').strip()
    open_ = b in ('', 'All')
    if sheet == 'Class 10':
        return ('school_10th', None), [], [], []
    if sheet.startswith('Inter'):
        return ('school_11th', None), [], [], STREAMS[sheet]
    if sheet == 'Droppers':
        return ('dropper', None), [], [], []
    if sheet == 'Polytechnic':
        return ('polytechnic', None), [], ([] if open_ else pick(DIPLOMA, b)), []
    if sheet == 'ITI':
        return ('iti', None), [], ([] if open_ else ITI.get(b, [])), []
    if sheet == 'B.Tech':
        if open_:
            return ('ug', 'B.Tech'), [], [], []
        if b == 'All core':
            return ('ug', 'B.Tech'), [], BTECH['All core'], []
        return ('ug', 'B.Tech'), [], pick(BTECH, b), []
    if sheet == 'Degree':
        if b.startswith('B.Com'):
            br = {'B.Com Computers': ['Computer Applications'], 'B.Com General': ['General']}.get(b, [])
            return ('ug', 'B.Com'), [], br, []
        if b.startswith('B.Sc') and '/ B.A' not in b:
            br = {'B.Sc BZC': ['Botany', 'Zoology', 'Chemistry', 'Biology'],
                  'B.Sc Computers / DS': ['Computer Science', 'Statistics'],
                  'B.Sc MPCs / MSCs / MECs': ['Mathematics', 'Physics', 'Chemistry', 'Computer Science',
                                              'Statistics', 'Electronics'],
                  'B.Sc Maths / Physics': ['Mathematics', 'Physics']}.get(b, [])
            return ('ug', 'B.Sc'), [], br, []
        if b == 'B.A (HEP / HPP / Economics)':
            return ('ug', 'BA'), [], ['History', 'Economics', 'Political Science', 'Public Administration'], []
        if b == 'B.A Psychology':
            return ('ug', 'BA'), [], ['Psychology'], []
        deg = {'B.A Journalism': ['BA Journalism', 'BJMC', 'BMM'], 'BBA': ['BBA', 'BBM', 'BMS'],
               'BCA': ['BCA'], 'BSW': ['BSW (Social Work)'], 'B.Sc / B.A / B.Com': ['B.Sc', 'BA', 'B.Com']}
        return ('ug', None), deg.get(b, DEGREE_ALL), [], []
    if sheet == 'Medical & AYUSH':
        if b == 'All medical':
            return ('ug', None), MEDICAL['MBBS'] + MEDICAL['BDS'] + MEDICAL['AYUSH'], [], []
        if b.startswith('BAMS'):
            return ('ug', None), MEDICAL['AYUSH'], [], []
        return ('ug', None), MEDICAL.get(b, []), [], []
    if sheet == 'Nursing':
        if b == 'All nursing':
            return ('ug', None), ['B.Sc Nursing', 'GNM', 'ANM'], [], []
        return ('ug', None), [{'B.Sc Nursing': 'B.Sc Nursing'}.get(x, x) for x in split(b)], [], []
    if sheet == 'Pharmacy':
        names = {'B.Pharm': 'B.Pharmacy', 'Pharm.D': 'Pharm.D', 'D.Pharm': 'D.Pharm'}
        if b == 'All pharmacy':
            return ('ug', None), list(names.values()), [], []
        return ('ug', None), [names[x] for x in split(b) if x in names], [], []
    if sheet == 'Allied Health':
        if b == 'All allied health':
            return ('ug', None), ['B.Sc Allied Health', 'B.Sc MLT', 'BPT (Physiotherapy)', 'B.Optom (Optometry)',
                                  'BOT (Occupational Therapy)', 'BASLP (Audiology & Speech)'], [], []
        if b == 'Radiology / Imaging':
            return ('ug', None), ['B.Sc Allied Health'], ['Radiology & Imaging'], []
        if b.startswith('Anaesthesia'):
            return ('ug', None), ['B.Sc Allied Health'], ['Anaesthesia Technology', 'Operation Theatre Technology',
                                                          'Cardiac Care Technology', 'Dialysis Technology'], []
        deg = {'B.Sc MLT': ['B.Sc MLT'], 'BPT (Physiotherapy)': ['BPT (Physiotherapy)'],
               'Optometry': ['B.Optom (Optometry)']}
        return ('ug', None), deg.get(b, []), [], []
    if sheet == 'Agri & Vet':
        deg = {'B.Sc Agriculture': ['B.Sc Agriculture'],
               'B.Sc Horticulture / Forestry': ['B.Sc Horticulture', 'B.Sc Forestry'],
               'B.F.Sc (Fisheries)': ['B.F.Sc (Fisheries)'],
               'B.Sc Food Science': ['B.Tech Food Technology', 'B.Tech Dairy Technology'],
               'B.V.Sc': ['B.V.Sc & AH'], 'B.V.Sc (Veterinary)': ['B.V.Sc & AH'],
               'Agri / Horti': ['B.Sc Agriculture', 'B.Sc Horticulture'],
               'Agri / Horti / Fisheries': ['B.Sc Agriculture', 'B.Sc Horticulture', 'B.F.Sc (Fisheries)']}
        return ('ug', None), deg.get(b, []), [], []
    if sheet == 'Arch & Design':
        deg = {'B.Arch': ['B.Arch', 'B.Planning'], 'B.Des / Fashion': ['B.Des'],
               'Hotel Management': ['BHM', 'BHMCT', 'B.Sc Culinary Arts']}
        return ('ug', None), deg.get(b, []), [], []
    if sheet == 'Law':
        return ('ug', None), ['LLB', 'BA LLB', 'BBA LLB', 'B.Com LLB', 'B.Sc LLB'], [], []
    if sheet == 'CA-CS-CMA':
        return ('professional_course', None), [x for x in split(b) if x in ('CA', 'CS', 'CMA')], [], []
    return ('ug', None), [], [], []


def points(v):
    try:
        return round(float(v), 2)
    except (TypeError, ValueError):
        return 0


def label(sheet, branch, task):
    b = (branch or '').strip()
    tag = sheet if b in ('', 'All') else f"{sheet} · {b}"
    return f"[{tag}] {str(task or '').strip()}"[:160]


def read_rows():
    wb = openpyxl.load_workbook(XLSX, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        if ws.title in ('Read me', 'Summary', 'Common', 'Streak rules'):
            continue
        rows = list(ws.iter_rows(values_only=True))
        hdr = [str(h).strip() if h else '' for h in rows[0]]
        for r in rows[1:]:
            d = {hdr[i]: r[i] for i in range(len(hdr)) if hdr[i]}
            if d.get('ID') and d.get('Task (what the student does)'):
                d['_sheet'] = ws.title
                out.append(d)
    return out


def main():
    with app.app_context():
        admin = db.session.execute(text(
            "SELECT id FROM admins WHERE status = 'active' ORDER BY created_at LIMIT 1")).scalar()

        batch_ids = {}
        for (edu, deg), name in BATCHES.items():
            bid = db.session.execute(text(
                "SELECT id FROM score_task_batches WHERE match_key = :k"),
                {'k': f"{edu or '~'}|{deg or '~'}"}).scalar()
            if not bid:
                bid = str(uuid.uuid5(NS, f"batch|{edu}|{deg}"))
                call_proc_one('sp_score_batch_upsert', bid, name, edu, deg, 1, admin)
                print(f"  [ok] batch {name}")
            batch_ids[(edu, deg)] = bid
        db.session.commit()

        made, unmatched = 0, []
        for d in read_rows():
            sheet, branch = d['_sheet'], d.get('Branch / Course')
            key, degrees, branches, streams = target(sheet, branch)
            narrow = sheet not in ('Class 10', 'Droppers') and not sheet.startswith('Inter') \
                and str(branch or '').strip() not in ('', 'All')
            if narrow and not (degrees or branches):
                unmatched.append(f"{sheet} / {branch}")
            tid = str(uuid.uuid5(NS, f"task|{sheet}|{d['ID']}"))
            name = label(sheet, branch, d.get('Task (what the student does)'))
            pts = points(d.get('Suggested readiness pts'))
            args = (STATES.get(str(d.get('State') or '').strip()),
                    ','.join(dict.fromkeys(degrees)), ','.join(dict.fromkeys(branches)), ','.join(streams))
            call_proc_one('sp_score_batch_task_upsert', tid, batch_ids[key], name, pts, None, 'draft', None, admin)
            call_proc_one('sp_score_task_set_targets', tid, *args)
            made += 1
            if key == ('school_11th', None):          # same task carries into Class 12
                tid12 = str(uuid.uuid5(NS, f"task12|{sheet}|{d['ID']}"))
                call_proc_one('sp_score_batch_task_upsert', tid12, batch_ids[('school_12th', None)],
                              name, pts, tid, 'draft', None, admin)
                call_proc_one('sp_score_task_set_targets', tid12, *args)
        db.session.commit()

        # The first load's batches used master_degree_type values; their tasks
        # have moved to the catalogue-label batches, so drop the empty ones.
        # match_key compares case-insensitively ('ug|ba' = 'ug|BA'), so the
        # lookup is binary to leave a batch that is also the new one alone.
        for old in OLD_DEGREES:
            if old != 'ba':
                bid = db.session.execute(text(
                    "SELECT id FROM score_task_batches WHERE match_key COLLATE utf8mb4_bin = :k"),
                    {'k': f"ug|{old}"}).scalar()
                if bid:
                    res = call_proc_one('sp_score_batch_delete', bid) or {}
                    print(f"  [ok] old batch ug|{old}: {res.get('result')}")
        db.session.commit()
        print(f"Done: {made} sheet rows as DRAFT tasks.")
        if unmatched:
            print("  No catalogue match (task open to the whole batch):", sorted(set(unmatched)))


if __name__ == '__main__':
    main()
