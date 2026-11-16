"""
Migration: close the one gap between score_event_rules and the v1 spec.

The Engineering Playbook §5.7 score table lists "Communities · create a new
community · +2 · 5 lifetime". Every other row in that table exists in
score_event_rules with matching points and caps — this one was missing, so a
student who starts a community earns nothing for it.

Playbook §2.1 is explicit that a feature which does not feed the score does not
belong in Skovo, and community creation is a feature we ship. Adding the rule
row rather than code, per the warning that point values are config, not code.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_spec_score_alignment.py
"""
from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db

app = InitApp().app()

# event_type, label, points, cap_type, cap_value
SPEC_RULES = [
    ('community_created', 'Created a community', 2.0, 'lifetime', 5),
]


def main():
    with app.app_context():
        added, updated = 0, 0
        for event_type, label, points, cap_type, cap_value in SPEC_RULES:
            row = db.session.execute(text(
                "SELECT `event_type` FROM `score_event_rules` WHERE `event_type` = :e"),
                {'e': event_type}).fetchone()
            if row:
                db.session.execute(text("""
                    UPDATE `score_event_rules`
                       SET `label` = :l, `points` = :p, `cap_type` = :ct,
                           `cap_value` = :cv, `is_active` = 1
                     WHERE `event_type` = :e
                """), {'l': label, 'p': points, 'ct': cap_type, 'cv': cap_value, 'e': event_type})
                updated += 1
            else:
                db.session.execute(text("""
                    INSERT INTO `score_event_rules`
                        (`event_type`, `label`, `points`, `cap_type`, `cap_value`, `is_active`)
                    VALUES (:e, :l, :p, :ct, :cv, 1)
                """), {'e': event_type, 'l': label, 'p': points, 'ct': cap_type, 'cv': cap_value})
                added += 1
        db.session.commit()

        total = db.session.execute(text(
            "SELECT COUNT(1) FROM `score_event_rules` WHERE `is_active` = 1")).scalar()
        print(f"spec rules added: {added} | updated: {updated}")
        print(f"active score rules now: {total}")


if __name__ == "__main__":
    main()
