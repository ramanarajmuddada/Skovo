"""Readiness Score Playbook v2.1 -- phase 1: the data foundation.

WHY
    Skovo_Readiness_Score_Flow.pdf / Skovo_Streak_Points_Model.pdf. Readiness
    becomes one Journey Card per stage (70 earned in three pillar buckets + 30
    completion), and everyday activity moves to a separate Streak Points book
    that can never write readiness. No age-based rules: everyone gets the same.

WHAT THIS ADDS (additive only -- nothing is dropped or switched off here)
    student_stages     + card fields: card_type, card_kind, earned/completion/
                         card score, completion status, result band, boost,
                         result document, expires_at (Skill Card)
    score_events       + card_id, pillar, status (applied/saved/capped),
                         release_at, verification_id, source, actor_id,
                         config_version
    career_streaks     + monthly save and pause-token state
    readiness_settings   one row: every global number (monthly cap 20, unlock 60 ...)
    score_actions        readiness points list, per card (replaces the flat rules)
    card_pillar_config   Clarity / Skill / Proof bucket per card (adds up to 70)
    completion_bands     30 / 25 / 22 / 18 + pending
    grade_conversion     board or university grade -> band
    verification_requests  evidence waiting for the desk / an achiever
    user_readiness       active card, Readiness Index, Active Ready
    sp_settings          streak + Streak Points numbers, multiplier, levels
    sp_actions           Streak Points list
    sp_events            the Streak Points ledger (lifetime + weekly come from it)
    weekly_plans         3 suggested actions per student per week
    config_versions      every config change: who, why, old, new, approval

FEATURE FLAG
    readiness_settings.v21_enabled = 0. The old engine keeps running until the
    new one is switched on (playbook C8 step 1).

Run from the SKOVO_BACKEND folder:
    python database/migrations/migrate_v21_readiness_foundation.py

Safe to re-run: CREATE TABLE IF NOT EXISTS, column checks, INSERT IGNORE seeds.
"""
import json

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db

app = InitApp().app()

CHARSET = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"

# ── new columns on existing tables ───────────────────────────────────────────
COLUMNS = [
    # student_stages -> Journey Card
    ('student_stages', 'card_type', "VARCHAR(30) NULL"),          # class10 / inter / degree_foundation / degree_readiness / skill
    ('student_stages', 'card_kind', "VARCHAR(12) NOT NULL DEFAULT 'worked'"),  # worked / past_result
    ('student_stages', 'earned_score', "DECIMAL(5,2) NOT NULL DEFAULT 0"),
    ('student_stages', 'completion_status', "VARCHAR(12) NOT NULL DEFAULT 'none'"),  # none / pending / awarded
    ('student_stages', 'result_band', "VARCHAR(12) NULL"),        # restricted: desk + student only
    ('student_stages', 'boost_applied', "TINYINT(1) NOT NULL DEFAULT 0"),
    ('student_stages', 'completion_points', "INT NOT NULL DEFAULT 0"),
    ('student_stages', 'card_score', "DECIMAL(5,2) NOT NULL DEFAULT 0"),
    ('student_stages', 'result_doc_id', "CHAR(36) NULL"),
    ('student_stages', 'expires_at', "DATETIME NULL"),
    # score_events -> readiness ledger
    ('score_events', 'card_id', "CHAR(36) NULL"),
    ('score_events', 'pillar', "VARCHAR(10) NULL"),               # clarity / skill / proof
    ('score_events', 'status', "VARCHAR(10) NOT NULL DEFAULT 'applied'"),  # applied / saved / capped
    ('score_events', 'release_at', "DATETIME NULL"),
    ('score_events', 'verification_id', "CHAR(36) NULL"),
    ('score_events', 'source', "VARCHAR(12) NULL"),               # app / n8n / bhaai / admin
    ('score_events', 'actor_id', "CHAR(36) NULL"),
    ('score_events', 'config_version', "INT NULL"),
    # career_streaks -> one day streak with a monthly save and pause tokens
    ('career_streaks', 'save_month', "CHAR(7) NULL"),             # YYYY-MM of the save last used
    ('career_streaks', 'pause_tokens_left', "INT NOT NULL DEFAULT 2"),
    ('career_streaks', 'pause_tokens_year', "SMALLINT NULL"),
    ('career_streaks', 'paused_until', "DATE NULL"),
    ('career_streaks', 'pause_reason', "VARCHAR(20) NULL"),        # token / exam
]

