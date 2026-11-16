"""
Run every migration the new onboarding flow needs, in dependency order.

Each step is idempotent, so re-running is safe — that is what makes this usable
as a deploy step rather than a one-shot script.

The target database is whatever `config/<env>.ini` resolves to (Backend=DEV
reads dev.ini). To deploy elsewhere, point that ini at the target and run:

    python migrate_onboarding_all.py

Order matters: cities need states, streams need boards, and the profile
procedure is rewritten last because it gained a parameter.
"""
import os
import subprocess
import sys

# Each step lives beside this file. `_bootstrap` chdir's to SKOVO_BACKEND so the
# steps find their .sql files, which means a bare script name no longer resolves
# — hand subprocess the absolute path instead.
HERE = os.path.dirname(os.path.abspath(__file__))

STEPS = [
    ('migrate_geo.py',                 'states + cities (36 states/UTs, 234 cities)'),
    ('migrate_academics.py',           'boards + streams, user_profiles.board'),
    ('migrate_course_catalogue.py',    'course catalogue (227 courses)'),
    ('migrate_student_goals.py',       'student_goals + sp_profile_upsert(p_board)'),
    ('migrate_flat_masters.py',        'career_interest, industry, year_*, prep_stage'),
    ('migrate_onboarding_masters.py',  'education stages incl. school_10th'),
    ('migrate_entrance_exams.py',      'national + state CET exam lists'),
    ('migrate_assessment_masters.py',  'stage-scoped assessment skills, goals, questions'),
    ('migrate_dropdown_masters.py',    'remaining dropdown enums (types, categories, statuses)'),
    ('migrate_dropdown_masters_final.py', 'last dropdowns: CG, trackers, exam resources, admin'),
    ('migrate_empty_masters.py',       'master types the UI asked for but that had no rows'),
    ('migrate_profile_stage_cleanup.py', 'clearable profile fields + strand cleanup'),
    ('migrate_retire_dead_masters.py', 'retire masters types replaced by real tables'),
    ('migrate_predictor_coverage.py',  'sp_cutoff_coverage — predictor confidence guard'),
    ('migrate_cohort_tasks_seed.py',   'task dropdowns + starter tasks per cohort'),
    ('migrate_bulk_import.py',         'bulk CSV import procs, cutoff source/verified_at'),
]


def main():
    print(f"Running {len(STEPS)} migrations\n" + "─" * 62)
    for script, what in STEPS:
        print(f"\n▶ {script}  —  {what}")
        result = subprocess.run([sys.executable, os.path.join(HERE, script)],
                                capture_output=True, text=True)

        # The scripts echo a lot of SQL; surface only their summary lines. Those
        # are printed flush-left, whereas echoed SQL is always indented — which
        # is a more reliable filter than trying to pattern-match SQL itself.
        for line in result.stdout.splitlines():
            if (line and not line.startswith((' ', '\t'))
                    and 'sqlalchemy' not in line.lower() and ' - INFO - ' not in line):
                print(f"   {line}")

        if result.returncode != 0:
            print(f"\n✗ {script} failed — stopping before anything downstream runs.")
            print('\n'.join(result.stderr.strip().splitlines()[-12:]))
            return 1

    print("\n" + "─" * 62)
    print("✓ All migrations applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
