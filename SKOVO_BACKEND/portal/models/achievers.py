import uuid
from . import db
from datetime import datetime


class Achievers(db.Model):
    """
    Unified professional profile.
    - All achievers can be showcased in cohorts / student-facing pages.
    - If email + password_hash are set, the achiever can also log in as a mentor.
    """
    __tablename__ = "achievers"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    full_name         = db.Column(db.Text, nullable=False)
    achievement_title = db.Column(db.Text)
    designation       = db.Column(db.Text)
    company           = db.Column(db.Text)
    bio               = db.Column(db.Text)
    avatar_url        = db.Column(db.Text)
    skills            = db.Column(db.JSON, default=[])
    domain_id         = db.Column(db.CHAR(36))
    linkedin_url      = db.Column(db.Text)
    is_verified       = db.Column(db.Boolean, default=False)
    is_featured       = db.Column(db.Boolean, default=False)
    is_active         = db.Column(db.Boolean, default=True)

    # Mentor portal login fields — nullable; only set for achievers who also mentor
    email             = db.Column(db.String(255), unique=True, nullable=True)
    password_hash     = db.Column(db.Text, nullable=True)
    status            = db.Column(db.String(20), nullable=True)   # 'active' / 'inactive'
    phone             = db.Column(db.String(20), nullable=True)
    profile_image_url = db.Column(db.Text, nullable=True)
    domains           = db.Column(db.JSON, nullable=True)          # multi-domain list for mentor portal
    suitable_for      = db.Column(db.JSON, nullable=True)          # education levels this achiever mentors: e.g. ['ug','graduated']

    # 1-on-1 session pricing — 0 means free
    session_rate      = db.Column(db.Numeric(10, 2), default=0)

    # How many seats an admin grants this achiever per cohort. Set when the
    # application is approved and editable afterwards. Achievers do not size
    # their own cohorts, for the same reason they do not price their own
    # sessions. NULL means no cap has been set yet — cohorts stay uncapped,
    # which is exactly how every cohort behaved before this column existed, so
    # achievers approved earlier are not retroactively locked out.
    cohort_seat_allocation = db.Column(db.Integer, nullable=True)

    # Payout details (where the achiever wants to be paid)
    payout_account_name   = db.Column(db.String(150), nullable=True)
    payout_account_number = db.Column(db.String(50),  nullable=True)
    payout_ifsc           = db.Column(db.String(20),  nullable=True)
    payout_upi            = db.Column(db.String(100), nullable=True)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    updated_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
