"""
Run this once to create a super admin account:
    python create_super_admin.py
"""
import os
import uuid
from dotenv import load_dotenv

load_dotenv()

from portal import InitApp
from portal.models import db
from portal.models.super_admins import SuperAdmins
from werkzeug.security import generate_password_hash

app = InitApp().app()

with app.app_context():
    print("\n=== SKOVO Super Admin Setup ===\n")

    email    = input("Email    : ").strip().lower()
    name     = input("Name     : ").strip()
    password = input("Password : ").strip()

    if not email or not name or not password:
        print("All fields are required.")
        exit(1)

    if len(password) < 8:
        print("Password must be at least 8 characters.")
        exit(1)

    existing = SuperAdmins.query.filter_by(email=email).first()
    if existing:
        print(f"Super admin with email '{email}' already exists.")
        exit(1)

    sa = SuperAdmins(
        id=str(uuid.uuid4()),
        full_name=name,
        email=email,
        password_hash=generate_password_hash(password),
        status='active',
    )
    db.session.add(sa)
    db.session.commit()

    print(f"\nSuper admin created successfully!")
    print(f"  Email : {email}")
    print(f"  Login : POST /v1/super/login")
    print()
