"""
SKOVO Dev Seed — Visakhapatnam Demo Data
Run from SKOVO_BACKEND folder:
    python seed.py

Credentials created:
  Super Admin : super@skovo.in     / Super@123
  Admin       : admin@demo.in      / Admin@123
  Mentor 1    : mentor1@demo.in    / Mentor@123
  Mentor 2    : mentor2@demo.in    / Mentor@123
  Student 1   : student1@demo.in   / Student@123   (score 75 — Achiever)
  Student 2   : student2@demo.in   / Student@123   (score 45 — Pioneer)
  Student 3   : student3@demo.in   / Student@123   (score 20 — Explorer)
  Student 4   : student4@demo.in   / Student@123   (score 0  — Explorer)
  Student 5   : student5@demo.in   / Student@123   (score 30 — Pioneer)
"""

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

from portal import InitApp
from portal.models import db
from portal.models.super_admins import SuperAdmins
from portal.models.users import Users
from portal.models.user_profiles import UserProfiles
from portal.models.domains import Domains
from portal.models.achievers import Achievers
from portal.models.cohorts import Cohorts
from portal.models.colleges import Colleges
from portal.models.college_courses import CollegeCourses
from portal.models.college_placement_insights import CollegePlacementInsights
from portal.models.opportunities import Opportunities
from portal.models.coaching_centres import CoachingCentres
from portal.models.groups import Groups
from portal.models.group_memberships import GroupMemberships
from portal.models.group_posts import GroupPosts
from portal.models.readiness_scores import ReadinessScores
from portal.models.mentors import Mentors
from werkzeug.security import generate_password_hash
import uuid
from datetime import datetime, timedelta

app = InitApp().app()

# ── Fixed IDs so re-runs are predictable ─────────────────────────────────────
SUPER_ID    = "22222222-0000-0000-0000-000000000001"

ADMIN_ID    = "44444444-0000-0000-0000-000000000001"
MENTOR1_ID  = "44444444-0000-0000-0000-000000000002"
MENTOR2_ID  = "44444444-0000-0000-0000-000000000003"
STU1_ID     = "44444444-0000-0000-0000-000000000004"
STU2_ID     = "44444444-0000-0000-0000-000000000005"
STU3_ID     = "44444444-0000-0000-0000-000000000006"
STU4_ID     = "44444444-0000-0000-0000-000000000007"
STU5_ID     = "44444444-0000-0000-0000-000000000008"

DOM_TECH_ID  = "55555555-0000-0000-0000-000000000001"
DOM_FIN_ID   = "55555555-0000-0000-0000-000000000002"
DOM_DES_ID   = "55555555-0000-0000-0000-000000000003"
DOM_MKT_ID   = "55555555-0000-0000-0000-000000000004"
DOM_HLTH_ID  = "55555555-0000-0000-0000-000000000005"
DOM_MGMT_ID  = "55555555-0000-0000-0000-000000000006"

ACH1_ID = "66666666-0000-0000-0000-000000000001"
ACH2_ID = "66666666-0000-0000-0000-000000000002"
ACH3_ID = "66666666-0000-0000-0000-000000000003"

COL1_ID = "77777777-0000-0000-0000-000000000001"
COL2_ID = "77777777-0000-0000-0000-000000000002"
COL3_ID = "77777777-0000-0000-0000-000000000003"
COL4_ID = "77777777-0000-0000-0000-000000000004"
COL5_ID = "77777777-0000-0000-0000-000000000005"

COH1_ID = "88888888-0000-0000-0000-000000000001"
COH2_ID = "88888888-0000-0000-0000-000000000002"
COH3_ID = "88888888-0000-0000-0000-000000000003"
COH4_ID = "88888888-0000-0000-0000-000000000004"

OPP1_ID = "99999999-0000-0000-0000-000000000001"
OPP2_ID = "99999999-0000-0000-0000-000000000002"
OPP3_ID = "99999999-0000-0000-0000-000000000003"
OPP4_ID = "99999999-0000-0000-0000-000000000004"
OPP5_ID = "99999999-0000-0000-0000-000000000005"

CC1_ID = "aaaaaaaa-0000-0000-0000-000000000001"
CC2_ID = "aaaaaaaa-0000-0000-0000-000000000002"
CC3_ID = "aaaaaaaa-0000-0000-0000-000000000003"
CC4_ID = "aaaaaaaa-0000-0000-0000-000000000004"

