"""
Migration: geography master data moves out of `masters` into real tables.

`masters` is (type, value, label, sort_order, is_active) — five columns, no
parent. A city belongs to a state, so the old data had to fake the hierarchy in
the type string with no foreign key and no integrity. This creates `states` and
`cities` properly and seeds all 28 states + 8 union territories, plus the cities
students actually come from.

The old `masters` rows for type 'state' / 'city' are left in place; the public
/auth/masters endpoint now serves those two types from these tables, so nothing
that reads the old contract breaks. They get deleted in a later step, once
nothing reads them.

Idempotent — upserts by state code and (state, city name). Run from SKOVO_BACKEND:
    python migrate_geo.py
"""
import uuid

from sqlalchemy import text

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from portal import InitApp
from portal.models import db
from portal.helpers.sql_file import apply_sql_file

app = InitApp().app()

SP_FILE = 'database/stored_procedures/geo.sql'

# code, name, kind, region
STATES = [
    ('AP', 'Andhra Pradesh',    'state', 'south'),
    ('AR', 'Arunachal Pradesh', 'state', 'northeast'),
    ('AS', 'Assam',             'state', 'northeast'),
    ('BR', 'Bihar',             'state', 'east'),
    ('CG', 'Chhattisgarh',      'state', 'central'),
    ('GA', 'Goa',               'state', 'west'),
    ('GJ', 'Gujarat',           'state', 'west'),
    ('HR', 'Haryana',           'state', 'north'),
    ('HP', 'Himachal Pradesh',  'state', 'north'),
    ('JH', 'Jharkhand',         'state', 'east'),
    ('KA', 'Karnataka',         'state', 'south'),
    ('KL', 'Kerala',            'state', 'south'),
    ('MP', 'Madhya Pradesh',    'state', 'central'),
    ('MH', 'Maharashtra',       'state', 'west'),
    ('MN', 'Manipur',           'state', 'northeast'),
    ('ML', 'Meghalaya',         'state', 'northeast'),
    ('MZ', 'Mizoram',           'state', 'northeast'),
    ('NL', 'Nagaland',          'state', 'northeast'),
    ('OD', 'Odisha',            'state', 'east'),
    ('PB', 'Punjab',            'state', 'north'),
    ('RJ', 'Rajasthan',         'state', 'north'),
    ('SK', 'Sikkim',            'state', 'northeast'),
    ('TN', 'Tamil Nadu',        'state', 'south'),
    ('TS', 'Telangana',         'state', 'south'),
    ('TR', 'Tripura',           'state', 'northeast'),
    ('UP', 'Uttar Pradesh',     'state', 'north'),
    ('UK', 'Uttarakhand',       'state', 'north'),
    ('WB', 'West Bengal',       'state', 'east'),
    # Union territories
    ('AN', 'Andaman & Nicobar Islands', 'ut', 'south'),
    ('CH', 'Chandigarh',                'ut', 'north'),
    ('DN', 'Dadra & Nagar Haveli and Daman & Diu', 'ut', 'west'),
    ('DL', 'Delhi',                     'ut', 'north'),
    ('JK', 'Jammu & Kashmir',           'ut', 'north'),
    ('LA', 'Ladakh',                    'ut', 'north'),
    ('LD', 'Lakshadweep',               'ut', 'south'),
    ('PY', 'Puducherry',                'ut', 'south'),
]

# Metros — tier 1. Everything else defaults to 2 for a state capital / major
# student city and 3 otherwise (set per-city below where it matters).
TIER_1 = {'Mumbai', 'Delhi', 'New Delhi', 'Bengaluru', 'Chennai', 'Kolkata',
          'Hyderabad', 'Pune', 'Ahmedabad'}

