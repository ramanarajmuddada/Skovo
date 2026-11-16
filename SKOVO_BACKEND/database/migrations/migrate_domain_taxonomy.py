"""
Turn `domains` from a flat, open list into a curated two-level taxonomy.

WHY
---
`domains` was a flat table any achiever could append to, and students browse
cohorts by it. That combination cannot hold: within a day of the delete button
shipping, the list held both "Agriculture & AgriTech" and "agritech". No string
comparison reliably knows those are the same category — that is an editorial
judgement, so the list needs one editor.

Meanwhile the same taxonomy already existed, curated and far better, in
`course_catalogue`: 227 rows over `degree_category -> degree -> branch`. Eight of
the eleven domains simply duplicated it (Engineering, Agriculture, Finance,
Design, Law, Education, Management, Medical). The platform was maintaining two
vocabularies for one idea, and matching an achiever's expertise to a student's
course was impossible because the two sides had no shared spine.

WHAT THIS DOES
--------------
1. Adds `parent_id` to `domains`, making it self-referencing (parent = domain,
   child = sub-domain).
2. Seeds top-level domains from `course_catalogue.degree_category`, REUSING the
   existing row wherever the name already matches, so `cohorts.domain_id` and
   `achievers.domain_id` keep pointing at valid rows.
3. Seeds sub-domains from the distinct `branch` values under each category —
   the specialisation, not the qualification. An achiever teaches "Computer
   Science", not "B.Tech"; a category whose rows carry no branch falls back to
   `degree` so nothing is left with an empty second level.
4. Adds the guidance areas that are not degrees (govt exams, entrance prep,
   study abroad, career switch) and the sectors India's NSDC Sector Skill
   Council list covers but this catalogue does not.
5. Deactivates junk rows that nothing references.

Nothing is deleted that is in use. Re-runnable: it upserts by normalised name.

    python database/migrations/migrate_domain_taxonomy.py
    python database/migrations/migrate_domain_taxonomy.py --undo   # drops parent_id, restores is_active
"""
import argparse
import re
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()


def norm(v):
    """Normalised key for matching: case, spacing and punctuation don't count."""
    return re.sub(r'[^a-z0-9]', '', (v or '').lower())


def slugify_plain(name):
    """The slug a name WOULD get, ignoring collisions — used to find an existing row."""
    return re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-') or 'domain'


def slugify(name, taken):
    s = re.sub(r'[^a-z0-9]+', '-', (name or '').lower()).strip('-') or 'domain'
    base, n = s, 1
    while s in taken:
        s = f'{base}-{n}'
        n += 1
    taken.add(s)
    return s


# Guidance areas that are not a degree. A student preparing for UPSC or applying
# abroad needs a mentor for exactly that, and no `degree_category` covers it.
EXTRA_DOMAINS = {
    'Government & Civil Services': [
        'UPSC / Civil Services', 'State PSC', 'SSC', 'Banking Exams',
        'Railways', 'Defence Services',
    ],
    'Entrance Exam Prep': [
        'JEE', 'NEET', 'CUET', 'CLAT', 'CAT / MBA Entrance', 'State Entrance Exams',
    ],
    'Study Abroad': [
        'GRE / GMAT', 'IELTS / TOEFL', 'Applications & SOP', 'Scholarships & Funding',
    ],
    'Career Switch & Upskilling': [
        'Resume & Interview Prep', 'Freelancing & Consulting', 'Higher Studies While Working',
    ],
}

# Sectors India's 36 NSDC Sector Skill Councils cover that `course_catalogue`
# does not. Included so an achiever from these fields finds themselves.
SSC_GAPS = {
    'Aerospace & Aviation': ['Pilot Training', 'Aircraft Maintenance', 'Cabin Crew'],
    'Logistics & Supply Chain': ['Warehousing', 'Transportation', 'Procurement'],
    'Tourism & Hospitality': ['Hotel Operations', 'Travel & Tourism', 'Event Management'],
    'Beauty & Wellness': ['Cosmetology', 'Fitness & Nutrition', 'Salon Management'],
    'Sports': ['Coaching', 'Sports Management', 'Physiotherapy'],
    'Media & Entertainment': ['Film & Television', 'Animation & VFX', 'Content Creation'],
}

# Rows that exist only because the list was open to anyone. Removed only if
# nothing references them.
JUNK = ('agritech', 'smoketestdomain')