GRP1_ID = "bbbbbbbb-0000-0000-0000-000000000001"
GRP2_ID = "bbbbbbbb-0000-0000-0000-000000000002"
GRP3_ID = "bbbbbbbb-0000-0000-0000-000000000003"
GRP4_ID = "bbbbbbbb-0000-0000-0000-000000000004"

now = datetime.utcnow()


def truncate_all(conn):
    tables = [
        "audit_logs", "invitations", "readiness_assessments", "readiness_scores",
        "group_post_likes", "group_posts", "group_memberships",
        "cohort_enrollments", "opportunity_applications",
        "college_placement_insights", "college_courses",
        "user_skills", "user_profiles",
        "mentors", "mentor_mentees",
        "`groups`", "cohorts", "opportunities", "coaching_centres",
        "colleges", "achievers", "domains",
        "auth_identities", "otp_requests", "sessions", "device_tokens", "notification_logs",
        "users", "super_admins",
    ]
    cursor = conn.cursor()
    cursor.execute("SET FOREIGN_KEY_CHECKS = 0")
    for t in tables:
        try:
            cursor.execute(f"TRUNCATE TABLE {t}")
            print(f"  truncated {t}")
        except Exception as e:
            print(f"  skip {t} ({e})")
    cursor.execute("SET FOREIGN_KEY_CHECKS = 1")
    conn.commit()
    cursor.close()


