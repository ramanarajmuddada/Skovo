"""
Migration: the last 21 hardcoded dropdowns, across every portal.

This finishes the sweep. Two more silent drifts turned up while collecting them,
both between a student screen and the admin screen that feeds it:

    exam resource types   student: notes, question_paper, video, book, …
                          admin:   pdf, video, article, quiz, ebook, notes, …
    exam types            student: 8 exams        admin: 11 exams

An admin could tag a resource "pdf" and the student filter had no such option,
so the resource was invisible. Both are reconciled into one list here.

Lists that begin with 'all' keep that entry in code — it is a UI filter, not a
value anything stores.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_dropdown_masters_final.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

_bootstrap.skip_if_masters_dropped()
from portal import InitApp
from portal.models import db

app = InitApp().app()

LISTS = {
    # ── Career Guidance surfaces ─────────────────────────────────────────────
    'abroad_program': [
        ('MS', 'MS'), ('MBA', 'MBA'), ('PhD', 'PhD'),
        ('BTech', 'B.Tech'), ('MArch', 'M.Arch'),
    ],
    'branch_category': [
        ('engineering', 'Engineering'), ('science', 'Science'), ('arts', 'Arts'),
        ('commerce', 'Commerce'), ('medical', 'Medical'),
    ],
    'entrance_exam_scope': [
        ('state', 'State'), ('national', 'National'), ('university', 'University'),
    ],
    'govt_exam_category': [
        ('upsc', 'UPSC'), ('ssc', 'SSC'), ('banking', 'Banking'), ('railway', 'Railway'),
        ('state', 'State PSC'), ('police', 'Police / Defence'), ('teaching', 'Teaching'),
    ],
    'scholarship_type': [
        ('central', 'Central Government'), ('state', 'State Government'),
        ('private', 'Private / Corporate'), ('international', 'International'),
    ],
    'coaching_category': [
        ('JEE', 'JEE'), ('NEET', 'NEET'), ('Coding', 'Coding'), ('Skill Dev', 'Skill Development'),
        ('Finance', 'Finance'), ('Design', 'Design'), ('Management', 'Management'),
    ],

    # ── Trackers ─────────────────────────────────────────────────────────────
    'college_application_status': [
        ('planning', 'Planning'), ('applied', 'Applied'), ('under_review', 'Under Review'),
        ('interview', 'Interview'), ('accepted', 'Accepted'), ('rejected', 'Rejected'),
        ('waitlisted', 'Waitlisted'), ('withdrawn', 'Withdrawn'),
    ],
    'application_priority': [
        ('low', 'Low'), ('medium', 'Medium'), ('high', 'High'),
    ],
    'scholarship_status': [
        ('interested', 'Interested'), ('applied', 'Applied'), ('under_review', 'Under Review'),
        ('interview', 'Interview'), ('awarded', 'Awarded'), ('rejected', 'Rejected'),
        ('withdrawn', 'Withdrawn'),
    ],
    'sop_doc_type': [
        ('sop', 'Statement of Purpose'), ('lor', 'Letter of Recommendation'),
        ('personal_statement', 'Personal Statement'), ('motivation_letter', 'Motivation Letter'),
    ],

    # ── Exam resources — reconciled across student and admin ─────────────────
    # The student page filtered on content shape (notes, question paper) while
    # admin tagged file format (pdf, ebook). One list, both meanings kept.
    'exam_resource_exam': [
        ('JEE', 'JEE'), ('NEET', 'NEET'), ('CAT', 'CAT'), ('GATE', 'GATE'),
        ('UPSC', 'UPSC'), ('SSC', 'SSC'), ('Banking', 'Banking'), ('GRE', 'GRE'),
        ('GMAT', 'GMAT'), ('SAT', 'SAT'), ('IELTS', 'IELTS'), ('TOEFL', 'TOEFL'),
        ('Other', 'Other'),
    ],
    'exam_resource_type': [
        ('notes', 'Notes'), ('question_paper', 'Question Paper'),
        ('practice_set', 'Practice Set'), ('formula_sheet', 'Formula Sheet'),
        ('video', 'Video'), ('book', 'Book'), ('ebook', 'E-book'),
        ('article', 'Article'), ('quiz', 'Quiz'), ('pdf', 'PDF'), ('other', 'Other'),
    ],

    # ── Admin-only ───────────────────────────────────────────────────────────
    'audit_action': [
        ('user.role_changed', 'User role changed'), ('user.status_changed', 'User status changed'),
        ('invite.created', 'Invite created'), ('invite.revoked', 'Invite revoked'),
        ('invite.accepted', 'Invite accepted'),
    ],
    'audit_resource': [
        ('user', 'User'), ('invitation', 'Invitation'), ('cohort', 'Cohort'),
        ('college', 'College'), ('opportunity', 'Opportunity'),
    ],
    'cg_content_type': [
        ('article', 'Article'), ('blog', 'Blog'), ('notification', 'Notification'),
        ('announcement', 'Announcement'), ('exam_update', 'Exam Update'),
    ],
    'cg_audience': [
        ('10th', '10th'), ('intermediate', 'Intermediate'), ('diploma', 'Diploma'),
        ('degree', 'Degree'), ('btech', 'B.Tech'), ('mtech', 'M.Tech'), ('all', 'Everyone'),
    ],
    'rank_data_exam': [
        ('EAMCET', 'EAMCET'), ('ECET', 'ECET'), ('JEE', 'JEE'), ('NEET', 'NEET'),
    ],
}


def upsert(mtype, value, label, order):
    row = db.session.execute(
        text("SELECT `id` FROM `masters` WHERE `type` = :t AND `value` = :v"),
        {'t': mtype, 'v': value}).fetchone()
    if row:
        db.session.execute(text(
            "UPDATE `masters` SET `label` = :l, `sort_order` = :s, `is_active` = 1 WHERE `id` = :i"),
            {'l': label, 's': order, 'i': row[0]})
        return 0
    db.session.execute(text("""
        INSERT INTO `masters` (`id`, `type`, `value`, `label`, `sort_order`, `is_active`)
        VALUES (:i, :t, :v, :l, :s, 1)
    """), {'i': str(uuid.uuid4()), 't': mtype, 'v': value, 'l': label, 's': order})
    return 1


def main():
    with app.app_context():
        added = 0
        for mtype, rows in LISTS.items():
            for i, (value, label) in enumerate(rows):
                added += upsert(mtype, value, label, (i + 1) * 10)
        db.session.commit()

        types = db.session.execute(text(
            "SELECT COUNT(DISTINCT `type`) FROM `masters` WHERE `is_active` = 1")).scalar()
        rows = db.session.execute(text(
            "SELECT COUNT(1) FROM `masters` WHERE `is_active` = 1")).scalar()
        print(f"rows added: {added} | new types: {len(LISTS)}")
        print(f"masters now: {types} active types, {rows} rows")


if __name__ == "__main__":
    main()