INDEXES = [
    ('score_events', 'ix_se_card', "(`card_id`, `status`)"),
    ('score_events', 'ix_se_release', "(`status`, `release_at`)"),
    ('student_stages', 'ix_stage_card', "(`card_type`, `status`)"),
]

TABLES = [
f"""CREATE TABLE IF NOT EXISTS `readiness_settings` (
  `id`                        TINYINT      NOT NULL DEFAULT 1,
  `v21_enabled`               TINYINT(1)   NOT NULL DEFAULT 0,
  `earned_max`                INT          NOT NULL DEFAULT 70,
  `completion_max`            INT          NOT NULL DEFAULT 30,
  `monthly_cap`               INT          NOT NULL DEFAULT 20,
  `cap_months`                INT          NOT NULL DEFAULT 3,
  `unlock_score`              INT          NOT NULL DEFAULT 60,
  `premium_score`             INT          NOT NULL DEFAULT 65,
  `boost_threshold`           INT          NOT NULL DEFAULT 65,
  `boost_bands`               INT          NOT NULL DEFAULT 1,
  `max_action_points`         INT          NOT NULL DEFAULT 5,
  `max_employer_points`       INT          NOT NULL DEFAULT 8,
  `active_ready_days`         INT          NOT NULL DEFAULT 30,
  `verify_hours`              INT          NOT NULL DEFAULT 48,
  `escalate_hours`            INT          NOT NULL DEFAULT 36,
  `correction_approval_over`  INT          NOT NULL DEFAULT 10,
  `grace_days`                INT          NOT NULL DEFAULT 30,
  `skill_card_months`         INT          NOT NULL DEFAULT 12,
  `promotion_on`              CHAR(5)      NOT NULL DEFAULT '07-01',
  `pass_mark`                 INT          NOT NULL DEFAULT 5,
  `ai_weight`                 DECIMAL(3,2) NOT NULL DEFAULT 0.50,
  `config_version`            INT          NOT NULL DEFAULT 1,
  `updated_at`                DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`                CHAR(36)     NULL,
  PRIMARY KEY (`id`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `score_actions` (
  `action_key`     VARCHAR(50)  NOT NULL,
  `label`          VARCHAR(160) NOT NULL,
  `evidence`       VARCHAR(255) NULL,
  `card_types`     JSON         NOT NULL,
  `pillar`         VARCHAR(10)  NOT NULL,
  `points`         INT          NOT NULL,
  `bonus_points`   INT          NULL,
  `bonus_min_mark` INT          NULL,
  `limit_type`     VARCHAR(12)  NOT NULL,
  `limit_value`    INT          NULL,
  `checked_by`     VARCHAR(20)  NOT NULL,
  `is_employer`    TINYINT(1)   NOT NULL DEFAULT 0,
  `sort_order`     INT          NOT NULL DEFAULT 0,
  `is_active`      TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_at`     DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`     CHAR(36)     NULL,
  PRIMARY KEY (`action_key`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `card_pillar_config` (
  `card_type`   VARCHAR(30) NOT NULL,
  `pillar`      VARCHAR(10) NOT NULL,
  `bucket_size` INT         NOT NULL,
  PRIMARY KEY (`card_type`, `pillar`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `completion_bands` (
  `band`              VARCHAR(12) NOT NULL,
  `label`             VARCHAR(40) NOT NULL,
  `min_percent`       DECIMAL(5,2) NULL,
  `university_grades` JSON        NOT NULL,
  `points`            INT         NOT NULL,
  `is_pending`        TINYINT(1)  NOT NULL DEFAULT 0,
  `sort_order`        INT         NOT NULL,
  PRIMARY KEY (`band`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `grade_conversion` (
  `id`                  CHAR(36)     NOT NULL,
  `board_or_university` VARCHAR(120) NOT NULL,
  `raw_grade`           VARCHAR(30)  NOT NULL,
  `band`                VARCHAR(12)  NOT NULL,
  `created_at`          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_grade` (`board_or_university`, `raw_grade`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `verification_requests` (
  `id`              CHAR(36)     NOT NULL,
  `user_id`         CHAR(36)     NOT NULL,
  `card_id`         CHAR(36)     NULL,
  `action_key`      VARCHAR(50)  NOT NULL,
  `kind`            VARCHAR(12)  NOT NULL DEFAULT 'evidence',  -- evidence / result / offer
  `evidence_doc_id` CHAR(36)     NULL,
  `evidence_url`    VARCHAR(500) NULL,
  `note`            VARCHAR(500) NULL,
  `route_to`        VARCHAR(12)  NOT NULL DEFAULT 'desk',      -- desk / achiever / employer
  `status`          VARCHAR(12)  NOT NULL DEFAULT 'pending',   -- pending / approved / rejected / held
  `auto_check`      JSON         NULL,
  `reviewer_id`     CHAR(36)     NULL,
  `mark`            INT          NULL,
  `feedback`        VARCHAR(500) NULL,
  `reason`          VARCHAR(255) NULL,
  `idempotency_key` VARCHAR(80)  NOT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_at`      DATETIME     NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vr_idem` (`idempotency_key`),
  KEY `ix_vr_queue` (`status`, `route_to`, `created_at`),
  KEY `ix_vr_user` (`user_id`, `created_at`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `user_readiness` (
  `user_id`               CHAR(36)     NOT NULL,
  `active_card_id`        CHAR(36)     NULL,
  `readiness_index`       DECIMAL(5,2) NOT NULL DEFAULT 0,
  `active_ready`          TINYINT(1)   NOT NULL DEFAULT 0,
  `last_checked_work_at`  DATETIME     NULL,
  `grace_until`           DATETIME     NULL,
  `updated_at`            DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `sp_settings` (
  `id`                  TINYINT     NOT NULL DEFAULT 1,
  `streak_seconds`      INT         NOT NULL DEFAULT 30,
  `monthly_saves`       INT         NOT NULL DEFAULT 1,
  `pause_tokens_year`   INT         NOT NULL DEFAULT 2,
  `pause_days`          INT         NOT NULL DEFAULT 21,
  `exam_pause_cards`    JSON        NOT NULL,
  `exam_days_around`    INT         NOT NULL DEFAULT 3,
  `reminder_hours`      JSON        NOT NULL,
  `quiet_from`          TINYINT     NOT NULL DEFAULT 22,
  `quiet_to`            TINYINT     NOT NULL DEFAULT 7,
  `weekly_reset_dow`    TINYINT     NOT NULL DEFAULT 1,
  `multiplier_steps`    JSON        NOT NULL,
  `multiplier_on_bonus` TINYINT(1)  NOT NULL DEFAULT 0,
  `levels`              JSON        NOT NULL,
  `milestones`          JSON        NOT NULL,
  `board_top_n`         INT         NOT NULL DEFAULT 10,
  `config_version`      INT         NOT NULL DEFAULT 1,
  `updated_at`          DATETIME    NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`          CHAR(36)    NULL,
  PRIMARY KEY (`id`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `sp_actions` (
  `sp_action`          VARCHAR(50)  NOT NULL,
  `label`              VARCHAR(160) NOT NULL,
  `points`             INT          NOT NULL,
  `limit_type`         VARCHAR(12)  NOT NULL,   -- daily / weekly / monthly / total / each
  `limit_value`        INT          NULL,
  `multiplier_applies` TINYINT(1)   NOT NULL DEFAULT 1,
  `sort_order`         INT          NOT NULL DEFAULT 0,
  `is_active`          TINYINT(1)   NOT NULL DEFAULT 1,
  `updated_at`         DATETIME     NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by`         CHAR(36)     NULL,
  PRIMARY KEY (`sp_action`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `sp_events` (
  `id`              BIGINT       NOT NULL AUTO_INCREMENT,
  `user_id`         CHAR(36)     NOT NULL,
  `sp_action`       VARCHAR(50)  NOT NULL,
  `base_points`     INT          NOT NULL,
  `multiplier`      DECIMAL(4,2) NOT NULL DEFAULT 1.00,
  `points`          INT          NOT NULL,
  `card_type`       VARCHAR(30)  NULL,
  `community_id`    CHAR(36)     NULL,
  `day`             DATE         NOT NULL,
  `week_start`      DATE         NOT NULL,
  `ref_id`          VARCHAR(64)  NULL,
  `idempotency_key` VARCHAR(120) NOT NULL,
  `created_at`      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_sp_idem` (`idempotency_key`),
  KEY `ix_sp_user_day` (`user_id`, `day`),
  KEY `ix_sp_week` (`week_start`, `card_type`),
  KEY `ix_sp_action` (`user_id`, `sp_action`, `day`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `weekly_plans` (
  `user_id`     CHAR(36) NOT NULL,
  `week_start`  DATE     NOT NULL,
  `action_keys` JSON     NOT NULL,
  `completed`   JSON     NOT NULL,
  `bonus_paid`  TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `week_start`)
) {CHARSET}""",

f"""CREATE TABLE IF NOT EXISTS `config_versions` (
  `id`             CHAR(36)     NOT NULL,
  `area`           VARCHAR(30)  NOT NULL,   -- readiness_settings / score_actions / sp_settings / ...
  `item_key`       VARCHAR(80)  NULL,
  `old_value`      JSON         NULL,
  `new_value`      JSON         NOT NULL,
  `reason`         VARCHAR(500) NOT NULL,
  `effective_from` DATETIME     NOT NULL,
  `status`         VARCHAR(12)  NOT NULL DEFAULT 'pending',  -- pending / applied / rejected / rolled_back
  `impact`         JSON         NULL,
  `created_by`     CHAR(36)     NOT NULL,
  `approved_by`    CHAR(36)     NULL,
  `created_at`     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `decided_at`     DATETIME     NULL,
  PRIMARY KEY (`id`),
  KEY `ix_cv_area` (`area`, `created_at`),
  KEY `ix_cv_status` (`status`, `effective_from`)
) {CHARSET}""",
]

