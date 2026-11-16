"""
Migration: make cohort tasks creatable, then give the existing cohorts a starter set.

Two separate problems, one screen:

1. The admin task form at AdminTasks.jsx requires `task_type`,
   `submission_type` and `difficulty_level`, and fills those dropdowns from
   masters types that had ZERO rows. The fields are mandatory, so the form
   could never be submitted — nobody could create a task, which is the real
   reason My Tasks is empty rather than merely new. The vocabularies come from
   the column comments on the cohort_tasks model.

2. The 16 existing cohorts have no tasks, so even an enrolled student sees a
   blank screen. Each cohort with no tasks of its own gets three generic ones
   the achiever can edit or delete. Cohorts that already have tasks are left
   alone — this never overwrites someone's content.

Idempotent. Run from SKOVO_BACKEND:
    python migrate_cohort_tasks_seed.py
"""
import uuid
from datetime import datetime, timedelta

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd

from portal import InitApp
from portal.models import db

app = InitApp().app()

# Values taken from the cohort_tasks model's column comments, so the dropdowns
# and what the code expects cannot disagree.
DROPDOWNS = {
    'task_type': [
        ('assignment',   'Assignment'),
        ('quiz',         'Quiz'),
        ('project',      'Project'),
        ('presentation', 'Presentation'),
        ('live_session', 'Live Session'),
    ],
    'task_submission_type': [
        ('text_only',   'Text answer'),
        ('file_upload', 'File upload'),
        ('url_link',    'Link / URL'),
        ('github_repo', 'GitHub repo'),
        ('video_link',  'Video link'),
    ],
    'difficulty_level': [
        ('beginner',     'Beginner'),
        ('intermediate', 'Intermediate'),
        ('advanced',     'Advanced'),
    ],
}

# title, description, task_type, submission_type, difficulty, weight, days_offset
STARTER_TASKS = [
    ('Introduce yourself to the cohort',
     'Tell the group who you are, what you are studying and what you want out of this cohort. '
     'A few lines is enough — it helps your achiever tailor the sessions.',
     'assignment', 'text_only', 'beginner', 3, 2),
    ('Complete the session worksheet',
     'Work through the worksheet shared in the session and upload it here. '
     'Attempt everything — an honest wrong answer is more useful to your achiever than a blank.',
     'assignment', 'file_upload', 'intermediate', 5, 7),
    ('Share your key takeaway',
     'One thing you learned that you will actually use, and one thing you are still stuck on.',
     'assignment', 'text_only', 'beginner', 3, 10),
]


def seed_dropdowns():
    added = 0
    for mtype, values in DROPDOWNS.items():
        for i, (value, label) in enumerate(values):
            # ── SP: sp_master_create / sp_master_update — each dropdown has
            # its own table now, resolved through `master_registry`. ──────────
            res = db.session.execute(
                text("CALL sp_master_create(:t, :i, :v, :l, :s, NULL)"),
                {'t': mtype, 'i': str(uuid.uuid4()), 'v': value,
                 'l': label, 's': (i + 1) * 10}).fetchone()
            if res and res[0] == 'ok':
                added += 1
            elif res and res[0] == 'duplicate':
                db.session.execute(text("""
                    UPDATE `master_{t}` SET `label` = :l, `sort_order` = :s, `is_active` = 1
                     WHERE `value` = :v
                """.format(t=mtype)), {'l': label, 's': (i + 1) * 10, 'v': value})
    db.session.commit()
    return added


def seed_tasks():
    # Only cohorts with no tasks at all — an achiever's own tasks are never touched.
    cohorts = db.session.execute(text("""
        SELECT c.`id`, c.`session_date`
          FROM `cohorts` c
         WHERE NOT EXISTS (
                SELECT 1 FROM `cohort_tasks` t
                 WHERE t.`cohort_id` = c.`id` AND t.`deleted_at` IS NULL)
    """)).mappings().all()

    created = 0
    for c in cohorts:
        # Due dates hang off the session where there is one, so they land after
        # the class rather than before it.
        anchor = c['session_date'] or datetime.utcnow()
        if isinstance(anchor, str):
            anchor = datetime.utcnow()
        for title, desc, ttype, stype, diff, weight, offset in STARTER_TASKS:
            db.session.execute(text("""
                INSERT INTO `cohort_tasks`
                    (`id`, `cohort_id`, `title`, `description`, `task_type`, `submission_type`,
                     `difficulty_level`, `task_status`, `due_date`, `score_weight`)
                VALUES (:i, :c, :t, :d, :tt, :st, :df, 'active', :due, :w)
            """), {'i': str(uuid.uuid4()), 'c': c['id'], 't': title, 'd': desc, 'tt': ttype,
                   'st': stype, 'df': diff, 'due': anchor + timedelta(days=offset), 'w': weight})
            created += 1
    db.session.commit()
    return len(cohorts), created


def main():
    with app.app_context():
        added = seed_dropdowns()
        cohorts, tasks = seed_tasks()

        counts = db.session.execute(text("""
            SELECT (SELECT COUNT(1) FROM `masters`
                     WHERE `type` IN ('task_type','task_submission_type','difficulty_level')
                       AND `is_active` = 1) AS dropdown_options,
                   (SELECT COUNT(1) FROM `cohort_tasks` WHERE `deleted_at` IS NULL) AS tasks_total,
                   (SELECT COUNT(DISTINCT `cohort_id`) FROM `cohort_tasks`) AS cohorts_with_tasks
        """)).mappings().first()

        print(f"dropdown options added: {added}")
        print(f"cohorts seeded: {cohorts} | tasks created: {tasks}")
        print("now:", dict(counts))


if __name__ == "__main__":
    main()
