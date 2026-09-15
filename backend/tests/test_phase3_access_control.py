import os

os.environ["DATABASE_URL"] = "sqlite:///:memory:"

import pytest
from fastapi import HTTPException

from auth import has_permission
from database import Base, SessionLocal, engine
from models import Permission, RolePermission, Team, TeamMember, User
from team_scope import require_team_member_access, require_team_permission


def setup_module(module):
    Base.metadata.create_all(bind=engine)


def teardown_module(module):
    Base.metadata.drop_all(bind=engine)


def create_user(db, role: str, suffix: str) -> User:
    user = User(
        name=f"Phase 3 {suffix}",
        mobile=f"777777{len(db.query(User).all()) + 2000}",
        password_hash="hashed",
        role=role,
        department="Engineering",
        designation="Developer",
        status="active",
    )
    db.add(user)
    db.commit()
    return user


def grant(db, role: str, key: str) -> None:
    permission = Permission(
        key=key,
        name=key,
        module=key.split(".", 1)[0],
        action=key.split(".", 1)[1],
    )
    db.add(permission)
    db.flush()
    db.add(RolePermission(role=role, permission_id=permission.id))
    db.commit()


def make_team(db, leader: User, member: User, name: str) -> Team:
    team = Team(name=name, team_leader_id=leader.id)
    db.add(team)
    db.flush()
    db.add(TeamMember(team_id=team.id, employee_id=member.id))
    db.commit()
    return team


def test_team_leader_can_access_member_with_permission_but_not_other_team():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "Leader")
    member = create_user(db, "user", "Member")
    other_leader = create_user(db, "team_leader", "Other Leader")
    other_member = create_user(db, "user", "Other Member")
    make_team(db, leader, member, "Phase 3 Team")
    make_team(db, other_leader, other_member, "Other Phase 3 Team")
    grant(db, "team_leader", "attendance.team_view")

    require_team_member_access(db, leader, member.id, "attendance.team_view")
    with pytest.raises(HTTPException) as error:
        require_team_member_access(db, leader, other_member.id, "attendance.team_view")
    assert error.value.status_code == 403
    db.close()


def test_team_leader_without_permission_is_rejected():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "No Permission")
    member = create_user(db, "user", "Restricted Member")
    make_team(db, leader, member, "Restricted Phase 3 Team")

    with pytest.raises(HTTPException) as error:
        require_team_member_access(db, leader, member.id, "leave.approve")
    assert error.value.status_code == 403
    db.close()


def test_inactive_team_and_removed_member_lose_access():
    db = SessionLocal()
    leader = create_user(db, "team_leader", "Inactive Leader")
    member = create_user(db, "user", "Inactive Member")
    team = make_team(db, leader, member, "Inactive Phase 3 Team")
    grant(db, "team_leader", "corrections.approve")

    require_team_member_access(db, leader, member.id, "corrections.approve")
    team.status = "inactive"
    db.commit()
    with pytest.raises(HTTPException):
        require_team_member_access(db, leader, member.id, "corrections.approve")

    team.status = "active"
    db.query(TeamMember).filter(
        TeamMember.team_id == team.id,
        TeamMember.employee_id == member.id,
    ).delete()
    db.commit()
    with pytest.raises(HTTPException):
        require_team_member_access(db, leader, member.id, "corrections.approve")
    db.close()


def test_admin_access_remains_unrestricted_by_team_scope():
    db = SessionLocal()
    admin = create_user(db, "admin", "Admin")
    superadmin = create_user(db, "superadmin", "Superadmin")
    assert require_team_permission(db, admin, "reports.team_view") == []
    assert require_team_permission(db, superadmin, "reports.team_view") == []
    assert has_permission(admin, "reports.team_view", db) is False
    db.close()
