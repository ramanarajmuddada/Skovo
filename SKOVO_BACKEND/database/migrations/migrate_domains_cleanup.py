"""
Migration: tidy the career-domain tree and give every domain a description.

An audit on 16 Oct 2026 found the 216 domains seeded on 22 Aug 2026 were
structurally clean (no duplicate names or slugs, no orphans) but:

  * none had a description, and the admin Edit form requires one — so no
    domain could be edited at all;
  * some specialisations sat in the wrong group:
      - ACCA papers (Applied Knowledge, Applied Skills, Strategic Professional)
        and CFA levels (Level 1-3) were filed under Management > Finance;
      - Law, Medical, Management, Education and Arts & Humanities — whole degree
        families (MBBS, LLB, MBA…) — were filed under "Research";
      - M.Arch and M.Des had their own "Design & Architecture" group beside the
        real Architecture and Design groups;
      - M.Pharmacy sat under Medical, MPT under Medical while BPT was under
        Nursing & Allied Health;
  * Chartered Accountancy had no levels while Cost & Management Accountancy had
    Foundation / Intermediate / Final;
  * two empty groups (Research > Sciences, Research > Engineering & Technology)
    duplicated the real Science and Engineering groups.

What this does — by slug, so it is idempotent and safe to re-run:
  1. adds ACCA, CFA and CA Foundation / Intermediate / Final;
  2. moves each misfiled domain under the right parent;
  3. renames Sports > Physiotherapy to "Sports Physiotherapy" (slug kept) so it
     reads apart from BPT / MPT;
  4. switches off the empty duplicate groups — never deletes;
  5. fills `description` wherever it is empty. Existing text is never replaced.

Only 5 domains were in use (9 cohorts, 0 achievers) and none of them moves, so
no cohort changes group.

Run from anywhere:
    venv/Scripts/python.exe database/migrations/migrate_domains_cleanup.py
"""
import re
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import text

from portal import InitApp
from portal.models import db

app = InitApp().app()


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


# (name, parent slug or None)
NEW = [
    ('ACCA', None),
    ('CFA', None),
    ('CA Foundation', 'chartered-accountancy'),
    ('CA Intermediate', 'chartered-accountancy'),
    ('CA Final', 'chartered-accountancy'),
]

# domain slug → new parent slug (None = top-level group)
MOVE = {
    'applied-knowledge':      'acca',
    'applied-skills':         'acca',
    'strategic-professional': 'acca',
    'level-1':                'cfa',
    'level-2':                'cfa',
    'level-3':                'cfa',
    'arts-humanities':        None,
    'education':              None,
    'law':                    None,
    'management':             None,
    'medical':                None,
    'm-arch':                 'architecture',
    'm-des':                  'design',
    'm-pharmacy':             'pharmacy',
    'mpt-physiotherapy':      'nursing-allied-health',
}

RENAME = {'physiotherapy': 'Sports Physiotherapy'}

# Empty once the moves above are done, and duplicates of a real group.
SWITCH_OFF = ['sciences', 'engineering-technology', 'design-architecture']

