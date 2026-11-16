import uuid
from . import db
from datetime import datetime


class CourseEnrollments(db.Model):
    """
    Student enrollment in an AchieverCourse.
    Tracks 70/30 split: achiever_earning=70%, platform_fee=30%.
    Access is lifetime after payment.
    """
    __tablename__ = "course_enrollments"

    id        = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    course_id = db.Column(db.CHAR(36), nullable=False)
    user_id   = db.Column(db.CHAR(36), nullable=False)

    payment_status   = db.Column(db.String(20), default='pending')  # pending|paid|free|refunded
    payment_order_id = db.Column(db.String(100))
    payment_id       = db.Column(db.String(100))

    amount_paid      = db.Column(db.Numeric(10, 2), default=0)
    platform_fee     = db.Column(db.Numeric(10, 2), default=0)   # 30% of amount_paid
    achiever_earning = db.Column(db.Numeric(10, 2), default=0)   # 70% of amount_paid

    coupon_code      = db.Column(db.String(40), nullable=True)
    discount_amount  = db.Column(db.Numeric(10, 2), default=0)

    access_type = db.Column(db.String(20), default='lifetime')   # always lifetime

    enrolled_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at  = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'course_id', name='uq_course_enrollment_user_course'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
