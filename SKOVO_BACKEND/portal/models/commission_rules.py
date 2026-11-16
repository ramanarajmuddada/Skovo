import uuid
from . import db
from datetime import datetime


class CommissionRules(db.Model):
    """Configurable platform commission, replacing the hardcoded 30% constant.

    Resolution is most-specific-wins: an achiever-level rule beats a tier-level
    rule, which beats the global rule. Exactly one global rule must always
    exist, because order creation has to resolve to *something* — a booking that
    cannot price itself is worse than one priced at the old default.

    Rules are never edited in place. Changing the rate closes the current row
    (sets effective_to) and inserts a new one, so a past order can always be
    explained by the rule that was in force when it was created — even though
    the order also snapshots its own rate.
    """
    __tablename__ = "commission_rules"

    id = db.Column(db.CHAR(36), primary_key=True, default=lambda: str(uuid.uuid4()))

    # global | tier | achiever   (scope_id: NULL | trust tier | achiever id)
    scope    = db.Column(db.String(20), nullable=False, default="global", index=True)
    scope_id = db.Column(db.String(36), nullable=True, index=True)

    # What the sale is for. NULL = applies to every kind.
    kind = db.Column(db.String(20), nullable=True, index=True)  # session | cohort | course

    # 0.3000 = 30% to the platform, achiever keeps 70%.
    rate = db.Column(db.Numeric(5, 4), nullable=False)

    effective_from = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    effective_to   = db.Column(db.DateTime, nullable=True)
    is_active      = db.Column(db.Boolean, nullable=False, default=True, index=True)

    note       = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    created_by = db.Column(db.CHAR(36), nullable=True)

    __table_args__ = {'mysql_charset': 'utf8mb4', 'mysql_collate': 'utf8mb4_unicode_ci'}

    def save(self):
        db.session.add(self)
        db.session.commit()

    def update(self):
        db.session.commit()