DESCRIPTIONS = {
    # ── Groups ─────────────────────────────────────────────────────────────
    'ACCA': 'Association of Chartered Certified Accountants — the global accounting qualification, paper by paper.',
    'CFA': 'Chartered Financial Analyst — the three-level investment management qualification.',
    'Aerospace & Aviation': 'Careers in flying, aircraft maintenance and airline cabin services.',
    'Agriculture': 'Farming, crop and allied sciences — B.Sc, M.Sc and technology degrees.',
    'Architecture': 'Designing buildings and planning towns — B.Arch, B.Planning and M.Arch.',
    'Arts & Humanities': 'Languages, social sciences and the humanities at degree and research level.',
    'Beauty & Wellness': 'Cosmetology, salon management, fitness and nutrition careers.',
    'Career Switch & Upskilling': 'Moving into a new field or growing in your current one while working.',
    'Chartered Accountancy': 'ICAI\'s CA course — Foundation, Intermediate and Final.',
    'Commerce': 'B.Com and related paths in accounts, banking, tax and HR.',
    'Company Secretary': 'ICSI\'s CS course — corporate law, governance and compliance.',
    'Computer Applications': 'BCA / MCA and applied computing — cloud, security and software.',
    'Cost & Management Accountancy': 'ICMAI\'s CMA course — costing, management accounting and finance.',
    'Design': 'Visual, product, fashion, interior and digital design careers.',
    'Design & Architecture': 'Postgraduate design and architecture (moved into Design and Architecture).',
    'Education': 'Teaching careers — D.El.Ed, B.Ed and M.Ed.',
    'Engineering': 'B.Tech / B.E. branches and specialisations.',
    'Engineering & Technology': 'Research in engineering (merged into Engineering).',
    'Entrance Exam Prep': 'Preparing for the national and state entrance exams — JEE, NEET, CUET, CLAT and more.',
    'Government & Civil Services': 'Central and state government jobs — UPSC, PSC, SSC, banking, railways, defence.',
    'Hotel Management': 'Hospitality degrees and hotel careers.',
    'ITI': 'Industrial Training Institute trades — two-year and one-year NCVT/SCVT courses.',
    'Law': 'Legal careers — five-year integrated LLB, three-year LLB and LLM.',
    'Logistics & Supply Chain': 'Moving goods — procurement, warehousing and transport careers.',
    'Management': 'MBA / PGDM and business specialisations.',
    'Marine & Defence': 'Merchant navy and armed forces careers.',
    'Mass Communication & Journalism': 'News, media and communication degrees.',
    'Media & Entertainment': 'Film, television, animation and online content careers.',
    'Medical': 'Medicine, dentistry and AYUSH — MBBS, BDS, BAMS and postgraduate degrees.',
    'Nursing & Allied Health': 'Nursing, lab technology and physiotherapy careers.',
    'Pharmacy': 'Medicines and the pharma industry — B.Pharm, Pharm.D and M.Pharm.',
    'Polytechnic': 'Three-year diploma engineering branches after Class 10.',
    'Research': 'Research careers — M.Phil, PhD and research jobs.',
    'Science': 'B.Sc / M.Sc in the pure and applied sciences.',
    'Sciences': 'Research in the sciences (merged into Science).',
    'Sports': 'Careers in sport — coaching, sports management and sports physiotherapy.',
    'Study Abroad': 'Applying to universities outside India — tests, applications and funding.',
    'Tourism & Hospitality': 'Travel, tourism, events and hotel operations careers.',
    'Veterinary': 'Animal health — B.V.Sc & Animal Husbandry.',

    # ── Aerospace & Aviation ───────────────────────────────────────────────
    'Aircraft Maintenance': 'Aircraft Maintenance Engineering (AME) — keeping aircraft airworthy.',
    'Cabin Crew': 'Flight attendant and airline cabin service careers.',
    'Pilot Training': 'Commercial Pilot Licence (CPL) training and flying careers.',
    # ── Agriculture ────────────────────────────────────────────────────────
    'B.Sc Agriculture': 'Four-year degree in crop science, soil and farm management.',
    'B.Sc Horticulture': 'Four-year degree in fruits, vegetables, flowers and plantation crops.',
    'B.Tech Dairy Technology': 'Engineering degree in milk processing and dairy plants.',
    'M.Sc Agriculture': 'Postgraduate specialisation in an agricultural science.',
    # ── Architecture ───────────────────────────────────────────────────────
    'B.Arch': 'Five-year Bachelor of Architecture, entered through NATA or JEE Paper 2.',
    'B.Planning': 'Four-year degree in town, city and regional planning.',
    'M.Arch': 'Postgraduate architecture specialisation.',
    # ── Beauty & Wellness ──────────────────────────────────────────────────
    'Cosmetology': 'Skin, hair and beauty treatment careers.',
    'Fitness & Nutrition': 'Personal training, dietetics and wellness coaching.',
    'Salon Management': 'Running and managing salons and beauty businesses.',
    # ── Career Switch & Upskilling ─────────────────────────────────────────
    'Freelancing & Consulting': 'Working independently for clients.',
    'Higher Studies While Working': 'Part-time, distance and executive programmes alongside a job.',
    'Resume & Interview Prep': 'CVs, LinkedIn and interview practice for placements and jobs.',
    # ── Commerce ───────────────────────────────────────────────────────────
    'Accounting & Finance': 'Bookkeeping, accounts and corporate finance roles.',
    'Banking & Insurance': 'Careers in banks, NBFCs and insurance companies.',
    'HR': 'Human resources in commerce — payroll, recruitment and labour law.',
    'Honours': 'B.Com (Honours) — the deeper, more specialised commerce degree.',
    'Taxation': 'GST and income tax practice and advisory.',
    # ── Company Secretary / CMA / CA ───────────────────────────────────────
    'Executive': 'CS Executive — the second stage of the Company Secretary course.',
    'Professional': 'CS Professional — the final stage of the Company Secretary course.',
    'Foundation': 'CMA Foundation — the entry stage of the Cost & Management Accountancy course.',
    'Intermediate': 'CMA Intermediate — the second stage of the Cost & Management Accountancy course.',
    'Final': 'CMA Final — the last stage of the Cost & Management Accountancy course.',
    'CA Foundation': 'The entry stage of the Chartered Accountancy course, after Class 12.',
    'CA Intermediate': 'The second stage of the CA course, with articleship alongside.',
    'CA Final': 'The last stage of the CA course before membership.',
    # ── Computer Applications ──────────────────────────────────────────────
    'Cloud Computing': 'AWS, Azure and GCP — building and running systems in the cloud.',
    'Cyber Security': 'Protecting systems and data — ethical hacking, SOC and security roles.',
    'General': 'General BCA / MCA computing without a specialisation.',
    # ── Design ─────────────────────────────────────────────────────────────
    'Animation': '2D and 3D animation design.',
    'Communication Design': 'Graphic design, branding and visual communication.',
    'Fashion Design': 'Clothing and accessory design — NIFT, NID and private institutes.',
    'Interior Design': 'Designing homes, offices and retail spaces.',
    'Product Design': 'Designing physical products and industrial objects.',
    'UI/UX Design': 'Designing apps and websites people find easy to use.',
    'M.Des': 'Master of Design — postgraduate design specialisation.',
    # ── Engineering ────────────────────────────────────────────────────────
    'AI & Machine Learning': 'B.Tech in Artificial Intelligence and Machine Learning.',
    'Aerospace': 'B.Tech in Aerospace / Aeronautical Engineering — aircraft and spacecraft.',
    'Agricultural Engineering': 'B.Tech applying engineering to farm machinery, irrigation and processing.',
    'Computer Science (CSE)': 'B.Tech in Computer Science and Engineering.',
    'Electrical & Electronics (EEE)': 'B.Tech in Electrical and Electronics Engineering.',
    'Electronics & Communication (ECE)': 'B.Tech in Electronics and Communication Engineering.',
    'Embedded Systems': 'Hardware-software systems inside devices — firmware and IoT.',
    'Environmental Engineering': 'Water, waste and pollution-control engineering.',
    'Metallurgy': 'B.Tech in Metallurgical and Materials Engineering.',
    'Power Systems': 'Generation, transmission and distribution of electricity.',
    'Robotics & Automation': 'Robots, industrial automation and control systems.',
    'Structural Engineering': 'Designing buildings, bridges and structures — a civil specialisation.',
    'Thermal Engineering': 'Heat, power plants and energy systems — a mechanical specialisation.',
    'VLSI Design': 'Chip design and semiconductor engineering.',
    # ── Entrance Exam Prep ─────────────────────────────────────────────────
    'CAT / MBA Entrance': 'CAT, XAT, MAT, ICET and other MBA entrance exams.',
    'CLAT': 'Common Law Admission Test for the National Law Universities.',
    'CUET': 'Common University Entrance Test for central university degrees.',
    'JEE': 'JEE Main and Advanced for NITs, IIITs and IITs.',
    'NEET': 'NEET-UG for MBBS, BDS, AYUSH and allied medical seats.',
    'State Entrance Exams': 'State CETs such as AP EAPCET and TS EAPCET.',
    # ── Government & Civil Services ────────────────────────────────────────
    'Banking Exams': 'IBPS, SBI and RBI exams for bank officer and clerk posts.',
    'Defence Services': 'CDS, AFCAT and other entries into the armed forces as an officer.',
    'Railways': 'RRB exams for railway jobs.',
    'SSC': 'Staff Selection Commission exams — CGL, CHSL, MTS and GD.',
    'State PSC': 'State Public Service Commission exams such as APPSC and TSPSC Group 1–4.',
    'UPSC / Civil Services': 'UPSC Civil Services — IAS, IPS, IFS and allied services.',
    # ── Hotel Management ───────────────────────────────────────────────────
    'BHM': 'Bachelor of Hotel Management — through NCHM JEE or state exams.',
    # ── ITI trades ─────────────────────────────────────────────────────────
    'COPA': 'Computer Operator and Programming Assistant — one-year ITI trade.',
    'Carpenter': 'Woodwork and furniture — ITI trade.',
    'Draughtsman (Civil)': 'Drawing building and civil plans — two-year ITI trade.',
    'Draughtsman (Mechanical)': 'Drawing machine parts and assemblies — two-year ITI trade.',
    'Electrician': 'Wiring, motors and electrical maintenance — two-year ITI trade.',
    'Fitter': 'Fitting and assembling machine parts — two-year ITI trade.',
    'Machinist': 'Operating lathes, milling and CNC machines — two-year ITI trade.',
    'Mechanic (Diesel)': 'Repairing diesel engines — one-year ITI trade.',
    'Mechanic (Motor Vehicle)': 'Repairing cars and two-wheelers — two-year ITI trade.',
    'Painter': 'Industrial and building painting — ITI trade.',
    'Plumber': 'Pipe fitting, water supply and sanitation — ITI trade.',
    'Refrigeration & AC': 'Installing and repairing refrigerators and air conditioners — ITI trade.',
    'Turner': 'Shaping metal on a lathe — two-year ITI trade.',
    'Welder': 'Gas and arc welding — one-year ITI trade.',
    'Wireman': 'House and industrial wiring — two-year ITI trade.',
    # ── Logistics ──────────────────────────────────────────────────────────
    'Procurement': 'Buying materials and managing suppliers.',
    'Transportation': 'Planning and running the movement of goods by road, rail, sea and air.',
    'Warehousing': 'Storing goods and running warehouses and inventory.',
    # ── Marine & Defence ───────────────────────────────────────────────────
    'B.E. Marine Engineering': 'Engineering degree for ship engines — leads to merchant navy engineer.',
    'B.Sc Nautical Science': 'Degree for deck officers in the merchant navy.',
    'NDA (Army / Navy / Air Force)': 'National Defence Academy entry after Class 12.',
    # ── Mass Communication & Journalism ────────────────────────────────────
    'BA Journalism': 'Undergraduate degree in reporting and news writing.',
    'BJMC': 'Bachelor of Journalism and Mass Communication.',
    'BMM': 'Bachelor of Mass Media — advertising, PR and journalism.',
    # ── Media & Entertainment ──────────────────────────────────────────────
    'Animation & VFX': 'Animation and visual effects for film, TV and games.',
    'Content Creation': 'YouTube, Instagram, podcasts and writing for an online audience.',
    'Film & Television': 'Direction, cinematography, editing and production.',
    # ── Nursing & Allied Health ────────────────────────────────────────────
    'B.Sc MLT': 'Medical Laboratory Technology — running diagnostic tests.',
    'B.Sc Nursing': 'Four-year nursing degree.',
    'BPT (Physiotherapy)': 'Bachelor of Physiotherapy.',
    'GNM': 'General Nursing and Midwifery — three-year nursing diploma.',
    'MPT (Physiotherapy)': 'Master of Physiotherapy.',
    # ── Pharmacy ───────────────────────────────────────────────────────────
    'B.Pharmacy': 'Four-year Bachelor of Pharmacy.',
    'Pharm.D': 'Six-year Doctor of Pharmacy, focused on clinical practice.',
    'M.Pharmacy': 'Master of Pharmacy — postgraduate specialisation.',
    # ── Polytechnic diplomas ───────────────────────────────────────────────
    'Automobile': 'Diploma in Automobile Engineering.',
    'Chemical': 'Diploma in Chemical Engineering.',
    'Civil': 'Diploma in Civil Engineering.',
    'Electrical': 'Diploma in Electrical and Electronics Engineering.',
    'Electronics & Communication': 'Diploma in Electronics and Communication Engineering.',
    'Information Technology': 'Diploma in Information Technology.',
    'Mechanical': 'Diploma in Mechanical Engineering.',
    'Mining': 'Diploma in Mining Engineering.',
    'Textile': 'Diploma in Textile Technology.',
    # ── Arts & Humanities ──────────────────────────────────────────────────
    'Economics': 'BA / MA Economics and economist careers.',
    'English': 'BA / MA English literature and language.',
    'Geography': 'BA / MA Geography — land, climate and people.',
    'History': 'BA / MA History.',
    'Journalism': 'Journalism at degree and research level.',
    'Languages': 'Indian and foreign languages, translation and interpretation.',
    'Philosophy': 'BA / MA Philosophy.',
    'Political Science': 'BA / MA Political Science.',
    'Psychology': 'BA / B.Sc / MA Psychology and counselling.',
    'Public Administration': 'Government and public policy administration.',
    'Sociology': 'BA / MA Sociology.',
    # ── Education ──────────────────────────────────────────────────────────
    'B.Ed': 'Bachelor of Education — to teach Classes 6–12.',
    'D.El.Ed': 'Diploma in Elementary Education — to teach Classes 1–8.',
    'M.Ed': 'Master of Education.',
    # ── Law ────────────────────────────────────────────────────────────────
    'B.Com LLB': 'Five-year integrated commerce and law degree.',
    'BA LLB': 'Five-year integrated arts and law degree.',
    'BBA LLB': 'Five-year integrated business and law degree.',
    'LLB': 'Three-year law degree after graduation.',
    'LLM': 'Master of Laws.',
    # ── Management ─────────────────────────────────────────────────────────
    'Business Analytics': 'Using data to make business decisions.',
    'Entrepreneurship': 'Starting and running your own business.',
    'Finance': 'MBA Finance — corporate finance, investments and banking.',
    'Healthcare Management': 'Running hospitals and healthcare organisations.',
    'Human Resources': 'MBA HR — hiring, people development and HR strategy.',
    'IT & Systems': 'MBA in IT and systems management.',
    'International Business': 'Trade and business across countries.',
    'Marketing': 'MBA Marketing — brands, sales and digital marketing.',
    'Operations': 'MBA Operations — production, quality and process management.',
    'Rural Management': 'Management for rural development, cooperatives and NGOs.',
    'Strategy': 'Business strategy and consulting.',
    # ── ACCA papers / CFA levels ───────────────────────────────────────────
    'Applied Knowledge': 'ACCA Applied Knowledge — the three entry papers.',
    'Applied Skills': 'ACCA Applied Skills — the six technical papers.',
    'Strategic Professional': 'ACCA Strategic Professional — the final papers.',
    'Level 1': 'CFA Level I — investment tools and ethics.',
    'Level 2': 'CFA Level II — asset valuation.',
    'Level 3': 'CFA Level III — portfolio management.',
    # ── Medical ────────────────────────────────────────────────────────────
    'BAMS': 'Bachelor of Ayurvedic Medicine and Surgery.',
    'BDS': 'Bachelor of Dental Surgery.',
    'BHMS': 'Bachelor of Homoeopathic Medicine and Surgery.',
    'BSMS': 'Bachelor of Siddha Medicine and Surgery.',
    'BUMS': 'Bachelor of Unani Medicine and Surgery.',
    'MBBS': 'Bachelor of Medicine and Bachelor of Surgery — becoming a doctor.',
    'MD': 'Doctor of Medicine — postgraduate medical specialisation.',
    'MDS': 'Master of Dental Surgery.',
    'MS': 'Master of Surgery — postgraduate surgical specialisation.',
    # ── Science ────────────────────────────────────────────────────────────
    'Biology': 'B.Sc / M.Sc Biology.',
    'Biotechnology': 'Using living systems in medicine, agriculture and industry.',
    'Botany': 'B.Sc / M.Sc Botany — the study of plants.',
    'Chemistry': 'B.Sc / M.Sc Chemistry.',
    'Computer Science': 'B.Sc / M.Sc Computer Science (the science degree — B.Tech CSE is under Engineering).',
    'Data Science': 'Statistics, programming and machine learning on real data.',
    'Electronics': 'B.Sc / M.Sc Electronics.',
    'Environmental Science': 'B.Sc / M.Sc Environmental Science.',
    'Food Technology': 'Processing, preserving and testing food.',
    'Forensic Science': 'Science applied to crime investigation.',
    'Mathematics': 'B.Sc / M.Sc Mathematics.',
    'Microbiology': 'B.Sc / M.Sc Microbiology.',
    'Other': 'Any other science subject not listed here.',
    'Physics': 'B.Sc / M.Sc Physics.',
    'Statistics': 'B.Sc / M.Sc Statistics.',
    'Zoology': 'B.Sc / M.Sc Zoology — the study of animals.',
    # ── Sports ─────────────────────────────────────────────────────────────
    'Coaching': 'Coaching athletes and teams.',
    'Sports Physiotherapy': 'Treating and preventing sports injuries.',
    'Physiotherapy': 'Treating and preventing sports injuries.',
    'Sports Management': 'Running sports businesses, leagues and events.',
    # ── Study Abroad ───────────────────────────────────────────────────────
    'Applications & SOP': 'University applications, SOPs and recommendation letters.',
    'GRE / GMAT': 'Graduate admission tests for MS and MBA abroad.',
    'IELTS / TOEFL': 'English language tests for studying abroad.',
    'Scholarships & Funding': 'Scholarships, loans and funding for study abroad.',
    # ── Tourism & Hospitality ──────────────────────────────────────────────
    'Event Management': 'Planning weddings, conferences and events.',
    'Hotel Operations': 'Front office, food and beverage and housekeeping roles.',
    'Travel & Tourism': 'Travel agencies, tour operations and tourism careers.',
    # ── Veterinary ─────────────────────────────────────────────────────────
    'B.V.Sc & AH': 'Bachelor of Veterinary Science and Animal Husbandry.',
}