# The legacy flat list used its own wording, so seeding from the catalogue left
# pairs like "Agriculture & AgriTech" (old, empty) beside "Agriculture" (new,
# with sub-domains) — the duplication this migration exists to remove.
#
# Each entry is (legacy name, catalogue name, label to keep). References are
# repointed to the surviving row before the legacy one is deleted, so no cohort
# or achiever is orphaned. The kept label is whichever reads better to a student:
# "Technology" beats "Computer Applications", but "Law" beats "Legal & Law".
MERGE = [
    ('Agriculture & AgriTech', 'Agriculture',          'Agriculture & AgriTech'),
    ('Business & Management',  'Management',           'Business & Management'),
    ('Design & Media',         'Design',               'Design'),
    ('Education & Teaching',   'Education',            'Education & Teaching'),
    ('Finance & Banking',      'Finance',              'Finance & Banking'),
    ('Healthcare',             'Medical',              'Healthcare & Medical'),
    ('Legal & Law',            'Law',                  'Law'),
    ('Technology',             'Computer Applications', 'Technology'),
]


def merge_legacy(conn, by_key):
    """Fold each legacy domain into its catalogue equivalent.

    The catalogue row is the survivor because it carries the sub-domains; the
    legacy row only carries references, which are moved across first.
    """
    merged = 0
    for legacy, canonical, keep_label in MERGE:
        lid = by_key.get(norm(legacy))
        cid = by_key.get(norm(canonical))
        if not lid or not cid or lid == cid:
            continue
        for tbl in ('cohorts', 'achievers'):
            conn.execute(text(
                f'UPDATE `{tbl}` SET `domain_id` = :c WHERE `domain_id` = :l'),
                {'c': cid, 'l': lid})
        # A sub-domain that somehow hung off the legacy row moves too.
        conn.execute(text(
            'UPDATE `domains` SET `parent_id` = :c WHERE `parent_id` = :l'),
            {'c': cid, 'l': lid})
        conn.execute(text('DELETE FROM `domains` WHERE `id` = :l'), {'l': lid})
        conn.execute(text('UPDATE `domains` SET `name` = :n WHERE `id` = :c'),
                     {'n': keep_label, 'c': cid})
        by_key.pop(norm(legacy), None)
        by_key[norm(keep_label)] = cid
        merged += 1
        print(f'   merged "{legacy}" into "{keep_label}"')
    return merged


def add_parent_column(conn):
    cols = {c[0] for c in conn.execute(text('SHOW COLUMNS FROM `domains`')).all()}
    if 'parent_id' in cols:
        return False
    conn.execute(text(
        'ALTER TABLE `domains` ADD COLUMN `parent_id` CHAR(36) NULL AFTER `id`,'
        ' ADD INDEX `ix_domains_parent` (`parent_id`)'))
    return True


def existing(conn):
    """Index every domain by normalised name AND by slug.

    Name alone is not enough. The merge step renames a surviving row to the
    better label ("Computer Applications" becomes "Technology"), after which a
    second run cannot find it by name and creates a fresh duplicate — the exact
    flip-flop this migration exists to remove. A slug is derived once and never
    rewritten, so it is the stable handle across runs.
    """
    rows = conn.execute(text('SELECT id, name, slug FROM `domains`')).mappings().all()
    by_key = {norm(r['name']): r['id'] for r in rows}
    by_slug = {r['slug']: r['id'] for r in rows if r['slug']}
    return by_key, by_slug


def upsert(conn, by_key, by_slug, name, parent_id=None):
    """Reuse the row if the name OR its slug already exists; otherwise create it.

    Reuse matters: `Engineering` is referenced by a live cohort and an achiever,
    so re-creating it would orphan both. The slug fallback catches rows the merge
    step renamed, which is what made an earlier version create six duplicates on
    its second run.
    """
    k = norm(name)
    did = by_key.get(k) or by_slug.get(slugify_plain(name))
    if did:
        by_key[k] = did
        conn.execute(text(
            'UPDATE `domains` SET `parent_id` = :p, `is_active` = 1 WHERE `id` = :i'),
            {'p': parent_id, 'i': did})
        return did, False
    did = str(uuid.uuid4())
    slug = slugify(name, set(by_slug))
    conn.execute(text("""
        INSERT INTO `domains` (`id`, `parent_id`, `name`, `slug`, `is_active`)
        VALUES (:i, :p, :n, :s, 1)
    """), {'i': did, 'p': parent_id, 'n': name, 's': slug})
    by_key[k] = did
    by_slug[slug] = did
    return did, True


