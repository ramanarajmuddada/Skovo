"""
Migration: every town in Andhra Pradesh and Telangana, with its district.

The `cities` list had 20 AP and 13 Telangana towns, none with a district, so a
student from Tenali, Bhimavaram, Hindupur, Jadcherla or Ghatkesar could not
find where they live. This loads every urban local body in both states:

  Andhra Pradesh (28 districts, incl. Markapuram and Polavaram, 31 Dec 2025)
    municipal corporations, municipalities, nagar panchayats, district HQs
  Telangana (33 districts)
    municipal corporations, municipalities, Secunderabad cantonment, district
    HQs, and the 33 Hyderabad/Warangal-ring towns (Medchal, Ghatkesar,
    Boduppal, Manikonda, Tellapur, …) that were municipalities until the 2025
    mergers — still the name a student gives for home.

Source: Wikipedia "List of urban local bodies in Andhra Pradesh / Telangana"
(current, plus the 11 May 2024 Telangana revision for the merged towns) and
"List of districts of …" for district names. Fetched 16 Oct 2026.

Rules:
  * Upsert on (state_id, name) — the table's unique key. Existing rows keep
    their tier and sort order; only a NULL district is filled, and the row is
    made active.
  * New rows: corporations tier 2, everything else tier 3, sorted after the
    existing big cities, alphabetically.
  * Two AP names repeat across districts and carry the district in brackets:
    Atmakur (Nandyal / Nellore), Gudur (Kurnool / Nellore).
  * Spelling variants map onto the row that already exists (Rajamahendravaram
    → Rajahmundry, Mahabubnagar → Mahbubnagar) so nothing appears twice.
  * The district-only rows migrate_ap_districts.py adds on a fresh database
    ("NTR", "Palnadu", "West Godavari", …) are districts, not towns, and are
    switched off here. Nothing is deleted.

Never deletes. Idempotent. Run from anywhere:

    venv/Scripts/python.exe database/migrations/migrate_ap_ts_towns.py
"""
import uuid

import _bootstrap  # noqa: F401 — puts SKOVO_BACKEND on sys.path and cwd
from sqlalchemy import bindparam, text

from portal import InitApp
from portal.models import db

app = InitApp().app()

