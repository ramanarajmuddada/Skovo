import uuid
from . import db
from datetime import datetime


class PaymentEvents(db.Model):
    """Every webhook the gateway sends us, recorded before it is acted on.

    This table is what makes webhook delivery safe. Gateways retry until they
    get a 2xx, so the same PAYMENT_SUCCESS can arrive three times; without a
    uniqueness constraint the third one books a second session and credits the
    achiever twice. `provider_event_id` is UNIQUE — the duplicate insert fails,
    we return 200, and nothing downstream runs a second time.

    Rows are kept even after processing: when a payment is disputed months
    later, the raw signed payload is the only evidence of what was actually
    delivered.
    """
    __tablename__ = "payment_events"

    id       = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    provider = db.Column(db.String(20), nullable=False)          # cashfree

    # The gateway's own id for this delivery. Unique -> replay protection.
    provider_event_id = db.Column(db.String(120), nullable=False, unique=True)
    event_type        = db.Column(db.String(60), nullable=True)

    order_id          = db.Column(db.CHAR(36), nullable=True, index=True)
    provider_order_id = db.Column(db.String(80), nullable=True, index=True)

    # Raw body as received. Signature is computed over these exact bytes, so it
    # is stored unparsed — re-serialising JSON changes key order and whitespace
    # and would make the stored payload unverifiable after the fact.
    raw_payload = db.Column(db.LargeBinary, nullable=True)

    signature_ok = db.Column(db.Boolean, nullable=False, default=False)
    processed    = db.Column(db.Boolean, nullable=False, default=False, index=True)
    process_error = db.Column(db.Text, nullable=True)

    received_at  = db.Column(db.DateTime, default=datetime.utcnow)
    processed_at = db.Column(db.DateTime, nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
