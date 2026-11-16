import uuid
from . import db
from datetime import datetime


class CohortEnrollments(db.Model):
    """
    Records which students enrolled in which cohort and payment status.
    """
    __tablename__ = "cohort_enrollments"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    user_id = db.Column(db.CHAR(36), nullable=False)
    cohort_id = db.Column(db.CHAR(36), nullable=False)

    payment_status = db.Column(db.String(20), default="pending")  # pending | paid | free | refunded
    payment_order_id = db.Column(db.String(100))   # payment_orders.order_no
    payment_id = db.Column(db.String(100))         # gateway payment id
    amount_paid = db.Column(db.Numeric(10, 2), default=0)  # gross paid by student, in INR
    platform_fee = db.Column(db.Numeric(10, 2), default=0)      # platform commission, in INR
    achiever_earning = db.Column(db.Numeric(10, 2), default=0)  # achiever's net share, in INR

    attended = db.Column(db.Boolean, default=False)

    coupon_code = db.Column(db.String(40), nullable=True)
    discount_amount = db.Column(db.Numeric(10, 2), default=0)

    enrolled_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = (
        db.UniqueConstraint('user_id', 'cohort_id', name='uq_enrollment_user_cohort'),
    )

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
