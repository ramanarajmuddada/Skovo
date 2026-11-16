import logging

logger = logging.getLogger("skovo")


def init_app():
    # ── Authentication ─────────────────────────────────────────────────────────
    from .Auth import send_otp, verify_otp, refresh_token, me, logout, register, password_login, reset_password, accept_invite, public_masters, consent, geo, academics, courses, parent_view

    # ── Dashboard ──────────────────────────────────────────────────────────────
    from .Dashboard import dashboard

    # ── Cohorts (Sunday Achiever Cohorts) ──────────────────────────────────────
    from .Cohorts import cohorts

    # ── Colleges ──────────────────────────────────────────────────────────────
    from .Colleges import colleges

    # ── Opportunities ─────────────────────────────────────────────────────────
    from .Opportunities import opportunities

    # ── My Applications ───────────────────────────────────────────────────────
    from .Applications import applications

    # ── Assemble (Community) ──────────────────────────────────────────────────
    from .Assemble import assemble, chat

    # ── Coaching Centres ──────────────────────────────────────────────────────
    from .CoachingCentres import coaching_centres

    # ── Profile ───────────────────────────────────────────────────────────────
    from .Profile import profile, goals, stages, data_rights

    # ── Readiness Assessment ──────────────────────────────────────────────────
    from .Readiness import readiness, score, v21

    # ── BhaAI (grounded career chat, v1) ─────────────────────────────────────
    from .BhaAI import bhaai

    # ── Achievers (student-facing browse + book, portal, auth) ───────────────
    from .Achiever import achiever, achiever_auth, achiever_register, achiever_referrals, achiever_quiz

    # ── Achiever Payouts (portal) ─────────────────────────────────────────────
    from .Payouts import payouts

    # ── Achiever Application (evidence, agreements, trust status) ─────────────
    from .AchieverApplication import achiever_application, achiever_lifecycle

    # ── Achiever Availability & Slots ─────────────────────────────────────────
    from .AchieverAvailability import achiever_availability
    from .AchieverAvailability import offerings  # noqa: F401  1-on-1s + hours

    # ── Achiever Reviews (student ratings of achievers) ───────────────────────
    from .AchieverReviews import achiever_reviews

    # ── Bookings (student) ────────────────────────────────────────────────────
    from .Bookings import bookings

    # ── Tasks (student) ───────────────────────────────────────────────────────
    from .Tasks import tasks, quiz

    # ── Notifications ─────────────────────────────────────────────────────────
    from .Notifications import notifications

    # ── Career Guidance (student-facing) ──────────────────────────────────────
    from .CareerGuidance import cg_routes

    # ── Admin Panel ───────────────────────────────────────────────────────────
    from .Admin import (admin_auth, admin_stats, admin_users, admin_cohorts, admin_colleges,
        admin_achiever_lifecycle, admin_console,
        admin_opportunities, admin_achievers, admin_domains, admin_coaching, admin_invites,
        admin_audit, admin_achiever_accounts, admin_bookings, admin_payments, admin_tasks,
        admin_readiness_rules, admin_cg_colleges, admin_cg_branches, admin_cg_entrance_exams,
        admin_cg_scholarships, admin_cg_govt_exams, admin_cg_abroad, admin_cg_ai_prompts,
        admin_cg_rank_data, admin_cg_content, admin_masters, admin_error_logs,
        admin_courses, admin_college_reviews, admin_referrals, admin_payouts,
        admin_communities, admin_subscriptions, admin_market, admin_score_rules,
        admin_moderation, admin_import, admin_achiever_trust, admin_cities,
        admin_support, admin_stages, admin_streaks, admin_leaderboard, admin_readiness_v21, admin_achiever_guidelines, admin_achiever_cohorts, admin_tasks_v1, admin_community_v1, admin_engagement, admin_wallet, admin_platform_v1, admin_site_faqs, admin_company,
        # Courses & Trades (Admin → Content). Dropped by the 078ad8c merge, so
        # every /course-catalogue route 404ed and the screen loaded empty.
        admin_course_catalogue)

    # ── Super Admin Panel ─────────────────────────────────────────────────────
    # super_register is deliberately NOT imported: super-admin self-registration
    # was removed on 2026-09-06 (login-only console). Leaving the import here
    # would keep POST /skovo-platform-owner/register and its send-otp live on the
    # server while the SPA merely stopped linking to them.
    from .Super import (super_auth, super_admins, super_platform,
        super_console,
        super_resources, super_achiever_trust, super_v1)

    # ── New Features ──────────────────────────────────────────────────────────
    from .MockTests import mock_tests
    from .CollegeApplications import college_applications
    from .CollegeReviews import college_reviews
    from .ScholarshipTracking import scholarship_tracking
    from .Forum import forum
    from .Resumes import resumes
    from .Certifications import certifications
    from .DocumentVault import document_vault
    from .Market import market
    from .SOPBuilder import sop_builder
    from .ExamResources import exam_resources
    from .Gamification import gamification, streaks, leaderboard_v1
    from .Engagement import engagement as engagement_v1

    # ── System Design Features ────────────────────────────────────────────────
    from .Webhooks import webhooks
    from .Payments import payments, wallet as wallet_routes
    from .Upload import upload
    from .Chat import chat
    from .Admin import admin_analytics

    # ── Achiever Courses ──────────────────────────────────────────────────
    from .AchieverCourses import achiever_courses

    # ── Referrals (student) ───────────────────────────────────────────────
    from .Referrals import referrals

    # ── Billing: coupons + invoices ───────────────────────────────────────
    from .Billing import billing

    # ── Skovo Pro subscription ────────────────────────────────────────────
    from .Subscription import subscription

    # ── Help & support (student / achiever / public contacts) ─────────────
    from .Support import support

    # ── Public landing-page data (no session) ─────────────────────────────
    from .Public import landing

    logger.info("All SKOVO routes registered successfully")
