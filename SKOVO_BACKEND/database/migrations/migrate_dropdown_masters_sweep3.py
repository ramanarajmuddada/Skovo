"""
Migration: the remaining hardcoded dropdowns — the ones with no master type yet.

An audit of all 111 `<FormSelect>`s across the four portals found 57 still taking
their options from a const array in the component. Roughly two-thirds of those
already had a matching master type seeded and simply were not reading it; this
file adds the types for the third that had none.

It also reconciles one live drift. The same three concepts were spelled two ways,
because the admin screen reads masters and the super-admin screen did not:

    stipend_type        masters: fixed, range, performance, unpaid, negotiable
                        super:   fixed, performance_based, unpaid
    opportunity_type    masters: … fellowship, freelance
                        super:   … fellowship          (no freelance)
    opportunity_status  masters: active, filled, closed, draft, expired
                        super:   active, closed, draft

A super-admin saving `performance_based` wrote a value the admin dropdown could
not render, and nothing errored. The frontend now reads masters on both screens;
the data fix for rows already written that way is at the bottom of this file.

Lists that begin with an 'all' entry keep it in code — that is a UI filter value,
not something any row stores.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_dropdown_masters_sweep3.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

LISTS = {
    # ── money / billing ──────────────────────────────────────────────────────
    # One list for both admin bookings and super-admin enrollments; they were
    # two arrays describing the same enrollment.payment_status column.
    'payment_status': [
        ('pending', 'Pending'), ('paid', 'Paid'), ('free', 'Free'),
        ('refunded', 'Refunded'), ('cancelled', 'Cancelled'),
    ],
    'coupon_discount_type': [
        ('percent', 'Percent (%)'), ('flat', 'Flat (₹)'),
    ],
    # The achiever form offered all/cohort/course and the admin form added
    # 'session'. Admin is the superset — an achiever coupon simply never targets
    # a session it does not own, so one list serves both.
    'coupon_applies_to': [
        ('all', 'All'), ('cohort', 'Cohorts'), ('course', 'Courses'),
        ('session', '1-on-1 Sessions'),
    ],

    # ── generic lifecycle ────────────────────────────────────────────────────
    # Colleges, scholarships and abroad programmes each had their own
    # active/inactive pair. They are the same two words every time.
    'active_status': [
        ('active', 'Active'), ('inactive', 'Inactive'),
    ],
    'course_status': [
        ('published', 'Published'), ('draft', 'Draft'), ('archived', 'Archived'),
    ],
    'task_status': [
        ('active', 'Active'), ('draft', 'Draft'), ('inactive', 'Inactive'),
    ],
    'sop_status': [
        ('draft', 'Draft'), ('review', 'In Review'), ('final', 'Final'),
    ],

    # ── community ────────────────────────────────────────────────────────────
    # Admin worded these "Open (anyone can join)" / "Approval required" and the
    # student Assemble screen worded them "Anyone can join" / "I approve each
    # request". Same two values, so keep the student's second-person phrasing —
    # the student is the one choosing.
    'community_join_policy': [
        ('open', 'Anyone can join'), ('approval', 'I approve each request'),
    ],
    'community_post_type': [
        ('regular', 'Regular'), ('thoughts', 'Thoughts'),
        ('knowledge_booster', 'Knowledge Booster'),
    ],

    # ── content / assessment ─────────────────────────────────────────────────
    'question_type': [
        ('mcq', 'Multiple Choice'), ('text', 'Text Answer'), ('true_false', 'True / False'),
    ],
    # Distinct from `difficulty_level` (beginner/intermediate/advanced), which
    # describes a course. A question is easy/medium/hard.
    'question_difficulty': [
        ('easy', 'Easy'), ('medium', 'Medium'), ('hard', 'Hard'),
    ],
    # What a course module holds. `live_session` is the exact string
    # _module_dict keys its live-room logic off — 'live' would silently disable
    # the join window on every live module.
    'course_content_type': [
        ('video', 'Video'), ('text', 'Text / Article'),
        ('live_session', 'Live Session'), ('resource', 'Resource Link'),
    ],

    # ── admin / platform ─────────────────────────────────────────────────────
    'invite_role': [
        ('mentor', 'Achiever'), ('admin', 'Admin'),
    ],
    'institution_plan': [
        ('trial', 'Trial'), ('basic', 'Basic'), ('pro', 'Pro'),
    ],
    'institution_status': [
        ('active', 'Active'), ('trial', 'Trial'), ('suspended', 'Suspended'),
    ],
    'readiness_level': [
        ('Explorer', 'Explorer'), ('Pioneer', 'Pioneer'), ('Achiever', 'Achiever'),
    ],
    'abroad_intake': [
        ('Fall', 'Fall'), ('Spring', 'Spring'), ('Summer', 'Summer'), ('Winter', 'Winter'),
        ('Rolling', 'Rolling / Anytime'),
    ],

    # ── audit ────────────────────────────────────────────────────────────────
    # The `audit_action` / `audit_resource` types already existed but held only
    # what the admin audit screen filtered on. The super-admin log filtered on a
    # different, overlapping set — so each screen could only filter half the
    # entries the other could write. These are the union of both.
    'audit_action': [
        ('user.created', 'user.created'), ('user.deleted', 'user.deleted'),
        ('user.role_changed', 'user.role_changed'), ('user.status_changed', 'user.status_changed'),
        ('invite.created', 'invite.created'), ('invite.revoked', 'invite.revoked'),
        ('invite.accepted', 'invite.accepted'),
        ('cohort.created', 'cohort.created'), ('cohort.updated', 'cohort.updated'),
        ('cohort.deleted', 'cohort.deleted'), ('admin.updated', 'admin.updated'),
    ],
    'audit_resource': [
        ('user', 'User'), ('invitation', 'Invitation'), ('cohort', 'Cohort'),
        ('college', 'College'), ('opportunity', 'Opportunity'),
        ('admin', 'Admin'), ('mentor', 'Achiever'),
    ],
}

# Values the super-admin screens wrote that disagree with the master list.
# Left alone, these rows render blank in every dropdown now reading masters.
VALUE_FIXES = [
    ("UPDATE opportunities SET stipend_type = 'performance' "
     "WHERE stipend_type = 'performance_based'"),
]


def main():
    with app.app_context():
        added = skipped = 0
        for mtype, entries in LISTS.items():
            for order, (value, label) in enumerate(entries):
                exists = db.session.execute(
                    text("SELECT id FROM masters WHERE type = :t AND value = :v"),
                    {'t': mtype, 'v': value},
                ).first()
                if exists:
                    skipped += 1
                    continue
                db.session.execute(
                    text("INSERT INTO masters (id, type, value, label, sort_order, is_active) "
                         "VALUES (:id, :t, :v, :l, :o, 1)"),
                    {'id': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 'o': order},
                )
                added += 1
        db.session.commit()
        print(f"masters: {added} added, {skipped} already present "
              f"({len(LISTS)} types)")

        fixed = 0
        for sql in VALUE_FIXES:
            fixed += db.session.execute(text(sql)).rowcount
        db.session.commit()
        print(f"drifted rows realigned: {fixed}")

        total_types = db.session.execute(
            text("SELECT COUNT(DISTINCT type) FROM masters")).scalar()
        total_rows = db.session.execute(text("SELECT COUNT(*) FROM masters")).scalar()
        print(f"masters now: {total_types} types, {total_rows} rows")


if __name__ == '__main__':
    main()