def seed():
    with app.app_context():
        raw = db.engine.raw_connection()
        print("\n-- Truncating all tables ---------------------------------------")
        truncate_all(raw)
        raw.close()

        print("\n-- Inserting seed data -----------------------------------------")

        # ── Super Admin ──────────────────────────────────────────────────────
        sup = SuperAdmins(
            id=SUPER_ID,
            full_name="SKOVO Super Admin",
            email="super@skovo.in",
            password_hash=generate_password_hash("Super@123"),
            status="active",
        )
        db.session.add(sup)
        db.session.flush()

        # ── Users ────────────────────────────────────────────────────────────
        pw_admin   = generate_password_hash("Admin@123")
        pw_mentor  = generate_password_hash("Mentor@123")
        pw_student = generate_password_hash("Student@123")

        admin_user = Users(id=ADMIN_ID,
                           full_name="Ravi Shankar", email="admin@demo.in",
                           password_hash=pw_admin, status="active")
        m1 = Users(id=MENTOR1_ID,
                   full_name="Arjun Rao", email="mentor1@demo.in",
                   password_hash=pw_mentor, status="active")
        m2 = Users(id=MENTOR2_ID,
                   full_name="Priya Lakshmi", email="mentor2@demo.in",
                   password_hash=pw_mentor, status="active")
        s1 = Users(id=STU1_ID,
                   full_name="Aakash Reddy", email="student1@demo.in",
                   password_hash=pw_student, status="active")
        s2 = Users(id=STU2_ID,
                   full_name="Bhavana Rao", email="student2@demo.in",
                   password_hash=pw_student, status="active")
        s3 = Users(id=STU3_ID,
                   full_name="Chetan Kumar", email="student3@demo.in",
                   password_hash=pw_student, status="active")
        s4 = Users(id=STU4_ID,
                   full_name="Divya Sree", email="student4@demo.in",
                   password_hash=pw_student, status="active")
        s5 = Users(id=STU5_ID,
                   full_name="Eswar Naidu", email="student5@demo.in",
                   password_hash=pw_student, status="active")
        db.session.add_all([admin_user, m1, m2, s1, s2, s3, s4, s5])
        db.session.flush()

        # ── User Profiles ────────────────────────────────────────────────────
        db.session.add_all([
            UserProfiles(id=str(uuid.uuid4()), user_id=STU1_ID,
                         education_level="UG", stream="Engineering",
                         city="Visakhapatnam", state="Andhra Pradesh",
                         career_interests=["technology", "finance"]),
            UserProfiles(id=str(uuid.uuid4()), user_id=STU2_ID,
                         education_level="12th", stream="Commerce",
                         city="Visakhapatnam", state="Andhra Pradesh",
                         career_interests=["finance", "management"]),
            UserProfiles(id=str(uuid.uuid4()), user_id=STU3_ID,
                         education_level="UG", stream="Science",
                         city="Vizag", state="Andhra Pradesh",
                         career_interests=["technology"]),
            UserProfiles(id=str(uuid.uuid4()), user_id=STU4_ID,
                         education_level="12th", stream="Arts",
                         city="Visakhapatnam", state="Andhra Pradesh",
                         career_interests=["design", "marketing"]),
            UserProfiles(id=str(uuid.uuid4()), user_id=STU5_ID,
                         education_level="UG", stream="Commerce",
                         city="Visakhapatnam", state="Andhra Pradesh",
                         career_interests=["finance"]),
        ])

        # ── Mentor Profiles ──────────────────────────────────────────────────
        db.session.add_all([
            Mentors(id=str(uuid.uuid4()),
                    full_name="Arjun Rao", email="mentor1@demo.in",
                    password_hash=pw_mentor, status="active",
                    bio="Senior Software Engineer at TCS Vizag with 8 years experience.",
                    domains=["technology"], designation="Senior Software Engineer",
                    company="TCS", linkedin_url="https://linkedin.com/in/arjunrao",
                    is_active=True, is_verified=True),
            Mentors(id=str(uuid.uuid4()),
                    full_name="Priya Lakshmi", email="mentor2@demo.in",
                    password_hash=pw_mentor, status="active",
                    bio="Investment Analyst at Kotak Securities, passionate about financial literacy.",
                    domains=["finance"], designation="Investment Analyst",
                    company="Kotak Securities", linkedin_url="https://linkedin.com/in/priyalakshmi",
                    is_active=True, is_verified=True),
        ])

        # ── Readiness Scores ─────────────────────────────────────────────────
        db.session.add_all([
            ReadinessScores(id=str(uuid.uuid4()), user_id=STU1_ID,
                            score=75, level="Achiever",
                            cohorts_completed=3, tasks_completed=12, assessment_completed=True),
            ReadinessScores(id=str(uuid.uuid4()), user_id=STU2_ID,
                            score=45, level="Pioneer",
                            cohorts_completed=1, tasks_completed=5, assessment_completed=True),
            ReadinessScores(id=str(uuid.uuid4()), user_id=STU3_ID,
                            score=20, level="Explorer",
                            cohorts_completed=0, tasks_completed=2, assessment_completed=False),
            ReadinessScores(id=str(uuid.uuid4()), user_id=STU4_ID,
                            score=0, level="Explorer",
                            cohorts_completed=0, tasks_completed=0, assessment_completed=False),
            ReadinessScores(id=str(uuid.uuid4()), user_id=STU5_ID,
                            score=30, level="Pioneer",
                            cohorts_completed=1, tasks_completed=3, assessment_completed=True),
        ])

        # ── Domains ──────────────────────────────────────────────────────────
        db.session.add_all([
            Domains(id=DOM_TECH_ID,  name="Technology",  slug="technology"),
            Domains(id=DOM_FIN_ID,   name="Finance",     slug="finance"),
            Domains(id=DOM_DES_ID,   name="Design",      slug="design"),
            Domains(id=DOM_MKT_ID,   name="Marketing",   slug="marketing"),
            Domains(id=DOM_HLTH_ID,  name="Healthcare",  slug="healthcare"),
            Domains(id=DOM_MGMT_ID,  name="Management",  slug="management"),
        ])
        db.session.flush()

        # ── Achievers ────────────────────────────────────────────────────────
        db.session.add_all([
            Achievers(id=ACH1_ID,
                      full_name="Kiran Babu",
                      designation="Senior Software Engineer", company="TCS",
                      bio="Vizag-based tech leader with 10 years in full-stack development. Mentor to 200+ students.",
                      domain_id=DOM_TECH_ID, is_verified=True, is_active=True),
            Achievers(id=ACH2_ID,
                      full_name="Lakshmi Prasad",
                      designation="Investment Analyst", company="Kotak Securities",
                      bio="Finance expert helping students navigate stock markets and career planning.",
                      domain_id=DOM_FIN_ID, is_verified=True, is_active=True),
            Achievers(id=ACH3_ID,
                      full_name="Anusha Devi",
                      designation="UI/UX Lead", company="Infosys",
                      bio="Design leader passionate about making technology human-centred.",
                      domain_id=DOM_DES_ID, is_verified=True, is_active=True),
        ])

        # ── Cohorts ──────────────────────────────────────────────────────────
        db.session.add_all([
            Cohorts(id=COH1_ID,
                    title="Python for Beginners — Zero to Job Ready",
                    achiever_id=ACH1_ID, domain_id=DOM_TECH_ID,
                    session_date=now + timedelta(days=7),
                    duration_minutes=90, total_seats=50, filled_seats=12,
                    price=0, status="upcoming",
                    about="Learn Python from scratch with real-world projects. Ideal for students with no coding background.",
                    what_you_learn=["Variables, loops, functions", "File handling & OOP",
                                    "Build a resume parser project", "How to crack Python interviews"]),
            Cohorts(id=COH2_ID,
                    title="Stock Market Basics — How to Invest at 20",
                    achiever_id=ACH2_ID, domain_id=DOM_FIN_ID,
                    session_date=now + timedelta(days=10),
                    duration_minutes=90, total_seats=40, filled_seats=28,
                    price=499, status="upcoming",
                    about="Understand equity markets, mutual funds, and how to start investing as a student.",
                    what_you_learn=["How stock markets work", "Mutual funds vs. direct equity",
                                    "Reading financial statements", "Build your first portfolio"]),
            Cohorts(id=COH3_ID,
                    title="UI/UX Design Fundamentals — Figma to Portfolio",
                    achiever_id=ACH3_ID, domain_id=DOM_DES_ID,
                    session_date=now + timedelta(days=14),
                    duration_minutes=120, total_seats=30, filled_seats=8,
                    price=0, status="upcoming",
                    about="Go from zero design experience to a Figma portfolio that gets you hired.",
                    what_you_learn=["Design thinking process", "Figma basics & wireframing",
                                    "Case study creation", "How to get your first UX internship"]),
            Cohorts(id=COH4_ID,
                    title="Career Planning Masterclass — Build Your 5-Year Roadmap",
                    achiever_id=ACH1_ID, domain_id=DOM_MGMT_ID,
                    session_date=now + timedelta(days=3),
                    duration_minutes=60, total_seats=100, filled_seats=67,
                    price=299, status="upcoming",
                    about="Practical workshop on setting career goals, choosing the right path, and building a personal brand.",
                    what_you_learn=["Self-assessment frameworks", "Goal setting with OKRs",
                                    "LinkedIn profile that attracts recruiters", "Resume & interview preparation"]),
        ])

        # ── Colleges ─────────────────────────────────────────────────────────
        db.session.add_all([
            Colleges(id=COL1_ID,
                     name="Andhra University", type="government",
                     location_city="Visakhapatnam", location_state="Andhra Pradesh",
                     nirf_ranking=54, naac_grade="A+",
                     annual_fees_min=30000, annual_fees_max=80000,
                     placement_rate=72.0, avg_package=5.8, highest_package=28.0,
                     website_url="https://www.andhrauniversity.edu.in", is_active=True),
            Colleges(id=COL2_ID,
                     name="GITAM University", type="deemed",
                     location_city="Visakhapatnam", location_state="Andhra Pradesh",
                     nirf_ranking=92, naac_grade="A",
                     annual_fees_min=120000, annual_fees_max=200000,
                     placement_rate=80.0, avg_package=7.2, highest_package=42.0,
                     website_url="https://www.gitam.edu", is_active=True),
            Colleges(id=COL3_ID,
                     name="MVGR College of Engineering", type="private",
                     location_city="Vizianagaram", location_state="Andhra Pradesh",
                     nirf_ranking=135, naac_grade="A",
                     annual_fees_min=80000, annual_fees_max=120000,
                     placement_rate=68.0, avg_package=4.5, highest_package=18.0,
                     website_url="https://www.mvgrce.edu.in", is_active=True),
            Colleges(id=COL4_ID,
                     name="RGUKT Nuzvid", type="government",
                     location_city="Nuzvid", location_state="Andhra Pradesh",
                     nirf_ranking=180, naac_grade="B++",
                     annual_fees_min=20000, annual_fees_max=40000,
                     placement_rate=60.0, avg_package=4.0, highest_package=12.0,
                     website_url="https://www.rgukt.ac.in", is_active=True),
            Colleges(id=COL5_ID,
                     name="Vignan's Institute of Information Technology", type="private",
                     location_city="Visakhapatnam", location_state="Andhra Pradesh",
                     nirf_ranking=210, naac_grade="A",
                     annual_fees_min=90000, annual_fees_max=140000,
                     placement_rate=74.0, avg_package=5.0, highest_package=22.0,
                     website_url="https://www.vignanvisakha.ac.in", is_active=True),
        ])
        db.session.flush()

        # ── College Courses ───────────────────────────────────────────────────
        courses = []
        for col_id, col_courses in [
            (COL1_ID, [("B.Tech", 4, "UG"), ("MBA", 2, "PG"), ("B.Sc", 3, "UG"), ("M.Tech", 2, "PG")]),
            (COL2_ID, [("B.Tech", 4, "UG"), ("BBA", 3, "UG"), ("MBA", 2, "PG"), ("B.Sc", 3, "UG")]),
            (COL3_ID, [("B.Tech", 4, "UG"), ("M.Tech", 2, "PG"), ("Diploma", 3, "Diploma")]),
            (COL4_ID, [("B.Tech", 6, "UG")]),
            (COL5_ID, [("B.Tech", 4, "UG"), ("MCA", 3, "PG"), ("MBA", 2, "PG")]),
        ]:
            for name, dur, deg in col_courses:
                courses.append(CollegeCourses(
                    id=str(uuid.uuid4()), college_id=col_id,
                    course_name=name, duration_years=dur, degree_type=deg))
        db.session.add_all(courses)

        # ── College Placement Insights ────────────────────────────────────────
        insights = []
        for col_id, rows in [
            (COL1_ID, [(2024, 72, 5.8, 28, 1200, 864), (2023, 68, 5.2, 24, 1150, 782)]),
            (COL2_ID, [(2024, 80, 7.2, 42, 900,  720), (2023, 77, 6.8, 38, 870,  670)]),
            (COL3_ID, [(2024, 68, 4.5, 18, 600,  408), (2023, 65, 4.2, 16, 580,  377)]),
            (COL4_ID, [(2024, 60, 4.0, 12, 400,  240), (2023, 55, 3.8, 10, 380,  209)]),
            (COL5_ID, [(2024, 74, 5.0, 22, 700,  518), (2023, 70, 4.8, 20, 680,  476)]),
        ]:
            for yr, pr, avg, high, tot, placed in rows:
                insights.append(CollegePlacementInsights(
                    id=str(uuid.uuid4()), college_id=col_id, year=yr,
                    placement_rate=pr, avg_package=avg, highest_package=high,
                    total_students=tot, placed_students=placed))
        db.session.add_all(insights)

        # ── Opportunities ─────────────────────────────────────────────────────
        db.session.add_all([
            Opportunities(
                id=OPP1_ID,
                title="Python Developer Intern", company="TCS",
                type="internship", domain="technology",
                location="Visakhapatnam", is_remote=False,
                duration="3 months", stipend_min=15000, stipend_max=25000,
                stipend_type="fixed", min_readiness_score=0,
                deadline=now + timedelta(days=20),
                description="Join TCS Vizag as a Python intern. Work on real client projects under senior engineers.",
                requirements=["Python basics", "Problem solving", "Good communication"],
                status="active", posted_by=ADMIN_ID,
            ),
            Opportunities(
                id=OPP2_ID,
                title="Financial Analyst — Fresher", company="Axis Bank",
                type="fresher_job", domain="finance",
                location="Visakhapatnam", is_remote=False,
                duration="Permanent", stipend_min=400000, stipend_max=600000,
                stipend_type="fixed", min_readiness_score=40,
                deadline=now + timedelta(days=15),
                description="Entry-level Financial Analyst role for fresh graduates. Rotational program across branches.",
                requirements=["B.Com / BBA / MBA Finance", "MS Excel", "Analytical mindset"],
                status="active", posted_by=ADMIN_ID,
            ),
            Opportunities(
                id=OPP3_ID,
                title="UI/UX Design Intern", company="Infosys",
                type="internship", domain="design",
                location="Hyderabad", is_remote=True,
                duration="4 months", stipend_min=12000, stipend_max=18000,
                stipend_type="fixed", min_readiness_score=0,
                deadline=now + timedelta(days=25),
                description="Remote UI/UX internship at Infosys Design Studio. Build real product features in Figma.",
                requirements=["Figma or Adobe XD", "Basic design principles", "Portfolio preferred"],
                status="active", posted_by=ADMIN_ID,
            ),
            Opportunities(
                id=OPP4_ID,
                title="Data Science Intern", company="Wipro",
                type="internship", domain="technology",
                location="Hyderabad", is_remote=True,
                duration="6 months", stipend_min=18000, stipend_max=28000,
                stipend_type="fixed", min_readiness_score=40,
                deadline=now + timedelta(days=12),
                description="Work with Wipro's data engineering team on ML model pipelines. Python + SQL required.",
                requirements=["Python (Pandas, NumPy)", "SQL", "Basic ML concepts", "Readiness score 40+"],
                status="active", posted_by=ADMIN_ID,
            ),
            Opportunities(
                id=OPP5_ID,
                title="Junior Full Stack Developer", company="Zensar Technologies",
                type="fresher_job", domain="technology",
                location="Pune", is_remote=False,
                duration="Permanent", stipend_min=500000, stipend_max=700000,
                stipend_type="fixed", min_readiness_score=65,
                deadline=now + timedelta(days=30),
                description="Full-stack developer role for top-performing students. React + Node.js. Relocation support provided.",
                requirements=["React.js", "Node.js / Python", "Git", "Readiness score 65+ (Achiever level)"],
                status="active", posted_by=ADMIN_ID,
            ),
        ])

        # ── Coaching Centres ──────────────────────────────────────────────────
        db.session.add_all([
            CoachingCentres(
                id=CC1_ID,
                name="Narayana IIT Academy", city="Visakhapatnam", state="Andhra Pradesh",
                address="Dwaraka Nagar, Visakhapatnam — 530016",
                categories=["JEE", "NEET"],
                description="Premier coaching institute for JEE and NEET with 20+ years of results.",
                discount_info="15% off on full course fee for SKOVO students",
                discount_percent=15, is_active=True, is_verified=True,
                contact_phone="9100001111", contact_email="vizag@narayana.edu.in",
            ),
            CoachingCentres(
                id=CC2_ID,
                name="Sri Chaitanya Techno School", city="Visakhapatnam", state="Andhra Pradesh",
                address="MVP Colony, Visakhapatnam — 530017",
                categories=["JEE", "NEET", "Coding"],
                description="Integrated school + coaching with strong IIT track record. Coding batches available.",
                discount_info="10% off on coaching modules for SKOVO users",
                discount_percent=10, is_active=True, is_verified=True,
                contact_phone="9100002222", contact_email="vizag@srichaitanya.net",
            ),
            CoachingCentres(
                id=CC3_ID,
                name="TIME Institute", city="Visakhapatnam", state="Andhra Pradesh",
                address="Siripuram, Visakhapatnam — 530003",
                categories=["Management", "Finance", "Language"],
                description="Best CAT / MBA prep centre in Vizag. Also offers CFA, IELTS coaching.",
                discount_info="20% off first month for SKOVO students",
                discount_percent=20, is_active=True, is_verified=True,
                contact_phone="9100003333", contact_email="vizag@time4education.com",
            ),
            CoachingCentres(
                id=CC4_ID,
                name="BYJU's Learning Centre", city="Visakhapatnam", state="Andhra Pradesh",
                address="Jagadamba Junction, Visakhapatnam — 530002",
                categories=["Coding", "Skill Dev"],
                description="Structured coding and skill development programs for college students.",
                discount_info="First module free for SKOVO users",
                discount_percent=0, is_active=True, is_verified=False,
                contact_phone="9100004444", contact_email="vizag@byjus.com",
            ),
        ])

        # ── Groups ────────────────────────────────────────────────────────────
        db.session.add_all([
            Groups(id=GRP1_ID,
                   name="Vizag Tech Community",
                   description="A space for tech enthusiasts in Visakhapatnam to share, learn and grow together.",
                   category="Coding", group_type="knowledge_booster",
                   icon_color="#3B82F6", join_type="open", member_count=3,
                   created_by=MENTOR1_ID, is_active=True),
            Groups(id=GRP2_ID,
                   name="Finance & Investing Club",
                   description="Deep dives into markets, personal finance and investment strategies for students.",
                   category="Finance", group_type="regular",
                   icon_color="#10B981", join_type="request", member_count=2,
                   created_by=MENTOR2_ID, is_active=True),
            Groups(id=GRP3_ID,
                   name="Design Thinkers",
                   description="UI/UX, graphic design, branding — all things visual. Share your work and get feedback.",
                   category="Design", group_type="thoughts",
                   icon_color="#8B5CF6", join_type="open", member_count=2,
                   created_by=ADMIN_ID, is_active=True),
            Groups(id=GRP4_ID,
                   name="Career Corner",
                   description="Resume reviews, mock interview tips, job search strategies. Everyone is welcome.",
                   category="Career Prep", group_type="regular",
                   icon_color="#F59E0B", join_type="open", member_count=4,
                   created_by=ADMIN_ID, is_active=True),
        ])
        db.session.flush()

        # ── Group Memberships ─────────────────────────────────────────────────
        memberships = [
            # Vizag Tech Community
            (MENTOR1_ID, GRP1_ID, "leader"), (STU1_ID, GRP1_ID, "member"), (STU3_ID, GRP1_ID, "member"),
            # Finance Club
            (MENTOR2_ID, GRP2_ID, "leader"), (STU2_ID, GRP2_ID, "member"),
            # Design Thinkers
            (ADMIN_ID,   GRP3_ID, "leader"), (STU4_ID, GRP3_ID, "member"),
            # Career Corner
            (ADMIN_ID,   GRP4_ID, "leader"), (STU1_ID, GRP4_ID, "member"),
            (STU2_ID,    GRP4_ID, "member"),  (STU5_ID, GRP4_ID, "member"),
        ]
        for uid, gid, role in memberships:
            db.session.add(GroupMemberships(
                id=str(uuid.uuid4()), user_id=uid, group_id=gid,
                role=role, status="active", joined_at=now,
            ))

        # ── Group Posts ───────────────────────────────────────────────────────
        db.session.add_all([
            GroupPosts(id=str(uuid.uuid4()), group_id=GRP1_ID, user_id=MENTOR1_ID,
                       post_type="resource", is_pinned=True, likes_count=5,
                       content="Welcome to Vizag Tech Community! Share resources, ask questions, grow together.",
                       link_url="https://roadmap.sh/python",
                       link_title="Python Developer Roadmap 2024"),
            GroupPosts(id=str(uuid.uuid4()), group_id=GRP1_ID, user_id=STU1_ID,
                       post_type="general", likes_count=3,
                       content="Just got shortlisted for TCS Python intern! The SKOVO readiness assessment prep really helped."),
            GroupPosts(id=str(uuid.uuid4()), group_id=GRP2_ID, user_id=MENTOR2_ID,
                       post_type="resource", is_pinned=True, likes_count=8,
                       content="Start here: Before picking stocks, understand these 5 financial ratios.",
                       link_url="https://www.investopedia.com/financial-ratios-4689817",
                       link_title="5 Financial Ratios Every Investor Must Know"),
            GroupPosts(id=str(uuid.uuid4()), group_id=GRP4_ID, user_id=ADMIN_ID,
                       post_type="general", is_pinned=True, likes_count=12,
                       content="Career Corner Rules: Be kind, share genuinely, no spam. Post your resume here for peer review!"),
            GroupPosts(id=str(uuid.uuid4()), group_id=GRP4_ID, user_id=STU2_ID,
                       post_type="general", likes_count=4,
                       content="Can anyone review my resume? I am applying for finance analyst roles in Vizag."),
        ])

        db.session.commit()
        print("\nSeed complete!")
        print("=" * 58)
        print("  CREDENTIALS")
        print("=" * 58)
        print("  Super Admin : super@skovo.in       / Super@123")
        print("  Admin       : admin@demo.in         / Admin@123")
        print("  Mentor 1    : mentor1@demo.in       / Mentor@123")
        print("  Mentor 2    : mentor2@demo.in       / Mentor@123")
        print("  Student 1   : student1@demo.in      / Student@123  (score 75)")
        print("  Student 2   : student2@demo.in      / Student@123  (score 45)")
        print("  Student 3   : student3@demo.in      / Student@123  (score 20)")
        print("  Student 4   : student4@demo.in      / Student@123  (score 0)")
        print("  Student 5   : student5@demo.in      / Student@123  (score 30)")
        print("=" * 58)


if __name__ == "__main__":
    seed()
