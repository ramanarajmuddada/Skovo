from flask_sqlalchemy import SQLAlchemy
from flask_migrate import Migrate

db = SQLAlchemy()
migrate = Migrate()


def init_app(app):
    db.init_app(app)
    migrate.init_app(app, db)

    app.logger.info("Initialized models")

    with app.app_context():

        # ── Core Auth ────────────────────────────────────────────────────────
        from .users import Users
        from .auth_identities import AuthIdentities
        from .sessions import Sessions
        from .otp_requests import OtpRequests
        # ── User Profile & Readiness ─────────────────────────────────────────
        from .user_profiles import UserProfiles
        from .user_skills import UserSkills
        from .readiness_scores import ReadinessScores
        from .readiness_assessments import ReadinessAssessments

        # ── Lookup / Master Data ─────────────────────────────────────────────
        from .domains import Domains
        from .masters import Masters
        # Entities with children or attributes of their own get a real table;
        # `masters` keeps only flat label lists (gender, category, statuses).
        from .states import States
        from .cities import Cities
        from .boards import Boards
        from .streams import Streams
        from .course_catalogue import CourseCatalogue
        from .student_goals import StudentGoals

        # ── Cohorts ──────────────────────────────────────────────────────────
        from .achievers import Achievers
        from .cohorts import Cohorts
        from .cohort_enrollments import CohortEnrollments
        from .cohort_tasks import CohortTasks
        from .task_submissions import TaskSubmissions

        # ── Colleges ─────────────────────────────────────────────────────────
        from .colleges import Colleges
        from .college_courses import CollegeCourses
        from .college_placement_insights import CollegePlacementInsights

        # ── Opportunities ────────────────────────────────────────────────────
        from .opportunities import Opportunities
        from .opportunity_applications import OpportunityApplications

        # ── Assemble (Community) ─────────────────────────────────────────────
        from .groups import Groups
        from .group_memberships import GroupMemberships
        from .group_posts import GroupPosts
        from .group_post_likes import GroupPostLikes

        # ── Coaching Centres ─────────────────────────────────────────────────

        # ── Achiever Sessions & Mentees ───────────────────────────────────────
        from .achiever_mentees import AchieverMentees
        from .achiever_sessions import AchieverSessions
        from .achiever_reviews import AchieverReviews
        from .payout_requests import PayoutRequests

        # ── Payments ──────────────────────────────────────────────────────────
        from .payment_orders import PaymentOrders
        from .payment_events import PaymentEvents
        from .ledger_entries import LedgerEntries
        from .commission_rules import CommissionRules
        from .payment_settings import PaymentSettings

        # ── Notifications & Infra ─────────────────────────────────────────────
        from .device_tokens import DeviceTokens
        from .notification_logs import NotificationLogs
        from .audit_logs import AuditLogs
        from .error_logs import ErrorLogs
        from .invitations import Invitations
        from .super_admins import SuperAdmins
        from .admins import Admins
        from .readiness_rules import ReadinessRules
        from .pro_free_limits import ProFreeLimits
        from .support_contacts import SupportContacts
        from .support_issues import SupportIssues

        # ── New Feature Tables ────────────────────────────────────────────────
        from .college_reviews import CollegeReviews
        from .achiever_availability import AchieverAvailability
        from .achiever_slots import AchieverSlots
        from .badges import Badges
        from .user_badges import UserBadges
        from .user_streaks import UserStreaks
        from .document_vault import DocumentVault
        from .platform_analytics import PlatformAnalytics
        from .session_messages import SessionMessages

        # ── Achiever Courses ──────────────────────────────────────────────────
        from .achiever_courses import AchieverCourses
        from .course_modules import CourseModules
        from .course_enrollments import CourseEnrollments
        from .course_progress import CourseProgress

        # ── Billing: coupons + invoices ───────────────────────────────────────
        from .coupons import Coupons, CouponRedemptions
        from .invoices import Invoices

        app.logger.info("All models imported successfully")

        # The 23 non-v1 models were removed here, not commented out: their
        # imports are what made db.create_all() below recreate the tables.
        # Dropping those tables while these lines existed achieved nothing -
        # the next boot rebuilt every one. The model files are kept in
        # database/extra_db/models/ so a shelved feature can be restored.
        #
        # Their stored procedures and table DDL are in database/extra_db/.

        # Auto-create any tables that don't exist yet (safe — won't drop/alter existing tables)
        db.create_all()
        app.logger.info("Database tables verified / created")

