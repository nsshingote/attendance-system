import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

from database import Base, SessionLocal, engine
from auth import has_permission, require_permission, require_roles
from models import Permission, RolePermission, User
from routers.permissions import (
    RolePermissionUpdate,
    get_my_permissions,
    get_team_leader_permissions,
    list_permissions,
    update_team_leader_permissions,
)


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


def test_admin_can_manage_team_leader_permissions_and_dashboard_stays_enabled():
    db = SessionLocal()
    admin = create_user(db, "admin")
    dashboard = Permission(key="dashboard.view", name="Dashboard", module="dashboard", action="view")
    attendance = Permission(key="attendance.team_view", name="Team attendance", module="attendance", action="team_view")
    db.add_all([dashboard, attendance])
    db.commit()
    db.add(RolePermission(role="admin", permission_id=attendance.id))
    db.commit()

    all_permissions = list_permissions(db=db)
    assert {item["key"] for item in all_permissions} >= {"dashboard.view", "attendance.team_view"}

    updated = update_team_leader_permissions(
        RolePermissionUpdate(permission_ids=[attendance.id]),
        db=db,
    )
    assert set(updated["permission_ids"]) == {dashboard.id, attendance.id}
    assert set(get_team_leader_permissions(db=db)) == {dashboard.id, attendance.id}
    assert db.query(RolePermission).filter(
        RolePermission.role == "admin",
        RolePermission.permission_id == attendance.id,
    ).count() == 1
    assert require_roles("admin")(current_user=admin) is admin
    db.close()


def test_permission_update_rejects_invalid_ids_and_keys():
    db = SessionLocal()
    dashboard = db.query(Permission).filter(Permission.key == "dashboard.view").first()
    if dashboard is None:
        dashboard = Permission(key="dashboard.view", name="Dashboard", module="dashboard", action="view")
        db.add(dashboard)
        db.commit()

    with pytest.raises(HTTPException) as invalid_id:
        update_team_leader_permissions(RolePermissionUpdate(permission_ids=[999999]), db=db)
    assert invalid_id.value.status_code == 422

    with pytest.raises(HTTPException) as invalid_key:
        update_team_leader_permissions(
            RolePermissionUpdate(permission_keys=["not.a.real.permission"]),
            db=db,
        )
    assert invalid_key.value.status_code == 422
    db.close()


def test_non_admin_is_rejected_by_admin_guard():
    db = SessionLocal()
    employee = create_user(db, "user")
    with pytest.raises(HTTPException) as error:
        require_roles("admin", "superadmin")(current_user=employee)
    assert error.value.status_code == 403
    db.close()