CITIES = {
    'AP': ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry',
           'Tirupati', 'Kakinada', 'Anantapur', 'Kadapa', 'Eluru', 'Ongole', 'Vizianagaram',
           'Srikakulam', 'Amaravati', 'Chittoor', 'Machilipatnam', 'Nandyal', 'Proddatur', 'Adoni'],
    'TS': ['Hyderabad', 'Secunderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Khammam',
           'Ramagundam', 'Mahbubnagar', 'Nalgonda', 'Adilabad', 'Suryapet', 'Siddipet', 'Medak'],
    'KA': ['Bengaluru', 'Mysuru', 'Hubballi', 'Mangaluru', 'Belagavi', 'Davanagere', 'Ballari',
           'Kalaburagi', 'Shivamogga', 'Tumakuru', 'Udupi', 'Manipal', 'Vijayapura', 'Hassan'],
    'TN': ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Erode',
           'Vellore', 'Thanjavur', 'Tiruppur', 'Dindigul', 'Kanchipuram', 'Nagercoil', 'Karur'],
    'KL': ['Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Thrissur', 'Kollam', 'Kannur',
           'Alappuzha', 'Palakkad', 'Kottayam', 'Malappuram'],
    'MH': ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Chhatrapati Sambhajinagar', 'Thane', 'Solapur',
           'Kolhapur', 'Amravati', 'Navi Mumbai', 'Sangli', 'Jalgaon', 'Nanded', 'Satara'],
    'DL': ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'Dwarka', 'Rohini'],
    'UP': ['Lucknow', 'Kanpur', 'Varanasi', 'Agra', 'Prayagraj', 'Ghaziabad', 'Noida',
           'Greater Noida', 'Meerut', 'Aligarh', 'Bareilly', 'Gorakhpur', 'Moradabad', 'Jhansi',
           'Mathura', 'Ayodhya'],
    'WB': ['Kolkata', 'Howrah', 'Durgapur', 'Asansol', 'Siliguri', 'Kharagpur', 'Darjeeling',
           'Malda', 'Bardhaman', 'Haldia'],
    'RJ': ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Ajmer', 'Bikaner', 'Alwar', 'Bhilwara', 'Sikar'],
    'GJ': ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Gandhinagar', 'Bhavnagar', 'Jamnagar',
           'Anand', 'Junagadh'],
    'MP': ['Bhopal', 'Indore', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Rewa', 'Satna'],
    'BR': ['Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Darbhanga', 'Purnia', 'Ara', 'Begusarai'],
    'PB': ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Pathankot'],
    'HR': ['Gurugram', 'Faridabad', 'Panipat', 'Ambala', 'Hisar', 'Karnal', 'Rohtak', 'Sonipat',
           'Kurukshetra'],
    'OD': ['Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore'],
    'JH': ['Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro Steel City', 'Hazaribagh', 'Deoghar'],
    'CG': ['Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Jagdalpur'],
    'AS': ['Guwahati', 'Dibrugarh', 'Silchar', 'Jorhat', 'Tezpur', 'Nagaon'],
    'UK': ['Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Nainital', 'Rishikesh'],
    'HP': ['Shimla', 'Solan', 'Mandi', 'Dharamshala', 'Kullu', 'Hamirpur'],
    'GA': ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa'],
    'JK': ['Srinagar', 'Jammu', 'Anantnag', 'Baramulla'],
    'CH': ['Chandigarh'],
    'PY': ['Puducherry', 'Karaikal'],
    'TR': ['Agartala', 'Udaipur'],
    'MN': ['Imphal'],
    'ML': ['Shillong', 'Tura'],
    'MZ': ['Aizawl'],
    'NL': ['Kohima', 'Dimapur'],
    'AR': ['Itanagar', 'Naharlagun'],
    'SK': ['Gangtok'],
    'AN': ['Port Blair'],
    'LD': ['Kavaratti'],
    'LA': ['Leh', 'Kargil'],
    'DN': ['Silvassa', 'Daman', 'Diu'],
}


def seed_states():
    for i, (code, name, kind, region) in enumerate(STATES):
        db.session.execute(text("""
            INSERT INTO `states` (`id`, `code`, `name`, `kind`, `region`, `sort_order`, `is_active`)
            VALUES (:i, :c, :n, :k, :r, :s, 1)
            ON DUPLICATE KEY UPDATE `name` = :n, `kind` = :k, `region` = :r, `sort_order` = :s, `is_active` = 1
        """), {'i': str(uuid.uuid4()), 'c': code, 'n': name, 'k': kind, 'r': region, 's': (i + 1) * 10})
    db.session.commit()


def seed_cities():
    ids = {r[0]: r[1] for r in db.session.execute(text("SELECT `code`, `id` FROM `states`")).fetchall()}
    for code, names in CITIES.items():
        state_id = ids.get(code)
        if not state_id:
            continue
        for i, name in enumerate(names):
            tier = 1 if name in TIER_1 else (2 if i < 4 else 3)
            db.session.execute(text("""
                INSERT INTO `cities` (`id`, `state_id`, `name`, `tier`, `sort_order`, `is_active`)
                VALUES (:i, :st, :n, :t, :s, 1)
                ON DUPLICATE KEY UPDATE `tier` = :t, `sort_order` = :s, `is_active` = 1
            """), {'i': str(uuid.uuid4()), 'st': state_id, 'n': name, 't': tier, 's': (i + 1) * 10})
    db.session.commit()


def main():
    with app.app_context():
        # Tables come from the models via db.create_all() during InitApp().
        procs = apply_sql_file(SP_FILE)
        seed_states()
        seed_cities()

        counts = db.session.execute(text("""
            SELECT (SELECT COUNT(*) FROM `states`) AS states,
                   (SELECT COUNT(*) FROM `states` WHERE `kind` = 'ut') AS uts,
                   (SELECT COUNT(*) FROM `cities`) AS cities,
                   (SELECT COUNT(DISTINCT `state_id`) FROM `cities`) AS states_with_cities
        """)).mappings().first()
        print(f"procedures loaded: {procs}")
        print(f"geo seeded: {dict(counts)}")


if __name__ == "__main__":
    main()
