import uuid
from . import db
from datetime import datetime


class StudentGoals(db.Model):
    """
    Where the student wants to go — as opposed to where they are.

    `user_profiles` records the present: current state, board, course, year. A
    guidance product runs on the other half, and that half is multi-valued —
    "NEET or JEE", "Chennai or Delhi" — which is why it cannot live as more
    columns on the profile.

    Current city and target city are deliberately different fields. A student in
    Hyderabad aiming for Chennai should see Tamil Nadu cutoffs, not Telangana
    ones, while still getting Telangana domicile scholarships.
    """
    __tablename__ = "student_goals"

    id      = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), nullable=False, index=True)

    target_exams      = db.Column(db.JSON)   # ["NEET UG", "JEE Main"]
    target_courses    = db.Column(db.JSON)   # ["MBBS", "B.Tech — Computer Science (CSE)"]
    target_states     = db.Column(db.JSON)   # ["Tamil Nadu", "Delhi"]
    target_cities     = db.Column(db.JSON)   # ["Chennai", "New Delhi"]
    target_college_ids = db.Column(db.JSON)  # dream list → colleges.id

    admission_year       = db.Column(db.Integer)      # 2027
    reservation_category = db.Column(db.String(20))   # general | obc | sc | st | ews — drives cutoffs
    budget_max           = db.Column(db.Integer)      # annual fees ceiling, ₹

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', name='uq_student_goals_user'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
