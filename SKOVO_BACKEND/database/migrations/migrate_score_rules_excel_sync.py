"""
Migration: line the Score Engine up with SKOVO-readiness-streak-tasks-v1.xlsx.

A row-by-row comparison on 17 Oct 2026 (425 Excel rows) found:

  * Pro annual was live at +20, against the sheet's 8 (C74). It was one of
    only two live scoring actions, so buying Pro was worth more than every
    live Class 10 task combined. Set to 8. It stays live — whether to switch
    it off is the admin's call on the Score Engine screen.
    ("When it starts" rules already fire once per student — INSERT IGNORE on
    ref 'm:active' — so no cap change is needed.)

  * Actions the sheet marks "In code today: Yes" had a metric to count
    from but no rule to switch on. Added OFF, at the sheet's points:
      C43 Enroll in a cohort   tiered 5 / 3 / 1, first three cohorts
      (C66 resume / C67 SOP were added here too, then removed on 17 Oct 2026:
       Resume Builder and SOP Builder are hidden in v1.)

Not added, on purpose:
  C57 Earn a badge          — 0 readiness points in the sheet (the badge is the reward)
  C54 Forum reply accepted  — already the "Answer marked Solved" action
  C52 Post reaches 5 reactions, C03 Fill all 4 vault folders
                            — nothing counts these yet; need a metric first

Every new rule starts OFF, per the sheet's golden rule. Idempotent: inserts
skip rules that already exist, and the Pro update only touches the 20.

Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_score_rules_excel_sync.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()

NEW_RULES = [
    # event_type, label, points, cap_type, cap_value, metric, test, threshold, shape, tiers
    ('m_cohorts_enrolled_tiered', 'Enroll in a cohort', 5, 'lifetime', 3,
     'cohorts_enrolled', 'each', None, 'tiered', '5,3,1'),
]


def main():
    with app.app_context():
        added = 0
        for (key, label, pts, cap_type, cap_value, metric, test, threshold, shape, tiers) in NEW_RULES:
            added += db.session.execute(text("""
                INSERT IGNORE INTO `score_event_rules`
                    (`event_type`, `label`, `points`, `is_active`, `cap_type`, `cap_value`,
                     `metric_key`, `rule_test`, `threshold`, `shape`, `tier_points`, `leaderboard_points`)
                VALUES (:k, :l, :p, 0, :ct, :cv, :m, :t, :th, :sh, :tp, 0)
            """), {'k': key, 'l': label, 'p': pts, 'ct': cap_type, 'cv': cap_value,
                   'm': metric, 't': test, 'th': threshold, 'sh': shape, 'tp': tiers}).rowcount

        pro = db.session.execute(text("""
            UPDATE `score_event_rules` SET `points` = 8
             WHERE `event_type` = 'm_pro_subscription_annual_active' AND `points` = 20
        """)).rowcount

        db.session.commit()

        live = db.session.execute(text(
            "SELECT `label`, `points` FROM `score_event_rules` WHERE `is_active` = 1 ORDER BY `points` DESC"
        )).fetchall()
        print(f'added {added} rule(s) (off); Pro annual 20 -> 8: {"yes" if pro else "already done"}')
        print('live actions: ' + ', '.join(f'{l} ({float(p):g})' for l, p in live))


if __name__ == '__main__':
    main()
