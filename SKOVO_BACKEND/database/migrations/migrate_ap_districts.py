"""
Migration: Andhra Pradesh's city list becomes its 26 districts.

AP was reorganised into 26 districts in April 2022. The `cities` table still
held the pre-reorganisation list of 20 large towns, so a student picking where
they are from could not find their district — eight of the twenty-six had no
entry at all (Anakapalli, Bapatla, Palnadu, …).

What this does:
  * upserts the 26 official district names, active, in alphabetical order;
  * deactivates the AP rows that are not districts (Vijayawada, Rajahmundry,
    Machilipatnam, …) so the list is exactly 26.

Deactivated, never deleted. `user_profiles.city` is a plain varchar, not a
foreign key, so a deleted row would silently orphan whoever had chosen it — and
an admin can restore any of them from Admin → Cities without a deploy.

At the time of writing the only AP cities any profile had stored were
Visakhapatnam and Guntur, both of which are district names and stay active, so
no existing student is affected.

Idempotent. Run from anywhere:

    venv\\Scripts\\python.exe database/migrations/migrate_ap_districts.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import bindparam, text

from portal import InitApp
from portal.models import db

app = InitApp().app()

STATE_CODE = 'AP'

# The 26 districts of Andhra Pradesh, official names, April 2022 reorganisation.
DISTRICTS = [
    'Alluri Sitharama Raju',
    'Anakapalli',
    'Ananthapuramu',
    'Annamayya',
    'Bapatla',
    'Chittoor',
    'Dr. B.R. Ambedkar Konaseema',
    'East Godavari',
    'Eluru',
    'Guntur',
    'Kakinada',
    'Krishna',
    'Kurnool',
    'Nandyal',
    'NTR',
    'Palnadu',
    'Parvathipuram Manyam',
    'Prakasam',
    'Sri Potti Sriramulu Nellore',
    'Sri Sathya Sai',
    'Srikakulam',
    'Tirupati',
    'Visakhapatnam',
    'Vizianagaram',
    'West Godavari',
    'YSR Kadapa',
]

# Visakhapatnam is the one district that is also a metro in TIER_1 terms; the
# rest are ordinary. Kept simple deliberately — tier only drives search ranking.
TIER_1 = {'Visakhapatnam'}


def main():
    with app.app_context():
        state_id = db.session.execute(
            text("SELECT `id` FROM `states` WHERE `code` = :c"), {'c': STATE_CODE}
        ).scalar()
        if not state_id:
            raise SystemExit(f'State {STATE_CODE} not found — run migrate_geo.py first.')

        before = db.session.execute(text(
            "SELECT COUNT(*) FROM `cities` WHERE `state_id` = :s AND `is_active` = 1"
        ), {'s': state_id}).scalar()

        for i, name in enumerate(DISTRICTS):
            db.session.execute(text("""
                INSERT INTO `cities` (`id`, `state_id`, `name`, `district`, `tier`, `sort_order`, `is_active`)
                VALUES (:i, :st, :n, :n, :t, :o, 1)
                ON DUPLICATE KEY UPDATE `district` = :n, `tier` = :t, `sort_order` = :o, `is_active` = 1
            """), {'i': str(uuid.uuid4()), 'st': state_id, 'n': name,
                   't': 1 if name in TIER_1 else 2, 'o': (i + 1) * 10})

        # Everything else in AP is pre-reorganisation and steps aside. Listed by
        # name rather than by "not in DISTRICTS" alone so the statement is
        # readable in a review, but driven by the same list so they cannot drift.
        stmt = text("""
            UPDATE `cities` SET `is_active` = 0
             WHERE `state_id` = :s
               AND `name` NOT IN :keep
               AND `is_active` = 1
        """).bindparams(bindparam('keep', expanding=True))
        retired = db.session.execute(stmt, {'s': state_id, 'keep': DISTRICTS}).rowcount

        db.session.commit()

        rows = db.session.execute(text("""
            SELECT `name`, `is_active` FROM `cities`
             WHERE `state_id` = :s ORDER BY `is_active` DESC, `sort_order`, `name`
        """), {'s': state_id}).fetchall()
        active = [r[0] for r in rows if r[1]]
        hidden = [r[0] for r in rows if not r[1]]

        print(f'AP cities: {before} active before -> {len(active)} active now '
              f'({retired} retired this run)')
        print(f'  active ({len(active)}): {", ".join(active)}')
        if hidden:
            print(f'  hidden ({len(hidden)}): {", ".join(hidden)}')
        if len(active) != 26:
            print(f'  WARNING: expected 26 active districts, found {len(active)}')


if __name__ == '__main__':
    main()
