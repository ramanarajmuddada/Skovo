import uuid
from . import db
from datetime import datetime


class PaymentOrders(db.Model):
    """One row per checkout attempt, created *before* the gateway is called.

    The order exists first so that a payment which succeeds at the gateway can
    always be matched back to something, even if every later step fails. A
    webhook arriving for an order we never wrote is unrecoverable; a webhook
    arriving for an order stuck in 'created' is repaired by the reconciler.

    `commission_rate` is snapshotted here on purpose. Reading the live rate at
    payout time would retroactively change what past bookings owe an achiever
    when the rate is edited — the resulting dispute is one the platform loses.
    """
    __tablename__ = "payment_orders"

    id       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    order_no = db.Column(db.String(40), nullable=False, unique=True)

    # What is being bought. kind tells you which id column is meaningful.
    kind        = db.Column(db.String(20), nullable=False)   # session | cohort | course | subscription
    student_id  = db.Column(db.CHAR(36), nullable=False, index=True)
    achiever_id = db.Column(db.CHAR(36), nullable=True, index=True)
    slot_id     = db.Column(db.CHAR(36), nullable=True, index=True)
    ref_id      = db.Column(db.CHAR(36), nullable=True, index=True)  # cohort/course/session id

    # Money. gross is what the student is charged after discount.
    currency        = db.Column(db.String(3), nullable=False, default="INR")
    gross           = db.Column(db.Numeric(10, 2), nullable=False)
    discount        = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    coupon_code     = db.Column(db.String(40), nullable=True)

    # Snapshot at creation — never re-read from commission_rules afterwards.
    commission_rate  = db.Column(db.Numeric(5, 4), nullable=False)   # 0.3000 = 30%
    platform_fee     = db.Column(db.Numeric(10, 2), nullable=False, default=0)
    achiever_earning = db.Column(db.Numeric(10, 2), nullable=False, default=0)

    # created -> pending -> paid -> settled, or failed / expired / refunded
    status = db.Column(db.String(20), nullable=False, default="created", index=True)

    provider          = db.Column(db.String(20), nullable=True)   # cashfree
    provider_order_id = db.Column(db.String(80), nullable=True, index=True)
    provider_payment_id = db.Column(db.String(80), nullable=True, index=True)
    failure_reason    = db.Column(db.Text, nullable=True)

    # The slot hold released by the expiry job if payment never completes.
    expires_at = db.Column(db.DateTime, nullable=True, index=True)
    paid_at    = db.Column(db.DateTime, nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
