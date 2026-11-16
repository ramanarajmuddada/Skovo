import uuid
from . import db
from datetime import datetime


class UserProfiles(db.Model):
    """
    Extended profile for students — full Indian education structure.
    """
    __tablename__ = "user_profiles"

    id      = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), unique=True)

    phone = db.Column(db.Text)
    city  = db.Column(db.String(100))
    state = db.Column(db.String(100))

    # Career interests stored as JSON array e.g. ["technology", "finance"]
    career_interests = db.Column(db.JSON, default=[])

    # ── Education (primary) ──────────────────────────────────────────────────
    # education_category is the canonical field; education_level kept for compat
    education_level    = db.Column(db.String(50))   # legacy: 10th|12th|ug|pg|diploma|graduated
    education_category = db.Column(db.String(30))
    # Values: school_11th | school_12th | iti | polytechnic | ug |
    #         professional_course | pg | phd | working | govt_exam | entrance_exam

    # ── School ───────────────────────────────────────────────────────────────
    school_name = db.Column(db.String(200))
    stream      = db.Column(db.String(30))
    # Values: pcm | pcb | pcmb | commerce | arts | vocational

    # ── ITI ──────────────────────────────────────────────────────────────────
    iti_trade = db.Column(db.String(100))
    # e.g. Electrician | Fitter | Welder | Mechanic | Plumber | COPA | Other

    # ── UG / PG / Polytechnic ────────────────────────────────────────────────
    college_name   = db.Column(db.String(200))
    degree_category = db.Column(db.String(50))
    # e.g. Engineering | Medical | Pharmacy | Nursing | Science | Commerce |
    #      Arts | Law | Computer | Architecture | Design | Hotel_Management |
    #      Mass_Comm | Agriculture | Marine | Defence | Management
    degree_type    = db.Column(db.String(100))   # B.Tech | MBBS | BCA | MBA etc.
    branch         = db.Column(db.String(100))   # CSE | ECE | Mechanical etc.
    year_of_study  = db.Column(db.String(30))    # 1st Year | 2nd Year | Preparing | etc.

    # ── Professional courses (CA / CS / CMA / CFA / CPA) ────────────────────
    professional_course_type  = db.Column(db.String(20))  # CA | CS | CMA | CFA | CPA
    professional_course_level = db.Column(db.String(30))
    # CA/CMA: Foundation | Intermediate | Final
    # CS: Foundation | Executive | Professional
    # CFA: Level 1 | Level 2 | Level 3

    # ── Exam aspirants ───────────────────────────────────────────────────────
    exam_target = db.Column(db.String(50))
    # Entrance: JEE Main | JEE Advanced | NEET UG | NEET PG | CAT | CLAT | GATE | CUET | NDA
    # Govt: UPSC | SSC CGL | SSC CHSL | IBPS PO | IBPS Clerk | SBI PO | SBI Clerk |
    #       RRB NTPC | RRB Group D | CDS | CAPF | CTET | State PSC | Other

    # ── Working professionals ─────────────────────────────────────────────────
    working_industry   = db.Column(db.String(100))
    # IT | Healthcare | Finance | Manufacturing | Education | Banking | Media |
    # Retail | Government | Agriculture | Consulting | Other
    working_experience = db.Column(db.String(20))   # 0-1 yr | 1-3 yrs | 3-5 yrs | 5+ yrs
    working_role       = db.Column(db.String(100))  # job title

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
