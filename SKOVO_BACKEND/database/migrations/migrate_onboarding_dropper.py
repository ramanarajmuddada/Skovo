"""
Migration: let a student say they are a dropper.

`dropper` was wired through the whole app — the onboarding card and icon
(OnboardingModal), the exam step (an entrance exam to retake), the stage
mapping (counts as Intermediate, stages.py), the readiness Excel's "Droppers"
sheet and the Score Engine's Droppers batch — but the onboarding_category
master had no `dropper` row. The card never rendered, nobody could pick it,
and the Droppers batch matched no one.

Adds the row after "In 12th Class". Idempotent.

Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_onboarding_dropper.py
"""
import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()


def main():
    with app.app_context():
        # Through sp_master_create — the same path as Admin > Masters — which
        # resolves master_onboarding_category via master_registry. (The generic
        # `masters` table is the old store; nothing reads this list from it.
        # A first draft of this migration wrote there; that row is removed.)
        db.session.execute(text(
            "DELETE FROM `masters` WHERE `type` = 'onboarding_category' AND `value` = 'dropper'"))
        res = db.session.execute(text("CALL sp_master_create(:t, UUID(), :v, :l, :o, NULL)"), {
            't': 'onboarding_category', 'v': 'dropper',
            'l': 'Dropper / Repeater|Retaking EAPCET / NEET / JEE after 12th', 'o': 25,
        }).mappings().first() or {}
        db.session.commit()
        rows = db.session.execute(text(
            "SELECT `value` FROM `master_onboarding_category` WHERE `is_active` = 1 ORDER BY `sort_order`"
        )).scalars().all()
        print(f'dropper: {res.get("result")}; onboarding order: {", ".join(rows)}')

if __name__ == '__main__':
    main()
