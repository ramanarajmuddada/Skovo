"""
NOT v1 — this migration recreates 12 tables that were removed from version-1.

college_applications, exam_questions, exam_resources, forum_posts,
forum_replies, mock_tests, referrals, resumes, scholarship_tracking,
sop_documents, test_attempts, user_certifications.

Those tables were dropped from the database, their DDL moved to
database/extra_db/tables/, their stored procedures to
database/extra_db/stored_procedures/, and their SQLAlchemy models to
database/extra_db/models/. Their features are hidden in every portal - see the
v1-hidden markers in Skovo/src/App.jsx and automation/utils/v1-surface.js.

schema_apply_ledger records this migration as already applied, so apply_all.py
skips it and the tables stay gone. On a FRESH database, or if the ledger is
ever cleared, it will run and bring all 12 back. That is the one route by which
the v1 schema can quietly regrow.

The file is kept rather than deleted because it also carries v1 schema history
that nothing else records. apply_all.py's own docstring already notes this
migration fails on a fresh database anyway: it reads FROM `mentors`, a table
merged into `achievers` long ago.
"""

"""
SKOVO Full Migration v2  (supersedes migrate_missing_columns.py + migrate_achievers_mentors_merge.py)
Runs ALL DB changes in one idempotent script:
  1. Achievers/Mentors merge  (adds 6 cols, copies mentor rows, re-points FKs)
  2. Extend existing tables   (achievers, users, colleges, abroad programs,
                               cohort_tasks, domains, scholarships, sessions,
                               opportunities)
  3. Create 20 new feature tables
Safe to re-run: every ADD COLUMN / CREATE TABLE checks before acting.
Run from SKOVO_BACKEND/:
    python migrate_full_v2.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(__file__))

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
_bootstrap.skip_if_mentors_dropped()
from portal import InitApp
from portal.models import db
from sqlalchemy import text


# ── helpers ──────────────────────────────────────────────────────────────────

def col(conn, table, column):
    r = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND COLUMN_NAME=:c"
    ), {"t": table, "c": column}).fetchone()
    return r[0] > 0

def idx(conn, table, name):
    r = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t AND INDEX_NAME=:i"
    ), {"t": table, "i": name}).fetchone()
    return r[0] > 0

def tbl(conn, table):
    r = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t"
    ), {"t": table}).fetchone()
    return r[0] > 0

def fk(conn, table, name):
    r = conn.execute(text(
        "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
        "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=:t "
        "AND CONSTRAINT_NAME=:f AND CONSTRAINT_TYPE='FOREIGN KEY'"
    ), {"t": table, "f": name}).fetchone()
    return r[0] > 0

def add_col(conn, table, column, defn):
    if not col(conn, table, column):
        conn.execute(text(f"ALTER TABLE `{table}` ADD COLUMN `{column}` {defn}"))
        conn.execute(text("COMMIT"))
        print(f"  + {table}.{column}")

def create_table(conn, name, ddl):
    if not tbl(conn, name):
        conn.execute(text(ddl))
        conn.execute(text("COMMIT"))
        print(f"  + table {name} created")
    else:
        print(f"  . table {name} already exists")


# ── main ─────────────────────────────────────────────────────────────────────

def run():
    app = InitApp().app()
    with app.app_context():
        conn = db.engine.connect()

        # ── 1. Achievers / Mentors merge ──────────────────────────────────────
        print("\n[1] Merging achievers + mentors ...")
        add_col(conn, 'achievers', 'email',             'VARCHAR(255) NULL')
        add_col(conn, 'achievers', 'password_hash',     'TEXT NULL')
        add_col(conn, 'achievers', 'status',            'VARCHAR(20) NULL')
        add_col(conn, 'achievers', 'phone',             'VARCHAR(20) NULL')
        add_col(conn, 'achievers', 'profile_image_url', 'TEXT NULL')
        add_col(conn, 'achievers', 'domains',           'JSON NULL')

        if not idx(conn, 'achievers', 'uq_achievers_email'):
            conn.execute(text(
                "ALTER TABLE achievers ADD UNIQUE INDEX uq_achievers_email (email)"
            ))
            conn.execute(text("COMMIT"))
            print("  + unique index achievers.email")

        # copy mentors rows (INSERT IGNORE preserves existing IDs so FKs stay valid)
        conn.execute(text("""
            INSERT IGNORE INTO achievers
              (id, full_name, email, password_hash, status, phone, bio, designation,
               company, linkedin_url, domains, skills, profile_image_url,
               is_active, is_verified, created_at, updated_at)
            SELECT id, full_name, email, password_hash, status, phone, bio, designation,
               company, linkedin_url, domains, skills, profile_image_url,
               is_active, is_verified, created_at, updated_at
            FROM mentors
        """))
        conn.execute(text("COMMIT"))
        print("  + mentor rows copied (INSERT IGNORE)")

        # re-point mentor_sessions FK
        for old, new in [('mentor_sessions_ibfk_1', 'fk_ms_achiever')]:
            if fk(conn, 'mentor_sessions', old):
                conn.execute(text(f"ALTER TABLE mentor_sessions DROP FOREIGN KEY `{old}`"))
                conn.execute(text("COMMIT"))
            if not fk(conn, 'mentor_sessions', new):
                conn.execute(text(
                    f"ALTER TABLE mentor_sessions ADD CONSTRAINT `{new}` "
                    "FOREIGN KEY (mentor_id) REFERENCES achievers(id)"
                ))
                conn.execute(text("COMMIT"))
                print(f"  + mentor_sessions FK -> achievers")

        # re-point mentor_mentees FK
        for old, new in [('mentor_mentees_ibfk_1', 'fk_mm_achiever')]:
            if fk(conn, 'mentor_mentees', old):
                conn.execute(text(f"ALTER TABLE mentor_mentees DROP FOREIGN KEY `{old}`"))
                conn.execute(text("COMMIT"))
            if not fk(conn, 'mentor_mentees', new):
                conn.execute(text(
                    f"ALTER TABLE mentor_mentees ADD CONSTRAINT `{new}` "
                    "FOREIGN KEY (mentor_id) REFERENCES achievers(id)"
                ))
                conn.execute(text("COMMIT"))
                print(f"  + mentor_mentees FK -> achievers")

        # ── 2. Extend existing tables ─────────────────────────────────────────
        print("\n[2] Extending existing tables ...")

        # achievers — core columns that may be absent on older DBs
        add_col(conn, 'achievers', 'achievement_title', 'TEXT NULL')
        add_col(conn, 'achievers', 'skills',            'JSON NULL')
        add_col(conn, 'achievers', 'is_featured',       'TINYINT(1) NOT NULL DEFAULT 0')

        # users
        add_col(conn, 'users', 'date_of_birth', 'DATE NULL')
        add_col(conn, 'users', 'gender',         "VARCHAR(10) NULL")
        add_col(conn, 'users', 'linkedin_url',   'TEXT NULL')

        # colleges
        add_col(conn, 'colleges', 'virtual_tour_url', 'TEXT NULL')
        add_col(conn, 'colleges', 'apply_url',         'TEXT NULL')

        # cg_abroad_programs
        add_col(conn, 'cg_abroad_programs', 'intake_season',        'VARCHAR(50) NULL')
        add_col(conn, 'cg_abroad_programs', 'pr_opportunities',     'TEXT NULL')
        add_col(conn, 'cg_abroad_programs', 'application_deadline', 'DATE NULL')

        # cohort_tasks
        add_col(conn, 'cohort_tasks', 'task_type',        'VARCHAR(50) NULL')
        add_col(conn, 'cohort_tasks', 'submission_type',  'VARCHAR(50) NULL')
        add_col(conn, 'cohort_tasks', 'difficulty_level', 'VARCHAR(50) NULL')
        add_col(conn, 'cohort_tasks', 'attachment_url',   'TEXT NULL')
        add_col(conn, 'cohort_tasks', 'task_status',      "VARCHAR(20) NOT NULL DEFAULT 'active'")

        # domains
        add_col(conn, 'domains', 'description', 'TEXT NULL')
        add_col(conn, 'domains', 'is_active',   'TINYINT(1) NOT NULL DEFAULT 1')

        # cg_scholarships
        add_col(conn, 'cg_scholarships', 'provider',             'VARCHAR(300) NULL')
        add_col(conn, 'cg_scholarships', 'scholarship_mode',     'VARCHAR(30) NULL')
        add_col(conn, 'cg_scholarships', 'notification_pdf_url', 'TEXT NULL')
        add_col(conn, 'cg_scholarships', 'deadline_date',        'DATE NULL')
        add_col(conn, 'cg_scholarships', 'scholarship_status',   "VARCHAR(20) NULL DEFAULT 'active'")

        # mentor_sessions
        add_col(conn, 'mentor_sessions', 'scheduled_at',      'DATETIME NULL')
        add_col(conn, 'mentor_sessions', 'video_call_url',     'TEXT NULL')
        add_col(conn, 'mentor_sessions', 'duration_minutes',   'INT NULL DEFAULT 60')

        # opportunities
        add_col(conn, 'opportunities', 'company_logo_url', 'TEXT NULL')
        add_col(conn, 'opportunities', 'company_website',  'TEXT NULL')

        # ── 3. New feature tables ─────────────────────────────────────────────
        print("\n[3] Creating new tables ...")

        create_table(conn, 'mock_tests', """
            CREATE TABLE mock_tests (
                id               CHAR(36)      NOT NULL PRIMARY KEY,
                title            VARCHAR(500)  NOT NULL,
                exam_type        VARCHAR(50),
                description      TEXT,
                duration_minutes INT           DEFAULT 60,
                total_marks      INT           DEFAULT 100,
                pass_marks       INT           DEFAULT 40,
                difficulty       VARCHAR(20)   DEFAULT 'medium',
                is_active        TINYINT(1)    DEFAULT 1,
                created_at       DATETIME(6)   DEFAULT CURRENT_TIMESTAMP(6),
                updated_at       DATETIME(6)   DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                created_by       CHAR(36),
                updated_by       CHAR(36)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'exam_questions', """
            CREATE TABLE exam_questions (
                id              CHAR(36)     NOT NULL PRIMARY KEY,
                mock_test_id    CHAR(36)     NOT NULL,
                question_text   TEXT         NOT NULL,
                question_type   VARCHAR(20)  DEFAULT 'mcq',
                options         JSON,
                correct_answer  TEXT,
                explanation     TEXT,
                marks           INT          DEFAULT 1,
                sort_order      INT          DEFAULT 0,
                created_at      DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at      DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (mock_test_id) REFERENCES mock_tests(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'test_attempts', """
            CREATE TABLE test_attempts (
                id                   CHAR(36)    NOT NULL PRIMARY KEY,
                mock_test_id         CHAR(36)    NOT NULL,
                user_id              CHAR(36)    NOT NULL,
                answers              JSON,
                score                INT,
                total_marks          INT,
                percentage           FLOAT,
                passed               TINYINT(1),
                time_taken_minutes   INT,
                status               VARCHAR(20) DEFAULT 'in_progress',
                started_at           DATETIME,
                completed_at         DATETIME,
                created_at           DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                FOREIGN KEY (mock_test_id) REFERENCES mock_tests(id),
                FOREIGN KEY (user_id)     REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'college_applications', """
            CREATE TABLE college_applications (
                id               CHAR(36)     NOT NULL PRIMARY KEY,
                user_id          CHAR(36)     NOT NULL,
                college_id       CHAR(36),
                college_name     VARCHAR(500),
                program_name     VARCHAR(300),
                exam_type        VARCHAR(50),
                application_date DATE,
                deadline_date    DATE,
                status           VARCHAR(30)  DEFAULT 'planning',
                priority         VARCHAR(10)  DEFAULT 'medium',
                notes            TEXT,
                application_url  TEXT,
                created_at       DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at       DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'college_reviews', """
            CREATE TABLE college_reviews (
                id                   CHAR(36)   NOT NULL PRIMARY KEY,
                college_id           CHAR(36)   NOT NULL,
                user_id              CHAR(36)   NOT NULL,
                rating               INT        NOT NULL,
                academics_rating     INT,
                placement_rating     INT,
                facilities_rating    INT,
                campus_life_rating   INT,
                review_text          TEXT,
                pros                 TEXT,
                cons                 TEXT,
                is_verified          TINYINT(1) DEFAULT 0,
                is_active            TINYINT(1) DEFAULT 1,
                created_at           DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at           DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (college_id) REFERENCES colleges(id),
                FOREIGN KEY (user_id)    REFERENCES users(id),
                UNIQUE KEY uq_college_review (college_id, user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'scholarship_tracking', """
            CREATE TABLE scholarship_tracking (
                id                CHAR(36)     NOT NULL PRIMARY KEY,
                user_id           CHAR(36)     NOT NULL,
                scholarship_id    CHAR(36),
                scholarship_name  VARCHAR(500),
                provider          VARCHAR(300),
                amount            INT,
                deadline_date     DATE,
                status            VARCHAR(30)  DEFAULT 'interested',
                applied_at        DATE,
                result            VARCHAR(30),
                notes             TEXT,
                application_url   TEXT,
                created_at        DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at        DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'forum_posts', """
            CREATE TABLE forum_posts (
                id            CHAR(36)     NOT NULL PRIMARY KEY,
                user_id       CHAR(36)     NOT NULL,
                title         VARCHAR(500) NOT NULL,
                content       TEXT         NOT NULL,
                category      VARCHAR(50)  DEFAULT 'general',
                tags          JSON,
                upvotes       INT          DEFAULT 0,
                views         INT          DEFAULT 0,
                replies_count INT          DEFAULT 0,
                is_pinned     TINYINT(1)   DEFAULT 0,
                is_solved     TINYINT(1)   DEFAULT 0,
                is_active     TINYINT(1)   DEFAULT 1,
                created_at    DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at    DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                deleted_at    DATETIME(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'forum_replies', """
            CREATE TABLE forum_replies (
                id          CHAR(36)    NOT NULL PRIMARY KEY,
                post_id     CHAR(36)    NOT NULL,
                user_id     CHAR(36)    NOT NULL,
                content     TEXT        NOT NULL,
                upvotes     INT         DEFAULT 0,
                is_accepted TINYINT(1)  DEFAULT 0,
                is_active   TINYINT(1)  DEFAULT 1,
                created_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                deleted_at  DATETIME(6),
                FOREIGN KEY (post_id) REFERENCES forum_posts(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'resumes', """
            CREATE TABLE resumes (
                id                  CHAR(36)     NOT NULL PRIMARY KEY,
                user_id             CHAR(36)     NOT NULL,
                title               VARCHAR(300) DEFAULT 'My Resume',
                template            VARCHAR(50)  DEFAULT 'classic',
                personal_info       JSON,
                education           JSON,
                experience          JSON,
                skills              JSON,
                projects            JSON,
                certifications      JSON,
                achievements        JSON,
                languages           JSON,
                summary             TEXT,
                is_active           TINYINT(1)   DEFAULT 1,
                last_downloaded_at  DATETIME,
                created_at          DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at          DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'user_certifications', """
            CREATE TABLE user_certifications (
                id              CHAR(36)     NOT NULL PRIMARY KEY,
                user_id         CHAR(36)     NOT NULL,
                title           VARCHAR(500) NOT NULL,
                provider        VARCHAR(300),
                credential_id   VARCHAR(200),
                issue_date      DATE,
                expiry_date     DATE,
                certificate_url TEXT,
                skills          JSON,
                is_verified     TINYINT(1)   DEFAULT 0,
                created_at      DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at      DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'mentor_availability', """
            CREATE TABLE mentor_availability (
                id           CHAR(36)    NOT NULL PRIMARY KEY,
                mentor_id    CHAR(36)    NOT NULL,
                day_of_week  TINYINT     NOT NULL COMMENT '0=Mon … 6=Sun',
                start_time   TIME        NOT NULL,
                end_time     TIME        NOT NULL,
                is_active    TINYINT(1)  DEFAULT 1,
                created_at   DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at   DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (mentor_id) REFERENCES achievers(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'mentor_slots', """
            CREATE TABLE mentor_slots (
                id          CHAR(36)    NOT NULL PRIMARY KEY,
                mentor_id   CHAR(36)    NOT NULL,
                slot_date   DATE        NOT NULL,
                start_time  TIME        NOT NULL,
                end_time    TIME        NOT NULL,
                session_id  CHAR(36),
                status      VARCHAR(20) DEFAULT 'available',
                created_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (mentor_id) REFERENCES achievers(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'badges', """
            CREATE TABLE badges (
                id          CHAR(36)     NOT NULL PRIMARY KEY,
                name        VARCHAR(200) NOT NULL,
                description TEXT,
                icon_url    TEXT,
                badge_type  VARCHAR(50)  DEFAULT 'achievement',
                criteria    JSON,
                points      INT          DEFAULT 10,
                is_active   TINYINT(1)   DEFAULT 1,
                created_at  DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at  DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'user_badges', """
            CREATE TABLE user_badges (
                id          CHAR(36)  NOT NULL PRIMARY KEY,
                user_id     CHAR(36)  NOT NULL,
                badge_id    CHAR(36)  NOT NULL,
                earned_at   DATETIME  DEFAULT CURRENT_TIMESTAMP,
                created_at  DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id)  REFERENCES users(id),
                FOREIGN KEY (badge_id) REFERENCES badges(id),
                UNIQUE KEY uq_user_badge (user_id, badge_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'user_streaks', """
            CREATE TABLE user_streaks (
                id               CHAR(36)  NOT NULL PRIMARY KEY,
                user_id          CHAR(36)  NOT NULL UNIQUE,
                current_streak   INT       DEFAULT 0,
                longest_streak   INT       DEFAULT 0,
                last_active_date DATE,
                total_points     INT       DEFAULT 0,
                created_at       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
                updated_at       DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'document_vault', """
            CREATE TABLE document_vault (
                id          CHAR(36)     NOT NULL PRIMARY KEY,
                user_id     CHAR(36)     NOT NULL,
                name        VARCHAR(500) NOT NULL,
                file_url    TEXT         NOT NULL,
                file_type   VARCHAR(50),
                file_size   INT,
                category    VARCHAR(50)  DEFAULT 'general',
                tags        JSON,
                is_active   TINYINT(1)   DEFAULT 1,
                created_at  DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at  DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'sop_documents', """
            CREATE TABLE sop_documents (
                id                   CHAR(36)     NOT NULL PRIMARY KEY,
                user_id              CHAR(36)     NOT NULL,
                title                VARCHAR(500) NOT NULL,
                doc_type             VARCHAR(30)  DEFAULT 'sop',
                target_institution   VARCHAR(500),
                target_program       VARCHAR(300),
                content              MEDIUMTEXT,
                word_count           INT,
                status               VARCHAR(20)  DEFAULT 'draft',
                created_at           DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at           DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (user_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'exam_resources', """
            CREATE TABLE exam_resources (
                id            CHAR(36)     NOT NULL PRIMARY KEY,
                title         VARCHAR(500) NOT NULL,
                description   TEXT,
                exam_type     VARCHAR(50),
                subject       VARCHAR(100),
                resource_type VARCHAR(30)  DEFAULT 'notes',
                file_url      TEXT,
                external_url  TEXT,
                thumbnail_url TEXT,
                tags          JSON,
                downloads     INT          DEFAULT 0,
                is_free       TINYINT(1)   DEFAULT 1,
                is_active     TINYINT(1)   DEFAULT 1,
                created_at    DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at    DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                created_by    CHAR(36),
                updated_by    CHAR(36)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'referrals', """
            CREATE TABLE referrals (
                id                CHAR(36)     NOT NULL PRIMARY KEY,
                referrer_id       CHAR(36)     NOT NULL,
                referred_email    VARCHAR(320) NOT NULL,
                referred_user_id  CHAR(36),
                referral_code     VARCHAR(20)  UNIQUE,
                status            VARCHAR(20)  DEFAULT 'pending',
                reward_given      TINYINT(1)   DEFAULT 0,
                created_at        DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                updated_at        DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
                FOREIGN KEY (referrer_id) REFERENCES users(id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        create_table(conn, 'platform_analytics', """
            CREATE TABLE platform_analytics (
                id           CHAR(36)     NOT NULL PRIMARY KEY,
                event_type   VARCHAR(100) NOT NULL,
                entity_type  VARCHAR(50),
                entity_id    CHAR(36),
                user_id      CHAR(36),
                meta         JSON,
                session_id   VARCHAR(100),
                ip_address   VARCHAR(45),
                user_agent   TEXT,
                created_at   DATETIME(6)  DEFAULT CURRENT_TIMESTAMP(6),
                INDEX idx_pa_event   (event_type),
                INDEX idx_pa_user    (user_id),
                INDEX idx_pa_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        """)

        print("\n=== Migration v2 complete! ===")
        conn.close()


if __name__ == '__main__':
    run()