# ── seeds (Proposed values from the playbook; all editable in the admin portal) ─
ALL = ['class10', 'inter', 'degree_foundation', 'degree_readiness', 'skill']

BUCKETS = {
    'class10':           (35, 21, 14),
    'inter':             (28, 25, 17),
    'degree_foundation': (18, 28, 24),
    'degree_readiness':  (7, 25, 38),
    'skill':             (5, 30, 35),
}

BANDS = [
    # band, label, min %, university grades, points, pending, sort
    ('top', 'Top', 70, ['O', 'A+', 'A'], 30, 0, 1),
    ('strong', 'Strong', 60, ['B+'], 25, 0, 2),
    ('good', 'Good', 50, ['B'], 22, 0, 3),
    ('pass', 'Pass', 0, ['C', 'P'], 18, 0, 4),
    ('not_yet', 'Not yet', None, ['F', 'Backlog', 'Absent', 'Withheld'], 0, 1, 5),
]

# key, label, evidence, cards, pillar, points, bonus, bonus_min, limit_type, limit_value, checked_by, employer
ACTIONS = [
    # every card
    ('readiness_check', 'Readiness check', "Completes each of the 4 short parts of the card's readiness check", ALL, 'clarity', 1, None, None, 'per_card', 4, 'app', 0),
    ('set_goal', 'Set a goal', 'Sets a goal with a clear target (stream, college, domain or role)', ALL, 'clarity', 2, None, None, 'per_card', 1, 'app', 0),
    ('goal_update', 'Update the goal', 'Updates the goal with a new clear target', ALL, 'clarity', 1, None, None, 'per_card', 2, 'app', 0),
    ('cohort_task', 'Cohort task', 'Submits the cohort task and it is marked', ALL, 'skill', 2, 3, 7, 'each', None, 'achiever', 0),
    ('free_challenge', 'Free challenge', 'Completes a free achiever challenge and it is marked', ALL, 'skill', 2, None, None, 'per_month', 2, 'achiever', 0),
    ('certificate', 'Certificate', 'External course or competition certificate', ALL, 'proof', 3, None, None, 'per_card', 4, 'ops', 0),
    ('shortlisted', 'Shortlisted', 'An employer or program shortlists the student', ALL, 'proof', 6, None, None, 'each', None, 'employer', 1),
    ('selected', 'Selected', 'Selected for an internship, job, program or scholarship', ALL, 'proof', 8, None, None, 'each', None, 'employer', 1),
    # Class 10
    ('interest_check', 'Interest check', 'Completes the career-interest test', ['class10'], 'clarity', 3, None, None, 'per_card', 1, 'app', 0),
    ('stream_explorer', 'Stream explorer', 'Passes the quiz at the end of each stream module', ['class10'], 'clarity', 1, None, None, 'per_card', 8, 'app', 0),
    ('cohort_reflection_c10', 'Cohort reflection', 'Short reflection after a career cohort, marked', ['class10'], 'clarity', 2, None, None, 'per_card', 6, 'achiever', 0),
    ('stream_decision', 'Stream decision', 'Stream choice with reasons, reviewed by an achiever', ['class10'], 'clarity', 5, None, None, 'per_card', 1, 'achiever', 0),
    ('skill_quiz', 'Skill quiz', 'Passes an in-app aptitude or subject quiz', ['class10'], 'skill', 1, None, None, 'per_month', 4, 'app', 0),
    ('competition', 'Competition', 'Olympiad or competition participation', ['class10', 'inter'], 'proof', 4, None, None, 'per_card', 3, 'ops', 0),
    # Intermediate
    ('exam_roadmap', 'Exam roadmap', 'Entrance-exam plan with dated milestones', ['inter'], 'clarity', 3, None, None, 'per_card', 1, 'app', 0),
    ('college_shortlist', 'College shortlist', 'Shortlists 5 or more colleges with a reason for each', ['inter'], 'clarity', 3, None, None, 'per_card', 1, 'app', 0),
    ('cohort_reflection_inter', 'Cohort reflection', 'Short reflection after a career cohort, marked', ['inter'], 'clarity', 2, None, None, 'per_card', 5, 'achiever', 0),
    ('course_decision', 'Course decision', 'Degree and branch choice with reasons, reviewed by an achiever', ['inter'], 'clarity', 5, None, None, 'per_card', 1, 'achiever', 0),
    ('mock_test', 'Mock test', 'In-app mock test, or a checked scorecard upload', ['inter'], 'skill', 2, None, None, 'per_month', 4, 'app', 0),
    ('exam_registration', 'Exam registration', 'Entrance exam registration', ['inter'], 'proof', 3, None, None, 'per_card', 3, 'ops', 0),
    # Degree Foundation
    ('pick_domain', 'Pick a domain', 'Picks a target domain', ['degree_foundation'], 'clarity', 3, None, None, 'per_card', 1, 'app', 0),
    ('domain_change', 'Change the domain', 'Changes the target domain', ['degree_foundation'], 'clarity', 1, None, None, 'per_card', 1, 'app', 0),
    ('skill_roadmap', 'Skill roadmap', 'Creates a skill roadmap and finishes its first milestone', ['degree_foundation'], 'clarity', 3, None, None, 'per_card', 1, 'app', 0),
    ('cohort_reflection_df', 'Cohort reflection', 'Short reflection after a domain cohort, marked', ['degree_foundation'], 'clarity', 2, None, None, 'per_card', 3, 'achiever', 0),
    ('skill_test', 'Skill test', 'Passes an in-app domain skill test', ['degree_foundation', 'degree_readiness'], 'skill', 3, None, None, 'per_card', 4, 'app', 0),
    ('project', 'Project', 'Submits a project and an achiever passes it', ['degree_foundation', 'degree_readiness', 'skill'], 'proof', 4, None, None, 'per_card', 4, 'achiever', 0),
    ('hackathon', 'Hackathon', 'Hackathon participation', ['degree_foundation', 'degree_readiness'], 'proof', 4, None, None, 'per_card', 3, 'ops', 0),
    ('gig_completed', 'Gig completed', 'Finishes a freelance, part-time or contract gig', ['degree_foundation', 'degree_readiness', 'skill'], 'proof', 5, None, None, 'each', None, 'employer', 1),
    # Degree Readiness
    ('career_plan', 'Career plan', 'Lists target roles and employers', ['degree_readiness'], 'clarity', 1, None, None, 'per_card', 1, 'app', 0),
    ('mock_interview', 'Mock interview', 'Completes a mock interview (achiever now, BhaAI later)', ['degree_readiness'], 'skill', 4, None, None, 'per_card', 4, 'achiever', 0),
    ('resume', 'Resume', 'Resume reviewed and passed by an achiever', ['degree_readiness'], 'proof', 4, None, None, 'per_card', 1, 'achiever', 0),
    ('portfolio', 'Portfolio', 'Public profile live with at least 2 passed projects', ['degree_readiness'], 'proof', 2, None, None, 'per_card', 1, 'app', 0),
    ('internship_completed', 'Internship completed', 'Employer confirms the internship was completed', ['degree_readiness', 'skill'], 'proof', 8, None, None, 'each', None, 'employer', 1),
    # Skill Card
    ('advanced_skill_test', 'Advanced skill test', 'Passes an advanced in-app skill test for the target role', ['skill'], 'skill', 3, None, None, 'per_card', 6, 'app', 0),
    ('mock_interview_role', 'Mock interview', 'Mock interview for the target role', ['skill'], 'skill', 4, None, None, 'per_card', 6, 'achiever', 0),
]