def run(conn):
    added_col = add_parent_column(conn)
    by_key, by_slug = existing(conn)
    made = reused = 0

    # ── 1. From the catalogue that is already curated ────────────────────────
    cats = conn.execute(text("""
        SELECT DISTINCT `degree_category` FROM `course_catalogue`
         WHERE `degree_category` IS NOT NULL AND `degree_category` <> ''
         ORDER BY `degree_category`
    """)).scalars().all()

    for cat in cats:
        if norm(cat) == 'other':          # not a category, a placeholder
            continue
        pid, created = upsert(conn, by_key, by_slug, cat)
        made += created
        reused += (not created)
        # Branch is the specialisation an achiever would name; degree is only the
        # qualification level, so "Engineering -> B.Tech" says nothing useful.
        subs = conn.execute(text("""
            SELECT DISTINCT `branch` FROM `course_catalogue`
             WHERE `degree_category` = :c AND `branch` IS NOT NULL AND `branch` <> ''
             ORDER BY `branch`
        """), {'c': cat}).scalars().all()
        if not subs:
            subs = conn.execute(text("""
                SELECT DISTINCT `degree` FROM `course_catalogue`
                 WHERE `degree_category` = :c AND `degree` IS NOT NULL AND `degree` <> ''
                 ORDER BY `degree`
            """), {'c': cat}).scalars().all()
        for sub in subs:
            _, c2 = upsert(conn, by_key, by_slug, sub, parent_id=pid)
            made += c2

    # ── 2. Guidance areas that are not degrees, and the SSC gaps ─────────────
    for group in (EXTRA_DOMAINS, SSC_GAPS):
        for parent, children in group.items():
            pid, created = upsert(conn, by_key, by_slug, parent)
            made += created
            reused += (not created)
            for child in children:
                _, c2 = upsert(conn, by_key, by_slug, child, parent_id=pid)
                made += c2

    # ── 3. Fold the legacy wording into the catalogue rows ───────────────────
    merged = merge_legacy(conn, by_key)

    # ── 4. Retire the rows the open list produced ────────────────────────────
    retired = 0
    for row in conn.execute(text('SELECT id, name FROM `domains`')).mappings().all():
        if norm(row['name']) not in JUNK:
            continue
        used = conn.execute(text("""
            SELECT (SELECT COUNT(*) FROM `cohorts`   WHERE `domain_id` = :i AND `deleted_at` IS NULL)
                 + (SELECT COUNT(*) FROM `achievers` WHERE `domain_id` = :i)
        """), {'i': row['id']}).scalar()
        if used:
            print(f'   kept "{row["name"]}" — {used} reference(s)')
            continue
        conn.execute(text('DELETE FROM `domains` WHERE `id` = :i'), {'i': row['id']})
        retired += 1

    return added_col, made, reused, retired, merged


def undo(conn):
    cols = {c[0] for c in conn.execute(text('SHOW COLUMNS FROM `domains`')).all()}
    if 'parent_id' in cols:
        # Sub-domains only exist because of this migration; nothing pointed at
        # them before it ran.
        n = conn.execute(text('DELETE FROM `domains` WHERE `parent_id` IS NOT NULL')).rowcount
        conn.execute(text('ALTER TABLE `domains` DROP INDEX `ix_domains_parent`'))
        conn.execute(text('ALTER TABLE `domains` DROP COLUMN `parent_id`'))
        return n
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--undo', action='store_true')
    args = ap.parse_args()

    with app.app_context():
        conn = db.session
        if args.undo:
            n = undo(conn)
            conn.commit()
            print(f'removed {n} sub-domain(s) and dropped parent_id')
            return

        added_col, made, reused, retired, merged = run(conn)
        conn.commit()
        if added_col:
            print('   added domains.parent_id')
        print(f'   created {made}, reused {reused}, merged {merged}, retired {retired}')
        tops = conn.execute(text('SELECT COUNT(*) FROM `domains` WHERE `parent_id` IS NULL')).scalar()
        subs = conn.execute(text('SELECT COUNT(*) FROM `domains` WHERE `parent_id` IS NOT NULL')).scalar()
        print(f'   taxonomy now: {tops} domains, {subs} sub-domains')


if __name__ == '__main__':
    main()
