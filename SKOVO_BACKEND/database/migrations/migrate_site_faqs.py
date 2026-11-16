"""Landing-page FAQs: the table, its procedures, and the seven FAQs the
homepage carried as literals (only when the table is still empty).

Idempotent. From SKOVO_BACKEND:
    python database/migrations/migrate_site_faqs.py
"""
import uuid
from pathlib import Path

from sqlalchemy import text

import _bootstrap  # noqa: F401
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()
ROOT = Path(__file__).resolve().parents[1]

# {gate} is filled in on the page with the live Opportunity Hub score.
SEED = [
    ('How is Skovo different from Internshala or Shiksha?',
     'Those are single-purpose tools — one lists internships, one lists colleges. Skovo connects the whole journey. Your college research, your cohorts, your communities, and your job applications all feed one Readiness Score, and that score is what unlocks opportunities.'),
    ('What exactly is the Readiness Score?',
     'A number from 0 to 100 that reflects the work you’ve actually put in. Attend a cohort, post in a community, upload a certificate, apply for something — each action adds points. At {gate}, the Opportunities Hub unlocks.'),
    ('Is Skovo free?',
     'There’s a real free tier — browse colleges, join communities, attend one cohort, build your score. Skovo Pro comes as a monthly, quarterly or yearly plan (see Pricing) and unlocks unlimited cohorts, direct messaging, and the Opportunities Hub.'),
    ('I’m in Class 9. Is this for me?',
     'Yes. Skovo covers ages 14 to 25. Younger students get cohorts about exploring subjects and understanding what different careers actually look like, long before you have to commit to anything.'),
    ('Who are the achievers? Are they verified?',
     'Every achiever is verified before hosting a session — identity, employment, and background all checked by our team. They’re young professionals three to five years into their careers, not career counsellors.'),
    ('How do cohorts work?',
     'They’re online sessions, usually on Sunday, running 60 to 90 minutes. Book a seat, join the link, ask your questions. Most cohorts include a small task afterwards that adds to your Readiness Score.'),
    ('I want to host cohorts. How do I become an achiever?',
     'Head to the For Achievers section and apply. We verify identity and employment before approving anyone.'),
]

WANT = ['sp_site_faqs_public', 'sp_site_faqs_admin_list', 'sp_site_faq_create',
        'sp_site_faq_update', 'sp_site_faq_delete', 'sp_site_faq_move']


def main():
    with app.app_context():
        ddl = (ROOT / 'tables' / 'site_faqs.sql').read_text(encoding='utf-8')
        ddl = '\n'.join(ln for ln in ddl.splitlines() if not ln.strip().startswith('--'))
        for stmt in [s.strip() for s in ddl.split(';') if s.strip()]:
            db.session.execute(text(stmt))
        db.session.commit()
        print('  site_faqs ready')

        apply_sql_file(str(ROOT / 'stored_procedures' / 'site_faqs.sql'))
        print('  procedures applied')

        if not db.session.execute(text('SELECT COUNT(*) FROM site_faqs')).scalar():
            for i, (q, a) in enumerate(SEED, start=1):
                db.session.execute(text(
                    'INSERT INTO site_faqs (id, question, answer, sort_order, is_active) '
                    'VALUES (:id, :q, :a, :o, 1)'), {'id': str(uuid.uuid4()), 'q': q, 'a': a, 'o': i})
            db.session.commit()
            print(f'  seeded {len(SEED)} FAQs')

        missing = [n for n in WANT if not int(db.session.execute(text(
            'SELECT COUNT(*) FROM information_schema.ROUTINES '
            'WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_NAME = :n'), {'n': n}).scalar() or 0)]
        if missing:
            raise SystemExit(f'missing: {", ".join(missing)}')
        print('Done.')


if __name__ == '__main__':
    main()