# sp_action, label, points, limit_type, limit_value, multiplier applies
SP_ACTIONS = [
    ('app_open', 'Open the app (streak day)', 10, 'daily', 1, 1),
    ('daily_task', 'Daily Career Task', 20, 'daily', 1, 1),
    ('weekly_plan_done', 'Finish all 3 Weekly Plan actions', 100, 'weekly', 1, 1),
    ('streak_7', '7-day streak bonus', 50, 'each', None, 0),
    ('streak_30', '30-day streak bonus', 200, 'each', None, 0),
    ('streak_100', '100-day streak bonus', 1000, 'each', None, 0),
    ('community_post', 'Post in a community', 5, 'daily', 3, 1),
    ('post_reactions', 'Post gets 5 reactions', 5, 'daily', 2, 1),
    ('community_join', 'Join a community', 10, 'total', 5, 1),
    ('cohort_attended', 'Attend a cohort (checked in)', 30, 'each', None, 1),
    ('opportunity_apply', 'Apply to an opportunity', 10, 'weekly', 5, 1),
    ('profile_complete', 'Complete profile', 50, 'total', 1, 1),
    ('document_upload', 'Upload a document', 5, 'total', 10, 1),
    ('referral_joined', 'Friend joins and finishes their readiness check', 100, 'monthly', 10, 1),
]

