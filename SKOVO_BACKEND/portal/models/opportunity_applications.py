import uuid
from . import db
from datetime import datetime


class OpportunityApplications(db.Model):
    """
    Student applications to opportunities.
    Status pipeline: applied → interviewing → offered | rejected
    """
    __tablename__ = "opportunity_applications"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), nullable=False)
    opportunity_id = db.Column(db.CHAR(36), nullable=False)

    resume_link = db.Column(db.Text)
    cover_note = db.Column(db.Text)

    status = db.Column(db.String(20), default="applied")
    # applied | interviewing | offered | rejected | withdrawn

    applied_at = db.Column(db.DateTime, default=datetime.utcnow)
    status_updated_at = db.Column(db.DateTime, default=datetime.utcnow)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'opportunity_id', name='uq_application_user_opp'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
