import uuid
from . import db
from datetime import datetime


class UserSkills(db.Model):
    """
    Skills selected by the student during Readiness Assessment Step 1.
    """
    __tablename__ = "user_skills"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36))

    # e.g. Python | JavaScript | Java | C/C++ | SQL | Excel | Machine Learning |
    #       Data Analysis | React | Node.js | UI/UX Design | Figma | Digital Marketing |
    #       SEO | Financial Modeling | Tally | Public Speaking | Content Writing | Canva | MS Office
    skill_name = db.Column(db.String(100))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    def save(self):
        db.session.add(self)
        db.session.commit()

    def delete(self):
        db.session.delete(self)
        db.session.commit()