SP_DEFAULTS = {
    'exam_pause_cards': ['class10', 'inter'],
    'reminder_hours': [19, 21],
    'multiplier_steps': [{'from': 0, 'x': 1.0}, {'from': 7, 'x': 1.2}, {'from': 30, 'x': 1.5}, {'from': 100, 'x': 2.0}],
    'levels': [{'name': 'Bronze', 'sp': 1000}, {'name': 'Silver', 'sp': 3000},
               {'name': 'Gold', 'sp': 7500}, {'name': 'Platinum', 'sp': 20000}],
    'milestones': {'7': 'streak_7', '30': 'streak_30', '100': 'streak_100'},
}

# Existing stage rows -> card type. UG / polytechnic / ITI years 1-2 are the
# Degree Foundation card, years 3+ Degree Readiness. PG and other stay off cards.
CARD_BACKFILL = """
UPDATE student_stages SET card_type = CASE
    WHEN stage_group = 'class_10' THEN 'class10'
    WHEN stage_group = 'intermediate' THEN 'inter'
    WHEN stage_group IN ('ug', 'polytechnic', 'iti')
         AND CAST(IFNULL(NULLIF(sub_year, ''), '1') AS UNSIGNED) >= 3 THEN 'degree_readiness'
    WHEN stage_group IN ('ug', 'polytechnic', 'iti') THEN 'degree_foundation'
    ELSE NULL END
 WHERE card_type IS NULL
"""