def main():
    with app.app_context():
        q = lambda sql, **p: db.session.execute(text(sql), p)
        ids = lambda: {r[0]: r[1] for r in q('SELECT `slug`, `id` FROM `domains`')}

        made = 0
        for name, parent in NEW:
            s = ids()
            if slug(name) in s:
                continue
            q("""INSERT INTO `domains` (`id`, `parent_id`, `name`, `slug`, `is_active`)
                 VALUES (:i, :p, :n, :s, 1)""",
              i=str(uuid.uuid4()), p=s.get(parent) if parent else None, n=name, s=slug(name))
            made += 1

        s = ids()
        moved = 0
        for child, parent in MOVE.items():
            if child not in s or (parent and parent not in s):
                print(f'  [skip] move {child} -> {parent}: not found')
                continue
            moved += q("""UPDATE `domains` SET `parent_id` = :p
                           WHERE `slug` = :c AND NOT (`parent_id` <=> :p)""",
                       p=s[parent] if parent else None, c=child).rowcount

        renamed = sum(q('UPDATE `domains` SET `name` = :n WHERE `slug` = :s AND `name` <> :n',
                        n=new, s=old).rowcount for old, new in RENAME.items())

        off = sum(q('UPDATE `domains` SET `is_active` = 0 WHERE `slug` = :s AND `is_active` = 1',
                    s=sl).rowcount for sl in SWITCH_OFF)

        described = 0
        for name, desc in DESCRIPTIONS.items():
            described += q("""UPDATE `domains` SET `description` = :d
                               WHERE `name` = :n AND (`description` IS NULL OR TRIM(`description`) = '')""",
                           d=desc, n=name).rowcount

        db.session.commit()

        total, active, nodesc, top = q("""
            SELECT COUNT(*), SUM(`is_active`),
                   SUM(`description` IS NULL OR TRIM(`description`) = ''),
                   SUM(`parent_id` IS NULL AND `is_active` = 1)
              FROM `domains`""").fetchone()
        print(f'added {made}, moved {moved}, renamed {renamed}, switched off {off}, described {described}')
        print(f'domains: {total} total, {active} live, {top} live top-level groups, {nodesc} without a description')


if __name__ == '__main__':
    main()
