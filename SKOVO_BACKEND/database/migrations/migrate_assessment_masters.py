"""
Migration: the Readiness Assessment stops being a college-student quiz.

Two problems, one cause.

1. `SKILLS` (35) and `CAREER_GOALS` (10) were hardcoded arrays in
   ReadinessAssessment.jsx, with a duplicate copy in the mobile app.

2. Worse: the assessment had zero stage awareness. A 10th-class student was
   shown Django, Figma, Financial Modeling and Tally, and asked to choose
   between "Investment Banking" and "UI/UX Designer".

That second one is not cosmetic. The assessment is worth 65 of the ~100 points
and Opportunities unlocks at 60, so a school student answering honestly — no
internship, no projects, none of those skills — could never reach the gate
except by attending eight cohorts. The score is meant to measure readiness; for
a school student it measured "are you already in college".

Everything is now master data, namespaced by stage bucket:

    skill_<bucket>            what they can claim
    career_goal_<bucket>      what they can aim at
    assessment_step2_<bucket> the experience questions
    assessment_step4_<bucket> the engagement questions

Step 2 and step 4 rows encode the input type in the value: `bool:field_name`
renders a Yes/No, `count:field_name` renders a counter. The label is the
question. That keeps the step structure fixed (the backend scores on field
names) while the wording adapts to who is answering.

Buckets: school · vocational · college · working. Every education_category maps
to one of the four.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_assessment_masters.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

SKILLS = {
    'school': [
        'Maths', 'Science practicals', 'English speaking', 'Hindi / regional language',
        'Computer basics', 'MS Word', 'MS Excel', 'PowerPoint', 'Internet research',
        'Drawing & art', 'Music', 'Sports', 'Debating', 'Essay writing', 'Quizzing',
        'Olympiad preparation', 'Coding basics (Scratch / Python)', 'Robotics kit',
        'Photography', 'Video making', 'Leadership in class', 'Teamwork',
        'Time management', 'Public speaking', 'Handling money / budgeting',
    ],
    'vocational': [
        'Electrical wiring', 'Welding', 'Fitting', 'Turning', 'Machining', 'Plumbing',
        'Carpentry', 'Painting', 'Motor mechanics', 'Diesel mechanics',
        'Refrigeration & AC', 'AutoCAD', 'Draughtsmanship', 'Computer operating (COPA)',
        'Measurement & tools', 'Blueprint reading', 'Workshop safety',
        'MS Office', 'Basic accounting', 'Customer handling', 'Teamwork',
        'Time management', 'Communication',
    ],
    'college': [
        'Python', 'JavaScript', 'Java', 'C++', 'SQL', 'React', 'Node.js', 'Git', 'Linux',
        'Data Analysis', 'Machine Learning', 'Web Development', 'Android Dev',
        'UI/UX Design', 'Figma', 'Canva', 'Photoshop', 'Video Editing',
        'Excel', 'PowerPoint', 'MS Office', 'Tally', 'Accounting', 'Financial Modeling',
        'Digital Marketing', 'Content Writing', 'Research', 'Public Speaking',
        'Communication', 'Leadership', 'Teamwork', 'Problem Solving', 'Time Management',
    ],
    'working': [
        'Team leadership', 'Project management', 'Client handling', 'Stakeholder comms',
        'Budgeting', 'Hiring & interviewing', 'Mentoring juniors', 'Process improvement',
        'Data Analysis', 'Excel / Sheets', 'SQL', 'Python', 'Presentation skills',
        'Negotiation', 'Vendor management', 'Reporting', 'Domain expertise',
        'Public Speaking', 'Problem Solving', 'Time Management',
    ],
}

CAREER_GOALS = {
    'school': [
        'Engineering (JEE / state CET)', 'Medicine (NEET)', 'Defence (NDA)',
        'Chartered Accountancy', 'Law', 'Design / Architecture',
        'Commerce & business', 'Teaching', 'Sports', 'Arts & media',
        'Government job', 'Not decided yet', 'Other',
    ],
    'vocational': [
        'Government technical job (Railways / PSU)', 'Private technical job',
        'Supervisor / foreman role', 'Own workshop or business',
        'Lateral entry into engineering', 'Work abroad', 'Apprenticeship',
        'Not decided yet', 'Other',
    ],
    'college': [
        'Software Engineer at a product company', 'Data Scientist / AI-ML Engineer',
        'Business Analyst / Consultant', 'UI/UX Designer', 'Digital Marketer',
        'Finance / Investment Banking', 'Chartered Accountancy',
        'Entrepreneur / Startup Founder', 'Government / UPSC', 'Higher studies (MS / MBA)',
        'Research / PhD', 'Content Creator / Writer', 'Not decided yet', 'Other',
    ],
    'working': [
        'Senior / lead role', 'Switch to a product company', 'Move into management',
        'Change domain', 'Higher studies (MBA / MS)', 'Government job',
        'Start my own business', 'Freelance / consulting', 'Work abroad', 'Other',
    ],
}

# value encodes the input type; label is the question the student reads.
STEP2 = {
    'school': [
        ('bool:has_internship',  'Taken part in an olympiad or competition?'),
        ('count:projects_count', 'School or science-fair projects done'),
    ],
    'vocational': [
        ('bool:has_internship',  'Done an apprenticeship or on-the-job training?'),
        ('count:projects_count', 'Workshop or practical projects completed'),
    ],
    'college': [
        ('bool:has_internship',  'Done an internship?'),
        ('count:projects_count', 'Projects built'),
    ],
    'working': [
        ('bool:has_internship',  'Led a project end to end?'),
        ('count:projects_count', 'Projects shipped'),
    ],
}

STEP4 = {
    'school': [
        ('bool:in_groups',        'Part of a school club or activity group?'),
        ('count:cohorts_attended', 'Skovo cohorts attended'),
    ],
    'vocational': [
        ('bool:in_groups',        'Active in a trade or student group?'),
        ('count:cohorts_attended', 'Skovo cohorts attended'),
    ],
    'college': [
        ('bool:in_groups',        'Active in student groups or clubs?'),
        ('count:cohorts_attended', 'Skovo cohorts attended'),
    ],
    'working': [
        ('bool:in_groups',        'Active in a professional community?'),
        ('count:cohorts_attended', 'Skovo cohorts attended'),
    ],
}

# education_category → assessment bucket. Exam aspirants and droppers sit with
# school: they are preparing for an entrance exam, not working in a field yet.
CATEGORY_BUCKET = {
    'school_10th': 'school', 'school_11th': 'school', 'school_12th': 'school',
    'entrance_exam': 'school', 'dropper': 'school', 'gap_year': 'school',
    'iti': 'vocational', 'polytechnic': 'vocational',
    'ug': 'college', 'pg': 'college', 'phd': 'college',
    'professional_course': 'college', 'govt_exam': 'college',
    'working': 'working',
}


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
        for bucket, values in SKILLS.items():
            for i, v in enumerate(values):
                added += upsert(f'skill_{bucket}', v, v, (i + 1) * 10)
        for bucket, values in CAREER_GOALS.items():
            for i, v in enumerate(values):
                added += upsert(f'career_goal_{bucket}', v, v, (i + 1) * 10)
        for bucket, rows in STEP2.items():
            for i, (v, label) in enumerate(rows):
                added += upsert(f'assessment_step2_{bucket}', v, label, (i + 1) * 10)
        for bucket, rows in STEP4.items():
            for i, (v, label) in enumerate(rows):
                added += upsert(f'assessment_step4_{bucket}', v, label, (i + 1) * 10)
        db.session.commit()

        counts = db.session.execute(text("""
            SELECT SUBSTRING_INDEX(`type`, '_', 1) AS family, COUNT(1) AS n
              FROM `masters`
             WHERE `is_active` = 1
               AND (`type` LIKE 'skill\\_%' OR `type` LIKE 'career\\_goal\\_%'
                    OR `type` LIKE 'assessment\\_%')
             GROUP BY family
        """)).mappings().all()
        print(f"rows added: {added}")
        print("assessment masters:", {c['family']: c['n'] for c in counts})
        print("buckets:", sorted(set(CATEGORY_BUCKET.values())))


if __name__ == "__main__":
    main()