def has_column(table, col):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': col}).scalar() > 0


def has_index(table, name):
    return db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :n"
    ), {'t': table, 'n': name}).scalar() > 0


def seed():
    ex = db.session.execute
    ex(text("INSERT IGNORE INTO readiness_settings (id) VALUES (1)"))
    ex(text("INSERT IGNORE INTO sp_settings (id, exam_pause_cards, reminder_hours, multiplier_steps, levels, milestones) "
            "VALUES (1, :c, :r, :m, :l, :ms)"),
       {'c': json.dumps(SP_DEFAULTS['exam_pause_cards']), 'r': json.dumps(SP_DEFAULTS['reminder_hours']),
        'm': json.dumps(SP_DEFAULTS['multiplier_steps']), 'l': json.dumps(SP_DEFAULTS['levels']),
        'ms': json.dumps(SP_DEFAULTS['milestones'])})
    for card, sizes in BUCKETS.items():
        for pillar, size in zip(('clarity', 'skill', 'proof'), sizes):
            ex(text("INSERT IGNORE INTO card_pillar_config (card_type, pillar, bucket_size) VALUES (:c, :p, :s)"),
               {'c': card, 'p': pillar, 's': size})
    for band, label, pct, grades, pts, pending, sort in BANDS:
        ex(text("INSERT IGNORE INTO completion_bands (band, label, min_percent, university_grades, points, is_pending, sort_order) "
                "VALUES (:b, :l, :m, :g, :p, :pe, :s)"),
           {'b': band, 'l': label, 'm': pct, 'g': json.dumps(grades), 'p': pts, 'pe': pending, 's': sort})
    for i, (key, label, evidence, cards, pillar, pts, bonus, bonus_min, lt, lv, checker, employer) in enumerate(ACTIONS):
        ex(text("INSERT IGNORE INTO score_actions (action_key, label, evidence, card_types, pillar, points, bonus_points, "
                "bonus_min_mark, limit_type, limit_value, checked_by, is_employer, sort_order) "
                "VALUES (:k, :l, :e, :c, :p, :pts, :b, :bm, :lt, :lv, :ck, :em, :s)"),
           {'k': key, 'l': label, 'e': evidence, 'c': json.dumps(cards), 'p': pillar, 'pts': pts, 'b': bonus,
            'bm': bonus_min, 'lt': lt, 'lv': lv, 'ck': checker, 'em': employer, 's': i})
    for i, (key, label, pts, lt, lv, mult) in enumerate(SP_ACTIONS):
        ex(text("INSERT IGNORE INTO sp_actions (sp_action, label, points, limit_type, limit_value, multiplier_applies, sort_order) "
                "VALUES (:k, :l, :p, :lt, :lv, :m, :s)"),
           {'k': key, 'l': label, 'p': pts, 'lt': lt, 'lv': lv, 'm': mult, 's': i})


def main():
    with app.app_context():
        for ddl in TABLES:
            db.session.execute(text(ddl))
        for table, col, ddl in COLUMNS:
            if not has_column(table, col):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{col}` {ddl}"))
                print(f"  + {table}.{col}")
        for table, name, cols in INDEXES:
            if not has_index(table, name):
                db.session.execute(text(f"ALTER TABLE `{table}` ADD INDEX `{name}` {cols}"))
        db.session.commit()
        seed()
        n = db.session.execute(text(CARD_BACKFILL)).rowcount
        db.session.commit()
        print(f"  stage rows mapped to a Journey Card: {n}")
        print("migrate_v21_readiness_foundation: done (v21_enabled = 0)")


if __name__ == '__main__':
    main()