# (state code, town, district, kind)
TOWNS = [
    # ── Andhra Pradesh ──
    ('AP', 'Addanki', 'Prakasam', 'municipality'),
    ('AP', 'Adoni', 'Kurnool', 'municipality'),
    ('AP', 'Akividu', 'West Godavari', 'nagar_panchayat'),
    ('AP', 'Allagadda', 'Nandyal', 'municipality'),
    ('AP', 'Allur', 'Sri Potti Sriramulu Nellore', 'nagar_panchayat'),
    ('AP', 'Amalapuram', 'Dr. B. R. Ambedkar Konaseema', 'municipality'),
    ('AP', 'Amaravati', 'Guntur', 'capital'),
    ('AP', 'Amudalavalasa', 'Srikakulam', 'municipality'),
    ('AP', 'Anakapalli', 'Anakapalli', 'district_hq'),
    ('AP', 'Anantapur', 'Ananthapuramu', 'corporation'),
    ('AP', 'Atmakur (Nandyal)', 'Nandyal', 'municipality'),
    ('AP', 'Atmakur (Nellore)', 'Sri Potti Sriramulu Nellore', 'municipality'),
    ('AP', 'B. Kothakota', 'Annamayya', 'nagar_panchayat'),
    ('AP', 'Badvel', 'YSR Kadapa', 'municipality'),
    ('AP', 'Bapatla', 'Bapatla', 'municipality'),
    ('AP', 'Bethamcherla', 'Nandyal', 'nagar_panchayat'),
    ('AP', 'Bhimavaram', 'West Godavari', 'municipality'),
    ('AP', 'Bobbili', 'Vizianagaram', 'municipality'),
    ('AP', 'Buchireddypalem', 'Sri Potti Sriramulu Nellore', 'municipality'),
    ('AP', 'Chilakaluripet', 'Palnadu', 'municipality'),
    ('AP', 'Chimakurthy', 'Prakasam', 'municipality'),
    ('AP', 'Chinthalapudi', 'Eluru', 'nagar_panchayat'),
    ('AP', 'Chirala', 'Bapatla', 'municipality'),
    ('AP', 'Chittoor', 'Chittoor', 'corporation'),
    ('AP', 'Dachepalle', 'Palnadu', 'nagar_panchayat'),
    ('AP', 'Darsi', 'Prakasam', 'municipality'),
    ('AP', 'Dharmavaram', 'Sri Sathya Sai', 'municipality'),
    ('AP', 'Dhone', 'Nandyal', 'municipality'),
    ('AP', 'Elamanchili', 'Anakapalli', 'municipality'),
    ('AP', 'Eluru', 'Eluru', 'corporation'),
    ('AP', 'Giddaluru', 'Prakasam', 'municipality'),
    ('AP', 'Gollaprolu', 'Kakinada', 'municipality'),
    ('AP', 'Gooty', 'Ananthapuramu', 'municipality'),
    ('AP', 'Gudivada', 'Krishna', 'municipality'),
    ('AP', 'Gudur (Kurnool)', 'Kurnool', 'nagar_panchayat'),
    ('AP', 'Gudur (Nellore)', 'Sri Potti Sriramulu Nellore', 'municipality'),
    ('AP', 'Guntakal', 'Ananthapuramu', 'municipality'),
    ('AP', 'Guntur', 'Guntur', 'corporation'),
    ('AP', 'Gurajala', 'Palnadu', 'nagar_panchayat'),
    ('AP', 'Hindupur', 'Sri Sathya Sai', 'municipality'),
    ('AP', 'Ichchapuram', 'Srikakulam', 'municipality'),
    ('AP', 'Jaggayyapeta', 'NTR', 'municipality'),
    ('AP', 'Jangareddygudem', 'Eluru', 'municipality'),
    ('AP', 'Kadapa', 'YSR Kadapa', 'corporation'),
    ('AP', 'Kadiri', 'Sri Sathya Sai', 'municipality'),
    ('AP', 'Kakinada', 'Kakinada', 'corporation'),
    ('AP', 'Kalyandurg', 'Ananthapuramu', 'municipality'),
    ('AP', 'Kamalapuram', 'YSR Kadapa', 'nagar_panchayat'),
    ('AP', 'Kandukur', 'Sri Potti Sriramulu Nellore', 'municipality'),
    ('AP', 'Kanigiri', 'Markapuram', 'municipality'),
    ('AP', 'Kavali', 'Sri Potti Sriramulu Nellore', 'municipality'),
    ('AP', 'Kondapalli', 'NTR', 'municipality'),
    ('AP', 'Kovvur', 'East Godavari', 'municipality'),
    ('AP', 'Kuppam', 'Chittoor', 'municipality'),
    ('AP', 'Kurnool', 'Kurnool', 'corporation'),
    ('AP', 'Macherla', 'Palnadu', 'municipality'),
    ('AP', 'Machilipatnam', 'Krishna', 'corporation'),
    ('AP', 'Madakasira', 'Sri Sathya Sai', 'nagar_panchayat'),
    ('AP', 'Madanapalle', 'Annamayya', 'municipality'),
    ('AP', 'Mandapeta', 'Dr. B. R. Ambedkar Konaseema', 'municipality'),
    ('AP', 'Mangalagiri', 'Guntur', 'corporation'),
    ('AP', 'Markapuram', 'Markapuram', 'municipality'),
    ('AP', 'Mummidivaram', 'Dr. B. R. Ambedkar Konaseema', 'nagar_panchayat'),
    ('AP', 'Mydukur', 'YSR Kadapa', 'municipality'),
    ('AP', 'Nagari', 'Chittoor', 'municipality'),
    ('AP', 'Naidupeta', 'Tirupati', 'municipality'),
    ('AP', 'Nandigama', 'NTR', 'municipality'),
    ('AP', 'Nandikotkur', 'Nandyal', 'municipality'),
    ('AP', 'Nandyal', 'Nandyal', 'municipality'),
    ('AP', 'Narasapuram', 'West Godavari', 'municipality'),
    ('AP', 'Narasaraopet', 'Palnadu', 'municipality'),
    ('AP', 'Narsipatnam', 'Anakapalli', 'municipality'),
    ('AP', 'Nellimarla', 'Vizianagaram', 'nagar_panchayat'),
    ('AP', 'Nellore', 'Sri Potti Sriramulu Nellore', 'corporation'),
    ('AP', 'Nidadavolu', 'East Godavari', 'municipality'),
    ('AP', 'Nuzvid', 'Eluru', 'municipality'),
    ('AP', 'Ongole', 'Prakasam', 'corporation'),
    ('AP', 'Paderu', 'Alluri Sitharama Raju', 'district_hq'),
    ('AP', 'Palakollu', 'West Godavari', 'municipality'),
    ('AP', 'Palakonda', 'Parvathipuram Manyam', 'nagar_panchayat'),
    ('AP', 'Palamaner', 'Chittoor', 'municipality'),
    ('AP', 'Palasa-Kasibugga', 'Srikakulam', 'municipality'),
    ('AP', 'Parvathipuram', 'Parvathipuram Manyam', 'municipality'),
    ('AP', 'Pedana', 'Krishna', 'municipality'),
    ('AP', 'Peddapuram', 'Kakinada', 'municipality'),
    ('AP', 'Penukonda', 'Sri Sathya Sai', 'nagar_panchayat'),
    ('AP', 'Piduguralla', 'Palnadu', 'municipality'),
    ('AP', 'Pithapuram', 'Kakinada', 'municipality'),
    ('AP', 'Podili', 'Markapuram', 'nagar_panchayat'),
    ('AP', 'Ponnur', 'Guntur', 'municipality'),
    ('AP', 'Proddatur', 'YSR Kadapa', 'municipality'),
    ('AP', 'Pulivendula', 'YSR Kadapa', 'municipality'),
    ('AP', 'Punganur', 'Annamayya', 'municipality'),
    ('AP', 'Puttaparthi', 'Sri Sathya Sai', 'municipality'),
    ('AP', 'Puttur', 'Tirupati', 'municipality'),
    ('AP', 'Rajahmundry', 'East Godavari', 'corporation'),
    ('AP', 'Rajam', 'Vizianagaram', 'municipality'),
    ('AP', 'Rajampet', 'YSR Kadapa', 'municipality'),
    ('AP', 'Ramachandrapuram', 'Dr. B. R. Ambedkar Konaseema', 'municipality'),
    ('AP', 'Rampachodavaram', 'Polavaram', 'district_hq'),
    ('AP', 'Rayachoty', 'Annamayya', 'municipality'),
    ('AP', 'Rayadurgam', 'Ananthapuramu', 'municipality'),
    ('AP', 'Repalle', 'Bapatla', 'municipality'),
    ('AP', 'Salur', 'Parvathipuram Manyam', 'municipality'),
    ('AP', 'Samalkota', 'Kakinada', 'municipality'),
    ('AP', 'Sattenapalle', 'Palnadu', 'municipality'),
    ('AP', 'Srikakulam', 'Srikakulam', 'corporation'),
    ('AP', 'Srikalahasti', 'Tirupati', 'municipality'),
    ('AP', 'Sullurpeta', 'Tirupati', 'municipality'),
    ('AP', 'Tadepalli', 'Guntur', 'corporation'),
    ('AP', 'Tadepalligudem', 'West Godavari', 'municipality'),
    ('AP', 'Tadigadapa', 'Krishna', 'municipality'),
    ('AP', 'Tadipatri', 'Ananthapuramu', 'municipality'),
    ('AP', 'Tanuku', 'West Godavari', 'municipality'),
    ('AP', 'Tenali', 'Guntur', 'municipality'),
    ('AP', 'Tirupati', 'Tirupati', 'corporation'),
    ('AP', 'Tuni', 'Kakinada', 'municipality'),
    ('AP', 'Venkatagiri', 'Tirupati', 'municipality'),
    ('AP', 'Vijayawada', 'NTR', 'corporation'),
    ('AP', 'Vinukonda', 'Palnadu', 'municipality'),
    ('AP', 'Visakhapatnam', 'Visakhapatnam', 'corporation'),
    ('AP', 'Vizianagaram', 'Vizianagaram', 'corporation'),
    ('AP', 'Vuyyuru', 'Krishna', 'municipality'),
    ('AP', 'Yeleswaram', 'Kakinada', 'nagar_panchayat'),
    ('AP', 'Yemmiganur', 'Kurnool', 'municipality'),
    ('AP', 'Yerraguntla', 'YSR Kadapa', 'municipality'),
    # ── Telangana ──
    ('TS', '<br/>Kohir', 'Sangareddy', 'municipality'),
    ('TS', 'Achampet', 'Nagarkurnool', 'municipality'),
    ('TS', 'Adibatla', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Adilabad', 'Adilabad', 'municipality'),
    ('TS', 'Alair', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Alampuram', 'Jogulamba Gadwal', 'municipality'),
    ('TS', 'Aler', 'Yadadri Bhuvanagiri', 'former_ulb'),
    ('TS', 'Aliabad', 'Medchal-Malkajgiri', 'municipality'),
    ('TS', 'Amangal', 'Ranga Reddy', 'municipality'),
    ('TS', 'Amarchinta', 'Wanaparthy', 'municipality'),
    ('TS', 'Ameenpur', 'Sangareddy', 'former_ulb'),
    ('TS', 'Andole-Jogipet', 'Sangareddy', 'municipality'),
    ('TS', 'Armoor', 'Nizamabad', 'municipality'),
    ('TS', 'Asifabad', 'Kumuram Bheem Asifabad', 'municipality'),
    ('TS', 'Aswaraopeta', 'Bhadradri Kothagudem', 'municipality'),
    ('TS', 'Atmakur', 'Wanaparthy', 'municipality'),
    ('TS', 'Badangpet', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Badepalle', 'Mahabubnagar', 'former_ulb'),
    ('TS', 'Bandlaguda Jagir', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Banswada', 'Kamareddy', 'municipality'),
    ('TS', 'Bellampalle', 'Mancherial', 'municipality'),
    ('TS', 'Bhainsa', 'Nirmal', 'municipality'),
    ('TS', 'Bheemgal', 'Nizamabad', 'municipality'),
    ('TS', 'Bhongir', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Bhoodan Pochampally', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Bhoothpur', 'Mahabubnagar', 'municipality'),
    ('TS', 'Bhupalpally', 'Jayashankar Bhupalpally', 'municipality'),
    ('TS', 'Bichkunda', 'Kamareddy', 'municipality'),
    ('TS', 'Bodhan', 'Nizamabad', 'municipality'),
    ('TS', 'Boduppal', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Chandur', 'Nalgonda', 'municipality'),
    ('TS', 'Chennur', 'Mancherial', 'municipality'),
    ('TS', 'Cheriyal', 'Siddipet', 'municipality'),
    ('TS', 'Chevella', 'Ranga Reddy', 'municipality'),
    ('TS', 'Chityal', 'Nalgonda', 'municipality'),
    ('TS', 'Choppadandi', 'Karimnagar', 'municipality'),
    ('TS', 'Choutuppal', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Dammaiguda', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Devarakadra', 'Mahabubnagar', 'municipality'),
    ('TS', 'Devarakonda', 'Nalgonda', 'municipality'),
    ('TS', 'Dharmapuri', 'Jagtial', 'municipality'),
    ('TS', 'Dornakal', 'Mahabubabad', 'municipality'),
    ('TS', 'Dubbak', 'Siddipet', 'former_ulb'),
    ('TS', 'Dubbaka', 'Siddipet', 'municipality'),
    ('TS', 'Dundigal', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Gaddapotharam', 'Sangareddy', 'municipality'),
    ('TS', 'Gadwal', 'Jogulamba Gadwal', 'municipality'),
    ('TS', 'Gajwel', 'Siddipet', 'municipality'),
    ('TS', 'Ghatkesar', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Gummadidala', 'Sangareddy', 'municipality'),
    ('TS', 'Gundla Pochampalli', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Haliya', 'Nalgonda', 'municipality'),
    ('TS', 'Hanumakonda', 'Hanumakonda', 'district_hq'),
    ('TS', 'Husnabad', 'Siddipet', 'municipality'),
    ('TS', 'Huzurabad', 'Karimnagar', 'municipality'),
    ('TS', 'Huzurnagar', 'Suryapet', 'municipality'),
    ('TS', 'Hyderabad', 'Hyderabad', 'corporation'),
    ('TS', 'Ibrahimpatnam', 'Ranga Reddy', 'municipality'),
    ('TS', 'IDA Bollaram', 'Sangareddy', 'former_ulb'),
    ('TS', 'Ieeja', 'Jogulamba Gadwal', 'municipality'),
    ('TS', 'Indresham', 'Sangareddy', 'municipality'),
    ('TS', 'Isnapur', 'Sangareddy', 'municipality'),
    ('TS', 'Jadcherla', 'Mahabubnagar', 'municipality'),
    ('TS', 'Jagtial', 'Jagtial', 'municipality'),
    ('TS', 'Jalpally', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Jammikunta', 'Karimnagar', 'municipality'),
    ('TS', 'Jangaon', 'Jangaon', 'municipality'),
    ('TS', 'Jawaharnagar', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Jinnaram', 'Sangareddy', 'municipality'),
    ('TS', 'Kagaznagar', 'Kumuram Bheem Asifabad', 'municipality'),
    ('TS', 'Kallur', 'Khammam', 'municipality'),
    ('TS', 'Kalwakurthy', 'Nagarkurnool', 'municipality'),
    ('TS', 'Kamareddy', 'Kamareddy', 'municipality'),
    ('TS', 'Karimnagar', 'Karimnagar', 'corporation'),
    ('TS', 'Kesamudram', 'Mahabubabad', 'municipality'),
    ('TS', 'Khammam', 'Khammam', 'corporation'),
    ('TS', 'Khanapur', 'Nirmal', 'municipality'),
    ('TS', 'Kodad', 'Suryapet', 'municipality'),
    ('TS', 'Kodangal', 'Vikarabad', 'municipality'),
    ('TS', 'Kollapur', 'Nagarkurnool', 'municipality'),
    ('TS', 'Kompally', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Korutla', 'Jagtial', 'municipality'),
    ('TS', 'Kosgi', 'Narayanpet', 'municipality'),
    ('TS', 'Kothagudem', 'Bhadradri Kothagudem', 'corporation'),
    ('TS', 'Kothakota', 'Wanaparthy', 'municipality'),
    ('TS', 'Kothapalli', 'Karimnagar', 'former_ulb'),
    ('TS', 'Kothur', 'Ranga Reddy', 'municipality'),
    ('TS', 'Kyathanpally', 'Mancherial', 'municipality'),
    ('TS', 'Luxettipet', 'Mancherial', 'municipality'),
    ('TS', 'Maddur', 'Narayanpet', 'municipality'),
    ('TS', 'Madhira', 'Khammam', 'municipality'),
    ('TS', 'Mahabubabad', 'Mahabubabad', 'municipality'),
    ('TS', 'Mahbubnagar', 'Mahabubnagar', 'corporation'),
    ('TS', 'Makhtal', 'Narayanpet', 'municipality'),
    ('TS', 'Makthal', 'Narayanpet', 'former_ulb'),
    ('TS', 'Malkajgiri', 'Medchal-Malkajgiri', 'corporation'),
    ('TS', 'Mancherial', 'Mancherial', 'corporation'),
    ('TS', 'Mandamarri', 'Mancherial', 'municipality'),
    ('TS', 'Manikonda', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Manthani', 'Peddapalli', 'municipality'),
    ('TS', 'Manuguru', 'Bhadradri Kothagudem', 'municipality'),
    ('TS', 'Maripeda', 'Mahabubabad', 'municipality'),
    ('TS', 'Medak', 'Medak', 'municipality'),
    ('TS', 'Medchal', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Meerpet-Jillelguda', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Metpally', 'Jagtial', 'municipality'),
    ('TS', 'Miryalaguda', 'Nalgonda', 'municipality'),
    ('TS', 'Moinabad', 'Ranga Reddy', 'municipality'),
    ('TS', 'Mothkur', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Mudichintalapalle', 'Medchal-Malkajgiri', 'municipality'),
    ('TS', 'Mulugu', 'Mulugu', 'municipality'),
    ('TS', 'Nagaram', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Nagarkurnool', 'Nagarkurnool', 'municipality'),
    ('TS', 'Nakrekal', 'Nalgonda', 'municipality'),
    ('TS', 'Nalgonda', 'Nalgonda', 'corporation'),
    ('TS', 'Nandikonda', 'Nalgonda', 'municipality'),
    ('TS', 'Narayankhed', 'Sangareddy', 'municipality'),
    ('TS', 'Narayanpet', 'Narayanpet', 'municipality'),
    ('TS', 'Narsampet', 'Warangal', 'municipality'),
    ('TS', 'Narsapur', 'Medak', 'municipality'),
    ('TS', 'Narsingi', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Naspur', 'Mancherial', 'former_ulb'),
    ('TS', 'Neredcherla', 'Suryapet', 'municipality'),
    ('TS', 'Nirmal', 'Nirmal', 'municipality'),
    ('TS', 'Nizamabad', 'Nizamabad', 'corporation'),
    ('TS', 'Nizampet', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Palwancha', 'Bhadradri Kothagudem', 'former_ulb'),
    ('TS', 'Parigi', 'Vikarabad', 'municipality'),
    ('TS', 'Parkal', 'Hanumakonda', 'municipality'),
    ('TS', 'Pebbair', 'Wanaparthy', 'municipality'),
    ('TS', 'Pedda Amberpet', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Peddapalli', 'Peddapalli', 'municipality'),
    ('TS', 'Peerzadiguda', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Pocharam', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Raikal', 'Jagtial', 'municipality'),
    ('TS', 'Ramagundam', 'Peddapalli', 'corporation'),
    ('TS', 'Ramayampet', 'Medak', 'municipality'),
    ('TS', 'Sadasivpet', 'Sangareddy', 'municipality'),
    ('TS', 'Sangareddy', 'Sangareddy', 'municipality'),
    ('TS', 'Sathupalli', 'Khammam', 'municipality'),
    ('TS', 'Secunderabad', 'Hyderabad', 'cantonment'),
    ('TS', 'Shadnagar', 'Ranga Reddy', 'municipality'),
    ('TS', 'Shamirpet', 'Medchal-Malkajgiri', 'district_hq'),
    ('TS', 'Shamshabad', 'Ranga Reddy', 'district_hq'),
    ('TS', 'Shankarpalli', 'Ranga Reddy', 'municipality'),
    ('TS', 'Siddipet', 'Siddipet', 'municipality'),
    ('TS', 'Sircilla', 'Rajanna Sircilla', 'municipality'),
    ('TS', 'Station Ghanpur', 'Jangaon', 'municipality'),
    ('TS', 'Sultanabad', 'Peddapalli', 'municipality'),
    ('TS', 'Suryapet', 'Suryapet', 'municipality'),
    ('TS', 'Tandur', 'Vikarabad', 'municipality'),
    ('TS', 'Tellapur', 'Sangareddy', 'former_ulb'),
    ('TS', 'Thirumalagiri', 'Suryapet', 'municipality'),
    ('TS', 'Thorrur', 'Mahabubabad', 'municipality'),
    ('TS', 'Toopran', 'Medak', 'municipality'),
    ('TS', 'Tukkuguda', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Tumkunta', 'Medchal-Malkajgiri', 'former_ulb'),
    ('TS', 'Turkayamjal', 'Ranga Reddy', 'former_ulb'),
    ('TS', 'Vemulawada', 'Rajanna Sircilla', 'municipality'),
    ('TS', 'Vikarabad', 'Vikarabad', 'municipality'),
    ('TS', 'Waddepalle', 'Jogulamba Gadwal', 'municipality'),
    ('TS', 'Wanaparthy', 'Wanaparthy', 'municipality'),
    ('TS', 'Warangal', 'Warangal', 'corporation'),
    ('TS', 'Wardhannapet', 'Warangal', 'municipality'),
    ('TS', 'Wyra', 'Khammam', 'municipality'),
    ('TS', 'Yadagirigutta', 'Yadadri Bhuvanagiri', 'municipality'),
    ('TS', 'Yedulapuram', 'Khammam', 'municipality'),
    ('TS', 'Yellampet', 'Medchal-Malkajgiri', 'municipality'),
    ('TS', 'Yellandu', 'Bhadradri Kothagudem', 'municipality'),
    ('TS', 'Yellareddy', 'Kamareddy', 'municipality'),
    ('TS', 'Zaheerabad', 'Sangareddy', 'municipality'),
]

TIER = {'corporation': 2}          # everything else: 3

# Added by migrate_ap_districts.py on a fresh database. Districts, not towns —
# a student lives in Tenali, not in "Guntur district". Names that are also a
# town (Guntur, Eluru, Chittoor, …) are in TOWNS and stay on.
AP_DISTRICT_ONLY = [
    'Alluri Sitharama Raju', 'Ananthapuramu', 'Annamayya', 'Dr. B.R. Ambedkar Konaseema',
    'East Godavari', 'Krishna', 'NTR', 'Palnadu', 'Parvathipuram Manyam', 'Prakasam',
    'Sri Potti Sriramulu Nellore', 'Sri Sathya Sai', 'West Godavari', 'YSR Kadapa',
]


def main():
    with app.app_context():
        states = dict(db.session.execute(
            text("SELECT `code`, `id` FROM `states` WHERE `code` IN ('AP', 'TS')")
        ).fetchall())
        if set(states) != {'AP', 'TS'}:
            raise SystemExit('AP/TS missing from `states` — run migrate_geo.py first.')

        added = filled = 0
        for code, sid in states.items():
            existing = {r[0].lower(): (r[0], r[1]) for r in db.session.execute(
                text("SELECT `name`, `district` FROM `cities` WHERE `state_id` = :s"), {'s': sid})}
            next_order = (db.session.execute(
                text("SELECT IFNULL(MAX(`sort_order`), 0) FROM `cities` WHERE `state_id` = :s"),
                {'s': sid}).scalar() or 0) + 10

            for st, name, district, kind in TOWNS:
                if st != code:
                    continue
                hit = existing.get(name.lower())
                if hit:
                    filled += db.session.execute(text("""
                        UPDATE `cities`
                           SET `district`  = IFNULL(`district`, :d),
                               `is_active` = 1
                         WHERE `state_id` = :s AND `name` = :n
                    """), {'s': sid, 'n': hit[0], 'd': district}).rowcount
                    continue
                db.session.execute(text("""
                    INSERT INTO `cities` (`id`, `state_id`, `name`, `district`, `tier`, `sort_order`, `is_active`)
                    VALUES (:i, :s, :n, :d, :t, :o, 1)
                """), {'i': str(uuid.uuid4()), 's': sid, 'n': name, 'd': district,
                       't': TIER.get(kind, 3), 'o': next_order})
                next_order += 10
                added += 1

        off = db.session.execute(text("""
            UPDATE `cities` SET `is_active` = 0
             WHERE `state_id` = :s AND `name` IN :names AND `is_active` = 1
        """).bindparams(bindparam('names', expanding=True)),
            {'s': states['AP'], 'names': AP_DISTRICT_ONLY}).rowcount

        db.session.commit()

        for code, sid in states.items():
            n, d = db.session.execute(text("""
                SELECT COUNT(*), COUNT(DISTINCT `district`) FROM `cities`
                 WHERE `state_id` = :s AND `is_active` = 1
            """), {'s': sid}).fetchone()
            print(f'{code}: {n} active towns across {d} districts')
        print(f'added {added}, existing rows touched {filled}, district-only rows switched off {off}')


if __name__ == '__main__':
    main()
