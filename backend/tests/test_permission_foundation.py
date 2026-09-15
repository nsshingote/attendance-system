import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

from database import Base, SessionLocal, engine
from auth import has_permission, require_permission, require_roles
from models import Permission, RolePermission, User
from routers.permissions import get_my_permissions


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def create_user(db, role: str):
    user = User(
        name=f"Permission {role}",
        mobile=f"9999999{len(db.query(User).all()) + 100}",
        password_hash="hashed",
        role=role,
        department="Engineering",
        designation="Developer",
        status="active",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_permission_check_allows_role_with_permission():
    db = SessionLocal()
    permission = Permission(key="test.allowed", name="Allowed", module="test", action="allowed")
    db.add(permission)
    db.flush()
    user = create_user(db, "team_leader")
    db.add(RolePermission(role="team_leader", permission_id=permission.id))
    db.commit()

    assert has_permission(user, "test.allowed", db) is True
    db.close()


def test_permission_check_rejects_role_without_permission():
    db = SessionLocal()
    user = create_user(db, "team_leader")

    assert has_permission(user, "test.not_granted", db) is False
    db.close()


def test_missing_permission_is_rejected_with_forbidden():
    db = SessionLocal()
    user = create_user(db, "team_leader")
    checker = require_permission("test.missing")

    with pytest.raises(HTTPException) as error:
        checker(current_user=user, db=db)

    assert error.value.status_code == 403
    db.close()


def test_existing_role_guard_behavior_is_unchanged():
    db = SessionLocal()
    admin = create_user(db, "admin")
    employee = create_user(db, "user")

    assert require_roles("admin")(current_user=admin) is admin
    with pytest.raises(HTTPException) as error:
        require_roles("admin")(current_user=employee)

    assert error.value.status_code == 403
    db.close()


def test_team_leader_is_a_valid_user_role():
    db = SessionLocal()
    team_leader = create_user(db, "team_leader")

    assert team_leader.role == "team_leader"
    db.close()


def test_permissions_me_returns_only_role_permissions():
    db = SessionLocal()
    user = create_user(db, "team_leader")
    allowed = Permission(key="team.allowed", name="Allowed", module="team", action="allowed")
    denied = Permission(key="team.denied", name="Denied", module="team", action="denied")
    db.add_all([allowed, denied])
    db.flush()
    db.add(RolePermission(role="team_leader", permission_id=allowed.id))
    db.commit()

    permissions = get_my_permissions(db=db, current_user=user)
    assert "team.allowed" in permissions
    assert "team.denied" not in permissions
    db.close()
