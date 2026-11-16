"""Referral reward rules, grants, and the referral_bonus score row.

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_referral_rewards.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

WANT = [
    'sp_referral_rules_list',
    'sp_referral_rule_upsert',
    'sp_referral_rule_delete',
    'sp_referral_find_referrer',
    'sp_referral_bind',
    'sp_referral_attended',
    'sp_referral_qualifying',
    'sp_referral_grant_put',
    'sp_referral_grant_summary',
    'sp_referral_score_add',
    'sp_referral_pro_extend',
    'sp_referral_referrer_of',
    'sp_referral_grants_for',
    'sp_referrals_by_referrer',
    'sp_referrals_send',
    'sp_referral_pay_add',
    'sp_referral_seats_add',
    'sp_referral_coupon_create',
    'sp_subscription_activate_for_order',
    'sp_student_coupon_validate',
]


def _add_column(table, column, ddl):
    have = db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.COLUMNS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c"
    ), {'t': table, 'c': column}).scalar()
    if not int(have or 0):
        db.session.execute(text(f"ALTER TABLE `{table}` ADD COLUMN {ddl}"))
        db.session.commit()
        print(f'  added {table}.{column}')


def _load_table(path):
    ddl = open(path, encoding='utf-8').read()
    lines = [ln for ln in ddl.splitlines() if not ln.strip().startswith('--')]
    ddl = '\n'.join(lines)
    for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
        db.session.execute(text(stmt))
    db.session.commit()


def _has_index(table, name):
    return int(db.session.execute(text(
        "SELECT COUNT(*) FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :n"
    ), {'t': table, 'n': name}).scalar() or 0) > 0


def _index_columns(table, name):
    return [r[0] for r in db.session.execute(text(
        "SELECT COLUMN_NAME FROM information_schema.STATISTICS "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND INDEX_NAME = :n "
        "ORDER BY SEQ_IN_INDEX"
    ), {'t': table, 'n': name}).fetchall()]


def _fix_referrals():
    """The live table predates referrals.sql: created_at and updated_at had no
    default, so every row was written with NULLs. Give them defaults and fill
    the gaps. completed_at is new; a friend who already joined keeps being
    counted by the rules that exist today."""
    db.session.execute(text(
        "UPDATE referrals SET created_at = COALESCE(created_at, updated_at, UTC_TIMESTAMP()) "
        "WHERE created_at IS NULL"
    ))
    db.session.execute(text(
        "UPDATE referrals SET updated_at = COALESCE(updated_at, created_at) WHERE updated_at IS NULL"
    ))
    db.session.execute(text("UPDATE referrals SET status = 'pending' WHERE status IS NULL"))
    db.session.execute(text(
        "ALTER TABLE referrals "
        "MODIFY created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "
        "MODIFY updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, "
        "MODIFY status VARCHAR(20) NULL DEFAULT 'pending', "
        "MODIFY reward_given TINYINT(1) NULL DEFAULT 0"
    ))
    db.session.commit()
    _add_column('referrals', 'completed_at', 'completed_at DATETIME NULL')
    # A rule pays friends who completed at or after its created_at. Stamping
    # existing friends with now keeps them counted by every rule that exists
    # today, and by no rule created later.
    db.session.execute(text(
        "UPDATE referrals SET completed_at = UTC_TIMESTAMP() "
        "WHERE status = 'completed' AND completed_at IS NULL"
    ))
    db.session.commit()
    print('table referrals: dates and completed_at fixed')


def _fix_grants():
    """Grant rows were unique per friend, so a milestone reached again with a
    different Nth friend paid twice. once_key makes a milestone one row."""
    _add_column('referral_grants', 'once_key', "once_key VARCHAR(40) NULL")
    db.session.execute(text(
        "UPDATE referral_grants "
        "SET once_key = IF(milestone_count > 0, 'milestone', friend_user_id) "
        "WHERE once_key IS NULL"
    ))
    db.session.execute(text("ALTER TABLE referral_grants MODIFY once_key VARCHAR(40) NOT NULL"))
    if _index_columns('referral_grants', 'uq_referral_grant_once') != [
            'rule_id', 'referrer_id', 'once_key', 'milestone_count']:
        if _has_index('referral_grants', 'uq_referral_grant_once'):
            db.session.execute(text("ALTER TABLE referral_grants DROP INDEX uq_referral_grant_once"))
        db.session.execute(text(
            "ALTER TABLE referral_grants ADD UNIQUE KEY uq_referral_grant_once "
            "(rule_id, referrer_id, once_key, milestone_count)"
        ))
    db.session.commit()
    print('table referral_grants: once_key ready')


def main():
    with app.app_context():
        _load_table('database/tables/referrals.sql')
        db.session.execute(text(
            "ALTER TABLE referrals MODIFY referral_code VARCHAR(40) NULL"
        ))
        db.session.commit()
        print('table referrals: ready')
        _load_table('database/tables/referral_reward_rules.sql')
        print('table referral_reward_rules: ready')
        _load_table('database/tables/referral_grants.sql')
        print('table referral_grants: ready')
        for table, column, ddl in (
            ('referrals', 'referrer_audience', "referrer_audience VARCHAR(20) NOT NULL DEFAULT 'student'"),
            ('referrals', 'friend_audience', "friend_audience VARCHAR(20) NOT NULL DEFAULT 'student'"),
            ('referral_reward_rules', 'referrer_audience', "referrer_audience VARCHAR(20) NOT NULL DEFAULT 'student'"),
            ('referral_reward_rules', 'friend_audience', "friend_audience VARCHAR(20) NOT NULL DEFAULT 'student'"),
            ('referral_reward_rules', 'referrer_pay_amount', 'referrer_pay_amount DECIMAL(12,2) NULL'),
            ('referral_reward_rules', 'referrer_seats', 'referrer_seats INT NULL'),
            ('referral_reward_rules', 'friend_pay_amount', 'friend_pay_amount DECIMAL(12,2) NULL'),
            ('referral_reward_rules', 'friend_seats', 'friend_seats INT NULL'),
        ):
            _add_column(table, column, ddl)

        db.session.execute(text(
            "INSERT INTO score_event_rules (event_type, label, points, cap_type, cap_value, is_active) "
            "SELECT 'referral_bonus', 'Referral', 0, 'none', NULL, 1 FROM DUAL "
            "WHERE NOT EXISTS (SELECT 1 FROM score_event_rules WHERE event_type = 'referral_bonus')"
        ))
        db.session.commit()
        print('score rule referral_bonus: ready')

        _fix_referrals()
        _fix_grants()
        # A prize coupon belongs to the person who won it.
        _add_column('coupons', 'owner_user_id', 'owner_user_id CHAR(36) NULL')

        n = apply_sql_file('database/stored_procedures/referral_rewards.sql')
        print(f'referral procedures: {n}')
        n = apply_sql_file('database/stored_procedures/endpoints/subscription_activate.sql')
        print(f'subscription activate procedure: {n}')
        n = apply_sql_file('database/stored_procedures/business/student.sql',
                           only_containing='sp_student_coupon_validate')
        print(f'coupon validate procedure: {n}')
        have = {r[0] for r in db.session.execute(text(
            "SELECT ROUTINE_NAME FROM information_schema.ROUTINES "
            "WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME IN "
            f"({', '.join(repr(x) for x in WANT)})"
        )).fetchall()}
        missing = [name for name in WANT if name not in have]
        for name in WANT:
            print(f'  {"OK  " if name in have else "MISS"} {name}')
        if missing:
            raise SystemExit('FAILED — not created: ' + ', '.join(missing))
        print('Done.')


if __name__ == '__main__':
    main()
